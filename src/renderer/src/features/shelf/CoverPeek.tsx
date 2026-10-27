import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { Book, BookStyle } from '@shared/types'
import { FORMAT_LABEL } from '@shared/types'
import { formatPages, formatWords } from '@/lib/format'
import { BookCoverArt } from './BookCoverArt'

const GAP = 14
const MARGIN = 14
const MIN_TOP = 52

/**
 * 悬停/聚焦某本书时"抽出"的封面卡片。
 *
 * 它必须渲染到 body 上：书架是滚动容器，任何画在书脊旁边的元素都会被
 * overflow 裁掉（尤其是每层最左边和最右边那几本）。这里用 fixed 定位，
 * 并把位置夹在窗口之内，因此永远完整可见。
 */
export function CoverPeek({
  book,
  style,
  anchor
}: {
  book: Book
  style: BookStyle
  anchor: DOMRect
}): ReactNode {
  const width = Math.round(Math.min(190, Math.max(112, anchor.height * 0.62)))
  const height = Math.round(width * 1.5)
  const cardWidth = width + 20
  const cardHeight = height + 84
  const cardRef = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState(() => place(anchor, cardWidth, cardHeight))
  const [visible, setVisible] = useState(false)

  useLayoutEffect(() => {
    setPosition(place(anchor, cardWidth, cardHeight))
  }, [anchor, cardWidth, cardHeight])

  useEffect(() => {
    const id = requestAnimationFrame(() => setVisible(true))
    return () => cancelAnimationFrame(id)
  }, [])

  useEffect(() => {
    setVisible(false)
  }, [book.id])

  return createPortal(
    <div
      ref={cardRef}
      className={['cover-peek', visible ? 'is-visible' : ''].filter(Boolean).join(' ')}
      style={{ left: position.left, top: position.top, width: cardWidth }}
      role="tooltip"
      aria-hidden
    >
      <BookCoverArt book={book} style={style} width={width} showMeta={false} />
      <div className="cover-peek-meta">
        <span className="cover-peek-title" title={book.title}>
          {book.title}
        </span>
        <span className="cover-peek-sub">
          {book.author ? `${book.author} · ` : ''}
          {FORMAT_LABEL[book.format]}
          {book.pageCount ? ` · ${formatPages(book.pageCount, book.pageCountExact)}` : ''}
          {book.words ? ` · ${formatWords(book.words)}` : ''}
        </span>
      </div>
    </div>,
    document.body
  )
}

function place(anchor: DOMRect, width: number, height: number): { left: number; top: number } {
  const viewportW = window.innerWidth
  const viewportH = window.innerHeight

  let left = anchor.right + GAP
  if (left + width > viewportW - MARGIN) left = anchor.left - GAP - width
  if (left < MARGIN) {
    // 两侧都放不下（窄窗口 / 书在正中），改成贴着书脊居中
    left = Math.min(Math.max(MARGIN, anchor.left + anchor.width / 2 - width / 2), viewportW - width - MARGIN)
  }

  let top = anchor.bottom - height + 30
  if (top + height > viewportH - MARGIN) top = viewportH - height - MARGIN
  top = Math.max(MIN_TOP, top)

  return { left: Math.round(left), top: Math.round(top) }
}
