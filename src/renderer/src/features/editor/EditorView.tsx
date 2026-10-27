import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Book, Bookmark, DialogFilter } from '@shared/types'
import { FORMAT_LABEL } from '@shared/types'
import { appApi, filesApi, libraryApi } from '@/lib/api'
import { useShortcuts } from '@/lib/useShortcuts'
import { FORMAT_ACCENT, formatBytes, formatPages, formatWords, relativeTime } from '@/lib/format'
import { reportWords } from '@/lib/usage'
import { useBookmarkTarget } from '@/lib/bookmarkTarget'
import { goToScrollAnchor, ratioOf, scrollAnchor } from '@/lib/scrollAnchor'
import { useLibrary } from '@/store/useLibrary'
import { useSettings } from '@/store/useSettings'
import { useUi } from '@/store/useUi'
import { Button, EmptyState, IconButton, Segmented, Select, Slider, Switch } from '@/components/common/Controls'
import {
  IconChevronDown,
  IconDownload,
  IconEdit,
  IconExternalLink,
  IconEye,
  IconFileMarkdown,
  IconFilePdf,
  IconFileWord,
  IconFolder,
  IconGlobe,
  IconInfo,
  IconSave,
  IconSplit,
  IconTrash
} from '@/components/icons/Icons'
import { EditorSurface, type MarkdownEditorHandle } from './EditorSurface'
import { EditorToolbar, type ToolbarAction } from './EditorToolbar'
import { MarkdownPreview, type MarkdownPreviewHandle } from './MarkdownPreview'
import { OutlinePanel } from './OutlinePanel'
import { ReadOnlyPane } from './ReadOnlyPane'
import { ReaderSidebar } from '@/features/reader/ReaderSidebar'
import { computeStats, isEditable, isMarkdown, parseHeadings, type HeadingInfo } from './lib/doc'
import { buildExportRoot, inlineImages, invalidateReadingCss, pdfFragment, selfContainedHtml } from './lib/exportDoc'
import { buildDocx } from './lib/docx'
import {
  applyRedo,
  applyUndo,
  insertBlock,
  insertCodeBlock,
  insertDivider,
  insertLink,
  insertTable,
  setHeading,
  toggleList,
  toggleQuote,
  wrapInline
} from './lib/format'
import { labelForAsset, pickNoteImage, storeClipboardImage } from './lib/imageStore'
import { useDocument } from './lib/useDocument'

type ViewMode = 'edit' | 'split' | 'preview'

type ExportKind = 'pdf' | 'docx' | 'html' | 'text'

interface ExportItem {
  kind: ExportKind
  label: string
  hint: string
  icon: ReactNode
  /** 只对 Markdown 有意义（纯文本没有排版结果可导） */
  markdownOnly: boolean
}

const EXPORT_ITEMS: ExportItem[] = [
  {
    kind: 'pdf',
    label: '导出为 PDF',
    hint: '保留排版、目录与五线谱',
    icon: <IconFilePdf size={15} />,
    markdownOnly: true
  },
  {
    kind: 'docx',
    label: '导出为 Word',
    hint: '.docx，图片与五线谱以位图嵌入',
    icon: <IconFileWord size={15} />,
    markdownOnly: true
  },
  {
    kind: 'html',
    label: '导出为 HTML',
    hint: '单文件，样式与图片全部内联',
    icon: <IconGlobe size={15} />,
    markdownOnly: true
  },
  {
    kind: 'text',
    label: '导出源文件',
    hint: 'Markdown / 纯文本原文',
    icon: <IconFileMarkdown size={15} />,
    markdownOnly: false
  }
]

const EXPORT_BUSY: Record<ExportKind, string> = {
  pdf: '排版中…',
  docx: '打包中…',
  html: '内联中…',
  text: '导出中…'
}

const FONT_OPTIONS = [
  { value: 'var(--font-serif)', label: '衬线体 · 宋体' },
  { value: 'var(--font-sans)', label: '无衬线 · 雅黑' },
  { value: 'var(--font-mono)', label: '等宽 · 代码' }
]

const VIEW_OPTIONS: { value: ViewMode; label: ReactNode; title: string }[] = [
  { value: 'edit', label: <IconEdit size={14} />, title: '只看编辑区' },
  { value: 'split', label: <IconSplit size={14} />, title: '边写边看' },
  { value: 'preview', label: <IconEye size={14} />, title: '只看预览' }
]

export function EditorView({ book }: { book: Book }): ReactNode {
  const format = book.format
  const editable = isEditable(format)
  const markdownMode = isMarkdown(format)
  // HTML 笔记由 HtmlNoteView 用 iframe 整页渲染，编辑器的排版控件对它无效
  const isHtml = format === 'html'

  const settings = useSettings((s) => s.settings)
  const patchUi = useSettings((s) => s.patchUi)
  const runtime = useSettings((s) => s.runtime)
  const toast = useUi((s) => s.toast)
  const updateBook = useLibrary((s) => s.updateBook)
  const removeBooks = useLibrary((s) => s.removeBooks)

  const doc = useDocument(book, format)
  const dark = runtime?.dark ?? false
  const ui = settings?.ui

  const [mode, setMode] = useState<ViewMode>(markdownMode ? 'split' : 'edit')
  const [focusMode, setFocusMode] = useState(false)
  const [outlineOpen, setOutlineOpen] = useState(true)
  const [cursor, setCursor] = useState({ line: 1, column: 1 })
  const [title, setTitle] = useState(book.title)
  const [exportOpen, setExportOpen] = useState(false)
  /*
   * 导出后的两个后续动作，默认都不勾：
   * 导出本身就该是一次干净的动作 —— 别偷偷往书架里塞东西，也别动原文件。
   */
  const [keepExported, setKeepExported] = useState(false)
  const [recycleSource, setRecycleSource] = useState(false)
  const [exporting, setExporting] = useState<ExportKind | null>(null)

  const editorRef = useRef<MarkdownEditorHandle | null>(null)
  const previewRef = useRef<MarkdownPreviewHandle | null>(null)

  /*
   * 纯文本没有"排版"这回事：预览与分栏对它没有意义，
   * 边看边写的分栏更是只剩一个和源码一模一样的右半边。
   * 所以 .txt 一律只有编辑器本身。
   */
  const plainText = format === 'txt'

  /* 切书时重置视图状态 */
  useEffect(() => {
    setMode(markdownMode ? 'split' : 'edit')
    setFocusMode(false)
    setCursor({ line: 1, column: 1 })
    setTitle(book.title)
  }, [book.id, book.title, markdownMode])

  useEffect(() => {
    if (!editable) setMode('preview')
  }, [editable])

  useEffect(() => {
    if (plainText) setMode('edit')
  }, [plainText])

  /* 统计与预览都跟在打字后面慢慢算，别让长文档拖慢输入 */
  const deferredText = useDeferredValue(doc.text)
  const headings = useMemo(() => (markdownMode ? parseHeadings(doc.text) : []), [markdownMode, doc.text])
  const stats = useMemo(() => computeStats(deferredText), [deferredText])

  /*
   * 书签：文本类按**行号**记位置，这样才能在那一行下面画线、跳过去时高亮。
   * （早先存的是滚动比例，比例换算不回具体某一行。）
   */
  const [flashLine, setFlashLine] = useState<number | null>(null)
  const [bookmarkLines, setBookmarkLines] = useState<number[]>([])
  const cursorLineRef = useRef(cursor.line)
  cursorLineRef.current = cursor.line

  // 侧栏里的书签一变，重新算「哪几行有书签」，交给编辑器内核画标记
  useEffect(() => {
    const onMarks = (event: Event): void => {
      const detail = (event as CustomEvent<{ bookId: string; list: Bookmark[] }>).detail
      if (!detail || detail.bookId !== book.id) return
      const lines: number[] = []
      for (const item of detail.list) {
        if (item.anchor?.kind === 'line') lines.push(item.anchor.line)
      }
      setBookmarkLines(lines)
    }
    window.addEventListener('bookscent:bookmarks', onMarks)
    return () => window.removeEventListener('bookscent:bookmarks', onMarks)
  }, [book.id])

  useBookmarkTarget({
    /*
     * 文本类按**行号**记位置（早先是滚动比例）：行号才能在那一行下面画线、
     * 跳过去时把那一行高亮 —— 用户要的"书签位置下划一条线"。
     */
    anchor: () => ({ kind: 'line', line: cursorLineRef.current }),
    goTo: (anchor) => {
      if (anchor.kind === 'line') {
        setFlashLine(anchor.line)
        return
      }
      goToScrollAnchor(document.querySelector<HTMLElement>('.bs-cm-host .cm-scroller'), anchor)
    },
    describe: () => {
      const ratio = ratioOf(document.querySelector<HTMLElement>('.bs-cm-host .cm-scroller')) ?? 0
      const line = doc.text.split('\n')[cursorLineRef.current] ?? ''
      return {
        page: Math.max(1, Math.round(ratio * Math.max(1, book.pageCount))),
        label: `第 ${cursorLineRef.current + 1} 行`,
        excerpt: line.trim() || book.title
      }
    }
  })

  /*
   * 输入字数统计。
   *
   * 只记"长出来的部分"：删掉的字不算负输入，所以不会把累计值减下去。
   * 第一次量到的字数不算输入 —— 那是打开文件时读进来的。
   * 逐键上报会把记录文件刷爆，所以先攒着，够一批或到时间再报一次。
   */
  const typedChars = useRef<number | null>(null)
  const pendingWords = useRef(0)
  useEffect(() => {
    /*
     * 文件一加载完就把基准重设一次。
     * 不然"打开笔记"本身会被当成输入：text 从空变成整篇，字数一下子涨几千，
     * 全被记进「输入字数」（这就是用户看到的那条 bug）。
     */
    typedChars.current = null
  }, [book.id, book.path])
  useEffect(() => {
    const chars = stats.chars
    // 还没加载完（或刚换文件）时量到的都不算输入
    if (!doc.loaded || typedChars.current === null) {
      typedChars.current = chars
      return
    }
    const delta = chars - typedChars.current
    typedChars.current = chars
    if (delta > 0) pendingWords.current += delta
  }, [stats.chars, doc.loaded])
  useEffect(() => {
    const flush = (): void => {
      if (pendingWords.current <= 0) return
      const words = pendingWords.current
      pendingWords.current = 0
      reportWords(book.id, words)
    }
    const timer = window.setInterval(flush, 10000)
    return () => {
      flush()
      window.clearInterval(timer)
    }
  }, [book.id])

  /** 光标所在章节：用于大纲高亮与预览跟随 */
  const activeHeadingId = useMemo(() => {
    if (headings.length === 0) return null
    let current: HeadingInfo | null = null
    for (const heading of headings) {
      if (heading.line <= cursor.line) current = heading
      else break
    }
    return (current ?? headings[0]).id
  }, [headings, cursor.line])

  /* 只在预览/分栏模式下、且切换章节时才滚动预览，避免光标抖动引起跳动 */
  const lastFollowed = useRef<string | null>(null)
  useEffect(() => {
    if (mode === 'edit') {
      lastFollowed.current = null
      return
    }
    if (!activeHeadingId || lastFollowed.current === activeHeadingId) return
    lastFollowed.current = activeHeadingId
    previewRef.current?.scrollToHeading(activeHeadingId)
  }, [activeHeadingId, mode])

  /* ------------------------------------------------------------ 保存 */

  const handleSave = useCallback((): void => {
    void doc.save()
  }, [doc])

  /*
   * Ctrl+S / Ctrl+E 走统一快捷键系统（设置页里能改键）。
   * Esc 关导出弹窗那条在下面另外的 effect 里，别混在一起。
   */
  useShortcuts({
    'editor.save': () => handleSave(),
    'editor.cycleMode': () =>
      setMode((current) => (current === 'edit' ? 'split' : current === 'split' ? 'preview' : 'edit'))
  })

  /* ---------------------------------------------------------- 工具栏 */

  /**
   * 「插入图片」：走 settings.pickBookImage 把图片拷进统一资源库，
   * 正文里只留 `asset:<文件名>` 引用（不写 base64、不留散落的相对路径）。
   */
  const insertImage = useCallback(async (): Promise<void> => {
    const view = editorRef.current?.getView()
    if (!view) return
    try {
      const ref = await pickNoteImage()
      if (!ref) return
      insertBlock(view, `![${labelForAsset(ref)}](${ref})`)
      toast('图片已存入统一图片库', 'success', ref)
    } catch (error) {
      toast('插入图片失败', 'error', (error as Error).message)
    }
  }, [toast])

  /** 剪贴板里的图片同样落进统一资源库，返回要插入的 Markdown */
  const handlePasteImage = useCallback(
    async (file: File): Promise<string | null> => {
      try {
        const ref = await storeClipboardImage(file)
        if (!ref) {
          toast('图片保存失败', 'error', '没能写入统一图片库')
          return null
        }
        toast('粘贴的图片已存入统一图片库', 'success', ref)
        return `![${labelForAsset(ref)}](${ref})`
      } catch (error) {
        toast('图片保存失败', 'error', (error as Error).message)
        return null
      }
    },
    [toast]
  )

  const runToolbar = useCallback(
    (action: ToolbarAction): void => {
      if (action === 'image') {
        void insertImage()
        return
      }
      const view = editorRef.current?.getView()
      if (!view) return
      switch (action) {
        case 'bold':
          wrapInline(view, '**', '加粗文字')
          break
        case 'italic':
          wrapInline(view, '*', '斜体文字')
          break
        case 'strike':
          wrapInline(view, '~~', '删除线')
          break
        case 'h1':
          setHeading(view, 1)
          break
        case 'h2':
          setHeading(view, 2)
          break
        case 'h3':
          setHeading(view, 3)
          break
        case 'bullet':
          toggleList(view, 'bullet')
          break
        case 'ordered':
          toggleList(view, 'ordered')
          break
        case 'task':
          toggleList(view, 'task')
          break
        case 'quote':
          toggleQuote(view)
          break
        case 'code':
          wrapInline(view, '`', '代码')
          break
        case 'codeblock':
          insertCodeBlock(view)
          break
        case 'link':
          insertLink(view)
          break
        case 'table':
          insertTable(view)
          break
        case 'divider':
          insertDivider(view)
          break
        case 'undo':
          applyUndo(view)
          break
        case 'redo':
          applyRedo(view)
          break
        default:
          break
      }
    },
    [insertImage]
  )

  /* ------------------------------------------------------------ 标题 */

  const commitTitle = useCallback((): void => {
    const next = title.trim()
    if (!next) {
      setTitle(book.title)
      return
    }
    if (next === book.title) return
    void updateBook(book.id, { title: next })
  }, [book.id, book.title, title, updateBook])

  /* ------------------------------------------------------------ 导出 */

  /**
   * 四种导出共用同一条渲染管线：
   * PDF / HTML / Word 都先按预览的方式渲染一份离屏 DOM（目录、五线谱、表格、图片俱全），
   * 唯一的源文本导出则直接把原文交给主进程。
   */
  /**
   * 导出成功之后的两个可选后续动作（弹窗里两个开关，默认都不勾）。
   *
   * - 「导出后把新文件加入书架」：以**引用**方式收进书架，文件仍留在用户保存的位置，
   *   免得同一份文档在藏书目录里再长一个副本。
   * - 「导出后把原笔记移入回收站」：注意动的是**原笔记**（不是导出的新文件）——
   *   典型用法是"写完导出成 Word 归档，原稿就不用了"。移入回收站可还原。
   */
  const afterExport = useCallback(
    async (path: string): Promise<void> => {
      if (keepExported) {
        try {
          await libraryApi.importPaths([path], false)
          toast('已把导出的文件加入书架', 'success', '以引用方式收录，文件仍在你保存的位置')
        } catch (error) {
          toast('加入书架失败', 'error', (error as Error).message)
        }
      }
      if (recycleSource) {
        try {
          await libraryApi.removeBooks([book.id], false)
          toast('原笔记已移入回收站', 'success', '在侧栏「回收站」里可以还原')
        } catch (error) {
          toast('移入回收站失败', 'error', (error as Error).message)
        }
      }
    },
    [keepExported, recycleSource, book.id, toast]
  )

  const runExport = useCallback(
    async (kind: ExportKind): Promise<void> => {
      const name = (book.title || '未命名笔记').trim() || '未命名笔记'
      setExportOpen(false)
      /* 记录导出到哪儿了，末尾统一接后续动作（4 条导出路径共用一段收尾） */
      let exportedPath = ''

      if (kind === 'text') {
        const ext = markdownMode ? 'md' : 'txt'
        const filters: DialogFilter[] = markdownMode
          ? [{ name: 'Markdown 文档', extensions: ['md', 'markdown'] }]
          : [{ name: '纯文本', extensions: ['txt'] }]
        try {
          const result = await filesApi.exportText(`${name}.${ext}`, doc.text, filters)
          if (!result.cancelled && result.path) {
            toast('已导出', 'success', result.path)
            exportedPath = result.path
          }
        } catch (error) {
          toast('导出失败', 'error', (error as Error).message)
        }
        if (exportedPath) await afterExport(exportedPath)
        return
      }

      setExporting(kind)
      try {
        invalidateReadingCss()
        const { root, sheetMusic } = await buildExportRoot(doc.text, headings)

        if (kind === 'html') {
          const inlined = await inlineImages(root)
          const result = await filesApi.exportText(`${name}.html`, selfContainedHtml(name, root), [
            { name: 'HTML 文档', extensions: ['html'] }
          ])
          if (!result.cancelled && result.path) {
            toast('已导出 HTML', 'success', `${result.path}（内联 ${inlined} 张图片）`)
            exportedPath = result.path
          }
        } else if (kind === 'pdf') {
          // 图片先全部转成 data URI：主进程的 asset:// → file:// 重写只认它自己的目录规则，
          // 内联之后不依赖任何路径推断，换目录也不会丢图。
          const inlined = await inlineImages(root)
          const result = await filesApi.exportPdf({
            html: pdfFragment(root),
            defaultName: name,
            baseDir: settings?.assetsDir,
            pageSize: 'A4'
          })
          if (!result.cancelled && result.path) {
            toast('已导出 PDF', 'success', `${result.path}（内联 ${inlined} 张图片）`)
            exportedPath = result.path
          }
        } else {
          const built = await buildDocx(root, name)
          const result = await filesApi.exportBinary(`${name}.docx`, built.bytes, [
            { name: 'Word 文档', extensions: ['docx'] }
          ])
          if (!result.cancelled && result.path) {
            const note = built.notes.length > 0 ? `；${built.notes[0]}` : ''
            toast('已导出 Word', 'success', `${result.path}（内嵌 ${built.images} 张图片）${note}`)
            exportedPath = result.path
          }
        }

        if (sheetMusic.failed > 0) {
          toast('部分五线谱未能排版', 'error', `共 ${sheetMusic.total} 段，成功 ${sheetMusic.rendered} 段`)
        }
      } catch (error) {
        toast('导出失败', 'error', (error as Error).message)
      } finally {
        setExporting(null)
      }
      if (exportedPath) await afterExport(exportedPath)
    },
    [book.title, doc.text, headings, markdownMode, settings?.assetsDir, toast, afterExport]
  )

  useEffect(() => {
    if (!exportOpen) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setExportOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [exportOpen])

  /* ------------------------------------------------------ 外观控制 */

  const setUi = useCallback(
    (patch: Parameters<typeof patchUi>[0]): void => {
      void patchUi(patch)
    },
    [patchUi]
  )

  /* -------------------------------------------------------- 大纲跳转 */

  const jumpToHeading = useCallback((heading: HeadingInfo): void => {
    editorRef.current?.scrollToLine(heading.line)
    previewRef.current?.scrollToHeading(heading.id)
    lastFollowed.current = heading.id
  }, [])

  /* -------------------------------------------------- 缺失文件守卫 */

  if (book.missing) {
    return (
      <div className="bs-editor bs-editor-center">
        <EmptyState
          icon={<IconFolder size={22} />}
          title="文件不在了"
          detail={`「${book.title}」指向的原始文件已经找不到了：${book.path}`}
          action={
            <Button
              variant="outline"
              icon={<IconTrash size={14} />}
              onClick={() => void removeBooks([book.id], false)}
            >
              移除记录
            </Button>
          }
        />
      </div>
    )
  }

  const showOutline = headings.length > 0 && outlineOpen
  const readOnly = !editable

  return (
    <div className={['bs-editor', focusMode ? 'is-focus' : ''].join(' ')}>
      {/* ---------------------------------------------------------- 头部 */}
      <header className="bs-header">
        <div className="bs-header-title">
          <input
            className="bs-title-input"
            value={title}
            spellCheck={false}
            aria-label="文档标题"
            onChange={(event) => setTitle(event.target.value)}
            onBlur={commitTitle}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                event.currentTarget.blur()
              }
              if (event.key === 'Escape') {
                setTitle(book.title)
                event.currentTarget.blur()
              }
            }}
          />
          {doc.dirty ? <span className="bs-dirty" title="有未保存的修改" /> : null}
        </div>

        <span className="bs-format-badge" style={{ background: FORMAT_ACCENT[format] }}>
          {FORMAT_LABEL[format]}
        </span>

        {/* 纯文本不给视图切换：没有渲染结果可切 */}
        {!readOnly && !plainText ? (
          <Segmented<ViewMode> value={mode} onChange={setMode} options={VIEW_OPTIONS} />
        ) : null}

        {headings.length > 0 ? (
          <Button
            size="xs"
            variant="ghost"
            active={outlineOpen}
            title="显示或隐藏大纲"
            onClick={() => setOutlineOpen((v) => !v)}
          >
            大纲
          </Button>
        ) : null}

        {/* 专注模式压暗的是我们自己的容器；HTML 笔记在 iframe 里，对它无效 */}
        {!isHtml ? (
          <Button
            size="xs"
            variant="ghost"
            active={focusMode}
            title="专注模式：压暗当前段落以外的内容"
            onClick={() => setFocusMode((v) => !v)}
          >
            专注
          </Button>
        ) : null}

        <span className="bs-header-spacer" />

        {/* 字号/行高/字体只作用于我们渲染的正文；HTML 笔记自带排版，给了也没用 */}
        {!isHtml ? (
          <div className="bs-appearance">
            <div className="bs-appearance-item" title="编辑器字号">
              <span className="bs-appearance-label">字号</span>
              <Slider
                value={ui?.editorFontSize ?? 15}
                min={12}
                max={24}
                step={1}
                onChange={(value) => setUi({ editorFontSize: value })}
                format={(value) => `${value}px`}
              />
            </div>
            <div className="bs-appearance-item" title="行高">
              <span className="bs-appearance-label">行高</span>
              <Slider
                value={ui?.editorLineHeight ?? 1.85}
                min={1.3}
                max={2.6}
                step={0.05}
                onChange={(value) => setUi({ editorLineHeight: value })}
                format={(value) => value.toFixed(2)}
              />
            </div>
            <div className="bs-appearance-item is-narrow" title="正文字体">
              <Select
                value={ui?.editorFontFamily ?? 'var(--font-serif)'}
                onChange={(value) => setUi({ editorFontFamily: value })}
                options={FONT_OPTIONS}
              />
            </div>
          </div>
        ) : null}

        <div className="bs-header-actions">
          <IconButton label="打开所在文件夹" onClick={() => void appApi.revealPath(book.path)}>
            <IconFolder size={15} />
          </IconButton>
          <IconButton label="用系统应用打开" onClick={() => void appApi.openPath(book.path)}>
            <IconExternalLink size={15} />
          </IconButton>
          {editable ? (
            <>
              <div className="bs-export">
                <Button
                  size="xs"
                  variant="ghost"
                  active={exportOpen}
                  disabled={exporting !== null}
                  icon={<IconDownload size={14} />}
                  title="导出为其他文档"
                  onClick={() => setExportOpen((open) => !open)}
                >
                  {exporting ? EXPORT_BUSY[exporting] : '导出'}
                  <IconChevronDown size={12} />
                </Button>
                {exportOpen ? (
                  <>
                    <span className="bs-export-backdrop" onClick={() => setExportOpen(false)} />
                    <div className="bs-export-menu" role="menu" aria-label="导出格式">
                      {/*
                        导出后的两个后续动作。
                        默认都不勾：导出本身就该是一次干净的动作，别偷偷改书架或动原文件。
                      */}
                      <div className="bs-export-follow">
                        <Switch
                          checked={keepExported}
                          onChange={setKeepExported}
                          label="导出后把新文件加入书架"
                        />
                        <Switch
                          checked={recycleSource}
                          onChange={setRecycleSource}
                          label="导出后把原笔记移入回收站"
                        />
                        <p className="bs-export-follow-hint">
                          两项都在回收站里可还原；不勾就只是导出文件。
                        </p>
                      </div>
                      {EXPORT_ITEMS.map((item) => {
                        const label =
                          item.kind === 'text' ? (markdownMode ? '导出 Markdown 原文' : '导出纯文本原文') : item.label
                        return (
                          <button
                            key={item.kind}
                            type="button"
                            role="menuitem"
                            className="bs-export-item"
                            disabled={item.markdownOnly && !markdownMode}
                            title={
                              item.markdownOnly && !markdownMode
                                ? '纯文本没有可排版的预览，只能导出原文'
                                : item.hint
                            }
                            onClick={() => void runExport(item.kind)}
                          >
                            <span className="bs-export-icon">{item.icon}</span>
                            <span className="bs-export-text">
                              <span className="bs-export-label">{label}</span>
                              <span className="bs-export-hint">{item.hint}</span>
                            </span>
                          </button>
                        )
                      })}
                    </div>
                  </>
                ) : null}
              </div>
              <Button
                size="xs"
                variant="solid"
                icon={<IconSave size={14} />}
                disabled={!doc.dirty || doc.saving}
                title="保存（Ctrl+S）"
                onClick={handleSave}
              >
                {doc.saving ? '保存中…' : '保存'}
              </Button>
            </>
          ) : null}
        </div>
      </header>

      {/* -------------------------------------------------------- 工具栏 */}
      {editable && mode !== 'preview' ? (
        <EditorToolbar disabled={!markdownMode} onAction={runToolbar} />
      ) : null}

      {/* -------------------------------------------------------- 冲突条 */}
      {doc.conflict ? (
        <div className="bs-banner">
          <IconInfo size={15} />
          <span>
            磁盘上的文件被外部修改过，而你还有未保存的修改。请选择如何处理。
          </span>
          <span className="bs-banner-spacer" />
          <Button size="xs" variant="outline" onClick={() => void doc.reload()}>
            重新载入
          </Button>
          <Button size="xs" variant="ghost" onClick={() => void doc.discardChanges()}>
            保留我的修改
          </Button>
        </div>
      ) : null}

      {/* ---------------------------------------------------------- 主体 */}
      {/*
        目录（md 的大纲）与书签合成一条**左**侧栏。
        以前大纲在右边，而 PDF 的目录在左边，同一个应用里忽左忽右很别扭。
      */}
      <div className="bs-body">
        <ReaderSidebar
          book={book}
          toc={
            showOutline ? (
              <OutlinePanel headings={headings} activeId={activeHeadingId} onJump={jumpToHeading} />
            ) : undefined
          }
          tocLabel="大纲"
          addLabel={readOnly ? '标记当前位置' : `标记第 ${cursor.line + 1} 行`}
          width={220}
        />
        <div className={['bs-main', `is-${mode}`, focusMode ? 'is-focus' : ''].join(' ')}>
          {readOnly ? (
            <div className="bs-pane is-full">
              <ReadOnlyPane book={book} />
            </div>
          ) : doc.loadError ? (
            <div className="bs-pane is-full bs-pane-center">
              <EmptyState
                icon={<IconInfo size={22} />}
                title="打不开这个文件"
                detail={doc.loadError}
                action={
                  <Button variant="outline" onClick={() => void doc.reload()}>
                    重试
                  </Button>
                }
              />
            </div>
          ) : (
            <>
              {mode !== 'preview' ? (
                <div className="bs-pane is-editor">
                  <EditorSurface
                    initialValue={doc.text}
                    reloadToken={doc.reloadToken}
                    bookmarkLines={bookmarkLines}
                    flashLine={flashLine}
                    onFlashDone={() => setFlashLine(null)}
                    style={{
                      fontSize: ui?.editorFontSize ?? 15,
                      fontFamily: ui?.editorFontFamily ?? 'var(--font-serif)',
                      lineHeight: ui?.editorLineHeight ?? 1.85
                    }}
                    dark={dark}
                    editable={!readOnly}
                    markdownMode={markdownMode}
                    onChange={doc.updateText}
                    onCursor={(line, column) => setCursor({ line, column })}
                    handleRef={editorRef}
                    onPasteImage={markdownMode ? handlePasteImage : undefined}
                  />
                </div>
              ) : null}
              {markdownMode && mode !== 'edit' ? (
                <div className="bs-pane is-preview">
                  <MarkdownPreview source={deferredText} headings={headings} handleRef={previewRef} />
                </div>
              ) : null}
            </>
          )}
        </div>
      </div>

      {/* -------------------------------------------------------- 状态栏 */}
      <footer className="bs-status">
        {isHtml ? (
          <span className="bs-status-item">HTML 笔记 · 独立来源整页渲染</span>
        ) : (
          <>
            <span className="bs-status-item">字数 {stats.chars.toLocaleString('zh-CN')}</span>
            <span className="bs-status-item">词数 {formatWords(stats.words)}</span>
            <span className="bs-status-item">行数 {stats.lines.toLocaleString('zh-CN')}</span>
            <span className="bs-status-item">约 {stats.minutes} 分钟</span>
          </>
        )}
        {!readOnly && !isHtml ? (
          <span className="bs-status-item">
            第 {cursor.line} 行 · 第 {cursor.column} 列
          </span>
        ) : null}
        <span className="bs-status-item">{formatBytes(doc.size)}</span>
        {book.pageCount > 0 ? (
          <span className="bs-status-item">{formatPages(book.pageCount, book.pageCountExact)}</span>
        ) : null}
        <span className="bs-status-spacer" />
        {editable ? (
          <span className={['bs-status-item', doc.dirty ? 'is-dirty' : ''].join(' ')}>
            {doc.dirty ? '未保存' : `已保存 · ${relativeTime(doc.savedAt)}`}
          </span>
        ) : (
          <span className="bs-status-item">{isHtml ? '可交互' : '只读预览'}</span>
        )}
        <span className="bs-status-item">{FORMAT_LABEL[format]}</span>
      </footer>
    </div>
  )
}
