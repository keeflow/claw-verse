<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef } from 'vue'
import { useRouter } from 'vue-router'
import { useClawMachineStore } from '@/stores/clawMachine'
import { ClawMachine } from '@/three/ClawMachine'
import {
  VIEW_PRESETS,
  VIEW_PRESET_LABEL,
  matchPreset,
  type ViewPresetName,
} from '@/three/CameraController'
import { useIsTouch, vibrate } from '@/utils/device'
import GameStatus from '@/components/GameStatus.vue'
import GameController from '@/components/GameController.vue'

const router = useRouter()
const store = useClawMachineStore()

const canvasHost = ref<HTMLElement | null>(null)
const machine = shallowRef<ClawMachine | null>(null)

const loading = ref(true)
const fatal = ref('')
const warning = ref('')
const bonus = ref('')
let bonusTimer = 0
/** 抓取结果的非阻塞反馈：成功=胜利横幅，失败=轻提示 */
const successBanner = ref('')
let successTimer = 0
const failNote = ref('')
let failTimer = 0
const remainingItems = ref(0)
const keyboardDir = ref({ x: 0, z: 0 })
/** 取物腔里等待取走的奖品数量 */
const chuteCount = ref(0)
let noteTimer = 0

/** 移动端：紧凑 HUD 是否展开成完整战况卡 */
const hudOpen = ref(false)
/** 触屏文案与震动反馈 */
const isTouch = useIsTouch()

/** 360° 环视：当前视角与自动旋转状态 */
const view = ref({ azimuth: 0, polar: 1.3, distance: 5.2 })
const autoRotate = ref(false)
const presetNames = Object.keys(VIEW_PRESETS) as ViewPresetName[]
const activePreset = computed(() => matchPreset(view.value))

/** 当前绕到机器的哪个角度（0° = 正面） */
const viewAngleText = computed(() => {
  const deg = (((view.value.azimuth * 180) / Math.PI) % 360 + 360) % 360
  return `${deg.toFixed(0)}°`
})

let itemPoll: number | null = null

const canContinue = computed(() => store.remainingAttempts > 0)

onMounted(async () => {
  store.hydrate()

  if (!canvasHost.value) return

  const instance = new ClawMachine(canvasHost.value, {
    onClawPosition: (p) => store.setClawPosition(p),
    onDirectionChange: (d) => {
      keyboardDir.value = d
    },
    onViewChange: (v) => {
      view.value = v
    },
    onAutoRotateChange: (on) => {
      autoRotate.value = on
    },
    onBonusPrize: (prize) => {
      // 爪子把别的物品撞进取物口也算玩家收获，保证「出货数 = 成功数」
      store.recordOutcome(
        { success: true, itemId: prize.itemId, itemName: prize.itemName, score: 1, reason: '意外收获：物品滚进了取物口' },
        prize.itemId,
      )
      bonus.value = `🎉 意外收获「${prize.itemName}」掉进了取物口！`
      remainingItems.value = instance.remainingItemCount
      if (isTouch.value) vibrate([0, 26, 40, 26])
      window.clearTimeout(bonusTimer)
      bonusTimer = window.setTimeout(() => {
        bonus.value = ''
      }, 5200)
    },
    onGrabStart: () => store.setGrabbing(true),
    onGrabEnd: (outcome) => {
      store.setGrabbing(false)
      store.recordOutcome(outcome, outcome.itemId ?? '')
      remainingItems.value = instance.remainingItemCount
      // 成功的庆祝交给 3D 场景（烟花 + 音乐），这里只做轻量文字反馈
      if (outcome.success) {
        if (isTouch.value) vibrate([0, 24, 60, 34])
        successBanner.value = outcome.itemName
        window.clearTimeout(successTimer)
        successTimer = window.setTimeout(() => {
          successBanner.value = ''
        }, 3600)
      } else {
        failNote.value = outcome.reason || '这次没有抓到物品'
        window.clearTimeout(failTimer)
        failTimer = window.setTimeout(() => {
          failNote.value = ''
        }, 3000)
      }
    },
    onRequestGrab: () => void handleGrab(),
    onWarning: (msg) => {
      warning.value = msg
      window.setTimeout(() => {
        if (warning.value === msg) warning.value = ''
      }, 5200)
    },
    onFatal: (msg) => {
      fatal.value = msg
      loading.value = false
    },
    onReady: () => {
      loading.value = false
      remainingItems.value = instance.remainingItemCount
      chuteCount.value = instance.chuteItemCount
    },
  })

  machine.value = instance
  await instance.init(store.items)
  instance.start()

  // 开发模式暴露调试句柄，便于自动化测试与调参
  if (import.meta.env.DEV) {
    ;(window as unknown as Record<string, unknown>).__clawGame = { machine: instance, store }
  }

  itemPoll = window.setInterval(() => {
    if (machine.value) {
      remainingItems.value = machine.value.remainingItemCount
      chuteCount.value = machine.value.chuteItemCount
    }
  }, 800)

  window.addEventListener('keydown', onKeydownRefill)
})

onBeforeUnmount(() => {
  if (itemPoll !== null) window.clearInterval(itemPoll)
  itemPoll = null
  window.clearTimeout(bonusTimer)
  window.clearTimeout(successTimer)
  window.clearTimeout(failTimer)
  window.clearTimeout(noteTimer)
  window.removeEventListener('keydown', onKeydownRefill)
  machine.value?.dispose()
  machine.value = null
  store.setGrabbing(false)
})

async function handleGrab() {
  const m = machine.value
  if (!m || store.isGrabbing || loading.value || fatal.value) return
  if (!store.consumeAttempt()) {
    warning.value = '抓取次数已经用完，可以点击「补充次数」继续'
    return
  }
  hudOpen.value = false
  if (isTouch.value) vibrate(14)
  const outcome = await m.grab()
  if (!outcome) {
    // 流程被中断时把次数还回去
    store.refillAttempts(Math.min(store.attemptsPerGame, store.remainingAttempts + 1))
    store.setGrabbing(false)
  }
}

function onDirection(dir: { x: number; z: number }) {
  machine.value?.setDirection(dir.x, dir.z)
}

function refill() {
  store.refillAttempts()
  store.setGrabbing(false)
  showNote('已补充抓取次数，继续加油 🎯')
}

/** 清空取物口：把落进取物腔的奖品全部取走 */
function clearChute() {
  const m = machine.value
  if (!m || m.isBusy) return
  const n = m.clearChute()
  chuteCount.value = m.chuteItemCount
  showNote(n > 0 ? `已从取物口取出 ${n} 件奖品 🧺` : '取物口是空的，抓到娃娃后会掉进来')
}

/** 底部中部的轻提示（复用 warning 样式，但语义是操作反馈） */
function showNote(msg: string) {
  warning.value = msg
  window.clearTimeout(noteTimer)
  noteTimer = window.setTimeout(() => {
    if (warning.value === msg) warning.value = ''
  }, 2600)
}

function resetView() {
  machine.value?.resetView()
}

function viewPreset(name: ViewPresetName) {
  machine.value?.viewPreset(name)
}

/** 手机上的「特写 / 全景」切换：窄屏时机器占满宽度，贴脸看更容易对位 */
function toggleCloseup() {
  viewPreset(activePreset.value === 'close' ? 'front' : 'close')
}

function toggleAutoRotate() {
  machine.value?.toggleAutoRotate()
  autoRotate.value = machine.value?.isAutoRotating ?? false
}

function goSettings() {
  router.push('/settings')
}

function onKeydownRefill(e: KeyboardEvent) {
  if (e.key === 'Enter' && store.remainingAttempts <= 0) refill()
}
</script>

<template>
  <!--
    注意：这一层不能加 touch-action:none —— 展开的战况卡要靠手指滚动，
    祖先一旦禁用手势，下层所有元素都滚不动了。触屏手势只在画布与摇杆上接管。
  -->
  <div class="relative h-full w-full overflow-hidden bg-[#05070d]" @contextmenu.prevent>
    <!-- 3D 画布：单指拖动环视、双指捏合缩放；点画面就收起展开的战况卡 -->
    <div
      ref="canvasHost"
      class="game-surface absolute inset-0"
      @pointerdown="hudOpen = false"
    ></div>

    <!-- 顶部浮层：标题栏 / 战况 / 提示条，整体走正常文档流，高度变化不会互相压字 -->
    <div class="pointer-events-none absolute inset-x-0 top-0 z-30 flex flex-col gap-2 px-3 pt-safe sm:px-4">
      <header class="pointer-events-none flex items-start justify-between gap-2">
        <div class="pointer-events-auto flex items-center gap-2.5">
          <div
            class="flex h-9 w-9 items-center justify-center rounded-xl border border-cyan-300/25 bg-slate-900/70 text-[16px] shadow-[0_0_22px_-6px_rgba(56,225,255,0.6)] sm:h-10 sm:w-10 sm:text-[18px]"
          >
            🕹️
          </div>
          <div class="leading-tight">
            <h1 class="neon-text text-[15px] font-bold tracking-wide text-slate-100 sm:text-[17px]">
              娃娃乐园
            </h1>
            <p class="hidden text-[11px] tracking-[0.18em] text-slate-500 sm:block">
              3D 抓娃娃机 · 电玩城
            </p>
          </div>
        </div>

        <div class="pointer-events-auto flex flex-wrap items-center justify-end gap-1.5 sm:gap-2">
          <!-- 宽屏：快捷视角一键转到各面 -->
          <div class="glass-panel hidden items-center gap-0.5 rounded-xl p-1 lg:flex">
            <button
              v-for="name in presetNames"
              :key="name"
              class="rounded-lg px-2.5 py-1.5 text-[12px] font-medium transition"
              :class="
                activePreset === name
                  ? 'bg-cyan-400/85 text-slate-950 shadow-[0_0_16px_-2px_rgba(56,225,255,0.7)]'
                  : 'text-slate-400 hover:bg-white/5 hover:text-white'
              "
              :title="`转到${VIEW_PRESET_LABEL[name]}视角`"
              @click="viewPreset(name)"
            >
              {{ VIEW_PRESET_LABEL[name] }}
            </button>
          </div>

          <!-- 窄屏：特写 / 全景切换（竖屏时机器几乎占满宽度，贴脸看更好对位） -->
          <button
            class="glass-panel hud-btn lg:hidden"
            :class="
              activePreset === 'close'
                ? 'border-cyan-300/45 text-cyan-200'
                : 'text-slate-300'
            "
            :aria-pressed="activePreset === 'close'"
            aria-label="切换特写视角"
            :title="activePreset === 'close' ? '切回全景视角' : '切到机内特写视角'"
            @click="toggleCloseup"
          >
            <svg viewBox="0 0 20 20" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="1.6">
              <circle cx="9" cy="9" r="5.5" />
              <path d="M13.2 13.2 17 17M9 6.6v4.8M6.6 9h4.8" stroke-linecap="round" />
            </svg>
            <span class="hidden sm:inline">特写</span>
          </button>

          <!-- 自动环绕 -->
          <button
            class="glass-panel hud-btn"
            :class="
              autoRotate
                ? 'border-cyan-300/45 text-cyan-200 shadow-[0_0_18px_-6px_rgba(56,225,255,0.8)]'
                : 'text-slate-300'
            "
            :aria-pressed="autoRotate"
            aria-label="自动环绕"
            @click="toggleAutoRotate"
          >
            <svg
              viewBox="0 0 20 20"
              class="h-4 w-4"
              :class="autoRotate && 'animate-spin'"
              fill="none"
              stroke="currentColor"
              stroke-width="1.6"
              stroke-linecap="round"
            >
              <path d="M16.4 8.4A6.6 6.6 0 0 0 4.6 6.2" />
              <path d="M3.6 11.6a6.6 6.6 0 0 0 11.8 2.2" />
              <path d="M4.6 2.6v3.6h3.6M15.4 17.4v-3.6h-3.6" />
            </svg>
            <span class="hidden sm:inline">自动旋转</span>
          </button>

          <button
            class="glass-panel hud-btn"
            aria-label="重置视角"
            title="重置视角"
            @click="resetView"
          >
            <svg viewBox="0 0 20 20" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="1.6">
              <path d="M4 10a6 6 0 1 0 1.8-4.3" stroke-linecap="round" />
              <path d="M4 3.6V7h3.4" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
            <span class="hidden sm:inline">重置视角</span>
          </button>

          <button
            class="glass-panel hud-btn"
            aria-label="设置"
            title="设置"
            @click="goSettings"
          >
            <svg viewBox="0 0 20 20" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="1.6">
              <path d="M10 12.6a2.6 2.6 0 1 0 0-5.2 2.6 2.6 0 0 0 0 5.2Z" />
              <path
                d="M16.2 12.2a1.3 1.3 0 0 0 .26 1.43l.05.05a1.6 1.6 0 1 1-2.26 2.26l-.05-.05a1.3 1.3 0 0 0-1.43-.26 1.3 1.3 0 0 0-.79 1.19v.13a1.6 1.6 0 1 1-3.2 0v-.07a1.3 1.3 0 0 0-.85-1.19 1.3 1.3 0 0 0-1.43.26l-.05.05A1.6 1.6 0 1 1 4.19 13.7l.05-.05a1.3 1.3 0 0 0 .26-1.43 1.3 1.3 0 0 0-1.19-.79h-.13a1.6 1.6 0 1 1 0-3.2h.07a1.3 1.3 0 0 0 1.19-.85 1.3 1.3 0 0 0-.26-1.43l-.05-.05A1.6 1.6 0 1 1 6.4 3.64l.05.05a1.3 1.3 0 0 0 1.43.26h.06a1.3 1.3 0 0 0 .79-1.19v-.13a1.6 1.6 0 1 1 3.2 0v.07a1.3 1.3 0 0 0 .79 1.19 1.3 1.3 0 0 0 1.43-.26l.05-.05a1.6 1.6 0 1 1 2.26 2.26l-.05.05a1.3 1.3 0 0 0-.26 1.43v.06a1.3 1.3 0 0 0 1.19.79h.13a1.6 1.6 0 1 1 0 3.2h-.07a1.3 1.3 0 0 0-1.19.79Z"
              />
            </svg>
            <span class="hidden sm:inline">设置</span>
          </button>
        </div>
      </header>

      <!-- 窄屏：一行紧凑战况，点一下展开完整面板 -->
      <div class="pointer-events-auto flex lg:hidden">
        <button
          class="glass-panel flex h-9 items-center gap-2 rounded-full px-3.5 text-[11px] transition active:scale-[0.97]"
          :aria-expanded="hudOpen"
          @click="hudOpen = !hudOpen"
        >
          <span class="flex items-center gap-1 text-slate-400">
            剩余
            <span
              class="tabular text-[14px] font-bold"
              :class="canContinue ? 'text-arcade-cyan' : 'text-rose-400'"
            >
              {{ store.remainingAttempts }}
            </span>
            <span class="tabular text-slate-500">/{{ store.attemptsPerGame }}</span>
          </span>
          <span class="h-3 w-px bg-white/10"></span>
          <span class="flex items-center gap-1 text-slate-400">
            机器内 <span class="tabular font-semibold text-slate-200">{{ remainingItems }}</span>
          </span>
          <span class="h-3 w-px bg-white/10"></span>
          <span class="flex items-center gap-1 text-slate-400">
            成功 <span class="tabular font-semibold text-emerald-300">{{ store.successCount }}</span>
          </span>
          <svg
            viewBox="0 0 20 20"
            class="h-3 w-3 text-slate-500 transition-transform"
            :class="hudOpen && 'rotate-180'"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
          >
            <path d="m5 7.5 5 5 5-5" />
          </svg>
        </button>
      </div>

      <!-- 窄屏展开的完整战况 -->
      <Transition name="hud">
        <div v-if="hudOpen" class="pointer-events-auto max-h-[52vh] overflow-y-auto scroll-thin lg:hidden">
          <GameStatus
            :attempts="store.remainingAttempts"
            :attempts-per-game="store.attemptsPerGame"
            :total-attempts="store.totalAttempts"
            :success-count="store.successCount"
            :remaining-items="remainingItems"
            :rewards="store.rewardSummary"
            :grabbing="store.isGrabbing"
          />
        </div>
      </Transition>

      <!-- 宽屏：完整战况常驻 -->
      <div class="pointer-events-none hidden lg:block">
        <GameStatus
          :attempts="store.remainingAttempts"
          :attempts-per-game="store.attemptsPerGame"
          :total-attempts="store.totalAttempts"
          :success-count="store.successCount"
          :remaining-items="remainingItems"
          :rewards="store.rewardSummary"
          :grabbing="store.isGrabbing"
        />
      </div>

      <!-- 提示条：跟着顶部浮层往下排，永不压住标题或战况 -->
      <Transition name="toast">
        <div
          v-if="warning"
          class="pointer-events-auto mx-auto max-w-[420px] rounded-xl border border-amber-300/30 bg-amber-400/12 px-4 py-2.5 text-center text-[12px] leading-relaxed text-amber-200 backdrop-blur"
        >
          {{ warning }}
        </div>
      </Transition>

      <Transition name="toast">
        <div
          v-if="bonus"
          class="pointer-events-auto mx-auto max-w-[420px] rounded-xl border border-emerald-300/35 bg-emerald-400/12 px-4 py-2.5 text-center text-[12px] leading-relaxed text-emerald-200 backdrop-blur"
        >
          {{ bonus }}
        </div>
      </Transition>

      <!-- 抓取成功：胜利横幅（非阻塞，烟花在 3D 场景里燃放） -->
      <Transition name="banner">
        <div v-if="successBanner" class="pointer-events-none flex justify-center">
          <div
            class="animate-pop-in flex items-center gap-3 rounded-2xl border border-amber-300/40 bg-gradient-to-r from-amber-400/18 via-amber-300/12 to-amber-400/18 px-5 py-2.5 shadow-[0_0_36px_-8px_rgba(255,203,71,0.7)] backdrop-blur sm:px-6 sm:py-3"
          >
            <span class="text-[22px] leading-none sm:text-[26px]">🎉</span>
            <div class="leading-tight">
              <div class="neon-text text-[16px] font-bold text-arcade-gold sm:text-[18px]">抓取成功！</div>
              <div class="mt-0.5 text-[12px] text-slate-200">
                获得 <span class="font-semibold text-arcade-gold">{{ successBanner }}</span> 一枚
              </div>
            </div>
          </div>
        </div>
      </Transition>

      <!-- 抓取失败：轻提示（不打断游戏） -->
      <Transition name="toast">
        <div
          v-if="failNote"
          class="pointer-events-auto mx-auto max-w-[420px] rounded-xl border border-slate-400/25 bg-slate-700/35 px-4 py-2.5 text-center text-[12px] leading-relaxed text-slate-200 backdrop-blur"
        >
          💨 {{ failNote }}
        </div>
      </Transition>
    </div>

    <!-- 宽屏左下：360° 环视操作提示 -->
    <div class="pointer-events-none absolute bottom-4 left-4 z-20 hidden xl:block">
      <div class="glass-panel flex items-center gap-3 rounded-xl px-3.5 py-2 text-[11px] text-slate-500">
        <span><span class="text-slate-300">拖动画面</span> 360° 环视</span>
        <span class="text-slate-700">·</span>
        <span><span class="text-slate-300">滚轮</span> 缩放</span>
        <span class="text-slate-700">·</span>
        <span><span class="text-slate-300">R</span> 复位</span>
        <span class="tabular rounded-md bg-white/5 px-1.5 py-0.5 text-slate-400">{{ viewAngleText }}</span>
      </div>
    </div>

    <!-- 宽屏右下：坐标 / 取物口 / 补充次数 -->
    <div class="pointer-events-none absolute bottom-4 right-4 z-20 hidden xl:block">
      <div class="glass-panel rounded-xl px-3.5 py-2.5 text-right">
        <div class="tabular text-[11px] text-slate-500">
          爪子坐标 X {{ store.currentClawPosition.x.toFixed(2) }} · Z {{ store.currentClawPosition.z.toFixed(2) }}
        </div>
        <button
          class="pointer-events-auto mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-semibold transition"
          :class="
            chuteCount > 0
              ? 'bg-gradient-to-r from-cyan-300 to-sky-500 text-slate-950 hover:brightness-110 shadow-[0_0_18px_-4px_rgba(56,225,255,0.8)]'
              : 'cursor-not-allowed bg-white/5 text-slate-500'
          "
          :disabled="chuteCount <= 0 || store.isGrabbing"
          :title="chuteCount > 0 ? '取走取物腔里的全部奖品' : '取物口还没有奖品'"
          @click="clearChute"
        >
          🧺 清空取物口<span v-if="chuteCount > 0" class="tabular">（{{ chuteCount }}）</span>
        </button>
        <button
          v-if="!canContinue"
          class="pointer-events-auto mt-2 w-full rounded-lg bg-gradient-to-r from-amber-300 to-amber-400 px-3 py-1.5 text-[12px] font-semibold text-amber-950 transition hover:brightness-105"
          @click="refill"
        >
          补充次数
        </button>
      </div>
    </div>

    <!-- 底部：次级操作 + 操作面板（窄屏把「取物口 / 补充次数」也搬到这里，拇指够得到） -->
    <div
      class="pointer-events-none absolute inset-x-0 bottom-0 z-20 mx-auto flex w-full max-w-[720px] flex-col items-center gap-2 px-3 pb-safe sm:px-4 xl:gap-0"
    >
      <div class="pointer-events-auto flex w-full items-center justify-end gap-2 xl:hidden">
        <button
          class="glass-panel flex h-9 items-center gap-1.5 rounded-full px-3 text-[12px] font-medium transition active:scale-[0.97]"
          :class="chuteCount > 0 ? 'text-cyan-200' : 'cursor-not-allowed text-slate-500'"
          :disabled="chuteCount <= 0 || store.isGrabbing"
          :title="chuteCount > 0 ? '取走取物腔里的全部奖品' : '取物口还没有奖品'"
          @click="clearChute"
        >
          🧺 取物口<span v-if="chuteCount > 0" class="tabular">（{{ chuteCount }}）</span>
        </button>
        <button
          v-if="!canContinue"
          class="flex h-9 items-center gap-1.5 rounded-full bg-gradient-to-r from-amber-300 to-amber-400 px-3.5 text-[12px] font-semibold text-amber-950 shadow-[0_0_20px_-6px_rgba(255,203,71,0.9)] transition active:scale-[0.97]"
          @click="refill"
        >
          ＋ 补充次数
        </button>
      </div>

      <GameController
        :disabled="!canContinue"
        :grabbing="store.isGrabbing"
        :attempts="store.remainingAttempts"
        :keyboard-dir="keyboardDir"
        @direction="onDirection"
        @grab="handleGrab"
      />
    </div>

    <!-- 加载 -->
    <Transition name="toast">
      <div
        v-if="loading && !fatal"
        class="absolute inset-0 z-40 flex flex-col items-center justify-center gap-4 bg-[#05070d]"
      >
        <div class="relative h-16 w-16">
          <span class="absolute inset-0 rounded-full border-2 border-cyan-400/25"></span>
          <span class="absolute inset-0 animate-spin rounded-full border-2 border-transparent border-t-cyan-300"></span>
        </div>
        <p class="text-[13px] tracking-[0.2em] text-slate-400">正在搭建娃娃机场景…</p>
        <p class="text-[11px] text-slate-600">首次加载需要初始化物理引擎</p>
      </div>
    </Transition>

    <!-- WebGL 不可用 -->
    <div v-if="fatal" class="absolute inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-[#05070d] px-6 text-center">
      <div class="text-[42px]">🛠️</div>
      <h2 class="text-lg font-semibold text-slate-100">无法启动 3D 场景</h2>
      <p class="max-w-md text-[13px] leading-relaxed text-slate-400">{{ fatal }}</p>
      <p class="max-w-md text-[12px] leading-relaxed text-slate-500">
        可以尝试更换现代浏览器、开启硬件加速，或先到设置页检查物品配置。
      </p>
      <button
        class="mt-2 rounded-xl border border-slate-600 px-4 py-2 text-[13px] text-slate-300 transition hover:border-slate-400 hover:text-white"
        @click="goSettings"
      >
        前往设置页
      </button>
    </div>
  </div>
</template>

<style scoped>
/* 顶栏按钮：手机上只有图标，落到 36px 的方形点击区；宽屏长回文字按钮 */
.hud-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  height: 2.25rem;
  min-width: 2.25rem;
  padding: 0 0.625rem;
  border-radius: 0.75rem;
  font-size: 12px;
  font-weight: 500;
  color: rgb(203 213 225);
  transition:
    transform 0.08s ease,
    color 0.12s ease,
    border-color 0.12s ease;
}

.hud-btn:active {
  transform: scale(0.94);
}

@media (min-width: 1024px) {
  .hud-btn {
    height: auto;
    min-width: 0;
    padding: 0.5rem 0.875rem;
  }
}

.toast-enter-active,
.toast-leave-active {
  transition:
    opacity 0.25s ease,
    transform 0.25s ease;
}
.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}

.banner-enter-active,
.banner-leave-active {
  transition:
    opacity 0.3s ease,
    transform 0.3s cubic-bezier(0.22, 1, 0.36, 1);
}
.banner-enter-from,
.banner-leave-to {
  opacity: 0;
  transform: translateY(-14px);
}

/* 战况卡展开：从上方轻轻落下，而不是硬邦邦地出现 */
.hud-enter-active,
.hud-leave-active {
  transition:
    opacity 0.22s ease,
    transform 0.22s cubic-bezier(0.22, 1, 0.36, 1);
}
.hud-enter-from,
.hud-leave-to {
  opacity: 0;
  transform: translateY(-10px) scale(0.98);
}
</style>
