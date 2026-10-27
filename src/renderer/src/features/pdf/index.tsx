/**
 * PDF 阅读模块入口。
 *
 * 这一层是「总装」：把文档、阅读记录、视图状态、搜索、批注串起来，
 * 具体的绘制与面板逻辑都在子组件里。对外只暴露 PdfViewer。
 */

import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode
} from 'react'
import type {
  AnnotationStroke,
  Book,
  Bookmark,
  NormRect,
  PageFlipAnimation,
  PdfTextHighlight,
  Point,
  TextMarkStyle
} from '@shared/types'
import { Button } from '@/components/common/Controls'
import {
  IconChevronLeft,
  IconChevronRight,
  IconExternalLink,
  IconFilePdf,
  IconRefresh
} from '@/components/icons/Icons'
import { appApi, filesApi } from '@/lib/api'
import { reportPageTurn } from '@/lib/usage'
import { useBookmarkTarget } from '@/lib/bookmarkTarget'
import { FLIP_DURATION_MS } from '@/features/reader/pageFlip'
import { useLibrary } from '@/store/useLibrary'
import { useSettings } from '@/store/useSettings'
import { useUi } from '@/store/useUi'
import { AnnotationToolbar, ANNOTATION_COLORS } from './components/AnnotationToolbar'
import { nextStrokeId, strokeStyleFor } from './components/AnnotationLayer'
import type { AnnotationSettings } from './components/AnnotationLayer'
import { ExtractImagesModal } from './components/ExtractImagesModal'
import { TextActionBar } from '@/components/common/TextActionBar'
import { TranslatePanel } from '@/features/reader/TranslatePanel'
import { SideResizer } from '@/components/common/SideResizer'
import { useSideWidth } from '@/lib/useSideWidth'
import { useShortcuts } from '@/lib/useShortcuts'
import { useTranslate } from '@/store/useTranslate'
import { PageView } from './components/PageView'
import { PdfSidebar, type SidebarTab } from './components/PdfSidebar'
import { Toolbar } from './components/Toolbar'
import { useBookRecord } from './hooks/useBookRecord'
import { usePageFlip } from './hooks/usePageFlip'
import { usePdfDocument } from './hooks/usePdfDocument'
import { useViewerState, type ScrollMode, type ZoomValue } from './hooks/useViewerState'
import { autoBookmarkLabel, hasBookmarkAt, makeBookmark, sortBookmarks } from './lib/bookmarks'
import { getPageText } from './lib/engine'
import { buildAnnotatedPdf } from './lib/exportPdf'
import { clamp, type PageBox } from './lib/geometry'
import { loadOutline, outlineIsUsable } from './lib/outline'
import { RenderQueue } from './lib/renderQueue'
import { searchDocument, type SearchHit, type SearchRect } from './lib/search'
import {
  FLIP_GUTTER,
  resolveSpreadStep,
  spreadCellsForPage,
  spreadCellsOf,
  spreadCount,
  spreadFootprint,
  spreadKey,
  spreadSliceAt,
  type SpreadCells
} from './lib/spread'

const SEARCH_DEBOUNCE = 320

/** 设置里的默认缩放允许 'auto'，阅读器内部用 'page-width' 表示它 */
function toZoomValue(value: 'auto' | 'page-fit' | 'page-width' | number | undefined): ZoomValue {
  if (value === undefined || value === 'auto') return 'page-width'
  if (value === 'page-fit' || value === 'page-width') return value
  return value
}

interface NoteEditorState {
  page: number
  stroke: AnnotationStroke | null
  point: Point | null
  text: string
}

/** 左右翻页舞台里每一张纸的角色 */
type SheetRole = 'only' | 'outgoing' | 'incoming'

/** 舞台上一叠纸：单页模式是一页，双页模式是一个跨页（左右两页并排） */
interface FlipSpreadView {
  /** 身份 key：左页-右页；换跨页时变化，React 据此决定复用还是重挂画布 */
  key: string
  role: SheetRole
  cells: SpreadCells
}

/** 舞台当前要挂哪些纸，以及这一帧是不是在放翻页动画 */
interface FlipStageView {
  animating: boolean
  dir: 'next' | 'prev' | null
  spreads: FlipSpreadView[]
}

export function PdfViewer({ book }: { book: Book }): ReactNode {
  /* ------------------------------------------------------------ 数据源 */

  const pdf = usePdfDocument(book)
  const recordStore = useBookRecord(book.id)
  const settings = useSettings((s) => s.settings)
  const updateBook = useLibrary((s) => s.updateBook)

  const scrollModeDefault: ScrollMode = settings?.ui.pdfContinuous === false ? 'single' : 'continuous'
  const zoomDefault: ZoomValue = toZoomValue(settings?.ui.pdfDefaultZoom)

  /** 左右翻页的排版：true = 双页跨页（摊开的书），默认开；只作用于 flip 模式 */
  const [flipSpread, setFlipSpread] = useState(true)

  const viewer = useViewerState(book, pdf.doc, pdf.pageCount, recordStore, {
    zoom: zoomDefault,
    scrollMode: scrollModeDefault,
    spreadPages: flipSpread
  })

  const {
    pageCount,
    doc,
    rawBytes,
    status,
    error: loadError,
    errorKind,
    reload
  } = pdf
  const {
    currentPage,
    pageBoxes,
    resolvedZoom,
    rotation,
    scrollMode,
    spreadPages,
    pendingScrollPage,
    registerPage,
    goToPage,
    setCurrentPage: focusPage,
    setZoom,
    zoomBy,
    rotate,
    setScrollMode
  } = viewer

  /**
   * 阅读器的渲染队列。双页跨页一次要栅格化两页，
   * 让它们走这条既有的串行队列（当前页优先），而不是各自抢带宽 ——
   * 连续滚动 / 单页模式不传队列，行为与以前一字不差。
   */
  const renderQueueRef = useRef<RenderQueue | null>(null)
  if (renderQueueRef.current === null) renderQueueRef.current = new RenderQueue()
  const renderQueue = renderQueueRef.current

  /*
   * 阅读页数：每一页只记一次。
   * 连续滚动时 currentPage 会因为滑动反复变，靠这个 Set 去重，
   * 否则来回滚两下就能把"读了几页"刷成几百。
   */
  const countedPages = useRef<Set<number>>(new Set())
  useEffect(() => {
    if (!currentPage || countedPages.current.has(currentPage)) return
    countedPages.current.add(currentPage)
    reportPageTurn(book.id)
  }, [currentPage, book.id])

  /*
   * 书签：PDF 有真页码，直接用页；跳转就是 goToPage。
   * 页里的文字搜起来要异步取文本层，加书签是即时动作，所以摘录用页码 + 目录标题。
   */
  const currentPageRef = useRef(currentPage)
  currentPageRef.current = currentPage
  const outlineTitleRef = useRef('')
  outlineTitleRef.current = ''
  useBookmarkTarget({
    anchor: () => ({ kind: 'page', page: currentPageRef.current }),
    goTo: (anchor) => {
      const page =
        anchor.kind === 'page'
          ? anchor.page
          : anchor.kind === 'scroll'
            ? Math.max(1, Math.round(anchor.ratio * Math.max(1, pageCount)))
            : 1
      goToPage(page)
    },
    describe: () => ({
      page: currentPageRef.current,
      label: `第 ${currentPageRef.current} 页`,
      excerpt: outlineTitleRef.current || book.title
    })
  })

  /* ------------------------------------------------- 左右翻页（flip） */

  const isFlipMode = scrollMode === 'flip'
  const flipAnimation: PageFlipAnimation = settings?.ui.pageFlipAnimation ?? 'slide'

  /**
   * 翻一次的落点：双页模式下 ← / → 要跨过整整两页（一个跨页），
   * 具体的配对规则见 lib/spread.ts（第 1 页独占右半边，(2,3)、(4,5)…）。
   */
  const resolveFlipTarget = useCallback(
    (page: number, delta: 1 | -1): number =>
      spreadPages ? resolveSpreadStep(page, delta, pageCount) : clamp(page + delta, 1, Math.max(1, pageCount)),
    [spreadPages, pageCount]
  )

  const flip = usePageFlip({
    active: isFlipMode,
    currentPage,
    pageCount,
    goToPage,
    animation: flipAnimation,
    animate: settings?.ui.animate !== false,
    resolveTarget: resolveFlipTarget
  })
  const turnPage = flip.turn

  // 还能不能往前 / 往后：左右翻页模式下「下一叠」可能已经到头，光看页码不够准
  const canTurnPrev = resolveFlipTarget(currentPage, -1) !== currentPage
  const canTurnNext = resolveFlipTarget(currentPage, 1) !== currentPage

  const buildSpread = useCallback(
    (page: number, role: SheetRole): FlipSpreadView => {
      const cells: SpreadCells = spreadPages
        ? spreadCellsForPage(page, pageCount, pageBoxes)
        : { left: null, right: pageBoxes[page - 1] ?? null }
      return { key: spreadKey(cells), role, cells }
    },
    [spreadPages, pageCount, pageBoxes]
  )

  /**
   * 舞台上要挂的纸：
   *  - 静止：只有当前页所在的那一叠（双页模式是一个跨页：左页 + 右页）；
   *  - 翻页动画中：先旧叠（outgoing）后新叠（incoming），叠在同一个网格格里一起动。
   * 只有「动画落点正好是当前页、且新旧不是同一叠」时才认这段动画；
   * 中途跳页（搜索 / 书签 / 缩略图）会立刻把它作废，只显示目标那一叠。
   */
  const flipStage = useMemo<FlipStageView>(() => {
    if (!isFlipMode) return { animating: false, dir: null, spreads: [] }

    const to = buildSpread(currentPage, 'only')
    const state = flip.flip
    const from = state ? buildSpread(state.from, 'outgoing') : null
    const animating = state !== null && from !== null && state.to === currentPage && from.key !== to.key

    if (!state || !from || !animating) return { animating: false, dir: null, spreads: [to] }
    return {
      animating: true,
      dir: state.dir,
      spreads: [from, { ...to, role: 'incoming' }]
    }
  }, [isFlipMode, buildSpread, currentPage, flip.flip])

  /**
   * 舞台尺寸：双页模式下取「所有跨页里最大的那一叠」。
   * 这样前后翻页时舞台尺寸恒定 —— 页面不会因为舞台重排而跳一下，
   * 滑入滑出的距离（--flip-shift）也总能保证纸叠完整移出可视区。
   */
  const stageSize = useMemo(() => {
    if (!isFlipMode) return null
    let width = 0
    let height = 0
    const total = spreadCount(pageCount)
    for (let index = 0; index < total; index += 1) {
      const size = spreadFootprint(spreadCellsOf(spreadSliceAt(index, pageCount), pageBoxes), {
        gutter: FLIP_GUTTER,
        facing: spreadPages
      })
      width = Math.max(width, size.width)
      height = Math.max(height, size.height)
    }
    return width > 0 && height > 0 ? { width, height } : null
  }, [isFlipMode, spreadPages, pageCount, pageBoxes])

  /** 当前这一叠的两页（双页模式下用来在状态栏标出「跨页 2–3」） */
  const currentCells = useMemo(
    () => (spreadPages ? spreadCellsForPage(currentPage, pageCount, pageBoxes) : null),
    [spreadPages, currentPage, pageCount, pageBoxes]
  )

  /**
   * 双页跨页里，用户在哪一页上落笔 / 擦除 / 写便签，就把「当前页」挪到哪一页。
   * 批注工具条的撤销 / 清除本页 / 按钮可用状态都是按当前页算的 ——
   * 不这样做的话，在左页画完、工具条却还在说右页（清除按钮甚至是灰的）。
   * 只改页码、不触发滚动定位，所以画面不会跳。
   */
  const focusSpreadPage = useCallback(
    (page: number): void => {
      if (!spreadPages || page === currentPage) return
      if (!currentCells) return
      if (currentCells.left?.page !== page && currentCells.right?.page !== page) return
      focusPage(page)
    },
    [spreadPages, currentPage, currentCells, focusPage]
  )

  const pagesRef = viewer.pagesRef
  const flipStageRef = flip.stageRef
  const setStage = useCallback(
    (node: HTMLDivElement | null): void => {
      flipStageRef(node)
      pagesRef(node)
    },
    [flipStageRef, pagesRef]
  )

  /* ------------------------------------------------------------ 界面状态 */

  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [tab, setTab] = useState<SidebarTab>('thumbs')
  const [searchOpen, setSearchOpen] = useState(false)
  const [extractOpen, setExtractOpen] = useState(false)
  const [outlineLoading, setOutlineLoading] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [annotationSettings, setAnnotationSettings] = useState<AnnotationSettings>({
    tool: 'select',
    color: ANNOTATION_COLORS[0],
    width: 0.0035,
    opacity: 1
  })
  const [noteEditor, setNoteEditor] = useState<NoteEditorState | null>(null)
  /** 鼠标停在左 / 右翻页热区上时，给一个可见的箭头提示 */
  const [flipHover, setFlipHover] = useState<'prev' | 'next' | null>(null)

  const [searchQuery, setSearchQuery] = useState('')
  const [hits, setHits] = useState<SearchHit[]>([])
  const [activeHit, setActiveHit] = useState(0)
  const [searching, setSearching] = useState(false)
  const [searchProgress, setSearchProgress] = useState<{ done: number; total: number } | null>(null)

  const undoStacks = useRef(new Map<number, AnnotationStroke[][]>())
  const searchAbort = useRef<{ aborted: boolean }>({ aborted: false })
  const focusSearchRef = useRef<(() => void) | null>(null)

  const toast = useUi((s) => s.toast)

  /* ------------------------------------------------------------ 目录缓存 */

  const fetchOutline = useCallback(async (): Promise<void> => {
    if (!doc) return
    setOutlineLoading(true)
    try {
      const outline = await loadOutline(doc)
      recordStore.setOutline(outline)
      if (outline.length === 0) toast('这份 PDF 没有内嵌目录', 'info')
      else if (!outlineIsUsable(outline)) toast('目录里的条目没有跳转目标', 'warn')
    } catch (err) {
      toast('目录读取失败', 'error', (err as Error).message)
    } finally {
      setOutlineLoading(false)
    }
  }, [doc, recordStore, toast])

  // 同一份文档只自动读一次目录；已经缓存过就跳过。
  // 用「记住是哪份 doc」而不是布尔开关，换书时天然重新判断。
  const outlineRequestedFor = useRef<unknown>(null)
  useEffect(() => {
    if (!doc) return
    if (recordStore.record.outline.length > 0) return
    if (outlineRequestedFor.current === doc) return
    outlineRequestedFor.current = doc
    void fetchOutline()
  }, [doc, recordStore.record.outline.length, fetchOutline])

  /* ------------------------------------------------------------ 打开与完结 */

  const openedRef = useRef<string | null>(null)
  useEffect(() => {
    if (status !== 'ready' || openedRef.current === book.id) return
    openedRef.current = book.id
    void updateBook(book.id, {
      lastOpenedAt: Date.now(),
      status: currentPage > 1 ? 'reading' : book.status === 'finished' ? 'finished' : 'unread'
    })
    // 只在打开时同步一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, book.id])

  useEffect(() => {
    if (status !== 'ready' || pageCount === 0) return
    if (currentPage === pageCount && pageCount > 1) {
      void updateBook(book.id, { status: 'finished', lastOpenedAt: Date.now() })
    } else if (currentPage > 1) {
      void updateBook(book.id, { status: 'reading', lastOpenedAt: Date.now() })
    }
  }, [currentPage, pageCount, status, book.id, updateBook])

  /* ------------------------------------------------------------ 书签 */

  const bookmarks = recordStore.record.bookmarks
  const bookmarkHere = hasBookmarkAt(bookmarks, currentPage)

  const toggleBookmark = useCallback(async (): Promise<void> => {
    const existing = hasBookmarkAt(recordStore.record.bookmarks, currentPage)
    if (existing) {
      recordStore.setBookmarks((list) => list.filter((b) => b.id !== existing.id))
      toast(`已移除第 ${currentPage} 页的书签`, 'info')
      return
    }
    let label = `第 ${currentPage} 页`
    if (doc) {
      try {
        const { text } = await getPageText(doc, currentPage)
        label = autoBookmarkLabel(text, currentPage)
      } catch {
        // 取不到文字就用默认名字
      }
    }
    const bookmark = makeBookmark(currentPage, label, recordStore.record.bookmarks.length)
    recordStore.setBookmarks((list) => sortBookmarks([...list, bookmark]))
    toast('已添加书签', 'success', label)
  }, [recordStore, currentPage, doc, toast])

  const addBookmarkAtCurrent = useCallback((): void => {
    const existing = hasBookmarkAt(recordStore.record.bookmarks, currentPage)
    if (existing) {
      toast('这一页已经有书签了', 'warn', existing.label)
      return
    }
    const bookmark: Bookmark = makeBookmark(currentPage, `第 ${currentPage} 页`, recordStore.record.bookmarks.length)
    recordStore.setBookmarks((list) => sortBookmarks([...list, bookmark]))
    // 异步补一个更贴切的自动名字
    if (doc) {
      void getPageText(doc, currentPage)
        .then(({ text }) => {
          const label = autoBookmarkLabel(text, currentPage)
          recordStore.setBookmarks((list) => list.map((b) => (b.id === bookmark.id ? { ...b, label } : b)))
        })
        .catch(() => undefined)
    }
  }, [recordStore, currentPage, doc, toast])

  const renameBookmark = useCallback(
    (id: string, label: string): void => {
      if (!label) return
      recordStore.setBookmarks((list) => list.map((b) => (b.id === id ? { ...b, label } : b)))
    },
    [recordStore]
  )

  const deleteBookmark = useCallback(
    (id: string): void => {
      recordStore.setBookmarks((list) => list.filter((b) => b.id !== id))
    },
    [recordStore]
  )

  const recolorBookmark = useCallback(
    (id: string, color: string): void => {
      recordStore.setBookmarks((list) => list.map((b) => (b.id === id ? { ...b, color } : b)))
    },
    [recordStore]
  )

  /* 备注 / 读书笔记：与 EPUB 用的是同一个面板，只是数据落在 PDF 自己的记录里 */
  const noteBookmark = useCallback(
    (id: string, note: string): void => {
      const text = note.trim()
      recordStore.setBookmarks((list) =>
        list.map((b) => (b.id === id ? { ...b, note: text || undefined } : b))
      )
    },
    [recordStore]
  )

  /* ------------------------------------------------------------ 批注 */

  const pageStrokes = useMemo(
    () => recordStore.record.annotations[String(currentPage)] ?? [],
    [recordStore.record.annotations, currentPage]
  )

  const pushUndo = useCallback((page: number, snapshot: AnnotationStroke[]): void => {
    const stack = undoStacks.current.get(page) ?? []
    stack.push(snapshot)
    if (stack.length > 40) stack.shift()
    undoStacks.current.set(page, stack)
  }, [])

  const commitStroke = useCallback(
    (page: number, stroke: AnnotationStroke): void => {
      focusSpreadPage(page)
      const snapshot = recordStore.record.annotations[String(page)] ?? []
      pushUndo(page, snapshot)
      recordStore.setPageStrokes(page, (list) => [...list, stroke])
    },
    [recordStore, pushUndo, focusSpreadPage]
  )

  const eraseStrokes = useCallback(
    (page: number, ids: string[], withUndo: boolean): void => {
      if (ids.length === 0) return
      focusSpreadPage(page)
      const snapshot = recordStore.record.annotations[String(page)] ?? []
      const remaining = snapshot.filter((stroke) => !ids.includes(stroke.id))
      if (remaining.length === snapshot.length) return
      // 一次拖拽只压一次撤销点，否则撤销要按好多下
      if (withUndo) pushUndo(page, snapshot)
      recordStore.setPageStrokes(page, () => remaining)
    },
    [recordStore, pushUndo, focusSpreadPage]
  )

  const undo = useCallback((): void => {
    const stack = undoStacks.current.get(currentPage)
    const snapshot = stack?.pop()
    if (!snapshot) {
      toast('这一页没有可以撤销的操作', 'info')
      return
    }
    recordStore.setPageStrokes(currentPage, () => snapshot)
  }, [currentPage, recordStore, toast])

  const clearPage = useCallback((): void => {
    const snapshot = recordStore.record.annotations[String(currentPage)] ?? []
    if (snapshot.length === 0) return
    pushUndo(currentPage, snapshot)
    recordStore.setPageStrokes(currentPage, () => [])
    toast(`已清除第 ${currentPage} 页的批注`, 'info')
  }, [currentPage, recordStore, pushUndo, toast])

  const requestTextNote = useCallback(
    (page: number, point: Point): void => {
      focusSpreadPage(page)
      setNoteEditor({ page, stroke: null, point, text: '' })
      setAnnotationSettings((current) => ({ ...current, tool: 'text' }))
    },
    [focusSpreadPage]
  )

  const editTextNote = useCallback(
    (page: number, stroke: AnnotationStroke): void => {
      focusSpreadPage(page)
      setNoteEditor({ page, stroke, point: null, text: stroke.text ?? '' })
    },
    [focusSpreadPage]
  )

  const commitNote = useCallback((): void => {
    const editor = noteEditor
    setNoteEditor(null)
    if (!editor) return
    const text = editor.text.trim()

    if (editor.stroke) {
      const snapshot = recordStore.record.annotations[String(editor.page)] ?? []
      if (!text) {
        pushUndo(editor.page, snapshot)
        recordStore.setPageStrokes(editor.page, (list) => list.filter((s) => s.id !== editor.stroke?.id))
        return
      }
      if (text === (editor.stroke.text ?? '')) return
      pushUndo(editor.page, snapshot)
      recordStore.setPageStrokes(editor.page, (list) =>
        list.map((s) => (s.id === editor.stroke?.id ? { ...s, text } : s))
      )
      return
    }

    if (!text) return
    const style = strokeStyleFor('text', annotationSettings)
    const anchor = editor.point ?? { x: 0.12, y: 0.12 }
    const stroke: AnnotationStroke = {
      id: nextStrokeId(),
      tool: 'text',
      color: annotationSettings.color,
      width: style.width,
      opacity: style.opacity,
      fontSize: 0.0175,
      text,
      points: [
        {
          x: anchor.x,
          y: anchor.y
        }
      ],
      createdAt: Date.now()
    }
    pushUndo(editor.page, recordStore.record.annotations[String(editor.page)] ?? [])
    recordStore.setPageStrokes(editor.page, (list) => [...list, stroke])
  }, [noteEditor, recordStore, annotationSettings, pushUndo])

  /* ------------------------------------------------------------ 导出批注 PDF */

  const exportAnnotated = useCallback(async (): Promise<void> => {
    if (!rawBytes) {
      toast('原始文件还没读进来，稍后再试', 'warn')
      return
    }
    const total = Object.values(recordStore.record.annotations).reduce((sum, list) => sum + list.length, 0)
    if (total === 0) {
      toast('还没有任何批注', 'warn', '先用钢笔或荧光笔在页面上画几笔吧')
      return
    }
    setExporting(true)
    try {
      const result = await buildAnnotatedPdf(rawBytes, recordStore.record.annotations)
      const saved = await filesApi.exportBinary(`${book.title}-批注.pdf`, result.bytes, [
        { name: 'PDF', extensions: ['pdf'] }
      ])
      if (saved.cancelled) {
        toast('已取消导出', 'info')
        return
      }
      toast(`已导出 ${result.drawn} 处批注`, 'success', saved.path ?? undefined)
      if (result.sanitized > 0) {
        toast('部分便签含非拉丁字符', 'warn', '标准字体无法嵌入中文，已用 ? 占位')
      }
    } catch (err) {
      toast('导出批注 PDF 失败', 'error', (err as Error).message)
    } finally {
      setExporting(false)
    }
  }, [rawBytes, recordStore.record.annotations, book.title, toast])

  /* ------------------------------------------------------------ 搜索 */

  useEffect(() => {
    const query = searchQuery.trim()
    if (!doc || query.length === 0) {
      searchAbort.current.aborted = true
      setHits([])
      setActiveHit(0)
      setSearching(false)
      setSearchProgress(null)
      return
    }
    const signal = { aborted: false }
    searchAbort.current = signal
    setSearching(true)
    setSearchProgress({ done: 0, total: pageCount })

    const timer = window.setTimeout(() => {
      void searchDocument(doc, query, {
        signal,
        onPage: (_page, _hits, total) => setSearchProgress({ done: _page, total: pageCount })
      })
        .then((found) => {
          if (signal.aborted) return
          setHits(found)
          setActiveHit(0)
          if (found.length > 0) goToPage(found[0].page)
        })
        .catch((err) => {
          if (!signal.aborted) toast('搜索失败', 'error', (err as Error).message)
        })
        .finally(() => {
          if (!signal.aborted) {
            setSearching(false)
            setSearchProgress(null)
          }
        })
    }, SEARCH_DEBOUNCE)

    return () => {
      window.clearTimeout(timer)
      signal.aborted = true
    }
  }, [searchQuery, doc, pageCount, goToPage, toast])

  const jumpToHit = useCallback(
    (index: number): void => {
      const hit = hits[index]
      if (!hit) return
      setActiveHit(index)
      goToPage(hit.page)
    },
    [hits, goToPage]
  )

  const activeHitData = hits[activeHit] ?? null

  const rectsByPage = useMemo(() => {
    const map = new Map<number, SearchRect[]>()
    for (const hit of hits) {
      const list = map.get(hit.page) ?? []
      if (hit !== activeHitData) list.push(...hit.rects)
      map.set(hit.page, list)
    }
    return map
  }, [hits, activeHitData])

  const registerSearchFocus = useCallback((focus: (() => void) | null): void => {
    focusSearchRef.current = focus
  }, [])

  /* ------------------------------------------------------------ 工具栏动作 */

  const openContainingFolder = useCallback((): void => {
    const path = book.path.replace(/[\\/][^\\/]*$/, '')
    if (!path) return
    void appApi.revealPath(path).catch((err: Error) => toast('打开文件夹失败', 'error', err.message))
  }, [book.path, toast])

  const openExternal = useCallback((): void => {
    void appApi.openPath(book.path).catch((err: Error) => toast('无法用系统应用打开', 'error', err.message))
  }, [book.path, toast])

  const handleZoomStep = useCallback(
    (direction: 1 | -1): void => {
      zoomBy(direction * 0.1)
    },
    [zoomBy]
  )

  /*
   * Ctrl + 滚轮缩放。
   *
   * 必须用**原生**监听：React 的 onWheel 是被动监听，preventDefault() 拦不住 ——
   * 而 Electron 默认会把 Ctrl+滚轮当成"整个界面缩放"，不拦就会连书架一起放大。
   * 用捕获阶段 + stopPropagation，保证滚到的是 PDF 自己的缩放。
   *
   * scrollRef 是回调 ref（拿不到 .current），所以这里自己再存一份节点。
   */
  const wheelHostRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    const node = wheelHostRef.current
    if (!node) return
    const onWheel = (event: WheelEvent): void => {
      if (!event.ctrlKey && !event.metaKey) return
      event.preventDefault()
      event.stopPropagation()
      /* 一格滚轮 ≈ 一次「放大/缩小」，与工具栏上的 ± 一致 */
      handleZoomStep(event.deltaY < 0 ? 1 : -1)
    }
    node.addEventListener('wheel', onWheel, { passive: false, capture: true })
    return () => node.removeEventListener('wheel', onWheel, { capture: true })
  }, [handleZoomStep, doc])

  const handleScrollModeChange = useCallback(
    (mode: ScrollMode): void => {
      // 切模式前先把翻页动画收干净，免得残留的旧页跟着换过去
      flip.cancel()
      setFlipHover(null)
      setScrollMode(mode)
    },    [flip.cancel, setScrollMode]
  )

  const handleToggleSearch = useCallback((): void => {
    setSidebarOpen(true)
    setTab('search')
    setSearchOpen((open) => !open)
    window.setTimeout(() => focusSearchRef.current?.(), 40)
  }, [])

  /* ------------------------------------------------------------ 键盘 */

  /*
   * 可改的快捷键走统一系统（设置页里能改键）；
   * 固定项（方向键随滚动模式、Home/End、Esc 取消绘制）仍留在下面那个监听里。
   */

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        return
      }
      // 带修饰键的组合交给统一快捷键系统 / 系统本身处理
      if (event.ctrlKey || event.metaKey || event.altKey) return

      switch (event.key) {
        /*
         * 固定项：方向键翻页跟随滚动模式（连续滚动时是滚动），Home/End 跳首尾，Esc 取消绘制。
         * PageDown/PageUp、+/-、B、Ctrl+F、Ctrl+Z 已交给可改的快捷键系统，这里不再处理 ——
         * 两处都处理的话一次按键会翻两页。
         */
        case 'Home':
          event.preventDefault()
          goToPage(1)
          break
        case 'End':
          event.preventDefault()
          goToPage(pageCount)
          break
        case 'ArrowRight':
        case 'ArrowDown':
          if (scrollMode !== 'continuous') {
            event.preventDefault()
            turnPage(1)
          }
          break
        case 'ArrowLeft':
        case 'ArrowUp':
          if (scrollMode !== 'continuous') {
            event.preventDefault()
            turnPage(-1)
          }
          break
        case 'Escape':
          setAnnotationSettings((current) => ({ ...current, tool: 'select' }))
          setNoteEditor(null)
          break
        default:
          break
      }

      switch (event.key.toLowerCase()) {
        case 'p':
          setAnnotationSettings((current) => ({ ...current, tool: 'pen' }))
          break
        case 'h':
          setAnnotationSettings((current) => ({ ...current, tool: 'highlighter' }))
          break
        case 'e':
          setAnnotationSettings((current) => ({ ...current, tool: 'eraser' }))
          break
        case 't':
          setAnnotationSettings((current) => ({ ...current, tool: 'text' }))
          break
        default:
          break
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [
    currentPage,
    pageCount,
    scrollMode,
    goToPage,
    turnPage,
    handleZoomStep,
    toggleBookmark,
    undo
  ])

  /* ------------------------------------------------------------ 渲染 */

  /**
   * 要挂出来的纸：
   *  - 连续滚动：全部页面
   *  - 单页：只有当前页
   *  - 左右翻页：由上面的 flipStage 决定（双页模式时每一叠是一个跨页）
   */
  const sheets = useMemo<PageBox[]>(() => {
    if (scrollMode === 'single') {
      const box = pageBoxes[currentPage - 1]
      return box ? [box] : []
    }
    return pageBoxes
  }, [scrollMode, pageBoxes, currentPage])

  /* ------------------------------------------------ PDF 正文文字操作 */
  /*
   * 选中文字 → 复制 / 高亮 / 划线 / 标记书签。
   *
   * PDF 的正文是画布上的一张图，没法像 EPUB 那样往 DOM 里插标记，
   * 所以走 pdf.js 的文字层选中，把"选中文字覆盖的矩形"归一化存下来，
   * 再当覆盖层画上去（缩放 / 旋转 / 双页都不必重算）。
   */
  const [textMarks, setTextMarks] = useState<PdfTextHighlight[]>([])
  const [textBar, setTextBar] = useState<{
    page: number
    text: string
    rects: NormRect[]
    anchor: { x: number; y: number }
  } | null>(null)

  /*
   * 记录里已有的标注：等记录**读进来之后**再取。
   * 之前依赖的是 record.bookId（字符串，一直不变），记录异步到达时这个 effect 不会重跑，
   * 于是重开时标注画不出来（存是存住了）。
   */
  useEffect(() => {
    if (!recordStore.hydrated) return
    setTextMarks(recordStore.record.pdfHighlights ?? [])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book.id, recordStore.hydrated])

  /* 左栏（缩略图/目录/书签/搜索）宽度可拖 */
  const sideLeft = useSideWidth('left')

  /* 翻译（右侧栏）：与 EPUB 用同一份状态与面板 */
  const translateOpen = useTranslate((s) => s.open)
  const translateToggle = useTranslate((s) => s.toggle)
  const runTranslate = useTranslate((s) => s.run)
  /*
   * 可改的快捷键走统一系统（设置页里能改键）；
   * 固定项（方向键随滚动模式、Home/End、Esc 取消绘制）仍留在下面那个监听里。
   */
  useShortcuts({
    'pdf.nextPage': () => turnPage(1),
    'pdf.prevPage': () => turnPage(-1),
    'pdf.search': () => {
      setSidebarOpen(true)
      setTab('search')
      setSearchOpen(true)
    },
    'pdf.undo': () => undo(),
    'pdf.zoomIn': () => handleZoomStep(1),
    'pdf.zoomOut': () => handleZoomStep(-1),
    'pdf.bookmark': () => addBookmarkAtCurrent(),
    /* 文本标记：都作用于"当前选中"，没选中就提示一下 */
    'pdf.highlight': () => markSelection('highlight'),
    'pdf.underline': () => markSelection('underline'),
    'pdf.wavy': () => markSelection('wavy'),
    'pdf.note': () => {
      if (!textBar) {
        toast('先选中一段正文', 'info')
        return
      }
      addBookmarkAtCurrent()
      setTextBar(null)
    },
    'pdf.translateSelection': () => {
      if (!textBar) {
        toast('先选中一段正文', 'info')
        return
      }
      const line = textBar.text
      const around = (document.querySelector('.pdf-text-layer')?.textContent || '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 600)
      void runTranslate(line, around && around !== line ? [around] : [])
      setTextBar(null)
    },
    'pdf.translate': translateToggle
  })


  /* 正在编辑的标注（点覆盖层浮出编辑条） */
  const [editingMark, setEditingMark] = useState<{ id: string; x: number; y: number } | null>(null)

  const editTextMark = useCallback(
    (id: string, patch: { color?: string; style?: TextMarkStyle }): void => {
      setTextMarks((current) => {
        const next = current.map((mark) => (mark.id === id ? { ...mark, ...patch } : mark))
        recordStore.setTextHighlights(next)
        return next
      })
      toast(patch.style ? '已换样式' : '已换颜色', 'success')
    },
    [recordStore, toast]
  )

  const deleteTextMark = useCallback(
    (id: string): void => {
      setTextMarks((current) => {
        const next = current.filter((mark) => mark.id !== id)
        recordStore.setTextHighlights(next)
        return next
      })
      setEditingMark(null)
      toast('已删除这条标注', 'success')
    },
    [recordStore, toast]
  )

  const commitTextMark = useCallback(
    (mark: PdfTextHighlight): void => {
      setTextMarks((current) => {
        const next = [...current, mark]
        /* 立即落盘：标注是用户主动做的动作，不该等自动保存的节流窗口 */
        recordStore.setTextHighlights(next)
        return next
      })
    },
    [recordStore]
  )

  const markSelection = useCallback(
    (style: TextMarkStyle, color = '#f6d365'): void => {
      const current = textBar
      if (!current) return
      commitTextMark({
        id: `pm_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
        page: current.page,
        rects: current.rects,
        text: current.text,
        style,
        color,
        createdAt: Date.now()
      })
      setTextBar(null)
      window.getSelection()?.removeAllRanges()
      toast(style === 'underline' ? '已划线' : '已高亮', 'success')
    },
    [textBar, commitTextMark, toast]
  )

  const renderPage = (box: PageBox): ReactNode => (
    <PageView
      doc={doc}
      box={box}
      currentPage={currentPage}
      scrollMode={scrollMode}
      annotations={recordStore.record.annotations[String(box.page)] ?? []}
      settings={annotationSettings}
      searchRects={rectsByPage.get(box.page) ?? []}
      activeSearchRect={activeHitData && activeHitData.page === box.page ? activeHitData.rects[0] ?? null : null}
      // 只有左右翻页才走共享渲染队列：连续滚动 / 单页保持原样
      renderQueue={isFlipMode ? renderQueue : null}
      noteEditor={noteEditor}
      onNoteTextChange={(text) => setNoteEditor((current) => (current ? { ...current, text } : current))}
      onNoteCommit={commitNote}
      onNoteCancel={() => setNoteEditor(null)}
      registerPage={registerPage}
      onCommitStroke={commitStroke}
      onEraseStrokes={eraseStrokes}
      onRequestTextNote={requestTextNote}
      onEditTextNote={editTextNote}
      textHighlights={textMarks}
      onTextSelect={(payload) => setTextBar(payload)}
      onMarkClick={(id, anchor) => setEditingMark({ id, ...anchor })}
    />
  )

  /**
   * 跨页的一半：
   *  - 有页：正常的 PageView + 批注层（批注坐标是「相对单页归一化」的，左右两页各存各的，
   *    所以画在哪一半都落在正确的页码上）；
   *  - 缺页（双页模式下的第 1 页左侧 / 偶数总页数最后一个跨页的右侧）：留一块与另一页等大的
   *    空白，让跨页宽度稳定、看起来像摊开的书里那一侧本来就是空白。
   *    单页模式（facing = false）不留白：缺的那一半直接不渲染，舞台就是一页。
   */
  const renderHalf = (cells: SpreadCells, side: 'left' | 'right', facing: boolean): ReactNode => {
    const box = side === 'left' ? cells.left : cells.right
    if (box) {
      return (
        <div className={`pdf-flip-half is-${side}`}>
          {renderPage(box)}
          {facing && cells.left !== null && cells.right !== null && box.page === currentPage ? (
            <span className="pdf-flip-target" aria-label={`当前页：第 ${box.page} 页`}>
              第 {box.page} 页
            </span>
          ) : null}
        </div>
      )
    }
    if (!facing) return null
    const reference = side === 'left' ? cells.right : cells.left
    if (!reference) return null
    return (
      <div
        className={`pdf-flip-half is-${side} is-blank`}
        style={{ width: `${reference.width}px`, height: `${reference.height}px` }}
        aria-hidden="true"
      />
    )
  }

  const annotationToolColor = annotationSettings.color

  // 到头的那一侧不再给提示（按钮这时也是禁用的）
  const flipCueSide =
    flipHover === 'prev' && !canTurnPrev ? null : flipHover === 'next' && !canTurnNext ? null : flipHover

  const stageStyle: CSSProperties | undefined =
    isFlipMode && stageSize
      ? ({
          width: `${stageSize.width}px`,
          height: `${stageSize.height}px`,
          ['--flip-dur' as string]: `${FLIP_DURATION_MS}ms`,
          // 滑入滑出的距离：按舞台宽度算，纸叠一定能完整移出可视区
          ['--flip-shift' as string]: `${Math.round(stageSize.width + 48)}px`,
          ['--flip-gutter' as string]: `${FLIP_GUTTER}px`
        } as CSSProperties)
      : undefined

  if (status === 'loading' || status === 'idle') {
    return (
      <div className="pdf-root pdf-root-center">
        <IconFilePdf size={38} />
        <p className="pdf-loading-text">正在打开《{book.title}》…</p>
      </div>
    )
  }

  if (status === 'error') {
    return (
      <div className="pdf-root pdf-root-center">
        <div className="pdf-error-panel">
          <IconFilePdf size={40} />
          <h2>{book.title}</h2>
          <p className="dim">{loadError ?? '这个 PDF 打不开。'}</p>
          <p className="muted pdf-error-path" title={book.path}>
            {book.path}
          </p>
          <div className="pdf-error-actions">
            <Button size="md" variant="solid" icon={<IconExternalLink size={16} />} onClick={openExternal}>
              用系统应用打开
            </Button>
            <Button size="md" variant="outline" icon={<IconRefresh size={16} />} onClick={reload}>
              重试
            </Button>
          </div>
          {errorKind === 'password' ? (
            <p className="field-hint">提示：带密码的 PDF 需要先在别的工具里去掉密码再导入。</p>
          ) : null}
        </div>
      </div>
    )
  }

  return (
    <div className="pdf-root">
      <Toolbar
        page={currentPage}
        pageCount={pageCount}
        zoom={viewer.zoom}
        resolvedZoom={resolvedZoom}
        scrollMode={scrollMode}
        bookmarked={Boolean(bookmarkHere)}
        sidebarOpen={sidebarOpen}
        searchOpen={searchOpen}
        busy={searching}
        flipSpread={flipSpread}
        canPrev={canTurnPrev}
        canNext={canTurnNext}
        onGoToPage={goToPage}
        onStepPage={turnPage}
        onFlipSpreadChange={setFlipSpread}
        onZoomSelect={setZoom}
        onZoomStep={handleZoomStep}
        onScrollModeChange={handleScrollModeChange}
        onRotate={rotate}
        onToggleBookmark={() => void toggleBookmark()}
        onToggleSidebar={() => setSidebarOpen((open) => !open)}
        translateOpen={translateOpen}
        onToggleTranslate={translateToggle}
        onToggleSearch={handleToggleSearch}
        onOpenContainingFolder={openContainingFolder}
        onOpenExternal={openExternal}
        onExtractImages={() => setExtractOpen(true)}
      />

      <div className="pdf-body">
        <PdfSidebar
          open={sidebarOpen}
          tab={tab}
          width={sideLeft.width}
          onTabChange={(next) => {
            setTab(next)
            setSidebarOpen(true)
            if (next === 'search') setSearchOpen(true)
          }}
          doc={doc}
          record={recordStore.record}
          pageCount={pageCount}
          currentPage={currentPage}
          onJump={goToPage}
          outlineLoading={outlineLoading}
          onRefreshOutline={() => void fetchOutline()}
          onAddBookmark={addBookmarkAtCurrent}
          onRenameBookmark={renameBookmark}
          onDeleteBookmark={deleteBookmark}
          onRecolorBookmark={recolorBookmark}
          onNoteBookmark={noteBookmark}
          search={{
            query: searchQuery,
            hits,
            activeIndex: activeHit,
            searching,
            progress: searchProgress,
            onQueryChange: setSearchQuery,
            onPrev: () => jumpToHit(activeHit > 0 ? activeHit - 1 : hits.length - 1),
            onNext: () => jumpToHit(activeHit < hits.length - 1 ? activeHit + 1 : 0),
            onJump: jumpToHit,
            onClear: () => setSearchQuery(''),
            registerFocus: registerSearchFocus
          }}
        />

        {/* 左栏宽度拖手：贴在侧栏与正文之间 */}
        {sidebarOpen ? (
          <SideResizer
            side="left"
            value={sideLeft.width}
            min={sideLeft.min}
            max={sideLeft.max}
            onDrag={sideLeft.setWidth}
            onCommit={sideLeft.commit}
          />
        ) : null}

        <div className="pdf-main">
          <div
            className={['pdf-scroll', `is-${scrollMode}`].join(' ')}
            ref={(node) => {
              /* 两用：给 viewer 用，也给 Ctrl+滚轮的原生监听用 */
              wheelHostRef.current = node
              viewer.scrollRef(node)
            }}
          >
            <div
              className={[
                'pdf-pages',
                isFlipMode ? 'pdf-flip-stage' : '',
                isFlipMode && spreadPages ? 'is-spread' : '',
                flipStage.animating ? 'is-flipping' : '',
                flipStage.animating && flip.running ? 'is-running' : ''
              ]
                .filter(Boolean)
                .join(' ')}
              ref={setStage}
              data-flip={isFlipMode ? flipAnimation : undefined}
              data-dir={flipStage.dir ?? undefined}
              style={stageStyle}
            >
              {isFlipMode ? (
                <>
                  <button
                    type="button"
                    className="pdf-flip-zone is-prev"
                    aria-label={spreadPages ? '上一个跨页' : '上一页'}
                    title={spreadPages ? '上一个跨页（←）' : '上一页（←）'}
                    disabled={!canTurnPrev}
                    onPointerEnter={() => setFlipHover('prev')}
                    onPointerLeave={() => setFlipHover((current) => (current === 'prev' ? null : current))}
                    onClick={() => turnPage(-1)}
                  />
                  <button
                    type="button"
                    className="pdf-flip-zone is-next"
                    aria-label={spreadPages ? '下一个跨页' : '下一页'}
                    title={spreadPages ? '下一个跨页（→）' : '下一页（→）'}
                    disabled={!canTurnNext}
                    onPointerEnter={() => setFlipHover('next')}
                    onPointerLeave={() => setFlipHover((current) => (current === 'next' ? null : current))}
                    onClick={() => turnPage(1)}
                  />
                </>
              ) : null}

              {isFlipMode
                ? flipStage.spreads.map((spread) => {
                    const pair = spread.cells.left !== null && spread.cells.right !== null
                    return (
                      <div
                        key={spread.key}
                        className={[
                          'pdf-flip-spread',
                          `is-${spread.role}`,
                          pair ? 'is-pair' : ''
                        ]
                          .filter(Boolean)
                          .join(' ')}
                      >
                        {renderHalf(spread.cells, 'left', spreadPages)}
                        {renderHalf(spread.cells, 'right', spreadPages)}
                      </div>
                    )
                  })
                : sheets.map((box) => <Fragment key={box.page}>{renderPage(box)}</Fragment>)}

              {/* 提示层压在最上面：热区在纸张下面（这样便签还点得到），提示得单独画 */}
              {isFlipMode ? (
                <div className={`pdf-flip-hint is-${flipCueSide ?? 'none'}`} aria-hidden="true">
                  <IconChevronLeft size={30} className="pdf-flip-cue is-prev" />
                  <IconChevronRight size={30} className="pdf-flip-cue is-next" />
                </div>
              ) : null}

              {/*
                选中正文后的操作条（与 EPUB 同一个组件、同一排动作）。
                PDF 的"选中"来自 pdf.js 的文字层，见 PageView 的 onTextSelect。
              */}
              {/*
                点已有标注 → 与"选中"用的是**同一条**操作条（用户提的：以前两套按钮像两个功能），
                只是这里按钮的含义是"把这条改成这样"，另加删除与关闭。
              */}
              {editingMark && textMarks.some((mark) => mark.id === editingMark.id) ? (
                (() => {
                  const mark = textMarks.find((item) => item.id === editingMark.id)!
                  return (
                    <TextActionBar
                      anchor={{ x: editingMark.x, y: editingMark.y }}
                      current={{ style: mark.style, color: mark.color }}
                      excerpt={mark.text}
                      onCopy={() => {
                        void navigator.clipboard.writeText(mark.text).then(
                          () => toast('已复制这段原文', 'success'),
                          () => toast('复制失败', 'error')
                        )
                      }}
                      onMark={(style, color) => editTextMark(mark.id, color ? { style, color } : { style })}
                      onDelete={() => deleteTextMark(mark.id)}
                      onClose={() => setEditingMark(null)}
                    />
                  )
                })()
              ) : null}

              {textBar ? (
                <TextActionBar
                  anchor={textBar.anchor}
                  onCopy={() => {
                    void navigator.clipboard.writeText(textBar.text).then(
                      () => toast('已复制选中文字', 'success'),
                      () => toast('复制失败', 'error')
                    )
                    setTextBar(null)
                  }}
                  onMark={markSelection}
                  onBookmark={() => {
                    addBookmarkAtCurrent()
                    setTextBar(null)
                  }}
                  /* 翻译：上下文就用当前页文字层里的文字（PDF 没有"段落"这个概念） */
                  onTranslate={() => {
                    const line = textBar.text
                    const around = (document.querySelector('.pdf-text-layer')?.textContent || '')
                      .replace(/\s+/g, ' ')
                      .trim()
                      .slice(0, 600)
                    void runTranslate(line, around && around !== line ? [around] : [])
                    setTextBar(null)
                  }}
                />
              ) : null}
            </div>
          </div>

          <div className="pdf-statusbar">
            <span className="tabular">
              {currentPage} / {pageCount} 页
            </span>
            {currentCells?.left && currentCells.right ? (
              <>
                <span className="pdf-status-sep" />
                <span className="pdf-status-spread tabular">
                  跨页 {currentCells.left.page}–{currentCells.right.page}
                </span>
              </>
            ) : null}
            <span className="pdf-status-sep" />
            <span>{Math.round(resolvedZoom * 100)}%</span>
            <span className="pdf-status-sep" />
            <span>{rotation === 0 ? '未旋转' : `旋转 ${rotation}°`}</span>
            <span className="pdf-status-grow" />
            <span className="pdf-status-hint">
              {annotationSettings.tool === 'select'
                ? isFlipMode
                  ? spreadPages
                    ? '左右翻页（双页）：← / → 翻一个跨页，点击页面左右两侧也能翻'
                    : '左右翻页：← / → 或点击页面左右两侧翻页'
                  : '手型模式：滚动与翻页不受影响'
                : '绘制中：Esc 回到手型模式'}
            </span>
            {pendingScrollPage !== null ? <span className="pdf-status-hint">定位中…</span> : null}
          </div>

          <div className="pdf-anno-bar-host">
            <AnnotationToolbar
              tool={annotationSettings.tool}
              color={annotationToolColor}
              width={annotationSettings.width}
              onToolChange={(tool) => setAnnotationSettings((current) => ({ ...current, tool }))}
              onColorChange={(color) => setAnnotationSettings((current) => ({ ...current, color }))}
              onWidthChange={(width) => setAnnotationSettings((current) => ({ ...current, width }))}
              onUndo={undo}
              onClearPage={clearPage}
              onExport={() => void exportAnnotated()}
              canUndo={(undoStacks.current.get(currentPage)?.length ?? 0) > 0}
              canClear={pageStrokes.length > 0}
              exporting={exporting}
            />
          </div>
        </div>

        {/* 翻译栏在**最右**：左边是缩略图/目录/书签栏，右边是它 */}
        {translateOpen ? <TranslatePanel /> : null}
      </div>

      <ExtractImagesModal
        open={extractOpen}
        onClose={() => setExtractOpen(false)}
        doc={doc}
        pageCount={pageCount}
        currentPage={currentPage}
        bookTitle={book.title}
      />
    </div>
  )
}
