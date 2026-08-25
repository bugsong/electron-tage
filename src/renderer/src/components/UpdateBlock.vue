<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { api } from '../api'
import { useToastStore } from '../stores/toast'
import { sanitizeHtml } from '../utils/sanitize'

const toast = useToastStore()

// 状态数据全部来自主进程返回对象，组件不透传任何凭证
const status = ref('idle')
const currentVersion = ref('')
const latestVersion = ref('')
const releaseNotes = ref('')
const manualDownloadUrl = ref('')
const errorReason = ref('')
const lastCheckedAt = ref(null)
const progress = ref(null)

const detailExpanded = ref(false)
const checking = ref(false)
const downloading = ref(false)
const installNotice = ref(false)
const retryCooldown = ref(0)

let unsubscribeEvent = null
let unsubscribeProgress = null
let cooldownTimer = null

function startRetryCooldown() {
  retryCooldown.value = 10
  if (cooldownTimer) clearInterval(cooldownTimer)
  cooldownTimer = setInterval(() => {
    retryCooldown.value -= 1
    if (retryCooldown.value <= 0) {
      retryCooldown.value = 0
      clearInterval(cooldownTimer)
      cooldownTimer = null
    }
  }, 1000)
}

const versionText = computed(() => (currentVersion.value ? `v${currentVersion.value}` : ''))

const isUpdateAvailable = computed(
  () =>
    status.value === 'update-available' ||
    status.value === 'downloading' ||
    status.value === 'ready-to-install'
)

const checkedText = computed(() => {
  if (!lastCheckedAt.value) return ''
  const d = new Date(lastCheckedAt.value)
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
})

const errorText = computed(() => {
  const map = {
    'source-unavailable': '更新源不可用',
    'network-error': '网络异常',
    'parse-error': '更新信息解析失败',
    'download-failed': '下载失败',
    'disk-full': '磁盘空间不足',
    'verify-failed': '更新包校验失败',
    'install-failed': '安装失败',
    'not-supported': '当前环境不支持更新'
  }
  return map[errorReason.value] || '检查更新失败'
})

const stateText = computed(() => {
  if (status.value === 'checking') return '检查更新中…'
  if (status.value === 'no-update') return '已是最新版本'
  if (status.value === 'error') return errorText.value
  return ''
})

const progressPercent = computed(() => {
  const p = progress.value
  if (!p || !p.total) return 0
  return Math.min(100, Math.round((p.transferred / p.total) * 100))
})

const progressText = computed(() => {
  const p = progress.value
  if (!p) return ''
  const mb = (n) => (n ? (n / 1024 / 1024).toFixed(1) : '0.0')
  const speed = p.bytesPerSecond ? `${(p.bytesPerSecond / 1024 / 1024).toFixed(1)} MB/s` : ''
  return `${mb(p.transferred)} MB / ${mb(p.total)} MB${speed ? ' · ' + speed : ''}`
})

const safeReleaseNotes = computed(() => sanitizeHtml(releaseNotes.value))

function applyState(s) {
  if (!s) return
  const prevStatus = status.value
  status.value = s.status || 'idle'
  if (s.currentVersion) currentVersion.value = s.currentVersion
  if (s.latestVersion) latestVersion.value = s.latestVersion
  if (typeof s.releaseNotes === 'string') releaseNotes.value = s.releaseNotes
  if (s.manualDownloadUrl) manualDownloadUrl.value = s.manualDownloadUrl
  errorReason.value = s.errorReason || ''
  lastCheckedAt.value = s.lastCheckedAt || null
  progress.value = s.progress || null
  checking.value = status.value === 'checking'
  downloading.value = status.value === 'downloading'
  installNotice.value = status.value === 'ready-to-install'
  if (!isUpdateAvailable.value) {
    detailExpanded.value = false
  }
  if (status.value === 'error' && prevStatus !== 'error') {
    startRetryCooldown()
  }
}

async function loadState() {
  try {
    const s = await api.getUpdaterState()
    applyState(s)
  } catch {
    /* 读取失败走空态降级（spec 5.1.3-1） */
  }
}

async function check() {
  if (checking.value) return
  try {
    const r = await api.checkForUpdates()
    if (r && r.ok === false) {
      if (r.reason === 'not-supported') {
        toast.error('当前环境不支持更新')
      } else if (r.reason === 'too-frequent') {
        /* 间隔内重复点击：静默忽略，不打扰（spec 5.2.1-5） */
      }
    }
  } catch (err) {
    toast.error(err.message || '检查更新失败')
  }
}

function toggleDetail() {
  if (!isUpdateAvailable.value) return
  detailExpanded.value = !detailExpanded.value
}

async function download() {
  if (downloading.value) return
  try {
    const r = await api.downloadUpdate()
    if (r && r.ok === false) {
      if (r.reason === 'not-supported') toast.error('当前环境不支持更新')
      else if (r.reason === 'not-available') toast.error('暂无可下载的更新版本')
    }
  } catch (err) {
    toast.error(err.message || '下载失败')
  }
}

async function cancel() {
  if (!downloading.value) return
  try {
    await api.cancelDownload()
  } catch {}
}

async function manualDownload() {
  try {
    const r = await api.openManualDownload()
    if (r && r.ok === false) {
      toast.error('无法打开下载页面，请稍后重试')
    }
  } catch (err) {
    toast.error(err.message || '无法打开下载页面，请稍后重试')
  }
}

onMounted(async () => {
  await loadState()
  unsubscribeEvent = api.onUpdaterEvent(applyState)
  unsubscribeProgress = api.onUpdaterProgress((p) => {
    progress.value = p
  })
})

onBeforeUnmount(() => {
  if (unsubscribeEvent) unsubscribeEvent()
  if (unsubscribeProgress) unsubscribeProgress()
  if (cooldownTimer) clearInterval(cooldownTimer)
})
</script>

<template>
  <div class="card st-card updater-block">
    <div class="updater-head">
      <div class="updater-title">版本更新</div>
      <div class="updater-head-right">
        <span class="updater-version" data-test="current-version">{{ versionText }}</span>
        <button
          class="btn btn-text updater-recheck"
          data-test="recheck-btn"
          :disabled="checking || downloading || installNotice || retryCooldown > 0"
          @click="check"
        >
          {{ checking ? '检查中…' : retryCooldown > 0 ? `检查更新 (${retryCooldown}s)` : '检查更新' }}
        </button>
      </div>
    </div>

    <div class="updater-body">
      <!-- 未检查：仅当前版本 + 检查更新按钮 -->
      <template v-if="status === 'idle'">
        <button class="btn btn-primary" :disabled="checking" @click="check">检查更新</button>
      </template>

      <!-- 检查中 -->
      <template v-else-if="status === 'checking'">
        <button class="btn" disabled>检查更新中…</button>
      </template>

      <!-- 已是最新 -->
      <template v-else-if="status === 'no-update'">
        <div class="updater-result updater-ok">
          <span>已是最新版本</span>
          <span v-if="checkedText" class="updater-time">{{ checkedText }}</span>
        </div>
        <button class="btn" @click="check">再次检查</button>
      </template>

      <!-- 检查失败 -->
      <template v-else-if="status === 'error' && !isUpdateAvailable">
        <div class="updater-result updater-error">{{ errorText }}</div>
        <button class="btn" :disabled="retryCooldown > 0" @click="check">
          {{ retryCooldown > 0 ? `重试 (${retryCooldown}s)` : '重试' }}
        </button>
      </template>

      <!-- 有新版本：惰性展示最新版本入口（spec 5.2.1-2） -->
      <template v-else-if="isUpdateAvailable">
        <div class="updater-result updater-hasnew" @click="toggleDetail">
          <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor">
            <path
              d="M12 16l-5-5h3V4h4v7h3zM5 18h14v2H5z"
            />
          </svg>
          <span data-test="latest-version">发现新版本 v{{ latestVersion }}</span>
          <span class="updater-toggle">{{ detailExpanded ? '收起' : '查看详情' }}</span>
        </div>

        <!-- 内嵌更新详情区：不弹窗、不离开原页面（spec 5.3.1-1/3） -->
        <div v-if="detailExpanded" class="updater-detail">
          <div class="updater-detail-row">
            <span class="updater-detail-label">最新版本</span>
            <span class="updater-detail-value">v{{ latestVersion }}</span>
          </div>

          <div class="updater-detail-row updater-notes">
            <span class="updater-detail-label">更新简介</span>
            <div class="updater-notes-text">
              <div v-if="releaseNotes" v-html="safeReleaseNotes"></div>
              <template v-else>本次更新的详细说明暂未提供</template>
            </div>
          </div>

          <!-- 下载中：进度条 + 取消 -->
          <div v-if="downloading" class="updater-download">
            <div class="progress">
              <div class="progress-fill" :style="{ width: progressPercent + '%' }"></div>
            </div>
            <div class="updater-download-meta">
              <span data-test="progress-text">{{ progressPercent }}% · {{ progressText }}</span>
              <button class="btn btn-text" @click="cancel">取消</button>
            </div>
          </div>

          <!-- 安装就绪提示 -->
          <div v-else-if="installNotice" class="updater-result updater-ok">
            <span>更新包已就绪，即将自动重启安装</span>
          </div>

          <!-- 下载失败/中断态：重试入口（spec 5.4.3） -->
          <div v-else-if="status === 'error'" class="updater-result updater-error">
            <span>{{ errorText }}</span>
          </div>

          <div v-if="!downloading && !installNotice" class="updater-actions">
            <button
              v-if="!installNotice"
              class="btn btn-primary"
              data-test="download-btn"
              @click="download"
            >
              {{ status === 'error' ? '重新下载' : '更新下载' }}
            </button>
            <button class="btn btn-text" @click="manualDownload">手动下载</button>
            <button class="btn btn-text" @click="detailExpanded = false">稍后再说</button>
          </div>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.updater-block {
  width: 100%;
  margin-top: 1rem;
}
.updater-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.updater-title {
  font-weight: 700;
  font-size: 1rem;
}
.updater-version {
  color: var(--text-2);
  font-size: 0.85rem;
  font-family: Consolas, 'Courier New', monospace;
}
.updater-head-right {
  display: flex;
  align-items: center;
  gap: 0.6rem;
}
.updater-recheck {
  font-size: 0.8rem;
  padding: 0.2rem 0.55rem;
}
.updater-body {
  margin-top: 0.7rem;
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
  width: 100%;
}
.updater-result {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.6rem;
  font-size: 0.88rem;
  padding: 0.45rem 0.7rem;
  border-radius: 8px;
}
.updater-ok {
  color: var(--success);
  background: var(--success-weak);
}
.updater-error {
  color: var(--danger);
  background: var(--danger-weak);
}
.updater-time {
  font-size: 0.78rem;
  opacity: 0.8;
}
.updater-hasnew {
  cursor: pointer;
  color: var(--primary);
  background: var(--primary-weak);
  font-weight: 600;
}
.updater-hasnew:hover {
  background: var(--card-hover);
}
.updater-toggle {
  font-size: 0.78rem;
  font-weight: 500;
  opacity: 0.85;
}
.updater-detail {
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 0.8rem;
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
}
.updater-detail-row {
  display: flex;
  gap: 0.6rem;
  font-size: 0.88rem;
}
.updater-detail-label {
  flex-shrink: 0;
  width: 4.2rem;
  color: var(--text-2);
}
.updater-detail-value {
  font-weight: 600;
  font-family: Consolas, 'Courier New', monospace;
}
.updater-notes-text {
  color: var(--text);
  white-space: pre-wrap;
  word-break: break-word;
  line-height: 1.7;
}
.updater-download {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}
.updater-download-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 0.82rem;
  color: var(--text-2);
}
.updater-actions {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  flex-wrap: wrap;
}
</style>
