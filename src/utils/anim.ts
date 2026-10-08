/**
 * 轻量缓动与属性补间工具。
 * 机械爪的所有位移/开合都走这里，避免坐标瞬变，同时不必引入 GSAP。
 */

export type EaseFn = (t: number) => number

export const easeLinear: EaseFn = (t) => t
export const easeInOutCubic: EaseFn = (t) =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
export const easeOutCubic: EaseFn = (t) => 1 - Math.pow(1 - t, 3)
export const easeInOutQuad: EaseFn = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2)
export const easeOutBack: EaseFn = (t) => {
  const c1 = 1.70158
  const c3 = c1 + 1
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2)
}

interface TweenState {
  from: number
  to: number
  elapsed: number
  duration: number
  ease: EaseFn
  resolve: () => void
}

/**
 * 属性补间集合：按 key 管理多条独立补间，
 * 每个 key 同时只允许一条补间，重复调用会平滑接管当前值。
 */
export class PropertyTweener {
  private map = new Map<string, TweenState>()
  private values = new Map<string, number>()

  constructor(
    private readonly apply: (key: string, value: number) => void,
    private readonly read: (key: string) => number,
  ) {}

  /** 立即设置某个 key 的值（不做动画） */
  set(key: string, value: number): void {
    this.cancel(key)
    this.values.set(key, value)
    this.apply(key, value)
  }

  /** 读取当前动画中的值 */
  get(key: string): number {
    return this.values.get(key) ?? this.read(key)
  }

  /** 是否处于补间中 */
  isActive(key?: string): boolean {
    if (key) return this.map.has(key)
    return this.map.size > 0
  }

  /** 取消补间（会 resolve，避免 await 永久挂起） */
  cancel(key?: string): void {
    if (key) {
      const t = this.map.get(key)
      if (t) {
        this.map.delete(key)
        this.values.set(key, this.interpolate(t))
        this.apply(key, t.to === this.interpolate(t) ? t.to : this.interpolate(t))
        t.resolve()
      }
      return
    }
    for (const k of [...this.map.keys()]) this.cancel(k)
  }

  /**
   * 补间到目标值。
   * @returns 补间结束（或被新补间接管）后 resolve 的 Promise
   */
  to(key: string, target: number, duration: number, ease: EaseFn = easeInOutCubic): Promise<void> {
    const current = this.values.has(key) ? this.values.get(key)! : this.read(key)

    // 接管同 key 的旧补间
    const prev = this.map.get(key)
    if (prev) prev.resolve()

    if (duration <= 0 || Math.abs(target - current) < 1e-6) {
      this.values.set(key, target)
      this.apply(key, target)
      return Promise.resolve()
    }

    return new Promise<void>((resolve) => {
      this.map.set(key, {
        from: current,
        to: target,
        elapsed: 0,
        duration,
        ease,
        resolve,
      })
    })
  }

  /** 每帧推进，dt 单位为秒 */
  update(dt: number): void {
    if (this.map.size === 0) return
    for (const [key, t] of [...this.map.entries()]) {
      t.elapsed += dt
      const v = this.interpolate(t)
      this.values.set(key, v)
      this.apply(key, v)
      if (t.elapsed >= t.duration) {
        this.values.set(key, t.to)
        this.apply(key, t.to)
        this.map.delete(key)
        t.resolve()
      }
    }
  }

  private interpolate(t: TweenState): number {
    const p = Math.min(1, t.elapsed / t.duration)
    return t.from + (t.to - t.from) * t.ease(p)
  }

  /** 一次性释放所有挂起 Promise */
  dispose(): void {
    for (const t of this.map.values()) t.resolve()
    this.map.clear()
    this.values.clear()
  }
}

/** 指数平滑（帧率无关），用于摇杆跟随等不需要精确时长的场景 */
export function damp(current: number, target: number, lambda: number, dt: number): number {
  return current + (target - current) * (1 - Math.exp(-lambda * dt))
}

export const clamp = (v: number, min: number, max: number): number => Math.min(max, Math.max(min, v))

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t

/** 简易延时，可被 signal 打断 */
export function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)))
}
