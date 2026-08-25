<script setup>
import Modal from './Modal.vue'

defineProps({
  title: { type: String, default: '确认' },
  message: { type: String, default: '' },
  okText: { type: String, default: '确定' },
  danger: { type: Boolean, default: false }
})
const emit = defineEmits(['confirm', 'close'])
</script>

<template>
  <Modal :title="title" width="22rem" @close="emit('close')">
    <div class="confirm-text">{{ message }}</div>
    <template #footer>
      <button class="btn" @click="emit('close')">取消</button>
      <button class="btn" :class="danger ? 'btn-danger' : 'btn-primary'" @click="emit('confirm')">
        {{ okText }}
      </button>
    </template>
  </Modal>
</template>
