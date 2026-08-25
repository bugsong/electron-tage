/**
 * 授权模块（license.js）测试
 * - 无效硬件字段过滤（占位符 / 全F / 全0 / 空值）
 * - 机器码派生：SHA256(有效字段按 | 拼接)，全部无效时返回 null
 * - 进阶码验签全流程：签名篡改 / 机器不匹配 / 已过期 / 格式错误 / 通过并持久化
 * 说明：验签用一次性生成的 ed25519 密钥对替换内置公钥，验证逻辑本身。
 */
const { test } = require('node:test')
const assert = require('node:assert')
const crypto = require('node:crypto')
const { freshUserData } = require('./helpers.cjs')

// helpers.cjs 先 mock electron（仅 app.getPath），license.js 可正常加载
const { _test, verifyActivationCode } = require('../src/main/license')

// 一次性 ed25519 密钥对（仅测试用，替换内置公钥）
const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519')
const TEST_PUBLIC_PEM = publicKey.export({ type: 'spki', format: 'pem' })

/** 用测试私钥生成合法进阶码：base64(json)|base64(签名) */
function makeActivationCode(machineCode, expiresAt) {
  const meta = JSON.stringify({ machineCode, expiresAt })
  const sig = crypto.sign(null, Buffer.from(meta, 'utf8'), privateKey)
  return Buffer.from(meta, 'utf8').toString('base64') + '|' + sig.toString('base64')
}

test('无效硬件字段被过滤（占位符/全F/全0/空值）', () => {
  const cases = [
    'To be filled by O.E.M.',
    'to be filled by o.e.m',
    'To Be Filled By O.E.M.',
    'FFFFFFFF',
    'ffffffffffff',
    '0'.repeat(16),
    '00000000-0000-0000-0000-000000000000',
    'ffffffff-ffff-ffff-ffff-ffffffffffff',
    '',
    '   ',
    'Default string',
    'None',
    'System Serial Number',
    'unknown',
    'N/A',
    'Not Specified'
  ]
  for (const c of cases) assert.equal(_test.cleanField(c), '', `应过滤: ${JSON.stringify(c)}`)
  assert.equal(_test.cleanField('WD-WCC6Y1234567'), 'WD-WCC6Y1234567')
  assert.equal(_test.cleanField('BFEBFBFF000906EA'), 'BFEBFBFF000906EA')
})

test('机器码 = SHA256(有效字段按 | 拼接)', () => {
  const sha = (s) => crypto.createHash('sha256').update(s).digest('hex')
  const raw = {
    cpuId: 'BFEBFBFF000906EA',
    disk: 'WD-WCC6Y1234567',
    biosUuid: 'A1B2C3D4-0000-0000-0000-000000000001'
  }
  assert.equal(
    _test.computeMachineCode(raw),
    sha('BFEBFBFF000906EA|WD-WCC6Y1234567|A1B2C3D4-0000-0000-0000-000000000001')
  )
  // 无效字段自动剔除后拼接
  const raw2 = { cpuId: 'To be filled by O.E.M.', disk: 'WD-WCC6Y1234567', biosUuid: 'ffffffff-ffff-ffff-ffff-ffffffffffff' }
  assert.equal(_test.computeMachineCode(raw2), sha('WD-WCC6Y1234567'))
  // 全部无效 / 空 → null
  assert.equal(_test.computeMachineCode({ cpuId: '', disk: 'FFFFFF', biosUuid: null }), null)
  assert.equal(_test.computeMachineCode(null), null)
})

test('进阶码校验：通过后持久化授权状态', async () => {
  freshUserData()
  const { initDb, getDb } = require('../src/main/db')
  initDb()
  _test.setPublicKey(TEST_PUBLIC_PEM)
  _test.setMachineCode('machine-abc-123')
  const future = Date.now() + 365 * 24 * 3600 * 1000

  const r = await verifyActivationCode(makeActivationCode('machine-abc-123', future))
  assert.equal(r.ok, true)
  assert.equal(r.expiresAt, future)

  const state = JSON.parse(getDb().prepare("SELECT value FROM settings WHERE key = 'license.state'").get().value)
  assert.equal(state.status, 'activated')
  assert.equal(state.machineCode, 'machine-abc-123')
  assert.equal(state.expiresAt, future)
})

test('进阶码校验：签名篡改 / 机器不匹配 / 已过期 / 格式错误', async () => {
  _test.setPublicKey(TEST_PUBLIC_PEM)
  _test.setMachineCode('machine-abc-123')
  const future = Date.now() + 365 * 24 * 3600 * 1000

  // 签名篡改：修改 json 原文后签名必然不匹配
  const good = makeActivationCode('machine-abc-123', future)
  const [b64Json] = good.split('|')
  const tamperedText = Buffer.from(b64Json, 'base64').toString('utf8').replace('machine-abc-123', 'machine-abc-124')
  const tamperedCode = Buffer.from(tamperedText, 'utf8').toString('base64') + '|' + good.split('|')[1]
  const r1 = await verifyActivationCode(tamperedCode)
  assert.equal(r1.ok, false)
  assert.equal(r1.reason, '签名篡改')

  // 机器不匹配：签名合法但 machineCode 指向别的设备
  const r2 = await verifyActivationCode(makeActivationCode('another-device', future))
  assert.equal(r2.ok, false)
  assert.equal(r2.reason, '机器不匹配')

  // 已过期
  const r3 = await verifyActivationCode(makeActivationCode('machine-abc-123', Date.now() - 1000))
  assert.equal(r3.ok, false)
  assert.equal(r3.reason, '已过期')

  // 格式错误
  assert.equal((await verifyActivationCode('not-a-code')).ok, false)
  assert.equal((await verifyActivationCode('a|b|c')).ok, false)
  assert.equal((await verifyActivationCode('')).ok, false)
  assert.equal((await verifyActivationCode(null)).ok, false)
})
