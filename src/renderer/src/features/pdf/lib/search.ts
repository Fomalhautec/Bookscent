/**
 * 全文搜索 —— 逐页懒加载文本内容，命中位置以归一化矩形保存，
 * 这样缩放、旋转后高亮框仍然贴在同一段文字上。
 */

import type { PDFDocumentProxy } from 'pdfjs-dist'
import { getPageText } from './engine'

export interface SearchRect {
  /** 相对页面（scale=1 viewport）的归一化坐标 0..1 */
  x: number
  y: number
  width: number
  height: number
}

export interface SearchHit {
  page: number
  /** 该命中在整篇搜索里的序号 */
  order: number
  /** 命中所在页的文本序号 */
  indexInPage: number
  snippet: string
  rects: SearchRect[]
}

export interface PageSearchResult {
  page: number
  hits: SearchHit[]
}

/**
 * 在单页里找关键词。
 * 逐 span 匹配：中文常见「一词被拆成多个 span」的情况这里不处理，
 * 好处是矩形位置精确、实现简单，代价是跨 span 的长词可能漏检。
 */
export async function searchPage(
  doc: PDFDocumentProxy,
  page: number,
  query: string,
  userRotation = 0
): Promise<Omit<SearchHit, 'order'>[]> {
  const needle = query.trim()
  if (!needle) return []
  const haystackLower = needle.toLocaleLowerCase()

  const { text, spans, viewportWidth, viewportHeight } = await getPageText(doc, page, userRotation)
  const local: Omit<SearchHit, 'order'>[] = []

  // span 内匹配
  for (const span of spans) {
    const spanLower = span.text.toLocaleLowerCase()
    let from = 0
    while (from <= spanLower.length - haystackLower.length) {
      const at = spanLower.indexOf(haystackLower, from)
      if (at < 0) break
      const ratio = span.width / Math.max(1, span.text.length)
      local.push({
        page,
        indexInPage: local.length,
        snippet: makeSnippet(span.text, at, needle.length),
        rects: [
          {
            x: clamp01((span.x + at * ratio) / viewportWidth),
            y: clamp01(span.y / viewportHeight),
            width: clamp01((needle.length * ratio) / viewportWidth),
            height: clamp01(span.height / viewportHeight)
          }
        ]
      })
      from = at + needle.length
    }
  }

  // 整页文本兜底：处理跨 span 的匹配（例如被排版拆开的西文单词）
  if (local.length === 0 && text.length > 0) {
    const pageLower = text.toLocaleLowerCase()
    let from = 0
    while (from <= pageLower.length - haystackLower.length) {
      const at = pageLower.indexOf(haystackLower, from)
      if (at < 0) break
      const rect = rectForRange(spans, at, needle.length)
      if (rect) {
        local.push({
          page,
          indexInPage: local.length,
          snippet: makeSnippet(text, at, needle.length),
          rects: [rect].map((r) => ({
            x: clamp01(r.x / viewportWidth),
            y: clamp01(r.y / viewportHeight),
            width: clamp01(r.width / viewportWidth),
            height: clamp01(r.height / viewportHeight)
          }))
        })
      }
      from = at + needle.length
    }
  }

  return local
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(1, Math.max(0, value))
}

function makeSnippet(text: string, at: number, length: number): string {
  const start = Math.max(0, at - 18)
  const end = Math.min(text.length, at + length + 22)
  const prefix = start > 0 ? '…' : ''
  const suffix = end < text.length ? '…' : ''
  return `${prefix}${text.slice(start, end).replace(/\s+/g, ' ')}${suffix}`
}

/** 把「整页文本里的字符区间」映射回 span 矩形（近似：取覆盖该区间起止的 span 并集） */
function rectForRange(
  spans: { x: number; y: number; width: number; height: number; text: string }[],
  start: number,
  length: number
): { x: number; y: number; width: number; height: number } | null {
  const end = start + length
  let cursor = 0
  let box: { x: number; y: number; width: number; height: number } | null = null
  for (const span of spans) {
    const spanStart = cursor
    const spanEnd = cursor + span.text.length
    cursor = spanEnd
    if (spanEnd <= start || spanStart >= end) continue
    const left = span.x
    const right = span.x + span.width
    if (!box) {
      box = { x: left, y: span.y, width: right - left, height: span.height }
    } else {
      const nx = Math.min(box.x, left)
      const ny = Math.min(box.y, span.y)
      const nr = Math.max(box.x + box.width, right)
      const nb = Math.max(box.y + box.height, span.y + span.height)
      box = { x: nx, y: ny, width: nr - nx, height: nb - ny }
    }
  }
  return box
}

/** 顺序搜索：逐页来，遇到足够多的命中就先返回，避免整本卡住 */
export async function searchDocument(
  doc: PDFDocumentProxy,
  query: string,
  options: { maxHits?: number; onPage?: (page: number, hits: SearchHit[], total: number) => void; signal?: { aborted: boolean } } = {}
): Promise<SearchHit[]> {
  const maxHits = options.maxHits ?? 500
  const all: SearchHit[] = []
  let order = 0
  for (let page = 1; page <= doc.numPages; page += 1) {
    if (options.signal?.aborted) break
    let local: Omit<SearchHit, 'order'>[] = []
    try {
      local = await searchPage(doc, page, query)
    } catch {
      local = []
    }
    const hits: SearchHit[] = local.map((hit) => ({ ...hit, order: order++ }))
    if (hits.length > 0) {
      all.push(...hits)
      options.onPage?.(page, hits, all.length)
    }
    if (all.length >= maxHits) break
  }
  return all
}
