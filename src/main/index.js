const { app, BrowserWindow, dialog, protocol, net } = require('electron')
const path = require('node:path')
const os = require('node:os')
const fs = require('node:fs')
const { initDb, dbPath } = require('./db')
const { registerIpc } = require('./ipc')
const { migrateImages, getImage } = require('./images')
const { runE2eTest, runUiSmoke } = require('./e2e')

// 端到端/UI 自检：使用独立临时数据库，避免污染真实数据
if (process.env.COMATE_TEST === '1' || process.env.COMATE_UI === '1') {
  app.setPath('userData', path.join(os.tmpdir(), 'comate-e2e-test'))
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
    minWidth: 1080,
    minHeight: 700,
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

app.whenReady().then(() => {
  try {
    initDb()
    console.log('[db] SQLite 数据库位置:', dbPath())
  } catch (err) {
    console.error('[db] 初始化失败:', err)
    dialog.showErrorBox('数据库初始化失败', String((err && err.message) || err))
    app.quit()
    return
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
