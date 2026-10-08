<script setup lang="ts">
import { computed } from 'vue'
import { itemThumbnail } from '@/utils/thumbnail'

const props = defineProps<{
  attempts: number
  attemptsPerGame: number
  totalAttempts: number
  successCount: number
  remainingItems: number
  rewards: { itemId: string; itemName: string; count: number }[]
  grabbing: boolean
}>()

const rate = computed(() => {
  if (props.totalAttempts === 0) return '—'
  return `${Math.round((props.successCount / props.totalAttempts) * 100)}%`
})

const lowAttempts = computed(() => props.attempts > 0 && props.attempts <= 2)
const empty = computed(() => props.attempts <= 0)
</script>

<template>
  <div class="glass-panel grid-clip pointer-events-auto w-[268px] rounded-xl px-4 py-3 text-slate-200">
    <div class="flex items-center justify-between">
      <span class="text-[11px] font-medium tracking-[0.2em] text-slate-400">剩余次数</span>
      <span
        class="text-[11px] font-medium tracking-wider"
        :class="empty ? 'text-rose-400' : lowAttempts ? 'text-amber-300' : 'text-emerald-300'"
      >
        {{ empty ? '次数已用完' : grabbing ? '抓取中…' : '可抓取' }}
      </span>
    </div>

    <div class="mt-1 flex items-end gap-2">
      <span
        class="tabular neon-text text-4xl font-bold leading-none"
        :class="empty ? 'text-rose-400' : 'text-arcade-cyan'"
      >
        {{ attempts }}
      </span>
      <span class="tabular pb-0.5 text-sm text-slate-400">/ {{ attemptsPerGame }}</span>
    </div>

    <div class="mt-3 grid grid-cols-3 gap-2 border-t border-white/8 pt-3">
      <div>
        <div class="text-[10px] tracking-wider text-slate-500">尝试</div>
        <div class="tabular text-lg font-semibold text-slate-100">{{ totalAttempts }}</div>
      </div>
      <div>
        <div class="text-[10px] tracking-wider text-slate-500">成功</div>
        <div class="tabular text-lg font-semibold text-emerald-300">{{ successCount }}</div>
      </div>
      <div>
        <div class="text-[10px] tracking-wider text-slate-500">命中率</div>
        <div class="tabular text-lg font-semibold text-arcade-gold">{{ rate }}</div>
      </div>
    </div>

    <div class="mt-3 flex items-center justify-between border-t border-white/8 pt-2.5">
      <span class="text-[10px] tracking-wider text-slate-500">机器内剩余</span>
      <span class="tabular text-xs font-medium text-slate-300">{{ remainingItems }} 件</span>
    </div>

    <div v-if="rewards.length" class="mt-2.5 border-t border-white/8 pt-2.5">
      <div class="mb-1.5 text-[10px] tracking-wider text-slate-500">已获得</div>
      <div class="flex flex-wrap gap-1.5">
        <div
          v-for="r in rewards.slice(0, 8)"
          :key="r.itemId"
          class="flex items-center gap-1 rounded-md border border-white/10 bg-white/5 px-1.5 py-1"
          :title="`${r.itemName} × ${r.count}`"
        >
          <img :src="itemThumbnail({ id: r.itemId, name: r.itemName })" class="h-4 w-3.5 object-contain" alt="" />
          <span class="tabular text-[11px] font-semibold text-slate-200">×{{ r.count }}</span>
        </div>
      </div>
    </div>
  </div>
</template>
