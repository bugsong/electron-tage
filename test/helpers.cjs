/**
 * 测试辅助：mock electron 的 app，让 db.js / ipc.js 可在纯 Node 环境中加载。
 * 用法：require('./helpers.cjs') 后再 require 被测模块。
 */
const Module = require('node:module')
const path = require('node:path')
const os = require('node:os')
const fs = require('node:fs')

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'comate-test-'))
let userData = path.join(tmpRoot, 'userData')
fs.mkdirSync(userData, { recursive: true })
let packaged = false

const origLoad = Module._load
Module._load = function (request, ...args) {
  if (request === 'electron') {
    return {
      app: {
        getPath: () => userData,
        getVersion: () => '0.1.0',
        get isPackaged() {
          return packaged
        }
      },
      // 测试用 safeStorage mock：可逆异或混淆，模拟"加密落盘、解密还原"语义，
      // 保证落盘内容不出现明文（便于测试断言磁盘上无明文密钥）
      safeStorage: {
        isEncryptionAvailable: () => true,
        encryptString: (s) => Buffer.from(Buffer.from(String(s), 'utf8').map((b) => b ^ 0x5a)),
        decryptString: (b) => Buffer.from(Buffer.from(b).map((x) => x ^ 0x5a)).toString('utf8')
      },
      ipcMain: { handle: () => {} },
      shell: { openExternal: async () => true },
      BrowserWindow: { getAllWindows: () => [] }
    }
  }
  return origLoad.apply(this, [request, ...args])
}

/** 每个用例可更换独立的 userData 目录（隔离数据库） */
function freshUserData() {
  userData = path.join(tmpRoot, 'ud-' + Math.random().toString(36).slice(2))
  fs.mkdirSync(userData, { recursive: true })
  return userData
}

/** 切换 app.isPackaged（模拟打包/开发模式） */
function setPackaged(v) {
  packaged = Boolean(v)
}

module.exports = { userData: () => userData, freshUserData, tmpRoot, setPackaged }
