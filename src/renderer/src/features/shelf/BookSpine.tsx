import { memo, type CSSProperties, type ReactNode } from 'react'
import { mix } from '@shared/themes'
import { imageSrc } from '@shared/noteUrl'
import type { Book, BookFacing, BookStyle, UiSettings } from '@shared/types'
import { FORMAT_LABEL } from '@shared/types'
import { BookCoverArt } from './BookCoverArt'
import {
  autoSpineTextColor,
  spineHasCurve,
  canShowSpineAuthor,
  coverDepth,
  fitSpineTitle,
  formatBadge,
  spineGradient,
  spineTextOrientation,
  spineTextureLayers
} from './spineStyle'
import { IconBookmarkFilled } from '@/components/icons/Icons'

export interface BookSpineProps {
  book: Book
  style: BookStyle
  /** 书脊实际厚度（页数决定） */
  width: number
  /** 书架给这本书的外框宽度（含朝向投影），由 bookFootprint 算出 */
  footprint: number
  height: number
  tilt: number
  facing: BookFacing
  ui: UiSettings
  selected: boolean
  marked: boolean
  /**
   * 阅读进度 0–100；0 表示不画。
   *
   * 一个数同时管两种画法：书脊朝外时是书脊左侧那条细竖条，
   * 封面朝外时是压在封面上的圆环 —— 圆环由父级以 `progressOverlay`
   * 传进来，省得每个书架组件各画一遍。
   */
  progress?: number
  /** 封面朝外时压在封面上的进度圆环（由 BookshelfView 提供） */
  progressOverlay?: ReactNode
  dragging?: boolean
  /** 额外的类名（例如拖动落点指示 is-drop-before） */
  className?: string
  onOpen: (book: Book) => void
  onContext: (book: Book, event: React.MouseEvent) => void
  onHover?: (book: Book, rect: DOMRect) => void
  onLeave?: () => void
  onDouble?: (book: Book) => void
  onDragStart?: (book: Book, event: React.PointerEvent) => void
}

/**
 * 一本立在书架上的书。
 *
 * 书脊面按需求呈现三种朝向：
 *  1. `spine`  —— 书脊朝外（默认），宽度由页数决定；
 *  2. `cover`  —— 封面朝外，像书店的封面陈列；
 *  3. `angled` —— 自定义角度，用 preserve-3d 把书脊与封面两个面转出来。
 *
 * 任意朝向下，用户插入过书脊/封面图片就以图片为准。
 *
 * 悬停时"抽出封面"的预览不在这里画：它会被书架的滚动容器裁掉，
 * 改由 BookshelfView 用 portal 渲染到 body 上（见 CoverPeek）。
 */
export const BookSpine = memo(function BookSpine({
  book,
  style,
  width,
  footprint,
  height,
  tilt,
  facing,
  ui,
  selected,
  marked,
  progress = 0,
  progressOverlay,
  dragging,
  className,
  onOpen,
  onContext,
  onHover,
  onLeave,
  onDouble,
  onDragStart
}: BookSpineProps): ReactNode {
  const ink = autoSpineTextColor(style)
  const curve = spineHasCurve(style)
  const vars: CSSProperties & Record<string, string> = {
    '--spine-w': `${width}px`,
    '--spine-h': `${height}px`,
    '--spine-ink': ink,
    '--spine-foil': style.foilColor,
    '--spine-ink-soft': mix(ink, style.spineColor, 0.28),
    '--spine-tilt': `${tilt}deg`,
    '--spine-bg': spineGradient(style),
    '--spine-texture': spineTextureLayers(style),
    '--book-footprint': `${footprint}px`,
    '--book-cover-depth': `${coverDepth(height, style)}px`,
    /* '--book-angle' / '--facing-rot' 随「自定义朝向」一起删掉了 */
    /*
     * 阅读进度下给 CSS。
     *
     * 必须挂在 `.book` 这个根节点上：书脊那条细条的填充是 `.progress-spine::after`
     * 画的，伪元素只能从**自己继承到的**自定义属性里取值，
     * 而封面上的圆环是自己给自己设的（在别的元素上），书脊朝向时圆环根本不渲染 ——
     * 所以以前这里没有这个变量时，`height: var(--progress-pct, 0%)` 永远落到 0%，
     * 轨道画得出来、填充永远长不上去。
     */
    '--progress-pct': `${Math.round(Math.max(0, Math.min(100, progress)))}%`,
    /*
     * 书脊贴图的比例，交给 CSS 的 aspect-ratio 用（见 .spine.is-photo）。
     * 不传就用默认 1:6。
     */
    '--spine-img-ar':
      style.spineImageAspect && style.spineImageAspect > 0 ? String(style.spineImageAspect) : ''
  }

  const orientation = spineTextOrientation(book.title)
  const fit = fitSpineTitle(book.title, width, height, style.spineTextDirection)
  // 纸质标签里的书名要按"标签这块纸"来排，不能按整条书脊算
  const labelFit = fitSpineTitle(
    book.title,
    Math.max(14, width * 0.76 - 4),
    Math.max(30, height * 0.6 - 8),
    'vertical'
  )
  const showAuthor = canShowSpineAuthor(book.author, height)
  const classes = [
    'book',
    `book-preset-${style.spinePreset}`,
    curve ? '' : 'is-flat-spine',
    `book-ornament-${style.ornament}`,
    style.spineTextDirection === 'vertical' ? 'is-vertical' : 'is-horizontal',
    `text-${orientation}`,
    `facing-${facing}`,
    selected ? 'is-selected' : '',
    dragging ? 'is-dragging' : '',
    progress > 0 ? 'has-progress' : '',
    ui.showShadow ? 'has-shadow' : '',
    ui.animate ? 'is-animated' : '',
    book.missing ? 'is-missing' : '',
    book.status === 'finished' ? 'is-finished' : '',
    className ?? ''
  ]
    .filter(Boolean)
    .join(' ')

  /** 书脊面：三种朝向下都可能出现（cover 朝向下隐藏） */
  const spineFace = (
    <div
      /*
       * 书脊朝向时书脊面**恰好等于书脊宽度**（is-exact-width）。
       *
       * 为什么：`.book` 的宽度是 footprint，而书脊朝向下 footprint = 书脊宽 + 倾斜外扩
       * （实测某本 38 + 6 = 44）。`.spine` 原本是 inset: 0，于是书脊面被拉成 44px，
       * 贴图居中后两侧各留 3px 透明带 —— 用户看到的"书的实际宽度没变、两边有透明带"。
       * 外扩那部分本来就只是给旋转留的布局余量，不该被画出来。
       * 只对 spine 朝向生效：cover / angled 时 `.spine` 是 3D 盒子的侧面，
       * 宽度必须跟着进深走，不能改。
       */
      className={[
        'spine',
        facing === 'spine' ? 'is-exact-width' : '',
        facing === 'spine' && style.spineImage ? 'is-photo' : ''
      ]
        .filter(Boolean)
        .join(' ')}
      /*
       * 书脊贴图的铺法：**高度撑满、宽度按图片自己的比例自动算**（`auto 100%`）。
       *
       * 为什么不是别的写法：
       *   - `cover`      → 盒子若比书脊宽，图溢出被裁；
       *   - `100% 100%`  → 图被横向拉扯，比例全错；
       *   - `<宽>px 100%` → 宽度得由我算，而布局高度与实际渲染高度并不完全一致，比例仍会偏。
       * `auto 100%` 把比例交给浏览器：宽 = 高 × 图片自身比例，绝对不失真。
       * 配合上面的等宽书脊面，图正好铺满，两侧不再有透明带。
       */
      style={
        style.spineImage
          ? {
              backgroundImage: `url(${imageSrc(style.spineImage)})`,
              // 比例已知（盒子会按比例）就用 100% 100% 正好铺满；未知则 auto 100%，宁可留边也不拉
              backgroundSize:
                style.spineImageAspect && style.spineImageAspect > 0 ? '100% 100%' : 'auto 100%',
              backgroundPosition: 'center',
              backgroundRepeat: 'no-repeat',
              /*
               * 书脊朝向时：盒子的宽度由**图片比例**推出，而不是用算出来的书脊宽度。
               *
               * 为什么：算出来的宽度用的是"布局高度"，而实际渲染出的书高更小
               * （实测布局 246、渲染 209，差约 15%），于是盒子总比图宽一截，
               * 贴图居中后两侧各留一条透明带（用户报的"书的实际宽度没变、两边有透明带"）。
               * 用 aspect-ratio + height:100% 让浏览器按**真实高度**推宽度，严丝合缝。
               *
               * 必须写成内联样式：先前用 CSS 变量传这个比例，变量为空时整条声明
               * 在计算时失效、退回 auto，规则等于没写。
               */
              ...(facing === 'spine' && style.spineImageAspect && style.spineImageAspect > 0
                ? { width: 'auto', aspectRatio: String(style.spineImageAspect) }
                : {})
            }
          : undefined
      }
    >
      {style.spineImage ? <span className="spine-photo-veil" /> : null}
      {!style.spineImage ? <span className="spine-texture" /> : null}
      {/* 平直书脊不画那道圆柱面明暗 */}
      {curve ? <span className="spine-shade" /> : null}
      {/* 贴了书脊图就别再画顶带/竹节：图本身就是书脊的样子，叠加只会变成横条带 */}
      {!style.spineImage ? <span className="spine-cap" /> : null}

      {!style.spineImage && style.ornament === 'ribs' ? (
        <span className="spine-ribs" aria-hidden>
          <i /> <i /> <i /> <i />
        </span>
      ) : null}
      {!style.spineImage && style.ornament === 'bands' ? (
        <span className="spine-bands" aria-hidden>
          <i /> <i />
          <i /> <i />
        </span>
      ) : null}
      {!style.spineImage && style.ornament === 'foil' ? (
        <>
          <span className="spine-foil-lines is-top" aria-hidden />
          <span className="spine-foil-lines is-bottom" aria-hidden />
        </>
      ) : null}

      {style.ornament === 'label' && !style.spineImage ? (
        <span className="spine-label">
          <span
            className="spine-label-text"
            style={{ fontSize: `${labelFit.fontSize}px`, width: `${labelFit.boxWidth}px` }}
          >
            {book.title}
          </span>
        </span>
      ) : style.spineImage ? null : (
        <span
          className="spine-title"
          style={{
            fontSize: `${fit.fontSize}px`,
            // 竖排必须把盒子收紧到"刚好放得下这些列"，否则 vertical-rl 的列会贴着右边
            ...(style.spineTextDirection === 'vertical' && fit.boxWidth > 0
              ? { width: `${fit.boxWidth}px` }
              : null)
          }}
        >
          {book.title}
        </span>
      )}

      {/* 贴了书脊图就不写字：图本身就是书名，再压一层字只会两边都看不清 */}
      {showAuthor && style.ornament !== 'label' && !style.spineImage ? (
        <span className="spine-author">{book.author}</span>
      ) : null}

      {style.showFormatIcon && facing !== 'cover' ? <span className="spine-badge">{formatBadge(book.format)}</span> : null}
      {marked && facing !== 'cover' ? (
        <span className="spine-mark" aria-label="有书签">
          <IconBookmarkFilled size={11} />
        </span>
      ) : null}

      {/* 书脊只有 20–40px 宽，圆环塞不下 —— 这里用贴着左缘的一条细竖条，
          高度跟书脊等高，从底部按百分比往上填。 */}
      {progress > 0 ? <span className="progress-spine" title={`已读 ${Math.round(progress)}%`} /> : null}
    </div>
  )

  const coverFace = (
    <div className="book-cover-face">
      <BookCoverArt book={book} style={style} width={coverDepth(height, style)} showMeta={false} />
      {style.showFormatIcon ? <span className="cover-face-badge">{formatBadge(book.format)}</span> : null}
      {marked ? (
        <span className="cover-face-mark" aria-label="有书签">
          <IconBookmarkFilled size={12} />
        </span>
      ) : null}
      {/* 封面朝外时地方够，用圆环；进度为 0 时什么都不画 */}
      {progress > 0 ? progressOverlay : null}
    </div>
  )

  return (
    <div
      className={classes}
      style={vars}
      data-book-id={book.id}
      role="button"
      tabIndex={0}
      title={`${book.title}${book.author ? ` · ${book.author}` : ''}\n${
        book.pageCount ? `${book.pageCount} 页` : FORMAT_LABEL[book.format]
      }`}
      onClick={() => onOpen(book)}
      onDoubleClick={() => onDouble?.(book)}
      onContextMenu={(event) => onContext(book, event)}
      onMouseEnter={(event) => onHover?.(book, event.currentTarget.getBoundingClientRect())}
      onMouseLeave={() => onLeave?.()}
      onFocus={(event) => onHover?.(book, event.currentTarget.getBoundingClientRect())}
      onBlur={() => onLeave?.()}
      onPointerDown={(event) => {
        if (event.button === 0) onDragStart?.(book, event)
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onOpen(book)
        }
      }}
    >
      <div className="book-3d">
        {facing === 'cover' ? coverFace : spineFace}
        <span className="spine-foot" />
      </div>
    </div>
  )
})
