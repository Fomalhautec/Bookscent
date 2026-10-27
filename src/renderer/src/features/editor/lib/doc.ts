import type { BookFormat } from '@shared/types'

/* ------------------------------------------------------------ 文档统计 */

export interface HeadingInfo {
  /** 1 基行号（源代码中的行） */
  line: number
  level: number
  text: string
  /** 预览面板里对应标题元素的 id */
  id: string
}

export interface DocStats {
  /** 字符数（含中文，不含空白） */
  chars: number
  /** 词数：西文按词，中日韩按字 */
  words: number
  lines: number
  /** 预计阅读时长（分钟），中文 400 字/分钟、西文 200 词/分钟 */
  minutes: number
}

const CJK = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/g
const LATIN_WORD = /[A-Za-z0-9'’\-_\u00c0-\u024f]+/g
const WHITESPACE = /\s+/g

export function countWords(text: string): number {
  const cjk = text.match(CJK)?.length ?? 0
  const latin = text.match(LATIN_WORD)?.length ?? 0
  return cjk + latin
}

export function computeStats(text: string): DocStats {
  const lines = text ? text.split(/\r\n|\r|\n/).length : 1
  const cjk = text.match(CJK)?.length ?? 0
  const latin = text.match(LATIN_WORD)?.length ?? 0
  const chars = text.replace(WHITESPACE, '').length
  const minutes = cjk / 400 + latin / 200
  return {
    chars,
    words: cjk + latin,
    lines,
    minutes: chars > 0 ? Math.max(1, Math.round(minutes)) : 0
  }
}

/** 纯文本行数统计（供只读预览使用） */
export function countLines(text: string): number {
  return text ? text.split(/\r\n|\r|\n/).length : 0
}

/* ------------------------------------------------------------ 标题解析 */

/** 去掉行内标记，得到适合放进大纲的纯文本 */
export function stripInline(text: string): string {
  return text
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/~~([^~]*)~~/g, '$1')
    .replace(/\*\*([^*]*)\*\*/g, '$1')
    .replace(/__([^_]*)__/g, '$1')
    .replace(/\*([^*]*)\*/g, '$1')
    .replace(/_([^_]*)_/g, '$1')
    .replace(/==([^=]*)==/g, '$1')
    .replace(/\\([\\`*_{}[\]()#+\-.!>~])/g, '$1')
    .trim()
}

function slugify(text: string, index: number, used: Set<string>): string {
  let base = text
    .toLowerCase()
    .replace(/<[^>]*>/g, '')
    .replace(/[`~!@#$%^&*()+=[\]{}\\|;:'",.<>/?！？。，、；：“”‘’（）《》【】…—]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
  if (!base) base = `heading-${index + 1}`
  let id = base
  let n = 2
  while (used.has(id)) id = `${base}-${n++}`
  used.add(id)
  return id
}

/**
 * 解析 Markdown 的 ATX 标题（# ~ ######）。
 * 跳过围栏代码块里的伪标题，并处理 ``` 与 ~~~ 两种围栏。
 */
export function parseHeadings(source: string): HeadingInfo[] {
  const lines = source.split(/\r\n|\r|\n/)
  const used = new Set<string>()
  const out: HeadingInfo[] = []
  let fence: string | null = null
  let index = 0

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]
    const fenceMatch = /^\s{0,3}(`{3,}|~{3,})/.exec(raw)
    if (fenceMatch) {
      const marker = fenceMatch[1][0]
      if (fence === null) fence = marker
      else if (fence === marker) fence = null
      continue
    }
    if (fence !== null) continue

    const match = /^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/.exec(raw)
    if (!match) continue
    const text = stripInline(match[2])
    if (!text) continue
    out.push({
      line: i + 1,
      level: match[1].length,
      text,
      id: slugify(text, index, used)
    })
    index++
  }
  return out
}

/* ------------------------------------------------------------ 其它小工具 */

export const EDITABLE: BookFormat[] = ['md', 'markdown', 'txt']

export function isEditable(format: BookFormat): boolean {
  return EDITABLE.includes(format)
}

export function isMarkdown(format: BookFormat): boolean {
  return format === 'md' || format === 'markdown'
}

/** 把行内序号（1 基）换算成编辑器里的字符位置 */
export function lineStartOffsets(text: string): number[] {
  const offsets: number[] = [0]
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (ch === '\n') offsets.push(i + 1)
    else if (ch === '\r') {
      if (text[i + 1] === '\n') i++
      offsets.push(i + 1)
    }
  }
  return offsets
}

export function lineOfOffset(offsets: number[], pos: number): number {
  let lo = 0
  let hi = offsets.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (offsets[mid] <= pos) lo = mid
    else hi = mid - 1
  }
  return lo + 1
}

export function columnOfOffset(offsets: number[], pos: number): number {
  const line = lineOfOffset(offsets, pos)
  return pos - offsets[line - 1] + 1
}
