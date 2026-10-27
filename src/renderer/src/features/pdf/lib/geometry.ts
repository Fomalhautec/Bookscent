/**
 * 页面几何计算 —— 纯函数，不碰 DOM，便于推理与复用。
 *
 * 坐标体系说明：
 *  - baseWidth / baseHeight：PDF 原始页面尺寸（PDF 单位，1/72 英寸）。
 *  - zoom：显示缩放倍率，1 = 原始尺寸的 1 倍（相当于 CSS 像素）。
 *  - rotation：用户额外旋转角度（0 / 90 / 180 / 270），实际渲染角度 = pageRotate + rotation。
 *  - boxWidth / boxHeight：页面盒子在屏幕上的 CSS 像素尺寸（已含旋转与缩放）。
 */

import type { AnnotationStroke, Point } from '@shared/types'

export const ZOOM_MIN = 0.1
export const ZOOM_MAX = 6

export interface PageBox {
  page: number
  /** 未旋转、未缩放时的 PDF 尺寸 */
  baseWidth: number
  baseHeight: number
  /** 该页自带旋转 + 用户旋转后的角度（0/90/180/270） */
  rotation: number
  /** 屏幕上的 CSS 像素尺寸（已含缩放与旋转） */
  width: number
  height: number
}

export function normalizeRotation(deg: number): number {
  const value = Math.round(deg / 90) * 90
  const mod = ((value % 360) + 360) % 360
  return mod
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/** 旋转 90/270 度时宽高互换 */
export function rotatedSize(
  baseWidth: number,
  baseHeight: number,
  rotation: number,
  scale: number
): { width: number; height: number } {
  const swapped = rotation % 180 !== 0
  const w = swapped ? baseHeight : baseWidth
  const h = swapped ? baseWidth : baseHeight
  return { width: w * scale, height: h * scale }
}

export function makePageBox(
  page: number,
  baseWidth: number,
  baseHeight: number,
  rotation: number,
  zoom: number
): PageBox {
  const { width, height } = rotatedSize(baseWidth, baseHeight, rotation, zoom)
  return { page, baseWidth, baseHeight, rotation, width, height }
}

export interface FitInput {
  /** 滚动容器可视区域 */
  viewportWidth: number
  viewportHeight: number
  baseWidth: number
  baseHeight: number
  rotation: number
  /** 页面周围留白（连续滚动里是左侧留白之和） */
  paddingX?: number
  paddingY?: number
  /**
   * 并排页之间的固定空隙（左右翻页双页的书缝）：它不参与缩放 ——
   * 只是从可用宽度里扣掉，缩放到多大书缝都是屏幕上的同一个宽度。
   */
  gap?: number
  /**
   * baseWidth / baseHeight 已经是「屏幕方向」的尺寸（双页跨页把两页合成一个大页面后），
   * 不要再按 rotation 交换宽高。
   */
  preRotated?: boolean
}

/** 适应宽度：让页面（或整个跨页）在横向刚好铺满可视区 */
export function fitWidthZoom(input: FitInput): number {
  const padX = input.paddingX ?? 48
  const avail = Math.max(60, input.viewportWidth - padX - (input.gap ?? 0))
  const swapped = !input.preRotated && input.rotation % 180 !== 0
  const base = swapped ? input.baseHeight : input.baseWidth
  if (base <= 0) return 1
  return clamp(avail / base, ZOOM_MIN, ZOOM_MAX)
}

/** 适应页面：整页（或整个跨页，含纵向）落在可视区内 */
export function fitPageZoom(input: FitInput): number {
  const padX = input.paddingX ?? 48
  const padY = input.paddingY ?? 36
  const availW = Math.max(60, input.viewportWidth - padX - (input.gap ?? 0))
  const availH = Math.max(60, input.viewportHeight - padY)
  const swapped = !input.preRotated && input.rotation % 180 !== 0
  const baseW = swapped ? input.baseHeight : input.baseWidth
  const baseH = swapped ? input.baseWidth : input.baseHeight
  if (baseW <= 0 || baseH <= 0) return 1
  return clamp(Math.min(availW / baseW, availH / baseH), ZOOM_MIN, ZOOM_MAX)
}

/* --------------------------------------------------------------- 归一化坐标 */

/** 屏幕坐标 → 归一化 0..1（相对页面盒子左上角） */
export function toNormalized(x: number, y: number, width: number, height: number): Point {
  return {
    x: width > 0 ? clamp(x / width, 0, 1) : 0,
    y: height > 0 ? clamp(y / height, 0, 1) : 0
  }
}

/** 归一化 0..1 → 屏幕坐标 */
export function fromNormalized(point: Point, width: number, height: number): Point {
  return { x: point.x * width, y: point.y * height }
}

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/** 一组归一化点的包围盒 */
export function pointsBounds(points: Point[]): Rect | null {
  if (points.length === 0) return null
  let minX = 1
  let minY = 1
  let maxX = 0
  let maxY = 0
  for (const p of points) {
    minX = Math.min(minX, p.x)
    minY = Math.min(minY, p.y)
    maxX = Math.max(maxX, p.x)
    maxY = Math.max(maxY, p.y)
  }
  return { x: minX, y: minY, width: Math.max(maxX - minX, 0), height: Math.max(maxY - minY, 0) }
}

/* ------------------------------------------------------------------- 命中 */

/** 点到线段距离的平方，避免开方 */
function distanceToSegmentSq(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax
  const dy = by - ay
  const lenSq = dx * dx + dy * dy
  let t = 0
  if (lenSq > 0) t = clamp(((px - ax) * dx + (py - ay) * dy) / lenSq, 0, 1)
  const cx = ax + t * dx
  const cy = ay + t * dy
  const ex = px - cx
  const ey = py - cy
  return ex * ex + ey * ey
}

/**
 * 橡皮擦命中判定：点在任意一段折线的容差范围内即算命中。
 * 坐标一律用屏幕 CSS 像素，容差取「线宽 / 2 + 手感常量」。
 */
export function strokeHitByPoint(stroke: AnnotationStroke, x: number, y: number, boxW: number, boxH: number): boolean {
  const tolerance = Math.max(9, (stroke.width * boxW) / 2 + 6)
  const tolSq = tolerance * tolerance

  if (stroke.tool === 'text') {
    const box = textNoteRect(stroke)
    return (
      x >= box.x * boxW - 4 &&
      x <= (box.x + box.width) * boxW + 4 &&
      y >= box.y * boxH - 4 &&
      y <= (box.y + box.height) * boxH + 4
    )
  }

  const pts = stroke.points
  if (pts.length === 0) return false
  if (pts.length === 1) {
    const dx = x - pts[0].x * boxW
    const dy = y - pts[0].y * boxH
    return dx * dx + dy * dy <= tolSq
  }
  for (let i = 1; i < pts.length; i += 1) {
    const a = pts[i - 1]
    const b = pts[i]
    const d = distanceToSegmentSq(x, y, a.x * boxW, a.y * boxH, b.x * boxW, b.y * boxH)
    if (d <= tolSq) return true
  }
  return false
}

/* -------------------------------------------------------------- 文字便签 */

/** 便签盒子的归一化尺寸（按页面宽度/高度比例） */
export const TEXT_NOTE_BOX = { width: 0.24, height: 0.052, fontSize: 0.0175 }

export function textNoteRect(stroke: AnnotationStroke): Rect {
  const first = stroke.points[0] ?? { x: 0, y: 0 }
  const width = stroke.fontSize ? clamp(stroke.fontSize * 10.5, 0.1, 0.6) : TEXT_NOTE_BOX.width
  const height = stroke.fontSize ? clamp(stroke.fontSize * 3.6, 0.03, 0.3) : TEXT_NOTE_BOX.height
  return { x: first.x, y: first.y, width, height }
}

/** 便签文字换行：中文按 1 字宽、西文按 0.55 字宽估算，够用且无需测量 DOM */
export function wrapText(text: string, maxCharsPerLine: number): string[] {
  const limit = Math.max(1, Math.floor(maxCharsPerLine))
  const lines: string[] = []
  let line = ''
  let used = 0
  for (const ch of text) {
    if (ch === '\n') {
      lines.push(line)
      line = ''
      used = 0
      continue
    }
    const w = ch.charCodeAt(0) > 0x2e80 ? 1 : 0.55
    if (used + w > limit && line.length > 0) {
      lines.push(line)
      line = ch
      used = w
    } else {
      line += ch
      used += w
    }
  }
  if (line.length > 0) lines.push(line)
  return lines.slice(0, 4)
}

/** 近似字符宽度数（用于换行估算） */
export function estimateTextWidth(text: string): number {
  let w = 0
  for (const ch of text) w += ch.charCodeAt(0) > 0x2e80 ? 1 : 0.55
  return w
}
