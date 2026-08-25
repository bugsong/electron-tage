<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import { api } from '../api'
import Modal from './Modal.vue'
import PaperCanvas, { clearSessionDrafts } from './PaperCanvas.vue'
import InlineNoteEditor from './InlineNoteEditor.vue'
import { sanitizeHtml } from '../utils/sanitize'
import { plainText } from '../utils/format'

const props = defineProps({
  question: { type: Object, required: true },
  myAnswer: { type: String, default: null },
  correct: { type: Boolean, default: null },
  showRemove: { type: Boolean, default: false },
  showNote: { type: Boolean, default: true }
})
const emit = defineEmits(['close', 'remove'])

const LETTERS = ['A', 'B', 'C', 'D']
const paperOpen = ref(false)
const noteOpen = ref(false)
const noteContent = ref('')

const safeStem = computed(() => sanitizeHtml(props.question.stem))
// 选项未填写时也保留 A/B/C/D 四个槽，保证可作答与字母对应
const safeOptions = computed(() => {
  const arr = props.question.options || []
  return LETTERS.map((letter, i) => ({ letter, text: sanitizeHtml(arr[i] || '') }))
})
const safeAnalysis = computed(() => sanitizeHtml(props.question.analysis || ''))

async function loadNote() {
  if (!props.showNote) return
  try {
    const n = await api.getNote(props.question.id)
    noteContent.value = n ? sanitizeHtml(n.content) : ''
  } catch {
    noteContent.value = ''
  }
}

onMounted(loadNote)

// 关闭内联笔记编辑区时刷新只读展示
watch(noteOpen, (v) => {
  if (!v) loadNote()
})

function optionClass(letter) {
  const cls = []
  if (props.myAnswer != null) {
    if (props.question.answer === letter) cls.push('is-correct')
    if (props.myAnswer === letter && props.myAnswer !== props.question.answer) cls.push('is-wrong')
  }
  return cls
}

// 关闭弹窗前清除本次查看的临时笔迹（普通版内存），与回看/练习界面保持同一套草纸清理逻辑；
// 进阶版笔迹在库中不受影响，下次打开仍可恢复
function close() {
  clearSessionDrafts('detail:' + props.question.id)
  emit('close')
}
</script>

<template>
  <Modal title="题目详情" width="80%" @close="close">
    <div class="d-question">
      <div class="d-meta">
        <span class="tag tag-primary">单选题</span>
        <span v-if="question.categoryName" class="tag tag-gray">{{ question.categoryName }}</span>
        <span v-if="myAnswer != null" class="tag" :class="correct ? 'tag-success' : 'tag-danger'">
          {{ correct ? '答对' : '答错' }}
        </span>
      </div>
      <div class="d-stem" v-html="safeStem"></div>
      <div class="d-options">
        <div v-for="opt in safeOptions" :key="opt.letter" class="d-option" :class="optionClass(opt.letter)">
          <span class="d-letter">{{ opt.letter }}</span>
          <span v-html="opt.text"></span>
        </div>
        <div v-if="!safeOptions.length" class="d-options-empty">选项见题干</div>
      </div>
      <div v-if="myAnswer != null" class="d-answer-line">
        我的答案：<b>{{ myAnswer }}</b>
        <span v-if="myAnswer !== question.answer">　正确答案：<b class="ok">{{ question.answer }}</b></span>
        <span v-else>　回答正确</span>
      </div>
      <div v-if="question.analysis" class="d-analysis">
        <div class="d-analysis-title">解析</div>
        <div v-html="safeAnalysis"></div>
      </div>
      <div v-if="showNote && noteContent" class="d-note">
        <div class="d-analysis-title">我的笔记</div>
        <div class="d-note-body" v-html="noteContent"></div>
      </div>
      <!-- 内联笔记编辑区：由「笔记」按钮控制显隐 -->
      <InlineNoteEditor v-if="noteOpen" :question-id="question.id" />
    </div>

    <template #footer>
      <button class="btn" @click="paperOpen = true">草纸</button>
      <button class="btn" :class="{ active: noteOpen }" @click="noteOpen = !noteOpen">笔记</button>
      <button v-if="showRemove" class="btn btn-danger" @click="emit('remove')">移出错题本</button>
      <button class="btn btn-primary" @click="close">关闭</button>
    </template>

    <PaperCanvas
      v-if="paperOpen"
      :open="true"
      :question-id="question.id"
      :scope="'detail:' + question.id"
      :question-no="question.no || ''"
      @close="paperOpen = false"
    />
  </Modal>
</template>

<style scoped>
.d-question {
  line-height: 1.85;
}
.d-meta {
  display: flex;
  gap: 0.5rem;
  margin-bottom: 0.7rem;
}
.d-stem {
  font-size: 1rem;
  margin-bottom: 0.9rem;
  word-break: break-word;
}
.d-stem :deep(img),
.d-options :deep(img),
.d-analysis :deep(img),
.d-note-body :deep(img) {
  max-width: 100%;
  height: auto;
  display: block;
  margin: 0.3rem auto;
}
.d-options {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  margin-bottom: 0.8rem;
}
.d-option {
  display: flex;
  gap: 0.6rem;
  padding: 0.5rem 0.8rem;
  border: 1px solid var(--border);
  border-radius: 9px;
}
.d-option.is-correct {
  border-color: var(--success);
  background: var(--success-weak);
}
.d-option.is-wrong {
  border-color: var(--danger);
  background: var(--danger-weak);
}
.d-letter {
  font-weight: 700;
  color: var(--text-2);
  flex-shrink: 0;
}
.d-options-empty {
  padding: 0.4rem 0.2rem;
  color: var(--text-2);
  font-size: 0.88rem;
}
.d-answer-line {
  font-size: 0.95rem;
  margin-bottom: 0.8rem;
}
.ok {
  color: var(--success);
}
.d-analysis {
  background: var(--card-hover);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 0.8rem 1rem;
  font-size: 0.92rem;
  margin-bottom: 0.8rem;
}
.d-analysis-title {
  font-weight: 700;
  margin-bottom: 0.3rem;
  color: var(--primary);
}
.d-note {
  background: var(--primary-weak);
  border-radius: 10px;
  padding: 0.8rem 1rem;
  font-size: 0.92rem;
}
.d-note-body {
  word-break: break-word;
  max-height: 180px;
  overflow-y: auto;
}
.d-note-body :deep(h2) {
  font-size: 1.05rem;
  margin: 0.4rem 0 0.2rem;
}
.d-note-body :deep(blockquote) {
  margin: 0.4rem 0;
  padding: 0.2rem 0.7rem;
  border-left: 3px solid var(--primary);
}
</style>
