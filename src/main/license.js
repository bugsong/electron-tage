// ============================================================
// 软件授权模块（仅 Windows 平台）
// ------------------------------------------------------------
// 【安全约束】
//   可以  硬件采集、SHA256 哈希、ed25519 验签：全部在主进程执行
//   不可  渲染进程不允许处理硬件信息和验签
//   不可  Electron 代码中绝对不能出现 ed25519 私钥，不能实现签名算法
//
// 机器码：SHA256(CPUId + '|' + 物理硬盘SN + '|' + BIOS-UUID) 的十六进制串；
//         其中无效字段（占位符 / 全F / 空值等）会被剔除后再拼接。
// 进阶码：base64(json 元数据) + '|' + base64(ed25519 签名)
//         json 元数据至少包含 machineCode（本机机器码）、expiresAt（过期时间戳，毫秒）
// ============================================================
const crypto = require('node:crypto')
const { execFile } = require('node:child_process')
const { ipcMain } = require('electron')
const { getDb } = require('./db')

/** 内置 Ed25519 公钥（SPKI PEM），仅用于验签；私钥绝不进入本仓库 */
let LICENSE_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAly3hD5skqIqukHjDtP1KtT07NF059iLbk1G4GUCTUas=
-----END PUBLIC KEY-----`

/** WMI 常见占位符 / 无效值：命中即剔除该硬件字段 */
const INVALID_PATTERNS = [
  /^to be filled by o\.e\.m\.?$/i,
  /^to be filled$/i,
  /^default string$/i,
  /^system serial number$/i,
  /^not specified$/i,
  /^not applicable$/i,
  /^n\/a$/i,
  /^na$/i,
  /^no asset tag$/i,
  /^none$/i,
  /^unknown$/i,
  /^oem$/i,
  /^invalid$/i,
  /^baseboard serial number$/i,
  /^chassis serial number$/i,
  /^0+$/, // 全 0
  /^f+$/i, // 全 F
  /^00000000-0000-0000-0000-000000000000$/i, // 全 0 UUID
  /^ffffffff-ffff-ffff-ffff-ffffffffffff$/i, // 全 F UUID
  /^03000200-0400-0500-0006-000700080009$/i // AMI 常见占位 UUID
]

/** 剔除无效 / 占位符值；有效值返回 trim 后的原文，否则返回空串 */
function cleanField(v) {
  const s = String(v == null ? '' : v).trim()
  if (!s) return ''
  return INVALID_PATTERNS.some((re) => re.test(s)) ? '' : s
}

/** 由三项硬件原始值计算机器码（无效字段自动剔除后拼接再哈希） */
function computeMachineCode(raw) {
  if (!raw) return null
  const parts = [raw.cpuId, raw.disk, raw.biosUuid].map(cleanField).filter(Boolean)
  if (!parts.length) return null
  return crypto.createHash('sha256').update(parts.join('|'), 'utf8').digest('hex')
}

/* ---------------- 硬件采集（主进程执行） ---------------- */

const HW_READ_TIMEOUT = 10000

function runPowershell(script) {
  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { timeout: HW_READ_TIMEOUT, windowsHide: true, maxBuffer: 4 * 1024 * 1024 },
      (err, stdout) => resolve(err ? null : String(stdout || '').trim())
    )
  })
}

/**
 * 通过 WMI（Get-CimInstance）读取 CPUID、物理硬盘 SN、BIOS-UUID。
 * 任一项读取失败不影响其余字段；整体失败返回 null 走降级处理。
 */
async function readHardware() {
  const script = `
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$r = [ordered]@{ cpuId = ''; disk = ''; biosUuid = '' }
try {
  $cpu = Get-CimInstance Win32_Processor -ErrorAction Stop | Select-Object -First 1
  $r.cpuId = [string]$cpu.ProcessorId
} catch {}
try {
  # 优先选非 USB 接口的第一块物理硬盘（通常为系统盘），失败则回退到第一块
  $disks = @(Get-CimInstance Win32_DiskDrive -ErrorAction Stop |
            Where-Object { $_.InterfaceType -ne 'USB' } |
            Sort-Object Index)
  if (-not $disks) { $disks = @(Get-CimInstance Win32_DiskDrive -ErrorAction Stop | Sort-Object Index) }
  if ($disks.Count -gt 0) { $r.disk = [string]$disks[0].SerialNumber }
} catch {}
try {
  $r.biosUuid = [string](Get-CimInstance Win32_ComputerSystemProduct -ErrorAction Stop).UUID
} catch {}
$r | ConvertTo-Json -Compress
`
  const out = await runPowershell(script)
  if (!out) return null
  try {
    const o = JSON.parse(out)
    return { cpuId: o.cpuId, disk: o.disk, biosUuid: o.biosUuid }
  } catch {
    return null
  }
}

let cachedMachineCode = null

/** 获取本机机器码（hex 字符串）；首次读取后缓存。返回 { ok, code } 或 { ok:false, reason } */
async function getMachineCode() {
  if (cachedMachineCode) return { ok: true, code: cachedMachineCode }
  const raw = await readHardware()
  const code = computeMachineCode(raw)
  if (!code) return { ok: false, reason: '无法读取本机硬件信息' }
  cachedMachineCode = code
  return { ok: true, code }
}

/* ---------------- 进阶码验签（主进程执行） ---------------- */

/** ed25519 验签：payload 为被签名的原文，signature 为签名字节 */
function verifyEd25519(payload, signature) {
  try {
    const key = crypto.createPublicKey(LICENSE_PUBLIC_KEY)
    return crypto.verify(null, Buffer.from(payload, 'utf8'), key, signature)
  } catch {
    return false
  }
}

/**
 * 校验进阶码：
 * ① 按 | 分割并 base64 解码 → 原始授权 json + ed25519 签名字节
 * ② 内置 ed25519 公钥校验签名
 * ③ 校验 json 内 machineCode 是否等于本机实时机器码
 * ④ 校验过期时间戳
 * ⑤ 通过后本地持久化保存授权状态
 */
async function verifyActivationCode(code) {
  const fail = (reason) => ({ ok: false, reason })

  if (typeof code !== 'string' || !code.includes('|')) return fail('进阶码格式错误')
  const parts = code.split('|')
  if (parts.length !== 2) return fail('进阶码格式错误')
  const [b64Json, b64Sig] = parts
  if (!b64Json || !b64Sig) return fail('进阶码格式错误')

  let jsonText, signature
  try {
    jsonText = Buffer.from(b64Json, 'base64').toString('utf8')
    signature = Buffer.from(b64Sig, 'base64')
  } catch {
    return fail('进阶码格式错误')
  }
  if (!jsonText || !signature.length) return fail('进阶码格式错误')

  // ② 验签（签名覆盖完整 json 原文，任何篡改都会失败）
  if (!verifyEd25519(jsonText, signature)) return fail('签名篡改')

  // ①/③ 解析元数据并比对机器码
  let meta
  try {
    meta = JSON.parse(jsonText)
  } catch {
    return fail('进阶码格式错误')
  }
  const mc = await getMachineCode()
  if (!mc.ok) return fail(mc.reason || '无法获取本机机器码')
  if (String(meta.machineCode || '') !== mc.code) return fail('机器不匹配')

  // ④ 过期时间戳（毫秒）
  const expiresAt = Number(meta.expiresAt)
  if (!Number.isFinite(expiresAt)) return fail('进阶码格式错误')
  if (expiresAt <= Date.now()) return fail('已过期')

  // ⑤ 通过后本地持久化授权状态
  const activatedAt = Date.now()
  try {
    getDb()
      .prepare(
        `INSERT INTO settings (key, value) VALUES ('license.state', ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`
      )
      .run(
        JSON.stringify({
          status: 'activated',
          machineCode: mc.code,
          activatedAt,
          expiresAt,
          meta
        })
      )
  } catch (err) {
    console.error('[license] 授权状态持久化失败:', err)
  }

  return { ok: true, activatedAt, expiresAt }
}

/**
 * 解除授权（删除数据库中的激活信息）：
 * 清除 settings 表里 license.state 这一行，进阶版即回退为普通版。
 * @returns {{ ok: boolean, reason?: string }}
 */
function deactivateLicense() {
  try {
    getDb().prepare("DELETE FROM settings WHERE key = 'license.state'").run()
    return { ok: true }
  } catch (err) {
    console.error('[license] 解除授权失败:', err)
    return { ok: false, reason: (err && err.message) || '数据库操作失败' }
  }
}

/* ---------------- IPC 接口 ---------------- */

/** 读取本地持久化的授权状态（供「关于」页展示；未激活或已过期视为未激活） */
function getLicenseStatus() {
  try {
    const row = getDb().prepare("SELECT value FROM settings WHERE key = 'license.state'").get()
    if (!row) return { activated: false }
    const s = JSON.parse(row.value)
    const expiresAt = Number(s.expiresAt)
    if (s.status === 'activated' && Number.isFinite(expiresAt) && expiresAt > Date.now()) {
      return { activated: true, activatedAt: s.activatedAt, expiresAt }
    }
    return { activated: false }
  } catch {
    return { activated: false }
  }
}

function registerLicenseIpc() {
  // 返回本机机器码 hex 字符串；读取硬件失败时返回 null（渲染进程仅展示，不做硬件处理）
  ipcMain.handle('get-machine-code', async () => {
    const r = await getMachineCode()
    return r.ok ? r.code : null
  })

  // 参数：进阶码字符串 → 返回校验结果 { ok:true, activatedAt, expiresAt } 或 { ok:false, reason }
  ipcMain.handle('verify-activation-code', (e, code) => verifyActivationCode(code))

  // 返回本地持久化的授权状态 { activated, activatedAt?, expiresAt? }
  ipcMain.handle('license:status', () => getLicenseStatus())

  // 解除授权：删除本机持久化的激活信息，进阶版回退为普通版
  ipcMain.handle('license:deactivate', () => deactivateLicense())
}

/* ---------------- 测试专用钩子（生产代码不调用） ---------------- */
const _test = {
  setPublicKey: (pem) => {
    LICENSE_PUBLIC_KEY = pem
  },
  setMachineCode: (code) => {
    cachedMachineCode = code
  },
  computeMachineCode,
  cleanField
}

module.exports = { getMachineCode, verifyActivationCode, getLicenseStatus, deactivateLicense, registerLicenseIpc, _test }
