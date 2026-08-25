<script setup>
import { ref, onMounted } from 'vue'
import { api } from '../api'
import { plainText } from '../utils/format'
import QuestionFormModal from '../components/QuestionFormModal.vue'
import ExcelImportModal from '../components/ExcelImportModal.vue'
import ConfirmDialog from '../components/ConfirmDialog.vue'
import { useToastStore } from '../stores/toast'

const toast = useToastStore()

const items = ref([])
const total = ref(0)
const page = ref(1)
const pageSize = 50
const loading = ref(false)
const keyword = ref('')
const categoryId = ref('')
const catOptions = ref([])

const formFor = ref(null)
const importOpen = ref(false)
const deleteFor = ref(null)
const rawTree = ref([])

async function loadCats() {
  try {
    const tree = await api.categoryTree()
    rawTree.value = tree
    const flat = []
    for (const n of tree) {
      flat.push({ id: n.id, name: n.name, total: n.total })
      for (const c of n.children) flat.push({ id: c.id, name: `${n.name} › ${c.name}`, total: c.total })
    }
    catOptions.value = flat
  } catch {}
}

async function load(reset = false) {
  if (reset) {
    page.value = 1
    items.value = []
  }
  loading.value = true
  try {
    const r = await api.listQuestions({
      categoryId: categoryId.value || null,
      keyword: keyword.value.trim(),
      page: page.value,
      pageSize
    })
    total.value = r.total
    items.value = reset ? r.items : [...items.value, ...r.items]
  } catch (err) {
    toast.error('加载题目失败：' + (err.message || err))
  } finally {
    loading.value = false
  }
}
onMounted(async () => {
  await loadCats()
  await load(true)
})

function search() {
  load(true)
}

function resetFilters() {
  keyword.value = ''
  categoryId.value = ''
  load(true)
}

async function remove() {
  const q = deleteFor.value
  deleteFor.value = null
  try {
    await api.deleteQuestion(q.id)
    toast.success('已删除题目（其错题记录、收藏、笔记、草稿一并清除）')
    await load(true)
  } catch (err) {
    toast.error('删除失败：' + (err.message || err))
  }
}

function onSaved() {
  formFor.value = null
  load(true)
}
</script>

<template>
  <div class="page">
    <div class="page-header">
      <span class="page-title-tag">题目管理</span>
      <div class="qm-actions">
        <button class="btn" @click="importOpen = true">导入 Excel</button>
        <button class="btn btn-primary" @click="formFor = { mode: 'new' }">新增题目</button>
      </div>
    </div>

    <div class="filter-bar">
      <input
        v-model="keyword"
        class="input filter-search"
        placeholder="搜索题干…"
        @keyup.enter="search"
      />
      <select v-model="categoryId" class="select filter-cat" @change="search()">
        <option value="">全部分类（共 {{ total }} 题）</option>
        <option v-for="c in catOptions" :key="c.id" :value="c.id">{{ c.name }}（{{ c.total }}）</option>
      </select>
      <button class="btn" @click="search">搜索</button>
      <button class="btn" @click="resetFilters">重置</button>
    </div>

    <div class="card qm-list">
      <div v-if="!items.length && !loading" class="empty">
        <div class="empty-icon">🗂</div>
        <div>暂无题目，点击右上角「导入 Excel」批量导入，或「新增题目」手动录入</div>
      </div>

      <template v-else>
        <div v-for="q in items" :key="q.id" class="list-row qm-row">
          <span class="qm-id">#{{ q.id }}</span>
          <span class="tag tag-gray">{{ q.categoryName }}</span>
          <span class="qm-stem">{{ plainText(q.stem) }}</span>
          <span class="tag tag-primary">答案 {{ q.answer }}</span>
          <button class="btn btn-text" @click="formFor = { mode: 'edit', question: q }">编辑</button>
          <button class="btn btn-text danger" @click="deleteFor = q">删除</button>
        </div>

        <div class="qm-footer">
          <span class="qm-total">共 {{ total }} 题，已加载 {{ items.length }}</span>
          <button
            v-if="items.length < total"
            class="btn"
            :disabled="loading"
            @click="load(false)"
          >
            {{ loading ? '加载中…' : '加载更多' }}
          </button>
        </div>
      </template>
    </div>

    <QuestionFormModal
      v-if="formFor"
      :question="formFor.mode === 'edit' ? formFor.question : null"
      :tree="rawTree"
      @close="formFor = null"
      @saved="onSaved"
    />

    <ExcelImportModal v-if="importOpen" @close="importOpen = false" @done="load(true)" />

    <ConfirmDialog
      v-if="deleteFor"
      title="删除题目"
      :message="`确定删除该题？其错题记录、收藏、笔记、草稿将一并清除，且不可恢复。`"
      danger
      ok-text="删除"
      @confirm="remove"
      @close="deleteFor = null"
    />
  </div>
</template>

<style scoped>
.qm-actions {
  display: flex;
  gap: 0.6rem;
}
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
  width: 15rem;
}
.qm-list {
  overflow: hidden;
}
.qm-row {
  display: flex;
  align-items: center;
}
.qm-id {
  color: var(--text-2);
  font-size: 0.82rem;
  flex-shrink: 0;
}
.qm-stem {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.qm-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.8rem 1rem;
  border-top: 1px solid var(--border);
  color: var(--text-2);
  font-size: 0.85rem;
}
.danger {
  color: var(--danger);
}
.danger:hover {
  background: var(--danger-weak);
}
</style>
