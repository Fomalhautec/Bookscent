import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { APP_VERSION } from '@shared/types'
import type { BookStyle, OpenAnimation } from '@shared/types'
import { useShortcuts } from '@/lib/useShortcuts'
import { useLibrary } from '@/store/useLibrary'
import { useSettings } from '@/store/useSettings'
import { useUi } from '@/store/useUi'
import { appApi } from '@/lib/api'
import { applyTheme, pickStyleForBook } from '@/lib/theme'
import { TitleBar } from '@/components/shell/TitleBar'
import { Sidebar } from '@/components/shell/Sidebar'
import { ToastHost } from '@/components/shell/ToastHost'
import { ReaderHost } from '@/components/shell/ReaderHost'
import { useReading } from '@/store/useReading'
import { BookContextMenu, BookDetailDrawer, BookshelfView, OpeningAnimation } from '@/features/shelf'
import { SettingsView } from '@/features/settings'
import { VocabView } from '@/features/vocab/VocabView'
import { useVocab } from '@/store/useVocab'
import { StatsView } from '@/features/stats'
import { TrashView } from '@/features/trash'
import { ProgressBar, Spinner } from '@/components/common/Controls'
import { ErrorBoundary } from '@/components/common/ErrorBoundary'
import { IconBookshelf, IconImport } from '@/components/icons/Icons'

export default function App(): ReactNode {
  const settings = useSettings((s) => s.settings)
  const runtime = useSettings((s) => s.runtime)
  const settingsLoading = useSettings((s) => s.loading)
  const loadSettings = useSettings((s) => s.load)

  const index = useLibrary((s) => s.index)
  const reading = useReading((s) => s.active)
  const loadLibrary = useLibrary((s) => s.load)
  const importPaths = useLibrary((s) => s.importPaths)
  const openTemporary = useLibrary((s) => s.openTemporary)
  const createNote = useLibrary((s) => s.createNote)
  const scan = useLibrary((s) => s.scan)

  /* 启动时先读一次单词本：侧栏那个条数要用（页面自己也会读，这里只是让它先有数） */
  useEffect(() => {
    void useVocab.getState().load()
  }, [])

  const view = useUi((s) => s.view)
  const setView = useUi((s) => s.setView)
  const sidebarOpen = useUi((s) => s.sidebarOpen)
  const openBookId = useLibrary((s) => s.openBookId)
  const detailBookId = useUi((s) => s.detailBookId)
  const closeDetail = useUi((s) => s.closeDetail)
  const openDetail = useUi((s) => s.openDetail)
  const opening = useUi((s) => s.opening)
  const clearOpening = useUi((s) => s.clearOpening)
  const toast = useUi((s) => s.toast)

  const [dragging, setDragging] = useState(false)
  const dragDepth = useRef(0)
  const booted = useRef(false)

  /* ------------------------------------------------------------ 初始化 */

  useEffect(() => {
    if (booted.current) return
    booted.current = true
    void loadSettings()
    void loadLibrary()
  }, [loadSettings, loadLibrary])

  /* ------------------------------------------------------------ 换肤 */

  useEffect(() => {
    if (!runtime || !settings) return
    applyTheme(runtime, settings.ui.zoom)
  }, [runtime, settings])

  /* ------------------------------------------------ 主进程推送与订阅 */

  useEffect(() => {
    const offBook = window.bookscent.library.onBookUpdated((book) => {
      const current = useLibrary.getState().index
      if (!current) return
      useLibrary.setState({
        index: { ...current, books: current.books.map((b) => (b.id === book.id ? book : b)) }
      })
    })
    const offProgress = window.bookscent.library.onScanProgress((progress) => {
      const wasRunning = useLibrary.getState().scan?.finished === false
      useLibrary.setState({ scan: progress })
      /*
       * 扫描（统计页数 + 补录封面）跑完时给个回执。
       * 以前只在标题栏转一个小圈，跑完就没了 —— 用户不知道"扫完了没有、扫了几本"。
       */
      if (progress.finished && wasRunning) {
        const count = useLibrary.getState().index?.books.length ?? 0
        useUi
          .getState()
          .toast(
            '藏书目录已扫描完成',
            'success',
            count > 0 ? `共 ${count} 本，页数与封面都已更新` : '书架上还没有书'
          )
      }
    })
    const offOpen = window.bookscent.app.onRequestOpen((paths) => {
      /*
       * 从系统「打开方式」/ 命令行 / 双击关联文件进来：**临时打开**，不直接入库。
       * 用户往往只是想看一眼，之前一律"复制并入库"太霸道。
       * 想留下的，阅读界面右上角有「添加到书架」。
       */
      if (paths.length) void openTemporary(paths[0])
    })
    /*
     * 首次启动带文件（双击关联文件时应用还没开着）：
     * 主动去主进程取一次。用"取"而不是"推"，是因为窗口建好时渲染层还没订阅 IPC。
     */
    void window.bookscent.app.takePendingOpen().then((paths) => {
      if (paths.length) void openTemporary(paths[0])
    })
    return () => {
      offBook()
      offProgress()
      offOpen()
    }
  }, [importPaths, openTemporary])

  /* --------------------------------------------------------- 拖放导入 */

  const onDragEnter = (event: React.DragEvent): void => {
    if (!event.dataTransfer?.types.includes('Files')) return
    event.preventDefault()
    dragDepth.current += 1
    setDragging(true)
  }

  const onDragOver = (event: React.DragEvent): void => {
    if (!event.dataTransfer?.types.includes('Files')) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
  }

  const onDragLeave = (): void => {
    dragDepth.current = Math.max(0, dragDepth.current - 1)
    if (dragDepth.current === 0) setDragging(false)
  }

  const onDrop = (event: React.DragEvent): void => {
    if (!event.dataTransfer?.files?.length) return
    event.preventDefault()
    dragDepth.current = 0
    setDragging(false)
    const paths: string[] = []
    for (const file of Array.from(event.dataTransfer.files)) {
      const path = appApi.getPathForFile(file)
      if (path) paths.push(path)
    }
    if (paths.length === 0) {
      toast('无法识别拖入的文件', 'warn', '请改用「导入」按钮选择文件。')
      return
    }
    void importPaths(paths, true)
  }

  /* ----------------------------------------------------------- 快捷键 */

  /* 全局快捷键走统一系统（设置页里能改键、也能看出各自适用范围） */
  useShortcuts({
    'global.newNote': () => void createNote('md'),
    'global.newText': () => void createNote('txt'),
    'global.import': () => void useLibrary.getState().importFiles(true),
    'global.tempOpen': () => void useLibrary.getState().importFiles(false),
    'global.settings': () => setView('settings'),
    'global.detail': () => openDetail(useLibrary.getState().openBookId ?? ''),
    'global.rescan': () => void useLibrary.getState().rescan()
  })

  /* -------------------------------------------------------------- 渲染 */

  const detailBook = useMemo(
    () => (detailBookId ? index?.books.find((b) => b.id === detailBookId) : undefined),
    [detailBookId, index?.books]
  )

  const booting = (settingsLoading || !index) && !settings

  const scanning = scan && !scan.finished && scan.total > 0

  const openingBook = useMemo(
    () => (opening ? index?.books.find((b) => b.id === opening.bookId) : undefined),
    [opening, index?.books]
  )

  const openingStyle = useMemo(() => {
    if (!openingBook || !settings) return {} as BookStyle
    return pickStyleForBook(openingBook, settings, 0)
  }, [openingBook, settings])

  const openAnimationMode: OpenAnimation = settings?.ui.openAnimation ?? 'full'

  return (
    <div className="app-shell" onDragEnter={onDragEnter} onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}>
      <TitleBar />

      <div className="app-body">
        {/*
          侧栏在书架与回收站都显示：回收站是和"全部藏书"并列的一处，
          没有侧栏会让人觉得走进了另一个界面（用户就是这么说的）。
        */}
        {(view === 'shelf' || view === 'trash') && !openBookId && sidebarOpen ? <Sidebar /> : null}

        <main className="app-main">
          <ErrorBoundary
            key={`${view}-${openBookId ?? 'shelf'}`}
            label={openBookId ? '这本书' : view === 'settings' ? '设置面板' : view === 'stats' ? '统计' : '书架'}
          >
            {booting ? (
              <BootScreen label={settingsLoading ? '正在打开书房…' : '正在整理书架…'} />
            ) : view === 'settings' ? (
              <SettingsView />
            ) : view === 'trash' ? (
              /* 回收站：只有还原与彻底删除两个动作 */
              <TrashView />
            ) : view === 'vocab' ? (
              <VocabView />
            ) : view === 'stats' ? (
              // 点统计里的条目直接打开那本书/笔记
              <StatsView
                onOpen={(id) => {
                  setView('shelf')
                  useLibrary.getState().select(id)
                }}
              />
            ) : openBookId ? (
              <ReaderHost />
            ) : (
              <BookshelfView />
            )}
          </ErrorBoundary>

          {dragging ? (
            <div className="drop-veil">
              <IconImport size={26} />
              <span>松手即上书架</span>
              <span style={{ fontSize: 12, fontFamily: 'var(--font-sans)' }}>
                支持 PDF、Markdown、纯文本、Word、网页与图片
              </span>
            </div>
          ) : null}
        </main>
      </div>

      <footer className="statusbar">
        {/*
          读书时这一行换成本书的阅读统计（用户要的位置）。
          注意是**单独一个小组件**订阅那份每秒都在变的数据：
          若在 App 里直接订阅，整棵树（包括 foliate 的阅读视图）都会每秒重渲染一次，
          和"切排版方向时重开书"的布局撞在一起能把渲染进程卡死。
        */}
        <StatusReading />
        {scanning ? (
          <span className="statusbar-item busy-flag">
            <Spinner size={12} />
            正在统计页数 {scan?.done}/{scan?.total}
            <span style={{ width: 90 }}>
              <ProgressBar value={scan?.done ?? 0} max={scan?.total ?? 1} />
            </span>
          </span>
        ) : null}
        <span className="statusbar-spacer" />
        <span className="statusbar-item statusbar-mono" title={index?.libraryDir}>
          {index?.libraryDir ?? '—'}
        </span>
        <span className="statusbar-item">
          {runtime ? `${runtime.app.name} · ${runtime.shelf.name}` : '—'}
        </span>
        <span className="statusbar-item statusbar-mono">v{APP_VERSION}</span>
      </footer>

      <BookContextMenu />
      <ToastHost />

      {openingBook ? (
        <OpeningAnimation
          key={`${openingBook.id}-${opening?.at ?? 0}`}
          book={openingBook}
          style={openingStyle}
          from={opening!.rect}
          mode={openAnimationMode === 'simple' ? 'simple' : 'full'}
          onDone={clearOpening}
        />
      ) : null}

      {detailBook ? (
        <div className="drawer-layer">
          <div className="drawer-scrim" onClick={closeDetail} />
          <aside className="drawer drawer-right" style={{ width: 470 }}>
            <BookDetailDrawer book={detailBook} onClose={closeDetail} />
          </aside>
        </div>
      ) : null}
    </div>
  )
}

function BootScreen({ label }: { label: string }): ReactNode {
  return (
    <div className="boot-screen">
      <span className="boot-mark">
        <IconBookshelf size={40} />
      </span>
      <span>{label}</span>
    </div>
  )
}

/** 秒数 → 「1 小时 20 分」这种（状态栏与阅读界面口径一致） */
function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds))
  if (total < 60) return `${total} 秒`
  const minutes = Math.floor(total / 60)
  if (minutes < 60) return `${minutes} 分`
  const hours = Math.floor(minutes / 60)
  return `${hours} 小时 ${minutes % 60} 分`
}/**
 * 状态栏左侧那一格：读书时显示这本书的统计，否则显示书架信息。
 *
 * 单独成一个组件，是为了把"每秒刷新"限在它自己身上 ——
 * 若在 App 里直接订阅那份每秒都变的数据，整棵树（包括 foliate 的阅读视图）
 * 都会每秒重渲染，和"切排版方向时重开书"的布局撞在一起会把渲染进程卡死。
 */
function StatusReading(): ReactNode {
  const reading = useReading((s) => s.active)
  const index = useLibrary((s) => s.index)

  /*
   * 临时开关：排查"整套跑到打开书籍动画就卡住"是不是这一格引起的。
   * 置 false 时状态栏始终显示书架信息（即改动前的行为）。
   */
  const SHOW_READING_STATS = true

  if (!reading || !SHOW_READING_STATS) {
    return (
      <span className="statusbar-item">
        <IconBookshelf size={13} />
        {index?.books.length ?? 0} 本藏书 · {index?.shelves.length ?? 0} 层书架
      </span>
    )
  }

  return (
    <>
      <span className="statusbar-item" title={reading.title}>
        <IconBookshelf size={13} />
        {reading.asNote ? '写作中' : '阅读中'} · {reading.title}
      </span>
      <span className="statusbar-item">本次 {formatDuration(reading.sessionSeconds)}</span>
      <span className="statusbar-item">
        共打开 {reading.opens + 1} 次 · 累计 {formatDuration(reading.seconds + reading.sessionSeconds)}
      </span>
      <span className="statusbar-item">
        {reading.asNote
          ? `累计输入 ${reading.words.toLocaleString('zh-CN')} 字`
          : `累计翻过 ${reading.pages} 页`}
      </span>
    </>
  )
}