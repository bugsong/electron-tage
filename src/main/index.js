const { app, BrowserWindow, dialog, protocol, net } = require('electron')
const path = require('node:path')
const os = require('node:os')
const fs = require('node:fs')
const { initDb, dbPath } = require('./db')
const { registerIpc } = require('./ipc')
const { migrateImages, getImage } = require('./images')
const { runE2eTest, runUiSmoke } = require('./e2e')
const { initAntiDebug } = require('./anti-debug')
const { checkLifecycle } = require('./lifecycle')

// 反调试：必须在 app ready 之前完成启动参数扫描（L1 层）
initAntiDebug()

// 端到端/UI 自检：使用独立临时数据库，避免污染真实数据
if (process.env.COMATE_TEST === '1' || process.env.COMATE_UI === '1') {
  const testDataDir = path.join(os.tmpdir(), 'comate-e2e-test')
  // 每次测试从全新 userData 开始，避免上次运行遗留的授权状态/数据污染断言
  try {
    fs.rmSync(testDataDir, { recursive: true, force: true })
  } catch {}
  app.setPath('userData', testDataDir)
}

// 设置磁盘缓存路径，避免权限问题导致的缓存错误
app.setPath('cache', path.join(app.getPath('userData'), 'cache'))

function createWindow() {
  // 确保缓存目录存在
  const cachePath = path.join(app.getPath('userData'), 'cache')
  if (!fs.existsSync(cachePath)) {
    fs.mkdirSync(cachePath, { recursive: true })
  }

  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    // 启动尺寸即为最小尺寸：子界面元素以启动态为最小态，放大时可无限铺满屏幕
    minWidth: 1280,
    minHeight: 820,
    title: '题迹',
    backgroundColor: '#f3f6fa',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    win.loadFile(path.join(__dirname, '../renderer/index.html'))
  }

  // 开发辅助：把渲染进程控制台输出转发到主进程终端，便于排查问题
  win.webContents.on('console-message', (event) => {
    const lvl = ['debug', 'info', 'warning', 'error'][event.level] || 'log'
    console.log(`[renderer:${lvl}]`, event.message)
  })
  win.webContents.on('did-fail-load', (_e, code, desc) => {
    console.error('[renderer] 页面加载失败:', code, desc)
  })

  if (process.env.COMATE_TEST === '1') {
    runE2eTest(win)
  } else if (process.env.COMATE_UI === '1') {
    runUiSmoke(win)
  }
}

app.whenReady().then(async () => {
  // 先获取设备唯一信息码作为数据库加密密钥（异步：依赖 PowerShell 硬件采集）
  try {
    const { getMachineCode } = require('./license')
    const { setMachineKey } = require('./keyring')
    const r = await getMachineCode()
    if (r && r.ok && r.code) {
      setMachineKey(r.code)
    } else {
      console.error('[db] 设备唯一信息码获取失败:', r && r.reason)
    }
  } catch (err) {
    console.error('[db] 设备唯一信息码获取异常:', err)
  }

  try {
    initDb()
    console.log('[db] SQLite 数据库位置:', dbPath())
  } catch (err) {
    console.error('[db] 初始化失败:', err)
    // 不再直接退出：允许进入设置页，通过"数据库加解密"输入正确密钥恢复
  }

  // local-image:// 自定义协议：从数据库 BLOB 读取图片
  protocol.handle('local-image', (req) => {
    const id = new URL(req.url).hostname
    const img = getImage(id)
    if (!img) return new Response(null, { status: 404 })
    return new Response(img.data, {
      headers: { 'content-type': img.mime, 'access-control-allow-origin': '*' }
    })
  })

  registerIpc()
  createWindow()

  // 生命周期检测：惰性、容错，不阻塞启动
  checkLifecycle().catch(() => {})

  // 后台迁移历史图片（base64 / file:// → BLOB），不阻塞启动
  migrateImages()
    .then((r) => console.log('[db] 图片迁移:', JSON.stringify(r)))
    .catch((err) => console.error('[db] 图片迁移失败:', err))

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// 自定义协议需在 ready 前声明特权
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'local-image',
    privileges: { secure: true, supportFetchAPI: true, stream: true, corsEnabled: true }
  }
])
