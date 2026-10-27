/**
 * 搜索面板 —— 全文搜索的输入、计数、命中列表与上下条跳转。
 * 命中项展示「页码 + 上下文片段」，点一下跳到对应页。
 */

import { useEffect, useRef, type ReactNode } from 'react'
import { Button, EmptyState, IconButton, Spinner } from '@/components/common/Controls'
import { IconChevronDown, IconChevronUp, IconClose, IconSearch } from '@/components/icons/Icons'
import type { SearchHit } from '../lib/search'

export interface SearchPanelProps {
  query: string
  hits: SearchHit[]
  activeIndex: number
  searching: boolean
  progress: { done: number; total: number } | null
  onQueryChange: (value: string) => void
  onPrev: () => void
  onNext: () => void
  onJump: (index: number) => void
  onClear: () => void
  /** 把「聚焦输入框」的能力交给外层，Ctrl+F 时用 */
  registerFocus: (focus: (() => void) | null) => void
}

export function SearchPanel({
  query,
  hits,
  activeIndex,
  searching,
  progress,
  onQueryChange,
  onPrev,
  onNext,
  onJump,
  onClear,
  registerFocus
}: SearchPanelProps): ReactNode {
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    const focus = (): void => {
      inputRef.current?.focus()
      inputRef.current?.select()
    }
    registerFocus(focus)
    focus()
    return () => registerFocus(null)
  }, [registerFocus])

  // 命中变化时把当前项滚进视野
  useEffect(() => {
    const node = document.querySelector<HTMLElement>('.pdf-search-item.is-active')
    node?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex, hits.length])

  return (
    <div className="pdf-sidebar-body pdf-search-panel">
      <div className="pdf-search-input">
        <IconSearch size={15} />
        <input
          ref={inputRef}
          className="text-input"
          value={query}
          placeholder="在全文里查找…"
          aria-label="搜索全文"
          onChange={(event) => onQueryChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              if (event.shiftKey) onPrev()
              else onNext()
            }
            if (event.key === 'Escape') {
              event.preventDefault()
              onClear()
            }
          }}
        />
        {query ? (
          <IconButton label="清空搜索" tone="muted" onClick={onClear}>
            <IconClose size={14} />
          </IconButton>
        ) : null}
      </div>

      <div className="pdf-search-status">
        {searching ? (
          <>
            <Spinner size={14} />
            <span>
              正在搜索
              {progress ? ` ${progress.done}/${progress.total}` : ''}…
            </span>
          </>
        ) : hits.length > 0 ? (
          <>
            <span className="tabular">
              {activeIndex + 1} / {hits.length}
            </span>
            <span className="pdf-search-nav">
              <IconButton label="上一处（Shift+Enter）" onClick={onPrev}>
                <IconChevronUp size={15} />
              </IconButton>
              <IconButton label="下一处（Enter）" onClick={onNext}>
                <IconChevronDown size={15} />
              </IconButton>
            </span>
          </>
        ) : query.trim() ? (
          <span className="muted">没有找到匹配的内容</span>
        ) : (
          <span className="muted">输入关键词后回车开始查找</span>
        )}
      </div>

      {hits.length === 0 && !searching && query.trim() ? (
        <EmptyState
          icon={<IconSearch size={22} />}
          title="换个词试试"
          detail="扫描件（图片型 PDF）没有文字层，搜索不到内容，可以用批注圈出重点。"
          action={
            <Button size="sm" variant="ghost" onClick={onClear}>
              清空
            </Button>
          }
        />
      ) : null}

      <ul className="pdf-search-list">
        {hits.map((hit, index) => (
          <li key={`${hit.page}-${hit.order}`}>
            <button
              type="button"
              className={['pdf-search-item', index === activeIndex ? 'is-active' : ''].filter(Boolean).join(' ')}
              onClick={() => onJump(index)}
            >
              <span className="pdf-search-page tabular">第 {hit.page} 页</span>
              <span className="pdf-search-snippet">{hit.snippet}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
