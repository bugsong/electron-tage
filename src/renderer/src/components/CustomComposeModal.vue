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
const count = ref(10)
const starting = ref(false)

async function load() {
  try {
    tree.value = await api.categoryTree()
    // 默认全部收起，由用户自行展开
  } catch (err) {
    toast.error('加载分类失败：' + (err.message || err))
  }
  try {
    const s = await api.getSettings()
    if (s.practiceCount) {
      const n = Number(s.practiceCount)
      if (Number.isFinite(n) && n >= 5 && n <= 50) count.value = n
    }
  } catch {}
}
onMounted(load)

function saveCount() {
  let n = Number(count.value)
  if (!Number.isFinite(n)) n = 10
  n = Math.min(50, Math.max(5, Math.round(n)))
  count.value = n
  api
    .setSetting('practiceCount', String(n))
    .then(() => toast.success(`题量已更新为 ${n} 题`))
    .catch(() => toast.error('保存失败'))
}

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
    if (r.locked) {
      toast.error(`有进行中的练习「${r.title}」入口在首页右上角！`)
      return
    }
    if (r.done) {
      toast.success(r.message)
      return
    }
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
      <div class="cc-count-input">
        <input type="number" min="5" max="50" v-model.number="count" class="cc-input" />
        <span class="cc-range-hint">5-50 题</span>
        <button class="btn btn-primary cc-save-btn" @click="saveCount">更新</button>
      </div>

      <div class="cc-label">题型</div>
      <div class="cc-type">单选题（单选题型目前够用，其他已在计划中）</div>
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
.cc-count-input {
  display: flex;
  align-items: center;
  gap: 0.6rem;
}
.cc-input {
  width: 5rem;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 0.4rem 0.6rem;
  font-size: 0.9rem;
  font-family: inherit;
  background: var(--card);
  color: var(--text);
}
.cc-input:focus {
  outline: none;
  border-color: var(--primary);
}
.cc-range-hint {
  color: var(--text-2);
  font-size: 0.82rem;
}
.cc-save-btn {
  padding: 0.4rem 1rem;
  font-size: 0.88rem;
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
