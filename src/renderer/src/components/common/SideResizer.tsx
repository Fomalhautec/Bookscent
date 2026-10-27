import { useCallback, useRef, useState, type ReactNode } from 'react'

/**
 * 侧栏宽度拖手 —— 一条窄窄的、可以用鼠标拖动的边。
 *
 * 为什么单独做成组件：阅读器左右两边各有一条（左边是目录/书签/笔记，
 * 右边是翻译），拖动逻辑与"松手才写设置"的策略完全一样，没必要写两遍。
 *
 * 拖的过程中只改调用方的**本地**状态（每帧都写设置会一直抖 IPC 与磁盘），
 * 松手时才 `onCommit` 落盘。
 */
export interface SideResizerProps {
  /** 拖手贴在哪一侧：left = 侧栏在左边（往右拖变宽）；right = 侧栏在右边（往左拖变宽） */
  side: 'left' | 'right'
  value: number
  min: number
  max: number
  /** 拖动中的实时宽度（调用方拿去改本地状态） */
  onDrag: (width: number) => void
  /** 松手：这时候才提交（写进设置） */
  onCommit: (width: number) => void
  /** 双击回到这个宽度（默认取范围中值） */
  resetTo?: number
}

export function SideResizer({
  side,
  value,
  min,
  max,
  onDrag,
  onCommit,
  resetTo
}: SideResizerProps): ReactNode {
  const [dragging, setDragging] = useState(false)
  const startRef = useRef<{ x: number; width: number } | null>(null)
  const latestRef = useRef(value)

  const clamp = useCallback(
    (width: number): number => Math.round(Math.max(min, Math.min(max, width))),
    [min, max]
  )

  const finish = useCallback(
    (commit: boolean) => {
      startRef.current = null
      setDragging(false)
      if (commit) onCommit(clamp(latestRef.current))
    },
    [clamp, onCommit]
  )

  return (
    <div
      className={['side-resizer', `is-${side}`, dragging ? 'is-dragging' : ''].filter(Boolean).join(' ')}
      role="separator"
      aria-orientation="vertical"
      aria-label="拖动调整宽度"
      title="拖动调整宽度（双击恢复）"
      onPointerDown={(event) => {
        event.preventDefault()
        event.stopPropagation()
        latestRef.current = value
        startRef.current = { x: event.clientX, width: value }
        setDragging(true)
        /*
         * 抓住指针：拖出这条细线也不会丢事件。
         * 用 try 包住：合成事件（探针/自动化）的 pointerId 未必真的按下过，
         * 这时 setPointerCapture 会抛 —— 不能因此把拖动整个断掉。
         */
        try {
          ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
        } catch {
          /* 抓不住也能拖：move 事件在元素上照样收得到 */
        }
      }}
      onPointerMove={(event) => {
        const start = startRef.current
        if (!start) return
        const delta = event.clientX - start.x
        const next = clamp(side === 'left' ? start.width + delta : start.width - delta)
        latestRef.current = next
        onDrag(next)
      }}
      onPointerUp={(event) => {
        if (!startRef.current) return
        try {
          ;(event.currentTarget as HTMLElement).releasePointerCapture?.(event.pointerId)
        } catch {
          /* 同上：没抓住就不用放 */
        }
        finish(true)
      }}
      onPointerCancel={() => finish(false)}
      onDoubleClick={() => {
        const target = clamp(resetTo ?? Math.round((min + max) / 2))
        latestRef.current = target
        onDrag(target)
        onCommit(target)
      }}
    />
  )
}
