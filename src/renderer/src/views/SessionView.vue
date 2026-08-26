<script setup>
import { ref, computed, onMounted, onBeforeUnmount, watch, toRaw } from 'vue'
import { useRoute, useRouter, onBeforeRouteLeave } from 'vue-router'
import { api } from '../api'
import { fmtDuration } from '../utils/format'
import QuestionCard from '../components/QuestionCard.vue'
import { clearSessionDrafts } from '../components/PaperCanvas.vue'
import QuickSettingsModal from '../components/QuickSettingsModal.vue'
import ConfirmDialog from '../components/ConfirmDialog.vue'
import { sessionOrigin } from '../utils/session'
import { useFavorites } from '../composables/useFavorites'
import { useToastStore } from '../stores/toast'

const route = useRoute()
const router = useRouter()
const toast = useToastStore()
const { favorites, loadFavorites, toggleFavorite } = useFavorites()

const session = ref(null)
const questions = ref([])
const answers = ref([])
const elapsedMs = ref(0)
const remainingMs = ref(0)
const paused = ref(false)
const loading = ref(true)

const settingsOpen = ref(false)
const confirmSubmit = ref(false)
const confirmAbandon = ref(false)
const confirmRemoveWrong = ref(null)

const removedWrong = ref(new Set())
const removedQuestionIds = new Set()

let timer = null
let tick = 0
let debounceTimer = null
let submitting = false

const origin = computed(() => sessionOrigin(session.value && session.value.type))

const answeredCount = computed(() => answers.value.filter((a) => a != null).length)
const unAnsweredCount = computed(() => questions.value.length - answeredCount.value)
const isCountdown = computed(() => session.value && session.value.timerMode === 'countdown')
const displayTime = computed(() => fmtDuration(isCountdown.value ? remainingMs.value : elapsedMs.value))

async function load() {
  const id = route.query.sessionId
  if (!id) {
    router.replace('/practice')
    return
  }
  try {
    const s = await api.getSession(id)
    if (!s || s.status !== 'in_progress') {
      router.replace('/practice')
      return
    }
    session.value = s
    questions.value = s.questions
    answers.value =
      Array.isArray(s.answers) && s.answers.length === s.questions.length
        ? s.answers
        : new Array(s.questions.length).fill(null)
    elapsedMs.value = s.durationMs || 0
    if (s.timerMode === 'countdown' && s.timerLimitMs > 0) {
      remainingMs.value = Math.max(0, s.timerLimitMs - elapsedMs.value)
    }
    try {
      await loadFavorites()
    } catch {}
    startTimer()
  } catch (err) {
    toast.error('加载练习失败：' + (err.message || err))
  } finally {
    loading.value = false
  }
}
onMounted(load)

/* ---- 计时与进度保存 ---- */

function startTimer() {
  timer = setInterval(() => {
    elapsedMs.value += 1000
    if (isCountdown.value) {
      remainingMs.value -= 1000
      if (remainingMs.value <= 0) {
        remainingMs.value = 0
        clearInterval(timer)
        timer = null
        autoSubmit()
      }
    }
    tick++
    if (tick % 10 === 0) persist()
  }, 1000)
}

function togglePause() {
  if (isCountdown.value) return
  if (paused.value) {
    paused.value = false
    startTimer()
  } else {
    paused.value = true
    clearInterval(timer)
    timer = null
    persist()
  }
}

async function autoSubmit() {
  toast.show('时间到，自动交卷', 'info')
  await doSubmit()
}

function persist() {
  if (!session.value) return
  clearTimeout(debounceTimer)
  // 使用 toRaw 转换为普通数组，避免 IPC 克隆错误
  const plainAnswers = JSON.parse(JSON.stringify(toRaw(answers.value)))
  api.savePracticeProgress(session.value.id, plainAnswers, elapsedMs.value).catch(() => {})
}

function debouncedPersist() {
  clearTimeout(debounceTimer)
  debounceTimer = setTimeout(persist, 600)
}

watch(answers, debouncedPersist, { deep: true })

onBeforeRouteLeave(() => {
  if (submitting) return true
  if (isCountdown.value) {
    toast.show('再坚持一下吧~', 'info')
    return false
  }
  persist()
})

onBeforeUnmount(() => {
  clearInterval(timer)
  clearTimeout(debounceTimer)
  persist()
})

/* ---- 交互 ---- */

function onSelect(i, opt) {
  answers.value[i] = opt
}

function askSubmit() {
  confirmSubmit.value = true
}

function askAbandon() {
  confirmAbandon.value = true
}

async function doSubmit() {
  confirmSubmit.value = false
  submitting = true
  try {
    // 转换为普通数组，避免 IPC 克隆错误
    const plainAnswers = JSON.parse(JSON.stringify(toRaw(answers.value)))
    await api.submitPractice(session.value.id, plainAnswers, elapsedMs.value)
    // 普通版：交卷后清除本次会话的内存笔迹
    clearSessionDrafts('session:' + session.value.id)
    router.push({ path: '/practice/result', query: { sessionId: session.value.id } })
  } catch (err) {
    submitting = false
    toast.error('交卷失败：' + (err.message || err))
  }
}

function leave() {
  if (isCountdown.value) {
    toast.show('再坚持一下吧~', 'info')
    return
  }
  persist()
  router.push(origin.value)
}

async function doAbandon() {
  confirmAbandon.value = false
  submitting = true
  try {
    await api.abandonPractice(session.value.id)
    // 普通版：放弃后同样清除本次会话的内存笔迹
    clearSessionDrafts('session:' + session.value.id)
    toast.success('已放弃本次练习，进度已清除')
    router.replace(origin.value)
  } catch (err) {
    submitting = false
    toast.error('操作失败：' + (err.message || err))
  }
}

function askRemoveWrong(q) {
  confirmRemoveWrong.value = q
}

async function doRemoveWrong() {
  const q = confirmRemoveWrong.value
  confirmRemoveWrong.value = null
  try {
    await api.removeWrong(q.id)
    removedWrong.value = new Set([...removedWrong.value, q.id])
    removedQuestionIds.add(q.id)
    toast.success('已移出错题本')
  } catch (err) {
    toast.error('操作失败：' + (err.message || err))
  }
}

function isRemoved(q) {
  return removedWrong.value.has(q.id) || removedQuestionIds.has(q.id)
}
</script>

<template>
  <div class="session-page">
    <div class="session-topbar">
      <button class="btn btn-text" title="保存进度并返回" @click="leave">← 返回</button>
      <span class="session-timer" :class="{ paused: paused, countdown: isCountdown }">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
          <circle cx="12" cy="13" r="8" />
          <path d="M12 9v4l2.5 2.5" />
          <path d="M9 2h6" />
        </svg>
        {{ displayTime }}
      </span>
      <button v-if="!isCountdown" class="btn btn-text pause-btn" @click="togglePause">{{ paused ? '继续' : '暂停' }}</button>
      <h1 class="session-title">{{ session && session.title }}</h1>
      <span class="session-count">{{ answeredCount }}/{{ session && session.total }}</span>
      <button class="icon-btn" title="显示设置" @click="settingsOpen = true">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1.08-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1.08 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09c0 .65.38 1.24.97 1.51.65.31 1.43.21 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9c.31.65.9 1.03 1.55 1.03H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      </button>
      <button class="btn btn-primary" :disabled="!questions.length" @click="askSubmit">交卷</button>
      <button class="btn btn-danger" :disabled="!questions.length" @click="askAbandon">放弃</button>
    </div>

    <div v-if="loading" class="empty">加载中…</div>

    <div v-else-if="!questions.length" class="empty">
      <div class="empty-icon">🗒</div>
      <div>本次练习没有可用的题目（题目可能已被删除）</div>
    </div>

    <div v-else class="session-body" :class="{ blurred: paused }">
      <QuestionCard
        v-for="(q, i) in questions"
        :key="q.id"
        :question="q"
        :index="i + 1"
        :answer="answers[i]"
        :is-favorite="favorites.has(q.id)"
        :session-type="session.type"
        :wrong-removed="isRemoved(q)"
        :paper-scope="'session:' + session.id"
        @select="onSelect(i, $event)"
        @favorite="toggleFavorite(q)"
        @remove-wrong="askRemoveWrong(q)"
      />
    </div>

    <div v-if="paused && !loading && questions.length" class="pause-hint">⏸ 已暂停，点击「继续」恢复答题</div>

    <QuickSettingsModal
      v-if="settingsOpen"
      @close="settingsOpen = false"
    />

    <ConfirmDialog
      v-if="confirmSubmit"
      title="交卷"
      :message="`已作答 ${answeredCount} / ${questions.length} 题，未作答 ${unAnsweredCount} 题。确认交卷？交卷后不可修改。`"
      ok-text="确认交卷"
      @confirm="doSubmit"
      @close="confirmSubmit = false"
    />

    <ConfirmDialog
      v-if="confirmAbandon"
      title="放弃本次练习"
      message="放弃后本次作答进度将被清除，确定放弃？"
      danger
      ok-text="放弃"
      @confirm="doAbandon"
      @close="confirmAbandon = false"
    />

    <ConfirmDialog
      v-if="confirmRemoveWrong"
      :title="`将第 ${questions.indexOf(confirmRemoveWrong) + 1} 题移出错题本？`"
      message="移出后该题不再计入错题统计。"
      ok-text="移除"
      @confirm="doRemoveWrong"
      @close="confirmRemoveWrong = null"
    />
  </div>
</template>

<style scoped>
.session-page {
  width: 100%;
  max-width: none;
  min-width: 0;
  margin: 0 auto;
}
.session-topbar {
  position: sticky;
  top: -1.4rem;
  z-index: 30;
  display: flex;
  align-items: center;
  gap: 0.7rem;
  background: var(--bg);
  padding: 1.1rem 0 0.9rem;
  margin-bottom: 1rem;
  border-bottom: 1px solid var(--border);
}
.session-timer {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  color: var(--text-2);
  font-size: 0.9rem;
  font-variant-numeric: tabular-nums;
  min-width: 4.6rem;
}
.session-timer.paused {
  color: var(--primary);
}
.session-timer.countdown {
  color: var(--danger);
  font-weight: 700;
}
.pause-btn {
  font-size: 0.85rem;
  font-weight: 600;
}
.session-body.blurred {
  filter: blur(8px);
  pointer-events: none;
  user-select: none;
}
.pause-hint {
  position: fixed;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  font-size: 1.4rem;
  font-weight: 700;
  color: var(--text-2);
  z-index: 40;
  pointer-events: none;
  background: var(--card);
  padding: 1rem 2rem;
  border-radius: 12px;
  border: 1px solid var(--border);
}
.session-title {
  flex: 1;
  text-align: center;
  font-size: 1.05rem;
  font-weight: 700;
  margin: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.session-count {
  color: var(--text-2);
  font-size: 0.88rem;
}
</style>
