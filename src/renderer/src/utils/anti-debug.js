/**
 * 反调试防护（渲染进程）
 *
 * 作用域：生产构建（file:// 加载）时全部生效；
 *        开发模式（Vite dev server 的 http:// 加载）仅拦截快捷键并提示，不触发退出，
 *        避免影响日常开发调试。
 *
 * 手段：
 *   - 快捷键拦截：F12 / Ctrl+Shift+I / Ctrl+Shift+J / Ctrl+Shift+C / Ctrl+U
 *   - Debugger 钩子检测：Function.prototype.toString 是否被篡改、源码是否出现 debugger
 *   - DevTools 窗口尺寸启发式：outerWidth-innerWidth 突变（纵深防御，主进程 900ms
 *     轮询 isDevToolsOpened 已覆盖主场景，此处兜底）
 *   - 时钟漂移检测：断点/单步暂停导致 setInterval 排队连发
 *
 * 检测到调试行为 → 通过 preload 暴露的 securityTrigger 上报主进程统一处置（退出）。
 */

const IS_DEV_SERVER = location.protocol === 'http:' || location.protocol === 'https:'

function report() {
  try {
    if (window.api && typeof window.api.securityTrigger === 'function') {
      window.api.securityTrigger()
    }
  } catch {
    /* 忽略 */
  }
}

// ---------------------------------------------------------------- 快捷键
function isDevShortcut(e) {
  const key = e.key
  const ctrl = e.ctrlKey || e.metaKey
  return (
    key === 'F12' ||
    (ctrl && e.shiftKey && (key === 'I' || key === 'J' || key === 'C')) ||
    (ctrl && key.toLowerCase() === 'u' && !e.shiftKey)
  )
}

function blockShortcuts() {
  window.addEventListener(
    'keydown',
    (e) => {
      if (isDevShortcut(e)) {
        e.preventDefault()
        e.stopPropagation()
        report()
      }
    },
    true // 捕获阶段拦截，先于页面内监听
  )
}

function blockShortcutsPassive() {
  window.addEventListener(
    'keydown',
    (e) => {
      if (isDevShortcut(e)) {
        e.preventDefault()
        e.stopPropagation()
        console.warn('[anti-debug] 开发模式拦截调试快捷键（正式构建下将上报退出）')
      }
    },
    true
  )
}

// ---------------------------------------------------------------- debugger 钩子
function watchDebuggerHook() {
  const NATIVE_RE = /\{\s*\[native code\]\s*\}/

  const check = () => {
    try {
      const fnSrc = Function.prototype.toString.call(Function)
      // 正常为 "function Function() { [native code] }"；被篡改注入 debugger 后会暴露
      if (!NATIVE_RE.test(fnSrc) || fnSrc.includes('debugger')) {
        report()
        return true
      }
    } catch {
      /* 读取异常不判定，避免误报 */
    }
    return false
  }

  check()
  setInterval(check, 3000)
}

// ---------------------------------------------------------------- 窗口尺寸启发式
function watchWindowSize() {
  const THRESHOLD = 160 // DevTools 侧边停靠会使 inner 尺寸明显缩小
  const check = () => {
    try {
      const shrinkW = window.outerWidth - window.innerWidth
      const shrinkH = window.outerHeight - window.innerHeight
      if (shrinkW > THRESHOLD || shrinkH > THRESHOLD) report()
    } catch {
      /* 忽略 */
    }
  }
  setInterval(check, 1500)
}

// ---------------------------------------------------------------- 时钟漂移
function watchClockDrift() {
  const EXPECTED = 1400
  const MIN_GAP = 350
  const WINDOW = 60000
  const TRIGGER = 5

  let last = Date.now()
  let windowStart = last
  let anomalies = 0

  setInterval(() => {
    const now = Date.now()
    const gap = now - last
    last = now

    if (gap < MIN_GAP) {
      if (now - windowStart > WINDOW) {
        windowStart = now
        anomalies = 1
      } else {
        anomalies++
      }
      if (anomalies >= TRIGGER) report()
    } else if (now - windowStart > WINDOW) {
      windowStart = now
      anomalies = 0
    }
  }, EXPECTED)
}

// ---------------------------------------------------------------- 入口
export function initRendererAntiDebug() {
  if (IS_DEV_SERVER) {
    blockShortcutsPassive()
    return { enabled: false, mode: 'dev' }
  }

  blockShortcuts()
  watchDebuggerHook()
  watchWindowSize()
  watchClockDrift()

  return { enabled: true, mode: 'production' }
}
