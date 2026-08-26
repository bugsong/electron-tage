import { ref } from 'vue'
import { api } from '../api'
import { useToastStore } from '../stores/toast'

/**
 * 收藏状态 + 切换逻辑
 * 原 SessionView / ReviewView 各写了一份相同的 favorites Set 与 toggleFavorite，统一到此。
 */
export function useFavorites() {
  const favorites = ref(new Set())
  const toast = useToastStore()

  async function loadFavorites() {
    try {
      const favs = await api.listFavorites()
      favorites.value = new Set(favs.map((f) => f.questionId))
    } catch {}
  }

  async function toggleFavorite(q) {
    try {
      const fav = await api.toggleFavorite(q.id)
      const s = new Set(favorites.value)
      if (fav) s.add(q.id)
      else s.delete(q.id)
      favorites.value = s
      toast.success(fav ? '已收藏' : '已取消收藏')
    } catch (err) {
      toast.error('操作失败：' + (err.message || err))
    }
  }

  return { favorites, loadFavorites, toggleFavorite }
}
