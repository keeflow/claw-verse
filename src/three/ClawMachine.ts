import * as THREE from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import type { ClawMachineItem, ClawPosition, GrabOutcome } from '@/types/claw-machine'
import { clamp, damp, wait } from '@/utils/anim'
import { soundFx } from '@/utils/soundFx'
import { CLAW_REST_OPEN, M, THEME } from './constants'
import { AssetLoader } from './AssetLoader'
import { PhysicsWorld, type PhysicsEntry } from './PhysicsWorld'
import { MachineBuilder } from './MachineBuilder'
import { ClawController } from './ClawController'
import { ItemManager, GRAB_THRESHOLD, GRIP_OFFSET } from './ItemManager'
import { CameraController, type ViewPresetName, type ViewState } from './CameraController'
import { Fireworks } from './Fireworks'

export interface ClawMachineCallbacks {
  onClawPosition?: (pos: ClawPosition) => void
  onDirectionChange?: (dir: { x: number; z: number }) => void
  onGrabStart?: () => void
  onGrabEnd?: (outcome: GrabOutcome) => void
  onReady?: () => void
  onWarning?: (message: string) => void
  onFatal?: (message: string) => void
  /** 玩家按下空格 / 回车时请求抓取 */
  onRequestGrab?: () => void
  /** 自动环绕开关状态变化（含用户拖拽导致自动关闭的情况） */
  onAutoRotateChange?: (on: boolean) => void
  /** 视角变化（方位角 / 俯仰角 / 距离），已做去重，仅在数值变化时触发 */
  onViewChange?: (view: ViewState) => void
  /** 意外收获：不是本次投放、自己（或被爪子带倒）滚进取物口的物品 */
  onBonusPrize?: (prize: { itemId: string; itemName: string }) => void
}

const GRAB_FLOW = {
  openBeforeDescend: 0.34,
  /** 垂直运动速度（米/秒），用于按距离换算动画时长 */
  verticalSpeed: 1.15,
  close: 0.36,
  transport: 1.0,
  releaseOpen: 0.32,
  /** 释放后等待物品落进取物槽的最长时间（毫秒） */
  collectTimeout: 3000,
  resetIn: 0.75,
} as const

/**
 * 整个游戏场景的生命周期管理者。
 * 负责：渲染器 / 场景 / 灯光 / 相机 / 物理 / 物品 的装配与销毁，
 * 以及“抓取”这一整套动作的编排。
 */
export class ClawMachine {
  private container: HTMLElement
  private callbacks: ClawMachineCallbacks

  private renderer: THREE.WebGLRenderer | null = null
  private scene = new THREE.Scene()
  private camera!: CameraController
  private physics = new PhysicsWorld()
  private assets = new AssetLoader()
  private builder = new MachineBuilder()
  private items!: ItemManager
  private claw!: ClawController
  private fireworks!: Fireworks

  private machineRoot = new THREE.Group()
  private animated: ReturnType<MachineBuilder['build']>['animated'] = []
  private marker: THREE.Mesh | null = null
  /** 机台操作面板上的实体摇杆（随输入方向倾斜） */
  private joystick: NonNullable<ReturnType<MachineBuilder['build']>['joystick']> | null = null
  /** 摇杆当前的倾斜量（屏幕坐标系，平滑跟随输入） */
  private stickTilt = { x: 0, z: 0 }

  private clock = new THREE.Clock()
  private rafId = 0
  private elapsed = 0
  private running = false
  private disposed = false

  private envRT: THREE.WebGLRenderTarget | null = null
  private heldEntry: PhysicsEntry | null = null
  /** 本次抓取正在投送、等待落槽确认的物品 */
  private deliveredEntry: PhysicsEntry | null = null
  private heldOffset = new THREE.Vector3()
  private heldQuat = new THREE.Quaternion()
  private busy = false
  private paused = false

  private keys = new Set<string>()
  private lastEmittedPos = new THREE.Vector3(999, 999, 999)
  private lastViewSignal = ''
  /** 最近一次的屏幕坐标系输入方向（驱动 3D 摇杆倾斜与 UI 高亮） */
  private inputDir = { x: 0, z: 0 }

  private resizeObserver: ResizeObserver | null = null
  private onWindowResize = () => this.resize()
  private onKeyDown = (e: KeyboardEvent) => this.handleKey(e, true)
  private onKeyUp = (e: KeyboardEvent) => this.handleKey(e, false)
  private onContextLost = (e: Event) => {
    e.preventDefault()
    this.callbacks.onWarning?.('WebGL 上下文丢失，正在尝试恢复…')
  }
  private onContextRestored = () => {
    this.callbacks.onWarning?.('WebGL 上下文已恢复')
  }

  constructor(container: HTMLElement, callbacks: ClawMachineCallbacks = {}) {
    this.container = container
    this.callbacks = callbacks
  }

  /**
   * 触屏设备（手机 / 平板）的 GPU 预算比桌面紧张：
   * 用它来决定采样倍率与阴影贴图分辨率，换取更稳的帧率。
   */
  private readonly touchDevice =
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(pointer: coarse)').matches

  // ------------------------------------------------------------------
  // 初始化
  // ------------------------------------------------------------------

  async init(items: ClawMachineItem[]): Promise<void> {
    // 1) 渲染器
    try {
      this.renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: false,
        powerPreference: 'high-performance',
      })
    } catch (err) {
      console.error('[ClawMachine] WebGL 初始化失败：', err)
      this.callbacks.onFatal?.('当前浏览器不支持 WebGL，无法运行 3D 娃娃机')
      return
    }

    const canvas = this.renderer.domElement
    canvas.style.display = 'block'
    canvas.style.width = '100%'
    canvas.style.height = '100%'
    canvas.style.touchAction = 'none'
    this.container.appendChild(canvas)

    // 手机多数是 DPR 3 的屏幕，封顶 1.75 能省下大量像素填充，画质肉眼几乎无差别
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.touchDevice ? 1.75 : 2))
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.08
    this.renderer.outputColorSpace = THREE.SRGBColorSpace

    canvas.addEventListener('webglcontextlost', this.onContextLost)
    canvas.addEventListener('webglcontextrestored', this.onContextRestored)

    // 2) 场景环境
    this.setupEnvironment()

    // 3) 物理世界
    await this.physics.init()

    // 4) 娃娃机结构
    const built = this.builder.build()
    this.machineRoot = built.root
    this.animated = built.animated
    this.joystick = built.joystick
    this.scene.add(this.machineRoot)
    for (const s of built.statics) {
      this.physics.addStaticBox(
        { x: s.center[0], y: s.center[1], z: s.center[2] },
        { x: s.half[0], y: s.half[1], z: s.half[2] },
        { rotationY: s.rotationY, friction: s.friction, restitution: s.restitution },
      )
    }

    // 5) 机械爪
    this.claw = new ClawController()
    this.claw.snapTo(0, 0, M.clawRestY, CLAW_REST_OPEN)
    this.scene.add(this.claw.root)

    // 5.5) 烟花特效（抓到娃娃时在机器背后燃放）
    this.fireworks = new Fireworks(this.scene)

    // 6) 落点指示环
    this.marker = this.createMarker()
    this.scene.add(this.marker)

    // 7) 物品
    this.items = new ItemManager(this.physics, this.assets)
    this.scene.add(this.items.group)
    await this.items.build(items)

    // 让物品提前落定，进页面即是自然堆叠
    this.physics.fastForward(150)

    const warnings = this.assets.errors
    if (warnings.length) this.callbacks.onWarning?.(warnings[0])

    // 8) 相机（支持 360° 环绕查看）
    const { width, height } = this.sizeOf()
    this.camera = new CameraController(
      this.renderer.domElement,
      width / Math.max(1, height),
      (on) => this.callbacks.onAutoRotateChange?.(on),
    )
    this.camera.resize(width, height)

    // 9) 事件
    window.addEventListener('keydown', this.onKeyDown)
    window.addEventListener('keyup', this.onKeyUp)
    window.addEventListener('resize', this.onWindowResize)
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => this.resize())
      this.resizeObserver.observe(this.container)
    }
    this.resize()

    this.callbacks.onReady?.()
  }

  private setupEnvironment() {
    // 背景渐变
    const canvas = document.createElement('canvas')
    canvas.width = 4
    canvas.height = 256
    const ctx = canvas.getContext('2d')
    if (ctx) {
      const g = ctx.createLinearGradient(0, 0, 0, 256)
      g.addColorStop(0, '#131b2f')
      g.addColorStop(0.45, '#0d1322')
      g.addColorStop(1, '#05070d')
      ctx.fillStyle = g
      ctx.fillRect(0, 0, 4, 256)
    }
    const bg = new THREE.CanvasTexture(canvas)
    bg.colorSpace = THREE.SRGBColorSpace
    bg.mapping = THREE.EquirectangularReflectionMapping
    this.scene.background = bg

    // PBR 环境反射（让金属、玻璃有真实的高光层次）
    try {
      const pmrem = new THREE.PMREMGenerator(this.renderer!)
      const env = new RoomEnvironment()
      const envRT = pmrem.fromScene(env, 0.04)
      this.scene.environment = envRT.texture
      this.scene.environmentIntensity = 0.42
      this.envRT = envRT
      env.dispose?.()
      pmrem.dispose()
    } catch (err) {
      console.warn('[ClawMachine] 环境贴图生成失败，退化为纯灯光照明：', err)
    }

    // 主光（唯一投影光源，控制阴影数量）
    const hemi = new THREE.HemisphereLight(0x7f9ed6, 0x1a2130, 0.55)
    this.scene.add(hemi)

    const key = new THREE.DirectionalLight(0xfff6e8, 2.1)
    key.position.set(3.4, 5.2, 3.2)
    key.castShadow = true
    const shadowRes = this.touchDevice ? 1024 : 1536
    key.shadow.mapSize.set(shadowRes, shadowRes)
    key.shadow.camera.near = 1
    key.shadow.camera.far = 14
    key.shadow.camera.left = -2.4
    key.shadow.camera.right = 2.4
    key.shadow.camera.top = 2.8
    key.shadow.camera.bottom = -0.6
    key.shadow.bias = -0.0006
    key.shadow.normalBias = 0.02
    this.scene.add(key)

    // 轮廓光，勾勒机台边缘
    const rim = new THREE.DirectionalLight(new THREE.Color(THEME.accent), 0.75)
    rim.position.set(-3.2, 2.4, -3.4)
    this.scene.add(rim)

    const fill = new THREE.DirectionalLight(new THREE.Color(THEME.accent2), 0.3)
    fill.position.set(2.6, 1.2, -3.0)
    this.scene.add(fill)
  }

  /** 爪子正下方的落点指示环 */
  private createMarker(): THREE.Mesh {
    const geo = new THREE.RingGeometry(0.115, 0.15, 40)
    const mat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(THEME.accent),
      transparent: true,
      opacity: 0.5,
      side: THREE.DoubleSide,
      depthWrite: false,
    })
    const mesh = new THREE.Mesh(geo, mat)
    mesh.rotation.x = -Math.PI / 2
    mesh.position.y = M.floorY + 0.014
    mesh.renderOrder = 3
    return mesh
  }

  // ------------------------------------------------------------------
  // 循环
  // ------------------------------------------------------------------

  start() {
    if (this.running || this.disposed) return
    this.running = true
    this.clock.getDelta()
    this.loop()
  }

  stop() {
    this.running = false
    if (this.rafId) {
      cancelAnimationFrame(this.rafId)
      this.rafId = 0
    }
  }

  private loop = () => {
    if (!this.running || this.disposed) return
    this.rafId = requestAnimationFrame(this.loop)

    const dt = Math.min(this.clock.getDelta(), 0.05)
    this.elapsed += dt

    if (!this.paused) {
      this.claw.update(dt, this.elapsed)
      this.physics.step(dt)
      this.physics.sync()
      this.updateHeld(dt)
      this.checkChute(dt)
      this.updateMarker()
      this.emitClawPosition()
    }

    this.updateAnimatedMaterials()
    this.updateJoystick(dt)
    this.fireworks?.update(dt)
    this.camera.update(dt)
    this.emitViewState()
    this.renderer?.render(this.scene, this.camera.camera)
  }

  /**
   * 机台操作面板上的实体摇杆：
   * 键盘 / 屏幕摇杆怎么推，机台上那根摇杆就往哪边倾斜。
   */
  private updateJoystick(dt: number) {
    if (!this.joystick) return
    this.stickTilt.x = damp(this.stickTilt.x, this.inputDir.x, 14, dt)
    this.stickTilt.z = damp(this.stickTilt.z, this.inputDir.z, 14, dt)
    const { group, baseTiltX } = this.joystick
    // 屏幕向上（-Z）→ 摇杆向后倒；屏幕向右（+X）→ 摇杆向右倒
    group.rotation.x = baseTiltX + this.stickTilt.z * 0.32
    group.rotation.z = -this.stickTilt.x * 0.32
  }

  /** 视角变化上报（按 2 位小数去重，避免每帧都惊动 Vue） */
  private emitViewState() {
    if (!this.camera || !this.callbacks.onViewChange) return
    const v = this.camera.view
    const key = `${v.azimuth.toFixed(2)}|${v.polar.toFixed(2)}|${v.radius.toFixed(2)}`
    if (key === this.lastViewSignal) return
    this.lastViewSignal = key
    this.callbacks.onViewChange({ azimuth: v.azimuth, polar: v.polar, distance: v.radius })
  }

  /** 被机械爪夹住的物品跟随爪心移动 */
  private updateHeld(dt: number) {
    if (!this.heldEntry) return
    const grab = this.claw.getGrabPoint(_grabTmp)
    _heldTmp.copy(grab).add(this.heldOffset)
    this.physics.driveHeld(this.heldEntry, _heldTmp, this.heldQuat)
    void dt
  }

  /**
   * 等待物品落进取物槽。
   * 返回是否真的掉了进去；超时说明物品弹回了机器内。
   */
  private waitForCollect(entry: PhysicsEntry, timeoutMs: number): Promise<boolean> {
    return new Promise((resolve) => {
      const started = performance.now()
      const tick = () => {
        if (this.disposed) return resolve(false)
        if (entry.collected) return resolve(true)
        // 已经静止却迟迟没进出货口 → 一定是掉回机器里了，提前结束等待
        const t = entry.body.translation()
        const lv = entry.body.linvel()
        const still = Math.hypot(lv.x, lv.y, lv.z) < 0.08
        const backInside =
          Math.abs(t.x) < M.halfW - 0.02 && Math.abs(t.z) < M.halfD - 0.02 && t.y > M.floorY + 0.05
        if (still && backInside && performance.now() - started > 900) return resolve(false)
        if (performance.now() - started > timeoutMs) return resolve(false)
        window.setTimeout(tick, 80)
      }
      tick()
    })
  }

  /**
   * 物品悬在洞口上方却长时间不动（例如斜着卡在洞口）→ 轻轻往下推一把。
   * 见 checkChute。
   */
  private stuckTime = new WeakMap<PhysicsEntry, number>()

  private checkChute(dt: number) {
    if (!this.items) return
    for (const entry of this.physics.entries) {
      if (entry.collected || entry.held) continue
      if (this.items.isInChute(entry)) {
        this.items.collect(entry)
        entry.object.visible = true
        this.stuckTime.delete(entry)

        // 掉落效果：物品落进取物口的瞬间，在落点炸开一团金色粒子
        const t = entry.body.translation()
        this.fireworks?.burstAt(
          _grabTmp.set(t.x, Math.max(t.y, M.chuteFloorY + 0.18), t.z),
          new THREE.Color(THEME.gold),
          60,
          1.4,
        )

        const isDelivered = entry === this.deliveredEntry
        this.deliveredEntry = null
        // 抓到的娃娃成功入袋（或意外滚入一个）→ 烟花 + 成功音乐
        this.celebrate()

        // 不是本次投送的物品也掉了进去（被爪子带倒 / 意外滚入）→
        // 如实告诉玩家这是意外收获，保证「出货数 = 成功数」始终成立
        if (!isDelivered) {
          this.callbacks.onBonusPrize?.({ itemId: entry.itemId, itemName: entry.itemName })
        }
        continue
      }
      // 物品悬在洞口上方却长时间不动（例如斜着卡在洞口）→ 轻轻往下推一把
      if (!this.items.isOverChuteMouth(entry)) {
        this.stuckTime.delete(entry)
        continue
      }
      const lv = entry.body.linvel()
      if (Math.hypot(lv.x, lv.y, lv.z) > 0.3) {
        this.stuckTime.delete(entry)
        continue
      }
      const waited = (this.stuckTime.get(entry) ?? 0) + dt
      if (waited > 1.2) {
        entry.body.wakeUp()
        entry.body.setLinvel({ x: 0, y: -0.6, z: 0 }, true)
        this.stuckTime.set(entry, 0)
      } else {
        this.stuckTime.set(entry, waited)
      }
    }
  }

  private updateMarker() {
    if (!this.marker) return
    this.marker.position.x = this.claw.x
    this.marker.position.z = this.claw.z
    const mat = this.marker.material as THREE.MeshBasicMaterial
    const target = this.busy ? 0.0 : 0.42
    mat.opacity += (target - mat.opacity) * 0.15
    // 距离出货口越近，指示环越偏金色，帮助玩家对准
    const nearChute = Math.hypot(this.claw.x - M.chute.x, this.claw.z - M.chute.z) < 0.18
    mat.color.set(nearChute ? THEME.gold : THEME.accent)
  }

  private updateAnimatedMaterials() {
    for (const a of this.animated) {
      a.material.emissiveIntensity = a.base + Math.sin(this.elapsed * a.speed + a.phase) * a.base * 0.28
    }
  }

  private emitClawPosition() {
    if (!this.claw) return
    const p = _grabTmp.set(this.claw.x, this.claw.y, this.claw.z)
    if (p.distanceTo(this.lastEmittedPos) < 0.004) return
    this.lastEmittedPos.copy(p)
    this.callbacks.onClawPosition?.({
      x: this.claw.x,
      z: this.claw.z,
      y: this.claw.y,
    } satisfies ClawPosition)
  }

  // ------------------------------------------------------------------
  // 输入
  // ------------------------------------------------------------------

  private handleKey(e: KeyboardEvent, down: boolean) {
    const code = e.code
    const relevant =
      code === 'KeyW' ||
      code === 'KeyA' ||
      code === 'KeyS' ||
      code === 'KeyD' ||
      code === 'ArrowUp' ||
      code === 'ArrowDown' ||
      code === 'ArrowLeft' ||
      code === 'ArrowRight' ||
      code === 'Space' ||
      code === 'Enter' ||
      code === 'KeyR'

    if (!relevant) return
    if (e.repeat && down) return
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return

    if (code === 'Space' || code === 'Enter') {
      e.preventDefault()
      if (down) this.callbacks.onRequestGrab?.()
      return
    }
    if (code === 'KeyR') {
      if (down) this.resetView()
      return
    }

    e.preventDefault()
    if (down) this.keys.add(code)
    else this.keys.delete(code)
    this.applyKeyDirection()
  }

  private applyKeyDirection() {
    if (!this.claw) return
    let x = 0
    let z = 0
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) x -= 1
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) x += 1
    // 屏幕向上 = 往远处走
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) z -= 1
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) z += 1
    this.driveClawFromScreen(x, z)
  }

  /**
   * 屏幕方向 → 机床方向。
   * 相机可以 360° 环绕，方向输入必须以画面为参照：
   * 无论转到哪个角度，按「→」都是往屏幕右边移动。
   */
  private screenToMachine(x: number, z: number): { x: number; z: number } {
    const a = this.camera?.azimuth ?? 0
    if (Math.abs(a) < 1e-4) return { x, z }
    const cos = Math.cos(a)
    const sin = Math.sin(a)
    return { x: x * cos + z * sin, z: -x * sin + z * cos }
  }

  /** 驱动机械爪（输入为屏幕坐标系的 -1 ~ 1） */
  private driveClawFromScreen(screenX: number, screenZ: number) {
    // 记录输入方向：3D 摇杆倾斜、UI 高亮都按画面参照系来
    this.inputDir.x = screenX
    this.inputDir.z = screenZ
    if (!this.claw) return
    if (this.busy) return
    const dir = this.screenToMachine(screenX, screenZ)
    this.claw.setDirection(dir.x, dir.z)
    // 回调仍返回屏幕方向：UI 的高低亮/提示都按画面来
    this.callbacks.onDirectionChange?.({ x: screenX, z: screenZ })
  }

  /** 摇杆 / 方向按钮输入（-1 ~ 1，屏幕坐标系） */
  setDirection(x: number, z: number) {
    this.driveClawFromScreen(x, z)
  }

  clearDirection() {
    this.keys.clear()
    this.inputDir.x = 0
    this.inputDir.z = 0
    this.claw?.clearDirection()
    this.callbacks.onDirectionChange?.({ x: 0, z: 0 })
  }

  /**
   * 清空取物口：把已经落进取物腔的奖品全部取走。
   * @returns 清掉的物品数量（0 表示本来就空）
   */
  clearChute(): number {
    if (!this.items) return 0
    const n = this.items.clearCollected()
    if (n > 0) soundFx.playCollect()
    return n
  }

  /** 取物腔里等待取走的奖品数量 */
  get chuteItemCount(): number {
    return this.items?.collectedCount ?? 0
  }

  resetView() {
    this.camera?.reset()
  }

  /** 切到快捷视角（正面 / 左侧 / 背面 / 右侧 / 俯瞰） */
  viewPreset(name: ViewPresetName) {
    this.camera?.viewPreset(name)
  }

  /** 相对当前方位角转动视角（弧度），供 UI 上的左右旋转按钮使用 */
  rotateView(deltaAzimuth: number) {
    this.camera?.rotateBy(deltaAzimuth)
  }

  setAutoRotate(on: boolean) {
    this.camera?.setAutoRotate(on)
  }

  toggleAutoRotate(): boolean {
    return this.camera ? this.camera.toggleAutoRotate() : false
  }

  get isAutoRotating(): boolean {
    return this.camera?.isAutoRotating ?? false
  }

  setPaused(v: boolean) {
    this.paused = v
  }

  resize() {
    if (!this.renderer || !this.camera) return
    const { width, height } = this.sizeOf()
    this.renderer.setSize(width, height, false)
    this.camera.resize(width, height)
  }

  private sizeOf() {
    const rect = this.container.getBoundingClientRect()
    return {
      width: Math.max(1, Math.floor(rect.width)),
      height: Math.max(1, Math.floor(rect.height)),
    }
  }

  // ------------------------------------------------------------------
  // 抓取流程
  // ------------------------------------------------------------------

  get isBusy(): boolean {
    return this.busy
  }

  /**
   * 庆祝：机器背后放一场烟花 + 播放成功音乐。
   * 抓到的娃娃入袋、意外收获入袋时都会触发。
   */
  private celebrate(): void {
    this.fireworks?.celebrate()
    soundFx.playSuccess()
  }

  /** 机械爪控制器（供调试工具或未来的录像回放使用） */
  get controller(): ClawController | undefined {
    return this.claw
  }

  /**
   * 完整抓取动作。
   * 方向控制在流程中被锁定，重复调用会被直接忽略。
   */
  async grab(): Promise<GrabOutcome | null> {
    if (this.busy || this.disposed || !this.claw || !this.items) return null
    this.busy = true
    this.claw.locked = true
    this.claw.clearDirection()
    this.keys.clear()
    // 用户手势时机解锁音频（浏览器自动播放策略要求）
    soundFx.unlock()
    this.callbacks.onDirectionChange?.({ x: 0, z: 0 })
    this.callbacks.onGrabStart?.()

    let held: PhysicsEntry | null = null
    let outcome: GrabOutcome = {
      success: false,
      itemId: undefined,
      itemName: '',
      score: 0,
      reason: '这次没有抓到物品',
    }

    try {
      // 1) 张开爪子
      await this.claw.setOpen(1, GRAB_FLOW.openBeforeDescend)

      // 2) 下降：对准爪子正下方最高物品的中心下潜。
      //    爪心高度由「物品中心 + 夹持偏移」决定，并由 clawMinY 兜底，
      //    保证闭爪时指尖不会插进柜内地板。
      const target = this.items.topItemUnderClaw(this.claw.x, this.claw.z, 0.14)
      const descendY = clamp(target.centerY + GRIP_OFFSET, M.clawMinY, M.railY - 0.14)
      const descendDur = clamp(Math.abs(this.claw.y - descendY) / GRAB_FLOW.verticalSpeed, 0.35, 1.15)
      // 绞盘声与下落同步：时长即下落时长
      soundFx.playDescend(descendDur)
      await this.claw.moveToY(descendY, descendDur)

      // 3) 检测附近物品并综合评分
      const candidate = this.items.evaluate(this.claw.getGrabPoint(_grabTmp))
      const success = !!candidate && candidate.score >= GRAB_THRESHOLD

      // 4) 闭合：抓到时收拢到“抱住物品”的程度，没抓到则完全闭合
      const closeTarget = success && candidate ? this.items.gripOpenFor(candidate.entry.radius) : 0
      await this.claw.setOpen(closeTarget, GRAB_FLOW.close)

      if (success && candidate) {
        held = candidate.entry
        this.heldEntry = held
        const t = held.body.translation()
        _heldTmp.set(t.x, t.y, t.z)
        this.claw.getGrabPoint(_grabTmp)
        this.heldOffset.copy(_heldTmp).sub(_grabTmp)
        const r = held.body.rotation()
        this.heldQuat.set(r.x, r.y, r.z, r.w)
        this.items.hold(held)

        outcome = {
          success: true,
          itemId: held.itemId,
          itemName: held.itemName,
          score: candidate.score,
          reason: candidate.reason,
        }
      } else {
        outcome = {
          success: false,
          itemId: candidate?.entry.itemId,
          itemName: candidate?.entry.itemName ?? '',
          score: candidate?.score ?? 0,
          reason: candidate ? candidate.reason : '爪子下没有物品',
        }
      }

      // 5) 上升
      const ascendDur = clamp(Math.abs(this.claw.y - M.clawRestY) / GRAB_FLOW.verticalSpeed, 0.35, 1.15)
      soundFx.playAscend(ascendDur)
      await this.claw.moveToY(M.clawRestY, ascendDur)

      if (held) {
        // 6) 移动到出货口，并下探到投放高度（洞口已打通，物品一路落进取物腔）
        await this.claw.moveTo(M.chute.x, M.chute.z, GRAB_FLOW.transport)
        const diveDur = clamp(Math.abs(this.claw.y - M.releaseY) / GRAB_FLOW.verticalSpeed, 0.3, 0.9)
        soundFx.playDescend(diveDur * 0.85)
        await this.claw.moveToY(M.releaseY, diveDur, { ignoreFloorLimit: true })

        // 7) 打开 → 物品掉入出货口
        await this.claw.setOpen(1, GRAB_FLOW.releaseOpen)
        this.items.release(held, new THREE.Vector3(0, -0.1, 0))
        this.heldEntry = null
        this.deliveredEntry = held

        // 8) 等物品真正落进取物槽（最多 3 秒）再宣布结果。
        //    偶尔物品会从洞口弹回机器里，这种情况下如实判定为失败。
        const landed = await this.waitForCollect(held, GRAB_FLOW.collectTimeout)
        this.deliveredEntry = null
        if (!landed) {
          outcome = {
            success: false,
            itemId: held.itemId,
            itemName: held.itemName,
            score: 0,
            reason: '东西没抓稳，掉回机器里了',
          }
        }
        // 成功音乐 / 烟花已在物品落槽瞬间由 celebrate() 触发；失败补一个柔和提示音
        if (!landed) soundFx.playFail()

        // 9) 结果
        this.callbacks.onGrabEnd?.(outcome)

        // 10) 复位
        await wait(120)
        await this.claw.reset(GRAB_FLOW.resetIn)
      } else {
        soundFx.playFail()
        this.callbacks.onGrabEnd?.(outcome)
        await this.claw.reset(GRAB_FLOW.resetIn)
      }
    } catch (err) {
      console.error('[ClawMachine] 抓取流程异常：', err)
      this.callbacks.onWarning?.('抓取过程出现异常，已复位')
      this.heldEntry = null
      this.claw.locked = false
      await this.claw.reset(0.4).catch(() => undefined)
    } finally {
      this.heldEntry = null
      this.claw.locked = false
      this.busy = false
    }

    return outcome
  }

  /** 按新配置重建机器内的物品（设置页保存后调用） */
  async rebuild(items: ClawMachineItem[]): Promise<void> {
    if (!this.items || !this.physics.isReady) return
    this.stop()
    try {
      this.items.clear()
      this.heldEntry = null
      await this.items.build(items)
      this.physics.fastForward(150)
    } catch (err) {
      console.error('[ClawMachine] 重建物品失败：', err)
      this.callbacks.onWarning?.('物品重建失败，请检查物品配置')
    }
    this.claw?.snapTo(0, 0, M.clawRestY, CLAW_REST_OPEN)
    this.busy = false
    this.start()
  }

  /** 当前仍在机器内、尚未被取走的物品数量 */
  get remainingItemCount(): number {
    return this.physics.entries.filter((e) => !e.collected).length
  }

  // ------------------------------------------------------------------
  // 销毁
  // ------------------------------------------------------------------

  dispose() {
    if (this.disposed) return
    this.disposed = true
    this.stop()

    window.removeEventListener('keydown', this.onKeyDown)
    window.removeEventListener('keyup', this.onKeyUp)
    window.removeEventListener('resize', this.onWindowResize)
    this.resizeObserver?.disconnect()
    this.resizeObserver = null

    const canvas = this.renderer?.domElement
    canvas?.removeEventListener('webglcontextlost', this.onContextLost)
    canvas?.removeEventListener('webglcontextrestored', this.onContextRestored)

    this.claw?.stop()
    this.items?.dispose()
    this.fireworks?.dispose()
    this.physics.dispose()
    this.camera?.dispose()

    // 释放场景内所有几何体与材质
    this.scene.traverse((o) => {
      const mesh = o as THREE.Mesh
      if (!mesh.isMesh && !(o as THREE.LineSegments).isLineSegments) return
      mesh.geometry?.dispose()
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
      for (const m of mats) m?.dispose()
    })
    this.machineRoot.clear()
    this.scene.clear()

    this.builder.dispose()
    this.assets.dispose()

    if (this.renderer) {
      this.renderer.dispose()
      this.renderer.forceContextLoss?.()
      if (canvas?.parentElement) canvas.parentElement.removeChild(canvas)
      this.renderer = null
    }

    const bg = this.scene.background
    if (bg instanceof THREE.Texture) bg.dispose()
    this.scene.environment = null
    this.envRT?.dispose()
    this.envRT = null
  }
}

const _grabTmp = new THREE.Vector3()
const _heldTmp = new THREE.Vector3()
