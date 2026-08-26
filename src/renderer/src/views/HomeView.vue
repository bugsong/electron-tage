<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { api } from '../api'
import { fmtTime, plainText } from '../utils/format'
import CustomComposeModal from '../components/CustomComposeModal.vue'
import QuestionDetailModal from '../components/QuestionDetailModal.vue'
import { useToastStore } from '../stores/toast'

const router = useRouter()
const toast = useToastStore()

const stats = ref(null)
const composeOpen = ref(false)
const detailFor = ref(null)

const greeting = computed(() => {
  const h = new Date().getHours()
  if (h < 6) return '夜深了'
  if (h < 12) return '早上好'
  if (h < 14) return '中午好'
  if (h < 18) return '下午好'
  return '晚上好'
})

const todayStr = computed(() => {
  const d = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}年${pad(d.getMonth() + 1)}月${pad(d.getDate())}日`
})

async function load() {
  try {
    stats.value = await api.getStats()
  } catch (err) {
    toast.error('加载首页数据失败：' + (err.message || err))
  }
}
onMounted(load)

function continuePractice() {
  const a = stats.value && stats.value.activeSession
  if (!a) return
  router.push({ path: '/practice/session', query: { sessionId: a.id } })
}

async function reviewWrong() {
  try {
    const r = await api.startPractice({ type: 'wrong_review', title: '错题重练', count: 20 })
    if (r.locked) {
      toast.error(`有进行中的练习「${r.title}」未完成，请先完成或放弃`)
      return
    }
    if (r.done) {
      toast.success(r.message)
      return
    }
    router.push({ path: '/practice/session', query: { sessionId: r.id } })
  } catch (err) {
    toast.error(err.message || '暂无错题可练习')
  }
}

function onComposeStarted(sessionId) {
  composeOpen.value = false
  router.push({ path: '/practice/session', query: { sessionId } })
}

function goCategory(id) {
  router.push({ path: '/practice', query: { expand: id } })
}

function barPercent(node) {
  if (!node.total) return 0
  return Math.round((node.done / node.total) * 100)
}
</script>

<template>
  <div class="page">
    <div class="home-hello">
      <div>
        <div class="home-greet">{{ greeting }}，今天也要好好刷题</div>
        <div class="home-date">{{ todayStr }}</div>
      </div>
      <button
        v-if="stats && stats.activeSession"
        class="btn btn-primary"
        @click="continuePractice"
      >
        继续上次练习 · {{ stats.activeSession.title }}（{{ stats.activeSession.answered }}/{{ stats.activeSession.total }}）
      </button>
    </div>

    <div v-if="!stats" class="empty">加载中…</div>

    <template v-else>
      <div class="stat-grid">
        <div class="card stat-card">
          <div class="stat-num">{{ stats.totalAnswered }}</div>
          <div class="stat-label">累计答题</div>
        </div>
        <div class="card stat-card">
          <div class="stat-num">{{ stats.correctRate }}%</div>
          <div class="stat-label">正确率</div>
        </div>
        <div class="card stat-card">
          <div class="stat-num">{{ stats.todayAnswered }}</div>
          <div class="stat-label">今日答题</div>
        </div>
        <div class="card stat-card" @click="router.push('/wrong')">
          <div class="stat-num" :class="{ warn: stats.wrongCount > 0 }">{{ stats.wrongCount }}</div>
          <div class="stat-label">错题</div>
        </div>
      </div>

      <div class="home-section">
        <div class="home-section-head">
          <h2>练习进度</h2>
          <button class="btn btn-text" @click="router.push('/practice')">查看全部 ›</button>
        </div>
        <div class="card home-list">
          <div
            v-for="node in stats.categoryProgress"
            :key="node.id"
            class="home-cat"
            @click="goCategory(node.id)"
          >
            <span class="home-cat-name">{{ node.name }}</span>
            <div class="home-cat-bar">
              <div class="progress">
                <div class="progress-fill" :style="{ width: barPercent(node) + '%' }"></div>
              </div>
            </div>
            <span class="home-cat-count">{{ node.done }}/{{ node.total }}</span>
          </div>
        </div>
      </div>

      <div class="home-section">
        <div class="home-section-head">
          <h2>快捷操作</h2>
        </div>
        <div class="home-quick">
          <button class="card home-quick-btn" :disabled="!stats.wrongCount" @click="reviewWrong">
            <div class="home-quick-icon">✕</div>
            <div class="home-quick-label">错题重练</div>
          </button>
          <button class="card home-quick-btn" @click="composeOpen = true">
            <div class="home-quick-icon">＋</div>
            <div class="home-quick-label">自定义组卷</div>
          </button>
          <button class="card home-quick-btn" @click="router.push('/questions')">
            <div class="home-quick-icon">⇧</div>
            <div class="home-quick-label">导入题目</div>
          </button>
          <button class="card home-quick-btn" @click="router.push('/notes')">
            <div class="home-quick-icon">📝</div>
            <div class="home-quick-label">我的笔记</div>
          </button>
        </div>
      </div>

      <div class="home-section">
        <div class="home-section-head">
          <h2>最近笔记</h2>
          <button class="btn btn-text" @click="router.push('/notes')">全部笔记 ›</button>
        </div>
        <div class="card home-list">
          <div
            v-for="n in stats.recentNotes"
            :key="n.questionId"
            class="home-note"
            @click="detailFor = n"
          >
            <div class="home-note-content">{{ n.plain || '（空笔记）' }}</div>
            <div class="home-note-meta">
              <span class="home-note-stem">{{ plainText(n.stem).slice(0, 60) }}</span>
              <span class="home-note-time">{{ fmtTime(n.updatedAt) }}</span>
            </div>
          </div>
          <div v-if="!stats.recentNotes.length" class="empty" style="padding: 1.2rem">
            还没有笔记，做题时点卡片上的「笔记」写下心得
          </div>
        </div>
      </div>
    </template>

    <CustomComposeModal v-if="composeOpen" @close="composeOpen = false" @started="onComposeStarted" />

    <QuestionDetailModal
      v-if="detailFor"
      :question="{ id: detailFor.questionId, stem: detailFor.stem, options: [], answer: '', analysis: '' }"
      @close="detailFor = null"
    />
  </div>
</template>

<style scoped>
.home-hello {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 1.2rem;
  flex-wrap: wrap;
}
.home-greet {
  font-size: 1.3rem;
  font-weight: 700;
}
.home-date {
  color: var(--text-2);
  font-size: 0.88rem;
}
.stat-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 0.9rem;
  margin-bottom: 1.3rem;
}
.stat-card {
  padding: 1rem 1.2rem;
  text-align: center;
}
.stat-num {
  font-size: 1.5rem;
  font-weight: 800;
  color: var(--primary);
}
.stat-num.warn {
  color: var(--danger);
}
.stat-label {
  color: var(--text-2);
  font-size: 0.82rem;
  margin-top: 0.15rem;
}
.home-section {
  margin-bottom: 1.3rem;
}
.home-section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 0.6rem;
}
.home-section-head h2 {
  font-size: 1.05rem;
  margin: 0;
}
.home-list {
  overflow: hidden;
}
.home-cat {
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 0.75rem 1.1rem;
  border-bottom: 1px solid var(--border);
  cursor: pointer;
}
.home-cat:last-child {
  border-bottom: none;
}
.home-cat:hover {
  background: var(--card-hover);
}
.home-cat-name {
  width: 9.5rem;
  font-weight: 600;
  flex-shrink: 0;
}
.home-cat-bar {
  flex: 1;
}
.home-cat-count {
  color: var(--text-2);
  font-size: 0.85rem;
  min-width: 4rem;
  text-align: right;
}
.home-quick {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 0.9rem;
}
.home-quick-btn {
  padding: 1rem;
  border: 1px solid var(--border);
  cursor: pointer;
  text-align: center;
  font-family: inherit;
  color: var(--text);
  transition: border-color 0.15s, transform 0.1s;
}
.home-quick-btn:hover {
  border-color: var(--primary);
  transform: translateY(-1px);
}
.home-quick-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.home-quick-icon {
  font-size: 1.3rem;
  color: var(--primary);
}
.home-quick-label {
  font-size: 0.88rem;
  margin-top: 0.3rem;
}
.home-note {
  padding: 0.75rem 1.1rem;
  border-bottom: 1px solid var(--border);
  cursor: pointer;
}
.home-note:last-child {
  border-bottom: none;
}
.home-note:hover {
  background: var(--card-hover);
}
.home-note-content {
  font-size: 0.92rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.home-note-meta {
  display: flex;
  justify-content: space-between;
  gap: 1rem;
  color: var(--text-2);
  font-size: 0.8rem;
  margin-top: 0.2rem;
}
.home-note-stem {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.home-note-time {
  flex-shrink: 0;
}
</style>
