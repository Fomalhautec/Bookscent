import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Book, Bookend, BookFormat, BookStyle, Shelf, UiSettings } from '@shared/types'
import { useLibrary } from '@/store/useLibrary'
import { useSettings } from '@/store/useSettings'
import { useUi } from '@/store/useUi'
import {
  bookFootprint,
  pickStyleForBook,
  bookHeightFor,
  spineWidthFor,
  tiltFor,
  tiltSpill
} from '@/lib/theme'
import { IconBookshelf, IconImport, IconPlus, IconSearch } from '@/components/icons/Icons'
import { Button, EmptyState } from '@/components/common/Controls'
import { ConfirmModal } from '@/components/common/ConfirmModal'
import { enabledSpineStyles } from '@/lib/theme'
/* 书立按朝向生效的判定（与书脊尺寸同一处小工具） */
import { bookendBreaksLine, bookendFitsFacing } from './spineStyle'
import { libraryApi } from '@/lib/api'
import { BookSpine } from './BookSpine'
import { BookListItem } from './BookListItem'
import { CoverPeek } from './CoverPeek'
import { FULL_REVEAL_MS, SIMPLE_REVEAL_MS } from './OpeningAnimation'
import { ShelfBatchBar, ShelfToolbar, BASE_STYLE_PICK, type BatchStyleOption } from './ShelfToolbar'
import {
  SORT_LABEL,
  activeFilterCount,
  filterBooks,
  moveWithinOrder,
  sortBooks,
  type ShelfFilter
} from './shelfOrder'

const ROW_PADDING = 30
const BOOK_GAP = 3
const PLANK_HEIGHT = 25
/**
 * 上一次量到的书架可用宽度（模块级，活过组件卸载）。
 * 见组件里 `available` 的注释：没有它，从书里退出来就会看到一次书架重排。
 */
let lastAvailable = 0
/** 书立本体（那根立柱）的宽度，空位宽度记在 bookend.gap 里 */
const BOOKEND_POST = 6

/** 架子上的一件东西：一本书，或者一个书立 */
interface ShelfItem {
  key: string
  order: number
  book?: Book
  bookend?: Bookend
  width: number
  /** 书立可以要求从这里另起一行 */
  breakLine?: boolean
}

interface PackedRow {
  items: ShelfItem[]
}

/**
 * 装箱：一行能放多少看**宽度**，不看本数。
 *
 * 以前还有个"每层最多几本"的上限，厚书薄书一视同仁地数本数，
 * 结果一行常常填不满就得换行 —— 一排实书不是这么站的。
 * 现在只按宽度塞满；想手动断开就在那里放一个"另起一行"的书立。
 */
function packRows(items: ShelfItem[], budget: number): PackedRow[] {
  const rows: PackedRow[] = []
  let current: ShelfItem[] = []
  let used = 0

  const flush = (): void => {
    if (current.length) rows.push({ items: current })
    current = []
    used = 0
  }

  for (const item of items) {
    if (item.breakLine && current.length > 0) flush()
    const next = used + item.width + (current.length ? BOOK_GAP : 0)
    if (current.length > 0 && next > budget) flush()
    current.push(item)
    used += item.width + (current.length > 1 ? BOOK_GAP : 0)
  }
  flush()
  return rows
}

const FALLBACK_UI = {
  shelfRowHeight: 250,
  shelfRowHeightCover: 250,
  booksPerShelf: 14,
  showPlaque: true,
  showShadow: true,
  animate: true,
  shelfTilt: 0.35,
  bookHeightVariation: 0.09,
  bookFacing: 'spine',
  heightMode: 'slight',
  shelfLayout: 'grouped',
  shelfBayMaxWidth: 560,
  shelfSort: 'manual',
  shelfSortDesc: false,
  showReadingProgress: true
} as UiSettings

interface DragState {
  bookId: string
  /** 这本书现在在哪一层，用来判断是否拖到了别的层 */
  shelfId: string
  startX: number
  startY: number
  active: boolean
}

interface DropTarget {
  bookId: string
  side: 'before' | 'after'
}

/** 多选模式下「单击选中、双击打开」的待决点击 */
interface PendingClick {
  bookId: string
  timer: number
}

/**
 * 封面朝外时压在封面上的圆形进度。
 *
 * 只用 CSS 画：`conic-gradient` 画圆环，内层再垫一个实心圆当遮罩 + 垫底，
 * 免得环下面的封面花纹透出来跟进度混在一起；环心顺手写上百分比。
 * 外圈那层半透明底是给深色/浅色封面都留的"底环"。
 */
function ProgressRing({ percent }: { percent: number }): ReactNode {
  const value = Math.round(percent)
  return (
    <span
      className="progress-ring"
      style={{ ['--progress-pct' as string]: `${value}%` }}
      title={`已读 ${value}%`}
      aria-label={`已读 ${value}%`}
    >
      <span className="progress-ring-label">{value}</span>
    </span>
  )
}

export function BookshelfView(): ReactNode {
  const index = useLibrary((s) => s.index)
  const query = useLibrary((s) => s.query)
  const activeShelfId = useLibrary((s) => s.activeShelfId)
  const viewMode = useLibrary((s) => s.viewMode)
  const select = useLibrary((s) => s.select)
  const importFiles = useLibrary((s) => s.importFiles)
  const createNote = useLibrary((s) => s.createNote)
  const reorder = useLibrary((s) => s.reorder)
  const updateBook = useLibrary((s) => s.updateBook)
  const removeBooks = useLibrary((s) => s.removeBooks)
  const assignShelf = useLibrary((s) => s.assignShelf)

  const settings = useSettings((s) => s.settings)
  const patch = useSettings((s) => s.patch)
  const openDetail = useUi((s) => s.openDetail)
  const openContextMenu = useUi((s) => s.openContextMenu)
  const toast = useUi((s) => s.toast)
  const removeMissing = useLibrary((s) => s.removeMissing)
  const multiSelect = useUi((s) => s.multiSelect)
  const setMultiSelect = useUi((s) => s.setMultiSelect)

  const scrollRef = useRef<HTMLDivElement>(null)
  /*
   * 书架可用宽度。
   *
   * 初值不能写死一个 960 那样的数：从书里退出来时这一层会重新挂载，
   * 用默认值先排一遍、量到真宽度再排一遍 —— 屏幕上就是"先几本一行、
   * 再跳成填满整行"的那次重排。
   * 所以把上一次量到的宽度存在模块级：重新挂载时直接拿它开排，
   * 再用 useLayoutEffect 在绘制前把真实宽度校准一次，整个过程没有可见的重排。
   */
  const [available, setAvailable] = useState(lastAvailable)
  const [peek, setPeek] = useState<{ book: Book; rect: DOMRect } | null>(null)
  const peekTimer = useRef<number | null>(null)

  /*
   * 书架上的多选。
   *
   * 选中项只记 id（不记顺序），并且**只认当前可见的书**：
   * 筛掉、搜掉或删掉的书会从选中列表里自动剔除，
   * 这样"移动/删除"永远不会误伤看不见的书。
   */
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  /** Shift 区间选择的锚点 */
  const anchorId = useRef<string | null>(null)
  /** 多选模式下等待判定的那一次单击（等一小会儿看是不是双击） */
  const pendingClick = useRef<PendingClick | null>(null)

  const [drag, setDrag] = useState<DragState | null>(null)
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null)
  /** 拖到了另一层书架上面 */
  const [dropShelf, setDropShelf] = useState<string | null>(null)
  const [pendingOrder, setPendingOrder] = useState<string[] | null>(null)
  const suppressClick = useRef(false)
  /** 延迟挂载阅读界面的定时器 */
  const openTimer = useRef<number | null>(null)

  useEffect(
    () => () => {
      if (openTimer.current !== null) window.clearTimeout(openTimer.current)
      if (pendingClick.current !== null) window.clearTimeout(pendingClick.current.timer)
    },
    []
  )

  const clearPeek = useCallback((): void => {
    if (peekTimer.current !== null) {
      window.clearTimeout(peekTimer.current)
      peekTimer.current = null
    }
    setPeek(null)
  }, [])

  const handleHover = useCallback((book: Book, rect: DOMRect): void => {
    if (peekTimer.current !== null) window.clearTimeout(peekTimer.current)
    // 稍微延迟，避免鼠标扫过整排书架时封面疯狂闪现
    peekTimer.current = window.setTimeout(() => setPeek({ book, rect }), 160)
  }, [])

  useEffect(() => () => clearPeek(), [clearPeek])

  useEffect(() => {
    const node = scrollRef.current
    if (!node) return
    node.addEventListener('scroll', clearPeek, { passive: true })
    return () => node.removeEventListener('scroll', clearPeek)
  }, [clearPeek])

  /*
   * 绘制前把真实宽度量出来。
   *
   * 依赖里必须带上 `index`：冷启动时这一层第一次渲染时还没有书库数据，
   * 组件会先 return null —— 那时 scrollRef.current 是空的，量不到东西。
   * 只挂 [] 的话这一次量空之后再也不量，available 一直停在 0，
   * 装箱预算 `Math.max(240, 0 - 60)` 兜成 240px，于是"每行只排两三本"，
   * 要等 ResizeObserver 异步回一次才跳成正常 —— 就是你看到的那一幕。
   *
   * 也不能每次渲染都量并 setState：宽度在两个值之间来回（滚动条出现/消失）
   * 会变成"量到 → 重排 → 又量到"的死循环。所以只在宽度真的变了时才写。
   */
  useLayoutEffect(() => {
    const node = scrollRef.current
    if (!node) return
    let width = node.clientWidth
    if (width <= 0) {
      // 首帧父容器还没定尺寸。宁可先用窗口估一个，也别让 0 进到装箱预算里。
      const sidebar = document.querySelector('.sidebar')?.getBoundingClientRect().width ?? 0
      width = Math.max(320, window.innerWidth - sidebar)
    }
    if (width > 0 && width !== lastAvailable) {
      lastAvailable = width
      setAvailable(width)
    }
  }, [index])

  useEffect(() => {
    const node = scrollRef.current
    if (!node) return
    /*
     * 只有宽度**真的**变了才 setState。
     *
     * 这条判断是防死循环的命门：书架超出屏幕时会出现竖向滚动条，
     * 滚动条一出现可用宽度就少十几像素、一少就可能换行、换行又改变高度、
     * 高度一变滚动条又可能消失…… 若每次回调都无条件 setState，
     * 这个过程会自激，渲染进程被 ResizeObserver 回调占满 ——
     * 表现为整个界面卡死、CDP 求值超时（0.9.0 加阅读进度时就是这么炸的）。
     * 留 1px 容差，免得亚像素抖动也来凑热闹。
     */
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? 0
      if (width > 0 && Math.abs(width - lastAvailable) > 1) {
        lastAvailable = width
        setAvailable(width)
      }
    })
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  /*
   * 阅读进度（书 id → 0..100）。
   *
   * 一趟把整份 map 拿回来，绝不在每本书上单独发一次 IPC ——
   * 一层书架几十本，逐本请求就是几十次跨进程往返。
   * 依赖 `index`：关掉一本书、翻过几页之后书库索引会刷新，
   * 顺手重取一次，书架上的进度就是刚读到的那个数。
   */
  const [progressByBook, setProgressByBook] = useState<Record<string, number>>({})

  useEffect(() => {
    let cancelled = false
    void libraryApi
      .progressMap()
      .then((map) => {
        if (!cancelled) setProgressByBook(map)
      })
      .catch(() => {
        // 进度只是装饰，取不到就当没有，不要打断书架
      })
    return () => {
      cancelled = true
    }
  }, [index])

  const ui: UiSettings = settings?.ui ?? FALLBACK_UI
  const facing = ui.bookFacing ?? 'spine'
  /* 单层高度按朝向分开：书脊那份可以调得更高，好把书名看清 */
  const rowHeight = (facing === 'cover' ? ui.shelfRowHeightCover : ui.shelfRowHeight) || 250
  const layout = ui.shelfLayout ?? 'grouped'
  const sortMode = ui.shelfSort ?? 'manual'

  /* ------------------------------------------------------- 阅读进度 */

  const showProgress = ui.showReadingProgress !== false

  /**
   * 一本书要画的进度；不画时返回 0。
   *
   * 三种情况都当 0 处理（子组件拿到 0 就什么都不渲染，不会留一个空环）：
   * 用户关掉了这个开关、`kind === 'note'`（笔记没有"读到几成"这回事）、
   * 进度确实是 0（0% 画出来反而像"进度坏了"）。
   */
  const progressOf = (book: Book): number => {
    if (!showProgress || book.kind !== 'book') return 0
    const percent = progressByBook[book.id]
    if (typeof percent !== 'number' || !Number.isFinite(percent) || percent <= 0) return 0
    return Math.max(0, Math.min(100, percent))
  }

  /* ------------------------------------------------------------ 筛选 */

  const filter: ShelfFilter = useMemo(
    () => ({
      query,
      formats: (ui.filterFormats ?? []) as BookFormat[],
      status: ui.filterStatus ?? [],
      tags: ui.filterTags ?? [],
      minRating: ui.filterMinRating ?? 0
    }),
    [query, ui.filterFormats, ui.filterStatus, ui.filterTags, ui.filterMinRating]
  )

  const patchFilter = (next: Partial<ShelfFilter>): void => {
    void patch({
      ui: {
        ...(next.formats !== undefined ? { filterFormats: next.formats } : null),
        ...(next.status !== undefined ? { filterStatus: next.status } : null),
        ...(next.tags !== undefined ? { filterTags: next.tags } : null),
        ...(next.minRating !== undefined ? { filterMinRating: next.minRating } : null)
      }
    })
  }

  const clearFilter = (): void => {
    useLibrary.getState().setQuery('')
    void patch({ ui: { filterFormats: [], filterStatus: [], filterTags: [], filterMinRating: 0 } })
  }

  /* ------------------------------------------------ 排序 + 逐本样式 */

  /*
   * 书架上用的书列表。
   *
   * 临时打开的书**不上书架**：它们只活在阅读器里（索引里带 temporary 标记），
   * 用户在阅读界面点「添加到书架」之后才会留在这里。
   * 之前漏了这一步，临时看一眼的文件会直接出现在书架上 —— 用户报的 bug。
   */
  const allBooks = useMemo(
    () => (index?.books ?? []).filter((book) => !book.temporary && !book.trashed),
    [index]
  )

  const allSorted = useMemo(
    () => sortBooks(allBooks, sortMode, ui.shelfSortDesc ?? false),
    [allBooks, sortMode, ui.shelfSortDesc]
  )

  const visible = useMemo(() => filterBooks(allSorted, filter), [allSorted, filter])

  const styleMap = useMemo(() => {
    const map = new Map<string, BookStyle>()
    const base = settings
    if (!base) return map
    visible.forEach((book, i) => map.set(book.id, pickStyleForBook(book, base, i)))
    return map
  }, [visible, settings])

  const styleOf = (book: Book): BookStyle =>
    styleMap.get(book.id) ?? settings?.bookStyle ?? ({} as BookStyle)

  const availableFormats = useMemo(() => {
    const set = new Set<BookFormat>()
    for (const book of allBooks) set.add(book.format)
    return [...set]
  }, [allBooks])

  const availableForBooks = available > 0 ? Math.max(240, available - ROW_PADDING * 2) : 0
  const bookAreaHeight = Math.max(90, rowHeight - PLANK_HEIGHT - 14)

  /**
   * 一本书的占位宽度：书脊厚度 → 按朝向投影（封面朝外时还要留出书与书的间距）。
   *
   * 贴了书脊图的书，宽度要用**这本书自己的高度**去算 ——
   * 用整层的最大高度算的话，矮一点的书宽度就偏大，图会被裁掉一条。
   */
  const footprintOf = (book: Book): number => {
    const style = styleOf(book)
    // 封面与书脊各用各的高度规则（封面模式下错落会整体缩放封面，所以单独一档）
    const ownHeight = bookHeightFor(book, bookAreaHeight, ui, facing)
    const width = spineWidthFor(book.pageCount || 1, style, ownHeight)
    // 倾斜会让书的实际横向占位变宽，装箱时要一并算上，否则会顶出边框
    const spill = tiltSpill(width, ownHeight, tiltFor(book, ui, style))
    return (
      bookFootprint(width, ownHeight, facing, facing === 'spine' ? 0 : (ui.coverBookGap ?? 14)) +
      spill
    )
  }

  const shelves: Shelf[] = useMemo(() => {
    const list = index?.shelves ?? []
    return activeShelfId === 'all' ? list : list.filter((s) => s.id === activeShelfId)
  }, [index?.shelves, activeShelfId])

  /**
   * 按书架层分组。
   * `budget` 是这一组能用的横向宽度：分层模式用整窗，连续模式下每个"格"有上限。
   */
  const buildGroup = useCallback(
    (shelf: Shelf, budget: number) => {
      const books = visible.filter((b) => b.shelfId === shelf.id)
      const heightsMap = new Map(books.map((b) => [b.id, bookHeightFor(b, bookAreaHeight, ui, facing)]))
      const widthsMap = new Map(books.map((b) => [b.id, footprintOf(b)]))

      /*
       * 书与书立排在同一条"顺序尺"上 —— 书立的位置是插在书与书之间的一个数，
       * 所以这里合起来排序，再一起装箱。
       */
      const items: ShelfItem[] = [
        ...books.map((book) => ({
          key: book.id,
          order: book.order ?? 0,
          book,
          width: widthsMap.get(book.id) ?? 40
        })),
        ...(index?.bookends ?? [])
          /*
           * 书立按朝向过滤：书脊模式与封面模式下书的宽度差很多，
           * 同一个换行位置往往只对其中一种模式合适，所以书立可以声明只在哪一种下生效。
           */
          .filter((entry) => entry.shelfId === shelf.id && bookendFitsFacing(entry, facing))
          .map((entry) => ({
            key: entry.id,
            order: entry.order,
            bookend: entry,
            // 挡板 + 它外侧的空位；左书立的挡板贴右边，宽度构成一样
            width: BOOKEND_POST + Math.max(0, entry.gap),
            /* 换行也按朝向取：书脊与封面模式可以各自不同 */
            breakLine: bookendBreaksLine(entry, facing)
          }))
      ].sort((a, b) => a.order - b.order)

      const rows = packRows(items, budget)
      return {
        shelf,
        books,
        widthsMap,
        heightsMap,
        // 空的书架层也要摆一层出来：既能看出"这层是空的"，
        // 也才有地方把书拖进去
        rows: rows.length > 0 ? rows : [{ items: [] }]
      }
    },
    // footprintOf 依赖这些输入
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [visible, bookAreaHeight, ui.booksPerShelf, ui, facing, styleMap, available, index?.bookends]
  )

  const groups = useMemo(
    () => shelves.map((shelf) => buildGroup(shelf, availableForBooks)),
    [shelves, buildGroup, availableForBooks]
  )

  const bayBudget = Math.max(240, (ui.shelfBayMaxWidth ?? 560) - ROW_PADDING * 2)
  const bays = useMemo(
    () => (layout === 'continuous' ? shelves.map((shelf) => buildGroup(shelf, bayBudget)) : []),
    [layout, shelves, buildGroup, bayBudget]
  )

  const totalVisible = visible.length

  /* -------------------------------------------------------------- 多选 */

  const visibleIdSet = useMemo(() => new Set(visible.map((book) => book.id)), [visible])

  /**
   * 过滤后的选中项。
   * 每次渲染都按可见集合算一遍，所以就算剔除 effect 还没跑，
   * 批量操作也绝不会落到当前看不见的书上。
   */
  const effectiveSelected = useMemo(
    () => selectedIds.filter((id) => visibleIdSet.has(id)),
    [selectedIds, visibleIdSet]
  )

  const selectedSet = useMemo(() => new Set(effectiveSelected), [effectiveSelected])

  const selectedBooks = useMemo(
    () => allBooks.filter((book) => selectedSet.has(book.id)),
    [allBooks, selectedSet]
  )

  /* 被筛掉/删掉的书自动退出选中，并报一声，免得用户以为还选着 */
  useEffect(() => {
    const dropped = selectedIds.filter((id) => !visibleIdSet.has(id)).length
    if (dropped === 0) return
    setSelectedIds((current) => current.filter((id) => visibleIdSet.has(id)))
    const gone = selectedIds.filter((id) => !allBooks.some((book) => book.id === id)).length
    toast(gone > 0 ? '已删除的书已从选择里去掉' : `${dropped} 本被筛掉的书已从选择里去掉`, 'info')
  }, [selectedIds, visibleIdSet, allBooks, toast])

  const clearPick = (): void => {
    setSelectedIds([])
    anchorId.current = null
  }

  const togglePick = (id: string): void => {
    setSelectedIds((current) => (current.includes(id) ? current.filter((x) => x !== id) : [...current, id]))
  }

  /** 点击时的选中决策；返回 true 表示这次点击被多选吃掉了，不要再打开书 */
  const applySelectClick = (id: string, event: React.MouseEvent): boolean => {
    if (event.shiftKey) {
      const from = anchorId.current ? visible.findIndex((book) => book.id === anchorId.current) : -1
      const to = visible.findIndex((book) => book.id === id)
      if (from >= 0 && to >= 0) {
        const [start, end] = from <= to ? [from, to] : [to, from]
        const range = visible.slice(start, end + 1).map((book) => book.id)
        setSelectedIds(range)
        return true
      }
      anchorId.current = id
      togglePick(id)
      return true
    }

    if (event.ctrlKey || event.metaKey) {
      anchorId.current = id
      togglePick(id)
      return true
    }

    if (!multiSelect) return false

    // 多选模式：单击 = 选中/取消。先等一小会儿，如果是双击就改去打开书。
    // 这个窗口要比双击间隔短，否则慢一点的双击会先选中再打开。
    if (event.detail >= 2) return true
    const pending = pendingClick.current
    if (pending) window.clearTimeout(pending.timer)
    const timer = window.setTimeout(() => {
      const current = pendingClick.current
      if (!current) return
      pendingClick.current = null
      togglePick(current.bookId)
    }, 180)
    pendingClick.current = { bookId: id, timer }
    return true
  }

  /** 双击打开时，把"这次单击其实是双击"记下来（由 BookSpine 的 onDoubleClick 触发） */
  const noteDoubleClick = (id: string): void => {
    if (!multiSelect) return
    const pending = pendingClick.current
    if (pending?.bookId !== id) return
    window.clearTimeout(pending.timer)
    pendingClick.current = { bookId: id, timer: -1 }
  }

  /* Escape 清除选择：输入框里按 Esc（取消输入）和弹窗里按 Esc（关弹窗）都不算 */
  useEffect(() => {
    if (effectiveSelected.length === 0) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      const target = event.target as HTMLElement | null
      const tag = target?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable) return
      if (document.querySelector('.modal-backdrop')) return
      clearPick()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [effectiveSelected.length])

  /** 批量改书：一本一本走 updateBook，避免并发写盘互相覆盖 */
  const batchUpdate = useCallback(
    async (books: Book[], makePatch: (book: Book) => Partial<Book>): Promise<boolean> => {
      let ok = true
      for (const book of books) {
        const updated = await updateBook(book.id, makePatch(book))
        if (!updated) ok = false
      }
      return ok
    },
    [updateBook]
  )

  const handleDeleteSelected = useCallback(
    async (deleteFiles: boolean): Promise<void> => {
      const ids = effectiveSelected
      if (ids.length === 0) return
      await removeBooks(ids, deleteFiles)
      setSelectedIds([])
      anchorId.current = null
      toast(deleteFiles ? `已删除 ${ids.length} 本书及其文件` : `已从书架移除 ${ids.length} 本书`, 'success')
    },
    [effectiveSelected, removeBooks, toast]
  )

  const handleMoveSelected = useCallback(
    async (shelfId: string): Promise<void> => {
      const ids = effectiveSelected
      if (ids.length === 0) return
      await assignShelf(ids, shelfId)
      const name = index?.shelves.find((shelf) => shelf.id === shelfId)?.name ?? '目标书架层'
      toast(`已把 ${ids.length} 本书移到「${name}」`, 'success')
    },
    [effectiveSelected, assignShelf, index?.shelves, toast]
  )

  const handleAddTags = useCallback(
    async (raw: string): Promise<void> => {
      const books = selectedBooks
      const tags = [...new Set(raw.split(/[\s,，、;；]+/).map((tag) => tag.trim()).filter(Boolean))]
      if (books.length === 0 || tags.length === 0) return
      const ok = await batchUpdate(books, (book) => ({ tags: [...new Set([...(book.tags ?? []), ...tags])] }))
      if (ok) toast(`已给 ${books.length} 本书加上「${tags.join('、')}」`, 'success')
    },
    [selectedBooks, batchUpdate, toast]
  )

  const handleRemoveTag = useCallback(
    async (tag: string): Promise<void> => {
      const books = selectedBooks
      if (books.length === 0 || !tag) return
      const ok = await batchUpdate(books, (book) => ({ tags: (book.tags ?? []).filter((item) => item !== tag) }))
      if (ok) toast(`已从 ${books.length} 本书移除「${tag}」`, 'success')
    },
    [selectedBooks, batchUpdate, toast]
  )

  /**
   * 套用书脊样式。
   *
   * 和 BookDetailDrawer 里的写法保持一致：`style` 是 Partial<BookStyle>，
   * 挑一套命名样式就是整份覆盖，选「跟随基准样式」就清成 {} 让它重新继承。
   */
  const handleApplyStyle = useCallback(
    async (styleId: string): Promise<void> => {
      const books = selectedBooks
      if (books.length === 0) return
      if (styleId === BASE_STYLE_PICK) {
        const ok = await batchUpdate(books, () => ({ style: {} }))
        if (ok) toast(`已让 ${books.length} 本书跟随基准样式`, 'success')
        return
      }
      const entry = (settings?.spineStyles ?? []).find((item) => item.id === styleId)
      if (!entry) return
      const next: Partial<BookStyle> = { ...entry.style }
      const ok = await batchUpdate(books, () => ({ style: next }))
      if (ok) toast(`已给 ${books.length} 本书套用「${entry.name}」`, 'success')
    },
    [selectedBooks, settings?.spineStyles, batchUpdate, toast]
  )

  /** 批量设系列（空字符串 = 清空）。同一系列的书会共用书脊高度。 */
  const handleSetSeries = useCallback(
    async (series: string): Promise<void> => {
      const books = selectedBooks
      if (books.length === 0) return
      const ok = await batchUpdate(books, () => ({ series }))
      if (ok) {
        toast(
          series ? `已把 ${books.length} 本书设为系列「${series}」` : `已清空 ${books.length} 本书的系列`,
          'success'
        )
      }
    },
    [selectedBooks, batchUpdate, toast]
  )

  /** 批量设作者（空字符串 = 清空） */
  const handleSetAuthor = useCallback(
    async (author: string): Promise<void> => {
      const books = selectedBooks
      if (books.length === 0) return
      const ok = await batchUpdate(books, () => ({ author }))
      if (ok) {
        toast(
          author ? `已把 ${books.length} 本书的作者设为「${author}」` : `已清空 ${books.length} 本书的作者`,
          'success'
        )
      }
    },
    [selectedBooks, batchUpdate, toast]
  )
  const handleRate = useCallback(
    async (rating: number): Promise<void> => {
      const books = selectedBooks
      if (books.length === 0) return
      const ok = await batchUpdate(books, () => ({ rating }))
      if (ok) toast(rating > 0 ? `已把 ${books.length} 本书评为 ${rating} 星` : `已清除 ${books.length} 本书的评分`, 'success')
    },
    [selectedBooks, batchUpdate, toast]
  )

  const handleSetStatus = useCallback(
    async (status: Book['status']): Promise<void> => {
      const books = selectedBooks
      if (books.length === 0) return
      const ok = await batchUpdate(books, () => ({ status }))
      if (ok) toast(`已更新 ${books.length} 本书的状态`, 'success')
    },
    [selectedBooks, batchUpdate, toast]
  )

  const selectAllVisible = useCallback((): void => {
    const ids = visible.map((book) => book.id)
    setSelectedIds(ids)
    anchorId.current = ids[ids.length - 1] ?? null
  }, [visible])

  const batchShelves = useMemo(
    () => (index?.shelves ?? []).map((shelf) => ({ id: shelf.id, name: shelf.name })),
    [index?.shelves]
  )

  /** 选中书共同拥有的标签（只有共同的才能"一起移除"） */
  const commonSelectedTags = useMemo((): string[] => {
    if (selectedBooks.length === 0) return []
    const [first, ...rest] = selectedBooks
    const pools = rest.map((book) => new Set(book.tags ?? []))
    return (first.tags ?? []).filter((tag) => pools.every((pool) => pool.has(tag)))
  }, [selectedBooks])

  const batchStyles = useMemo((): BatchStyleOption[] => {
    if (!settings) return []
    return enabledSpineStyles(settings).map((entry) => ({
      id: entry.id,
      name: entry.name,
      enabled: entry.enabled,
      color: entry.style.spineColor
    }))
  }, [settings])

  /* -------------------------------------------------------------- 拖动 */

  const orderIds = useMemo(() => allSorted.map((b) => b.id), [allSorted])

  /* 文件已经找不到的书：工具栏上给一个一键清理入口 */  const missingBooks = useMemo(
    () => (index?.books ?? []).filter((book) => book.missing),
    [index?.books]
  )
  const handleRemoveMissing = useCallback(async (): Promise<void> => {
    if (missingBooks.length === 0) return
    const count = await removeMissing()
    if (count > 0) toast(`已从书架移除 ${count} 本失效书籍`, 'success', '文件没有被删除')
  }, [missingBooks.length, removeMissing, toast])

  const commitDrop = useCallback(
    async (target: DropTarget | null, shelfTarget: string | null): Promise<void> => {
      if (!drag) return

      // 1) 拖到别的书架层上 —— 这比排序优先
      if (shelfTarget && shelfTarget !== drag.shelfId) {
        const name = index?.shelves.find((s) => s.id === shelfTarget)?.name ?? '另一层'
        // 拖的是选中项之一时，整批一起搬过去（和右键菜单的"移动到"同一套语义）
        const moving = selectedSet.has(drag.bookId) ? effectiveSelected : [drag.bookId]
        if (moving.length > 1) {
          await assignShelf(moving, shelfTarget)
          setSelectedIds([])
          anchorId.current = null
          toast(`已把 ${moving.length} 本书移到「${name}」`, 'success')
        } else {
          await updateBook(drag.bookId, { shelfId: shelfTarget })
          toast(`已移到「${name}」`, 'success')
        }
        return
      }

      // 2) 同一层内：调整顺序
      if (!target) return
      /*
       * 筛选/搜索状态下不接排序拖动。
       *
       * orderIds 走的是"当前看得见的那批书"，而顺序要写回整层。
       * 有书被藏起来时，前后关系本来就无从判断，
       * 硬排出来的结果在清除筛选后看着就是乱的 —— 这正是"拖动排序看不懂"的来源。
       */
      if (query.trim() || activeFilterCount(filter) > 0) {
        toast('筛选状态下不好判断前后关系', 'error', '先清除筛选或搜索，再拖动排序')
        return
      }
      const nextIds = moveWithinOrder(orderIds, drag.bookId, target.bookId, target.side)
      if (nextIds.join('|') === orderIds.join('|')) return

      if (sortMode === 'manual') {
        await reorder(nextIds)
        return
      }

      // 非默认排序下拖动：先问一句，再把这个顺序固化成新的默认顺序
      setPendingOrder(nextIds)
    },
    [drag, orderIds, sortMode, reorder, updateBook, assignShelf, selectedSet, effectiveSelected, toast, index?.shelves]
  )

  const confirmPendingOrder = useCallback(async (): Promise<void> => {
    const nextIds = pendingOrder
    setPendingOrder(null)
    if (!nextIds) return
    await reorder(nextIds)
    await patch({ ui: { shelfSort: 'manual', shelfSortDesc: false } })
    toast('已按当前顺序固化默认排列', 'success')
  }, [pendingOrder, reorder, patch, toast])

  useEffect(() => {
    if (!drag) return

    const onMove = (event: PointerEvent): void => {
      if (!drag.active) {
        const far = Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) > 6
        if (!far) return
        setDrag((current) => (current ? { ...current, active: true } : current))
        return
      }
      const element = document.elementFromPoint(event.clientX, event.clientY)

      // 落在别的书架层上 → 高亮那一层，表示"松手就搬到这儿"
      const shelfId = element?.closest<HTMLElement>('.shelf-unit')?.dataset.shelfId ?? null
      if (shelfId && drag.shelfId && shelfId !== drag.shelfId) {
        setDropShelf(shelfId)
        setDropTarget(null)
        return
      }
      setDropShelf(null)

      const node = element?.closest<HTMLElement>('.book')
      const id = node?.dataset.bookId
      if (!node || !id || id === drag.bookId) {
        setDropTarget(null)
        return
      }
      const rect = node.getBoundingClientRect()
      setDropTarget({ bookId: id, side: event.clientX < rect.left + rect.width / 2 ? 'before' : 'after' })
    }

    const onUp = (): void => {
      const active = drag.active
      const target = dropTarget
      const shelfTarget = dropShelf
      suppressClick.current = active
      setDrag(null)
      setDropTarget(null)
      setDropShelf(null)
      if (active) void commitDrop(target, shelfTarget)
      // 拖动过的这次 click 要丢掉
      if (active) window.setTimeout(() => (suppressClick.current = false), 0)
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
  }, [drag, dropTarget, dropShelf, commitDrop])

  const handleDragStart = (book: Book, event: React.PointerEvent): void => {
    if (event.button !== 0) return
    clearPeek()
    setDrag({
      bookId: book.id,
      shelfId: book.shelfId,
      startX: event.clientX,
      startY: event.clientY,
      active: false
    })
  }

  const handleOpen = (book: Book): void => {
    if (suppressClick.current) return
    clearPeek()
    // 多选模式下的单击已经在捕获阶段被"选中"吃掉了；能走到这里的都是真·打开
    const mode = settings?.ui.openAnimation ?? 'full'
    const node = scrollRef.current?.querySelector<HTMLElement>(`.book[data-book-id="${book.id}"]`)

    if (!node || mode === 'off') {
      clearPick()
      select(book.id)
      return
    }

    /*
     * 先播动画，等幕布压成不透明之后再把阅读界面挂上去。
     * 否则阅读界面从第一帧就渲染在透明的幕布后面 ——
     * 看起来就是"动画还没开始，书已经开了"。
     */
    clearPick()
    useUi.getState().playOpening(book.id, node.getBoundingClientRect())
    if (openTimer.current !== null) window.clearTimeout(openTimer.current)
    openTimer.current = window.setTimeout(
      () => {
        openTimer.current = null
        select(book.id)
      },
      mode === 'full' ? FULL_REVEAL_MS : SIMPLE_REVEAL_MS
    )
  }

  const handleContext = (book: Book, event: React.MouseEvent): void => {
    event.preventDefault()
    clearPeek()
    openContextMenu({ x: event.clientX, y: event.clientY, bookId: book.id })
  }

  const handleDouble = (book: Book): void => {
    // 多选模式下双击 = 打开；把刚排队的那次"选中"撤掉
    noteDoubleClick(book.id)
    clearPeek()
    openDetail(book.id)
  }

  /**
   * 书脊（或列表行）上的单击：在捕获阶段先判定"这是多选操作还是打开"。
   *
   * 必须用捕获 —— 单击的处理写在 BookSpine / BookListItem 里（onClick → onOpen），
   * 只有赶在它之前 stopPropagation，才能让 shift / ctrl / 多选模式接管这次点击。
   */
  const bookIdFromEvent = (event: React.MouseEvent): string | null => {
    const target = event.target as HTMLElement | null
    const spine = target?.closest<HTMLElement>('.book')
    if (spine?.dataset.bookId) return spine.dataset.bookId
    // 列表视图：行上记着 id（和书脊一样靠 data-book-id 认书）
    return target?.closest<HTMLElement>('.book-list-item')?.dataset.bookId ?? null
  }

  const handleBookClick = (event: React.MouseEvent): void => {
    if (suppressClick.current) return
    const bookId = bookIdFromEvent(event)
    if (!bookId) return

    if (event.shiftKey || event.ctrlKey || event.metaKey || multiSelect) {
      event.preventDefault()
      event.stopPropagation()
      applySelectClick(bookId, event)
    }
  }

  /** Shift / Ctrl + 单击时别让浏览器顺手开始框选文字 */
  const handleBookMouseDown = (event: React.MouseEvent): void => {
    if (!event.shiftKey && !event.ctrlKey && !event.metaKey) return
    if (bookIdFromEvent(event)) event.preventDefault()
  }

  if (!index) return null

  if (index.books.length === 0) {
    return (
      <div className="shelf-empty">
        <EmptyState
          icon={<IconBookshelf size={26} />}
          title="书架上还没有书"
          detail="把 PDF、Markdown、纯文本或 Word 文档拖进窗口，或者新建一篇笔记开始记录。"
          action={
            <div className="shelf-empty-actions">
              <Button variant="solid" size="md" icon={<IconImport size={15} />} onClick={() => void importFiles(true)}>
                导入文档
              </Button>
              <Button
                variant="outline"
                size="md"
                icon={<IconPlus size={15} />}
                onClick={() => void createNote(ui.newNoteFormat ?? 'md')}
              >
                新建笔记
              </Button>
            </div>
          }
        />
      </div>
    )
  }

  const renderSpineRow = (
    shelf: Shelf,
    row: PackedRow,
    rowIndex: number,
    totalBooks: number,
    widthsMap: Map<string, number>,
    heightsMap: Map<string, number>,
    key: string
  ): ReactNode => (
    <div
      className={['shelf-unit', dropShelf === shelf.id ? 'is-drop-shelf' : ''].filter(Boolean).join(' ')}
      key={key}
      data-shelf-id={shelf.id}
    >
      <div className={`shelf-row${ui.showShadow ? ' has-shadow' : ''}`} style={{ height: bookAreaHeight + 16 }}>
        <div className="shelf-books">
          {row.items.map((item) => {
            /* 书立：左右两根立柱夹出一段空位，把这一层分成两组 */
            if (item.bookend) {
              const entry = item.bookend
              return (
                <span
                  key={item.key}
                  className={[
                    'shelf-bookend',
                    (entry.side ?? 'right') === 'right' ? 'is-right' : 'is-left',
                    entry.breakLine ? 'is-break' : ''
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  style={{ width: item.width, marginRight: -BOOK_GAP }}
                  title={
                    entry.breakLine
                      ? '书立（到此另起一行）：单击可加宽空位、翻转方向或移除'
                      : '书立：单击可加宽空位、翻转方向或移除'
                  }
                  onClick={(event) => {
                    // 单击就能开菜单：书立只有几像素宽，靠右键很难点中
                    event.preventDefault()
                    event.stopPropagation()
                    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
                    openContextMenu({ x: rect.left, y: rect.bottom, bookendId: entry.id })
                  }}
                  onContextMenu={(event) => {
                    event.preventDefault()
                    event.stopPropagation()
                    openContextMenu({ x: event.clientX, y: event.clientY, bookendId: entry.id })
                  }}
                >
                  <span className="shelf-bookend-post" />
                  <span className="shelf-bookend-foot" />
                </span>
              )
            }

            const book = item.book
            if (!book) return null
            const ownHeight = heightsMap.get(book.id) ?? bookAreaHeight
            const spineWidth =
              widthsMap.get(book.id) ?? spineWidthFor(book.pageCount || 1, styleOf(book), ownHeight)
            const target = dropTarget
            const dropClass = drag?.active && target?.bookId === book.id ? `is-drop-${target.side}` : ''
            const progress = progressOf(book)
            return (
              <BookSpine
                key={book.id}
                book={book}
                style={styleOf(book)}
                width={spineWidth}
                footprint={
                  bookFootprint(
                    spineWidth,
                    ownHeight,
                    facing,
                    facing === 'spine' ? 0 : (ui.coverBookGap ?? 14)
                  ) + tiltSpill(spineWidth, ownHeight, tiltFor(book, ui, styleOf(book)))
                }
                height={ownHeight}
                tilt={tiltFor(book, ui, styleOf(book))}
                facing={facing}
                ui={ui}
                selected={selectedSet.has(book.id)}
                marked={false}
                progress={progress}
                progressOverlay={<ProgressRing percent={progress} />}
                dragging={drag?.active === true && drag.bookId === book.id}
                onOpen={handleOpen}
                onContext={handleContext}
                onHover={handleHover}
                onLeave={clearPeek}
                onDouble={handleDouble}
                onDragStart={handleDragStart}
                className={dropClass}
              />
            )
          })}
        </div>
        <div className="shelf-plank">
          <span className="shelf-plank-top" />
          <span className="shelf-plank-face" />
          {ui.showPlaque && rowIndex === 0 ? <span className="shelf-plaque-name">{shelf.name}</span> : null}
          {ui.showPlaque && rowIndex === 0 ? (
            <span className="shelf-plaque-count">{totalBooks} 本</span>
          ) : null}
        </div>
      </div>
    </div>
  )

  return (
    <div
      className={['shelf-view', layout === 'continuous' ? 'is-continuous-scroll' : ''].filter(Boolean).join(' ')}
      ref={scrollRef}
      data-available={Math.round(available)}
      onClickCapture={handleBookClick}
      onMouseDownCapture={handleBookMouseDown}
    >
      <ShelfToolbar
        filter={filter}
        onFilter={patchFilter}
        onClearFilter={clearFilter}
        sort={sortMode}
        sortDesc={ui.shelfSortDesc ?? false}
        onSort={(mode, desc) => void patch({ ui: { shelfSort: mode, shelfSortDesc: desc } })}
        availableFormats={availableFormats}
        allBooks={allBooks}
        manualHint={sortMode !== 'manual'}
        missingCount={missingBooks.length}
        onRemoveMissing={() => void handleRemoveMissing()}
        multiSelect={multiSelect}
        onToggleMultiSelect={(next) => {
          setMultiSelect(next)
          if (!next) {
            const pending = pendingClick.current
            if (pending) window.clearTimeout(pending.timer)
            pendingClick.current = null
          }
        }}
        selectedCount={effectiveSelected.length}
      />

      {effectiveSelected.length > 0 ? (
        <ShelfBatchBar
          books={selectedBooks}
          shelves={batchShelves}
          commonTags={commonSelectedTags}
          styles={batchStyles}
          visibleCount={totalVisible}
          onSelectAllVisible={selectAllVisible}
          onClear={clearPick}
          onDelete={handleDeleteSelected}
          onMove={handleMoveSelected}
          onAddTags={handleAddTags}
          onRemoveTag={handleRemoveTag}
          onApplyStyle={handleApplyStyle}
          onRate={handleRate}
          onSetSeries={handleSetSeries}
          onSetAuthor={handleSetAuthor}
          onSetStatus={handleSetStatus}
        />
      ) : null}

      <div className={`shelf-scroll${layout === 'continuous' ? ' is-continuous' : ''}`}>
        {viewMode === 'list' ? (
          groups.map((group) => (
            <section className="shelf-list-group" key={group.shelf.id}>
              <h2 className="shelf-list-title">{group.shelf.name}</h2>
              <div className="book-list">
                {group.books.map((book) => (
                  <div className="book-list-row" key={book.id}>
                    <BookListItem
                      book={book}
                      style={styleOf(book)}
                      selected={selectedSet.has(book.id)}
                      progress={progressOf(book)}
                      onOpen={handleOpen}
                      onContext={handleContext}
                      onDouble={handleDouble}
                    />
                  </div>
                ))}
              </div>
            </section>
          ))
        ) : totalVisible === 0 ? (
          <div className="shelf-empty is-inline">
            <EmptyState
              icon={<IconSearch size={24} />}
              title={query || filter.formats.length ? '没有找到匹配的书' : '这层书架还是空的'}
              detail={
                query
                  ? `试试别的关键词，当前搜索：「${query}」`
                  : '可以放宽筛选条件，或把书拖到别的书架层。'
              }
              action={
                <Button variant="outline" onClick={clearFilter}>
                  清除筛选
                </Button>
              }
            />
          </div>
        ) : layout === 'continuous' ? (
          /* 连续书柜：每个书架层是一"格"，横向并排，放不下就换行；
             各格之间不留页面式的空隙，看起来是一面整墙。 */
          <div className="shelf-continuous">
            {bays.map((bay) => (
              <div
                className="shelf-bay"
                key={bay.shelf.id}
                style={{ ['--bay-max' as string]: `${ui.shelfBayMaxWidth ?? 560}px` }}
              >
                {bay.rows.map((row, rowIndex) =>
                  renderSpineRow(
                    bay.shelf,
                    row,
                    rowIndex,
                    bay.books.length,
                    bay.widthsMap,
                    bay.heightsMap,
                    `${bay.shelf.id}-${rowIndex}`
                  )
                )}
              </div>
            ))}
          </div>
        ) : (
          groups.flatMap((group) =>
            group.rows.map((row, rowIndex) =>
              renderSpineRow(
                group.shelf,
                row,
                rowIndex,
                group.books.length,
                group.widthsMap,
                group.heightsMap,
                `${group.shelf.id}-${rowIndex}`
              )
            )
          )
        )}
        <div className="shelf-tail" />
      </div>

      {peek && !drag?.active ? <CoverPeek book={peek.book} style={styleOf(peek.book)} anchor={peek.rect} /> : null}

      <ConfirmModal
        open={pendingOrder !== null}
        title="固化为默认排序"
        message={`当前按「${SORT_LABEL[sortMode]}」排序。拖动会把这个顺序保存成新的默认顺序。`}
        detail="默认顺序就是「排序方式 = 默认（手动）」时书架上的排列，保存后原来的手动顺序会被覆盖。"
        confirmLabel="固化并拖动"
        onConfirm={() => void confirmPendingOrder()}
        onCancel={() => setPendingOrder(null)}
      />
    </div>
  )
}
