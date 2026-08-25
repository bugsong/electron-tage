/**
 * 数据库加密（SQLCipher + safeStorage 密钥）测试
 * - 首次初始化即生成加密库与 key.enc（磁盘上不含明文密钥）
 * - 密钥持久化：重新初始化（模拟重启）后数据可正常访问
 * - 已有未加密数据库自动迁移为加密库（数据保留）
 * - 密钥缺失 / key.enc 损坏时的行为
 * - 错误密钥无法打开加密库
 * - wipeKey 擦除内存密钥副本
 * - moveDb 迁移后加密与数据均保持
 */
const { test } = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')
const { freshUserData } = require('./helpers.cjs')

const KEY_FILE = 'key.enc'
const Database = require('better-sqlite3-multiple-ciphers')

function assertEncryptedReadFails(file) {
  const probe = new Database(file)
  try {
    assert.throws(() => probe.prepare('SELECT count(*) FROM sqlite_master').get(), /not a database|encrypted/i)
  } finally {
    probe.close()
  }
}

test('首次初始化：数据库已加密，key.enc 落盘且不含明文密钥', () => {
  const dir = freshUserData()
  const { initDb, getDb } = require('../src/main/db')
  initDb()
  getDb().prepare("INSERT INTO settings (key, value) VALUES ('k', 'v')").run()
  getDb().close()

  const dbFile = path.join(dir, 'tage.db')
  const keyFile = path.join(dir, KEY_FILE)
  assert.ok(fs.existsSync(dbFile), '数据库文件应存在')
  assert.ok(fs.existsSync(keyFile), 'key.enc 应存在')

  // key.enc 内容不应含明文密钥（64 位 hex 密钥模式）
  const text = fs.readFileSync(keyFile).toString('utf8')
  assert.ok(!/[0-9a-f]{64}/i.test(text), 'key.enc 不应包含明文密钥')

  // 无密钥打开加密库读取失败
  assertEncryptedReadFails(dbFile)
})

test('密钥持久化：重新初始化后数据完整可访问', () => {
  freshUserData()
  const { initDb, getDb } = require('../src/main/db')
  initDb()
  getDb().prepare("INSERT INTO settings (key, value) VALUES ('persist', 'yes')").run()
  getDb().close()

  // 模拟重启：key.enc 解密出同一密钥，加密库可正常打开
  initDb()
  const row = getDb().prepare("SELECT value FROM settings WHERE key = 'persist'").get()
  assert.equal(row.value, 'yes')
  getDb().close()
})

test('已有未加密数据库自动迁移为加密库（数据保留）', () => {
  const dir = freshUserData()
  // 手工构造历史版本遗留的未加密库
  const dbFile = path.join(dir, 'tage.db')
  const plain = new Database(dbFile)
  plain.exec('CREATE TABLE legacy (id INTEGER PRIMARY KEY, note TEXT)')
  plain.prepare('INSERT INTO legacy (note) VALUES (?)').run('旧数据')
  plain.close()

  const { initDb, getDb } = require('../src/main/db')
  initDb()
  const row = getDb().prepare('SELECT note FROM legacy WHERE id = 1').get()
  assert.equal(row.note, '旧数据', '迁移后旧数据应保留')
  getDb().close()

  // 迁移后已加密：无密钥读取失败
  assertEncryptedReadFails(dbFile)
})

test('密钥缺失时无法打开既有加密库', () => {
  const dir = freshUserData()
  const { initDb, getDb } = require('../src/main/db')
  initDb()
  getDb().close()

  // 删除 key.enc：重新初始化会生成新密钥，但打不开旧加密库
  fs.rmSync(path.join(dir, KEY_FILE), { force: true })
  const { initDb: reinit } = require('../src/main/db')
  assert.throws(() => reinit(), /not a database|encrypted/i)
})

test('key.enc 损坏时初始化报错', () => {
  const dir = freshUserData()
  const { initDb, getDb } = require('../src/main/db')
  initDb()
  getDb().close()

  fs.writeFileSync(path.join(dir, KEY_FILE), 'corrupted-content')
  const { initDb: reinit } = require('../src/main/db')
  assert.throws(() => reinit(), /密钥文件内容无效/)
})

test('错误密钥无法打开加密库', () => {
  const dir = freshUserData()
  const { initDb, getDb } = require('../src/main/db')
  initDb()
  getDb().close()

  const dbFile = path.join(dir, 'tage.db')
  const probe = new Database(dbFile)
  try {
    probe.pragma(`key = "x'${'00'.repeat(32)}'"`)
    assert.throws(() => probe.prepare('SELECT * FROM settings').get(), /not a database|encrypted/i)
  } finally {
    probe.close()
  }
})

test('wipeKey 擦除内存中的密钥副本', () => {
  freshUserData()
  const { loadKey, wipeKey } = require('../src/main/keyring')
  const key = loadKey()
  const before = Buffer.from(key)
  wipeKey(key)
  assert.ok(key.every((b) => b === 0), '密钥应被清零')

  // 磁盘 key.enc 仍可还原同一密钥
  const key2 = loadKey()
  assert.equal(key2.toString('hex'), before.toString('hex'), '重新加载的密钥应一致')
  wipeKey(key2)
})

test('moveDb 迁移后数据库仍加密且数据完整', async () => {
  const oldDir = freshUserData()
  const { initDb, getDb, moveDb } = require('../src/main/db')
  initDb()
  getDb().prepare("INSERT INTO settings (key, value) VALUES ('moved', 'yes')").run()

  const newDir = path.join(oldDir, '..', 'enc-moved')
  const res = await moveDb(newDir)
  assert.equal(res.status, 'ok')
  assert.equal(getDb().prepare("SELECT value FROM settings WHERE key = 'moved'").get().value, 'yes')
  getDb().close()

  // 新位置库为加密库
  assertEncryptedReadFails(path.join(newDir, 'tage.db'))
  // 旧位置文件已清理
  assert.ok(!fs.existsSync(path.join(oldDir, 'tage.db')), '旧 tage.db 应被清理')
})
