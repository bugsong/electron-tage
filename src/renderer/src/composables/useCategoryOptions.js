import { ref } from 'vue'
import { api } from '../api'

/**
 * 分类树拍平成下拉选项
 * 原 WrongView / FavoritesView / NotesView / QuestionsView 各写了一份相同的 loadCats，统一到此。
 *
 * @param {object}  opts
 * @param {boolean} opts.withTotal 选项是否带题量（QuestionsView 用）
 * @param {boolean} opts.indent    子分类名是否加「　父 › 子」缩进（Wrong/Fav/Notes 用）
 */
export function useCategoryOptions(opts = {}) {
  const { withTotal = false, indent = false } = opts
  const catOptions = ref([])
  const rawTree = ref([])

  async function loadCats() {
    try {
      const tree = await api.categoryTree()
      rawTree.value = tree
      const flat = []
      for (const n of tree) {
        flat.push(mk(n.id, n.name, withTotal ? n.total : undefined))
        for (const c of n.children) {
          const name = (indent ? '　' : '') + n.name + ' › ' + c.name
          flat.push(mk(c.id, name, withTotal ? c.total : undefined))
        }
      }
      catOptions.value = flat
    } catch {}
  }

  function mk(id, name, total) {
    return total !== undefined ? { id, name, total } : { id, name }
  }

  return { catOptions, rawTree, loadCats }
}
