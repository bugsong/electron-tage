<script setup>
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { api } from '../api'
import { fmtTime, plainText } from '../utils/format'
import { useToastStore } from '../stores/toast'

const router = useRouter()
const toast = useToastStore()

const items = ref([])
const loading = ref(true)
const keyword = ref('')
const categoryId = ref('')
const catOptions = ref([])

async function loadCats() {
  try {
    const tree = await api.categoryTree()
    const flat = []
    for (const n of tree) {
      flat.push({ id: n.id, name: n.name })
      for (const c of n.children) flat.push({ id: c.id, name: `　${n.name} › ${c.name}` })
    }
    catOptions.value = flat
  } catch {}
}

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

    <div class="filter-bar">
      <input
        v-model="keyword"
        class="input filter-search"
        placeholder="搜索题干…"
        @keyup.enter="search"
      />
      <select v-model="categoryId" class="select filter-cat" @change="load()">
        <option value="">全部分类</option>
        <option v-for="c in catOptions" :key="c.id" :value="c.id">{{ c.name }}</option>
      </select>
      <button class="btn" @click="search">搜索</button>
      <button class="btn" @click="keyword = ''; categoryId = ''; load()">重置</button>
    </div>

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
.filter-bar {
  display: flex;
  gap: 0.6rem;
  margin-bottom: 1rem;
  flex-wrap: wrap;
}
.filter-search {
  width: 16rem;
}
.filter-cat {
  width: 13rem;
}
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
