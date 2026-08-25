<script setup>
import { ref, onMounted, onBeforeUnmount, nextTick, watch, toRaw } from 'vue'
import { api } from '../api'
import { useToastStore } from '../stores/toast'

const props = defineProps({
  questionId: { type: [Number, String], required: true },
  open: { type: Boolean, default: false }
})
const emit = defineEmits(['close'])
const toast = useToastStore()

const canvasRef = ref(null)
const strokes = ref([])
const redoStack = ref([])
const tool = ref('pen')
const drawing = ref(null)
const saved = ref(false)

const INK = '#20242c'
const ERASER_BG = 'rgba(255,255,255,0.95)'
const PEN_WIDTH = 3
const ERASER_WIDTH = 26

let ro = null
let savedTimer = null

function ctx() {
  return canvasRef.value.getContext('2d')
}

function pos(e) {
  const rect = canvasRef.value.getBoundingClientRect()
  return { x: e.clientX - rect.left, y: e.clientY - rect.top }
}

function drawStroke(c, s) {
  if (!s || !Array.isArray(s.points) || s.points.length < 2) return
  c.strokeStyle = s.tool === 'eraser' ? ERASER_BG : s.color || INK
  c.lineWidth = s.lineWidth || PEN_WIDTH
  c.beginPath()
  c.moveTo(s.points[0].x, s.points[0].y)
  for (let i = 1; i < s.points.length; i++) c.lineTo(s.points[i].x, s.points[i].y)
  c.stroke()
}

function redraw() {
  const canvas = canvasRef.value
  if (!canvas) return
  const c = ctx()
  const dpr = window.devicePixelRatio || 1
  c.setTransform(dpr, 0, 0, dpr, 0, 0)
  c.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight)
  c.lineCap = 'round'
  c.lineJoin = 'round'
  for (const s of strokes.value) drawStroke(c, s)
  if (drawing.value) drawStroke(c, drawing.value)
}

function resize() {
  const canvas = canvasRef.value
  if (!canvas || !canvas.clientWidth) return
  const dpr = window.devicePixelRatio || 1
  const w = canvas.clientWidth
  const h = canvas.clientHeight
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr)
    canvas.height = Math.round(h * dpr)
  }
  redraw()
}

/* ---- 绘制事件 ---- */

function onDown(e) {
  if (e.button !== 0) return
  drawing.value = {
    tool: tool.value,
    points: [pos(e)],
    lineWidth: tool.value === 'eraser' ? ERASER_WIDTH : PEN_WIDTH,
    color: INK
  }
}

function onMove(e) {
  if (!drawing.value) return
  const p = pos(e)
  const last = drawing.value.points[drawing.value.points.length - 1]
  if (last && Math.abs(p.x - last.x) < 1.5 && Math.abs(p.y - last.y) < 1.5) return
  drawing.value.points.push(p)
  redraw()
}

async function onUp() {
  if (!drawing.value) return
  if (drawing.value.points.length >= 2) {
    strokes.value.push(drawing.value)
    redoStack.value = []
    await persist()
  }
  drawing.value = null
}

/* ---- 工具操作 ---- */

function cloneForIPC(arr) {
  // 将 Vue 响应式代理转换为普通对象，避免 IPC 克隆错误
  return JSON.parse(JSON.stringify(toRaw(arr)))
}

async function persist() {
  try {
    await api.saveDraft(props.questionId, cloneForIPC(strokes.value))
    saved.value = true
    clearTimeout(savedTimer)
    savedTimer = setTimeout(() => (saved.value = false), 1500)
  } catch (err) {
    toast.error('草稿保存失败：' + (err.message || err))
  }
}

async function undo() {
  if (!strokes.value.length) return
  redoStack.value.push(strokes.value.pop())
  redraw()
  await persist()
}

async function redo() {
  if (!redoStack.value.length) return
  strokes.value.push(redoStack.value.pop())
  redraw()
  await persist()
}

function clear() {
  if (!strokes.value.length) return
  if (!window.confirm('确定清空当前题目的全部草稿笔迹？')) return
  strokes.value = []
  redoStack.value = []
  redraw()
  api.clearDraft(props.questionId).catch(() => {})
  toast.success('草稿已清空')
}

function onKey(e) {
  if (e.key === 'Escape') {
    emit('close')
  } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
    e.preventDefault()
    if (e.shiftKey) redo()
    else undo()
  } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
    e.preventDefault()
    redo()
  }
}

async function loadDraft() {
  try {
    const paths = await api.getDraft(props.questionId)
    strokes.value = Array.isArray(paths)
      ? paths.filter((s) => s && Array.isArray(s.points))
      : []
    redraw()
  } catch {
    strokes.value = []
  }
}

onMounted(async () => {
  await nextTick()
  resize()
  await loadDraft()
  ro = new ResizeObserver(resize)
  ro.observe(canvasRef.value)
  window.addEventListener('keydown', onKey)
})

onBeforeUnmount(() => {
  if (ro) ro.disconnect()
  window.removeEventListener('keydown', onKey)
  clearTimeout(savedTimer)
})

watch(() => props.open, async (v) => {
  if (v) {
    await nextTick()
    resize()
    redraw()
  }
})
</script>

<template>
  <div v-if="open" class="paper-overlay" @mousedown.self="emit('close')">
    <canvas
      ref="canvasRef"
      class="paper-canvas"
      :class="{ 'cursor-eraser': tool === 'eraser' }"
      @mousedown="onDown"
      @mousemove="onMove"
      @mouseup="onUp"
      @mouseleave="onUp"
    ></canvas>
    <div class="paper-tools">
      <button class="tool-btn" :class="{ active: tool === 'pen' }" title="画笔" @click="tool = 'pen'">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
        </svg>
      </button>
      <button class="tool-btn" title="撤销" :disabled="!strokes.length" @click="undo">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <path d="M3 7v6h6" />
          <path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13" />
        </svg>
      </button>
      <button class="tool-btn" title="反撤销" :disabled="!redoStack.length" @click="redo">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 7v6h-6" />
          <path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3L21 13" />
        </svg>
      </button>
      <button class="tool-btn" :class="{ active: tool === 'eraser' }" title="橡皮" @click="tool = 'eraser'">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <path d="m20.5 15.5-9-9L4 14l5.5 5.5z" />
          <path d="m4 14 4-4 5 5-4 4" />
          <path d="M12 7l5 5" />
        </svg>
      </button>
      <button class="tool-btn" title="清空" :disabled="!strokes.length" @click="clear">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <path d="M3 6h18" />
          <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
          <path d="M10 11v6M14 11v6" />
        </svg>
      </button>
      <button class="tool-btn exit" title="退出" @click="emit('close')">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <path d="M18 6 6 18M6 6l12 12" />
        </svg>
      </button>
      <span v-if="saved" class="saved-tip">已保存</span>
    </div>
  </div>
</template>

<style scoped>
.paper-overlay {
  position: absolute;
  inset: 0;
  background: rgba(255, 255, 255, 0.9);
  border-radius: inherit;
  display: flex;
  z-index: 50;
  overflow: hidden;
}
.paper-canvas {
  flex: 1;
  cursor: crosshair;
  touch-action: none;
}
.paper-canvas.cursor-eraser {
  cursor: cell;
}
.paper-tools {
  width: 2.8rem;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.35rem;
  padding: 0.6rem 0.3rem;
  background: rgba(248, 249, 252, 0.8);
  border-left: 1px solid rgba(0, 0, 0, 0.06);
}
.tool-btn {
  width: 2.2rem;
  height: 2.2rem;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--text-2);
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}
.tool-btn:hover {
  background: var(--primary-weak);
  color: var(--primary);
}
.tool-btn.active {
  background: var(--primary);
  color: #fff;
}
.tool-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}
.tool-btn.exit {
  margin-top: auto;
  color: var(--danger);
}
.tool-btn.exit:hover {
  background: var(--danger-weak);
}
.saved-tip {
  font-size: 0.7rem;
  color: var(--success);
  margin-top: 0.3rem;
}
</style>
