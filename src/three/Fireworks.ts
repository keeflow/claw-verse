import * as THREE from 'three'
import { clamp } from '@/utils/anim'

/**
 * 烟花与落袋闪光特效。
 *
 * 两种玩法：
 *  · launch()      —— 一枚火箭从机器背后升空，到顶后炸成一团彩色粒子；
 *  · burstAt(pos)  —— 在指定位置直接炸开（物品落进取物口时的金色闪光）。
 *
 * 实现要点：
 *  · 全部粒子走 THREE.Points + AdditiveBlending，不需要贴图；
 *  · 每团烟花一个 BufferGeometry，CPU 逐帧推进，寿命结束后自动销毁；
 *  · 定时器不使用 setTimeout，统一在 update(dt) 里倒计时，
 *    保证 dispose() 后不会留下任何回调。
 */

interface Burst {
  points: THREE.Points
  velocities: Float32Array
  age: number
  life: number
  gravity: number
  drag: number
  /** 初速度大小，用于按寿命归一化透明度 */
  speed: number
}

interface Rocket {
  mesh: THREE.Mesh
  velocity: THREE.Vector3
  targetY: number
  hue: number
}

interface Scheduled {
  countdown: number
  fn: () => void
}

const BURST_LIFE = 1.7
const ROCKET_SPEED = 4.6

/** 生成径向渐变的圆形光点贴图，让粒子呈现柔和光晕而不是生硬的方块 */
function makeDotTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 64
  canvas.height = 64
  const ctx = canvas.getContext('2d')
  if (ctx) {
    const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32)
    g.addColorStop(0, 'rgba(255,255,255,1)')
    g.addColorStop(0.32, 'rgba(255,255,255,0.9)')
    g.addColorStop(0.65, 'rgba(255,255,255,0.28)')
    g.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, 64, 64)
  }
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

export class Fireworks {
  readonly group = new THREE.Group()

  private bursts: Burst[] = []
  private rockets: Rocket[] = []
  private scheduled: Scheduled[] = []

  private rocketGeo: THREE.BufferGeometry | null = null
  private dotTex: THREE.CanvasTexture
  private disposables: (THREE.BufferGeometry | THREE.Material | THREE.Texture)[] = []

  /** 爆炸瞬间的补光，快速衰减 */
  private flash: THREE.PointLight
  private flashLife = 0

  constructor(parent: THREE.Object3D) {
    this.group.name = 'Fireworks'
    parent.add(this.group)

    this.dotTex = makeDotTexture()
    this.disposables.push(this.dotTex)

    this.flash = new THREE.PointLight(0xffffff, 0, 9, 2)
    this.flash.position.set(0, 3.2, -3)
    this.group.add(this.flash)

    // 共享的单位球几何（火箭弹头）
    const geo = new THREE.SphereGeometry(0.035, 8, 6)
    this.rocketGeo = geo
    this.disposables.push(geo)
  }

  /** 是否还有活动中的特效（供调试面板显示） */
  get active(): boolean {
    return this.bursts.length > 0 || this.rockets.length > 0 || this.scheduled.length > 0
  }

  /**
   * 放一场完整的庆祝烟花：三枚火箭错开升空，在机器背后炸开。
   * @param originY 爆炸基准高度
   */
  celebrate(originY = 2.45): void {
    const delays = [0, 0.38, 0.82]
    delays.forEach((d, i) => {
      this.after(d, () => {
        this.launch({
          x: -1.5 + i * 1.5 + (Math.random() - 0.5) * 0.6,
          z: -2.6 - Math.random() * 1.2,
          apexY: originY + Math.random() * 0.7,
        })
      })
    })
  }

  /** 发射一枚火箭，到顶自动爆炸 */
  launch(opts: { x: number; z: number; apexY: number }): void {
    if (!this.rocketGeo) return
    const mat = new THREE.MeshBasicMaterial({
      color: new THREE.Color().setHSL(Math.random(), 0.9, 0.7, THREE.SRGBColorSpace),
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
    this.disposables.push(mat)
    const mesh = new THREE.Mesh(this.rocketGeo, mat)
    mesh.position.set(opts.x, 0.4, opts.z)
    this.group.add(mesh)
    this.rockets.push({
      mesh,
      velocity: new THREE.Vector3((Math.random() - 0.5) * 0.4, ROCKET_SPEED, (Math.random() - 0.5) * 0.2),
      targetY: opts.apexY,
      hue: Math.random(),
    })
  }

  /** 在指定位置直接炸开一团粒子（落袋闪光 / 自定义庆祝） */
  burstAt(position: THREE.Vector3, color?: THREE.Color, count = 70, speed = 1.6): void {
    const n = Math.max(12, Math.round(count))
    const positions = new Float32Array(n * 3)
    const velocities = new Float32Array(n * 3)
    const colors = new Float32Array(n * 3)

    // 注意：setHSL 必须显式传 SRGBColorSpace，否则按 linear 空间解释会灰白发淡
    const base = color ?? new THREE.Color().setHSL(Math.random(), 0.95, 0.6, THREE.SRGBColorSpace)
    const white = new THREE.Color(1, 1, 1)

    for (let i = 0; i < n; i++) {
      // 均匀球面方向 + 随机速率
      const u = Math.random() * 2 - 1
      const theta = Math.random() * Math.PI * 2
      const s = Math.sqrt(1 - u * u)
      const dir = new THREE.Vector3(s * Math.cos(theta), u, s * Math.sin(theta))
      const v = speed * (0.45 + Math.random() * 0.75)
      velocities[i * 3] = dir.x * v
      velocities[i * 3 + 1] = dir.y * v + speed * 0.35
      velocities[i * 3 + 2] = dir.z * v

      const c = Math.random() < 0.22 ? white : base
      colors[i * 3] = c.r
      colors[i * 3 + 1] = c.g
      colors[i * 3 + 2] = c.b
    }

    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    const mat = new THREE.PointsMaterial({
      size: 0.15,
      map: this.dotTex,
      vertexColors: true,
      transparent: true,
      opacity: 1,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      sizeAttenuation: true,
    })
    const points = new THREE.Points(geo, mat)
    points.position.copy(position)
    points.frustumCulled = false
    this.group.add(points)
    this.disposables.push(geo, mat)

    this.bursts.push({
      points,
      velocities,
      age: 0,
      life: BURST_LIFE * (0.8 + Math.random() * 0.35),
      gravity: 2.6,
      drag: 0.962,
      speed,
    })

    this.flash.position.copy(position)
    this.flashLife = 1
  }

  private after(delay: number, fn: () => void): void {
    if (delay <= 0) {
      fn()
      return
    }
    this.scheduled.push({ countdown: delay, fn })
  }

  update(dt: number): void {
    // 延时任务
    if (this.scheduled.length) {
      for (let i = this.scheduled.length - 1; i >= 0; i--) {
        const s = this.scheduled[i]
        s.countdown -= dt
        if (s.countdown <= 0) {
          this.scheduled.splice(i, 1)
          s.fn()
        }
      }
    }

    // 火箭升空
    for (let i = this.rockets.length - 1; i >= 0; i--) {
      const r = this.rockets[i]
      r.mesh.position.addScaledVector(r.velocity, dt)
      r.velocity.y -= 1.1 * dt // 轻微重力，让升空轨迹带一点弧线
      const mat = r.mesh.material as THREE.MeshBasicMaterial
      mat.opacity = clamp(r.velocity.y / ROCKET_SPEED, 0.25, 1)
      if (r.mesh.position.y >= r.targetY || r.velocity.y <= 0.6) {
        const pos = r.mesh.position.clone()
        const color = new THREE.Color().setHSL(r.hue, 0.92, 0.6, THREE.SRGBColorSpace)
        this.group.remove(r.mesh)
        mat.dispose()
        this.rockets.splice(i, 1)
        this.burstAt(pos, color, 110, 2.6)
      }
    }

    // 粒子团推进
    for (let i = this.bursts.length - 1; i >= 0; i--) {
      const b = this.bursts[i]
      b.age += dt
      if (b.age >= b.life) {
        this.group.remove(b.points)
        b.points.geometry.dispose()
        ;(b.points.material as THREE.PointsMaterial).dispose()
        this.bursts.splice(i, 1)
        continue
      }
      const attr = b.points.geometry.getAttribute('position') as THREE.BufferAttribute
      const arr = attr.array as Float32Array
      for (let j = 0; j < arr.length; j += 3) {
        const dragF = Math.pow(b.drag, dt * 60)
        b.velocities[j] *= dragF
        b.velocities[j + 1] = b.velocities[j + 1] * dragF - b.gravity * dt
        b.velocities[j + 2] *= dragF
        arr[j] += b.velocities[j] * dt
        arr[j + 1] += b.velocities[j + 1] * dt
        arr[j + 2] += b.velocities[j + 2] * dt
      }
      attr.needsUpdate = true
      const t = b.age / b.life
      ;(b.points.material as THREE.PointsMaterial).opacity = clamp(1 - t * t, 0, 1)
    }

    // 爆炸补光衰减
    if (this.flashLife > 0) {
      this.flashLife = Math.max(0, this.flashLife - dt * 3.2)
      this.flash.intensity = this.flashLife * this.flashLife * 26
    }
  }

  dispose(): void {
    this.scheduled.length = 0
    for (const r of this.rockets) {
      this.group.remove(r.mesh)
      ;(r.mesh.material as THREE.Material).dispose()
    }
    this.rockets.length = 0
    for (const b of this.bursts) {
      this.group.remove(b.points)
      b.points.geometry.dispose()
      ;(b.points.material as THREE.Material).dispose()
    }
    this.bursts.length = 0
    for (const d of this.disposables) d.dispose()
    this.disposables = []
    this.rocketGeo = null
    this.group.removeFromParent()
  }
}
