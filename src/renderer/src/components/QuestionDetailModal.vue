<script setup>
import { ref, computed, onMounted } from 'vue'
import { api } from '../api'
import Modal from './Modal.vue'
import PaperCanvas from './PaperCanvas.vue'
import NoteEditorModal from './NoteEditorModal.vue'
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
// 过滤空选项：截图已包含选项时可不填写；保留字母对应关系避免索引错位
const safeOptions = computed(() =>
  (props.question.options || [])
    .map((o, i) => ({ letter: LETTERS[i], text: sanitizeHtml(o) }))
    .filter((o) => o.text.trim())
)
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

function optionClass(letter) {
  const cls = []
  if (props.myAnswer != null) {
    if (props.question.answer === letter) cls.push('is-correct')
    if (props.myAnswer === letter && props.myAnswer !== props.question.answer) cls.push('is-wrong')
  }
  return cls
}
</script>

<template>
  <Modal title="题目详情" width="40rem" @close="emit('close')">
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
    </div>

    <template #footer>
      <button class="btn" @click="paperOpen = true">草纸</button>
      <button class="btn" @click="noteOpen = true">笔记</button>
      <button v-if="showRemove" class="btn btn-danger" @click="emit('remove')">移出错题本</button>
      <button class="btn btn-primary" @click="emit('close')">关闭</button>
    </template>

    <PaperCanvas
      v-if="paperOpen"
      :question-id="question.id"
      :question-no="question.no || ''"
      @close="paperOpen = false"
    />
    <NoteEditorModal
      v-if="noteOpen"
      :question-id="question.id"
      @close="noteOpen = false; loadNote()"
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
