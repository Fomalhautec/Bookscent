/**
 * 文本便签编辑框 —— 点一下页面就在落点处出现一个小输入框。
 * 编辑已有便签时传入 stroke，此时位置与尺寸沿用原便签，避免「跳动」。
 */

import { useEffect, useMemo, useRef, type ReactNode } from 'react'
import type { AnnotationStroke, Point } from '@shared/types'
import { TEXT_NOTE_BOX, textNoteRect, type PageBox } from '../lib/geometry'

export interface TextNoteEditorProps {
  box: PageBox
  point: Point | null
  stroke: AnnotationStroke | null
  value: string
  onChange: (text: string) => void
  onCommit: () => void
  onCancel: () => void
}

export function TextNoteEditor({
  box,
  point,
  stroke,
  value,
  onChange,
  onCommit,
  onCancel
}: TextNoteEditorProps): ReactNode {
  const ref = useRef<HTMLTextAreaElement | null>(null)

  const rect = useMemo(() => {
    if (stroke) return textNoteRect(stroke)
    const anchor = point ?? { x: 0.1, y: 0.1 }
    return {
      x: Math.min(1 - TEXT_NOTE_BOX.width, Math.max(0, anchor.x)),
      y: Math.min(1 - TEXT_NOTE_BOX.height, Math.max(0, anchor.y)),
      width: TEXT_NOTE_BOX.width,
      height: TEXT_NOTE_BOX.height
    }
  }, [stroke, point])

  useEffect(() => {
    const node = ref.current
    if (!node) return
    node.focus()
    node.select()
  }, [stroke?.id, point?.x, point?.y])

  return (
    <div
      className="pdf-note-editor"
      style={{
        left: `${rect.x * box.width}px`,
        top: `${rect.y * box.height}px`,
        width: `${Math.max(150, rect.width * box.width)}px`,
        height: `${Math.max(56, rect.height * box.height)}px`
      }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <textarea
        ref={ref}
        value={value}
        placeholder="写点想法…（Ctrl+Enter 保存，Esc 取消）"
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          event.stopPropagation()
          if (event.key === 'Escape') {
            event.preventDefault()
            onCancel()
          } else if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
            event.preventDefault()
            onCommit()
          }
        }}
        onBlur={onCommit}
      />
      <div className="pdf-note-actions">
        <button type="button" className="pdf-note-btn" onMouseDown={(e) => e.preventDefault()} onClick={onCommit}>
          保存
        </button>
        <button type="button" className="pdf-note-btn is-quiet" onMouseDown={(e) => e.preventDefault()} onClick={onCancel}>
          取消
        </button>
      </div>
    </div>
  )
}
