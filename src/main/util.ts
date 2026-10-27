import { createHash } from 'node:crypto'
import { basename, dirname, extname, normalize } from 'node:path'
import type { BookFormat } from '@shared/types'

/* ------------------------------------------------------------ 格式识别 */

const EXT_FORMAT: Record<string, BookFormat> = {
  '.pdf': 'pdf',
  '.md': 'md',
  '.markdown': 'markdown',
  '.mdown': 'md',
  '.mkd': 'md',
  '.mdx': 'md',
  '.txt': 'txt',
  '.text': 'txt',
  '.log': 'txt',
  '.doc': 'doc',
  '.docx': 'docx',
  '.rtf': 'rtf',
  '.html': 'html',
  '.htm': 'html',
  '.xhtml': 'html',
  '.epub': 'epub',
  '.png': 'image',
  '.jpg': 'image',
  '.jpeg': 'image',
  '.webp': 'image',
  '.gif': 'image',
  '.bmp': 'image',
  '.avif': 'image'
}

export const IMPORTABLE_EXTENSIONS = Object.keys(EXT_FORMAT).map((e) => e.slice(1))

export const DOCUMENT_FILTERS = [
  { name: '全部支持的文档', extensions: IMPORTABLE_EXTENSIONS },
  { name: 'PDF 文档', extensions: ['pdf'] },
  { name: 'Markdown', extensions: ['md', 'markdown', 'mdown', 'mkd'] },
  { name: '纯文本', extensions: ['txt', 'text', 'log'] },
  { name: 'Word 文档', extensions: ['doc', 'docx'] },
  { name: '网页 / 电子书', extensions: ['html', 'htm', 'epub', 'rtf'] },
  { name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'avif'] }
]

export const IMAGE_FILTERS = [
  { name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'avif', 'svg'] }
]

export function detectFormat(filePath: string): BookFormat {
  return EXT_FORMAT[extname(filePath).toLowerCase()] ?? 'unknown'
}

export function isSupported(filePath: string): boolean {
  return detectFormat(filePath) !== 'unknown'
}

/** 去掉扩展名的文件名，作为默认书名 */
export function titleFromPath(filePath: string): string {
  const base = basename(filePath)
  const ext = extname(base)
  return ext ? base.slice(0, -ext.length) : base
}

export function stableId(filePath: string): string {
  const norm = normalize(filePath).replace(/\\/g, '/').toLowerCase()
  return `bk_${createHash('sha1').update(norm).digest('hex').slice(0, 16)}`
}

export function uid(prefix = 'id'): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
}

/* --------------------------------------------------------- 页数估算 */

export function countWords(text: string): number {
  const cjk = text.match(/[\u3400-\u4dbf\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/g)?.length ?? 0
  const latin = text.match(/[A-Za-z0-9][A-Za-z0-9'’-]*/g)?.length ?? 0
  return cjk + latin
}

/**
 * 由正文字符数估算页数：中文约 900 字/页，西文约 450 词/页。
 * 用于 md / txt / doc 等不含分页信息的格式，决定书脊厚度。
 */
export function estimatePages(text: string): number {
  const cjk = text.match(/[\u3400-\u4dbf\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/g)?.length ?? 0
  const latin = text.match(/[A-Za-z0-9][A-Za-z0-9'’-]*/g)?.length ?? 0
  const pages = cjk / 900 + latin / 450
  return Math.max(1, Math.ceil(pages))
}

/* ------------------------------------------------------------ 文件工具 */

export function uniqueName(dir: string, name: string, exists: (p: string) => boolean): string {
  const ext = extname(name)
  const stem = ext ? name.slice(0, -ext.length) : name
  let candidate = name
  let i = 1
  while (exists(joinSafe(dir, candidate))) {
    candidate = `${stem} (${i})${ext}`
    i++
    if (i > 9999) break
  }
  return candidate
}

function joinSafe(dir: string, name: string): string {
  const sep = dir.endsWith('\\') || dir.endsWith('/') ? '' : '\\'
  return `${dir}${sep}${name}`
}

export function sanitizeFileName(name: string): string {
  return name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/^\.+/, '').trim() || 'untitled'
}

/**
 * HTML → 正文纯文字。
 *
 * DSH 这类工具生成的笔记常常有九成是 CSS 与 JS（一个演示文稿外壳可能只有几百字正文）。
 * 如果只做"去标签"，页数会被撑到几百页、书脊宽度完全失真，
 * 所以必须先把 script / style / 注释整块删掉再计数。
 */
export function htmlToPlainText(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|template|svg|iframe)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<(br|hr)\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h[1-6]|section|article|blockquote|td|th|figcaption|pre)\s*>/gi, '\n')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&amp;/gi, '&')
    .replace(/[ \t\u00a0\u3000]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * 抽出 HTML 里**真正会去磁盘取文件**的引用。
 *
 * 只认 `src="..."` 与 `<link href="...">`。
 * 不能用通用的 `href`：DSH 生成的笔记里有大量 `<a href="cat">` 这种页内跳转
 * （甚至连 # 都省了），当成资源会满屏"文件缺失"的误报。
 */
export function extractHtmlAssetRefs(html: string): string[] {
  const found = new Set<string>()
  // 注意 `(?<![\w-])`：没有它，`data-src="cat"` 这种懒加载/数据属性会被当成资源路径，
  // DSH 生成的笔记里大量存在，会造成满屏"文件缺失"的误报。
  for (const match of html.matchAll(/(?<![\w-])src\s*=\s*["']([^"']+)["']/gi)) found.add(match[1].trim())
  for (const match of html.matchAll(/<link\b[^>]*\bhref\s*=\s*["']([^"']+)["']/gi)) found.add(match[1].trim())
  return [...found]
}

/** 不是本地文件：站外链接、协议地址、data:、锚点 */
export function isRemoteRef(ref: string): boolean {
  return !ref || ref.startsWith('#') || ref.startsWith('//') || /^[a-z][a-z0-9+.-]*:/i.test(ref)
}

/** `<title>` 里的实体解码（够用即可） */
function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&amp;/gi, '&')
}

/** 只有这些标题说明作者没起名，不如用文件名或文件夹名 */
const PLACEHOLDER_TITLE = /^(untitled|untitled document|document|new document|index|无标题|未命名|未命名文档)\s*$/i

/**
 * 给 HTML 笔记起一个像样的书名。
 *
 * `goi/index.html` 直接用文件名会得到一本叫「index」的书——毫无信息量；
 * 笔记自己的 `<title>` 才是作者写下的名字，退而求其次才用所在文件夹名。
 */
export function htmlTitleFor(filePath: string, html: string): string {
  const raw = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? ''
  const docTitle = decodeEntities(raw).replace(/\s+/g, ' ').trim()
  const base = titleFromPath(filePath)

  if (docTitle && !PLACEHOLDER_TITLE.test(docTitle)) {
    return docTitle.length > 64 ? `${docTitle.slice(0, 63)}…` : docTitle
  }

  const isShell = /^(index|default|main)$/i.test(base)
  if (isShell) {
    const folder = basename(dirname(filePath))
    if (folder && folder !== '.' && folder !== '/' && folder !== '\\') return folder
  }
  return base || '未命名笔记'
}

/**
 * 宽容地解码文本：优先 UTF-8（严格模式），失败后依次尝试 GB18030 / Big5 /
 * Shift_JIS，覆盖中文用户常见的 GBK 编码纯文本，避免整篇乱码。
 */
export function decodeText(buf: Buffer): string {
  if (buf.length === 0) return ''
  if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    return buf.subarray(3).toString('utf8')
  }
  if (buf[0] === 0xff && buf[1] === 0xfe) return decodeWith('utf-16le', buf.subarray(2))
  if (buf[0] === 0xfe && buf[1] === 0xff) return decodeWith('utf-16be', buf.subarray(2))
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf)
  } catch {
    for (const enc of ['gb18030', 'big5', 'shift_jis', 'euc-kr', 'windows-1252']) {
      try {
        const text = decodeWith(enc, buf)
        if (!text.includes('\uFFFD')) return text
      } catch {
        /* 该编码不可用，继续尝试 */
      }
    }
    return buf.toString('utf8')
  }
}

function decodeWith(encoding: string, buf: Buffer): string {
  return new TextDecoder(encoding).decode(buf)
}

export function mimeForExt(filePath: string): string {
  switch (extname(filePath).toLowerCase()) {
    case '.png':
      return 'image/png'
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg'
    case '.webp':
      return 'image/webp'
    case '.gif':
      return 'image/gif'
    case '.bmp':
      return 'image/bmp'
    case '.avif':
      return 'image/avif'
    case '.svg':
      return 'image/svg+xml'
    default:
      return 'application/octet-stream'
  }
}
