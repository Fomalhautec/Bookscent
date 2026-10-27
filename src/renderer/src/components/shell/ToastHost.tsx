import { type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useUi, type ToastKind } from '@/store/useUi'
import { IconCheck, IconClose, IconInfo, IconWand } from '@/components/icons/Icons'

function iconFor(kind: ToastKind): ReactNode {
  switch (kind) {
    case 'success':
      return <IconCheck size={15} />
    case 'warn':
      return <IconInfo size={15} />
    case 'error':
      return <IconClose size={15} />
    default:
      return <IconWand size={15} />
  }
}

export function ToastHost(): ReactNode {
  const toasts = useUi((s) => s.toasts)
  const dismiss = useUi((s) => s.dismiss)
  if (toasts.length === 0) return null
  return createPortal(
    <div className="toast-stack">
      {toasts.map((toast) => (
        <div className={['toast', `toast-${toast.kind}`].join(' ')} key={toast.id} role="status">
          <span className="toast-icon">{iconFor(toast.kind)}</span>
          <div className="toast-text">
            <div className="toast-title">{toast.title}</div>
            {toast.detail ? <div className="toast-detail">{toast.detail}</div> : null}
          </div>
          <button type="button" className="icon-btn" onClick={() => dismiss(toast.id)} aria-label="关闭提示">
            <IconClose size={13} />
          </button>
        </div>
      ))}
    </div>,
    document.body
  )
}
