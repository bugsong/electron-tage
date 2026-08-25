<script setup>
/**
 * 富文本编辑器（WangEditor 5）封装。
 * - v-model 绑定 HTML 字符串
 * - 图片上传钩子：读取文件 → IPC 存入数据库 BLOB → 插入 local-image://{id} 引用
 */
import '@wangeditor/editor/dist/css/style.css'
import { onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import { Editor, Toolbar } from '@wangeditor/editor-for-vue'
import { api } from '../api'
import { useToastStore } from '../stores/toast'

const props = defineProps({
  modelValue: { type: String, default: '' },
  placeholder: { type: String, default: '输入内容…' },
  height: { type: String, default: '160px' }
})
const emit = defineEmits(['update:modelValue'])
const toast = useToastStore()

const editorRef = shallowRef(null)
const inner = ref(props.modelValue)

const toolbarConfig = {}
const editorConfig = {
  placeholder: props.placeholder,
  MENU_CONF: {
    uploadImage: {
      // 自定义上传：压缩存库（主进程 sharp 压缩），返回 local-image:// 引用
      async customUpload(file, insertFn) {
        try {
          const buf = await file.arrayBuffer()
          const { id } = await api.saveImage(buf)
          insertFn(`local-image://${id}`, '', '')
          toast.success('图片已插入')
        } catch (err) {
          toast.error('图片上传失败：' + (err.message || err))
        }
      }
    }
  }
}

function handleCreated(editor) {
  editorRef.value = editor
}

watch(
  () => props.modelValue,
  (v) => {
    if (v !== inner.value) inner.value = v || ''
  }
)
watch(inner, (v) => emit('update:modelValue', v))

onBeforeUnmount(() => {
  if (editorRef.value) {
    editorRef.value.destroy()
    editorRef.value = null
  }
})
</script>

<template>
  <div class="rte" :style="{ '--rte-height': height }">
    <Toolbar :editor="editorRef" :default-config="toolbarConfig" mode="default" class="rte-toolbar" />
    <Editor
      v-model="inner"
      :default-config="editorConfig"
      mode="default"
      class="rte-editor"
      @on-created="handleCreated"
    />
  </div>
</template>

<style scoped>
.rte {
  flex: 1;
  min-width: 0;
  border: 1px solid var(--border);
  border-radius: 8px;
  overflow: hidden;
  background: var(--card);
}
.rte-toolbar {
  border-bottom: 1px solid var(--border);
}
.rte-editor {
  height: var(--rte-height);
  overflow-y: hidden;
}
.rte :deep(.w-e-text-container) {
  height: var(--rte-height) !important;
  background: var(--card);
}
.rte :deep(img) {
  max-width: 100%;
}
</style>
