<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useIsNarrow, vibrate } from '@/utils/device'

const props = defineProps<{
  disabled?: boolean
  /** 键盘方向，用于高亮对应的箭头，并让摇杆头跟着偏移 */
  keyboardDir?: { x: number; z: number }
}>()

const emit = defineEmits<{
  (e: 'direction', payload: { x: number; z: number }): void
}>()

/* ------------------------------------------------------------------ */
/* 十字方向键：按住持续移动                                             */
/* ------------------------------------------------------------------ */
const held = reactive<Record<string, boolean>>({ up: false, down: false, left: false, right: false })

function emitHeld() {
  if (props.disabled) return
  const x = (held.right ? 1 : 0) + (held.left ? -1 : 0)
  const z = (held.down ? 1 : 0) + (held.up ? -1 : 0)
  emit('direction', { x, z })
}

function pressKey(k: 'up' | 'down' | 'left' | 'right') {
  if (props.disabled) return
  if (!held[k]) vibrate(8)
  held[k] = true
  emitHeld()
}

function releaseKey(k: 'up' | 'down' | 'left' | 'right') {
  if (!held[k]) return
  held[k] = false
  emitHeld()
}

function releaseAll() {
  let changed = false
  for (const k of ['up', 'down', 'left', 'right'] as const) {
    if (held[k]) {
      held[k] = false
      changed = true
    }
  }
  if (changed) emitHeld()
  resetKnob()
}

const anyHeld = () => Object.values(held).some(Boolean)

const arrowActive = (k: 'up' | 'down' | 'left' | 'right') => {
  if (held[k]) return true
  const d = props.keyboardDir
  if (!d) return false
  if (k === 'up') return d.z < 0
  if (k === 'down') return d.z > 0
  if (k === 'left') return d.x < 0
  return d.x > 0
}

/* ------------------------------------------------------------------ */
/* 摇杆：拖动得到归一化方向                                             */
/* ------------------------------------------------------------------ */
/** 手机竖屏把摇杆放大：手指按上去更稳，微调也更细腻 */
const narrow = useIsNarrow()
const PAD = computed(() => (narrow.value ? 132 : 104)) // 摇杆底盘直径
const MAX_R = computed(() => (narrow.value ? 44 : 34)) // 摇杆最大偏移半径
const KNOB = computed(() => (narrow.value ? 44 : 34)) // 摇杆头直径

const knob = ref({ x: 0, y: 0 })
const dragging = ref(false)
const padRef = ref<HTMLElement | null>(null)

const knobStyle = computed(() => ({
  transform: `translate3d(${knob.value.x}px, ${knob.value.y}px, 0)`,
}))

const padStyle = computed(() => ({
  width: `${PAD.value}px`,
  height: `${PAD.value}px`,
  cursor: props.disabled ? 'not-allowed' : 'grab',
}))

function resetKnob() {
  knob.value = { x: 0, y: 0 }
  dragging.value = false
  emit('direction', { x: 0, z: 0 })
}

function updateFromEvent(e: PointerEvent) {
  const el = padRef.value
  if (!el) return
  const rect = el.getBoundingClientRect()
  const cx = rect.left + rect.width / 2
  const cy = rect.top + rect.height / 2
  let dx = e.clientX - cx
  let dy = e.clientY - cy
  const maxR = MAX_R.value
  const len = Math.hypot(dx, dy)
  if (len > maxR) {
    dx = (dx / len) * maxR
    dy = (dy / len) * maxR
  }
  knob.value = { x: dx, y: dy }
  // 屏幕向上 = 机床前方 = -Z
  emit('direction', {
    x: Math.max(-1, Math.min(1, dx / maxR)),
    z: Math.max(-1, Math.min(1, dy / maxR)),
  })
}

function onPadDown(e: PointerEvent) {
  if (props.disabled) return
  dragging.value = true
  vibrate(10)
  try {
    ;(e.target as HTMLElement)?.setPointerCapture?.(e.pointerId)
  } catch {
    // 合成事件或指针已释放时会抛错，忽略即可
  }
  updateFromEvent(e)
}

function onPadMove(e: PointerEvent) {
  if (!dragging.value) return
  // 阻止移动端手势（滚动 / 下拉刷新）与画布的视角拖拽
  e.preventDefault()
  updateFromEvent(e)
}

function onPadUp(e: PointerEvent) {
  if (!dragging.value) return
  try {
    ;(e.target as HTMLElement)?.releasePointerCapture?.(e.pointerId)
  } catch {
    // 忽略：指针可能已经失效
  }
  resetKnob()
}

/**
 * 指针离开整个控制区：
 * 鼠标离开就收手（避免拖出去卡住方向），但触屏拖摇杆时手指经常会滑出容器，
 * 那种情况下不能放手 —— 触摸只认 pointerup / pointercancel。
 */
function onContainerLeave(e: PointerEvent) {
  if (dragging.value) return
  if (e.pointerType === 'touch') return
  releaseAll()
}

/** 兜底：指针在别处抬起（例如元素被移除）时也要让摇杆归位 */
function onWindowPointerUp() {
  if (dragging.value) resetKnob()
}

onMounted(() => {
  window.addEventListener('pointerup', onWindowPointerUp)
  window.addEventListener('pointercancel', onWindowPointerUp)
})

/**
 * 键盘方向 → 摇杆头偏移。
 * 面板上的摇杆不只是摆设：用 WASD / 方向键移动时，
 * 摇杆头会朝同一方向偏移，松开归位（拖拽中的优先级更高，不被打断）。
 */
watch(
  () => props.keyboardDir,
  (d) => {
    if (dragging.value) return
    const x = d?.x ?? 0
    const z = d?.z ?? 0
    if (x === 0 && z === 0) {
      if (!anyHeld()) knob.value = { x: 0, y: 0 }
      return
    }
    const len = Math.hypot(x, z) || 1
    const scale = Math.min(1, len) / len
    knob.value = { x: x * MAX_R.value * scale, y: z * MAX_R.value * scale }
  },
  { deep: true },
)

onBeforeUnmount(() => {
  window.removeEventListener('pointerup', onWindowPointerUp)
  window.removeEventListener('pointercancel', onWindowPointerUp)
  resetKnob()
})

defineExpose({ releaseAll })
</script>

<template>
  <div class="flex items-end gap-3 no-select sm:gap-5" @pointerleave="onContainerLeave">
    <!-- 十字方向键：窄屏（手机竖屏）收起来，只留摇杆，给小屏省空间 -->
    <div class="hidden grid-cols-3 grid-rows-3 gap-1.5 md:grid">
      <button
        class="col-start-2 row-start-1 dpad"
        :class="arrowActive('up') && 'dpad-on'"
        :disabled="disabled"
        aria-label="向前"
        @pointerdown.prevent="pressKey('up')"
        @pointerup="releaseKey('up')"
        @pointercancel="releaseKey('up')"
        @pointerleave="releaseKey('up')"
      >
        ▲
      </button>
      <button
        class="col-start-1 row-start-2 dpad"
        :class="arrowActive('left') && 'dpad-on'"
        :disabled="disabled"
        aria-label="向左"
        @pointerdown.prevent="pressKey('left')"
        @pointerup="releaseKey('left')"
        @pointercancel="releaseKey('left')"
        @pointerleave="releaseKey('left')"
      >
        ◀
      </button>
      <div class="col-start-2 row-start-2 flex items-center justify-center">
        <span class="h-1.5 w-1.5 rounded-full bg-white/25"></span>
      </div>
      <button
        class="col-start-3 row-start-2 dpad"
        :class="arrowActive('right') && 'dpad-on'"
        :disabled="disabled"
        aria-label="向右"
        @pointerdown.prevent="pressKey('right')"
        @pointerup="releaseKey('right')"
        @pointercancel="releaseKey('right')"
        @pointerleave="releaseKey('right')"
      >
        ▶
      </button>
      <button
        class="col-start-2 row-start-3 dpad"
        :class="arrowActive('down') && 'dpad-on'"
        :disabled="disabled"
        aria-label="向后"
        @pointerdown.prevent="pressKey('down')"
        @pointerup="releaseKey('down')"
        @pointercancel="releaseKey('down')"
        @pointerleave="releaseKey('down')"
      >
        ▼
      </button>
    </div>

    <!-- 摇杆 -->
    <div class="flex flex-col items-center gap-1.5">
      <div
        ref="padRef"
        class="game-surface relative flex items-center justify-center rounded-full border border-white/12 bg-slate-950/60"
        :class="disabled && 'opacity-50'"
        :style="padStyle"
        @pointerdown="onPadDown"
        @pointermove="onPadMove"
        @pointerup="onPadUp"
        @pointercancel="onPadUp"
      >
        <div class="absolute inset-2 rounded-full border border-white/6"></div>
        <div class="absolute inset-6 rounded-full border border-dashed border-white/8"></div>
        <div
          class="pointer-events-none absolute rounded-full border border-arcade-cyan/50 bg-gradient-to-br from-cyan-300/80 to-sky-500/80 shadow-[0_0_18px_rgba(56,225,255,0.55)] transition-transform duration-75"
          :style="{ ...knobStyle, width: `${KNOB}px`, height: `${KNOB}px` }"
        ></div>
      </div>
      <span class="text-[10px] tracking-[0.18em] text-slate-500">摇 杆</span>
    </div>
  </div>
</template>

<style scoped>
.dpad {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  border-radius: 10px;
  font-size: 11px;
  color: rgb(148 163 184);
  background: linear-gradient(160deg, rgba(30, 41, 64, 0.9), rgba(15, 21, 35, 0.9));
  border: 1px solid rgba(120, 160, 220, 0.18);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.06);
  /* 触屏上长按方向键时不要触发滚动 / 文本选择 */
  touch-action: none;
  user-select: none;
  -webkit-user-select: none;
  transition:
    transform 0.08s ease,
    background 0.12s ease,
    color 0.12s ease,
    box-shadow 0.12s ease;
}

/* hover 高亮只在真正有指针悬停的设备上生效，避免触屏「粘住」高亮状态 */
@media (hover: hover) and (pointer: fine) {
  .dpad:hover:not(:disabled) {
    color: rgb(226 240 255);
    border-color: rgba(56, 225, 255, 0.35);
  }
}

.dpad:active:not(:disabled),
.dpad-on {
  transform: translateY(1px) scale(0.96);
  color: #041019;
  background: linear-gradient(160deg, #7deaff, #23c8ee);
  border-color: rgba(56, 225, 255, 0.9);
  box-shadow: 0 0 16px rgba(56, 225, 255, 0.5);
}

.dpad:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

/* 手机横屏时视口很矮：把方向键收小一点，别把 3D 画面挤没了 */
@media (max-height: 560px) {
  .dpad {
    width: 38px;
    height: 38px;
    font-size: 10px;
  }
}
</style>
