import { useEffect, useRef } from 'react'
import type { BookmarkAnchor } from '@shared/types'

/**
 * 当前阅读器向外暴露的"书签锚点"能力。
 *
 * 为什么要这么一层：书香笔记支持 PDF / EPUB / Markdown / 纯文本 / Word / 网页 / 图片，
 * 每种格式能定位的方式都不一样（页码、EPUB CFI、滚动比例），
 * 而"加书签"这个动作在界面上只应该有一个入口（阅读器顶栏那颗按钮 + Ctrl+B）。
 *
 * 所以让**正在打开的那个阅读器**注册这三个函数，顶栏只管调：
 *   - `anchor()`    取当前位置，返回 null 表示这个格式暂时不支持
 *   - `goTo(anchor)` 跳到某个书签
 *   - `describe()`  取当前位置的页码/描述/摘录，用来给书签起名
 */
export interface BookmarkTarget {
  anchor: () => BookmarkAnchor | null
  goTo: (anchor: BookmarkAnchor) => void
  describe: () => { page: number; label: string; excerpt?: string }
}

let current: BookmarkTarget | null = null

export function registerBookmarkTarget(target: BookmarkTarget | null): void {
  current = target
}

export function getBookmarkTarget(): BookmarkTarget | null {
  return current
}

/**
 * 在阅读器组件里挂上自己的能力。
 *
 * 用 ref 记住最新一份：阅读器的位置每翻一页都在变，
 * 但注册只发生一次，闭包里拿不到新值。
 */
export function useBookmarkTarget(target: BookmarkTarget): void {
  const latest = useRef(target)
  latest.current = target

  useEffect(() => {
    registerBookmarkTarget({
      anchor: () => latest.current.anchor(),
      goTo: (anchor) => latest.current.goTo(anchor),
      describe: () => latest.current.describe()
    })
    return () => registerBookmarkTarget(null)
  }, [])
}

/* --------------------------------------------------------------- 小工具 */

/** 把任意路径的一节文本截成好看的摘录 */
export function excerptOf(text: string, max = 60): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max)}…` : flat
}

/** 书签该跳到哪：优先用锚点，老记录只有页码 */
export function pageOfAnchor(anchor: BookmarkAnchor | undefined, fallbackPage: number): number {
  if (!anchor) return fallbackPage
  if (anchor.kind === 'page') return anchor.page
  return fallbackPage
}

/**
 * 两个锚点算不算"同一个位置"。
 *
 * 用来在书签列表里标出当前所在的那一条。
 * 比例类的允许一点误差：滚动位置很难精确回到同一像素，
 * 要求完全相等的话高亮永远不亮。
 */
export function sameAnchor(a: BookmarkAnchor | null | undefined, b: BookmarkAnchor | null | undefined): boolean {
  if (!a || !b) return false
  if (a.kind === 'page' && b.kind === 'page') return a.page === b.page
  if (a.kind === 'line' && b.kind === 'line') return a.line === b.line
  if (a.kind === 'cfi' && b.kind === 'cfi') {
    return a.cfi === b.cfi || Math.abs(a.fraction - b.fraction) < 0.004
  }
  if (a.kind === 'scroll' && b.kind === 'scroll') return Math.abs(a.ratio - b.ratio) < 0.01
  return false
}

/** 书签列表右侧那行小字：各格式能拿到的信息不一样 */
export function metaOfAnchor(anchor: BookmarkAnchor | undefined, page: number): string {
  if (!anchor) return `第 ${page} 页`
  if (anchor.kind === 'page') return `第 ${anchor.page} 页`
  if (anchor.kind === 'line') return `第 ${anchor.line + 1} 行`
  if (anchor.kind === 'cfi') return `第 ${Math.round(anchor.fraction * 100)}%`
  return `第 ${Math.round(anchor.ratio * 100)}% 处`
}
