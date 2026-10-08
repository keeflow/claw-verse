<script setup lang="ts">
const props = defineProps<{
  disabled?: boolean
  grabbing?: boolean
  label?: string
}>()

const emit = defineEmits<{ (e: 'grab'): void }>()

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
      @click="onClick"
    >
      <span class="relative z-10 flex flex-col items-center leading-none">
        <span class="text-[22px] font-bold tracking-[0.22em]">{{ grabbing ? '抓取中' : '抓 取' }}</span>
        <span class="mt-1 text-[10px] font-medium tracking-[0.16em] opacity-70">
          {{ grabbing ? 'PLEASE WAIT' : 'PRESS SPACE' }}
        </span>
      </span>
      <span class="grab-ring"></span>
    </button>
    <span class="text-[10px] tracking-[0.18em] text-slate-500">
      {{ disabled ? '次数已用完' : grabbing ? '机械爪动作中' : '对准物品后按下' }}
    </span>
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

.grab-btn-ready:hover {
  transform: translateY(-2px) scale(1.02);
  box-shadow:
    0 0 0 8px rgba(255, 77, 141, 0.18),
    0 0 46px rgba(255, 77, 141, 0.7),
    inset 0 -6px 18px rgba(120, 0, 40, 0.35);
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
</style>
