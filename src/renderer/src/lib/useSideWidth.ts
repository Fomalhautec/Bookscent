import { useCallback, useEffect, useRef, useState } from 'react'
import { useSettings } from '@/store/useSettings'

/** 左右两侧栏的宽度范围：窄到看不出内容、宽到把正文挤没，都不合适 */
export const SIDE_WIDTH_RANGE = {
  left: { min: 180, max: 460, fallback: 240 },
  right: { min: 260, max: 720, fallback: 360 }
} as const

/**
 * 侧栏宽度：读设置、拖动时走本地状态、松手才落盘。
 *
 * 为什么要本地状态：拖一次会产生几十个 pointermove，
 * 每次都 `patch()` 会把 IPC 与磁盘写爆（设置文件是一整个 JSON）。
 * 所以拖动只改这里，`commit()` 才写。
 */
export function useSideWidth(kind: 'left' | 'right'): {
  width: number
  setWidth: (width: number) => void
  commit: (width: number) => void
  min: number
  max: number
} {
  const settings = useSettings((s) => s.settings)
  const patch = useSettings((s) => s.patch)
  const range = SIDE_WIDTH_RANGE[kind]
  const stored = (kind === 'left' ? settings?.ui.sideWidth : settings?.ui.translateWidth) ?? range.fallback
  const [width, setWidth] = useState(stored)
  /* 已经动过手之后，别让设置的异步回读把宽度拽回去 */
  const touched = useRef(false)

  useEffect(() => {
    if (!touched.current) setWidth(stored)
  }, [stored])

  const commit = useCallback(
    (next: number) => {
      touched.current = true
      const clamped = Math.round(Math.max(range.min, Math.min(range.max, next)))
      setWidth(clamped)
      if (!settings) return
      void patch({
        ui:
          kind === 'left'
            ? { ...settings.ui, sideWidth: clamped }
            : { ...settings.ui, translateWidth: clamped }
      })
    },
    [kind, patch, range.max, range.min, settings]
  )

  return { width, setWidth, commit, min: range.min, max: range.max }
}
