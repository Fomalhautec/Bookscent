import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Bookmark } from '@shared/types'
import { Button, EmptyState, IconButton } from '@/components/common/Controls'
import {
  IconBookmarkFilled,
  IconCheck,
  IconClose,
  IconCopy,
  IconEdit,
  IconQuote,
  IconTrash
} from '@/components/icons/Icons'
import { relativeTime } from '@/lib/format'
import { metaOfAnchor } from '@/lib/bookmarkTarget'
import { BOOKMARK_COLORS } from '@/lib/useBookmarks'

export interface BookmarkPanelProps {
  bookmarks: Bookmark[]
  /** 当前位置对应的书签，列表里高亮 */
  activeId: string | null
  /** 「加书签」按钮上的文案（各格式不一样，PDF 说页码、EPUB 说章节） */
  addLabel: string
  /**
   * 只显示哪一类。
   *
   * 「书签」（只记位置："我读到这儿了"）与「笔记」（带原文与备注："这句话我有想法"）
   * 在阅读侧栏里是**两栏**。不传就两类都显示（PDF 的四栏侧栏就是这么用的）。
   */
  mode?: 'bookmarks' | 'notes'
  onAdd: () => void
  onJump: (bookmark: Bookmark) => void
  onRename: (id: string, label: string) => void
  onRecolor: (id: string, color: string) => void
  /** 给书签写备注 / 读书笔记 */
  onNote: (id: string, note: string) => void
  onDelete: (id: string) => void
}

/** 这一条算不算「笔记」：显式标了 kind=note，或老数据里带着原文 */
export function isNoteBookmark(item: Bookmark): boolean {
  return item.kind === 'note' || (item.kind === undefined && (item.excerpt ?? '').trim().length > 0)
}

/**
 * 书签 / 笔记面板 —— 所有格式共用一份。
 *
 * 这套交互原本是 PDF 那边的，用户反馈"比新写的那个好用"，所以以它为准：
 * 颜色圆点、内联重命名、删除、点一下跳过去。类名仍是 `.pdf-bookmark-*`
 * （样式在 pdf.css 里，全局引入），改名只会带来无谓的回归风险，就没动。
 */
export function BookmarkPanel({
  bookmarks,
  activeId,
  addLabel,
  mode,
  onAdd,
  onJump,
  onRename,
  onRecolor,
  onNote,
  onDelete
}: BookmarkPanelProps): ReactNode {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [noteId, setNoteId] = useState<string | null>(null)
  const [noteDraft, setNoteDraft] = useState('')
  const inputRef = useRef<HTMLInputElement | null>(null)
  const noteRef = useRef<HTMLTextAreaElement | null>(null)

  useEffect(() => {
    if (editingId) inputRef.current?.select()
  }, [editingId])

  useEffect(() => {
    if (noteId) noteRef.current?.focus()
  }, [noteId])

  const sorted = useMemo(
    () => [...bookmarks].sort((a, b) => a.page - b.page || a.createdAt - b.createdAt),
    [bookmarks]
  )
  const list = useMemo(
    () => (mode ? sorted.filter((item) => (mode === 'notes' ? isNoteBookmark(item) : !isNoteBookmark(item))) : sorted),
    [sorted, mode]
  )

  const startEdit = (bookmark: Bookmark): void => {
    setEditingId(bookmark.id)
    setDraft(bookmark.label)
  }

  const commitEdit = (): void => {
    if (editingId) onRename(editingId, draft.trim())
    setEditingId(null)
  }

  const startNote = (bookmark: Bookmark): void => {
    setNoteId(bookmark.id)
    setNoteDraft(bookmark.note ?? '')
  }

  const commitNote = (): void => {
    if (noteId) onNote(noteId, noteDraft)
    setNoteId(null)
  }

  const renderRow = (bookmark: Bookmark): ReactNode => {
    const active = bookmark.id === activeId
    return (
      <li key={bookmark.id} className={['pdf-bookmark', active ? 'is-active' : ''].filter(Boolean).join(' ')}>
        <button
          type="button"
          className="pdf-bookmark-main"
          onClick={() => onJump(bookmark)}
          title={bookmark.label}
        >
          <span className="pdf-bookmark-dot" style={{ background: bookmark.color }} aria-hidden="true" />
          {editingId === bookmark.id ? (
            <input
              ref={inputRef}
              className="text-input pdf-bookmark-input"
              value={draft}
              onClick={(event) => event.stopPropagation()}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                event.stopPropagation()
                if (event.key === 'Enter') commitEdit()
                if (event.key === 'Escape') setEditingId(null)
              }}
              onBlur={commitEdit}
            />
          ) : (
            <span className="pdf-bookmark-text">
              <span className="pdf-bookmark-label">{bookmark.label}</span>
              {bookmark.excerpt ? <span className="pdf-bookmark-excerpt">{bookmark.excerpt}</span> : null}
              {bookmark.note && noteId !== bookmark.id ? (
                <span className="pdf-bookmark-note">{bookmark.note}</span>
              ) : null}
              <span className="pdf-bookmark-meta">
                {metaOfAnchor(bookmark.anchor, bookmark.page)} · {relativeTime(bookmark.createdAt)}
              </span>
            </span>
          )}
        </button>

        <span className="pdf-bookmark-tools">
          {editingId === bookmark.id ? (
            <IconButton label="确定" onClick={commitEdit}>
              <IconCheck size={14} />
            </IconButton>
          ) : (
            <IconButton label="重命名" tone="muted" onClick={() => startEdit(bookmark)}>
              <IconEdit size={14} />
            </IconButton>
          )}
          {/* 带原文的那条可以一键复制（笔记最常见的用法） */}
          {bookmark.excerpt ? (
            <IconButton
              label="复制这段原文"
              tone="muted"
              onClick={() => {
                /* 复制走干净那份：日文书的振假名不该出现在剪贴板里 */
                void navigator.clipboard.writeText(bookmark.plain || bookmark.excerpt || '').catch(() => undefined)
              }}
            >
              <IconCopy size={14} />
            </IconButton>
          ) : null}
          <IconButton
            label={bookmark.note ? '改备注' : '写备注'}
            tone={bookmark.note ? 'default' : 'muted'}
            onClick={() => (noteId === bookmark.id ? commitNote() : startNote(bookmark))}
          >
            <IconQuote size={14} />
          </IconButton>
          <IconButton label="删除书签" tone="muted" onClick={() => onDelete(bookmark.id)}>
            <IconTrash size={14} />
          </IconButton>
        </span>

        <span className="pdf-bookmark-colors">
          {BOOKMARK_COLORS.map((color) => (
            <button
              key={color}
              type="button"
              className={['pdf-swatch', 'is-tiny', bookmark.color === color ? 'is-active' : '']
                .filter(Boolean)
                .join(' ')}
              style={{ background: color }}
              title="换个颜色"
              aria-label={`颜色 ${color}`}
              onClick={() => onRecolor(bookmark.id, color)}
            />
          ))}
          {editingId === bookmark.id ? (
            <IconButton label="取消重命名" tone="muted" onClick={() => setEditingId(null)}>
              <IconClose size={14} />
            </IconButton>
          ) : null}
        </span>

        {noteId === bookmark.id ? (
          <div className="pdf-bookmark-note-edit">
            <textarea
              ref={noteRef}
              className="text-input"
              rows={3}
              placeholder="写点备注 / 读书笔记…（Ctrl+Enter 保存）"
              value={noteDraft}
              onChange={(event) => setNoteDraft(event.target.value)}
              onKeyDown={(event) => {
                event.stopPropagation()
                if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) commitNote()
                if (event.key === 'Escape') setNoteId(null)
              }}
            />
            <div className="pdf-bookmark-note-foot">
              <Button size="xs" variant="outline" onClick={() => setNoteId(null)}>
                取消
              </Button>
              <Button size="xs" variant="solid" icon={<IconCheck size={13} />} onClick={commitNote}>
                保存备注
              </Button>
            </div>
          </div>
        ) : null}
      </li>
    )
  }

  return (
    <div className="pdf-sidebar-body pdf-bookmarks">
      <div className="pdf-panel-head">
        <Button size="sm" variant="outline" icon={<IconBookmarkFilled size={14} />} onClick={onAdd}>
          {addLabel}
        </Button>
      </div>

      {list.length === 0 ? (
        <EmptyState
          icon={<IconBookmarkFilled size={22} />}
          title={mode === 'notes' ? '还没有笔记' : '还没有书签'}
          detail={
            mode === 'notes'
              ? '选中一段正文，点浮出工具条上的「记为笔记」，原文与想法就一起记下来了。'
              : '读到要紧的地方按 Ctrl+B 记一笔，下次从书架打开就能跳回来。'
          }
        />
      ) : (
        <ul className="pdf-bookmark-list">{list.map(renderRow)}</ul>
      )}
    </div>
  )
}
