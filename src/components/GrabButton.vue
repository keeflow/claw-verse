<script setup lang="ts">
import { computed } from 'vue'
import { useIsTouch } from '@/utils/device'

const props = defineProps<{
  disabled?: boolean
  grabbing?: boolean
  label?: string
}>()

const emit = defineEmits<{ (e: 'grab'): void }>()

/** 触屏上把「按空格」换成「轻触」，文案跟着操作方式走 */
const touch = useIsTouch()

const subLabel = computed(() => {
  if (props.grabbing) return 'PLEASE WAIT'
  if (props.disabled) return 'NO ATTEMPT LEFT'
  return touch.value ? 'TAP TO GRAB' : 'PRESS SPACE'
})

const hint = computed(() => {
  if (props.disabled) return '次数已用完'
  if (props.grabbing) return '机械爪动作中'
  return touch.value ? '对准物品后轻触' : '对准物品后按下'
})

function onClick() {
  if (props.disabled || props.grabbing) return
  emit('grab')
}
</script>

<template>
  <div class="flex flex-col items-center gap-2 no-select">
    <button
      type="button"
      class="grab-btn"
      :class="grabbing ? 'grab-btn-busy' : disabled ? 'grab-btn-off' : 'grab-btn-ready'"
      :disabled="disabled || grabbing"
      :aria-label="grabbing ? '抓取中' : '抓取'"
      @click="onClick"
    >
      <span class="relative z-10 flex flex-col items-center leading-none">
        <span class="grab-title text-[22px] font-bold tracking-[0.22em]">
          {{ grabbing ? '抓取中' : '抓 取' }}
        </span>
        <span class="mt-1 text-[10px] font-medium tracking-[0.16em] opacity-70">{{ subLabel }}</span>
      </span>
      <span class="grab-ring"></span>
    </button>
    <span class="text-[10px] tracking-[0.18em] text-slate-500">{{ hint }}</span>
  </div>
</template>

<style scoped>
.grab-btn {
  position: relative;
  width: 132px;
  height: 132px;
  border-radius: 999px;
  border: 2px solid rgba(255, 255, 255, 0.12);
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  /* 触屏：干掉双击缩放与长按选中，按下即时响应 */
  touch-action: manipulation;
  user-select: none;
  -webkit-user-select: none;
  transition:
    transform 0.1s ease,
    box-shadow 0.2s ease,
    filter 0.2s ease;
}

.grab-btn-ready {
  color: #260d16;
  background:
    radial-gradient(circle at 34% 26%, rgba(255, 255, 255, 0.85), rgba(255, 255, 255, 0) 46%),
    conic-gradient(from 200deg, #ff8fb4, #ff4d8d 40%, #ff2f7e 70%, #ff8fb4);
  box-shadow:
    0 0 0 6px rgba(255, 77, 141, 0.14),
    0 0 34px rgba(255, 77, 141, 0.55),
    inset 0 -6px 18px rgba(120, 0, 40, 0.35);
}

@media (hover: hover) and (pointer: fine) {
  .grab-btn-ready:hover {
    transform: translateY(-2px) scale(1.02);
    box-shadow:
      0 0 0 8px rgba(255, 77, 141, 0.18),
      0 0 46px rgba(255, 77, 141, 0.7),
      inset 0 -6px 18px rgba(120, 0, 40, 0.35);
  }
}

.grab-btn-ready:active {
  transform: translateY(2px) scale(0.97);
}

.grab-btn-busy {
  color: #06202b;
  background: linear-gradient(160deg, #8bf0ff, #29c9ec);
  box-shadow:
    0 0 0 6px rgba(56, 225, 255, 0.14),
    0 0 34px rgba(56, 225, 255, 0.5);
  cursor: wait;
}

.grab-btn-off {
  color: rgba(226, 232, 240, 0.5);
  background: linear-gradient(160deg, rgba(60, 70, 92, 0.7), rgba(28, 34, 48, 0.8));
  box-shadow: none;
  cursor: not-allowed;
}

.grab-ring {
  position: absolute;
  inset: 10px;
  border-radius: 999px;
  border: 1px dashed rgba(255, 255, 255, 0.35);
  pointer-events: none;
}

.grab-btn-busy .grab-ring {
  animation: ring-spin 1.6s linear infinite;
}

@keyframes ring-spin {
  to {
    transform: rotate(360deg);
  }
}

/*
 * 小屏 / 矮屏收起尺寸：手机上一个 132px 的圆钮会占掉太多画面，
 * 但依然保留 104px（拇指轻松覆盖，远大于 44px 的可点最小尺寸）。
 */
@media (max-width: 639px), (max-height: 560px) {
  .grab-btn {
    width: 104px;
    height: 104px;
  }

  .grab-title {
    font-size: 18px;
    letter-spacing: 0.16em;
  }

  .grab-ring {
    inset: 8px;
  }
}
</style>
