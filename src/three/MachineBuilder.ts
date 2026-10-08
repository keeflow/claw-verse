import * as THREE from 'three'
import { CHUTE_OPENING, M, THEME } from './constants'

/** 静态碰撞体描述，交给 PhysicsWorld 注册 */
export interface StaticBoxSpec {
  center: [number, number, number]
  half: [number, number, number]
  rotationY?: number
  friction?: number
  restitution?: number
}

export interface MachineBuildResult {
  root: THREE.Group
  statics: StaticBoxSpec[]
  /** 需要被逐帧更新的自发光贴图/材质，用于呼吸灯效果 */
  animated: { material: THREE.MeshStandardMaterial; base: number; speed: number; phase: number }[]
  /** 出货口中心（机器局部坐标），机械爪在此释放物品 */
  chuteCenter: THREE.Vector3
  /** 机台操作面板上的实体摇杆（可随输入方向倾斜，增强代入感） */
  joystick: { group: THREE.Group; baseTiltX: number } | null
}

// ---------------------------------------------------------------------------
// 贴图
// ---------------------------------------------------------------------------

/** 画布中文字体栈：优先系统中文字体，逐级回退，避免渲染成方块 */
const CJK_FONT =
  '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans SC", "Source Han Sans SC", "Heiti SC", sans-serif'

function textCanvasTexture(
  key: string,
  w: number,
  h: number,
  draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void,
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (ctx) draw(ctx, w, h)
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 4
  tex.name = key
  return tex
}

function marqueeTexture(): { map: THREE.CanvasTexture; emissive: THREE.CanvasTexture } {
  const make = (mode: 'map' | 'emissive') =>
    textCanvasTexture(`marquee-${mode}`, 1024, 256, (ctx, w, h) => {
      const g = ctx.createLinearGradient(0, 0, w, h)
      if (mode === 'map') {
        g.addColorStop(0, '#141a2c')
        g.addColorStop(0.5, '#1d2540')
        g.addColorStop(1, '#141a2c')
      } else {
        g.addColorStop(0, '#0a0f1c')
        g.addColorStop(1, '#0a0f1c')
      }
      ctx.fillStyle = g
      ctx.fillRect(0, 0, w, h)

      // 装饰斜条纹
      ctx.globalAlpha = 0.16
      ctx.strokeStyle = '#38e1ff'
      ctx.lineWidth = 10
      for (let i = -h; i < w; i += 46) {
        ctx.beginPath()
        ctx.moveTo(i, h)
        ctx.lineTo(i + h, 0)
        ctx.stroke()
      }
      ctx.globalAlpha = 1

      const text = '娃娃乐园'
      ctx.font = `bold 148px ${CJK_FONT}`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      if (mode === 'map') {
        ctx.fillStyle = '#e9f8ff'
      } else {
        ctx.shadowColor = '#38e1ff'
        ctx.shadowBlur = 42
        ctx.fillStyle = '#bff4ff'
      }
      ctx.fillText(text, w / 2, h / 2 + 4)

      ctx.font = `bold 36px ${CJK_FONT}`
      if (mode === 'map') ctx.fillStyle = '#ff5f97'
      else {
        ctx.shadowColor = '#ff2f7e'
        ctx.shadowBlur = 30
        ctx.fillStyle = '#ff9dc0'
      }
      ctx.fillText('· 3D 抓娃娃机 ·', w / 2, h - 38)
    })
  return { map: make('map'), emissive: make('emissive') }
}

function panelTexture(): THREE.CanvasTexture {
  return textCanvasTexture('front-panel', 512, 160, (ctx, w, h) => {
    ctx.fillStyle = '#0d1220'
    ctx.fillRect(0, 0, w, h)
    ctx.strokeStyle = '#38e1ff'
    ctx.lineWidth = 6
    ctx.strokeRect(10, 10, w - 20, h - 20)
    ctx.font = `bold 62px ${CJK_FONT}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = '#e9f8ff'
    ctx.fillText('取 物 口', w / 2, h / 2 - 10)
    ctx.font = `bold 28px ${CJK_FONT}`
    ctx.fillStyle = '#7ce6ff'
    ctx.fillText('· 打 开 挡 板 取 走 奖 品 ·', w / 2, h - 42)
  })
}

// ---------------------------------------------------------------------------
// 材质
// ---------------------------------------------------------------------------

interface Mats {
  body: THREE.MeshStandardMaterial
  bodyDark: THREE.MeshStandardMaterial
  frame: THREE.MeshStandardMaterial
  chrome: THREE.MeshStandardMaterial
  accent: THREE.MeshStandardMaterial
  accentPink: THREE.MeshStandardMaterial
  neon: THREE.MeshStandardMaterial
  gold: THREE.MeshStandardMaterial
  glass: THREE.MeshPhysicalMaterial
  carpet: THREE.MeshStandardMaterial
  rubber: THREE.MeshStandardMaterial
}

function createMaterials(): Mats {
  return {
    body: new THREE.MeshStandardMaterial({ color: THEME.machineBody, roughness: 0.42, metalness: 0.34 }),
    bodyDark: new THREE.MeshStandardMaterial({ color: THEME.machineBodyDark, roughness: 0.55, metalness: 0.3 }),
    frame: new THREE.MeshStandardMaterial({ color: 0x2c3549, roughness: 0.3, metalness: 0.82 }),
    chrome: new THREE.MeshStandardMaterial({ color: 0xdfe6f0, roughness: 0.14, metalness: 1 }),
    accent: new THREE.MeshStandardMaterial({
      color: 0x0a1620,
      emissive: new THREE.Color(THEME.accent),
      emissiveIntensity: 2.1,
      roughness: 0.4,
    }),
    accentPink: new THREE.MeshStandardMaterial({
      color: 0x1a0a14,
      emissive: new THREE.Color(THEME.accent2),
      emissiveIntensity: 1.9,
      roughness: 0.4,
    }),
    neon: new THREE.MeshStandardMaterial({
      color: 0x061018,
      emissive: new THREE.Color(THEME.neon),
      emissiveIntensity: 1.6,
      roughness: 0.5,
    }),
    gold: new THREE.MeshStandardMaterial({ color: THEME.gold, roughness: 0.28, metalness: 0.9 }),
    glass: new THREE.MeshPhysicalMaterial({
      color: new THREE.Color(THEME.glassTint),
      transparent: true,
      opacity: 0.16,
      roughness: 0.04,
      metalness: 0,
      side: THREE.DoubleSide,
      depthWrite: false,
      clearcoat: 1,
      clearcoatRoughness: 0.05,
      envMapIntensity: 1.8,
    }),
    carpet: new THREE.MeshStandardMaterial({ color: THEME.carpet, roughness: 0.96, metalness: 0.02 }),
    rubber: new THREE.MeshStandardMaterial({ color: 0x14181f, roughness: 0.9, metalness: 0.05 }),
  }
}

function box(
  w: number,
  h: number,
  d: number,
  x: number,
  y: number,
  z: number,
  material: THREE.Material,
  opts: { cast?: boolean; receive?: boolean; rotY?: number } = {},
): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material)
  mesh.position.set(x, y, z)
  if (opts.rotY) mesh.rotation.y = opts.rotY
  mesh.castShadow = opts.cast ?? true
  mesh.receiveShadow = opts.receive ?? true
  return mesh
}

// ---------------------------------------------------------------------------
// 构建
// ---------------------------------------------------------------------------

/** 竖直平面上的空心矩形边框（用于取物口等需要“透空”的位置） */
function uprightFrame(
  w: number,
  h: number,
  bar: number,
  depth: number,
  x: number,
  y: number,
  z: number,
  material: THREE.Material,
): THREE.Group {
  const g = new THREE.Group()
  g.position.set(x, y, z)
  const hw = w / 2
  const hh = h / 2
  g.add(box(w + bar * 2, bar, depth, 0, hh + bar / 2, 0, material))
  g.add(box(w + bar * 2, bar, depth, 0, -hh - bar / 2, 0, material))
  g.add(box(bar, h, depth, -hw - bar / 2, 0, 0, material))
  g.add(box(bar, h, depth, hw + bar / 2, 0, 0, material))
  return g
}

interface Rect {
  x0: number
  x1: number
  z0: number
  z1: number
}

/**
 * 一块挖了矩形孔的水平板（厚度沿 Y）。
 * 娃娃机的楼层封板（柜顶压边、玻璃柜下框）都必须给出货口让路，
 * 否则洞口会被整块板材从上方封死，物品掉落时像被「吃掉」一样。
 */
function plateWithHole(
  outer: Rect,
  hole: Rect,
  y: number,
  thickness: number,
  material: THREE.Material,
): THREE.Group {
  const g = new THREE.Group()
  g.position.y = y

  const addSlab = (x0: number, x1: number, z0: number, z1: number) => {
    const w = x1 - x0
    const d = z1 - z0
    if (w <= 0.001 || d <= 0.001) return
    g.add(box(w, thickness, d, (x0 + x1) / 2, 0, (z0 + z1) / 2, material))
  }

  // 孔洞四条边各留一块条板；孔洞与外框重叠的部分自动为空
  addSlab(outer.x0, outer.x1, outer.z0, Math.min(hole.z0, outer.z1)) // 后侧整条
  addSlab(outer.x0, outer.x1, Math.max(hole.z1, outer.z0), outer.z1) // 前侧整条
  const zMid0 = Math.max(hole.z0, outer.z0)
  const zMid1 = Math.min(hole.z1, outer.z1)
  addSlab(outer.x0, Math.min(hole.x0, outer.x1), zMid0, zMid1) // 左侧
  addSlab(Math.max(hole.x1, outer.x0), outer.x1, zMid0, zMid1) // 右侧
  return g
}

/**
 * 负责整个娃娃机的结构建模。
 * 只生产几何体与静态碰撞体描述，不接触物理世界实例，便于单独调试。
 */
export class MachineBuilder {
  private mats = createMaterials()
  private disposables: (THREE.BufferGeometry | THREE.Material | THREE.Texture)[] = []
  private joystick: MachineBuildResult['joystick'] = null

  build(): MachineBuildResult {
    const root = new THREE.Group()
    root.name = 'ClawMachine'
    const statics: StaticBoxSpec[] = []
    const animated: MachineBuildResult['animated'] = []
    this.joystick = null

    this.buildShowroomFloor(root)
    this.buildBaseCabinet(root, statics, animated)
    this.buildPlayFloor(root, statics, animated)
    this.buildChute(root, statics)
    this.buildGlassBox(root)
    this.buildTopper(root, animated)
    this.buildInteriorLights(root)
    this.buildXrails(root)

    const chuteCenter = new THREE.Vector3(M.chute.x, M.floorY + 0.42, M.chute.z)

    return { root, statics, animated, chuteCenter, joystick: this.joystick }
  }

  // ---------- 地面 ----------
  private buildShowroomFloor(parent: THREE.Group) {
    const ground = new THREE.Mesh(new THREE.CircleGeometry(9, 64), this.mats.carpet)
    ground.rotation.x = -Math.PI / 2
    ground.position.y = -0.005
    ground.receiveShadow = true
    parent.add(ground)
    this.disposables.push(ground.geometry)

    // 机台底盘。顶面必须低于底座踢脚（skirt）的顶面，
    // 否则两者的大面积顶面共面同向，旋转视角时整圈基座闪动。
    const plinth = new THREE.Mesh(
      new THREE.CylinderGeometry(1.55, 1.7, 0.055, 48),
      new THREE.MeshStandardMaterial({ color: 0x0a0e18, roughness: 0.7, metalness: 0.2 }),
    )
    plinth.position.y = 0.0275
    plinth.receiveShadow = true
    plinth.castShadow = true
    parent.add(plinth)
    this.disposables.push(plinth.geometry, plinth.material as THREE.Material)

    // 地面光环
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(1.78, 1.92, 72),
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(THEME.accent),
        transparent: true,
        opacity: 0.22,
        side: THREE.DoubleSide,
      }),
    )
    ring.rotation.x = -Math.PI / 2
    ring.position.y = 0.012
    parent.add(ring)
    this.disposables.push(ring.geometry, ring.material as THREE.Material)
  }

  // ---------- 下半部分柜体 + 操作台 + 取物口 ----------
  private buildBaseCabinet(
    parent: THREE.Group,
    statics: StaticBoxSpec[],
    animated: MachineBuildResult['animated'],
  ) {
    const W = M.cabinetW + 0.06
    const D = M.cabinetD + 0.06
    const H = M.floorY
    // 柜体结构件的顶面收进柜顶压边（capPlate）厚度之内。
    // 若与压边顶面（= floorY）完全共面，旋转视角时两层材质会来回争夺深度，
    // 橱窗底部四周就会持续闪动（z-fighting）。
    const BODY_TOP = M.floorY - 0.01
    const zCenter = 0

    /**
     * 柜体不是一整块：右前方的取物腔（滑道落料处）必须留空，
     * 否则掉进去的奖品会被柜体外壳挡住，看不到出货效果。
     */
    const CAV = { x0: 0.2, x1: 0.78, y0: 0.08, y1: 0.62, z0: M.chute.z - M.chute.size / 2 - 0.02, z1: D / 2 }

    const parts: [number, number, number, number, number, number][] = [
      // [w, h, d, x, y, z]
      [W, BODY_TOP, CAV.z0 + D / 2, 0, BODY_TOP / 2, (-D / 2 + CAV.z0) / 2], // 后段整块
      [CAV.x0 + W / 2, BODY_TOP, CAV.z1 - CAV.z0, (-W / 2 + CAV.x0) / 2, BODY_TOP / 2, (CAV.z0 + CAV.z1) / 2], // 左前块
      [W / 2 - CAV.x1, BODY_TOP, CAV.z1 - CAV.z0, (CAV.x1 + W / 2) / 2, BODY_TOP / 2, (CAV.z0 + CAV.z1) / 2], // 右前柱
      [CAV.x1 - CAV.x0, CAV.y0, CAV.z1 - CAV.z0, (CAV.x0 + CAV.x1) / 2, CAV.y0 / 2, (CAV.z0 + CAV.z1) / 2], // 腔体下方
      // 腔体上方：只保留出货口前方的一段（关闭取物口上沿的柜体）。
      // 出货口正上方的楼层必须留空，洞口才能从玻璃柜一路贯通到取物腔。
      [
        CAV.x1 - CAV.x0,
        BODY_TOP - CAV.y1,
        CAV.z1 - CHUTE_OPENING.z1,
        (CAV.x0 + CAV.x1) / 2,
        (CAV.y1 + BODY_TOP) / 2,
        (CHUTE_OPENING.z1 + CAV.z1) / 2,
      ],
    ]
    for (const [w, h, d, x, y, z] of parts) {
      if (w <= 0.001 || h <= 0.001 || d <= 0.001) continue
      parent.add(box(w, h, d, x, y, z, this.mats.body))
    }

    // 底座踢脚（压在取物腔开口下方）
    const skirt = box(W + 0.03, 0.06, D + 0.03, 0, 0.03, zCenter, this.mats.bodyDark)
    parent.add(skirt)

    // 顶部金属压边：内圈让出玻璃柜内部区域，
    // 出货口正上方不得有任何板材（否则洞口被封死）。
    const capHalfW = (W + 0.05) / 2
    const capHalfD = (D + 0.05) / 2
    const capPlate = plateWithHole(
      { x0: -capHalfW, x1: capHalfW, z0: -capHalfD, z1: capHalfD },
      { x0: -M.halfW, x1: M.halfW, z0: -M.halfD, z1: M.halfD },
      // 顶面比柜内地板高 1mm：压边与地板的外边缘共线，
      // 若同高，旋转时玻璃柜四边的接缝会闪出细线。
      H - 0.024,
      0.05,
      this.mats.frame,
    )
    parent.add(capPlate)
    this.trackGeometries(capPlate)

    // 底部自发光灯带
    const stripGeo = new THREE.BoxGeometry(W * 0.86, 0.028, 0.028)
    this.disposables.push(stripGeo)
    for (const side of [-1, 1]) {
      const strip = new THREE.Mesh(stripGeo, this.mats.accent)
      strip.position.set(0, 0.055, side * (D / 2 + 0.005))
      parent.add(strip)
    }
    animated.push({ material: this.mats.accent, base: 2.1, speed: 0.9, phase: 0 })

    // 侧面散热格栅
    for (const side of [-1, 1]) {
      for (let i = 0; i < 5; i++) {
        const grille = box(0.02, 0.015, D * 0.5, side * (W / 2 + 0.014), 0.26 + i * 0.035, zCenter, this.mats.rubber)
        grille.castShadow = false
        parent.add(grille)
      }
    }

    // 操作台（向前倾斜的面板）
    const panel = new THREE.Group()
    panel.position.set(0, H - 0.02, M.cabinetD / 2 + 0.02)
    const panelSlab = new THREE.Mesh(new THREE.BoxGeometry(W * 0.92, 0.9, 0.06), this.mats.bodyDark)
    panelSlab.rotation.x = -0.95
    panelSlab.position.set(0, 0.0, 0.16)
    panelSlab.castShadow = true
    panelSlab.receiveShadow = true
    panel.add(panelSlab)
    this.disposables.push(panelSlab.geometry)

    // 摇杆
    const stick = new THREE.Group()
    const stickBase = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.095, 0.05, 24), this.mats.rubber)
    stickBase.castShadow = true
    stick.add(stickBase)
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.16, 16), this.mats.chrome)
    shaft.position.y = 0.1
    shaft.castShadow = true
    stick.add(shaft)
    const ball = new THREE.Mesh(
      new THREE.SphereGeometry(0.05, 24, 18),
      new THREE.MeshStandardMaterial({ color: 0xd8344f, roughness: 0.28, metalness: 0.1 }),
    )
    ball.position.y = 0.19
    ball.castShadow = true
    stick.add(ball)
    this.disposables.push(stickBase.geometry, shaft.geometry, ball.geometry, ball.material as THREE.Material)
    stick.position.set(-W * 0.27, 0.055, 0.24)
    stick.rotation.x = 0.4
    panel.add(stick)
    // 记录摇杆，供 ClawMachine 按输入方向驱动倾斜
    this.joystick = { group: stick, baseTiltX: 0.4 }

    // 抓取按钮
    const btnBase = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.03, 28), this.mats.frame)
    btnBase.castShadow = true
    const btn = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.035, 28), this.mats.accentPink)
    btn.position.y = 0.03
    btn.castShadow = true
    const btnGroup = new THREE.Group()
    btnGroup.add(btnBase, btn)
    btnGroup.position.set(W * 0.24, 0.05, 0.24)
    btnGroup.rotation.x = 0.4
    panel.add(btnGroup)
    this.disposables.push(btnBase.geometry, btn.geometry)
    animated.push({ material: this.mats.accentPink, base: 1.9, speed: 2.4, phase: 1.2 })

    // 小屏状态灯
    for (let i = 0; i < 4; i++) {
      const led = new THREE.Mesh(new THREE.SphereGeometry(0.012, 12, 10), this.mats.neon)
      led.position.set(W * 0.06 + i * 0.035, 0.06, 0.27)
      panel.add(led)
      this.disposables.push(led.geometry)
    }

    parent.add(panel)

    // 取物口：正面右侧的玻璃窗，正对柜体内部的取物腔
    const winW = 0.5
    const winH = 0.42
    const winX = (CAV.x0 + CAV.x1) / 2
    const winY = (CAV.y0 + CAV.y1) / 2
    const winZ = D / 2 + 0.005
    const winFrame = uprightFrame(winW, winH, 0.03, 0.02, winX, winY, winZ, this.mats.frame)
    parent.add(winFrame)
    const winGlass = new THREE.Mesh(new THREE.PlaneGeometry(winW, winH), this.mats.glass)
    winGlass.position.set(winX, winY, winZ + 0.014)
    winGlass.renderOrder = 2
    parent.add(winGlass)
    this.disposables.push(winGlass.geometry)

    // 取物口标识牌
    const labelTex = panelTexture()
    this.disposables.push(labelTex)
    const label = new THREE.Mesh(
      new THREE.PlaneGeometry(0.42, 0.12),
      new THREE.MeshBasicMaterial({ map: labelTex, transparent: true }),
    )
    label.position.set(winX, (CAV.y1 + H) / 2, D / 2 + 0.004)
    parent.add(label)
    this.disposables.push(label.geometry, label.material as THREE.Material)

    // 柜体外壳碰撞（四周挡板，让物品无法从玻璃柜下方漏出去）
    // 挡板一路延伸到玻璃柜顶，高度随橱窗高度自适应
    const t = 0.05
    const wallBottom = M.floorY
    const wallTop = M.glassTop + 0.03
    const wallCy = (wallBottom + wallTop) / 2
    const wallHy = (wallTop - wallBottom) / 2
    statics.push(
      { center: [-M.halfW - t, wallCy, 0], half: [t, wallHy, M.halfD + t] },
      { center: [M.halfW + t, wallCy, 0], half: [t, wallHy, M.halfD + t] },
      { center: [0, wallCy, -M.halfD - t], half: [M.halfW + t, wallHy, t] },
      { center: [0, wallCy, M.halfD + t], half: [M.halfW + t, wallHy, t] },
      // 天花板
      { center: [0, M.glassTop + 0.03, 0], half: [M.halfW + t, 0.03, M.halfD + t] },
    )
  }

  // ---------- 玻璃柜内地面（留出货口缺口） ----------
  private buildPlayFloor(parent: THREE.Group, statics: StaticBoxSpec[], animated: MachineBuildResult['animated']) {
    const th = 0.05
    const topY = M.floorY
    const cy = topY - th / 2

    const floorMat = new THREE.MeshStandardMaterial({ color: 0x182034, roughness: 0.62, metalness: 0.18 })
    this.disposables.push(floorMat)

    const chuteMinX = M.chute.x - M.chute.size / 2
    const chuteMinZ = M.chute.z - M.chute.size / 2
    const chuteMaxZ = M.chute.z + M.chute.size / 2

    // 左大块
    const wA = chuteMinX - -M.halfW
    const slabA = box(wA, th, M.halfD * 2, -M.halfW + wA / 2, cy, 0, floorMat)
    parent.add(slabA)
    statics.push({
      center: [-M.halfW + wA / 2, cy, 0],
      half: [wA / 2, th / 2, M.halfD],
      friction: 0.95,
    })

    // 右后块（出货口缺口之外的区域）
    const wB = M.halfW - chuteMinX
    const dB = chuteMinZ - -M.halfD
    const slabB = box(wB, th, dB, chuteMinX + wB / 2, cy, -M.halfD + dB / 2, floorMat)
    parent.add(slabB)
    statics.push({
      center: [chuteMinX + wB / 2, cy, -M.halfD + dB / 2],
      half: [wB / 2, th / 2, dB / 2],
      friction: 0.95,
    })

    // 右前窄条（出货口靠近前玻璃一侧的收边）
    const dC = M.halfD - chuteMaxZ
    if (dC > 0.01) {
      const slabC = box(wB, th, dC, chuteMinX + wB / 2, cy, chuteMaxZ + dC / 2, floorMat)
      parent.add(slabC)
      statics.push({
        center: [chuteMinX + wB / 2, cy, chuteMaxZ + dC / 2],
        half: [wB / 2, th / 2, dC / 2],
        friction: 0.95,
      })
    }

    // 地板高光描边
    const trim = new THREE.Mesh(
      new THREE.BoxGeometry(M.halfW * 2, 0.012, 0.02),
      this.mats.neon,
    )
    trim.position.set(0, M.floorY + 0.008, -M.halfD + 0.012)
    trim.castShadow = false
    parent.add(trim)
    this.disposables.push(trim.geometry)

    // 出货口视觉：坑壁暗面 + 三条金色挡边（呼吸灯）。
    // 注意这里不能再铺任何「假洞平面」——洞口下方是真实的出货滑道，
    // 铺平面会把正在下落的物品从上方视线里整个挡住，玩家就看不到掉落效果了。
    // 深度感由滑道内壁（暗色）+ 坑底缓冲垫（近黑）自然形成。

    // 出货口内侧的三条挡边：散落的物品不会自己滚进去，爪子从上方投放则不受影响。
    // 材质是独立实例并带自发光呼吸，充当「洞口金边」引导灯。
    const maxZ = M.chute.z + M.chute.size / 2
    const lipH = 0.09
    const lipMat = new THREE.MeshStandardMaterial({
      color: THEME.gold,
      emissive: new THREE.Color(THEME.gold),
      emissiveIntensity: 0.55,
      roughness: 0.28,
      metalness: 0.9,
    })
    this.disposables.push(lipMat)
    const innerX = chuteMinX
    const innerZ = chuteMinZ
    // 挡边整体向外让 3mm：其内侧面若与玻璃柜下框（bottomFrame）的
    // 洞口边缘面共面同向（x = hole.x0 / z = hole.z0 / z = hole.z1），
    // 旋转视角时这两层面会在洞口四周整圈闪动（z-fighting）。
    const GAP = 0.003
    const lipA = box(0.03, lipH, M.halfD - innerZ, innerX - 0.015 - GAP, M.floorY + lipH / 2, (innerZ + M.halfD) / 2, lipMat)
    const lipB = box(M.halfW - innerX, lipH, 0.03, (innerX + M.halfW) / 2, M.floorY + lipH / 2, innerZ - 0.015 - GAP, lipMat)
    // 前侧挡边（洞口靠玻璃的一边），防止物品被弹起后从正面滚出
    const lipC = box(M.chute.size, lipH, 0.03, M.chute.x, M.floorY + lipH / 2, maxZ + 0.015 + GAP, lipMat)
    lipA.castShadow = false
    lipB.castShadow = false
    lipC.castShadow = false
    parent.add(lipA, lipB, lipC)
    // 洞口金边呼吸灯：引导玩家把爪子开到出货口上方
    animated.push({ material: lipMat, base: 0.55, speed: 2.2, phase: 2.4 })
    statics.push(
      {
        center: [innerX - 0.015 - GAP, M.floorY + lipH / 2, (innerZ + M.halfD) / 2],
        half: [0.015, lipH / 2, (M.halfD - innerZ) / 2],
        friction: 0.4,
      },
      {
        center: [(innerX + M.halfW) / 2, M.floorY + lipH / 2, innerZ - 0.015 - GAP],
        half: [(M.halfW - innerX) / 2, lipH / 2, 0.015],
        friction: 0.4,
      },
      {
        center: [M.chute.x, M.floorY + lipH / 2, maxZ + 0.015 + GAP],
        half: [M.chute.size / 2, lipH / 2, 0.015],
        friction: 0.4,
      },
    )
  }

  // ---------- 出货滑道 + 取物槽 ----------
  private buildChute(parent: THREE.Group, statics: StaticBoxSpec[]) {
    const s = M.chute.size / 2
    const minX = M.chute.x - s
    const maxX = M.chute.x + s
    const minZ = M.chute.z - s
    const maxZ = M.chute.z + s
    const bottom = M.chuteFloorY
    // 滑道壁顶端收到玻璃柜下框（bottomFrame）底面的同一高度，
    // 比柜顶压边顶面（floorY）低 5mm —— 壁顶被压边整个盖住，
    // 不会与压边 / 柜内地板在同一平面抢深度而闪烁。
    const height = M.floorY - 0.005 - bottom
    const cy = bottom + height / 2
    const t = 0.03

    const chuteMat = new THREE.MeshStandardMaterial({ color: 0x121a2b, roughness: 0.5, metalness: 0.4 })
    this.disposables.push(chuteMat)

    // 左 / 右 / 后壁
    const wallL = box(t * 2, height, M.chute.size, minX - t, cy, M.chute.z, chuteMat)
    const wallR = box(t * 2, height, M.chute.size, maxX + t, cy, M.chute.z, chuteMat)
    const wallB = box(M.chute.size + t * 4, height, t * 2, M.chute.x, cy, minZ - t, chuteMat)
    parent.add(wallL, wallR, wallB)

    statics.push(
      { center: [minX - t, cy, M.chute.z], half: [t, height / 2, s], friction: 0.5 },
      { center: [maxX + t, cy, M.chute.z], half: [t, height / 2, s], friction: 0.5 },
      { center: [M.chute.x, cy, minZ - t], half: [s + t * 2, height / 2, t], friction: 0.5 },
    )

    // 前壁用玻璃，方便从取物口看到掉进去的奖品
    const frontGlass = new THREE.Mesh(
      new THREE.PlaneGeometry(M.chute.size + t * 2, height),
      this.mats.glass,
    )
    frontGlass.position.set(M.chute.x, cy, maxZ + t)
    parent.add(frontGlass)
    this.disposables.push(frontGlass.geometry)
    statics.push({
      center: [M.chute.x, cy, maxZ + t],
      half: [s + t, height / 2, t * 0.6],
      friction: 0.2,
      restitution: 0.1,
    })

    // 槽底 + 缓冲垫
    const floorPad = box(M.chute.size + t * 4, 0.04, M.chute.size + t * 4, M.chute.x, bottom - 0.02, M.chute.z, this.mats.rubber)
    parent.add(floorPad)
    statics.push({
      center: [M.chute.x, bottom - 0.02, M.chute.z],
      half: [s + t * 2, 0.02, s + t * 2],
      friction: 0.95,
      restitution: 0.02,
    })

    // 滑道底部光带
    const glow = new THREE.Mesh(new THREE.BoxGeometry(M.chute.size, 0.012, 0.012), this.mats.gold)
    glow.position.set(M.chute.x, bottom + 0.03, maxZ - 0.02)
    glow.castShadow = false
    parent.add(glow)
    this.disposables.push(glow.geometry)

    // 取物腔内的补光灯，让玩家能看清掉进来的奖品
    const trayLight = new THREE.PointLight(0xffe9c4, 1.6, 1.5, 2)
    trayLight.position.set(M.chute.x, bottom + 0.34, M.chute.z - 0.04)
    parent.add(trayLight)

    // 腔体内壁加一层浅色，配合补光灯提升可见度
    const trayBack = new THREE.Mesh(
      new THREE.PlaneGeometry(M.chute.size, height * 0.9),
      new THREE.MeshStandardMaterial({ color: 0x33405c, roughness: 0.75, metalness: 0.1 }),
    )
    trayBack.position.set(M.chute.x, cy, minZ + 0.005)
    parent.add(trayBack)
    this.disposables.push(trayBack.geometry, trayBack.material as THREE.Material)
  }

  // ---------- 玻璃柜 ----------
  private buildGlassBox(parent: THREE.Group) {
    // 立柱根部沉入柜顶压边（capPlate）之内 2cm，柱顶仍在玻璃柜顶面 ——
    // 避免柱底圆面与压边顶面在同一平面闪烁。
    const postBottom = M.floorY - 0.02
    const h = M.glassTop - postBottom
    const cy = (postBottom + M.glassTop) / 2
    const postR = 0.032

    // 四角立柱
    const postGeo = new THREE.CylinderGeometry(postR, postR, h, 12)
    this.disposables.push(postGeo)
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const post = new THREE.Mesh(postGeo, this.mats.frame)
        post.position.set(sx * (M.halfW + 0.035), cy, sz * (M.halfD + 0.035))
        post.castShadow = true
        parent.add(post)
      }
    }

    // 玻璃面板
    const panels: [number, number, number, number][] = [
      // [w, h, x, z] + 旋转
      [M.halfD * 2, h, -M.halfW - 0.02, 0],
      [M.halfD * 2, h, M.halfW + 0.02, 0],
      [M.halfW * 2, h, 0, -M.halfD - 0.02],
      [M.halfW * 2, h, 0, M.halfD + 0.02],
    ]
    panels.forEach(([w, hh, x, z], i) => {
      const pane = new THREE.Mesh(new THREE.PlaneGeometry(w, hh), this.mats.glass)
      pane.position.set(x, cy, z)
      if (i < 2) pane.rotation.y = Math.PI / 2
      pane.renderOrder = 2
      parent.add(pane)
      this.disposables.push(pane.geometry)
    })

    // 上金属框
    const frameGeoTop = new THREE.BoxGeometry(M.halfW * 2 + 0.1, 0.05, M.halfD * 2 + 0.1)
    const topFrame = new THREE.Mesh(frameGeoTop, this.mats.frame)
    topFrame.position.set(0, M.glassTop - 0.02, 0)
    topFrame.castShadow = true
    parent.add(topFrame)
    this.disposables.push(frameGeoTop)

    // 下金属框：同样是挖了洞的板件，给出货口留出贯通的通道，
    // 物品下落时从洞口一路可见，直到取物腔底部。
    const bottomFrame = plateWithHole(
      { x0: -M.halfW - 0.05, x1: M.halfW + 0.05, z0: -M.halfD - 0.05, z1: M.halfD + 0.05 },
      { x0: CHUTE_OPENING.x0, x1: CHUTE_OPENING.x1, z0: CHUTE_OPENING.z0, z1: CHUTE_OPENING.z1 },
      M.floorY + 0.02,
      0.05,
      this.mats.frame,
    )
    bottomFrame.castShadow = true
    parent.add(bottomFrame)
    this.trackGeometries(bottomFrame)
  }

  /** 把组合板件里自动生成的几何体登记到统一释放列表 */
  private trackGeometries(group: THREE.Group) {
    group.traverse((o) => {
      const mesh = o as THREE.Mesh
      if (mesh.isMesh) this.disposables.push(mesh.geometry)
    })
  }

  // ---------- 顶部灯箱 ----------
  private buildTopper(parent: THREE.Group, animated: MachineBuildResult['animated']) {
    const W = M.cabinetW + 0.08
    const D = M.cabinetD + 0.08
    const H = M.topperH
    const y = M.glassTop + H / 2

    const topper = box(W, H, D, 0, y, 0, this.mats.body)
    parent.add(topper)

    const trim = box(W + 0.04, 0.05, D + 0.04, 0, M.glassTop + 0.03, 0, this.mats.frame)
    parent.add(trim)

    // 霓虹灯带（四边）
    const neonGeo = new THREE.BoxGeometry(W, 0.022, 0.022)
    this.disposables.push(neonGeo)
    for (const sz of [-1, 1]) {
      const n = new THREE.Mesh(neonGeo, this.mats.neon)
      n.position.set(0, M.glassTop + H - 0.05, sz * (D / 2 + 0.02))
      parent.add(n)
    }
    const neonGeoZ = new THREE.BoxGeometry(0.022, 0.022, D)
    this.disposables.push(neonGeoZ)
    for (const sx of [-1, 1]) {
      const n = new THREE.Mesh(neonGeoZ, this.mats.neon)
      n.position.set(sx * (W / 2 + 0.02), M.glassTop + H - 0.05, 0)
      parent.add(n)
    }
    animated.push({ material: this.mats.neon, base: 1.6, speed: 1.7, phase: 0.6 })

    // 正 / 背面灯箱画布
    const { map, emissive } = marqueeTexture()
    this.disposables.push(map, emissive)
    const marqueeMat = new THREE.MeshStandardMaterial({
      map,
      emissiveMap: emissive,
      emissive: new THREE.Color(0xffffff),
      emissiveIntensity: 1.25,
      roughness: 0.5,
      metalness: 0.1,
    })
    this.disposables.push(marqueeMat)

    for (const sz of [-1, 1]) {
      const face = new THREE.Mesh(new THREE.PlaneGeometry(W * 0.94, H * 0.72), marqueeMat)
      face.position.set(0, y + 0.01, sz * (D / 2 + 0.002))
      if (sz < 0) face.rotation.y = Math.PI
      parent.add(face)
      this.disposables.push(face.geometry)
    }
  }

  // ---------- 柜内灯光 ----------
  private buildInteriorLights(parent: THREE.Group) {
    // 灯槽贴着玻璃柜顶，给下方导轨与机械爪留出运动空间
    const housing = box(M.halfW * 2, 0.03, M.halfD * 2, 0, M.glassTop - 0.016, 0, this.mats.bodyDark)
    housing.castShadow = false
    parent.add(housing)

    const lightGeo = new THREE.BoxGeometry(0.1, 0.014, M.halfD * 1.5)
    this.disposables.push(lightGeo)
    const lightMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      emissive: new THREE.Color(0xfff2dc),
      emissiveIntensity: 2.6,
      roughness: 0.6,
    })
    this.disposables.push(lightMat)
    for (const sx of [-0.42, 0, 0.42]) {
      const l = new THREE.Mesh(lightGeo, lightMat)
      l.position.set(sx, M.glassTop - 0.045, 0)
      l.castShadow = false
      parent.add(l)
    }

    // 实际照明：两盏射灯（不投影，仅提亮柜内，避免阴影数量膨胀）
    for (const sx of [-0.45, 0.45]) {
      const spot = new THREE.SpotLight(0xfff4e2, 11, 3.2, Math.PI / 3.2, 0.6, 1.5)
      spot.position.set(sx, M.glassTop - 0.09, -0.18)
      spot.target.position.set(sx * 0.5, M.floorY, 0.16)
      parent.add(spot, spot.target)
    }

    // 柜内氛围灯
    const ambient = new THREE.PointLight(new THREE.Color(THEME.neon), 2.6, 3, 2)
    ambient.position.set(0, M.glassTop - 0.28, 0)
    parent.add(ambient)
  }

  // ---------- X 导轨 ----------
  private buildXrails(parent: THREE.Group) {
    const len = M.halfW * 2 + 0.06
    const geo = new THREE.CylinderGeometry(0.019, 0.019, len, 14)
    this.disposables.push(geo)
    for (const sz of [-0.32, 0.32]) {
      const rail = new THREE.Mesh(geo, this.mats.chrome)
      rail.rotation.z = Math.PI / 2
      rail.position.set(0, M.railY, sz)
      rail.castShadow = true
      parent.add(rail)
    }

    // 导轨端座
    for (const sx of [-1, 1]) {
      const mount = box(0.05, 0.09, 0.72, sx * (M.halfW + 0.02), M.railY, 0, this.mats.frame)
      parent.add(mount)
    }
  }

  /** 释放本模块创建的资源 */
  dispose(): void {
    for (const d of this.disposables) d.dispose()
    this.disposables = []
    for (const m of Object.values(this.mats)) m.dispose()
  }
}
