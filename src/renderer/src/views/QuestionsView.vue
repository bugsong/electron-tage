<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { api } from '../api'
import { plainText } from '../utils/format'
import QuestionFormModal from '../components/QuestionFormModal.vue'
import ExcelImportModal from '../components/ExcelImportModal.vue'
import ConfirmDialog from '../components/ConfirmDialog.vue'
import FilterBar from '../components/FilterBar.vue'
import { useCategoryOptions } from '../composables/useCategoryOptions'
import { useToastStore } from '../stores/toast'

const toast = useToastStore()
const { catOptions, rawTree, loadCats } = useCategoryOptions({ withTotal: true })

const items = ref([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(10)
const pageSizeInput = ref('10')
const pageInput = ref('1')
const loading = ref(false)
const keyword = ref('')
const categoryId = ref('')

const formFor = ref(null)
const importOpen = ref(false)
const deleteFor = ref(null)

// 管理模式（勾选批量删除）
const manageMode = ref(false)
const selected = ref(new Set())
const deleteManyFor = ref(false)

const totalPages = computed(() => Math.max(1, Math.ceil(total.value / pageSize.value)))
const allCurrentSelected = computed(
  () => items.value.length > 0 && items.value.every((q) => selected.value.has(q.id))
)

let pageSizeTimer = null

async function load() {
  loading.value = true
  try {
    const r = await api.listQuestions({
      categoryId: categoryId.value || null,
      keyword: keyword.value.trim(),
      page: page.value,
      pageSize: pageSize.value
    })
    total.value = r.total
    items.value = r.items
  } catch (err) {
    toast.error('加载题目失败：' + (err.message || err))
  } finally {
    loading.value = false
  }
}

function syncPageInput() {
  pageInput.value = String(page.value)
}

function search() {
  page.value = 1
  syncPageInput()
  load()
}

function resetFilters() {
  keyword.value = ''
  categoryId.value = ''
  search()
}

function goPage(p) {
  if (p < 1 || p > totalPages.value || p === page.value) return
  page.value = p
  syncPageInput()
  load()
}

function jumpPage() {
  const p = parseInt(pageInput.value, 10)
  if (!Number.isFinite(p) || p < 1) {
    syncPageInput()
    return
  }
  goPage(p)
}

/** 每页条数输入（防抖后实时生效），非法值回退当前值 */
function onPageSizeInput() {
  clearTimeout(pageSizeTimer)
  pageSizeTimer = setTimeout(applyPageSize, 350)
}

function applyPageSize() {
  const n = parseInt(pageSizeInput.value, 10)
  if (!Number.isFinite(n) || n < 1) {
    pageSizeInput.value = String(pageSize.value)
    return
  }
  if (n === pageSize.value) return
  pageSize.value = n
  page.value = 1
  syncPageInput()
  load()
}

/** 删除后若当前页被删空则回退一页再刷新 */
async function reloadAfterDelete() {
  if (!items.value.length && page.value > 1) {
    page.value -= 1
    syncPageInput()
  }
  await load()
}

async function remove() {
  const q = deleteFor.value
  deleteFor.value = null
  try {
    await api.deleteQuestion(q.id)
    toast.success('已删除题目（其错题记录、收藏、笔记、草稿一并清除）')
    await reloadAfterDelete()
  } catch (err) {
    toast.error('删除失败：' + (err.message || err))
  }
}

function onSaved() {
  formFor.value = null
  search()
}

/* ---------------- 管理模式 ---------------- */

function toggleManage() {
  manageMode.value = !manageMode.value
  if (!manageMode.value) selected.value = new Set()
}

function toggleSelect(id) {
  const s = new Set(selected.value)
  if (s.has(id)) s.delete(id)
  else s.add(id)
  selected.value = s
}

function toggleAllCurrent() {
  const s = new Set(selected.value)
  if (allCurrentSelected.value) {
    for (const q of items.value) s.delete(q.id)
  } else {
    for (const q of items.value) s.add(q.id)
  }
  selected.value = s
}

async function removeSelected() {
  deleteManyFor.value = false
  const ids = [...selected.value]
  if (!ids.length) return
  try {
    await api.deleteQuestions(ids)
    toast.success(`已删除 ${ids.length} 题（其错题记录、收藏、笔记、草稿一并清除）`)
    selected.value = new Set()
    await reloadAfterDelete()
  } catch (err) {
    toast.error('删除失败：' + (err.message || err))
  }
}

onMounted(async () => {
  await loadCats()
  await load()
})

onBeforeUnmount(() => clearTimeout(pageSizeTimer))
</script>

<template>
  <div class="page">
    <div class="page-header">
      <span class="page-title-tag">题库</span>
      <div class="qm-actions">
        <button class="btn" @click="importOpen = true">导入 Excel</button>
        <button class="btn btn-primary" @click="formFor = { mode: 'new' }">新增题目</button>
      </div>
    </div>

    <FilterBar
      v-model:keyword="keyword"
      v-model:categoryId="categoryId"
      :cat-options="catOptions"
      :with-total="true"
      :all-label="`全部分类（共 ${total} 题）`"
      @search="search"
      @reset="resetFilters"
    >
      <template #extra>
        <div class="qm-ctl">
          <span class="qm-ctl-label">每页</span>
          <input
            v-model="pageSizeInput"
            type="number"
            min="1"
            class="input qm-size-input"
            title="每页条数（默认10）"
            @input="onPageSizeInput"
          />
          <span class="qm-ctl-label">条</span>
          <button class="btn" :class="{ active: manageMode }" @click="toggleManage">管理</button>
        </div>
      </template>
    </FilterBar>

    <div class="card qm-list">
      <div v-if="!items.length && !loading" class="empty">
        <div class="empty-icon">🗂</div>
        <div>暂无题目，点击右上角「导入 Excel」批量导入，或「新增题目」手动录入</div>
      </div>

      <template v-else>
        <div v-for="q in items" :key="q.id" class="list-row qm-row">
          <input
            v-if="manageMode"
            type="checkbox"
            class="qm-check"
            :checked="selected.has(q.id)"
            @change="toggleSelect(q.id)"
          />
          <span class="qm-id">#{{ q.id }}</span>
          <span class="tag tag-gray">{{ q.categoryName }}</span>
          <span class="qm-stem">{{ plainText(q.stem) }}</span>
          <span class="tag tag-primary">答案 {{ q.answer }}</span>
          <button class="btn btn-text" @click="formFor = { mode: 'edit', question: q }">编辑</button>
          <button class="btn btn-text danger" @click="deleteFor = q">删除</button>
        </div>

        <!-- 管理模式操作条 -->
        <div v-if="manageMode" class="qm-manage-bar">
          <label class="qm-check-all">
            <input type="checkbox" :checked="allCurrentSelected" @change="toggleAllCurrent" />
            <span>全选</span>
          </label>
          <span class="qm-selected-count">已选 {{ selected.size }} 题</span>
          <button class="btn btn-danger" :disabled="!selected.size" @click="deleteManyFor = true">
            删除
          </button>
        </div>

        <!-- 分页 -->
        <div class="qm-footer">
          <span class="qm-total">共 {{ total }} 题</span>
          <div class="qm-pager">
            <button class="btn" :disabled="page <= 1 || loading" @click="goPage(page - 1)">上一页</button>
            <span class="qm-page-label">第</span>
            <input
              v-model="pageInput"
              type="number"
              min="1"
              :max="totalPages"
              class="input qm-page-input"
              @change="jumpPage"
              @keyup.enter="jumpPage"
            />
            <span class="qm-page-label">页 / 共 {{ totalPages }} 页</span>
            <button class="btn" :disabled="page >= totalPages || loading" @click="goPage(page + 1)">下一页</button>
          </div>
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

    <ExcelImportModal v-if="importOpen" @close="importOpen = false" @done="search" />

    <ConfirmDialog
      v-if="deleteFor"
      title="删除题目"
      :message="`确定删除该题？其错题记录、收藏、笔记、草稿将一并清除，且不可恢复。`"
      danger
      ok-text="删除"
      @confirm="remove"
      @close="deleteFor = null"
    />

    <ConfirmDialog
      v-if="deleteManyFor"
      title="批量删除"
      :message="`确定删除选中的 ${selected.size} 题？其错题记录、收藏、笔记、草稿将一并清除，且不可恢复。`"
      danger
      ok-text="删除"
      @confirm="removeSelected"
      @close="deleteManyFor = false"
    />
  </div>
</template>

<style scoped>
.qm-actions {
  display: flex;
  gap: 0.6rem;
}
.qm-ctl {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  margin-left: auto;
}
.qm-ctl-label {
  color: var(--text-2);
  font-size: 0.85rem;
}
.qm-size-input {
  width: 4rem;
}
.qm-list {
  overflow: hidden;
}
.qm-row {
  display: flex;
  align-items: center;
}
.qm-check {
  width: 1rem;
  height: 1rem;
  flex-shrink: 0;
  accent-color: var(--primary);
  cursor: pointer;
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
.qm-manage-bar {
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 0.7rem 1rem;
  border-top: 1px solid var(--border);
  background: var(--card-hover);
}
.qm-check-all {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  cursor: pointer;
  font-size: 0.9rem;
  color: var(--text);
}
.qm-check-all input {
  width: 1rem;
  height: 1rem;
  accent-color: var(--primary);
  cursor: pointer;
}
.qm-selected-count {
  flex: 1;
  color: var(--text-2);
  font-size: 0.85rem;
}
.qm-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  flex-wrap: wrap;
  padding: 0.8rem 1rem;
  border-top: 1px solid var(--border);
  color: var(--text-2);
  font-size: 0.85rem;
}
.qm-pager {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}
.qm-page-label {
  color: var(--text-2);
  font-size: 0.85rem;
}
.qm-page-input {
  width: 4rem;
  text-align: center;
}
.danger {
  color: var(--danger);
}
.danger:hover {
  background: var(--danger-weak);
}
</style>
