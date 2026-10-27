/**
 * 左侧面板外壳：四个页签（缩略图 / 目录 / 书签 / 搜索）。
 * 面板本身不持有数据，全部由 PdfViewer 注入，方便键盘快捷键直接联动。
 */

import type { ReactNode } from 'react'
import type { BookRecord } from '@shared/types'
import { IconBookmarkFilled, IconGrid, IconLayers, IconSearch } from '@/components/icons/Icons'
import { BookmarkPanel } from '@/features/reader/BookmarkPanel'
import { OutlinePanel } from './OutlinePanel'
import { SearchPanel, type SearchPanelProps } from './SearchPanel'
import { ThumbnailStrip } from './ThumbnailStrip'
import type { PDFDocumentProxy } from '../lib/engine'

export type SidebarTab = 'thumbs' | 'outline' | 'bookmarks' | 'search'

export interface PdfSidebarProps {
  open: boolean
  tab: SidebarTab
  onTabChange: (tab: SidebarTab) => void
  doc: PDFDocumentProxy | null
  record: BookRecord
  pageCount: number
  currentPage: number
  onJump: (page: number) => void
  outlineLoading: boolean
  onRefreshOutline: () => void
  onAddBookmark: () => void
  onRenameBookmark: (id: string, label: string) => void
  onDeleteBookmark: (id: string) => void
  onRecolorBookmark: (id: string, color: string) => void
  /** 给书签写备注 / 读书笔记 */
  onNoteBookmark: (id: string, note: string) => void
  search: SearchPanelProps
  /** 左侧栏宽度（可拖动调整，范围由调用方给） */
  width?: number
}

const TABS: { id: SidebarTab; label: string; icon: ReactNode }[] = [
  { id: 'thumbs', label: '缩略图', icon: <IconGrid size={14} /> },
  { id: 'outline', label: '目录', icon: <IconLayers size={14} /> },
  { id: 'bookmarks', label: '书签', icon: <IconBookmarkFilled size={14} /> },
  { id: 'search', label: '搜索', icon: <IconSearch size={14} /> }
]

export function PdfSidebar(props: PdfSidebarProps): ReactNode {
  return (
    <aside
      className={['pdf-sidebar', props.open ? 'is-open' : 'is-collapsed'].filter(Boolean).join(' ')}
      style={props.width ? { width: props.width } : undefined}
    >
      <div className="pdf-sidebar-tabs" role="tablist">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={props.tab === tab.id}
            className={['pdf-sidebar-tab', props.tab === tab.id ? 'is-active' : ''].filter(Boolean).join(' ')}
            title={tab.label}
            onClick={() => props.onTabChange(tab.id)}
          >
            {tab.icon}
            <span>{tab.label}</span>
          </button>
        ))}
      </div>

      {props.open ? (
        <>
          {props.tab === 'thumbs' ? (
            <ThumbnailStrip
              doc={props.doc}
              pageCount={props.pageCount}
              currentPage={props.currentPage}
              onSelect={props.onJump}
            />
          ) : null}

          {props.tab === 'outline' ? (
            <OutlinePanel
              outline={props.record.outline}
              loading={props.outlineLoading}
              currentPage={props.currentPage}
              onJump={props.onJump}
              onRefresh={props.onRefreshOutline}
            />
          ) : null}

          {props.tab === 'bookmarks' ? (
            /*
             * 用共用的书签面板（原来那份挪到了 features/reader/，所有格式共用一套交互）。
             * PDF 的定位就是页码，所以 activeId 直接拿页码比对。
             */
            <BookmarkPanel
              bookmarks={props.record.bookmarks}
              activeId={
                props.record.bookmarks.find((item) => item.page === props.currentPage)?.id ?? null
              }
              addLabel={`在第 ${props.currentPage} 页加书签`}
              onJump={(bookmark) => props.onJump(bookmark.page)}
              onAdd={props.onAddBookmark}
              onRename={props.onRenameBookmark}
              onDelete={props.onDeleteBookmark}
              onRecolor={props.onRecolorBookmark}
              onNote={props.onNoteBookmark}
            />
          ) : null}

          {props.tab === 'search' ? <SearchPanel {...props.search} /> : null}
        </>
      ) : null}
    </aside>
  )
}
