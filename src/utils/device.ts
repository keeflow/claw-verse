import { onBeforeUnmount, ref, type Ref } from 'vue'

/**
 * 设备能力探测。
 *
 * 只做「能力判断」不做「UA 猜测」：媒体查询能同时覆盖触屏笔记本、平板、
 * 折叠屏展开后的窄屏分屏等情况，比 navigator.userAgent 可靠得多。
 */

/** 媒体查询的响应式封装；构造时同步取一次初值，避免首帧按桌面布局闪一下 */
export function useMediaQuery(query: string): Ref<boolean> {
  const supported = typeof window !== 'undefined' && typeof window.matchMedia === 'function'
  if (!supported) return ref(false)

  const mql = window.matchMedia(query)
  const matches = ref(mql.matches)
  const update = (e: MediaQueryListEvent) => {
    matches.value = e.matches
  }

  // Safari 13 及以下只有已废弃的 addListener
  if (typeof mql.addEventListener === 'function') {
    mql.addEventListener('change', update)
    onBeforeUnmount(() => mql.removeEventListener('change', update))
  } else {
    mql.addListener(update)
    onBeforeUnmount(() => mql.removeListener(update))
  }

  return matches
}

/** 触屏设备（粗指针）：按钮要更大、文案换成「轻触」、并给出震动反馈 */
export function useIsTouch(): Ref<boolean> {
  return useMediaQuery('(pointer: coarse)')
}

/** 手机级窄屏：控制面板切换为「单摇杆 + 大抓取键」布局 */
export function useIsNarrow(): Ref<boolean> {
  return useMediaQuery('(max-width: 639px)')
}

/** 矮视口（手机横屏）：需要压缩控制面板高度，给 3D 画面留空间 */
export function useIsShortViewport(): Ref<boolean> {
  return useMediaQuery('(max-height: 560px)')
}

/**
 * 轻量震动反馈（Android Chrome / 部分国产浏览器支持）。
 * iOS Safari 不支持 navigator.vibrate，静默忽略即可，不影响任何流程。
 */
export function vibrate(pattern: number | number[] = 12): void {
  try {
    navigator.vibrate?.(pattern)
  } catch {
    // 忽略：部分浏览器在无用户手势时调用会抛错
  }
}
