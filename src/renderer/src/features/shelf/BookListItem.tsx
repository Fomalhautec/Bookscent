import { memo, type ReactNode } from 'react'
import { mix, readableOn } from '@shared/themes'
import type { Book, BookStyle } from '@shared/types'
import { FORMAT_LABEL } from '@shared/types'
import { FORMAT_ACCENT, formatBytes, formatDateTime, formatWords, relativeTime } from '@/lib/format'
import {
  IconFileMarkdown,
  IconFilePdf,
  IconFileText,
  IconFileWord,
  IconGlobe,
  IconImage,
  IconBook as IconBookBase,
  IconStar,
  IconStarFilled,
  IconCheck
} from '@/components/icons/Icons'

function FormatIcon({ book, size = 17 }: { book: Book; size?: number }): ReactNode {
  switch (book.format) {
    case 'pdf':
      return <IconFilePdf size={size} />
    case 'md':
    case 'markdown':
      return <IconFileMarkdown size={size} />
    case 'txt':
      return <IconFileText size={size} />
    case 'doc':
    case 'docx':
      return <IconFileWord size={size} />
    case 'html':
      return <IconGlobe size={size} />
    case 'image':
      return <IconImage size={size} />
    default:
      return <IconBookBase size={size} />
  }
}

export const BookListItem = memo(function BookListItem({
  book,
  style,
  selected,
  progress = 0,
  onOpen,
  onContext,
  onDouble
}: {
  book: Book
  style: BookStyle
  selected: boolean
  /** 阅读进度 0–100；0 表示不显示（见 BookshelfView.progressOf） */
  progress?: number
  onOpen: (book: Book) => void
  onContext: (book: Book, event: React.MouseEvent) => void
  onDouble: (book: Book) => void
}): ReactNode {
  const accent = style.spineColor || FORMAT_ACCENT[book.format]
  const ink = readableOn(accent, '#fdf8ee', '#241a10')
  const percent = Math.round(progress)

  return (
    <div
      className={['book-list-item', selected ? 'is-selected' : '', book.missing ? 'is-missing' : '']
        .filter(Boolean)
        .join(' ')}
      // 进度百分比通过这些自定义属性下给 CSS（横条按 --progress-pct 填）
      style={percent > 0 ? { ['--progress-pct' as string]: `${percent}%` } : undefined}
      onClick={() => onOpen(book)}
      onDoubleClick={() => onDouble(book)}
      onContextMenu={(event) => onContext(book, event)}
      role="button"
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === 'Enter') onOpen(book)
      }}
    >
      <span
        className="book-list-mark"
        style={{ background: `linear-gradient(150deg, ${accent}, ${mix(accent, '#000000', 0.32)})`, color: ink }}
      >
        <FormatIcon book={book} />
      </span>

      <div className="book-list-main">
        <div className="book-list-line">
          <h3 className="book-list-name">{book.title}</h3>
          {book.status === 'finished' ? (
            <span className="book-list-badge is-done" title="已读完">
              <IconCheck size={11} />
            </span>
          ) : null}
        </div>
        <div className="book-list-sub">
          <span>{book.author || '佚名'}</span>
          <span className="dot" />
          <span>{FORMAT_LABEL[book.format]}</span>
          <span className="dot" />
          <span>{book.pageCount ? (book.pageCountExact ? `${book.pageCount} 页` : `约 ${book.pageCount} 页`) : '—'}</span>
          {book.words ? (
            <>
              <span className="dot" />
              <span>{formatWords(book.words)}</span>
            </>
          ) : null}
        </div>
        {book.tags.length > 0 ? (
          <div className="book-list-tags">
            {book.tags.slice(0, 5).map((tag) => (
              <span className="book-list-tag" key={tag}>
                {tag}
              </span>
            ))}
          </div>
        ) : null}
        {/* 阅读进度：一条横条 + 右边的百分比，单独占一行，不去挤书名 */}
        {percent > 0 ? (
          <div className="progress-row" title={`已读 ${percent}%`}>
            <span className="progress-row-track">
              <span className="progress-row-fill" />
            </span>
            <span className="progress-row-text">{percent}%</span>
          </div>
        ) : null}
      </div>

      <div className="book-list-stars">
        {[1, 2, 3, 4, 5].map((n) =>
          n <= book.rating ? <IconStarFilled key={n} size={12} /> : <IconStar key={n} size={12} />
        )}
      </div>

      <div className="book-list-meta">
        <span title={formatDateTime(book.updatedAt)}>{relativeTime(book.lastOpenedAt ?? book.addedAt)}</span>
        <span className="muted">{formatBytes(book.size)}</span>
      </div>
    </div>
  )
})
