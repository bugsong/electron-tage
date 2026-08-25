<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { api } from '../api'
import { sanitizeHtml } from '../utils/sanitize'
import QuestionCard from '../components/QuestionCard.vue'
import NoteEditorModal from '../components/NoteEditorModal.vue'
import { useToastStore } from '../stores/toast'

const route = useRoute()
const router = useRouter()
const toast = useToastStore()

const session = ref(null)
const wrongItems = ref([])
const loading = ref(true)
const index = ref(0)
const favorites = ref(new Set())
const noteFor = ref(null)

const isWrongMode = computed(() => route.query.mode === 'wrong')
const questions = computed(() => (isWrongMode.value ? wrongItems.value : session.value ? session.value.questions : []))
const total = computed(() => questions.value.length)
const current = computed(() => questions.value[index.value])

const myAnswer = computed(() =>
  isWrongMode.value || !session.value ? null : session.value.answers[index.value]
)
const myCorrect = computed(() =>
  isWrongMode.value || !session.value ? null : session.value.result[index.value]
)

const safeAnalysis = computed(() => (current.value ? sanitizeHtml(current.value.analysis || '') : ''))

async function load() {
  if (isWrongMode.value) {
    try {
      const list = await api.listWrong({})
      wrongItems.value = list.map((w) => ({
        id: w.questionId,
        questionId: w.questionId,
        stem: w.stem,
        options: w.options,
        answer: w.answer,
        analysis: w.analysis,
        categoryName: w.categoryName
      }))
      index.value = Math.min(Math.max(Number(route.query.index) || 0, 0), Math.max(wrongItems.value.length - 1, 0))
      try {
        const favs = await api.listFavorites()
        favorites.value = new Set(favs.map((f) => f.questionId))
      } catch {}
    } catch (err) {
      toast.error('加载失败：' + (err.message || err))
    } finally {
      loading.value = false
    }
    return
  }
  const id = route.query.sessionId
  if (!id) {
    router.replace('/practice')
    return
  }
  try {
    const s = await api.getSession(id)
    if (!s) {
      router.replace('/practice')
      return
    }
    session.value = s
    index.value = Math.min(Math.max(Number(route.query.index) || 0, 0), Math.max(s.questions.length - 1, 0))
    try {
      const favs = await api.listFavorites()
      favorites.value = new Set(favs.map((f) => f.questionId))
    } catch {}
  } catch (err) {
    toast.error('加载失败：' + (err.message || err))
  } finally {
    loading.value = false
  }
}
onMounted(load)

function go(i) {
  if (i < 0 || i >= total.value) return
  index.value = i
  const query = { index: i, mode: route.query.mode, sessionId: route.query.sessionId }
  router.replace({ path: '/practice/review', query })
}

async function toggleFavorite(q) {
  try {
    const fav = await api.toggleFavorite(q.id)
    const s = new Set(favorites.value)
    if (fav) s.add(q.id)
    else s.delete(q.id)
    favorites.value = s
    toast.success(fav ? '已收藏' : '已取消收藏')
  } catch (err) {
    toast.error('操作失败：' + (err.message || err))
  }
}
</script>

<template>
  <div class="review-page">
    <div class="rv-topbar">
      <button v-if="isWrongMode" class="btn btn-text" title="返回错题本" @click="router.push('/wrong')">
        ← 错题本
      </button>
      <button v-else class="btn btn-text" title="返回答题卡" @click="router.push({ path: '/practice/result', query: { sessionId: route.query.sessionId } })">
        ← 答题卡
      </button>
      <h1 class="rv-title">{{ isWrongMode ? '错题复盘' : '题目回看' }}</h1>
      <span class="rv-count">{{ index + 1 }}/{{ total }}</span>
      <button class="btn" :disabled="index === 0" @click="go(index - 1)">上一题</button>
      <button class="btn btn-primary" :disabled="index >= total - 1" @click="go(index + 1)">下一题</button>
    </div>

    <div v-if="loading" class="empty">加载中…</div>
    <div v-else-if="!questions.length" class="empty">{{ isWrongMode ? '太棒了，当前没有错题' : '没有可查看的题目' }}</div>

    <template v-else>
      <QuestionCard
        v-if="current"
        :question="current"
        :index="index + 1"
        :answer="myAnswer"
        :is-favorite="favorites.has(current.id)"
        :session-type="isWrongMode ? 'wrong_review' : session.type"
        :show-result="true"
        :is-correct="myCorrect"
        @favorite="toggleFavorite(current)"
        @note="noteFor = current"
      />

      <div v-if="safeAnalysis" class="card rv-analysis">
        <div class="rv-analysis-title">解析</div>
        <div class="rv-analysis-body" v-html="safeAnalysis"></div>
      </div>

      <div class="rv-nav">
        <button class="btn" :disabled="index === 0" @click="go(index - 1)">← 上一题</button>
        <button class="btn btn-primary" :disabled="index >= total - 1" @click="go(index + 1)">下一题 →</button>
      </div>
    </template>

    <NoteEditorModal v-if="noteFor" :question-id="noteFor.id" @close="noteFor = null" />
  </div>
</template>

<style scoped>
.review-page {
  width: 80%;
  max-width: 80%;
  margin: 0 auto;
}
.rv-topbar {
  display: flex;
  align-items: center;
  gap: 0.7rem;
  padding-bottom: 0.9rem;
  margin-bottom: 1rem;
  border-bottom: 1px solid var(--border);
}
.rv-title {
  flex: 1;
  text-align: center;
  font-size: 1.05rem;
  font-weight: 700;
  margin: 0;
}
.rv-count {
  color: var(--text-2);
  font-size: 0.88rem;
  font-variant-numeric: tabular-nums;
}
.rv-analysis {
  padding: 0.8rem 1rem;
  margin-bottom: 1rem;
  font-size: 0.92rem;
  line-height: 1.85;
}
.rv-analysis-title {
  font-weight: 700;
  margin-bottom: 0.3rem;
  color: var(--primary);
}
.rv-analysis-body {
  word-break: break-word;
}
.rv-analysis-body :deep(img) {
  max-width: 100%;
  height: auto;
}
.rv-nav {
  display: flex;
  justify-content: space-between;
  gap: 0.7rem;
}
</style>
