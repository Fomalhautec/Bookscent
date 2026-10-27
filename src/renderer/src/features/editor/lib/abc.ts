/**
 * ABC 记谱（五线谱）渲染。
 *
 * 设计要点：
 *  - marked 的 renderer 是同步的，而 abcjs 必须握着真实 DOM 才能排版，
 *    所以预览里先放一个占位 <figure class="bs-music">，渲染完成后再异步把 SVG 塞进去。
 *  - abcjs 只在真正遇到 ```abc 时才加载（动态 import → 单独 chunk），
 *    没写谱子的笔记不用为它付出任何首屏成本。
 *  - 应用 CSP 是 `script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' blob:`，
 *    没有 unsafe-eval。abcjs 的 SVG 排版路径不含 eval / new Function（已核对
 *    dist/abcjs-basic-min.js），因此**不需要**放宽 CSP。
 */

export interface SheetMusicStats {
  total: number
  rendered: number
  failed: number
}

export interface RasterImage {
  bytes: Uint8Array
  mime: 'image/png'
  width: number
  height: number
}

type AbcModule = typeof import('abcjs')

let abcModule: AbcModule | null = null
let abcPending: Promise<AbcModule | null> | null = null
let abcError: string | null = null

/** 渲染器缺失时的原因（供界面显示，例如未安装 / 加载失败） */
export function sheetMusicUnavailableReason(): string | null {
  return abcError
}

/** 按需加载 abcjs；失败不抛出，只是返回 null 并记下原因 */
export function loadAbcjs(): Promise<AbcModule | null> {
  if (abcModule) return Promise.resolve(abcModule)
  if (abcPending) return abcPending
  abcPending = import('abcjs')
    .then((mod) => {
      const candidate = mod as unknown as { default?: AbcModule } & AbcModule
      const api = candidate.default ?? candidate
      if (typeof api?.renderAbc !== 'function') throw new Error('abcjs 接口不可用')
      abcModule = api
      return api
    })
    .catch((error: unknown) => {
      abcError = error instanceof Error ? error.message : String(error)
      return null
    })
  return abcPending
}

/* --------------------------------------------------------- 渲染五线谱 */

export interface EnhanceOptions {
  /** 排版宽度（px）；导出时用固定宽度，否则用容器宽度 */
  staffWidth?: number
}

/**
 * 把 root 里所有还没渲染的 `figure.bs-music` 排成真正的 SVG 乐谱。
 * 可重复调用（幂等）：已渲染 / 已失败的块会被跳过。
 */
export async function enhanceSheetMusic(root: HTMLElement, options: EnhanceOptions = {}): Promise<SheetMusicStats> {
  const blocks = Array.from(root.querySelectorAll<HTMLElement>('figure.bs-music'))
  const stats: SheetMusicStats = { total: blocks.length, rendered: 0, failed: 0 }
  if (blocks.length === 0) return stats

  const abc = await loadAbcjs()
  const staffWidth = Math.max(320, Math.round(options.staffWidth ?? 720))

  for (const block of blocks) {
    const state = block.dataset.bsMusicState
    if (state === 'ok') {
      stats.rendered += 1
      continue
    }
    if (state === 'error') {
      stats.failed += 1
      continue
    }
    const source = block.querySelector<HTMLElement>('.bs-music-source code')?.textContent ?? ''
    if (!source.trim()) {
      markMusicError(block, '这段五线谱是空的', false)
      stats.failed += 1
      continue
    }
    if (!abc) {
      markMusicError(block, `未安装五线谱渲染器（${abcError ?? 'abcjs 加载失败'}）`, false)
      stats.failed += 1
      continue
    }
    try {
      renderInto(abc, block, source, staffWidth)
      block.dataset.bsMusicState = 'ok'
      stats.rendered += 1
    } catch (error) {
      markMusicError(block, `五线谱排版失败：${(error as Error).message}`, true)
      stats.failed += 1
    }
  }
  return stats
}

function renderInto(abc: AbcModule, block: HTMLElement, source: string, staffWidth: number): void {
  const score = block.querySelector<HTMLElement>('.bs-music-score')
  if (!score) throw new Error('缺少排版容器')
  score.textContent = ''

  // 预览里的每一次重建（改一个字就会重排）都命中缓存，乐谱不会闪
  const cacheKey = `${staffWidth}\u0000${source}`
  const cached = svgCache.get(cacheKey)
  if (cached) {
    score.innerHTML = cached
    block.querySelector<HTMLElement>('.bs-music-status')?.remove()
    return
  }

  const tunes = abc.renderAbc(score, source, {
    staffwidth: staffWidth,
    scale: 1,
    paddingtop: 0,
    paddingbottom: 0,
    paddingleft: 0,
    paddingright: 0,
    add_classes: false,
    responsive: undefined
  }) as unknown as unknown[] | null

  const svg = score.querySelector('svg')
  if (!tunes || tunes.length === 0 || !svg) {
    score.textContent = ''
    throw new Error('无法解析这段 ABC 记谱')
  }

  normalizeSvg(svg as SVGSVGElement, staffWidth)
  svgCache.set(cacheKey, score.innerHTML)
  if (svgCache.size > 40) {
    const oldest = svgCache.keys().next().value
    if (oldest !== undefined) svgCache.delete(oldest)
  }

  block.querySelector<HTMLElement>('.bs-music-status')?.remove()
}

/** ABC 源码 → 排好版并归一化过的 SVG 标记 */
const svgCache = new Map<string, string>()

/**
 * abcjs 给出的 SVG 带固定 width/height。这里补一个 viewBox 并改成百分比宽度，
 * 这样它在预览里能随容器缩放，同时导出时仍能从 viewBox 拿到真实尺寸。
 */
function normalizeSvg(svg: SVGSVGElement, fallbackWidth: number): void {
  const width = Number.parseFloat(svg.getAttribute('width') ?? '') || fallbackWidth
  const rawHeight = Number.parseFloat(svg.getAttribute('height') ?? '')
  const height = rawHeight > 0 ? rawHeight : Math.round(width * 0.32)
  if (!svg.getAttribute('viewBox')) svg.setAttribute('viewBox', `0 0 ${Math.round(width)} ${Math.round(height)}`)
  svg.removeAttribute('width')
  svg.removeAttribute('height')
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet')
  svg.setAttribute('role', 'img')
  svg.style.width = '100%'
  svg.style.height = 'auto'
  svg.style.maxWidth = '100%'
}

function markMusicError(block: HTMLElement, message: string, clearScore: boolean): void {
  block.dataset.bsMusicState = 'error'
  if (clearScore) {
    const score = block.querySelector<HTMLElement>('.bs-music-score')
    if (score) score.textContent = ''
  }
  const status = block.querySelector<HTMLElement>('.bs-music-status')
  if (status) {
    status.textContent = message
    status.classList.add('is-error')
  }
}

/* ------------------------------------------------------ SVG → 位图 */

/** 加载一张图（data:/blob:/asset: 都可以），失败返回 null */
export function loadHtmlImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => resolve(null)
    image.src = src
  })
}

/** 元素的固有尺寸（SVG 用 viewBox，普通图用 naturalWidth） */
export function intrinsicSize(element: Element): { width: number; height: number } {
  if (element instanceof SVGSVGElement) {
    const box = element.viewBox?.baseVal
    if (box && box.width > 0 && box.height > 0) return { width: box.width, height: box.height }
    const rect = element.getBoundingClientRect()
    return { width: rect.width || 720, height: rect.height || 240 }
  }
  const image = element as HTMLImageElement
  if (image.naturalWidth > 0) return { width: image.naturalWidth, height: image.naturalHeight }
  const rect = element.getBoundingClientRect()
  return { width: rect.width || 480, height: rect.height || 320 }
}

/**
 * 把一段渲染好的 SVG 乐谱序列化成 PNG。
 *
 * Word 不认识内联 SVG，只能嵌位图，所以导出 .docx 前必须先过一遍 canvas。
 * SVG 用 data: URL 喂给 <img>，不会污染 canvas（可以正常 toBlob）。
 */
export async function svgToPng(svg: SVGSVGElement, scale = 2): Promise<RasterImage | null> {
  const { width, height } = intrinsicSize(svg)
  const w = Math.max(1, Math.round(width))
  const h = Math.max(1, Math.round(height))

  const clone = svg.cloneNode(true) as SVGSVGElement
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  clone.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink')
  clone.setAttribute('width', String(w))
  clone.setAttribute('height', String(h))
  clone.setAttribute('viewBox', `0 0 ${w} ${h}`)
  clone.removeAttribute('style')

  const markup = new XMLSerializer().serializeToString(clone)
  const dataUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`
  const image = await loadHtmlImage(dataUrl)
  if (!image) return null

  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(w * scale))
  canvas.height = Math.max(1, Math.round(h * scale))
  const context = canvas.getContext('2d')
  if (!context) return null
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.setTransform(scale, 0, 0, scale, 0, 0)
  context.drawImage(image, 0, 0, w, h)

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
  if (!blob) return null
  const bytes = new Uint8Array(await blob.arrayBuffer())
  return { bytes, mime: 'image/png', width: canvas.width, height: canvas.height }
}

/** 任意位图（data URL）→ PNG 字节；用于把 webp/avif 这类 Word 不认的格式转掉 */
export async function rasterToPng(src: string): Promise<RasterImage | null> {
  const image = await loadHtmlImage(src)
  if (!image) return null
  const w = image.naturalWidth || 480
  const h = image.naturalHeight || 320
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const context = canvas.getContext('2d')
  if (!context) return null
  context.drawImage(image, 0, 0, w, h)
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
  if (!blob) return null
  return { bytes: new Uint8Array(await blob.arrayBuffer()), mime: 'image/png', width: w, height: h }
}
