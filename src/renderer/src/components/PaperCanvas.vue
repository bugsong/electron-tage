<script>
// 普通版（未激活进阶版）的会话内草稿缓存：只存内存不落库，
// key = `${scope}:${questionId}`，交卷/放弃/离开时由使用方调用 clearSessionDrafts(scope) 清除
const sessionDraftCache = new Map()

export function clearSessionDrafts(scope) {
  const prefix = scope ? scope + ':' : ''
  for (const k of sessionDraftCache.keys()) {
    if (k.startsWith(prefix)) sessionDraftCache.delete(k)
  }
}
</script>

<script setup>
import { ref, onMounted, onBeforeUnmount, nextTick, watch, toRaw } from 'vue'
import { api } from '../api'
import { useToastStore } from '../stores/toast'

const props = defineProps({
  questionId: { type: [Number, String], required: true },
  open: { type: Boolean, default: false },
  // 会话内草稿缓存作用域（普通版不落库）：练习传 session 前缀，交卷后清除
  scope: { type: String, default: '' }
})
const emit = defineEmits(['close'])
const toast = useToastStore()

const canvasRef = ref(null)
const strokes = ref([])
const redoStack = ref([])
const INK = '#20242c'
const PEN_WIDTH = 3
const ERASER_WIDTH = 26
const PEN_SIZES = [
  { key: 'thin', label: '细', px: 2 },
  { key: 'normal', label: '中', px: 3 },
  { key: 'bold', label: '粗', px: 6 }
]
const PEN_COLORS = ['#20242c', '#e5484d', '#2f7bf6', '#1fa268', '#e8a13c', '#8b5cf6']
// 橡皮粗细独立于画笔：px 为实际擦除宽度，dot 为按钮里的示意圆点尺寸
const ERASER_SIZES = [
  { key: 'thin', label: '细', px: 14, dot: 5 },
  { key: 'normal', label: '中', px: 26, dot: 9 },
  { key: 'bold', label: '粗', px: 40, dot: 14 }
]

// 普通版固定参数
const FREE_PEN_COLOR = '#e5484d'
const FREE_PEN_SIZE = 'normal'
const FREE_ERASER_SIZE = 'normal'
const FREE_ERASER_MODE = 'pixel'

// 进阶版判定：未激活时按普通版削弱（固定红色画笔 / 固定像素橡皮 / 不展示设置项 / 笔迹不落库）
// 初始按普通版渲染，授权确认后升级为进阶版，避免由高到低闪烁
const pro = ref(false)

const tool = ref('pen')
const penSize = ref(FREE_PEN_SIZE)
const penColor = ref(FREE_PEN_COLOR)
const eraserSize = ref(FREE_ERASER_SIZE)
const eraserMode = ref(FREE_ERASER_MODE) // 'pixel' 像素擦除 | 'stroke' 整笔擦除
const drawing = ref(null)
const saved = ref(false)

async function loadLicense() {
  try {
    const s = await api.getLicenseStatus()
    pro.value = !!(s && s.activated)
  } catch {
    pro.value = true // 授权状态读取失败时按进阶版处理，避免误削弱
  }
  if (pro.value) {
    await loadToolPrefs()
  } else {
    // 普通版固定参数，不读取 / 保存上次状态
    penColor.value = FREE_PEN_COLOR
    penSize.value = FREE_PEN_SIZE
    eraserSize.value = FREE_ERASER_SIZE
    eraserMode.value = FREE_ERASER_MODE
  }
}

/** 普通版会话内草稿缓存 key */
const draftKey = () => (props.scope ? props.scope + ':' : '') + props.questionId

function penSizePx() {
  const s = PEN_SIZES.find((s) => s.key === penSize.value)
  return s ? s.px : PEN_WIDTH
}

function eraserSizePx() {
  const s = ERASER_SIZES.find((s) => s.key === eraserSize.value)
  return s ? s.px : ERASER_WIDTH
}

/* ---- 画笔/橡皮参数持久化（settings 表） ---- */

function savePref(key, value) {
  api.setSetting(key, value).catch(() => {})
}

function setPenSize(key) {
  penSize.value = key
  savePref('penSize', key)
}

function setPenColor(c) {
  penColor.value = c
  savePref('penColor', c)
}

function setEraserSize(key) {
  eraserSize.value = key
  savePref('eraserSize', key)
}

function setEraserMode(m) {
  eraserMode.value = m
  savePref('eraserMode', m)
}

/** 从数据库读取上次保存的画笔/橡皮参数，非法值回退默认 */
async function loadToolPrefs() {
  try {
    const s = await api.getSettings()
    if (PEN_SIZES.some((x) => x.key === s.penSize)) penSize.value = s.penSize
    if (PEN_COLORS.includes(s.penColor)) penColor.value = s.penColor
    if (ERASER_SIZES.some((x) => x.key === s.eraserSize)) eraserSize.value = s.eraserSize
    if (s.eraserMode === 'pixel' || s.eraserMode === 'stroke') eraserMode.value = s.eraserMode
  } catch {
    /* 默认值兜底 */
  }
}

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
  // 整笔擦除：预览为半透明高亮，松手后整笔删除（不直接擦除像素）
  if (s.tool === 'eraser' && s.mode === 'stroke') {
    c.globalCompositeOperation = 'source-over'
    c.strokeStyle = 'rgba(47, 123, 246, 0.35)'
    c.lineWidth = s.lineWidth || ERASER_WIDTH
    c.beginPath()
    c.moveTo(s.points[0].x, s.points[0].y)
    for (let i = 1; i < s.points.length; i++) c.lineTo(s.points[i].x, s.points[i].y)
    c.stroke()
    return
  }
  // 橡皮擦用 destination-out 真正擦除笔迹，露出下方的原题（透明覆层下不再画白块）
  const erasing = s.tool === 'eraser'
  c.globalCompositeOperation = erasing ? 'destination-out' : 'source-over'
  c.strokeStyle = erasing ? '#000' : s.color || INK
  c.lineWidth = s.lineWidth || PEN_WIDTH
  c.beginPath()
  c.moveTo(s.points[0].x, s.points[0].y)
  for (let i = 1; i < s.points.length; i++) c.lineTo(s.points[i].x, s.points[i].y)
  c.stroke()
  c.globalCompositeOperation = 'source-over'
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
    mode: tool.value === 'eraser' ? eraserMode.value : null,
    points: [pos(e)],
    lineWidth: tool.value === 'eraser' ? eraserSizePx() : penSizePx(),
    color: penColor.value
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

/** 整笔擦除命中检测：与擦除路径（按当前粗细的半径范围）相交的笔迹整笔删除 */
function findStrokesHit(eraserStroke) {
  const r = (eraserStroke.lineWidth || ERASER_WIDTH) / 2
  const r2 = r * r
  const hit = new Set()
  strokes.value.forEach((s, i) => {
    if (s.tool === 'eraser') return
    for (const p of s.points) {
      for (const e of eraserStroke.points) {
        const dx = p.x - e.x
        const dy = p.y - e.y
        if (dx * dx + dy * dy <= r2) {
          hit.add(i)
          return
        }
      }
    }
  })
  return hit
}

async function onUp() {
  if (!drawing.value) return
  const d = drawing.value
  if (d.points.length >= 2) {
    if (d.mode === 'stroke') {
      // 整笔擦除：删除与擦除路径相交的全部笔迹，擦除轨迹本身不入库
      const hit = findStrokesHit(d)
      if (hit.size) {
        strokes.value = strokes.value.filter((_, i) => !hit.has(i))
        redoStack.value = []
        await persist()
      }
    } else {
      strokes.value.push(d)
      redoStack.value = []
      await persist()
    }
  }
  drawing.value = null
  redraw() // 无论是否命中都重绘，清除整笔擦除遗留的拖影
}

/* ---- 工具操作 ---- */

function cloneForIPC(arr) {
  // 将 Vue 响应式代理转换为普通对象，避免 IPC 克隆错误
  return JSON.parse(JSON.stringify(toRaw(arr)))
}

async function persist() {
  if (!pro.value) {
    // 普通版：仅保存到会话内存，不落库（交卷后由使用方 clearSessionDrafts 清除）
    sessionDraftCache.set(draftKey(), cloneForIPC(strokes.value))
    return
  }
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
  if (pro.value) api.clearDraft(props.questionId).catch(() => {})
  else sessionDraftCache.delete(draftKey())
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
  if (!pro.value) {
    // 普通版：只恢复本次会话内存中的笔迹，不读取数据库
    strokes.value = sessionDraftCache.get(draftKey()) || []
    redraw()
    return
  }
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
  await loadLicense()
  await nextTick()
  if (!canvasRef.value) return
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

      <!-- 画笔设置：粗细 / 颜色（进阶版专属） -->
      <div v-if="pro && tool === 'pen'" class="tool-settings">
        <div class="ts-label">粗细</div>
        <div class="ts-row">
          <button
            v-for="s in PEN_SIZES"
            :key="s.key"
            class="ts-btn ts-size"
            :class="{ active: penSize === s.key }"
            :title="s.label + ' ' + s.px + 'px'"
            @click="setPenSize(s.key)"
          >
            <span class="ts-line" :style="{ height: s.px + 'px' }"></span>
          </button>
        </div>
        <div class="ts-label">颜色</div>
        <div class="ts-colors">
          <button
            v-for="c in PEN_COLORS"
            :key="c"
            class="ts-swatch"
            :class="{ active: penColor === c }"
            :style="{ background: c }"
            :title="c"
            @click="setPenColor(c)"
          ></button>
        </div>
      </div>

      <!-- 橡皮设置：粗细 / 擦除方式（进阶版专属） -->
      <div v-else-if="pro && tool === 'eraser'" class="tool-settings">
        <div class="ts-label">粗细</div>
        <div class="ts-row">
          <button
            v-for="s in ERASER_SIZES"
            :key="s.key"
            class="ts-btn ts-size"
            :class="{ active: eraserSize === s.key }"
            :title="s.label + ' ' + s.px + 'px'"
            @click="setEraserSize(s.key)"
          >
            <span class="ts-dot" :style="{ width: s.dot + 'px', height: s.dot + 'px' }"></span>
          </button>
        </div>
        <div class="ts-label">擦除方式</div>
        <button class="ts-btn ts-mode" :class="{ active: eraserMode === 'pixel' }" @click="setEraserMode('pixel')">
          像素擦除
        </button>
        <button class="ts-btn ts-mode" :class="{ active: eraserMode === 'stroke' }" @click="setEraserMode('stroke')">
          整笔擦除
        </button>
      </div>

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
  /* 初始透明度 10%：保持透明，做题时仍能看到原题 */
  background: rgba(255, 255, 255, 0.1);
  border-radius: inherit;
  z-index: 50;
}
.paper-canvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  border-radius: inherit;
  cursor: crosshair;
  touch-action: none;
}
.paper-canvas.cursor-eraser {
  cursor: cell;
}
/* 工具栏浮在题卡右侧外边，不遮挡题卡内容；宽度随设置内容伸缩，高度随内容纵向伸缩 */
.paper-tools {
  position: absolute;
  top: 0;
  left: calc(100% + 0.6rem);
  width: max-content;
  min-width: 2.8rem;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.3rem;
  padding: 0.6rem 0.45rem;
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 10px;
  box-shadow: var(--shadow);
  z-index: 51;
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
/* ---- 工具设置区（画笔粗细/颜色、橡皮擦除方式） ---- */
.tool-settings {
  width: 5.2rem;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.25rem;
  padding: 0.5rem 0;
  margin-top: 0.15rem;
  border-top: 1px dashed var(--border);
}
.ts-label {
  font-size: 0.68rem;
  color: var(--text-2);
}
.ts-row {
  display: flex;
  gap: 0.2rem;
}
.ts-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--card);
  color: var(--text-2);
  font-size: 0.72rem;
  font-family: inherit;
  cursor: pointer;
  transition: background 0.15s, color 0.15s, border-color 0.15s;
}
.ts-btn:hover {
  border-color: var(--primary);
  color: var(--primary);
}
.ts-btn.active {
  border-color: var(--primary);
  background: var(--primary-weak);
  color: var(--primary);
}
.ts-size {
  width: 1.5rem;
  height: 1.5rem;
  padding: 0;
}
.ts-line {
  display: block;
  width: 0.85rem;
  background: currentColor;
  border-radius: 2px;
}
.ts-dot {
  display: block;
  border-radius: 50%;
  background: currentColor;
}
.ts-colors {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 0.25rem;
}
.ts-swatch {
  width: 1.15rem;
  height: 1.15rem;
  border-radius: 50%;
  border: 2px solid transparent;
  padding: 0;
  cursor: pointer;
  box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.14);
}
.ts-swatch.active {
  border-color: var(--primary);
  box-shadow: 0 0 0 2px var(--primary-weak);
}
.ts-mode {
  width: 100%;
  padding: 0.3rem 0;
}
/* 已保存提示：绝对定位于退出按钮上方，不参与布局，避免自动保存时顶动按钮 */
.saved-tip {
  position: absolute;
  bottom: calc(2.2rem + 0.5rem);
  left: 0;
  right: 0;
  text-align: center;
  font-size: 0.68rem;
  color: var(--success);
  pointer-events: none;
}
</style>
