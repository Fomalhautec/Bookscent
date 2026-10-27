/**
 * 书签辅助：默认配色、自动命名、增删改。
 * 书签本身存在 BookRecord.bookmarks 里，这里只做纯逻辑。
 */

import type { Bookmark } from '@shared/types'
import { truncate } from '@/lib/format'

export const BOOKMARK_COLORS = [
  '#b5443a',
  '#c8873a',
  '#4a7f52',
  '#3f6f8f',
  '#7a5aa8',
  '#8a5c5c'
] as const

export function bookmarkColor(index: number): string {
  return BOOKMARK_COLORS[index % BOOKMARK_COLORS.length]
}

export function createBookmarkId(): string {
  return `bm_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`
}

/**
 * 自动书签名：优先取该页开头的一小段文字，
 * 没有文字（扫描件 / 图片页）就退化成「第 N 页」。
 */
export function autoBookmarkLabel(pageText: string, page: number): string {
  const flat = pageText.replace(/\s+/g, ' ').trim()
  if (flat.length < 2) return `第 ${page} 页`
  return truncate(flat, 24)
}

export function sortBookmarks(list: Bookmark[]): Bookmark[] {
  return [...list].sort((a, b) => a.page - b.page || a.createdAt - b.createdAt)
}

export function makeBookmark(page: number, label: string, index: number, note?: string): Bookmark {
  return {
    id: createBookmarkId(),
    page,
    label,
    color: bookmarkColor(index),
    note,
    createdAt: Date.now()
  }
}

export function hasBookmarkAt(list: Bookmark[], page: number): Bookmark | undefined {
  return list.find((b) => b.page === page)
}
