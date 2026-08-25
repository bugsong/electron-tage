<script setup>
import { ref, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { api } from '../api'
import CustomComposeModal from '../components/CustomComposeModal.vue'
import { useToastStore } from '../stores/toast'

const route = useRoute()
const router = useRouter()
const toast = useToastStore()

const tree = ref([])
const loading = ref(true)
const expanded = ref(new Set())
const composeOpen = ref(false)

async function load() {
  loading.value = true
  try {
    tree.value = await api.categoryTree()
    // 默认展开第一个一级分类；支持从首页带 ?expand= 展开指定分类
    const expandId = Number(route.query.expand)
    if (expandId) expanded.value.add(expandId)
    else if (tree.value.length) expanded.value.add(tree.value[0].id)
  } catch (err) {
    toast.error('加载分类失败：' + (err.message || err))
  } finally {
    loading.value = false
  }
}
onMounted(load)

function toggleExpand(id) {
  const s = new Set(expanded.value)
  if (s.has(id)) s.delete(id)
  else s.add(id)
  expanded.value = s
}

async function goPractice(categoryId, name) {
  try {
    const r = await api.startPractice({
      type: 'special',
      title: `专项智能练习（${name}）`,
      categoryIds: [categoryId],
      count: 20
    })
    router.push({ path: '/practice/session', query: { sessionId: r.id } })
  } catch (err) {
    toast.error(err.message || '开始练习失败')
  }
}

function onComposeStarted(sessionId) {
  composeOpen.value = false
  router.push({ path: '/practice/session', query: { sessionId } })
}

/** 一级节点展示的子项：政治理论在最前面补一个虚拟「全部」 */
function visibleChildren(node) {
  const subs = [...node.children]
  if (node.name === '政治理论') {
    subs.unshift({
      id: 'all-' + node.id,
      virtual: true,
      parentId: node.id,
      parentName: node.name,
      name: '全部',
      total: node.total,
      done: node.done
    })
  }
  return subs
}
</script>

<template>
  <div class="page">
    <div class="page-header">
      <span class="page-title-tag">专项练习</span>
      <button class="btn btn-text" @click="composeOpen = true">自定义刷题</button>
    </div>

    <div v-if="loading" class="empty">加载中…</div>

    <div v-else-if="!tree.length" class="empty">
      <div class="empty-icon">📂</div>
      <div>还没有任何分类，请先到「题目管理」导入题目</div>
    </div>

    <div v-else class="card ptree">
      <div v-for="node in tree" :key="node.id" class="pnode">
        <div class="prow" :class="{ expanded: expanded.has(node.id) }">
          <button class="parrow" :class="{ open: expanded.has(node.id) }" @click="toggleExpand(node.id)"></button>
          <span class="pname" @click="toggleExpand(node.id)">{{ node.name }}</span>
          <span class="pcount">{{ node.done }}/{{ node.total }}</span>
          <button class="btn btn-text pgo" @click="goPractice(node.id, node.name)">去练习 &gt;</button>
        </div>

        <div v-if="expanded.has(node.id)" class="pchildren">
          <template v-if="visibleChildren(node).length">
            <div v-for="child in visibleChildren(node)" :key="child.id" class="prow child">
              <span class="pname child-name">{{ child.name }}</span>
              <span class="pcount">{{ child.done }}/{{ child.total }}</span>
              <button
                class="btn btn-text pgo"
                @click="goPractice(child.virtual ? child.parentId : child.id, child.virtual ? child.parentName : child.name)"
              >
                去练习 &gt;
              </button>
            </div>
          </template>
          <div v-else class="pempty">暂无子分类</div>
        </div>
      </div>
    </div>

    <CustomComposeModal v-if="composeOpen" @close="composeOpen = false" @started="onComposeStarted" />
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
  padding-left: 3.2rem;
  background: var(--card-hover);
  border-top: 1px solid var(--border);
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
</style>
