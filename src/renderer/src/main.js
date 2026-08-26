import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import router from './router'
import { useSettingsStore } from './stores/settings'
import { useAdvancedStore } from './stores/advanced'
import './assets/base.css'

const app = createApp(App)
const pinia = createPinia()
app.use(pinia)
app.use(router)
app.mount('#app')

// 启动即加载设置并应用主题/字号
useSettingsStore(pinia).load()
// 加载进阶功能开关（授权 + 各子功能状态），供全局统一控制
useAdvancedStore(pinia).load()
