/**
 * 设置 · 预览件
 * 这一组组件只做一件事：把一套颜色/样式画成看得见的小样。
 * 主题预览把令牌铺成 CSS 变量，因此子树里的 var(--bg-surface) 会跟着变。
 */

import type { CSSProperties, ReactNode } from 'react'
import { imageSrc } from '@shared/noteUrl'
import { SPINE_PALETTE, mix, resolveTokens, tokensToCssVars } from '@shared/themes'
import type { BookFormat, BookStyle, ThemePreset, ThemeTokens, UiSettings } from '@shared/types'
import { IconFileMarkdown, IconFilePdf, IconFileText, IconFileWord, IconImage } from '@/components/icons/Icons'
import { fitSpineTitle } from '@/features/shelf/spineStyle'
import { spineWidthFor, stableRandom } from '@/lib/theme'

/* ------------------------------------------------------------------ 变量 */

/** 主题令牌 → CSS 自定义属性（TS 的 CSSProperties 没有索引签名，这里收口一次断言） */
export function tokenVars(tokens: Partial<ThemeTokens>): CSSProperties {
  return tokensToCssVars(tokens) as unknown as CSSProperties
}

/** 任意自定义属性集合 → style */
export function rawVars(vars: Record<string, string>): CSSProperties {
  return vars as unknown as CSSProperties
}

/* -------------------------------------------------------- 格式图标 */

export function formatIcon(format: BookFormat, size = 12): ReactNode {
  switch (format) {
    case 'pdf':
      return <IconFilePdf size={size} />
    case 'md':
    case 'markdown':
      return <IconFileMarkdown size={size} />
    case 'doc':
    case 'docx':
      return <IconFileWord size={size} />
    case 'image':
      return <IconImage size={size} />
    default:
      return <IconFileText size={size} />
  }
}

/* ------------------------------------------------------ 应用主题小窗预览 */

/**
 * 迷你假窗口：标题栏 / 侧栏条 / 两行文字 / 一枚强调按钮。
 * 之所以不画成一个色块，是为了让"这套主题到底长什么样"一眼可辨。
 */
export function ThemeMock({ preset }: { preset: ThemePreset }): ReactNode {
  const tokens = resolveTokens(preset)
  return (
    <div className="set-mock" style={tokenVars(tokens)}>
      <div className="set-mock-bar">
        <span className="set-mock-dot" />
        <span className="set-mock-dot" />
        <span className="set-mock-dot" />
        <span className="set-mock-title">书香笔记</span>
      </div>
      <div className="set-mock-body">
        <div className="set-mock-side">
          <span className="set-mock-nav is-on" />
          <span className="set-mock-nav" />
          <span className="set-mock-nav" />
          <span className="set-mock-nav is-short" />
        </div>
        <div className="set-mock-main">
          <span className="set-mock-line" style={{ width: '72%' }} />
          <span className="set-mock-line" style={{ width: '54%' }} />
          <span className="set-mock-line is-faint" style={{ width: '64%' }} />
          <span className="set-mock-btn">开始阅读</span>
        </div>
      </div>
      <div className="set-mock-swatch">
        {preset.swatch.slice(0, 3).map((color) => (
          <span key={color} className="set-mock-swatch-dot" style={{ background: color }} />
        ))}
      </div>
    </div>
  )
}

/* ------------------------------------------------------ 书架主题小格预览 */

export interface ShelfBook {
  /** 高度比例 0.6 ~ 1 */
  height: number
  /** 倾角（度） */
  tilt: number
}

export function shelfBooks(
  count: number,
  ui?: Pick<UiSettings, 'shelfTilt' | 'bookHeightVariation'>,
  seedPrefix = 'preview'
): ShelfBook[] {
  const variation = Math.max(0, Math.min(0.4, ui?.bookHeightVariation ?? 0.1))
  const tiltAmount = Math.max(0, Math.min(1, ui?.shelfTilt ?? 0.3))
  const books: ShelfBook[] = []
  for (let i = 0; i < count; i++) {
    const r = stableRandom(`${seedPrefix}-${i}`, 7)
    const t = stableRandom(`${seedPrefix}-${i}`, 23)
    // 大多数书直立，偶尔有一两本歪着靠在邻书上
    const tilt = t > 0.76 ? Math.round((t - 0.76) * 30 * tiltAmount * 10) / 10 : 0
    books.push({ height: 1 - variation * (0.35 + 0.65 * r), tilt })
  }
  return books
}

export function ShelfMock({
  preset,
  books,
  showPlaque = true,
  showShadow = true,
  plankLabel,
  height = 108
}: {
  preset: ThemePreset
  books: ShelfBook[]
  showPlaque?: boolean
  showShadow?: boolean
  plankLabel?: string
  height?: number
}): ReactNode {
  const tokens = resolveTokens(preset)
  const wood1 = tokens['shelf-wood-1']
  const wood3 = tokens['shelf-wood-3']
  return (
    <div className={`set-shelf ${showShadow ? 'has-shadow' : ''}`} style={tokenVars(tokens)}>
      <div className="set-shelf-screen" style={{ height }}>
        <div className="set-shelf-cavity" />
        <div className="set-shelf-books">
          {books.map((book, index) => {
            const palette = SPINE_PALETTE[(index * 5 + 3) % SPINE_PALETTE.length]
            const c1 = mix(palette, wood1, 0.22)
            const c2 = mix(palette, wood3, 0.4)
            return (
              <span
                key={`${index}-${palette}`}
                className="set-shelf-book"
                style={{
                  height: `${Math.round(book.height * 100)}%`,
                  transform: book.tilt ? `rotate(${book.tilt}deg)` : undefined,
                  backgroundImage: [
                    'linear-gradient(to right, rgba(255,255,255,.26), rgba(255,255,255,0) 38%, rgba(0,0,0,.28))',
                    `repeating-linear-gradient(90deg, ${c1} 0 2px, ${c2} 2px 3px, ${c1} 3px 5px)`,
                    `linear-gradient(180deg, ${c1}, ${c2})`
                  ].join(', ')
                }}
              />
            )
          })}
        </div>
        <div className="set-shelf-plank">
          <span className="set-shelf-plank-top" />
          {showPlaque ? <span className="set-shelf-plaque">{plankLabel ?? '第三层'}</span> : null}
        </div>
      </div>
    </div>
  )
}

/* -------------------------------------------------------- 书脊（真样式） */

export interface SpineViewProps {
  style: BookStyle
  pages: number
  title: string
  format?: BookFormat
  height?: number
  /** 指定宽度（选择器里的小样用），不传则由页数决定 */
  width?: number
}

export function SpineView({ style, pages, title, format = 'md', height = 168, width }: SpineViewProps): ReactNode {
  const computed = width ?? spineWidthFor(pages, style)
  const vertical = style.spineTextDirection === 'vertical'
  // 书脊只有一条窄面，字数要按宽度估一估，免得横排时被切到半个字
  const maxChars = vertical
    ? 9
    : Math.max(2, Math.floor((computed - 8) / (Math.max(9, Math.min(13, computed * 0.26)) * 0.9)))
  const vars: Record<string, string> = {
    '--bs-1': style.spineColor,
    '--bs-2': style.spineColor2,
    '--bs-foil': style.foilColor,
    '--bs-ink': style.spineTextColor
  }
  // 贴图字段可能是 `asset:<文件名>`，必须先过 imageSrc() 换成 asset:// 地址
  const spinePhoto = imageSrc(style.spineImage)
  const texture: CSSProperties = spinePhoto
    ? {
        backgroundImage: `linear-gradient(to right, rgba(255,255,255,.16), rgba(0,0,0,.2)), url("${spinePhoto}")`,
        backgroundSize: 'cover',
        backgroundPosition: 'center'
      }
    : {}

  // 纸质标签里的书名要按"标签这块纸"来排，不能按整条书脊算（与书架上的算法一致）
  const normalFit = fitSpineTitle(
    title,
    Math.max(14, computed - 6),
    Math.max(30, height * 0.63),
    style.spineTextDirection
  )
  const labelFit = fitSpineTitle(
    title,
    Math.max(14, computed * 0.76 - 4),
    Math.max(24, height * 0.6 - 8),
    'vertical'
  )

  return (
    <span
      className={`set-spine p-${style.spinePreset} o-${style.ornament}`}
      style={{
        ...rawVars(vars),
        ...texture,
        width: computed,
        height,
        transform: style.tilt ? `rotate(${style.tilt}deg)` : undefined,
        color: style.spineTextColor,
        fontFamily: style.fontFamily
      }}
    >
      <SpineOrnamentView ornament={style.ornament} />
      {style.ornament === 'label' ? (
        <span className="set-spine-label">
          <span
            className="set-spine-label-text"
            style={{ fontSize: `${labelFit.fontSize}px`, width: `${labelFit.boxWidth}px` }}
          >
            {title.slice(0, maxChars)}
          </span>
        </span>
      ) : (
        <span
          className={`set-spine-title ${vertical ? 'is-vertical' : 'is-horizontal'}`}
          style={{
            fontSize: `${normalFit.fontSize}px`,
            // 竖排必须把盒子收紧到"刚好放得下这些列"，否则 vertical-rl 的列会贴着右边
            ...(vertical && normalFit.boxWidth > 0 ? { width: `${normalFit.boxWidth}px` } : null)
          }}
        >
          {title.slice(0, maxChars)}
        </span>
      )}
      {style.showFormatIcon ? (
        <span
          className="set-spine-icon"
          style={{ color: style.foilColor, zIndex: style.ornament === 'label' ? 4 : undefined }}
        >
          {formatIcon(format, Math.max(10, Math.min(14, computed * 0.3)))}
        </span>
      ) : null}
      {style.spineImage ? <span className="set-spine-photo-tag">贴图</span> : null}
    </span>
  )
}

/**
 * 书脊装饰小样。
 *
 * 位置必须与 shelf.css 里的 .spine-bands / .spine-ribs / .spine-foil-lines 对齐，
 * 否则预览里的书名会和装饰撞在一起，看着像另一套样式。
 * 纸质标签本身就是书名的载体，所以这里不出装饰，由 SpineView 画标签盒子。
 */
export function SpineOrnamentView({ ornament }: { ornament: BookStyle['ornament'] }): ReactNode {
  switch (ornament) {
    // 头尾各两道横带（与 .spine-bands i 的 12% / 17.5% 一致）
    case 'bands':
      return (
        <>
          <span className="set-spine-band" style={{ top: '12%' }} />
          <span className="set-spine-band" style={{ top: '17.5%' }} />
          <span className="set-spine-band" style={{ bottom: '17.5%' }} />
          <span className="set-spine-band" style={{ bottom: '12%' }} />
        </>
      )
    // 头尾各一组双线（与 .spine-foil-lines 的 8% 一致）
    case 'foil':
      return (
        <>
          <span className="set-spine-foil is-top" style={{ top: '8%' }} />
          <span className="set-spine-foil is-bottom" style={{ bottom: '8%' }} />
        </>
      )
    case 'label':
      return null
    // 竹节占首尾两段，中间留给书名（与 .book-ornament-ribs .spine-ribs 的 inset: 6% 一致）
    case 'ribs':
      return (
        <>
          <span className="set-spine-rib" style={{ top: '8%' }} />
          <span className="set-spine-rib" style={{ top: '16%' }} />
          <span className="set-spine-rib" style={{ bottom: '16%' }} />
          <span className="set-spine-rib" style={{ bottom: '8%' }} />
        </>
      )
    case 'none':
    default:
      return null
  }
}

/* ------------------------------------------------------------- 封面小样 */

export function CoverView({
  style,
  width = 72,
  title = '书香'
}: {
  style: BookStyle
  width?: number
  title?: string
}): ReactNode {
  const height = Math.round(width * 1.42)
  const vars: Record<string, string> = {
    '--cv-1': style.coverColor,
    '--cv-2': style.coverColor2,
    '--cv-foil': style.foilColor,
    '--cv-ink': style.coverTextColor
  }
  // 封面图同样可能是 `asset:<文件名>`，直接拼进 url() 是无效地址
  const coverPhoto = imageSrc(style.coverImage)
  return (
    <span
      className={`set-cover c-${style.coverPreset}`}
      style={{
        ...rawVars(vars),
        width,
        height,
        color: style.coverTextColor,
        fontFamily: style.fontFamily
      }}
    >
      {coverPhoto ? (
        <span className="set-cover-image" style={{ backgroundImage: `url("${coverPhoto}")` }} />
      ) : (
        <span className="set-cover-frame" />
      )}
      <span className="set-cover-title" style={{ fontSize: Math.max(9, Math.round(width * 0.17)) }}>
        {title}
      </span>
    </span>
  )
}

/* ------------------------------------------------------------ 颜色小圆点 */

export function Swatch({ color, size = 12 }: { color: string; size?: number }): ReactNode {
  return <span className="set-swatch" style={{ background: color, width: size, height: size }} />
}
