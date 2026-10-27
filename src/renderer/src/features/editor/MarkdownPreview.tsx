import { useCallback, useEffect, useImperativeHandle, useRef, useState, type MouseEvent, type ReactNode, type RefObject } from 'react'
import { enhanceSheetMusic } from './lib/abc'
import type { HeadingInfo } from './lib/doc'
import { anchorIdFromHref, assignHeadingIds, renderMarkdown, scrollPreviewTo } from './lib/markdown'

export interface MarkdownPreviewHandle {
  scrollToHeading: (id: string) => void
  getRoot: () => HTMLDivElement | null
}

interface Props {
  source: string
  headings: HeadingInfo[]
  className?: string
  handleRef?: RefObject<MarkdownPreviewHandle | null>
  /** 空文档时的占位文案 */
  emptyHint?: ReactNode
}

/**
 * Markdown 实时预览。
 * 180ms 防抖 + DOMPurify 消毒；渲染完再按顺序补标题 id，供大纲跳转。
 * ```abc 围栏交给 abcjs 异步排成 SVG（见 lib/abc.ts）。
 */
export function MarkdownPreview(props: Props): ReactNode {
  const host = useRef<HTMLDivElement | null>(null)
  const [html, setHtml] = useState('')

  const headingKey = props.headings.map((h) => h.id).join('|')

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setHtml(renderMarkdown(props.source, props.headings))
    }, 180)
    return () => window.clearTimeout(timer)
    // headings 只在文档结构变化时才会变，跟着 source 一起重排即可
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.source])

  useEffect(() => {
    const root = host.current
    if (!root) return
    assignHeadingIds(root, props.headings.map((h) => h.id))
    // 标题列表变化后重新贴 id
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [html, headingKey])

  /* 五线谱：同步渲染已在上一步完成，这里把占位块换成真正的 SVG */
  useEffect(() => {
    const root = host.current
    if (!root || !html) return
    const width = Math.max(320, Math.min(760, (root.clientWidth || 760) - 64))
    void enhanceSheetMusic(root, { staffWidth: width })
  }, [html])

  /* 目录（以及任何 #锚点链接）在预览容器内部滚动，不要改窗口 URL */
  const handleClick = useCallback((event: MouseEvent<HTMLDivElement>): void => {
    const target = event.target as HTMLElement | null
    const anchor = target?.closest?.('a[href^="#"]') as HTMLAnchorElement | null
    if (!anchor) return
    const id = anchorIdFromHref(anchor.getAttribute('href'))
    if (!id) return
    event.preventDefault()
    scrollPreviewTo(host.current, id)
  }, [])

  useImperativeHandle(props.handleRef, () => ({
    scrollToHeading: (id: string): void => scrollPreviewTo(host.current, id),
    getRoot: (): HTMLDivElement | null => host.current
  }))

  return (
    <div
      className={['bs-preview-scroll', props.className ?? ''].filter(Boolean).join(' ')}
      ref={host}
      onClick={handleClick}
    >
      <article
        className="bs-prose"
        dangerouslySetInnerHTML={{ __html: html }}
        aria-label="预览"
      />
      {html.trim() ? null : (
        <p className="bs-preview-empty">{props.emptyHint ?? '还没有内容，左侧写点什么吧。'}</p>
      )}
    </div>
  )
}
