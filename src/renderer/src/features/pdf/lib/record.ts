/**
 * BookRecord 的读写封装 —— 阅读进度、书签、批注、目录缓存都存在这里。
 * 主进程负责落盘，渲染层只关心「合并 + 防抖保存」。
 */

import type { AnnotationMap, AnnotationStroke, BookRecord, Bookmark, OutlineItem } from '@shared/types'
import { libraryApi } from '@/lib/api'

export const EMPTY_RECORD: BookRecord = {
  bookId: '',
  progress: { page: 1, scrollRatio: 0, zoom: 1, rotation: 0 },
  bookmarks: [],
  annotations: {},
  outline: [],
  pdfHighlights: [],
  updatedAt: 0
}

export function normalizeRecord(record: BookRecord | null | undefined, bookId: string): BookRecord {
  if (!record) return { ...EMPTY_RECORD, bookId, progress: { ...EMPTY_RECORD.progress } }
  const progress = record.progress ?? EMPTY_RECORD.progress
  return {
    bookId,
    progress: {
      page: Math.max(1, Math.floor(progress.page || 1)),
      scrollRatio: Math.min(1, Math.max(0, progress.scrollRatio || 0)),
      zoom: progress.zoom && progress.zoom > 0 ? progress.zoom : 1,
      rotation: progress.rotation || 0
    },
    bookmarks: Array.isArray(record.bookmarks) ? record.bookmarks : [],
    annotations: record.annotations && typeof record.annotations === 'object' ? record.annotations : {},
    outline: Array.isArray(record.outline) ? record.outline : [],
    /*
     * 文字标注（高亮 / 划线）必须带上。
     * 这个函数是**白名单重建** —— 漏一个字段，写盘时就把用户刚做的高亮丢掉了。
     * （EPUB 那边"进度自动保存不带 highlights"是同一类坑。）
     */
    pdfHighlights: Array.isArray(record.pdfHighlights) ? record.pdfHighlights : [],
    updatedAt: record.updatedAt ?? 0
  }
}

export function withProgress(
  record: BookRecord,
  progress: Partial<BookRecord['progress']>
): BookRecord {
  return { ...record, progress: { ...record.progress, ...progress }, updatedAt: Date.now() }
}

export function withBookmarks(record: BookRecord, bookmarks: Bookmark[]): BookRecord {
  return { ...record, bookmarks, updatedAt: Date.now() }
}

export function withOutline(record: BookRecord, outline: OutlineItem[]): BookRecord {
  return { ...record, outline, updatedAt: Date.now() }
}

export function withAnnotations(record: BookRecord, annotations: AnnotationMap): BookRecord {
  return { ...record, annotations, updatedAt: Date.now() }
}

/** 取某一页的批注（返回稳定引用，便于 memo） */
export function strokesForPage(record: BookRecord, page: number): AnnotationStroke[] {
  return record.annotations[String(page)] ?? []
}

export function isEmptyStrokes(strokes: AnnotationStroke[]): boolean {
  return strokes.filter((s) => s.points.length > 0 || s.tool === 'text').length === 0
}

/**
 * 防抖保存器。阅读进度、批注都会高频变化，
 * 600ms 内的连续改动合并成一次 saveRecord。
 *
 * 主进程的 saveRecord 是「整份记录覆写」，并发写入会互相覆盖，
 * 因此这里额外串行化：同一时刻只允许一个 save 在飞，
 * 飞行期间的新改动排队，落地后合并成下一次写入。
 */
export class RecordSaver {
  private timer: number | null = null
  private pending: BookRecord | null = null
  private inFlight: Promise<void> | null = null
  private lastError: string | null = null

  constructor(
    private readonly delay = 600,
    private readonly onSaved?: (record: BookRecord) => void,
    private readonly onError?: (message: string) => void
  ) {}

  schedule(record: BookRecord): void {
    this.pending = record
    if (this.timer !== null) window.clearTimeout(this.timer)
    this.timer = window.setTimeout(() => {
      void this.flush()
    }, this.delay)
  }

  /**
   * 立刻写盘。
   *
   * `record` 参数是**必须**的语义补丁：书签、大纲、批注这些"立即保存"的改动走的是
   * `commit(next, true)` → `flush()`，而旧的 flush 只读 `this.pending` ——
   * 那个字段只有 `schedule()` 会写。于是立即保存要么什么都不写（pending 为空直接 return），
   * 要么把上一次 schedule 留下的**旧记录**（只有阅读进度、没有刚加的书签）写回去。
   * 表现就是"加了书签、界面里也有，重开却没了"。
   * 所以这里允许调用方把要写的记录直接递进来。
   */
  async flush(record?: BookRecord): Promise<void> {
    if (record) this.pending = record
    if (this.timer !== null) {
      window.clearTimeout(this.timer)
      this.timer = null
    }
    if (this.inFlight) {
      // 等前一次写完，再决定要不要补写（pending 会被下一轮读到）
      await this.inFlight.catch(() => undefined)
    }
    const payload = this.pending
    this.pending = null
    if (!payload) return

    const run = (async (): Promise<void> => {
      try {
        const saved = await libraryApi.saveRecord(payload)
        this.lastError = null
        this.onSaved?.(saved)
      } catch (error) {
        this.lastError = (error as Error).message
        this.onError?.(this.lastError)
      }
    })()

    this.inFlight = run
    try {
      await run
    } finally {
      if (this.inFlight === run) this.inFlight = null
    }
  }

  /** 立即保存，组件卸载时调用 */
  async dispose(): Promise<void> {
    await this.flush()
  }

  get error(): string | null {
    return this.lastError
  }
}
