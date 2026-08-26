/**
 * 反调试防护（主进程）
 *
 * 分层防御：
 *   L1 启动参数硬扫描 —— 模块加载时同步执行（早于 app ready）
 *       拦截 --inspect / --inspect-brk / --remote-debugging-port /
 *       NODE_OPTIONS 注入 / ELECTRON_RUN_AS_NODE 等
 *   L2 DevTools 检测 —— webContents devtools-opened 事件 + 900ms 轮询兜底
 *   L3 时钟漂移检测 —— 主进程被调试器断点/单步暂停时，setInterval 会
 *       出现"排队连发"，相邻触发间隔远小于期望值，累计次数判定
 *
 * 放行通道（开发/测试用）：
 *   - 环境变量 TAGE_ALLOW_DEBUG=1  显式放行（打包产物同样生效，勿在生产传播）
 *   - 测试模式 COMATE_TEST=1 / COMATE_UI=1 自动放行
 *
 * 已知局限：反调试只能提高门槛，无法绝对阻止有决心且具备 Node 能力的
 * 逆向者（他们可以改 asar 删掉本模块）。它的价值在于拦掉 99% 的
 * "开个 DevTools / 加个启动参数"级别的尝试。
 */

const { app, BrowserWindow, ipcMain } = require('electron')

// ---------------------------------------------------------------------------
// 放行判断
// ---------------------------------------------------------------------------
const isExplicitlyAllowed = () => process.env.TAGE_ALLOW_DEBUG === '1'
const isTestMode = () => process.env.COMATE_TEST === '1' || process.env.COMATE_UI === '1'

// ---------------------------------------------------------------------------
// L1 启动参数扫描（同步）
// ---------------------------------------------------------------------------
const FORBIDDEN_ARGS = [
  { re: /^--inspect(?:-brk)?(?:=|$)/i, hint: 'node inspector' },
  { re: /^--inspect-port[=:]?\d*$/i, hint: 'node inspect port' },
  { re: /^--remote-debugging-(?:port|address|pipe)(?:=.*)?$/i, hint: 'cdp remote debugging' },
  { re: /^--remote-allow-origins(?:=.*)?$/i, hint: 'cdp origin whitelist' },
  { re: /^--renderer-startup-dialog$/i, hint: 'renderer startup dialog' }
]

function scanProcessArguments() {
  const hits = []
  for (const arg of process.argv) {
    for (const { re, hint } of FORBIDDEN_ARGS) {
      if (re.test(arg)) {
        hits.push(`${hint} (${arg})`)
        break
      }
    }
  }

  // NODE_OPTIONS 注入：攻击者常用 --require=evil.js / --inspect 附加调试器
  const nodeOptions = process.env.NODE_OPTIONS || ''
  if (/--(?:inspect|inspect-brk|require)\b/i.test(nodeOptions)) {
    hits.push(`NODE_OPTIONS 注入 (${nodeOptions})`)
  }

  // ELECTRON_RUN_AS_NODE=1：把 Electron 当纯 Node 运行，可绕过窗口直接加载主进程逻辑
  if (process.env.ELECTRON_RUN_AS_NODE === '1') {
    hits.push('ELECTRON_RUN_AS_NODE=1')
  }

  return hits
}

// ---------------------------------------------------------------------------
// 统一处置：随机延迟退出，避免攻击者通过退出时序反推检测逻辑
// ---------------------------------------------------------------------------
function killProcess(reason) {
  const delay = 250 + Math.floor(Math.random() * 500)
  setTimeout(() => {
    console.error(`[anti-debug] 检测到调试行为，进程退出。原因: ${reason}`)
    try {
      app.exit(1)
    } catch {
      process.exit(1)
    }
  }, delay)
}

// ---------------------------------------------------------------------------
// L2 DevTools 检测
// ---------------------------------------------------------------------------
function watchDevTools() {
  // 事件通道：新 webContents 创建时挂监听（比轮询更即时）
  app.on('web-contents-created', (_event, wc) => {
    wc.on('devtools-opened', () => killProcess('devtools-opened 事件'))
  })

  // 轮询兜底：覆盖事件被意外移除 / 事件未触发的场景
  const sweep = () => {
    for (const win of BrowserWindow.getAllWindows()) {
      try {
        if (win.webContents.isDevToolsOpened()) {
          killProcess('DevTools 已打开')
          return
        }
      } catch {
        /* 窗口销毁竞态，忽略 */
      }
    }
  }
  setInterval(sweep, 900)
}

// ---------------------------------------------------------------------------
// L3 时钟漂移检测（断点 / 单步调试）
// ---------------------------------------------------------------------------
function watchClockDrift() {
  const EXPECTED = 1400 // 检测周期 ms
  const MIN_GAP = 350 // 实际间隔低于此值视为"异常连发"（正常不可能）
  const WINDOW = 60000 // 统计窗口 ms
  const TRIGGER = 5 // 窗口内累计异常次数达此值即判定

  let last = Date.now()
  let windowStart = last
  let anomalies = 0

  setInterval(() => {
    const now = Date.now()
    const gap = now - last
    last = now

    if (gap < MIN_GAP) {
      // 进入新窗口则重置计数（保留当前这次异常）
      if (now - windowStart > WINDOW) {
        windowStart = now
        anomalies = 1
      } else {
        anomalies++
      }
      if (anomalies >= TRIGGER) {
        killProcess('时钟漂移异常（疑似断点/单步调试）')
      }
    } else if (now - windowStart > WINDOW) {
      windowStart = now
      anomalies = 0
    }
  }, EXPECTED)
}

// ---------------------------------------------------------------------------
// 入口
// ---------------------------------------------------------------------------
function initAntiDebug() {
  if (isExplicitlyAllowed()) {
    console.log('[anti-debug] 已通过 TAGE_ALLOW_DEBUG 显式放行')
    return { enabled: false }
  }
  if (isTestMode()) {
    console.log('[anti-debug] 测试模式（COMATE_TEST/COMATE_UI），反调试已禁用')
    return { enabled: false }
  }

  // L1 启动参数扫描必须在 app ready 前完成
  const hits = scanProcessArguments()
  if (hits.length > 0) {
    console.error('[anti-debug] 检测到调试启动参数:', hits.join('; '))
    killProcess('启动参数包含调试开关')
    return { enabled: true, terminated: true }
  }

  // L2/L3 运行时检测
  watchDevTools()
  watchClockDrift()

  // 渲染进程上报通道（渲染进程检测到调试行为时通知主进程统一处置）
  ipcMain.on('anti-debug:trigger', () => killProcess('渲染进程上报调试行为'))

  return { enabled: true }
}

module.exports = { initAntiDebug }
