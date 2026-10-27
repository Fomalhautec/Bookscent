import { create } from 'zustand'
import type { Book, BookendFacing, BookendSide, LibraryIndex, Shelf } from '@shared/types'
import { libraryApi } from '@/lib/api'
import { useUi } from './useUi'

export type ViewMode = 'grid' | 'list'

interface LibraryStore {
  index: LibraryIndex | null
  loading: boolean
  scan: { done: number; total: number; finished: boolean } | null
  openBookId: string | null
  query: string
  activeShelfId: string
  viewMode: ViewMode
  selectedIds: string[]

  load: () => Promise<void>
  rescan: () => Promise<void>
  importFiles: (copy: boolean) => Promise<number>
  importFolder: (copy: boolean) => Promise<number>
  importPaths: (paths: string[], copy: boolean) => Promise<number>
  /** 临时打开一个文件（不进书架） */
  openTemporary: (path: string) => Promise<void>
  /** 弹对话框挑一个文件临时打开 */
  pickTemporary: () => Promise<void>
  /** 把一本临时书转正 */
  keepTemporary: (id: string) => Promise<void>
  /** 手动排序：按给定顺序重排这些书 */
  reorder: (orderedIds: string[]) => Promise<void>
  createNote: (kind: 'md' | 'txt', title?: string) => Promise<Book | null>
  updateBook: (id: string, patch: Partial<Book>) => Promise<Book | null>
  removeBooks: (ids: string[], deleteFiles: boolean) => Promise<void>

  select: (id: string | null) => void
  setQuery: (q: string) => void
  setActiveShelf: (id: string) => void
  setViewMode: (mode: ViewMode) => void
  toggleSelected: (id: string) => void
  clearSelection: () => void

  /** 从回收站还原（文件挪回藏书目录） */
  restoreBooks: (ids: string[]) => Promise<void>
  /** 彻底删除：文件 + 条目 + 阅读记录 */
  purgeBooks: (ids: string[]) => Promise<void>

  addShelf: (name: string) => Promise<void>
  renameShelf: (id: string, name: string) => Promise<void>
  removeShelf: (id: string) => Promise<void>
  /** 设置书架层主题色（侧栏右键菜单与设置里的书架层管理都写这里） */
  setShelfColor: (id: string, color: string | null) => Promise<void>
  assignShelf: (ids: string[], shelfId: string) => Promise<void>

  /** 书立（单侧隔断）：在锚点书的某一侧加一块挡板 */
  addBookend: (shelfId: string, anchorBookId: string | null, side?: BookendSide) => Promise<void>
  updateBookend: (
    id: string,
    patch: {
    gap?: number
    label?: string
    side?: BookendSide
    breakLine?: boolean
    /** 封面模式下的换行（不设就沿用 breakLine） */
    breakLineCover?: boolean
    /** 在哪些朝向模式下生效 */
    facing?: BookendFacing
  }
  ) => Promise<void>
  moveBookend: (id: string, direction: -1 | 1) => Promise<void>
  /** 一键移除所有找不到文件的失效书籍 */
  removeMissing: () => Promise<number>
  removeBookend: (id: string) => Promise<void>

  bookById: (id: string | null) => Book | undefined
}

export const useLibrary = create<LibraryStore>()((set, get) => ({
  index: null,
  loading: true,
  scan: null,
  openBookId: null,
  query: '',
  activeShelfId: 'all',
  viewMode: 'grid',
  selectedIds: [],

  load: async () => {
    try {
      const index = await libraryApi.index()
      set({ index, loading: false })
      void libraryApi.rescan().then((fresh) => set({ index: fresh }))
    } catch (error) {
      set({ loading: false })
      useUi.getState().toast('书架读取失败', 'error', (error as Error).message)
    }
  },

  rescan: async () => {
    try {
      const index = await libraryApi.rescan()
      set({ index })
    } catch (error) {
      useUi.getState().toast('重新扫描失败', 'error', (error as Error).message)
    }
  },

  importFiles: async (copy) => {
    try {
      const result = await libraryApi.importFilesDialog(copy)
      if (!result) return 0
      set({ index: result.index })
      reportImport(result.added.length, result.skipped)
      return result.added.length
    } catch (error) {
      useUi.getState().toast('导入失败', 'error', (error as Error).message)
      return 0
    }
  },

  importFolder: async (copy) => {
    try {
      const result = await libraryApi.importFolderDialog(copy)
      if (!result) return 0
      set({ index: result.index })
      reportImport(result.added.length, result.skipped)
      return result.added.length
    } catch (error) {
      useUi.getState().toast('导入失败', 'error', (error as Error).message)
      return 0
    }
  },

  reorder: async (orderedIds) => {
    try {
      const index = await libraryApi.reorderBooks(orderedIds)
      set({ index })
    } catch (error) {
      useUi.getState().toast('保存排序失败', 'error', (error as Error).message)
    }
  },

  importPaths: async (paths, copy) => {
    try {
      const result = await libraryApi.importPaths(paths, copy)
      set({ index: result.index })
      reportImport(result.added.length, result.skipped)
      return result.added.length
    } catch (error) {
      useUi.getState().toast('导入失败', 'error', (error as Error).message)
      return 0
    }
  },

  /**
   * 临时打开：看着方便，不进书架。
   * 打开后直接把阅读界面切到这本书（用户点「打开方式」或菜单里的「临时打开」都是这个路径）。
   */
  openTemporary: async (path) => {
    try {
      const result = await libraryApi.openTemporary(path)
      if (!result) return
      set({ index: result.index, openBookId: result.book.id })
      useUi
        .getState()
        .toast('已临时打开', 'success', '看完可以直接关掉；想留下就点阅读界面右上角的「添加到书架」')
    } catch (error) {
      useUi.getState().toast('打不开这个文件', 'error', (error as Error).message)
    }
  },

  pickTemporary: async () => {
    try {
      const result = await libraryApi.pickTemporary()
      if (!result) return
      set({ index: result.index, openBookId: result.book.id })
      useUi
        .getState()
        .toast('已临时打开', 'success', '看完可以直接关掉；想留下就点阅读界面右上角的「添加到书架」')
    } catch (error) {
      useUi.getState().toast('打不开这个文件', 'error', (error as Error).message)
    }
  },

  /** 临时的书转正：清掉标记并留在书架上 */
  keepTemporary: async (id) => {
    const book = await libraryApi.updateBook(id, { temporary: false })
    if (book) {
      useUi.getState().toast(`已把「${book.title}」添加到书架`, 'success')
    } else {
      useUi.getState().toast('添加失败', 'error')
    }
  },

  createNote: async (kind, title) => {
    try {
      const book = await libraryApi.createNote(kind, title)
      const index = get().index
      if (index) set({ index: { ...index, books: [...index.books, book] } })
      void libraryApi.enrich()
      return book
    } catch (error) {
      useUi.getState().toast('新建笔记失败', 'error', (error as Error).message)
      return null
    }
  },

  updateBook: async (id, patch) => {
    const previous = get().index
    if (previous) {
      set({
        index: {
          ...previous,
          books: previous.books.map((b) => (b.id === id ? { ...b, ...patch } : b))
        }
      })
    }
    try {
      const book = await libraryApi.updateBook(id, patch)
      const index = get().index
      if (index) {
        set({ index: { ...index, books: index.books.map((b) => (b.id === id ? book : b)) } })
      }
      return book
    } catch (error) {
      if (previous) set({ index: previous })
      useUi.getState().toast('保存书籍信息失败', 'error', (error as Error).message)
      return null
    }
  },

  removeBooks: async (ids, deleteFiles) => {
    try {
      const index = await libraryApi.removeBooks(ids, deleteFiles)
      set({ index, selectedIds: [] })
      if (ids.includes(get().openBookId ?? '')) set({ openBookId: null })
      if (!deleteFiles) {
        useUi
          .getState()
          .toast(`已把 ${ids.length} 本书移入回收站`, 'success', '在侧栏「回收站」里可以还原或彻底删除')
      }
    } catch (error) {
      useUi.getState().toast('删除失败', 'error', (error as Error).message)
    }
  },

  /** 回收站 → 还原：文件挪回藏书目录，重新出现在书架上 */
  restoreBooks: async (ids) => {
    try {
      const index = await libraryApi.restoreBooks(ids)
      set({ index, selectedIds: [] })
      if (ids.length > 0) useUi.getState().toast(`已还原 ${ids.length} 本书`, 'success')
    } catch (error) {
      useUi.getState().toast('还原失败', 'error', (error as Error).message)
    }
  },

  /** 回收站 → 彻底删除：文件与记录一起清掉，不可恢复 */
  purgeBooks: async (ids) => {
    try {
      const index = await libraryApi.purgeBooks(ids)
      set({ index, selectedIds: [] })
      if (ids.includes(get().openBookId ?? '')) set({ openBookId: null })
      if (ids.length > 0) useUi.getState().toast(`已彻底删除 ${ids.length} 本书`, 'success')
    } catch (error) {
      useUi.getState().toast('删除失败', 'error', (error as Error).message)
    }
  },

  select: (id) => set({ openBookId: id }),
  setQuery: (query) => set({ query }),
  setActiveShelf: (activeShelfId) => set({ activeShelfId }),
  setViewMode: (viewMode) => set({ viewMode }),

  toggleSelected: (id) => {
    const { selectedIds } = get()
    set({
      selectedIds: selectedIds.includes(id) ? selectedIds.filter((x) => x !== id) : [...selectedIds, id]
    })
  },

  clearSelection: () => set({ selectedIds: [] }),

  addShelf: async (name) => {
    const index = get().index
    if (!index) return
    const shelf: Shelf = {
      id: `shelf_${Date.now().toString(36)}`,
      name,
      themeId: null,
      color: null,
      order: index.shelves.length
    }
    const next = await libraryApi.saveShelves([...index.shelves, shelf])
    set({ index: next, activeShelfId: shelf.id })
  },

  renameShelf: async (id, name) => {
    const index = get().index
    if (!index) return
    const next = await libraryApi.saveShelves(index.shelves.map((s) => (s.id === id ? { ...s, name } : s)))
    set({ index: next })
  },

  setShelfColor: async (id, color) => {
    const index = get().index
    if (!index) return
    try {
      const next = await libraryApi.saveShelves(index.shelves.map((s) => (s.id === id ? { ...s, color } : s)))
      set({ index: next })
    } catch (error) {
      useUi.getState().toast('保存书架层主题色失败', 'error', (error as Error).message)
    }
  },

  removeShelf: async (id) => {
    const index = get().index
    if (!index) return
    if (index.shelves.length <= 1) {
      useUi.getState().toast('至少要保留一层书架', 'warn')
      return
    }
    // 先给这一层的书找好下家（「我的书架」，没有就剩下的第一层），
    // 再删层：书只是换了归属，磁盘上的文件一律不动。
    const target = shelfFallbackFor(index.shelves, id)
    const movedIds = index.books.filter((b) => b.shelfId === id).map((b) => b.id)
    if (target && movedIds.length > 0) await get().assignShelf(movedIds, target.id)
    const next = await libraryApi.saveShelves(index.shelves.filter((s) => s.id !== id))
    set({ index: next, activeShelfId: 'all' })
  },

  assignShelf: async (ids, shelfId) => {
    const index = get().index
    if (!index) return
    const updated = index.books.map((b) => (ids.includes(b.id) ? { ...b, shelfId } : b))
    set({ index: { ...index, books: updated } })
    await Promise.all(ids.map((id) => libraryApi.updateBook(id, { shelfId })))
  },

  addBookend: async (shelfId, anchorBookId, side) => {
    const next = await libraryApi.addBookend(shelfId, anchorBookId, side)
    set({ index: next })
  },

  updateBookend: async (id, patch) => {
    const next = await libraryApi.updateBookend(id, patch)
    set({ index: next })
  },

  removeBookend: async (id) => {
    const next = await libraryApi.removeBookend(id)
    set({ index: next })
  },

  moveBookend: async (id, direction) => {
    const next = await libraryApi.moveBookend(id, direction)
    set({ index: next })
  },

  removeMissing: async () => {
    const { index: next, removed } = await libraryApi.removeMissing()
    set({ index: next, selectedIds: [] })
    return removed.length
  },

  bookById: (id) => (id ? get().index?.books.find((b) => b.id === id) : undefined)
}))

/**
 * 删掉一层书架时，这一层的书归到哪一层：
 * 优先「我的书架」，没有就叫剩下的第一层。
 * 侧栏与设置里的删除弹窗都用它算目标层，保证提示文字和真正落盘的结果一致。
 */
export function shelfFallbackFor(shelves: Shelf[], removingId: string): Shelf | undefined {
  const remaining = shelves.filter((s) => s.id !== removingId)
  return remaining.find((s) => s.name === '我的书架') ?? remaining[0]
}

function reportImport(added: number, skipped: { path: string; reason: string }[]): void {
  const toast = useUi.getState().toast
  if (added > 0) toast(`已上架 ${added} 本书`, 'success')
  if (skipped.length > 0) {
    toast(
      `${skipped.length} 个文件被跳过`,
      'warn',
      skipped
        .slice(0, 3)
        .map((s) => `${s.path.split(/[\\/]/).pop()}：${s.reason}`)
        .join('；')
    )
  }
  if (added === 0 && skipped.length === 0) toast('没有可导入的文件', 'info')
}
