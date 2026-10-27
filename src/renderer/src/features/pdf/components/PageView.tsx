/**
 * 单页视图。
 *
 * 一个页面由三层叠成：
 *   1. .pdf-page-placeholder —— 按正确尺寸撑开版面，保证滚动条长度稳定
 *   2. canvas —— 靠近视口时才栅格化（IntersectionObserver），按 DPR 放大
 *   3. 批注层 / 搜索高亮层 —— SVG 覆盖，坐标随时可用
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type {
  AnnotationStroke,
  NormRect,
  PdfTextHighlight,
  Point
} from '@shared/types'
import { getPixelRatio, ignoreCancelled } from '../lib/dom'
import {
  renderPageTextLayer,
  renderPageToCanvas,
  type CancellableRenderTask,
  type PDFDocumentProxy
} from '../lib/engine'
import type { PageBox } from '../lib/geometry'
import type { RenderQueue } from '../lib/renderQueue'
import type { ScrollMode } from '../hooks/useViewerState'
import type { SearchRect } from '../lib/search'
import { AnnotationLayer, type AnnotationSettings } from './AnnotationLayer'
import { TextNoteEditor } from './TextNoteEditor'

export interface PageViewProps {
  doc: PDFDocumentProxy | null
  box: PageBox
  /** 当前页（用于优先级与高亮） */
  currentPage: number
  scrollMode: ScrollMode
  annotations: AnnotationStroke[]
  settings: AnnotationSettings
  searchRects: SearchRect[]
  activeSearchRect: SearchRect | null
  /**
   * 可选的串行渲染队列（阅读器那一份）。双页跨页时左右两页共用它：
   * 先画当前页再画对页，避免同一帧里两个渲染任务抢带宽。
   * 不传就沿用原来的「各页自己起一个渲染任务」。
   */
  renderQueue?: RenderQueue | null
  /** 正在编辑的便签（属于本页时才渲染编辑框） */
  noteEditor:
    | { page: number; stroke: AnnotationStroke | null; point: Point | null; text: string }
    | null
  onNoteTextChange: (text: string) => void
  onNoteCommit: () => void
  onNoteCancel: () => void
  registerPage: (page: number, node: HTMLDivElement | null) => void
  onCommitStroke: (page: number, stroke: AnnotationStroke) => void
  onEraseStrokes: (page: number, ids: string[], withUndo: boolean) => void
  onRequestTextNote: (page: number, point: Point) => void
  onEditTextNote: (page: number, stroke: AnnotationStroke) => void
  /** 这一页的文字标注（高亮/划线） */
  textHighlights?: PdfTextHighlight[]
  /** 点了某条标注：交给上层编辑（改颜色 / 换样式 / 删除） */
  onMarkClick?: (id: string, anchor: { x: number; y: number }) => void
  /**
   * 在文字层里选中一段文字。
   * 交给上层去决定画工具条还是存标注 —— PageView 只管把"选中了什么、在哪"报上去。
   */
  onTextSelect?: (payload: {
    page: number
    text: string
    rects: NormRect[]
    /** 选区在窗口里的位置，用来贴工具条 */
    anchor: { x: number; y: number }
  }) => void
}

export function PageView(props: PageViewProps): ReactNode {
  const { doc, box, currentPage, scrollMode } = props
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const hostRef = useRef<HTMLDivElement | null>(null)
  const textLayerRef = useRef<HTMLDivElement | null>(null)
  const [distance, setDistance] = useState(Number.POSITIVE_INFINITY)
  const [rendered, setRendered] = useState(false)
  const [failed, setFailed] = useState(false)

  /* 本页自己的文字标注（按页过滤，覆盖层用归一化百分比画） */
  const pageHighlights = useMemo(
    () => (props.textHighlights ?? []).filter((mark) => mark.page === box.page),
    [props.textHighlights, box.page]
  )

  /**
   * 文字层里的选区 → 归一化矩形 + 文字。
   *
   * 矩形用 range.getClientRects() 取，再除以纸张盒子的尺寸 —— 于是缩放、旋转、
   * 双页并排都不用重算，百分比天然自适应。
   */
  const reportSelection = useCallback((): void => {
    const layer = textLayerRef.current
    const paper = layer?.parentElement
    const onSelect = props.onTextSelect
    if (!layer || !paper || !onSelect) return
    const selection = window.getSelection()
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) return
    const range = selection.getRangeAt(0)
    /* 只认落在这一页文字层里的选区，跨页的就交给各自页面处理 */
    if (!layer.contains(range.commonAncestorContainer)) return
    const text = selection.toString()
    if (!text.trim()) return
    /* 注意别把外层的 box（这一页的盒子）遮蔽掉 */
    const paperRect = paper.getBoundingClientRect()
    if (paperRect.width <= 0 || paperRect.height <= 0) return
    const rects = Array.from(range.getClientRects())
      .filter((rect) => rect.width > 0.5 && rect.height > 0.5)
      .map((rect) => ({
        x: (rect.left - paperRect.left) / paperRect.width,
        y: (rect.top - paperRect.top) / paperRect.height,
        width: rect.width / paperRect.width,
        height: rect.height / paperRect.height
      }))
    if (rects.length === 0) return
    const first = range.getClientRects()[0]
    if (!first) return
    onSelect({
      page: box.page,
      text,
      rects,
      anchor: { x: first.left + first.width / 2, y: first.top }
    })
  }, [props.onTextSelect])

  const pixelRatio = getPixelRatio()
  const renderKey = `${box.page}|${box.width.toFixed(2)}|${box.height.toFixed(2)}|${box.rotation}|${pixelRatio}`

  /* ---------------------------------------------- 与视口的距离 */

  const setHost = (node: HTMLDivElement | null): void => {
    hostRef.current = node
    props.registerPage(box.page, node)
  }

  useEffect(() => {
    const node = hostRef.current
    if (!node) return
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0]
        if (!entry) return
        // 单页 / 左右翻页：挂出来的就是眼前要看的这几页，
        // 一律当作「就在眼前」，免得翻页动画把它平移出视口时反而不栅格化
        if (scrollMode !== 'continuous') {
          setDistance(0)
          return
        }
        if (entry.isIntersecting) {
          const root = entry.rootBounds
          const self = entry.boundingClientRect
          if (!root) {
            setDistance(0)
            return
          }
          const above = root.top - self.bottom
          const below = self.top - root.bottom
          setDistance(Math.max(0, Math.max(above, below)))
        } else {
          setDistance(Number.POSITIVE_INFINITY)
        }
      },
      { rootMargin: '900px 0px', threshold: 0 }
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [scrollMode])

  const inRange = distance < 1400

  /* -------------------------------------------------- 栅格化 */

  useEffect(() => {
    if (!doc || !inRange) return
    let disposed = false
    let canceled = false
    let task: CancellableRenderTask | null = null
    setFailed(false)

    const stopped = (): boolean => disposed || canceled

    const draw = async (): Promise<void> => {
      // 先让出一帧，别和布局 / 首屏提交抢时间。
      // 注意：这里必须一定会 resolve —— 走渲染队列时它被队列 await 着，
      // 卡住不返回会把整条队列堵死（rAF 在窗口隐藏 / 被节流时可能长时间不来，
      // 所以配一个兜底定时器）。
      await new Promise<void>((resolve) => {
        const timer = window.setTimeout(resolve, 500)
        window.requestAnimationFrame(() => {
          window.clearTimeout(timer)
          resolve()
        })
      })
      if (stopped()) return
      try {
        const page = await doc.getPage(box.page)
        if (stopped()) return
        const canvas = canvasRef.current
        if (!canvas) return
        // 旋转已由 getViewport 处理，因此 scale 就是把原始尺寸放大到盒子尺寸的倍率
        const scale = Math.max(0.02, box.width / Math.max(1, box.baseWidth))
        task = renderPageToCanvas(page, canvas, scale, box.rotation - (page.rotate ?? 0), pixelRatio)
        await ignoreCancelled(task.promise)
        if (!stopped()) setRendered(true)

        /*
         * 画完就铺文字层。
         * canvas 是图，选不中字；文字层是一堆透明 span，位置与画布对齐 ——
         * 有了它才有原生的选词、复制，以及我们自己的高亮/划线。
         *
         * 用一个小延时错开：文字层是"锦上添花"，不该跟首帧抢时间。
         * 直接紧跟着渲染时，开书动画会被拖慢到提前收场（整套里那几条动画断言就是这么挂的）。
         */
        const layer = textLayerRef.current
        if (layer) {
          window.setTimeout(() => {
            if (stopped() || !textLayerRef.current) return
            void renderPageTextLayer(page, textLayerRef.current, scale, box.rotation - (page.rotate ?? 0)).catch(
              () => undefined
            )
          }, 160)
        }
      } catch {
        if (!stopped()) setFailed(true)
      }
    }

    const stop = (): void => {
      canceled = true
      try {
        task?.cancel()
      } catch {
        // 忽略取消失败
      }
    }

    const queue = props.renderQueue
    const promise = queue
      ? // 同一个跨页的两页共用一条队列：当前页优先，画完再画对页
        queue.enqueue(box.page === currentPage ? 0 : 1, () => ({ promise: draw(), cancel: stop }))
      : draw()
    void promise.catch(() => {
      if (!stopped()) setFailed(true)
    })

    return () => {
      disposed = true
      stop()
    }
    // renderKey 覆盖了缩放 / 旋转 / DPR 的所有变化
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, renderKey, inRange])

  const isCurrent = currentPage === box.page
  const showOverlay = inRange

  const highlightRects = useMemo(() => props.searchRects, [props.searchRects])

  return (
    <div
      ref={setHost}
      className={['pdf-page', isCurrent ? 'is-current' : '', showOverlay ? 'is-live' : '']
        .filter(Boolean)
        .join(' ')}
      data-page={box.page}
      style={{
        width: `${box.width}px`,
        height: `${box.height}px`
      }}
    >
      <div className="pdf-paper" style={{ width: `${box.width}px`, height: `${box.height}px` }}>
        <canvas
          ref={canvasRef}
          className={['pdf-canvas', rendered ? 'is-ready' : ''].filter(Boolean).join(' ')}
          style={{ width: `${box.width}px`, height: `${box.height}px` }}
        />
        {!rendered && !failed ? <div className="pdf-page-loading" aria-hidden="true" /> : null}
        {failed ? <div className="pdf-page-failed">这一页渲染失败了</div> : null}

        {/*
          文字层：透明文字铺在画布上，负责"能选中"。
          选中之后由 onTextSelect 报给上层，工具条与标注都存在上层（与 EPUB 一致）。
        */}
        <div
          className="pdf-text-layer"
          ref={textLayerRef}
          onMouseUp={reportSelection}
          onTouchEnd={reportSelection}
        />

        {/* 文字标注（高亮 / 划线 / 波浪线）：归一化百分比覆盖层，点一下就编辑 */}
        {pageHighlights.length > 0 ? (
          <div className="pdf-mark-layer">
            {pageHighlights.flatMap((mark) =>
              mark.rects.map((rect, index) => (
                <span
                  key={`${mark.id}-${index}`}
                  className={`pdf-mark pdf-mark-${mark.style}`}
                  data-mark-id={mark.id}
                  role="button"
                  tabIndex={-1}
                  title="点一下可以改颜色 / 换样式 / 删除"
                  onClick={(event) => {
                    event.stopPropagation()
                    const box = (event.currentTarget as HTMLElement).getBoundingClientRect()
                    props.onMarkClick?.(mark.id, { x: box.left + box.width / 2, y: box.top })
                  }}
                  style={{
                    left: `${rect.x * 100}%`,
                    top: `${rect.y * 100}%`,
                    width: `${Math.max(0.3, rect.width * 100)}%`,
                    height: `${Math.max(0.3, rect.height * 100)}%`,
                    '--pdf-mark-color': mark.color
                  } as React.CSSProperties}
                />
              ))
            )}
          </div>
        ) : null}

        {highlightRects.length > 0 ? (
          <div className="pdf-search-layer" aria-hidden="true">
            {highlightRects.map((rect, index) => (
              <span
                key={index}
                className="pdf-search-hit"
                style={{
                  left: `${rect.x * 100}%`,
                  top: `${rect.y * 100}%`,
                  width: `${Math.max(0.4, rect.width * 100)}%`,
                  height: `${Math.max(0.4, rect.height * 100)}%`
                }}
              />
            ))}
            {props.activeSearchRect ? (
              <span
                className="pdf-search-hit is-active"
                style={{
                  left: `${props.activeSearchRect.x * 100}%`,
                  top: `${props.activeSearchRect.y * 100}%`,
                  width: `${Math.max(0.4, props.activeSearchRect.width * 100)}%`,
                  height: `${Math.max(0.4, props.activeSearchRect.height * 100)}%`
                }}
              />
            ) : null}
          </div>
        ) : null}

        {showOverlay ? (
          <AnnotationLayer
            page={box.page}
            width={box.width}
            height={box.height}
            strokes={props.annotations}
            settings={props.settings}
            visible
            textFontSize={0.0175}
            onCommit={(stroke) => props.onCommitStroke(box.page, stroke)}
            onErase={(ids, withUndo) => props.onEraseStrokes(box.page, ids, withUndo)}
            onRequestTextNote={(point) => props.onRequestTextNote(box.page, point)}
            onEditTextNote={(stroke) => props.onEditTextNote(box.page, stroke)}
          />
        ) : null}

        {props.noteEditor && props.noteEditor.page === box.page ? (
          <TextNoteEditor
            box={box}
            point={props.noteEditor.point}
            stroke={props.noteEditor.stroke}
            value={props.noteEditor.text}
            onChange={props.onNoteTextChange}
            onCommit={props.onNoteCommit}
            onCancel={props.onNoteCancel}
          />
        ) : null}
      </div>
    </div>
  )
}
