import type { ReactNode } from 'react'
import { Button, Modal } from './Controls'

export interface ConfirmModalProps {
  open: boolean
  title: string
  message: ReactNode
  detail?: ReactNode
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
  onConfirm: () => void
  onCancel: () => void
}

/**
 * 应用内的确认弹窗。
 *
 * 不用 Electron 的原生 dialog：原生窗口不在 DOM 里，既跟不上主题，
 * 也没法在自动化验证里截图核对。
 */
export function ConfirmModal({
  open,
  title,
  message,
  detail,
  confirmLabel = '确定',
  cancelLabel = '取消',
  danger,
  onConfirm,
  onCancel
}: ConfirmModalProps): ReactNode {
  return (
    <Modal
      open={open}
      title={title}
      onClose={onCancel}
      width={480}
      className="confirm-modal"
      footer={
        <>
          <Button variant="ghost" onClick={onCancel}>
            {cancelLabel}
          </Button>
          <Button variant={danger ? 'danger' : 'solid'} onClick={onConfirm} data-confirm="1">
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="confirm-body">
        <p className="confirm-message">{message}</p>
        {detail ? <p className="confirm-detail">{detail}</p> : null}
      </div>
    </Modal>
  )
}
