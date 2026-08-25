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
const loading = ref(true)
const index = ref(0)
const favorites = ref(new Set())
const noteFor = ref(null)

const questions = computed(() => (session.value ? session.value.questions : []))
const total = computed(() => questions.value.length)
const current = computed(() => questions.value[index.value])

const safeAnalysis = computed(() => (current.value ? sanitizeHtml(current.value.analysis || '') : ''))

async function load() {
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
  router.replace({ path: '/practice/review', query: { sessionId: route.query.sessionId, index: i } })
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
      <button class="btn btn-text" title="返回答题卡" @click="router.push({ path: '/practice/result', query: { sessionId: route.query.sessionId } })">
        ← 答题卡
      </button>
      <h1 class="rv-title">题目回看</h1>
      <span class="rv-count">{{ index + 1 }}/{{ total }}</span>
      <button class="btn" :disabled="index === 0" @click="go(index - 1)">上一题</button>
      <button class="btn btn-primary" :disabled="index >= total - 1" @click="go(index + 1)">下一题</button>
    </div>

    <div v-if="loading" class="empty">加载中…</div>
    <div v-else-if="!questions.length" class="empty">没有可查看的题目</div>

    <template v-else>
      <QuestionCard
        v-if="current"
        :question="current"
        :index="index + 1"
        :answer="session.answers[index]"
        :is-favorite="favorites.has(current.id)"
        :session-type="session.type"
        :show-result="true"
        :is-correct="session.result[index]"
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
