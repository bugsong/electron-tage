<script setup>
/**
 * 单击切换开关：v-model 绑定布尔值，点击即切换。
 * 通过 disabled 可禁用（如总开关关闭时子功能不可单独操作）。
 */
const props = defineProps({
  modelValue: { type: Boolean, default: false },
  disabled: { type: Boolean, default: false }
})
const emit = defineEmits(['update:modelValue'])

function toggle() {
  if (props.disabled) return
  emit('update:modelValue', !props.modelValue)
}
</script>

<template>
  <button
    type="button"
    class="tgl"
    :class="{ on: modelValue, off: !modelValue, disabled }"
    role="switch"
    :aria-checked="modelValue"
    :disabled="disabled"
    @click="toggle"
  >
    <span class="tgl-track"><span class="tgl-knob"></span></span>
    <span class="tgl-text">{{ modelValue ? '启用中' : '已禁用' }}</span>
  </button>
</template>

<style scoped>
.tgl {
  display: inline-flex;
  align-items: center;
  gap: 0.55rem;
  border: none;
  background: transparent;
  cursor: pointer;
  padding: 0;
  font-family: inherit;
}
.tgl:disabled {
  cursor: not-allowed;
}
.tgl-track {
  position: relative;
  width: 2.5rem;
  height: 1.35rem;
  border-radius: 999px;
  background: var(--border);
  transition: background 0.18s ease;
  flex-shrink: 0;
}
.tgl-knob {
  position: absolute;
  top: 0.16rem;
  left: 0.16rem;
  width: 1.03rem;
  height: 1.03rem;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.28);
  transition: transform 0.18s ease;
}
.tgl.on .tgl-track {
  background: var(--primary);
}
.tgl.on .tgl-knob {
  transform: translateX(1.15rem);
}
.tgl-text {
  font-size: 0.85rem;
  color: var(--text-2);
  min-width: 3.4rem;
  text-align: left;
}
.tgl.on .tgl-text {
  color: var(--primary);
  font-weight: 600;
}
.tgl.disabled .tgl-track {
  opacity: 0.6;
}
.tgl.disabled .tgl-text {
  opacity: 0.6;
}
</style>
