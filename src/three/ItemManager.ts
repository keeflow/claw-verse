import * as THREE from 'three'
import type { ClawMachineItem, GrabDifficulty, Vec3 } from '@/types/claw-machine'
import { MAX_TOTAL_ITEMS } from '@/utils/storage'
import { clamp } from '@/utils/anim'
import { M, SPAWN_AREA, CLAW_GRIP_OFFSET, clawOpenForTipRadius } from './constants'
import { AssetLoader, disposeObject, fitToSize, measure } from './AssetLoader'
import type { PhysicsEntry, PhysicsWorld } from './PhysicsWorld'

/** 难度 → 成功率权重 */
const DIFFICULTY_SCORE: Record<GrabDifficulty, number> = {
  easy: 1.0,
  normal: 0.88,
  hard: 0.74,
}

/** 综合评分达到该值即判定抓取成功 */
export const GRAB_THRESHOLD = 0.42

/**
 * 爪子的“握持半径”：三指收拢时刚好能抱住的物体半径。
 * 物品等效半径与它的比值决定尺寸分，两者越接近越容易夹住。
 */
export const GRASP_RADIUS = 0.15

/** 夹持中心相对爪心的垂直距离（手指包裹区间的中点略偏上） */
export const GRIP_OFFSET = CLAW_GRIP_OFFSET

/** 手指贴住物品表面时预留的空隙，避免指尖直接穿进模型里 */
const GRASP_CLEARANCE = 0.02

/** 单次生成时允许的最大层数，避免物品堆到玻璃顶 */
const MAX_LAYERS = 5

/** 抓取评分明细，便于调试与向玩家解释失败原因 */
export interface GrabScoreBreakdown {
  distance: number
  size: number
  difficulty: number
  weight: number
  angle: number
  random: number
  total: number
}

export interface GrabCandidate {
  entry: PhysicsEntry
  distance: number
  score: number
  breakdown: GrabScoreBreakdown
  reason: string
}

const _v = new THREE.Vector3()
const _q = new THREE.Quaternion()

function randomRotationQuat(): THREE.Quaternion {
  _q.setFromEuler(
    new THREE.Euler(
      (Math.random() - 0.5) * 0.9,
      Math.random() * Math.PI * 2,
      (Math.random() - 0.5) * 0.9,
      'XYZ',
    ),
  )
  return _q.clone()
}

function shuffled<T>(arr: T[]): T[] {
  const a = arr.slice()
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

/**
 * 物品管理器：配置 → 可见可碰撞的娃娃机物品。
 * 同时负责抓取判定所需的“附近物品检索”和“能不能夹住”的计算。
 */
export class ItemManager {
  /** 存放所有物品视觉对象的容器 */
  readonly group = new THREE.Group()
  /** 物品配置 id → 该物品生成的实例 */
  readonly spawned: { config: ClawMachineItem; entries: PhysicsEntry[] }[] = []

  private assets: AssetLoader
  private physics: PhysicsWorld
  /** 场景中的落点记录，用于随机摆放时避免重叠 */
  private placed: { x: number; z: number; layer: number }[] = []

  constructor(physics: PhysicsWorld, assets: AssetLoader) {
    this.physics = physics
    this.assets = assets
    this.group.name = 'Items'
  }

  /**
   * 依据配置生成机器内的全部物品。
   * 每件物品独立 try/catch，单个模型异常不会影响其它物品。
   */
  async build(items: ClawMachineItem[]): Promise<void> {
    this.clear()

    const enabled = items.filter((it) => it.enabled && it.quantity > 0)
    if (enabled.length === 0) {
      console.warn('[ItemManager] 没有任何启用的物品，机器内将是空的')
      return
    }

    // 展开成实例列表，并做总量保护
    const instances: { config: ClawMachineItem; index: number }[] = []
    for (const cfg of enabled) {
      const qty = Math.max(0, Math.round(cfg.quantity))
      for (let i = 0; i < qty; i++) {
        if (instances.length >= MAX_TOTAL_ITEMS) break
        instances.push({ config: cfg, index: i })
      }
      if (instances.length >= MAX_TOTAL_ITEMS) {
        console.warn(`[ItemManager] 物品总量已达上限 ${MAX_TOTAL_ITEMS}，超出部分不再生成`)
        break
      }
    }

    // 固定位置的物品先占位，随机物品再填充，减少空跑
    const fixed = shuffled(instances.filter((i) => i.config.positionMode === 'fixed'))
    const random = shuffled(instances.filter((i) => i.config.positionMode !== 'fixed'))
    const ordered = [...fixed, ...random]

    const layerSlots = this.buildSpawnSlots()
    let cursor = 0
    const layerCount = Math.max(1, Math.ceil(ordered.length / Math.max(1, layerSlots.length)))

    for (const inst of ordered) {
      try {
        const layer = Math.min(MAX_LAYERS - 1, Math.floor(cursor / Math.max(1, layerSlots.length)))
        const slot = layerSlots[cursor % Math.max(1, layerSlots.length)]
        cursor += 1

        const pose = this.resolvePose(inst.config, slot, layer)
        await this.spawnOne(inst.config, pose.position, pose.quaternion)
      } catch (err) {
        console.warn(`[ItemManager] 物品生成失败：${inst.config.name}`, err)
      }
    }

    void layerCount
  }

  /** 生成单个物品实例 */
  private async spawnOne(
    config: ClawMachineItem,
    position: THREE.Vector3,
    quaternion: THREE.Quaternion,
  ): Promise<void> {
    const model = await this.assets.createItemModel(config)

    // 尺寸：优先使用配置，其次用缩放后的包围盒
    const size = this.resolveSize(config)
    const scale = Number.isFinite(config.scale) && config.scale > 0 ? config.scale : 1
    fitToSize(model, size, scale)

    // 生成在机器外 → 拉回内部
    const box = measure(model)
    const halfX = box.max.x - box.min.x
    const halfZ = box.max.z - box.min.z
    position.x = clamp(position.x, -M.halfW + halfX / 2, M.halfW - halfX / 2)
    position.z = clamp(position.z, -M.halfD + halfZ / 2, M.halfD - halfZ / 2)

    model.position.copy(position)
    model.quaternion.copy(quaternion)
    this.group.add(model)

    const shape: 'box' | 'ball' = config.id === 'football' ? 'ball' : 'box'

    const entry = this.physics.createItemBody({
      object: model,
      itemId: config.id,
      itemName: config.name,
      weight: config.weight,
      difficulty: config.difficulty,
      size,
      position,
      quaternion,
      shape,
      friction: config.friction,
      restitution: config.restitution,
      linearDamping: 0.2,
      angularDamping: config.id === 'football' ? 0.35 : 0.95,
    })

    let bucket = this.spawned.find((s) => s.config.id === config.id)
    if (!bucket) {
      bucket = { config, entries: [] }
      this.spawned.push(bucket)
    }
    bucket.entries.push(entry)
  }

  /** 计算物品的最终尺寸 */
  private resolveSize(config: ClawMachineItem): THREE.Vector3 {
    const s: Vec3 = config.size ?? { x: 0.25, y: 0.25, z: 0.25 }
    return new THREE.Vector3(
      clamp(s.x, 0.03, 2),
      clamp(s.y, 0.03, 2),
      clamp(s.z, 0.03, 2),
    )
  }

  /** 生成本次的摆放槽位（自然抖动网格，且避开出货口） */
  private buildSpawnSlots(): { x: number; z: number }[] {
    const cols = 4
    const rows = 3
    const cellX = (SPAWN_AREA.maxX - SPAWN_AREA.minX) / cols
    const cellZ = (SPAWN_AREA.maxZ - SPAWN_AREA.minZ) / rows
    const chuteMinX = M.chute.x - M.chute.size / 2
    const chuteMinZ = M.chute.z - M.chute.size / 2

    const slots: { x: number; z: number }[] = []
    for (let c = 0; c < cols; c++) {
      for (let r = 0; r < rows; r++) {
        const x = SPAWN_AREA.minX + cellX * (c + 0.5)
        const z = SPAWN_AREA.minZ + cellZ * (r + 0.5)
        // 出货口及周边不摆物品，避免开局就掉进滑道
        if (x > chuteMinX - 0.16 && z > chuteMinZ - 0.16) continue
        slots.push({ x, z })
      }
    }
    return shuffled(slots.length ? slots : [{ x: -0.2, z: -0.1 }])
  }

  /** 决定一个实例的初始位姿 */
  private resolvePose(
    config: ClawMachineItem,
    slot: { x: number; z: number },
    layer: number,
  ): { position: THREE.Vector3; quaternion: THREE.Quaternion } {
    const jitter = () => (Math.random() - 0.5) * 0.1
    let x: number
    let z: number
    let y: number

    if (config.positionMode === 'fixed' && config.position) {
      x = config.position.x
      z = config.position.z
      y = clamp(config.position.y, M.floorY + 0.14, M.glassTop - 0.2)
    } else {
      x = slot.x + jitter()
      z = slot.z + jitter()
      // 从机器内部稍高的位置落下，形成自然堆叠
      y = M.floorY + 0.2 + layer * 0.26 + Math.random() * 0.12
      y = Math.min(y, M.glassTop - 0.24)
    }

    const quaternion =
      config.randomRotation
        ? randomRotationQuat()
        : new THREE.Quaternion().setFromEuler(
            new THREE.Euler(config.rotation?.x ?? 0, config.rotation?.y ?? 0, config.rotation?.z ?? 0),
          )

    this.placed.push({ x, z, layer })
    return { position: new THREE.Vector3(x, y, z), quaternion }
  }

  // ------------------------------------------------------------------
  // 抓取判定
  // ------------------------------------------------------------------

  /**
   * 检索机械爪覆盖范围内的物品并打分。
   * 复合评分模型：距离 × 尺寸 × 难度 × 重量 × 角度 × 随机扰动。
   * @param point 爪子的夹持点（世界坐标）
   */
  evaluate(point: THREE.Vector3): GrabCandidate | null {
    const nearby = this.physics.nearby(point, GRASP_RADIUS + 0.4)
    if (nearby.length === 0) return null

    let best: GrabCandidate | null = null

    for (const { entry } of nearby) {
      const t = entry.body.translation()
      _v.set(t.x, t.y, t.z)

      const horizontal = Math.hypot(_v.x - point.x, _v.z - point.z)
      const vertical = Math.abs(_v.y - point.y)

      // 爪子能“够到”的最大水平偏移
      const effectiveReach = GRASP_RADIUS + entry.radius

      // 1) 距离分：水平偏移权重更高（爪子只能垂直开合）
      const distanceScore = clamp(
        1 - (horizontal / effectiveReach) * 0.85 - (vertical / effectiveReach) * 0.35,
        0,
        1,
      )
      if (distanceScore <= 0.02) continue

      // 2) 尺寸分：过大夹不住，过小会从指缝滑走
      const coverage = entry.radius / GRASP_RADIUS
      const sizeScore = clamp(1 - Math.abs(coverage - 0.95) / 0.95, 0.12, 1)

      // 3) 难度分
      const difficultyScore = DIFFICULTY_SCORE[entry.difficulty] ?? 0.85

      // 4) 重量分：越重越容易滑落
      const weightScore = clamp(1.15 - entry.weight * 0.8, 0.42, 1)

      // 5) 角度分：扁平物品（抱枕）立着比躺着难夹
      const flatness = entry.size.y / Math.max(entry.size.x, entry.size.z)
      let angleScore = 1
      if (flatness < 0.6) {
        const r = entry.body.rotation()
        _q.set(r.x, r.y, r.z, r.w)
        _v.set(0, 1, 0).applyQuaternion(_q)
        const alignment = Math.abs(_v.y)
        angleScore = clamp(0.72 + 0.3 * alignment, 0.72, 1)
      }

      // 6) 随机扰动，保留电玩城的运气成分
      const randomFactor = 0.8 + Math.random() * 0.4

      const total =
        distanceScore * sizeScore * difficultyScore * weightScore * angleScore * randomFactor

      const breakdown: GrabScoreBreakdown = {
        distance: distanceScore,
        size: sizeScore,
        difficulty: difficultyScore,
        weight: weightScore,
        angle: angleScore,
        random: randomFactor,
        total,
      }

      if (!best || total > best.score) {
        best = {
          entry,
          distance: Math.hypot(horizontal, vertical),
          score: total,
          breakdown,
          reason: this.explain(breakdown),
        }
      }
    }

    if (best && best.score < GRAB_THRESHOLD) best.reason = this.explain(best.breakdown, true)
    return best
  }

  /**
   * 成功夹住时手指应该停住的开合度。
   * 由爪子几何反解：让三指指尖正好落在物品表面外一点点，
   * 这样手指是“贴住”物品，而不是插进模型内部。
   */
  gripOpenFor(radius: number): number {
    return clamp(clawOpenForTipRadius(radius + GRASP_CLEARANCE), 0.06, 1)
  }

  /**
   * 爪子正下方最高的那件物品，用于自适应决定下潜深度。
   * 返回它的中心高度（夹持点要对准这里）与顶面高度（退让用）。
   * 下方没有任何物品时，返回地板上一个等效物品的数值。
   */
  topItemUnderClaw(
    x: number,
    z: number,
    radius = 0.15,
  ): { centerY: number; topY: number; radius: number } {
    let best: { centerY: number; topY: number; radius: number } | null = null
    for (const e of this.physics.entries) {
      if (e.collected || e.held) continue
      const t = e.body.translation()
      if (Math.hypot(t.x - x, t.z - z) > radius + e.radius) continue
      const topY = t.y + e.size.y / 2
      if (!best || topY > best.topY) best = { centerY: t.y, topY, radius: e.radius }
    }
    return best ?? { centerY: M.floorY + 0.12, topY: M.floorY, radius: 0.12 }
  }

  /** 把评分明细翻译成玩家能看懂的理由 */
  private explain(b: GrabScoreBreakdown, failed = false): string {
    if (!failed) return '爪子稳稳夹住了'
    const parts: [string, number][] = [
      ['位置偏了一点', 1 - b.distance],
      ['尺寸不合适', 1 - b.size],
      ['物品太滑太重', 1 - b.weight],
      ['没夹稳角度', 1 - b.angle],
      ['难度偏高', 1 - b.difficulty],
    ]
    parts.sort((x, y) => y[1] - x[1])
    return parts[0][0]
  }

  /** 把物品临时约束到爪子中心 */
  hold(entry: PhysicsEntry): void {
    this.physics.hold(entry)
  }

  /** 解除约束，让物品自然掉落 */
  release(entry: PhysicsEntry, velocity?: THREE.Vector3): void {
    this.physics.release(entry, velocity)
  }

  /** 物品落入出货槽，后续不再参与抓取判定 */
  collect(entry: PhysicsEntry): void {
    this.physics.markCollected(entry)
  }

  /** 取物槽里已经落袋、等待玩家取走的物品数量 */
  get collectedCount(): number {
    return this.physics.entries.reduce((n, e) => (e.collected ? n + 1 : n), 0)
  }

  /**
   * 清空取物口：把已落袋的物品从场景与物理世界中一并移除。
   * 正在爪子上 / 仍在机器内的物品不受影响。
   * @returns 清掉的物品数量
   */
  clearCollected(): number {
    const targets = this.physics.entries.filter((e) => e.collected && !e.held)
    for (const entry of targets) {
      const obj = entry.object
      if (obj.parent) obj.parent.remove(obj)
      disposeObject(obj)
      this.physics.removeEntry(entry)
      for (const bucket of this.spawned) {
        const i = bucket.entries.indexOf(entry)
        if (i >= 0) bucket.entries.splice(i, 1)
      }
    }
    // 顺手清掉已经没有实例的配置桶，避免长期累积
    for (let i = this.spawned.length - 1; i >= 0; i--) {
      if (this.spawned[i].entries.length === 0) this.spawned.splice(i, 1)
    }
    return targets.length
  }

  /** 判断某个物品是否已经落进出货槽 */
  isInChute(entry: PhysicsEntry): boolean {
    const t = entry.body.translation()
    return (
      t.x > M.chute.x - M.chute.size / 2 - 0.03 &&
      t.x < M.chute.x + M.chute.size / 2 + 0.03 &&
      t.z > M.chute.z - M.chute.size / 2 - 0.03 &&
      t.z < M.chute.z + M.chute.size / 2 + 0.03 &&
      t.y < M.floorY - 0.02
    )
  }

  /** 物品是否悬在出货口洞口范围内（含搭在洞口边缘的情况），用于滑道滞留检测 */
  isOverChuteMouth(entry: PhysicsEntry): boolean {
    const t = entry.body.translation()
    return (
      t.y < M.floorY + 0.16 &&
      Math.abs(t.x - M.chute.x) < M.chute.size / 2 &&
      Math.abs(t.z - M.chute.z) < M.chute.size / 2
    )
  }

  get totalSpawned(): number {
    return this.spawned.reduce((n, s) => n + s.entries.length, 0)
  }

  /** 清空所有物品（几何体/材质一并释放） */
  clear(): void {
    for (const entry of [...this.physics.entries]) {
      this.physics.removeEntry(entry)
    }
    for (const child of [...this.group.children]) {
      this.group.remove(child)
      disposeObject(child)
    }
    this.spawned.length = 0
    this.placed.length = 0
  }

  dispose(): void {
    this.clear()
  }
}
