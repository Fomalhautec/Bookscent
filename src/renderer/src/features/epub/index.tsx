import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type {
  Book,
  BookRecord,
  EpubSpread,
  EpubWritingMode,
  TextHighlight,
  TextMarkStyle
} from '@shared/types'
import { appApi, filesApi, libraryApi } from '@/lib/api'
import { useSettings } from '@/store/useSettings'
import { useUi } from '@/store/useUi'
import { reportPageTurn } from '@/lib/usage'
import { useBookmarkTarget } from '@/lib/bookmarkTarget'
import { useBookmarks } from '@/lib/useBookmarks'
import type { Bookmark } from '@shared/types'
import { ReaderSidebar } from '@/features/reader/ReaderSidebar'
import { Button, IconButton, Select, Spinner, Tooltip } from '@/components/common/Controls'
import {
  IconArrowLeft,
  IconArrowRight,
  IconBookmarkFilled,
  IconBookOpen,
  IconColumns,
  IconExternalLink,
  IconGlobe,
  IconVolume,
  IconImage,
  IconImageExtract,
  IconInfo,
  IconMinus,
  IconPlus,
  IconRows,
  IconTextCursor
} from '@/components/icons/Icons'
import { TextActionBar } from '@/components/common/TextActionBar'
import { TranslatePanel } from '@/features/reader/TranslatePanel'
import { TtsBar } from '@/features/reader/TtsBar'
import {
  clearSentenceHighlight,
  highlightSentence,
  injectHighlightStyle,
  sectionSentences,
  selectionText,
  sentenceIndexAt
} from './ttsMark'
import { useTts } from '@/store/useTts'
import { SideResizer } from '@/components/common/SideResizer'
import { useShortcuts } from '@/lib/useShortcuts'
import { useSideWidth } from '@/lib/useSideWidth'
import { useTranslate } from '@/store/useTranslate'
import { applyBookmarkMarks, bookmarkMarkStyles } from './bookmarkMarks'
import { ExportImagesModal } from './ExportImagesModal'
import { EpubGallery } from './EpubGallery'
import {
  DEFAULT_TEXT_MARK_COLOR,
  applyHighlights,
  clearHighlights,
  makeHighlight,
  selectionToRange,
  textMarkStyles
} from './textMarks'
import {
  attachStyleInjector,
  flattenToc,
  loadFoliate,
  readingStyles,
  textOf,
  type FoliateBook,
  type FoliateLocation,
  type FoliateView,
  type WritingMode
} from './foliate'

/**
 * 书页配色。
 *
 * `auto`（默认）跟着应用主题走 —— 和笔记的编辑器保持一致：换深色主题，
 * 书页也变暗，同时接管正文里写死的颜色，保证字还看得清。
 * 另外三档是明确的手动指定，与应用主题无关。
 */
type ReadTheme = 'auto' | 'original' | 'paper' | 'night'
type Flow = 'paginated' | 'scrolled'

const THEME_OPTIONS: { value: ReadTheme; label: string }[] = [
  { value: 'auto', label: '跟随应用主题' },
  { value: 'original', label: '保持原样' },
  { value: 'paper', label: '纸色' },
  { value: 'night', label: '夜间' }
]

/** 纸色/夜间两档的固定配色（auto 与 original 由别处决定） */
const FIXED_PALETTE: Record<'paper' | 'night', { background: string; color: string }> = {
  paper: { background: '#f6f0e4', color: '#2b2318' },
  night: { background: '#1b1d21', color: '#d8d3c8' }
}

/* 边框距离 / 行距 / 段首缩进的档位（0 = 不干预，用书自己的排版） */
const MARGIN_OPTIONS = [
  { value: 16, label: '窄' },
  { value: 36, label: '中' },
  { value: 64, label: '宽' }
]
const INDENT_OPTIONS = [
  { value: 0, label: '书' },
  { value: 2, label: '缩' }
]

const WRITING_OPTIONS: { value: EpubWritingMode; label: string }[] = [
  { value: 'auto', label: '书' },
  { value: 'horizontal', label: '横' },
  { value: 'vertical', label: '竖' }
]

/** 一栏的宽度上限：一行 30–40 字最好读，也就是 A5 那个量级 */
const MAX_INLINE_SIZE = 620

/**
 * EPUB 阅读器（foliate-js）。
 *
 * 为什么换成 foliate-js：分页这件事（分栏、书脊沟、单双页、竖排的推进方向、
 * 翻页步距）自己写了两版都有坑。foliate 的 `<foliate-paginator>` 是从成熟
 * 阅读器里长出来的，这些它都管，而且是纯 ESM，没有构建步骤。
 *
 * 它与界面只有几个约定：
 *   - `book.transformTarget` 的 `data` 事件 —— 能在文档被解析**之前**改内容。
 *     我们用它注入排版方向：分页器是在 iframe load 时读 body 的 writing-mode
 *     来决定横竖的，晚了这一节就按旧方向排了。
 *   - view 元素上的 `load` / `relocate` 事件
 *   - `renderer.setStyles()`，以及 `setAttribute('flow' | 'max-column-count' …)`
 *     注意：分页器的参数**只有 HTML 属性，没有 JS 属性 API**。
 */
/**
 * 把阅读样式写进每个**已经加载**的章节。
 *
 * 为什么不用 `renderer.setStyles()`：这个 foliate 构建没有那个 API，调了是静默无效 ——
 * 于是换主题、调字号时只有新加载的章节是新样式，眼前这一页还是旧配色
 * （深色底配黑字，用户就是这么撞上的）。真正生效的是改章节 HTML 里那个
 * `<style data-bookscent="reader">`。
 */
function applyStylesToSections(view: FoliateView, css: string): void {
  const contents = (view.renderer?.getContents?.() ?? []) as { doc?: Document }[]
  for (const content of contents) {
    const doc = content?.doc
    if (!doc) continue
    let tag = doc.querySelector('style[data-bookscent="reader"]')
    if (!tag) {
      tag = doc.createElement('style')
      tag.setAttribute('data-bookscent', 'reader')
      doc.head?.appendChild(tag)
    }
    tag.textContent = css
  }
}

export function EpubView({ book }: { book: Book }): ReactNode {
  const settings = useSettings((s) => s.settings)
  const patch = useSettings((s) => s.patch)
  const toast = useUi((s) => s.toast)

  const [status, setStatus] = useState<'loading' | 'ready' | 'failed'>('loading')
  const [error, setError] = useState<string | null>(null)
  const [meta, setMeta] = useState({ title: '', author: '' })
  const [toc, setToc] = useState<{ label: string; href: string; depth: number }[]>([])
  const [tocOpen, setTocOpen] = useState(true)
  const [theme, setTheme] = useState<ReadTheme>('auto')
  /*
   * 字号与行距**直接读 ui 设置**（不再另存一份本地 state）。
   * 两份状态就会出现"改了这个、那个还是旧值"，而且换书、重开都会忘 ——
   * 这两个本来就是长期偏好，放进设置里最合适。
   */
  const scale = settings?.ui.epubFontSize ?? 1
  const setScale = (updater: number | ((value: number) => number)): void => {
    const next = typeof updater === 'function' ? updater(scale) : updater
    patchFont({ epubFontSize: Math.min(2.4, Math.max(0.6, Math.round(next * 20) / 20)) })
  }
  /* 字号 / 字体 / 行距：都存在 ui 设置里，换书、重开都记得 */
  const fontFamily = settings?.ui.epubFontFamily ?? ''
  const patchFont = (next: {
    epubFontSize?: number
    epubFontFamily?: string
    epubLineHeight?: number
    epubIndent?: number
  }): void => {
    void patch({ ui: next })
  }
  /* 正文两套可选字体：衬线偏"纸书"，黑体偏"屏幕"；楷体给中文长文 */
  const FONT_OPTIONS: { value: string; label: string; stack: string }[] = [
    { value: '', label: '书', stack: '' },
    { value: 'serif', label: '衬线', stack: 'Georgia, "Songti SC", "SimSun", serif' },
    { value: 'sans', label: '黑体', stack: '"PingFang SC", "Microsoft YaHei", system-ui, sans-serif' },
    { value: 'kai', label: '楷体', stack: '"Kaiti SC", "KaiTi", "STKaiti", serif' }
  ]

  /* 行距同样从设置里读；0 = 跟随书籍 */
  const lineHeight = settings?.ui.epubLineHeight ?? 0
  const setLineHeight = (value: number): void => patchFont({ epubLineHeight: value })
  /* 段首缩进同样从设置读，允许负数（缩回） */
  const indent = settings?.ui.epubIndent ?? 0
  const setIndent = (value: number): void => patchFont({ epubIndent: value })
  /* 书页四周的留白（边框距离） */
  const [margin, setMargin] = useState(36)
  /* 左侧栏开合与当前栏（「目录」按钮要能切换它） */
  const [sideOpen, setSideOpen] = useState(true)
  const [sideTab, setSideTab] = useState<'toc' | 'bookmarks' | 'notes'>('toc')
  /* 排版弹层 */
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement | null>(null)

  /* 排版弹层：点别处或按 Esc 关掉 */
  useEffect(() => {
    if (!menuOpen) return
    const onDown = (event: MouseEvent): void => {
      const target = event.target as Node | null
      if (target && !menuRef.current?.contains(target)) setMenuOpen(false)
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setMenuOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [menuOpen])
  const [flow, setFlow] = useState<Flow>('paginated')
  const [activeHref, setActiveHref] = useState<string | null>(null)
  const [position, setPosition] = useState({ fraction: 0, index: 0 })
  /**
   * 当前这一节文档的实际排版方向。
   *
   * 这些值必须和**分页器自己的判定**一致（它读 body 的计算样式），
   * 否则"点击左边是下一页"就会和实际的分栏方向对不上。
   * 原始字符串留着，出问题时能一眼看出到底量到了什么。
   */
  const [docWriting, setDocWriting] = useState('')
  const [docVertical, setDocVertical] = useState(false)
  /**
   * 这本书确认过的竖排状态。
   * 纯图片章节（轻小说开头常有一堆插图）往往不声明 writing-mode，量出来是横排 ——
   * 那时要沿用这本书已确认的朝向，否则整节的翻页方向都会反。
   */
  const bookVerticalRef = useRef(false)
  const [docRtl, setDocRtl] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  /* 翻译栏（右侧）与它的开关 */
  /* 朗读：把当前这一节按段落切成句子 → 交给朗读引擎 */
  const ttsPlay = useTts((s) => s.play)
  const ttsPlaying = useTts((s) => s.playing)
  const ttsSegments = useTts((s) => s.segments)
  const ttsIndex = useTts((s) => s.index)
  const ttsOpen = useTts((s) => s.open)
  const setTtsOpen = useTts((s) => s.setOpen)
  const setTtsBoundary = useTts((s) => s.setBoundary)

  /* 左栏（目录/书签/笔记）与右栏（翻译）的宽度都可拖 */
  const sideLeft = useSideWidth('left')

  const translateOpen = useTranslate((s) => s.open)
  const translateToggle = useTranslate((s) => s.toggle)
  const runTranslate = useTranslate((s) => s.run)

  /* 相册式看图器（独立于导出弹窗） */
  const [galleryOpen, setGalleryOpen] = useState(false)
  const [exportDir, setExportDir] = useState<string | null>(null)

  const hostRef = useRef<HTMLDivElement | null>(null)
  const viewRef = useRef<FoliateView | null>(null)
  /**
   * 章节渲染完要做的事（画标注 + 接选区监听）。
   * wireView 里的 load 回调注册得早、拿不到后面的闭包，所以走 ref 取最新那份。
   */
  const wireSectionDocRef = useRef<((doc: Document, section: number) => void) | null>(null)
  /* 快捷键处理函数（章节 iframe 里也要用同一份，见 wireSectionDoc） */
  const keyHandlerRef = useRef<((event: KeyboardEvent) => void) | null>(null)
  /* 当前这一节里命中的书签数量（决定要不要显示页边色带） */
  const [bookmarkHits, setBookmarkHits] = useState(0)
  /* 正在编辑的标注（点标注浮出编辑条） */
  const [editingMark, setEditingMark] = useState<{ id: string; x: number; y: number } | null>(null)
  const bookRef = useRef<FoliateBook | null>(null)
  const detachRef = useRef<(() => void) | null>(null)
  const recordRef = useRef<BookRecord | null>(null)

  const writingMode: EpubWritingMode = settings?.ui.epubWritingMode ?? 'auto'
  const spread: EpubSpread = settings?.ui.epubSpread ?? 'double'
  const mode = toWritingMode(writingMode)

  /*
   * 阅读方向一律看**渲染出来的文档**，不看 OPF 的 page-progression-direction。
   *
   * 分页器的分栏方向是它自己从文档算的（writing-mode 是不是竖排、dir 是不是 rtl），
   * 而 foliate 的 goLeft/goRight 只看 OPF —— 两者不一致时按钮就会和版面打架，
   * 用户遇到的"原生竖排书点下一页往回翻"正是这么来的。
   * 点击区/方向键必须跟版面走，所以这里和分页器用同一套判断。
   */
  const verticalNow = mode === 'vertical' || (mode === 'auto' && docVertical)
  /*
   * 阅读方向也要跟着**用户指定的方向**走。
   * 以前这里是 `docVertical || docRtl`：书本身竖排、用户却强制横排时 rtl 仍是 true，
   * 翻页方向就反着来 —— 用户看到的是"点下一页来回翻"。
   */
  const rtl = mode === 'vertical' ? true : mode === 'horizontal' ? docRtl : docVertical || docRtl

  /**
   * 当前该注入的阅读样式（transformTarget 与 setStyles 共用同一份）。
   *
   * 应用主题的纸面/文字色每次现读 —— 用户换肤后书页要跟着变，
   * 所以这里不缓存，读的是 <html> 上实时的 CSS 变量。
   */
  const stylesFor = useCallback(
    (target: WritingMode): string => {
      const cs = getComputedStyle(document.documentElement)
      const read = (name: string, fallback: string): string => cs.getPropertyValue(name).trim() || fallback
      return (
        readingStyles({
          mode: target,
          scale,
          theme,
          appSurface: read('--bg-surface', '#ffffff'),
          appInk: read('--text-primary', '#2b2318'),
          appLink: read('--accent', '#8a4b3a'),
          dark: document.documentElement.dataset.dark === 'true',
          fixed: FIXED_PALETTE[theme === 'night' ? 'night' : 'paper'],
          lineHeight,
          indent,
          /* 字体族：'' = 跟随书籍（选项里的 stack 为空） */
          fontFamily: FONT_OPTIONS.find((option) => option.value === fontFamily)?.stack ?? ''
        }) +
        /* 文字标注（高亮 / 划线）的样式跟着阅读样式一起注入每个章节 */
        textMarkStyles() +
        /* 书签标记的样式也一起注入 */
        bookmarkMarkStyles()
      )
    },
    [scale, theme, lineHeight, indent, fontFamily]
  )

  /** 上一次记过的页位置，用来判断"这次 relocate 是不是真的翻页了" */
  const lastPageKey = useRef('')
  /* 书签的定位要读最新值，但注册只发生一次 —— 用 ref 兜住 */
  const positionRef = useRef(position.fraction)
  positionRef.current = position.fraction
  const activeHrefRef = useRef<string | null>(activeHref)
  activeHrefRef.current = activeHref

  /*
   * 书签：EPUB 用 CFI 定位（换字号、换单双页都不会漂），
   * 不像文本类只能记滚动比例。章节名与百分比拿来当说明。
   */
  useBookmarkTarget({
    anchor: () => {
      const location = viewRef.current?.lastLocation
      const cfi = location?.cfi
      if (!cfi) return null
      return { kind: 'cfi', cfi, fraction: location?.fraction ?? 0 }
    },
    goTo: (anchor) => {
      const view = viewRef.current
      if (!view) return
      if (anchor.kind === 'cfi') void view.goTo(anchor.cfi).catch(() => undefined)
      else if (anchor.kind === 'scroll') void view.goToFraction(anchor.ratio).catch(() => undefined)
      else void view.goToFraction(positionRef.current).catch(() => undefined)
    },
    describe: () => {
      const location = viewRef.current?.lastLocation
      const percent = Math.round((location?.fraction ?? 0) * 100)
      const chapter = activeHrefRef.current
        ? toc.find((item) => item.href === activeHrefRef.current)?.label
        : undefined
      return {
        page: (location?.index ?? 0) + 1,
        label: `${chapter ? `${chapter} · ` : ''}${percent}%`,
        excerpt: meta.title
      }
    }
  })

  /** 把 view 的事件接上（重开 view 时也要接一次） */
  const wireView = useCallback((view: FoliateView): void => {
    view.addEventListener('relocate', (event) => {
      const detail = (event as CustomEvent<FoliateLocation>).detail
      if (!detail) return
      setPosition({ fraction: detail.fraction ?? 0, index: detail.index ?? 0 })
      if (detail.tocItem?.href) setActiveHref(detail.tocItem.href)
      /*
       * 阅读页数：relocate 在滚动时也会零星触发，只有"页位置真的变了"才算翻页，
       * 否则慢慢滚动会把页数刷成几百。
       */
      const key = `${detail.index ?? 0}:${Math.round((detail.fraction ?? 0) * 200)}`
      if (key !== lastPageKey.current) {
        lastPageKey.current = key
        reportPageTurn(book.id)
      }
    })
    view.addEventListener('load', (event) => {
      // 换节后样式表是新建的，得重新写一遍
      applyStylesToSections(view, latestStyles.current)
      const doc = (event as CustomEvent<{ doc?: Document }>).detail?.doc
      if (!doc) return
      /*
       * 章节渲染完：把这一章已存的标注画上，并接上选区监听。
       * 章节下标要从 renderer 的 contents 里反查（load 事件只给 doc）。
       */
      const section = view.renderer?.getContents?.().find((c) => c.doc === doc)?.index ?? 0
      wireSectionDocRef.current?.(doc, section)
      /*
       * writing-mode 是继承属性，书的样式表可能写在 html 上、也可能写在 body 上，
       * 所以两处都量一遍，取到竖排就用竖排。
       */
      const view$ = doc.defaultView
      const modes = [doc.documentElement, doc.body]
        .filter(Boolean)
        .map((el) => view$?.getComputedStyle(el as Element).writingMode ?? '')
      setDocWriting(modes.filter(Boolean).join(' | '))
      /*
       * 竖排判定要**带书级兜底**。
       *
       * 纯图片章节（轻小说开头常有一堆插图）往往没有文字、也不声明 writing-mode，
       * 于是这里量到 horizontal-tb，把整本书的竖排判定带跑偏 —— 翻页方向跟着反过来，
       * 读起来就像"只有这一节是横排书"。
       *
       * 兜底分两层：
       *   1. 这本书已经确认过的朝向（bookVerticalRef，本次会话内）；
       *   2. 记录里存下的朝向（epubVertical）——封面/插图页在正文之前，
       *      只靠第 1 层根本来不及，所以结论要记在书上，下次开书就对了。
       */
      const declaredVertical = modes.some((value) => value.startsWith('vertical'))
      const declaredHorizontal = modes.some((value) => value.startsWith('horizontal'))
      const hasText = (doc.body?.textContent ?? '').trim().length > 24
      /*
       * 只让**有正文**的章节来决定这本书的朝向：
       * 插图页常常自带一个 horizontal-tb，让它发言会把竖排书带偏。
       */
      if (hasText && declaredVertical) {
        bookVerticalRef.current = true
        const base = recordRef.current
        if (base && base.epubVertical !== true) {
          recordRef.current = { ...base, epubVertical: true }
        }
      } else if (hasText && declaredHorizontal && !bookVerticalRef.current) {
        bookVerticalRef.current = false
        const base = recordRef.current
        if (base && base.epubVertical !== false) {
          recordRef.current = { ...base, epubVertical: false }
        }
      }
      /*
       * 没有文字的页面（封面、插图）**不让它自己发言**。
       *
       * 那些页面往往自带一个 horizontal-tb —— 这正是"竖排书里插图页被认成横排"的根因。
       * 它们跟随这本书的朝向（来自有正文的章节，并已记进记录）。
       */
      setDocVertical(
        hasText
          ? declaredVertical
            ? true
            : declaredHorizontal
              ? false
              : bookVerticalRef.current
          : bookVerticalRef.current
      )
      const htmlDir = doc.documentElement?.dir ?? ''
      const bodyDir = doc.body?.dir ?? ''
      const bodyDirection = doc.body ? view$?.getComputedStyle(doc.body).direction ?? '' : ''
      setDocRtl(htmlDir === 'rtl' || bodyDir === 'rtl' || bodyDirection === 'rtl')
    })
  }, [])

  /** 给 load 事件用：它拿不到最新的闭包，就用一个 ref 兜住 */
  const latestStyles = useRef('')

  /**
   * 建 view 并打开书。
   *
   * `target` 单独传进来而不是读 state：切换排版方向时要先关掉旧 view、
   * 用新样式重新注入再打开，这一次开的必须用新值，不能等 state 刷新。
   */
  const mountView = useCallback(
    async (view: FoliateView, target: WritingMode, lastLocation: string | null): Promise<void> => {
      const foliateBook = bookRef.current
      if (!foliateBook) return
      const css = stylesFor(target)
      latestStyles.current = css
      detachRef.current?.()
      detachRef.current = attachStyleInjector(foliateBook, () => latestStyles.current)
      await view.open(foliateBook)
      applyStylesToSections(view, css)
      applyRendererAttributes(view, { flow, spread, mode: target, margin })
      // init 会解构参数，所以没位置可恢复时也要给个空对象
      await view.init(lastLocation ? { lastLocation } : {})
    },
    [flow, spread, stylesFor]
  )

  /* ------------------------------------------------------------ 载入 */

  useEffect(() => {
    let cancelled = false
    setStatus('loading')
    setError(null)

    void (async () => {
      try {
        const [mod, record] = await Promise.all([
          loadFoliate(),
          libraryApi.record(book.id).catch(() => null)
        ])
        if (cancelled) return
        recordRef.current = record
        /* 书级朝向：开书就生效，封面/插图页也按它处理 */
        if (typeof record?.epubVertical === 'boolean') bookVerticalRef.current = record.epubVertical
        /* 已存的文字标注：画到章节里、供选择工具条读写 */
        setHighlights(record?.highlights ?? [])

        const bytes = await filesApi.readBinary(book.path)
        if (cancelled) return
        const file = new File([bytes as unknown as BlobPart], fileNameOf(book.path), {
          type: 'application/epub+zip'
        })
        const foliateBook = await mod.makeBook(file)
        if (cancelled) return
        if (!foliateBook.sections?.length) {
          setStatus('failed')
          setError('这本书里没有找到可读的章节。可能是加密的 EPUB，或者结构不标准。')
          return
        }
        bookRef.current = foliateBook
        setMeta({
          title: textOf(foliateBook.metadata?.title) || book.title,
          author: textOf(foliateBook.metadata?.author)
        })
        setToc(flattenToc(foliateBook.toc))

        const host = hostRef.current
        if (!host) return
        const view = document.createElement('foliate-view') as FoliateView
        view.className = 'epub-foliate'
        viewRef.current = view
        wireView(view)
        host.append(view)

        await mountView(view, toWritingMode(settings?.ui.epubWritingMode ?? 'auto'), record?.progress.cfi ?? null)
        if (cancelled) return
        setStatus('ready')
      } catch (err) {
        if (cancelled) return
        setStatus('failed')
        setError((err as Error).message)
      }
    })()

    return () => {
      cancelled = true
      detachRef.current?.()
      detachRef.current = null
      const view = viewRef.current
      if (view) {
        try {
          view.close()
        } catch {
          /* 关不掉就算了，元素会跟着卸载一起没 */
        }
        view.remove()
      }
      viewRef.current = null
      bookRef.current = null
    }
    // 换书才重建；样式与排版方向走下面各自的分支
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book.id, book.path])

  /* ------------------------------- 字号 / 主题 / 单双页 / 翻页与滚动 */

  useEffect(() => {
    const view = viewRef.current
    if (status !== 'ready' || !view) return
    const css = stylesFor(mode)
    latestStyles.current = css
    applyStylesToSections(view, css)
    /*
     * 留白（边框距离）也要在这里重设：它走的是渲染器属性而不是样式，
     * 不重新 setAttribute 的话要翻到下一节才生效 —— 拖滑杆时看着像没反应。
     */
    applyRendererAttributes(view, { flow, spread, mode, margin })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scale, theme, flow, spread, status, lineHeight, indent, margin])

  /*
   * 换排版方向必须重开。
   *
   * 分页器是在 iframe 载入时读 body 的 writing-mode 来决定横排/竖排的，
   * 而"同一节"不会重新载入，所以只改样式它不会重新判定，翻页方向还是旧的。
   * 做法：记住当前 CFI → 关掉 view → 用新样式重新注入并打开 → 回到原处。
   */
  const appliedMode = useRef<WritingMode>(mode)
  useEffect(() => {
    if (status !== 'ready' || mode === appliedMode.current) return
    const host = hostRef.current
    const old = viewRef.current
    if (!host || !old) return
    appliedMode.current = mode
    const cfi = old.lastLocation?.cfi ?? null
    void (async () => {
      try {
        old.close()
        old.remove()
        const fresh = document.createElement('foliate-view') as FoliateView
        fresh.className = 'epub-foliate'
        wireView(fresh)
        viewRef.current = fresh
        host.append(fresh)
        await mountView(fresh, mode, cfi)
        toast(
          mode === 'vertical' ? '已切为竖排' : mode === 'horizontal' ? '已切为横排' : '已跟随书籍排版',
          'success'
        )
      } catch (err) {
        toast('切换排版方向失败', 'error', (err as Error).message)
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, status])

  /* --------------------------------------------------------- 进度记录 */

  useEffect(() => {
    if (status !== 'ready') return
    const id = window.setTimeout(() => {
      const view = viewRef.current
      const base = recordRef.current
      const next: BookRecord = {
        bookId: book.id,
        progress: {
          // page 沿用 PDF 那边的 1 起算约定
          page: position.index + 1,
          scrollRatio: position.fraction,
          zoom: scale,
          rotation: 0,
          cfi: view?.lastLocation?.cfi
        },
        bookmarks: base?.bookmarks ?? [],
        annotations: base?.annotations ?? {},
        /*
         * 必须把标注带上：进度是每 800ms 自动存一次的，
         * 这里漏了 highlights 就会把刚画的高亮立刻抹掉（PDF 那边以前也踩过同一类坑）。
         */
        highlights: base?.highlights ?? [],
        /* 同样必须带上，否则每次自动保存都把朝向结论抹掉 */
        epubVertical: base?.epubVertical,
        outline: base?.outline ?? [],
        updatedAt: Date.now()
      }
      recordRef.current = next
      void libraryApi.saveRecord(next).catch(() => undefined)
    }, 800)
    return () => window.clearTimeout(id)
  }, [status, position.index, position.fraction, scale, book.id])

  /* ------------------------------------------------------ 正文文字操作 */
  /*
   * 选中正文 → 复制 / 高亮 / 划线 / 标记书签。
   *
   * 选区定位走"章节下标 + 正文文本偏移"（见 textMarks.ts 的说明），
   * 不用 CFI：foliate 只稳定提供"Range → CFI"，反过来的 API 各版本不一样。
   * 高亮随 record.highlights 持久化，切章 / 重开 / 换字号都会重新画上。
   */
  const [highlights, setHighlights] = useState<TextHighlight[]>([])
  const highlightsRef = useRef<TextHighlight[]>([])
  highlightsRef.current = highlights
  /* 书签能力：工具条上的「标记书签」与侧栏用的是同一份实现 */
  const marks = useBookmarks(book)
  /* wireSectionDoc 的闭包要能拿到最新书签清单 */
  const marksRef = useRef<Bookmark[]>([])
  marksRef.current = marks.list

  const [selectionBar, setSelectionBar] = useState<{
    x: number
    y: number
    section: number
    range: { start: number; end: number; text: string; plain: string; clean: string }
    /** 前后各若干段：翻译要带上，代词与省略主语才不至于译飞 */
    context: string[]
  } | null>(null)
  /* 上下文段数（设置里可调）：wireSectionDoc 的闭包是空的，用 ref 兜住最新值 */
  const contextSizeRef = useRef(settings?.translate.contextSize ?? 2)
  contextSizeRef.current = settings?.translate.contextSize ?? 2

  /** 记下标注：既更新界面，也写进记录（从 recordRef 出发，别覆盖别的字段） */
  const persistHighlights = useCallback(
    (next: TextHighlight[]): void => {
      setHighlights(next)
      const base = recordRef.current
      if (!base) return
      const merged: BookRecord = { ...base, highlights: next, updatedAt: Date.now() }
      recordRef.current = merged
      void libraryApi.saveRecord(merged).catch(() => undefined)
    },
    []
  )

  const markSelection = useCallback(
    (style: TextMarkStyle, color = DEFAULT_TEXT_MARK_COLOR): void => {
      const current = selectionBar
      if (!current) return
      const mark = makeHighlight(current.section, current.range, style, color)
      /* 就地画上，不等下次切章 */
      const doc = viewRef.current?.renderer?.getContents?.()?.find((c) => c.index === current.section)?.doc
      if (doc) applyHighlights(doc, current.section, [mark])
      persistHighlights([...highlightsRef.current, mark])
      setSelectionBar(null)
      window.getSelection()?.removeAllRanges()
      toast(style === 'underline' ? '已划线' : style === 'wavy' ? '已加波浪线' : '已高亮', 'success')
    },
    [selectionBar, persistHighlights, toast]
  )

  /* ------------------------------------------------ 编辑已有的标注 */
  /*
   * 以前标注是"一次性"的：划完就定死，颜色也改不了。
   * 现在点标注本身（整条都能点，见 #8）浮出 MarkEditBar，改颜色 / 换样式 / 删除都在那儿。
   */
  const editMark = useCallback(
    (id: string, patch: Partial<Pick<TextHighlight, 'color' | 'style'>>): void => {
      const next = highlightsRef.current.map((mark) =>
        mark.id === id ? { ...mark, ...patch } : mark
      )
      persistHighlights(next)
      toast(patch.style ? '已换样式' : '已换颜色', 'success')
    },
    [persistHighlights, toast]
  )

  const deleteMark = useCallback(
    (id: string): void => {
      persistHighlights(highlightsRef.current.filter((mark) => mark.id !== id))
      setEditingMark(null)
      toast('已删除这条标注', 'success')
    },
    [persistHighlights, toast]
  )

  const copySelection = useCallback((): void => {
    /*
     * 复制走"去掉振假名"的那一份。
     * 日文书里 <ruby>剥<rt>む</rt>き出し</ruby> 的读音会混进纯文本，
     * 复制出来变成「剥むき出だし」这类东西 —— 粘到别处就是错的。
     */
    const text = selectionBar?.range.plain || selectionBar?.range.text || ''
    if (!text) return
    void navigator.clipboard.writeText(text).then(
      () => toast('已复制选中文字', 'success'),
      () => toast('复制失败', 'error')
    )
    setSelectionBar(null)
  }, [selectionBar, toast])

  /**
   * 章节渲染完 → 画上这一章的标注，并接上选区监听。
   * 每个章节是独立的 iframe 文档，所以监听要挂在各自的 doc 上。
   */
  const wireSectionDoc = useCallback((doc: Document, section: number): void => {
    applyHighlights(doc, section, highlightsRef.current)
    /* 书签也要看得见：把加了书签的那段文字标出来 */
    const hits = applyBookmarkMarks(doc, marksRef.current)
    if (hits > 0) setBookmarkHits(hits)
    const onSelect = (): void => {
      const selection = doc.getSelection()
      if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
        setSelectionBar(null)
        return
      }
      const range = selection.getRangeAt(0)
      const picked = selectionToRange(doc, range)
      if (!picked) {
        setSelectionBar(null)
        return
      }
      /* 工具条贴着选区：把 iframe 在窗口里的位置补上，否则会飘到左上角 */
      const rect = range.getBoundingClientRect()
      const frame = doc.defaultView?.frameElement?.getBoundingClientRect()
      /*
       * 顺带把上下文取下来（前后各 N 段）。
       * 用 DOM 的兄弟节点取，而不是按纯文本切段 —— 后者分不出真正的段落边界。
       */
      const block =
        (range.startContainer.parentElement as HTMLElement | null)?.closest(
          'p, li, blockquote, dd, h1, h2, h3, h4, h5, h6, div'
        ) ?? null
      const context: string[] = []
      if (block) {
        const size = Math.max(0, contextSizeRef.current)
        const before: string[] = []
        for (let el = block.previousElementSibling; el && before.length < size; el = el.previousElementSibling) {
          const text = (el.textContent ?? '').trim()
          if (text) before.unshift(text.slice(0, 500))
        }
        const after: string[] = []
        for (let el = block.nextElementSibling; el && after.length < size; el = el.nextElementSibling) {
          const text = (el.textContent ?? '').trim()
          if (text) after.push(text.slice(0, 500))
        }
        context.push(...before, ...after)
      }
      setSelectionBar({
        x: (frame?.left ?? 0) + rect.left + rect.width / 2,
        y: (frame?.top ?? 0) + rect.top,
        section,
        /*
         * 顺手存一份"去掉振假名"的文本：`range.toString()` 会把 `<rt>` 的读音也算进去
         * （这本书是 <ruby>詩<rt>し</rt>暮<rt>ぐれ</rt></ruby>，取到的是"詩し暮ぐれ"），
         * 拿它和句子比对永远对不上。此刻 live range 还在手上，是唯一能精确剔除的时机。
         */
        range: { ...picked, clean: selectionText(range) },
        context
      })
    }
    doc.addEventListener('mouseup', onSelect)
    doc.addEventListener('selectionchange', onSelect)
    /*
     * 点已有标注 → 浮出编辑条（改颜色 / 换样式 / 删除）。
     *
     * 点**整条**都算：用 closest 往上找，所以点在文字、下划线、波浪线上的任何位置都能命中
     * —— 以前标注点不动，改颜色只能删了重划（用户报的）。
     */
    const onMarkClick = (event: Event): void => {
      const target = event.target as HTMLElement | null
      const element = target?.closest?.('.epub-mark') as HTMLElement | null
      if (!element) return
      const id = element.dataset.markId
      if (!id) return
      event.stopPropagation()
      const rect = element.getBoundingClientRect()
      const frame = doc.defaultView?.frameElement?.getBoundingClientRect()
      /* 顺带把选区收掉：这时候用户想动的是标注，不是选字 */
      setSelectionBar(null)
      setEditingMark({
        id,
        x: (frame?.left ?? 0) + rect.left + rect.width / 2,
        y: (frame?.top ?? 0) + rect.top
      })
    }
    /*
     * 同一个章节可能被重复 wire（换样式、重排都会再来一次），
     * 所以在文档上做个记号，避免监听器越挂越多。
     * 文档被卸载时监听器自然跟着走，不需要在这里清理。
     */
    const marked = doc as Document & { __bmWired?: boolean; __keysWired?: boolean }
    if (!marked.__bmWired) {
      marked.__bmWired = true
      doc.addEventListener('click', onMarkClick)
    }
    /*
     * 快捷键也要挂进每个章节文档。
     *
     * 正文在 iframe 里：用户一点正文（或选一段字），焦点就进了 iframe 的 document，
     * 挂在外层 window 上的监听**一个键都收不到** —— 表现就是"点一下正文，翻页/翻译等
     * 所有快捷键全失效"（用户报的）。这里转发给同一套处理函数，行为完全一致。
     */
    if (!marked.__keysWired) {
      marked.__keysWired = true
      doc.addEventListener('keydown', (event) => {
        keyHandlerRef.current?.(event as unknown as KeyboardEvent)
      })
    }
  }, [])

  /** wireView 里的 load 回调拿不到最新闭包，用 ref 兜一下 */
  wireSectionDocRef.current = wireSectionDoc

  /* ------------------------------------------------ 书签标记（看得见） */
  /**
   * 书签清单一变（或翻页了）就重画一次标记。
   *
   * 加完书签当场就该看到那条下划线与右上角的色带 ——
   * 以前既没画标记，侧栏那份清单也还是旧的，用户说"标记的当下根本显示不出来"。
   */
  useEffect(() => {
    if (status !== 'ready') return
    const view = viewRef.current
    const contents = (view?.renderer?.getContents?.() ?? []) as { doc?: Document }[]
    let hits = 0
    for (const content of contents) {
      if (content?.doc) hits += applyBookmarkMarks(content.doc, marks.list)
    }
    setBookmarkHits(hits)
  }, [marks.list, status, position.index])

  /* ------------------------------------------------ 标注改动后重画 */
  /**
   * 改颜色 / 换样式 / 删除之后要立刻重画。
   *
   * 以前只有"新建"那条路径会就地画一次，改与删都没有重画的机会 ——
   * 所以标注看起来是"定死在那儿"的。
   */
  useEffect(() => {
    if (status !== 'ready') return
    const view = viewRef.current
    const contents = (view?.renderer?.getContents?.() ?? []) as { index?: number; doc?: Document }[]
    for (const content of contents) {
      if (!content?.doc) continue
      /*
       * 先清掉旧的包裹再重画。
       *
       * applyHighlights 遇到"已经画过"的那一条会跳过（原本是为了防止切章重复包），
       * 于是改颜色 / 换样式 / 删除时旧的那层包裹留在页面上不动 ——
       * 看起来就是"标注定死在那儿，改了没反应"（用户报的）。
       */
      clearHighlights(content.doc)
      /* 拿不到下标就传 -1：让 applyHighlights 靠原文去认（见那里的注释） */
      const section = typeof content.index === 'number' ? content.index : -1
      applyHighlights(content.doc, section, highlights)
    }
  }, [highlights, status, position.index])

  /* Esc 关掉标注编辑条 */
  useEffect(() => {
    if (!editingMark) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setEditingMark(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [editingMark])

  /* ------------------------------------------------------ 阅读样式热更新 */
  /**
   * 换主题 / 调字号时，**已经渲染出来的章节**也要立刻换上新样式。
   *
   * 以前 setStyles 只在章节 load 的时候调一次，于是"阅读中改背景"只换了新章节，
   * 眼前那一页还是旧配色 —— 深色底配黑字，就看不清了（用户报的那个问题）。
   */
  useEffect(() => {
    if (status !== 'ready') return
    const view = viewRef.current
    if (!view) return
    const css = stylesFor(mode)
    latestStyles.current = css
    applyStylesToSections(view, css)
    /*
     * 依赖整个 settings 对象，而不是逐个字段。
     * 逐个列字段时漏掉一个就会"改了没反应，等下一项设置变了才生效" ——
     * 字体就是这么漏的（字号变了、字体没变，直到换主题才一起刷上去）。
     */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, mode, settings])

  /* ------------------------------------------------------------ 翻页 */

  /** 按阅读顺序翻页：下一页永远是"后面那一页"，跟横竖排无关 */
  const goLogical = useCallback((direction: 'next' | 'prev') => {
    const view = viewRef.current
    if (!view) return
    void (direction === 'next' ? view.next() : view.prev())
  }, [])

  /**
   * 按屏幕上的左右翻页。
   *
   * 竖排（或声明了 rtl）的书是从右往左读的，所以"左边"才是下一页 ——
   * 这正是日本原生竖排书的习惯。横排书则相反。
   */
  const goPhysical = useCallback(
    (side: 'left' | 'right') => {
      goLogical((side === 'left') === rtl ? 'next' : 'prev')
    },
    [goLogical, rtl]
  )

  const turn = goLogical

  /* ------------------------------------------------------------ 朗读 */

  /**
   * 取当前这一节的句子（**唯一**的取文本实现）。
   *
   * 之前"从头朗读"和"从选中处朗读"各写了一套取文本逻辑 —— 结果一套跳过了 <rt>（振假名），
   * 另一套没有，于是同一段文字两条路表现不同（用户实测反馈）。
   * 现在只有这一个入口：段落级克隆后删 `rt/rp`，再切句。
   */
  const buildSectionSentences = useCallback((): { sentences: string[]; doc: Document | null } => {
    const view = viewRef.current
    const contents = (view?.renderer?.getContents?.() ?? []) as { doc?: Document }[]
    const paragraphs: string[] = []
    let firstDoc: Document | null = null
    for (const content of contents) {
      const body = content?.doc?.body
      if (!body) continue
      if (!firstDoc) firstDoc = content.doc ?? null
      for (const element of body.querySelectorAll('p, div, li, blockquote, h1, h2, h3, h4, h5, h6')) {
        /* 只取"没有块级子元素"的那种：避免整章被重复收一遍 */
        if (element.querySelector('p, div, li, blockquote')) continue
        /* 去掉 <rt>/<rp>：日文书的振假名会把读音混进正文，念出来是重复的 */
        const clone = element.cloneNode(true) as HTMLElement
        for (const noise of [...clone.querySelectorAll('rt, rp, script, style')]) noise.remove()
        const text = (clone.textContent ?? '').replace(/\s+/g, ' ').trim()
        if (text.length > 0) paragraphs.push(text)
      }
    }
    /* 再切成句子：逐句朗读才能跟着高亮，长段也不会一次合成很久 */
    const sentences: string[] = []
    for (const paragraph of paragraphs) {
      for (const part of paragraph.split(/(?<=[。！？!?…；;])\s*/)) {
        const piece = part.trim()
        if (piece.length >= 2) sentences.push(piece)
      }
    }
    return { sentences: sentences.length > 0 ? sentences : paragraphs, doc: firstDoc }
  }, [])

  const speakCurrentSection = useCallback((): void => {
    const { sentences } = buildSectionSentences()
    if (sentences.length === 0) {
      toast('这一节没有可朗读的文字', 'info')
      return
    }
    ttsPlay(sentences, 'epub')
  }, [buildSectionSentences, ttsPlay, toast])

  /**
   * 从选中的位置开始读。
   *
   * 句子列表走 buildSectionSentences（与"从头朗读"同一条路，天然跳过振假名），
   * 再用"清洗过的选中文字"去定位起点 —— 两边文本形态一致，定位才靠得住。
   */
  const speakFromSelection = useCallback(
    (cleanSelected: string): void => {
      const { sentences } = buildSectionSentences()
      if (sentences.length === 0) {
        toast('这一节没有可朗读的文字', 'info')
        return
      }
      const doc = viewRef.current
      const contents = (doc?.renderer?.getContents?.() ?? []) as { doc?: Document }[]
      const sectionDoc = contents.find((content) => content?.doc)?.doc ?? null
      const from = sectionDoc ? sentenceIndexAt(sectionDoc, cleanSelected) : 0
      ttsPlay(sentences.slice(Math.max(0, from)), 'epub')
    },
    [buildSectionSentences, ttsPlay, toast]
  )

  /*
   * 读到哪一句就把哪一句标出来。
   * 注意 CSS Custom Highlight 是**按文档**的：正文在 iframe 里，
   * 所以要把样式注进章节文档，并用章节文档自己的 CSS 对象来设高亮。
   */
  useEffect(() => {
    const view = viewRef.current
    const contents = (view?.renderer?.getContents?.() ?? []) as { doc?: Document }[]
    const docs = contents.map((content) => content?.doc).filter((doc): doc is Document => Boolean(doc))
    if (!ttsOpen || !ttsPlaying) {
      for (const doc of docs) clearSentenceHighlight(doc)
      return
    }
    const sentence = ttsSegments[ttsIndex] ?? ''
    for (const doc of docs) {
      injectHighlightStyle(doc)
      highlightSentence(doc, sentence)
    }
  }, [ttsOpen, ttsPlaying, ttsIndex, ttsSegments, position.index])
  /* 连读：一节读完后自动翻到下一节接着读 */
  useEffect(() => {
    setTtsBoundary(() => {
      const view = viewRef.current
      if (!view) return false
      /* 先翻到下一节；能不能读由翻页后的数据决定，这里只管"还有没有下一节" */
      try {
        view.next()
        return true
      } catch {
        return false
      }
    })
    return () => setTtsBoundary(null)
  }, [setTtsBoundary])

  /* 翻页之后如果朗读还开着，就把新的一节接上 */
  useEffect(() => {
    if (!ttsOpen) return
    const playing = useTts.getState().playing
    if (playing) return
    const timer = setTimeout(() => speakCurrentSection(), 1200)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [position.index, ttsOpen])
  /* ------------------------------------------------------------ 键盘 */

  /*
   * 走统一的快捷键系统（设置页里能改键）。
   * 左右方向键按**屏幕方向**翻（跟点击左右两侧一致），
   * 空格/PageDown/PageUp 按**阅读顺序**翻 —— 后者不该因为书是竖排就反过来。
   */
  /* 顶层窗口与每个章节 iframe 共用这一个处理函数 */
  keyHandlerRef.current = useShortcuts({
    'epub.nextScreen': () => goLogical('next'),
    'epub.prevScreen': () => goLogical('prev'),
    'epub.nextPage': () => goPhysical('right'),
    'epub.prevPage': () => goPhysical('left'),
    'epub.bookmark': () => void marks.add(),
    /* 文本标记：都作用于"当前选中"，没选中就提示一下（别静默失败） */
    'epub.highlight': () => markSelection('highlight'),
    'epub.underline': () => markSelection('underline'),
    'epub.wavy': () => markSelection('wavy'),
    'epub.note': () => {
      if (!selectionBar) {
        toast('先选中一段正文', 'info')
        return
      }
      void marks.add({
        excerpt: selectionBar.range.text,
        plain: selectionBar.range.plain,
        kind: 'note'
      })
      setSelectionBar(null)
      window.getSelection()?.removeAllRanges()
    },
    'epub.translateSelection': () => {
      if (!selectionBar) {
        toast('先选中一段正文', 'info')
        return
      }
      void runTranslate(selectionBar.range.plain || selectionBar.range.text, selectionBar.context)
      setSelectionBar(null)
    },
    /* 从选中的这一句开始朗读（读到本节末尾；连读打开时还会翻页接着读） */
    'epub.speakSelection': () => {
      if (!selectionBar) {
        toast('先选中一段正文', 'info')
        return
      }
      speakFromSelection(selectionBar.range.clean || selectionBar.range.plain)
      setSelectionBar(null)
      window.getSelection()?.removeAllRanges()
    },
    'epub.sidebar': () => setSideOpen((open) => !open),
    'epub.translate': translateToggle,
    'epub.fontUp': () => setScale((value) => Math.min(2, Number((value + 0.1).toFixed(2)))),
    'epub.fontDown': () => setScale((value) => Math.max(0.7, Number((value - 0.1).toFixed(2))))
  })

  const gotoHref = useCallback((href: string) => {
    setActiveHref(href)
    void viewRef.current?.goTo(href).catch(() => undefined)
  }, [])

  /* ------------------------------------------------------------ 渲染 */

  const percent = useMemo(() => Math.round(position.fraction * 100), [position.fraction])

  if (status === 'failed') {
    return (
      <div className="epub-empty">
        <IconInfo size={24} />
        <h3>打不开这本 EPUB</h3>
        <p>{error}</p>
        <Button variant="outline" icon={<IconExternalLink size={14} />} onClick={() => void appApi.openPath(book.path)}>
          用系统应用打开
        </Button>
      </div>
    )
  }

  return (
    <div
      className="epub-view"
      /* 给自动化探针看的：阅读方向与精确进度（百分比字符串只有整数位，判不出一次翻页） */
      data-epub-direction={rtl ? 'rtl' : 'ltr'}
      data-epub-vertical={verticalNow ? 'yes' : 'no'}
      data-epub-writing={docWriting}
      data-epub-fraction={position.fraction.toFixed(4)}
    >
      <div className="epub-bar">
        {/*
          「目录」是一颗**真的按钮**：点它把左侧栏收起来／展开。
          0.9.1 把它做成过纯图标 <span>，于是点它毫无反应（用户反馈"点不动"）——
          图标看着像按钮就必须是按钮。
        */}
        <Button
          variant="outline"
          active={sideOpen}
          icon={<IconBookOpen size={15} />}
          onClick={() => {
            if (sideOpen && sideTab !== 'toc') setSideTab('toc')
            else setSideOpen((value) => !value)
          }}
          title="展开／收起左侧的目录与书签"
        >
          目录
        </Button>

        <Button variant="outline" icon={<IconArrowLeft size={14} />} onClick={() => turn('prev')}>
          上一页
        </Button>
        <Button variant="outline" trailing={<IconArrowRight size={14} />} onClick={() => turn('next')}>
          下一页
        </Button>

        {/*
          书名不在这里再写一遍 —— 上面阅读器栏已经有一行大标题了，
          工具条里再来一次是重复的（用户提的）。
          这一格改成阅读进度：一条细进度条 + 百分比，比原来光一个数字醒目。
        */}
        <span className="epub-progress" title={`阅读进度 ${percent}%`}>
          <span className="epub-progress-track">
            <span className="epub-progress-fill" style={{ width: `${Math.max(1, percent)}%` }} />
          </span>
          <span className="epub-progress-text">{percent}%</span>
        </span>

        <span className="epub-bar-spacer" />

        <Tooltip label="排版方向：把竖排书横着读，或者反过来">
          <div className="epub-seg">
            {WRITING_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                className={writingMode === option.value ? 'is-active' : ''}
                onClick={() => void patch({ ui: { epubWritingMode: option.value } })}
                title={
                  option.value === 'auto'
                    ? '跟随书籍本身的排版方向'
                    : `强制${option.value === 'vertical' ? '竖排' : '横排'}（即便是${option.value === 'vertical' ? '横排' : '竖排'}书）`
                }
              >
                {option.value === 'auto' ? <IconTextCursor size={13} /> : option.label}
              </button>
            ))}
          </div>
        </Tooltip>

        <Tooltip label="一屏一页 / 一屏两页（竖排固定单栏）">
          <div className="epub-seg">
            <button
              type="button"
              className={spread === 'single' ? 'is-active' : ''}
              onClick={() => void patch({ ui: { epubSpread: 'single' } })}
              title="单页"
            >
              单
            </button>
            <button
              type="button"
              className={spread === 'double' ? 'is-active' : ''}
              onClick={() => void patch({ ui: { epubSpread: 'double' } })}
              title="双页（摊开的书）"
            >
              双
            </button>
          </div>
        </Tooltip>

        <Tooltip label={verticalNow ? '左右翻页（竖排：从右往左）' : '左右翻页'}>
          <div className="epub-seg">
            <button
              type="button"
              className={flow === 'paginated' ? 'is-active' : ''}
              onClick={() => setFlow('paginated')}
              title={verticalNow ? '左右翻页（竖排：从右往左）' : '左右翻页'}
            >
              <IconColumns size={14} />
            </button>
            <button
              type="button"
              className={flow === 'scrolled' ? 'is-active' : ''}
              onClick={() => setFlow('scrolled')}
              title={verticalNow ? '左右滚动（竖排时文字横向走，所以是横向滚动）' : '上下滚动'}
            >
              <IconRows size={14} />
            </button>
          </div>
        </Tooltip>

        <Select value={theme} options={THEME_OPTIONS} onChange={(value) => setTheme(value)} className="epub-select" />

        <div className="epub-scale">
          <IconButton label="缩小" onClick={() => setScale((v) => Math.max(0.7, Math.round((v - 0.1) * 10) / 10))}>
            <IconMinus size={14} />
          </IconButton>
          <span className="epub-scale-value">{Math.round(scale * 100)}%</span>
          <IconButton label="放大" onClick={() => setScale((v) => Math.min(2, Math.round((v + 0.1) * 10) / 10))}>
            <IconPlus size={14} />
          </IconButton>
        </div>

        {/*
          排版选项收进一个弹层。
          0.9.2 把它们各自铺成一排按钮之后，工具条被撑得很宽，
          「目录」「导出图片」这些真正常用的按钮反倒被挤成小图标。
        */}
        <div className="epub-menu" ref={menuRef}>
          <Button
            variant="outline"
            icon={<IconTextCursor size={15} />}
            active={menuOpen}
            onClick={() => setMenuOpen((value) => !value)}
            title="边框距离 / 行距 / 段首缩进"
          >
            排版
          </Button>
          {menuOpen ? (
            <div className="epub-menu-panel">
              <div className="epub-menu-row">
                <span className="epub-menu-label">字号</span>
                <input
                  className="epub-range"
                  type="range"
                  min={0.7}
                  max={2}
                  step={0.05}
                  value={scale}
                  onChange={(event) => setScale(Number(event.target.value))}
                />
                <span className="epub-menu-value tabular">{Math.round(scale * 100)}%</span>
              </div>
              <div className="epub-menu-row">
                <span className="epub-menu-label">字体</span>
                <div className="epub-seg">
                  {FONT_OPTIONS.map((option) => (
                    <button
                      key={option.value || 'book'}
                      type="button"
                      className={fontFamily === option.value ? 'is-active' : ''}
                      title={option.value === '' ? '跟随书籍自带的字体' : `正文用${option.label}`}
                      onClick={() => patchFont({ epubFontFamily: option.value })}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="epub-menu-row">
                <span className="epub-menu-label">行距</span>
                {/*
                  以前只有「书 / 紧 / 松」三档，用户说太难用 —— 改成连续可调：
                  最左边是"跟随书籍"，往右是 1.2 倍到 2.6 倍。
                */}
                <input
                  className="epub-range"
                  type="range"
                  min={0}
                  max={2.6}
                  step={0.1}
                  value={lineHeight}
                  onChange={(event) => setLineHeight(Number(event.target.value))}
                />
                <span className="epub-menu-value tabular">
                  {lineHeight === 0 ? '书' : `${lineHeight.toFixed(1)}×`}
                </span>
              </div>
              <div className="epub-menu-row">
                <span className="epub-menu-label">边框距离</span>
                <div className="epub-seg">
                  {MARGIN_OPTIONS.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      className={margin === option.value ? 'is-active' : ''}
                      onClick={() => setMargin(option.value)}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="epub-menu-row">
                <span className="epub-menu-label">段首缩进</span>
                {/*
                  最左边是"缩回"：有些书自己就把每段缩进了两格，再往上加只会更深，
                  所以必须能往左调。0 = 跟随书籍。
                */}
                <input
                  className="epub-range"
                  type="range"
                  min={-3}
                  max={4}
                  step={0.5}
                  value={indent}
                  onChange={(event) => setIndent(Number(event.target.value))}
                />
                <span className="epub-menu-value tabular">
                  {indent === 0 ? '书' : indent < 0 ? `缩回 ${Math.abs(indent)}em` : `${indent}em`}
                </span>
              </div>
            </div>
          ) : null}
        </div>

        {/* 朗读：贴着底部的一条，不挡正文 */}
        <Button
          variant="outline"
          icon={<IconVolume size={15} />}
          active={ttsOpen}
          onClick={() => {
            if (ttsOpen) {
              setTtsOpen(false)
              return
            }
            setTtsOpen(true)
            /*
             * 已经读着（或暂停着）就别重新从头来 —— 用户点开朗读栏往往只是想看看控件。
             * 只有"还没有内容"时才从这一节开头读。
             */
            const state = useTts.getState()
            if (state.segments.length > 0) {
              if (!state.playing) state.resume()
              return
            }
            speakCurrentSection()
          }}
          title="朗读当前这一节（可换语言与语音）"
        >
          朗读
        </Button>

        {/*
          翻译栏开关：左边管"书里有什么"（目录/书签/笔记），右边管"这句话什么意思"。
        */}
        <Button
          variant="outline"
          icon={<IconGlobe size={15} />}
          active={translateOpen}
          onClick={translateToggle}
          title="翻译（选中正文后点「翻译」，结果显示在右侧）"
        >
          翻译
        </Button>
        {/*
          「看图」是独立入口：看图是最轻的动作，不该先打开一个"导出"界面
          （用户原话：想看张图还得钻进导出弹窗点小图，别扭）。
        */}
        <Button variant="outline" icon={<IconImage size={15} />} onClick={() => setGalleryOpen(true)}>
          看图
        </Button>
        <Button variant="outline" icon={<IconImageExtract size={15} />} onClick={() => setExportOpen(true)}>
          导出图片
        </Button>
        <IconButton label="用系统应用打开" onClick={() => void appApi.openPath(book.path)}>
          <IconExternalLink size={15} />
        </IconButton>
      </div>

      <div className="epub-body">
        {/* 目录与书签合用左侧栏（与 PDF、编辑器保持一致：目录一律在左边） */}
        {sideOpen ? (
        <ReaderSidebar
          book={book}
          tab={sideTab}
          onTabChange={setSideTab}
          toc={
            <nav className="epub-toc-list-wrap" aria-label="目录">
              {toc.length === 0 ? (
                <p className="epub-toc-empty">这本书没有提供目录</p>
              ) : (
                <ol className="epub-toc-list">
                  {toc.map((item, index) => (
                    <li key={`${item.href}-${index}`} style={{ paddingLeft: 8 + item.depth * 12 }}>
                      <button
                        type="button"
                        className={activeHref === item.href ? 'is-active' : ''}
                        onClick={() => gotoHref(item.href)}
                        title={item.label}
                      >
                        {item.label}
                      </button>
                    </li>
                  ))}
                </ol>
              )}
            </nav>
          }
          tocLabel="目录"
          addLabel="标记当前位置"
          width={sideLeft.width}
        />
        ) : null}

        {sideOpen ? (
        <SideResizer
          side="left"
          value={sideLeft.width}
          min={sideLeft.min}
          max={sideLeft.max}
          onDrag={sideLeft.setWidth}
          onCommit={sideLeft.commit}
        />
        ) : null}

        <div className="epub-stage is-foliate">
          <div className="epub-foliate-host" ref={hostRef} />

          {/*
            这一页有书签时，右上角挂一条色带。
            书签是"我在这存了个点"，光有列表不够 —— 用户说"根本看不到"，
            所以在页面本身给个提示；具体那一段文字也会被标出来（见 bookmarkMarks）。
          */}
          {bookmarkHits > 0 ? (
            <div className="epub-bm-ribbon" title={`这一页有 ${bookmarkHits} 个书签`}>
              <IconBookmarkFilled size={13} />
              <span>{bookmarkHits}</span>
            </div>
          ) : null}

          {/*
            选中正文浮出的操作条 —— 与"点已有标注"用的是**同一条**（用户提的：
            以前手动划选区出来的是旧样式、点标注出来的是新样式，像两个功能）。
            区别只在动作含义：选中时是"加标注"，编辑时是"改成这样"。
          */}
          {editingMark && highlights.some((mark) => mark.id === editingMark.id) ? (
            (() => {
              const mark = highlights.find((item) => item.id === editingMark.id)!
              return (
                <TextActionBar
                  anchor={{ x: editingMark.x, y: editingMark.y }}
                  current={{ style: mark.style, color: mark.color }}
                  excerpt={mark.text}
                  onCopy={() => {
                    /* 复制时剥掉振假名：那些读音夹在正文里会把人看懵（见 plainTextOf） */
                    void navigator.clipboard.writeText(mark.plain ?? mark.text).then(
                      () => toast('已复制这段原文', 'success'),
                      () => toast('复制失败', 'error')
                    )
                  }}
                  onMark={(style, color) => editMark(mark.id, color ? { style, color } : { style })}
                  onDelete={() => deleteMark(mark.id)}
                  onClose={() => setEditingMark(null)}
                />
              )
            })()
          ) : null}

          {selectionBar ? (
            <TextActionBar
              anchor={{ x: selectionBar.x, y: selectionBar.y }}
              onCopy={copySelection}
              onMark={markSelection}
              onBookmark={() => {
                /* 把选中的原文一起记下来 —— 这才是「笔记」而不是光记个位置 */
                void marks.add({
                  excerpt: selectionBar.range.text,
                  plain: selectionBar.range.plain,
                  kind: 'note'
                })
                setSelectionBar(null)
              }}
              /* 翻译：结果去右侧栏，不遮挡正文 */
              onTranslate={() => {
                void runTranslate(selectionBar.range.plain || selectionBar.range.text, selectionBar.context)
                setSelectionBar(null)
              }}
              /* 朗读：从选中的这一句开始，一直读到本节末尾 */
              onSpeak={() => {
                speakFromSelection(selectionBar.range.clean || selectionBar.range.plain)
                setSelectionBar(null)
                window.getSelection()?.removeAllRanges()
              }}
            />
          ) : null}

          {/*
           * 点击左右两侧翻页。做成两条靠边的窄带，而不是覆盖整页 ——
           * 中间那块要留给书里的链接、选词、图片。
           * 竖排书左边是"下一页"，所以提示语也要跟着换。
           */}
          {status === 'ready' && flow === 'paginated'
            ? (['left', 'right'] as const).map((side) => {
              const isNext = (side === 'left') === rtl
              return (
                <button
                  key={side}
                  type="button"
                  tabIndex={-1}
                  className={`epub-flip-zone is-${side}`}
                  /*
                   * 宽度：跟着书页留白走，但**别缩得太狠**。
                   *
                   * 之前只按留白取（最小 44px），用户反馈"翻页区域调得也太小了"——
                   * 44px 的边条在宽屏上很难瞄准。现在以留白为基准再加一点余量
                   * （越界的那点落在正文最外侧的空白里，仍然不会压住字），
                   * 下限提到 88px、上限 150px，宽屏窄屏都好按。
                   */
                  style={{ width: `${Math.max(88, Math.min(margin + 36, 150))}px` }}
                  data-action={isNext ? 'next' : 'prev'}
                  onClick={() => goPhysical(side)}
                  title={`点击翻到${isNext ? '下一' : '上一'}页${verticalNow ? '（竖排：从右往左）' : ''}`}
                  aria-label={`翻到${isNext ? '下一' : '上一'}页`}
                >
                  <span className="epub-flip-hint">{side === 'left' ? '‹' : '›'}</span>
                </button>
              )
            })
            : null}

          {status === 'loading' ? (
            <div className="epub-loading">
              <Spinner size={20} />
              <span>正在排版…</span>
            </div>
          ) : null}
        </div>

        {/* 翻译栏在**最右**：左边是目录栏，右边是它，正文夹在中间 */}
        {translateOpen ? <TranslatePanel /> : null}
      </div>

      {/*
        朗读栏放在 `.epub-body` **外面**：body 是横向 flex，
        放进去它就成了一条竖着的列 —— 段落一长整页都被它占住（用户报的）。
        它是横向底栏，应当占满宽度、只占底部一条。
      */}
      <TtsBar />

      {/* 相册式看图器：独立于导出弹窗 */}
      <EpubGallery
        open={galleryOpen}
        bookId={book.id}
        bookPath={book.path}
        onClose={() => setGalleryOpen(false)}
      />

      <ExportImagesModal
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        book={book}
        presetHref={null}
        dir={exportDir}
        onDirChange={setExportDir}
      />
    </div>
  )
}

/* ------------------------------------------------------------- 辅助 */

function toWritingMode(value: EpubWritingMode): WritingMode {
  return value === 'vertical' ? 'vertical' : value === 'horizontal' ? 'horizontal' : 'auto'
}

function fileNameOf(path: string): string {
  const parts = path.split(/[\\/]/)
  return parts[parts.length - 1] || 'book.epub'
}

/**
 * 分页器的参数只能通过 HTML 属性设置（没有 JS 属性 API）。
 *
 * - `flow`：翻页 or 滚动
 * - `max-column-count`：一屏几栏。它在元素自身是"竖屏比例"时无效
 *   （分页器的设计：竖屏一栏才读得舒服），所以窗口很窄时会自动退回单栏。
 * - `max-inline-size`：一栏的最大宽度，决定一行多少字
 * - `margin`：页面四周留白，单位必须是 px
 * - `gap`：栏与栏之间的间距，百分比
 *
 * 竖排一律单栏：竖排里"栏"是沿竖直方向堆的，一屏两栏会把两列挤到上下，
 * 所以竖排时忽略单双页设置。
 */
function applyRendererAttributes(
  view: FoliateView,
  options: { flow: Flow; spread: EpubSpread; mode: WritingMode; margin: number }
): void {
  const renderer = view.renderer
  if (!renderer?.setAttribute) return
  const columns = options.mode === 'vertical' ? 1 : options.spread === 'double' ? 2 : 1
  renderer.setAttribute('flow', options.flow)
  renderer.setAttribute('max-column-count', String(columns))
  renderer.setAttribute('max-inline-size', `${MAX_INLINE_SIZE}px`)
  // 边框距离可调（用户要的"边框距离"就是书页四周留白）
  renderer.setAttribute('margin', `${options.margin}px`)
  renderer.setAttribute('gap', '7%')
}
