import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { Shelf } from '@shared/types'
import { shelfFallbackFor, useLibrary } from '@/store/useLibrary'
import { useSettings } from '@/store/useSettings'
import { useUi } from '@/store/useUi'
import { useVocab } from '@/store/useVocab'
import { appApi } from '@/lib/api'
import { IconBookOpen } from '@/components/icons/Icons'
import { Button, CheckRow, ColorInput, IconButton, Modal, ProgressBar } from '@/components/common/Controls'
import { MenuButton, type MenuEntry } from '@/components/common/Menu'
import {
  IconBookStack,
  IconCheck,
  IconClose,
  IconEdit,
  IconFilePlus,
  IconFolderOpen,
  IconImport,
  IconLibrary,
  IconPalette,
  IconPlus,
  IconRefresh,
  IconTrash
} from '@/components/icons/Icons'

/** 导入项：临时打开 / 文件 / 文件夹 × 复制 / 引用，几条路都摆出来 */
function IMPORT_ITEMS(
  importFiles: (copy: boolean) => Promise<number>,
  importFolder: (copy: boolean) => Promise<number>,
  pickTemporary: () => Promise<void>
): MenuEntry[] {
  return [
    {
      /*
       * 临时打开：电脑里的文件先看一眼，不进书架。
       * 排在第一位，因为它是最轻的动作 —— 想留下再点阅读界面里的「添加到书架」。
       */
      id: 'temp-open',
      label: '临时打开…',
      hint: '只看一眼，不进书架',
      icon: <IconFilePlus size={14} />,
      onSelect: () => void pickTemporary()
    },
    { separator: true },
    {
      id: 'files-copy',
      label: '导入文件…',
      hint: '复制进藏书目录',
      icon: <IconFilePlus size={14} />,
      onSelect: () => void importFiles(true)
    },
    {
      id: 'files-ref',
      label: '引用文件…',
      hint: '留在原位置',
      icon: <IconFilePlus size={14} />,
      onSelect: () => void importFiles(false)
    },
    { separator: true },
    {
      id: 'folder-copy',
      label: '导入文件夹…',
      hint: '递归复制',
      icon: <IconFolderOpen size={14} />,
      onSelect: () => void importFolder(true)
    },
    {
      id: 'folder-ref',
      label: '引用文件夹…',
      hint: '留在原位置',
      icon: <IconFolderOpen size={14} />,
      onSelect: () => void importFolder(false)
    }
  ]
}

/* ------------------------------------------------------- 书架层主题色（共享） */

/**
 * 书架层主题色板：纸、木、烫金这一路的暖色，
 * 摆在纸质书架上不像荧光笔，也不会把书脊的颜色压下去。
 */
export const SHELF_THEME_COLORS: { color: string; name: string }[] = [
  { color: '#8c5a3c', name: '檀木棕' },
  { color: '#a9713f', name: '胡桃黄' },
  { color: '#c0913c', name: '烫金' },
  { color: '#7c8b4a', name: '苔绿' },
  { color: '#5f7f6a', name: '竹青' },
  { color: '#4e7a8a', name: '青瓷' },
  { color: '#5b6b96', name: '靛蓝' },
  { color: '#7a5f9e', name: '紫檀' },
  { color: '#a85a63', name: '胭脂' },
  { color: '#8a7a68', name: '亚麻灰' }
]

/**
 * 书架层主题色选择器：预设色板 + 自定义颜色 + 「不设色」。
 *
 * 侧栏的书架层右键菜单和设置里的书架层管理共用这一个组件，
 * 两边改的都是同一份 `Shelf.color`，所以怎么改都不会跑偏。
 */
export function ShelfColorPicker({
  value,
  onChange,
  size = 'md'
}: {
  value?: string | null
  onChange: (color: string | null) => void
  size?: 'sm' | 'md'
}): ReactNode {
  const current = (value ?? '').toLowerCase()
  return (
    <div className={['sidebar-shelf-color', `is-${size}`].join(' ')}>
      <div className="sidebar-shelf-color-grid">
        {SHELF_THEME_COLORS.map((entry) => {
          const active = current === entry.color
          return (
            <button
              key={entry.color}
              type="button"
              className={['sidebar-shelf-swatch', active ? 'is-active' : ''].filter(Boolean).join(' ')}
              style={{ background: entry.color }}
              title={entry.name}
              aria-label={entry.name}
              aria-pressed={active}
              onClick={() => onChange(entry.color)}
            >
              {active ? <IconCheck size={12} /> : null}
            </button>
          )
        })}
      </div>
      <div className="sidebar-shelf-color-custom">
        <ColorInput
          label="自定义主题色"
          value={value || SHELF_THEME_COLORS[0].color}
          onChange={(next) => onChange(next)}
        />
        <Button variant="subtle" size="xs" disabled={!value} onClick={() => onChange(null)}>
          不设色
        </Button>
      </div>
    </div>
  )
}

/* --------------------------------------------------------- 删除书架层弹窗 */

/**
 * 删除书架层的应用内确认弹窗。
 *
 * 用 Modal 而不是 Electron 原生 dialog：原生窗口装不下这个勾选框。
 * 勾选（默认）→ 层里的书改归到「我的书架」（没有就叫剩下的第一层）后删层；
 * 不勾选 → 不允许删除，因为书不能失去归属。文件始终留在磁盘上。
 */
export function ShelfDeleteModal({
  open,
  shelfName,
  targetName,
  bookCount,
  onCancel,
  onConfirm
}: {
  open: boolean
  shelfName: string
  targetName: string
  bookCount: number
  onCancel: () => void
  onConfirm: () => void
}): ReactNode {
  const [moveBooks, setMoveBooks] = useState(true)

  // 每次打开都回到默认勾选，免得上次的操作悄悄留在弹窗里
  useEffect(() => {
    if (open) setMoveBooks(true)
  }, [open])

  return (
    <Modal
      open={open}
      title="删除书架层"
      subtitle="只删这一层，书和文件都不会被删掉"
      onClose={onCancel}
      width={480}
      className="confirm-modal"
      footer={
        <>
          <Button variant="ghost" onClick={onCancel}>
            取消
          </Button>
          <Button variant="danger" disabled={!moveBooks} onClick={onConfirm} data-confirm="1">
            删除这一层
          </Button>
        </>
      }
    >
      <div className="confirm-body">
        <p className="confirm-message">删除「{shelfName}」这一层？</p>
        <CheckRow
          checked={moveBooks}
          onChange={setMoveBooks}
          label={`把这一层的书归到「${targetName}」`}
          detail={`这一层的 ${bookCount} 本书会改归到「${targetName}」，文件仍留在藏书目录里。`}
        />
        {moveBooks ? null : (
          <p className="sidebar-shelf-delete-note">
            不勾选就无法删除：这些书会失去归属。请勾选后归到「{targetName}」，或者先把书挪到别的层再来删。
          </p>
        )}
      </div>
    </Modal>
  )
}

/* ------------------------------------------------------------------ 侧栏 */

interface ShelfMenuState {
  shelfId: string
  x: number
  y: number
}

export function Sidebar(): ReactNode {
  const open = useUi((s) => s.sidebarOpen)
  const index = useLibrary((s) => s.index)
  const activeShelfId = useLibrary((s) => s.activeShelfId)
  const setActiveShelf = useLibrary((s) => s.setActiveShelf)
  const addShelf = useLibrary((s) => s.addShelf)
  const renameShelf = useLibrary((s) => s.renameShelf)
  const removeShelf = useLibrary((s) => s.removeShelf)
  const setShelfColor = useLibrary((s) => s.setShelfColor)
  const rescan = useLibrary((s) => s.rescan)
  const scan = useLibrary((s) => s.scan)
  const importFolder = useLibrary((s) => s.importFolder)
  const importFiles = useLibrary((s) => s.importFiles)
  const pickTemporary = useLibrary((s) => s.pickTemporary)
  const createNote = useLibrary((s) => s.createNote)
  const settings = useSettings((s) => s.settings)
  const openDetail = useUi((s) => s.openDetail)
  const setView = useUi((s) => s.setView)
  /* 当前视图：回收站与书架并列，高亮要跟着走 */
  const view = useUi((s) => s.view)

  const newNoteFormat = settings?.ui.newNoteFormat ?? 'md'
  // 库里已经有 HTML 笔记时才提示"引用"这条路，平时不占地方
  const isHtmlHintVisible = (index?.books ?? []).some((book) => book.format === 'html')

  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState('')

  // 右键菜单：位置先落在鼠标上，渲染后再按实际尺寸收进窗口里
  const [menu, setMenu] = useState<ShelfMenuState | null>(null)
  const [menuPalette, setMenuPalette] = useState(false)
  const [menuPos, setMenuPos] = useState({ left: 0, top: 0 })
  const menuRef = useRef<HTMLDivElement>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  /* 临时打开的书不计入书架与数量（它们只在阅读器里出现，点了「添加到书架」才留下） */
  const books = (index?.books ?? []).filter((book) => !book.temporary && !book.trashed)
  /* 回收站里的数量（侧栏那个入口的角标） */
  const vocabCount = useVocab((s) => s.words.length)
  const trashedCount = (index?.books ?? []).filter((book) => book.trashed).length
  const shelves = index?.shelves ?? []
  const scanning = scan && !scan.finished && scan.total > 0

  const countOf = (shelfId: string): number => books.filter((b) => b.shelfId === shelfId).length
  const reading = books.filter((b) => b.status === 'reading')

  const menuShelf: Shelf | undefined = menu ? shelves.find((s) => s.id === menu.shelfId) : undefined
  const deletingShelf: Shelf | undefined = deletingId ? shelves.find((s) => s.id === deletingId) : undefined
  const deleteTarget = deletingId ? shelfFallbackFor(shelves, deletingId) : undefined
  const isLastShelf = shelves.length <= 1

  const commitAdd = (): void => {
    const name = draft.trim()
    setDraft('')
    setAdding(false)
    if (name) void addShelf(name)
  }

  const openShelfMenu = (event: React.MouseEvent<HTMLDivElement>, shelfId: string): void => {
    event.preventDefault()
    event.stopPropagation()
    // 正在内联改名时右键：先把改了一半的名字落盘，再收输入框，免得白改
    if (editingId && editDraft.trim()) void renameShelf(editingId, editDraft.trim())
    setEditingId(null)
    setMenuPalette(false)
    setMenu({ shelfId, x: event.clientX, y: event.clientY })
    setMenuPos({ left: event.clientX, top: event.clientY })
  }

  const startRename = (shelf: Shelf): void => {
    setMenu(null)
    setEditingId(shelf.id)
    setEditDraft(shelf.name)
  }

  const startDelete = (shelf: Shelf): void => {
    setMenu(null)
    if (isLastShelf) return
    setDeletingId(shelf.id)
  }

  // 点到别处、按下 Esc、滚动或窗口失焦都收菜单，和书脊右键菜单的手感一致
  useEffect(() => {
    if (!menu) return
    const close = (): void => setMenu(null)
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setMenu(null)
    }
    // 打开系统取色器时窗口会失焦，这时候不能把菜单（连同色板）收掉
    const onWindowBlur = (): void => {
      if (menuRef.current?.contains(document.activeElement)) return
      setMenu(null)
    }
    window.addEventListener('mousedown', close)
    window.addEventListener('keydown', onKey)
    window.addEventListener('resize', close)
    window.addEventListener('scroll', close, true)
    window.addEventListener('blur', onWindowBlur)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', close)
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('blur', onWindowBlur)
    }
  }, [menu])

  // 菜单本身够不着的地方就别摆出去：展开色板后变高了，这里再量一次
  useLayoutEffect(() => {
    if (!menu) return
    const el = menuRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const left = Math.max(8, Math.min(menu.x, window.innerWidth - rect.width - 8))
    const top = Math.max(8, Math.min(menu.y, window.innerHeight - rect.height - 8))
    setMenuPos((prev) => (prev.left === left && prev.top === top ? prev : { left, top }))
  }, [menu, menuPalette])

  return (
    <aside className={['sidebar', open ? '' : 'is-collapsed'].filter(Boolean).join(' ')}>
      <div className="sidebar-inner">
        {/* 新建与导入放在侧栏：这是最常做的两件事，不该藏在标题栏的菜单里 */}
        <div className="sidebar-group sidebar-create">
          <div className="sidebar-actions">
            <Button
              block
              variant="solid"
              icon={<IconPlus size={14} />}
              onClick={() => void createNote(newNoteFormat)}
            >
              新建笔记
            </Button>
            <MenuButton
              block
              variant="outline"
              align="left"
              label="导入"
              icon={<IconImport size={14} />}
              items={IMPORT_ITEMS(importFiles, importFolder, pickTemporary)}
            />
          </div>
          {isHtmlHintVisible ? (
            <p className="sidebar-hint">
              HTML 笔记若还带着同目录的 <code>.js</code>/<code>.css</code>，建议用「引用外部文件」。
            </p>
          ) : null}
        </div>

        <div className="sidebar-group">
          <div className="sidebar-heading">
            <span>书房</span>
            <span className="nav-item-count">{books.length}</span>
          </div>
          <button
            type="button"
            className={['nav-item', view === 'shelf' && activeShelfId === 'all' ? 'is-active' : ''].filter(Boolean).join(' ')}
            onClick={() => {
              /* 从回收站/设置等页面点书架，要真的回到书架视图 */
              setView('shelf')
              setActiveShelf('all')
            }}
          >
            <span className="nav-item-icon">
              <IconLibrary size={15} />
            </span>
            <span className="nav-item-label">全部藏书</span>
            <span className="nav-item-count">{books.length}</span>
          </button>
          {/*
            回收站：被移除的书不会真的消失，也不该再出现在书架上。
            单独一个入口，进去只有两件事能做 —— 还原、彻底删除。
          */}
          <button
            type="button"
            className={[
              'nav-item',
              'is-trash',
              trashedCount > 0 ? 'has-items' : '',
              /* 在回收站里时它才是当前项（与书架并列，高亮不能停在"全部藏书"上） */
              view === 'trash' ? 'is-active' : ''
            ]
              .filter(Boolean)
              .join(' ')}
            title="被移除的书都在这里，可以还原或彻底删除"
            onClick={() => setView('trash')}
          >
            <span className="nav-item-icon">
              <IconTrash size={15} />
            </span>
            <span className="nav-item-label">回收站</span>
            <span className="nav-item-count">{trashedCount}</span>
          </button>
        </div>

        <div className="sidebar-group">
          <div className="sidebar-heading">
            <span>书架层</span>
            <span className="sidebar-heading-actions">
              <IconButton label="新增一层书架" onClick={() => setAdding(true)}>
                <IconPlus size={13} />
              </IconButton>
            </span>
          </div>

          {shelves.map((shelf) => {
            const themed = Boolean(shelf.color)
            return (
              <div
                className="shelf-nav-row"
                key={shelf.id}
                onContextMenu={(event) => openShelfMenu(event, shelf.id)}
              >
                {editingId === shelf.id ? (
                  <input
                    className="text-input shelf-nav-input"
                    autoFocus
                    value={editDraft}
                    onChange={(event) => setEditDraft(event.target.value)}
                    onBlur={() => {
                      if (editDraft.trim()) void renameShelf(shelf.id, editDraft.trim())
                      setEditingId(null)
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') event.currentTarget.blur()
                      if (event.key === 'Escape') setEditingId(null)
                    }}
                  />
                ) : (
                  <button
                    type="button"
                    className={['nav-item', activeShelfId === shelf.id ? 'is-active' : ''].filter(Boolean).join(' ')}
                    onClick={() => {
              setView('shelf')
              setActiveShelf(shelf.id)
            }}
                    onDoubleClick={() => startRename(shelf)}
                    title="双击重命名，右键更多操作"
                  >
                    {/* 主题色只走描边：图标本身是 line 图标，改 currentColor 就是改线条颜色 */}
                    <span
                      className={['nav-item-icon', 'shelf-nav-icon', themed ? 'is-themed' : ''].filter(Boolean).join(' ')}
                      style={themed ? { color: shelf.color ?? undefined } : undefined}
                    >
                      <IconBookStack size={15} />
                    </span>
                    <span className="nav-item-label">{shelf.name}</span>
                    <span className="nav-item-count">{countOf(shelf.id)}</span>
                  </button>
                )}
                {/*
                  这里原来还有一个 12px 的小删除按钮。
                  用户说它"基本没用"—— 点错代价大（删层）、瞄准也费劲，
                  而右键菜单里本来就有「删除书架」。所以去掉，只留右键那条路。
                */}
              </div>
            )
          })}

          {adding ? (
            <input
              className="text-input shelf-nav-input"
              autoFocus
              placeholder="新书架层的名字"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onBlur={commitAdd}
              onKeyDown={(event) => {
                if (event.key === 'Enter') event.currentTarget.blur()
                if (event.key === 'Escape') {
                  setDraft('')
                  setAdding(false)
                }
              }}
            />
          ) : null}
        </div>

        {reading.length > 0 ? (
          <div className="sidebar-group">
            <div className="sidebar-heading">
              <span>正在读</span>
            </div>
            {reading.slice(0, 5).map((book) => (
              <button
                key={book.id}
                type="button"
                className="nav-item nav-item-book"
                onClick={() => openDetail(book.id)}
                title={book.title}
              >
                <span className="nav-item-icon">
                  <span className="nav-item-dot" style={{ background: book.accent }} />
                </span>
                <span className="nav-item-label">{book.title}</span>
              </button>
            ))}
          </div>
        ) : null}

        <span className="sidebar-spacer" />

        <div className="sidebar-plaque">
          <div className="sidebar-heading" style={{ padding: '0 0 6px' }}>
            <span>藏书目录</span>
            <span className="sidebar-heading-actions">
              <IconButton label="在资源管理器中打开" onClick={() => void appApi.revealPath(index?.libraryDir ?? '')}>
                <IconFolderOpen size={13} />
              </IconButton>
              <IconButton label="重新扫描" onClick={() => void rescan()}>
                <IconRefresh size={13} />
              </IconButton>
            </span>
          </div>
          <p className="sidebar-plaque-path">{index?.libraryDir ?? '—'}</p>
          {scanning ? (
            <div className="sidebar-scan">
              <div className="sidebar-scan-text">
                <span>正在统计页数</span>
                <span className="tabular">
                  {scan?.done}/{scan?.total}
                </span>
              </div>
              <ProgressBar value={scan?.done ?? 0} max={scan?.total ?? 1} />
            </div>
          ) : null}
        </div>

        <Button
          block
          variant="subtle"
          icon={<IconClose size={13} />}
          onClick={() => useUi.getState().toggleSidebar()}
        >
          收起侧栏
        </Button>
      </div>

      {/* 书架层右键菜单 */}
      {menu && menuShelf
        ? createPortal(
            <div
              ref={menuRef}
              className="context-menu sidebar-shelf-menu"
              style={{ left: menuPos.left, top: menuPos.top }}
              onMouseDown={(event) => event.stopPropagation()}
              onContextMenu={(event) => event.preventDefault()}
            >
              <div className="sidebar-shelf-menu-head">
                <span
                  className={['sidebar-shelf-menu-dot', menuShelf.color ? '' : 'is-none'].filter(Boolean).join(' ')}
                  style={menuShelf.color ? { background: menuShelf.color } : undefined}
                />
                <span className="sidebar-shelf-menu-name">{menuShelf.name}</span>
              </div>

              <button
                type="button"
                className={['context-item', menuPalette ? 'is-open' : ''].filter(Boolean).join(' ')}
                onClick={() => setMenuPalette((value) => !value)}
              >
                <span className="menu-item-icon">
                  <IconPalette size={14} />
                </span>
                <span className="menu-item-label">设置主题色</span>
              </button>

              {menuPalette ? (
                <div className="sidebar-shelf-menu-palette">
                  <ShelfColorPicker
                    size="sm"
                    value={menuShelf.color ?? null}
                    onChange={(color) => void setShelfColor(menuShelf.id, color)}
                  />
                </div>
              ) : null}

              <div className="context-sep" />

              <button type="button" className="context-item" onClick={() => startRename(menuShelf)}>
                <span className="menu-item-icon">
                  <IconEdit size={14} />
                </span>
                <span className="menu-item-label">重命名</span>
              </button>

              <button
                type="button"
                className="context-item is-danger"
                disabled={isLastShelf}
                onClick={() => startDelete(menuShelf)}
              >
                <span className="menu-item-icon">
                  <IconTrash size={14} />
                </span>
                <span className="menu-item-label">删除书架</span>
              </button>
              {isLastShelf ? <div className="context-label">至少要保留一层书架</div> : null}
            </div>,
            document.body
          )
        : null}

      {/* 删除确认：应用内弹窗，带「把书归到哪一层」的勾选 */}
      <ShelfDeleteModal
        open={Boolean(deletingShelf)}
        shelfName={deletingShelf?.name ?? ''}
        targetName={deleteTarget?.name ?? ''}
        bookCount={deletingId ? countOf(deletingId) : 0}
        onCancel={() => setDeletingId(null)}
        onConfirm={() => {
          const id = deletingId
          setDeletingId(null)
          if (id) void removeShelf(id)
        }}
      />
    </aside>
  )
}
