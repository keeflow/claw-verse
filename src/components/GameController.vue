<script setup lang="ts">
import { computed } from 'vue'
import DirectionController from './DirectionController.vue'
import GrabButton from './GrabButton.vue'

const props = defineProps<{
  disabled?: boolean
  grabbing?: boolean
  attempts: number
  keyboardDir?: { x: number; z: number }
  keyboardActive?: boolean
}>()

const emit = defineEmits<{
  (e: 'direction', payload: { x: number; z: number }): void
  (e: 'grab'): void
}>()

const controlDisabled = computed(() => props.disabled || props.grabbing)
</script>

<template>
  <div
    class="glass-panel pointer-events-auto flex flex-wrap items-end justify-between gap-5 rounded-2xl px-6 py-4"
  >
    <DirectionController
      :disabled="controlDisabled"
      :keyboard-dir="keyboardDir"
      @direction="(p) => emit('direction', p)"
    />

    <div class="flex flex-col items-center gap-2 px-1">
      <div class="flex items-center gap-3 text-[10px] tracking-wider text-slate-500">
        <span class="kbd">W</span><span class="kbd">A</span><span class="kbd">S</span><span class="kbd">D</span>
        <span class="text-slate-600">/</span>
        <span class="kbd">↑</span><span class="kbd">←</span><span class="kbd">↓</span><span class="kbd">→</span>
        <span class="text-slate-600">移动</span>
      </div>
      <GrabButton :disabled="disabled" :grabbing="grabbing" @grab="emit('grab')" />
    </div>

    <div class="hidden w-[136px] flex-col gap-1.5 text-[11px] leading-relaxed text-slate-400 lg:flex">
      <div class="flex justify-between">
        <span>空格 / 回车</span><span class="text-slate-300">抓取</span>
      </div>
      <div class="flex justify-between">
        <span>R</span><span class="text-slate-300">重置视角</span>
      </div>
      <div class="flex justify-between">
        <span>拖拽画面</span><span class="text-slate-300">微调视角</span>
      </div>
      <div class="mt-1 border-t border-white/8 pt-1.5">
        剩余 <span class="tabular font-semibold text-arcade-gold">{{ attempts }}</span> 次机会
      </div>
    </div>
  </div>
</template>

<style scoped>
.kbd {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border-radius: 5px;
  font-size: 10px;
  color: rgb(203 213 225);
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.12);
}
</style>
