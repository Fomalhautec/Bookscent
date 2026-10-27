import type { Bookmark } from '@shared/types'
import { collectSectionText } from './textMarks'

/**
 * 在章节里把"加了书签的那段文字"标出来。
 *
 * 为什么这么做：EPUB 的书签锚点是 CFI，而 foliate 只提供"位置 → CFI"、
 * 不提供"CFI → 在哪一章"的反查，没法直接知道某个书签落在当前这一节。
 * 但我们存了那段摘录（`excerpt`），在当前章节的纯文本里找它就行 ——
 * 找到了就是"这个书签在这一页"，顺便正好有了可见的位置。
 *
 * 样式（`.epub-bm-mark`）跟高亮区分开：书签是"我在这存了个点"，
 * 高亮是"我把这句划出来了"，两者可以同时存在。
 */
const MARK_CLASS = 'epub-bm-mark'

/** 先清掉上一轮画的书签标记（切章、删书签都要重画） */
export function clearBookmarkMarks(doc: Document): void {
  for (const node of doc.querySelectorAll(`.${MARK_CLASS}`)) {
    const parent = node.parentNode
    if (!parent) continue
    while (node.firstChild) parent.insertBefore(node.firstChild, node)
    parent.removeChild(node)
    parent.normalize()
  }
}

/**
 * 把章节文本"压平"：连续空白算一个空格，并记住每个压平后的字符在原文里的下标。
 *
 * 为什么必须这样找：笔记的摘录是 `excerptOf()` 存下来的，它会把空白统一成普通空格；
 * 而章节原文里可能是**全角空格**（日文书里的「Introduction　Rain」就是），
 * JS 的 `\s` 认它，于是摘录变成半角空格，拿回原文 indexOf 就永远找不到 ——
 * 表现就是"记为笔记之后正文里没有标记"（老笔记也一样失效）。
 * 压平之后两边同一把尺子，再靠这张映射表换回原文下标去包标记。
 */
function flatten(text: string): { flat: string; map: number[] } {
  const map: number[] = []
  let flat = ''
  let pendingSpace = false
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    if (/\s/.test(char)) {
      if (flat.length > 0) pendingSpace = true
      continue
    }
    if (pendingSpace) {
      /* 插进来的这个空格指向刚跳过的那段空白，换回原文下标时落在空白里，安全 */
      map.push(index - 1)
      flat += ' '
    }
    pendingSpace = false
    map.push(index)
    flat += char
  }
  return { flat, map }
}

/**
 * 画书签标记。返回落在这一节里的书签数量（用来决定要不要显示页边色带）。
 */
export function applyBookmarkMarks(doc: Document, bookmarks: Bookmark[]): number {
  clearBookmarkMarks(doc)
  const withExcerpt = bookmarks.filter((bookmark) => (bookmark.excerpt ?? '').trim().length > 3)
  if (withExcerpt.length === 0) return 0

  const { text, nodes } = collectSectionText(doc)
  const { flat, map } = flatten(text)
  let hit = 0
  for (const bookmark of withExcerpt) {
    /* 摘录也压平一次：老记录里可能是别的空白写法 */
    const needle = flatten((bookmark.excerpt ?? '').trim()).flat
    if (needle.length === 0) continue
    const at = flat.indexOf(needle)
    if (at < 0) continue
    const from = map[at]
    const to = map[at + needle.length - 1] + 1
    if (from === undefined || to === undefined || to <= from) continue
    if (wrapRange(doc, nodes, from, to, bookmark)) hit += 1
  }
  return hit
}

/** 把 [from, to) 这段文本包一层书签标记；跨多个文本节点时逐段包 */
function wrapRange(
  doc: Document,
  nodes: Text[],
  from: number,
  to: number,
  bookmark: Bookmark
): boolean {
  const targets: { node: Text; start: number; end: number }[] = []
  let cursor = 0
  for (const node of nodes) {
    const nodeStart = cursor
    const nodeEnd = cursor + node.data.length
    cursor = nodeEnd
    if (nodeEnd <= from || nodeStart >= to) continue
    targets.push({
      node,
      start: Math.max(0, from - nodeStart),
      end: Math.min(node.data.length, to - nodeStart)
    })
  }
  if (targets.length === 0) return false

  let wrapped = 0
  /* 从后往前切，前面节点的偏移才不会失效 */
  for (const target of [...targets].reverse()) {
    const { node } = target
    if (target.end <= target.start) continue
    try {
      const head = node.splitText(target.start)
      if (target.end - target.start < head.data.length) head.splitText(target.end - target.start)
      const element = doc.createElement('span')
      element.className = MARK_CLASS
      element.dataset.bookmarkId = bookmark.id
      element.style.setProperty('--epub-bm-color', bookmark.color)
      element.title = bookmark.label
      head.parentNode?.insertBefore(element, head)
      element.appendChild(head)
      wrapped += 1
    } catch {
      /* 单个节点失败不影响其余 */
    }
  }
  return wrapped > 0
}

/** 书签标记的样式，跟着阅读样式一起注入章节 */
export function bookmarkMarkStyles(): string {
  return `
    .${MARK_CLASS} {
      /* 竖排书要靠逻辑属性：border-bottom 在竖排下只会落在最后一个字下面 */
      border-block-end: 2px solid var(--epub-bm-color, #c8553d) !important;
      background: color-mix(in srgb, var(--epub-bm-color, #c8553d) 12%, transparent) !important;
      border-radius: 2px;
      cursor: pointer;
    }
  `
}
