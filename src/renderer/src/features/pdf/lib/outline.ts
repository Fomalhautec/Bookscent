/**
 * PDF 内嵌目录（书签树）解析。
 *
 * getOutline() 返回的 dest 有三种形态：
 *   1. 字符串 —— 命名目标，需要 getDestination() 再查一次
 *   2. 数组   —— 显式目标，[0] 可能是 RefProxy（用 getPageIndex 换算）或页码（0 基）
 *   3. null   —— 没有跳转目标，只能展示标题
 */

import type { PDFDocumentProxy } from 'pdfjs-dist'
import type { OutlineItem } from '@shared/types'

/** pdfjs 目录节点的原始结构（只声明我们真正读取的字段） */
interface RawOutlineNode {
  title: string
  dest: string | unknown[] | null
  items?: RawOutlineNode[]
}

/** RefProxy 形如 { num, gen }，pdfjs 没有导出这个类型，按结构判断 */
function isRefProxy(value: unknown): value is { num: number; gen: number } {
  if (!value || typeof value !== 'object') return false
  const ref = value as { num?: unknown; gen?: unknown }
  return typeof ref.num === 'number' && typeof ref.gen === 'number'
}

/**
 * 把目标解析成 1 基页码；解析不出来返回 null。
 * indexCache 用来缓存 RefProxy → 页码，避免重复往返 worker。
 */
async function resolveDestinationPage(
  doc: PDFDocumentProxy,
  dest: string | unknown[] | null,
  indexCache: Map<string, number>
): Promise<number | null> {
  if (!dest) return null
  let target: unknown[] | null = null
  if (typeof dest === 'string') {
    try {
      target = await doc.getDestination(dest)
    } catch {
      return null
    }
  } else if (Array.isArray(dest)) {
    target = dest
  }
  if (!target || target.length === 0) return null

  const first = target[0]
  if (isRefProxy(first)) {
    const key = `${first.num}:${first.gen}`
    const cached = indexCache.get(key)
    if (cached !== undefined) return cached + 1
    try {
      const index = await doc.getPageIndex(first)
      indexCache.set(key, index)
      return index + 1
    } catch {
      return null
    }
  }
  if (typeof first === 'number') {
    // 有 PDF 用页码本身作为目标，0 基
    const page = Math.floor(first) + 1
    return page >= 1 && page <= doc.numPages ? page : null
  }
  return null
}

/**
 * 读取并展平目录，depth 从 0 开始。
 * 上限 6 层，防止异常 PDF 里的自引用把递归撑爆。
 */
export async function loadOutline(doc: PDFDocumentProxy): Promise<OutlineItem[]> {
  let raw: unknown
  try {
    raw = await doc.getOutline()
  } catch {
    return []
  }
  if (!Array.isArray(raw) || raw.length === 0) return []

  const indexCache = new Map<string, number>()
  const out: OutlineItem[] = []

  async function walk(nodes: RawOutlineNode[], depth: number): Promise<void> {
    if (depth > 6) return
    for (const node of nodes) {
      if (!node || typeof node.title !== 'string') continue
      const title = node.title.replace(/\s+/g, ' ').trim()
      if (!title) continue
      const page = await resolveDestinationPage(doc, node.dest, indexCache)
      out.push({ title, page, depth })
      if (Array.isArray(node.items) && node.items.length > 0) {
        await walk(node.items as RawOutlineNode[], depth + 1)
      }
    }
  }

  await walk(raw as RawOutlineNode[], 0)
  return out
}

/** 目录是否「够用」：有标题且至少一项能跳转 */
export function outlineIsUsable(outline: OutlineItem[]): boolean {
  return outline.some((item) => item.page !== null)
}
