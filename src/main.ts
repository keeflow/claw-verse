import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import router from './router'
import './style.css'

const app = createApp(App)

app.use(createPinia())
app.use(router)

// 全局兜底：单个组件异常不应该让整页白屏
app.config.errorHandler = (err, _instance, info) => {
  console.error('[ClawVerse] 未捕获的组件异常：', err, info)
}

app.mount('#app')
