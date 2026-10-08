/**
 * 抓娃娃机领域模型定义。
 * 所有 3D 场景与 UI 都围绕这些类型运转，物品不允许硬编码在场景代码里。
 */

/** 抓取难度 */
export type GrabDifficulty = 'easy' | 'normal' | 'hard'

/** 初始化位置模式 */
export type PositionMode = 'random' | 'fixed'

export interface Vec3 {
  x: number
  y: number
  z: number
}

/** 单个娃娃机物品配置 */
export interface ClawMachineItem {
  id: string

  name: string

  /** .glb / .gltf 模型地址；为空时使用内置程序化模型 */
  modelUrl: string
  thumbnailUrl?: string

  /** 同种物品在机器内生成的数量 */
  quantity: number

  /** 模型整体缩放 */
  scale: number

  /** 碰撞体尺寸（未乘 scale），缺省时按模型包围盒推算 */
  size?: Vec3

  /** 重量（kg 量级），影响抓取判定与物理质量 */
  weight: number
  friction?: number
  restitution?: number

  difficulty: GrabDifficulty

  positionMode: PositionMode

  /** positionMode === 'fixed' 时的初始坐标（机器内局部坐标） */
  position?: Vec3

  randomRotation: boolean

  /** randomRotation === false 时的固定旋转（弧度） */
  rotation?: Vec3

  enabled: boolean
}

/** 全局娃娃机配置（未来替换为后端接口的返回体） */
export interface ClawMachineConfig {
  /** 配置版本，用于 localStorage 结构的迁移 */
  version: number
  /** 每次游玩可用的抓取次数 */
  remainingAttempts: number
  /** 单局初始次数 */
  attemptsPerGame: number
  items: ClawMachineItem[]
}

/** 抓取结果记录 */
export interface GrabRecord {
  itemId: string
  itemName: string
  success: boolean
  /** 该次抓取的综合评分 0~1 */
  score: number
  time: number
}

/** 机械爪实时位置（机器内部局部坐标） */
export interface ClawPosition {
  x: number
  z: number
  /** 爪子相对顶部导轨的垂直高度 */
  y: number
}

/** 一次抓取流程的阶段 */
export type GrabPhase =
  | 'idle'
  | 'open'
  | 'descend'
  | 'close'
  | 'ascend'
  | 'transport'
  | 'release'
  | 'reset'

/** 抓取结果弹出层数据 */
export interface GrabOutcome {
  success: boolean
  /** 抓到 / 判定到最近的物品配置 id */
  itemId?: string
  itemName: string
  score: number
  /** 判定理由，用于调试与展示（例如“距离太远”） */
  reason: string
}

/** 机器内部可用空间尺寸（局部坐标，单位米） */
export interface MachineBounds {
  /** 玻璃柜内部半宽（X） */
  halfWidth: number
  /** 玻璃柜内部半深（Z） */
  halfDepth: number
  /** 物品可落地的内部底面高度 */
  floorY: number
  /** 爪子可下降的最低高度 */
  minY: number
  /** 爪子导轨所在高度 */
  railY: number
}
