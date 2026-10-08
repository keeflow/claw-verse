import type { ClawMachineConfig, ClawMachineItem } from '@/types/claw-machine'

/**
 * 系统默认物品。
 *
 * modelUrl 为空字符串时，AssetLoader 会使用内置的程序化模型
 * （按 id 匹配 bear / rabbit / cat / gift / football / star），
 * 这样第一阶段不依赖任何外部 .glb 资源也能跑起来；
 * 用户也可以在设置页填写自定义 .glb / .gltf 地址来替换。
 */
export const defaultItems: ClawMachineItem[] = [
  {
    id: 'bear',
    name: '小熊',
    modelUrl: '',
    quantity: 5,
    scale: 1,
    size: { x: 0.26, y: 0.26, z: 0.24 },
    weight: 0.4,
    friction: 0.8,
    restitution: 0.08,
    difficulty: 'easy',
    positionMode: 'random',
    randomRotation: true,
    enabled: true,
  },
  {
    id: 'rabbit',
    name: '兔子',
    modelUrl: '',
    quantity: 3,
    scale: 1,
    size: { x: 0.24, y: 0.3, z: 0.22 },
    weight: 0.5,
    friction: 0.8,
    restitution: 0.08,
    difficulty: 'normal',
    positionMode: 'random',
    randomRotation: true,
    enabled: true,
  },
  {
    id: 'cat',
    name: '猫咪',
    modelUrl: '',
    quantity: 3,
    scale: 1,
    size: { x: 0.28, y: 0.26, z: 0.26 },
    weight: 0.55,
    friction: 0.85,
    restitution: 0.06,
    difficulty: 'normal',
    positionMode: 'random',
    randomRotation: true,
    enabled: true,
  },
  {
    id: 'gift',
    name: '礼盒',
    modelUrl: '',
    quantity: 4,
    scale: 1,
    size: { x: 0.26, y: 0.26, z: 0.26 },
    weight: 0.6,
    friction: 0.6,
    restitution: 0.1,
    difficulty: 'hard',
    positionMode: 'random',
    randomRotation: true,
    enabled: true,
  },
  {
    id: 'football',
    name: '足球',
    modelUrl: '',
    quantity: 4,
    scale: 1,
    size: { x: 0.22, y: 0.22, z: 0.22 },
    weight: 0.35,
    friction: 0.28,
    restitution: 0.62,
    difficulty: 'normal',
    positionMode: 'random',
    randomRotation: true,
    enabled: true,
  },
  {
    id: 'star',
    name: '星星抱枕',
    modelUrl: '',
    quantity: 3,
    scale: 1,
    size: { x: 0.34, y: 0.14, z: 0.32 },
    weight: 0.45,
    friction: 0.9,
    restitution: 0.04,
    difficulty: 'easy',
    positionMode: 'random',
    randomRotation: true,
    enabled: true,
  },
]

/** 内置程序化模型所支持的 id */
export const BUILTIN_SHAPES = ['bear', 'rabbit', 'cat', 'gift', 'football', 'star'] as const
export type BuiltinShape = (typeof BUILTIN_SHAPES)[number]

/** 每个物品的默认主色调，设置页缩略图与程序化模型共用 */
export const ITEM_PALETTE: Record<string, string> = {
  bear: '#c98a5b',
  rabbit: '#f3f0f7',
  cat: '#e8a33d',
  gift: '#e0455f',
  football: '#f7f7f9',
  star: '#f6c945',
}

/** 默认全局配置 */
export const defaultConfig: ClawMachineConfig = {
  version: 1,
  attemptsPerGame: 10,
  remainingAttempts: 10,
  items: defaultItems,
}

/** 深拷贝一份默认物品，避免 Pinia 里的修改污染常量 */
export function cloneDefaultItems(): ClawMachineItem[] {
  return defaultItems.map((item) => ({
    ...item,
    size: item.size ? { ...item.size } : undefined,
    position: item.position ? { ...item.position } : undefined,
    rotation: item.rotation ? { ...item.rotation } : undefined,
  }))
}
