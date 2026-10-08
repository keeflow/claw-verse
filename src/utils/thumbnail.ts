import type { ClawMachineItem } from '@/types/claw-machine'
import { ITEM_PALETTE } from '@/models/defaultItems'
import { guessShape } from '@/three/AssetLoader'

const cache = new Map<string, string>()

const SHADOW = 'rgba(8,12,22,0.28)'
const INK = '#2a2233'

/** 按内置形状画出矢量缩略图，供设置页卡片与编辑器预览使用 */
function shapeSvg(shape: string, fill: string, base: string): string {
  const color = fill
  const dark = shade(base, -0.22)
  const light = shade(base, 0.3)

  switch (shape) {
    case 'bear':
      return `
        <ellipse cx="32" cy="55" rx="19" ry="17" fill="${color}"/>
        <circle cx="15" cy="24" r="7" fill="${dark}"/><circle cx="49" cy="24" r="7" fill="${dark}"/>
        <circle cx="15" cy="24" r="3.4" fill="${light}"/><circle cx="49" cy="24" r="3.4" fill="${light}"/>
        <circle cx="32" cy="33" r="15" fill="${color}"/>
        <ellipse cx="32" cy="38" rx="7.4" ry="5.6" fill="${light}"/>
        <circle cx="32" cy="36.5" r="2.4" fill="${INK}"/>
        <circle cx="26" cy="30" r="1.9" fill="${INK}"/><circle cx="38" cy="30" r="1.9" fill="${INK}"/>
        <ellipse cx="13" cy="52" rx="6" ry="7" fill="${color}"/>
        <ellipse cx="51" cy="52" rx="6" ry="7" fill="${color}"/>`
    case 'rabbit':
      return `
        <ellipse cx="24" cy="20" rx="5" ry="13" fill="${color}" transform="rotate(-12 24 20)"/>
        <ellipse cx="40" cy="20" rx="5" ry="13" fill="${color}" transform="rotate(12 40 20)"/>
        <ellipse cx="24" cy="20" rx="2.2" ry="9" fill="${light}" transform="rotate(-12 24 20)"/>
        <ellipse cx="40" cy="20" rx="2.2" ry="9" fill="${light}" transform="rotate(12 40 20)"/>
        <ellipse cx="32" cy="54" rx="18" ry="16" fill="${color}"/>
        <circle cx="32" cy="34" r="13" fill="${color}"/>
        <circle cx="27" cy="33" r="1.9" fill="${INK}"/><circle cx="37" cy="33" r="1.9" fill="${INK}"/>
        <circle cx="32" cy="39" r="2.2" fill="#f0839f"/>
        <ellipse cx="16" cy="62" rx="7" ry="4" fill="${light}"/>
        <ellipse cx="48" cy="62" rx="7" ry="4" fill="${light}"/>`
    case 'cat':
      return `
        <ellipse cx="32" cy="56" rx="18" ry="15" fill="${color}"/>
        <path d="M16 26 L20 8 L33 20 Z" fill="${color}"/>
        <path d="M48 26 L44 8 L31 20 Z" fill="${color}"/>
        <path d="M19 24 L21.5 13 L29 20.5 Z" fill="${light}"/>
        <path d="M45 24 L42.5 13 L35 20.5 Z" fill="${light}"/>
        <circle cx="32" cy="35" r="14" fill="${color}"/>
        <ellipse cx="32" cy="40" rx="7" ry="5" fill="${light}"/>
        <circle cx="32" cy="38.4" r="2.1" fill="#ef7fa0"/>
        <path d="M26 31.5 q2.2 -2 4.4 0" stroke="${INK}" stroke-width="1.9" fill="none" stroke-linecap="round"/>
        <path d="M33.6 31.5 q2.2 -2 4.4 0" stroke="${INK}" stroke-width="1.9" fill="none" stroke-linecap="round"/>
        <path d="M50 54 q12 -2 8 -14" stroke="${color}" stroke-width="5" fill="none" stroke-linecap="round"/>`
    case 'gift':
      return `
        <rect x="10" y="24" width="44" height="38" rx="4" fill="${color}"/>
        <rect x="7" y="16" width="50" height="11" rx="3" fill="${dark}"/>
        <rect x="28" y="16" width="8" height="46" fill="#ffd45e"/>
        <rect x="7" y="16" width="50" height="11" fill="#ffd45e" opacity="0.95" rx="3"/>
        <circle cx="24" cy="14" r="6" fill="none" stroke="#ffd45e" stroke-width="4"/>
        <circle cx="40" cy="14" r="6" fill="none" stroke="#ffd45e" stroke-width="4"/>`
    case 'football':
      return `
        <circle cx="32" cy="38" r="23" fill="${color}" stroke="${dark}" stroke-width="1.2"/>
        <path d="M32 24 L41 30 L37.5 40 L26.5 40 L23 30 Z" fill="${INK}"/>
        <path d="M32 15 L38 20 L32 24 L26 20 Z" fill="${INK}"/>
        <path d="M12 30 L20 28 L23 30 L18 38 L11 37 Z" fill="${INK}"/>
        <path d="M52 30 L44 28 L41 30 L46 38 L53 37 Z" fill="${INK}"/>
        <path d="M24 56 L32 52 L40 56 L37 63 L27 63 Z" fill="${INK}"/>`
    case 'star':
      return `
        <path d="M32 8 L39.8 25 L58 27.4 L44.5 40.2 L48.2 58 L32 49 L15.8 58 L19.5 40.2 L6 27.4 L24.2 25 Z"
              fill="${color}" stroke="${light}" stroke-width="1.4" stroke-linejoin="round"/>
        <circle cx="27" cy="30" r="1.8" fill="${INK}"/>
        <circle cx="37" cy="30" r="1.8" fill="${INK}"/>
        <path d="M28.5 35 q3.5 3 7 0" stroke="${INK}" stroke-width="1.6" fill="none" stroke-linecap="round"/>`
    default:
      return `
        <rect x="12" y="18" width="40" height="40" rx="8" fill="${color}"/>
        <rect x="12" y="18" width="40" height="40" rx="8" fill="none" stroke="${light}" stroke-width="2"/>
        <path d="M22 30 L32 48 L42 30" stroke="${light}" stroke-width="3.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M30 34 L32 48 L34 34" stroke="${light}" stroke-width="3.4" fill="none" stroke-linecap="round"/>`
  }
}

/** 颜色加深 / 提亮 */
function shade(hex: string, amount: number): string {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex.trim())
  if (!m) return hex
  const to = (c: string) => {
    const v = parseInt(c, 16)
    const out = amount >= 0 ? v + (255 - v) * amount : v * (1 + amount)
    return Math.max(0, Math.min(255, Math.round(out)))
      .toString(16)
      .padStart(2, '0')
  }
  return `#${to(m[1])}${to(m[2])}${to(m[3])}`
}

/**
 * 生成物品缩略图（SVG DataURL）。
 * 未配置 thumbnailUrl 时按内置形状绘制，避免设置页出现空白卡片。
 */
export function itemThumbnail(item: Pick<ClawMachineItem, 'id' | 'name' | 'thumbnailUrl'>): string {
  if (item.thumbnailUrl) return item.thumbnailUrl
  const shape = guessShape(item)
  const color = ITEM_PALETTE[item.id] ?? ITEM_PALETTE[shape] ?? '#7dd3fc'
  const key = `${shape}|${color}`
  const hit = cache.get(key)
  if (hit) return hit

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 76" width="64" height="76">
    <defs>
      <radialGradient id="g" cx="35%" cy="28%" r="78%">
        <stop offset="0%" stop-color="${shade(color, 0.42)}"/>
        <stop offset="100%" stop-color="${shade(color, -0.12)}"/>
      </radialGradient>
    </defs>
    <ellipse cx="32" cy="68" rx="21" ry="5" fill="${SHADOW}"/>
    <g>${shapeSvg(shape, 'url(#g)', color)}</g>
  </svg>`

  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
  cache.set(key, url)
  return url
}

/** 物品主题色（用于卡片描边与标签） */
export function itemColor(item: Pick<ClawMachineItem, 'id' | 'name'>): string {
  const shape = guessShape(item)
  return ITEM_PALETTE[item.id] ?? ITEM_PALETTE[shape] ?? '#7dd3fc'
}

export const DIFFICULTY_LABEL: Record<string, string> = {
  easy: '简单',
  normal: '普通',
  hard: '困难',
}

export const DIFFICULTY_STYLE: Record<string, string> = {
  easy: 'bg-emerald-500/15 text-emerald-300 border-emerald-400/30',
  normal: 'bg-sky-500/15 text-sky-300 border-sky-400/30',
  hard: 'bg-rose-500/15 text-rose-300 border-rose-400/30',
}
