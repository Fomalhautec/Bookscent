import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useLibrary } from '@/store/useLibrary'
import { useUi } from '@/store/useUi'
import { appApi, dialogApi, filesApi, libraryApi } from '@/lib/api'
import { EDITABLE_FORMATS, type BookendFacing } from '@shared/types'
import { BOOK_STATUS_LABELS } from '@/features/settings/labels'
import {
  IconCheck,
  IconBookOpen,
  IconChevronRight,
  IconColumns,
  IconEdit,
  IconExternalLink,
  IconFolder,
  IconInfo,
  IconLock,
  IconStar,
  IconTrash
} from '@/components/icons/Icons'

/**
 * 一级菜单里的「带子菜单的一行」。
 *
 * 「阅读状态」与「移动到书架层」原先各铺开一整列，菜单被撑得极长；
 * 现在各自收成一行：左边名字，右边当前值，悬停或点击从侧面弹出子菜单。
 * 子菜单挂在菜单根节点内部，所以点它的项不会被"点空白处关闭"误伤。
 */
function ContextSubmenu({
  label,
  summary,
  children
}: {
  label: string
  summary: string
  children: ReactNode
}): ReactNode {
  const [open, setOpen] = useState(false)
  const [placement, setPlacement] = useState<'right' | 'left'>('right')
  const [panelTop, setPanelTop] = useState(0)
  const hostRef = useRef<HTMLDivElement | null>(null)
  const rowRef = useRef<HTMLButtonElement | null>(null)
  const panelRef = useRef<HTMLDivElement | null>(null)

  /* 贴着窗口右边就向左弹；贴着下边就往上收。子菜单不许跑出可视区域。 */
  useLayoutEffect(() => {
    if (!open) return
    const host = hostRef.current
    const panel = panelRef.current
    if (!host || !panel) return
    const hostRect = host.getBoundingClientRect()
    // 用 offsetWidth/Height 而不是 rect：入场动画的 transform 会把 rect 量小
    const panelWidth = panel.offsetWidth
    const panelHeight = panel.offsetHeight
    const margin = 8
    setPlacement(hostRect.right + 8 + panelWidth > window.innerWidth - margin ? 'left' : 'right')
    let top = hostRect.top - 5
    if (top + panelHeight > window.innerHeight - margin) {
      top = Math.max(margin, window.innerHeight - margin - panelHeight)
    }
    setPanelTop(host.offsetTop + (top - hostRect.top))
  }, [open])

  return (
    <div
      className="context-sub-host"
      ref={hostRef}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      /* 焦点整体离开这一支（含子菜单）才收起来 */
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false)
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          if (!open) return
          // 先收子菜单，别把整个菜单一起关掉
          event.stopPropagation()
          setOpen(false)
          rowRef.current?.focus()
          return
        }
        if (!open && (event.key === 'ArrowRight' || event.key === 'ArrowDown')) {
          event.preventDefault()
          setOpen(true)
          return
        }
        if (open && (event.key === 'ArrowLeft' || event.key === 'ArrowUp')) {
          event.stopPropagation()
          setOpen(false)
          rowRef.current?.focus()
        }
      }}
    >
      <button
        type="button"
        ref={rowRef}
        className={['context-item', open ? 'is-open' : ''].filter(Boolean).join(' ')}
        aria-haspopup="menu"
        aria-expanded={open}
        onFocus={() => setOpen(true)}
        onClick={() => setOpen(true)}
      >
        <span className="context-spacer" />
        {label}
        <span className="context-sub-value">{summary}</span>
        <IconChevronRight size={13} className="context-sub-caret" />
      </button>
      {open ? (
        <div
          className={['context-submenu', placement === 'left' ? 'is-left' : ''].filter(Boolean).join(' ')}
          ref={panelRef}
          style={{ top: panelTop }}
        >
          {children}
        </div>
      ) : null}
    </div>
  )
}

/** 书脊右键菜单：常用动作一步到位 */
export function BookContextMenu(): ReactNode {
  const menu = useUi((s) => s.contextMenu)
  const closeMenu = useUi((s) => s.closeContextMenu)
  const toast = useUi((s) => s.toast)
  const openDetail = useUi((s) => s.openDetail)
  const index = useLibrary((s) => s.index)
  const select = useLibrary((s) => s.select)
  const updateBook = useLibrary((s) => s.updateBook)
  const removeBooks = useLibrary((s) => s.removeBooks)
  const assignShelf = useLibrary((s) => s.assignShelf)
  const addBookend = useLibrary((s) => s.addBookend)
  const updateBookend = useLibrary((s) => s.updateBookend)
  const removeBookend = useLibrary((s) => s.removeBookend)
  const moveBookend = useLibrary((s) => s.moveBookend)

  const book = useMemo(
    () => (menu?.bookId ? index?.books.find((b) => b.id === menu.bookId) : undefined),
    [menu, index?.books]
  )
  const bookend = useMemo(
    () => (menu?.bookendId ? (index?.bookends ?? []).find((e) => e.id === menu.bookendId) : undefined),
    [menu, index?.bookends]
  )
  const menuRef = useRef<HTMLDivElement | null>(null)
  /* 展开中的二级菜单：'facing' | 'break' | null */
  const [openSub, setOpenSub] = useState<'facing' | 'break' | null>(null)
  /* 换菜单时把它收起来 */
  useEffect(() => setOpenSub(null), [menu])

  useEffect(() => {
    if (!menu) return
    /*
     * 点菜单项时别把菜单收掉。
     *
     * 真实点击的顺序是 mousedown → mouseup → click。以前这里无条件地在
     * mousedown 上 closeMenu()，菜单在 mouseup 之前就被卸载了；
     * 浏览器不会给一个已经从 DOM 里移除的元素派 click，
     * 于是菜单项的 onClick 永远不执行（书立菜单曾因此"完全没有反应"）。
     * 现在只要按下的位置在菜单里就放过；菜单项本身也已经改成在
     * pointerdown 上派发，双保险。
     */
    const dismiss = (event: Event): void => {
      const target = event.target as Node | null
      if (target && menuRef.current?.contains(target)) return
      closeMenu()
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') closeMenu()
    }
    window.addEventListener('mousedown', dismiss)
    window.addEventListener('keydown', onKey)
    const onBlur = (): void => closeMenu()
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('mousedown', dismiss)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('blur', onBlur)
    }
  }, [menu, closeMenu])

  /* 书立的菜单：只有间距与移除两件事 */
  if (menu && bookend) {
    const style = {
      left: Math.min(menu.x, window.innerWidth - 230),
      top: Math.min(menu.y, window.innerHeight - 220)
    }
    const shift = (delta: number): void => {
      closeMenu()
      const next = Math.max(0, Math.min(240, bookend.gap + delta))
      void updateBookend(bookend.id, { gap: next })
    }
    /*
     * 菜单项在**根节点的 pointerdown 上按 data-action 派发**。
     *
     * 为什么不用 onClick：真实点击是 mousedown → mouseup → click，
     * 中间只要菜单被任何东西收起，click 就永远不会落到按钮上。
     * pointerdown 是这一串里的第一个事件，在它上面就把事情办掉，
     * 后面谁想把菜单收掉都不影响操作已经生效。
     */
    /* 朝向的展示文案，以及「是否换行」按朝向的派生值 */
    const FACING_LABEL: Record<BookendFacing, string> = {
      both: '两种模式',
      spine: '仅书脊模式',
      cover: '仅封面模式'
    }
    const facingScope: BookendFacing = bookend.facing ?? 'both'
    /* 封面模式没单独设过就沿用书脊那份 */
    const coverBreaks =
      typeof bookend.breakLineCover === 'boolean' ? bookend.breakLineCover : bookend.breakLine === true
    const breakSummary =
      facingScope === 'cover'
        ? coverBreaks
          ? '封面模式：换行'
          : '封面模式：不换行'
        : facingScope === 'spine'
          ? bookend.breakLine
            ? '书脊模式：换行'
            : '书脊模式：不换行'
          : `书脊${bookend.breakLine ? '换' : '不换'} / 封面${coverBreaks ? '换' : '不换'}`

    const actions: Record<string, () => void> = {
      wider: () => shift(12),
      narrower: () => shift(-12),
      flip: () => {
        const next = bookend.side === 'left' ? 'right' : 'left'
        closeMenu()
        void updateBookend(bookend.id, { side: next })
      },
      /*
       * 二级菜单的开合。换朝向/换行之后**不关菜单**：这两个本来就是"调着看"的，
       * 关掉再右键一次很烦（而且以前那个循环按钮还得先切书架朝向才看得出效果）。
       */
      toggleFacingMenu: () => setOpenSub((prev) => (prev === 'facing' ? null : 'facing')),
      toggleBreakMenu: () => setOpenSub((prev) => (prev === 'break' ? null : 'break')),
      'facing:both': () => {
        void updateBookend(bookend.id, { facing: 'both' })
        toast('两种朝向都生效', 'success')
      },
      'facing:spine': () => {
        void updateBookend(bookend.id, { facing: 'spine' })
        toast('只在书脊模式生效', 'success')
      },
      'facing:cover': () => {
        void updateBookend(bookend.id, { facing: 'cover' })
        toast('只在封面模式生效', 'success')
      },
      /* 换行按朝向分别设：书脊与封面模式的书宽差很多，断点常常只对一种合适 */
      'breakLine:spine': () => {
        const next = !bookend.breakLine
        void updateBookend(bookend.id, { breakLine: next })
        toast(next ? '书脊模式：到这里另起一行' : '书脊模式：接着排', 'success')
      },
      'breakLine:cover': () => {
        const next = !coverBreaks
        void updateBookend(bookend.id, { breakLineCover: next })
        toast(next ? '封面模式：到这里另起一行' : '封面模式：接着排', 'success')
      },
      moveLeft: () => {
        closeMenu()
        void moveBookend(bookend.id, -1)
      },
      moveRight: () => {
        closeMenu()
        void moveBookend(bookend.id, 1)
      },
      remove: () => {
        closeMenu()
        void removeBookend(bookend.id)
      }
    }

    const onPointerDown = (event: React.PointerEvent): void => {
      event.stopPropagation()
      const target = event.target as HTMLElement | null
      const button = target?.closest?.('[data-action]') as HTMLButtonElement | null
      const key = button?.getAttribute('data-action') ?? null
      if (!key || !button || button.disabled) return
      event.preventDefault()
      actions[key]?.()
    }

    return createPortal(
      <div
        className="context-menu"
        ref={menuRef}
        style={style}
        onPointerDown={onPointerDown}
        onMouseDown={(event) => event.stopPropagation()}
        onContextMenu={(event) => event.preventDefault()}
      >
        <div className="context-label">
          {bookend.side === 'left' ? '左书立' : '右书立'} · 空位 {Math.round(bookend.gap)}px ·{' '}
          {FACING_LABEL[facingScope]}
          {breakSummary.includes('不换') && breakSummary.includes('封面') && breakSummary.includes('书脊')
            ? ' · ' + breakSummary
            : ''}
        </div>
        <button type="button" className="context-item" data-action="wider">
          <span className="context-spacer" />
          加宽空位
        </button>
        <button
          type="button"
          className="context-item"
          data-action="narrower"
          disabled={bookend.gap <= 0}
        >
          <span className="context-spacer" />
          收窄空位
        </button>
        <div className="context-sep" />
        <button type="button" className="context-item" data-action="flip">
          <span className="context-spacer" />
          翻到另一侧（现在是{bookend.side === 'left' ? '左' : '右'}书立）
        </button>

        {/*
          「适用朝向」与「换行」都做成二级菜单。
          以前朝向是个循环按钮：想看另一档得先切书架朝向才能看出效果，很别扭；
          换行原来是一刀切，而书脊与封面模式的书宽差很多，同一个断点常常只对一种合适 ——
          于是有些书立两种模式都留着，只是换行位置不同。
        */}
        <div className="context-sub">
          <button
            type="button"
            className="context-item context-sub-head"
            data-action="toggleFacingMenu"
            aria-expanded={openSub === 'facing'}
          >
            <span className="context-spacer" />
            <span className="context-sub-label">适用朝向</span>
            <span className="context-sub-value">{FACING_LABEL[bookend.facing ?? 'both']}</span>
            <span className={`context-sub-caret${openSub === 'facing' ? ' is-open' : ''}`} />
          </button>
          {openSub === 'facing' ? (
            <div className="context-sub-body">
              {(['both', 'spine', 'cover'] as BookendFacing[]).map((option) => (
                <button
                  key={option}
                  type="button"
                  className={[
                    'context-item',
                    'is-sub',
                    (bookend.facing ?? 'both') === option ? 'is-checked' : ''
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  data-action={`facing:${option}`}
                >
                  <span className="context-spacer" />
                  {FACING_LABEL[option]}
                </button>
              ))}
            </div>
          ) : null}
        </div>

        <div className="context-sub">
          <button
            type="button"
            className="context-item context-sub-head"
            data-action="toggleBreakMenu"
            aria-expanded={openSub === 'break'}
          >
            <span className="context-spacer" />
            <span className="context-sub-label">到这里另起一行</span>
            <span className="context-sub-value">{breakSummary}</span>
            <span className={`context-sub-caret${openSub === 'break' ? ' is-open' : ''}`} />
          </button>
          {openSub === 'break' ? (
            <div className="context-sub-body">
              {/* 只列这个书立真正生效的模式，不给无关的开关 */}
              {facingScope !== 'cover' ? (
                <button
                  type="button"
                  className={['context-item', 'is-sub', bookend.breakLine ? 'is-checked' : ''].filter(Boolean).join(' ')}
                  data-action="breakLine:spine"
                >
                  <span className="context-spacer" />
                  书脊模式：{bookend.breakLine ? '另起一行' : '接着排'}
                </button>
              ) : null}
              {facingScope !== 'spine' ? (
                <button
                  type="button"
                  className={['context-item', 'is-sub', coverBreaks ? 'is-checked' : ''].filter(Boolean).join(' ')}
                  data-action="breakLine:cover"
                >
                  <span className="context-spacer" />
                  封面模式：{coverBreaks ? '另起一行' : '接着排'}
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
        <div className="context-sep" />
        <button type="button" className="context-item" data-action="moveLeft">
          <span className="context-spacer" />
          向左挪一位
        </button>
        <button type="button" className="context-item" data-action="moveRight">
          <span className="context-spacer" />
          向右挪一位
        </button>
        <div className="context-sep" />
        <button type="button" className="context-item is-danger" data-action="remove">
          <IconTrash size={14} />
          移除这个书立
        </button>
      </div>,
      document.body
    )
  }

  if (!menu || !book) return null

  const editable = EDITABLE_FORMATS.includes(book.format)
  const style = { left: Math.min(menu.x, window.innerWidth - 230), top: Math.min(menu.y, window.innerHeight - 380) }

  const run = (fn: () => void | Promise<unknown>): void => {
    closeMenu()
    void fn()
  }

  return createPortal(
    <div className="context-menu" style={style} onMouseDown={(event) => event.stopPropagation()}>
      <button type="button" className="context-item" onClick={() => run(() => select(book.id))}>
        <IconEdit size={14} />
        {editable ? '编辑这本书' : '阅读这本书'}
        <kbd>Enter</kbd>
      </button>
      <button type="button" className="context-item" onClick={() => run(() => openDetail(book.id))}>
        <IconInfo size={14} />
        查看书籍详情
      </button>

      <div className="context-sep" />

      <button type="button" className="context-item" onClick={() => run(() => appApi.openPath(book.path))}>
        <IconExternalLink size={14} />
        用系统应用打开
      </button>
      <button type="button" className="context-item" onClick={() => run(() => appApi.revealPath(book.path))}>
        <IconFolder size={14} />
        在资源管理器中显示
      </button>
      <button
        type="button"
        className="context-item"
        onClick={() =>
          run(async () => {
            await navigator.clipboard.writeText(book.path)
            toast('路径已复制', 'success', book.path)
          })
        }
      >
        <IconLock size={14} />
        复制文件路径
      </button>

      <div className="context-sep" />
      <ContextSubmenu label="阅读状态" summary={BOOK_STATUS_LABELS[book.status]}>
        {(
          [
            ['unread', '标记为未读'],
            ['reading', '标记为在读'],
            ['finished', '标记为读完']
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            className="context-item"
            onClick={() => run(() => updateBook(book.id, { status: value }))}
          >
            {book.status === value ? <IconCheck size={14} /> : <span className="context-spacer" />}
            {label}
          </button>
        ))}
      </ContextSubmenu>

      <div className="context-sep" />
      {/*
       * 书立按单侧来加，和现实一致：想在一本书右边隔一下就在它右边放一块挡板，
       * 想在下一组开头挡一下就在那本书左边放一块 —— 两个面对面，中间就是空位。
       */}
      <button
        type="button"
        className="context-item"
        onClick={() => run(() => addBookend(book.shelfId, book.id, 'right'))}
      >
        <IconColumns size={14} />
        在右边加书立
      </button>
      <button
        type="button"
        className="context-item"
        onClick={() => run(() => addBookend(book.shelfId, book.id, 'left'))}
      >
        <IconColumns size={14} />
        在左边加书立
      </button>
      <div className="context-sep" />
      {/*
        当作书籍 / 当作笔记：读书与写字是两种行为，统计也按这个分账。
        默认值看格式（应用改不了的算书、能改的算笔记），这里给一个随手可改的入口 ——
        一本写完的笔记当然可以当书读。
      */}
      <button
        type="button"
        className="context-item"
        onClick={() =>
          run(() => updateBook(book.id, { kind: book.kind === 'note' ? 'book' : 'note' }))
        }
      >
        <IconBookOpen size={14} />
        {book.kind === 'note' ? '改当作书籍（算阅读）' : '改当作笔记（算写作）'}
      </button>
      <div className="context-sep" />
      <ContextSubmenu
        label="移动到书架层"
        summary={(index?.shelves ?? []).find((shelf) => shelf.id === book.shelfId)?.name ?? '未分层'}
      >
        {(index?.shelves ?? []).map((shelf) => (
          <button
            key={shelf.id}
            type="button"
            className="context-item"
            onClick={() => run(() => assignShelf([book.id], shelf.id))}
          >
            {book.shelfId === shelf.id ? <IconCheck size={14} /> : <span className="context-spacer" />}
            {shelf.name}
          </button>
        ))}
      </ContextSubmenu>

      <div className="context-sep" />
      <button
        type="button"
        className="context-item"
        onClick={() =>
          run(async () => {
            await updateBook(book.id, { rating: book.rating === 5 ? 0 : 5 })
            toast(book.rating === 5 ? '已取消满分' : '已标记为 5 星', 'success')
          })
        }
      >
        <IconStar size={14} />
        {book.rating === 5 ? '取消满分标记' : '标记为 5 星'}
      </button>
      {editable ? (
        <button
          type="button"
          className="context-item"
          onClick={() =>
            run(async () => {
              const content = await filesApi.readText(book.path)
              const result = await filesApi.exportText(`${book.title}.txt`, content, [
                { name: '纯文本', extensions: ['txt'] }
              ])
              if (!result.cancelled) toast('已导出', 'success', result.path ?? '')
            })
          }
        >
          <IconEdit size={14} />
          导出为 TXT
        </button>
      ) : null}

      <div className="context-sep" />
      <button
        type="button"
        className="context-item is-danger"
        onClick={() =>
          run(async () => {
            const response = await dialogApi.confirm({
              title: '移除书籍',
              message: `确定把《${book.title}》从书架移除吗？`,
              detail: book.external ? '文件不在藏书目录里，只会移除书架记录。' : '文件本身会保留在藏书目录中。',
              buttons: ['取消', '移除'],
              defaultId: 1,
              cancelId: 0,
              type: 'question'
            })
            if (response === 1) {
              await removeBooks([book.id], false)
              toast('已从书架移除', 'success')
            }
          })
        }
      >
        <IconTrash size={14} />
        从书架移除
      </button>
      {!book.external ? (
        <button
          type="button"
          className="context-item is-danger"
          onClick={() =>
            run(async () => {
              const response = await dialogApi.confirm({
                title: '删除文件',
                message: `将永久删除《${book.title}》的文件，无法撤销。`,
                detail: book.path,
                buttons: ['取消', '删除'],
                defaultId: 0,
                cancelId: 0,
                type: 'warning'
              })
              if (response === 1) {
                await libraryApi.removeBooks([book.id], true)
                await useLibrary.getState().load()
                toast('文件已删除', 'success')
              }
            })
          }
        >
          <IconTrash size={14} />
          连同文件一起删除
        </button>
      ) : null}
    </div>,
    document.body
  )
}
