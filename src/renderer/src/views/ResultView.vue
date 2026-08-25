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
