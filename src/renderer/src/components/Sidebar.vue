<script setup>
import { ref, onMounted } from 'vue'
import { api } from '../api'

const collapsed = ref(false)

onMounted(async () => {
  try {
    const s = await api.getSettings()
    collapsed.value = s.sidebarCollapsed === '1'
  } catch {
    collapsed.value = false
  }
})

/** 切换收起/展开，并持久化到 settings 表 */
function toggleCollapsed() {
  collapsed.value = !collapsed.value
  api.setSetting('sidebarCollapsed', collapsed.value ? '1' : '0').catch(() => {})
}

const items = [
  { to: '/home', label: '首页', icon: 'home' },
  { to: '/practice', label: '练习', icon: 'practice' },
  { to: '/wrong', label: '错题', icon: 'wrong' },
  { to: '/notes', label: '笔记', icon: 'notes' },
  { to: '/favorites', label: '收藏', icon: 'favorites' },
  { to: '/questions', label: '题库', icon: 'questions' },
  { to: '/settings', label: '设置', icon: 'settings' }
]

const icons = {
  home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/><path d="M9 21v-6h6v6"/>',
  practice:
    '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>',
  wrong: '<circle cx="12" cy="12" r="9"/><path d="m9 9 6 6M15 9l-6 6"/>',
  notes: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M8 13h8M8 17h5"/>',
  favorites:
    '<path d="m12 2 3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01z"/>',
  questions:
    '<path d="M8 6h13M8 12h13M8 18h13"/><path d="M3.5 6h.01M3.5 12h.01M3.5 18h.01"/>',
  settings:
    '<circle cx="12" cy="12" r="3.2"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.03 1.56V21a2 2 0 1 1-4 0v-.09A1.7 1.7 0 0 0 8.98 19.4a1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.56-1.03H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.6 8.98a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34H9a1.7 1.7 0 0 0 1.03-1.56V3a2 2 0 1 1 4 0v.09c0 .68.4 1.29 1.03 1.56.66.31 1.43.21 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87V9c.27.63.88 1.03 1.56 1.03H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.51.97z"/>'
}
</script>

<template>
  <aside class="sidebar" :class="{ collapsed }">
    <div class="sidebar-logo">
      <span class="sidebar-logo-text">题迹</span>
    </div>
    <nav class="sidebar-nav">
      <router-link
        v-for="item in items"
        :key="item.to"
        :to="item.to"
        class="sidebar-item"
        active-class="active"
      >
        <svg
          viewBox="0 0 24 24"
          width="19"
          height="19"
          fill="none"
          stroke="currentColor"
          stroke-width="1.8"
          stroke-linecap="round"
          stroke-linejoin="round"
          v-html="icons[item.icon]"
        />
        <span>{{ item.label }}</span>
      </router-link>
    </nav>
    <div class="sidebar-foot">
      <!-- 收起/展开按钮固定在左下角同一位置 -->
      <button v-if="!collapsed" class="sidebar-corner-btn" title="收起导航" @click="toggleCollapsed">
        <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M15 18l-6-6 6-6" />
        </svg>
      </button>
      <button v-if="collapsed" class="sidebar-corner-btn" title="展开导航" @click="toggleCollapsed">
        <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M3 6h18M3 12h18M3 18h18" />
        </svg>
      </button>
      <span>数据仅存本机</span>
    </div>
  </aside>
</template>

<style scoped>
.sidebar {
  width: 13rem;
  flex-shrink: 0;
  background: var(--card);
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  padding: 1rem 0.7rem 0.5rem;
  overflow: hidden;
  white-space: nowrap;
  transition: width 0.22s ease, padding 0.22s ease, border-color 0.22s ease;
}
.sidebar.collapsed {
  width: 0;
  padding-left: 0;
  padding-right: 0;
  border-right: none;
}
.sidebar-logo {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  padding: 0.2rem 0.55rem 1rem;
}
.sidebar-logo-text {
  font-weight: 700;
  font-size: 1.05rem;
}
.sidebar-nav {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  flex: 1;
}
.sidebar-item {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  padding: 0.52rem 0.7rem;
  border-radius: 8px;
  color: var(--text-2);
  font-size: 0.92rem;
  transition: background 0.15s, color 0.15s;
}
.sidebar-item:hover {
  background: var(--card-hover);
  color: var(--text);
}
.sidebar-item.active {
  background: var(--primary);
  color: #fff;
  font-weight: 600;
}
.sidebar-foot {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.6rem 0.7rem 0.5rem 3.1rem;
  font-size: 0.72rem;
  color: var(--text-2);
}
/* 收起/展开按钮：固定在左下角同一位置（fixed 脱离折叠区裁剪） */
.sidebar-corner-btn {
  position: fixed;
  left: 0.5rem;
  bottom: 0.5rem;
  z-index: 60;
  width: 2rem;
  height: 2rem;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--card);
  color: var(--text-2);
  box-shadow: var(--shadow);
  cursor: pointer;
  transition: color 0.15s, border-color 0.15s;
}
.sidebar-corner-btn:hover {
  color: var(--primary);
  border-color: var(--primary);
}
</style>
