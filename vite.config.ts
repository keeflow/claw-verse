import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  // GitHub Pages 部署在 https://keeflow.github.io/claw-verse/ 子路径下，
  // 资源引用必须带上前缀；本地 dev / preview 同样按此前缀服务，保证环境一致。
  base: '/claw-verse/',
  plugins: [vue(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    host: '127.0.0.1',
  },
  // Rapier 的 wasm 体积较大，单独拆包，避免 build 警告淹没其他信息
  build: {
    chunkSizeWarningLimit: 2500,
  },
})
