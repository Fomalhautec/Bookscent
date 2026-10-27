import { useEffect, useState } from 'react'
import type { Book } from '@shared/types'
import { USAGE_KEY_OF } from '@shared/types'
import { libraryApi } from '@/lib/api'
import { useLibrary } from '@/store/useLibrary'
import { useReading } from '@/store/useReading'

/*
 * 计时与上报的间隔。
 *
 * **一分钟一次就够**：这是"读了多久"的统计，不是秒表。
 * 早先 20 秒一跳，意味着整棵树（含 foliate 的阅读视图）跟着重渲染，
 * 正好和"切排版方向时重开书"的布局撞上会把渲染进程卡死。
 * 秒数不会因此丢：切后台、关窗、卸载时都会各刷一次（见下面的 flush）。
 */
const FLUSH_MS = 60000

/** 用量钩子的返回值：够阅读界面底栏显示一行字 */
export interface UsageSummary {
  /** 本次打开已经计的秒数（实时跳） */
  sessionSeconds: number
  /** 累计打开次数 */
  opens: number
  /** 累计秒数 */
  seconds: number
  /** 累计页数（书籍） */
  pages: number
  /** 累计输入字数（笔记） */
  words: number
}

/**
 * 用量计时。
 *
 * 挂在阅读界面上（ReaderHost），一本书打开着就一直在算：
 *   - 挂载时记一次"打开"
 *   - 每 20 秒、以及切到后台/关闭时，把这段时间累加进记录
 *
 * 只在窗口可见时计时 —— 挂在后台开着一整天不该算成读了十小时。
 * 上报的是**增量**，由主进程读改写合并，所以不会覆盖阅读进度和批注。
 */
export function useUsage(book: Book | undefined): UsageSummary {
  const [summary, setSummary] = useState<UsageSummary>({
    sessionSeconds: 0,
    opens: 0,
    seconds: 0,
    pages: 0,
    words: 0
  })

  const id = book?.id
  const kind = book?.kind

  useEffect(() => {
    if (!id || !kind) return
    const key = USAGE_KEY_OF[kind]
    let pendingSeconds = 0
    let sessionSeconds = 0
    let last = Date.now()

    // 先把累计值读出来（底栏要显示"共打开 N 次"）
    void libraryApi
      .record(id)
      .then((record) => {
        const usage = record.usage?.[key]
        setSummary((current) => ({
          ...current,
          opens: usage?.opens ?? 0,
          seconds: usage?.seconds ?? 0,
          pages: usage?.pages ?? 0,
          words: usage?.words ?? 0
        }))
      })
      .catch(() => undefined)

    const flush = (): void => {
      const now = Date.now()
      if (document.visibilityState === 'visible') {
        const delta = Math.max(0, Math.round((now - last) / 1000))
        pendingSeconds += delta
        sessionSeconds += delta
        setSummary((current) => ({ ...current, sessionSeconds }))
      }
      last = now
      if (pendingSeconds < 1) return
      const seconds = pendingSeconds
      pendingSeconds = 0
      void libraryApi.recordUsage(id, key, { seconds }).catch(() => undefined)
    }

    void libraryApi.recordUsage(id, key, { opens: 1 }).catch(() => undefined)

    const timer = window.setInterval(flush, FLUSH_MS)
    const onVisibility = (): void => {
      if (document.visibilityState === 'visible') last = Date.now()
      else flush()
    }
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('beforeunload', flush)

    return () => {
      flush()
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('beforeunload', flush)
      // 离开这本书，状态栏恢复显示书架信息
      useReading.getState().setActive(null)
    }
  }, [id, kind])

  /*
   * 把摘要同步给全局状态栏。
   * 用户希望阅读统计显示在"46 本藏书 · 4 层书架"那一行上，
   * 而不是单独一条底栏 —— 那边只要读这个 store 就行。
   */
  useEffect(() => {
    if (!id || !kind) return
    useReading.getState().setActive({
      bookId: id,
      title: book?.title ?? '',
      asNote: kind === 'note',
      sessionSeconds: summary.sessionSeconds,
      opens: summary.opens,
      seconds: summary.seconds,
      pages: summary.pages,
      words: summary.words
    })
  }, [id, kind, book?.title, summary])

  return summary
}

/**
 * 翻页计数（阅读类的"阅读页数"）。
 *
 * 阅读器自己知道什么时候换了页，换页时调一下这个就行。
 * 同样是增量上报，主进程按 kind 分账。
 */
export function reportPageTurn(bookId: string, count = 1): void {
  if (count <= 0) return
  const book = useLibrary.getState().index?.books.find((b) => b.id === bookId)
  const key = USAGE_KEY_OF[book?.kind ?? 'book']
  void libraryApi.recordUsage(bookId, key, { pages: count }).catch(() => undefined)
}

/** 输入字数增量（笔记类的"输入字数"） */
export function reportWords(bookId: string, words: number): void {
  if (words <= 0) return
  const book = useLibrary.getState().index?.books.find((b) => b.id === bookId)
  const key = USAGE_KEY_OF[book?.kind ?? 'note']
  void libraryApi.recordUsage(bookId, key, { words }).catch(() => undefined)
}
