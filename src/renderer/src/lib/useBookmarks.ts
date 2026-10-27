import { useCallback, useEffect, useMemo } from 'react'
import { create } from 'zustand'
import type { Book, Bookmark, BookmarkAnchor } from '@shared/types'
import { libraryApi } from '@/lib/api'
import { excerptOf, getBookmarkTarget, sameAnchor } from '@/lib/bookmarkTarget'
import { useUi } from '@/store/useUi'

/** 书签颜色沿用 PDF 那套（几种能在纸面上看清的颜色） */
export const BOOKMARK_COLORS = ['#c8553d', '#d9a441', '#4a7f52', '#3f6ea8', '#8a5aa8', '#6b6b6b']

/**
 * 书签清单是**跨组件共享**的一份状态。
 *
 * 以前每个用到它的组件各自 useBookmarks()，于是阅读器加了书签、侧栏那份还是旧的 ——
 * 用户看到的就是"标记的当下，书签栏显示不出来"。位置类数据本来也只有一份，
 * 放在 store 里最合适：阅读器、侧栏、书签标记都读同一个 list。
 */
interface BookmarkState {
  bookId: string | null
  list: Bookmark[]
  /** 当前位置对应的锚点，用来在列表里高亮"你在这" */
  activeAnchor: BookmarkAnchor | null
  load: (bookId: string | null) => Promise<void>
  setList: (bookId: string, next: Bookmark[]) => Promise<void>
  setActiveAnchor: (anchor: BookmarkAnchor | null) => void
}

export const useBookmarkStore = create<BookmarkState>((set, get) => ({
  bookId: null,
  list: [],
  activeAnchor: null,
  load: async (bookId) => {
    if (!bookId) {
      set({ bookId: null, list: [], activeAnchor: null })
      return
    }
    /* 换书先清空，免得短暂显示上一本的书签 */
    if (get().bookId !== bookId) set({ bookId, list: [], activeAnchor: null })
    try {
      const record = await libraryApi.record(bookId)
      /* 期间又换书了就别覆盖 */
      if (get().bookId !== bookId) return
      set({ list: record.bookmarks ?? [] })
    } catch {
      /* 读不到就当没有 */
    }
  },
  setList: async (bookId, next) => {
    set({ list: next, bookId })
    /* 阅读界面要按书签位置画标记（下划线、跳转高亮），用事件广播出去 */
    window.dispatchEvent(new CustomEvent('bookscent:bookmarks', { detail: { bookId, list: next } }))
    const record = await libraryApi.record(bookId)
    await libraryApi.saveRecord({ ...record, bookmarks: next })
  },
  setActiveAnchor: (activeAnchor) => set({ activeAnchor })
}))

export interface BookmarksApi {
  list: Bookmark[]
  /** 当前位置对应的书签 id（列表里高亮用），没有就是 null */
  activeId: string | null
  /** 加书签：位置由正在打开的那个阅读器提供 */
  /** 加书签：位置由正在打开的那个阅读器提供；excerpt 传用户选中的原文，plain 传去掉振假名的那份 */
  add: (options?: { excerpt?: string; plain?: string; kind?: 'bookmark' | 'note' }) => Promise<void>
  jump: (bookmark: Bookmark) => void
  rename: (id: string, label: string) => Promise<void>
  recolor: (id: string, color: string) => Promise<void>
  /** 给书签写备注 / 读书笔记 */
  setNote: (id: string, note: string) => Promise<void>
  remove: (id: string) => Promise<void>
}

/**
 * 书签的统一读写。
 *
 * 所有格式共用这一份：位置怎么记由阅读器注册的锚点决定（见 bookmarkTarget），
 * 界面只管清单。写回整份记录时 `saveRecord` 会保留用量字段，所以不会把统计踩掉。
 */
export function useBookmarks(book: Book | undefined): BookmarksApi {
  const toast = useUi((s) => s.toast)
  const bookId = book?.id
  const list = useBookmarkStore((s) => s.list)
  const activeAnchor = useBookmarkStore((s) => s.activeAnchor)

  useEffect(() => {
    void useBookmarkStore.getState().load(bookId ?? null)
  }, [bookId])

  /* 当前位置可能会变（翻页、滚动），隔一小会儿取一次，用于高亮 */
  useEffect(() => {
    if (!bookId) return
    const tick = (): void =>
      useBookmarkStore.getState().setActiveAnchor(getBookmarkTarget()?.anchor() ?? null)
    tick()
    const timer = window.setInterval(tick, 700)
    return () => window.clearInterval(timer)
  }, [bookId])

  const persist = useCallback(
    async (next: Bookmark[]) => {
      if (!bookId) return
      await useBookmarkStore.getState().setList(bookId, next)
    },
    [bookId]
  )

  const add = useCallback(
    async (options?: { excerpt?: string; plain?: string; kind?: 'bookmark' | 'note' }) => {
      if (!bookId) return
      const target = getBookmarkTarget()
      const anchor = target?.anchor() ?? null
      if (!target || !anchor) {
        toast('这个位置暂时不能加书签', 'error', '先翻一下页再试')
        return
      }
      const info = target.describe()
      const current = useBookmarkStore.getState().list
      /*
       * 摘录优先用**用户选中的那段原文**（从选中工具条「记为笔记」进来时会传），
       * 那才是他要记下来的句子；没选中时才退回"当前位置那一页的文字"。
       * 这个摘录还有第二个用处：EPUB 靠它在章节里把书签那段标出来（见 bookmarkMarks）。
       */
      const excerpt = options?.excerpt?.trim() || info.excerpt || ''
      const bookmark: Bookmark = {
        id: `bm_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
        page: info.page,
        label: info.label,
        color: BOOKMARK_COLORS[current.length % BOOKMARK_COLORS.length],
        createdAt: Date.now(),
        anchor,
        /* 来源决定它是书签还是笔记：从选中文本记下来的才算笔记 */
        kind: options?.kind ?? 'bookmark',
        excerpt: excerpt ? excerptOf(excerpt) : undefined,
        /* 复制/展示用：不含振假名（定位仍靠 excerpt 与锚点） */
        plain: options?.plain ? excerptOf(options.plain) : undefined
      }
      await persist([...current, bookmark])
      /* 带原文的是「笔记」，只有位置的是「书签」—— 用户要求把这两者分清楚 */
      const isNote = Boolean(bookmark.excerpt)
      toast(
        isNote ? '已记为笔记' : '已加书签',
        'success',
        isNote ? excerptOf(bookmark.excerpt ?? '') : info.label
      )
    },
    [bookId, persist, toast]
  )

  const jump = useCallback((bookmark: Bookmark) => {
    const target = getBookmarkTarget()
    if (!target) return
    const anchor = bookmark.anchor ?? { kind: 'page' as const, page: bookmark.page }
    target.goTo(anchor)
    // 跳过去之后把它标成"当前位置"，列表里立刻高亮
    useBookmarkStore.getState().setActiveAnchor(anchor)
  }, [])

  const rename = useCallback(
    async (id: string, label: string) => {
      await persist(list.map((item) => (item.id === id ? { ...item, label: label || item.label } : item)))
    },
    [list, persist]
  )

  const recolor = useCallback(
    async (id: string, color: string) => {
      await persist(list.map((item) => (item.id === id ? { ...item, color } : item)))
    },
    [list, persist]
  )

  const setNote = useCallback(
    async (id: string, note: string) => {
      const next = list.map((item) => (item.id === id ? { ...item, note: note.trim() || undefined } : item))
      await persist(next)
      toast(note.trim() ? '备注已保存' : '备注已清空', 'success')
    },
    [list, persist, toast]
  )

  const remove = useCallback(
    async (id: string) => {
      await persist(list.filter((item) => item.id !== id))
    },
    [list, persist]
  )

  const activeId = useMemo(() => {
    const hit = list.find((item) => sameAnchor(item.anchor, activeAnchor))
    return hit?.id ?? null
  }, [list, activeAnchor])

  return { list, activeId, add, jump, rename, recolor, setNote, remove }
}
