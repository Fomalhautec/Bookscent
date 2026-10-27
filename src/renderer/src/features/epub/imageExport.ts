/**
 * EPUB 图片导出用的小工具。
 *
 * EPUB 里的图片本来就是 zip 里的独立文件，导出就是「把原字节拿出来写成文件」——
 * 不需要像 PDF 那样先渲染。书内文件挂在 `app://bundle/__epub/<bookId>/...`，
 * 与界面同源，所以渲染层直接 `fetch()` 那些地址就能拿到字节。
 */

import { epubUrlFor } from '@shared/noteUrl'
import type { SaveImageFile } from '@shared/types'

/** 书里的一张图（与主进程 `library:epub-images` 返回的形状一致） */
export interface EpubImageItem {
  href: string
  name: string
  bytes: number
}

/** href / URL 里的文件名（含扩展名） */
export function nameFromHref(href: string): string {
  const clean = href.split('?')[0].split('#')[0]
  const last = clean.split('/').filter(Boolean).pop() ?? ''
  if (!last) return 'image'
  try {
    return decodeURIComponent(last)
  } catch {
    return last
  }
}

/**
 * 书页里 `<img>` 的 src 反解回它在清单里的 href。
 *
 * 浏览器给的是解析后的绝对地址（`app://bundle/__epub/<bookId>/OPS/images/a.jpg`），
 * 而清单里的 href 是相对解包根的 `OPS/images/a.jpg`。
 * 反解不出来（data: 内联图、外链）返回 null，调用方走「直接拿 src 的字节」那条路。
 */
export function hrefFromEpubUrl(bookId: string, url: string): string | null {
  let pathname: string
  try {
    pathname = new URL(url, window.location.href).pathname
  } catch {
    return null
  }
  const prefix = epubUrlFor(bookId, '')
  if (!pathname.startsWith(prefix)) return null
  const rest = pathname.slice(prefix.length)
  if (!rest) return null
  return rest
    .split('/')
    .map((segment) => {
      try {
        return decodeURIComponent(segment)
      } catch {
        return segment
      }
    })
    .join('/')
}

/** 一段图片字节；地址与界面同源，直接 fetch */
export async function fetchImageBytes(url: string): Promise<Uint8Array> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`读取失败（HTTP ${response.status}）`)
  return new Uint8Array(await response.arrayBuffer())
}

/** 清单条目 → 落盘载荷（主进程按原字节写文件，名字沿用书里的文件名） */
export async function fetchEpubImageFile(
  bookId: string,
  item: { href: string; name: string }
): Promise<SaveImageFile> {
  const data = await fetchImageBytes(epubUrlFor(bookId, item.href))
  return { name: item.name || nameFromHref(item.href), data }
}

const EXT_BY_MIME: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/bmp': '.bmp',
  'image/avif': '.avif',
  'image/svg+xml': '.svg'
}

/** 没有扩展名时按 MIME 补一个，免得存出来是打不开的无后缀文件 */
export function ensureImageExtension(name: string, mime: string): string {
  if (/\.[a-z0-9]{2,5}$/i.test(name)) return name
  const ext = EXT_BY_MIME[mime.split(';')[0].trim().toLowerCase()]
  return ext ? `${name}${ext}` : name
}

/** 不是清单里的图（data: 内联图、外链）：直接从它的 src 取字节 */
export async function fetchImageFile(url: string, fallbackName: string): Promise<SaveImageFile> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`读取失败（HTTP ${response.status}）`)
  const blob = await response.blob()
  const name = ensureImageExtension(fallbackName || 'image', blob.type)
  return { name, data: new Uint8Array(await blob.arrayBuffer()) }
}
