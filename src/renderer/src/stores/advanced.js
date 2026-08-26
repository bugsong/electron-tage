import { defineStore } from 'pinia'
import { api } from '../api'

/**
 * 进阶功能全局控制 store
 * ------------------------------------------------------------
 * 统一控制所有进阶版模块的状态：
 *  - licensed：当前是否激活了进阶版（来自授权状态）
 *  - master  ：总开关「启用进阶版功能」，关闭后所有进阶能力回退普通版表现
 *  - features：各子功能的独立开关
 *
 * 某子功能的「实际生效」 = licensed && master && features[name]
 * 持久化到 settings 表，键名见 KEY_MAP。
 */

// 子功能默认状态（与产品草纸一致）
const DEFAULT_FEATURES = {
  memory: false, // 草纸·记忆功能：默认关闭
  brushColor: true, // 笔刷·颜色：默认开启
  brushSize: true, // 笔刷·粗细：默认开启
  eraserSize: false, // 橡皮·粗细：默认关闭
  eraserMode: true, // 橡皮·擦除方式：默认开启
  countdown: true // 倒计时：默认开启
}

const DEFAULT_MASTER = true

// settings 表键名
const KEY_MAP = {
  master: 'advMaster',
  memory: 'advMemory',
  brushColor: 'advBrushColor',
  brushSize: 'advBrushSize',
  eraserSize: 'advEraserSize',
  eraserMode: 'advEraserMode',
  countdown: 'advCountdown'
}

// 设置页展示用元数据（分组 + 文案），保持与草纸一致
export const FEATURE_GROUPS = [
  {
    group: '草纸',
    items: [{ key: 'memory', label: '记忆功能', desc: '持久保留做题痕迹，草纸笔迹可落库回顾' }]
  },
  {
    group: '笔刷',
    items: [
      { key: 'brushColor', label: '颜色', desc: '自由调节画笔颜色' },
      { key: 'brushSize', label: '粗细', desc: '自由调节画笔粗细' }
    ]
  },
  {
    group: '橡皮',
    items: [
      { key: 'eraserSize', label: '粗细', desc: '自由调节橡皮粗细' },
      { key: 'eraserMode', label: '擦除方式', desc: '像素擦除 / 整笔擦除' }
    ]
  },
  {
    group: '倒计时',
    items: [{ key: 'countdown', label: '倒计时', desc: '限定作答时间，到点自动交卷' }]
  }
]

export const useAdvancedStore = defineStore('advanced', {
  state: () => ({
    licensed: false,
    loaded: false,
    master: DEFAULT_MASTER,
    features: { ...DEFAULT_FEATURES }
  }),
  getters: {
    /** 进阶功能总开关是否生效（授权 + 总开关） */
    advancedOn: (s) => s.licensed && s.master,
    /** 某子功能是否实际生效：授权 && 总开关 && 子开关 */
    isOn: (s) => (name) => s.licensed && s.master && !!s.features[name]
  },
  actions: {
    /** 启动时加载一次：授权状态 + 各开关持久化值（幂等） */
    async load() {
      if (this.loaded) return
      try {
        const ls = await api.getLicenseStatus()
        this.licensed = !!(ls && ls.activated)
      } catch {
        this.licensed = false
      }
      try {
        const s = await api.getSettings()
        for (const key in KEY_MAP) {
          const raw = s[KEY_MAP[key]]
          if (raw === undefined || raw === null) continue
          const v = raw === '1' || raw === true || raw === 1
          if (key === 'master') this.master = v
          else if (this.features.hasOwnProperty(key)) this.features[key] = v
        }
      } catch {
        /* 保持默认值 */
      }
      this.loaded = true
    },
    async persist(key) {
      const dbKey = KEY_MAP[key]
      const val = key === 'master' ? this.master : this.features[key]
      try {
        await api.setSetting(dbKey, val ? '1' : '0')
      } catch {
        /* 忽略持久化失败 */
      }
    },
    /** 总开关：单击切换并持久化 */
    async toggleMaster() {
      this.master = !this.master
      await this.persist('master')
    },
    /** 子功能开关：单击切换并持久化；若当前总开关关闭，则同时开启总开关 */
    async toggleFeature(name) {
      if (!this.features.hasOwnProperty(name)) return
      if (!this.advancedOn && !this.features[name]) {
        this.master = true
        await this.persist('master')
      }
      this.features[name] = !this.features[name]
      await this.persist(name)
    }
  }
})
