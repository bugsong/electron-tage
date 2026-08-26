<script setup>
import { ref, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { api } from '../api'
import CustomComposeModal from '../components/CustomComposeModal.vue'
import Modal from '../components/Modal.vue'
import { useToastStore } from '../stores/toast'

const route = useRoute()
const router = useRouter()
const toast = useToastStore()

const tree = ref([])
const loading = ref(true)
const expanded = ref(new Set())
const composeOpen = ref(false)
const practiceCount = ref(20)
const clearTarget = ref(null)
const clearing = ref(false)

async function load() {
  loading.value = true
  try {
    tree.value = await api.categoryTree()
    // 默认全部收起；支持从首页带 ?expand= 展开指定分类
    const expandId = Number(route.query.expand)
    if (expandId) expanded.value.add(expandId)
  } catch (err) {
    toast.error('加载分类失败：' + (err.message || err))
  } finally {
    loading.value = false
  }
  try {
    const s = await api.getSettings()
    if (s.practiceCount) {
      const n = Number(s.practiceCount)
      if (Number.isFinite(n) && n >= 5 && n <= 50) practiceCount.value = n
    }
  } catch {}
}
onMounted(load)

function toggleExpand(id) {
  const s = new Set(expanded.value)
  if (s.has(id)) s.delete(id)
  else s.add(id)
  expanded.value = s
}

/** 已做/未做进度百分比 */
function barPercent(node) {
  if (!node || !node.total) return 0
  return Math.round((node.done / node.total) * 100)
}

async function goPractice(categoryId, name) {
  try {
    const r = await api.startPractice({
      type: 'special',
      title: `练习（${name}）`,
      categoryIds: [categoryId],
      count: practiceCount.value
    })
    if (r.locked) {
      toast.error(`有进行中的练习「${r.title}」入口在首页右上角！`)
      return
    }
    if (r.done) {
      toast.success(r.message)
      return
    }
    router.push({ path: '/practice/session', query: { sessionId: r.id } })
  } catch (err) {
    toast.error(err.message || '开始练习失败')
  }
}

function askClear(categoryId, name) {
  clearTarget.value = { categoryId, name }
}

async function doClear() {
  if (!clearTarget.value) return
  clearing.value = true
  try {
    await api.clearPracticeProgress(clearTarget.value.categoryId)
    toast.success(`已清除「${clearTarget.value.name}」的刷题记录`)
    clearTarget.value = null
    await load()
  } catch (err) {
    toast.error(err.message || '清除记录失败')
  } finally {
    clearing.value = false
  }
}

function onComposeStarted(sessionId) {
  composeOpen.value = false
  router.push({ path: '/practice/session', query: { sessionId } })
}

/** 每个一级节点都在最前面补一个虚拟「全部」 */
function visibleChildren(node) {
  const subs = [...node.children]
  subs.unshift({
    id: 'all-' + node.id,
    virtual: true,
    parentId: node.id,
    parentName: node.name,
    name: '全部',
    total: node.total,
    done: node.done
  })
  return subs
}
</script>

<template>
  <div class="page">
    <div class="page-header">
      <span class="page-title-tag">练习</span>
      <button class="btn btn-text" @click="composeOpen = true">自定义刷题</button>
    </div>

    <div v-if="loading" class="empty">加载中…</div>

    <div v-else-if="!tree.length" class="empty">
      <div class="empty-icon">📂</div>
      <div>还没有任何分类，请先到「题库」导入题目</div>
    </div>

    <div v-else class="card ptree">
      <div v-for="node in tree" :key="node.id" class="pnode">
        <div class="prow" :class="{ expanded: expanded.has(node.id) }">
          <button class="parrow" :class="{ open: expanded.has(node.id) }" @click="toggleExpand(node.id)"></button>
          <span class="pname" @click="toggleExpand(node.id)">{{ node.name }}</span>
          <span class="pcount">{{ node.done }}/{{ node.total }}</span>
          <button class="btn btn-text pgo" @click="goPractice(node.id, node.name)">去练习 &gt;</button>
          <button class="btn btn-text pclear" @click="askClear(node.id, node.name)">清除记录</button>
        </div>
        <div class="pprogress">
          <div class="progress">
            <div class="progress-fill" :style="{ width: barPercent(node) + '%' }"></div>
          </div>
        </div>

        <div v-if="expanded.has(node.id)" class="pchildren">
          <template v-if="visibleChildren(node).length">
            <div v-for="child in visibleChildren(node)" :key="child.id" class="pchild">
              <div class="prow child">
                <span class="pname child-name">{{ child.name }}</span>
                <span class="pcount">{{ child.done }}/{{ child.total }}</span>
                <button
                  class="btn btn-text pgo"
                  @click="goPractice(child.virtual ? child.parentId : child.id, child.virtual ? child.parentName : child.name)"
                >
                  去练习 &gt;
                </button>
                <button
                  class="btn btn-text pclear"
                  @click="askClear(child.virtual ? child.parentId : child.id, child.virtual ? child.parentName : child.name)"
                >
                  清除记录
                </button>
              </div>
              <div class="pprogress">
                <div class="progress">
                  <div class="progress-fill" :style="{ width: barPercent(child) + '%' }"></div>
                </div>
              </div>
            </div>
          </template>
          <div v-else class="pempty">暂无子分类</div>
        </div>
      </div>
    </div>

    <CustomComposeModal v-if="composeOpen" @close="composeOpen = false" @started="onComposeStarted" />

    <Modal v-if="clearTarget" title="清除刷题记录" width="28rem" @close="clearTarget = null">
      <div class="clear-body">
        确定要清除「<strong>{{ clearTarget.name }}</strong>」的刷题记录吗？<br />
        清除后该类目下的题目将重新变为未练习状态，方便二刷三刷。此操作不可撤销。
      </div>
      <template #footer>
        <button class="btn" @click="clearTarget = null">取消</button>
        <button class="btn btn-danger" :disabled="clearing" @click="doClear">
          {{ clearing ? '清除中…' : '确认清除' }}
        </button>
      </template>
    </Modal>
  </div>
</template>

<style scoped>
.ptree {
  overflow: hidden;
}
.pnode + .pnode {
  border-top: 1px solid var(--border);
}
.prow {
  display: flex;
  align-items: center;
  gap: 0.8rem;
  padding: 0.8rem 1.1rem;
}
.prow.child {
  padding: 0.7rem 1.1rem 0.3rem 3.2rem;
}
/* 子集块：行 + 进度条整体一个浅色块 */
.pchild {
  background: var(--card-hover);
  border-top: 1px solid var(--border);
}
/* 进度条（已做/未做） */
.pprogress {
  padding: 0.15rem 1.1rem 0.85rem 2.7rem;
}
.pchild .pprogress {
  padding: 0.1rem 1.1rem 0.7rem 3.2rem;
}
.pchild .progress {
  height: 0.4rem;
}
.parrow {
  width: 0;
  height: 0;
  border: 0.4rem solid transparent;
  border-left-color: var(--text-2);
  background: none;
  cursor: pointer;
  transition: transform 0.15s;
  padding: 0;
}
.parrow.open {
  transform: rotate(90deg);
  border-left-color: var(--primary);
}
.pname {
  flex: 1;
  font-weight: 600;
  font-size: 0.98rem;
  cursor: pointer;
}
.child-name {
  font-weight: 400;
  font-size: 0.92rem;
}
.pcount {
  color: var(--text-2);
  font-size: 0.88rem;
  min-width: 5rem;
  text-align: right;
}
.pgo {
  font-weight: 600;
}
.pempty {
  padding: 0.5rem 1.1rem 0.8rem 3.2rem;
  color: var(--text-2);
  font-size: 0.85rem;
}
.pclear {
  font-size: 0.82rem;
  color: var(--text-2);
  white-space: nowrap;
}
.pclear:hover {
  color: var(--danger);
}
.clear-body {
  font-size: 0.92rem;
  line-height: 1.7;
  color: var(--text);
}
</style>
