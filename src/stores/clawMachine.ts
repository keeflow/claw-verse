import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type {
  ClawMachineConfig,
  ClawMachineItem,
  ClawPosition,
  GrabOutcome,
  GrabRecord,
} from '@/types/claw-machine'
import { cloneDefaultItems, defaultConfig, ITEM_PALETTE } from '@/models/defaultItems'
import {
  clearConfig,
  createItemId,
  loadConfig,
  MAX_TOTAL_ITEMS,
  normalizeItem,
  saveConfig,
} from '@/utils/storage'

/** 生成一个空白物品，作为“添加物品”的初值 */
export function createEmptyItem(): ClawMachineItem {
  return {
    id: createItemId(),
    name: '新物品',
    modelUrl: '',
    thumbnailUrl: undefined,
    quantity: 3,
    scale: 1,
    size: { x: 0.24, y: 0.24, z: 0.24 },
    weight: 0.5,
    friction: 0.75,
    restitution: 0.06,
    difficulty: 'normal',
    positionMode: 'random',
    position: { x: 0, y: 0.75, z: 0 },
    randomRotation: true,
    rotation: { x: 0, y: 0, z: 0 },
    enabled: true,
  }
}

export const useClawMachineStore = defineStore('clawMachine', () => {
  // ---------- 配置 ----------
  const items = ref<ClawMachineItem[]>(cloneDefaultItems())
  const attemptsPerGame = ref<number>(defaultConfig.attemptsPerGame)

  // ---------- 游戏状态 ----------
  const remainingAttempts = ref<number>(defaultConfig.attemptsPerGame)
  const totalAttempts = ref<number>(0)
  const successCount = ref<number>(0)
  const rewards = ref<GrabRecord[]>([])

  const isGrabbing = ref<boolean>(false)
  const currentClawPosition = ref<ClawPosition>({ x: 0, z: 0, y: 0 })
  const lastOutcome = ref<GrabOutcome | null>(null)

  /** 配置版本号，游戏页面监听它来决定是否重建场景 */
  const configRevision = ref<number>(0)

  // ---------- 派生 ----------
  /** 只有启用的物品会进入 3D 场景 */
  const enabledItems = computed(() => items.value.filter((it) => it.enabled && it.quantity > 0))

  /** 场景中实际会生成的物品总数（带上限保护） */
  const plannedItemCount = computed(() =>
    Math.min(
      enabledItems.value.reduce((sum, it) => sum + Math.max(0, it.quantity), 0),
      MAX_TOTAL_ITEMS,
    ),
  )

  /** 已获得物品按名称聚合，用于结果面板展示 */
  const rewardSummary = computed(() => {
    const map = new Map<string, { itemId: string; itemName: string; count: number }>()
    for (const r of rewards.value) {
      if (!r.success) continue
      const found = map.get(r.itemId)
      if (found) found.count += 1
      else map.set(r.itemId, { itemId: r.itemId, itemName: r.itemName, count: 1 })
    }
    return [...map.values()]
  })

  const attemptLabel = computed(() => `${remainingAttempts.value} / ${attemptsPerGame.value}`)

  // ---------- 配置读写 ----------
  function applyConfig(config: ClawMachineConfig) {
    items.value = config.items.map((it, i) => normalizeItem(it, i) ?? it)
    attemptsPerGame.value = config.attemptsPerGame
    // 次数属于单局状态：重新进入游戏时重置为完整次数
    remainingAttempts.value = config.attemptsPerGame
  }

  /** 从 localStorage 载入配置（进入页面时调用） */
  function hydrate() {
    applyConfig(loadConfig())
    configRevision.value += 1
  }

  /** 持久化当前配置 */
  function persist() {
    const ok = saveConfig({
      version: 1,
      attemptsPerGame: attemptsPerGame.value,
      remainingAttempts: remainingAttempts.value,
      items: items.value,
    })
    if (!ok) console.warn('[store] 配置未能写入 localStorage（可能超出配额）')
    return ok
  }

  /** 标记配置已变更，游戏页面据此重建场景 */
  function touchConfig() {
    persist()
    configRevision.value += 1
  }

  // ---------- 物品 CRUD ----------
  function addItem(item?: Partial<ClawMachineItem>): ClawMachineItem {
    const base = createEmptyItem()
    const merged = { ...base, ...item, id: item?.id && item.id.trim() ? item.id : createItemId() }
    const safe = normalizeItem(merged) ?? base
    items.value.push(safe)
    touchConfig()
    return safe
  }

  function updateItem(id: string, patch: Partial<ClawMachineItem>) {
    const idx = items.value.findIndex((it) => it.id === id)
    if (idx < 0) return
    const merged = { ...items.value[idx], ...patch, id }
    items.value[idx] = normalizeItem(merged) ?? items.value[idx]
    touchConfig()
  }

  function removeItem(id: string) {
    const idx = items.value.findIndex((it) => it.id === id)
    if (idx < 0) return
    items.value.splice(idx, 1)
    touchConfig()
  }

  function toggleItem(id: string, enabled?: boolean) {
    const target = items.value.find((it) => it.id === id)
    if (!target) return
    target.enabled = enabled ?? !target.enabled
    touchConfig()
  }

  /** 恢复默认物品配置 */
  function resetToDefaults() {
    items.value = cloneDefaultItems()
    attemptsPerGame.value = defaultConfig.attemptsPerGame
    remainingAttempts.value = defaultConfig.attemptsPerGame
    touchConfig()
  }

  /** 危险操作：清空全部本地数据 */
  function hardReset() {
    clearConfig()
    resetToDefaults()
    resetStats()
  }

  // ---------- 游戏状态 ----------
  function setGrabbing(v: boolean) {
    isGrabbing.value = v
  }

  function setClawPosition(p: Partial<ClawPosition>) {
    currentClawPosition.value = { ...currentClawPosition.value, ...p }
  }

  /** 消耗一次机会，返回是否还有剩余 */
  function consumeAttempt(): boolean {
    if (remainingAttempts.value <= 0) return false
    remainingAttempts.value -= 1
    totalAttempts.value += 1
    return true
  }

  /** 补充次数 */
  function refillAttempts(n = attemptsPerGame.value) {
    remainingAttempts.value = n
  }

  function recordOutcome(outcome: GrabOutcome, itemId = '') {
    lastOutcome.value = outcome
    if (outcome.success) successCount.value += 1
    rewards.value.unshift({
      itemId,
      itemName: outcome.itemName,
      success: outcome.success,
      score: outcome.score,
      time: Date.now(),
    })
    if (rewards.value.length > 60) rewards.value.length = 60
  }

  function resetStats() {
    remainingAttempts.value = attemptsPerGame.value
    totalAttempts.value = 0
    successCount.value = 0
    rewards.value = []
    lastOutcome.value = null
  }

  /** 取某个物品的主题色（缩略图兜底用） */
  function paletteOf(item: ClawMachineItem): string {
    return ITEM_PALETTE[item.id] ?? ITEM_PALETTE[item.name] ?? '#7dd3fc'
  }

  return {
    // state
    items,
    attemptsPerGame,
    remainingAttempts,
    totalAttempts,
    successCount,
    rewards,
    isGrabbing,
    currentClawPosition,
    lastOutcome,
    configRevision,
    // getters
    enabledItems,
    plannedItemCount,
    rewardSummary,
    attemptLabel,
    // actions
    hydrate,
    persist,
    touchConfig,
    addItem,
    updateItem,
    removeItem,
    toggleItem,
    resetToDefaults,
    hardReset,
    setGrabbing,
    setClawPosition,
    consumeAttempt,
    refillAttempts,
    recordOutcome,
    resetStats,
    paletteOf,
  }
})
