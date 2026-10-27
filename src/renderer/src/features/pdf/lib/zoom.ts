/** 缩放相关的常量与格式化 */

import { ZOOM_MAX, ZOOM_MIN } from './geometry'

export const ZOOM_PRESETS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4] as const
export const ZOOM_STEP = 0.1

export { ZOOM_MAX, ZOOM_MIN }

/** 缩放倍率的显示文本：整数不带小数，其余保留一位 */
export function formatZoom(value: number): string {
  const pct = value * 100
  const rounded = Math.round(pct)
  return Math.abs(pct - rounded) < 0.05 ? `${rounded}%` : `${pct.toFixed(1)}%`
}

/** 滚轮 / 快捷键缩放取整，避免出现 137.0000001% 这种数字 */
export function roundZoom(value: number): number {
  return Math.round(value * 1000) / 1000
}
