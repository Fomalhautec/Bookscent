import type { ReactNode } from 'react'
import { IconButton } from '@/components/common/Controls'
import {
  IconBold,
  IconChecklist,
  IconCodeBlock,
  IconCodeInline,
  IconDivider,
  IconHeading1,
  IconHeading2,
  IconHeading3,
  IconImage,
  IconItalic,
  IconLink,
  IconListBullet,
  IconListOrdered,
  IconQuote,
  IconRedo,
  IconStrike,
  IconTable,
  IconUndo
} from '@/components/icons/Icons'

export type ToolbarAction =
  | 'bold'
  | 'italic'
  | 'strike'
  | 'h1'
  | 'h2'
  | 'h3'
  | 'bullet'
  | 'ordered'
  | 'quote'
  | 'code'
  | 'codeblock'
  | 'link'
  | 'image'
  | 'table'
  | 'divider'
  | 'task'
  | 'undo'
  | 'redo'

interface Props {
  disabled: boolean
  onAction: (action: ToolbarAction) => void
}

interface Item {
  action: ToolbarAction
  label: string
  icon: ReactNode
  hint: string
}

const MARK_ITEMS: Item[] = [
  { action: 'bold', label: '加粗', icon: <IconBold size={15} />, hint: '加粗（Ctrl+B）' },
  { action: 'italic', label: '斜体', icon: <IconItalic size={15} />, hint: '斜体（Ctrl+I）' },
  { action: 'strike', label: '删除线', icon: <IconStrike size={15} />, hint: '删除线' }
]

const HEADING_ITEMS: Item[] = [
  { action: 'h1', label: '一级标题', icon: <IconHeading1 size={15} />, hint: '一级标题' },
  { action: 'h2', label: '二级标题', icon: <IconHeading2 size={15} />, hint: '二级标题' },
  { action: 'h3', label: '三级标题', icon: <IconHeading3 size={15} />, hint: '三级标题' }
]

const LIST_ITEMS: Item[] = [
  { action: 'bullet', label: '无序列表', icon: <IconListBullet size={15} />, hint: '无序列表' },
  { action: 'ordered', label: '有序列表', icon: <IconListOrdered size={15} />, hint: '有序列表' },
  { action: 'task', label: '待办清单', icon: <IconChecklist size={15} />, hint: '待办清单' },
  { action: 'quote', label: '引用', icon: <IconQuote size={15} />, hint: '引用' }
]

const BLOCK_ITEMS: Item[] = [
  { action: 'code', label: '行内代码', icon: <IconCodeInline size={15} />, hint: '行内代码' },
  { action: 'codeblock', label: '代码块', icon: <IconCodeBlock size={15} />, hint: '代码块' },
  { action: 'link', label: '链接', icon: <IconLink size={15} />, hint: '链接（Ctrl+K）' },
  { action: 'image', label: '插入图片', icon: <IconImage size={15} />, hint: '插入图片（存入统一图片库）' },
  { action: 'table', label: '表格', icon: <IconTable size={15} />, hint: '插入表格' },
  { action: 'divider', label: '分割线', icon: <IconDivider size={15} />, hint: '分割线' }
]

const HISTORY_ITEMS: Item[] = [
  { action: 'undo', label: '撤销', icon: <IconUndo size={15} />, hint: '撤销（Ctrl+Z）' },
  { action: 'redo', label: '重做', icon: <IconRedo size={15} />, hint: '重做（Ctrl+Shift+Z）' }
]

function Group({
  items,
  disabled,
  onAction
}: {
  items: Item[]
  disabled: boolean
  onAction: (action: ToolbarAction) => void
}): ReactNode {
  return (
    <div className="bs-tool-group">
      {items.map((item) => (
        <IconButton
          key={item.action}
          label={item.label}
          size={15}
          variant="ghost"
          disabled={disabled}
          title={disabled ? '纯文本模式不支持该操作' : item.hint}
          onClick={() => onAction(item.action)}
        >
          {item.icon}
        </IconButton>
      ))}
    </div>
  )
}

export function EditorToolbar(props: Props): ReactNode {
  const { disabled, onAction } = props
  return (
    <div className="bs-toolbar" role="toolbar" aria-label="格式工具栏">
      <Group items={MARK_ITEMS} disabled={disabled} onAction={onAction} />
      <span className="bs-tool-sep" />
      <Group items={HEADING_ITEMS} disabled={disabled} onAction={onAction} />
      <span className="bs-tool-sep" />
      <Group items={LIST_ITEMS} disabled={disabled} onAction={onAction} />
      <span className="bs-tool-sep" />
      <Group items={BLOCK_ITEMS} disabled={disabled} onAction={onAction} />
      <span className="bs-tool-sep" />
      <Group items={HISTORY_ITEMS} disabled={false} onAction={onAction} />
      {disabled ? <span className="bs-tool-note">纯文本模式只保留撤销与重做</span> : null}
    </div>
  )
}
