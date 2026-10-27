import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import type { Dirent } from 'node:fs'
import { basename, dirname, extname, join, normalize, relative, resolve } from 'node:path'
import { app } from 'electron'
import { unzipSync } from 'fflate'
import { PDFDocument } from 'pdf-lib'
import type {
  Book,
  Bookend,
  BookendFacing,
  BookendSide,
  BookFormat,
  BookKind,
  BookRecord,
  BookStyle,
  ImportResult,
  LibraryIndex,
  Shelf,
  StatsDayCell,
  StatsInsightItem,
  StatsOverview,
  StatsRecentItem,
  UsageDelta,
  UsageKey,
  UsageStats
} from '@shared/types'
import { EDITABLE_FORMATS, FORMAT_LABEL, KIND_BY_FORMAT } from '@shared/types'
import { dayKey, dayKeyBefore, FINISHED_PERCENT, readingPercent } from '@shared/progress'
import { paletteColorFor } from '@shared/themes'
import { ensureDir, readJson, writeJson } from './store'
import { epubCoverLight, epubTextStats } from './epub'
import { persistDataUrlImage } from './files'
import { logLine } from './log'
import { ensureLibraryDir, libraryIndexFile, recordFile, userDataDir } from './settings'
import { buildSamplePdf, samplePdfPath } from './sample'
import {
  countWords,
  decodeText,
  detectFormat,
  estimatePages,
  extractHtmlAssetRefs,
  htmlTitleFor,
  htmlToPlainText,
  isRemoteRef,
  isSupported,
  sanitizeFileName,
  stableId,
  titleFromPath,
  uid,
  uniqueName
} from './util'

/* ------------------------------------------------------------ 内存缓存 */

let index: LibraryIndex | null = null

export function currentIndex(): LibraryIndex {
  if (!index) index = loadIndex()
  return index
}

function loadIndex(): LibraryIndex {
  const raw = readJson<Partial<LibraryIndex> | null>(libraryIndexFile(), null)
  let dir = raw?.libraryDir ?? ''
  if (!dir || !existsSync(dir)) dir = ensureLibraryDir(dir)
  const shelves = raw?.shelves && raw.shelves.length ? raw.shelves : defaultShelves()
  const next: LibraryIndex = {
    version: 1,
    libraryDir: dir,
    /*
     * 临时打开的书不进书架：上次运行遗留的一律丢掉。
     * 这就是"临时"的语义实现 —— 不额外存一份状态，只靠下次启动不再承认它们。
     */
    books: (raw?.books ?? []).map(normalizeBook).filter((book) => !book.temporary),
    shelves,
    // 老索引里没有书立这一项，补个空数组免得各处都要判空
    bookends: (raw?.bookends ?? []).filter((entry) => entry && typeof entry.id === 'string'),
    scannedAt: raw?.scannedAt ?? 0
  }
  return next
}

export function persist(next?: LibraryIndex): LibraryIndex {
  const value = next ?? currentIndex()
  index = value
  writeJson(libraryIndexFile(), value)
  return value
}

function defaultShelves(): Shelf[] {
  return [{ id: 'shelf_main', name: '我的书架', themeId: null, order: 0 }]
}

/**
 * 导入 EPUB 时把书里的封面图取出来落盘，返回 `asset:<文件名>`。
 *
 * 落盘而不是内联：一张封面动辄几百 KB，塞进 library.json 会让索引越来越难读写
 * （这也是 assets.ts 里那套"内联图片迁移"存在的原因）。
 * 取不到就返回 null，交给程序化封面，导入流程不受影响。
 */
function coverFromEpub(bookId: string, filePath: string, title: string): Partial<BookStyle> | null {
  try {
    // 轻量路径：只解出封面那几个条目，不解整本书（导入与后台补录都要快）
    const cover = epubCoverLight(filePath)
    if (!cover) {
      logLine('epub', `封面：这本书里没找到可用封面图 —— ${filePath}`)
      return null
    }
    logLine('epub', `封面：解出 ${Math.round(cover.dataUrl.length / 1365)}KB 图（${cover.width}×${cover.height}）`)
    const ref = persistDataUrlImage(cover.dataUrl, `${title}-cover`)
    if (!ref) return null
    const aspect = cover.width > 0 && cover.height > 0 ? cover.width / cover.height : undefined
    logLine('epub', `封面已取：${title} → ${ref}${aspect ? `（${cover.width}×${cover.height}）` : ''}`)
    return { coverImage: ref, ...(aspect ? { coverImageAspect: aspect } : null) }
  } catch (error) {
    logLine('epub', `封面提取失败 ${filePath}：${(error as Error).message}`)
    return null
  }
}

/**
 * 这本书是不是"该补录封面"：EPUB、文件还在、没有封面、而且没试过。
 *
 * 为什么需要补录：封面是在**导入那一刻**提取的，早先导入的书
 * （尤其是 `external=true` 的引用式导入，那时钩子只挂在 rescan 上）
 * 永远不会有封面，界面上就是一张空白/素净的程序化封面。
 */
export function needsCover(book: Book): boolean {
  return book.format === 'epub' && !book.missing && !book.style?.coverImage && !book.coverChecked
}

/**
 * 给一本书补录封面，返回更新后的书（没法补就只打上"试过"的标记）。
 *
 * 调用方（后台批次）负责 persist 与广播。
 */
export function applyEpubCover(book: Book): Book {
  const cover = coverFromEpub(book.id, book.path, book.title)
  return {
    ...book,
    coverChecked: true,
    style: cover ? { ...(book.style ?? {}), ...cover } : book.style
  }
}

function normalizeBook(raw: Partial<Book>): Book {
  const path = raw.path ?? ''
  const format = (raw.format ?? detectFormat(path)) as BookFormat
  return {
    id: raw.id ?? stableId(path),
    title: raw.title ?? titleFromPath(path),
    author: raw.author ?? '',
    // 系列名：只用于"同系列书脊等高"，老索引没有这个字段
    series: raw.series,
    /*
     * 下面这几个状态位必须原样带过来。
     *
     * 这里是**白名单重建**：漏掉哪个字段，写回时就把用户的操作悄悄抹掉了。已经栽过两次：
     *   - `temporary` 丢了 → 「临时打开」的书重开应用后变成正式书（用户报的"临时打开也会进书架"）；
     *   - `trashed`/`trashedAt` 丢了 → 回收站里的书重启后又回到书架。
     */
    coverChecked: raw.coverChecked,
    temporary: raw.temporary,
    trashed: raw.trashed,
    trashedAt: raw.trashedAt,
    format,
    // 老索引里没有 kind：按格式补一个默认值，用户改过的（已是合法值）原样保留
    kind: raw.kind === 'book' || raw.kind === 'note' ? raw.kind : KIND_BY_FORMAT[format] ?? 'book',
    path,
    external: raw.external ?? false,
    size: raw.size ?? 0,
    pageCount: raw.pageCount ?? 0,
    pageCountExact: raw.pageCountExact ?? false,
    words: raw.words ?? 0,
    addedAt: raw.addedAt ?? Date.now(),
    updatedAt: raw.updatedAt ?? Date.now(),
    lastOpenedAt: raw.lastOpenedAt ?? null,
    status: raw.status ?? 'unread',
    rating: raw.rating ?? 0,
    tags: raw.tags ?? [],
    summary: raw.summary ?? '',
    shelfId: raw.shelfId ?? 'shelf_main',
    // 手动排序位置：新书默认排到最后
    order: raw.order ?? raw.addedAt ?? Date.now(),
    style: raw.style ?? {},
    accent: raw.accent ?? paletteColorFor(raw.title ?? path),
    coverThumb: raw.coverThumb ?? null,
    missing: raw.missing ?? false
  }
}

/* ------------------------------------------------------------ 目录遍历 */

const MAX_DEPTH = 8

function walk(dir: string, out: string[], depth = 0): void {
  if (depth > MAX_DEPTH) return
  let entries: Dirent[]
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    /* 「_回收站」不参与扫描：里面的书是被移除的，不该被扫回来 */
    if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === TRASH_DIR) continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) walk(full, out, depth + 1)
    else if (entry.isFile() && isSupported(full)) out.push(full)
  }
}

/* ------------------------------------------------------------ 页数探测 */

function stripXml(xml: string): string {
  return xml
    .replace(/<w:p[ >][^>]*>/g, '\n')
    .replace(/<w:p\/>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export function readTextFile(filePath: string): string {
  const buf = readFileSync(filePath)
  return decodeText(buf)
}

export async function extractDocText(filePath: string): Promise<string | null> {
  try {
    const mod = await import('word-extractor')
    const WordExtractor = (mod as unknown as { default?: unknown }).default ?? mod
    const Ctor = WordExtractor as new () => { extract(p: string): Promise<{ getBody(): string }> }
    const extractor = new Ctor()
    const doc = await extractor.extract(filePath)
    return doc.getBody() ?? ''
  } catch {
    return null
  }
}

export interface ProbeResult {
  pages: number
  exact: boolean
  words: number
}

export async function probeFile(filePath: string): Promise<ProbeResult> {
  const format = detectFormat(filePath)
  try {
    switch (format) {
      case 'pdf': {
        const buf = readFileSync(filePath)
        const doc = await PDFDocument.load(buf, {
          ignoreEncryption: true,
          updateMetadata: false,
          throwOnInvalidObject: false
        })
        return { pages: Math.max(1, doc.getPageCount()), exact: true, words: 0 }
      }
      case 'docx': {
        const zip = unzipSync(new Uint8Array(readFileSync(filePath)))
        let pages = 0
        const appXml = zip['docProps/app.xml']
        if (appXml) {
          const m = decodeText(Buffer.from(appXml)).match(/<Pages>(\d+)<\/Pages>/)
          if (m) pages = Number(m[1])
        }
        const docXml = zip['word/document.xml']
        const text = docXml ? stripXml(decodeText(Buffer.from(docXml))) : ''
        const words = countWords(text)
        return { pages: pages > 0 ? pages : estimatePages(text), exact: pages > 0, words }
      }
      case 'doc': {
        const text = (await extractDocText(filePath)) ?? ''
        return { pages: estimatePages(text), exact: false, words: countWords(text) }
      }
      case 'epub': {
        // 章节数不是页数：一本 3 章的书可能有一两百页。
        // 用正文估算，与 Markdown / HTML 走同一套口径。
        const stats = epubTextStats(stableId(filePath), filePath)
        return { pages: stats.pages, exact: false, words: stats.words }
      }
      case 'image':
        return { pages: 1, exact: true, words: 0 }
      case 'html': {
        // 必须先去脚本/样式再计数，否则一个演示文稿外壳会被算成几百页
        const text = htmlToPlainText(readTextFile(filePath))
        return { pages: estimatePages(text), exact: false, words: countWords(text) }
      }
      default: {
        const text = readTextFile(filePath)
        return { pages: estimatePages(text), exact: false, words: countWords(text) }
      }
    }
  } catch {
    return { pages: 1, exact: false, words: 0 }
  }
}

/* ------------------------------------------------------------ 扫描 / 导入 */

export function rescan(): LibraryIndex {
  const current = currentIndex()
  current.libraryDir = ensureLibraryDir(current.libraryDir)
  const found: string[] = []
  walk(current.libraryDir, found)

  const byPath = new Map(current.books.map((b) => [b.path.toLowerCase(), b]))
  const nextBooks: Book[] = []
  const seen = new Set<string>()

  for (const filePath of found) {
    const key = filePath.toLowerCase()
    seen.add(key)
    const existing = byPath.get(key)
    let size = 0
    let mtime = Date.now()
    try {
      const st = statSync(filePath)
      size = st.size
      mtime = st.mtimeMs
    } catch {
      continue
    }
    if (existing) {
      const changed = existing.size !== size
      nextBooks.push({
        ...existing,
        path: filePath,
        size,
        updatedAt: changed ? Math.round(mtime) : existing.updatedAt,
        // 文件变化后重新探测页数
        pageCount: changed ? 0 : existing.pageCount,
        missing: false
      })
    } else {
      const format = detectFormat(filePath)
      const book: Book = normalizeBook({
        id: stableId(filePath),
        title: displayTitleFor(filePath),
        format,
        path: filePath,
        external: false,
        size,
        addedAt: Date.now(),
        updatedAt: Math.round(mtime),
        shelfId: current.shelves[0]?.id ?? 'shelf_main'
      })
      /*
       * EPUB 默认拿书里的封面图当封面（用户要求，优先"名叫 cover 的图"）。
       * 只在书里没有自带样式时才设，免得盖掉用户后来换的封面。
       */
      if (format === 'epub') {
        const cover = coverFromEpub(book.id, filePath, book.title)
        if (cover) book.style = { ...(book.style ?? {}), ...cover }
      }
      nextBooks.push(book)
    }
  }

  // 保留引用的库外文件；标记已消失的库内文件
  for (const book of current.books) {
    const key = book.path.toLowerCase()
    if (seen.has(key)) continue
    if (book.external) {
      nextBooks.push({ ...book, missing: !existsSync(book.path) })
    } else {
      nextBooks.push({ ...book, missing: true })
    }
  }

  // 索引按「书架层顺序 + 手动顺序」存放，展示时的排序由渲染层负责
  const dirOrder = new Map(current.shelves.map((s) => [s.id, s.order]))
  nextBooks.sort((a, b) => {
    const sa = dirOrder.get(a.shelfId) ?? 0
    const sb = dirOrder.get(b.shelfId) ?? 0
    if (sa !== sb) return sa - sb
    return (a.order ?? 0) - (b.order ?? 0)
  })

  const next: LibraryIndex = {
    ...current,
    books: nextBooks,
    scannedAt: Date.now()
  }
  return persist(next)
}

function addPath(filePath: string, copy: boolean, targetDir: string, shelves: Shelf[]): Book {
  let finalPath = filePath
  if (copy) {
    const name = uniqueName(targetDir, basename(filePath), existsSync)
    finalPath = join(targetDir, name)
    copyFileSync(filePath, finalPath)
    if (detectFormat(filePath) === 'html') copyHtmlSiblings(filePath, finalPath)
  }
  const st = statSync(finalPath)
  const book = normalizeBook({
    id: stableId(finalPath),
    title: displayTitleFor(finalPath),
    format: detectFormat(finalPath),
    path: finalPath,
    external: !copy,
    size: st.size,
    addedAt: Date.now(),
    updatedAt: Math.round(st.mtimeMs),
    shelfId: shelves[0]?.id ?? 'shelf_main'
  })
  /*
   * EPUB 默认拿书里的封面图当封面（用户要求，优先"名叫 cover 的图"）。
   * 这里和 rescan() 都要做：导入走 addPath（\`copy=false\` 的引用式导入不经过 rescan），
   * 而放进库目录的文件由 rescan 收编 —— 两处都是"新书第一次进书架"。
   */
  if (book.format === 'epub') {
    logLine('import', `新建书籍条目：${book.format} ${book.title}（external=${book.external}）`)
    const cover = coverFromEpub(book.id, book.path, book.title)
    if (cover) book.style = { ...(book.style ?? {}), ...cover }
  }
  return book
}

/**
 * 书名：HTML 笔记优先用文档自己的 `<title>`。
 * 否则 `goi/index.html` 会变成一本叫「index」的书，毫无信息量。
 */
function displayTitleFor(filePath: string): string {
  if (detectFormat(filePath) !== 'html') return titleFromPath(filePath)
  try {
    // `<title>` 一定在文档开头，读前 32 KB 足够，不必整份读进来
    const head = readFileSync(filePath, 'utf8').slice(0, 32 * 1024)
    return htmlTitleFor(filePath, head)
  } catch {
    return titleFromPath(filePath)
  }
}

/**
 * 复制 HTML 笔记时，把它引用的同级资源（.css/.js/图片，含 lib/ 这类子目录）一并带过来。
 *
 * DSH 生成的笔记经常是 `<link href="design-tokens.css">` + `<script src="kanji-data.js">`
 * 这种结构；只复制 .html 会得到一份没有样式、没有数据的空壳。
 * 这里只处理"不越出 HTML 所在目录"的相对路径，`../` 一律跳过（否则目录结构无法保真）。
 */
function copyHtmlSiblings(sourceHtml: string, targetHtml: string): string[] {
  const sourceDir = dirname(sourceHtml)
  const targetBase = dirname(targetHtml)
  let text: string
  try {
    text = readTextFile(sourceHtml)
  } catch {
    return []
  }

  const copied: string[] = []
  const seen = new Set<string>()

  for (const raw of extractHtmlAssetRefs(text)) {
    if (isRemoteRef(raw)) continue
    const clean = raw.split('#')[0].split('?')[0]
    if (!clean || seen.has(clean)) continue
    seen.add(clean)

    const source = resolve(sourceDir, clean)
    const relativePath = relative(sourceDir, source)
    if (!relativePath || relativePath.startsWith('..')) continue

    try {
      if (!existsSync(source) || !statSync(source).isFile()) continue
      const destination = join(targetBase, relativePath)
      if (normalize(destination) === normalize(targetHtml)) continue
      ensureDir(dirname(destination))
      copyFileSync(source, destination)
      copied.push(relativePath)
    } catch {
      /* 单个资源失败不影响导入 */
    }
  }

  return copied
}

/**
 * 临时打开一个文件：只为看一眼，不进书架。
 *
 * 实现上就是"带 temporary 标记地收进索引，并且**下次启动丢掉**"（见 loadIndex）。
 * 好处是阅读器、书签、进度、取封面这些能力全都能照用，不需要为"临时"单开一条渲染通道。
 * 路径已经在书架里（不管是不是临时的）就直接返回那一本，不重复建条目。
 */
export function openTemporary(filePath: string): Book {
  const current = currentIndex()
  const key = filePath.toLowerCase()
  const existing = current.books.find((b) => b.path.toLowerCase() === key)
  if (existing) return existing

  if (!existsSync(filePath)) throw new Error('文件不存在')
  if (!isSupported(filePath)) throw new Error(`不支持的格式 ${extname(filePath) || '(无扩展名)'}`)

  // 引用式收进来（不复制文件），再打上临时标记
  const book = addPath(filePath, false, current.libraryDir, current.shelves)
  book.temporary = true
  current.books = [...current.books, book]
  persist(current)
  logLine('import', `临时打开：${book.title}（${book.format}）`)
  return book
}

export function importPaths(paths: string[], copy: boolean): ImportResult {
  logLine('import', `开始导入 ${paths.length} 个路径（copy=${copy}）`)
  const current = currentIndex()
  current.libraryDir = ensureLibraryDir(current.libraryDir)
  const targetDir = current.libraryDir
  const existing = new Set(current.books.map((b) => b.path.toLowerCase()))
  const added: Book[] = []
  const skipped: { path: string; reason: string }[] = []

  for (const p of paths) {
    try {
      if (!existsSync(p)) {
        skipped.push({ path: p, reason: '文件不存在' })
        continue
      }
      const st = statSync(p)
      if (st.isDirectory()) {
        const nested: string[] = []
        walk(p, nested)
        for (const n of nested) {
          if (existing.has(n.toLowerCase())) {
            skipped.push({ path: n, reason: '已在书架中' })
            continue
          }
          const book = addPath(n, copy, targetDir, current.shelves)
          existing.add(book.path.toLowerCase())
          added.push(book)
        }
        continue
      }
      if (!isSupported(p)) {
        skipped.push({ path: p, reason: `不支持的格式 ${extname(p) || '(无扩展名)'}` })
        continue
      }
      if (existing.has(p.toLowerCase())) {
        logLine('import', `跳过（已在书架中）：${p}`)
        skipped.push({ path: p, reason: '已在书架中' })
        continue
      }
      const book = addPath(p, copy, targetDir, current.shelves)
      existing.add(book.path.toLowerCase())
      added.push(book)
    } catch (error) {
      skipped.push({ path: p, reason: (error as Error).message })
    }
  }

  // 新书按导入顺序排到手动排序的末尾
  let nextOrder = current.books.reduce((max, b) => Math.max(max, b.order ?? 0), 0)
  for (const book of added) {
    nextOrder += 1
    book.order = nextOrder
  }
  current.books = [...current.books, ...added]
  persist(current)
  /*
   * 一行日志说明这次导入取封面取到了几本。
   * 用户之前只能靠"导入太快/太慢"来猜有没有取封面 —— 有这行就不必猜了。
   */
  const epubs = added.filter((b) => b.format === 'epub')
  if (epubs.length > 0) {
    const got = epubs.filter((b) => Boolean(b.style?.coverImage)).length
    logLine('epub', `导入取封面：EPUB ${epubs.length} 本，取到 ${got} 本`)
  }
  return { added, skipped, index: current }
}

/* ---------------------------------------------------------- 书立（隔断） */

/**
 * 在某本书之后插入一个书立。
 * 位置取"这本书"与"它后面那一件"的中点，所以反复往同一处插也不会撞号，
 * 更不需要把整层的 order 重排一遍。
 */
/**
 * 在某一侧加一个书立。
 *
 * 位置取"锚点"与"那一侧相邻的一件"的中点，所以反复往同一处加也不会撞号，
 * 更不需要把整层的 order 重排一遍。
 */
export function addBookend(
  shelfId: string,
  anchorBookId: string | null,
  side: BookendSide = 'right',
  facing: BookendFacing = 'both'
): LibraryIndex {
  const current = currentIndex()
  const bookends = current.bookends ?? []

  const items: { order: number; id: string }[] = [
    ...current.books.filter((b) => b.shelfId === shelfId).map((b) => ({ order: b.order ?? 0, id: b.id })),
    ...bookends.filter((e) => e.shelfId === shelfId).map((e) => ({ order: e.order, id: e.id }))
  ].sort((a, b) => a.order - b.order)

  let order: number
  const anchorIndex = anchorBookId ? items.findIndex((item) => item.id === anchorBookId) : -1
  if (anchorIndex < 0) {
    // 没锚点：右书立放到这一层最后，左书立放到最前
    order = side === 'right' ? (items[items.length - 1]?.order ?? 0) + 1 : (items[0]?.order ?? 1) - 1
  } else {
    const anchor = items[anchorIndex]
    const neighbour = side === 'right' ? items[anchorIndex + 1] : items[anchorIndex - 1]
    order = neighbour
      ? (anchor.order + neighbour.order) / 2
      : anchor.order + (side === 'right' ? 1 : -1)
  }

  current.bookends = [
    ...bookends,
    // 默认空位给得小一点：书立本身就该是薄薄一片，空间由对面那个书立一起凑
    { id: uid('bd'), shelfId, order, side, anchorBookId, gap: 16 }
  ]
  persist(current)
  return current
}

export function updateBookend(
  id: string,
  patch: Partial<Pick<Bookend, 'gap' | 'label' | 'side' | 'breakLine' | 'breakLineCover' | 'facing'>>
): LibraryIndex {
  const current = currentIndex()
  current.bookends = (current.bookends ?? []).map((entry) =>
    entry.id === id ? { ...entry, ...patch } : entry
  )
  return persist(current)
}

/**
 * 把书立左右挪一位。
 *
 * 同一层里的书与书立共用一个 order 序列，所以"挪一位"就是把相邻两件的
 * order 互换 —— 不用重排整层，也不用管中间隔了几本书。
 */
export function moveBookend(id: string, direction: -1 | 1): LibraryIndex {
  const current = currentIndex()
  const bookends = current.bookends ?? []
  const target = bookends.find((entry) => entry.id === id)
  if (!target) return current

  const items: { order: number; id: string; kind: 'book' | 'bookend' }[] = [
    ...current.books
      .filter((b) => b.shelfId === target.shelfId)
      .map((b) => ({ order: b.order ?? 0, id: b.id, kind: 'book' as const })),
    ...bookends
      .filter((e) => e.shelfId === target.shelfId)
      .map((e) => ({ order: e.order, id: e.id, kind: 'bookend' as const }))
  ].sort((a, b) => a.order - b.order)

  const index = items.findIndex((item) => item.id === id)
  const neighbour = items[index + direction]
  if (index < 0 || !neighbour) return current

  const mine = target.order
  const theirs = neighbour.order
  current.bookends = bookends.map((entry) => (entry.id === id ? { ...entry, order: theirs } : entry))
  current.books = current.books.map((book) =>
    book.id === neighbour.id ? { ...book, order: mine } : book
  )
  return persist(current)
}

export function removeBookend(id: string): LibraryIndex {
  const current = currentIndex()
  current.bookends = (current.bookends ?? []).filter((entry) => entry.id !== id)
  return persist(current)
}

/**
 * 一次移除所有"找不到文件"的书。
 *
 * 只从书架索引里删，绝不动磁盘 —— 文件已经不在了，也没什么可动的。
 * 返回被移除的书，好让界面能如实说"移除了哪几本"。
 */
export function removeMissing(): { removed: Book[]; index: LibraryIndex } {
  const current = currentIndex()
  const missing = current.books.filter((book) => book.missing || !existsSync(book.path))
  if (missing.length === 0) return { removed: [], index: current }
  const ids = new Set(missing.map((book) => book.id))
  current.books = current.books.filter((book) => !ids.has(book.id))
  // 它们的书立也一并清掉，免得留个孤零零的挡板
  current.bookends = (current.bookends ?? []).filter(
    (entry) => !entry.anchorBookId || !ids.has(entry.anchorBookId)
  )
  return { removed: missing, index: persist(current) }
}

/**
 * 手动排序：把给定的 id 顺序写进 order。
 * 只重排被点名的书（它们的新 order 依次递增），其余书的相对次序不变。
 */
export function reorderBooks(orderedIds: string[]): LibraryIndex {
  const current = currentIndex()
  const all = [...current.books].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
  const picked = orderedIds
    .map((id) => all.find((b) => b.id === id))
    .filter((b): b is Book => Boolean(b))
  if (picked.length === 0) return current

  // 把被点名的书按新顺序插回它们原本占据的位置
  const slots: number[] = []
  all.forEach((book, index) => {
    if (picked.some((p) => p.id === book.id)) slots.push(index)
  })
  const next = [...all]
  slots.forEach((slot, i) => {
    next[slot] = picked[i]
  })
  next.forEach((book, index) => {
    book.order = index
  })
  current.books = next
  return persist(current)
}

export function createNote(kind: 'md' | 'txt', title?: string): Book {
  const current = currentIndex()
  current.libraryDir = ensureLibraryDir(current.libraryDir)
  const stamp = new Date()
  const fallback = `新笔记 ${stamp.getFullYear()}-${String(stamp.getMonth() + 1).padStart(2, '0')}-${String(
    stamp.getDate()
  ).padStart(2, '0')} ${String(stamp.getHours()).padStart(2, '0')}${String(stamp.getMinutes()).padStart(2, '0')}`
  const rawName = sanitizeFileName(title?.trim() || fallback)
  const ext = kind === 'md' ? '.md' : '.txt'
  const fileName = uniqueName(current.libraryDir, `${rawName}${ext}`, existsSync)
  const fullPath = join(current.libraryDir, fileName)
  const body =
    kind === 'md'
      ? `# ${rawName}\n\n> 记于 ${stamp.toLocaleString('zh-CN')}\n\n`
      : `${rawName}\n\n`
  writeFileSync(fullPath, body, 'utf8')
  const book = normalizeBook({
    id: stableId(fullPath),
    title: rawName,
    format: kind,
    path: fullPath,
    external: false,
    size: Buffer.byteLength(body, 'utf8'),
    pageCount: 1,
    words: countWords(body),
    addedAt: Date.now(),
    updatedAt: Date.now(),
    lastOpenedAt: Date.now(),
    status: 'reading',
    shelfId: current.shelves[0]?.id ?? 'shelf_main',
    style: {}
  })
  current.books = [...current.books, book]
  persist(current)
  return book
}

export function updateBook(id: string, patch: Partial<Book>): Book {
  const current = currentIndex()
  const at = current.books.findIndex((b) => b.id === id)
  if (at < 0) throw new Error(`未找到书籍 ${id}`)
  const merged: Book = { ...current.books[at], ...patch, id, updatedAt: Date.now() }
  if (patch.accent === undefined && patch.title && patch.title !== current.books[at].title) {
    merged.accent = paletteColorFor(patch.title)
  }
  current.books[at] = merged
  persist(current)
  return merged
}

/** 藏书目录下专门放被移除文件的文件夹（资源管理器里一眼能找到、也方便自己清空） */
export const TRASH_DIR = '_回收站'

function trashDirOf(libraryDir: string): string {
  const dir = join(libraryDir, TRASH_DIR)
  try {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  } catch {
    /* 建不出来就退化成"只标记、不搬文件" */
  }
  return dir
}

/** 把文件挪进回收站目录（重名自动加后缀）；引用式或文件不在则返回 null */
function moveToTrash(book: Book, libraryDir: string): string | null {
  if (book.external || !existsSync(book.path)) return null
  try {
    const dir = trashDirOf(libraryDir)
    const target = join(dir, uniqueName(dir, basename(book.path), existsSync))
    renameSync(book.path, target)
    return target
  } catch {
    return null
  }
}

/**
 * 从书架移除。
 *
 * `deleteFiles = false`（默认）：**移入回收站** —— 复制入库的文件挪进 `_回收站`，
 * 条目保留并打上 trashed 标记；重新扫描不会把它收回来（walk 会跳过那个目录）。
 * `deleteFiles = true`：彻底删除（文件 + 条目 + 阅读记录）。
 */
export function removeBooks(ids: string[], deleteFiles: boolean): LibraryIndex {
  const current = currentIndex()
  const remove = new Set(ids)

  if (deleteFiles) {
    for (const book of current.books) {
      if (!remove.has(book.id)) continue
      if (!book.external) {
        try {
          rmSync(book.path, { force: true })
        } catch {
          /* 文件被占用时保留 */
        }
      }
      try {
        rmSync(recordFile(book.id), { force: true })
      } catch {
        /* 忽略 */
      }
    }
    current.books = current.books.filter((b) => !remove.has(b.id))
    return persist(current)
  }

  for (const book of current.books) {
    if (!remove.has(book.id) || book.temporary) continue
    const moved = moveToTrash(book, current.libraryDir)
    book.trashed = true
    book.trashedAt = Date.now()
    if (moved) book.path = moved
    logLine(
      'trash',
      `移入回收站：${book.title}${moved ? '（文件已挪进 _回收站）' : '（引用式，文件留在原处）'}`
    )
  }
  return persist(current)
}

/** 从回收站还原：文件挪回藏书目录，清掉标记 */
export function restoreBooks(ids: string[]): LibraryIndex {
  const current = currentIndex()
  const want = new Set(ids)
  for (const book of current.books) {
    if (!want.has(book.id) || !book.trashed) continue
    if (!book.external && book.path.includes(TRASH_DIR)) {
      try {
        const target = join(
          current.libraryDir,
          uniqueName(current.libraryDir, basename(book.path), existsSync)
        )
        renameSync(book.path, target)
        book.path = target
      } catch {
        /* 搬不动就保持原路径，至少还能读 */
      }
    }
    delete book.trashed
    delete book.trashedAt
    logLine('trash', `从回收站还原：${book.title}`)
  }
  return persist(current)
}

/** 彻底删除：文件（含回收站里的）+ 条目 + 阅读记录 */
export function purgeBooks(ids: string[]): LibraryIndex {
  return removeBooks(ids, true)
}

export function chooseLibraryDir(dir: string): LibraryIndex {
  const current = currentIndex()
  const nextDir = ensureLibraryDir(dir)
  // 换目录时，把还在旧目录里的书标记为外部引用，保留用户数据
  const books = current.books.map((b) =>
    b.external ? { ...b, missing: !existsSync(b.path) } : { ...b, external: true, missing: !existsSync(b.path) }
  )
  const next: LibraryIndex = { ...current, libraryDir: nextDir, books }
  persist(next)
  return rescan()
}

export function saveShelves(shelves: Shelf[]): LibraryIndex {
  const current = currentIndex()
  const ids = new Set(shelves.map((s) => s.id))
  const fallback = shelves[0]?.id ?? 'shelf_main'
  current.shelves = shelves.map((s, i) => ({ ...s, order: i }))
  current.books = current.books.map((b) => (ids.has(b.shelfId) ? b : { ...b, shelfId: fallback }))
  // 被删掉的层，它的书立也一并清掉
  current.bookends = (current.bookends ?? []).filter((entry) => ids.has(entry.shelfId))
  return persist(current)
}

/* ------------------------------------------------------------ 读书记录 */

export function emptyRecord(bookId: string): BookRecord {
  return {
    bookId,
    progress: { page: 1, scrollRatio: 0, zoom: 0, rotation: 0 },
    usage: {},
    bookmarks: [],
    annotations: {},
    outline: [],
    updatedAt: Date.now()
  }
}

/** 把一条用量补齐成完整结构（老记录里可能只有一半字段） */
function normalizeUsage(raw: Partial<UsageStats> | undefined): UsageStats {
  return {
    seconds: Math.max(0, Math.round(raw?.seconds ?? 0)),
    opens: Math.max(0, Math.round(raw?.opens ?? 0)),
    pages: Math.max(0, Math.round(raw?.pages ?? 0)),
    words: Math.max(0, Math.round(raw?.words ?? 0)),
    lastAt: raw?.lastAt ?? null,
    days: { ...(raw?.days ?? {}) }
  }
}

export function getRecord(bookId: string): BookRecord {
  const raw = readJson<Partial<BookRecord> | null>(recordFile(bookId), null)
  if (!raw) return emptyRecord(bookId)
  const usage: Partial<Record<UsageKey, UsageStats>> = {}
  for (const key of ['asBook', 'asNote'] as UsageKey[]) {
    if (raw.usage?.[key]) usage[key] = normalizeUsage(raw.usage[key])
  }
  return {
    ...emptyRecord(bookId),
    ...raw,
    bookId,
    progress: { page: 1, scrollRatio: 0, zoom: 0, rotation: 0, ...(raw.progress ?? {}) },
    usage,
    bookmarks: raw.bookmarks ?? [],
    annotations: raw.annotations ?? {},
    outline: raw.outline ?? []
  }
}

export function saveRecord(record: BookRecord): BookRecord {
  /*
   * usage 只由 recordUsage 维护，这里一律沿用盘上那份。
   *
   * 渲染层保存进度/批注时手里那份记录往往是**挂载时的快照**，
   * 中间通过 recordUsage 新记的次数、页数、字数都不在里面 ——
   * 整份覆盖就会把它们抹掉（我第一版就是这样，打开次数和页数一直是 0）。
   */
  const stored = readJson<Partial<BookRecord> | null>(recordFile(record.bookId), null)
  const value: BookRecord = {
    ...record,
    usage: stored?.usage ?? record.usage ?? {},
    updatedAt: Date.now()
  }
  writeJson(recordFile(record.bookId), value)
  return value
}

/**
 * 累加用量。
 *
 * 渲染层只上报**增量**，由这里读改写 —— 阅读进度、批注、用量是三个不同的
 * 写入方，如果各自整份覆盖，谁后写谁的就算数，前面的全丢。
 */
export function recordUsage(bookId: string, key: UsageKey, delta: UsageDelta): BookRecord {
  const record = getRecord(bookId)
  const current = normalizeUsage(record.usage?.[key])
  const at = Date.now()
  const today = dayKey(at)
  const seconds = Math.max(0, Math.round(delta.seconds ?? 0))
  const next: UsageStats = {
    seconds: current.seconds + seconds,
    opens: current.opens + Math.max(0, Math.round(delta.opens ?? 0)),
    pages: current.pages + Math.max(0, Math.round(delta.pages ?? 0)),
    words: current.words + Math.max(0, Math.round(delta.words ?? 0)),
    lastAt: at,
    // 只有真的产生了时长才记到某一天，免得"打开一下"就点亮一格
    days: seconds > 0 ? { ...current.days, [today]: (current.days[today] ?? 0) + seconds } : current.days
  }
  record.usage = { ...(record.usage ?? {}), [key]: next }
  /*
   * 这里**直接落盘**，不走 saveRecord。
   * saveRecord 的职责是"别让渲染层把 usage 覆盖掉"，所以它会沿用盘上那份 ——
   * 而这里恰恰就是要写 usage，绕过去才不会把自己刚算好的结果丢掉。
   */
  record.updatedAt = at
  writeJson(recordFile(bookId), record)
  return record
}

/** 每本书的阅读进度百分比，书架与列表画进度用（一趟扫完，别一本一个 IPC） */
export function progressMap(): Record<string, number> {
  const out: Record<string, number> = {}
  for (const book of currentIndex().books) {
    const record = getRecord(book.id)
    out[book.id] = readingPercent(book, record)
  }
  return out
}

/* ------------------------------------------------------------ 统计总览 */

const DAYS_WINDOW = 182

/** 一天要算"打卡"，至少要累计这么久 —— 打开看一眼不算 */
export const STREAK_MIN_SECONDS = 5 * 60

/**
 * 统计总览。
 *
 * 直接扫所有记录算出来 —— 记录是每本一个几十字节的小 JSON，几百本也就几十毫秒；
 * 为此再维护一份全局索引反而要多操心一致性。
 * 每本书的记录只读一次，别在循环里反复读盘。
 */
export function statsOverview(): StatsOverview {
  const index = currentIndex()
  const generatedAt = Date.now()
  const today = dayKey(generatedAt)

  const days: Record<string, StatsDayCell> = {}
  for (let i = DAYS_WINDOW - 1; i >= 0; i -= 1) {
    const date = dayKeyBefore(i, generatedAt)
    days[date] = { date, seconds: 0, opens: 0, words: 0, readingSeconds: 0, noteSeconds: 0 }
  }
  // 某天有哪些书/笔记动过（去重后才是"打开数"）
  const activeByDay = new Map<string, Set<string>>()

  const reading = { books: 0, finished: 0, seconds: 0, opens: 0, pages: 0 }
  const notes = { count: 0, seconds: 0, opens: 0, words: 0, wordsToday: 0 }
  const inProgress: StatsOverview['reading']['inProgress'] = []
  const noteItems: StatsOverview['notes']['items'] = []
  const recent: StatsRecentItem[] = []
  const bookmarkItems: StatsOverview['bookmarks'] = []
  /* 心得：正文标注 + 写了备注的书签 */
  const insightItems: StatsOverview['insights']['items'] = []

  for (const book of index.books) {
    /* 临时打开的书与回收站里的书都不计入统计：它们都不在书架上 */
    if (book.temporary || book.trashed) continue
    const record = getRecord(book.id)
    const percent = readingPercent(book, record)

    // 书签：与用量无关，任何书/笔记都可能挂着几个
    for (const bookmark of record.bookmarks ?? []) {
      bookmarkItems.push({
        id: bookmark.id,
        bookId: book.id,
        bookTitle: book.title,
        kind: book.kind,
        label: bookmark.label,
        excerpt: bookmark.excerpt,
        at: bookmark.createdAt
      })
      /*
       * 写了备注的书签也算一条心得 —— 那是"我有想法"，不只是"我读到这儿"。
       */
      if (bookmark.note) {
        insightItems.push({
          id: bookmark.id,
          bookId: book.id,
          bookTitle: book.title,
          text: bookmark.excerpt ?? bookmark.label,
          note: bookmark.note,
          kind: 'note',
          at: bookmark.createdAt
        })
      }
    }

    /*
     * 正文里划出来的标注（EPUB 的文字标注 + PDF 的文字层标注）也是心得。
     * 这两类以前只存在记录里、统计页完全看不到。
     */
    for (const mark of record.highlights ?? []) {
      insightItems.push({
        id: mark.id,
        bookId: book.id,
        bookTitle: book.title,
        text: mark.text,
        kind: mark.style === 'underline' ? 'underline' : mark.style === 'wavy' ? 'wavy' : 'highlight',
        at: mark.createdAt
      })
    }
    for (const mark of record.pdfHighlights ?? []) {
      insightItems.push({
        id: mark.id,
        bookId: book.id,
        bookTitle: book.title,
        text: mark.text,
        kind: mark.style === 'underline' ? 'underline' : mark.style === 'wavy' ? 'wavy' : 'highlight',
        at: mark.createdAt
      })
    }

    for (const key of ['asBook', 'asNote'] as UsageKey[]) {
      const raw = record.usage?.[key]
      if (!raw) continue
      const usage = normalizeUsage(raw)
      const kind: BookKind = key === 'asBook' ? 'book' : 'note'

      recent.push({
        id: book.id,
        title: book.title,
        kind,
        format: book.format,
        at: usage.lastAt ?? 0,
        seconds: usage.seconds,
        percent: kind === 'book' ? percent : null
      })

      for (const [date, seconds] of Object.entries(usage.days)) {
        const cell = days[date]
        if (cell) {
          cell.seconds += seconds
          // 读写各记一份：打卡要按类别分开算
          if (kind === 'book') cell.readingSeconds += seconds
          else cell.noteSeconds += seconds
        }
        const set = activeByDay.get(date)
        if (set) set.add(`${book.id}:${key}`)
        else activeByDay.set(date, new Set([`${book.id}:${key}`]))
      }

      if (kind === 'book') {
        reading.books += 1
        reading.seconds += usage.seconds
        reading.opens += usage.opens
        reading.pages += usage.pages
        if (percent >= FINISHED_PERCENT) reading.finished += 1
        else inProgress.push({ id: book.id, title: book.title, percent, at: usage.lastAt ?? 0 })
      } else {
        notes.count += 1
        notes.seconds += usage.seconds
        notes.opens += usage.opens
        notes.words += usage.words
        noteItems.push({ id: book.id, title: book.title, words: usage.words, at: usage.lastAt ?? 0 })
      }
    }
  }

  for (const [date, set] of activeByDay) {
    const cell = days[date]
    if (cell) cell.opens = set.size
  }

  recent.sort((a, b) => b.at - a.at)
  inProgress.sort((a, b) => b.at - a.at)
  noteItems.sort((a, b) => b.at - a.at)
  bookmarkItems.sort((a, b) => b.at - a.at)

  return {
    generatedAt,
    reading: { ...reading, inProgress: inProgress.slice(0, 12) },
    notes: { ...notes, items: noteItems.slice(0, 12) },
    recent: recent.slice(0, 12),
    bookmarks: bookmarkItems.slice(0, 12),
    insights: {
      count: insightItems.length,
      items: [...insightItems].sort((a, b) => b.at - a.at).slice(0, 12)
    },
    days: Object.values(days),
    streak: computeStreak(days, today, (cell) => cell.seconds),
    readingStreak: computeStreak(days, today, (cell) => cell.readingSeconds),
    noteStreak: computeStreak(days, today, (cell) => cell.noteSeconds),
    streakMinSeconds: STREAK_MIN_SECONDS
  }
}

/**
 * 连续打卡天数。
 *
 * `pick` 决定看哪一项时长（总量 / 只算读书 / 只算写字），
 * 并且**必须累计到 STREAK_MIN_SECONDS 才算这一天打过卡** ——
 * 顺手打开看一眼就点亮一格的话，热力图会变成一片噪声。
 * 今天还没达标时从昨天开始数，免得"今天还没开始"就把连击清零。
 */
function computeStreak(
  days: Record<string, StatsDayCell>,
  today: string,
  pick: (cell: StatsDayCell) => number
): number {
  const dates = Object.keys(days).sort()
  let cursor = dates.indexOf(today)
  if (cursor < 0) return 0
  if (pick(days[today]) < STREAK_MIN_SECONDS) cursor -= 1
  let streak = 0
  for (let i = cursor; i >= 0; i -= 1) {
    const cell = days[dates[i]]
    if (!cell || pick(cell) < STREAK_MIN_SECONDS) break
    streak += 1
  }
  return streak
}

/* ------------------------------------------------------------ 附加信息 */

export function ensureUserDirs(): void {
  ensureDir(userDataDir())
}

export function formatLabelOf(book: Book): string {
  return FORMAT_LABEL[book.format] ?? '文件'
}

export function isEditable(book: Book): boolean {
  return EDITABLE_FORMATS.includes(book.format)
}

export function newShelf(name: string, existing: Shelf[]): Shelf {
  return { id: uid('shelf'), name, themeId: null, order: existing.length }
}

/* ------------------------------------------------------------ 首次运行 */

const SEED_MARKER = '.bookscent-seeded'

/** 示例 PDF 里嵌入的那张小图：优先用打包进应用的应用图标 */
function resolveSampleIcon(): string {
  const roots: string[] = []
  try {
    roots.push(app.getAppPath())
  } catch {
    /* 忽略 */
  }
  try {
    if (process.resourcesPath) roots.push(process.resourcesPath)
  } catch {
    /* 忽略 */
  }
  for (const root of roots) {
    for (const rel of ['build/icon.png', 'icon.png', 'app/build/icon.png']) {
      const candidate = join(root, rel)
      if (existsSync(candidate)) return candidate
    }
  }
  return ''
}

/**
 * 首次启动时在藏书目录里放三份示例，让书架一开始就有东西可看、可读、可编辑。
 * 只做一次（留下标记文件），用户删掉示例后不会再生成。
 */
export async function seedFirstRun(): Promise<void> {
  const index = currentIndex()
  const marker = join(userDataDir(), SEED_MARKER)
  if (existsSync(marker)) return
  const dir = ensureLibraryDir(index.libraryDir)

  const welcome = `# 欢迎来到书香笔记

> 一座属于你自己的书房。书架上的每一本书，都是你读过或写下的一页。

## 书架怎么用

- **点击书脊** 打开阅读或编辑；**右键书脊** 打开书籍菜单。
- 书脊的**厚薄由页数决定**：PDF 与 Word 读真实页数，Markdown / 纯文本按字数估算。
- 想更漂亮，可以在「书籍样式」里给任意一本书换上**自定义书脊图片**或**封面**。

## 支持哪些格式

| 格式 | 打开方式 |
| --- | --- |
| \`.md\` \`.markdown\` | 内置编辑器，左侧写作、右侧实时预览 |
| \`.txt\` | 内置纯文本编辑器 |
| \`.pdf\` | 内置阅读器：书签、绘图批注、导出页面图片 |
| \`.doc\` \`.docx\` | 文字预览，可一键交给 Word 打开 |

## 一点小技巧

1. 按 \`Ctrl+S\` 保存当前笔记，按 \`Ctrl+E\` 打开或关闭预览。
2. 在 PDF 阅读器里按 \`B\` 给当前页加书签，按 \`P\` 切换到画笔。
3. 主题、书架木板、书脊样式都可以在右上角的**外观**里随心情更换。

---

*书香笔记 v0.9.6*
`

  const guide = `# 外观与个性化

## 三类主题，各管一段

1. **应用主题** — 决定窗口底色、文字、按钮与强调色。
2. **书架主题** — 决定木板纹理、书架内壁与整体木色。
3. **书籍样式** — 决定书脊预设、烫金颜色、书脊装饰与字体。

三者可以自由组合：例如「墨夜」的应用主题，配「胡桃木」的书架，再给书脊换上「竹节烫金」。

## 自定义到什么程度

- 任意主题都可以在预设基础上**微调每一个颜色**。
- 每本书都可以单独覆盖样式，不会影响书架上的其他书。
- 书脊贴图与封面图片支持任意 PNG / JPG，直接拖进来即可。

> 提示：把常用的一套外观**导出为 JSON**，换电脑时再导入回来，书房就跟着你走。
`

  const note = `读书笔记 · 示例
=========================

书名：《查令十字街84号》
作者：海莲·汉芙

【摘抄】
你们若恰好路经查令十字街84号，请代我献上一吻，
我亏欠她良多……

【我的想法】
一间旧书店之所以动人，不在于书有多全，
而在于有人愿意为一本你还没读过的书，等你二十年。

——
试着把这份文件当成你的随手记：Ctrl+S 保存，
改动会立刻写回原文件，不经过任何转换。
`

  const seeds: { name: string; body: string; format: 'md' | 'txt' }[] = [
    { name: '欢迎使用书香笔记.md', body: welcome, format: 'md' },
    { name: '外观与个性化.md', body: guide, format: 'md' },
    { name: '读书笔记示例.txt', body: note, format: 'txt' }
  ]

  const added: Book[] = []
  for (const seed of seeds) {
    const full = join(dir, seed.name)
    if (!existsSync(full)) writeFileSync(full, seed.body, 'utf8')
    added.push(
      normalizeBook({
        id: stableId(full),
        title: seed.name.replace(/\.(md|txt)$/i, ''),
        format: seed.format,
        path: full,
        external: false,
        size: Buffer.byteLength(seed.body, 'utf8'),
        pageCount: estimatePages(seed.body),
        pageCountExact: false,
        words: countWords(seed.body),
        addedAt: Date.now(),
        updatedAt: Date.now(),
        shelfId: index.shelves[0]?.id ?? 'shelf_main'
      })
    )
  }

  const existing = new Set(index.books.map((b) => b.path.toLowerCase()))
  const merged = [...index.books]
  for (const book of added) {
    if (!existing.has(book.path.toLowerCase())) merged.push(book)
  }

  // 再放一份 24 页的示例 PDF，让书架一开始就有真正的"厚书"可以试阅读器
  try {
    const pdfPath = samplePdfPath(dir)
    if (!existsSync(pdfPath)) {
      const bytes = await buildSamplePdf(resolveSampleIcon())
      writeFileSync(pdfPath, Buffer.from(bytes))
    }
    if (!existing.has(pdfPath.toLowerCase())) {
      merged.push(
        normalizeBook({
          id: stableId(pdfPath),
          title: '示例文档 · The Shape of a Shelf',
          author: 'Bookscent',
          format: 'pdf',
          path: pdfPath,
          external: false,
          size: statSync(pdfPath).size,
          pageCount: 24,
          pageCountExact: true,
          probeSize: statSync(pdfPath).size,
          summary: '一份 24 页的示例 PDF：目录、页码、内嵌图片，用来试书签、批注与图片提取。',
          addedAt: Date.now(),
          updatedAt: Date.now(),
          shelfId: index.shelves[0]?.id ?? 'shelf_main'
        })
      )
    }
  } catch {
    /* 示例 PDF 生成失败不影响启动 */
  }

  persist({ ...index, books: merged })
  writeFileSync(marker, new Date().toISOString(), 'utf8')
}
