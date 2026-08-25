import { defineStore } from 'pinia'
import { api } from '../api'

export const FONT_SIZES = [
  { key: 'small', label: '小', px: 14 },
  { key: 'normal', label: '标准', px: 16 },
  { key: 'large', label: '大', px: 18 },
  { key: 'xlarge', label: '特大', px: 20 }
]

export const useSettingsStore = defineStore('settings', {
  state: () => ({
    fontSize: 'normal',
    theme: 'light',
    loaded: false
  }),
  actions: {
    async load() {
      try {
        const s = await api.getSettings()
        this.fontSize = s.fontSize || 'normal'
        this.theme = s.theme || 'light'
      } catch {
        /* 默认值兜底 */
      }
      this.apply()
      this.loaded = true
    },
    apply() {
      document.documentElement.dataset.theme = this.theme
      document.documentElement.dataset.fontSize = this.fontSize
    },
    async setFontSize(v) {
      this.fontSize = v
      this.apply()
      await api.setSetting('fontSize', v)
    },
    async setTheme(v) {
      this.theme = v
      this.apply()
      await api.setSetting('theme', v)
    }
  }
})
