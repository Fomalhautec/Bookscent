/**
 * 少量 DOM 工具：元素尺寸观察、设备像素比、渲染任务取消兼容层。
 */

import { useCallback, useEffect, useState } from 'react'

/** 页面之间的纵向间距（连续滚动模式） */
export const PAGE_GAP = 18

export function getPixelRatio(): number {
  const raw = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1
  // 上限 2：再高对 PDF 文本的清晰度提升有限，内存与耗时却是平方增长
  return Math.max(1, Math.min(2, raw))
}

export interface ElementRef<T extends HTMLElement> {
  /** 挂到 JSX 的 ref 上 */
  ref: (node: T | null) => void
  /** 当前节点，可能在首次渲染后才有值 —— 用 state 是为了让依赖它的 effect 能重跑 */
  node: T | null
}

/**
 * 用回调 ref + state 保存元素，这样元素一挂载就会触发一次重渲染，
 * 依赖它的 effect（尺寸观察、滚动定位）才能正确拿到节点。
 */
export function useElementRef<T extends HTMLElement>(): ElementRef<T> {
  const [node, setNode] = useState<T | null>(null)
  const ref = useCallback((next: T | null) => setNode(next), [])
  return { ref, node }
}

/** 观察元素尺寸变化（ResizeObserver 包装） */
export function useElementSize<T extends HTMLElement>(
  node: T | null
): { width: number; height: number } {
  const [size, setSize] = useState({ width: 0, height: 0 })

  useEffect(() => {
    if (!node) return
    const push = (): void => {
      const rect = node.getBoundingClientRect()
      setSize((current) =>
        current.width === Math.round(rect.width) && current.height === Math.round(rect.height)
          ? current
          : { width: Math.round(rect.width), height: Math.round(rect.height) }
      )
    }
    push()
    const observer = new ResizeObserver(push)
    observer.observe(node)
    return () => observer.disconnect()
  }, [node])

  return size
}

/** pdfjs 的 RenderTask.promise 被取消时会 reject，这里统一吞掉取消错误 */
export async function ignoreCancelled(promise: Promise<unknown>): Promise<void> {
  try {
    await promise
  } catch (error) {
    const name = (error as { name?: string } | null)?.name ?? ''
    if (name === 'RenderingCancelledException') return
    if (/cancel/i.test((error as { message?: string } | null)?.message ?? '')) return
    throw error
  }
}
