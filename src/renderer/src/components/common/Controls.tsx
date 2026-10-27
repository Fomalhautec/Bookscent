import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes
} from 'react'
import { createPortal } from 'react-dom'
import { IconCheck, IconChevronDown, IconClose } from '@/components/icons/Icons'

/* --------------------------------------------------------------- Button */

type ButtonVariant = 'solid' | 'outline' | 'ghost' | 'subtle' | 'danger'
type ButtonSize = 'xs' | 'sm' | 'md' | 'lg'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  icon?: ReactNode
  trailing?: ReactNode
  active?: boolean
  block?: boolean
}

export function Button({
  variant = 'ghost',
  size = 'sm',
  icon,
  trailing,
  active,
  block,
  className,
  children,
  ...rest
}: ButtonProps): ReactNode {
  return (
    <button
      type="button"
      className={[
        'btn',
        `btn-${variant}`,
        `btn-${size}`,
        active ? 'is-active' : '',
        block ? 'is-block' : '',
        className ?? ''
      ]
        .filter(Boolean)
        .join(' ')}
      {...rest}
    >
      {icon ? <span className="btn-icon">{icon}</span> : null}
      {children ? <span className="btn-label">{children}</span> : null}
      {trailing ? <span className="btn-trailing">{trailing}</span> : null}
    </button>
  )
}

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string
  size?: number
  variant?: ButtonVariant
  active?: boolean
  tone?: 'default' | 'muted'
}

export function IconButton({
  label,
  variant = 'ghost',
  active,
  tone = 'default',
  className,
  children,
  ...rest
}: IconButtonProps): ReactNode {
  return (
    <button
      type="button"
      className={['icon-btn', `btn-${variant}`, active ? 'is-active' : '', `tone-${tone}`, className ?? '']
        .filter(Boolean)
        .join(' ')}
      title={label}
      aria-label={label}
      {...rest}
    >
      {children}
      <span className="sr-only">{label}</span>
    </button>
  )
}

/* ---------------------------------------------------------------- Field */

export function Field({
  label,
  hint,
  children,
  inline,
  htmlFor
}: {
  label?: ReactNode
  hint?: ReactNode
  children: ReactNode
  inline?: boolean
  htmlFor?: string
}): ReactNode {
  return (
    <div className={['field', inline ? 'is-inline' : ''].filter(Boolean).join(' ')}>
      {label ? (
        <label className="field-label" htmlFor={htmlFor}>
          {label}
        </label>
      ) : null}
      <div className="field-body">{children}</div>
      {hint ? <p className="field-hint">{hint}</p> : null}
    </div>
  )
}

export function SectionTitle({
  children,
  action,
  hint
}: {
  children: ReactNode
  action?: ReactNode
  hint?: ReactNode
}): ReactNode {
  return (
    <div className="section-title">
      <div className="section-title-main">
        <h3>{children}</h3>
        {hint ? <p>{hint}</p> : null}
      </div>
      {action ? <div className="section-title-action">{action}</div> : null}
    </div>
  )
}

/* --------------------------------------------------------------- Inputs */

export function TextInput({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>): ReactNode {
  return <input className={['text-input', className ?? ''].filter(Boolean).join(' ')} {...rest} />
}

export function TextArea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>): ReactNode {
  return <textarea className={['text-input', 'text-area', className ?? ''].filter(Boolean).join(' ')} {...rest} />
}

export interface Option<T extends string = string> {
  value: T
  label: string
  hint?: string
  disabled?: boolean
}

export function Select<T extends string = string>({
  value,
  onChange,
  options,
  className,
  ...rest
}: {
  value: T
  onChange: (value: T) => void
  options: Option<T>[]
  className?: string
} & Omit<SelectHTMLAttributes<HTMLSelectElement>, 'value' | 'onChange'>): ReactNode {
  return (
    <div className={['select-wrap', className ?? ''].filter(Boolean).join(' ')}>
      <select
        className="select"
        value={value}
        onChange={(event) => onChange(event.target.value as T)}
        {...rest}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value} disabled={option.disabled}>
            {option.label}
          </option>
        ))}
      </select>
      <IconChevronDown size={14} className="select-caret" />
    </div>
  )
}

export function Switch({
  checked,
  onChange,
  label,
  disabled
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  label?: ReactNode
  disabled?: boolean
}): ReactNode {
  const id = useId()
  return (
    <div className={['switch-row', disabled ? 'is-disabled' : ''].filter(Boolean).join(' ')}>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        className={['switch', checked ? 'is-on' : ''].filter(Boolean).join(' ')}
        onClick={() => !disabled && onChange(!checked)}
        disabled={disabled}
      >
        <span className="switch-knob" />
      </button>
      {label ? (
        <label className="switch-label" htmlFor={id}>
          {label}
        </label>
      ) : null}
    </div>
  )
}

export interface SliderProps {
  value: number
  min: number
  max: number
  step?: number
  onChange: (value: number) => void
  format?: (value: number) => string
  /** 滑杆右侧的可输入数值框，默认开启（拖动只能看个大概，输入才能精确定值） */
  input?: boolean
  /** 数值框后面的单位；不给就从 format 推（例如 " px"、"°"、"×"） */
  unit?: string
  /** 数值框的无障碍名称 */
  ariaLabel?: string
}

/** 收掉浮点噪音（0.30000000000000004 → 0.3），但不做 step 取整，免得把非整格的存量值显示错 */
function tidyNumber(value: number): number {
  return Number(value.toFixed(6))
}

function formatNumber(value: number): string {
  return String(tidyNumber(value))
}

/** 吸附到 min + k * step 的格子上；不截断 min 自身的精度 */
function snapToStep(value: number, min: number, step: number): number {
  if (!(step > 0)) return tidyNumber(value)
  return tidyNumber(min + Math.round((value - min) / step) * step)
}

/** 容忍用户输入 " 16 "、"1,5" 这类写法：逗号当小数点，其余只留数字、小数点、正负号和 e */
function parseInput(raw: string): number {
  return Number.parseFloat(raw.replace(',', '.').replace(/[^\d.eE+-]/g, ''))
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/**
 * 数值框后面的尾巴：
 *  - format(value) 与 value 同刻度时，那截尾巴就是单位（" px"、"°"、"×"）；
 *  - 刻度不同（0.5 → "100%"、24 → "2.4"）时不能把 "%"/"2.4" 直接挂在输入框后面骗人，
 *    于是原样显示整段格式化文本，让人一眼看出输入框里的数与界面显示的关系；
 *  - 纯文字（"整齐"、"不限"）同理原样显示。
 */
function suffixOf(format: ((value: number) => string) | undefined, value: number): string {
  if (!format) return ''
  const text = format(value).trim()
  const match = /^(-?\d+(?:\.\d+)?)\s*(.*)$/.exec(text)
  if (!match) return text
  const parsed = Number.parseFloat(match[1])
  const epsilon = Math.max(1e-9, Math.abs(value) * 1e-9)
  if (Math.abs(parsed - value) <= epsilon) return match[2]
  return match[2] ? text : ''
}

export function Slider({
  value,
  min,
  max,
  step = 1,
  onChange,
  format,
  input = true,
  unit,
  ariaLabel
}: SliderProps): ReactNode {
  // draft 只在输入框里非 null：没在输入时输入框一直跟着 value 走
  const [draft, setDraft] = useState<string | null>(null)
  // Esc 撤销后紧接着的 blur 不该再把输入内容提交上去
  const skipBlur = useRef(false)

  const commit = (raw: string): void => {
    setDraft(null)
    const parsed = parseInput(raw)
    if (!Number.isFinite(parsed)) return
    const next = clampNumber(snapToStep(parsed, min, step), min, max)
    if (next !== value) onChange(next)
  }

  const nudge = (direction: 1 | -1): void => {
    const typed = draft === null ? Number.NaN : parseInput(draft)
    const base = Number.isFinite(typed) ? typed : value
    setDraft(null)
    const next = clampNumber(snapToStep(base + direction * step, min, step), min, max)
    if (next !== value) onChange(next)
  }

  const suffix = input ? unit ?? suffixOf(format, value) : ''

  return (
    <div className="slider-row">
      <input
        className="slider"
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => {
          // 拖滑杆时丢掉输入框里没提交的草稿，避免两边显示不一致
          setDraft(null)
          onChange(Number(event.target.value))
        }}
        style={{ ['--fill' as string]: `${((value - min) / (max - min)) * 100}%` }}
      />
      {input ? (
        <>
          <input
            className="slider-input"
            type="text"
            inputMode="decimal"
            role="spinbutton"
            aria-label={ariaLabel ?? '数值'}
            aria-valuenow={value}
            aria-valuemin={min}
            aria-valuemax={max}
            spellCheck={false}
            value={draft ?? formatNumber(value)}
            onFocus={(event) => {
              setDraft(formatNumber(value))
              event.currentTarget.select()
            }}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={(event) => {
              if (skipBlur.current) {
                skipBlur.current = false
                return
              }
              commit(event.currentTarget.value)
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                commit(event.currentTarget.value)
              } else if (event.key === 'Escape') {
                event.preventDefault()
                skipBlur.current = true
                setDraft(null)
                event.currentTarget.blur()
              } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
                event.preventDefault()
                nudge(event.key === 'ArrowUp' ? 1 : -1)
              }
            }}
          />
          {suffix ? <span className="slider-unit">{suffix}</span> : null}
        </>
      ) : (
        <span className="slider-value">{format ? format(value) : value}</span>
      )}
    </div>
  )
}

export function ColorInput({
  value,
  onChange,
  label
}: {
  value: string
  onChange: (value: string) => void
  label?: string
}): ReactNode {
  const [text, setText] = useState(value)
  useEffect(() => setText(value), [value])
  const commit = useCallback(
    (next: string) => {
      setText(next)
      if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(next.trim()) || /^rgba?\(/i.test(next.trim())) {
        onChange(next.trim())
      }
    },
    [onChange]
  )
  const isTransparent = value.startsWith('rgba') || value.startsWith('rgb')
  return (
    <div className="color-input">
      <label className="color-swatch" title={label ?? value}>
        <span className="color-swatch-fill" style={{ background: value }} />
        {isTransparent ? <span className="color-swatch-alpha" /> : null}
        <input
          type="color"
          value={toHex(value)}
          onChange={(event) => onChange(event.target.value)}
          aria-label={label ?? '颜色'}
        />
      </label>
      <input
        className="color-text"
        value={text}
        onChange={(event) => commit(event.target.value)}
        spellCheck={false}
      />
    </div>
  )
}

function toHex(value: string): string {
  if (value.startsWith('#')) {
    const h = value.slice(1)
    if (h.length === 3) return `#${h.split('').map((c) => c + c).join('')}`
    if (h.length >= 6) return `#${h.slice(0, 6)}`
  }
  const m = value.match(/rgba?\(([^)]+)\)/)
  if (m) {
    const [r, g, b] = m[1].split(',').map((p) => Number.parseInt(p.trim(), 10))
    const p = (v: number): string => Math.max(0, Math.min(255, v || 0)).toString(16).padStart(2, '0')
    return `#${p(r)}${p(g)}${p(b)}`
  }
  return '#000000'
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  size = 'sm'
}: {
  value: T
  onChange: (value: T) => void
  options: { value: T; label: ReactNode; title?: string }[]
  size?: 'sm' | 'md'
}): ReactNode {
  return (
    <div className={['segmented', `segmented-${size}`].join(' ')} role="tablist">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="tab"
          aria-selected={option.value === value}
          title={option.title}
          className={['segmented-item', option.value === value ? 'is-active' : ''].filter(Boolean).join(' ')}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

export function Chip({
  children,
  active,
  onClick,
  onRemove,
  title
}: {
  children: ReactNode
  active?: boolean
  onClick?: () => void
  onRemove?: () => void
  title?: string
}): ReactNode {
  return (
    <span className={['chip', active ? 'is-active' : ''].filter(Boolean).join(' ')} title={title}>
      <button type="button" className="chip-main" onClick={onClick}>
        {children}
      </button>
      {onRemove ? (
        <button type="button" className="chip-remove" onClick={onRemove} aria-label="移除">
          <IconClose size={11} />
        </button>
      ) : null}
    </span>
  )
}

/* ---------------------------------------------------------------- Modal */

export function Modal({
  open,
  title,
  subtitle,
  onClose,
  children,
  footer,
  width = 560,
  className
}: {
  open: boolean
  title: ReactNode
  subtitle?: ReactNode
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  width?: number
  className?: string
}): ReactNode {
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [open, onClose])

  if (!open) return null
  return createPortal(
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className={['modal', className ?? ''].filter(Boolean).join(' ')} style={{ width }} role="dialog">
        <header className="modal-head">
          <div>
            <h2>{title}</h2>
            {subtitle ? <p className="modal-subtitle">{subtitle}</p> : null}
          </div>
          <IconButton label="关闭" onClick={onClose}>
            <IconClose size={16} />
          </IconButton>
        </header>
        <div className="modal-body">{children}</div>
        {footer ? <footer className="modal-foot">{footer}</footer> : null}
      </div>
    </div>,
    document.body
  )
}

export function Drawer({
  open,
  title,
  subtitle,
  onClose,
  children,
  footer,
  width = 420,
  side = 'right'
}: {
  open: boolean
  title: ReactNode
  subtitle?: ReactNode
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  width?: number
  side?: 'right' | 'left'
}): ReactNode {
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null
  return createPortal(
    <div className="drawer-layer">
      <div className="drawer-scrim" onClick={onClose} />
      <aside className={`drawer drawer-${side}`} style={{ width }}>
        <header className="drawer-head">
          <div>
            <h2>{title}</h2>
            {subtitle ? <p className="drawer-subtitle">{subtitle}</p> : null}
          </div>
          <IconButton label="关闭" onClick={onClose}>
            <IconClose size={16} />
          </IconButton>
        </header>
        <div className="drawer-body">{children}</div>
        {footer ? <footer className="drawer-foot">{footer}</footer> : null}
      </aside>
    </div>,
    document.body
  )
}

/* --------------------------------------------------------------- 小工具 */

export function Tooltip({ label, children }: { label: string; children: ReactNode }): ReactNode {
  const [visible, setVisible] = useState(false)
  const timer = useRef<number | null>(null)
  const show = (): void => {
    if (timer.current) window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setVisible(true), 380)
  }
  const hide = (): void => {
    if (timer.current) window.clearTimeout(timer.current)
    setVisible(false)
  }
  return (
    <span className="tooltip-host" onMouseEnter={show} onMouseLeave={hide} onMouseDown={hide}>
      {children}
      {visible ? <span className="tooltip-bubble">{label}</span> : null}
    </span>
  )
}

export function Spinner({ size = 18 }: { size?: number }): ReactNode {
  return <span className="spinner" style={{ width: size, height: size }} />
}

export function ProgressBar({ value, max }: { value: number; max: number }): ReactNode {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0
  return (
    <div className="progress" role="progressbar" aria-valuenow={pct}>
      <div className="progress-fill" style={{ width: `${pct}%` }} />
    </div>
  )
}

export function EmptyState({
  icon,
  title,
  detail,
  action
}: {
  icon?: ReactNode
  title: ReactNode
  detail?: ReactNode
  action?: ReactNode
}): ReactNode {
  return (
    <div className="empty-state">
      {icon ? <div className="empty-icon">{icon}</div> : null}
      <h3>{title}</h3>
      {detail ? <p>{detail}</p> : null}
      {action ? <div className="empty-action">{action}</div> : null}
    </div>
  )
}

export function CheckRow({
  checked,
  onChange,
  label,
  detail
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  label: ReactNode
  detail?: ReactNode
}): ReactNode {
  return (
    <button
      type="button"
      className={['check-row', checked ? 'is-checked' : ''].filter(Boolean).join(' ')}
      onClick={() => onChange(!checked)}
    >
      <span className="check-box">{checked ? <IconCheck size={12} /> : null}</span>
      <span className="check-text">
        <span className="check-label">{label}</span>
        {detail ? <span className="check-detail">{detail}</span> : null}
      </span>
    </button>
  )
}
