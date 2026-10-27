import type { BookmarkAnchor } from '@shared/types'

/**
 * 滚动型阅读器的书签锚点。
 *
 * 网页、Word、图片、纯文本预览这些没有可靠页码的格式，
 * 只能记"滚到了整篇的百分之几"。文本类的页码是按字数估的，
 * 换个字号就变了，所以书签里存比例、由阅读器自己换算。
 */
export function ratioOf(element: HTMLElement | null): number | null {
  if (!element) return null
  const max = element.scrollHeight - element.clientHeight
  if (max <= 4) return 0 // 一屏就放得下：位置恒为开头
  return Math.max(0, Math.min(1, element.scrollTop / max))
}

export function scrollToRatio(element: HTMLElement | null, ratio: number): void {
  if (!element) return
  const max = element.scrollHeight - element.clientHeight
  element.scrollTop = Math.max(0, Math.min(1, ratio)) * Math.max(0, max)
}

/** 给滚动型阅读器用的锚点与跳转 */
export function scrollAnchor(element: HTMLElement | null): BookmarkAnchor | null {
  const ratio = ratioOf(element)
  return ratio === null ? null : { kind: 'scroll', ratio }
}

export function goToScrollAnchor(element: HTMLElement | null, anchor: BookmarkAnchor): void {
  if (anchor.kind === 'scroll') scrollToRatio(element, anchor.ratio)
}
