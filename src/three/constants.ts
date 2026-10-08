/**
 * 娃娃机的尺寸常量（单位：米）。
 * MachineBuilder / ClawController / ItemManager 共用同一套尺寸，
 * 避免各处硬编码导致爪子范围与柜体对不上。
 */

// ---------------------------------------------------------------------------
// 机械爪手指几何
//
// 整根手指是一段「弯钩」：从指根（爪心下方 pivotOffset）出发，先向外张开
// upperAngle，再沿手指平滑转 lowerAngle（负值向内勾），最后由指尖钩回内侧。
//
// 两套算法共用同一份参数，保证外形与手感永远不会打架：
//   · clawTipRadius / clawTipDrop 用两段折线模型（upperLen + 指尖段）
//     精确描述「指尖」的位置 → 夹持半径、下潜深度、地板安全高度都由它推导
//   · clawFingerCurve 用一条三次贝塞尔把指根连到同一个指尖点，
//     让手指视觉上是弯曲的钩子，而指尖落点分毫不动
// ---------------------------------------------------------------------------
export const CLAW_FINGER = {
  /** 指根到肘部的弧长（决定指尖落点的两段长度之一） */
  upperLen: 0.2,
  /** 指尖（含锥形头）相对肘部的伸出量（两段长度之二） */
  tipExt: 0.21,
  /** 指根相对爪心的垂直偏移 */
  pivotOffset: 0.062,
  /** 指尖锥体半高 */
  tipHalf: 0.03,
  /** 指根外张角：闭合 → 张开（弧度） */
  upperAngle: [0.2, 0.78] as const,
  /** 沿手指转过的角度：闭合 → 张开（负值向内勾） */
  lowerAngle: [-0.34, 0.1] as const,
  /** 手指（杆身）半径 */
  rodR: 0.021,
}

/** 指根到锥尖的等效长度（锥尖顶点半径/高度都按它算） */
const TIP_REACH = CLAW_FINGER.tipExt + CLAW_FINGER.tipHalf

function mix(from: number, to: number, t: number): number {
  return from + (to - from) * t
}

/** 数值裁剪到 0~1 */
function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v
}

/** 三次平滑过渡，用于弯折/收尖，避免出现硬折角 */
function smoothstep01(v: number): number {
  const t = clamp01(v)
  return t * t * (3 - 2 * t)
}

/** 开合度（0 收拢 / 1 撑开）→ 两段手指的绝对转角 */
export function clawFingerAngles(open: number): { upper: number; lower: number } {
  const o = Math.min(1, Math.max(0, open))
  return {
    upper: mix(CLAW_FINGER.upperAngle[0], CLAW_FINGER.upperAngle[1], o),
    lower: mix(CLAW_FINGER.lowerAngle[0], CLAW_FINGER.lowerAngle[1], o),
  }
}

/** 开合度 → 三指锥尖所在的水平半径，也就是爪子“抱得住”的物品半径 */
export function clawTipRadius(open: number): number {
  const { upper, lower } = clawFingerAngles(open)
  return CLAW_FINGER.upperLen * Math.sin(upper) + TIP_REACH * Math.sin(upper + lower)
}

/** 开合度 → 指尖最低点相对爪心的高度差 */
export function clawTipDrop(open: number): number {
  const { upper, lower } = clawFingerAngles(open)
  return (
    CLAW_FINGER.pivotOffset +
    CLAW_FINGER.upperLen * Math.cos(upper) +
    TIP_REACH * Math.cos(upper + lower)
  )
}

/** 开合度的反解：希望指尖正好停在半径 r 上时需要多大开合度 */
export function clawOpenForTipRadius(r: number): number {
  if (r <= clawTipRadius(0)) return 0
  if (r >= clawTipRadius(1)) return 1
  let lo = 0
  let hi = 1
  for (let i = 0; i < 18; i++) {
    const mid = (lo + hi) / 2
    if (clawTipRadius(mid) < r) lo = mid
    else hi = mid
  }
  return (lo + hi) / 2
}

/** 完全闭合时指尖相对爪心的下沉量 —— 爪心最低安全高度由它决定 */
export const CLAW_TIP_DROP_CLOSED = clawTipDrop(0)
/** 完全张开时指尖相对爪心的下沉量（下降途中用它算余量） */
export const CLAW_TIP_DROP_OPEN = clawTipDrop(1)
/** 夹持中心相对爪心的垂直距离：手指包裹区间的中点略偏上 */
export const CLAW_GRIP_OFFSET = 0.35
/** 待机时的开合度：微微收拢的爪形，抓取时才会完全张开 */
export const CLAW_REST_OPEN = 0.55

// ---------------------------------------------------------------------------
// 弯曲手指的中心线
//
// 指尖落点由上方的两段折线模型给定（physics 用它），
// 视觉上的手指则是一条经过指根与指尖的三次贝塞尔曲线：
//   · 起始切线沿指根外张方向 → 手指从爪心自然向外生长
//   · 末端切线额外向内多转 hook 角 → 指尖变成钩子（开爪时几乎伸直）
// 曲线两端与折线模型完全重合，所以换成弯钩造型后，
// 夹持半径 / 下潜深度 / 地板安全高度全部保持不变。
// ---------------------------------------------------------------------------

/**
 * 指尖额外的内勾角（常量）：手指的弧度来自金属本身的形状，
 * 张开时只是整体向外转，钩形基本保持，不会变成一根直杆。
 */
const CLAW_HOOK = 0.65
/** 贝塞尔控制柄长度比例（相对指根—指尖弦长），决定弯得有多"鼓" */
const CLAW_HANDLE = { root: 0.42, tip: 0.3 } as const

/** 手指网格的纵向 / 环向细分（几何逐帧重建，数值不宜过大） */
export const CLAW_FINGER_SEGMENTS = 28
export const CLAW_FINGER_RADIAL = 12

export interface ClawFingerCurve {
  /** 指根（手指局部坐标原点） */
  p0: { x: number; y: number }
  /** 控制点 1（靠近指根） */
  c1: { x: number; y: number }
  /** 控制点 2（靠近指尖） */
  c2: { x: number; y: number }
  /** 指尖（与折线模型算出的落点严格一致） */
  p3: { x: number; y: number }
}

/** 生成某个开合度下手指中心线的三次贝塞尔控制点 */
export function clawFingerCurve(open: number): ClawFingerCurve {
  const o = Math.min(1, Math.max(0, open))
  const { upper, lower } = clawFingerAngles(o)
  // 指尖落点 —— 与 clawTipRadius / clawTipDrop 同源
  const tipX = clawTipRadius(o)
  const tipY = -(
    CLAW_FINGER.upperLen * Math.cos(upper) +
    TIP_REACH * Math.cos(upper + lower)
  )
  const chord = Math.hypot(tipX, tipY)
  const rootAngle = upper
  const tipAngle = upper + lower - CLAW_HOOK
  return {
    p0: { x: 0, y: 0 },
    c1: {
      x: Math.sin(rootAngle) * CLAW_HANDLE.root * chord,
      y: -Math.cos(rootAngle) * CLAW_HANDLE.root * chord,
    },
    c2: {
      x: tipX - Math.sin(tipAngle) * CLAW_HANDLE.tip * chord,
      y: tipY + Math.cos(tipAngle) * CLAW_HANDLE.tip * chord,
    },
    p3: { x: tipX, y: tipY },
  }
}

/** 在中心线上取 t（0 指根 → 1 指尖）处的点与切线角 */
export function clawFingerEval(
  curve: ClawFingerCurve,
  t: number,
  out: { x: number; y: number; angle: number },
): { x: number; y: number; angle: number } {
  const u = 1 - t
  const a = u * u * u
  const b = 3 * u * u * t
  const c = 3 * u * t * t
  const d = t * t * t
  out.x = a * curve.p0.x + b * curve.c1.x + c * curve.c2.x + d * curve.p3.x
  out.y = a * curve.p0.y + b * curve.c1.y + c * curve.c2.y + d * curve.p3.y
  // 导数 → 切线方向 (sin angle, -cos angle)
  const dx =
    3 * u * u * (curve.c1.x - curve.p0.x) +
    6 * u * t * (curve.c2.x - curve.c1.x) +
    3 * t * t * (curve.p3.x - curve.c2.x)
  const dy =
    3 * u * u * (curve.c1.y - curve.p0.y) +
    6 * u * t * (curve.c2.y - curve.c1.y) +
    3 * t * t * (curve.p3.y - curve.c2.y)
  out.angle = Math.atan2(dx, -dy)
  return out
}

/**
 * 手指在 t 处的截面半径。
 * 杆身从前到后轻微收细，最后一段收成尖，形成钩尖。
 */
export function clawFingerRadiusAt(t: number): number {
  const rod = CLAW_FINGER.rodR * (1 - 0.16 * clamp01(t))
  const taper = smoothstep01((t - 0.68) / 0.32)
  return Math.max(0.0016, rod * (1 - taper * 0.97))
}

/** 柜内地面高度（物品落地的水平面） */
const FLOOR_Y = 0.78
/** 玻璃柜顶面高度 */
const GLASS_TOP = 2.24
/** X/Z 导轨高度（机械爪悬挂的最高点） */
const RAIL_Y = 2.16

export const M = {
  /** 玻璃柜内部半宽（X 方向） */
  halfW: 0.72,
  /** 玻璃柜内部半深（Z 方向） */
  halfD: 0.55,

  /** 柜体底部（地面） */
  groundY: 0,
  /** 玻璃柜内部地面高度，也是物品落地高度 */
  floorY: FLOOR_Y,
  /** 玻璃柜顶面（橱窗高度 = glassTop - floorY，物品堆放空间） */
  glassTop: GLASS_TOP,
  /** X/Z 导轨高度 */
  railY: RAIL_Y,

  /** 玻璃柜外框宽 / 深 */
  cabinetW: 1.62,
  cabinetD: 1.28,
  /** 顶部灯箱高度 */
  topperH: 0.42,

  /**
   * 爪子可下降的最低高度。
   * 指尖闭合时会伸到爪心下方 CLAW_TIP_DROP_CLOSED 处，
   * 因此爪心至少要比地板高出这么多，否则手指会插穿柜内地板。
   */
  clawMinY: FLOOR_Y + CLAW_TIP_DROP_CLOSED + 0.012,
  /**
   * 爪子待机高度：默认吊在导轨正下方（最高处）。
   * 玩家先在地面上方平移选位，按下抓取后爪子才下潜到物品处。
   */
  clawRestY: RAIL_Y - 0.26,
  /**
   * 投放到出货口时爪子的下探高度。
   * 要保证完全张开的指尖（爪心下方 CLAW_TIP_DROP_OPEN 处）
   * 仍高出货口挡边，同时物品落差又足够小、不会弹出。
   */
  releaseY: FLOOR_Y + 0.5,
  /** 爪子水平可移动范围（比内胆略小，避免贴玻璃） */
  clawLimitX: 0.6,
  clawLimitZ: 0.44,

/**
 * 出货口（地板缺口）中心与边长。
 * 边长取 0.5：比最大的默认物品（约 0.34 宽）的对角线还宽，
 * 物品带着任意旋转掉下去都不会卡在洞口。
 */
chute: {
  x: 0.48,
  z: 0.28,
  size: 0.5,
},
/** 出货口滑道底部 / 取物槽地板高度 */
chuteFloorY: 0.16,
} as const

/**
 * 出货口在楼层上的开口矩形（机器局部坐标，x/z 各自的 min/max）。
 * 楼层以上的所有封板（柜顶压边、玻璃柜下框、腔体上方的实体块）
 * 都必须给这块区域让路，洞口才是真正「打通」的。
 */
export const CHUTE_OPENING = {
  x0: M.chute.x - M.chute.size / 2,
  x1: M.chute.x + M.chute.size / 2,
  z0: M.chute.z - M.chute.size / 2,
  z1: M.chute.z + M.chute.size / 2,
} as const

/** 机器局部坐标 → 爪子在水平面上的可动范围 */
export const CLAW_BOUNDS = {
  minX: -M.clawLimitX,
  maxX: M.clawLimitX,
  minZ: -M.clawLimitZ,
  maxZ: M.clawLimitZ,
} as const

/** 物品生成区域（留出贴边余量，避免物品生成在玻璃外） */
export const SPAWN_AREA = {
  minX: -M.halfW + 0.12,
  maxX: M.halfW - 0.12,
  minZ: -M.halfD + 0.12,
  maxZ: M.halfD - 0.12,
} as const

/** 主题色板，UI 与 3D 场景共用 */
export const THEME = {
  machineBody: '#1b2030',
  machineBodyDark: '#111524',
  accent: '#38e1ff',
  accent2: '#ff4d8d',
  neon: '#5ef0ff',
  gold: '#ffcb47',
  glassTint: '#bfeaff',
  carpet: '#0e1320',
} as const
