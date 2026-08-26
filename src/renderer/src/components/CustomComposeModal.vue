<script setup>
import { ref, computed, onMounted } from 'vue'
import { api } from '../api'
import Modal from './Modal.vue'
import { useAdvancedStore } from '../stores/advanced'
import { useToastStore } from '../stores/toast'

const emit = defineEmits(['close', 'started'])
const toast = useToastStore()
const adv = useAdvancedStore()

const tree = ref([])
const expanded = ref(new Set())
const selected = ref(new Set())
const count = ref(10)
const starting = ref(false)
const timerChoice = ref(null)
const timerLimitMin = ref(0)

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
  try {
    await adv.load()
  } catch {}
}
onMounted(load)

function onLimitInput() {
  const n = Number(timerLimitMin.value)
  if (!Number.isFinite(n)) {
    timerLimitMin.value = Math.min(180, Math.max(1, (timerChoice.value && timerChoice.value.count || 10) * 2))
    return
  }
  if (n < 1) {
    toast.error('倒计时不能少于 1 分钟')
    timerLimitMin.value = 1
  } else if (n > 180) {
    toast.error('倒计时不能超过 180 分钟')
    timerLimitMin.value = 180
  }
}

function cancelTimerChoice() {
  if (timerChoice.value) {
    api.abandonPractice(timerChoice.value.sessionId).catch(() => {})
    timerChoice.value = null
  }
}

function chooseForward() {
  const sid = timerChoice.value.sessionId
  timerChoice.value = null
  emit('started', sid)
}

async function chooseCountdown() {
  const sid = timerChoice.value.sessionId
  const limitMin = timerLimitMin.value
  timerChoice.value = null
  try {
    await api.updatePracticeTimer(sid, 'countdown', limitMin * 60 * 1000)
  } catch {}
  emit('started', sid)
}

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
    if (adv.isOn('countdown')) {
      timerChoice.value = { sessionId: r.id, count: r.total }
      timerLimitMin.value = Math.min(180, Math.max(1, r.total * 2))
    } else {
      emit('started', r.id)
    }
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

  <Modal v-if="timerChoice" title="选择计时模式" width="30rem" @close="cancelTimerChoice">
    <div class="tc-body">
      <p class="tc-info">
        本次抽取「<strong>{{ timerChoice.count }}</strong>」道题，限定倒计时：
        <input type="number" min="1" max="180" v-model.number="timerLimitMin" @change="onLimitInput" class="tc-limit-input" />
        分钟
      </p>
      <p class="tc-warn">请注意：倒计时模式不允许暂停！</p>
    </div>
    <template #footer>
      <button class="btn" @click="cancelTimerChoice">取消</button>
      <button class="btn" @click="chooseForward">正计时</button>
      <button class="btn btn-primary" @click="chooseCountdown">倒计时</button>
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
.tc-body {
  font-size: 0.92rem;
  line-height: 1.8;
}
.tc-info {
  margin: 0 0 0.5rem;
}
.tc-limit-input {
  width: 4.5rem;
  border: 1px solid var(--danger);
  color: var(--danger);
  font-weight: 700;
  font-size: 1.05rem;
  border-radius: 6px;
  padding: 0.15rem 0.4rem;
  text-align: center;
  background: var(--card);
  font-family: inherit;
}
.tc-limit-input:focus {
  outline: none;
  box-shadow: 0 0 0 2px var(--danger-weak);
}
.tc-warn {
  color: var(--text-2);
  font-size: 0.82rem;
  margin: 0;
}
</style>
