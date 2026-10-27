import type { TextHighlight, TextMarkStyle } from '@shared/types'

/**
 * EPUB 正文的文字标注（高亮 / 划线）。
 *
 * 定位：**章节下标 + 该章节正文纯文本的起止偏移**。
 *
 * 为什么不用 CFI：foliate 的 View 只稳定提供"从 Range 生成 CFI"，反过来的
 * "CFI → Range"在不同版本里 API 名字都不一样，硬用会在升级时碎掉。
 * 而一个章节渲染出来之后，它的正文文本顺序是固定的 —— 用 TreeWalker 把文本节点
 * 串成一条纯文本，偏移就是稳定的；换字号、换单行双行、重新打开都对得上。
 *
 * 代价：如果用户换了书（同一个 bookId 但内容不同）偏移会失效 ——
 * 所以 TextHighlight 里还存了原文，兜底按文字重新找一次。
 */

/** 可选的标注配色（与阅读主题搭得住的一组暖色） */
export const TEXT_MARK_COLORS: { value: string; name: string }[] = [
  { value: '#f6d365', name: '琥珀' },
  { value: '#f7a072', name: '橘' },
  { value: '#a8d5a2', name: '草绿' },
  { value: '#9ec5e8', name: '天青' },
  { value: '#e3a6c8', name: '藕荷' }
]

export const DEFAULT_TEXT_MARK_COLOR = TEXT_MARK_COLORS[0].value

/** 正文里那段文字在 DOM 中的位置：文本节点 + 节点内偏移 */
interface TextPoint {
  node: Text
  offset: number
}

/** 把一章的正文文本节点按文档顺序串起来，返回整章纯文本与节点表 */
export function collectSectionText(doc: Document): { text: string; nodes: Text[] } {
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = (node as Text).parentElement
      if (!parent) return NodeFilter.FILTER_REJECT
      /* 脚本/样式里的文字不算正文；已有的标注标记也不重复计入 */
      const tag = parent.tagName
      if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT') return NodeFilter.FILTER_REJECT
      return NodeFilter.FILTER_ACCEPT
    }
  })
  const nodes: Text[] = []
  let text = ''
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const value = (node as Text).data
    nodes.push(node as Text)
    text += value
  }
  return { text, nodes }
}

/** 文本偏移 → DOM 里的 (文本节点, 节点内偏移) */
function pointAt(nodes: Text[], offset: number): TextPoint | null {
  let remaining = offset
  for (const node of nodes) {
    const length = node.data.length
    if (remaining <= length) return { node, offset: Math.max(0, remaining) }
    remaining -= length
  }
  const last = nodes[nodes.length - 1]
  return last ? { node: last, offset: last.data.length } : null
}

/** 当前选区 → 章节内的偏移区间（同一章节内才算数） */
export function selectionToRange(
  doc: Document,
  range: Range
): { start: number; end: number; text: string; plain: string } | null {
  const { text, nodes } = collectSectionText(doc)
  if (nodes.length === 0) return null

  /* Range 的两端换算成"文本节点 + 节点内偏移"，再累加成整章偏移 */
  const toOffset = (node: Node, nodeOffset: number): number | null => {
    let acc = 0
    for (const candidate of nodes) {
      if (candidate === node) return acc + nodeOffset
      /* 端点可能落在元素节点上（比如选到段落边界）：退化成"该节点之前的文本长度" */
      if (candidate.parentNode === node || node.contains?.(candidate)) {
        // 落在元素内部：以这个元素里的第一个文本节点作为端点
        return acc + nodeOffset
      }
      acc += candidate.data.length
    }
    return null
  }

  const start = toOffset(range.startContainer, range.startOffset)
  const end = toOffset(range.endContainer, range.endOffset)
  if (start === null || end === null) return null
  const from = Math.min(start, end)
  const to = Math.max(start, end)
  const picked = text.slice(from, to)
  if (!picked.trim()) return null
  /* plain 是给复制/翻译用的（去掉振假名），定位仍用 from/to 与原始 text */
  return { start: from, end: to, text: picked, plain: plainTextOf(range) }
}

/**
 * 把一处标注画进章节 DOM。
 *
 * 做法是把区间内的文本节点**逐个切分**，选中那一段用 `<mark>` 包起来，从后往前处理
 * 以免前面的切分影响后面的偏移。
 *
 * 为什么不用 range.surroundContents()：它对"只选中节点一部分"的情况会直接抛
 * InvalidStateError —— 而阅读时选中的几乎永远是一部分。另外也不能拿
 * range.commonAncestorContainer 去遍历（选区落在单个文本节点里时，
 * 那个"共同祖先"就是文本节点本身，遍历它找不到任何文字节点）。
 */
export function applyHighlight(doc: Document, mark: TextHighlight): boolean {
  const { text, nodes } = collectSectionText(doc)
  let from = mark.start
  let to = mark.end

  /* 偏移对不上（书被替换过 / 版本差异）时，按原文找一次 */
  const candidate = text.slice(from, to)
  if (candidate !== mark.text) {
    const found = text.indexOf(mark.text)
    if (found < 0) return false
    from = found
    to = found + mark.text.length
  }
  if (to <= from) return false

  const startPoint = pointAt(nodes, from)
  const endPoint = pointAt(nodes, to)
  if (!startPoint || !endPoint) return false

  /* 找出与区间相交的文本节点，连同各自要包的 [start, end) 一起记下来 */
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
  /* 从后往前：先改后面的节点，前面节点的偏移才不会失效 */
  for (const target of [...targets].reverse()) {
    const { node } = target
    const start = target.start
    const end = target.end
    if (end <= start) continue
    try {
      const head = node.splitText(start)
      /* 切掉选中段之后的部分；此时 head 正好是选中那一段 */
      if (end - start < head.data.length) head.splitText(end - start)
      const element = doc.createElement('mark')
      element.className = `epub-mark epub-mark-${mark.style}`
      element.dataset.markId = mark.id
      element.style.setProperty('--epub-mark-color', mark.color)
      head.parentNode?.insertBefore(element, head)
      element.appendChild(head)
      wrapped += 1
    } catch {
      /* 单个节点失败不影响其余部分 */
    }
  }
  return wrapped > 0
}

/** 把某一章里属于这本书的标注全部画上（每次章节渲染完调用一次） */
export function applyHighlights(doc: Document, section: number, marks: TextHighlight[]): number {
  let applied = 0
  for (const mark of marks) {
    /*
     * section < 0 表示"不知道这一节是第几节"（foliate 的 getContents 有时不给 index）。
     * 那就整份都试一遍：applyHighlight 会拿存下来的原文在当前章节里找，
     * 找得到才画、找不到就跳过，所以对错章节调用是无害的。
     * 以前这里严格相等判断，拿不到下标时**所有**标注重画都被跳过 ——
     * 于是改颜色、换样式、删除在页面上都不生效（用户报的"定死在那儿"）。
     */
    if (section >= 0 && mark.section !== section) continue
    /* 已经画过就别重复包（切章回来会重复调用） */
    if (doc.querySelector(`[data-mark-id="${mark.id}"]`)) {
      applied += 1
      continue
    }
    if (applyHighlight(doc, mark)) applied += 1
  }
  return applied
}

/** 从章节 DOM 里清掉所有标注包裹（还原成纯文本，便于重新计算偏移） */
export function clearHighlights(doc: Document): void {
  for (const node of Array.from(doc.querySelectorAll('mark.epub-mark'))) {
    const parent = node.parentNode
    if (!parent) continue
    while (node.firstChild) parent.insertBefore(node.firstChild, node)
    parent.removeChild(node)
    parent.normalize()
  }
}

/** 标注在正文里的样式（注入到每个章节） */
export function textMarkStyles(): string {
  return `
.epub-mark {
  background: color-mix(in srgb, var(--epub-mark-color, #f6d365) 62%, transparent);
  color: inherit;
  border-radius: 2px;
  padding: 0 1px;
  cursor: pointer;
}
.epub-mark-underline {
  background: none;
  /*
   * 用逻辑属性 border-block-end 而不是 border-bottom。
   * 竖排（vertical-rl）时 block 方向是横向的，border-bottom 只会落在"最后一个字"的下方，
   * 看起来就像只画了一小段（用户报的那个）。逻辑属性会自动落到正确的一侧。
   */
  border-block-end: 2px solid var(--epub-mark-color, #f6d365);
  padding-bottom: 1px;
}
/* 波浪线：text-decoration 在竖排下也由浏览器正确绘制 */
.epub-mark-wavy {
  background: none;
  text-decoration: underline wavy var(--epub-mark-color, #f6d365) 2px;
  text-underline-offset: 2px;
}
`.trim()
}

/** 生成一个稳定 id（同一处标注重复创建时也能区分） */
export function newMarkId(): string {
  return `mk_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`
}

/**
 * 选区里"能读的正文"，去掉振假名。
 *
 * 日文排版的振假名是 `<ruby>剥<rt>む</rt>き出し</ruby>`：`rt` 里的读音属于排版注音，
 * 混进纯文本就变成「剥むき出だし」这种读不通的东西。复制与翻译要的是**读得通**的那份，
 * 而定位标注仍然用原始偏移（`text`），所以两份都留着。
 */
export function plainTextOf(range: Range): string {
  try {
    const holder = document.createElement('div')
    holder.appendChild(range.cloneContents())
    for (const node of holder.querySelectorAll('rt, rp')) node.remove()
    return (holder.textContent ?? '').replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, ' ').trim()
  } catch {
    return range.toString().trim()
  }
}

/** 选中文字 → 一条待保存的标注 */
export function makeHighlight(
  section: number,
  range: { start: number; end: number; text: string; plain?: string },
  style: TextMarkStyle,
  color: string
): TextHighlight {
  return {
    id: newMarkId(),
    section,
    start: range.start,
    end: range.end,
    text: range.text,
    /* 复制/展示用：不含振假名 */
    plain: range.plain,
    style,
    color,
    createdAt: Date.now()
  }
}
