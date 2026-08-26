import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import router from './router'
import { useSettingsStore } from './stores/settings'
import { useAdvancedStore } from './stores/advanced'
import { initRendererAntiDebug } from './utils/anti-debug'
import './assets/base.css'

// 反调试：必须在应用挂载前启动，尽早拦截调试行为
initRendererAntiDebug()

const app = createApp(App)
const pinia = createPinia()
app.use(pinia)
app.use(router)
app.mount('#app')

// 启动即加载设置并应用主题/字号
useSettingsStore(pinia).load()
// 加载进阶功能开关（授权 + 各子功能状态），供全局统一控制
const advStore = useAdvancedStore(pinia)
advStore.load()
// 订阅主进程授权变化事件，授权状态改变时 store 自动刷新，所有消费方响应式更新
advStore.subscribe()
