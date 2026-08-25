<script setup>
import { ref } from 'vue'
import { api } from '../api'
import Modal from './Modal.vue'
import { useToastStore } from '../stores/toast'

const emit = defineEmits(['close', 'done'])
const toast = useToastStore()

const step = ref('pick') // pick | preview | result
const filePath = ref('')
const rows = ref([])
const errors = ref([])
const parsing = ref(false)
const importing = ref(false)
const result = ref(null)

async function pickFile() {
  try {
    const fp = await api.pickExcel()
    if (!fp) return
    filePath.value = fp
    parsing.value = true
    const r = await api.parseExcel(fp)
    rows.value = r.rows
    errors.value = r.errors
    parsing.value = false
    step.value = 'preview'
    if (!rows.value.length && !errors.value.length) {
      toast.error('文件中没有解析到任何内容，请检查表头列名（题干 / A B C D / 答案 / 解析）')
    }
  } catch (err) {
    parsing.value = false
    toast.error('解析失败：' + (err.message || err))
  }
}

async function doImport() {
  importing.value = true
  try {
    const r = await api.importRows(rows.value)
    result.value = r
    step.value = 'result'
    toast.success(`导入完成：新增 ${r.inserted} 题，跳过重复 ${r.duplicates} 题`)
    emit('done')
  } catch (err) {
    toast.error('导入失败：' + (err.message || err))
  } finally {
    importing.value = false
  }
}

function fileName(p) {
  return p ? p.split(/[\\/]/).pop() : ''
}
</script>

<template>
  <Modal title="导入 Excel 题库" width="38rem" :closable="!importing" @close="emit('close')">
    <!-- 第一步：选择文件 -->
    <div v-if="step === 'pick'" class="im">
      <div class="im-tip">
        <p><b>文件要求</b>：.xlsx 或 .xls 表格，第一行为表头。</p>
        <p>至少包含：<span class="tag tag-primary">题干</span> <span class="tag tag-gray">A B C D 选项</span>
          <span class="tag tag-gray">答案</span>，可选：<span class="tag tag-gray">解析</span>
          <span class="tag tag-gray">一级分类 / 二级分类</span>（不填则归入「未分类」）。</p>
      </div>
      <button class="btn btn-primary" :disabled="parsing" @click="pickFile">
        {{ parsing ? '解析中…' : '选择 Excel 文件' }}
      </button>
    </div>

    <!-- 第二步：预览确认 -->
    <div v-else-if="step === 'preview'" class="im">
      <div class="im-file">{{ fileName(filePath) }}</div>
      <div class="im-summary">
        共解析出 <b class="ok">{{ rows.length }}</b> 道有效题目
        <template v-if="errors.length">，<b class="bad">{{ errors.length }}</b> 行存在错误</template>
      </div>

      <div v-if="rows.length" class="im-preview">
        <div v-for="r in rows.slice(0, 5)" :key="r.rowIndex" class="im-prow">
          <span class="tag tag-gray">第{{ r.rowIndex }}行</span>
          <span class="im-pstem">{{ r.stem.slice(0, 60) }}</span>
          <span class="im-pans">答案 {{ r.answer }}</span>
        </div>
        <div v-if="rows.length > 5" class="im-more">…共 {{ rows.length }} 题</div>
      </div>

      <div v-if="errors.length" class="im-errors">
        <div class="im-errors-title">以下行存在问题，将被跳过：</div>
        <div v-for="e in errors.slice(0, 8)" :key="e.rowIndex" class="im-errors-row">
          第 {{ e.rowIndex }} 行：{{ e.errors.join('、') }}
          <span v-if="e.stem">（{{ e.stem }}）</span>
        </div>
        <div v-if="errors.length > 8" class="im-more">…共 {{ errors.length }} 行错误</div>
      </div>
    </div>

    <!-- 第三步：结果 -->
    <div v-else class="im">
      <div class="im-result-ok">✓ 导入完成</div>
      <div class="im-summary">
        新增 <b class="ok">{{ result.inserted }}</b> 题，跳过重复 <b>{{ result.duplicates }}</b> 题
      </div>
      <button class="btn" @click="emit('close')">完成</button>
    </div>

    <template v-if="step === 'preview'" #footer>
      <button class="btn" :disabled="importing" @click="step = 'pick'">重新选择</button>
      <button class="btn btn-primary" :disabled="!rows.length || importing" @click="doImport">
        {{ importing ? '导入中…' : `导入 ${rows.length} 题` }}
      </button>
    </template>
  </Modal>
</template>

<style scoped>
.im {
  display: flex;
  flex-direction: column;
  gap: 0.8rem;
}
.im-tip p {
  margin: 0.25rem 0;
  color: var(--text-2);
  font-size: 0.9rem;
  line-height: 1.7;
}
.im-file {
  font-size: 0.9rem;
  font-weight: 600;
}
.im-summary {
  font-size: 0.95rem;
}
.ok {
  color: var(--success);
}
.bad {
  color: var(--danger);
}
.im-preview {
  border: 1px solid var(--border);
  border-radius: 8px;
  overflow: hidden;
}
.im-prow {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  padding: 0.4rem 0.7rem;
  border-bottom: 1px solid var(--border);
  font-size: 0.85rem;
}
.im-prow:last-child {
  border-bottom: none;
}
.im-pstem {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.im-pans {
  color: var(--text-2);
  flex-shrink: 0;
}
.im-more {
  padding: 0.4rem 0.7rem;
  color: var(--text-2);
  font-size: 0.82rem;
}
.im-errors {
  background: var(--danger-weak);
  border: 1px solid var(--danger);
  border-radius: 8px;
  padding: 0.6rem 0.8rem;
  font-size: 0.82rem;
  max-height: 150px;
  overflow-y: auto;
}
.im-errors-title {
  font-weight: 700;
  color: var(--danger);
  margin-bottom: 0.3rem;
}
.im-errors-row {
  line-height: 1.7;
}
.im-result-ok {
  font-size: 1.6rem;
  font-weight: 800;
  color: var(--success);
  text-align: center;
  padding: 0.6rem 0;
}
</style>
