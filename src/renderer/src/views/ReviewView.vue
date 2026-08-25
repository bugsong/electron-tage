<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRoute, useRouter, onBeforeRouteLeave } from 'vue-router'
import { api } from '../api'
import { sanitizeHtml } from '../utils/sanitize'
import QuestionCard from '../components/QuestionCard.vue'
import { clearSessionDrafts } from '../components/PaperCanvas.vue'
import { useToastStore } from '../stores/toast'

const route = useRoute()
const router = useRouter()
const toast = useToastStore()

const session = ref(null)
const wrongItems = ref([])
const noteItems = ref([])
const favItems = ref([])
const loading = ref(true)
const index = ref(0)
const favorites = ref(new Set())

const isWrongMode = computed(() => route.query.mode === 'wrong')
const isNotesMode = computed(() => route.query.mode === 'notes')
const isFavMode = computed(() => route.query.mode === 'favorites')
const questions = computed(() => {
  if (isWrongMode.value) return wrongItems.value
  if (isNotesMode.value) return noteItems.value
  if (isFavMode.value) return favItems.value
  return session.value ? session.value.questions : []
})
const total = computed(() => questions.value.length)
const current = computed(() => questions.value[index.value])

const myAnswer = computed(() =>
  isWrongMode.value || isNotesMode.value || isFavMode.value || !session.value
    ? null
    : session.value.answers[index.value]
)
const myCorrect = computed(() =>
  isWrongMode.value || isNotesMode.value || isFavMode.value || !session.value
    ? null
    : session.value.result[index.value]
)

const safeAnalysis = computed(() => (current.value ? sanitizeHtml(current.value.analysis || '') : ''))

// 本次回看的草纸作用域：与练习界面的 session scope 同源，统一由 clearSessionDrafts 管理临时笔迹
const paperScope = computed(() => 'review:' + (session.value ? session.value.id : (route.query.mode || 'view')))

// 离开回看页时清除本次回看的临时笔迹（普通版内存），与练习界面「交卷/放弃即清」保持同一套草纸清理逻辑
onBeforeRouteLeave(() => {
  clearSessionDrafts(paperScope.value)
})

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
  if (isNotesMode.value) {
    try {
      const list = await api.listNotes({})
      noteItems.value = list.map((n) => ({
        id: n.questionId,
        questionId: n.questionId,
        stem: n.stem,
        options: n.options,
        answer: n.answer,
        analysis: n.analysis,
        categoryName: n.categoryName
      }))
      // 优先按 questionId 定位（来自笔记列表点击，带过滤也能对位），否则按 index
      const qid = Number(route.query.questionId)
      const pos = qid ? noteItems.value.findIndex((n) => n.questionId === qid) : -1
      const start = pos >= 0 ? pos : Number(route.query.index) || 0
      index.value = Math.min(Math.max(start, 0), Math.max(noteItems.value.length - 1, 0))
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
  if (isFavMode.value) {
    try {
      const list = await api.listFavorites({})
      favItems.value = list.map((f) => ({
        id: f.questionId,
        questionId: f.questionId,
        stem: f.stem,
        options: f.options,
        answer: f.answer,
        analysis: f.analysis,
        categoryName: f.categoryName
      }))
      // 优先按 questionId 定位（来自收藏列表点击，带过滤也能对位），否则按 index
      const qid = Number(route.query.questionId)
      const pos = qid ? favItems.value.findIndex((n) => n.questionId === qid) : -1
      const start = pos >= 0 ? pos : Number(route.query.index) || 0
      index.value = Math.min(Math.max(start, 0), Math.max(favItems.value.length - 1, 0))
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
      <button v-if="isNotesMode" class="btn btn-text" title="返回笔记" @click="router.push('/notes')">
        ← 笔记
      </button>
      <button v-else-if="isFavMode" class="btn btn-text" title="返回收藏" @click="router.push('/favorites')">
        ← 收藏
      </button>
      <button v-else-if="isWrongMode" class="btn btn-text" title="返回错题本" @click="router.push('/wrong')">
        ← 错题本
      </button>
      <button v-else class="btn btn-text" title="返回答题卡" @click="router.push({ path: '/practice/result', query: { sessionId: route.query.sessionId } })">
        ← 答题卡
      </button>
      <h1 class="rv-title">{{ isNotesMode ? '笔记回看' : isFavMode ? '收藏回看' : isWrongMode ? '错题复盘' : '题目回看' }}</h1>
      <span class="rv-count">{{ index + 1 }}/{{ total }}</span>
      <button class="btn" :disabled="index === 0" @click="go(index - 1)">上一题</button>
      <button class="btn btn-primary" :disabled="index >= total - 1" @click="go(index + 1)">下一题</button>
    </div>

    <div v-if="loading" class="empty">加载中…</div>
    <div v-else-if="!questions.length" class="empty">
      {{ isNotesMode ? '还没有笔记，做题时在题目卡片右上角点「笔记」写下心得' : isFavMode ? '还没有收藏题目，做题时点卡片上的星标即可收藏' : isWrongMode ? '太棒了，当前没有错题' : '没有可查看的题目' }}
    </div>

    <template v-else>
      <QuestionCard
        v-if="current"
        :question="current"
        :index="index + 1"
        :answer="myAnswer"
        :is-favorite="favorites.has(current.id)"
        :session-type="isWrongMode || isNotesMode || isFavMode ? 'wrong_review' : session.type"
        :show-result="true"
        :is-correct="myCorrect"
        :paper-scope="paperScope"
        @favorite="toggleFavorite(current)"
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
