/**
 * 「从书内图片提取封面 / 书脊」的取材层。
 *
 * 两种书的图源完全不是一回事：
 *   EPUB：zip 里的独立文件，`libraryApi.epubImages()` 给清单，
 *         同源的 `epubUrlFor()` 地址直接 fetch 就能拿到原字节；
 *   PDF ：页内位图对象，复用阅读器那套 `extractEmbeddedImages()`
 *         （遍历绘图指令 → 解码 → 去重 → 导成 PNG 字节）。
 *
 * 这里把两者归一成同一张清单，界面层（ExtractCoverModal）只需要
 * 「一列图 + 取字节」两件事，再也分不清来源。
 */

import type { Book } from '@shared/types'
import { epubUrlFor } from '@shared/noteUrl'
import { filesApi, libraryApi } from '@/lib/api'
import { extractEmbeddedImages } from '@/features/pdf/lib/extract'
import { destroyPdf, loadPdf } from '@/features/pdf/lib/engine'

/** 要提取到哪个位置：封面还是书脊 */
export type CoverExtractKind = 'cover' | 'spine'

/** 书里的一张图（已归一，两种格式共用） */
export interface InternalImage {
  id: string
  /** 显示名：EPUB 用书里的文件名，PDF 用对象名 */
  name: string
  bytes: number
  /** PDF 抽图时已知的像素尺寸；EPUB 要等选中后加载才知道 */
  width: number | null
  height: number | null
}

export interface InternalImageSource {
  items: InternalImage[]
  /** 取这张图的字节（缩略图与最终裁剪都从原始字节重新解码，不用缩略图当素材） */
  fetchBytes: (id: string) => Promise<Uint8Array>
}

export interface LoadInternalImagesOptions {
  /** 每张图都要过一遍的结果（EPUB 是「枚举完成」，PDF 是「已扫描的页数」） */
  onProgress?: (done: number, total: number) => void
}

/** 一份图片清单最多捧多少张图在内存里 —— 200 张插图的书不能一口气全解出来 */
const MAX_ITEMS = 240

/** EPUB：清单来自主进程，字节按需从同源协议地址取 */
async function loadEpubImages(book: Book, options: LoadInternalImagesOptions): Promise<InternalImageSource> {
  const list = await libraryApi.epubImages(book.path)
  const items: InternalImage[] = list
    .filter((entry) => entry.bytes > 0)
    .sort((a, b) => b.bytes - a.bytes)
    .slice(0, MAX_ITEMS)
    .map((entry) => ({
      id: entry.href,
      name: entry.name || entry.href.split('/').pop() || entry.href,
      bytes: entry.bytes,
      width: null,
      height: null
    }))

  options.onProgress?.(items.length, items.length)

  return {
    items,
    fetchBytes: async (id: string): Promise<Uint8Array> => {
      const response = await fetch(epubUrlFor(book.id, id))
      if (!response.ok) throw new Error(`读取失败（HTTP ${response.status}）`)
      return new Uint8Array(await response.arrayBuffer())
    }
  }
}

/** PDF：整本扫一遍内嵌位图，字节留在内存里（与阅读器的「提取图片」同一套） */
async function loadPdfImages(book: Book, options: LoadInternalImagesOptions): Promise<InternalImageSource> {
  const bytes = await filesApi.readBinary(book.path)
  if (bytes.byteLength === 0) throw new Error('文件是空的')
  const loaded = await loadPdf(bytes.slice())
  try {
    const report = await extractEmbeddedImages(loaded.doc, book.title || 'PDF', (done, total) =>
      options.onProgress?.(done, total)
    )
    const store = new Map<string, Uint8Array>()
    for (const image of report.images) store.set(image.key, image.file.data)
    return {
      items: report.images.map((image) => ({
        id: image.key,
        name: image.name,
        bytes: image.file.data.byteLength,
        width: image.width,
        height: image.height
      })),
      fetchBytes: async (id: string): Promise<Uint8Array> => {
        const data = store.get(id)
        if (!data) throw new Error('这张图已经不在内存里了')
        return data
      }
    }
  } finally {
    await destroyPdf(loaded.task)
  }
}

/** 只有 EPUB 与 PDF 的书里才有「内部图片」这个概念 */
export function canExtractInternalImages(book: Book): boolean {
  return book.format === 'epub' || book.format === 'pdf'
}

export async function loadInternalImages(
  book: Book,
  options: LoadInternalImagesOptions = {}
): Promise<InternalImageSource> {
  if (book.format === 'epub') return loadEpubImages(book, options)
  if (book.format === 'pdf') return loadPdfImages(book, options)
  throw new Error('这个格式的书籍没有内部图片')
}

/* --------------------------------------------------------------- 小工具 */

/** 字节 → blob 地址；调用方负责 revoke。slice() 是为了拿到独立缓冲（Blob 不吃 SharedArrayBuffer 后端） */
export function blobUrlOf(data: Uint8Array, mime = 'image/png'): string {
  return URL.createObjectURL(new Blob([data.slice()], { type: mime }))
}

/** 图片字节按扩展名猜 MIME，取不到就当 PNG */
export function mimeForName(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  const table: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    webp: 'image/webp',
    gif: 'image/gif',
    bmp: 'image/bmp',
    avif: 'image/avif',
    svg: 'image/svg+xml'
  }
  return table[ext] ?? 'image/png'
}

/** 解码一张图的自然尺寸；解不出来（格式太怪）返回 null */
export function decodeImageSize(src: string): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    const image = new Image()
    image.onload = () => {
      resolve(image.naturalWidth > 0 && image.naturalHeight > 0
        ? { width: image.naturalWidth, height: image.naturalHeight }
        : null)
    }
    image.onerror = () => resolve(null)
    image.src = src
  })
}

/* --------------------------------------------------------------- 裁剪几何 */

/** 裁剪框（归一化到图片的 0–1 空间，与显示尺寸无关） */
export interface CropRect {
  x: number
  y: number
  w: number
  h: number
}

/** 选框角上的把手；move = 整框平移 */
export type CropHandle = 'nw' | 'ne' | 'sw' | 'se' | 'move'

export const FULL_CROP: CropRect = { x: 0, y: 0, w: 1, h: 1 }

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value
}

/**
 * 选框允许的最小尺寸。
 *
 * 这里**刻意做得极小**（0.05%，2000px 的图上约 1 像素），只用来挡住"宽或高变成 0"
 * 这种退化情况 —— 不再是一个拦着用户往上贴的 UX 限制：
 * 想裁封面上的一个小图案，就该能一路框到一像素。
 */
const MIN_CROP_SIDE = 0.0005

/** 把矩形收进 0–1 的图片范围 */
export function clampRect(rect: CropRect): CropRect {
  const w = clamp(rect.w, MIN_CROP_SIDE, 1)
  const h = clamp(rect.h, MIN_CROP_SIDE, 1)
  return { x: clamp(rect.x, 0, 1 - w), y: clamp(rect.y, 0, 1 - h), w, h }
}

/**
 * 在图片里找一块居中的、比例最接近目标比例的最大矩形。
 * `aspect` 是宽 ÷ 高 —— 与 `coverImageAspect` / `spineImageAspect` 一个口径。
 */
export function fitRect(aspect: number): CropRect {
  const imageAspect = 2 / 3
  if (aspect >= imageAspect) {
    const h = imageAspect / aspect
    return { x: 0, y: (1 - h) / 2, w: 1, h }
  }
  const w = aspect / imageAspect
  return { x: (1 - w) / 2, y: 0, w, h: 1 }
}

/**
 * 拖动角把手时算新矩形。
 *
 * 定点（对角）不动，宽高按目标比例联动；比例给 null 就是自由裁剪，
 * 两边各算各的。**没有"最小尺寸"门槛** —— 早期版本在框太小的时候直接
 * 返回原矩形，本意是怕光标贴住定点时抖动，代价却是"想裁一小块就卡住"，
 * 用户要的是能一路框到很小。现在只挡住宽或高变成 0 的退化情况。
 */
export function resizeCrop(
  start: CropRect,
  aspect: number | null,
  handle: CropHandle,
  dx: number,
  dy: number
): CropRect {
  if (handle === 'move') {
    return clampRect({ ...start, x: start.x + dx, y: start.y + dy })
  }

  const left = handle === 'nw' || handle === 'sw'
  const top = handle === 'nw' || handle === 'ne'

  const anchorX = left ? start.x + start.w : start.x
  const anchorY = top ? start.y + start.h : start.y
  const pointerX = clamp((left ? start.x : start.x + start.w) + dx, 0, 1)
  const pointerY = clamp((top ? start.y : start.y + start.h) + dy, 0, 1)

  const roomW = left ? anchorX : 1 - anchorX
  const roomH = top ? anchorY : 1 - anchorY
  if (roomW <= 0 || roomH <= 0) return start

  let w = clamp(left ? anchorX - pointerX : pointerX - anchorX, 0, roomW)
  let h = clamp(top ? anchorY - pointerY : pointerY - anchorY, 0, roomH)

  if (aspect !== null) {
    if (w / Math.max(h, 1e-6) > aspect) w = h * aspect
    else h = w / aspect
    if (w > roomW) {
      w = roomW
      h = w / aspect
    }
    if (h > roomH) {
      h = roomH
      w = h * aspect
    }
  }

  // 贴到定点上（宽或高为 0）时保留原矩形，免得选框塌成一条线再也拖不回来
  if (w < MIN_CROP_SIDE || h < MIN_CROP_SIDE) return start
  w = Math.max(w, MIN_CROP_SIDE)
  h = Math.max(h, MIN_CROP_SIDE)

  return {
    x: left ? anchorX - w : anchorX,
    y: top ? anchorY - h : anchorY,
    w,
    h
  }
}

/**
 * 按裁剪框把原图画进画布并导出 PNG。
 *
 * 长边超过 `maxSide` 就等比缩到它 —— 书脊图最后只显示几十像素宽，
 * 没必要把一张 6000px 的原图整块塞进 library.json。
 */
export function drawCrop(
  image: CanvasImageSource,
  rect: CropRect,
  naturalWidth: number,
  naturalHeight: number,
  maxSide = 1600,
  mime: 'image/png' | 'image/jpeg' = 'image/png'
): string | null {
  const safe = clampRect(rect)
  const sourceX = Math.round(safe.x * naturalWidth)
  const sourceY = Math.round(safe.y * naturalHeight)
  const sourceW = Math.max(1, Math.round(safe.w * naturalWidth))
  const sourceH = Math.max(1, Math.round(safe.h * naturalHeight))

  const scale = Math.min(1, maxSide / Math.max(sourceW, sourceH))
  const outW = Math.max(1, Math.round(sourceW * scale))
  const outH = Math.max(1, Math.round(sourceH * scale))

  const canvas = document.createElement('canvas')
  canvas.width = outW
  canvas.height = outH
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(image, sourceX, sourceY, sourceW, sourceH, 0, 0, outW, outH)
  try {
    return canvas.toDataURL(mime, mime === 'image/jpeg' ? 0.92 : undefined)
  } catch {
    return null
  }
}

/** 字节 → 可直接给 canvas 用的位图 */
export function decodeForCrop(blob: Blob): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === 'function') {
    return createImageBitmap(blob).catch(() => decodeViaElement(blob))
  }
  return decodeViaElement(blob)
}

function decodeViaElement(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob)
    const image = new Image()
    image.onload = () => {
      URL.revokeObjectURL(url)
      resolve(image)
    }
    image.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('这张图片解不开'))
    }
    image.src = url
  })
}
