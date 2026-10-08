import type {
  ClawMachineConfig,
  ClawMachineItem,
  GrabDifficulty,
  PositionMode,
  Vec3,
} from '@/types/claw-machine'
import { cloneDefaultItems, defaultConfig, defaultItems } from '@/models/defaultItems'

/** localStorage 存储键 */
export const STORAGE_KEY = 'claw-machine-config'

/** 当前配置结构版本 */
export const CONFIG_VERSION = 1

/** 单个物品数量上限，防止数量填成天文数字把浏览器卡死 */
export const MAX_QUANTITY = 40
/** 一次生成的物品总数上限 */
export const MAX_TOTAL_ITEMS = 60

const DIFFICULTIES: GrabDifficulty[] = ['easy', 'normal', 'hard']

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function num(v: unknown, fallback: number, min?: number, max?: number): number {
  const n = typeof v === 'number' ? v : Number(v)
  if (!Number.isFinite(n)) return fallback
  let out = n
  if (min !== undefined) out = Math.max(min, out)
  if (max !== undefined) out = Math.min(max, out)
  return out
}

function str(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback
}

function bool(v: unknown, fallback: boolean): boolean {
  if (typeof v === 'boolean') return v
  if (v === 'true') return true
  if (v === 'false') return false
  return fallback
}

function optionalVec3(v: unknown): Vec3 | undefined {
  if (!isObj(v)) return undefined
  return {
    x: num(v.x, 0),
    y: num(v.y, 0),
    z: num(v.z, 0),
  }
}

/** 生成一个稳定、可读的唯一 id */
export function createItemId(prefix = 'item'): string {
  const rand = Math.random().toString(36).slice(2, 8)
  return `${prefix}-${Date.now().toString(36)}-${rand}`
}

/**
 * 把任意来源（localStorage / 用户输入 / 未来后端）的数据规整成合法物品配置。
 * 字段缺失、类型错误、越界数值都会在这里被兜住。
 */
export function normalizeItem(raw: unknown, index = 0): ClawMachineItem | null {
  if (!isObj(raw)) return null

  const name = str(raw.name).trim()
  if (!name) return null

  const id = str(raw.id).trim() || `item-${index}`

  const size = optionalVec3(raw.size)
  const difficulty = DIFFICULTIES.includes(raw.difficulty as GrabDifficulty)
    ? (raw.difficulty as GrabDifficulty)
    : 'normal'
  const positionMode: PositionMode = raw.positionMode === 'fixed' ? 'fixed' : 'random'

  return {
    id,
    name,
    modelUrl: str(raw.modelUrl),
    thumbnailUrl: str(raw.thumbnailUrl) || undefined,
    quantity: Math.round(num(raw.quantity, 1, 0, MAX_QUANTITY)),
    scale: num(raw.scale, 1, 0.05, 12),
    size: size
      ? {
          x: num(size.x, 0.25, 0.02, 3),
          y: num(size.y, 0.25, 0.02, 3),
          z: num(size.z, 0.25, 0.02, 3),
        }
      : undefined,
    weight: num(raw.weight, 0.5, 0.02, 20),
    friction: num(raw.friction, 0.75, 0, 1.5),
    restitution: num(raw.restitution, 0.06, 0, 1),
    difficulty,
    positionMode,
    position: positionMode === 'fixed' ? optionalVec3(raw.position) : optionalVec3(raw.position),
    randomRotation: bool(raw.randomRotation, true),
    rotation: optionalVec3(raw.rotation) ?? { x: 0, y: 0, z: 0 },
    enabled: bool(raw.enabled, true),
  }
}

/** 规整整份配置 */
export function normalizeConfig(raw: unknown): ClawMachineConfig {
  if (!isObj(raw)) return { ...defaultConfig, items: cloneDefaultItems() }

  const rawItems = Array.isArray(raw.items) ? raw.items : defaultItems
  const items = rawItems
    .map((it, i) => normalizeItem(it, i))
    .filter((it): it is ClawMachineItem => it !== null)

  const attemptsPerGame = Math.round(num(raw.attemptsPerGame, 10, 1, 99))

  return {
    version: CONFIG_VERSION,
    attemptsPerGame,
    remainingAttempts: Math.round(num(raw.remainingAttempts, attemptsPerGame, 0, 99)),
    items: items.length ? items : cloneDefaultItems(),
  }
}

/** 读取配置；任何异常都回退到默认配置而不是抛错 */
export function loadConfig(): ClawMachineConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { ...defaultConfig, items: cloneDefaultItems() }
    return normalizeConfig(JSON.parse(raw) as unknown)
  } catch (err) {
    console.warn('[storage] 配置读取失败，已回退到默认配置：', err)
    return { ...defaultConfig, items: cloneDefaultItems() }
  }
}

/** 写入配置；配额超限等异常不阻断游戏 */
export function saveConfig(config: ClawMachineConfig): boolean {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config))
    return true
  } catch (err) {
    console.warn('[storage] 配置保存失败：', err)
    return false
  }
}

/** 清空持久化配置 */
export function clearConfig(): void {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch (err) {
    console.warn('[storage] 配置清除失败：', err)
  }
}
