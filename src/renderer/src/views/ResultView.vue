<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { api } from '../api'
import { fmtDuration, plainText } from '../utils/format'
import QuestionDetailModal from '../components/QuestionDetailModal.vue'
import { useToastStore } from '../stores/toast'

const route = useRoute()
const router = useRouter()
const toast = useToastStore()

const session = ref(null)
const loading = ref(true)
const detailFor = ref(null)

const wrongCount = computed(() => (session.value ? session.value.result.filter((r) => !r).length : 0))
const unanswered = computed(() =>
  session.value
    ? session.value.answers.filter((a) => a == null).length
    : 0
)
const correctRate = computed(() =>
  session.value && session.value.total
    ? Math.round((session.value.correct / session.value.total) * 100)
    : 0
)

const origin = computed(() => {
  const t = session.value && session.value.type
  if (t === 'wrong_review') return '/wrong'
  if (t === 'favorite') return '/favorites'
  return '/practice'
})

async function load() {
  const id = route.query.sessionId
  if (!id) {
    router.replace('/practice')
    return
  }
  try {
    const s = await api.getSession(id)
    if (!s || s.status !== 'done') {
      router.replace('/practice')
      return
    }
    session.value = s
  } catch (err) {
    toast.error('加载结果失败：' + (err.message || err))
  } finally {
    loading.value = false
  }
}
onMounted(load)

async function reviewWrong() {
  try {
    const r = await api.startPractice({ type: 'wrong_review', title: '错题重练', count: 20 })
    router.push({ path: '/practice/session', query: { sessionId: r.id } })
  } catch (err) {
    toast.error(err.message || '错题重练开始失败')
  }
}

function getQuestionStatus(i) {
  if (session.value.answers[i] == null) return 'unanswered'
  return session.value.result[i] ? 'correct' : 'wrong'
}

function openQuestionDetail(i) {
  const q = session.value.questions[i]
  detailFor.value = { q, i }
}
</script>

<template>
  <div class="page">
    <div v-if="loading" class="empty">加载中…</div>

    <template v-else-if="session">
      <div class="page-header">
        <h1 class="page-heading">{{ session.title }}</h1>
        <button class="btn" @click="router.push(origin)">← 返回</button>
      </div>

      <div class="r-summary card">
        <div class="r-score">
          <div class="r-score-num">{{ session.correct }}<span class="r-total">/{{ session.total }}</span></div>
          <div class="r-score-label">得分</div>
        </div>
        <div class="r-item">
          <div class="r-item-num">{{ correctRate }}%</div>
          <div class="r-item-label">正确率</div>
        </div>
        <div class="r-item">
          <div class="r-item-num">{{ fmtDuration(session.durationMs) }}</div>
          <div class="r-item-label">用时</div>
        </div>
        <div class="r-item">
          <div class="r-item-num ok">{{ session.total - wrongCount - unanswered }}</div>
          <div class="r-item-label">答对</div>
        </div>
        <div class="r-item">
          <div class="r-item-num bad">{{ wrongCount }}</div>
          <div class="r-item-label">答错</div>
        </div>
        <div class="r-item">
          <div class="r-item-num gray">{{ unanswered }}</div>
          <div class="r-item-label">未答</div>
        </div>
      </div>

      <!-- 答题卡区域 -->
      <div class="card r-answer-card-section">
        <div class="r-answer-card-header">
          <div class="r-answer-card-title">答题卡</div>
          <div class="r-answer-card-stats">
            <span class="stat-item"><span class="dot correct"></span>对 {{ session.correct }}</span>
            <span class="stat-item"><span class="dot wrong"></span>错 {{ wrongCount }}</span>
            <span class="stat-item"><span class="dot unanswered"></span>未答 {{ unanswered }}</span>
          </div>
        </div>
        
        <!-- 统计数据行 -->
        <div class="r-answer-card-metrics">
          <div class="metric">
            <span class="metric-value">{{ session.correct }}/{{ session.total }}</span>
            <span class="metric-label">得分</span>
          </div>
          <div class="metric">
            <span class="metric-value">{{ correctRate }}%</span>
            <span class="metric-label">正确率</span>
          </div>
          <div class="metric">
            <span class="metric-value">{{ fmtDuration(session.durationMs) }}</span>
            <span class="metric-label">用时</span>
          </div>
        </div>
        
        <!-- 题号网格 -->
        <div class="r-answer-card-grid full">
          <button
            v-for="(_, i) in session.questions"
            :key="i"
            class="answer-card-btn"
            :class="getQuestionStatus(i)"
            @click="openQuestionDetail(i)"
          >
            {{ i + 1 }}
          </button>
        </div>
      </div>

      <div class="card r-list">
        <div
          v-for="(q, i) in session.questions"
          :key="q.id"
          class="r-row"
          @click="detailFor = { q, i }"
        >
          <span class="r-no">{{ i + 1 }}</span>
          <span class="tag" :class="session.result[i] ? 'tag-success' : 'tag-danger'">
            {{ session.result[i] ? '对' : '错' }}
          </span>
          <span class="r-stem">{{ plainText(q.stem) }}</span>
          <span class="r-answer">
            <template v-if="session.answers[i] != null">我的 {{ session.answers[i] }}</template>
            <template v-else>未作答</template>
          </span>
          <button class="btn btn-text" @click.stop="detailFor = { q, i }">查看</button>
        </div>
      </div>

      <div class="r-actions">
        <button class="btn" @click="router.push(origin)">返回目录</button>
        <button v-if="wrongCount" class="btn btn-primary" @click="reviewWrong">错题重练（{{ wrongCount }} 题）</button>
      </div>
    </template>

    <QuestionDetailModal
      v-if="detailFor"
      :question="{ ...detailFor.q, no: detailFor.i + 1 }"
      :my-answer="session.answers[detailFor.i]"
      :correct="session.result[detailFor.i]"
      @close="detailFor = null"
    />
  </div>
</template>

<style scoped>
.r-summary {
  display: flex;
  align-items: center;
  gap: 2.2rem;
  padding: 1.3rem 1.6rem;
  margin-bottom: 1.1rem;
}
.r-score {
  text-align: center;
}
.r-score-num {
  font-size: 2rem;
  font-weight: 800;
  color: var(--primary);
  line-height: 1.2;
}
.r-total {
  font-size: 1rem;
  color: var(--text-2);
  font-weight: 600;
}
.r-score-label {
  font-size: 0.8rem;
  color: var(--text-2);
}
.r-item {
  text-align: center;
  flex: 1;
}
.r-item-num {
  font-size: 1.2rem;
  font-weight: 700;
}
.r-item-num.ok {
  color: var(--success);
}
.r-item-num.bad {
  color: var(--danger);
}
.r-item-num.gray {
  color: var(--text-2);
}
.r-item-label {
  font-size: 0.8rem;
  color: var(--text-2);
}

/* 答题卡区域 */
.r-answer-card-section {
  margin-bottom: 1.1rem;
  padding: 1rem 1.2rem;
}
.r-answer-card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 0.8rem;
}
.r-answer-card-title {
  font-weight: 700;
  font-size: 1rem;
}
.r-answer-card-stats {
  display: flex;
  gap: 1rem;
  font-size: 0.85rem;
  color: var(--text-2);
}
.stat-item {
  display: flex;
  align-items: center;
  gap: 0.35rem;
}

/* 统计数据行 */
.r-answer-card-metrics {
  display: flex;
  justify-content: space-around;
  padding: 0.8rem 0;
  margin-bottom: 0.8rem;
  background: var(--bg);
  border-radius: 8px;
}
.metric {
  text-align: center;
}
.metric-value {
  display: block;
  font-size: 1.3rem;
  font-weight: 700;
  color: var(--primary);
}
.metric-label {
  display: block;
  font-size: 0.8rem;
  color: var(--text-2);
  margin-top: 0.2rem;
}

/* 题号网格 */
.r-answer-card-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(2.2rem, 1fr));
  gap: 0.5rem;
  margin-bottom: 0.5rem;
}
.r-answer-card-grid.full {
  max-height: none;
  overflow: visible;
}

/* 答题卡按钮 */
.answer-card-btn {
  width: 2.2rem;
  height: 2.2rem;
  border-radius: 50%;
  border: none;
  font-size: 0.85rem;
  font-weight: 600;
  cursor: pointer;
  transition: transform 0.15s, box-shadow 0.15s;
  display: flex;
  align-items: center;
  justify-content: center;
}
.answer-card-btn:hover {
  transform: scale(1.1);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
}
.answer-card-btn.correct {
  background: var(--success);
  color: white;
}
.answer-card-btn.wrong {
  background: var(--danger);
  color: white;
}
.answer-card-btn.unanswered {
  background: var(--border);
  color: var(--text-2);
}
.answer-card-btn.large {
  width: 2.6rem;
  height: 2.6rem;
  font-size: 0.95rem;
}

/* 小圆点 */
.dot {
  width: 0.6rem;
  height: 0.6rem;
  border-radius: 50%;
  display: inline-block;
}
.dot.correct {
  background: var(--success);
}
.dot.wrong {
  background: var(--danger);
}
.dot.unanswered {
  background: var(--border);
  border: 1px solid var(--text-3);
}

.r-list {
  margin-bottom: 1rem;
  overflow: hidden;
}
.r-row {
  display: flex;
  align-items: center;
  gap: 0.7rem;
  padding: 0.7rem 1rem;
  border-bottom: 1px solid var(--border);
  cursor: pointer;
}
.r-row:last-child {
  border-bottom: none;
}
.r-row:hover {
  background: var(--card-hover);
}
.r-no {
  font-weight: 700;
  min-width: 1.6rem;
}
.r-stem {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text);
}
.r-answer {
  color: var(--text-2);
  font-size: 0.86rem;
  min-width: 4.5rem;
  text-align: right;
}
.r-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.7rem;
}
</style>
