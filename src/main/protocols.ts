import { protocol } from 'electron'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { dirname, extname, isAbsolute, join, normalize, relative, resolve, sep } from 'node:path'
import {
  ASSET_SCHEME,
  EPUB_URL_PREFIX,
  NOTE_SCHEME,
  decodeNotePath,
  encodeNotePath,
  noteHostFor
} from '@shared/noteUrl'
import { epubFile, hasEpub, loadEpub } from './epub'
import { assetsDir } from './settings'
import { currentIndex } from './library'
import { logLine } from './log'
import { extractHtmlAssetRefs, isRemoteRef } from './util'

/* ------------------------------------------------------------ 应用自身资源 */

export const APP_SCHEME = 'app'
export const APP_ORIGIN = `${APP_SCHEME}://bundle`

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.xhtml': 'text/html; charset=utf-8',
  '.xht': 'text/html; charset=utf-8',
  '.opf': 'application/oebps-package+xml; charset=utf-8',
  '.ncx': 'application/x-dtbncx+xml; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.cjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',  '.wasm': 'application/wasm',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.pdf': 'application/pdf',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm'
}

export function mimeFor(filePath: string): string {
  return MIME_TYPES[extname(filePath).toLowerCase()] ?? 'application/octet-stream'
}

/**
 * 两个自定义协议都必须在 app ready 之前登记。
 * `standard` + `secure` 让它们拥有正常的来源语义：
 * ES Module Worker、fetch、CSP 的 'self'、localStorage 才能正常工作。
 */
export function registerProtocolSchemes(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: APP_SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true }
    },
    {
      scheme: NOTE_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true,
        stream: true,
        // HTML 笔记是独立页面，允许它自己存 localStorage（学习进度之类）
        allowServiceWorkers: false
      }
    },
    {
      scheme: ASSET_SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true }
    }
  ])
}

export function registerProtocolHandlers(): void {
  registerAppHandler()
  registerNoteHandler()
  registerAssetHandler()
}

/* ------------------------------------------------------------ asset:// */

/** 书籍外观图片（书脊贴图 / 封面）只在数据目录里取，且不允许跳出该目录 */
function registerAssetHandler(): void {
  protocol.handle(ASSET_SCHEME, async (request) => {
    let fileName: string
    try {
      fileName = decodeURIComponent(new URL(request.url).pathname).replace(/^\/+/, '')
    } catch {
      return new Response('Bad request', { status: 400 })
    }
    if (!fileName || fileName.includes('..') || /[\\/]/.test(fileName)) {
      return new Response('Forbidden', { status: 403 })
    }
    return serve(join(assetsDir(), fileName))
  })
}

/* ------------------------------------------------------------ app:// */

function rendererDir(): string {
  return normalize(join(__dirname, '../renderer'))
}

function registerAppHandler(): void {
  const root = rendererDir()
  logLine('protocol', `app:// 根目录 ${root}（存在 ${existsSync(root)}）`)
  protocol.handle(APP_SCHEME, async (request) => {
    let pathname: string
    try {
      pathname = decodeURIComponent(new URL(request.url).pathname)
    } catch {
      return new Response('Bad request', { status: 400 })
    }

    // EPUB 的内部文件也走 app:// —— 与界面同源，渲染层才能注入阅读样式、
    // 控制分栏翻页；代价是必须剥掉书里的脚本（见 stripScripts）。
    if (pathname.startsWith(EPUB_URL_PREFIX)) {
      return serveEpubFile(pathname.slice(EPUB_URL_PREFIX.length))
    }

    if (!pathname || pathname === '/') pathname = '/index.html'
    if (pathname.endsWith('/')) pathname += 'index.html'
    const target = normalize(join(root, pathname))
    if (target !== root && !target.startsWith(root + sep)) {
      return new Response('Forbidden', { status: 403 })
    }
    try {
      const data = await readFile(target)
      return new Response(data, { headers: { 'content-type': mimeFor(target) } })
    } catch {
      return new Response('Not found', { status: 404 })
    }
  })
}

/* ------------------------------------------------- EPUB 内部文件 */

async function serveEpubFile(rest: string): Promise<Response> {
  const slash = rest.indexOf('/')
  if (slash <= 0) return new Response('Bad request', { status: 400 })
  const bookId = rest.slice(0, slash)
  const inner = rest.slice(slash + 1)

  const book = currentIndex().books.find((item) => item.id === bookId)
  if (!book) return new Response('Unknown book', { status: 404 })
  if (!hasEpub(bookId)) loadEpub(bookId, book.path)

  const data = epubFile(bookId, inner)
  if (!data) return new Response('Not found', { status: 404 })

  const mime = mimeFor(inner)
  if (mime.startsWith('text/html')) {
    // 强制 UTF-8：EPUB 里偶尔会声明别的编码或干脆不声明
    return new Response(stripScripts(new TextDecoder('utf-8').decode(data)), {
      headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' }
    })
  }
  return new Response(data, { headers: { 'content-type': mime, 'cache-control': 'no-cache' } })
}

/**
 * 去掉书里的脚本与内联事件。
 *
 * EPUB 内容与界面同源（这是分栏翻页、注入阅读样式的前提），
 * 所以一个带 JS 的 epub 理论上能摸到 window.bookscent。
 * 电子书里的脚本本来也极少见，直接剥掉最省心。
 */
function stripScripts(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, '')
    .replace(/<script\b[^>]*\/>/gi, '')
    .replace(/\son[a-z]+\s*=\s*"[^"]*"/gi, '')
    .replace(/\son[a-z]+\s*=\s*'[^']*'/gi, '')
    .replace(/(href|src)\s*=\s*(["'])\s*javascript:[^"']*\2/gi, '$1=$2#$2')
}

/* ------------------------------------------------------------ note:// */

function registerNoteHandler(): void {
  protocol.handle(NOTE_SCHEME, async (request) => {
    let url: URL
    try {
      url = new URL(request.url)
    } catch {
      return new Response('Bad request', { status: 400 })
    }

    const book = bookForHost(url.hostname)
    if (!book) {
      logLine('protocol', `note:// 未知 host ${url.hostname}`)
      return new Response('Unknown book', { status: 404 })
    }
    const root = dirname(book.path)

    const decoded = decodeNotePath(url.pathname)
    if (!decoded) return new Response('Bad request', { status: 400 })
    // Windows 下把正斜杠路径归一化；拒绝盘符之外的相对路径
    if (!/^[a-zA-Z]:\//.test(decoded) && !isAbsolute(decoded)) {
      return new Response('Forbidden', { status: 403 })
    }
    const target = normalize(decoded)
    if (target !== root && !target.startsWith(root + sep)) {
      logLine('protocol', `note:// 越界访问被拒 ${target}`)
      return new Response('Forbidden', { status: 403 })
    }

    try {
      const stat = statSync(target)
      if (stat.isDirectory()) {
        const indexTarget = join(target, 'index.html')
        if (!existsSync(indexTarget)) return missing(request, book.path)
        return serve(indexTarget)
      }
      return serve(target)
    } catch {
      return missing(request, book.path)
    }
  })
}

/**
 * 目标不存在时的处理。
 *
 * DSH 生成的笔记里常见 `<a href="cat">` 这种**漏掉 # 的页内锚点**，
 * 点一下就会把 iframe 导航到一个并不存在的地址。
 * 判断依据是请求头：导航请求带 `Accept: text/html`，子资源不是——
 * 前者礼貌地送回笔记本身，后者老实回 404（避免把 HTML 塞进 script/link 槽位）。
 */
function missing(request: Request, notePath: string): Response {
  const accept = request.headers.get('accept') ?? ''
  if (accept.includes('text/html')) {
    const url = new URL(request.url)
    // 回到这本笔记本身：host 不变，路径换成笔记自己的路径
    return Response.redirect(`${url.protocol}//${url.host}/${encodeNotePath(notePath)}`, 302)
  }
  return new Response('Not found', { status: 404 })
}

/** host → 对应的书 */
function bookForHost(host: string): { id: string; path: string } | null {
  for (const book of currentIndex().books) {
    if (noteHostFor(book.id) === host) return { id: book.id, path: book.path }
  }
  return null
}

async function serve(filePath: string): Promise<Response> {
  try {
    const data = await readFile(filePath)
    return new Response(data, {
      headers: {
        'content-type': mimeFor(filePath),
        'cache-control': 'no-cache'
      }
    })
  } catch {
    return new Response('Not found', { status: 404 })
  }
}

/* ------------------------------------------------- HTML 笔记的资源体检 */

export interface HtmlAssetReport {
  /** 引用到的相对资源总数 */
  referenced: number
  /** 缺失的资源（相对 HTML 的路径） */
  missing: string[]
  /** 明确指向外网或 data: 的引用数 */
  external: number
}

const SRC_ATTR = /(?:src|href)\s*=\s*["']([^"']+)["']/gi

/**
 * 检查一份 HTML 笔记引用到的相对资源在不在。
 * 用途：从别处"复制入库"时如果没有把同级 css/js 一起带过来，这里会立刻暴露。
 */
export function checkHtmlAssets(filePath: string): HtmlAssetReport {
  const report: HtmlAssetReport = { referenced: 0, missing: [], external: 0 }
  let text: string
  try {
    text = readFileSync(filePath).toString('utf8')
  } catch {
    return report
  }
  const baseDir = dirname(filePath)
  const seen = new Set<string>()

  for (const raw of extractHtmlAssetRefs(text)) {
    if (!raw) continue
    if (isRemoteRef(raw)) {
      report.external += 1
      continue
    }
    const clean = raw.split('#')[0].split('?')[0]
    if (!clean) continue
    report.referenced += 1
    if (seen.has(clean)) continue
    seen.add(clean)
    const target = resolve(baseDir, clean)
    if (!existsSync(target)) report.missing.push(clean)
  }

  return report
}
