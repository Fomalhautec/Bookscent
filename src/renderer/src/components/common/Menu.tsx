import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { IconChevronDown } from '@/components/icons/Icons'

export interface MenuItem {
  id: string
  label: string
  icon?: ReactNode
  hint?: string
  danger?: boolean
  disabled?: boolean
  checked?: boolean
  onSelect: () => void
}

export type MenuEntry = MenuItem | { separator: true }

export function MenuButton({
  label,
  icon,
  items,
  variant = 'ghost',
  size = 'sm',
  active,
  block,
  align = 'right',
  title
}: {
  label?: ReactNode
  icon?: ReactNode
  items: MenuEntry[]
  variant?: 'solid' | 'outline' | 'ghost' | 'subtle' | 'danger'
  size?: 'xs' | 'sm' | 'md' | 'lg'
  active?: boolean
  block?: boolean
  align?: 'left' | 'right'
  title?: string
}): ReactNode {
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState({ left: 0, top: 0 })
  const anchor = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    const place = (): void => {
      const rect = anchor.current?.getBoundingClientRect()
      if (!rect) return
      const width = 240
      const left = align === 'right' ? Math.min(rect.right - width, window.innerWidth - width - 8) : rect.left
      setPosition({ left: Math.max(8, left), top: rect.bottom + 6 })
    }
    place()
    const close = (): void => setOpen(false)
    window.addEventListener('resize', close)
    window.addEventListener('scroll', close, true)
    window.addEventListener('blur', close)
    return () => {
      window.removeEventListener('resize', close)
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('blur', close)
    }
  }, [open, align])

  useEffect(() => {
    if (!open) return
    const onDown = (event: MouseEvent): void => {
      if (anchor.current?.contains(event.target as Node)) return
      setOpen(false)
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <>
      <button
        ref={anchor}
        type="button"
        title={title}
        className={['btn', `btn-${variant}`, `btn-${size}`, active || open ? 'is-active' : '', block ? 'is-block' : '']
          .filter(Boolean)
          .join(' ')}
        onClick={() => setOpen((value) => !value)}
      >
        {icon ? <span className="btn-icon">{icon}</span> : null}
        {label ? <span className="btn-label">{label}</span> : null}
        <span className="btn-trailing">
          <IconChevronDown size={13} />
        </span>
      </button>
      {open
        ? createPortal(
            <div
              className="context-menu menu-popup"
              style={{ left: position.left, top: position.top, minWidth: 240 }}
              onMouseDown={(event) => event.stopPropagation()}
            >
              {items.map((entry, i) =>
                'separator' in entry ? (
                  <div className="context-sep" key={`sep-${i}`} />
                ) : (
                  <button
                    key={entry.id}
                    type="button"
                    disabled={entry.disabled}
                    className={['context-item', entry.danger ? 'is-danger' : ''].filter(Boolean).join(' ')}
                    onClick={() => {
                      setOpen(false)
                      entry.onSelect()
                    }}
                  >
                    {entry.icon ? <span className="menu-item-icon">{entry.icon}</span> : null}
                    <span className="menu-item-label">{entry.label}</span>
                    {entry.hint ? <span className="menu-item-hint">{entry.hint}</span> : null}
                    {entry.checked ? <span className="menu-item-check">✓</span> : null}
                  </button>
                )
              )}
            </div>,
            document.body
          )
        : null}
    </>
  )
}
