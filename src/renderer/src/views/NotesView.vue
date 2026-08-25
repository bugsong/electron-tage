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
    items.value = await api.listNotes({
      keyword: keyword.value.trim(),
      categoryId: categoryId.value || null
    })
  } catch (err) {
    toast.error('加载笔记失败：' + (err.message || err))
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

function preview(content) {
  return plainText(content).slice(0, 90) || '（空笔记）'
}

/** 点击笔记条目进入独立回看页（与错题「复盘」一致），带 questionId 以兼容过滤后的列表 */
function openReview(i) {
  const n = items.value[i]
  if (!n) return
  router.push({ path: '/practice/review', query: { mode: 'notes', questionId: n.questionId } })
}
</script>

<template>
  <div class="page">
    <div class="page-header">
      <span class="page-title-tag">笔记</span>
      <span class="page-sub">全部 {{ items.length }} 条，做题时点卡片上的「笔记」即可随题记录</span>
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
      <div class="empty-icon">📝</div>
      <div>{{ keyword || categoryId ? '没有符合条件的笔记' : '还没有笔记，做题时在题目卡片右上角点「笔记」写下心得' }}</div>
    </div>

    <div v-else class="card">
      <div v-for="(n, i) in items" :key="n.questionId" class="note-item" @click="openReview(i)">
        <div class="note-body" v-html="n.content"></div>
        <div class="note-meta">
          <span class="tag tag-gray">{{ n.categoryName }}</span>
          <span class="note-stem">{{ plainText(n.stem).slice(0, 80) }}</span>
          <span class="note-time">{{ fmtTime(n.updatedAt) }}</span>
        </div>
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
.page-sub {
  color: var(--text-2);
  font-size: 0.85rem;
}
.note-item {
  padding: 0.9rem 1.1rem;
  border-bottom: 1px solid var(--border);
  cursor: pointer;
}
.note-item:last-child {
  border-bottom: none;
}
.note-item:hover {
  background: var(--card-hover);
}
.note-body {
  font-size: 0.93rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
/* 富文本里的块级元素一律内联化、换行隐藏，保证缩略预览单行省略 */
.note-body :deep(p),
.note-body :deep(div),
.note-body :deep(ul),
.note-body :deep(ol),
.note-body :deep(li),
.note-body :deep(pre) {
  display: inline;
  margin: 0;
}
.note-body :deep(br) {
  display: none;
}
.note-body :deep(h2) {
  font-size: 1rem;
  margin: 0;
  display: inline;
}
.note-body :deep(blockquote) {
  margin: 0;
  padding-left: 0.5rem;
  border-left: 2px solid var(--primary);
  display: inline;
}
.note-body :deep(img) {
  max-width: 1.1em;
  max-height: 1.1em;
  vertical-align: -0.2em;
  object-fit: cover;
}
.note-meta {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  color: var(--text-2);
  font-size: 0.8rem;
  margin-top: 0.35rem;
}
.note-stem {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.note-time {
  flex-shrink: 0;
}
</style>
