<script setup>
import { ref, onMounted } from 'vue'
import { api } from '../api'
import { useSettingsStore, FONT_SIZES } from '../stores/settings'
import { useToastStore } from '../stores/toast'

const settings = useSettingsStore()
const toast = useToastStore()
const dbPath = ref('')

onMounted(async () => {
  try {
    dbPath.value = await api.getDbPath()
  } catch {
    dbPath.value = ''
  }
})

async function copyPath() {
  try {
    await navigator.clipboard.writeText(dbPath.value)
    toast.success('路径已复制')
  } catch {
    toast.error('复制失败')
  }
}
</script>

<template>
  <div class="page st-page">
    <span class="page-title-tag">设置</span>

    <div class="card st-card">
      <div class="st-title">字号大小</div>
      <div class="st-desc">调整后全局即时生效，并自动保存</div>
      <div class="st-row">
        <button
          v-for="f in FONT_SIZES"
          :key="f.key"
          class="st-btn"
          :class="{ active: settings.fontSize === f.key }"
          @click="settings.setFontSize(f.key)"
        >
          {{ f.label }}
          <span class="st-btn-sample" :style="{ fontSize: f.px + 'px' }">示例</span>
        </button>
      </div>
    </div>

    <div class="card st-card">
      <div class="st-title">配色</div>
      <div class="st-desc">支持日间 / 夜间两种配色</div>
      <div class="st-row">
        <button
          class="st-btn theme-btn"
          :class="{ active: settings.theme === 'light' }"
          @click="settings.setTheme('light')"
        >
          ☀ 日间
        </button>
        <button
          class="st-btn theme-btn"
          :class="{ active: settings.theme === 'dark' }"
          @click="settings.setTheme('dark')"
        >
          ☾ 夜间
        </button>
      </div>
    </div>

    <div class="card st-card">
      <div class="st-title">数据位置</div>
      <div class="st-desc">全部数据（题库、错题、笔记、收藏、草稿笔迹）保存在下面的 SQLite 文件中，请勿删除</div>
      <div class="st-path">
        <span class="st-path-text">{{ dbPath }}</span>
        <button class="btn" @click="copyPath">复制路径</button>
      </div>
    </div>

    <div class="st-about">刷题笔记 · 仅本机使用 · 数据不出本机</div>
  </div>
</template>

<style scoped>
.st-page {
  max-width: 620px;
}
.st-card {
  padding: 1.1rem 1.3rem;
  margin-top: 1rem;
}
.st-title {
  font-weight: 700;
  font-size: 1rem;
}
.st-desc {
  color: var(--text-2);
  font-size: 0.85rem;
  margin: 0.2rem 0 0.8rem;
}
.st-row {
  display: flex;
  gap: 0.7rem;
  flex-wrap: wrap;
}
.st-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  border: 1px solid var(--border);
  background: var(--card);
  color: var(--text);
  border-radius: 8px;
  padding: 0.5rem 1rem;
  cursor: pointer;
  font-size: 0.9rem;
  font-family: inherit;
  min-width: 6rem;
  justify-content: center;
}
.st-btn.active {
  border-color: var(--primary);
  background: var(--primary-weak);
  color: var(--primary);
  font-weight: 600;
}
.st-btn-sample {
  color: var(--text-2);
}
.st-btn.active .st-btn-sample {
  color: var(--primary);
}
.theme-btn {
  flex: 1;
}
.st-path {
  display: flex;
  align-items: center;
  gap: 0.7rem;
}
.st-path-text {
  flex: 1;
  background: var(--card-hover);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 0.45rem 0.7rem;
  font-size: 0.82rem;
  font-family: Consolas, 'Courier New', monospace;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  user-select: text;
}
.st-about {
  text-align: center;
  color: var(--text-2);
  font-size: 0.8rem;
  margin-top: 1.2rem;
}
</style>
