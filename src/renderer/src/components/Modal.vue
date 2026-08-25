<script setup>
defineProps({
  title: { type: String, default: '' },
  width: { type: String, default: '30rem' },
  closable: { type: Boolean, default: true }
})
const emit = defineEmits(['close'])
</script>

<template>
  <Teleport to="body">
    <div class="modal-mask" @mousedown.self="closable && emit('close')">
      <div class="modal-panel" :style="{ width }">
        <div class="modal-header">
          <slot name="header">
            <span class="modal-title">{{ title }}</span>
          </slot>
          <button v-if="closable" class="icon-btn" @click="emit('close')">✕</button>
        </div>
        <div class="modal-body">
          <slot />
        </div>
        <div v-if="$slots.footer" class="modal-footer">
          <slot name="footer" />
        </div>
      </div>
    </div>
  </Teleport>
</template>
