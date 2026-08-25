<script setup>
import { ref, computed, onMounted } from 'vue'
import { api } from '../api'
import Modal from './Modal.vue'
import { useToastStore } from '../stores/toast'

const emit = defineEmits(['close', 'started'])
const toast = useToastStore()

const tree = ref([])
const expanded = ref(new Set())
const selected = ref(new Set())
const count = ref(20)
const starting = ref(false)

const COUNT_OPTIONS = [10, 20, 30, 50]

async function load() {
  try {
    tree.value = await api.categoryTree()
    // 默认展开第一个一级分类（政治理论）
    if (tree.value.length) expanded.value.add(tree.value[0].id)
  } catch (err) {
    toast.error('加载分类失败：' + (err.message || err))
  }
}
onMounted(load)

function toggleExpand(id) {
  const s = new Set(expanded.value)
  if (s.has(id)) s.delete(id)
  else s.add(id)
  expanded.value = s
}

function toggle(id) {
  const s = new Set(selected.value)
  if (s.has(id)) s.delete(id)
  else s.add(id)
  selected.value = s
}

const selectedCount = computed(() => selected.value.size)

async function start() {
  if (!selected.value.size) {
    toast.error('请至少勾选一个分类')
    return
  }
  starting.value = true
  try {
    const r = await api.startPractice({
      type: 'custom',
      title: '自定义组卷',
      categoryIds: [...selected.value],
      count: count.value
    })
    emit('started', r.id)
  } catch (err) {
    toast.error(err.message || '组卷失败')
  } finally {
    starting.value = false
  }
}
</script>

<template>
  <Modal title="自定义刷题" width="34rem" @close="emit('close')">
    <div class="cc">
      <div class="cc-label">选择分类</div>
      <div class="cc-tree">
        <div v-for="node in tree" :key="node.id" class="cc-group">
          <div class="cc-row">
            <input
              type="checkbox"
              class="cc-check"
              :checked="selected.has(node.id)"
              @change="toggle(node.id)"
            />
            <button class="cc-arrow" :class="{ open: expanded.has(node.id) }" @click="toggleExpand(node.id)"></button>
            <span class="cc-name">{{ node.name }}</span>
            <span class="cc-count">{{ node.done }}/{{ node.total }}</span>
          </div>
          <div v-if="expanded.has(node.id) && node.children.length" class="cc-children">
            <div v-for="child in node.children" :key="child.id" class="cc-row child">
              <input
                type="checkbox"
                class="cc-check"
                :checked="selected.has(child.id)"
                @change="toggle(child.id)"
              />
              <span class="cc-name">{{ child.name }}</span>
              <span class="cc-count">{{ child.done }}/{{ child.total }}</span>
            </div>
          </div>
        </div>
      </div>

      <div class="cc-label">题量</div>
      <div class="cc-counts">
        <button
          v-for="c in COUNT_OPTIONS"
          :key="c"
          class="cc-count-btn"
          :class="{ active: count === c }"
          @click="count = c"
        >
          {{ c }} 题
        </button>
      </div>

      <div class="cc-label">题型</div>
      <div class="cc-type">单选题（第一版仅支持单选）</div>
    </div>

    <template #footer>
      <span class="cc-selected">已选 {{ selectedCount }} 个分类</span>
      <button class="btn" @click="emit('close')">取消</button>
      <button class="btn btn-primary" :disabled="starting" @click="start">
        {{ starting ? '组卷中…' : '开始练习' }}
      </button>
    </template>
  </Modal>
</template>

<style scoped>
.cc-label {
  font-weight: 700;
  font-size: 0.9rem;
  margin: 0.9rem 0 0.4rem;
}
.cc-tree {
  border: 1px solid var(--border);
  border-radius: 10px;
  max-height: 300px;
  overflow-y: auto;
  padding: 0.3rem 0;
}
.cc-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.42rem 0.7rem;
}
.cc-row:hover {
  background: var(--card-hover);
}
.cc-row.child {
  padding-left: 2.4rem;
}
.cc-check {
  width: 1rem;
  height: 1rem;
  accent-color: var(--primary);
  cursor: pointer;
}
.cc-arrow {
  width: 0;
  height: 0;
  border: 0.38rem solid transparent;
  border-left-color: var(--text-2);
  background: none;
  cursor: pointer;
  transition: transform 0.15s;
  margin-right: 0.2rem;
}
.cc-arrow.open {
  transform: rotate(90deg);
  border-left-color: var(--primary);
}
.cc-name {
  flex: 1;
  font-size: 0.92rem;
}
.cc-count {
  color: var(--text-2);
  font-size: 0.82rem;
}
.cc-counts {
  display: flex;
  gap: 0.6rem;
}
.cc-count-btn {
  border: 1px solid var(--border);
  background: var(--card);
  color: var(--text);
  border-radius: 8px;
  padding: 0.4rem 0.9rem;
  cursor: pointer;
  font-size: 0.9rem;
  font-family: inherit;
}
.cc-count-btn.active {
  border-color: var(--primary);
  background: var(--primary-weak);
  color: var(--primary);
  font-weight: 600;
}
.cc-type {
  font-size: 0.9rem;
  color: var(--text-2);
}
.cc-selected {
  margin-right: auto;
  color: var(--text-2);
  font-size: 0.85rem;
}
</style>
