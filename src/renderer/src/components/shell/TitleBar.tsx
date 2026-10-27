import { useEffect, useState, type ReactNode } from 'react'
import { APP_VERSION } from '@shared/types'
import { useLibrary } from '@/store/useLibrary'
import { useSettings } from '@/store/useSettings'
import { useUi } from '@/store/useUi'
import { useVocab } from '@/store/useVocab'
import { libraryApi } from '@/lib/api'
import {
  IconBookOpen,
  IconBookshelf,
  IconCalendar,
  IconClose,
  IconGrid,
  IconList,
  IconMaximize,
  IconMenu as IconMenuBars,
  IconMinimize,
  IconSettings,
  IconRefresh,
  IconRestore,
  IconSearch
} from '@/components/icons/Icons'

export function TitleBar(): ReactNode {
  const view = useUi((s) => s.view)
  const vocabCount = useVocab((s) => s.words.length)
  const setView = useUi((s) => s.setView)
  const sidebarOpen = useUi((s) => s.sidebarOpen)
  const toggleSidebar = useUi((s) => s.toggleSidebar)

  const query = useLibrary((s) => s.query)
  const setQuery = useLibrary((s) => s.setQuery)
  const viewMode = useLibrary((s) => s.viewMode)
  const setViewMode = useLibrary((s) => s.setViewMode)
  const importFiles = useLibrary((s) => s.importFiles)
  const createNote = useLibrary((s) => s.createNote)
  const rescan = useLibrary((s) => s.rescan)
  const scan = useLibrary((s) => s.scan)

  const settings = useSettings((s) => s.settings)

  const [maximized, setMaximized] = useState(false)

  useEffect(() => {
    void window.bookscent.app.windowIsMaximized().then(setMaximized)
    return window.bookscent.app.onMaximizeChange(setMaximized)
  }, [])

  const scanning = scan && !scan.finished && scan.total > 0

  return (
    <header className="titlebar">
      <div className="titlebar-brand">
        <span className="titlebar-mark">
          <IconBookshelf size={16} />
        </span>
        <span className="titlebar-name">书香笔记</span>
        <span className="titlebar-version">v{APP_VERSION}</span>
      </div>

      <div className="titlebar-nav">
        <button
          type="button"
          className={['btn', 'btn-sm', view === 'shelf' ? 'is-active' : 'btn-ghost'].join(' ')}
          onClick={() => setView('shelf')}
        >
          <span className="btn-icon">
            <IconBookshelf size={14} />
          </span>
          <span className="btn-label">书架</span>
        </button>
        <button
          type="button"
          className={['btn', 'btn-sm', view === 'vocab' ? 'is-active' : 'btn-ghost'].join(' ')}
          onClick={() => {
            setView('vocab')
            void useVocab.getState().load()
          }}
          title="把翻译里的词收进来，按语种分开记"
        >
          <span className="btn-icon">
            <IconBookOpen size={14} />
          </span>
          <span className="btn-label">单词本</span>
          {vocabCount > 0 ? <span className="btn-count">{vocabCount}</span> : null}
        </button>
        <button
          type="button"
          className={['btn', 'btn-sm', view === 'stats' ? 'is-active' : 'btn-ghost'].join(' ')}
          onClick={() => setView('stats')}
          title="阅读与写作的统计"
        >
          <span className="btn-icon">
            <IconCalendar size={14} />
          </span>
          <span className="btn-label">统计</span>
        </button>
        <button
          type="button"
          className={['btn', 'btn-sm', view === 'settings' ? 'is-active' : 'btn-ghost'].join(' ')}
          onClick={() => setView('settings')}
        >
          <span className="btn-icon">
            <IconSettings size={14} />
          </span>
          <span className="btn-label">设置</span>
        </button>
      </div>

      <span className="titlebar-divider" />

      {view === 'shelf' ? (
        <>
          <div className="titlebar-search no-drag">
            <span className="titlebar-search-icon">
              <IconSearch size={14} />
            </span>
            <input
              className="text-input"
              placeholder="搜索书名、作者、标签…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            {query ? (
              <button className="titlebar-search-clear" type="button" onClick={() => setQuery('')} aria-label="清空搜索">
                <IconClose size={13} />
              </button>
            ) : null}
          </div>

          {/* 新建与导入已经移到侧栏，这里只保留搜索与视图切换 */}
          <span className="titlebar-divider" />

          <div className="titlebar-actions">
            <button
              type="button"
              className={['icon-btn', viewMode === 'grid' ? 'is-active' : ''].filter(Boolean).join(' ')}
              title="书架视图"
              onClick={() => setViewMode('grid')}
            >
              <IconGrid size={15} />
            </button>
            <button
              type="button"
              className={['icon-btn', viewMode === 'list' ? 'is-active' : ''].filter(Boolean).join(' ')}
              title="列表视图"
              onClick={() => setViewMode('list')}
            >
              <IconList size={15} />
            </button>
            <button
              type="button"
              className="icon-btn"
              title={scanning ? `正在统计页数… ${scan?.done}/${scan?.total}` : '重新扫描藏书目录'}
              onClick={() => void rescan()}
            >
              <IconRefresh size={15} className={scanning ? 'is-spinning' : undefined} />
            </button>
          </div>
        </>
      ) : null}

      <span className="titlebar-spacer" />

      <div className="titlebar-actions">
        <button
          type="button"
          className={['icon-btn', sidebarOpen ? 'is-active' : ''].filter(Boolean).join(' ')}
          title={sidebarOpen ? '收起侧栏' : '展开侧栏'}
          onClick={toggleSidebar}
        >
          <IconMenuBars size={15} />
        </button>
      </div>

      <div className="window-controls">
        <button
          type="button"
          className="window-btn"
          title="最小化"
          onClick={() => void window.bookscent.app.windowMinimize()}
        >
          <IconMinimize size={15} />
        </button>
        <button
          type="button"
          className="window-btn"
          title={maximized ? '还原' : '最大化'}
          onClick={() => void window.bookscent.app.windowToggleMaximize().then(setMaximized)}
        >
          {maximized ? <IconRestore size={14} /> : <IconMaximize size={13} />}
        </button>
        <button
          type="button"
          className="window-btn window-btn-close"
          title="关闭"
          onClick={() => void window.bookscent.app.windowClose()}
        >
          <IconClose size={15} />
        </button>
      </div>
    </header>
  )
}
