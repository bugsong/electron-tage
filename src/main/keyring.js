/**
 * 数据库加密密钥管理
 * - 主密钥：设备唯一信息码（机器码 SHA256 的 hex，32 字节），由启动流程通过 setMachineKey 注入
 *   该密钥同时用于本机数据库加密与"分享"场景下他人库的解密 + rekey 回本机密钥
 * - 回退密钥：旧版本使用 safeStorage 加密的随机密钥（key.enc），仅在一次性迁移时使用
 *   迁移成功后 key.enc 会被删除，之后完全由设备唯一信息码接管
 * - safeStorage 仅主进程可用；本模块只被主进程引用
 */
const path = require('node:path')
const fs = require('node:fs')
const crypto = require('node:crypto')
const { app, safeStorage } = require('electron')

/** 旧版加密密钥文件名（存放于 userData，userData 本身永不随数据库目录迁移） */
const KEY_FILE = 'key.enc'
/** 64 位十六进制（32 字节）密钥格式校验 */
const KEY_HEX_RE = /^[0-9a-f]{64}$/

function keyFilePath() {
  return path.join(app.getPath('userData'), KEY_FILE)
}

/* ---------------- 设备唯一信息码密钥（新体系，由启动流程注入） ---------------- */

let cachedMachineKey = null // Buffer(32)

/** 由启动流程在 app.whenReady 早期注入设备唯一信息码（64 位 hex） */
function setMachineKey(hex) {
  if (typeof hex !== 'string' || !KEY_HEX_RE.test(hex.toLowerCase())) {
    throw new Error('设备唯一信息码格式无效（应为 64 位十六进制）')
  }
  if (cachedMachineKey) cachedMachineKey.fill(0)
  cachedMachineKey = Buffer.from(hex.toLowerCase(), 'hex')
}

function hasMachineKey() {
  return !!cachedMachineKey
}

function getMachineKeyHex() {
  return cachedMachineKey ? cachedMachineKey.toString('hex') : null
}

/* ---------------- 旧 safeStorage 密钥（仅一次性迁移回退用） ---------------- */

function loadLegacyKey() {
  if (!safeStorage || typeof safeStorage.isEncryptionAvailable !== 'function' || !safeStorage.isEncryptionAvailable()) {
    throw new Error('系统安全存储不可用（safeStorage 不可用）')
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
  // 无旧密钥文件：生成（仅用于全新库的旧体系，正常不会走到）
  const key = crypto.randomBytes(32)
  const hex = key.toString('hex')
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, safeStorage.encryptString(hex), { mode: 0o600 })
  return key
}

/**
 * 获取数据库加密密钥（32 字节 Buffer 副本）。
 * 优先使用设备唯一信息码；未注入时回退到旧 safeStorage 密钥（一次性迁移场景）。
 * 返回的是副本，调用方必须用 wipeKey() 擦除，不会影响缓存的机器码密钥。
 * @returns {Buffer} 32 字节密钥
 */
function loadKey() {
  if (cachedMachineKey) return Buffer.from(cachedMachineKey)
  return loadLegacyKey()
}

/** 擦除内存中的密钥副本（使用后尽快调用，避免密钥驻留） */
function wipeKey(key) {
  if (Buffer.isBuffer(key)) key.fill(0)
}

/** 判断旧密钥文件是否已存在（供一次性迁移判断使用） */
function hasKeyFile() {
  return fs.existsSync(keyFilePath())
}

module.exports = {
  loadKey,
  wipeKey,
  hasKeyFile,
  keyFilePath,
  KEY_FILE,
  setMachineKey,
  hasMachineKey,
  getMachineKeyHex,
  loadLegacyKey
}
