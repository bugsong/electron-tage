<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { api } from '../api'
import Modal from './Modal.vue'
import { sanitizeHtml } from '../utils/sanitize'
import { useToastStore } from '../stores/toast'

const props = defineProps({
  questionId: { type: [Number, String], required: true },
  title: { type: String, default: '随题笔记' }
})
const emit = defineEmits(['close'])
const toast = useToastStore()

const editorRef = ref(null)
const savedAt = ref('')
let debounceTimer = null

function sanitizeContent() {
  return sanitizeHtml(editorRef.value ? editorRef.value.innerHTML : '')
}

async function save() {
  clearTimeout(debounceTimer)
  try {
    await api.saveNote(props.questionId, sanitizeContent())
    const d = new Date()
    const pad = (n) => String(n).padStart(2, '0')
    savedAt.value = `已保存 ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  } catch (err) {
    toast.error('笔记保存失败：' + (err.message || err))
  }
}

function onInput() {
  clearTimeout(debounceTimer)
  debounceTimer = setTimeout(save, 800)
}

function exec(cmd, arg) {
  editorRef.value.focus()
  document.execCommand(cmd, false, arg)
  onInput()
}

function onPaste(e) {
  e.preventDefault()
  const text = e.clipboardData.getData('text/plain')
  document.execCommand('insertText', false, text)
  onInput()
}

onMounted(async () => {
  try {
    const note = await api.getNote(props.questionId)
    if (note && note.content) editorRef.value.innerHTML = note.content
  } catch {
    /* 无笔记则空白开始 */
  }
  editorRef.value.focus()
})

onBeforeUnmount(() => clearTimeout(debounceTimer))
</script>

<template>
  <Modal :title="title" width="44rem" @close="emit('close')">
    <div class="note-editor">
      <div class="note-toolbar">
        <button class="nb" title="加粗" @click="exec('bold')"><b>B</b></button>
        <button class="nb" title="斜体" @click="exec('italic')"><i>I</i></button>
        <button class="nb" title="下划线" @click="exec('underline')"><u>U</u></button>
        <button class="nb" title="删除线" @click="exec('strikeThrough')"><s>S</s></button>
        <span class="sep"></span>
        <button class="nb" title="标题" @click="exec('formatBlock', 'h2')">H2</button>
        <button class="nb" title="无序列表" @click="exec('insertUnorderedList')">• 列表</button>
        <button class="nb" title="有序列表" @click="exec('insertOrderedList')">1. 列表</button>
        <button class="nb" title="引用" @click="exec('formatBlock', 'blockquote')">❝ 引用</button>
        <span class="sep"></span>
        <button class="nb" title="清除格式" @click="exec('removeFormat')">清除格式</button>
      </div>
      <div
        ref="editorRef"
        class="note-content"
        contenteditable="true"
        data-placeholder="在这里写下这道题的笔记…"
        @input="onInput"
        @paste="onPaste"
      ></div>
      <div class="note-foot">
        <span v-if="savedAt" class="note-saved">{{ savedAt }}</span>
        <span class="note-tip">修改后自动保存</span>
      </div>
    </div>
  </Modal>
</template>

<style scoped>
.note-editor {
  display: flex;
  flex-direction: column;
}
.note-toolbar {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  padding-bottom: 0.6rem;
  border-bottom: 1px solid var(--border);
  flex-wrap: wrap;
}
.nb {
  min-width: 2rem;
  height: 1.9rem;
  border: none;
  background: transparent;
  color: var(--text-2);
  border-radius: 6px;
  cursor: pointer;
  font-size: 0.85rem;
  padding: 0 0.5rem;
  font-family: inherit;
}
.nb:hover {
  background: var(--primary-weak);
  color: var(--primary);
}
.sep {
  width: 1px;
  height: 1.2rem;
  background: var(--border);
  margin: 0 0.3rem;
}
.note-content {
  min-height: 300px;
  max-height: 46vh;
  overflow-y: auto;
  padding: 0.9rem 0.2rem;
  outline: none;
  line-height: 1.9;
  user-select: text;
}
.note-content:empty::before {
  content: attr(data-placeholder);
  color: var(--text-2);
  opacity: 0.6;
}
.note-content :deep(h2) {
  font-size: 1.15rem;
  margin: 0.6rem 0 0.3rem;
}
.note-content :deep(blockquote) {
  margin: 0.5rem 0;
  padding: 0.3rem 0.8rem;
  border-left: 3px solid var(--primary);
  background: var(--primary-weak);
  border-radius: 0 6px 6px 0;
  color: var(--text-2);
}
.note-foot {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 0.8rem;
  padding-top: 0.5rem;
  border-top: 1px solid var(--border);
  font-size: 0.8rem;
}
.note-saved {
  color: var(--success);
}
.note-tip {
  color: var(--text-2);
}
</style>
