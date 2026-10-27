import type { Book, BookFormat, BookStatus, ShelfSortMode } from '@shared/types'

const collator = new Intl.Collator('zh-Hans-CN', { numeric: true, sensitivity: 'base' })

/** 每种排序"顺理成章"的方向：新的、大的、评分高的在前 */
export function defaultDescFor(mode: ShelfSortMode): boolean {
  return mode === 'recent' || mode === 'added' || mode === 'rating' || mode === 'pages'
}

export const SORT_LABEL: Record<ShelfSortMode, string> = {
  manual: '默认（手动）',
  recent: '最近打开',
  added: '加入时间',
  title: '书名',
  author: '作者',
  pages: '页数',
  rating: '评分',
  format: '格式'
}

/**
 * 排序。
 *
 * `manual` 用的是 user 拖出来的 order；其它模式都是即时算出来的，
 * 所以一旦在非 manual 模式下拖动，就要先把当前顺序固化成新的 order（见 BookshelfView）。
 */
export function sortBooks(books: Book[], mode: ShelfSortMode, desc: boolean): Book[] {
  const list = [...books]
  const cmp = comparatorFor(mode)
  list.sort((a, b) => {
    const result = cmp(a, b)
    // 同值时用手动顺序兜底，保证排序稳定、不跳动
    return result !== 0 ? result : (a.order ?? 0) - (b.order ?? 0)
  })
  return desc ? list.reverse() : list
}

function comparatorFor(mode: ShelfSortMode): (a: Book, b: Book) => number {
  switch (mode) {
    case 'recent':
      return (a, b) => (a.lastOpenedAt ?? 0) - (b.lastOpenedAt ?? 0)
    case 'added':
      return (a, b) => (a.addedAt ?? 0) - (b.addedAt ?? 0)
    case 'title':
      return (a, b) => collator.compare(a.title, b.title)
    case 'author':
      return (a, b) => collator.compare(a.author || '\uffff', b.author || '\uffff')
    case 'pages':
      return (a, b) => (a.pageCount ?? 0) - (b.pageCount ?? 0)
    case 'rating':
      return (a, b) => (a.rating ?? 0) - (b.rating ?? 0)
    case 'format':
      return (a, b) => collator.compare(a.format, b.format)
    default:
      return (a, b) => (a.order ?? 0) - (b.order ?? 0)
  }
}

/* ------------------------------------------------------------------ 筛选 */

export interface ShelfFilter {
  /** 顶部搜索框里的关键词 */
  query: string
  formats: BookFormat[]
  status: BookStatus[]
  tags: string[]
  minRating: number
}

export function emptyFilter(): ShelfFilter {
  return { query: '', formats: [], status: [], tags: [], minRating: 0 }
}

export function isFilterActive(filter: ShelfFilter): boolean {
  return (
    filter.query.trim().length > 0 ||
    filter.formats.length > 0 ||
    filter.status.length > 0 ||
    filter.tags.length > 0 ||
    filter.minRating > 0
  )
}

export function activeFilterCount(filter: ShelfFilter): number {
  let count = 0
  if (filter.query.trim()) count += 1
  if (filter.formats.length) count += 1
  if (filter.status.length) count += 1
  if (filter.tags.length) count += 1
  if (filter.minRating > 0) count += 1
  return count
}

export function filterBooks(books: Book[], filter: ShelfFilter): Book[] {
  const query = filter.query.trim().toLowerCase()
  const tags = filter.tags.map((tag) => tag.toLowerCase())

  return books.filter((book) => {
    if (filter.formats.length > 0 && !filter.formats.includes(book.format)) return false
    if (filter.status.length > 0 && !filter.status.includes(book.status)) return false
    if (filter.minRating > 0 && (book.rating ?? 0) < filter.minRating) return false
    if (tags.length > 0) {
      const own = book.tags.map((tag) => tag.toLowerCase())
      if (!tags.some((tag) => own.includes(tag))) return false
    }
    if (query) {
      const haystack = `${book.title} ${book.author} ${book.tags.join(' ')} ${book.path}`.toLowerCase()
      if (!haystack.includes(query)) return false
    }
    return true
  })
}

/** 库里出现过的全部标签，用于筛选面板的候选列表 */
export function collectTags(books: Book[]): string[] {
  const set = new Set<string>()
  for (const book of books) {
    for (const tag of book.tags ?? []) {
      const trimmed = tag.trim()
      if (trimmed) set.add(trimmed)
    }
  }
  return [...set].sort((a, b) => collator.compare(a, b))
}

/* -------------------------------------------------------------- 拖动落点 */

/**
 * 把 `draggedId` 移到 `targetId` 的 before/after，返回新的 id 顺序。
 * 传入的 orderedIds 应当是"当前看到的顺序"，这样固化下来的默认顺序才符合直觉。
 */
export function moveWithinOrder(
  orderedIds: string[],
  draggedId: string,
  targetId: string,
  side: 'before' | 'after'
): string[] {
  if (draggedId === targetId) return orderedIds
  const next = orderedIds.filter((id) => id !== draggedId)
  const targetIndex = next.indexOf(targetId)
  if (targetIndex < 0) return orderedIds
  next.splice(side === 'after' ? targetIndex + 1 : targetIndex, 0, draggedId)
  return next
}
