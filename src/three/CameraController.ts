import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { clamp, easeInOutCubic, lerp } from '@/utils/anim'

/** 默认最佳观察位（正前方偏右，能同时看清柜内物品、机械爪与取物口） */
const DEFAULT_POSITION = new THREE.Vector3(0.34, 2.62, 5.02)
const DEFAULT_TARGET = new THREE.Vector3(0, 1.24, 0.02)

/**
 * 环绕约束。
 * 方位角故意不设上下限 —— 娃娃机可以 360° 自由环绕查看；
 * 只限制俯仰与距离：俯仰不让镜头贴到正上方（会与轨道打架），
 * 也不让它低到地板以下；距离既不会钻进柜体，也能拉远看全景。
 */
export const VIEW_LIMITS = {
  minPolar: 0.16,
  maxPolar: 1.62,
  minDistance: 2.4,
  maxDistance: 8.2,
} as const

/** 快捷视角：方位角（0 = 正面 / π = 背面）、俯仰角、距离 */
export const VIEW_PRESETS = {
  front: { azimuth: 0.07, polar: 1.3, distance: 5.2 },
  right: { azimuth: Math.PI / 2, polar: 1.3, distance: 5.2 },
  back: { azimuth: Math.PI, polar: 1.3, distance: 5.2 },
  left: { azimuth: -Math.PI / 2, polar: 1.3, distance: 5.2 },
  /** 机内特写：贴近玻璃看物品与爪子，方便对位 */
  close: { azimuth: 0.07, polar: 1.12, distance: 2.95 },
} as const

export type ViewPresetName = keyof typeof VIEW_PRESETS

export const VIEW_PRESET_LABEL: Record<ViewPresetName, string> = {
  front: '正面',
  right: '右侧',
  back: '背面',
  left: '左侧',
  close: '特写',
}

interface SphericalView {
  azimuth: number
  polar: number
  radius: number
}

/** 对外暴露的视角状态（距离用 distance 命名，UI 更直观） */
export interface ViewState {
  azimuth: number
  polar: number
  distance: number
}

interface ViewTween extends SphericalView {
  fromAzimuth: number
  fromPolar: number
  fromRadius: number
  elapsed: number
  duration: number
}

const _v = new THREE.Vector3()
const _sph = new THREE.Spherical()

/** 默认机位（不加屏幕比例缩放的那一份「标准距离」）的球坐标 */
const HOME_VIEW: SphericalView = (() => {
  const s = new THREE.Spherical().setFromVector3(_v.copy(DEFAULT_POSITION).sub(DEFAULT_TARGET))
  return { azimuth: s.theta, polar: s.phi, radius: s.radius }
})()

/**
 * 按屏幕宽高比给出机位缩放系数。
 *
 * 竖直视角固定 42°，宽高比越小水平视角就越窄 —— 竖屏手机上机台两侧
 * 会被裁掉。这里把机位整体拉远一点补偿：宽高比 ≥ 1 不动，竖屏最多拉远 35%，
 * 保证娃娃机（含灯箱）在任何手机上都能完整入镜。
 */
export function distanceScaleForAspect(aspect: number): number {
  if (!Number.isFinite(aspect) || aspect <= 0) return 1
  if (aspect >= 1) return 1
  return Math.min(1.35, 1 + (1 - aspect) * 0.35)
}

/** 把角度收敛到 (-π, π]，用于取最短旋转路径 */
export function wrapAngle(a: number): number {
  return THREE.MathUtils.euclideanModulo(a + Math.PI, Math.PI * 2) - Math.PI
}

/** 判断当前视角最接近哪个预设（误差超过 tolerance 返回 null） */
export function matchPreset(
  view: Pick<SphericalView, 'azimuth' | 'polar'>,
  tolerance = 0.08,
): ViewPresetName | null {
  let best: ViewPresetName | null = null
  let bestErr = tolerance
  for (const name of Object.keys(VIEW_PRESETS) as ViewPresetName[]) {
    const p = VIEW_PRESETS[name]
    const err = Math.max(
      Math.abs(wrapAngle(view.azimuth - p.azimuth)),
      Math.abs(view.polar - p.polar) * 0.8,
    )
    if (err < bestErr) {
      bestErr = err
      best = name
    }
  }
  return best
}

/**
 * 相机控制器。
 * 支持 360° 自由环绕（拖动 / 触屏）、滚轮缩放、快捷视角切换与自动旋转。
 * 所有程序化转场都在球坐标下插值，镜头沿弧线绕行，不会从机台中间穿过去。
 */
export class CameraController {
  readonly camera: THREE.PerspectiveCamera
  readonly controls: OrbitControls

  private tween: ViewTween | null = null
  /** 自动旋转的用户意愿（补间期间会被临时压制，结束后恢复） */
  private autoRotateWanted = false
  /** 外部主动禁用（例如弹出结果弹窗时锁住视角） */
  private userEnabled = true
  /** 当前屏幕比例对应的机位缩放（竖屏拉远，见 distanceScaleForAspect） */
  private distanceScale = 1
  private readonly home: SphericalView = HOME_VIEW
  private readonly onAutoRotateChange?: (on: boolean) => void
  private readonly domElement: HTMLElement
  private readonly handlePointerDown = () => {
    // 用户主动拖拽 = 接管视角：停止程序化转场，并关掉自动旋转（按钮状态同步刷新）
    this.stopTween()
    if (this.autoRotateWanted) this.setAutoRotate(false)
  }

  constructor(
    domElement: HTMLElement,
    aspect: number,
    onAutoRotateChange?: (on: boolean) => void,
  ) {
    this.domElement = domElement
    this.onAutoRotateChange = onAutoRotateChange

    this.camera = new THREE.PerspectiveCamera(42, aspect, 0.1, 80)
    this.camera.position.copy(DEFAULT_POSITION)

    this.controls = new OrbitControls(this.camera, domElement)
    this.controls.target.copy(DEFAULT_TARGET)
    this.controls.enableDamping = true
    this.controls.dampingFactor = 0.09
    // 触屏上手指的行程比鼠标短得多，同样转 30° 要滑更长的距离 —— 提一点灵敏度
    const coarsePointer =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(pointer: coarse)').matches
    this.controls.rotateSpeed = coarsePointer ? 0.62 : 0.45
    this.controls.zoomSpeed = coarsePointer ? 0.85 : 0.7
    this.controls.zoomToCursor = false
    this.controls.enablePan = false
    this.controls.minPolarAngle = VIEW_LIMITS.minPolar
    this.controls.maxPolarAngle = VIEW_LIMITS.maxPolar
    // 不设置 min/maxAzimuthAngle：方位角完全放开，可绕机器一圈查看
    this.controls.autoRotateSpeed = 0.9

    // 竖屏 / 窄屏：机位与距离限位一起按比例放大，整台机器才不会被裁掉
    this.distanceScale = distanceScaleForAspect(aspect)
    this.applyDistanceLimits()
    if (this.distanceScale !== 1) {
      // 只改半径不改方向：初始机位沿原视线方向后退
      this.camera.position.sub(this.controls.target).multiplyScalar(this.distanceScale).add(this.controls.target)
    }

    this.controls.update()

    // 滚轮缩放同样视为用户接管，取消正在进行的转场
    this.controls.addEventListener('start', () => this.stopTween())
    domElement.addEventListener('pointerdown', this.handlePointerDown)
  }

  // ------------------------------------------------------------------
  // 视角控制
  // ------------------------------------------------------------------

  /** 平滑转到指定方位角（弧度，可超过 ±π，会走最短路径） */
  rotateTo(azimuth: number, polar?: number, distance?: number, duration = 0.85): void {
    const cur = this.readSpherical()
    // 走最短路径：从当前方位角出发的等价角
    const toAzimuth = cur.azimuth + wrapAngle(azimuth - cur.azimuth)
    // 传入的 distance 是「标准距离」，要乘上当前屏幕比例的缩放，竖屏同样能看全机器
    const radius = distance !== undefined ? distance * this.distanceScale : cur.radius
    this.startTween({
      fromAzimuth: cur.azimuth,
      fromPolar: cur.polar,
      fromRadius: cur.radius,
      azimuth: toAzimuth,
      polar: clamp(polar ?? cur.polar, VIEW_LIMITS.minPolar, VIEW_LIMITS.maxPolar),
      radius: clamp(radius, this.controls.minDistance, this.controls.maxDistance),
      elapsed: 0,
      duration: Math.max(0.1, duration),
    })
  }

  /** 相对当前方位角旋转（弧度，正值为顺时针绕机器转） */
  rotateBy(deltaAzimuth: number, duration = 0.6): void {
    this.rotateTo(this.readSpherical().azimuth + deltaAzimuth, undefined, undefined, duration)
  }

  /** 切到快捷视角 */
  viewPreset(name: ViewPresetName, duration = 0.85): void {
    const p = VIEW_PRESETS[name]
    this.rotateTo(p.azimuth, p.polar, p.distance, duration)
  }

  /** 开启 / 关闭自动环绕 */
  setAutoRotate(on: boolean): void {
    this.autoRotateWanted = on
    this.controls.autoRotate = on && !this.tween
    this.onAutoRotateChange?.(on)
  }

  toggleAutoRotate(): boolean {
    this.setAutoRotate(!this.autoRotateWanted)
    return this.autoRotateWanted
  }

  get isAutoRotating(): boolean {
    return this.autoRotateWanted
  }

  /** 平滑回到默认视角 */
  reset(): void {
    this.rotateTo(this.home.azimuth, this.home.polar, this.home.radius, 0.9)
  }

  setEnabled(v: boolean): void {
    this.userEnabled = v
    if (v) {
      if (!this.tween) this.controls.enabled = true
      this.controls.autoRotate = this.autoRotateWanted && !this.tween
    } else {
      this.controls.enabled = false
      this.controls.autoRotate = false
    }
  }

  /** 当前方位角（弧度），供方向键按屏幕方向映射输入 */
  get azimuth(): number {
    return this.readSpherical().azimuth
  }

  /** 当前视角的球坐标，UI 用它反查处于哪个预设视角 */
  get view(): SphericalView {
    return this.readSpherical()
  }

  get isDefaultView(): boolean {
    const cur = this.readSpherical()
    return (
      Math.abs(cur.radius - this.home.radius * this.distanceScale) < 0.05 &&
      Math.abs(wrapAngle(cur.azimuth - this.home.azimuth)) < 0.03 &&
      Math.abs(cur.polar - this.home.polar) < 0.03
    )
  }

  // ------------------------------------------------------------------
  // 循环
  // ------------------------------------------------------------------

  update(dt: number): void {
    const tw = this.tween
    if (tw) {
      tw.elapsed = Math.min(tw.duration, tw.elapsed + dt)
      const k = easeInOutCubic(tw.duration > 0 ? tw.elapsed / tw.duration : 1)
      _sph.set(
        lerp(tw.fromRadius, tw.radius, k),
        lerp(tw.fromPolar, tw.polar, k),
        lerp(tw.fromAzimuth, tw.azimuth, k),
      )
      this.camera.position.copy(this.controls.target).add(_v.setFromSpherical(_sph))
      if (tw.elapsed >= tw.duration) this.stopTween()
    }
    // 传入 dt 让自动旋转按真实帧率推进
    this.controls.update(dt)
  }

  resize(width: number, height: number): void {
    if (height <= 0) return
    this.camera.aspect = width / height
    this.camera.updateProjectionMatrix()
    // 旋转手机 / 拖动窗口都会走到这里：机位跟着屏幕比例重新配平
    this.applyDistanceScale(distanceScaleForAspect(this.camera.aspect))
  }

  dispose(): void {
    this.domElement.removeEventListener('pointerdown', this.handlePointerDown)
    this.tween = null
    this.controls.dispose()
  }

  // ------------------------------------------------------------------
  // 内部
  // ------------------------------------------------------------------

  private applyDistanceLimits(): void {
    this.controls.minDistance = VIEW_LIMITS.minDistance * this.distanceScale
    this.controls.maxDistance = VIEW_LIMITS.maxDistance * this.distanceScale
  }

  /** 屏幕比例变化时同步缩放机位，画面不会突然贴脸或被拉飞 */
  private applyDistanceScale(next: number): void {
    if (Math.abs(next - this.distanceScale) < 0.005) return
    const ratio = next / this.distanceScale
    this.distanceScale = next
    this.applyDistanceLimits()

    if (this.tween) {
      // 转场途中旋转手机：起点与终点一起缩放，弧线不会断
      this.tween.fromRadius = clamp(
        this.tween.fromRadius * ratio,
        this.controls.minDistance,
        this.controls.maxDistance,
      )
      this.tween.radius = clamp(this.tween.radius * ratio, this.controls.minDistance, this.controls.maxDistance)
      return
    }

    const cur = this.readSpherical()
    const radius = clamp(cur.radius * ratio, this.controls.minDistance, this.controls.maxDistance)
    this.camera.position
      .copy(this.controls.target)
      .add(_v.setFromSpherical(_sph.set(radius, cur.polar, cur.azimuth)))
  }

  private startTween(t: ViewTween): void {
    this.tween = t
    this.controls.enabled = false
    this.controls.autoRotate = false
  }

  private stopTween(): void {
    if (!this.tween) return
    this.tween = null
    this.controls.enabled = this.userEnabled
    this.controls.autoRotate = this.userEnabled && this.autoRotateWanted
  }

  /** 相机相对观察点的球坐标（方位角 / 俯仰角 / 距离） */
  private readSpherical(): SphericalView {
    _v.copy(this.camera.position).sub(this.controls.target)
    if (_v.lengthSq() < 1e-8) _v.set(0, 0, 1)
    _sph.setFromVector3(_v)
    return { azimuth: _sph.theta, polar: _sph.phi, radius: _sph.radius }
  }
}
