/**
 * RTF → 纯文本。不追求完整实现，只把正文取出来：
 * 跳过字体表 / 颜色表 / 样式表 / 图片等目标组，处理控制字、十六进制转义与 \uN 转义。
 */

/** Windows-1252 里 0x80–0x9F 区间的可打印字符（RTF 的 \'hh 就是这套编码） */
const CP1252_HIGH: Record<number, string> = {
  0x80: '\u20ac',
  0x82: '\u201a',
  0x83: '\u0192',
  0x84: '\u201e',
  0x85: '\u2026',
  0x86: '\u2020',
  0x87: '\u2021',
  0x88: '\u02c6',
  0x89: '\u2030',
  0x8a: '\u0160',
  0x8b: '\u2039',
  0x8c: '\u0152',
  0x8e: '\u017d',
  0x91: '\u2018',
  0x92: '\u2019',
  0x93: '\u201c',
  0x94: '\u201d',
  0x95: '\u2022',
  0x96: '\u2013',
  0x97: '\u2014',
  0x98: '\u02dc',
  0x99: '\u2122',
  0x9a: '\u0161',
  0x9b: '\u203a',
  0x9c: '\u0153',
  0x9e: '\u017e',
  0x9f: '\u0178'
}

/** 需要整组丢弃的目标 */
const SKIP_DESTINATIONS = new Set([
  'fonttbl', 'colortbl', 'stylesheet', 'info', 'pict', 'object', 'themedata',
  'datastore', 'latentstyles', 'listtable', 'listoverridetable', 'rsidtbl',
  'generator', 'filetbl', 'revtbl', 'xmlnstbl', 'header', 'footer', 'headerl',
  'headerr', 'headerf', 'footerl', 'footerr', 'footerf', 'footnote', 'annotation'
])

interface Frame {
  /** 这一层组里出现过的目标名 */
  destination: string | null
  /** 进入该组时的跳过层级（-1 表示不跳过） */
  skipAt: number
}

function decodeHex(hex: string): string {
  if (hex.length !== 2) return ''
  const code = Number.parseInt(hex, 16)
  if (Number.isNaN(code)) return ''
  if (code >= 0x80 && code <= 0x9f) return CP1252_HIGH[code] ?? ''
  return String.fromCharCode(code)
}

export function rtfToText(source: string): string {
  const out: string[] = []
  const stack: Frame[] = [{ destination: null, skipAt: -1 }]
  let skipDepth = -1
  let depth = 0
  let i = 0

  const skipping = (): boolean => skipDepth >= 0
  const push = (text: string): void => {
    if (!skipping() && text) out.push(text)
  }
  const newline = (): void => {
    if (skipping()) return
    if (out.length > 0 && out[out.length - 1] !== '\n') out.push('\n')
  }

  while (i < source.length) {
    const ch = source[i]

    if (ch === '{') {
      depth++
      const parent = stack[stack.length - 1]
      stack.push({ destination: null, skipAt: parent.skipAt })
      i++
      continue
    }

    if (ch === '}') {
      if (depth > 0) {
        const frame = stack.pop()
        if (frame && frame.skipAt === depth) skipDepth = -1
        depth--
      }
      i++
      continue
    }

    if (ch === '\\') {
      let j = i + 1
      const next = source[j]

      /* \\ \{ \} 转义 */
      if (next === '\\' || next === '{' || next === '}' || next === "'") {
        if (next === "'") {
          const hex = source.slice(j + 1, j + 3)
          if (/^[0-9a-fA-F]{2}$/.test(hex)) {
            push(decodeHex(hex))
            i = j + 3
            continue
          }
          i = j + 1
          continue
        }
        push(next)
        i = j + 1
        continue
      }

      /* 控制符号：\~ 不换行空格 \- 可选连字符 \_ 不换行连字符 */
      if (next === '~') {
        push('\u00a0')
        i = j + 1
        continue
      }
      if (next === '-' || next === '_') {
        i = j + 1
        continue
      }
      if (next === '*') {
        /* \* 标记「可忽略的目标组」 */
        const top = stack[stack.length - 1]
        if (top) top.destination = top.destination ?? '__ignorable__'
        if (skipDepth < 0) skipDepth = depth
        i = j + 1
        continue
      }

      /* 普通控制字 */
      let k = j
      while (k < source.length && /[A-Za-z]/.test(source[k])) k++
      const word = source.slice(j, k)
      if (!word) {
        i = j
        continue
      }
      if (source[k] === '-') k++
      while (k < source.length && /[0-9]/.test(source[k])) k++
      const digits = source.slice(j + word.length, k)
      const value = /^-?\d+$/.test(digits) ? Number.parseInt(digits, 10) : null
      /* 控制字后的单个空格属于分隔符 */
      if (source[k] === ' ') k++

      const frame = stack[stack.length - 1]
      if (frame && frame.destination === null) frame.destination = word

      if (word === 'u' && value !== null) {
        const code = value < 0 ? value + 65536 : value
        push(String.fromCharCode(code))
        /* \uN 之后通常跟一个 \'hh 兜底字节，按规范它只算一个字符位 */
        if (source[k] === '\\' && source[k + 1] === "'" && /^[0-9a-fA-F]{2}$/.test(source.slice(k + 2, k + 4))) {
          k += 4
        } else {
          k += 1
        }
        i = k
        continue
      }

      if (word === 'par' || word === 'line' || word === 'sect' || word === 'pard') {
        newline()
        i = k
        continue
      }
      if (word === 'tab') {
        push('\t')
        i = k
        continue
      }

      if (SKIP_DESTINATIONS.has(word)) {
        if (skipDepth < 0) skipDepth = depth
        if (frame) frame.skipAt = depth
      } else if (skipDepth === depth && frame && frame.skipAt === depth) {
        /* 同一层出现了新的控制字目标，说明不是需要跳过的组 */
        skipDepth = -1
      }

      i = k
      continue
    }

    if (ch === '\r' || ch === '\n') {
      i++
      continue
    }

    push(ch)
    i++
  }

  return out
    .join('')
    .replace(/\u0000/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
