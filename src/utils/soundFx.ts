/**
 * 极轻量的 WebAudio 音效：全部用振荡器实时合成，不需要任何音频素材。
 *
 *  · playSuccess() —— 抓到娃娃的上行琶音 + 结尾和弦，明亮欢快；
 *  · playFail()    —— 没抓到的柔和双音，短促不刺耳。
 *
 * 浏览器自动播放策略：AudioContext 必须在用户手势里创建/恢复，
 * 因此在玩家按下「抓取」时调用 unlock()，之后随时可以发声。
 */

const NOTE = {
  C5: 523.25,
  E5: 659.25,
  G5: 783.99,
  C6: 1046.5,
  E6: 1318.51,
  G6: 1567.98,
} as const

class SoundFx {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  /** 静音开关（预留：以后可接入设置页） */
  enabled = true

  /** 在用户手势中调用：创建并唤醒 AudioContext */
  unlock(): void {
    try {
      if (!this.ctx) {
        const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
        if (!Ctor) return
        this.ctx = new Ctor()
        this.master = this.ctx.createGain()
        this.master.gain.value = 0.5
        this.master.connect(this.ctx.destination)
      }
      if (this.ctx.state === 'suspended') void this.ctx.resume()
    } catch (err) {
      console.warn('[SoundFx] 音频初始化失败：', err)
    }
  }

  private get ready(): boolean {
    return this.enabled && !!this.ctx && !!this.master && this.ctx.state === 'running'
  }

  /** 单个音符：振荡器 + 包络 */
  private tone(
    freq: number,
    start: number,
    dur: number,
    opts: { type?: OscillatorType; gain?: number; slideTo?: number } = {},
  ): void {
    if (!this.ctx || !this.master) return
    const ctx = this.ctx
    const osc = ctx.createOscillator()
    const g = ctx.createGain()
    osc.type = opts.type ?? 'triangle'
    osc.frequency.setValueAtTime(freq, start)
    if (opts.slideTo) osc.frequency.exponentialRampToValueAtTime(opts.slideTo, start + dur)

    const peak = opts.gain ?? 0.2
    g.gain.setValueAtTime(0.0001, start)
    g.gain.exponentialRampToValueAtTime(peak, start + 0.018)
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur)

    osc.connect(g).connect(this.master)
    osc.start(start)
    osc.stop(start + dur + 0.05)
  }

  /** 抓到娃娃：上行琶音 + 明亮收尾和弦 */
  playSuccess(): void {
    if (!this.ready || !this.ctx) return
    const t0 = this.ctx.currentTime + 0.02
    const arp: [number, number][] = [
      [NOTE.C5, 0],
      [NOTE.E5, 0.09],
      [NOTE.G5, 0.18],
      [NOTE.C6, 0.27],
    ]
    for (const [f, dt] of arp) {
      this.tone(f, t0 + dt, 0.34, { type: 'triangle', gain: 0.22 })
      this.tone(f * 2, t0 + dt, 0.22, { type: 'sine', gain: 0.05 })
    }
    // 收尾和弦（带一点点延音），营造「撒花」的欢快感
    const chord: [number, number][] = [
      [NOTE.C5, 0.2],
      [NOTE.E5, 0.18],
      [NOTE.G5, 0.16],
      [NOTE.C6, 0.18],
      [NOTE.E6, 0.1],
      [NOTE.G6, 0.08],
    ]
    for (const [f, g0] of chord) {
      this.tone(f, t0 + 0.4, 0.85, { type: 'triangle', gain: g0 })
    }
    // 高音闪光
    this.tone(NOTE.E6 * 1.5, t0 + 0.55, 0.5, { type: 'sine', gain: 0.06 })
  }

  /** 没抓到：柔和下滑双音 */
  playFail(): void {
    if (!this.ready || !this.ctx) return
    const t0 = this.ctx.currentTime + 0.02
    this.tone(392, t0, 0.18, { type: 'sine', gain: 0.14 })
    this.tone(311.13, t0 + 0.16, 0.3, { type: 'sine', gain: 0.12, slideTo: 261.63 })
  }

  /**
   * 抓钩下落：绞盘 / 电机声。
   * 中频锯齿波缓慢下滑（电机加载）+ 低频摩擦底噪 + 轻微的滑轮颤动，
   * 时长与实际下落过程一致，让「按下抓取 → 爪子下沉」在听觉上也被感知到。
   */
  playDescend(durationSec = 0.9): void {
    this.winch(durationSec, { from: 300, to: 148, subFrom: 94, subTo: 56, tremolo: 11 })
  }

  /** 抓钩上升：音高缓慢上扬的绞盘声，收尾时自然停下 */
  playAscend(durationSec = 0.9): void {
    this.winch(durationSec, { from: 150, to: 305, subFrom: 56, subTo: 96, tremolo: 9 })
  }

  private winch(
    durationSec: number,
    opts: {
      from: number
      to: number
      subFrom: number
      subTo: number
      tremolo: number
    },
  ): void {
    if (!this.ready || !this.ctx || !this.master) return
    const ctx = this.ctx
    const d = Math.max(0.2, Math.min(2.5, durationSec))
    const t0 = ctx.currentTime + 0.01

    // 主增益：淡入 → 保持 → 快速淡出，避免咔哒声
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, t0)
    g.gain.exponentialRampToValueAtTime(0.13, t0 + 0.05)
    g.gain.setValueAtTime(0.13, t0 + Math.max(0.06, d - 0.07))
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + d)
    g.connect(this.master)

    // 电机主音：锯齿波 + 低通滤波，音高随行程滑动
    const osc = ctx.createOscillator()
    osc.type = 'sawtooth'
    osc.frequency.setValueAtTime(opts.from, t0)
    osc.frequency.exponentialRampToValueAtTime(opts.to, t0 + d)
    const lp = ctx.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.setValueAtTime(1150, t0)
    lp.frequency.linearRampToValueAtTime(560, t0 + d)
    lp.Q.value = 5
    osc.connect(lp)
    lp.connect(g)
    osc.start(t0)
    osc.stop(t0 + d + 0.05)

    // 底噪：低频三角波，模拟钢缆与滑轮的摩擦感
    const sub = ctx.createOscillator()
    sub.type = 'triangle'
    sub.frequency.setValueAtTime(opts.subFrom, t0)
    sub.frequency.exponentialRampToValueAtTime(opts.subTo, t0 + d)
    const sg = ctx.createGain()
    sg.gain.setValueAtTime(0.0001, t0)
    sg.gain.exponentialRampToValueAtTime(0.075, t0 + 0.06)
    sg.gain.exponentialRampToValueAtTime(0.0001, t0 + d)
    sub.connect(sg)
    sg.connect(this.master)
    sub.start(t0)
    sub.stop(t0 + d + 0.05)

    // 滑轮颤动：对主增益做轻微的方波调制，产生机械的「哒哒」质感
    const lfo = ctx.createOscillator()
    lfo.type = 'square'
    lfo.frequency.value = opts.tremolo
    const lfoGain = ctx.createGain()
    lfoGain.gain.value = 0.035
    lfo.connect(lfoGain)
    lfoGain.connect(g.gain)
    lfo.start(t0)
    lfo.stop(t0 + d + 0.05)
  }

  /** 清空取物口：轻快上滑的「取走」确认音 */
  playCollect(): void {
    if (!this.ready || !this.ctx) return
    const t0 = this.ctx.currentTime + 0.02
    this.tone(523.25, t0, 0.1, { type: 'sine', gain: 0.12 })
    this.tone(783.99, t0 + 0.08, 0.14, { type: 'sine', gain: 0.1 })
  }

  dispose(): void {
    void this.ctx?.close().catch(() => undefined)
    this.ctx = null
    this.master = null
  }
}

/** 全局单例 */
export const soundFx = new SoundFx()
