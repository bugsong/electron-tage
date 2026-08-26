<script setup>
import { useSettingsStore, FONT_SIZES } from '../stores/settings'
import Modal from './Modal.vue'

const emit = defineEmits(['close'])

const settings = useSettingsStore()
</script>

<template>
  <Modal title="显示设置" width="24rem" @close="emit('close')">
    <div class="qs">
      <div class="qs-label">字号大小</div>
      <div class="qs-row">
        <button
          v-for="f in FONT_SIZES"
          :key="f.key"
          class="qs-btn"
          :class="{ active: settings.fontSize === f.key }"
          @click="settings.setFontSize(f.key)"
        >
          {{ f.label }}
        </button>
      </div>

      <div class="qs-label">配色</div>
      <div class="qs-row">
        <button
          class="qs-btn"
          :class="{ active: settings.theme === 'light' }"
          @click="settings.setTheme('light')"
        >
          日间
        </button>
        <button
          class="qs-btn"
          :class="{ active: settings.theme === 'dark' }"
          @click="settings.setTheme('dark')"
        >
          夜间
        </button>
      </div>
    </div>
  </Modal>
</template>

<style scoped>
.qs-label {
  font-weight: 700;
  font-size: 0.9rem;
  margin-bottom: 0.4rem;
}
.qs-row {
  display: flex;
  gap: 0.6rem;
  margin-bottom: 1.1rem;
}
.qs-btn {
  flex: 1;
  border: 1px solid var(--border);
  background: var(--card);
  color: var(--text);
  border-radius: 8px;
  padding: 0.4rem 0;
  cursor: pointer;
  font-size: 0.9rem;
  font-family: inherit;
}
.qs-btn.active {
  border-color: var(--primary);
  background: var(--primary-weak);
  color: var(--primary);
  font-weight: 600;
}
</style>
