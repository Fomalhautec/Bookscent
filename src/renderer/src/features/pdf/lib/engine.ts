/**
 * PDF 引擎层 —— 把 pdfjs-dist 的原始 API 包成一组「文档级」操作。
 *
 * 这里刻意不引入 React：所有函数都是命令式、可等待的，
 * 组件层只负责把结果搬到 state 里。这样渲染流程可以被
 * 阅读器、缩略图、导出、搜索四个场景共用。
 */

import * as pdfjsLib from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import type { PDFDocumentLoadingTask, PDFDocumentProxy, PDFPageProxy, PageViewport } from 'pdfjs-dist'

/**
 * 生产环境页面是用自定义 app:// 协议提供的，worker 脚本必须解析成绝对地址，
 * 否则 pdfjs 会把 '/assets/...' 当成相对路径，从 file:// 或错误的位置去取。
 */
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(workerUrl, document.baseURI).href

export { pdfjsLib }
export type { PDFDocumentLoadingTask, PDFDocumentProxy, PDFPageProxy, PageViewport }

/** pdfjs 渲染任务最小可用结构（避免在组件里到处写 RenderTask） */
export interface CancellableRenderTask {
  promise: Promise<void>
  cancel(): void
}

/* ------------------------------------------------------------------ 加载 */

export class PdfLoadError extends Error {
  readonly kind: 'password' | 'invalid' | 'missing' | 'unknown'

  constructor(kind: PdfLoadError['kind'], message: string) {
    super(message)
    this.name = 'PdfLoadError'
    this.kind = kind
  }
}

function classifyError(error: unknown): PdfLoadError {
  if (error instanceof PdfLoadError) return error
  const name = (error as { name?: string } | null)?.name ?? ''
  const message = (error as { message?: string } | null)?.message ?? String(error)
  if (name === 'PasswordException') return new PdfLoadError('password', '这个 PDF 有密码保护，暂时无法打开。')
  if (name === 'InvalidPDFException') return new PdfLoadError('invalid', '文件不是有效的 PDF，或者已经损坏。')
  if (/encrypted|password/i.test(message)) {
    return new PdfLoadError('password', '这个 PDF 有密码保护，暂时无法打开。')
  }
  if (/invalid|corrupt|structure|format/i.test(message)) {
    return new PdfLoadError('invalid', 'PDF 结构异常，无法解析。')
  }
  return new PdfLoadError('unknown', message || 'PDF 打开失败。')
}

export interface LoadedPdf {
  doc: PDFDocumentProxy
  pageCount: number
  /** pdfjs v6 里 PDFDocumentProxy 不再有 destroy()，销毁要走 loadingTask */
  task: PDFDocumentLoadingTask
}

/**
 * 从内存字节加载文档。
 * 注意：pdfjs 会把 Uint8Array 转交给 worker，之后原数组会被「中立化」，
 * 因此需要保留原始字节做批注导出时必须先复制一份。
 */
export async function loadPdf(data: Uint8Array): Promise<LoadedPdf> {
  try {
    const task = pdfjsLib.getDocument({
      data,
      // 中文 PDF 常用内置 CMap，交给 pdfjs 自行按需取用
      useSystemFonts: true
    })
    const doc = await task.promise
    return { doc, pageCount: doc.numPages, task }
  } catch (error) {
    throw classifyError(error)
  }
}

/** 销毁文档与 worker；重复调用、取消阶段调用都要安静收场 */
export async function destroyPdf(task: PDFDocumentLoadingTask | null): Promise<void> {
  if (!task) return
  try {
    await task.destroy()
  } catch {
    // 卸载阶段 worker 可能已经被销毁，忽略即可
  }
}

/* ------------------------------------------------------------------ 页面 */

export interface PageSize {
  width: number
  height: number
}

const sizeCache = new WeakMap<PDFDocumentProxy, Map<number, PageSize>>()

/** 页面原始尺寸（scale = 1，不含用户旋转） */
export async function getPageSize(doc: PDFDocumentProxy, pageNumber: number): Promise<PageSize> {
  let cache = sizeCache.get(doc)
  if (!cache) {
    cache = new Map()
    sizeCache.set(doc, cache)
  }
  const cached = cache.get(pageNumber)
  if (cached) return cached

  const page = await doc.getPage(pageNumber)
  const viewport = page.getViewport({ scale: 1 })
  const size: PageSize = { width: viewport.width, height: viewport.height }
  cache.set(pageNumber, size)
  return size
}

export async function getPage(doc: PDFDocumentProxy, pageNumber: number): Promise<PDFPageProxy> {
  return doc.getPage(pageNumber)
}

/** 取页面自带旋转（PDF /Rotate） */
export async function getPageRotation(doc: PDFDocumentProxy, pageNumber: number): Promise<number> {
  const page = await doc.getPage(pageNumber)
  return page.rotate
}

/** 按渲染角度 + 缩放构造 viewport，实际角度 = 页面自带旋转 + 用户旋转 */
export function viewportFor(page: PDFPageProxy, scale: number, userRotation: number): PageViewport {
  return page.getViewport({ scale, rotation: page.rotate + userRotation })
}

/* --------------------------------------------------------------- 渲染 */

export function createCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.floor(width))
  canvas.height = Math.max(1, Math.floor(height))
  return canvas
}

/**
 * 把某一页的**文字层**画进 container（透明文字，覆盖在画布上）。
 *
 * 为什么需要它：光有 canvas 就是一张图，选不中任何字。pdf.js 的 TextLayer 会把
 * 每个文字块放成一个透明 span，位置与画布严格对齐 —— 于是浏览器原生的选词、复制，
 * 以及我们自己的高亮 / 划线都成了可能。
 *
 * 幂等：每次先清空容器，避免换缩放或重渲时叠出好几层。
 */
export async function renderPageTextLayer(
  page: PDFPageProxy,
  container: HTMLElement,
  scale: number,
  userRotation: number
): Promise<void> {
  const viewport = viewportFor(page, scale, userRotation)
  container.replaceChildren()
  const textContent = await page.getTextContent()
  const layer = new pdfjsLib.TextLayer({ textContentSource: textContent, container, viewport })
  await layer.render()
}

/** 以指定倍率把某一页画到画布上（画布按 outputScale 放大，CSS 尺寸由调用方控制） */
export function renderPageToCanvas(
  page: PDFPageProxy,
  canvas: HTMLCanvasElement,
  scale: number,
  userRotation: number,
  outputScale: number
): CancellableRenderTask {
  const viewport = viewportFor(page, scale, userRotation)
  const pixelWidth = Math.max(1, Math.floor(viewport.width * outputScale))
  const pixelHeight = Math.max(1, Math.floor(viewport.height * outputScale))
  if (canvas.width !== pixelWidth) canvas.width = pixelWidth
  if (canvas.height !== pixelHeight) canvas.height = pixelHeight

  const transform = outputScale === 1 ? undefined : [outputScale, 0, 0, outputScale, 0, 0]
  const context = canvas.getContext('2d', { alpha: false })
  if (context) {
    context.save()
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.restore()
  }

  return page.render({
    canvas,
    canvasContext: context ?? undefined,
    viewport,
    transform,
    background: '#ffffff'
  }) as unknown as CancellableRenderTask
}

/**
 * 离屏渲染一页并导出字节。用于「页面导出」。
 * 采用 DPR = 1 的干净倍率，避免把屏幕 DPR 混进导出结果。
 */
export async function renderPageToBytes(
  doc: PDFDocumentProxy,
  pageNumber: number,
  scale: number,
  imageType: 'png' | 'jpeg',
  quality = 0.92,
  userRotation = 0
): Promise<{ data: Uint8Array; width: number; height: number }> {
  const page = await doc.getPage(pageNumber)
  const viewport = viewportFor(page, scale, userRotation)
  const canvas = createCanvas(viewport.width, viewport.height)
  const task = renderPageToCanvas(page, canvas, scale, userRotation, 1)
  await task.promise
  const data = await canvasToBytes(canvas, imageType, quality)
  return { data, width: canvas.width, height: canvas.height }
}

async function canvasToBlob(canvas: HTMLCanvasElement, imageType: 'png' | 'jpeg', quality: number): Promise<Blob> {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob)
        else reject(new Error('画布导出失败'))
      },
      imageType === 'png' ? 'image/png' : 'image/jpeg',
      imageType === 'png' ? undefined : quality
    )
  })
}

/** canvas → Uint8Array（经由 toBlob → arrayBuffer） */
export async function canvasToBytes(
  canvas: HTMLCanvasElement,
  imageType: 'png' | 'jpeg',
  quality = 0.92
): Promise<Uint8Array> {
  const blob = await canvasToBlob(canvas, imageType, quality)
  return new Uint8Array(await blob.arrayBuffer())
}

/* --------------------------------------------------------------- 缩略图 */

/** 缩略图只取页面本身，忽略用户旋转，保证栅格整齐 */
export async function renderThumbnail(
  doc: PDFDocumentProxy,
  pageNumber: number,
  targetWidth: number
): Promise<string> {
  const page = await doc.getPage(pageNumber)
  const base = page.getViewport({ scale: 1 })
  const scale = Math.max(0.05, targetWidth / base.width)
  const viewport = page.getViewport({ scale })
  const outputScale = Math.min(2, window.devicePixelRatio || 1)
  const canvas = createCanvas(viewport.width, viewport.height)
  const task = renderPageToCanvas(page, canvas, scale, 0, outputScale)
  await task.promise
  try {
    return canvas.toDataURL('image/png')
  } catch {
    return ''
  }
}

/* ----------------------------------------------------------- 文本内容 */

export interface TextSpan {
  text: string
  /** 屏幕坐标（scale = 1 的 viewport 空间，y 轴向下） */
  x: number
  y: number
  width: number
  height: number
}

export interface PageText {
  text: string
  spans: TextSpan[]
  /** 当前 viewport 下的页面尺寸，便于把 span 归一化 */
  viewportWidth: number
  viewportHeight: number
}

/** 应用 6 元仿射矩阵 */
function applyMatrix(m: number[], x: number, y: number): { x: number; y: number } {
  return { x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] }
}

let measureCanvas: HTMLCanvasElement | null = null

function measureTextWidth(text: string, font: string, fallback: number): number {
  if (!measureCanvas) measureCanvas = document.createElement('canvas')
  const ctx = measureCanvas.getContext('2d')
  if (!ctx) return fallback
  ctx.font = font
  const w = ctx.measureText(text).width
  return w > 0 ? w : fallback
}

/**
 * 取某一页的文字。返回的 span 已经过 viewport 变换：
 * 文本项在 PDF 空间中「基线在 origin、向上生长」，转到屏幕空间后
 * 顶部 y 为 y - height，绘制高亮矩形时要用这个。
 */
export async function getPageText(
  doc: PDFDocumentProxy,
  pageNumber: number,
  userRotation = 0
): Promise<PageText> {
  const page = await doc.getPage(pageNumber)
  const viewport = viewportFor(page, 1, userRotation)
  const content = await page.getTextContent()
  const spans: TextSpan[] = []
  let text = ''

  // TextItem 与 TextMarkedContent 混在 items 里，用字段判断即可
  for (const item of content.items) {
    const raw = item as { str?: string; width?: number; height?: number; transform?: number[] }
    if (typeof raw.str !== 'string' || !raw.transform) continue
    const str = raw.str
    if (str.length === 0) continue
    const t = raw.transform
    const origin = applyMatrix(viewport.transform, t[4], t[5])
    const declaredWidth = Math.abs(raw.width ?? 0)
    const fontSize = Math.abs(t[3]) || Math.abs(raw.height ?? 0) || 10
    const spanHeight = Math.abs(raw.height ?? 0) || fontSize
    const spanWidth =
      declaredWidth > 0.5
        ? declaredWidth
        : measureTextWidth(str, `${fontSize}px sans-serif`, estimateWidth(str, fontSize))
    spans.push({
      text: str,
      x: origin.x,
      y: origin.y - spanHeight,
      width: spanWidth,
      height: spanHeight
    })
    text += str
    if ((item as { hasEOL?: boolean }).hasEOL) text += '\n'
  }

  return { text, spans, viewportWidth: viewport.width, viewportHeight: viewport.height }
}

function estimateWidth(text: string, fontSize: number): number {
  let units = 0
  for (const ch of text) units += ch.charCodeAt(0) > 0x2e80 ? 1 : 0.55
  return units * fontSize
}

export { applyMatrix }
