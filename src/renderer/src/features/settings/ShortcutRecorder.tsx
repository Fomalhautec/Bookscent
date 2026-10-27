import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Modal, Button } from '@/components/common/Controls'
import { normalizeKey } from '@shared/shortcuts'

/**
 * 快捷键录制窗。
 *
 * 为什么不用"点一下再随便按键"：那需要用户自己记住修饰键的写法，
 * 而且按错一次就没了参照（用户的原话是"建议弹出一个小窗口，其中包括控制键按键组合，
 * 可以点击选用，类似于 Windows 系统中的设置"）。所以这里做成**点选**：
 *   - 控制键：Ctrl / Alt / Shift / Meta 四个开关；
 *   - 按键：字母、数字、功能键、方向键、翻页键、常用符号，点一下就选上；
 *   - 下面实时显示组合结果；也可以直接按一次键盘组合（会同步到上面的选择）。
 * 确定后写回设置；「清空」= 禁用这个动作。
 */
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')
const DIGITS = '0123456789'.split('')
const FUNCTIONS = ['F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12']
const NAVIGATION = [
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'ArrowDown',
  'PageUp',
  'PageDown',
  'Home',
  'End',
  'Space',
  'Enter',
  'Tab',
  'Backspace',
  'Delete',
  'Escape'
]
const SYMBOLS = ['+', '-', '=', '_', ',', '.', '/', ';', "'", '[', ']', '`']

const MODIFIERS: { id: string; label: string }[] = [
  { id: 'Ctrl', label: 'Ctrl' },
  { id: 'Alt', label: 'Alt' },
  { id: 'Shift', label: 'Shift' },
  { id: 'Meta', label: 'Win / Cmd' }
]

/** 展示用：ArrowLeft → ←、PageDown → PgDn… */
function keyLabel(key: string): string {
  const map: Record<string, string> = {
    ArrowLeft: '←',
    ArrowRight: '→',
    ArrowUp: '↑',
    ArrowDown: '↓',
    Space: '空格',
    Enter: '回车',
    Tab: 'Tab',
    Backspace: '退格',
    Delete: 'Del',
    Escape: 'Esc',
    PageUp: 'PgUp',
    PageDown: 'PgDn',
    Home: 'Home',
    End: 'End'
  }
  return map[key] ?? key
}

export interface ShortcutRecorderProps {
  open: boolean
  /** 动作名，例如「下一屏（按阅读顺序）」 */
  label: string
  /** 当前生效的键（规范形式） */
  value: string[]
  onClose: () => void
  onConfirm: (key: string) => void
  /** 清空 = 禁用这个动作 */
  onDisable: () => void
}

export function ShortcutRecorder({
  open,
  label,
  value,
  onClose,
  onConfirm,
  onDisable
}: ShortcutRecorderProps): ReactNode {
  const [mods, setMods] = useState<string[]>([])
  const [key, setKey] = useState('')

  /* 每次打开都用当前值初始化，免得残留上一次的选择 */
  useEffect(() => {
    if (!open) return
    const first = value[0] ?? ''
    const parts = first.split('+')
    /* 末尾的空段说明主键就是 '+' 本身 */
    const base = parts[parts.length - 1] === '' ? '+' : parts[parts.length - 1]
    const rest = parts[parts.length - 1] === '' ? parts.slice(0, -2) : parts.slice(0, -1)
    setMods(rest.filter((part) => MODIFIERS.some((mod) => mod.id === part)))
    setKey(base)
  }, [open, value])

  const preview = useMemo(() => {
    const parts = mods.filter((mod) => MODIFIERS.some((item) => item.id === mod))
    if (!key) return parts.length > 0 ? `${parts.join('+')}+…` : '还没选按键'
    return normalizeKey([...parts, key].join('+'))
  }, [mods, key])

  const toggleMod = (id: string): void => {
    setMods((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]))
  }

  const group = (title: string, keys: string[]): ReactNode => (
    <div className="keys-group">
      <span className="keys-group-title">{title}</span>
      <div className="keys-grid">
        {keys.map((item) => (
          <button
            key={item}
            type="button"
            className={['keys-key', item === key ? 'is-active' : ''].filter(Boolean).join(' ')}
            onClick={() => setKey(item)}
          >
            {keyLabel(item)}
          </button>
        ))}
      </div>
    </div>
  )

  return (
    <Modal
      open={open}
      title={`设置快捷键 · ${label}`}
      subtitle="点选控制键与按键，或直接在下面按一次组合键；同一个界面里同一个键只能对应一个动作。"
      onClose={onClose}
      width={620}
      footer={
        <>
          <Button variant="subtle" onClick={onDisable}>
            清空（禁用）
          </Button>
          <span className="translate-spacer" />
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button variant="solid" disabled={!key} onClick={() => onConfirm(preview)}>
            确定
          </Button>
        </>
      }
    >
      <div className="keys-recorder">
        <div className="keys-preview">
          <span className="keys-preview-label">当前组合</span>
          <code className="keys-preview-value">{preview}</code>
        </div>

        <div className="keys-mods">
          {MODIFIERS.map((mod) => (
            <button
              key={mod.id}
              type="button"
              className={['keys-mod', mods.includes(mod.id) ? 'is-active' : ''].filter(Boolean).join(' ')}
              onClick={() => toggleMod(mod.id)}
            >
              {mod.label}
            </button>
          ))}
          <span className="keys-hint">直接按键盘组合也可以：</span>
          <input
            className="text-input keys-capture-input"
            value=""
            readOnly
            placeholder="在这里按一次"
            onKeyDown={(event) => {
              event.preventDefault()
              const parts: string[] = []
              if (event.ctrlKey) parts.push('Ctrl')
              if (event.altKey) parts.push('Alt')
              if (event.shiftKey) parts.push('Shift')
              if (event.metaKey) parts.push('Meta')
              const raw = event.key
              if (['Control', 'Alt', 'Shift', 'Meta'].includes(raw)) {
                setMods(parts)
                return
              }
              const base = raw === ' ' ? 'Space' : raw.length === 1 ? raw.toUpperCase() : raw
              setMods(parts)
              setKey(base)
            }}
          />
        </div>

        {group('字母', LETTERS)}
        {group('数字', DIGITS)}
        {group('功能键', FUNCTIONS)}
        {group('方向与翻页', NAVIGATION)}
        {group('符号', SYMBOLS)}
      </div>
    </Modal>
  )
}
