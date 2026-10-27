import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Book, Bookmark } from '@shared/types'
import { IconBookmarkFilled, IconLayers, IconQuote } from '@/components/icons/Icons'
import { useBookmarks } from '@/lib/useBookmarks'
import { BookmarkPanel, isNoteBookmark } from './BookmarkPanel'

export type ReaderSidebarTab = 'toc' | 'bookmarks' | 'notes'

export interface ReaderSidebarProps {
  book: Book
  /** 目录/大纲那一边的内容；没有目录的格式可以不传，这样只剩「书签」「笔记」两栏 */
  toc?: ReactNode
  tocLabel?: string
  /** 「加书签」按钮上的文案 */
  addLabel?: string
  /** 尺寸：PDF 那边的侧栏更宽，编辑器的窄一些 */
  width?: number
  /** 受控的当前栏（不传就自己管）。EPUB 的「目录」按钮要能切到这一栏 */
  tab?: ReaderSidebarTab
  onTabChange?: (tab: ReaderSidebarTab) => void
}

/**
 * 阅读器的左侧栏：目录 / 书签 / 笔记。
 *
 * 「书签」与「笔记」是**两栏**（用户要求分开）：书签只记位置（"我读到这儿了"），
 * 笔记带着原文与备注（"这句话我有想法"）。混在一栏里既不好找也不好数。
 *
 * 为什么统一放左边：PDF 的目录一直就在左边，而编辑器的大纲原来在右边 ——
 * 同一个应用里"目录在哪边"忽左忽右，用起来很别扭（用户提的）。
 */
export function ReaderSidebar({
  book,
  toc,
  tocLabel = '目录',
  addLabel = '标记当前位置',
  width = 240,
  tab: tabProp,
  onTabChange
}: ReaderSidebarProps): ReactNode {
  const marks = useBookmarks(book)
  const hasToc = Boolean(toc)
  const [tabState, setTabState] = useState<ReaderSidebarTab>(hasToc ? 'toc' : 'bookmarks')
  const tab = tabProp ?? tabState

  const setTab = (next: ReaderSidebarTab): void => {
    setTabState(next)
    onTabChange?.(next)
  }

  // 这本书换掉之后，回到有内容的那一栏
  useEffect(() => {
    if (tabProp === undefined) setTabState(hasToc ? 'toc' : 'bookmarks')
  }, [book.id, hasToc, tabProp])

  const { bookmarkCount, noteCount } = useMemo(() => {
    let bookmarks = 0
    let notes = 0
    for (const item of marks.list) {
      if (isNoteBookmark(item)) notes += 1
      else bookmarks += 1
    }
    return { bookmarkCount: bookmarks, noteCount: notes }
  }, [marks.list])

  return (
    <aside className="reader-side" style={{ width }}>
      <div className="reader-side-tabs" role="tablist">
        {hasToc ? (
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'toc'}
            className={['reader-side-tab', tab === 'toc' ? 'is-active' : ''].join(' ')}
            onClick={() => setTab('toc')}
          >
            <IconLayers size={14} />
            {tocLabel}
          </button>
        ) : null}
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'bookmarks'}
          className={['reader-side-tab', tab === 'bookmarks' ? 'is-active' : ''].join(' ')}
          onClick={() => setTab('bookmarks')}
        >
          <IconBookmarkFilled size={14} />
          书签{bookmarkCount > 0 ? ` ${bookmarkCount}` : ''}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'notes'}
          className={['reader-side-tab', tab === 'notes' ? 'is-active' : ''].join(' ')}
          onClick={() => setTab('notes')}
        >
          <IconQuote size={14} />
          笔记{noteCount > 0 ? ` ${noteCount}` : ''}
        </button>
      </div>

      <div className="reader-side-body">
        {tab === 'toc' && hasToc ? (
          toc
        ) : (
          <BookmarkPanel
            bookmarks={marks.list}
            activeId={marks.activeId}
            addLabel={addLabel}
            /* 两栏各自只看自己那一类 */
            mode={tab === 'notes' ? 'notes' : 'bookmarks'}
            onAdd={() => void marks.add()}
            onJump={marks.jump}
            onRename={(id, label) => void marks.rename(id, label)}
            onRecolor={(id, color) => void marks.recolor(id, color)}
            onNote={(id, note) => void marks.setNote(id, note)}
            onDelete={(id) => void marks.remove(id)}
          />
        )}
      </div>
    </aside>
  )
}

/** 供需要自己画书签列表的阅读器（PDF 已有自己的四栏侧栏） */
export type { Bookmark }
