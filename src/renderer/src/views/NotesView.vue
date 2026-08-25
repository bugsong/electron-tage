<script setup>
import { ref, onMounted } from 'vue'
import { api } from '../api'
import { fmtTime, plainText } from '../utils/format'
import QuestionDetailModal from '../components/QuestionDetailModal.vue'
import { useToastStore } from '../stores/toast'

const toast = useToastStore()

const items = ref([])
const loading = ref(true)
const detailFor = ref(null)

async function load() {
  loading.value = true
  try {
    items.value = await api.listNotes()
  } catch (err) {
    toast.error('加载笔记失败：' + (err.message || err))
  } finally {
    loading.value = false
  }
}
onMounted(load)

function preview(content) {
  return plainText(content).slice(0, 90) || '（空笔记）'
}
</script>

<template>
  <div class="page">
    <div class="page-header">
      <span class="page-title-tag">笔记</span>
      <span class="page-sub">全部 {{ items.length }} 条，做题时点卡片上的「笔记」即可随题记录</span>
    </div>

    <div v-if="loading" class="empty">加载中…</div>

    <div v-else-if="!items.length" class="empty">
      <div class="empty-icon">📝</div>
      <div>还没有笔记，做题时在题目卡片右上角点「笔记」写下心得</div>
    </div>

    <div v-else class="card">
      <div v-for="n in items" :key="n.questionId" class="note-item" @click="detailFor = n">
        <div class="note-body" v-html="n.content"></div>
        <div class="note-meta">
          <span class="tag tag-gray">{{ n.categoryName }}</span>
          <span class="note-stem">{{ plainText(n.stem).slice(0, 80) }}</span>
          <span class="note-time">{{ fmtTime(n.updatedAt) }}</span>
        </div>
      </div>
    </div>

    <QuestionDetailModal
      v-if="detailFor"
      :question="{ ...detailFor, id: detailFor.questionId }"
      @close="detailFor = null"
    />
  </div>
</template>

<style scoped>
.page-sub {
  color: var(--text-2);
  font-size: 0.85rem;
}
.note-item {
  padding: 0.9rem 1.1rem;
  border-bottom: 1px solid var(--border);
  cursor: pointer;
}
.note-item:last-child {
  border-bottom: none;
}
.note-item:hover {
  background: var(--card-hover);
}
.note-body {
  font-size: 0.93rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.note-body :deep(h2) {
  font-size: 1rem;
  margin: 0;
  display: inline;
}
.note-body :deep(blockquote) {
  margin: 0;
  padding-left: 0.5rem;
  border-left: 2px solid var(--primary);
  display: inline;
}
.note-body :deep(img) {
  max-width: 1.1em;
  max-height: 1.1em;
  vertical-align: -0.2em;
  object-fit: cover;
}
.note-meta {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  color: var(--text-2);
  font-size: 0.8rem;
  margin-top: 0.35rem;
}
.note-stem {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.note-time {
  flex-shrink: 0;
}
</style>
