import type { ReactNode } from 'react'
import { mix, readableOn } from '@shared/themes'
import { imageSrc } from '@shared/noteUrl'
import type { Book, BookStyle, CoverPreset } from '@shared/types'
import { FORMAT_LABEL } from '@shared/types'
import { formatBadge } from './spineStyle'

/** 几种「书名换个地方放」的版式：结构不同，不能只靠 CSS 换皮 */
const TITLE_PRESETS: CoverPreset[] = ['corner', 'sidebar', 'panel', 'swiss']

/**
 * 书籍封面。既可以由预设程序化生成，也可以直接用用户上传的封面图片。
 * 同一个组件同时服务于书架上的"抽出预览"和详情抽屉里的大图。
 *
 * 版式分两代：
 *   classic / minimal / vintage / gradient / typewriter / plain
 *     —— 书名一律在正中（cover-body），差别在框线与纹理；
 *   corner / sidebar / panel / swiss
 *     —— 书名的位置与阅读方向都不一样，所以各自有自己的结构；
 *        尺寸全部按 `--cover-u`（由封面宽度算出）走 em，缩放时不会散架。
 */
export function BookCoverArt({
  book,
  style,
  width,
  className,
  showMeta = true
}: {
  book: Book
  style: BookStyle
  width: number
  className?: string
  showMeta?: boolean
}): ReactNode {
  const height = Math.round(width * 1.5)
  const ink = style.coverTextColor || readableOn(style.coverColor)
  const vars: Record<string, string> = {
    '--cover-w': `${width}px`,
    '--cover-h': `${height}px`,
    // 版式基准单位：新版的四个版式（右上 / 竖排 / 色块 / 居中细线）的留白与字号
    // 全按它换算，于是 60px 的架上缩略图与 200px 的详情大图排出来是同一张脸。
    // 系数取自老版式：132px 宽时基准约 8.2px，乘 1.62 正好是原来那档 15px 书名。
    '--cover-u': `${Math.round(width * 0.062 * 100) / 100}px`,
    '--cover-ink': ink,
    '--cover-accent': style.foilColor,
    '--cover-c1': style.coverColor,
    '--cover-c2': style.coverColor2 || mix(style.coverColor, '#000000', 0.3),
    '--cover-blend': mix(style.coverColor, '#000000', 0.24)
  }

  if (style.coverImage) {
    /*
     * 用 <img> 而不是 background-image。
     *
     * background-image 加载失败是**静默**的：只看到一块空白封面，查不出原因
     * （用户报的"有封面但是空白"就卡在这里）。换成 <img> 之后 onError 能拿到
     * 真实原因，onLoad 也留一条痕 —— 是地址不对、文件没了，还是浏览器拒绝解码，
     * 一看日志就知道。
     *
     */
    const src = imageSrc(style.coverImage)
    return (
      <div className={['cover', 'cover-image', className ?? ''].filter(Boolean).join(' ')} style={vars}>
        <img
          className="cover-image-img"
          src={src}
          alt=""
          draggable={false}
          /*
           * 封面比例已知时用 cover（盒子本来就是按它算的，正好铺满）；
           * 未知时用 contain —— 老数据没记比例的话，cover 会把封面裁掉一条。
           */
          style={{
            objectFit: style.coverImageAspect && style.coverImageAspect > 0 ? 'cover' : 'contain'
          }}
        />
        <span className="cover-sheen" />
      </div>
    )
  }

  const preset = style.coverPreset
  const isNewLayout = TITLE_PRESETS.includes(preset)

  return (
    <div
      className={['cover', `cover-${preset}`, className ?? ''].filter(Boolean).join(' ')}
      style={vars}
    >
      <span className="cover-ground" />
      <span className="cover-grain" />
      {preset === 'classic' ? <span className="cover-frame" /> : null}
      {preset === 'vintage' ? (
        <>
          <span className="cover-frame cover-frame-inset" />
          <span className="cover-exlibris">EX LIBRIS</span>
        </>
      ) : null}
      {preset === 'minimal' ? <span className="cover-rule" /> : null}

      {/* 书名在右上角：左上角一道短金线压角，右下角署名与格式 */}
      {preset === 'corner' ? (
        <>
          <span className="cover-corner-mark" />
          <h3 className="cover-title">{book.title}</h3>
          <span className="cover-corner-rule" />
          {book.author ? <p className="cover-author cover-corner-author">{book.author}</p> : null}
        </>
      ) : null}

      {/* 书名竖排在右侧，署名与装饰留在左边 */}
      {preset === 'sidebar' ? (
        <>
          <span className="cover-sidebar-mark" />
          <h3 className="cover-title cover-sidebar-title">{book.title}</h3>
          <div className="cover-sidebar-body">
            {book.author ? <p className="cover-author">{book.author}</p> : null}
            <span className="cover-flourish" />
          </div>
        </>
      ) : null}

      {/* 书名压在整块色块上，色块之外只留底色 */}
      {preset === 'panel' ? (
        <div className="cover-panel">
          <h3 className="cover-title">{book.title}</h3>
          {book.author ? <p className="cover-author">{book.author}</p> : null}
        </div>
      ) : null}

      {/* 居中极简：只剩一条细线与一个小标签 */}
      {preset === 'swiss' ? (
        <>
          <span className="cover-label" />
          <div className="cover-swiss-body">
            <h3 className="cover-title">{book.title}</h3>
            <span className="cover-rule" />
            {book.author ? <p className="cover-author">{book.author}</p> : null}
          </div>
        </>
      ) : null}

      {!isNewLayout ? (
        <div className="cover-body">
          <h3 className="cover-title">{book.title}</h3>
          {preset !== 'typewriter' ? <span className="cover-flourish" /> : null}
          {book.author ? <p className="cover-author">{book.author}</p> : null}
        </div>
      ) : null}

      {showMeta ? (
        <div className="cover-meta">
          <span className="cover-format">{formatBadge(book.format)}</span>
          <span className="cover-pages">{book.pageCount ? `${book.pageCount} 页` : FORMAT_LABEL[book.format]}</span>
        </div>
      ) : null}
      <span className="cover-sheen" />
    </div>
  )
}
