/**
 * 目录面板 —— 展平的目录项，按 depth 缩进。
 * 目录来自 pdfjs getOutline()，读一次后缓存进 BookRecord.outline。
 */

import type { ReactNode } from 'react'
import type { OutlineItem } from '@shared/types'
import { Button, EmptyState, Spinner } from '@/components/common/Controls'
import { IconBookOpen, IconLayers } from '@/components/icons/Icons'

export interface OutlinePanelProps {
  outline: OutlineItem[]
  loading: boolean
  currentPage: number
  onJump: (page: number) => void
  onRefresh: () => void
}

export function OutlinePanel({ outline, loading, currentPage, onJump, onRefresh }: OutlinePanelProps): ReactNode {
  if (loading) {
    return (
      <div className="pdf-sidebar-body pdf-panel-center">
        <Spinner size={20} />
        <p className="muted">正在读取目录…</p>
      </div>
    )
  }

  if (outline.length === 0) {
    return (
      <div className="pdf-sidebar-body">
        <EmptyState
          icon={<IconLayers size={22} />}
          title="这份 PDF 没有目录"
          detail="有些文档没有内嵌书签结构，可以改用缩略图或全文搜索定位。"
          action={
            <Button size="sm" variant="outline" onClick={onRefresh}>
              重新读取
            </Button>
          }
        />
      </div>
    )
  }

  return (
    <div className="pdf-sidebar-body pdf-outline">
      {outline.map((item, index) => {
        const clickable = item.page !== null
        const active = clickable && item.page === currentPage
        return (
          <button
            key={`${index}-${item.title}`}
            type="button"
            className={['pdf-outline-item', active ? 'is-active' : '', clickable ? '' : 'is-static']
              .filter(Boolean)
              .join(' ')}
            style={{ paddingLeft: `${10 + Math.min(item.depth, 5) * 13}px` }}
            disabled={!clickable}
            title={item.title}
            onClick={() => clickable && item.page !== null && onJump(item.page)}
          >
            <span className="pdf-outline-dot" aria-hidden="true" />
            <span className="pdf-outline-title">{item.title}</span>
            {item.page !== null ? <span className="pdf-outline-page tabular">{item.page}</span> : null}
          </button>
        )
      })}
      <div className="pdf-panel-foot">
        <IconBookOpen size={14} />
        <span>共 {outline.length} 条目录</span>
      </div>
    </div>
  )
}
