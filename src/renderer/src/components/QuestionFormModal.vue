<script setup>
import { ref, computed, watch, onMounted } from 'vue'
import { api } from '../api'
import Modal from './Modal.vue'
import { sanitizeHtml } from '../utils/sanitize'
import { useToastStore } from '../stores/toast'

const props = defineProps({
  question: { type: Object, default: null },
  tree: { type: Array, default: () => [] }
})
const emit = defineEmits(['close', 'saved'])

const toast = useToastStore()
const saving = ref(false)

const topId = ref('')
const childId = ref('')
const stem = ref('')
const options = ref(['', '', '', ''])
const answer = ref('A')
const analysis = ref('')

const children = computed(() => {
  const top = props.tree.find((n) => n.id === Number(topId.value))
  return top ? top.children : []
})

watch(topId, () => {
  childId.value = ''
})

onMounted(() => {
  if (props.question) {
    const q = props.question
    const top = props.tree.find((n) => n.id === q.categoryId) || props.tree.find((n) => n.children.some((c) => c.id === q.categoryId))
    if (top) {
      topId.value = String(top.id)
      const child = top.children.find((c) => c.id === q.categoryId)
      if (child) childId.value = String(child.id)
    }
    stem.value = q.stem
    options.value = [...(q.options || [])]
    answer.value = q.answer
    analysis.value = q.analysis || ''
  } else if (props.tree.length) {
    topId.value = String(props.tree[0].id)
  }
})

async function save() {
  const categoryId = childId.value ? Number(childId.value) : Number(topId.value)
  if (!categoryId) {
    toast.error('请选择分类')
    return
  }
  const cleanStem = sanitizeHtml(stem.value.trim())
  if (!cleanStem) {
    toast.error('题干不能为空')
    return
  }
  const opts = options.value.map((o) => o.trim())
  saving.value = true
  try {
    await api.saveQuestion({
      id: props.question ? props.question.id : null,
      categoryId,
      stem: cleanStem,
      options: opts,
      answer: answer.value,
      analysis: sanitizeHtml(analysis.value)
    })
    toast.success(props.question ? '已保存修改' : '已新增题目')
    emit('saved')
  } catch (err) {
    toast.error(err.message || '保存失败')
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <Modal :title="question ? '编辑题目' : '新增题目'" width="40rem" @close="emit('close')">
    <div class="qf">
      <div class="qf-row">
        <label class="qf-label">分类</label>
        <select v-model="topId" class="select">
          <option v-for="n in tree" :key="n.id" :value="String(n.id)">{{ n.name }}</option>
        </select>
        <select v-if="children.length" v-model="childId" class="select">
          <option value="">（不选子分类）</option>
          <option v-for="c in children" :key="c.id" :value="String(c.id)">{{ c.name }}</option>
        </select>
      </div>

      <div class="qf-row">
        <label class="qf-label">题干</label>
        <textarea v-model="stem" class="textarea" rows="4" placeholder="输入题干…"></textarea>
      </div>

      <div class="qf-options">
        <div v-for="(opt, i) in options" :key="i" class="qf-opt">
          <span class="qf-letter">{{ 'ABCD'[i] }}</span>
          <input v-model="options[i]" class="input" :placeholder="`选项 ${'ABCD'[i]}（可留空）…`" />
        </div>
        <div class="qf-opt-tip">选项可留空，截图已包含选项时无需重复填写</div>
      </div>

      <div class="qf-row">
        <label class="qf-label">正确答案</label>
        <select v-model="answer" class="select qf-answer">
          <option value="A">A</option>
          <option value="B">B</option>
          <option value="C">C</option>
          <option value="D">D</option>
        </select>
      </div>

      <div class="qf-row">
        <label class="qf-label">解析</label>
        <textarea v-model="analysis" class="textarea" rows="3" placeholder="答案解析（可选）…"></textarea>
      </div>
    </div>

    <template #footer>
      <button class="btn" @click="emit('close')">取消</button>
      <button class="btn btn-primary" :disabled="saving" @click="save">
        {{ saving ? '保存中…' : '保存' }}
      </button>
    </template>
  </Modal>
</template>

<style scoped>
.qf {
  display: flex;
  flex-direction: column;
  gap: 0.9rem;
}
.qf-row {
  display: flex;
  align-items: flex-start;
  gap: 0.7rem;
}
.qf-label {
  width: 4.2rem;
  flex-shrink: 0;
  font-weight: 600;
  font-size: 0.9rem;
  padding-top: 0.45rem;
}
.qf-row .select:first-of-type {
  width: 10rem;
}
.qf-options {
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
}
.qf-opt {
  display: flex;
  align-items: center;
  gap: 0.6rem;
}
.qf-letter {
  font-weight: 700;
  color: var(--text-2);
  width: 1.2rem;
  text-align: center;
}
.qf-opt-tip {
  font-size: 0.8rem;
  color: var(--text-2);
  padding-left: 1.8rem;
}
.qf-answer {
  width: 5rem;
}
</style>
