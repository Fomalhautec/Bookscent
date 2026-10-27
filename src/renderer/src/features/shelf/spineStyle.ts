import { mix, readableOn } from '@shared/themes'
import type { Book, BookFacing, BookFormat, BookStyle } from '@shared/types'

/* ------------------------------------------------------------ 材质与渐变 */

/** 书脊正面的横向渐变：模拟圆柱面受光，是"仿真"的关键一步 */
export function spineGradient(style: BookStyle): string {
  const c = style.spineColor
  const c2 = style.spineColor2 || mix(c, '#000000', 0.3)
  switch (style.spinePreset) {
    case 'leather':
      return `linear-gradient(90deg, ${mix(c2, '#000000', 0.3)} 0%, ${mix(c, '#000000', 0.14)} 11%, ${mix(
        c,
        '#ffffff',
        0.17
      )} 29%, ${c} 52%, ${mix(c, '#000000', 0.18)} 79%, ${c2} 100%)`
    case 'cloth':
      return `linear-gradient(90deg, ${mix(c, '#000000', 0.2)} 0%, ${c} 21%, ${mix(
        c,
        '#ffffff',
        0.08
      )} 44%, ${c} 69%, ${mix(c, '#000000', 0.16)} 100%)`
    case 'paper':
      return `linear-gradient(90deg, ${c2} 0%, ${c} 17%, ${mix(c, '#ffffff', 0.24)} 45%, ${c} 75%, ${c2} 100%)`
    case 'modern':
      return `linear-gradient(180deg, ${mix(c, '#ffffff', 0.07)} 0%, ${c} 42%, ${mix(c, '#000000', 0.1)} 100%)`
    case 'flat':
      // 完全平面：不做左右弧面渐变，只有一丁点上下的明暗免得像坏掉的色块
      return `linear-gradient(180deg, ${mix(c, '#ffffff', 0.03)} 0%, ${c} 55%, ${mix(c, '#000000', 0.04)} 100%)`
    case 'gilded':
      return `linear-gradient(90deg, ${mix(c2, '#000000', 0.34)} 0%, ${c} 19%, ${mix(
        c,
        '#ffffff',
        0.12
      )} 46%, ${c} 71%, ${c2} 100%)`
    case 'photo':
      return `linear-gradient(90deg, ${mix(c, '#000000', 0.12)} 0%, ${c} 55%, ${mix(c, '#000000', 0.14)} 100%)`
    default:
      return `linear-gradient(90deg, ${c2}, ${c})`
  }
}

/** 书脊上的第二层纹理（布纹 / 皮纹 / 纸纹），用 repeating-gradient 叠出来 */
export function spineTextureLayers(style: BookStyle): string {
  const ink = mix(style.spineColor, '#000000', 0.5)
  switch (style.spinePreset) {
    case 'leather':
      return `repeating-linear-gradient(64deg, ${ink}0d 0 2px, transparent 2px 5px),
              repeating-linear-gradient(-46deg, ${ink}0a 0 1px, transparent 1px 4px)`
    case 'cloth':
      return `repeating-linear-gradient(0deg, ${ink}14 0 1px, transparent 1px 3px),
              repeating-linear-gradient(90deg, ${ink}10 0 1px, transparent 1px 3px)`
    case 'paper':
      return `repeating-linear-gradient(0deg, ${ink}0a 0 1px, transparent 1px 7px)`
    case 'gilded':
      return `repeating-linear-gradient(72deg, ${ink}12 0 1px, transparent 1px 6px)`
    default:
      return 'none'
  }
}

export interface SpineBox {
  width: number
  height: number
}

export function spineUsesImage(style: BookStyle): boolean {
  return Boolean(style.spineImage)
}

/**
 * 书脊竖排时文字的方向。
 *
 * 一律用 `mixed`：中文按正立排，而**英文与数字会转 90° 横躺**，
 * 这才是竖排的常理（`upright` 会把字母和数字也一个个正立堆起来，
 * 像 "2024" 变成竖着摞的四块数字，非常难看）。
 * 中文在 mixed 下本来就是正立的，所以这个选择对中文标题没有任何损失。
 */
export function spineTextOrientation(_title: string): 'upright' | 'mixed' {
  return 'mixed'
}

export function spineFontSize(style: BookStyle, width: number, title: string): number {
  const base = style.spineTextDirection === 'vertical' ? Math.min(width * 0.46, 15) : 12
  const len = title.length
  if (len > 22) return Math.max(9.5, base - 3.5)
  if (len > 14) return Math.max(10.5, base - 2)
  if (len > 8) return Math.max(11.5, base - 1)
  return base
}

const CJK_RE = /[\u3400-\u4dbf\u4e00-\u9fff\u3000-\u303f\uff00-\uffef\u3040-\u30ff\uac00-\ud7af]/

/** 竖排时一个字符沿行内（竖直）方向推进的距离 */
function inlineAdvance(text: string, size: number, upright: boolean): number {
  let total = 0
  for (const ch of text) {
    if (CJK_RE.test(ch)) total += size * 1.02
    else if (ch === ' ') total += size * 0.3
    else total += upright ? size * 0.62 : size * 0.52
  }
  return total
}

/** 竖排时一行（=一列）的宽度占字号的倍数，与 shelf.css 的 line-height 对应 */
const COLUMN_RATIO = 1.16

export interface SpineTitleFit {
  fontSize: number
  /** 竖排会折成几列（横排恒为 1） */
  columns: number
  /**
   * 书名区盒子应有的宽度。
   *
   * `writing-mode: vertical-rl` 的块流方向是**从右往左**，
   * 所以文字默认贴着盒子右边缘——盒子再宽也不会自动居中。
   * 把盒子宽度收紧到"刚好放得下这些列"，再整体水平居中，书名才真正居中。
   */
  boxWidth: number
}

/**
 * 选一个能让书名"装得下"的字号，并算出居中所需要的盒子宽度。
 *
 * 竖排时文字超出可用高度会自动折成多列（vertical-rl 的列从右往左排），
 * 所以只要保证「列数 × 列宽」不超过书名区的宽度，书名就不会被裁掉开头。
 * 横排是整体旋转 90°，可用长度就是书脊高度，按字符数缩到合适为止。
 *
 * 这里的盒子尺寸必须与 shelf.css 里 .spine-title 的百分比保持一致。
 */
export function fitSpineTitle(
  title: string,
  width: number,
  height: number,
  direction: BookStyle['spineTextDirection']
): SpineTitleFit {
  const text = title.trim() || '无题'
  const round = (n: number): number => Math.round(n * 10) / 10

  if (direction === 'horizontal') {
    const avail = Math.max(40, height - 48)
    let size = Math.min(width * 0.52, 13)
    while (size > 8 && inlineAdvance(text, size, false) * 1.02 > avail) size -= 0.5
    const fontSize = round(size)
    // 横排是 rotate(90°) 的单行，盒子宽度=书脊宽度，不需要额外居中处理
    return { fontSize, columns: 1, boxWidth: 0 }
  }

  const avail = Math.max(38, height * 0.63)
  const usableWidth = Math.max(12, width * 0.9)
  const upright = true

  for (let size = Math.min(width * 0.42, 14); size >= 8; size -= 0.5) {
    const length = inlineAdvance(text, size, upright)
    const columns = Math.max(1, Math.ceil(length / avail))
    const boxWidth = columns * size * COLUMN_RATIO
    if (boxWidth <= usableWidth) {
      return { fontSize: round(size), columns, boxWidth: Math.ceil(boxWidth) }
    }
  }

  // 放到最小也塞不下：按可用宽度反推能排几列，宁可多折一列也不要裁字
  const smallest = 8
  const columns = Math.max(1, Math.ceil(inlineAdvance(text, smallest, upright) / avail))
  return {
    fontSize: smallest,
    columns,
    boxWidth: Math.min(Math.ceil(columns * smallest * COLUMN_RATIO), Math.ceil(usableWidth))
  }
}

/** 只要字号时的便捷包装 */
export function fitSpineFontSize(
  title: string,
  width: number,
  height: number,
  direction: BookStyle['spineTextDirection']
): number {
  return fitSpineTitle(title, width, height, direction).fontSize
}

/** 书脊底部的作者署名只在放得下时才显示 */
export function canShowSpineAuthor(author: string, height: number): boolean {
  if (!author) return false
  const limit = Math.max(28, height * 0.24)
  return inlineAdvance(author, 9.5, true) <= limit
}

/** 书脊底色上的可读文字色（用户没显式指定时兜底） */
export function autoSpineTextColor(style: BookStyle): string {
  return style.spineTextColor || readableOn(style.spineColor)
}

/* --------------------------------------------------------------- 图标 */

export type SpineIconKind = BookFormat | 'unknown'

/** 书脊上那枚小小的格式标记——用文字缩写而不是图标，缩到 12px 也认得出 */
export function formatBadge(format: BookFormat): string {
  switch (format) {
    case 'pdf':
      return 'PDF'
    case 'md':
    case 'markdown':
      return 'MD'
    case 'txt':
      return 'TXT'
    case 'doc':
    case 'docx':
      return 'DOC'
    case 'rtf':
      return 'RTF'
    case 'html':
      return 'HTML'
    case 'epub':
      return 'EPUB'
    case 'image':
      return 'IMG'
    default:
      return '·'
  }
}

/* --------------------------------------------------------- 书籍色调兜底 */

export function bookAccent(book: Book): string {
  return book.style?.spineColor || book.accent || '#8a4b3a'
}

/* ------------------------------------------------------------ 朝向与占位 */

/**
 * 封面深度（封面朝外时这本书占的横向宽度）。
 * 与 BookCoverArt 的 2:3 比例保持一致。
 */
/** 封面的进深（封面朝外时的宽度）。给了贴图就听贴图的比例 */
export function coverDepth(height: number, style?: BookStyle): number {
  if (style?.coverImage) return coverImageDepth(height, style)
  return Math.max(48, Math.round(height / 1.5))
}

/**
 * 倾斜的书会比自己的盒子宽出多少。
 *
 * `.book` 是绕底边中点 rotate 的，一个 W×H 的盒子转过 θ 之后的横向宽度是
 * W·cosθ + H·sinθ —— 多出来的部分没人替它留位置，
 * 所以一层里最后一本略微倾斜的厚书就会顶出书架边框。
 * 装箱时把这段算进去，位置就留出来了。
 */
export function tiltSpill(width: number, height: number, tilt: number): number {
  const rad = (Math.abs(tilt) * Math.PI) / 180
  if (rad < 0.001) return 0
  const rotated = width * Math.cos(rad) + height * Math.sin(rad)
  return Math.max(0, Math.ceil(rotated - width))
}

/**
 * 这根书脊该不该有弧度。
 *
 * `auto` 的判断：平板装帧与贴了书脊图的都不该有 ——
 * 一张自己的照片上再叠一层假明暗只会显得脏；皮革布纹这类才需要那道圆柱光。
 */
export function spineHasCurve(style: BookStyle): boolean {
  if (style.spineCurve === 'curved') return true
  if (style.spineCurve === 'flat') return false
  if (style.spineImage) return false
  return style.spinePreset !== 'flat'
}

/** 书脊贴图的宽高比兜底值（1:6 左右，和一本普通平装书差不多） */
export const DEFAULT_SPINE_IMAGE_ASPECT = 1 / 6
/** 封面图的宽高比兜底值（很多书的封面接近 2:3） */
export const DEFAULT_COVER_IMAGE_ASPECT = 2 / 3

/** 贴图满铺时书脊该有多厚：按贴图比例 × 书高，并夹在一个说得过去的区间里 */
export function spineImageWidth(height: number, style: BookStyle): number {
  const aspect = style.spineImageAspect && style.spineImageAspect > 0
    ? style.spineImageAspect
    : DEFAULT_SPINE_IMAGE_ASPECT
  return Math.max(14, Math.min(240, Math.round(height * aspect)))
}

/** 同样地，封面图满铺时封面该有多宽 */
export function coverImageDepth(height: number, style: BookStyle): number {
  const aspect = style.coverImageAspect && style.coverImageAspect > 0
    ? style.coverImageAspect
    : DEFAULT_COVER_IMAGE_ASPECT
  return Math.max(24, Math.min(height * 1.6, Math.round(height * aspect)))
}

/**
 * 这本书在当前朝向下占据的横向宽度。
 *
 * 书架按宽度装箱，所以必须按投影宽度算，否则相邻的书会互相压住。
 * 自定义角度下就是「书脊投影 + 封面投影」。
 * `gap` 是额外留给相邻两本书之间的间距 —— 封面朝外时书与书需要喘口气。
 */
export function bookFootprint(
  spineWidth: number,
  height: number,
  facing: BookFacing,
  gap = 0
): number {
  /*
   * 只剩两种朝向：
   *  - 书脊朝外：占位就是书脊自身宽度；
   *  - 封面朝外：占位是封面进深 + 书与书之间的间隙。
   * （曾经还有 'angled' 自定义角度，需要算投影宽度，已删除。）
   */
  if (facing === 'spine') return spineWidth
  return coverDepth(height) + gap
}

/**
 * 这个书立在当前朝向下是否"从这里另起一行"。
 *
 * 书脊与封面模式下书的宽度差很多，同一个断点常常只对其中一种合适，
 * 所以书立可以按朝向分别设（`breakLineCover` 缺省时沿用 `breakLine`）。
 */
export function bookendBreaksLine(
  entry: { breakLine?: boolean; breakLineCover?: boolean },
  facing: BookFacing
): boolean {
  if (facing === 'cover' && typeof entry.breakLineCover === 'boolean') return entry.breakLineCover
  return entry.breakLine === true
}

/**
 * 这个书立在当前朝向下是否生效。
 *
 * 书脊模式与封面模式下书的宽度差很多（书脊几十像素、封面是一整张图的进深），
 * 同一个"到此另起一行"在一种模式里正合适，在另一种里会把书架切得很难看，
 * 所以书立可以只在某一种朝向下生效。老数据没有 facing 字段 = 两种都生效。
 */
export function bookendFitsFacing(
  entry: { facing?: 'both' | 'spine' | 'cover' },
  facing: BookFacing
): boolean {
  const scope = entry.facing ?? 'both'
  return scope === 'both' || scope === facing
}