<script setup>
import Sidebar from './components/Sidebar.vue'
import ToastHost from './components/ToastHost.vue'
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
  </div>
</template>
