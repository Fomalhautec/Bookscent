import { useEffect, useRef, useState, type ReactNode } from 'react'
import { APP_VERSION } from '@shared/types'
import { Button, EmptyState, Spinner } from '@/components/common/Controls'
import {
  IconBook,
  IconBookshelf,
  IconGlobe,
  IconInfo,
  IconKeyboard,
  IconLibrary,
  IconPalette,
  IconRefresh,
  IconSettings,
  IconTextCursor
} from '@/components/icons/Icons'
import { useSettings } from '@/store/useSettings'
import { useUi } from '@/store/useUi'
import { AboutTab } from './AboutTab'
import { AppearanceTab } from './AppearanceTab'
import { GeneralTab } from './GeneralTab'
import { LibraryTab } from './LibraryTab'
import { ReadingTab } from './ReadingTab'
import { ShortcutTab } from './ShortcutTab'
import { SettingsSubPage, type SubPageId } from './SubPages'
import { TranslateTab } from './TranslateTab'
import { ShelfTab } from './ShelfTab'
import { SpineStylesTab } from './SpineStylesTab'

type TabId = 'general' | 'appearance' | 'spine' | 'shelf' | 'reading' | 'translate' | 'keys' | 'files' | 'about'

interface TabDef {
  id: TabId
  label: string
  icon: ReactNode
  description: string
  /**
   * 这一页拥有哪些设置项（点分路径）。
   * 「恢复本页默认」只重置这些 —— `ui` 一个大对象横跨好几页，
   * 按顶层键重置会把别页的设置一起清掉。空数组 = 这一页没有可重置项。
   */
  resetPaths: string[]
}

const SHELF_PATHS = [
  'ui.shelfRowHeight',
  'ui.showPlaque',
  'ui.showShadow',
  'ui.shelfTilt',
  'ui.bookHeightVariation',
    'ui.coverHeightVariation',
    'ui.coverHeightScale',
  'ui.bookFacing',
  
  'ui.heightMode',
  'ui.shelfLayout',
  'ui.shelfBayMaxWidth',
  'ui.shelfSort',
  'ui.shelfSortDesc',
  'ui.coverBookGap',
  'ui.filterFormats',
  'ui.filterStatus',
  'ui.filterTags',
  'ui.filterMinRating'
]

const TABS: TabDef[] = [
  {
    id: 'general',
    label: '通用',
    icon: <IconSettings size={17} />,
    description: '新建笔记的默认格式、界面缩放与动画，还有下次打开时侧栏的样子。',
    resetPaths: ['ui.zoom', 'ui.newNoteFormat', 'ui.sidebarOpen', 'ui.animate', 'ui.openAnimation']
  },
  {
    id: 'appearance',
    label: '外观',
    icon: <IconPalette size={17} />,
    description: '界面本身的观感：应用主题与书架材质。书籍长什么样请去「书籍外观」。',
    resetPaths: ['appTheme', 'shelfTheme', 'customThemes']
  },
  {
    id: 'spine',
    label: '书籍外观',
    icon: <IconBook size={17} />,
    description: '书脊工艺、烫金、贴图与封面 —— 先定基准样式，再由样式列表分配下去。',
    resetPaths: [
      'bookStyle',
      'noteStyle',
      'spineStyles',
      'spineStyleMode',
      'noteSpineStyles',
      'noteSpineStyleMode',
      'customBookStyles'
    ]
  },
  {
    id: 'shelf',
    label: '书架与排序',
    icon: <IconBookshelf size={17} />,
    description: '书籍朝向、高度错落、分层或整墙书柜，以及默认的排序与筛选。',
    resetPaths: SHELF_PATHS
  },
  {
    id: 'reading',
    label: '阅读与编辑',
    icon: <IconTextCursor size={17} />,
    description: '字号、行高、自动保存与 PDF 视图，按你的读写节奏来。',
    resetPaths: [
      'ui.editorFontSize',
      'ui.editorFontFamily',
      'ui.editorLineHeight',
      'ui.autosave',
      'ui.autosaveDelay',
      'ui.pdfDefaultZoom',
      'ui.pdfContinuous',
      'ui.pageFlipAnimation'
    ]
  },
  {
    id: 'translate',
    label: '翻译',
    icon: <IconGlobe size={17} />,
    description: '机翻与 AI 两套配置：选引擎、填密钥、目标语言与上下文段数，AI 还能改提示词。',
    resetPaths: ['translate']
  },
  {
    id: 'keys',
    label: '快捷键',
    icon: <IconKeyboard size={17} />,
    description: '一条条列出所有快捷键与它们的适用范围（全局 / EPUB / PDF / 编辑器），可逐项改键。',
    resetPaths: ['ui.shortcuts']
  },
  {
    id: 'files',
    label: '文件与数据',
    icon: <IconLibrary size={17} />,
    description: '藏书目录、图片数据目录、导入方式、书架层，以及设置的导出与恢复。',
    resetPaths: ['assetsDir']
  },
  {
    id: 'about',
    label: '关于',
    icon: <IconInfo size={17} />,
    description: '版本、运行环境、数据位置、更新日志与常用快捷键。',
    resetPaths: []
  }
]

export function SettingsView(): ReactNode {
  const settings = useSettings((s) => s.settings)
  const loading = useSettings((s) => s.loading)
  const error = useSettings((s) => s.error)
  const load = useSettings((s) => s.load)
  const resetPaths = useSettings((s) => s.resetPaths)
  const toast = useUi((s) => s.toast)
  const [tab, setTab] = useState<TabId>('general')
  /* 子页：翻译记录 / 引用的书籍 / 更新日志（仍然属于各自的分页） */
  const [sub, setSub] = useState<SubPageId | null>(null)
  const asked = useRef(false)
  const pane = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (settings || loading || asked.current) return
    asked.current = true
    void load()
  }, [settings, loading, load])

  // 换分页时把内容滚回顶部，否则会停在上一个分页滚到的位置、看不到开头
  // （.set-pane 才是滚动容器）
  useEffect(() => {
    pane.current?.scrollTo({ top: 0 })
  }, [tab, sub])

  const active = TABS.find((item) => item.id === tab) ?? TABS[0]

  /* 「恢复本页默认」：点一下先变成确认，再点才真的恢复 ——
     恢复设置不可撤销，值得多问一句，但不值得为它开一个弹窗。 */
  const [confirming, setConfirming] = useState(false)
  const [resetting, setResetting] = useState(false)
  useEffect(() => setConfirming(false), [tab])

  const runReset = async (): Promise<void> => {
    if (active.resetPaths.length === 0) return
    if (!confirming) {
      setConfirming(true)
      return
    }
    setResetting(true)
    try {
      await resetPaths(active.resetPaths)
      toast('已恢复本页默认', 'success', active.label)
    } catch (error) {
      toast('恢复失败', 'error', (error as Error).message)
    } finally {
      setResetting(false)
      setConfirming(false)
    }
  }

  return (
    <div className="set-view">
      <nav className="set-nav" aria-label="设置分类">
        <div className="set-nav-brand">
          <IconSettings size={16} />
          <span>设置</span>
        </div>
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`set-nav-item ${item.id === tab ? 'is-active' : ''}`}
            aria-current={item.id === tab}
            onClick={() => {
                  setSub(null)
                  setTab(item.id)
                }}
          >
            <span className="set-nav-icon">{item.icon}</span>
            <span className="set-nav-text">
              <span className="set-nav-label">{item.label}</span>
            </span>
          </button>
        ))}
        <div className="set-nav-foot">v{APP_VERSION} · MIT 许可</div>
      </nav>

      <main className="set-pane" ref={pane}>
        <header className="set-head">
          <div className="set-head-main">
            <h1>设置</h1>
            <p>{active.description}</p>
          </div>
          <div className="set-head-actions">
            {active.resetPaths.length > 0 ? (
              <Button
                variant={confirming ? 'solid' : 'outline'}
                size="sm"
                icon={<IconRefresh size={14} />}
                disabled={resetting}
                onClick={() => void runReset()}
                title={`把「${active.label}」这一页的设置恢复成出厂默认，其它页不受影响`}
              >
                {resetting ? '正在恢复…' : confirming ? '再点一次即恢复' : '恢复本页默认'}
              </Button>
            ) : null}
            <span className="set-head-tag">{active.label}</span>
          </div>
        </header>

        {!settings ? (
          error ? (
            <EmptyState
              icon={<IconInfo size={22} />}
              title="设置读取失败"
              detail={error}
              action={
                <Button
                  variant="outline"
                  icon={<IconRefresh size={14} />}
                  onClick={() => {
                    asked.current = false
                    void load()
                  }}
                >
                  重试
                </Button>
              }
            />
          ) : (
            <div className="set-loading">
              <Spinner size={22} />
              <span>正在读取设置…</span>
            </div>
          )
        ) : (
          <div className="set-content">
            {/* 子页优先：它仍然属于某个分页，只是把长内容单独放一页 */}
            {sub ? <SettingsSubPage id={sub} settings={settings} onBack={() => setSub(null)} /> : null}
            {!sub && tab === 'general' ? <GeneralTab settings={settings} /> : null}
            {!sub && tab === 'appearance' ? (
              <AppearanceTab settings={settings} onGoTo={(next) => setTab(next)} />
            ) : null}
            {!sub && tab === 'spine' ? <SpineStylesTab settings={settings} /> : null}
            {!sub && tab === 'shelf' ? <ShelfTab settings={settings} /> : null}
            {!sub && tab === 'reading' ? <ReadingTab settings={settings} /> : null}
            {!sub && tab === 'translate' ? <TranslateTab settings={settings} onOpenSub={setSub} /> : null}
            {!sub && tab === 'keys' ? <ShortcutTab settings={settings} /> : null}
            {!sub && tab === 'files' ? <LibraryTab settings={settings} onOpenSub={setSub} /> : null}
            {!sub && tab === 'about' ? <AboutTab onOpenSub={setSub} /> : null}
          </div>
        )}
      </main>
    </div>
  )
}
