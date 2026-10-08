import * as THREE from 'three'
import {
  CLAW_BOUNDS,
  CLAW_FINGER,
  CLAW_FINGER_RADIAL,
  CLAW_FINGER_SEGMENTS,
  CLAW_GRIP_OFFSET,
  CLAW_REST_OPEN,
  M,
  THEME,
  clawFingerCurve,
  clawFingerEval,
  clawFingerRadiusAt,
} from './constants'
import { clamp, easeInOutCubic, easeOutCubic, PropertyTweener } from '@/utils/anim'

/** 单根弯曲手指的节点与网格 */
interface ClawFinger {
  root: THREE.Group
  mesh: THREE.Mesh
}

export interface ClawControllerOptions {
  /** 爪子水平移动速度（米/秒） */
  speed?: number
  /** 输入跟随的补间时长 */
  inputDuration?: number
}

/**
 * 机械爪控制器。
 * 负责水平移动 + 边界限制、升降、开合以及完整的抓取动作编排。
 * 所有坐标变化都通过 PropertyTweener 过渡，不存在坐标瞬变。
 *
 * 三根手指是「弯钩」：指根固定在爪心下方，沿一条贝塞尔曲线向外伸出，
 * 末端向内勾回。开合时曲线随之变化（张开≈伸直、闭合≈钩紧），
 * 指尖落点始终由 constants 里的折线模型决定，与夹持判定完全一致。
 */
export class ClawController {
  /** 挂到机器 root 上的节点 */
  readonly root = new THREE.Group()

  /** 当前水平位置（机器局部坐标） */
  x = 0
  z = 0
  /** 当前爪子高度 */
  y: number = M.clawRestY
  /** 开合程度：0 = 完全闭合，1 = 完全张开 */
  open = CLAW_REST_OPEN

  /** 抓取流程中锁定方向控制 */
  locked = false
  /** 是否允许玩家操作 */
  enabled = true

  private tweener: PropertyTweener
  private dirX = 0
  private dirZ = 0
  private targetX = 0
  private targetZ = 0
  private readonly speed: number
  private readonly inputDuration: number

  private gantry = new THREE.Group()
  private head = new THREE.Group()
  private clawBase = new THREE.Group()
  private rope!: THREE.Mesh
  private fingers: ClawFinger[] = []
  private glowRing!: THREE.Mesh
  /** 手指网格上一次生成时的开合度，用于避免无意义的逐帧重建 */
  private lastGeomOpen = Number.NaN
  private disposables: (THREE.BufferGeometry | THREE.Material)[] = []

  constructor(opts: ClawControllerOptions = {}) {
    this.speed = opts.speed ?? 0.68
    this.inputDuration = opts.inputDuration ?? 0.2

    this.root.name = 'ClawController'
    this.tweener = new PropertyTweener(
      (key, value) => {
        switch (key) {
          case 'x':
            this.x = value
            break
          case 'z':
            this.z = value
            break
          case 'y':
            this.y = value
            break
          case 'open':
            this.open = value
            break
        }
      },
      (key) => (key === 'x' ? this.x : key === 'z' ? this.z : key === 'y' ? this.y : this.open),
    )

    this.buildStructure()
    this.applyTransforms()
  }

  // ------------------------------------------------------------------
  // 结构
  // ------------------------------------------------------------------

  private buildStructure() {
    const chrome = new THREE.MeshStandardMaterial({ color: 0xe3eaf5, roughness: 0.16, metalness: 1 })
    const frame = new THREE.MeshStandardMaterial({ color: 0x2c3549, roughness: 0.32, metalness: 0.8 })
    // 手指用深色枪灰 + 金色关节，在明亮的柜内也有足够对比度
    const steel = new THREE.MeshStandardMaterial({ color: 0x4a5570, roughness: 0.34, metalness: 0.92 })
    const gold = new THREE.MeshStandardMaterial({ color: THEME.gold, roughness: 0.25, metalness: 0.95 })
    const neon = new THREE.MeshStandardMaterial({
      color: 0x07141c,
      emissive: new THREE.Color(THEME.accent),
      emissiveIntensity: 3.2,
      roughness: 0.5,
    })
    this.disposables.push(chrome, frame, steel, gold, neon)

    // --- Z 向滑轨（随 X 移动） ---
    const railLen = M.halfD * 2 + 0.1
    const zRailGeo = new THREE.CylinderGeometry(0.019, 0.019, railLen, 14)
    this.disposables.push(zRailGeo)
    const zRail = new THREE.Mesh(zRailGeo, chrome)
    zRail.rotation.x = Math.PI / 2
    zRail.position.y = -0.008
    zRail.castShadow = true
    this.gantry.add(zRail)

    // X 向滑块
    const blockGeo = new THREE.BoxGeometry(0.13, 0.06, 0.13)
    this.disposables.push(blockGeo)
    const block = new THREE.Mesh(blockGeo, frame)
    block.position.y = -0.012
    block.castShadow = true

    // --- 吊挂部分（随 Z 移动） ---
    const carriage = new THREE.Group()
    carriage.add(block)
    // 滑块两侧的导轮
    const wheelGeo = new THREE.TorusGeometry(0.024, 0.01, 8, 18)
    this.disposables.push(wheelGeo)
    for (const sx of [-1, 1]) {
      const wheel = new THREE.Mesh(wheelGeo, gold)
      wheel.position.set(sx * 0.062, -0.008, 0)
      wheel.rotation.y = Math.PI / 2
      wheel.castShadow = true
      carriage.add(wheel)
    }
    this.head.add(carriage)

    // --- 绳索 ---
    const ropeGeo = new THREE.CylinderGeometry(0.008, 0.008, 1, 10)
    ropeGeo.translate(0, -0.5, 0)
    this.disposables.push(ropeGeo)
    this.rope = new THREE.Mesh(ropeGeo, frame)
    this.head.add(this.rope)

    // --- 爪身 ---
    const hubGeo = new THREE.CylinderGeometry(0.072, 0.092, 0.085, 22)
    this.disposables.push(hubGeo)
    const hub = new THREE.Mesh(hubGeo, chrome)
    hub.castShadow = true
    this.clawBase.add(hub)

    const collarGeo = new THREE.CylinderGeometry(0.096, 0.096, 0.022, 26)
    this.disposables.push(collarGeo)
    const collar = new THREE.Mesh(collarGeo, gold)
    collar.position.y = -0.052
    collar.castShadow = true
    this.clawBase.add(collar)

    const glowGeo = new THREE.TorusGeometry(0.115, 0.011, 8, 28)
    this.disposables.push(glowGeo)
    this.glowRing = new THREE.Mesh(glowGeo, neon)
    this.glowRing.rotation.x = Math.PI / 2
    this.glowRing.position.y = -0.056
    this.clawBase.add(this.glowRing)

    // --- 三根弯曲的手指（沿贝塞尔曲线扫出的钩形杆，尺寸来自 constants） ---
    const pinGeo = new THREE.SphereGeometry(CLAW_FINGER.rodR * 1.32, 14, 10)
    this.disposables.push(pinGeo)

    for (let i = 0; i < 3; i++) {
      const fingerRoot = new THREE.Group()
      fingerRoot.rotation.y = (i / 3) * Math.PI * 2 + Math.PI / 6
      // 指根落在爪心下方 pivotOffset 处，曲线原点即指根
      fingerRoot.position.y = -CLAW_FINGER.pivotOffset

      const mesh = new THREE.Mesh(this.createFingerGeometry(), steel)
      mesh.castShadow = true
      // 几何逐帧形变（包围球固定），直接关掉视锥剔除更稳
      mesh.frustumCulled = false

      // 指根关节球：既盖住曲线起点，也让弯钩更像机械结构
      const pin = new THREE.Mesh(pinGeo, gold)
      pin.castShadow = true

      fingerRoot.add(mesh, pin)
      this.clawBase.add(fingerRoot)
      this.fingers.push({ root: fingerRoot, mesh })
    }

    this.head.add(this.clawBase)
    this.gantry.add(this.head)
    this.root.add(this.gantry)
  }

  /** 手指网格：沿中心线扫出的锥形管，顶点缓冲留出位置，之后逐帧写入 */
  private createFingerGeometry(): THREE.BufferGeometry {
    const seg = CLAW_FINGER_SEGMENTS
    const rad = CLAW_FINGER_RADIAL
    const count = (seg + 1) * (rad + 1)

    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3))
    geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(count * 3), 3))

    const indices: number[] = []
    for (let i = 0; i < seg; i++) {
      for (let j = 0; j < rad; j++) {
        const a = i * (rad + 1) + j
        const b = (i + 1) * (rad + 1) + j
        const c = b + 1
        const d = a + 1
        indices.push(a, d, b, b, d, c)
      }
    }
    geo.setIndex(indices)
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0.05, -0.2, 0), 0.42)
    this.disposables.push(geo)
    return geo
  }

  /**
   * 按当前开合度重新扫出手指网格。
   * 只改顶点数据、不重建几何体，因此逐帧调用也没有额外分配。
   */
  private updateFingerMeshes(open: number) {
    const seg = CLAW_FINGER_SEGMENTS
    const rad = CLAW_FINGER_RADIAL
    const curve = clawFingerCurve(open)
    const p = _fingerSample

    for (const finger of this.fingers) {
      const posAttr = finger.mesh.geometry.getAttribute('position') as THREE.BufferAttribute
      const norAttr = finger.mesh.geometry.getAttribute('normal') as THREE.BufferAttribute
      const pa = posAttr.array as Float32Array
      const na = norAttr.array as Float32Array

      let k = 0
      for (let i = 0; i <= seg; i++) {
        const t = i / seg
        clawFingerEval(curve, t, p)
        const nx = Math.cos(p.angle)
        const ny = Math.sin(p.angle)
        const r = clawFingerRadiusAt(t)
        for (let j = 0; j <= rad; j++) {
          const v = (j / rad) * Math.PI * 2
          const cv = Math.cos(v)
          const sv = Math.sin(v)
          pa[k] = p.x + nx * r * cv
          pa[k + 1] = p.y + ny * r * cv
          pa[k + 2] = r * sv
          na[k] = nx * cv
          na[k + 1] = ny * cv
          na[k + 2] = sv
          k += 3
        }
      }

      posAttr.needsUpdate = true
      norAttr.needsUpdate = true
    }
  }

  // ------------------------------------------------------------------
  // 变换应用
  // ------------------------------------------------------------------

  private applyTransforms() {
    this.gantry.position.set(this.x, M.railY, 0)
    this.head.position.z = this.z

    const ropeLen = Math.max(0.05, M.railY - this.y)
    this.rope.scale.y = ropeLen
    this.clawBase.position.y = -ropeLen

    // 手指开合：弯曲的手指形状随开合度实时变化。
    // 指尖落点由 constants 的折线模型决定，与夹持半径 / 下降深度的计算共用同一份几何。
    const open = clamp(this.open, 0, 1)
    if (!(Math.abs(open - this.lastGeomOpen) <= 0.0015)) {
      this.updateFingerMeshes(open)
      this.lastGeomOpen = open
    }

    this.glowRing.scale.setScalar(1 + open * 0.12)
  }

  /** 夹持点世界坐标：手指包裹区间的中心，物品中心应对准这里 */
  getGrabPoint(target = new THREE.Vector3()): THREE.Vector3 {
    return target.set(this.x, this.y - CLAW_GRIP_OFFSET, this.z)
  }

  get position(): THREE.Vector3 {
    return new THREE.Vector3(this.x, this.y, this.z)
  }

  get isBoundAtEdge(): boolean {
    return (
      this.x <= CLAW_BOUNDS.minX + 1e-4 ||
      this.x >= CLAW_BOUNDS.maxX - 1e-4 ||
      this.z <= CLAW_BOUNDS.minZ + 1e-4 ||
      this.z >= CLAW_BOUNDS.maxZ - 1e-4
    )
  }

  // ------------------------------------------------------------------
  // 输入
  // ------------------------------------------------------------------

  /** 设置方向输入，取值 -1 / 0 / 1 */
  setDirection(x: number, z: number) {
    this.dirX = clamp(x, -1, 1)
    this.dirZ = clamp(z, -1, 1)
  }

  /** 直接设置水平目标位置（会被边界钳制） */
  setTarget(x: number, z: number, duration = this.inputDuration) {
    if (this.locked || !this.enabled) return
    this.targetX = clamp(x, CLAW_BOUNDS.minX, CLAW_BOUNDS.maxX)
    this.targetZ = clamp(z, CLAW_BOUNDS.minZ, CLAW_BOUNDS.maxZ)
    void this.tweener.to('x', this.targetX, duration, easeOutCubic)
    void this.tweener.to('z', this.targetZ, duration, easeOutCubic)
  }

  /** 归一化摇杆输入（-1~1），直接映射到边界内的绝对位置 */
  setStick(nx: number, nz: number, duration = this.inputDuration) {
    const cx = (CLAW_BOUNDS.minX + CLAW_BOUNDS.maxX) / 2
    const cz = (CLAW_BOUNDS.minZ + CLAW_BOUNDS.maxZ) / 2
    this.setTarget(
      cx + (nx * (CLAW_BOUNDS.maxX - CLAW_BOUNDS.minX)) / 2,
      cz + (nz * (CLAW_BOUNDS.maxZ - CLAW_BOUNDS.minZ)) / 2,
      duration,
    )
  }

  // ------------------------------------------------------------------
  // 脚本化动作
  // ------------------------------------------------------------------

  /** 平滑移动到指定水平位置 */
  moveTo(x: number, z: number, duration = 0.6): Promise<void> {
    const tx = clamp(x, CLAW_BOUNDS.minX, CLAW_BOUNDS.maxX)
    const tz = clamp(z, CLAW_BOUNDS.minZ, CLAW_BOUNDS.maxZ)
    this.targetX = tx
    this.targetZ = tz
    return Promise.all([
      this.tweener.to('x', tx, duration, easeInOutCubic),
      this.tweener.to('z', tz, duration, easeInOutCubic),
    ]).then(() => undefined)
  }

  /** 垂直移动。ignoreFloorLimit 用于出货口正上方投放（洞口下方是空的，可以潜得更低） */
  moveToY(y: number, duration = 0.5, opts: { ignoreFloorLimit?: boolean } = {}): Promise<void> {
    const min = opts.ignoreFloorLimit ? M.floorY + 0.1 : M.clawMinY
    const ty = clamp(y, min, M.railY - 0.12)
    return this.tweener.to('y', ty, duration, easeInOutCubic)
  }

  /** 开合：0 闭合，1 张开 */
  setOpen(value: number, duration = 0.3): Promise<void> {
    return this.tweener.to('open', clamp(value, 0, 1), duration, easeInOutCubic)
  }

  /** 复位到待机状态 */
  async reset(duration = 0.7): Promise<void> {
    this.locked = false
    this.targetX = 0
    this.targetZ = 0
    await Promise.all([
      this.tweener.to('x', 0, duration, easeInOutCubic),
      this.tweener.to('z', 0, duration, easeInOutCubic),
      this.tweener.to('y', M.clawRestY, duration, easeInOutCubic),
      this.tweener.to('open', CLAW_REST_OPEN, duration, easeInOutCubic),
    ])
  }

  /** 立刻把爪子放到指定状态（用于场景重建） */
  snapTo(x: number, z: number, y: number, open: number) {
    this.tweener.cancel()
    this.x = clamp(x, CLAW_BOUNDS.minX, CLAW_BOUNDS.maxX)
    this.z = clamp(z, CLAW_BOUNDS.minZ, CLAW_BOUNDS.maxZ)
    this.y = clamp(y, M.clawMinY, M.railY - 0.12)
    this.open = clamp(open, 0, 1)
    this.targetX = this.x
    this.targetZ = this.z
    this.applyTransforms()
  }

  // ------------------------------------------------------------------
  // 帧更新
  // ------------------------------------------------------------------

  update(dt: number, elapsed: number) {
    // 键盘/摇杆持续输入：推动目标点后交给补间平滑跟随
    if (!this.locked && this.enabled && (this.dirX !== 0 || this.dirZ !== 0)) {
      const nx = clamp(this.targetX + this.dirX * this.speed * dt, CLAW_BOUNDS.minX, CLAW_BOUNDS.maxX)
      const nz = clamp(this.targetZ + this.dirZ * this.speed * dt, CLAW_BOUNDS.minZ, CLAW_BOUNDS.maxZ)
      if (Math.abs(nx - this.targetX) > 1e-5 || Math.abs(nz - this.targetZ) > 1e-5) {
        this.targetX = nx
        this.targetZ = nz
        void this.tweener.to('x', nx, this.inputDuration, easeOutCubic)
        void this.tweener.to('z', nz, this.inputDuration, easeOutCubic)
      }
    }

    this.tweener.update(dt)
    this.applyTransforms()

    // 爪子上的呼吸灯
    const mat = this.glowRing.material as THREE.MeshStandardMaterial
    mat.emissiveIntensity = 2.6 + Math.sin(elapsed * 3) * 0.9
  }

  /** 松开输入时调用，停止持续移动 */
  clearDirection() {
    this.dirX = 0
    this.dirZ = 0
  }

  /** 停止所有补间（例如场景销毁） */
  stop() {
    this.tweener.dispose()
  }

  dispose() {
    this.tweener.dispose()
    this.root.traverse((o) => {
      const mesh = o as THREE.Mesh
      if (mesh.isMesh) mesh.geometry?.dispose()
    })
    for (const d of this.disposables) d.dispose()
    this.disposables = []
    this.fingers = []
    this.root.clear()
  }
}

/** 复用的采样结果，避免逐帧新建对象 */
const _fingerSample = { x: 0, y: 0, angle: 0 }
