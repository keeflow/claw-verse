<script setup lang="ts">
import { computed } from 'vue'
import type { ClawMachineItem } from '@/types/claw-machine'
import { DIFFICULTY_LABEL, itemColor, itemThumbnail } from '@/utils/thumbnail'

const props = defineProps<{
  item: ClawMachineItem
  /** 该物品当前配置的抓取成功倾向，用于卡片预览 */
  difficultyHint?: string
}>()

const emit = defineEmits<{
  (e: 'edit'): void
  (e: 'remove'): void
  (e: 'toggle', value: boolean): void
  (e: 'duplicate'): void
}>()

const sizeText = computed(() => {
  const s = props.item.size
  if (!s) return '—'
  return `${s.x.toFixed(2)} × ${s.y.toFixed(2)} × ${s.z.toFixed(2)} m`
})

const weightHint = computed(() => {
  const w = props.item.weight
  if (w < 0.4) return '很轻'
  if (w < 0.55) return '适中'
  if (w < 0.8) return '偏重'
  return '很重'
})

const diffClass = computed(() => {
  switch (props.item.difficulty) {
    case 'easy':
      return 'bg-emerald-50 text-emerald-700 ring-emerald-200'
    case 'hard':
      return 'bg-rose-50 text-rose-700 ring-rose-200'
    default:
      return 'bg-sky-50 text-sky-700 ring-sky-200'
  }
})

const modelLabel = computed(() => {
  if (!props.item.modelUrl) return '内置模型'
  const seg = props.item.modelUrl.split('/').pop() || props.item.modelUrl
  return seg.length > 18 ? `${seg.slice(0, 16)}…` : seg
})

const barColor = computed(() => itemColor(props.item))
</script>

<template>
  <div
    class="group relative flex flex-col overflow-hidden rounded-2xl border bg-white transition-all duration-200"
    :class="
      item.enabled
        ? 'border-slate-200 shadow-[0_1px_2px_rgba(16,24,40,0.06)] hover:border-slate-300 hover:shadow-[0_12px_28px_-12px_rgba(16,24,40,0.22)]'
        : 'border-slate-200 bg-slate-50/70 opacity-70'
    "
  >
    <!-- 顶部色条 -->
    <div class="h-1 w-full" :style="{ background: item.enabled ? barColor : '#cbd5e1' }"></div>

    <div class="flex gap-3.5 p-4">
      <!-- 缩略图 -->
      <div
        class="relative flex h-[76px] w-[64px] flex-none items-center justify-center rounded-xl border border-slate-200 bg-gradient-to-b from-slate-50 to-slate-100"
      >
        <img :src="itemThumbnail(item)" class="h-[62px] w-[52px] object-contain" alt="" />
        <span
          v-if="!item.enabled"
          class="absolute inset-0 flex items-center justify-center rounded-xl bg-white/70 text-[10px] font-medium text-slate-500"
        >
          已停用
        </span>
      </div>

      <!-- 信息 -->
      <div class="min-w-0 flex-1">
        <div class="flex items-start justify-between gap-2">
          <h3 class="truncate text-[15px] font-semibold text-slate-900">{{ item.name }}</h3>
          <span
            class="tabular flex-none rounded-md px-1.5 py-0.5 text-[11px] font-semibold"
            :class="item.quantity > 0 ? 'bg-slate-100 text-slate-600' : 'bg-amber-50 text-amber-600'"
          >
            ×{{ item.quantity }}
          </span>
        </div>

        <div class="mt-1.5 flex flex-wrap items-center gap-1.5">
          <span class="rounded-md px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-inset" :class="diffClass">
            {{ DIFFICULTY_LABEL[item.difficulty] }}
          </span>
          <span class="rounded-md bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-600">
            {{ item.weight.toFixed(2) }} kg · {{ weightHint }}
          </span>
          <span
            class="rounded-md px-1.5 py-0.5 text-[11px]"
            :class="item.positionMode === 'fixed' ? 'bg-violet-50 text-violet-700' : 'bg-slate-100 text-slate-600'"
          >
            {{ item.positionMode === 'fixed' ? '指定位置' : '随机位置' }}
          </span>
        </div>

        <dl class="mt-2 space-y-0.5 text-[11px] text-slate-500">
          <div class="flex gap-1.5">
            <dt class="flex-none text-slate-400">尺寸</dt>
            <dd class="tabular truncate">{{ sizeText }}</dd>
          </div>
          <div class="flex gap-1.5">
            <dt class="flex-none text-slate-400">模型</dt>
            <dd class="truncate" :title="item.modelUrl || '内置模型'">{{ modelLabel }}</dd>
          </div>
        </dl>

        <p v-if="difficultyHint" class="mt-1.5 text-[11px] text-slate-400">{{ difficultyHint }}</p>
      </div>
    </div>

    <!-- 操作 -->
    <div class="mt-auto flex items-center justify-between gap-2 border-t border-slate-100 px-3 py-2.5">
      <label class="flex cursor-pointer items-center gap-2 text-[12px] text-slate-600">
        <button
          type="button"
          role="switch"
          :aria-checked="item.enabled"
          class="relative h-5 w-9 rounded-full transition-colors"
          :class="item.enabled ? 'bg-emerald-500' : 'bg-slate-300'"
          @click="emit('toggle', !item.enabled)"
        >
          <span
            class="absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform"
            :style="{ left: item.enabled ? '18px' : '2px' }"
          ></span>
        </button>
        {{ item.enabled ? '已启用' : '已停用' }}
      </label>

      <div class="flex items-center gap-1">
        <button
          class="flex h-9 w-9 items-center justify-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
          title="复制"
          aria-label="复制"
          @click="emit('duplicate')"
        >
          <svg viewBox="0 0 20 20" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="1.6">
            <rect x="7" y="7" width="9" height="9" rx="2" />
            <path d="M13 4H6a2 2 0 0 0-2 2v7" stroke-linecap="round" />
          </svg>
        </button>
        <button
          class="flex h-9 w-9 items-center justify-center rounded-lg text-slate-400 transition hover:bg-blue-50 hover:text-blue-600"
          title="编辑"
          aria-label="编辑"
          @click="emit('edit')"
        >
          <svg viewBox="0 0 20 20" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="1.6">
            <path d="M13.6 3.4l3 3L7.5 15.5 4 16l.5-3.5z" stroke-linejoin="round" />
          </svg>
        </button>
        <button
          class="flex h-9 w-9 items-center justify-center rounded-lg text-slate-400 transition hover:bg-rose-50 hover:text-rose-600"
          title="删除"
          aria-label="删除"
          @click="emit('remove')"
        >
          <svg viewBox="0 0 20 20" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="1.6">
            <path d="M4 6h12M8 6V4.5h4V6M6.5 6l.6 9.2A1.5 1.5 0 0 0 8.6 16.7h2.8a1.5 1.5 0 0 0 1.5-1.5L13.5 6" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        </button>
      </div>
    </div>
  </div>
</template>
