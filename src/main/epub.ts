import { existsSync, readFileSync, statSync } from 'node:fs'
import { inflateSync, unzipSync } from 'fflate'
import type { EpubChapter, EpubInfo } from '@shared/types'
import { logLine } from './log'

/**
 * EPUB 引擎。
 *
 * 直接在内存里解开 zip，再按需把内部文件喂给 `app://bundle/__epub/...`。
 * 不落盘有两个好处：不会和用户的书产生缓存同步问题，
 * 也不会在磁盘上留下几百兆的解包副本。
 *
 * 为什么把整本书解在内存而不是按条目读：EPUB 的 zip 通常没有可靠的目录索引，
 * fflate 也得把中央目录读完才能定位；一次解开反而更简单也更快。
 */

export type { EpubChapter, EpubInfo }

interface Packed {
  key: string
  files: Record<string, Uint8Array>
  /** 小写路径 → 真实路径 */
  lookup: Map<string, string>
  info: EpubInfo
  size: number
}

const cache = new Map<string, Packed>()
/** 内存上限：几本图多的书就能吃掉上百兆，所以设个上限做 LRU */
const MAX_CACHE_BYTES = 160 * 1024 * 1024
let cachedBytes = 0

function evict(needRoom: number): void {
  if (cachedBytes + needRoom <= MAX_CACHE_BYTES) return
  for (const [id, entry] of cache) {
    cache.delete(id)
    cachedBytes -= entry.size
    if (cachedBytes + needRoom <= MAX_CACHE_BYTES) return
  }
}

/** 取（必要时解开）一本书，返回它在内存里的解包结果 */
export function loadEpub(bookId: string, path: string): Packed | null {
  if (!existsSync(path)) return null
  const stat = statSync(path)
  const key = `${path}|${stat.mtimeMs}|${stat.size}`
  const hit = cache.get(bookId)
  if (hit && hit.key === key) {
    // 命中就提到队首，维持 LRU 顺序
    cache.delete(bookId)
    cache.set(bookId, hit)
    return hit
  }
  if (hit) {
    cache.delete(bookId)
    cachedBytes -= hit.size
  }

  try {
    const bytes = new Uint8Array(readFileSync(path))
    evict(bytes.byteLength)
    const files = unzipSync(bytes)
    const lookup = new Map<string, string>()
    for (const name of Object.keys(files)) lookup.set(normalizePath(name).toLowerCase(), name)

    const info = parseEpub(files, lookup)
    const packed: Packed = { key, files, lookup, info, size: bytes.byteLength }
    cache.set(bookId, packed)
    cachedBytes += packed.size
    logLine('epub', `${path} 已解开：${info.fileCount} 个条目，${info.chapters.length} 章`)
    return packed
  } catch (error) {
    logLine('epub', `解开失败 ${path}：${(error as Error).message}`)
    return null
  }
}

export function epubInfo(bookId: string, path: string): EpubInfo | null {
  return loadEpub(bookId, path)?.info ?? null
}

/** 从内存里取一个内部文件；path 是相对解包根的路径 */
export function epubFile(bookId: string, path: string): Uint8Array | null {
  const packed = cache.get(bookId)
  if (!packed) return null
  const normalized = normalizePath(decodeURIComponent(path)).replace(/^\/+/, '')
  if (!normalized || normalized.includes('..')) return null
  const real = packed.lookup.get(normalized.toLowerCase())
  return real ? packed.files[real] : null
}

export function hasEpub(bookId: string): boolean {
  return cache.has(bookId)
}

/** 一本书里所有图片条目（给「导出图片」用） */
export interface EpubImage {
  href: string
  name: string
  bytes: number
}

export function epubImages(bookId: string, path: string): EpubImage[] {
  const packed = loadEpub(bookId, path)
  if (!packed) return []
  const out: EpubImage[] = []
  for (const [lower, real] of packed.lookup) {
    if (!/\.(png|jpe?g|gif|webp|bmp|svg|avif)$/.test(lower)) continue
    const data = packed.files[real]
    out.push({
      href: normalizePath(real),
      name: normalizePath(real).split('/').pop() ?? real,
      bytes: data ? data.byteLength : 0
    })
  }
  return out.sort((a, b) => b.bytes - a.bytes)
}

/**
 * 估算这本书的"页数"。
 *
 * 书脊的厚薄由页数决定，而 EPUB 的章节数与页数完全不是一回事 ——
 * 一本 3 章的书可能有一两百页。
 *
 * 关键是**不能靠解压来估**：`unzipSync` 会把整本解开，
 * 一个 200 本电子书的书架每扫一次就要解开几个 G，
 * 书架一打开就卡住（这正是第一版的毛病）。
 * 所以这里只读 zip 的中央目录 —— 那里已经写着每个条目的未压缩大小，
 * 把正文章节的大小加起来就够估页数了，一个字节都不用解压。
 */
export function epubTextStats(_bookId: string, path: string): { pages: number; words: number } {
  try {
    const bytes = new Uint8Array(readFileSync(path))
    /*
     * 用**压缩后**的大小，而不是原始大小。
     *
     * 原始大小被标记撑得很虚：Calibre 生成的 EPUB 每个段落都挂着
     * `<p class="calibre1">`，一本三百页的小说原始 XHTML 能有 3.7MB，
     * 按原始大小估会得出 1500 页。压缩后标记几乎不占体积，
     * 剩下的基本就是正文的信息量，实测两本中文书都能落在正确量级。
     */
    let packed = 0
    for (const entry of zipEntries(bytes)) {
      if (/\.x?html?$/i.test(entry.name)) packed += entry.compressedSize
    }
    if (packed > 0) {
      // 标定：约 1.5KB 压缩正文 = 一页（含标点的中文约 800 字）
      const pages = Math.max(1, Math.round(packed / 1536))
      return { pages, words: Math.round(packed / 1.92) }
    }
  } catch {
    /* 中央目录读不出来才退回解压 */
  }
  const info = epubInfo(_bookId, path)
  return { pages: Math.max(1, info?.chapters.length ?? 1), words: 0 }
}

/** zip 中央目录里的一个条目 */
function zipEntries(bytes: Uint8Array): { name: string; compressedSize: number }[] {
  if (bytes.length < 22) return []
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  // 从尾部往前找 EOCD（末尾可能带最长 65535 字节的注释）
  let eocd = -1
  const floor = Math.max(0, bytes.length - 22 - 65535)
  for (let i = bytes.length - 22; i >= floor; i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i
      break
    }
  }
  if (eocd < 0) return []

  const count = view.getUint16(eocd + 10, true)
  let offset = view.getUint32(eocd + 16, true)
  const decoder = new TextDecoder('utf-8')
  const out: { name: string; compressedSize: number }[] = []
  for (let i = 0; i < count; i++) {
    if (offset + 46 > bytes.length || view.getUint32(offset, true) !== 0x02014b50) break
    const compressedSize = view.getUint32(offset + 20, true)
    const nameLen = view.getUint16(offset + 28, true)
    const extraLen = view.getUint16(offset + 30, true)
    const commentLen = view.getUint16(offset + 32, true)
    out.push({
      name: decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLen)),
      compressedSize
    })
    offset += 46 + nameLen + extraLen + commentLen
  }
  return out
}

/* ------------------------------------------------------------------ 解析 */

function normalizePath(input: string): string {
  const parts: string[] = []
  for (const segment of input.replace(/\\/g, '/').split('/')) {
    if (!segment || segment === '.') continue
    if (segment === '..') {
      parts.pop()
      continue
    }
    parts.push(segment)
  }
  return parts.join('/')
}

/** 相对 base 目录解析 href，并去掉 #fragment 与 ?query */
function resolveHref(baseDir: string, href: string): string {
  const clean = href.split('#')[0].split('?')[0]
  try {
    return normalizePath(baseDir ? `${baseDir}/${decodeURIComponent(clean)}` : decodeURIComponent(clean))
  } catch {
    return normalizePath(baseDir ? `${baseDir}/${clean}` : clean)
  }
}

function dirOf(path: string): string {
  const index = path.lastIndexOf('/')
  return index < 0 ? '' : path.slice(0, index)
}

function decodeXml(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_m, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_m, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&amp;/g, '&')
}

function parseAttrs(source: string): Record<string, string> {
  const attrs: Record<string, string> = {}
  for (const match of source.matchAll(/([\w:.-]+)\s*=\s*"([^"]*)"/g)) {
    attrs[match[1].toLowerCase()] = match[2]
  }
  return attrs
}

function readText(files: Record<string, Uint8Array>, lookup: Map<string, string>, path: string): string | null {
  const real = lookup.get(normalizePath(path).toLowerCase())
  if (!real) return null
  try {
    return new TextDecoder('utf-8').decode(files[real])
  } catch {
    return null
  }
}

/**
 * 找封面图。
 *
 * 三种办法依次试，覆盖市面上绝大多数 EPUB：
 *   1. EPUB3：manifest 里带 `properties="cover-image"` 的那一项；
 *   2. EPUB2：`<meta name="cover" content="<item id>">` 指向的项；
 *   3. 兜底：文件名里带 cover 的图片（用户的原话就是"名为 cover 的图片"）——
 *      有些书（尤其 Calibre 导出的）既不标 properties 也不写 meta，但图就叫 cover.jpg。
 */
function findCoverHref(
  opf: string,
  opfDir: string,
  manifest: Map<string, ManifestItem>,
  lookup: Map<string, string>
): string | null {
  const byProp = [...manifest.values()].find((item) => item.properties.split(/\s+/).includes('cover-image'))
  if (byProp) return resolveHref(opfDir, byProp.href)

  const metaId =
    /<meta\b[^>]*name\s*=\s*"cover"[^>]*content\s*=\s*"([^"]+)"/i.exec(opf)?.[1] ??
    /<meta\b[^>]*content\s*=\s*"([^"]+)"[^>]*name\s*=\s*"cover"/i.exec(opf)?.[1]
  if (metaId) {
    const item = manifest.get(metaId)
    if (item) return resolveHref(opfDir, item.href)
  }

  const named = [...manifest.values()].find(
    (item) => item.mediaType.startsWith('image/') && /cover/i.test(item.href)
  )
  if (named) return resolveHref(opfDir, named.href)

  // manifest 里没登记图片的畸形书：直接在解包结果里按文件名找
  for (const [lower, real] of lookup) {
    if (/\.(png|jpe?g|webp|gif)$/.test(lower) && /(^|\/)cover[^/]*$/.test(lower)) return normalizePath(real)
  }
  return null
}

/** 封面图的内容与像素尺寸（导入时拿去落盘 + 记宽高比用） */
export interface EpubCover {
  dataUrl: string
  width: number
  height: number
}

export function epubCover(bookId: string, path: string): EpubCover | null {
  const packed = loadEpub(bookId, path)
  const href = packed?.info.cover
  if (!packed || !href) return null
  const bytes = epubFile(bookId, href)
  if (!bytes || bytes.byteLength === 0) return null
  const mime = /\.png$/i.test(href)
    ? 'image/png'
    : /\.webp$/i.test(href)
      ? 'image/webp'
      : /\.gif$/i.test(href)
        ? 'image/gif'
        : 'image/jpeg'
  const size = imageSize(bytes)
  return {
    dataUrl: `data:${mime};base64,${Buffer.from(bytes).toString('base64')}`,
    width: size?.width ?? 0,
    height: size?.height ?? 0
  }
}

/**
 * 从图片字节里读像素尺寸（PNG / JPEG / GIF / WebP）。
 *
 * 为什么要读：书架的封面几何要按封面自己的宽高比算（`coverImageAspect`），
 * 不写的话会回落到默认的 2:3 —— 对 0.704 的封面来说宽了 5%，
 * 看着不致命，但"图被拉宽一点"是能看出来的。
 * 读不出来就返回 null，调用方退回默认比例。
 */
function imageSize(bytes: Uint8Array): { width: number; height: number } | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  // PNG：IHDR 紧跟在 8 字节签名 + 4 字节长度 + 4 字节类型之后
  if (bytes.byteLength > 24 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return { width: view.getUint32(16), height: view.getUint32(20) }
  }
  // GIF：逻辑屏幕描述符，小端
  if (bytes.byteLength > 10 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) {
    return { width: view.getUint16(6, true), height: view.getUint16(8, true) }
  }
  // WebP：VP8X / VP8 / VP8L 三种头
  if (
    bytes.byteLength > 30 &&
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) {
    const kind = String.fromCharCode(bytes[12], bytes[13], bytes[14], bytes[15])
    if (kind === 'VP8X') {
      const w = 1 + (bytes[24] | (bytes[25] << 8) | (bytes[26] << 16))
      const h = 1 + (bytes[27] | (bytes[28] << 8) | (bytes[29] << 16))
      return { width: w, height: h }
    }
    if (kind === 'VP8 ') {
      return { width: view.getUint16(26, true) & 0x3fff, height: view.getUint16(28, true) & 0x3fff }
    }
  }
  // JPEG：扫段找 SOF
  if (bytes.byteLength > 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let i = 2
    while (i + 9 < bytes.byteLength) {
      if (bytes[i] !== 0xff) {
        i += 1
        continue
      }
      const marker = bytes[i + 1]
      const len = view.getUint16(i + 2)
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { width: view.getUint16(i + 7), height: view.getUint16(i + 5) }
      }
      i += 2 + len
    }
  }
  return null
}

/* ------------------------------------------------------- 轻量取封面 */

/**
 * 只读封面用的 zip 索引。
 *
 * 为什么不能直接 `unzipSync` 整本：取封面只需要 container.xml、OPF 和封面图
 * 三个条目（前两个各几 KB）。整本解开意味着把一本 8MB 的书全inflate进内存 ——
 * 导入 N 本就要解开 N 本，启动时给几十本补录封面会让主进程长时间卡住
 * （用户反馈"重进一次能解决，但启动变得特别慢"就是这个）。
 * 所以这里只解析中央目录，再按需解出目标条目。
 */
interface ZipEntryInfo {
  name: string
  method: number
  compressedSize: number
  localOffset: number
}

function zipIndex(bytes: Uint8Array): ZipEntryInfo[] {
  if (bytes.length < 22) return []
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let eocd = -1
  const floor = Math.max(0, bytes.length - 22 - 65535)
  for (let i = bytes.length - 22; i >= floor; i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i
      break
    }
  }
  if (eocd < 0) return []
  const count = view.getUint16(eocd + 10, true)
  let offset = view.getUint32(eocd + 16, true)
  const decoder = new TextDecoder('utf-8')
  const out: ZipEntryInfo[] = []
  for (let i = 0; i < count; i++) {
    if (offset + 46 > bytes.length || view.getUint32(offset, true) !== 0x02014b50) break
    const method = view.getUint16(offset + 10, true)
    const compressedSize = view.getUint32(offset + 20, true)
    const nameLen = view.getUint16(offset + 28, true)
    const extraLen = view.getUint16(offset + 30, true)
    const commentLen = view.getUint16(offset + 32, true)
    const localOffset = view.getUint32(offset + 42, true)
    out.push({
      name: decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLen)),
      method,
      compressedSize,
      localOffset
    })
    offset += 46 + nameLen + extraLen + commentLen
  }
  return out
}

/** 解出 zip 里的**一个**条目（0 = 存储，8 = deflate） */
function readZipEntry(bytes: Uint8Array, entry: ZipEntryInfo): Uint8Array | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const at = entry.localOffset
  if (at + 30 > bytes.length || view.getUint32(at, true) !== 0x04034b50) return null
  const nameLen = view.getUint16(at + 26, true)
  const extraLen = view.getUint16(at + 28, true)
  const start = at + 30 + nameLen + extraLen
  const raw = bytes.subarray(start, start + entry.compressedSize)
  if (entry.method === 0) return raw
  if (entry.method === 8) {
    try {
      return inflateSync(raw)
    } catch {
      return null
    }
  }
  return null
}

/**
 * 轻量版封面提取：不解整本书，只解 container.xml / OPF / 封面图。
 *
 * 找不到封面或格式不认识就返回 null（调用方照旧用程序化封面）。
 */
export function epubCoverLight(path: string): { dataUrl: string; width: number; height: number } | null {
  if (!existsSync(path)) return null
  const bytes = new Uint8Array(readFileSync(path))
  const entries = zipIndex(bytes)
  if (entries.length === 0) return null
  const byName = new Map<string, ZipEntryInfo>()
  for (const entry of entries) byName.set(normalizePath(entry.name).toLowerCase(), entry)

  const textOf = (name: string): string | null => {
    const entry = byName.get(normalizePath(name).toLowerCase())
    if (!entry) return null
    const data = readZipEntry(bytes, entry)
    return data ? new TextDecoder('utf-8').decode(data) : null
  }

  const container = textOf('META-INF/container.xml')
  if (!container) {
    logLine('epub', '封面：读不到 META-INF/container.xml，放弃')
    return null
  }
  const opfPath = /<rootfile\b[^>]*full-path\s*=\s*"([^"]+)"/i.exec(container)?.[1]
  if (!opfPath) {
    logLine('epub', '封面：container.xml 里没有 rootfile')
    return null
  }
  const opf = textOf(opfPath)
  if (!opf) {
    logLine('epub', `封面：读不到 OPF（${opfPath}）`)
    return null
  }
  const opfDir = dirOf(normalizePath(opfPath))

  const manifest = new Map<string, ManifestItem>()
  for (const match of opf.matchAll(/<item\b([^>]*?)\/?>/gi)) {
    const attrs = parseAttrs(match[1])
    if (!attrs.id || !attrs.href) continue
    manifest.set(attrs.id, {
      href: attrs.href,
      mediaType: attrs['media-type'] ?? '',
      properties: attrs.properties ?? ''
    })
  }

  // findCoverHref 的兜底分支要一个"小写路径 → 真实路径"的表
  const lookup = new Map<string, string>()
  for (const entry of entries) lookup.set(normalizePath(entry.name).toLowerCase(), entry.name)
  const href = findCoverHref(opf, opfDir, manifest, lookup)
  if (!href) {
    logLine('epub', `封面：OPF 里找不到封面项（manifest ${manifest.size} 项，条目 ${entries.length} 个）`)
    return null
  }
  logLine('epub', `封面：OPF 指定 ${href}`)

  const entry = byName.get(href.toLowerCase())
  if (!entry) {
    logLine('epub', `封面：zip 里没有这个条目 ${href}`)
    return null
  }
  const data = readZipEntry(bytes, entry)
  if (!data || data.byteLength === 0) {
    logLine('epub', `封面：解不出条目 ${href}（method=${entry.method}，压缩后 ${entry.compressedSize} 字节）`)
    return null
  }
  logLine('epub', `封面：解出 ${data.byteLength} 字节（${href}）`)

  const mime = /\.png$/i.test(href)
    ? 'image/png'
    : /\.webp$/i.test(href)
      ? 'image/webp'
      : /\.gif$/i.test(href)
        ? 'image/gif'
        : 'image/jpeg'
  const size = imageSize(data)
  return {
    dataUrl: `data:${mime};base64,${Buffer.from(data).toString('base64')}`,
    width: size?.width ?? 0,
    height: size?.height ?? 0
  }
}

interface ManifestItem {
  href: string
  mediaType: string
  properties: string
}

function parseEpub(files: Record<string, Uint8Array>, lookup: Map<string, string>): EpubInfo {
  const empty: EpubInfo = { chapters: [], fileCount: Object.keys(files).length, title: '', author: '' }

  const container = readText(files, lookup, 'META-INF/container.xml')
  if (!container) return empty
  const opfPath = /<rootfile\b[^>]*full-path\s*=\s*"([^"]+)"/i.exec(container)?.[1]
  if (!opfPath) return empty

  const opf = readText(files, lookup, opfPath)
  if (!opf) return empty
  const opfDir = dirOf(normalizePath(opfPath))

  /* -------- manifest / spine / 元数据 -------- */
  const manifest = new Map<string, ManifestItem>()
  for (const match of opf.matchAll(/<item\b([^>]*?)\/?>/gi)) {
    const attrs = parseAttrs(match[1])
    if (!attrs.id || !attrs.href) continue
    manifest.set(attrs.id, {
      href: attrs.href,
      mediaType: attrs['media-type'] ?? '',
      properties: attrs.properties ?? ''
    })
  }

  const spineIds: string[] = []
  for (const match of opf.matchAll(/<itemref\b([^>]*?)\/?>/gi)) {
    const attrs = parseAttrs(match[1])
    if (attrs.idref) spineIds.push(attrs.idref)
  }

  const title = decodeXml(/<dc:title[^>]*>([\s\S]*?)<\/dc:title>/i.exec(opf)?.[1]?.trim() ?? '')
  const author = decodeXml(/<dc:creator[^>]*>([\s\S]*?)<\/dc:creator>/i.exec(opf)?.[1]?.trim() ?? '')

  /* -------- 目录：先 EPUB3 nav，再 EPUB2 NCX -------- */
  const toc = new Map<string, { title: string; depth: number }>()
  const navItem = [...manifest.values()].find((item) => item.properties.split(/\s+/).includes('nav'))
  if (navItem) {
    const navText = readText(files, lookup, resolveHref(opfDir, navItem.href))
    if (navText) collectNavToc(navText, opfDir, dirOf(resolveHref(opfDir, navItem.href)), toc)
  }
  if (toc.size === 0) {
    const ncxId = /<spine\b[^>]*\btoc\s*=\s*"([^"]+)"/i.exec(opf)?.[1]
    const ncxItem = (ncxId ? manifest.get(ncxId) : undefined) ??
      [...manifest.values()].find((item) => item.mediaType.includes('ncx'))
    if (ncxItem) {
      const ncxText = readText(files, lookup, resolveHref(opfDir, ncxItem.href))
      if (ncxText) collectNcxToc(ncxText, opfDir, toc)
    }
  }

  /* -------- 章节 -------- */
  const chapters: EpubChapter[] = []
  const seen = new Set<string>()
  let index = 0
  for (const id of spineIds) {
    const item = manifest.get(id)
    if (!item) continue
    const href = resolveHref(opfDir, item.href)
    if (seen.has(href)) continue
    seen.add(href)
    index += 1
    const entry = toc.get(href)
    chapters.push({
      href,
      title: entry?.title || `第 ${index} 节`,
      depth: entry?.depth ?? 0
    })
  }

  // 没有 spine 的畸形书：退化成按目录顺序
  if (chapters.length === 0) {
    for (const [href, entry] of toc) chapters.push({ href, title: entry.title, depth: entry.depth })
  }

  return {
    chapters,
    fileCount: Object.keys(files).length,
    title,
    author,
    cover: findCoverHref(opf, opfDir, manifest, lookup) ?? undefined
  }
}

/** EPUB3 的 nav.xhtml：按 <ol> 的嵌套深度记层级 */
function collectNavToc(
  html: string,
  opfDir: string,
  navDir: string,
  out: Map<string, { title: string; depth: number }>
): void {
  // 只取 toc 那个 nav
  const navMatch = /<nav\b[^>]*epub:type\s*=\s*"toc"[^>]*>([\s\S]*?)<\/nav>/i.exec(html) ??
    /<nav\b[^>]*role\s*=\s*"doc-toc"[^>]*>([\s\S]*?)<\/nav>/i.exec(html)
  const body = navMatch ? navMatch[1] : html
  let depth = 0
  const tokens = body.matchAll(/<ol\b[^>]*>|<\/ol>|<a\b([^>]*)>([\s\S]*?)<\/a>/gi)
  for (const token of tokens) {
    const raw = token[0]
    if (/^<ol/i.test(raw)) {
      depth += 1
      continue
    }
    if (/^<\/ol/i.test(raw)) {
      depth = Math.max(1, depth - 1)
      continue
    }
    const attrs = parseAttrs(token[1] ?? '')
    if (!attrs.href) continue
    const href = resolveHref(navDir, attrs.href)
    const text = decodeXml((token[2] ?? '').replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim()
    if (!text || out.has(href)) continue
    out.set(href, { title: text, depth: Math.max(0, depth - 1) })
  }
  void opfDir
}

/** EPUB2 的 NCX：<navPoint> 的嵌套就是层级 */
function collectNcxToc(ncx: string, opfDir: string, out: Map<string, { title: string; depth: number }>): void {
  const navDir = dirOf(resolveHref(opfDir, 'toc.ncx'))
  let depth = -1
  const tokens = ncx.matchAll(/<navPoint\b[^>]*>|<\/navPoint>|<text[^>]*>([\s\S]*?)<\/text>|<content\b([^>]*?)\/?>/gi)
  let pendingTitle = ''
  for (const token of tokens) {
    const raw = token[0]
    if (/^<navPoint/i.test(raw)) {
      depth += 1
      pendingTitle = ''
      continue
    }
    if (/^<\/navPoint/i.test(raw)) {
      depth = Math.max(-1, depth - 1)
      continue
    }
    if (/^<text/i.test(raw)) {
      pendingTitle = decodeXml(token[1] ?? '').replace(/\s+/g, ' ').trim()
      continue
    }
    const attrs = parseAttrs(token[2] ?? '')
    if (!attrs.src) continue
    const href = resolveHref(navDir || opfDir, attrs.src)
    if (out.has(href)) continue
    out.set(href, { title: pendingTitle || '未命名', depth: Math.max(0, depth) })
  }
}
