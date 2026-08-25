import { defineStore } from 'pinia'

let seed = 0

export const useToastStore = defineStore('toast', {
  state: () => ({ list: [] }),
  actions: {
    show(message, type = 'info', duration = 2600) {
      const id = ++seed
      this.list.push({ id, message, type })
      setTimeout(() => this.remove(id), duration)
    },
    success(message) {
      this.show(message, 'success')
    },
    error(message) {
      this.show(message, 'error', 3600)
    },
    remove(id) {
      this.list = this.list.filter((t) => t.id !== id)
    }
  }
})
