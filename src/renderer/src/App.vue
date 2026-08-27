<script setup>
import { ref, onMounted, onUnmounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { api } from './api'
import Sidebar from './components/Sidebar.vue'
import ToastHost from './components/ToastHost.vue'

const router = useRouter()
const route = useRoute()
const dbNotReady = ref(false)
const dbError = ref('')
let pollTimer = null

async function checkDb() {
  try {
    const s = await api.getDbStatus()
    if (s && s.ready) {
      dbNotReady.value = false
      stopPoll()
    } else if (s && !s.ready) {
      dbNotReady.value = true
      dbError.value = s.error || ''
      startPoll()
    }
  } catch {
    /* 忽略 */
  }
}

function startPoll() {
  if (pollTimer) return
  pollTimer = setInterval(checkDb, 1500)
}

function stopPoll() {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
}

function goSettings() {
  router.push('/settings')
}

onMounted(checkDb)
onUnmounted(stopPoll)
</script>

<template>
  <div class="app-shell">
    <Sidebar />
    <main class="app-main">
      <router-view v-slot="{ Component }">
        <transition name="fade" mode="out-in">
          <component :is="Component" />
        </transition>
      </router-view>
    </main>
    <ToastHost />

    <!-- 数据库未就绪遮罩：仅在非设置页展示，引导去设置页解密 -->
    <Teleport to="body">
      <div v-if="dbNotReady && route.path !== '/settings'" class="db-lock-mask">
        <div class="db-lock-panel">
          <div class="db-lock-title">数据库无法打开</div>
          <div class="db-lock-desc">
            当前数据位置的数据库解密失败，可能是加密密钥（设备唯一信息码）不匹配。<br />
            请前往「设置 → 数据库加解密」输入正确的设备唯一信息码以恢复访问。
          </div>
          <div v-if="dbError" class="db-lock-error">{{ dbError }}</div>
          <button class="db-lock-btn" @click="goSettings">前往设置</button>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.db-lock-mask {
  position: fixed;
  inset: 0;
  z-index: 9999;
  background: rgba(0, 0, 0, 0.55);
  display: flex;
  align-items: center;
  justify-content: center;
}
.db-lock-panel {
  background: var(--card, #fff);
  border-radius: 12px;
  padding: 1.6rem 1.8rem;
  max-width: 30rem;
  text-align: center;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
}
.db-lock-title {
  font-size: 1.1rem;
  font-weight: 700;
  margin-bottom: 0.6rem;
}
.db-lock-desc {
  font-size: 0.88rem;
  color: var(--text-2, #666);
  line-height: 1.7;
  margin-bottom: 0.8rem;
}
.db-lock-error {
  font-size: 0.8rem;
  color: #c0392b;
  background: #fdecea;
  border: 1px solid #f5b7b1;
  border-radius: 6px;
  padding: 0.4rem 0.6rem;
  margin-bottom: 0.8rem;
  word-break: break-all;
}
.db-lock-btn {
  border: none;
  background: var(--primary, #3b82f6);
  color: #fff;
  border-radius: 8px;
  padding: 0.5rem 1.4rem;
  font-size: 0.9rem;
  cursor: pointer;
}
.db-lock-btn:hover {
  opacity: 0.9;
}
</style>
