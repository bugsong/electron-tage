// ============================================================
// 软件生命周期检测（惰性、容错）
// ------------------------------------------------------------
//   启动时从 GitHub raw 拉取 info.json，失败则静默放行；
//   成功且已过期 → 弹出 10s 倒计时窗口后退出。
//   注意：必须用 raw.githubusercontent.com，blob 链接返回的是 HTML 页。
// ============================================================
const { app, BrowserWindow, net } = require('electron')

const REPO = 'bugsong/electron-tage'
const BRANCH = 'main'
const FILE = 'info.json'
const FETCH_TIMEOUT_MS = 10000
const CHECK_DELAY_MS = 5000
const COUNTDOWN_MS = 10000

/** 源 1：GitHub raw + 时间戳破缓存（raw 自身有 5 分钟缓存） */
async function fetchFromRaw() {
  const url = `https://raw.githubusercontent.com/${REPO}/${BRANCH}/${FILE}?t=${Date.now()}`
  // console.log('[lifecycle] 请求 raw:', url)
  const resp = await net.fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
  // console.log('[lifecycle] raw 状态:', resp.status)
  if (!resp.ok) return null
  return await resp.json()
}

/** 源 2：GitHub Contents API，返回 base64，完全不缓存 */
async function fetchFromApi() {
  const url = `https://api.github.com/repos/${REPO}/contents/${FILE}?ref=${BRANCH}`
  // console.log('[lifecycle] 请求 api:', url)
  const resp = await net.fetch(url, {
    headers: { 'User-Agent': 'tage-app', Accept: 'application/vnd.github+json' },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
  })
  // console.log('[lifecycle] api 状态:', resp.status)
  if (!resp.ok) return null
  const data = await resp.json()
  if (!data || !data.content) return null
  return JSON.parse(Buffer.from(data.content, 'base64').toString('utf8'))
}

/** 拉取生命周期信息；依次尝试多个源，全部失败返回 null（惰性容错） */
async function fetchLifecycle() {
  const sources = [fetchFromRaw, fetchFromApi]
  for (const fn of sources) {
    try {
      const json = await fn()
      if (json && json.expiration_date) {
        // console.log('[lifecycle] 解析成功:', json)
        return json
      }
    } catch (err) {
      // console.error('[lifecycle] 该源失败:', err && err.message)
    }
  }
  return null
}

/** 弹出无框倒计时窗口；10s 后强制退出 */
function showCountdownWindow() {
  const win = new BrowserWindow({
    width: 380,
    height: 200,
    frame: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    center: true,
    backgroundColor: '#1f2329',
    webPreferences: { contextIsolation: true, nodeIntegration: false }
  })

  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head><meta charset="utf-8"><style>
  *{margin:0;padding:0;box-sizing:border-box}
  html,body{height:100%;font-family:"Microsoft YaHei",sans-serif}
  body{display:flex;flex-direction:column;align-items:center;justify-content:center;
       background:#1f2329;color:#e6e6e6;user-select:none}
  .msg{font-size:17px;line-height:1.6;text-align:center;padding:0 24px}
  .num{font-size:54px;font-weight:700;color:#ff6b6b;margin-top:14px;
       font-variant-numeric:tabular-nums}
  .unit{font-size:14px;color:#9aa0a6;margin-top:4px}
</style></head>
<body>
  <div class="msg">软件的生命已到尽头<br>感谢陪伴！</div>
  <div class="num" id="n">10</div>
  <div class="unit">秒后自动退出</div>
  <script>
    let s = 10;
    const el = document.getElementById('n');
    setInterval(() => { if (s > 0) el.textContent = --s; }, 1000);
  </script>
</body></html>`

  win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))

  setTimeout(() => {
    try { if (!win.isDestroyed()) win.close() } catch {}
    app.quit()
  }, COUNTDOWN_MS)
}

/**
 * 启动时检测生命周期（惰性）：
 *   拉取失败 / 字段缺失 / 未过期 → 静默放行
 *   已过期 → 弹倒计时窗口
 */
async function checkLifecycle() {
  await new Promise((r) => setTimeout(r, CHECK_DELAY_MS))
  const info = await fetchLifecycle()
  if (!info || !info.expiration_date) {
    // console.log('[lifecycle] 无过期字段或全部源失败，放行')
    return
  }
  const expires = new Date(info.expiration_date).getTime()
  // console.log('[lifecycle] 过期:', new Date(expires).toISOString(), '| 当前:', new Date().toISOString())
  if (!Number.isFinite(expires)) return
  if (expires > Date.now()) {
    // console.log('[lifecycle] 未到期，放行')
    return
  }
  // console.log('[lifecycle] 已到期，弹倒计时窗口')
  showCountdownWindow()
}

module.exports = { checkLifecycle }
