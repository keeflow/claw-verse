import { createRouter, createWebHashHistory, type RouteRecordRaw } from 'vue-router'

const routes: RouteRecordRaw[] = [
  { path: '/', redirect: '/game' },
  {
    path: '/game',
    name: 'game',
    component: () => import('@/views/Game/index.vue'),
    meta: { title: '3D 抓娃娃机' },
  },
  {
    path: '/settings',
    name: 'settings',
    component: () => import('@/views/Settings/index.vue'),
    meta: { title: '娃娃机设置' },
  },
  { path: '/:pathMatch(.*)*', redirect: '/game' },
]

export const router = createRouter({
  // GitHub Pages 是纯静态托管，没有服务端 rewrite：使用 hash 模式，
  // 刷新 / 直接访问子路由（如 /#/settings）都能正常命中，无需 404 兜底。
  history: createWebHashHistory(import.meta.env.BASE_URL),
  routes,
  scrollBehavior: () => ({ top: 0 }),
})

router.afterEach((to) => {
  const base = '娃娃乐园'
  document.title = to.meta?.title ? `${to.meta.title as string} · ${base}` : base
})

export default router
