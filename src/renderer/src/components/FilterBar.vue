<script setup>
import { computed } from 'vue'

/**
 * 通用筛选栏：搜索框 + 分类下拉 + 搜索 + 重置，带 extra 插槽给 QuestionsView 的超集控件。
 * 原 WrongView / FavoritesView / NotesView 三份一模一样的筛选栏、QuestionsView 的超集，统一到此。
 */
const props = defineProps({
  keyword: { type: String, default: '' },
  categoryId: { type: String, default: '' },
  catOptions: { type: Array, default: () => [] },
  allLabel: { type: String, default: '全部分类' },
  withTotal: { type: Boolean, default: false }
})
const emit = defineEmits(['update:keyword', 'update:categoryId', 'search', 'reset'])

const keyword = computed({
  get: () => props.keyword,
  set: (v) => emit('update:keyword', v)
})
const categoryId = computed({
  get: () => props.categoryId,
  set: (v) => emit('update:categoryId', v)
})

function onReset() {
  emit('update:keyword', '')
  emit('update:categoryId', '')
  emit('reset')
}
</script>

<template>
  <div class="filter-bar">
    <input
      v-model="keyword"
      class="input filter-search"
      placeholder="搜索题干…"
      @keyup.enter="$emit('search')"
    />
    <select v-model="categoryId" class="select filter-cat" @change="$emit('search')">
      <option value="">{{ allLabel }}</option>
      <option v-for="c in catOptions" :key="c.id" :value="c.id">
        {{ c.name }}<template v-if="withTotal && c.total != null">（{{ c.total }}）</template>
      </option>
    </select>
    <button class="btn" @click="$emit('search')">搜索</button>
    <button class="btn" @click="onReset">重置</button>
    <slot name="extra" />
  </div>
</template>

<style scoped>
.filter-bar {
  display: flex;
  gap: 0.6rem;
  margin-bottom: 1rem;
  flex-wrap: wrap;
}
.filter-search {
  width: 16rem;
}
.filter-cat {
  width: 15rem;
}
</style>
