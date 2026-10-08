import RAPIER from '@dimforge/rapier3d-compat'
import * as THREE from 'three'
import type { GrabDifficulty } from '@/types/claw-machine'

/** 碰撞分组：默认组与“被爪子抓住”组 */
const GROUP_DEFAULT = 0x0001
const GROUP_HELD = 0x0002
const GROUPS_DEFAULT = ((GROUP_DEFAULT << 16) | 0xffff) >>> 0
/** 抓在手里时关闭一切碰撞，避免把旁边的物品撞飞 */
const GROUPS_HELD = ((GROUP_HELD << 16) | 0x0000) >>> 0

/** 一个物品在物理世界中的完整映射 */
export interface PhysicsEntry {
  body: RAPIER.RigidBody
  collider: RAPIER.Collider
  object: THREE.Object3D
  /** 归属的物品配置 id */
  itemId: string
  itemName: string
  weight: number
  difficulty: GrabDifficulty
  /** 等效半径，用于抓取覆盖范围判定 */
  radius: number
  /** 尺寸（米） */
  size: THREE.Vector3
  /** 是否正被机械爪持有 */
  held: boolean
  /** 是否已落入出货槽 */
  collected: boolean
}

export interface CreateBodyOptions {
  object: THREE.Object3D
  itemId: string
  itemName: string
  weight: number
  difficulty: GrabDifficulty
  /** 视觉尺寸，用于推算碰撞体 */
  size: THREE.Vector3
  position: THREE.Vector3
  quaternion: THREE.Quaternion
  /** ball 使用球体碰撞体（足球），其余用长方体 */
  shape?: 'box' | 'ball'
  friction?: number
  restitution?: number
  /** 线性阻尼，抑制平铺物品无休止抖动 */
  linearDamping?: number
  angularDamping?: number
}

const _v = new THREE.Vector3()
const _q = new THREE.Quaternion()

/**
 * Rapier 物理世界 + Three.js 对象同步。
 * 只负责“物理”这一层，物品语义交给 ItemManager。
 */
export class PhysicsWorld {
  world!: RAPIER.World
  readonly entries: PhysicsEntry[] = []

  private accumulator = 0
  private readonly fixedStep = 1 / 60
  private ready = false

  /** 全局静态碰撞体（柜体、导轨、地板等） */
  static readonly GRAVITY = { x: 0, y: -9.81, z: 0 }

  async init(): Promise<void> {
    await RAPIER.init()
    this.world = new RAPIER.World(PhysicsWorld.GRAVITY)
    this.world.timestep = this.fixedStep
    // 略微增加迭代次数，让堆叠更稳定
    this.world.integrationParameters.numSolverIterations = 8
    this.ready = true
  }

  get isReady(): boolean {
    return this.ready
  }

  /** 添加一个静态长方体贴片（无刚体，直接挂在 world 上） */
  addStaticBox(
    center: THREE.Vector3Like,
    half: THREE.Vector3Like,
    opts: { rotationY?: number; friction?: number; restitution?: number } = {},
  ): RAPIER.Collider {
    const desc = RAPIER.ColliderDesc.cuboid(half.x, half.y, half.z)
      .setTranslation(center.x, center.y, center.z)
      .setFriction(opts.friction ?? 0.85)
      .setRestitution(opts.restitution ?? 0.02)
      .setCollisionGroups(GROUPS_DEFAULT)

    if (opts.rotationY) {
      _q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), opts.rotationY)
      desc.setRotation({ x: _q.x, y: _q.y, z: _q.z, w: _q.w })
    }
    return this.world.createCollider(desc)
  }

  /** 创建一个动态物品刚体 */
  createItemBody(opts: CreateBodyOptions): PhysicsEntry {
    const { object, size, position, quaternion } = opts

    const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(position.x, position.y, position.z)
      .setRotation({ x: quaternion.x, y: quaternion.y, z: quaternion.z, w: quaternion.w })
      .setLinearDamping(opts.linearDamping ?? 0.22)
      .setAngularDamping(opts.angularDamping ?? 0.9)
      .setCcdEnabled(true)

    const body = this.world.createRigidBody(bodyDesc)

    // 碰撞体略小于视觉尺寸，避免相邻物品互相撑开产生抖动
    const hx = Math.max(0.02, (size.x * 0.94) / 2)
    const hy = Math.max(0.02, (size.y * 0.94) / 2)
    const hz = Math.max(0.02, (size.z * 0.94) / 2)

    const colliderDesc =
      opts.shape === 'ball'
        ? RAPIER.ColliderDesc.ball(Math.max(0.02, Math.max(size.x, size.y, size.z) / 2))
        : RAPIER.ColliderDesc.cuboid(hx, hy, hz)

    colliderDesc
      .setMass(Math.max(0.05, opts.weight))
      .setFriction(opts.friction ?? 0.8)
      .setRestitution(opts.restitution ?? 0.05)
      .setCollisionGroups(GROUPS_DEFAULT)

    const collider = this.world.createCollider(colliderDesc, body)

    const entry: PhysicsEntry = {
      body,
      collider,
      object,
      itemId: opts.itemId,
      itemName: opts.itemName,
      weight: opts.weight,
      difficulty: opts.difficulty,
      radius: Math.max(size.x, size.z) / 2,
      size: size.clone(),
      held: false,
      collected: false,
    }
    this.entries.push(entry)
    return entry
  }

  removeEntry(entry: PhysicsEntry): void {
    const idx = this.entries.indexOf(entry)
    if (idx >= 0) this.entries.splice(idx, 1)
    try {
      this.world.removeRigidBody(entry.body)
    } catch (err) {
      console.warn('[PhysicsWorld] 移除刚体失败：', err)
    }
  }

  /**
   * 把物品“吸附”到机械爪：切换为运动学刚体，之后每帧由爪子驱动。
   * 这是程序化抓取判定的物理落点，能彻底避免夹住却掉落 / 物品弹飞。
   */
  hold(entry: PhysicsEntry): void {
    entry.held = true
    entry.body.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true)
    entry.body.setLinvel({ x: 0, y: 0, z: 0 }, true)
    entry.body.setAngvel({ x: 0, y: 0, z: 0 }, true)
    entry.collider.setCollisionGroups(GROUPS_HELD)
  }

  /** 每帧驱动被持有的物品到指定位置 */
  driveHeld(entry: PhysicsEntry, position: THREE.Vector3, quaternion?: THREE.Quaternion): void {
    entry.body.setNextKinematicTranslation({ x: position.x, y: position.y, z: position.z })
    if (quaternion) {
      entry.body.setNextKinematicRotation({
        x: quaternion.x,
        y: quaternion.y,
        z: quaternion.z,
        w: quaternion.w,
      })
    }
  }

  /** 释放物品：恢复为动态刚体，并给一个很小的初速度，让它自然掉落 */
  release(entry: PhysicsEntry, velocity?: THREE.Vector3): void {
    entry.held = false
    entry.body.setBodyType(RAPIER.RigidBodyType.Dynamic, true)
    entry.collider.setCollisionGroups(GROUPS_DEFAULT)
    entry.body.setLinvel(
      { x: velocity?.x ?? 0, y: velocity?.y ?? -0.2, z: velocity?.z ?? 0 },
      true,
    )
  }

  /** 标记为已收集（掉入出货槽后不会再参与抓取判定） */
  markCollected(entry: PhysicsEntry): void {
    entry.collected = true
  }

  /** 唤醒所有刚体，用于重置场景 */
  wakeAll(): void {
    for (const e of this.entries) {
      if (!e.held) e.body.wakeUp()
    }
  }

  /** 固定步长推进，dt 为渲染帧间隔（秒） */
  step(dt: number): void {
    if (!this.ready) return
    // 页面切到后台再回来时 dt 可能很大，钳制避免物理爆炸
    this.accumulator += Math.min(dt, 0.1)
    let steps = 0
    while (this.accumulator >= this.fixedStep && steps < 5) {
      this.world.step()
      this.accumulator -= this.fixedStep
      steps++
    }
    if (steps >= 5) this.accumulator = 0
  }

  /** 把物理状态同步到 Three.js 对象上 */
  sync(): void {
    for (const e of this.entries) {
      const t = e.body.translation()
      const r = e.body.rotation()
      e.object.position.set(t.x, t.y, t.z)
      e.object.quaternion.set(r.x, r.y, r.z, r.w)
    }
  }

  /**
   * 快速预演若干步（场景初始化时让物品提前落定），
   * 避免玩家进页面时看到物品从天而降的等待。
   */
  fastForward(steps = 120): void {
    if (!this.ready) return
    for (let i = 0; i < steps; i++) this.world.step()
    this.sync()
  }

  /** 查询距离给定点最近的若干个未收集物品 */
  nearby(
    point: THREE.Vector3,
    maxDistance: number,
    filter?: (e: PhysicsEntry) => boolean,
  ): { entry: PhysicsEntry; distance: number }[] {
    const out: { entry: PhysicsEntry; distance: number }[] = []
    for (const e of this.entries) {
      if (e.held || e.collected) continue
      if (filter && !filter(e)) continue
      const t = e.body.translation()
      _v.set(t.x, t.y, t.z)
      const d = _v.distanceTo(point)
      if (d <= maxDistance) out.push({ entry: e, distance: d })
    }
    out.sort((a, b) => a.distance - b.distance)
    return out
  }

  /** 统计仍在机器内、未被收集的物品数量 */
  get activeCount(): number {
    return this.entries.filter((e) => !e.collected).length
  }

  /** 物理世界是否已经静置（全部刚体休眠），用于判断堆叠是否稳定 */
  get isSettled(): boolean {
    return this.entries.every((e) => e.held || e.body.isSleeping())
  }

  dispose(): void {
    if (!this.ready) return
    try {
      this.world.free()
    } catch (err) {
      console.warn('[PhysicsWorld] 释放物理世界失败：', err)
    }
    this.entries.length = 0
    this.ready = false
  }
}
