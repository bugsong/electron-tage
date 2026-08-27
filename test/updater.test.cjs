/**
 * 应用更新模块（updater.js）测试
 * - 版本比较纯函数：语义化版本号比较
 * - 检查结果 JSON 序列化/反序列化（损坏 JSON 返回 null）
 * - 状态机迁移：idle→checking→update-available/no-update/error 各分支
 * - checking 期间重复触发被忽略；检查间隔内重复触发被忽略
 * - 下载进度透传、下载完成进入 ready-to-install、失败回退、开发模式保护
 * 说明：mock electron-updater 的 autoUpdater 实例与事件序列，隔离真实更新链路。
 */
const { test } = require('node:test')
const assert = require('node:assert')
const { EventEmitter } = require('node:events')
const { freshUserData, setPackaged } = require('./helpers.cjs')

const { _test, compareVersions } = require('../src/main/updater')

/** 构造一个 mock 的 electron-updater 实例（EventEmitter + 关键方法） */
function makeMockUpdater() {
  const eu = new EventEmitter()
  eu.setFeedURL = () => {}
  eu.checkForUpdates = async () => {}
  eu.downloadUpdate = async () => {}
  eu.quitAndInstall = () => {}
  return eu
}

/** 用 mock 实例替换 autoUpdater 并重置状态；返回 mock 实例 */
function useMockUpdater() {
  const mock = makeMockUpdater()
  _test.setAutoUpdater(mock)
  _test.reset()
  setPackaged(true)
  return mock
}

/** 通过一次 check() 绑定事件监听器（bindListeners 惰性绑定） */
async function bindListeners(mock) {
  const { check } = require('../src/main/updater')
  await check()
  assert.equal(_test.state.status, 'checking')
}

test('版本比较：语义化版本号比较', () => {
  assert.equal(compareVersions('0.2.0', '0.1.0'), 1)
  assert.equal(compareVersions('0.1.0', '0.2.0'), -1)
  assert.equal(compareVersions('0.1.0', '0.1.0'), 0)
  assert.equal(compareVersions('v0.1.0', '0.1.0'), 0)
  assert.equal(compareVersions('1.0.0', '0.9.9'), 1)
  assert.equal(compareVersions('0.10.0', '0.9.0'), 1)
  assert.equal(compareVersions('', ''), 0)
})

test('检查结果持久化：序列化/反序列化，损坏 JSON 返回 null', async () => {
  freshUserData()
  const { initDb, getDb } = require('../src/main/db')
  initDb()
  const mock = useMockUpdater()
  await bindListeners(mock)

  // 通过 update-available 事件驱动持久化
  mock.emit('update-available', { version: '0.2.0', releaseNotes: '新增功能' })
  const row = getDb().prepare("SELECT value FROM settings WHERE key = 'updater.lastCheck'").get()
  assert.ok(row, '检查结果应已持久化')
  const saved = JSON.parse(row.value)
  assert.equal(saved.latestVersion, '0.2.0')
  assert.equal(saved.status, 'update-available')

  // 损坏 JSON：读取应返回 null 走空态降级（不抛错）
  getDb()
    .prepare("UPDATE settings SET value = ? WHERE key = 'updater.lastCheck'")
    .run('{not-json')
  _test.reset()
  const s2 = _test.getState()
  assert.equal(s2.ok, true)
  assert.equal(s2.status, 'idle')
})

test('状态机：idle→checking→update-available（惰性展示，不携带展开指令）', async () => {
  freshUserData()
  const { initDb } = require('../src/main/db')
  initDb()
  const mock = useMockUpdater()

  const r = await _test.getState()
  assert.equal(r.status, 'idle')

  // 触发检查（同时绑定事件监听）
  const { check } = require('../src/main/updater')
  const cr = await check()
  assert.equal(cr.ok, true)
  assert.equal(_test.state.status, 'checking')

  // 模拟发现新版本：状态迁移 update-available，携带版本信息与手动下载地址
  mock.emit('update-available', { version: '0.2.0', releaseNotes: 'v0.2.0 说明' })
  assert.equal(_test.state.status, 'update-available')
  assert.equal(_test.state.latestVersion, '0.2.0')
  assert.equal(_test.state.manualDownloadUrl, 'https://github.com/bugsong/electron-tage/releases')
})

test('状态机：idle→checking→no-update（已是最新）', async () => {
  freshUserData()
  const { initDb } = require('../src/main/db')
  initDb()
  const mock = useMockUpdater()
  await bindListeners(mock)

  // 远端版本不高于当前版本（0.1.0）→ 已是最新
  mock.emit('update-available', { version: '0.1.0' })
  assert.equal(_test.state.status, 'no-update')
})

test('状态机：idle→checking→error（更新源不可用）', async () => {
  freshUserData()
  const { initDb } = require('../src/main/db')
  initDb()
  const mock = useMockUpdater()
  await bindListeners(mock)

  mock.emit('error', new Error('getaddrinfo ENOTFOUND github.com'))
  assert.equal(_test.state.status, 'error')
  assert.equal(_test.state.errorReason, 'network-error')
})

test('检查间隔与并发保护：checking 期间与间隔内重复触发被忽略', async () => {
  freshUserData()
  const { initDb } = require('../src/main/db')
  initDb()
  useMockUpdater()

  const { check } = require('../src/main/updater')
  const r1 = await check()
  assert.equal(r1.ok, true)
  // 状态 checking 中再次触发 → ignored
  const r2 = await check()
  assert.equal(r2.ok, false)
  assert.equal(r2.reason, 'checking')
  // 完成一次检查后，间隔内重复触发 → too-frequent
  _test.state.lastCheckAt = Date.now()
  _test.state.status = 'idle'
  const r3 = await check()
  assert.equal(r3.ok, false)
  assert.equal(r3.reason, 'too-frequent')
})

test('下载流程：进度透传字段正确、下载完成进入 ready-to-install 并自动安装', async () => {
  freshUserData()
  const { initDb } = require('../src/main/db')
  initDb()
  const mock = useMockUpdater()

  // 先检查到新版本
  const { check, download } = require('../src/main/updater')
  await check()
  mock.emit('update-available', { version: '0.2.0', releaseNotes: 'x' })
  assert.equal(_test.state.status, 'update-available')

  // 下载
  const dr = await download()
  assert.equal(dr.ok, true)
  assert.equal(_test.state.status, 'downloading')

  // 进度事件透传
  mock.emit('download-progress', { percent: 42, transferred: 42 * 1024, total: 100 * 1024, bytesPerSecond: 1024 })
  assert.deepEqual(_test.state.progress, {
    percent: 42,
    transferred: 42 * 1024,
    total: 100 * 1024,
    bytesPerSecond: 1024
  })

  // 下载完成 → ready-to-install
  mock.emit('update-downloaded')
  assert.equal(_test.state.status, 'ready-to-install')
})

test('下载失败：回退 update-available 并附带可重试原因', async () => {
  freshUserData()
  const { initDb } = require('../src/main/db')
  initDb()
  const mock = useMockUpdater()

  const { check, download } = require('../src/main/updater')
  await check()
  mock.emit('update-available', { version: '0.2.0', releaseNotes: '' })

  mock.downloadUpdate = async () => {
    throw new Error('ENOSPC: no space left on device')
  }
  await download()
  assert.equal(_test.state.status, 'update-available')
  assert.equal(_test.state.errorReason, 'disk-full')
})

test('开发模式保护：未打包时 check/download 返回 not-supported', async () => {
  freshUserData()
  const { initDb } = require('../src/main/db')
  initDb()
  useMockUpdater()
  setPackaged(false)

  const { check, download } = require('../src/main/updater')
  const r1 = await check()
  assert.equal(r1.ok, false)
  assert.equal(r1.reason, 'not-supported')
  const r2 = await download()
  assert.equal(r2.ok, false)
  assert.equal(r2.reason, 'not-supported')
})

test('安装失败标记：写入与版本判定清除逻辑（getState 不自动展示，仅手动检测）', async () => {
  freshUserData()
  const { initDb, getDb } = require('../src/main/db')
  initDb()
  useMockUpdater()

  // 写入失败标记（记录目标版本 0.2.0）
  _test.persistInstallFailMarker()
  getDb()
    .prepare("UPDATE settings SET value = ? WHERE key = 'updater.installFail'")
    .run(JSON.stringify({ version: '0.2.0', at: Date.now() }))

  // getState 不再自动展示安装失败：初始恒为 idle，需用户手动检查
  _test.reset()
  const s1 = _test.getState()
  assert.equal(s1.status, 'idle')

  // 模拟升级到目标版本：readInstallFailMarker 判定安装成功并清除
  getDb()
    .prepare("UPDATE settings SET value = ? WHERE key = 'updater.installFail'")
    .run(JSON.stringify({ version: '0.0.5', at: Date.now() }))
  assert.equal(_test.readInstallFailMarker(), null)
  const row = getDb().prepare("SELECT value FROM settings WHERE key = 'updater.installFail'").get()
  assert.equal(row, undefined, '升级后失败标记应被清除')
})

test('getState 不自动恢复持久化记录：初始恒为 idle，仅手动检查才检测', () => {
  freshUserData()
  const { initDb, getDb } = require('../src/main/db')
  initDb()
  useMockUpdater()

  const writeSaved = (o) =>
    getDb()
      .prepare(
        `INSERT INTO settings (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`
      )
      .run('updater.lastCheck', JSON.stringify(o))

  // 即使持久化记录版本高于当前，getState 也不自动恢复更新状态
  writeSaved({ status: 'update-available', latestVersion: '0.2.0', releaseNotes: 'y', manualDownloadUrl: 'u', checkedAt: Date.now() })
  _test.reset()
  const s = _test.getState()
  assert.equal(s.status, 'idle', '不再自动恢复更新状态，初始为 idle')
  assert.equal(s.latestVersion, null)
})

test('手动检查发现新版本后状态机同步，download 不再返回 not-available', async () => {
  freshUserData()
  const { initDb } = require('../src/main/db')
  initDb()
  const mock = useMockUpdater()
  const { check, download } = require('../src/main/updater')

  // 手动检查 → mock 触发 update-available（版本高于当前 0.1.0）
  await check()
  mock.emit('update-available', { version: '0.2.0', releaseNotes: 'x' })
  assert.equal(_test.state.status, 'update-available')

  // 状态机已同步到 update-available，download 直接进入下载而非 not-available
  const r = await download()
  assert.equal(r.ok, true)
  assert.equal(_test.state.status, 'downloading')
})

test('error 状态下重试不受检查间隔限制', async () => {
  freshUserData()
  const { initDb } = require('../src/main/db')
  initDb()
  const mock = useMockUpdater()
  await bindListeners(mock)

  // 制造 error 状态（校验失败）
  mock.emit('error', new Error('sha512 integrity check failed'))
  assert.equal(_test.state.status, 'error')
  assert.equal(_test.state.errorReason, 'verify-failed')

  // 模拟刚检查过（间隔内），重试应跳过间隔立即执行
  _test.state.lastCheckAt = Date.now()
  const { check } = require('../src/main/updater')
  const rr = await check()
  assert.equal(rr.ok, true, 'error 状态下重试应跳过间隔立即执行')
  assert.equal(_test.state.status, 'checking')
})
