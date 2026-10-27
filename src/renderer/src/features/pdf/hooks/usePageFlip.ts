/**
 * 左右翻页（flip）模式的翻页动画状态机。
 *
 * 四个约定：
 *  1. 「当前是哪一页」永远由 useViewerState 决定，动画只是画面。
 *     所以无论动画怎么被打断，阅读器最后一定停在正确的那一页上。
 *  2. 一次翻页渲染两叠纸：outgoing（旧的那一叠）与 incoming（新的那一叠）。
 *     双页模式下每一叠是一个跨页 —— 动画的单位是「跨页」，不是单页。
 *     起始状态挂在 .is-flipping 上，下一帧切到 .is-running 才真正开始过渡 ——
 *     这样过渡才会从起点跑到终点，而不是「已经在终点、又跳一次」。
 *  3. 落点页由 resolveTarget 决定（双页模式下要跨过两页），
 *     动画的 from / to 记的是「页码」，由调用方换算成跨页。
 *  4. 动画没播完就又翻页时：丢掉上一段动画，直接以新页为起点重开，绝不排队。
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { PageFlipAnimation } from '@shared/types'
import { FLIP_DURATION_MS } from '@/features/reader/pageFlip'

export type FlipDirection = 'next' | 'prev'

export interface FlipState {
  /** 动画开始前显示的那一页 */
  from: number
  /** 动画结束后要停的那一页（等于当前的 currentPage） */
  to: number
  dir: FlipDirection
}

export interface PageFlipController {
  /** 正在播放的翻页动画；null 表示静止 */
  flip: FlipState | null
  /** 过渡是否已经从「起始状态」切到「结束状态」 */
  running: boolean
  /** 动画时长（毫秒）；0 表示这一档不播放动画 */
  durationMs: number
  /** 翻一页（双页模式下是翻一个跨页）：delta 为 +1 / -1；首尾到头是空操作，不循环 */
  turn: (delta: 1 | -1) => void
  /** 立刻把动画收干净（切模式、跳页时用） */
  cancel: () => void
  /** 挂到翻页舞台元素上，用来强制一次布局（让过渡从起点开始） */
  stageRef: (node: HTMLDivElement | null) => void
}

/** 动画结束后多留一点时间再卸掉旧页，免得过渡被提前掐断 */
const FLIP_SETTLE_MS = 60

export function usePageFlip(options: {
  /** 是否处于左右翻页模式 */
  active: boolean
  currentPage: number
  pageCount: number
  goToPage: (page: number) => void
  animation: PageFlipAnimation
  /** 对应 ui.animate，关掉后一律不播动画 */
  animate: boolean
  /**
   * 由「当前页 + 方向」算出落点页。双页跨页模式下翻一次要跨过两页（一个跨页），
   * 所以落点不能简单地 ±1。返回当前页即表示已经到头，不播放动画。
   * 缺省是单页的 ±1。
   */
  resolveTarget?: (currentPage: number, delta: 1 | -1) => number
}): PageFlipController {
  const { active, currentPage, pageCount, goToPage, animation, animate, resolveTarget } = options
  const durationMs = active && animate && animation !== 'none' ? FLIP_DURATION_MS : 0

  const [flip, setFlip] = useState<FlipState | null>(null)
  const [running, setRunning] = useState(false)
  const stage = useRef<HTMLDivElement | null>(null)
  const timer = useRef<number | null>(null)
  const frame = useRef<number | null>(null)

  const stageRef = useCallback((node: HTMLDivElement | null): void => {
    stage.current = node
  }, [])

  const clearPending = useCallback((): void => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current)
      timer.current = null
    }
    if (frame.current !== null) {
      window.cancelAnimationFrame(frame.current)
      frame.current = null
    }
  }, [])

  const cancel = useCallback((): void => {
    clearPending()
    setFlip(null)
    setRunning(false)
  }, [clearPending])

  const turn = useCallback(
    (delta: 1 | -1): void => {
      const last = Math.max(1, pageCount)
      const fallback = Math.min(Math.max(currentPage + delta, 1), last)
      // 落点由调用方决定（单页是 ±1，双页是 ±一个跨页）；夹一下防止越界
      const raw = resolveTarget ? resolveTarget(currentPage, delta) : fallback
      const to = Math.min(Math.max(Math.round(raw), 1), last)
      // 越过第一页 / 最后一页就是空操作，绝不绕回另一端
      if (to === currentPage) return
      const from = currentPage
      goToPage(to)
      clearPending()
      if (durationMs <= 0) {
        setFlip(null)
        setRunning(false)
        return
      }
      // 上一段动画还没落定：先回到静止态，再以新页为起点重开
      setRunning(false)
      setFlip({ from, to, dir: delta > 0 ? 'next' : 'prev' })
      frame.current = window.requestAnimationFrame(() => {
        frame.current = null
        // 读一次布局，逼浏览器先提交「起始状态」，过渡才会真的从起点开始
        void stage.current?.offsetHeight
        setRunning(true)
      })
      timer.current = window.setTimeout(() => {
        timer.current = null
        setFlip(null)
        setRunning(false)
      }, durationMs + FLIP_SETTLE_MS)
    },
    [clearPending, currentPage, durationMs, goToPage, pageCount, resolveTarget]
  )

  // 退出左右翻页、或者把动画关掉时，立刻收干净
  useEffect(() => {
    if (!active || durationMs <= 0) cancel()
  }, [active, durationMs, cancel])

  // 卸载时清掉定时器与待执行的帧
  useEffect(() => clearPending, [clearPending])

  return { flip, running, durationMs, turn, cancel, stageRef }
}
