// ============================================================
// 应用更新模块（Windows）
// ------------------------------------------------------------
// 【安全约束】
//   可以  检查更新、下载、校验、自动安装：全部在主进程执行
//   不可  渲染进程不允许持有任何凭证；公开产物仓库零认证
//   不可  token 绝不能硬编码进源码/配置文件/打包产物
//
// 更新源：GitHub 公开产物仓库（owner=bugsong、repo=electron-tage、private=false）
// 发布令牌仅经构建/CI 环境变量注入，运行期零凭证（spec 4.3-2/5/6/7）。
// SSH 仅用于代码推送，与更新下载链路无关（spec 4.3-8）。
// ============================================================
const { ipcMain, app, shell, BrowserWindow } = require('electron')
const { getDb } = require('./db')
const { CancellationToken } = require('builder-util-runtime')

/* ---------------- UpdateConfig：更新源配置（spec 6.4） ---------------- */

const UpdateConfig = {
  feedType: 'github',
  owner: 'bugsong',
  repo: 'electron-tage',
  private: false,
  releaseType: 'release',
  // 发布令牌仅于构建/CI 环境变量注入（仅发布环节标识），运行期不读取、不落地、不渲染
  tokenSource: 'GH_TOKEN',
  // 备用更新源兜底（spec 4.3-9）：当前基线为空；配置后主源不可用时自动切换重试
  fallbackFeed: null,
  checkIntervalMs: 60 * 60 * 1000 // 同一会话内检查间隔：1 小时
}

const MANUAL_DOWNLOAD_URL = `https://github.com/${UpdateConfig.owner}/${UpdateConfig.repo}/releases`
const CHECK_TIMEOUT_MS = 10000
const INSTALL_DELAY_MS = 2000 // ready-to-install 后等待写入型 IPC 收敛再安装

/* ---------------- 版本比较（纯函数，可测） ---------------- */

/** 语义化版本号比较：a > b 返回 1；a < b 返回 -1；相等返回 0。非法段按 0 处理。 */
function compareVersions(a, b) {
  const pa = String(a == null ? '' : a)
    .replace(/^v/i, '')
    .split('.')
    .map((n) => parseInt(n, 10))
  const pb = String(b == null ? '' : b)
    .replace(/^v/i, '')
    .split('.')
    .map((n) => parseInt(n, 10))
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = Number.isFinite(pa[i]) ? pa[i] : 0
    const y = Number.isFinite(pb[i]) ? pb[i] : 0
    if (x !== y) return x > y ? 1 : -1
  }
  return 0
}

/* ---------------- UpdateState：内存状态机（spec 6.1） ---------------- */

const STATUS = {
  IDLE: 'idle',
  CHECKING: 'checking',
  UPDATE_AVAILABLE: 'update-available',
  NO_UPDATE: 'no-update',
  DOWNLOADING: 'downloading',
  READY_TO_INSTALL: 'ready-to-install',
  ERROR: 'error'
}

const state = {
  status: STATUS.IDLE,
  latestVersion: null,
  releaseNotes: '',
  manualDownloadUrl: null,
  errorReason: null,
  lastCheckedAt: null,
  progress: null,
  lastCheckAt: null // 内存记录最近一次检查发起时间（检查间隔限制）
}

function transition(next) {
  state.status = next
  return snapshot()
}

/** 组装当前状态快照（供 getState IPC 与事件推送共用） */
function snapshot() {
  return {
    ok: true,
    status: state.status,
    currentVersion: currentVersion(),
    latestVersion: state.latestVersion,
    releaseNotes: state.releaseNotes,
    manualDownloadUrl: state.manualDownloadUrl,
    errorReason: state.errorReason,
    lastCheckedAt: state.lastCheckedAt,
    progress: state.progress
  }
}

/** 惰性读取当前应用版本；读取失败回退 0.0.0（不阻断状态展示） */
function currentVersion() {
  try {
    return app.getVersion()
  } catch {
    return '0.0.0'
  }
}

/* ---------------- 结构化日志（spec 4.4） ---------------- */

function log(stage, fields = {}) {
  const entry = { stage, ...fields }
  if (!('result' in entry)) entry.result = 'ok'
  if (!('checkedAt' in entry)) entry.checkedAt = Date.now()
  console.log(`[updater] ${JSON.stringify(entry)}`)
}

/* ---------------- electron-updater 惰性实例与事件监听 ---------------- */

let autoUpdaterInstance = null
let listenersBound = false
let currentFeed = null
let currentDownloadToken = null

function getAutoUpdater() {
  if (!autoUpdaterInstance) {
    autoUpdaterInstance = require('electron-updater').autoUpdater
  }
  return autoUpdaterInstance
}

/** 主更新源不可用（网络受限/仓库不可达/限流）时切换备用更新源重试（spec 4.3-9） */
async function tryFallbackFeed(err) {
  if (!UpdateConfig.fallbackFeed) return false
  if (currentFeed === UpdateConfig.fallbackFeed) return false
  try {
    const eu = getAutoUpdater()
    currentFeed = UpdateConfig.fallbackFeed
    eu.setFeedURL(UpdateConfig.fallbackFeed)
    log('check', { result: 'fallback', reason: 'source-unavailable', feed: UpdateConfig.fallbackFeed.feedType })
    await eu.checkForUpdates()
    return true
  } catch {
    return false
  }
}

/** 错误分类（spec 6.1 errorReason 枚举） */
function classifyError(err) {
  const msg = String((err && err.message) || err || '')
  if (/404|not found|repo.*not|repository.*not/i.test(msg)) return 'source-unavailable'
  if (/ENOSPC|no space|disk/i.test(msg)) return 'disk-full'
  if (/parse|unexpected token|latest\.yml|manifest/i.test(msg)) return 'parse-error'
  if (/verify|sha512|integrity|校验/i.test(msg)) return 'verify-failed'
  if (/timeout|etimedout|econnrefused|enetunreach|socket|network|getaddrinfo/i.test(msg)) return 'network-error'
  return 'source-unavailable'
}

/** 置 error 状态并推送（检查/下载失败共用） */
function setErrorState(reason) {
  state.errorReason = reason
  state.lastCheckedAt = Date.now()
  transition(STATUS.ERROR)
  log('check', { result: 'fail', reason, stage: 'check' })
  broadcast('updater:state-changed', snapshot())
}

function bindListeners() {
  if (listenersBound) return
  listenersBound = true
  const eu = getAutoUpdater()

  eu.on('checking-for-update', () => {
    log('check', { stage: 'check', result: 'checking' })
  })

  eu.on('update-available', (info) => {
    const latest = String((info && info.version) || '')
    if (compareVersions(latest, currentVersion()) <= 0) {
      // 远端版本不高于当前版本：视为已是最新（spec 5.2.1）
      finishNoUpdate()
      return
    }
    state.latestVersion = latest
    state.releaseNotes = extractReleaseNotes(info)
    state.manualDownloadUrl = MANUAL_DOWNLOAD_URL
    state.lastCheckedAt = Date.now()
    state.errorReason = null
    state.lastCheckAt = state.lastCheckedAt
    // 惰性推送：仅更新状态与版本信息，不携带任何"展开/弹窗"指令（spec 5.2.1-2）
    transition(STATUS.UPDATE_AVAILABLE)
    persistCheckResult()
    log('check', { result: 'ok', version: latest, durationMs: Date.now() - (state.lastCheckAt || Date.now()) })
    broadcast('updater:state-changed', snapshot())
  })

  eu.on('update-not-available', () => {
    finishNoUpdate()
  })

  eu.on('error', (err) => {
    const reason = classifyError(err)
    // 主源不可用（网络受限/仓库不可达/限流）时尝试备用更新源兜底；无备用源则同步失败
    if ((reason === 'source-unavailable' || reason === 'network-error') && UpdateConfig.fallbackFeed) {
      tryFallbackFeed(err).then((fallbacked) => {
        if (fallbacked) return
        setErrorState(reason)
      })
      return
    }
    setErrorState(reason)
  })

  eu.on('download-progress', (p) => {
    state.progress = {
      percent: Number(p.percent) || 0,
      transferred: Number(p.transferred) || 0,
      total: Number(p.total) || 0,
      bytesPerSecond: Number(p.bytesPerSecond) || 0
    }
    broadcast('updater:download-progress', state.progress)
  })

  eu.on('update-downloaded', () => {
    state.progress = null
    state.errorReason = null
    transition(STATUS.READY_TO_INSTALL)
    log('download', { result: 'ok', stage: 'install', version: state.latestVersion })
    broadcast('updater:state-changed', snapshot())
    // 等待可能进行中的写入型 IPC 收敛后自动退出并安装（spec 5.4.1-4、4.2-5）
    setTimeout(() => {
      try {
        // 安装失败兜底：若安装异常退出前应用仍存活，则记录失败标记，下次启动提示可重试
        persistInstallFailMarker()
        getAutoUpdater().quitAndInstall()
      } catch (err) {
        log('install', { result: 'fail', reason: 'install-failed', stage: 'install' })
      }
    }, INSTALL_DELAY_MS)
  })
}

/** 提取更新简介（releaseNotes 可为字符串或数组） */
function extractReleaseNotes(info) {
  const n = info && info.releaseNotes
  if (!n) return ''
  if (typeof n === 'string') return n
  if (Array.isArray(n)) {
    return n
      .map((item) => (item && (item.note || item.body)) || '')
      .filter(Boolean)
      .join('\n')
  }
  return String(n)
}

/* ---------------- CheckResultStore：检查结果持久化（spec 2.3） ---------------- */

const LAST_CHECK_KEY = 'updater.lastCheck'

function persistCheckResult() {
  try {
    getDb()
      .prepare(
        `INSERT INTO settings (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`
      )
      .run(
        LAST_CHECK_KEY,
        JSON.stringify({
          status: state.status,
          latestVersion: state.latestVersion,
          releaseNotes: state.releaseNotes,
          manualDownloadUrl: state.manualDownloadUrl,
          checkedAt: state.lastCheckedAt
        })
      )
  } catch (err) {
    log('check', { result: 'fail', reason: 'persist-failed', stage: 'check', msg: String(err && err.message) })
  }
}

/** 读取留存的最近一次检查结果；损坏 JSON 返回 null（空态降级，不抛错，spec 5.1.3-1） */
function loadCheckResult() {
  try {
    const row = getDb().prepare('SELECT value FROM settings WHERE key = ?').get(LAST_CHECK_KEY)
    if (!row) return null
    const o = JSON.parse(row.value)
    if (!o || typeof o !== 'object') return null
    return o
  } catch {
    return null
  }
}

/* ---------------- 安装失败标记（spec 5.4.3-4） ---------------- */

const INSTALL_FAIL_KEY = 'updater.installFail'

/** 安装前写入失败标记；若安装成功新版本启动时会清除，失败则以原版本重启并读取提示 */
function persistInstallFailMarker() {
  try {
    getDb()
      .prepare(
        `INSERT INTO settings (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`
      )
      .run(INSTALL_FAIL_KEY, JSON.stringify({ version: state.latestVersion || '', at: Date.now() }))
  } catch {}
}

/** 读取并判定安装失败标记：应用以原版本启动（未升级）且存在标记 → 提示可重试 */
function readInstallFailMarker() {
  try {
    const row = getDb().prepare('SELECT value FROM settings WHERE key = ?').get(INSTALL_FAIL_KEY)
    if (!row) return null
    const o = JSON.parse(row.value)
    if (!o || typeof o !== 'object') return null
    // 已升级到新版本：安装成功，清除标记
    if (o.version && compareVersions(currentVersion(), o.version) > 0) {
      getDb().prepare('DELETE FROM settings WHERE key = ?').run(INSTALL_FAIL_KEY)
      return null
    }
    return { version: o.version, at: o.at }
  } catch {
    return null
  }
}

/** 检查完成但无新版本：仅更新"已是最新"标记与检查时间（spec 2.3-2） */
function finishNoUpdate() {
  state.latestVersion = null
  state.releaseNotes = ''
  state.manualDownloadUrl = null
  state.errorReason = null
  state.lastCheckedAt = Date.now()
  state.lastCheckAt = state.lastCheckedAt
  try {
    getDb()
      .prepare(
        `INSERT INTO settings (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`
      )
      .run(LAST_CHECK_KEY, JSON.stringify({ status: STATUS.NO_UPDATE, checkedAt: state.lastCheckedAt }))
  } catch {}
  transition(STATUS.NO_UPDATE)
  log('check', { result: 'ok', version: currentVersion(), stage: 'check' })
  broadcast('updater:state-changed', snapshot())
}

/* ---------------- 核心流程 ---------------- */

/** 手动检查更新（spec 5.2.1：唯一入口，用户点击触发） */
async function check() {
  if (!app.isPackaged) return { ok: false, reason: 'not-supported' }
  if (state.status === STATUS.CHECKING) return { ok: false, reason: 'checking' }
  if (state.status === STATUS.DOWNLOADING) return { ok: false, reason: 'checking' }
  // error 状态下重试立即响应，不受检查间隔限制（spec 5.2.1-5）
  if (state.status !== STATUS.ERROR && state.lastCheckAt && Date.now() - state.lastCheckAt < UpdateConfig.checkIntervalMs) {
    return { ok: false, reason: 'too-frequent' }
  }
  state.lastCheckAt = Date.now()
  transition(STATUS.CHECKING)
  broadcast('updater:state-changed', snapshot())
  try {
    bindListeners()
    // 回到主更新源（spec 4.5-1）：首次检查或上次切过备用源后都显式设置主源
    const eu = getAutoUpdater()
    eu.setFeedURL({
      provider: UpdateConfig.feedType,
      owner: UpdateConfig.owner,
      repo: UpdateConfig.repo,
      private: UpdateConfig.private
    })
    currentFeed = UpdateConfig
    // 10 秒超时兜底（spec 4.1-1）：无事件回调按网络异常处理
    const timedOut = await Promise.race([
      getAutoUpdater().checkForUpdates().then(() => false, () => false),
      new Promise((resolve) => setTimeout(() => resolve(true), CHECK_TIMEOUT_MS))
    ])
    if (timedOut) {
      setErrorState('network-error')
    }
  } catch (err) {
    setErrorState(classifyError(err))
  }
  return { ok: true }
}

/** 下载更新包（spec 5.4.1：用户点击"更新下载"唯一入口） */
async function download() {
  if (!app.isPackaged) return { ok: false, reason: 'not-supported' }
  if (state.status === STATUS.DOWNLOADING) return { ok: false, reason: 'downloading' }
  if (state.status !== STATUS.UPDATE_AVAILABLE && state.status !== STATUS.ERROR) {
    return { ok: false, reason: 'not-available' }
  }
  if (!state.latestVersion) {
    const saved = loadCheckResult()
    if (!saved || !saved.latestVersion) return { ok: false, reason: 'not-available' }
    state.latestVersion = saved.latestVersion
    state.releaseNotes = saved.releaseNotes || ''
    state.manualDownloadUrl = saved.manualDownloadUrl || MANUAL_DOWNLOAD_URL
  }
  state.errorReason = null
  state.progress = { percent: 0, transferred: 0, total: 0, bytesPerSecond: 0 }
  transition(STATUS.DOWNLOADING)
  broadcast('updater:state-changed', snapshot())
  const token = new CancellationToken()
  currentDownloadToken = token
  try {
    bindListeners()
    await getAutoUpdater().downloadUpdate(token)
  } catch (err) {
    // 取消/失败/校验失败：回退 update-available，保留最新版本信息供重试（spec 5.4.3）
    let reason = classifyError(err)
    if (reason === 'network-error' || reason === 'source-unavailable') reason = 'download-failed'
    state.progress = null
    state.errorReason = reason
    transition(STATUS.UPDATE_AVAILABLE)
    log('download', { result: 'fail', reason, stage: 'download' })
    broadcast('updater:state-changed', snapshot())
  } finally {
    currentDownloadToken = null
  }
  return { ok: true }
}

/** 取消下载（spec 5.4.1-3）：状态非 downloading 时幂等忽略 */
async function cancelDownload() {
  if (state.status !== STATUS.DOWNLOADING) return { ok: true, ignored: true }
  try {
    if (currentDownloadToken) currentDownloadToken.cancel()
  } catch {}
  state.progress = null
  state.errorReason = null
  transition(STATUS.UPDATE_AVAILABLE)
  log('download', { result: 'cancelled', stage: 'download' })
  broadcast('updater:state-changed', snapshot())
  return { ok: true }
}

/** 手动下载：系统默认浏览器打开公开产物仓库发布页面（spec 5.3.1-7） */
async function openManualDownload() {
  const url = state.manualDownloadUrl || (loadCheckResult()?.manualDownloadUrl) || MANUAL_DOWNLOAD_URL
  try {
    await shell.openExternal(url)
    return { ok: true }
  } catch {
    return { ok: false, reason: 'open-failed' }
  }
}

/** 查询更新状态（spec 5.2.1-4）：idle 时合并留存的最近一次检查结果 */
function getState() {
  if (state.status === STATUS.IDLE) {
    const saved = loadCheckResult()
    if (saved) {
      const savedIsNewer = !!saved.latestVersion && compareVersions(saved.latestVersion, currentVersion()) > 0
      if (savedIsNewer) {
        // 同步到内存状态机：后续 download() 依赖 state.status 判定可下载（spec 5.2.1-4）
        state.status = STATUS.UPDATE_AVAILABLE
        state.latestVersion = saved.latestVersion
        state.releaseNotes = saved.releaseNotes || ''
        state.manualDownloadUrl = saved.manualDownloadUrl || MANUAL_DOWNLOAD_URL
        state.lastCheckedAt = saved.checkedAt || null
      } else if (saved.status === STATUS.NO_UPDATE || saved.status === STATUS.UPDATE_AVAILABLE) {
        // 持久化版本不高于当前（含已升级到该版本）：视为已是最新（spec 5.2.1）
        state.status = STATUS.NO_UPDATE
        state.lastCheckedAt = saved.checkedAt || null
      }
    }
    // 安装失败标记：以原版本启动且未升级 → 提示"安装失败，可稍后重试"（spec 5.4.3-4）
    if (readInstallFailMarker()) {
      state.status = STATUS.ERROR
      state.errorReason = 'install-failed'
    }
  }
  return snapshot()
}

/* ---------------- IPC 接口（spec 2.2.2） ---------------- */

function broadcast(channel, payload) {
  try {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send(channel, payload)
    }
  } catch {}
}

function registerUpdaterIpc() {
  ipcMain.handle('updater:getState', () => getState())
  ipcMain.handle('updater:check', () => check())
  ipcMain.handle('updater:download', () => download())
  ipcMain.handle('updater:cancelDownload', () => cancelDownload())
  ipcMain.handle('updater:openManualDownload', () => openManualDownload())
}

/* ---------------- 测试专用钩子（生产代码不调用） ---------------- */
const _test = {
  setAutoUpdater: (mock) => {
    autoUpdaterInstance = mock
    listenersBound = false
  },
  emitFakeEvent: (name, payload) => {
    // 重新绑定监听（监听器挂在真实/mock 实例上），触发后即撤销以隔离用例
    const eu = getAutoUpdater()
    listenersBound = false
    bindListeners()
    if (eu.listeners && eu.listeners(name)) {
      for (const fn of eu.listeners(name)) {
        try {
          fn(payload)
        } catch {}
      }
    }
  },
  setCurrentFeed: (feed) => {
    currentFeed = feed
  },
  reset: () => {
    state.status = STATUS.IDLE
    state.latestVersion = null
    state.releaseNotes = ''
    state.manualDownloadUrl = null
    state.errorReason = null
    state.lastCheckedAt = null
    state.progress = null
    state.lastCheckAt = null
    currentFeed = null
    currentDownloadToken = null
  },
  compareVersions,
  getState,
  STATUS,
  state,
  persistInstallFailMarker,
  readInstallFailMarker
}
module.exports = {
  compareVersions,
  getState,
  check,
  download,
  cancelDownload,
  openManualDownload,
  registerUpdaterIpc,
  UpdateConfig,
  _test
}
