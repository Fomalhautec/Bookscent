/**
 * Markdown 笔记 → Word (.docx)
 *
 * 自己拼一个最小但**合法**的 OOXML 包，不引第三方文档库（体积与许可都不划算）。
 * 包内结构：
 *   [Content_Types].xml
 *   _rels/.rels
 *   docProps/core.xml · docProps/app.xml
 *   word/document.xml · word/styles.xml · word/numbering.xml
 *   word/_rels/document.xml.rels
 *   word/media/imageN.*
 *
 * 覆盖：标题、段落、加粗/斜体/删除线、行内代码、高亮、链接、表格、有序/无序列表、
 * 代码块、分割线、目录（嵌套超链接 + 书签）以及图片（含五线谱 —— SVG 先经 canvas
 * 栅格化成 PNG 再嵌入，Word 不认内联 SVG）。
 */

import { strToU8, zipSync, type Zippable } from 'fflate'
import { intrinsicSize, loadHtmlImage, rasterToPng, svgToPng } from './abc'
import { bytesToBase64, readImageContent } from './imageStore'

/* ------------------------------------------------------------ 常量 */

/** 1 CSS px = 1/96 英寸；1 英寸 = 914400 EMU */
const EMU_PER_PX = 9525
/** A4 去掉左右各 1 英寸页边距后的可用宽度，留一点余量 */
const CONTENT_EMU = Math.round(6.1 * 914400)

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
const R_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const WP_NS = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing'
const A_NS = 'http://schemas.openxmlformats.org/drawingml/2006/main'
const PIC_NS = 'http://schemas.openxmlformats.org/drawingml/2006/picture'

const IMAGE_MIME_BY_EXT: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  bmp: 'image/bmp',
  tiff: 'image/tiff'
}

/* ------------------------------------------------------------ 类型 */

interface Run {
  text: string
  bold?: boolean
  italic?: boolean
  strike?: boolean
  code?: boolean
  highlight?: boolean
  link?: string
  anchor?: string
  break?: boolean
}

interface TocEntry {
  level: number
  text: string
  anchor: string
}

type Block =
  | { kind: 'heading'; level: number; runs: Run[]; bookmark: string }
  | { kind: 'para'; runs: Run[]; style?: string; align?: 'center' }
  | { kind: 'code'; text: string }
  | { kind: 'list'; ordered: boolean; level: number; runs: Run[] }
  | { kind: 'table'; rows: Run[][][] }
  | { kind: 'image'; media: number; cx: number; cy: number }
  | { kind: 'hr' }
  | { kind: 'toc'; items: TocEntry[] }

interface MediaItem {
  fileName: string
  ext: string
  relId: string
  bytes: Uint8Array
  cx: number
  cy: number
}

export interface DocxBuildResult {
  bytes: Uint8Array
  images: number
  sheetMusic: number
  /** 降级说明（图片取不到字节之类），供界面提示 */
  notes: string[]
}

/* ------------------------------------------------------------ XML 工具 */

const XML_BAD = /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g

function escapeXml(text: string): string {
  return text
    .replace(XML_BAD, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/** 多行文本 → 一串 <w:t>，行间用 <w:br/>；空白用 xml:space 保住 */
function textElements(text: string): string {
  const lines = text.split(/\r\n|\r|\n/)
  return lines
    .map((line, index) => {
      const br = index === 0 ? '' : '<w:br/>'
      if (!line) return br
      return `${br}<w:t xml:space="preserve">${escapeXml(line)}</w:t>`
    })
    .join('')
}

/* ------------------------------------------------------- 行内元素收集 */

function isBoldTag(tag: string): boolean {
  return tag === 'strong' || tag === 'b'
}

function isItalicTag(tag: string): boolean {
  return tag === 'em' || tag === 'i'
}

function isStrikeTag(tag: string): boolean {
  return tag === 'del' || tag === 's' || tag === 'strike'
}

interface InlineState {
  bold: boolean
  italic: boolean
  strike: boolean
  code: boolean
  highlight: boolean
  link?: string
  anchor?: string
}

const BASE_STATE: InlineState = { bold: false, italic: false, strike: false, code: false, highlight: false }

function collectRuns(node: Node, state: InlineState, out: Run[]): void {
  if (node.nodeType === Node.TEXT_NODE) {
    const text = node.textContent ?? ''
    if (!text) return
    out.push({ text, ...state })
    return
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return

  const element = node as Element
  const tag = element.tagName.toLowerCase()

  if (tag === 'br') {
    out.push({ text: '', break: true, ...state })
    return
  }
  if (tag === 'img' || element.classList.contains('bs-music')) return
  if (tag === 'input') {
    const checked = element.hasAttribute('checked')
    out.push({ text: checked ? '☑ ' : '☐ ', ...state })
    return
  }
  if (tag === 'svg') return

  const next: InlineState = { ...state }
  if (isBoldTag(tag)) next.bold = true
  if (isItalicTag(tag)) next.italic = true
  if (isStrikeTag(tag)) next.strike = true
  if (tag === 'code' || tag === 'kbd' || tag === 'samp') next.code = true
  if (tag === 'mark' || tag === 'u') next.highlight = true
  if (tag === 'sub' || tag === 'sup') next.highlight = false
  if (tag === 'a') {
    const href = element.getAttribute('href') ?? ''
    if (href.startsWith('#')) next.anchor = href.slice(1)
    else if (href) next.link = href
  }
  for (const child of Array.from(element.childNodes)) collectRuns(child, next, out)
}

function runsFrom(element: Element): Run[] {
  const out: Run[] = []
  for (const child of Array.from(element.childNodes)) collectRuns(child, BASE_STATE, out)
  return out
}

function plainText(runs: Run[]): string {
  return runs.map((run) => run.text).join('')
}

/* ------------------------------------------------------------ 块遍历 */

interface WalkState {
  bookmarks: number
  ordered?: boolean
  level: number
}

function nextBookmarkId(state: WalkState): string {
  state.bookmarks += 1
  return `bsH${state.bookmarks}`
}

function hasBlockChildren(element: Element): boolean {
  return Array.from(element.children).some((child) => {
    const tag = child.tagName.toLowerCase()
    return (
      /^h[1-6]$/.test(tag) ||
      ['p', 'ul', 'ol', 'blockquote', 'pre', 'table', 'hr', 'figure', 'div', 'details', 'nav', 'section'].includes(tag)
    )
  })
}

function walkChildren(parent: Element, out: Block[], state: WalkState): void {
  for (const child of Array.from(parent.children)) walkElement(child, out, state)
}

function walkElement(element: Element, out: Block[], state: WalkState): void {
  const tag = element.tagName.toLowerCase()

  if (element.classList.contains('bs-music')) {
    const before = out.length
    pushMediaBlock(element, out)
    if (out.length === before) {
      // 没排出 SVG（缺少渲染器 / ABC 有误）时，至少把源码带进 Word
      const code = element.querySelector('pre code')?.textContent ?? ''
      if (code.trim()) out.push({ kind: 'code', text: code })
    }
    return
  }

  if (element.classList.contains('bs-toc')) {
    out.push({ kind: 'toc', items: readToc(element) })
    return
  }

  if (/^h[1-6]$/.test(tag)) {
    const level = Number(tag.slice(1))
    out.push({ kind: 'heading', level, runs: runsFrom(element), bookmark: nextBookmarkId(state) })
    return
  }

  switch (tag) {
    case 'p': {
      const images = Array.from(element.querySelectorAll('img'))
      const runs = runsFrom(element)
      const text = plainText(runs).trim()
      if (images.length > 0 && !text) {
        images.forEach((image) => pushMediaBlock(image, out))
        return
      }
      if (text || runs.some((run) => run.break)) out.push({ kind: 'para', runs })
      // 图文混排时不能让图片丢掉：文字之后按顺序补上
      images.forEach((image) => pushMediaBlock(image, out))
      return
    }
    case 'ul':
    case 'ol': {
      const ordered = tag === 'ol'
      for (const item of Array.from(element.children)) {
        if (item.tagName.toLowerCase() !== 'li') continue
        const nested = Array.from(item.children).filter((child) =>
          ['ul', 'ol'].includes(child.tagName.toLowerCase())
        )
        const inline = runsFromWithoutLists(item)
        const runs = inline.length > 0 ? inline : [{ text: '' }]
        out.push({ kind: 'list', ordered, level: Math.min(8, state.level), runs })
        for (const sub of nested) {
          walkElement(sub, out, { ...state, level: state.level + 1 })
        }
      }
      return
    }
    case 'blockquote': {
      const before = out.length
      walkChildren(element, out, state)
      for (let i = before; i < out.length; i++) {
        const block = out[i]
        if (block.kind === 'para') out[i] = { ...block, style: 'Quote' }
        else if (block.kind === 'heading') out[i] = { ...block, level: Math.min(6, block.level + 1) }
      }
      if (out.length === before) out.push({ kind: 'para', runs: runsFrom(element), style: 'Quote' })
      return
    }
    case 'pre': {
      out.push({ kind: 'code', text: element.textContent ?? '' })
      return
    }
    case 'table': {
      out.push({ kind: 'table', rows: readTable(element) })
      return
    }
    case 'hr': {
      out.push({ kind: 'hr' })
      return
    }
    case 'img': {
      pushMediaBlock(element, out)
      return
    }
    case 'figure': {
      const hasMusic = element.classList.contains('bs-music')
      if (hasMusic) pushMediaBlock(element, out)
      else walkChildren(element, out, state)
      return
    }
    case 'details': {
      const summary = Array.from(element.children).find((child) => child.tagName.toLowerCase() === 'summary')
      if (summary) out.push({ kind: 'para', runs: [{ text: (summary.textContent ?? '').trim(), bold: true }] })
      const rest = Array.from(element.children).filter((child) => child.tagName.toLowerCase() !== 'summary')
      for (const child of rest) walkElement(child, out, state)
      return
    }
    case 'div':
    case 'section':
    case 'article':
    case 'nav':
    case 'dl':
    case 'dd':
    case 'dt': {
      if (hasBlockChildren(element)) {
        walkChildren(element, out, state)
        return
      }
      const runs = runsFrom(element)
      if (plainText(runs).trim()) out.push({ kind: 'para', runs })
      return
    }
    default: {
      const runs = runsFrom(element)
      if (plainText(runs).trim()) out.push({ kind: 'para', runs })
    }
  }
}

/** 列表项自身的行内内容（不含它内嵌的子列表） */
function runsFromWithoutLists(item: Element): Run[] {
  const out: Run[] = []
  for (const child of Array.from(item.childNodes)) {
    if (child.nodeType === Node.ELEMENT_NODE) {
      const tag = (child as Element).tagName.toLowerCase()
      if (tag === 'ul' || tag === 'ol') continue
      if (tag === 'p') {
        for (const inner of Array.from(child.childNodes)) collectRuns(inner, BASE_STATE, out)
        continue
      }
    }
    collectRuns(child, BASE_STATE, out)
  }
  return out
}

function readTable(table: Element): Run[][][] {
  const rows: Run[][][] = []
  const rowElements = Array.from(table.querySelectorAll('tr'))
  for (const row of rowElements) {
    const cells: Run[][] = []
    for (const cell of Array.from(row.children)) {
      const tag = cell.tagName.toLowerCase()
      if (tag !== 'td' && tag !== 'th') continue
      const runs = runsFrom(cell)
      if (tag === 'th') runs.forEach((run) => (run.bold = true))
      cells.push(runs.length > 0 ? runs : [{ text: '' }])
    }
    if (cells.length > 0) rows.push(cells)
  }
  return rows
}

function readToc(nav: Element): TocEntry[] {
  const entries: TocEntry[] = []
  nav.querySelectorAll('a[href^="#"]').forEach((anchor) => {
    const href = anchor.getAttribute('href') ?? ''
    const id = href.slice(1)
    if (!id) return
    const item = anchor.closest('li')
    let level = 0
    let node: Element | null = item
    while (node && node !== nav) {
      if (node.tagName.toLowerCase() === 'ul') level += 1
      node = node.parentElement
    }
    entries.push({ level: Math.max(0, level - 1), text: (anchor.textContent ?? '').trim(), anchor: idForHeading(id) })
  })
  return entries
}

/* -------------------------------------------------------- 图片 / 媒体 */

function pushMediaBlock(element: Element, out: Block[]): void {
  const index = Number(element.getAttribute('data-bs-media') ?? '')
  if (!Number.isInteger(index) || index < 0) return
  const cx = Number(element.getAttribute('data-bs-media-cx') ?? '0') || CONTENT_EMU
  const cy = Number(element.getAttribute('data-bs-media-cy') ?? '0') || Math.round(CONTENT_EMU * 0.4)
  out.push({ kind: 'image', media: index, cx, cy })
}

function fitSize(width: number, height: number): { cx: number; cy: number } {
  const safeW = width > 0 ? width : 480
  const safeH = height > 0 ? height : 320
  let cx = Math.round(safeW * EMU_PER_PX)
  let cy = Math.round(safeH * EMU_PER_PX)
  const maxH = Math.round(8.5 * 914400)
  if (cx > CONTENT_EMU) {
    cy = Math.round((cy * CONTENT_EMU) / cx)
    cx = CONTENT_EMU
  }
  if (cy > maxH) {
    cx = Math.round((cx * maxH) / cy)
    cy = maxH
  }
  return { cx, cy }
}

async function collectMedia(root: HTMLElement): Promise<{ items: MediaItem[]; notes: string[]; sheet: number }> {
  const nodes = Array.from(root.querySelectorAll<HTMLElement>('figure.bs-music, img'))
  const items: MediaItem[] = []
  const notes: string[] = []
  let sheet = 0
  let serial = 0

  const push = (element: Element, bytes: Uint8Array, ext: string, width: number, height: number): void => {
    const index = items.length
    serial += 1
    const name = `image${serial}.${ext}`
    const { cx, cy } = fitSize(width, height)
    items.push({ fileName: name, ext, relId: `rIdImage${serial}`, bytes, cx, cy })
    element.setAttribute('data-bs-media', String(index))
    element.setAttribute('data-bs-media-cx', String(cx))
    element.setAttribute('data-bs-media-cy', String(cy))
  }

  for (const node of nodes) {
    if (node.tagName.toLowerCase() === 'figure') {
      const svg = node.querySelector('svg')
      if (!svg) continue
      const png = await svgToPng(svg as SVGSVGElement, 2)
      if (!png) {
        notes.push('有一处五线谱没能栅格化成图片，Word 里已跳过（源码仍保留在 ABC 源码折叠块中）')
        continue
      }
      push(node, png.bytes, 'png', png.width / 2, png.height / 2)
      sheet += 1
      continue
    }

    const image = node as HTMLImageElement
    const src = image.getAttribute('src') ?? ''
    const content = await readImageContent(src)
    if (!content) {
      if (src && !src.startsWith('data:')) notes.push(`图片无法读取，Word 里已跳过：${src}`)
      continue
    }
    const ext = content.ext === 'jpeg' ? 'jpg' : content.ext
    if (IMAGE_MIME_BY_EXT[ext] && ext !== 'bmp' && ext !== 'tiff') {
      const dataUrl = `data:${content.mime};base64,${bytesToBase64(content.bytes)}`
      const loaded = await loadHtmlImage(dataUrl)
      const size = loaded ? { width: loaded.naturalWidth, height: loaded.naturalHeight } : intrinsicSize(image)
      push(node, content.bytes, ext, size.width, size.height)
      continue
    }
    // webp / avif / svg / bmp：Word 不认，先转成 PNG
    const dataUrl = `data:${content.mime};base64,${bytesToBase64(content.bytes)}`
    const png = await rasterToPng(dataUrl)
    if (!png) {
      notes.push(`图片格式无法转换为 PNG，Word 里已跳过：${src}`)
      continue
    }
    push(node, png.bytes, 'png', png.width, png.height)
  }

  return { items, notes, sheet }
}

/* ------------------------------------------------------------ 书签映射 */

/**
 * 目录里的 `#锚点` 是 slug（如 `第一节`），标题书签是顺序号（bsH1…）。
 * 两遍遍历前先按文档顺序建一张对照表。
 */
let headingAnchors: Map<string, string> = new Map()

function idForHeading(id: string): string {
  return headingAnchors.get(id) ?? id
}

function indexHeadings(root: HTMLElement): void {
  headingAnchors = new Map()
  const headings = Array.from(root.querySelectorAll('h1, h2, h3, h4, h5, h6'))
  headings.forEach((heading, index) => {
    if (heading.id) headingAnchors.set(heading.id, `bsH${index + 1}`)
  })
}

/* --------------------------------------------------------- XML 片段 */

function runXml(run: Run, options: { bold?: boolean } = {}): string {
  if (run.break) return '<w:r><w:br/></w:r>'
  if (!run.text) return ''
  const properties: string[] = []
  const bold = run.bold || options.bold
  if (run.code) properties.push('<w:rStyle w:val="CodeChar"/>')
  if (bold) properties.push('<w:b/>')
  if (run.italic) properties.push('<w:i/>')
  if (run.strike) properties.push('<w:strike/>')
  if (run.highlight) properties.push('<w:highlight w:val="yellow"/>')
  const rPr = properties.length > 0 ? `<w:rPr>${properties.join('')}</w:rPr>` : ''
  const body = `${rPr}${textElements(run.text)}`
  if (run.link) {
    return `<w:hyperlink r:id="${linkRelId(run.link)}">${`<w:r>${body}</w:r>`}</w:hyperlink>`
  }
  if (run.anchor) {
    return `<w:hyperlink w:anchor="${escapeXml(idForHeading(run.anchor))}"><w:r>${body}</w:r></w:hyperlink>`
  }
  return `<w:r>${body}</w:r>`
}

/* 外部链接需要在 rels 里登记，这里维护一张表 */
let linkRels: { id: string; url: string }[] = []
let linkCounter = 0

function linkRelId(url: string): string {
  const existing = linkRels.find((entry) => entry.url === url)
  if (existing) return existing.id
  linkCounter += 1
  const id = `rIdLink${linkCounter}`
  linkRels.push({ id, url })
  return id
}

function runsXml(runs: Run[]): string {
  const body = runs.map((run) => runXml(run)).join('')
  return body || '<w:r><w:t xml:space="preserve"></w:t></w:r>'
}

function imageXml(media: MediaItem, id: number): string {
  return `<w:p><w:pPr><w:spacing w:before="120" w:after="120"/><w:jc w:val="center"/></w:pPr><w:r><w:drawing>` +
    `<wp:inline distT="0" distB="0" distL="0" distR="0">` +
    `<wp:extent cx="${media.cx}" cy="${media.cy}"/>` +
    `<wp:effectExtent l="0" t="0" r="0" b="0"/>` +
    `<wp:docPr id="${id}" name="图片${id}"/>` +
    `<wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr>` +
    `<a:graphic><a:graphicData uri="${PIC_NS}"><pic:pic>` +
    `<pic:nvPicPr><pic:cNvPr id="${id}" name="${escapeXml(media.fileName)}"/><pic:cNvPicPr/></pic:nvPicPr>` +
    `<pic:blipFill><a:blip r:embed="${media.relId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
    `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${media.cx}" cy="${media.cy}"/></a:xfrm>` +
    `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>` +
    `</pic:pic></a:graphicData></a:graphic>` +
    `</wp:inline></w:drawing></w:r></w:p>`
}

function blockXml(block: Block, media: MediaItem[]): string {
  switch (block.kind) {
    case 'heading': {
      const id = Number(block.bookmark.replace('bsH', '')) || 1
      return (
        `<w:p><w:pPr><w:pStyle w:val="Heading${Math.min(6, block.level)}"/></w:pPr>` +
        `<w:bookmarkStart w:id="${id}" w:name="${block.bookmark}"/>` +
        runsXml(block.runs) +
        `<w:bookmarkEnd w:id="${id}"/></w:p>`
      )
    }
    case 'para': {
      const style = block.style ? `<w:pStyle w:val="${block.style}"/>` : ''
      const align = block.align ? `<w:jc w:val="${block.align}"/>` : ''
      const pPr = style || align ? `<w:pPr>${style}${align}</w:pPr>` : ''
      return `<w:p>${pPr}${runsXml(block.runs)}</w:p>`
    }
    case 'code': {
      const lines = block.text.replace(/\r\n?/g, '\n').split('\n')
      const runs = lines
        .map((line, index) => {
          const br = index === 0 ? '' : '<w:br/>'
          return `<w:r>${br}<w:t xml:space="preserve">${escapeXml(line)}</w:t></w:r>`
        })
        .join('')
      return `<w:p><w:pPr><w:pStyle w:val="CodeBlock"/></w:pPr>${runs}</w:p>`
    }
    case 'list': {
      const numId = block.ordered ? 2 : 1
      return (
        `<w:p><w:pPr><w:pStyle w:val="ListParagraph"/><w:numPr>` +
        `<w:ilvl w:val="${Math.min(8, block.level)}"/><w:numId w:val="${numId}"/>` +
        `</w:numPr></w:pPr>${runsXml(block.runs)}</w:p>`
      )
    }
    case 'table': {
      if (block.rows.length === 0) return ''
      const rows = block.rows
        .map((cells) => {
          const tcs = cells
            .map(
              (runs) =>
                `<w:tc><w:tcPr><w:tcW w:w="0" w:type="auto"/></w:tcPr>` +
                `<w:p>${runsXml(runs)}</w:p></w:tc>`
            )
            .join('')
          return `<w:tr>${tcs}</w:tr>`
        })
        .join('')
      return (
        `<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="0" w:type="auto"/>` +
        `<w:tblBorders>` +
        `<w:top w:val="single" w:sz="6" w:color="C9BEA9"/>` +
        `<w:left w:val="single" w:sz="6" w:color="C9BEA9"/>` +
        `<w:bottom w:val="single" w:sz="6" w:color="C9BEA9"/>` +
        `<w:right w:val="single" w:sz="6" w:color="C9BEA9"/>` +
        `<w:insideH w:val="single" w:sz="6" w:color="C9BEA9"/>` +
        `<w:insideV w:val="single" w:sz="6" w:color="C9BEA9"/>` +
        `</w:tblBorders></w:tblPr><w:tblGrid/>${rows}</w:tbl>` +
        `<w:p><w:pPr><w:spacing w:after="0"/></w:pPr></w:p>`
      )
    }
    case 'image': {
      const item = media[block.media]
      if (!item) return ''
      return imageXml({ ...item, cx: block.cx, cy: block.cy }, block.media + 1)
    }
    case 'hr':
      return (
        `<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="C9BEA9"/></w:pBdr>` +
        `<w:spacing w:before="160" w:after="160"/></w:pPr></w:p>`
      )
    case 'toc': {
      if (block.items.length === 0) return ''
      const title = `<w:p><w:pPr><w:pStyle w:val="TOCHeading"/></w:pPr><w:r><w:t>目录</w:t></w:r></w:p>`
      const items = block.items
        .map((entry) => {
          const style = `TOC${Math.min(4, entry.level + 1)}`
          return (
            `<w:p><w:pPr><w:pStyle w:val="${style}"/></w:pPr>` +
            `<w:hyperlink w:anchor="${escapeXml(entry.anchor)}">` +
            `<w:r><w:rPr><w:rStyle w:val="Hyperlink"/></w:rPr><w:t xml:space="preserve">${escapeXml(entry.text)}</w:t></w:r>` +
            `</w:hyperlink></w:p>`
          )
        })
        .join('')
      return title + items
    }
    default:
      return ''
  }
}

/* -------------------------------------------------------- 静态部件 */

function stylesXml(): string {
  const heading = (level: number, size: number, bold = true): string =>
    `<w:style w:type="paragraph" w:styleId="Heading${level}"><w:name w:val="heading ${level}"/>` +
    `<w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/>` +
    `<w:pPr><w:keepNext/><w:spacing w:before="${Math.max(120, 320 - level * 30)}" w:after="120"/><w:outlineLvl w:val="${level - 1}"/></w:pPr>` +
    `<w:rPr><w:b w:val="${bold ? '1' : '0'}"/><w:sz w:val="${size}"/><w:szCs w:val="${size}"/></w:rPr></w:style>`

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="${W_NS}">
<w:docDefaults><w:rPrDefault><w:rPr>
<w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:eastAsia="宋体" w:cs="Times New Roman"/>
<w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:val="zh-CN" w:eastAsia="zh-CN"/>
</w:rPr></w:rPrDefault><w:pPrDefault><w:pPr>
<w:spacing w:after="140" w:line="320" w:lineRule="auto"/>
</w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>
<w:style w:type="character" w:default="1" w:styleId="DefaultParagraphFont"><w:name w:val="Default Paragraph Font"/></w:style>
<w:style w:type="table" w:default="1" w:styleId="TableNormal"><w:name w:val="Normal Table"/></w:style>
<w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/><w:basedOn w:val="TableNormal"/></w:style>
<w:style w:type="numbering" w:default="1" w:styleId="NoList"><w:name w:val="No List"/></w:style>
${heading(1, 40)}${heading(2, 32)}${heading(3, 28)}${heading(4, 24)}${heading(5, 22)}${heading(6, 22)}
<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/>
<w:pPr><w:spacing w:after="240"/><w:jc w:val="center"/></w:pPr>
<w:rPr><w:b/><w:sz w:val="52"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/><w:basedOn w:val="Normal"/>
<w:pPr><w:pBdr><w:left w:val="single" w:sz="18" w:space="8" w:color="C2A878"/></w:pBdr><w:ind w:left="420"/></w:pPr>
<w:rPr><w:i/><w:color w:val="5C5145"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="CodeBlock"><w:name w:val="Code Block"/><w:basedOn w:val="Normal"/>
<w:pPr><w:shd w:val="clear" w:color="auto" w:fill="F5F1E8"/><w:spacing w:before="120" w:after="120"/></w:pPr>
<w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:eastAsia="等线"/><w:sz w:val="19"/></w:rPr></w:style>
<w:style w:type="character" w:styleId="CodeChar"><w:name w:val="Code Char"/>
<w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/><w:shd w:val="clear" w:color="auto" w:fill="F5F1E8"/></w:rPr></w:style>
<w:style w:type="character" w:styleId="Hyperlink"><w:name w:val="Hyperlink"/>
<w:rPr><w:color w:val="8A6A2F"/><w:u w:val="single"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/>
<w:pPr><w:ind w:left="420"/><w:contextualSpacing/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="TOCHeading"><w:name w:val="TOC Heading"/><w:basedOn w:val="Normal"/>
<w:pPr><w:spacing w:before="240" w:after="120"/></w:pPr><w:rPr><w:b/><w:sz w:val="30"/></w:rPr></w:style>
${[1, 2, 3, 4]
  .map(
    (level) =>
      `<w:style w:type="paragraph" w:styleId="TOC${level}"><w:name w:val="toc ${level}"/><w:basedOn w:val="Normal"/>` +
      `<w:pPr><w:spacing w:after="40"/><w:ind w:left="${(level - 1) * 220}"/><w:contextualSpacing/></w:pPr></w:style>`
  )
  .join('')}
</w:styles>`
}

function numberingXml(): string {
  const bulletLevels = Array.from({ length: 9 }, (_unused, level) => {
    const indent = 420 + level * 360
    return `<w:lvl w:ilvl="${level}"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/>` +
      `<w:lvlJc w:val="left"/><w:pPr><w:ind w:left="${indent}" w:hanging="240"/></w:pPr>` +
      `<w:rPr><w:rFonts w:ascii="Symbol" w:hAnsi="Symbol" w:hint="default"/></w:rPr></w:lvl>`
  }).join('')
  const decimalLevels = Array.from({ length: 9 }, (_unused, level) => {
    const indent = 420 + level * 360
    return `<w:lvl w:ilvl="${level}"><w:start w:val="1"/><w:numFmt w:val="decimal"/>` +
      `<w:lvlText w:val="%${level + 1}."/><w:lvlJc w:val="left"/>` +
      `<w:pPr><w:ind w:left="${indent}" w:hanging="240"/></w:pPr></w:lvl>`
  }).join('')

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:numbering xmlns:w="${W_NS}">
<w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="hybridMultilevel"/>${bulletLevels}</w:abstractNum>
<w:abstractNum w:abstractNumId="1"><w:multiLevelType w:val="hybridMultilevel"/>${decimalLevels}</w:abstractNum>
<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>
<w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num>
</w:numbering>`
}

function contentTypesXml(extensions: string[]): string {
  const defaults = Array.from(new Set(['png', ...extensions]))
    .map(
      (ext) =>
        `<Default Extension="${ext}" ContentType="${IMAGE_MIME_BY_EXT[ext] ?? 'application/octet-stream'}"/>`
    )
    .join('')
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
${defaults}
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>
<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>`
}

function rootRelsXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="${R_NS}/officeDocument" Target="word/document.xml"/>
<Relationship Id="rId2" Type="${R_NS}/metadata/core-properties" Target="docProps/core.xml"/>
<Relationship Id="rId3" Type="${R_NS}/extended-properties" Target="docProps/app.xml"/>
</Relationships>`
}

function documentRelsXml(media: MediaItem[]): string {
  const images = media
    .map(
      (item) =>
        `<Relationship Id="${item.relId}" Type="${R_NS}/image" Target="media/${item.fileName}"/>`
    )
    .join('')
  const links = linkRels
    .map((entry) => `<Relationship Id="${entry.id}" Type="${R_NS}/hyperlink" Target="${escapeXml(entry.url)}" TargetMode="External"/>`)
    .join('')
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rIdStyles" Type="${R_NS}/styles" Target="styles.xml"/>
<Relationship Id="rIdNumbering" Type="${R_NS}/numbering" Target="numbering.xml"/>
${images}${links}
</Relationships>`
}

function coreXml(title: string, created: string): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"
 xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/"
 xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
<dc:title>${escapeXml(title)}</dc:title>
<dc:creator>书香笔记 Bookscent</dc:creator>
<cp:lastModifiedBy>书香笔记 Bookscent</cp:lastModifiedBy>
<dcterms:created xsi:type="dcterms:W3CDTF">${created}</dcterms:created>
<dcterms:modified xsi:type="dcterms:W3CDTF">${created}</dcterms:modified>
</cp:coreProperties>`
}

function appXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"
 xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
<Application>书香笔记 Bookscent</Application>
</Properties>`
}

function documentXml(blocks: Block[], media: MediaItem[]): string {
  const body = blocks.map((block) => blockXml(block, media)).join('')
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="${W_NS}" xmlns:r="${R_NS}" xmlns:wp="${WP_NS}" xmlns:a="${A_NS}" xmlns:pic="${PIC_NS}">
<w:body>${body}
<w:sectPr><w:pgSz w:w="11906" w:h="16838"/>
<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="851" w:footer="992" w:gutter="0"/>
</w:sectPr>
</w:body></w:document>`
}

/* ------------------------------------------------------------ 主流程 */

export async function buildDocx(root: HTMLElement, title: string): Promise<DocxBuildResult> {
  linkRels = []
  linkCounter = 0
  indexHeadings(root)

  const { items: media, notes, sheet } = await collectMedia(root)

  const blocks: Block[] = []
  const state: WalkState = { bookmarks: 0, level: 0 }
  walkChildren(root, blocks, state)

  const created = new Date().toISOString().replace(/\.\d+Z$/, 'Z')
  const files: Zippable = {
    '[Content_Types].xml': strToU8(contentTypesXml(media.map((item) => item.ext))),
    '_rels/.rels': strToU8(rootRelsXml()),
    'docProps/core.xml': strToU8(coreXml(title, created)),
    'docProps/app.xml': strToU8(appXml()),
    'word/document.xml': strToU8(documentXml(blocks, media)),
    'word/styles.xml': strToU8(stylesXml()),
    'word/numbering.xml': strToU8(numberingXml()),
    'word/_rels/document.xml.rels': strToU8(documentRelsXml(media))
  }
  for (const item of media) files[`word/media/${item.fileName}`] = item.bytes

  const bytes = zipSync(files, { level: 6 })
  return { bytes, images: media.length, sheetMusic: sheet, notes }
}
