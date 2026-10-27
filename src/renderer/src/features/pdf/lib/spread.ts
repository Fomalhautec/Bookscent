/**
 * 左右翻页的「跨页（facing pages）」配对规则。
 *
 * 配对约定 —— 与真实装订成册的书完全一致：
 *   - 第 1 页单独占右半边（recto：书的首页永远是右手页，左边是封面内侧）；
 *   - 之后每两页组成一个跨页：(2,3)、(4,5)、(6,7)…
 *   - 于是每个跨页永远是「左页 → 右页」的阅读顺序，翻一次就是翻一个跨页。
 *
 * 由此可以推出全部公式（pageCount = 总页数 N）：
 *   - 跨页数量          = floor(N / 2) + 1
 *   - 第 p 页所在跨页    = floor(p / 2)（第 1 页与第 2 页之外的奇数页共享同一个跨页）
 *   - 第 i 个跨页的左页  = i === 0 ? 无 : 2i；右页 = 2i + 1（超出 N 就是没有）
 *   - 因此 N 为奇数时最后一个跨页是完整的一对；N 为偶数时最后一个跨页只有左页。
 *
 * 只有一侧有页的跨页（第 1 页、以及 N 为偶数时的最后半页）不会被居中，
 * 而是留在它「天然」的那一半，另一半留白 —— 这正是摊开的书的样子，
 * 也让舞台尺寸在前后翻页之间保持稳定，动画不会因为页面忽宽忽窄而抖动。
 *
 * 另一个约定：导航（← / → / PageUp / PageDown / 点击热区 / 工具栏按钮）
 * 一次移动一个跨页，落点用 spreadAnchorPage 计算 ——
 * 中间跨页落在左页，最后一个跨页落在末页，这样读到最后一跨页就等于读完整本。
 */

import type { PageBox } from './geometry'

/** 并排两页之间的书缝宽度（CSS 像素，不随缩放变化） */
export const FLIP_GUTTER = 18

export interface SpreadSlice {
  /** 跨页序号，从 0 开始 */
  index: number
  /** 左半边的页码；null 表示这一侧没有页 */
  left: number | null
  /** 右半边的页码；null 表示这一侧没有页 */
  right: number | null
}

export interface SpreadCells {
  left: PageBox | null
  right: PageBox | null
}

export interface SpreadFootprint {
  width: number
  height: number
}

function clampInt(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value)))
}

/** 一共几个跨页：N 页 → floor(N / 2) + 1 */
export function spreadCount(pageCount: number): number {
  return Math.floor(Math.max(0, pageCount) / 2) + 1
}

/** 第 page 页落在第几个跨页（第 1 页独占跨页 0） */
export function spreadIndexForPage(page: number): number {
  return Math.floor(Math.max(1, Math.round(page)) / 2)
}

/** 第 index 个跨页左右两侧分别是第几页 */
export function spreadSliceAt(index: number, pageCount: number): SpreadSlice {
  const total = Math.max(0, pageCount)
  const i = clampInt(index, 0, spreadCount(total) - 1)
  if (total <= 0) return { index: 0, left: null, right: null }
  const left = i === 0 ? null : i * 2
  const right = i * 2 + 1
  return {
    index: i,
    left: left !== null && left <= total ? left : null,
    right: right <= total ? right : null
  }
}

export function spreadSliceForPage(page: number, pageCount: number): SpreadSlice {
  return spreadSliceAt(spreadIndexForPage(page), pageCount)
}

/**
 * 跳到一个跨页时「当前页」记在哪一页上：
 *   - 中间跨页记左页（顺着阅读方向前进，下一步自然落在下一页的跨页）；
 *   - 最后一个跨页记末页，这样读到最后一跨页就等于读完整本（进度与「已读完」都对得上）。
 */
export function spreadAnchorPage(index: number, pageCount: number): number {
  const slice = spreadSliceAt(index, pageCount)
  if (slice.left === null) return slice.right ?? 1
  if (slice.right === null) return slice.left
  return slice.index === spreadCount(pageCount) - 1 ? slice.right : slice.left
}

/**
 * 双页模式下往前 / 往后翻一个跨页后的落点页。
 * 已经到头就原样返回当前页，调用方据此判断「这是空操作」。
 */
export function resolveSpreadStep(page: number, delta: 1 | -1, pageCount: number): number {
  const total = Math.max(1, pageCount)
  const current = clampInt(page, 1, total)
  const index = spreadIndexForPage(current)
  const next = clampInt(index + delta, 0, spreadCount(total) - 1)
  if (next === index) return current
  return spreadAnchorPage(next, total)
}

/** 把跨页的两侧映射成页面盒子（盒子还没算出来时给 null） */
export function spreadCellsOf(slice: SpreadSlice, boxes: PageBox[]): SpreadCells {
  return {
    left: slice.left === null ? null : boxes[slice.left - 1] ?? null,
    right: slice.right === null ? null : boxes[slice.right - 1] ?? null
  }
}

/** 按页号直接取跨页两侧的盒子 */
export function spreadCellsForPage(page: number, pageCount: number, boxes: PageBox[]): SpreadCells {
  return spreadCellsOf(spreadSliceForPage(page, pageCount), boxes)
}

/**
 * 跨页在舞台上的占位尺寸。
 *
 * facing = true（双页）：缺的那半边按另一半的宽度补白，并留出书缝 ——
 *   于是所有跨页的宽度都是「两页 + 书缝」，翻页时舞台尺寸恒定。
 * facing = false（单页）：舞台就是这一页，不补白也不留书缝。
 */
export function spreadFootprint(
  cells: SpreadCells,
  options: { gutter: number; facing: boolean }
): SpreadFootprint {
  const pageWidth = cells.left?.width ?? cells.right?.width ?? 0
  const height = Math.max(cells.left?.height ?? 0, cells.right?.height ?? 0)
  if (!options.facing) return { width: pageWidth, height }
  const leftWidth = cells.left?.width ?? pageWidth
  const rightWidth = cells.right?.width ?? pageWidth
  return {
    width: leftWidth + (leftWidth > 0 && rightWidth > 0 ? options.gutter : 0) + rightWidth,
    height
  }
}

/** 一叠纸的身份：左页-右页；换跨页时 key 变化，React 据此决定是否复用画布 */
export function spreadKey(cells: SpreadCells): string {
  return `${cells.left?.page ?? 0}-${cells.right?.page ?? 0}`
}
