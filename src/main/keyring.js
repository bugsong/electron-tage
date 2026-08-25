/**
 * 数据库加密密钥管理
 * - 首次运行生成随机 AES-256 密钥（32 字节），经 safeStorage 加密后落盘 key.enc，磁盘上绝无明文密钥
 * - 后续运行读取 key.enc 并用 safeStorage 解密还原，作为 SQLCipher 的 PRAGMA key
 * - safeStorage 仅主进程可用，渲染进程通过 IPC 间接使用（本模块只被主进程引用）
 * - 不提供"重置密钥/更换密码"能力：key.enc 丢失即数据库不可再访问
 */
const path = require('node:path')
const fs = require('node:fs')
const crypto = require('node:crypto')
const { app, safeStorage } = require('electron')

/** 加密密钥文件名（存放于 userData，userData 本身永不随数据库目录迁移） */
const KEY_FILE = 'key.enc'
/** 64 位十六进制（32 字节）密钥格式校验 */
const KEY_HEX_RE = /^[0-9a-f]{64}$/

function keyFilePath() {
  return path.join(app.getPath('userData'), KEY_FILE)
}

/**
 * 获取数据库加密密钥（32 字节 Buffer）。
 * - 首次启动：生成随机密钥 → safeStorage 加密 → 写入 key.enc
 * - 后续启动：读取 key.enc → safeStorage 解密 → 还原密钥
 * 调用方必须用 wipeKey() 擦除返回的 Buffer，避免密钥长期驻留内存。
 * @returns {Buffer} 32 字节密钥
 */
function loadKey() {
  if (!safeStorage || typeof safeStorage.isEncryptionAvailable !== 'function' || !safeStorage.isEncryptionAvailable()) {
    throw new Error('系统安全存储不可用（safeStorage 不可用），无法安全保存数据库加密密钥')
  }

  const file = keyFilePath()
  if (fs.existsSync(file)) {
    let hex
    try {
      hex = safeStorage.decryptString(fs.readFileSync(file))
    } catch (err) {
      throw new Error('数据库密钥解密失败（系统凭据可能已变更）：' + ((err && err.message) || err))
    }
    if (typeof hex !== 'string' || !KEY_HEX_RE.test(hex)) {
      throw new Error('数据库密钥文件内容无效（key.enc 已损坏或格式异常）')
    }
    return Buffer.from(hex, 'hex')
  }

  const key = crypto.randomBytes(32)
  const hex = key.toString('hex')
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, safeStorage.encryptString(hex), { mode: 0o600 })
  return key
}

/** 擦除内存中的密钥副本（使用后尽快调用，避免密钥驻留） */
function wipeKey(key) {
  if (Buffer.isBuffer(key)) key.fill(0)
}

/** 判断密钥文件是否已存在（供启动诊断使用） */
function hasKeyFile() {
  return fs.existsSync(keyFilePath())
}

module.exports = { loadKey, wipeKey, hasKeyFile, keyFilePath, KEY_FILE }
