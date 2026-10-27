import type { ReactNode } from 'react'
import type { TextMarkStyle } from '@shared/types'
import { TEXT_MARK_COLORS } from '@/features/epub/textMarks'
import { IconClose, IconCopy, IconTrash } from '@/components/icons/Icons'

/**
 * 选中/编辑正文时浮出的操作条 —— **只有这一条**。
 *
 * 以前有两个：选中时一条（复制 / 配色 / 划线 / 波浪 / 记为笔记），点已有标注时另一条
 * （复制 / 配色 / 高亮 / 划线 / 波浪 / 删除）。同样是"对这段文字动手"，两套按钮顺序不一样、
 * 样式按钮的去留也不一样，用起来像两个功能（用户提的）。
 * 现在合成一条：按钮顺序与外观完全一致，只是**动作的含义**按场景不同 ——
 *   - 选中时：这些按钮是"给这段加标注"；
 *   - 编辑时：同样这些按钮是"把这条改成这样"，另加删除与关闭。
 *
 * `current` 传进来时表示正在编辑已有标注：按钮会标出"你现在是哪一档"。
 */
export interface TextActionBarProps {
  /** 选区/标注在窗口里的位置；条子贴在它上方 */
  anchor: { x: number; y: number }
  /**
   * 应用某种样式；带 color 时同时换颜色。
   * 选中场景 = 新建标注；编辑场景 = 修改这条标注。
   */
  onMark: (style: TextMarkStyle, color?: string) => void
  onCopy: () => void
  /** 编辑已有标注时传入：标出当前样式与颜色 */
  current?: { style: TextMarkStyle; color: string } | null
  /** 编辑已有标注时显示的原文片段 */
  excerpt?: string
  /** 编辑场景：删除这条标注 */
  onDelete?: () => void
  /** 编辑场景：关闭 */
  onClose?: () => void
  /** 选中场景：记为笔记 */
  onBookmark?: () => void
  /** 选中场景：翻译 */
  onTranslate?: () => void
  /** 从选中处开始朗读 */
  onSpeak?: () => void
}

const STYLE_BUTTONS: { value: TextMarkStyle; label: string }[] = [
  { value: 'highlight', label: '高亮' },
  { value: 'underline', label: '划线' },
  { value: 'wavy', label: '波浪' }
]

export function TextActionBar({
  anchor,
  onMark,
  onCopy,
  current,
  excerpt,
  onDelete,
  onClose,
  onBookmark,
  onTranslate,
  onSpeak
}: TextActionBarProps): ReactNode {
  const editing = Boolean(current)
  return (
    <div
      className={['text-action-bar', editing ? 'is-edit' : ''].filter(Boolean).join(' ')}
      style={{ left: anchor.x, top: Math.max(48, anchor.y - 44) }}
      /* 在工具条上按下鼠标不该把选区弄丢 */
      onMouseDown={(event) => event.preventDefault()}
    >
      {editing && excerpt ? (
        <span className="mark-edit-excerpt" title={excerpt}>
          {excerpt.length > 12 ? `${excerpt.slice(0, 12)}…` : excerpt}
        </span>
      ) : null}
      <button type="button" className="text-action-btn" onClick={onCopy}>
        <IconCopy size={13} />
        复制
      </button>
      <span className="text-action-sep" />
      {TEXT_MARK_COLORS.map((entry) => (
        <button
          key={entry.value}
          type="button"
          className={['text-action-color', current?.color === entry.value ? 'is-current' : '']
            .filter(Boolean)
            .join(' ')}
          style={{ background: entry.value }}
          title={editing ? `改成 ${entry.name}` : `高亮 · ${entry.name}`}
          onClick={() => onMark('highlight', entry.value)}
        />
      ))}
      <span className="text-action-sep" />
      {STYLE_BUTTONS.map((entry) => (
        <button
          key={entry.value}
          type="button"
          className={['text-action-btn', current?.style === entry.value ? 'is-current' : '']
            .filter(Boolean)
            .join(' ')}
          onClick={() => onMark(entry.value)}
        >
          {entry.label}
        </button>
      ))}
      {onBookmark ? (
        <>
          <span className="text-action-sep" />
          <button type="button" className="text-action-btn" onClick={onBookmark}>
            记为笔记
          </button>
        </>
      ) : null}
      {onTranslate ? (
        <button type="button" className="text-action-btn" onClick={onTranslate}>
          翻译
        </button>
      ) : null}
      {onSpeak ? (
        <button type="button" className="text-action-btn" onClick={onSpeak} title="从这一句开始朗读">
          朗读
        </button>
      ) : null}
      {onDelete ? (
        <>
          <span className="text-action-sep" />
          <button type="button" className="text-action-btn is-danger" onClick={onDelete}>
            <IconTrash size={13} />
            删除
          </button>
        </>
      ) : null}
      {onClose ? (
        <button type="button" className="text-action-btn" onClick={onClose} title="关闭">
          <IconClose size={13} />
        </button>
      ) : null}
    </div>
  )
}
