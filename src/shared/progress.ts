import type { Book, BookRecord } from './types'

/**
 * 阅读进度（0–100）。
 *
 * 主进程算统计、渲染层画进度条都用这一个函数，免得两处对不上。
 *
 * 为什么不能只看 `progress.page`：
 *   - PDF / Word 的页数来自文档本身，页码可靠；
 *   - Markdown / 纯文本的"页数"是按字数估的，页码会随字号估算漂，
 *     用滚动比例更实在；
 *   - EPUB 存的是整本的 fraction（章节位置换算成全书比例），只有它准。
 */
export function readingPercent(book: Book, record: BookRecord | null | undefined): number {
  if (!record) return 0
  const { page, scrollRatio } = record.progress
  const ratio = Number.isFinite(scrollRatio) ? Math.max(0, Math.min(1, scrollRatio)) : 0
  const total = book.pageCount > 0 ? book.pageCount : 0

  if (book.pageCountExact && total > 1) {
    const at = Math.max(1, Math.min(total, page || 1)) - 1
    // 页码是主依据，滚动比例只是页内的零头
    return clampPercent(((at + ratio) / total) * 100)
  }
  if (ratio > 0) return clampPercent(ratio * 100)
  if (total > 1) return clampPercent((Math.max(1, page || 1) - 1) / (total - 1) * 100)
  return 0
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(100, Math.round(value)))
}

/** 读完的判定阈值：留 2% 的余量，免得最后一页差一点永远不算读完 */
export const FINISHED_PERCENT = 98

/** 本地日期键 YYYY-MM-DD（热力图按本地日历分格，不用 UTC） */
export function dayKey(at: number = Date.now()): string {
  const d = new Date(at)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** 往前推 n 天的日期键 */
export function dayKeyBefore(days: number, from: number = Date.now()): string {
  const d = new Date(from)
  d.setDate(d.getDate() - days)
  return dayKey(d.getTime())
}
