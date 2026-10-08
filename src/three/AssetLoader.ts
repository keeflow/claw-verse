import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import type { ClawMachineItem, Vec3 } from '@/types/claw-machine'
import { BUILTIN_SHAPES, ITEM_PALETTE, type BuiltinShape } from '@/models/defaultItems'

const FALLBACK_COLOR = '#7dd3fc'

/** 材质缓存：同色同类型复用，避免大量物品各建一份材质 */
const materialCache = new Map<string, THREE.MeshStandardMaterial>()
/** 贴图缓存 */
const textureCache = new Map<string, THREE.Texture>()
/** GLB 源模型缓存（内存中的原始场景，clone 后使用） */
const modelCache = new Map<string, THREE.Object3D>()

/** 全部由本模块创建的材质，用于统一 dispose */
const ownedMaterials = new Set<THREE.Material>()
const ownedTextures = new Set<THREE.Texture>()

function stdMaterial(color: string, opts: Partial<THREE.MeshStandardMaterialParameters> = {}) {
  const key = `${color}|${JSON.stringify(opts)}`
  const hit = materialCache.get(key)
  if (hit) return hit
  const mat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(color),
    roughness: 0.72,
    metalness: 0.04,
    ...opts,
  })
  materialCache.set(key, mat)
  ownedMaterials.add(mat)
  return mat
}

/** 画布贴图生成（足球花纹、木纹、噪声等程序化贴图） */
function canvasTexture(key: string, size: number, draw: (ctx: CanvasRenderingContext2D, s: number) => void) {
  const hit = textureCache.get(key)
  if (hit) return hit
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (ctx) draw(ctx, size)
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 4
  textureCache.set(key, tex)
  ownedTextures.add(tex)
  return tex
}

function footballTexture(): THREE.Texture {
  return canvasTexture('football', 512, (ctx, s) => {
    ctx.fillStyle = '#f6f7fb'
    ctx.fillRect(0, 0, s, s)
    // 五边形近似：白色球体上散布深色多边形块
    ctx.fillStyle = '#181c26'
    const rows = 4
    const cols = 8
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const cx = ((c + (r % 2 ? 0.5 : 0)) / cols) * s
        const cy = ((r + 0.5) / rows) * s
        const rad = s / cols / 1.85
        ctx.beginPath()
        for (let i = 0; i < 5; i++) {
          const a = (i / 5) * Math.PI * 2 - Math.PI / 2
          const px = cx + Math.cos(a) * rad
          const py = cy + Math.sin(a) * rad
          if (i === 0) ctx.moveTo(px, py)
          else ctx.lineTo(px, py)
        }
        ctx.closePath()
        ctx.fill()
      }
    }
  })
}

function lineTexture(): THREE.Texture {
  return canvasTexture('lines', 128, (ctx, s) => {
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, s, s)
    ctx.strokeStyle = '#c7d2e5'
    ctx.lineWidth = 4
    for (let i = 0; i <= s; i += s / 2) {
      ctx.beginPath()
      ctx.moveTo(i, 0)
      ctx.lineTo(i, s)
      ctx.stroke()
      ctx.beginPath()
      ctx.moveTo(0, i)
      ctx.lineTo(s, i)
      ctx.stroke()
    }
  })
}

// ---------------------------------------------------------------------------
// 程序化模型
// ---------------------------------------------------------------------------

function bodySphere(radius: number, color: string, sx = 1, sy = 1, sz = 1) {
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 22, 16), stdMaterial(color))
  mesh.scale.set(sx, sy, sz)
  mesh.castShadow = true
  mesh.receiveShadow = true
  return mesh
}

/** 小熊 */
function buildBear(): THREE.Group {
  const g = new THREE.Group()
  const body = '#c98a5b'
  const light = '#e6b98c'
  const dark = '#3b2b22'

  const torso = bodySphere(0.5, body, 1, 1.02, 0.92)
  g.add(torso)

  const head = bodySphere(0.36, body)
  head.position.set(0, 0.56, 0.04)
  g.add(head)

  const muzzle = bodySphere(0.17, light, 1, 0.85, 1)
  muzzle.position.set(0, 0.46, 0.32)
  g.add(muzzle)

  const nose = bodySphere(0.07, dark)
  nose.position.set(0, 0.5, 0.46)
  g.add(nose)

  for (const sx of [-1, 1]) {
    const ear = bodySphere(0.15, body)
    ear.position.set(0.27 * sx, 0.78, -0.02)
    g.add(ear)
    const inner = bodySphere(0.085, light)
    inner.position.set(0.27 * sx, 0.78, 0.09)
    g.add(inner)

    const eye = bodySphere(0.055, dark)
    eye.position.set(0.14 * sx, 0.63, 0.31)
    g.add(eye)

    const arm = bodySphere(0.17, body, 1, 1, 1)
    arm.position.set(0.45 * sx, 0.1, 0.06)
    g.add(arm)

    const leg = bodySphere(0.2, body, 1, 0.9, 1)
    leg.position.set(0.24 * sx, -0.42, 0.12)
    g.add(leg)
  }

  return g
}

/** 兔子 */
function buildRabbit(): THREE.Group {
  const g = new THREE.Group()
  const body = '#f4f1f8'
  const pink = '#f2a6bd'
  const dark = '#3a3340'

  const torso = bodySphere(0.44, body, 1, 1.12, 0.92)
  g.add(torso)

  const head = bodySphere(0.3, body)
  head.position.set(0, 0.56, 0.03)
  g.add(head)

  for (const sx of [-1, 1]) {
    const ear = bodySphere(0.1, body, 1, 3.1, 1)
    ear.position.set(0.14 * sx, 0.98, -0.02)
    ear.rotation.z = -0.2 * sx
    g.add(ear)

    const inner = bodySphere(0.055, pink, 1, 3, 1)
    inner.position.set(0.14 * sx, 0.98, 0.055)
    inner.rotation.z = -0.2 * sx
    g.add(inner)

    const eye = bodySphere(0.052, dark)
    eye.position.set(0.13 * sx, 0.62, 0.26)
    g.add(eye)

    const foot = bodySphere(0.16, body, 1.25, 0.7, 1)
    foot.position.set(0.22 * sx, -0.4, 0.1)
    g.add(foot)
  }

  const nose = bodySphere(0.05, pink)
  nose.position.set(0, 0.54, 0.31)
  g.add(nose)

  return g
}

/** 猫咪 */
function buildCat(): THREE.Group {
  const g = new THREE.Group()
  const body = '#e8a33d'
  const cream = '#fbe6c2'
  const dark = '#3a3326'
  const pink = '#f08aa8'

  const torso = bodySphere(0.45, body, 1, 1.0, 0.94)
  g.add(torso)

  const head = bodySphere(0.31, body)
  head.position.set(0, 0.52, 0.05)
  g.add(head)

  // 耳朵：薄三棱柱
  for (const sx of [-1, 1]) {
    const shape = new THREE.Shape()
    shape.moveTo(-0.15, 0)
    shape.lineTo(0.15, 0)
    shape.lineTo(0.0, 0.28)
    shape.closePath()
    const geo = new THREE.ExtrudeGeometry(shape, {
      depth: 0.05,
      bevelEnabled: true,
      bevelThickness: 0.012,
      bevelSize: 0.012,
      bevelSegments: 1,
    })
    geo.center()
    const ear = new THREE.Mesh(geo, stdMaterial(body))
    ear.position.set(0.19 * sx, 0.78, 0.02)
    ear.rotation.z = -0.22 * sx
    ear.castShadow = true
    g.add(ear)

    const eye = bodySphere(0.06, dark, 0.55, 1, 0.6)
    eye.position.set(0.13 * sx, 0.56, 0.29)
    g.add(eye)
  }

  const muzzle = bodySphere(0.11, cream, 1.2, 0.8, 0.8)
  muzzle.position.set(0, 0.43, 0.28)
  g.add(muzzle)

  const nose = bodySphere(0.045, pink)
  nose.position.set(0, 0.46, 0.35)
  g.add(nose)

  // 尾巴
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, -0.1, -0.35),
    new THREE.Vector3(0.25, 0.05, -0.62),
    new THREE.Vector3(0.1, 0.45, -0.68),
    new THREE.Vector3(-0.15, 0.62, -0.5),
  ])
  const tail = new THREE.Mesh(new THREE.TubeGeometry(curve, 22, 0.075, 8, false), stdMaterial(body))
  tail.castShadow = true
  g.add(tail)

  // 前爪
  for (const sx of [-1, 1]) {
    const paw = bodySphere(0.13, cream, 1, 0.8, 1.2)
    paw.position.set(0.3 * sx, -0.02, 0.34)
    g.add(paw)
  }

  return g
}

/** 礼盒 */
function buildGift(): THREE.Group {
  const g = new THREE.Group()
  const box = '#e0455f'
  const ribbon = '#ffd45e'

  const cube = new THREE.Mesh(new THREE.BoxGeometry(0.82, 0.7, 0.82), stdMaterial(box, { roughness: 0.55 }))
  cube.castShadow = true
  cube.receiveShadow = true
  g.add(cube)

  const lid = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.14, 0.9), stdMaterial(box, { roughness: 0.5 }))
  lid.position.y = 0.4
  lid.castShadow = true
  g.add(lid)

  // 十字丝带
  const bandA = new THREE.Mesh(new THREE.BoxGeometry(0.94, 0.72, 0.16), stdMaterial(ribbon, { roughness: 0.35, metalness: 0.35 }))
  bandA.castShadow = true
  g.add(bandA)

  const bandB = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.72, 0.94), stdMaterial(ribbon, { roughness: 0.35, metalness: 0.35 }))
  bandB.castShadow = true
  g.add(bandB)

  // 蝴蝶结
  for (const sx of [-1, 1]) {
    const loop = new THREE.Mesh(
      new THREE.TorusGeometry(0.13, 0.045, 8, 20),
      stdMaterial(ribbon, { roughness: 0.3, metalness: 0.4 }),
    )
    loop.position.set(0.14 * sx, 0.52, 0)
    loop.rotation.set(Math.PI / 2, 0, 0.5 * sx)
    loop.castShadow = true
    g.add(loop)
  }
  const knot = bodySphere(0.075, ribbon)
  knot.position.set(0, 0.5, 0)
  g.add(knot)

  return g
}

/** 足球 */
function buildFootball(): THREE.Group {
  const g = new THREE.Group()
  const mat = new THREE.MeshStandardMaterial({
    map: footballTexture(),
    roughness: 0.42,
    metalness: 0.02,
  })
  ownedMaterials.add(mat)
  const ball = new THREE.Mesh(new THREE.SphereGeometry(0.5, 32, 24), mat)
  ball.castShadow = true
  ball.receiveShadow = true
  g.add(ball)

  const seam = new THREE.Mesh(
    new THREE.SphereGeometry(0.502, 24, 18),
    stdMaterial('#ffffff', { wireframe: true, transparent: true, opacity: 0.12 }),
  )
  g.add(seam)
  return g
}

/** 星星抱枕 */
function buildStar(): THREE.Group {
  const g = new THREE.Group()
  const color = '#f6c945'
  const shape = new THREE.Shape()
  const spikes = 5
  const outer = 0.5
  const inner = 0.22
  for (let i = 0; i < spikes * 2; i++) {
    const r = i % 2 === 0 ? outer : inner
    const a = (i / (spikes * 2)) * Math.PI * 2 - Math.PI / 2
    const x = Math.cos(a) * r
    const y = Math.sin(a) * r
    if (i === 0) shape.moveTo(x, y)
    else shape.lineTo(x, y)
  }
  shape.closePath()

  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: 0.26,
    bevelEnabled: true,
    bevelThickness: 0.1,
    bevelSize: 0.1,
    bevelSegments: 3,
  })
  geo.center()
  const star = new THREE.Mesh(geo, stdMaterial(color, { roughness: 0.85 }))
  star.castShadow = true
  star.receiveShadow = true
  g.add(star)

  // 表情，让抱枕更可爱
  const dark = '#4a3b12'
  for (const sx of [-1, 1]) {
    const eye = bodySphere(0.035, dark, 1, 1.4, 0.6)
    eye.position.set(0.1 * sx, 0.06, 0.19)
    g.add(eye)
  }
  return g
}

/** 无内置形状时的通用占位模型 */
function buildGeneric(color: string): THREE.Group {
  const g = new THREE.Group()
  const geo = new THREE.BoxGeometry(0.62, 0.62, 0.62)
  // 圆角盒：用球体拼接的方式过于复杂，这里用带描边的基础盒体 + 顶面贴图保持质感
  const mesh = new THREE.Mesh(geo, stdMaterial(color, { roughness: 0.6 }))
  mesh.castShadow = true
  mesh.receiveShadow = true
  g.add(mesh)

  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(geo),
    new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.22 }),
  )
  g.add(edges)
  return g
}

/** 棋盘格箱体，用于完全未知的物品 */
function buildCrate(): THREE.Group {
  const g = new THREE.Group()
  const mat = new THREE.MeshStandardMaterial({ map: lineTexture(), roughness: 0.8 })
  ownedMaterials.add(mat)
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.7, 0.7), mat)
  mesh.castShadow = true
  mesh.receiveShadow = true
  g.add(mesh)
  return g
}

function isBuiltinShape(v: string): v is BuiltinShape {
  return (BUILTIN_SHAPES as readonly string[]).includes(v)
}

/** 按 id / 名称猜测内置形状 */
export function guessShape(item: Pick<ClawMachineItem, 'id' | 'name'>): BuiltinShape | 'generic' {
  const key = `${item.id} ${item.name}`.toLowerCase()
  if (isBuiltinShape(item.id)) return item.id
  for (const s of BUILTIN_SHAPES) {
    if (key.includes(s)) return s
  }
  if (key.includes('熊') || key.includes('bear')) return 'bear'
  if (key.includes('兔') || key.includes('rabbit') || key.includes('bunny')) return 'rabbit'
  if (key.includes('猫') || key.includes('cat')) return 'cat'
  if (key.includes('礼') || key.includes('gift') || key.includes('box')) return 'gift'
  if (key.includes('球') || key.includes('ball') || key.includes('foot')) return 'football'
  if (key.includes('星') || key.includes('star')) return 'star'
  return 'generic'
}

/** 创建内置程序化模型 */
export function createBuiltinMesh(shape: BuiltinShape | 'generic', color: string): THREE.Group {
  switch (shape) {
    case 'bear':
      return buildBear()
    case 'rabbit':
      return buildRabbit()
    case 'cat':
      return buildCat()
    case 'gift':
      return buildGift()
    case 'football':
      return buildFootball()
    case 'star':
      return buildStar()
    default:
      return buildGeneric(color)
  }
}

/**
 * 模型资源加载器。
 * - 统一管理 .glb / .gltf 的加载与缓存
 * - 加载失败时回退到内置程序化模型，绝不让单个模型拖垮整个场景
 */
export class AssetLoader {
  private gltf = new GLTFLoader()
  private failed = new Set<string>()
  private disposed = false
  /** 加载失败详情，供 UI 提示 */
  readonly errors: string[] = []

  /** 预加载模型（带缓存）。失败时抛出，由调用方降级 */
  async loadGLB(url: string): Promise<THREE.Object3D> {
    if (this.disposed) throw new Error('AssetLoader 已销毁')
    const cached = modelCache.get(url)
    if (cached) return cached.clone(true)

    const gltf = await this.gltf.loadAsync(url)
    const scene = gltf.scene
    scene.traverse((o) => {
      const mesh = o as THREE.Mesh
      if (mesh.isMesh) {
        mesh.castShadow = true
        mesh.receiveShadow = true
      }
    })
    modelCache.set(url, scene)
    return scene.clone(true)
  }

  /**
   * 根据配置创建物品模型。
   * 优先级：自定义 GLB → 内置程序化模型 → 棋盘格兜底。
   */
  async createItemModel(item: ClawMachineItem): Promise<THREE.Group> {
    const shape = guessShape(item)
    const color = item.thumbnailUrl ? FALLBACK_COLOR : (ITEM_PALETTE[item.id] ?? ITEM_PALETTE[shape] ?? FALLBACK_COLOR)

    if (item.modelUrl && !this.failed.has(item.modelUrl)) {
      try {
        const root = await this.loadGLB(item.modelUrl)
        const group = new THREE.Group()
        // 去掉 GLTF 自带的空父节点旋转差异：统一以包围盒中心为原点
        normalizeToOrigin(root)
        group.add(root)
        return group
      } catch (err) {
        this.failed.add(item.modelUrl)
        const msg = `模型加载失败，已使用占位模型：${item.name} (${item.modelUrl})`
        this.errors.push(msg)
        console.warn('[AssetLoader]', msg, err)
      }
    }

    try {
      return createBuiltinMesh(shape, color)
    } catch (err) {
      this.errors.push(`程序化模型生成失败：${item.name}`)
      console.warn('[AssetLoader] 程序化模型生成失败：', err)
      return buildCrate()
    }
  }

  /** 清空模型缓存 */
  clearCache(): void {
    modelCache.clear()
    this.failed.clear()
  }

  dispose(): void {
    this.disposed = true
    for (const obj of modelCache.values()) disposeObject(obj)
    modelCache.clear()
    this.failed.clear()
    for (const m of ownedMaterials) m.dispose()
    ownedMaterials.clear()
    for (const t of ownedTextures) t.dispose()
    ownedTextures.clear()
    materialCache.clear()
    textureCache.clear()
  }
}

/** 把对象移动到以包围盒中心为原点 */
export function normalizeToOrigin(obj: THREE.Object3D): void {
  obj.updateWorldMatrix(true, true)
  const box = new THREE.Box3().setFromObject(obj)
  if (box.isEmpty()) return
  const center = box.getCenter(new THREE.Vector3())
  obj.position.sub(center)
  obj.updateWorldMatrix(true, true)
}

/**
 * 按配置尺寸缩放模型（体积匹配）。
 * 保持模型原始长宽比，只调整整体大小，视觉上比逐轴拉伸自然得多。
 * @returns 实际使用的缩放系数
 */
export function fitToSize(obj: THREE.Object3D, size: Vec3, extraScale = 1): number {
  obj.updateWorldMatrix(true, true)
  const dim = new THREE.Box3().setFromObject(obj).getSize(new THREE.Vector3())
  if (dim.x <= 1e-5 || dim.y <= 1e-5 || dim.z <= 1e-5) return 1

  const ratio = Math.cbrt((size.x / dim.x) * (size.y / dim.y) * (size.z / dim.z)) * extraScale
  const s = Number.isFinite(ratio) && ratio > 0 ? ratio : 1
  obj.scale.multiplyScalar(s)
  obj.updateWorldMatrix(true, true)
  return s
}

/** 计算对象当前包围盒（自动刷新世界矩阵） */
export function measure(obj: THREE.Object3D): THREE.Box3 {
  obj.updateWorldMatrix(true, true)
  return new THREE.Box3().setFromObject(obj)
}

/** 统一释放几何体；共享材质（本模块缓存）与缓存贴图会被跳过 */
export function disposeObject(root: THREE.Object3D): void {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh
    if (!mesh.isMesh) return
    mesh.geometry?.dispose()
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    for (const m of mats) {
      if (!m || ownedMaterials.has(m)) continue
      for (const key of Object.keys(m)) {
        const val = (m as unknown as Record<string, unknown>)[key]
        if (val instanceof THREE.Texture && !ownedTextures.has(val)) val.dispose()
      }
      m.dispose()
    }
  })
}
