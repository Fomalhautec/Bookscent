/**
 * 逐句高亮的 "现在读到这里"。
 *
 * 用 CSS Custom Highlight API（`CSS.highlights` + `::highlight()`）而不是往 DOM 里插标记：
 *   - 朗读是**临时**状态，插标记会跟用户自己的标注、书签标记搅在一起，还得负责拆干净；
 *   - Custom Highlight 只动样式范围，不改结构 —— 翻页重排都不受影响。
 *
 * 两个容易踩的坑（都踩过）：
 *   1. `CSS` / `Highlight` 是**按文档**的。正文在 iframe 里，必须用 `doc.defaultView.CSS`，
 *      用外层的 `CSS` 什么也不会发生（之前"完全看不到高亮"就是这个）。
 *   2. 日文书的 `<ruby>` 会把振假名（`<rt>`）塞进 textContent，朗读文本与章节文本就对不上，
 *      `indexOf` 找不到 → 不标。所以拼章节文本时要把 `rt` / `rp` 排除掉。
 */

import { cleanSpeechText } from '@/lib/speechText'

const HIGHLIGHT_NAME = 'tts-sentence'

/** 拼出"用于比对"的章节文本：跳过 <rt>/<rp>，并记录每个字符对应的文本节点与偏移 */
function sectionText(doc: Document): {
  text: string
  slots: { node: Text; offset: number }[]
} {
  const slots: { node: Text; offset: number }[] = []
  let text = ''
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT)
  let node = walker.nextNode() as Text | null
  while (node) {
    let parent = node.parentElement
    let skip = false
    while (parent) {
      const tag = parent.tagName
      /* 振假名、注音、以及不显示的节点都不要 */
      if (tag === 'RT' || tag === 'RP' || tag === 'SCRIPT' || tag === 'STYLE') {
        skip = true
        break
      }
      parent = parent.parentElement
    }
    if (!skip) {
      for (let offset = 0; offset < node.data.length; offset += 1) {
        slots.push({ node, offset })
        text += node.data[offset]
      }
    }
    node = walker.nextNode() as Text | null
  }
  /*
   * 再按形态剔掉"没有 ruby 标记的注音"（青空文库的 ｜漢字《かな》、括号注音），
   * 规则与朗读入口一致 —— 否则念的是干净句子、章节里是带读音的字，高亮永远对不上。
   * 这里按**字符范围**剔除并同步裁剪 slots，下标依然有效。
   */
  const KANA = /^[\u3040-\u309F\u30A0-\u30FF\u30FC\u3005ー〜・\s]+$/
  const kanaOnly = (value: string): boolean => value.length > 0 && value.length <= 24 && KANA.test(value)
  const drop = new Uint8Array(text.length)
  const mark = (from: number, to: number): void => {
    for (let index = from; index < to; index += 1) drop[index] = 1
  }
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === '｜') mark(index, index + 1)
  }
  for (const pattern of [/《([^》]{1,24})》/g, /[（(［\[]([^）)］\]]{1,24})[）)］\]]/g]) {
    let match = pattern.exec(text)
    while (match) {
      if (kanaOnly(match[1])) mark(match.index, match.index + match[0].length)
      match = pattern.exec(text)
    }
  }
  let cleanedText = ''
  const keptSlots: { node: Text; offset: number }[] = []
  for (let index = 0; index < text.length; index += 1) {
    if (drop[index]) continue
    cleanedText += text[index]
    keptSlots.push(slots[index])
  }
  return { text: cleanedText, slots: keptSlots }
}

/** 压平空白（连续空白算一个），并给出压平后每个字符在原文里的下标 */
function flatten(text: string): { flat: string; map: number[] } {
  const map: number[] = []
  let flat = ''
  let pending = false
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    if (/\s/.test(char)) {
      if (flat.length > 0) pending = true
      continue
    }
    if (pending) {
      map.push(index - 1)
      flat += ' '
    }
    pending = false
    map.push(index)
    flat += char
  }
  return { flat, map }
}

/** 由"整章下标范围"造 Range（跨多个文本节点也能覆盖） */
function rangeOf(slots: { node: Text; offset: number }[], from: number, to: number): Range | null {
  const start = slots[from]
  const end = slots[Math.max(from, to - 1)]
  if (!start || !end) return null
  try {
    const doc = start.node.ownerDocument
    const range = doc.createRange()
    range.setStart(start.node, start.offset)
    range.setEnd(end.node, end.offset + 1)
    return range
  } catch {
    return null
  }
}

/** 取这个文档自己的 CSS/Highlight（iframe 里必须用 iframe 的） */
function apiOf(doc: Document): {
  highlights?: Map<string, unknown>
  Highlight?: new (...ranges: Range[]) => unknown
} | null {
  const view = doc.defaultView as
    | (Window & {
        CSS?: { highlights?: Map<string, unknown> }
        Highlight?: new (...ranges: Range[]) => unknown
      })
    | null
  if (!view) return null
  return { highlights: view.CSS?.highlights, Highlight: view.Highlight }
}

/** 高亮"正在读的那一句"；空字符串表示清掉 */
export function highlightSentence(doc: Document, sentence: string): boolean {
  const api = apiOf(doc)
  if (!api?.highlights) return false
  const needle = sentence.trim()
  if (!needle) {
    api.highlights.delete(HIGHLIGHT_NAME)
    return false
  }
  if (!api.Highlight) return false
  const { text, slots } = sectionText(doc)
  const flatSection = flatten(text)
  const flatNeedle = flatten(needle).flat
  if (!flatNeedle) return false
  const at = flatSection.flat.indexOf(flatNeedle)
  if (at < 0) {
    api.highlights.delete(HIGHLIGHT_NAME)
    return false
  }
  const from = flatSection.map[at]
  const to = flatSection.map[at + flatNeedle.length - 1] + 1
  const range = rangeOf(slots, from, to)
  if (!range) return false
  try {
    api.highlights.set(HIGHLIGHT_NAME, new api.Highlight(range))
    return true
  } catch {
    return false
  }
}

/** 退出朗读时清掉高亮（对每个打开过的文档都清一遍） */
export function clearSentenceHighlight(doc?: Document | null): void {
  if (!doc) return
  try {
    apiOf(doc)?.highlights?.delete(HIGHLIGHT_NAME)
  } catch {
    /* 没有这个 API 就什么也不用做 */
  }
}

/**
 * 把高亮样式注入章节文档。
 * 这个样式**必须在 iframe 自己的样式表里** —— 挂在主窗口上对章节无效。
 */
export function injectHighlightStyle(doc: Document): void {
  const ID = 'bookscent-tts-style'
  if (doc.getElementById(ID)) return
  try {
    const style = doc.createElement('style')
    style.id = ID
    style.textContent = `::highlight(${HIGHLIGHT_NAME}) {
      background-color: rgba(198, 146, 74, 0.35);
      color: inherit;
    }`
    doc.head?.appendChild(style)
  } catch {
    /* 注不进去就算了 */
  }
}

/* ------------------------------------------------------------ 供朗读使用 */

/**
 * 选中范围的"干净文本"：把 `<rt>` / `<rp>`（振假名）剔除后再取文字。
 *
 * 为什么不能用 `range.toString()`：它会把 `<rt>` 里的读音也算进去。
 * 这本书的标记长这样 ——
 *   `<ruby><span>詩</span><rt>し</rt><span>暮</span><rt>ぐれ</rt></ruby>`
 * `toString()` 得到 `詩し暮ぐれ`，而句子那边是 `詩暮`，两边永远对不上，
 * 于是"带振假名的句子点朗读没反应"。这里克隆片段、删掉 rt/rp，再取文本。
 */
export function selectionText(range: Range): string {
  try {
    const fragment = range.cloneContents()
    const host = range.startContainer.ownerDocument?.createElement('div')
    if (!host) return range.toString()
    host.appendChild(fragment)
    for (const noise of [...host.querySelectorAll('rt, rp, script, style')]) noise.remove()
    return cleanSpeechText(host.textContent ?? '')
  } catch {
    return cleanSpeechText(range.toString())
  }
}

/**
 * 把这一节切成句子。
 * 中文按 。！？…；，英文的句点后面要是空格或大写才切（免得把 3.14 切断）。
 */
export function sectionSentences(doc: Document): string[] {
  const { text } = sectionText(doc)
  const sentences: string[] = []
  const body = text.replace(/\s+/g, ' ')
  for (const part of body.split(/(?<=[。！？!?…；;])\s*/)) {
    /* 与朗读入口同一套清洗：这样"念的句子"与"参与定位的句子"完全一致 */
    const piece = cleanSpeechText(part)
    if (piece.length >= 2) sentences.push(piece)
  }
  return sentences
}

/**
 * 选中文字落在第几句（找不到就返回 0 = 从第一节开头）。
 * 用于"点工具条里的朗读，从我这里开始读"。
 */
export function sentenceIndexAt(doc: Document, selected: string): number {
  const sentences = sectionSentences(doc)
  if (sentences.length === 0) return 0
  /*
   * 选中的原文里通常**带着读音**（ruby 的 <rt> 会被 plainTextOf 取到，
   * 或者写法是《かな》/（かな）），而句子是清洗过的 ——
   * 两边不统一就永远定位不上，表现就是"带振假名的句子点朗读没反应/从头开始"。
   * 所以先按同一套规则清洗，再比。
   */
  const needle = flatten(cleanSpeechText(selected)).flat
  if (!needle) return 0
  /* 先看选中文字落在哪一句里 */
  for (let index = 0; index < sentences.length; index += 1) {
    const flatSentence = flatten(sentences[index]).flat
    if (flatSentence.includes(needle) || needle.includes(flatSentence)) return index
  }
  /* 退一步：用章节文本里的位置去比，取第一个起点不小于它的句子 */
  const whole = flatten(sectionText(doc).text).flat
  const at = whole.indexOf(needle)
  if (at < 0) return 0
  let cursor = 0
  for (let index = 0; index < sentences.length; index += 1) {
    const flatSentence = flatten(sentences[index]).flat
    const found = whole.indexOf(flatSentence, cursor)
    if (found >= 0 && found >= at) return index
    if (found >= 0) cursor = found + flatSentence.length
  }
  return 0
}