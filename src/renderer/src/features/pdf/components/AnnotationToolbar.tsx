/**
 * 批注工具条 —— 悬浮在阅读区底部。
 * 工具 / 颜色 / 线宽 / 撤销 / 清除本页 / 导出批注 PDF。
 */

import type { ReactNode } from 'react'
import { Button, IconButton, Slider } from '@/components/common/Controls'
import {
  IconDownload,
  IconEraser,
  IconHighlighter,
  IconPen,
  IconTextCursor,
  IconTrash,
  IconUndo
} from '@/components/icons/Icons'
import { IconHand, IconUnderline } from './pdfIcons'
import type { DrawingTool } from './AnnotationLayer'

export const ANNOTATION_COLORS = [
  '#b5443a',
  '#c8873a',
  '#3f7f5c',
  '#3f6f8f',
  '#7a5aa8',
  '#2f2f33'
] as const

export interface AnnotationToolbarProps {
  tool: DrawingTool
  color: string
  width: number
  onToolChange: (tool: DrawingTool) => void
  onColorChange: (color: string) => void
  onWidthChange: (width: number) => void
  onUndo: () => void
  onClearPage: () => void
  onExport: () => void
  canUndo: boolean
  canClear: boolean
  exporting: boolean
}

const TOOLS: { tool: DrawingTool; label: string; hint: string; icon: ReactNode }[] = [
  { tool: 'select', label: '手型 / 选择', hint: 'Esc', icon: <IconHand size={16} /> },
  { tool: 'pen', label: '钢笔', hint: 'P', icon: <IconPen size={16} /> },
  { tool: 'highlighter', label: '荧光笔', hint: 'H', icon: <IconHighlighter size={16} /> },
  { tool: 'underline', label: '下划线', hint: 'U', icon: <IconUnderline size={16} /> },
  { tool: 'text', label: '文字便签', hint: 'T', icon: <IconTextCursor size={16} /> },
  { tool: 'eraser', label: '橡皮擦', hint: 'E', icon: <IconEraser size={16} /> }
]

export function AnnotationToolbar(props: AnnotationToolbarProps): ReactNode {
  const { tool, color, width } = props

  return (
    <div className="pdf-anno-bar">
      <div className="pdf-anno-tools">
        {TOOLS.map((item) => (
          <IconButton
            key={item.tool}
            label={`${item.label}（${item.hint}）`}
            active={tool === item.tool}
            onClick={() => props.onToolChange(item.tool)}
          >
            {item.icon}
          </IconButton>
        ))}
      </div>

      <span className="pdf-anno-divider" />

      <div className="pdf-anno-colors" role="group" aria-label="批注颜色">
        {ANNOTATION_COLORS.map((swatch) => (
          <button
            key={swatch}
            type="button"
            className={['pdf-swatch', color.toLowerCase() === swatch.toLowerCase() ? 'is-active' : '']
              .filter(Boolean)
              .join(' ')}
            style={{ background: swatch }}
            title={swatch}
            aria-label={`颜色 ${swatch}`}
            onClick={() => props.onColorChange(swatch)}
          />
        ))}
        <label className="pdf-swatch is-picker" title="自定义颜色">
          <span style={{ background: color }} />
          <input
            type="color"
            value={/^#[0-9a-f]{6}$/i.test(color) ? color : '#b5443a'}
            aria-label="自定义颜色"
            onChange={(event) => props.onColorChange(event.target.value)}
          />
        </label>
      </div>

      <span className="pdf-anno-divider" />

      <div className="pdf-anno-width">
        <span className="pdf-anno-width-label">粗细</span>
        <Slider
          value={Math.round(width * 1000)}
          min={1}
          max={40}
          step={1}
          onChange={(value) => props.onWidthChange(value / 1000)}
          format={(value) => `${(value / 10).toFixed(1)}`}
        />
      </div>

      <span className="pdf-anno-divider" />

      <div className="pdf-anno-actions">
        <IconButton label="撤销上一笔（Ctrl+Z）" disabled={!props.canUndo} onClick={props.onUndo}>
          <IconUndo size={16} />
        </IconButton>
        <IconButton label="清除本页批注" disabled={!props.canClear} onClick={props.onClearPage}>
          <IconTrash size={16} />
        </IconButton>
        <Button
          size="sm"
          variant="outline"
          icon={<IconDownload size={15} />}
          disabled={props.exporting}
          onClick={props.onExport}
        >
          {props.exporting ? '正在导出…' : '导出批注 PDF'}
        </Button>
      </div>
    </div>
  )
}
