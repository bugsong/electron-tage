<script setup>
import { ref, onMounted } from 'vue'
import { api } from '../api'
import { useSettingsStore, FONT_SIZES } from '../stores/settings'
import { useAdvancedStore, FEATURE_GROUPS } from '../stores/advanced'
import { useToastStore } from '../stores/toast'
import ConfirmDialog from '../components/ConfirmDialog.vue'
import Modal from '../components/Modal.vue'
import ToggleSwitch from '../components/ToggleSwitch.vue'

const settings = useSettingsStore()
const advanced = useAdvancedStore()
const toast = useToastStore()
const dbPath = ref('')
const moving = ref(false)
// 设备唯一信息（机器码由主进程采集硬件并加密生成；同时作为数据库加解密密钥）
const machineCode = ref('')
const mcFailed = ref(false)
const mcLoading = ref(false)
// 待用户选择 继承/覆盖 的迁移 { dir, mode, message, sourceExists }
const pendingChoose = ref(null)
// 待用户输入解密密钥的迁移 { dir, message }
const pendingKey = ref(null)
// pendingKey 弹窗内输入的密钥（独立于"数据库加解密"块的 decryptInput，避免互相污染）
const pendingKeyInput = ref('')
// 数据库加解密块：输入的解密密钥
const decryptInput = ref('')
const applyingKey = ref(false)
// 数据库就绪状态 { ready, error }
const dbStatus = ref({ ready: true, error: null })

onMounted(async () => {
  try {
    dbPath.value = await api.getDbPath()
  } catch {
    dbPath.value = ''
  }
  // 加载进阶功能开关状态（授权 + 各子功能开关）；授权显隐统一由 store 驱动
  try {
    await advanced.load()
  } catch {
    /* 保持默认 */
  }
  // 设备唯一信息码同时用于授权与数据库加解密，始终加载
  loadMachineCode()
  refreshDbStatus()
})

async function refreshDbStatus() {
  try {
    dbStatus.value = await api.getDbStatus()
  } catch {
    dbStatus.value = { ready: true, error: null }
  }
}

async function loadMachineCode() {
  if (mcLoading.value) return
  mcLoading.value = true
  mcFailed.value = false
  try {
    const code = await api.getMachineCode()
    machineCode.value = code || ''
    if (!code) mcFailed.value = true
  } catch {
    mcFailed.value = true
  } finally {
    mcLoading.value = false
  }
}

async function copyMachineCode() {
  if (!machineCode.value) return
  try {
    await navigator.clipboard.writeText(machineCode.value)
    toast.success('设备信息已复制')
  } catch {
    toast.error('复制失败')
  }
}

async function copyPath() {
  try {
    await navigator.clipboard.writeText(dbPath.value)
    toast.success('路径已复制')
  } catch {
    toast.error('复制失败')
  }
}

async function chooseDbDir() {
  if (moving.value) return
  let dir
  try {
    dir = await api.pickDbDir()
  } catch {
    toast.error('选择文件夹失败')
    return
  }
  if (!dir) return
  try {
    const info = await api.moveDb(dir)
    handleMoveInfo(dir, info)
  } catch (err) {
    toast.error(err.message || '迁移数据库失败')
  }
}

function handleMoveInfo(dir, info) {
  if (!info) return
  if (info.status === 'ok') {
    applyMoveResult(info)
    return
  }
  if (info.status === 'need_choose') {
    pendingChoose.value = {
      dir,
      mode: info.mode,
      message: info.message,
      sourceExists: info.sourceExists
    }
    return
  }
  if (info.status === 'need_key') {
    pendingKey.value = { dir, message: info.message }
    return
  }
}

async function chooseInherit() {
  const pending = pendingChoose.value
  pendingChoose.value = null
  if (!pending) return
  moving.value = true
  try {
    const info = await api.moveDb(pending.dir, { action: 'inherit' })
    applyMoveResult(info)
  } catch (err) {
    toast.error(err.message || '继承失败')
  } finally {
    moving.value = false
  }
}

async function chooseOverwrite() {
  const pending = pendingChoose.value
  pendingChoose.value = null
  if (!pending) return
  moving.value = true
  try {
    const info = await api.moveDb(pending.dir, { action: 'overwrite' })
    applyMoveResult(info)
  } catch (err) {
    toast.error(err.message || '覆盖失败')
  } finally {
    moving.value = false
  }
}

async function confirmKey() {
  const pending = pendingKey.value
  const key = pendingKeyInput.value.trim()
  if (!pending) return
  if (!key) {
    toast.error('请输入设备唯一信息码')
    return
  }
  pendingKey.value = null
  pendingKeyInput.value = ''
  moving.value = true
  try {
    const info = await api.moveDb(pending.dir, { action: 'inherit_with_key', key })
    applyMoveResult(info)
  } catch (err) {
    toast.error(err.message || '解密失败')
  } finally {
    moving.value = false
  }
}

async function applyDecryptKeyToCurrent() {
  const key = decryptInput.value.trim()
  if (!key) return
  applyingKey.value = true
  try {
    await api.applyDecryptKey(key)
    decryptInput.value = ''
    toast.success('解密成功，已用本机设备唯一信息码重新加密')
    await refreshDbStatus()
    try { dbPath.value = await api.getDbPath() } catch {}
  } catch (err) {
    toast.error(err.message || '解密失败')
  } finally {
    applyingKey.value = false
  }
}

function applyMoveResult(info) {
  if (info && info.status === 'ok') {
    dbPath.value = info.newPath
    const msg =
      info.action === 'migrate'
        ? '已迁移数据库到新位置'
        : info.action === 'inherit'
          ? '已继承该位置的数据库'
          : info.action === 'use'
            ? '已打开该位置的数据库'
            : '已在新位置初始化数据库'
    toast.success(msg)
    refreshDbStatus()
  }
}
</script>

<template>
  <div class="page st-page">
    <span class="page-title-tag">设置</span>

    <div class="card st-card">
      <div class="st-title">字号大小</div>
      <div class="st-desc">调整后全局即时生效，并自动保存</div>
      <div class="st-row">
        <button
          v-for="f in FONT_SIZES"
          :key="f.key"
          class="st-btn"
          :class="{ active: settings.fontSize === f.key }"
          @click="settings.setFontSize(f.key)"
        >
          {{ f.label }}
          <span class="st-btn-sample" :style="{ fontSize: f.px + 'px' }">示例</span>
        </button>
      </div>
    </div>

    <div class="card st-card">
      <div class="st-title">配色</div>
      <div class="st-desc">支持日间 / 夜间两种配色</div>
      <div class="st-row">
        <button
          class="st-btn theme-btn"
          :class="{ active: settings.theme === 'light' }"
          @click="settings.setTheme('light')"
        >
          ☀ 日间
        </button>
        <button
          class="st-btn theme-btn"
          :class="{ active: settings.theme === 'dark' }"
          @click="settings.setTheme('dark')"
        >
          ☾ 夜间
        </button>
      </div>
    </div>

    <!-- 进阶功能控制：仅进阶版激活后可见 -->
    <div v-if="advanced.licensed" class="card st-card adv-card">
      <div class="st-title">进阶功能控制</div>
      <div class="st-desc">进阶版专属。关闭总开关后，以下所有进阶能力将立即回到普通版表现</div>

      <!-- 总开关 -->
      <div class="adv-row">
        <div class="adv-row-main">
          <div class="adv-row-title">启用进阶版功能</div>
          <div class="adv-row-sub">总开关：统一管理以下所有进阶模块</div>
        </div>
        <ToggleSwitch
          :model-value="advanced.master"
          @update:model-value="advanced.toggleMaster()"
        />
      </div>

      <div v-if="!advanced.advancedOn" class="adv-banner">
        总开关已关闭，以下进阶模块当前均不可用
      </div>

      <div class="adv-divider"></div>

      <!-- 各分组 -->
      <template v-for="g in FEATURE_GROUPS" :key="g.group">
        <div class="adv-group-title">{{ g.group }}</div>
        <div v-for="item in g.items" :key="item.key" class="adv-row">
          <div class="adv-row-main">
            <div class="adv-row-title">{{ item.label }}</div>
            <div class="adv-row-sub">{{ item.desc }}</div>
          </div>
          <ToggleSwitch
            :model-value="advanced.advancedOn && advanced.features[item.key]"
            :disabled="!advanced.advancedOn"
            @update:model-value="advanced.toggleFeature(item.key)"
          />
        </div>
        <div class="adv-divider"></div>
      </template>
    </div>

    <div class="card st-card">
      <div class="st-title">数据位置</div>
      <div class="st-desc">全部数据（题库、错题、笔记、收藏、草稿笔迹）保存在下面的 SQLite 文件中，请勿删除</div>
      <div class="st-path">
        <span class="st-path-text">{{ dbPath }}</span>
        <button class="btn" @click="copyPath">复制路径</button>
        <button class="btn" @click="chooseDbDir" :disabled="moving">
          {{ moving ? '处理中…' : '更改路径' }}
        </button>
      </div>
      <div class="st-desc st-desc-note">若新位置已有本软件数据库，将优先继承使用（保留其数据）；若没有则自动迁移或初始化</div>
    </div>

    <!-- 数据库加解密：本机密钥展示 + 他人库解密接管 -->
    <div class="card st-card">
      <div class="st-title">数据库加解密</div>
      <div class="st-desc">本机数据库使用「设备唯一信息码」作为加解密密钥。分享数据库时，对方需输入你的设备唯一信息码解密，解密后会自动用对方本机码重新加密，无需额外保存他人密钥。</div>

      <div class="st-sub-title">本机设备唯一信息码</div>
      <div class="st-desc">即本机数据库的加密密钥，分享数据库时提供给对方</div>
      <div class="st-path">
        <span class="st-path-text">{{ mcFailed ? '获取失败' : machineCode || '获取中…' }}</span>
        <button class="btn" @click="copyMachineCode" :disabled="!machineCode">复制</button>
      </div>

      <div class="st-sub-title">输入解密密钥</div>
      <div class="st-desc">若当前数据位置的数据库由他人分享（用其设备唯一信息码加密），在此输入其设备唯一信息码以解密并用本机码重新加密</div>
      <div class="st-path">
        <input
          class="st-key-input"
          v-model.trim="decryptInput"
          placeholder="粘贴 64 位设备唯一信息码"
          :disabled="applyingKey"
        />
        <button
          class="btn"
          @click="applyDecryptKeyToCurrent"
          :disabled="applyingKey || !decryptInput"
        >
          {{ applyingKey ? '处理中…' : '应用解密密钥' }}
        </button>
      </div>

      <div v-if="dbStatus && !dbStatus.ready" class="st-warn">
        当前数据库无法打开：{{ dbStatus.error || '解密密钥不匹配' }}。请输入正确的设备唯一信息码以恢复访问。
      </div>
    </div>


    <!-- 选择 继承 / 覆盖 弹窗 -->
    <Modal
      v-if="pendingChoose"
      title="更改数据位置"
      width="26rem"
      @close="pendingChoose = null"
    >
      <div class="confirm-text">{{ pendingChoose.message }}</div>
      <template #footer>
        <button class="btn" @click="pendingChoose = null">取消</button>
        <button
          v-if="pendingChoose.mode === 'inherit_or_overwrite'"
          class="btn btn-primary"
          @click="chooseInherit"
        >
          继承
        </button>
        <button class="btn btn-danger" @click="chooseOverwrite">覆盖</button>
      </template>
    </Modal>

    <!-- 输入解密密钥弹窗 -->
    <Modal
      v-if="pendingKey"
      title="输入解密密钥"
      width="26rem"
      @close="pendingKey = null"
    >
      <div class="confirm-text">{{ pendingKey.message }}</div>
      <div class="st-path" style="margin-top: 0.8rem">
        <input
          class="st-key-input"
          v-model.trim="pendingKeyInput"
          placeholder="粘贴 64 位设备唯一信息码"
        />
      </div>
      <template #footer>
        <button class="btn" @click="pendingKey = null">取消</button>
        <button class="btn btn-primary" @click="confirmKey">解密并继承</button>
      </template>
    </Modal>

    <!-- <div class="st-about">题迹 · 仅本地使用 · 数据不出本机</div> -->
  </div>
</template>

<style scoped>
.st-page {
  /* 与 .page 一致：不再固定 620px，随屏幕自适应铺满，最大态不限制 */
  max-width: none;
}
.st-card {
  padding: 1.1rem 1.3rem;
  margin-top: 1rem;
}
.st-title {
  font-weight: 700;
  font-size: 1rem;
}
.st-sub-title {
  font-weight: 600;
  font-size: 0.9rem;
  margin: 0.9rem 0 0.1rem;
}
.st-desc {
  color: var(--text-2);
  font-size: 0.85rem;
  margin: 0.2rem 0 0.8rem;
}
.st-row {
  display: flex;
  gap: 0.7rem;
  flex-wrap: wrap;
}
.st-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  border: 1px solid var(--border);
  background: var(--card);
  color: var(--text);
  border-radius: 8px;
  padding: 0.5rem 1rem;
  cursor: pointer;
  font-size: 0.9rem;
  font-family: inherit;
  min-width: 6rem;
  justify-content: center;
}
.st-btn.active {
  border-color: var(--primary);
  background: var(--primary-weak);
  color: var(--primary);
  font-weight: 600;
}
.st-btn-sample {
  color: var(--text-2);
}
.st-btn.active .st-btn-sample {
  color: var(--primary);
}
.theme-btn {
  flex: 1;
}
.st-path {
  display: flex;
  align-items: center;
  gap: 0.7rem;
}
.st-path .btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
.st-desc-note {
  margin: 0.6rem 0 0;
  color: var(--text-2);
  font-size: 0.8rem;
}
.st-path-text {
  flex: 1;
  background: var(--card-hover);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 0.45rem 0.7rem;
  font-size: 0.82rem;
  font-family: Consolas, 'Courier New', monospace;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  user-select: text;
}
.st-key-input {
  flex: 1;
  background: var(--card-hover);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 0.45rem 0.7rem;
  font-size: 0.82rem;
  font-family: Consolas, 'Courier New', monospace;
  color: var(--text);
  outline: none;
  min-width: 0;
}
.st-key-input:focus {
  border-color: var(--primary);
}
.st-warn {
  margin: 0.8rem 0 0;
  padding: 0.55rem 0.8rem;
  border-radius: 8px;
  background: #fff4e5;
  border: 1px solid #ffb84d;
  color: #b35900;
  font-size: 0.82rem;
  line-height: 1.5;
}
.confirm-text {
  white-space: pre-line;
  line-height: 1.6;
  font-size: 0.88rem;
  color: var(--text);
}
/* ---- 进阶功能控制 ---- */
.adv-card {
  padding-bottom: 1.1rem;
}
.adv-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.55rem 0;
}
.adv-row-main {
  min-width: 0;
}
.adv-row-title {
  font-size: 0.95rem;
  font-weight: 600;
}
.adv-row-sub {
  font-size: 0.78rem;
  color: var(--text-2);
  margin-top: 0.1rem;
}
.adv-group-title {
  font-size: 0.8rem;
  font-weight: 700;
  color: var(--primary);
  margin: 0.4rem 0 0.1rem;
}
.adv-divider {
  height: 1px;
  background: var(--border);
  margin: 0.7rem 0 0.4rem;
}
.adv-banner {
  margin: 0.5rem 0 0;
  padding: 0.45rem 0.7rem;
  border-radius: 8px;
  background: var(--card-hover);
  border: 1px solid var(--border);
  color: var(--text-2);
  font-size: 0.8rem;
}
</style>
