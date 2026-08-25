<script setup>
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { api } from '../api'
import { fmtTime, plainText } from '../utils/format'
import QuestionDetailModal from '../components/QuestionDetailModal.vue'
import ConfirmDialog from '../components/ConfirmDialog.vue'
import { useToastStore } from '../stores/toast'

const router = useRouter()
const toast = useToastStore()

const items = ref([])
const loading = ref(true)
const keyword = ref('')
const categoryId = ref('')
const catOptions = ref([])
const detailFor = ref(null)
const confirmRemove = ref(null)

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
    items.value = await api.listWrong({
      keyword: keyword.value.trim(),
      categoryId: categoryId.value || null
    })
  } catch (err) {
    toast.error('加载错题失败：' + (err.message || err))
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

async function remove(q) {
  confirmRemove.value = null
  try {
    await api.removeWrong(q.questionId)
    toast.success('已移出错题本')
    await load()
  } catch (err) {
    toast.error('操作失败：' + (err.message || err))
  }
}

async function reviewWrong() {
  try {
    const r = await api.startPractice({
      type: 'wrong_review',
      title: '错题重练',
      count: 20,
      wrongCategoryId: categoryId.value || null
    })
    router.push({ path: '/practice/session', query: { sessionId: r.id } })
  } catch (err) {
    toast.error(err.message || '暂无错题可练习')
  }
}
</script>

<template>
  <div class="page">
    <div class="page-header">
      <span class="page-title-tag">错题</span>
      <button class="btn btn-primary" :disabled="!items.length" @click="reviewWrong">错题重练</button>
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
      <div class="empty-icon">🎉</div>
      <div>{{ keyword || categoryId ? '没有符合条件的错题' : '太棒了，当前没有错题' }}</div>
    </div>

    <div v-else class="card">
      <div v-for="q in items" :key="q.questionId" class="list-row wrong-row">
        <span class="tag tag-danger">错{{ q.wrongCount }}次</span>
        <span class="wrong-stem" @click="detailFor = q">{{ plainText(q.stem) }}</span>
        <span class="wrong-meta">{{ q.categoryName }} · {{ fmtTime(q.lastWrongAt) }}</span>
        <button class="btn btn-text" @click="detailFor = q">复盘</button>
        <button class="btn btn-text danger" @click="confirmRemove = q">移除</button>
      </div>
    </div>

    <QuestionDetailModal
      v-if="detailFor"
      :question="{ ...detailFor, id: detailFor.questionId }"
      :my-answer="null"
      show-remove
      @close="detailFor = null"
      @remove="confirmRemove = detailFor; detailFor = null"
    />

    <ConfirmDialog
      v-if="confirmRemove"
      title="移出错题本"
      message="移出后该题不再计入错题统计（题目本身不会被删除）。"
      danger
      ok-text="移除"
      @confirm="remove(confirmRemove)"
      @close="confirmRemove = null"
    />
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
.wrong-row {
  display: flex;
  align-items: center;
}
.wrong-stem {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: pointer;
}
.wrong-stem:hover {
  color: var(--primary);
}
.wrong-meta {
  color: var(--text-2);
  font-size: 0.82rem;
  margin-right: 0.5rem;
  flex-shrink: 0;
}
.danger {
  color: var(--danger);
}
.danger:hover {
  background: var(--danger-weak);
}
</style>
