<script setup>
import { ref, onMounted } from 'vue'
import { api } from '../api'
import { useSettingsStore, FONT_SIZES } from '../stores/settings'
import { useToastStore } from '../stores/toast'
import ConfirmDialog from '../components/ConfirmDialog.vue'

const settings = useSettingsStore()
const toast = useToastStore()
const dbPath = ref('')
const moving = ref(false)
// 设备唯一信息（机器码由主进程采集硬件并加密生成；已激活进阶版后不再展示）
const licensed = ref(false)
const machineCode = ref('')
const mcFailed = ref(false)
const mcLoading = ref(false)
// 待用户确认的迁移 { dir, message }
const pendingMove = ref(null)

onMounted(async () => {
  try {
    dbPath.value = await api.getDbPath()
  } catch {
    dbPath.value = ''
  }
  try {
    const s = await api.getLicenseStatus()
    licensed.value = !!(s && s.activated)
  } catch {
    licensed.value = false
  }
  if (!licensed.value) loadMachineCode()
})

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
    if (info.status === 'need_confirm') {
      pendingMove.value = { dir, message: info.message }
      return
    }
    applyMoveResult(info)
  } catch (err) {
    toast.error(err.message || '迁移数据库失败')
  }
}

async function confirmMove() {
  const pending = pendingMove.value
  pendingMove.value = null
  if (!pending) return
  moving.value = true
  try {
    const info = await api.moveDb(pending.dir, { force: true })
    applyMoveResult(info)
  } catch (err) {
    toast.error(err.message || '迁移数据库失败')
  } finally {
    moving.value = false
  }
}

function applyMoveResult(info) {
  if (info && info.status === 'ok') {
    dbPath.value = info.newPath
    const msg =
      info.action === 'migrate'
        ? '已迁移数据库到新位置'
        : info.action === 'use'
          ? '已打开该位置的数据库'
          : '已在新位置初始化数据库'
    toast.success(msg)
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

    <div class="card st-card">
      <div class="st-title">数据位置</div>
      <div class="st-desc">全部数据（题库、错题、笔记、收藏、草稿笔迹）保存在下面的 SQLite 文件中，请勿删除</div>
      <div class="st-path">
        <span class="st-path-text">{{ dbPath }}</span>
        <button class="btn" @click="copyPath">复制路径</button>
        <button class="btn" @click="chooseDbDir" :disabled="moving">
          {{ moving ? '迁移中…' : '更改路径' }}
        </button>
      </div>
      <div class="st-desc st-desc-note">更改位置后，已有数据会自动迁移过去；若新位置还没有数据库，则会自动初始化</div>
    </div>

    <div v-if="!licensed" class="card st-card">
      <div class="st-title">设备唯一信息(已加密)</div>
      <div class="st-desc">由本机硬件（CPUID、物理硬盘、BIOS）在本地加密生成，仅用于软件授权，不会上传；<br/>(进阶版约一杯奶茶价)请复制后发送给开发者生成进阶码</div>
      <div class="st-path">
        <span class="st-path-text">{{ mcFailed ? '获取失败' : machineCode || '获取中…' }}</span>
        <button class="btn" @click="copyMachineCode" :disabled="!machineCode">复制</button>
      </div>
    </div>

    <ConfirmDialog
      v-if="pendingMove"
      title="更改数据位置"
      :message="pendingMove.message"
      ok-text="确认"
      @confirm="confirmMove"
      @close="pendingMove = null"
    />

    <div class="st-about">题迹 · 仅本机使用 · 数据不出本机</div>
  </div>
</template>

<style scoped>
.st-page {
  max-width: 620px;
}
.st-card {
  padding: 1.1rem 1.3rem;
  margin-top: 1rem;
}
.st-title {
  font-weight: 700;
  font-size: 1rem;
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
.st-about {
  text-align: center;
  color: var(--text-2);
  font-size: 0.8rem;
  margin-top: 1.2rem;
}
</style>
