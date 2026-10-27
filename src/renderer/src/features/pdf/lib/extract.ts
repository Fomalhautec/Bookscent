/**
 * 图片提取。
 *
 * 两条路子：
 *  1. 页面导出 —— 直接把页栅格化，所见即所得；
 *  2. 内嵌图片 —— 走 page.getOperatorList()，收集 paintImageXObject /
 *     paintJpegXObject 的目标名，再用 page.objs.get(name) 取回解码结果。
 */

import type { PDFDocumentProxy } from 'pdfjs-dist'
import { pdfjsLib, createCanvas, canvasToBytes, renderPageToCanvas } from './engine'

const MIN_IMAGE_SIDE = 32

export interface ExtractedImage {
  /** 稳定的对象名，用于去重 */
  key: string
  name: string
  file: { name: string; data: Uint8Array }
  width: number
  height: number
}

export interface EmbeddedImageReport {
  images: ExtractedImage[]
  found: number
  skipped: number
  /** 详情行，用于提示用户为什么跳过了某些图 */
  notes: string[]
}

/** pdfjs 解码后的图片对象（字段名在不同版本间略有差异，按结构取） */
interface RawDecodedImage {
  width?: number
  height?: number
  kind?: number
  data?: Uint8Array | Uint8ClampedArray | number[] | null
  bitmap?: ImageBitmap | HTMLCanvasElement | null
}

/**
 * 图片类绘图指令。
 * 注意：pdfjs v6 已经把 paintJpegXObject 合并进 paintImageXObject，
 * 这里按名字取，取不到就跳过，兼容不同小版本。
 */
const OPS_IMAGE_KEYS = ['paintImageXObject', 'paintJpegXObject', 'paintImageMaskXObject'] as const

function imageOpValues(): number[] {
  const ops = pdfjsLib.OPS as unknown as Record<string, number | undefined>
  const values: number[] = []
  for (const key of OPS_IMAGE_KEYS) {
    const value = ops[key]
    if (typeof value === 'number') values.push(value)
  }
  return values
}

/** 收集一页里所有内嵌图片的对象名（先去重，顺序保持） */
async function collectImageNames(doc: PDFDocumentProxy, pageNumber: number): Promise<string[]> {
  const page = await doc.getPage(pageNumber)
  const opList = await page.getOperatorList()
  const wanted = new Set(imageOpValues())
  const names: string[] = []
  const seen = new Set<string>()
  for (let i = 0; i < opList.fnArray.length; i += 1) {
    const fn = opList.fnArray[i]
    if (!wanted.has(fn)) continue
    const args = opList.argsArray[i] as unknown
    const name = Array.isArray(args) ? args[0] : undefined
    if (typeof name !== 'string') continue
    if (seen.has(name)) continue
    seen.add(name)
    names.push(name)
  }
  return names
}

/** 有些 ImageBitmap/Canvas 是「已解码位图」，直接画即可；否则按 data 手工铺像素 */
function decodedToCanvas(decoded: RawDecodedImage): HTMLCanvasElement | null {
  const width = Math.floor(decoded.width ?? 0)
  const height = Math.floor(decoded.height ?? 0)

  if (decoded.bitmap) {
    const bitmap = decoded.bitmap
    const w = 'width' in bitmap ? Number(bitmap.width) : width
    const h = 'height' in bitmap ? Number(bitmap.height) : height
    if (w > 0 && h > 0) {
      const canvas = createCanvas(w, h)
      const ctx = canvas.getContext('2d')
      if (ctx) {
        ctx.drawImage(bitmap as CanvasImageSource, 0, 0, w, h)
        return canvas
      }
    }
  }

  const data = decoded.data
  if (!data || width <= 0 || height <= 0) return null
  const pixels = data instanceof Uint8Array || data instanceof Uint8ClampedArray ? data : Uint8Array.from(data as number[])

  const expectedRgba = width * height * 4
  const expectedRgb = width * height * 3
  const expectedGray = width * height

  // 显式写成 ArrayBuffer 后端：ImageData 不接受 SharedArrayBuffer
  const emptyRgba = (): Uint8ClampedArray<ArrayBuffer> => new Uint8ClampedArray(new ArrayBuffer(expectedRgba))

  let rgba: Uint8ClampedArray<ArrayBuffer>
  if (pixels.length >= expectedRgba && pixels.length < expectedRgba + height * 4) {
    // 已经就是 RGBA，拷贝一份（ImageData 要求独立缓冲）
    rgba = emptyRgba()
    rgba.set(pixels.subarray(0, expectedRgba))
  } else if (pixels.length >= expectedRgb) {
    rgba = emptyRgba()
    for (let i = 0, j = 0; i < expectedRgb; i += 3, j += 4) {
      rgba[j] = pixels[i]
      rgba[j + 1] = pixels[i + 1]
      rgba[j + 2] = pixels[i + 2]
      rgba[j + 3] = 255
    }
  } else if (pixels.length >= expectedGray) {
    rgba = emptyRgba()
    for (let i = 0, j = 0; i < expectedGray; i += 1, j += 4) {
      const v = pixels[i]
      rgba[j] = v
      rgba[j + 1] = v
      rgba[j + 2] = v
      rgba[j + 3] = 255
    }
  } else {
    // 1 位灰度蒙版之类，按行有 32 位对齐，这里不做还原
    return null
  }

  const canvas = createCanvas(width, height)
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.putImageData(new ImageData(rgba, width, height), 0, 0)
  return canvas
}

function sanitize(name: string): string {
  const cleaned = name.replace(/[^a-zA-Z0-9_-]/g, '')
  return cleaned || 'image'
}

const HASH_MASK = 0xffff

/** 轻量指纹：尺寸 + 前 64 字节的 FNV-1a 摘要，用来跳过重复图片 */
export function fingerprintImage(width: number, height: number, bytes: Uint8Array): string {
  let hash = 0x811c9dc5
  const limit = Math.min(64, bytes.length)
  for (let i = 0; i < limit; i += 1) {
    hash ^= bytes[i]
    hash = (hash * 0x01000193) >>> 0
  }
  return `${width}x${height}:${(hash & HASH_MASK).toString(16)}`
}

/**
 * 遍历整本文档提取内嵌图片。
 * 小于 32px 的图（多是图标、蒙版、分隔线）跳过，避免刷屏。
 */
export async function extractEmbeddedImages(
  doc: PDFDocumentProxy,
  prefix: string,
  onProgress?: (done: number, total: number) => void
): Promise<EmbeddedImageReport> {
  const images: ExtractedImage[] = []
  const notes: string[] = []
  const seenKeys = new Set<string>()
  let found = 0
  let skipped = 0
  let index = 0

  for (let page = 1; page <= doc.numPages; page += 1) {
    let names: string[] = []
    try {
      names = await collectImageNames(doc, page)
    } catch {
      notes.push(`第 ${page} 页内容解析失败，已跳过`)
      onProgress?.(page, doc.numPages)
      continue
    }

    const pageProxy = await doc.getPage(page)
    for (const name of names) {
      found += 1
      let decoded: RawDecodedImage | null = null
      try {
        // objs.get 需要对象已解析；渲染过或 getOperatorList 之后一般都已就绪
        decoded = pageProxy.objs.get(name) as RawDecodedImage | null
      } catch {
        decoded = null
      }
      if (!decoded) {
        skipped += 1
        continue
      }
      const width = Math.floor(decoded.width ?? 0)
      const height = Math.floor(decoded.height ?? 0)
      if (width < MIN_IMAGE_SIDE || height < MIN_IMAGE_SIDE) {
        skipped += 1
        continue
      }

      const canvas = decodedToCanvas(decoded)
      if (!canvas) {
        skipped += 1
        continue
      }

      const data = await canvasToBytes(canvas, 'png')
      const key = fingerprintImage(canvas.width, canvas.height, data)
      if (seenKeys.has(key)) {
        skipped += 1
        continue
      }
      seenKeys.add(key)

      index += 1
      images.push({
        key,
        name,
        width: canvas.width,
        height: canvas.height,
        file: {
          name: `${prefix}-图片-${String(index).padStart(3, '0')}-${sanitize(name)}.png`,
          data
        }
      })
    }
    onProgress?.(page, doc.numPages)
  }

  if (skipped > 0) notes.push(`已跳过 ${skipped} 个重复或过小的图片`)
  return { images, found, skipped, notes }
}

/* ------------------------------------------------------------ 页面导出 */

export interface PageExportOptions {
  pages: number[]
  scale: number
  imageType: 'png' | 'jpeg'
  quality: number
  prefix: string
}

export async function exportPages(
  doc: PDFDocumentProxy,
  options: PageExportOptions,
  onProgress?: (done: number, total: number) => void
): Promise<{ files: { name: string; data: Uint8Array }[]; notes: string[] }> {
  const files: { name: string; data: Uint8Array }[] = []
  const notes: string[] = []
  const total = options.pages.length
  const digits = String(doc.numPages).length
  const ext = options.imageType === 'png' ? 'png' : 'jpg'

  for (let i = 0; i < options.pages.length; i += 1) {
    const pageNumber = options.pages[i]
    try {
      const page = await doc.getPage(pageNumber)
      const viewport = page.getViewport({ scale: options.scale })
      const canvas = createCanvas(viewport.width, viewport.height)
      const task = renderPageToCanvas(page, canvas, options.scale, 0, 1)
      await task.promise
      const data = await canvasToBytes(canvas, options.imageType, options.quality)
      files.push({
        name: `${options.prefix}-第${String(pageNumber).padStart(digits, '0')}页.${ext}`,
        data
      })
    } catch (error) {
      notes.push(`第 ${pageNumber} 页导出失败：${(error as Error).message}`)
    }
    onProgress?.(i + 1, total)
  }

  return { files, notes }
}

/**
 * 解析「自定义页码范围」输入，例如 "1-5, 8, 12-14"。
 * 返回排好序、去重的 1 基页码；非法片段会被忽略并回报。
 */
export function parsePageRange(input: string, maxPage: number): { pages: number[]; invalid: string[] } {
  const pages = new Set<number>()
  const invalid: string[] = []
  const chunks = input
    .split(/[,，、;；\s]+/)
    .map((s) => s.trim())
    .filter(Boolean)

  for (const chunk of chunks) {
    const range = chunk.match(/^(\d+)\s*[-–~至]\s*(\d+)$/)
    if (range) {
      const from = Number.parseInt(range[1], 10)
      const to = Number.parseInt(range[2], 10)
      if (!Number.isFinite(from) || !Number.isFinite(to)) {
        invalid.push(chunk)
        continue
      }
      const lo = Math.max(1, Math.min(from, to))
      const hi = Math.min(maxPage, Math.max(from, to))
      if (lo > maxPage || hi < 1) {
        invalid.push(chunk)
        continue
      }
      for (let p = lo; p <= hi; p += 1) pages.add(p)
      continue
    }
    const single = Number.parseInt(chunk, 10)
    if (Number.isFinite(single) && single >= 1 && single <= maxPage) {
      pages.add(single)
    } else {
      invalid.push(chunk)
    }
  }

  return { pages: [...pages].sort((a, b) => a - b), invalid }
}
