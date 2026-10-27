/**
 * 单页批注层。
 *
 * 设计要点：
 *  - 坐标系：所有笔迹存归一化 0..1 坐标（相对页面左上角），
 *    渲染时乘以页面屏幕尺寸，因此缩放 / 旋转天然无关；
 *  - 事件：只在「拿起笔」时接管指针（touch-action: none），
 *    手型 / 选择模式下整层 pointer-events: none，绝不挡住滚动；
 *  - 高亮用 multiply 混合，叠在文字上仍能看清原文。
 */

import { useCallback, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import type { AnnotationStroke, AnnotationTool, Point } from '@shared/types'
import { strokeHitByPoint, textNoteRect, wrapText } from '../lib/geometry'

export type DrawingTool = AnnotationTool | 'select'

export interface AnnotationSettings {
  tool: DrawingTool
  color: string
  /** 归一化线宽（相对页面宽度） */
  width: number
  opacity: number
}

export interface AnnotationLayerProps {
  page: number
  width: number
  height: number
  strokes: AnnotationStroke[]
  settings: AnnotationSettings
  visible: boolean
  /** 文本便签盒尺寸（归一化），由父层按页面宽度换算后传入以便换行 */
  textFontSize: number
  onCommit: (stroke: AnnotationStroke) => void
  onErase: (strokeIds: string[], withUndo: boolean) => void
  onRequestTextNote: (point: Point) => void
  onEditTextNote: (stroke: AnnotationStroke) => void
}

let strokeSeq = 0

export function nextStrokeId(): string {
  strokeSeq += 1
  return `st_${Date.now().toString(36)}_${strokeSeq.toString(36)}`
}

/** 由工具推导默认的线宽与不透明度 */
export function strokeStyleFor(tool: DrawingTool, settings: AnnotationSettings): { width: number; opacity: number } {
  switch (tool) {
    case 'highlighter':
      return { width: Math.max(settings.width, 0.014), opacity: 0.32 }
    case 'underline':
      return { width: Math.max(settings.width * 0.5, 0.0022), opacity: 1 }
    case 'eraser':
      return { width: settings.width, opacity: 1 }
    case 'pen':
    default:
      return { width: Math.max(settings.width, 0.002), opacity: settings.opacity }
  }
}

function roundPoint(p: Point): Point {
  return { x: Math.round(p.x * 10000) / 10000, y: Math.round(p.y * 10000) / 10000 }
}

function pointsToPath(points: Point[], width: number, height: number): string {
  if (points.length === 0) return ''
  let d = `M ${(points[0].x * width).toFixed(2)} ${(points[0].y * height).toFixed(2)}`
  for (let i = 1; i < points.length; i += 1) {
    d += ` L ${(points[i].x * width).toFixed(2)} ${(points[i].y * height).toFixed(2)}`
  }
  return d
}

/* ------------------------------------------------------------- 只读渲染 */

export function AnnotationStrokes({
  strokes,
  width,
  height,
  interactive,
  onEditTextNote
}: {
  strokes: AnnotationStroke[]
  width: number
  height: number
  interactive: boolean
  onEditTextNote?: (stroke: AnnotationStroke) => void
}): ReactNode {
  return (
    <g>
      {strokes.map((stroke) => (
        <StrokeShape
          key={stroke.id}
          stroke={stroke}
          width={width}
          height={height}
          interactive={interactive}
          onEditTextNote={onEditTextNote}
        />
      ))}
    </g>
  )
}

function StrokeShape({
  stroke,
  width,
  height,
  interactive,
  onEditTextNote
}: {
  stroke: AnnotationStroke
  width: number
  height: number
  interactive: boolean
  onEditTextNote?: (stroke: AnnotationStroke) => void
}): ReactNode {
  const strokeWidth = Math.max(0.6, stroke.width * width)

  if (stroke.tool === 'text') {
    const rect = textNoteRect(stroke)
    const x = rect.x * width
    const y = rect.y * height
    const boxW = rect.width * width
    const boxH = rect.height * height
    const fontPx = Math.max(8, (stroke.fontSize ?? 0.0175) * height)
    const maxChars = Math.max(4, Math.floor(boxW / (fontPx * 0.62)))
    const lines = wrapText(stroke.text ?? '', maxChars)
    return (
      <g
        className="pdf-note"
        style={interactive ? { cursor: 'pointer', pointerEvents: 'auto' } : undefined}
        onPointerDown={
          interactive && onEditTextNote
            ? (event) => {
                event.stopPropagation()
                onEditTextNote(stroke)
              }
            : undefined
        }
      >
        <rect
          x={x}
          y={y}
          width={boxW}
          height={boxH}
          rx={Math.min(6, boxH * 0.16)}
          fill="var(--bg-elevated)"
          fillOpacity={0.94}
          stroke={stroke.color}
          strokeWidth={1.2}
        />
        <rect x={x} y={y} width={3} height={boxH} rx={1.5} fill={stroke.color} />
        <text x={x + 8} y={y + fontPx + 2} fontSize={fontPx} fill="var(--text-primary)">
          {lines.map((line, index) => (
            <tspan key={index} x={x + 8} dy={index === 0 ? 0 : fontPx * 1.25}>
              {line}
            </tspan>
          ))}
        </text>
      </g>
    )
  }

  if (stroke.tool === 'highlighter') {
    const bounds = stroke.points.reduce(
      (acc, p) => ({
        minX: Math.min(acc.minX, p.x),
        minY: Math.min(acc.minY, p.y),
        maxX: Math.max(acc.maxX, p.x),
        maxY: Math.max(acc.maxY, p.y)
      }),
      { minX: 1, minY: 1, maxX: 0, maxY: 0 }
    )
    const pad = strokeWidth / 2
    return (
      <rect
        x={bounds.minX * width - pad}
        y={bounds.minY * height - pad}
        width={Math.max(1, (bounds.maxX - bounds.minX) * width + pad * 2)}
        height={Math.max(1, (bounds.maxY - bounds.minY) * height + pad * 2)}
        fill={stroke.color}
        opacity={stroke.opacity}
        style={{ mixBlendMode: 'multiply' }}
      />
    )
  }

  if (stroke.tool === 'underline') {
    const a = stroke.points[0]
    const b = stroke.points[stroke.points.length - 1]
    if (!a) return null
    const endX = b && b.x !== a.x ? b.x : Math.min(1, a.x + 0.06)
    return (
      <line
        x1={a.x * width}
        y1={a.y * height}
        x2={endX * width}
        y2={(b?.y ?? a.y) * height}
        stroke={stroke.color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        opacity={stroke.opacity}
      />
    )
  }

  if (stroke.points.length === 1) {
    return (
      <circle
        cx={stroke.points[0].x * width}
        cy={stroke.points[0].y * height}
        r={Math.max(0.8, strokeWidth / 2)}
        fill={stroke.color}
        opacity={stroke.opacity}
      />
    )
  }

  return (
    <path
      d={pointsToPath(stroke.points, width, height)}
      fill="none"
      stroke={stroke.color}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      opacity={stroke.opacity}
    />
  )
}

/* -------------------------------------------------------------- 可绘制层 */

export function AnnotationLayer(props: AnnotationLayerProps): ReactNode {
  const { page, width, height, strokes, settings, visible, textFontSize } = props
  const [draft, setDraft] = useState<AnnotationStroke | null>(null)
  const erasing = useRef(false)
  const erased = useRef(new Set<string>())
  const drawing = settings.tool !== 'select' && settings.tool !== 'text'

  const localPoint = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>): Point => {
      const rect = event.currentTarget.getBoundingClientRect()
      const x = rect.width > 0 ? (event.clientX - rect.left) / rect.width : 0
      const y = rect.height > 0 ? (event.clientY - rect.top) / rect.height : 0
      return { x: Math.min(1, Math.max(0, x)), y: Math.min(1, Math.max(0, y)) }
    },
    []
  )

  const startStroke = useCallback(
    (point: Point): AnnotationStroke => {
      const style = strokeStyleFor(settings.tool, settings)
      return {
        id: nextStrokeId(),
        tool: settings.tool as AnnotationTool,
        color: settings.color,
        width: style.width,
        opacity: style.opacity,
        points: [roundPoint(point)],
        createdAt: Date.now()
      }
    },
    [settings]
  )

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>): void => {
      if (!visible) return
      if (event.button !== 0 && event.pointerType === 'mouse') return
      const point = localPoint(event)

      if (settings.tool === 'select') return

      if (settings.tool === 'text') {
        event.preventDefault()
        props.onRequestTextNote(point)
        return
      }

      event.preventDefault()
      event.currentTarget.setPointerCapture?.(event.pointerId)

      if (settings.tool === 'eraser') {
        erasing.current = true
        erased.current = new Set()
        const hits = strokes.filter((s) => strokeHitByPoint(s, point.x * width, point.y * height, width, height))
        if (hits.length > 0) {
          for (const s of hits) erased.current.add(s.id)
          props.onErase([...erased.current], true)
        }
        return
      }

      setDraft(startStroke(point))
    },
    [visible, settings.tool, localPoint, strokes, width, height, startStroke, props]
  )

  const handlePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>): void => {
      if (!visible) return
      const point = localPoint(event)

      if (erasing.current) {
        const hits = strokes.filter((s) => strokeHitByPoint(s, point.x * width, point.y * height, width, height))
        let changed = false
        for (const s of hits) {
          if (!erased.current.has(s.id)) {
            erased.current.add(s.id)
            changed = true
          }
        }
        if (changed) props.onErase([...erased.current], false)
        return
      }

      if (!draft) return
      setDraft((current) => {
        if (!current) return current
        const next = roundPoint(point)
        const last = current.points[current.points.length - 1]
        // 采样：距离太近就不记录，避免一笔几千个点
        const dx = (next.x - last.x) * width
        const dy = (next.y - last.y) * height
        if (dx * dx + dy * dy < 1.2) return current
        return { ...current, points: [...current.points, next] }
      })
    },
    [visible, localPoint, strokes, width, height, draft, props]
  )

  const finishStroke = useCallback((): void => {
    if (erasing.current) {
      erasing.current = false
      erased.current = new Set()
      return
    }
    if (draft) {
      props.onCommit(draft)
      setDraft(null)
    }
  }, [draft, props])

  const handlePointerUp = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>): void => {
      event.currentTarget.releasePointerCapture?.(event.pointerId)
      finishStroke()
    },
    [finishStroke]
  )

  const preview = useMemo(() => {
    if (!draft) return null
    return <StrokeShape stroke={draft} width={width} height={height} interactive={false} />
  }, [draft, width, height])

  if (!visible) return null

  return (
    <div
      className={[
        'pdf-anno',
        drawing ? 'is-drawing' : '',
        settings.tool === 'eraser' ? 'is-erasing' : '',
        settings.tool === 'text' ? 'is-text' : ''
      ]
        .filter(Boolean)
        .join(' ')}
      data-page={page}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onPointerLeave={(event) => {
        if (erasing.current) return
        if (draft && event.buttons === 0) finishStroke()
      }}
    >
      <svg
        className="pdf-anno-svg"
        width={width}
        height={height}
        viewBox={`0 0 ${Math.max(1, width)} ${Math.max(1, height)}`}
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <AnnotationStrokes
          strokes={strokes}
          width={width}
          height={height}
          interactive={settings.tool !== 'select'}
          onEditTextNote={props.onEditTextNote}
        />
        {preview}
      </svg>
    </div>
  )
}
