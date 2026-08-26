<script setup>
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { api } from '../api'
import { fmtTime, plainText } from '../utils/format'
import FilterBar from '../components/FilterBar.vue'
import { useCategoryOptions } from '../composables/useCategoryOptions'
import { useToastStore } from '../stores/toast'

const router = useRouter()
const toast = useToastStore()
const { catOptions, loadCats } = useCategoryOptions({ indent: true })

const items = ref([])
const loading = ref(true)
const keyword = ref('')
const categoryId = ref('')

async function load() {
  loading.value = true
  try {
    items.value = await api.listFavorites({
      keyword: keyword.value.trim(),
      categoryId: categoryId.value || null
    })
  } catch (err) {
    toast.error('加载收藏失败：' + (err.message || err))
  } finally {
    loading.value = false
  }
}
onMounted(async () => {
  await loadCats()
  await load()
})

function search() {
  load()
}

async function unstar(q) {
  try {
    await api.toggleFavorite(q.questionId)
    toast.success('已取消收藏')
    await load()
  } catch (err) {
    toast.error('操作失败：' + (err.message || err))
  }
}

async function reviewFavorites() {
  try {
    const r = await api.startPractice({ type: 'favorite', title: '收藏练习', count: 20 })
    router.push({ path: '/practice/session', query: { sessionId: r.id } })
  } catch (err) {
    toast.error(err.message || '暂无收藏题目')
  }
}

/** 点击条目进入独立回看页（与笔记回看一致），带 questionId 以兼容过滤后的列表 */
function openReview(i) {
  const q = items.value[i]
  if (!q) return
  router.push({ path: '/practice/review', query: { mode: 'favorites', questionId: q.questionId } })
}
</script>

<template>
  <div class="page">
    <div class="page-header">
      <span class="page-title-tag">收藏</span>
      <button class="btn btn-primary" :disabled="!items.length" @click="reviewFavorites">收藏练习</button>
    </div>

    <FilterBar
      v-model:keyword="keyword"
      v-model:categoryId="categoryId"
      :cat-options="catOptions"
      @search="search"
      @reset="search"
    />

    <div v-if="loading" class="empty">加载中…</div>

    <div v-else-if="!items.length" class="empty">
      <div class="empty-icon">⭐</div>
      <div>{{ keyword || categoryId ? '没有符合条件的收藏' : '还没有收藏题目，做题时点卡片上的星标即可收藏' }}</div>
    </div>

    <div v-else class="card">
      <div v-for="(q, i) in items" :key="q.questionId" class="list-row fav-row">
        <span class="tag tag-gray">{{ q.categoryName }}</span>
        <span class="fav-stem" @click="openReview(i)">{{ plainText(q.stem) }}</span>
        <span class="fav-meta">{{ fmtTime(q.createdAt) }}</span>
        <button class="btn btn-text" @click="openReview(i)">查看</button>
        <button class="icon-btn" title="取消收藏" @click="unstar(q)">
          <svg viewBox="0 0 24 24" width="17" height="17" fill="currentColor" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round">
            <path d="m12 2 3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01z" />
          </svg>
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.fav-row {
  display: flex;
  align-items: center;
}
.fav-stem {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: pointer;
}
.fav-stem:hover {
  color: var(--primary);
}
.fav-meta {
  color: var(--text-2);
  font-size: 0.82rem;
  flex-shrink: 0;
}
</style>
