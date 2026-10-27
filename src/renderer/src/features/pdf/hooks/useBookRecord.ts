/**
 * BookRecord（进度 / 书签 / 批注 / 目录缓存）的唯一状态源。
 *
 * 所有写操作都走 mutate：就地产生新 record → 更新 state → 交给防抖保存器。
 * 组件卸载或切书时立刻 flush，避免丢掉最后一次改动。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AnnotationMap, PdfTextHighlight, AnnotationStroke, BookRecord, Bookmark, OutlineItem } from '@shared/types'
import { libraryApi } from '@/lib/api'
import { useUi } from '@/store/useUi'
import {
  normalizeRecord,
  RecordSaver,
  withAnnotations,
  withBookmarks,
  withOutline,
  withProgress
} from '../lib/record'

export interface BookRecordStore {
  record: BookRecord
  loading: boolean
  /** 已加载或写入过至少一次（用于判断进度是否可恢复） */
  hydrated: boolean
  setProgress: (progress: Partial<BookRecord['progress']>, immediate?: boolean) => void
  setBookmarks: (updater: (list: Bookmark[]) => Bookmark[]) => void
  setOutline: (outline: OutlineItem[]) => void
  setPageStrokes: (page: number, updater: (strokes: AnnotationStroke[]) => AnnotationStroke[]) => void
  setAnnotations: (annotations: AnnotationMap) => void
  /** 文字标注（高亮 / 划线）：整体替换，立即落盘 */
  setTextHighlights: (marks: PdfTextHighlight[]) => void
  flush: () => Promise<void>
}

export function useBookRecord(bookId: string): BookRecordStore {
  const [record, setRecord] = useState<BookRecord>(() => normalizeRecord(null, bookId))
  const [loading, setLoading] = useState(true)
  const [hydrated, setHydrated] = useState(false)
  const recordRef = useRef(record)
  recordRef.current = record

  const saverRef = useRef<RecordSaver | null>(null)
  if (saverRef.current === null) {
    saverRef.current = new RecordSaver(600, undefined, (message) => {
      useUi.getState().toast('阅读记录保存失败', 'error', message)
    })
  }

  // 换书：立刻把上一本的待写内容落盘，然后重新拉取
  useEffect(() => {
    let disposed = false
    const saver = saverRef.current
    void saver?.flush()
    setLoading(true)
    setHydrated(false)
    setRecord(normalizeRecord(null, bookId))

    const run = async (): Promise<void> => {
      try {
        const loaded = await libraryApi.record(bookId)
        if (disposed) return
        setRecord(normalizeRecord(loaded, bookId))
        setHydrated(true)
      } catch (error) {
        if (disposed) return
        useUi.getState().toast('阅读记录读取失败', 'error', (error as Error).message)
      } finally {
        if (!disposed) setLoading(false)
      }
    }

    void run()

    return () => {
      disposed = true
      void saver?.flush()
    }
  }, [bookId])

  const commit = useCallback((next: BookRecord, immediate = false): void => {
    recordRef.current = next
    setRecord(next)
    const saver = saverRef.current
    if (!saver) return
    // 必须把这份记录递进去：flush() 只读自己的 pending，不递就等于没保存
    if (immediate) void saver.flush(next)
    else saver.schedule(next)
  }, [])

  const mutate = useCallback(
    (fn: (current: BookRecord) => BookRecord, immediate = false): void => {
      commit(fn(recordRef.current), immediate)
    },
    [commit]
  )

  const setProgress = useCallback(
    (progress: Partial<BookRecord['progress']>, immediate = false): void => {
      mutate((current) => withProgress(current, progress), immediate)
    },
    [mutate]
  )

  const setBookmarks = useCallback(
    (updater: (list: Bookmark[]) => Bookmark[]): void => {
      mutate((current) => withBookmarks(current, updater(current.bookmarks)), true)
    },
    [mutate]
  )

  const setOutline = useCallback(
    (outline: OutlineItem[]): void => {
      mutate((current) => withOutline(current, outline), true)
    },
    [mutate]
  )

  const setPageStrokes = useCallback(
    (page: number, updater: (strokes: AnnotationStroke[]) => AnnotationStroke[]): void => {
      mutate((current) => {
        const key = String(page)
        const next = updater(current.annotations[key] ?? [])
        const annotations: AnnotationMap = { ...current.annotations }
        if (next.length === 0) delete annotations[key]
        else annotations[key] = next
        return withAnnotations(current, annotations)
      }, true)
    },
    [mutate]
  )

  const setAnnotations = useCallback(
    (annotations: AnnotationMap): void => {
      mutate((current) => withAnnotations(current, annotations), true)
    },
    [mutate]
  )

  /*
   * 文字标注（高亮 / 划线）：整体替换 + 立即落盘。
   * 这是用户主动做的动作，不该等自动保存那 600ms 的节流窗口。
   */
  const setTextHighlights = useCallback(
    (marks: PdfTextHighlight[]): void => {
      mutate((current) => ({ ...current, pdfHighlights: marks, updatedAt: Date.now() }), true)
    },
    [mutate]
  )

  const flush = useCallback(async (): Promise<void> => {
    await saverRef.current?.flush()
  }, [])

  // 卸载时兜底 flush
  useEffect(() => {
    return () => {
      void saverRef.current?.flush()
    }
  }, [])

  return useMemo(
    () => ({
      record,
      loading,
      hydrated,
      setProgress,
      setBookmarks,
      setOutline,
      setPageStrokes,
      setAnnotations,
      setTextHighlights,
      flush
    }),
    [
      record,
      loading,
      hydrated,
      setProgress,
      setBookmarks,
      setOutline,
      setPageStrokes,
      setAnnotations,
      setTextHighlights,
      flush
    ]
  )
}
