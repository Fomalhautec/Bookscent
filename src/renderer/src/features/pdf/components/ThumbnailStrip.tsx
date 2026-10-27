/**
 * 缩略图面板 —— 只为进入视口的页面渲染，并且串行排队，
 * 避免一本 800 页的书一打开就把主线程拖死。
 */

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { renderThumbnail, type PDFDocumentProxy } from '../lib/engine'
import { RenderQueue } from '../lib/renderQueue'

const THUMB_WIDTH = 118

export interface ThumbnailStripProps {
  doc: PDFDocumentProxy | null
  pageCount: number
  currentPage: number
  onSelect: (page: number) => void
}

interface ThumbItemProps {
  doc: PDFDocumentProxy | null
  page: number
  active: boolean
  queue: RenderQueue
  onSelect: (page: number) => void
}

function ThumbItem({ doc, page, active, queue, onSelect }: ThumbItemProps): ReactNode {
  const hostRef = useRef<HTMLButtonElement | null>(null)
  const [url, setUrl] = useState<string | null>(null)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const node = hostRef.current
    if (!node) return
    const observer = new IntersectionObserver(
      (entries) => setVisible(Boolean(entries[0]?.isIntersecting)),
      { root: node.closest('.pdf-sidebar-body'), rootMargin: '300px 0px' }
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!doc || !visible || url) return
    let disposed = false
    const handle = queue.enqueue(page, () => {
      const promise = renderThumbnail(doc, page, THUMB_WIDTH)
        .then((dataUrl) => {
          if (!disposed && dataUrl) setUrl(dataUrl)
        })
        .catch(() => undefined)
      return { promise, cancel: () => undefined }
    })
    void handle.catch(() => undefined)
    return () => {
      disposed = true
    }
  }, [doc, visible, url, page, queue])

  return (
    <button
      ref={hostRef}
      type="button"
      className={['pdf-thumb', active ? 'is-active' : ''].filter(Boolean).join(' ')}
      data-page={page}
      onClick={() => onSelect(page)}
      aria-label={`第 ${page} 页`}
      aria-current={active ? 'page' : undefined}
    >
      <span className="pdf-thumb-frame">
        {url ? (
          <img src={url} alt="" draggable={false} />
        ) : (
          <span className="pdf-thumb-skeleton" aria-hidden="true" />
        )}
      </span>
      <span className="pdf-thumb-label tabular">{page}</span>
    </button>
  )
}

export function ThumbnailStrip({ doc, pageCount, currentPage, onSelect }: ThumbnailStripProps): ReactNode {
  const queueRef = useRef<RenderQueue | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)

  if (queueRef.current === null) queueRef.current = new RenderQueue()
  const queue = queueRef.current

  useEffect(() => {
    const instance = queueRef.current
    return () => instance?.clear()
  }, [])

  // 当前页变化时把对应缩略图滚进视野
  useEffect(() => {
    const list = listRef.current
    if (!list) return
    const node = list.querySelector<HTMLElement>(`.pdf-thumb[data-page="${currentPage}"]`)
    node?.scrollIntoView({ block: 'nearest' })
  }, [currentPage])

  return (
    <div className="pdf-sidebar-body pdf-thumb-list" ref={listRef}>
      {Array.from({ length: pageCount }, (_, index) => index + 1).map((page) => (
        <ThumbItem
          key={page}
          doc={doc}
          page={page}
          active={page === currentPage}
          queue={queue}
          onSelect={onSelect}
        />
      ))}
    </div>
  )
}
