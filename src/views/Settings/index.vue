<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { storeToRefs } from 'pinia'
import { useClawMachineStore } from '@/stores/clawMachine'
import type { ClawMachineItem } from '@/types/claw-machine'
import { createItemId, MAX_TOTAL_ITEMS } from '@/utils/storage'
import ItemCard from '@/components/ItemCard.vue'
import ItemEditor from '@/components/ItemEditor.vue'

const router = useRouter()
const store = useClawMachineStore()
const { items } = storeToRefs(store)

const editorOpen = ref(false)
const editing = ref<ClawMachineItem | null>(null)
const toast = ref('')
const search = ref('')
const difficultyFilter = ref<'all' | 'easy' | 'normal' | 'hard'>('all')
const statusFilter = ref<'all' | 'enabled' | 'disabled'>('all')
const sortBy = ref<'default' | 'quantity' | 'weight' | 'name'>('default')

const confirmState = ref<{
  open: boolean
  title: string
  message: string
  confirmText: string
  danger: boolean
  action: (() => void) | null
}>({
  open: false,
  title: '',
  message: '',
  confirmText: '确认',
  danger: false,
  action: null,
})

onMounted(() => {
  store.hydrate()
})

/* ------------------------------------------------------------------ */
/* 统计                                                                */
/* ------------------------------------------------------------------ */
const enabledCount = computed(() => items.value.filter((i) => i.enabled).length)
const totalCount = computed(() => items.value.reduce((n, i) => n + (i.enabled ? i.quantity : 0), 0))
const overLimit = computed(() => totalCount.value > MAX_TOTAL_ITEMS)

/** 每个物品在“完美对位”情况下的估计成功率，用于卡片提示 */
function estimate(item: ClawMachineItem): string {
  const diff = item.difficulty === 'easy' ? 1 : item.difficulty === 'hard' ? 0.74 : 0.88
  const weight = Math.min(1, Math.max(0.42, 1.15 - item.weight * 0.8))
  const size = Math.min(1, Math.max(0.08, 1 - Math.abs((item.size ? item.size.x / 2 : 0.12) / 0.3 - 0.75) / 0.85))
  const p = Math.round(diff * weight * size * 100)
  return `对准后约 ${p}% 把握`
}

/* ------------------------------------------------------------------ */
/* 筛选 / 排序                                                          */
/* ------------------------------------------------------------------ */
const visibleItems = computed(() => {
  const kw = search.value.trim().toLowerCase()
  let list = items.value.filter((it) => {
    if (kw && !it.name.toLowerCase().includes(kw)) return false
    if (difficultyFilter.value !== 'all' && it.difficulty !== difficultyFilter.value) return false
    if (statusFilter.value === 'enabled' && !it.enabled) return false
    if (statusFilter.value === 'disabled' && it.enabled) return false
    return true
  })

  if (sortBy.value === 'quantity') list = [...list].sort((a, b) => b.quantity - a.quantity)
  else if (sortBy.value === 'weight') list = [...list].sort((a, b) => a.weight - b.weight)
  else if (sortBy.value === 'name') list = [...list].sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'))
  return list
})

/* ------------------------------------------------------------------ */
/* 操作                                                                */
/* ------------------------------------------------------------------ */
function showToast(msg: string) {
  toast.value = msg
  window.setTimeout(() => {
    if (toast.value === msg) toast.value = ''
  }, 2400)
}

function openAdd() {
  editing.value = null
  editorOpen.value = true
}

function openEdit(item: ClawMachineItem) {
  editing.value = item
  editorOpen.value = true
}

function onSave(item: ClawMachineItem) {
  if (editing.value) {
    store.updateItem(editing.value.id, item)
    showToast(`已保存「${item.name}」`)
  } else {
    store.addItem({ ...item, id: item.id || createItemId() })
    showToast(`已添加「${item.name}」`)
  }
  editorOpen.value = false
  editing.value = null
}

function onDuplicate(item: ClawMachineItem) {
  const copy: ClawMachineItem = {
    ...item,
    id: createItemId(),
    name: `${item.name} 副本`,
    size: item.size ? { ...item.size } : undefined,
    position: item.position ? { ...item.position } : undefined,
    rotation: item.rotation ? { ...item.rotation } : undefined,
  }
  store.addItem(copy)
  showToast(`已复制「${item.name}」`)
}

function askRemove(item: ClawMachineItem) {
  confirmState.value = {
    open: true,
    title: '删除物品',
    message: `确定要删除「${item.name}」吗？保存后该物品将不再出现在娃娃机内。`,
    confirmText: '删除',
    danger: true,
    action: () => {
      store.removeItem(item.id)
      showToast(`已删除「${item.name}」`)
    },
  }
}

function askReset() {
  confirmState.value = {
    open: true,
    title: '恢复默认设置',
    message: '将把娃娃机物品恢复为系统默认的 6 种物品，当前的所有修改都会丢失。',
    confirmText: '恢复默认',
    danger: true,
    action: () => {
      store.resetToDefaults()
      showToast('已恢复默认物品配置')
    },
  }
}

function runConfirm() {
  confirmState.value.action?.()
  confirmState.value.open = false
  confirmState.value.action = null
}

function goGame() {
  router.push('/game')
}
</script>

<template>
  <div class="min-h-full bg-slate-50">
    <!-- 顶栏 -->
    <header class="sticky top-0 z-30 border-b border-slate-200 bg-white/90 backdrop-blur">
      <div class="mx-auto flex max-w-[1440px] flex-wrap items-center justify-between gap-3 px-4 py-3.5 sm:px-6">
        <div class="flex items-center gap-3">
          <div
            class="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-cyan-400 to-sky-500 text-[16px] shadow-sm"
          >
            🕹️
          </div>
          <div class="leading-tight">
            <h1 class="text-[15px] font-semibold text-slate-900">娃娃机设置</h1>
            <p class="text-[11.5px] text-slate-500">管理机器内部的物品、物理与抓取参数</p>
          </div>
        </div>

        <div class="flex w-full items-center justify-between gap-2 sm:w-auto sm:justify-end">
          <span class="hidden text-[11px] text-slate-400 lg:inline">修改会自动保存到浏览器本地</span>
          <button
            class="rounded-lg border border-slate-300 bg-white px-3 py-2 text-[12.5px] font-medium text-slate-700 transition hover:bg-slate-50 sm:px-3.5"
            @click="askReset"
          >
            恢复默认设置
          </button>
          <button
            class="rounded-lg bg-blue-600 px-3 py-2 text-[12.5px] font-semibold text-white shadow-sm transition hover:bg-blue-700 sm:px-3.5"
            @click="goGame"
          >
            进入游戏
          </button>
        </div>
      </div>
    </header>

    <main class="pb-safe-lg mx-auto max-w-[1440px] px-4 pt-5 sm:px-6 sm:pt-6">
      <!-- 统计 -->
      <section class="mb-5 grid grid-cols-2 gap-3 sm:mb-6 lg:grid-cols-4">
        <div class="rounded-2xl border border-slate-200 bg-white p-4">
          <div class="text-[11.5px] text-slate-500">物品种类</div>
          <div class="tabular mt-1 text-2xl font-semibold text-slate-900">{{ items.length }}</div>
          <div class="mt-0.5 text-[11px] text-slate-400">其中启用 {{ enabledCount }} 种</div>
        </div>
        <div class="rounded-2xl border border-slate-200 bg-white p-4">
          <div class="text-[11.5px] text-slate-500">预计生成</div>
          <div
            class="tabular mt-1 text-2xl font-semibold"
            :class="overLimit ? 'text-amber-600' : 'text-slate-900'"
          >
            {{ totalCount }}
          </div>
          <div class="mt-0.5 text-[11px]" :class="overLimit ? 'text-amber-600' : 'text-slate-400'">
            {{ overLimit ? `超出上限，游戏内仅生成 ${MAX_TOTAL_ITEMS} 件` : `上限 ${MAX_TOTAL_ITEMS} 件` }}
          </div>
        </div>
        <div class="rounded-2xl border border-slate-200 bg-white p-4">
          <div class="text-[11.5px] text-slate-500">难度分布</div>
          <div class="mt-1.5 flex items-end gap-3">
            <span class="tabular text-lg font-semibold text-emerald-600">
              {{ items.filter((i) => i.difficulty === 'easy').length }}
            </span>
            <span class="tabular text-lg font-semibold text-sky-600">
              {{ items.filter((i) => i.difficulty === 'normal').length }}
            </span>
            <span class="tabular text-lg font-semibold text-rose-600">
              {{ items.filter((i) => i.difficulty === 'hard').length }}
            </span>
          </div>
          <div class="mt-0.5 flex gap-3 text-[11px] text-slate-400">
            <span>简单</span><span>普通</span><span>困难</span>
          </div>
        </div>
        <div class="rounded-2xl border border-slate-200 bg-white p-4">
          <div class="text-[11.5px] text-slate-500">单局抓取次数</div>
          <div class="mt-1 flex items-center gap-2">
            <input
              :value="store.attemptsPerGame"
              type="number"
              min="1"
              max="99"
              class="tabular w-20 rounded-lg border border-slate-300 px-2.5 py-1.5 text-[14px] font-semibold text-slate-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/15"
              @input="
                store.attemptsPerGame = Math.min(99, Math.max(1, ($event.target as HTMLInputElement).valueAsNumber || 1));
                store.touchConfig()
              "
            />
            <span class="text-[11.5px] text-slate-400">次 / 局</span>
          </div>
        </div>
      </section>

      <!-- 工具栏 -->
      <section class="mb-4 flex flex-wrap items-center gap-2.5">
        <div class="relative w-full sm:w-auto">
          <svg
            viewBox="0 0 20 20"
            class="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
            fill="none"
            stroke="currentColor"
            stroke-width="1.7"
          >
            <circle cx="9" cy="9" r="5.5" />
            <path d="M13.2 13.2 17 17" stroke-linecap="round" />
          </svg>
          <input
            v-model="search"
            type="text"
            placeholder="搜索物品名称"
            class="w-full rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-3 text-[12.5px] text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/15 sm:w-56"
          />
        </div>

        <select
          v-model="difficultyFilter"
          class="min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-[12.5px] text-slate-700 outline-none focus:border-blue-500 sm:flex-none"
        >
          <option value="all">全部难度</option>
          <option value="easy">简单</option>
          <option value="normal">普通</option>
          <option value="hard">困难</option>
        </select>

        <select
          v-model="statusFilter"
          class="min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-[12.5px] text-slate-700 outline-none focus:border-blue-500 sm:flex-none"
        >
          <option value="all">全部状态</option>
          <option value="enabled">仅已启用</option>
          <option value="disabled">仅已停用</option>
        </select>

        <select
          v-model="sortBy"
          class="min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-[12.5px] text-slate-700 outline-none focus:border-blue-500 sm:flex-none"
        >
          <option value="default">默认顺序</option>
          <option value="quantity">按数量</option>
          <option value="weight">按重量</option>
          <option value="name">按名称</option>
        </select>

        <div class="flex w-full items-center justify-between gap-2 sm:ml-auto sm:w-auto sm:justify-end">
          <span class="tabular text-[12px] text-slate-500">共 {{ visibleItems.length }} / {{ items.length }} 项</span>
          <button
            class="flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-[12.5px] font-semibold text-white shadow-sm transition hover:bg-blue-700"
            @click="openAdd"
          >
            <span class="text-[15px] leading-none">+</span> 添加物品
          </button>
        </div>
      </section>

      <!-- 列表 -->
      <section v-if="visibleItems.length" class="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
        <ItemCard
          v-for="item in visibleItems"
          :key="item.id"
          :item="item"
          :difficulty-hint="estimate(item)"
          @edit="openEdit(item)"
          @remove="askRemove(item)"
          @duplicate="onDuplicate(item)"
          @toggle="(v) => store.toggleItem(item.id, v)"
        />
      </section>

      <section
        v-else
        class="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-white py-20 text-center"
      >
        <div class="text-[36px]">📦</div>
        <h3 class="mt-3 text-[15px] font-semibold text-slate-800">
          {{ items.length ? '没有符合条件的物品' : '还没有任何物品' }}
        </h3>
        <p class="mt-1 text-[12.5px] text-slate-500">
          {{ items.length ? '试着调整搜索或筛选条件' : '添加物品后，娃娃机内部就会按配置生成它们' }}
        </p>
        <button
          class="mt-4 rounded-lg bg-blue-600 px-4 py-2 text-[12.5px] font-semibold text-white transition hover:bg-blue-700"
          @click="openAdd"
        >
          添加第一个物品
        </button>
      </section>
    </main>

    <!-- 编辑器 -->
    <ItemEditor :open="editorOpen" :item="editing" @close="editorOpen = false" @save="onSave" />

    <!-- 确认弹窗 -->
    <Teleport to="body">
      <Transition name="fade">
        <div
          v-if="confirmState.open"
          class="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 px-4 backdrop-blur-[2px]"
          @click.self="confirmState.open = false"
        >
          <div class="animate-pop-in w-full max-w-[400px] rounded-2xl bg-white p-6 shadow-2xl">
            <h3 class="text-[16px] font-semibold text-slate-900">{{ confirmState.title }}</h3>
            <p class="mt-2 text-[13px] leading-relaxed text-slate-600">{{ confirmState.message }}</p>
            <div class="mt-5 flex justify-end gap-2.5">
              <button
                class="rounded-lg border border-slate-300 px-4 py-2 text-[13px] font-medium text-slate-700 transition hover:bg-slate-50"
                @click="confirmState.open = false"
              >
                取消
              </button>
              <button
                class="rounded-lg px-4 py-2 text-[13px] font-semibold text-white transition"
                :class="confirmState.danger ? 'bg-rose-600 hover:bg-rose-700' : 'bg-blue-600 hover:bg-blue-700'"
                @click="runConfirm"
              >
                {{ confirmState.confirmText }}
              </button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- 保存提示 -->
    <Transition name="fade">
      <div
        v-if="toast"
        class="bottom-safe fixed left-1/2 z-50 -translate-x-1/2 rounded-xl bg-slate-900 px-4 py-2.5 text-[12.5px] font-medium text-white shadow-lg"
      >
        {{ toast }}
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
