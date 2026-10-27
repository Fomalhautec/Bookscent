/**
 * 批注导出为 PDF 层。
 *
 * 做法：用 pdf-lib 载入原始字节，把存在 BookRecord.annotations 里的
 * 归一化笔迹（0..1，相对「页面盒子左上角」）反归一化后逐页画上去。
 *
 * 坐标有两层换算：
 *  1. 归一化 y 轴向下（屏幕习惯）→ PDF 原点左下、y 轴向上：
 *     py = height * (1 - y)
 *  2. 批注是按「旋转后用户看到的画面」存的，pdf-lib 的页面永远是未旋转尺寸，
 *     所以还要按页面旋转角做一次逆变换，否则旋转过的页面批注会跑位。
 */

import { BlendMode, LineCapStyle, PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import type { PDFFont, PDFPage } from 'pdf-lib'
import type { AnnotationMap, AnnotationStroke, Point } from '@shared/types'
import { pointsBounds, textNoteRect, wrapText } from './geometry'

/** 解析 #rgb / #rrggbb / rgb() / rgba() 为 0..1 的 rgb 三元组 */
export function parseCssColor(value: string): { r: number; g: number; b: number; a: number } {
  const fallback = { r: 0.1, g: 0.1, b: 0.1, a: 1 }
  const input = (value || '').trim().toLowerCase()
  const hex = input.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/)
  if (hex) {
    const h = hex[1]
    const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h
    return {
      r: Number.parseInt(full.slice(0, 2), 16) / 255,
      g: Number.parseInt(full.slice(2, 4), 16) / 255,
      b: Number.parseInt(full.slice(4, 6), 16) / 255,
      a: 1
    }
  }
  const fn = input.match(/^rgba?\(([^)]+)\)$/)
  if (fn) {
    const parts = fn[1].split(/[,/\s]+/).filter(Boolean)
    const num = (raw: string, max: number): number => {
      const v = raw.endsWith('%') ? (Number.parseFloat(raw) / 100) * max : Number.parseFloat(raw)
      return Number.isFinite(v) ? v : 0
    }
    return {
      r: num(parts[0] ?? '0', 255) / 255,
      g: num(parts[1] ?? '0', 255) / 255,
      b: num(parts[2] ?? '0', 255) / 255,
      a: parts[3] ? num(parts[3], 1) : 1
    }
  }
  return fallback
}

/**
 * pdf-lib 的标准字体只覆盖 WinAnsi（拉丁 + 少量符号）。
 * 纯拉丁的便签直接用 pdf 文本画；只要出现非拉丁字符（中文便签是常态），
 * 就改用 canvas 光栅化成 PNG 贴上去 —— 这样任何语言都能如实导出，
 * 代价是这部分文字不可选中，所以只在必要时才走这条路。
 */
function toWinAnsi(text: string): { text: string; replaced: boolean } {
  let replaced = false
  let out = ''
  for (const ch of text) {
    if (ch === '\n') {
      out += ' '
      continue
    }
    const code = ch.codePointAt(0) ?? 0
    if ((code >= 32 && code <= 126) || (code >= 160 && code <= 255)) {
      out += ch
    } else {
      out += '?'
      replaced = true
    }
  }
  return { text: out, replaced }
}

/** 把一段便签文字画到离屏 canvas 上，返回 PNG 字节与它在页面上的尺寸（pt） */
async function rasterizeNote(
  lines: string[],
  fontPx: number,
  color: string,
  lineHeight: number
): Promise<{ png: Uint8Array; width: number; height: number } | null> {
  if (typeof document === 'undefined') return null
  const scale = 3
  const canvas = document.createElement('canvas')
  const probe = canvas.getContext('2d')
  if (!probe) return null

  const font = `${fontPx * scale}px "Noto Serif SC", "Songti SC", "Microsoft YaHei", system-ui, sans-serif`
  probe.font = font
  let widest = 0
  for (const line of lines) widest = Math.max(widest, probe.measureText(line).width)

  const padX = Math.ceil(2 * scale)
  const padY = Math.ceil(2 * scale)
  canvas.width = Math.max(2, Math.ceil(widest + padX * 2))
  canvas.height = Math.max(2, Math.ceil(lines.length * fontPx * lineHeight * scale + padY * 2))

  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.font = font
  ctx.fillStyle = color
  ctx.textBaseline = 'top'
  lines.forEach((line, index) => {
    ctx.fillText(line, padX, padY + index * fontPx * lineHeight * scale)
  })

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
  if (!blob) return null
  const bytes = new Uint8Array(await blob.arrayBuffer())
  return { png: bytes, width: canvas.width / scale, height: canvas.height / scale }
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

/** 旋转后的归一化坐标 → 未旋转页面空间的归一化坐标 */
function inverseRotate(x: number, y: number, rotation: number): Point {
  const r = ((rotation % 360) + 360) % 360
  switch (r) {
    case 90:
      return { x: y, y: 1 - x }
    case 180:
      return { x: 1 - x, y: 1 - y }
    case 270:
      return { x: 1 - y, y: x }
    default:
      return { x, y }
  }
}

/** 归一化点 → pdf-lib 页面坐标（原点左下、y 轴向上） */
function toPagePoint(point: Point, rotation: number, width: number, height: number): Point {
  const mapped = inverseRotate(point.x, point.y, rotation)
  return { x: mapped.x * width, y: height * (1 - mapped.y) }
}

/** 一条笔迹 → SVG path 串（相对页面左上角、y 轴向下，供 drawSvgPath 使用） */
function strokePath(stroke: AnnotationStroke, rotation: number, pageWidth: number, pageHeight: number): string {
  const pts = stroke.points
  if (pts.length === 0) return ''
  const first = toPagePoint(pts[0], rotation, pageWidth, pageHeight)
  let d = `M ${round2(first.x)} ${round2(pageHeight - first.y)}`
  for (let i = 1; i < pts.length; i += 1) {
    const p = toPagePoint(pts[i], rotation, pageWidth, pageHeight)
    d += ` L ${round2(p.x)} ${round2(pageHeight - p.y)}`
  }
  return d
}

function opacityOf(stroke: AnnotationStroke, fallback: number, max: number): number {
  const value = stroke.opacity && stroke.opacity > 0 ? stroke.opacity : fallback
  return Math.min(max, Math.max(0.08, value))
}

/** 把一页的笔迹画到 pdf-lib 的页面上 */
export async function drawStrokesOnPage(
  page: PDFPage,
  strokes: AnnotationStroke[],
  font: PDFFont,
  rotation = 0
): Promise<{ drawn: number; sanitized: number }> {
  const { width, height } = page.getSize()
  let drawn = 0
  let sanitized = 0

  for (const stroke of strokes) {
    const parsed = parseCssColor(stroke.color)
    const pdfColor = rgb(parsed.r, parsed.g, parsed.b)
    const lineWidth = Math.max(0.4, stroke.width * width)

    if (stroke.tool === 'text') {
      const note = (stroke.text ?? '').trim()
      if (!note) continue
      const rect = textNoteRect(stroke)
      const fontPx = Math.max(6, (stroke.fontSize ?? 0.0175) * height)
      const maxChars = Math.max(6, Math.floor((rect.width * width) / (fontPx * 0.58)))
      const lines = wrapText(note, maxChars)
      const topLeft = toPagePoint({ x: rect.x, y: rect.y }, rotation, width, height)
      const needsRaster = lines.some((line) => toWinAnsi(line).replaced)

      if (needsRaster) {
        // 含中文等非 WinAnsi 字符：光栅化后贴图，保证所见即所得
        const raster = await rasterizeNote(lines, fontPx, stroke.color, 1.28)
        if (raster) {
          try {
            const image = await page.doc.embedPng(raster.png)
            page.drawImage(image, {
              x: topLeft.x,
              y: topLeft.y - raster.height + fontPx * 0.28,
              width: raster.width,
              height: raster.height,
              opacity: opacityOf(stroke, 1, 1)
            })
            sanitized += 1
            drawn += 1
            continue
          } catch {
            /* 贴图失败就退回文本路径 */
          }
        }
      }

      for (let i = 0; i < lines.length; i += 1) {
        const converted = toWinAnsi(lines[i])
        if (converted.replaced) sanitized += 1
        if (!converted.text.trim()) continue
        page.drawText(converted.text, {
          x: topLeft.x,
          y: topLeft.y - fontPx * (i + 1),
          size: fontPx,
          font,
          color: pdfColor,
          opacity: opacityOf(stroke, 1, 1)
        })
      }
      drawn += 1
      continue
    }

    if (stroke.tool === 'highlighter') {
      const bounds = pointsBounds(stroke.points)
      if (!bounds) continue
      const thickness = Math.max(2, stroke.width * width)
      // 视觉空间里的矩形转到未旋转空间后依然是轴对齐矩形，取四角包围盒即可
      const corners = [
        { x: bounds.x, y: bounds.y },
        { x: bounds.x + bounds.width, y: bounds.y },
        { x: bounds.x, y: bounds.y + bounds.height },
        { x: bounds.x + bounds.width, y: bounds.y + bounds.height }
      ].map((p) => inverseRotate(p.x, p.y, rotation))
      const minX = Math.min(...corners.map((c) => c.x))
      const maxX = Math.max(...corners.map((c) => c.x))
      const minY = Math.min(...corners.map((c) => c.y))
      const maxY = Math.max(...corners.map((c) => c.y))
      page.drawRectangle({
        x: minX * width,
        y: height - maxY * height - thickness * 0.25,
        width: Math.max(1, (maxX - minX) * width),
        height: Math.max(1, (maxY - minY) * height + thickness * 0.5),
        color: pdfColor,
        opacity: opacityOf(stroke, 0.32, 0.65),
        blendMode: BlendMode.Multiply
      })
      drawn += 1
      continue
    }

    if (stroke.tool === 'underline') {
      const pts = stroke.points
      if (pts.length === 0) continue
      const a = pts[0]
      const b = pts[pts.length - 1]
      const endNormalized = b.x === a.x ? { x: Math.min(1, a.x + 0.06), y: b.y } : b
      page.drawLine({
        start: toPagePoint(a, rotation, width, height),
        end: toPagePoint(endNormalized, rotation, width, height),
        thickness: Math.max(0.6, lineWidth),
        color: pdfColor,
        opacity: opacityOf(stroke, 1, 1),
        lineCap: LineCapStyle.Round
      })
      drawn += 1
      continue
    }

    // pen / line / arrow / rect / ellipse 统一按折线画，保证「所见即所存」
    const path = strokePath(stroke, rotation, width, height)
    if (!path) continue
    page.drawSvgPath(path, {
      // SVG 原点落在页面左上角，pdf-lib 内部再翻转 y 轴
      x: 0,
      y: height,
      borderColor: pdfColor,
      borderWidth: lineWidth,
      borderOpacity: opacityOf(stroke, 1, 1),
      borderLineCap: LineCapStyle.Round
    })
    drawn += 1
  }

  return { drawn, sanitized }
}

/** 载入原始字节 → 画批注 → 返回新的 PDF 字节 */
export async function buildAnnotatedPdf(
  originalBytes: Uint8Array,
  annotations: AnnotationMap
): Promise<{ bytes: Uint8Array; drawn: number; sanitized: number }> {
  const pdf = await PDFDocument.load(originalBytes, { ignoreEncryption: true, updateMetadata: false })
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const pages = pdf.getPages()
  let drawn = 0
  let sanitized = 0

  for (const [key, strokes] of Object.entries(annotations)) {
    const pageNumber = Number.parseInt(key, 10)
    if (!Number.isFinite(pageNumber) || pageNumber < 1 || pageNumber > pages.length) continue
    if (!Array.isArray(strokes) || strokes.length === 0) continue
    const page = pages[pageNumber - 1]
    // 页面自带旋转 /Rotate 也要抵消
    const rotation = page.getRotation().angle
    const result = await drawStrokesOnPage(page, strokes, font, rotation)
    drawn += result.drawn
    sanitized += result.sanitized
  }

  const bytes = await pdf.save({ useObjectStreams: true })
  return { bytes, drawn, sanitized }
}
