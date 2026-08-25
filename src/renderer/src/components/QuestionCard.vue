<script setup>
import { computed, ref, watch } from 'vue'
import { sanitizeHtml } from '../utils/sanitize'
import PaperCanvas, { clearSessionDrafts } from './PaperCanvas.vue'
import InlineNoteEditor from './InlineNoteEditor.vue'

const props = defineProps({
  question: { type: Object, required: true },
  index: { type: Number, default: 1 },
  answer: { type: String, default: null },
  isFavorite: { type: Boolean, default: false },
  sessionType: { type: String, default: 'special' },
  showResult: { type: Boolean, default: false },
  isCorrect: { type: Boolean, default: null },
  wrongRemoved: { type: Boolean, default: false },
  // 草纸会话内草稿作用域（普通版不落库，交卷后清除）
  paperScope: { type: String, default: '' }
})

const emit = defineEmits(['select', 'favorite', 'remove-wrong'])

const LETTERS = ['A', 'B', 'C', 'D']
const paperOpen = ref(false)
const noteOpen = ref(false)

// 切换题目（回看页上一题/下一题复用同一实例）时，自动关闭草纸与笔记覆层，避免带到下一题；
// 同时清除本次视图 scope 内的临时笔迹（普通版内存缓存），使重新打开的草纸为空白。
// 该 watch 只在单实例复用场景触发（练习页每题独立实例、question 不变），进阶版笔迹在库中不受影响。
watch(
  () => props.question.id,
  () => {
    paperOpen.value = false
    noteOpen.value = false
    if (props.paperScope) clearSessionDrafts(props.paperScope)
  }
)

const safeStem = computed(() => sanitizeHtml(props.question.stem))
// 选项未填写时也保留 A/B/C/D 四个槽，保证可作答与字母对应
const safeOptions = computed(() => {
  const arr = props.question.options || []
  return LETTERS.map((letter, i) => ({ letter, text: sanitizeHtml(arr[i] || '') }))
})

function onPick(letter) {
  if (props.showResult || paperOpen.value) return
  emit('select', letter)
}

function optionClass(letter) {
  const cls = []
  if (props.showResult) {
    if (props.question.answer === letter) cls.push('is-correct')
    if (props.answer === letter && props.answer !== props.question.answer) cls.push('is-wrong')
  } else if (props.answer === letter) {
    cls.push('checked')
  }
  return cls
}

function togglePaper() {
  paperOpen.value = !paperOpen.value
}
</script>

<template>
  <div class="card q-card" :class="{ 'q-card-wrong': showResult && isCorrect === false, 'paper-active': paperOpen }">
    <PaperCanvas
      v-if="paperOpen"
      :question-id="question.id"
      :scope="paperScope"
      :open="paperOpen"
      @close="paperOpen = false"
    />

    <div class="q-head">
      <span class="q-no">{{ index }}</span>
      <span class="tag tag-primary">单选题</span>
      <span v-if="showResult" class="tag" :class="isCorrect ? 'tag-success' : 'tag-danger'">
        {{ isCorrect ? '答对' : '答错' }}
      </span>
      <div class="q-head-right">
        <button class="icon-btn" :class="{ active: paperOpen }" title="草纸" @click="togglePaper">
          <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
          </svg>
        </button>
        <button class="icon-btn" :class="{ active: noteOpen }" title="随题笔记" @click="noteOpen = !noteOpen">
          <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <path d="M14 2v6h6" />
            <path d="M8 13h8M8 17h5" />
          </svg>
        </button>
        <button class="icon-btn" :class="{ active: isFavorite }" title="收藏" @click="emit('favorite')">
          <svg viewBox="0 0 24 24" width="17" height="17" :fill="isFavorite ? 'currentColor' : 'none'" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <path d="m12 2 3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01z" />
          </svg>
        </button>
        <button
          v-if="sessionType === 'wrong_review' && !showResult"
          class="icon-btn remove-wrong"
          :class="{ removed: wrongRemoved }"
          :title="wrongRemoved ? '已移出错题本' : '移出错题本'"
          :disabled="wrongRemoved"
          @click="emit('remove-wrong')"
        >
          <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <path d="M3 6h18" />
            <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
            <path d="M10 11v6M14 11v6" />
          </svg>
        </button>
      </div>
    </div>

    <div class="q-stem" v-html="safeStem"></div>

    <div class="q-options">
      <div
        v-for="opt in safeOptions"
        :key="opt.letter"
        class="q-option"
        :class="optionClass(opt.letter)"
        @click="onPick(opt.letter)"
      >
        <span class="q-radio" :class="{ checked: !showResult && answer === opt.letter }"></span>
        <span class="q-letter">{{ opt.letter }}</span>
        <span class="q-option-text" v-html="opt.text"></span>
        <span v-if="showResult && question.answer === opt.letter" class="q-mark">✓</span>
        <span v-else-if="showResult && answer === opt.letter && answer !== question.answer" class="q-mark wrong">✕</span>
      </div>
      <div v-if="!safeOptions.length" class="q-options-empty">选项见题干</div>
    </div>

    <!-- 随题笔记：按钮控制下方富文本笔记区域的显隐 -->
    <div v-if="noteOpen" class="q-note">
      <InlineNoteEditor :question-id="question.id" />
    </div>
  </div>
</template>

<style scoped>
.q-card {
  position: relative;
  padding: 1.1rem 1.3rem;
  margin-bottom: 1rem;
}
.q-card-wrong {
  border-color: var(--danger);
}
.q-head {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  margin-bottom: 0.7rem;
}
.q-no {
  font-weight: 700;
  color: var(--text);
  min-width: 1.4rem;
}
.q-head-right {
  margin-left: auto;
  display: flex;
  gap: 0.1rem;
}
.icon-btn.active {
  color: var(--primary);
  background: var(--primary-weak);
}
.remove-wrong:hover {
  color: var(--danger);
  background: var(--danger-weak);
}
.remove-wrong.removed {
  color: var(--success);
  background: var(--success-weak);
  opacity: 0.8;
}
.remove-wrong:disabled {
  cursor: default;
}
.q-stem {
  font-size: 1rem;
  line-height: 1.85;
  margin-bottom: 0.9rem;
  word-break: break-word;
}
.q-stem :deep(img),
.q-option-text :deep(img) {
  max-width: 100%;
  height: auto;
  display: block;
  margin: 0.3rem auto;
}
.q-options {
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
}
.q-option {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  padding: 0.55rem 0.85rem;
  border: 1px solid var(--border);
  border-radius: 10px;
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s;
}
.q-option:hover {
  border-color: var(--primary);
  background: var(--card-hover);
}
.q-option.checked {
  border-color: var(--primary);
  background: var(--primary-weak);
}
.q-option.is-correct {
  border-color: var(--success);
  background: var(--success-weak);
}
.q-option.is-wrong {
  border-color: var(--danger);
  background: var(--danger-weak);
}
.q-radio {
  width: 1.05rem;
  height: 1.05rem;
  flex-shrink: 0;
  border: 2px solid var(--text-2);
  border-radius: 50%;
  position: relative;
  transition: border-color 0.15s;
}
.q-radio.checked {
  border-color: var(--primary);
}
.q-radio.checked::after {
  content: '';
  position: absolute;
  inset: 0.18rem;
  border-radius: 50%;
  background: var(--primary);
}
.q-letter {
  font-weight: 700;
  color: var(--text-2);
  min-width: 1rem;
}
.q-option.checked .q-letter {
  color: var(--primary);
}
.q-option-text {
  flex: 1;
  word-break: break-word;
}
.q-options-empty {
  padding: 0.6rem 0.2rem;
  color: var(--text-2);
  font-size: 0.88rem;
}
/* 随题笔记内联区域 */
.q-note {
  margin-top: 0.9rem;
  padding: 0.8rem 0.9rem 0.5rem;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--card-hover);
}
.q-mark {
  color: var(--success);
  font-weight: 700;
}
.q-mark.wrong {
  color: var(--danger);
}
</style>
