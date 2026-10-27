import { useEffect, useLayoutEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { Book, BookStyle, OpenAnimation } from '@shared/types'
import { imageSrc } from '@shared/noteUrl'
import { coverDepth } from './spineStyle'
import { BookCoverArt } from './BookCoverArt'

export interface OpeningAnimationProps {
  book: Book
  style: BookStyle
  /** 被点那本书在书架上的位置 */
  from: { left: number; top: number; width: number; height: number }
  mode: Exclude<OpenAnimation, 'off'>
  onDone: () => void
}

/*
 * 完整版四拍：
 *   1 抽出书架  2 飞到眼前（幕布同时压成不透明，把身后的阅读界面彻底挡住）
 *   3 封面翻开  4 整块淡出，露出已经准备好的阅读界面
 * 最后一定要留足淡出的时间，否则会"啪"地直接消失，看起来像没播完。
 */
const FULL_STEPS = [120, 400, 660, 820]
const FULL_LEAVE_MS = 360
const SIMPLE_STEPS = [150, 340]
const SIMPLE_LEAVE_MS = 220
const LEAVE_CLASS_AT = 4

/**
 * 幕布压成不透明的那一刻（也就是 stage 2 的时间点）。
 * 阅读界面要等到这时候才挂载 —— 早于它，页面会从透明幕布后面透出来。
 */
export const FULL_REVEAL_MS = FULL_STEPS[1]
export const SIMPLE_REVEAL_MS = SIMPLE_STEPS[1]

/**
 * 打开书籍的过场动画。
 *
 * 完整版四拍：抽出书架 → 飞到眼前转正 → 封面翻开 → 淡出露出阅读界面。
 * 阅读界面这时候已经在下面渲染好了，所以最后一拍只是把它"擦"出来，
 * 不会出现白屏或二次加载。
 */
export function OpeningAnimation({ book, style, from, mode, onDone }: OpeningAnimationProps): ReactNode {
  const [stage, setStage] = useState(0)
  const [target, setTarget] = useState(() => targetBox(from))

  useLayoutEffect(() => {
    setTarget(targetBox(from))
  }, [from])

  useEffect(() => {
    const steps = mode === 'full' ? FULL_STEPS : SIMPLE_STEPS
    const leave = mode === 'full' ? FULL_LEAVE_MS : SIMPLE_LEAVE_MS
    const timers = steps.map((delay, index) => window.setTimeout(() => setStage(index + 1), delay))
    // 最后一拍的淡出必须播完才卸载
    const finish = window.setTimeout(onDone, steps[steps.length - 1] + leave)
    return () => {
      timers.forEach((id) => window.clearTimeout(id))
      window.clearTimeout(finish)
    }
  }, [mode, onDone])

  const settled = stage >= 2
  const box = settled ? target : from
  const depth = coverDepth(Math.round(target.height))
  const leaving = stage >= LEAVE_CLASS_AT
  /*
   * 幕布从"书飞到眼前"那一刻起就要一直盖住，直到最后一拍才掀开。
   * 注意不能写成 `.stage-2`：stage 每次都会换类名（stage-3、stage-4…），
   * 那样幕布只在 stage-2 那一小段是不透明的，封面刚翻开就又透出阅读界面了。
   */
  const veiled = settled && !leaving

  return createPortal(
    <div
      className={[
        'open-anim',
        `open-anim-${mode}`,
        `stage-${stage}`,
        veiled ? 'is-veiled' : '',
        leaving ? 'is-leaving' : ''
      ]
        .filter(Boolean)
        .join(' ')}
      aria-hidden
    >
      <div className="open-anim-veil" />
      <div
        className="open-anim-book"
        style={{
          left: box.left,
          top: box.top,
          width: box.width,
          height: box.height,
          ['--open-depth' as string]: `${depth}px`
        }}
      >
        <div className="open-anim-scene">
          <div className="open-anim-page">
            <span className="open-anim-page-rule" />
            <span className="open-anim-page-rule" />
            <span className="open-anim-page-rule" />
            <span className="open-anim-page-rule" />
          </div>
          <div className="open-anim-cover">
            <BookCoverArt book={book} style={style} width={depth} showMeta={false} />
            <span className="open-anim-spine" />
          </div>
          {/*
           * 翻开之前盖一层"书脊朝外"的面。
           * 飞出来的这本书本来只有封面，于是点一本带书脊贴图的书时，
           * 动画第一帧显示的是封面 —— 看起来像书脊图被换掉了。
           * 这一层就是被点的那根书脊，到翻开那一拍再淡掉。
           */}
          <span
            className="open-anim-spine-face"
            style={
              style.spineImage
                ? { backgroundImage: `url(${imageSrc(style.spineImage)})` }
                : { background: `linear-gradient(90deg, ${style.spineColor}, ${style.spineColor2})` }
            }
          >
            {style.spineImage ? null : <span className="open-anim-spine-title">{book.title}</span>}
          </span>
        </div>
      </div>
    </div>,
    document.body
  )
}

/** 目标位置：屏幕中央、按窗口高度定尺寸 */
function targetBox(from: { width: number; height: number }): {
  left: number
  top: number
  width: number
  height: number
} {
  const viewportH = window.innerHeight
  const viewportW = window.innerWidth
  const height = Math.round(Math.min(560, viewportH * 0.62, viewportW * 0.52 * 1.5))
  const width = Math.round(height / 1.5)
  return {
    left: Math.round((viewportW - width) / 2),
    top: Math.round((viewportH - height) / 2 - 10),
    width,
    height
  }
}
