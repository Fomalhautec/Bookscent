import { useEffect, useState, type ReactNode } from 'react'
import { Button, Modal, TextInput } from '@/components/common/Controls'

/**
 * 命名用的轻量弹窗：Electron 渲染进程没有可用的 window.prompt，
 * 所以所有"起个名字"都走这个组件。
 */
export function NamePrompt({
  open,
  title,
  subtitle,
  placeholder,
  initial = '',
  submitLabel = '保存',
  onSubmit,
  onClose
}: {
  open: boolean
  title: string
  subtitle?: string
  placeholder?: string
  initial?: string
  submitLabel?: string
  onSubmit: (name: string) => void | Promise<void>
  onClose: () => void
}): ReactNode {
  const [name, setName] = useState(initial)

  useEffect(() => {
    if (open) setName(initial)
  }, [open, initial])

  const submit = (): void => {
    const value = name.trim()
    if (!value) return
    void onSubmit(value)
    onClose()
  }

  return (
    <Modal
      open={open}
      title={title}
      subtitle={subtitle}
      onClose={onClose}
      width={420}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            取消
          </Button>
          <Button variant="solid" onClick={submit} disabled={!name.trim()}>
            {submitLabel}
          </Button>
        </>
      }
    >
      <TextInput
        autoFocus
        value={name}
        placeholder={placeholder}
        onChange={(event) => setName(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') submit()
        }}
      />
    </Modal>
  )
}
