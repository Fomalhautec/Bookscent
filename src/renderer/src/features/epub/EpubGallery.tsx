import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { SaveImageFile } from '@shared/types'
import { epubUrlFor } from '@shared/noteUrl'
import { filesApi, libraryApi } from '@/lib/api'
import { Button, IconButton, Spinner } from '@/components/common/Controls'
import {
  IconCheck,
  IconChevronLeft,
  IconChevronRight,
  IconClose,
  IconDownload,
  IconMinus,
  IconPlus,
  IconSearch
} from '@/components/icons/Icons'
import { useUi } from '@/store/useUi'
import { fetchEpubImageFile, type EpubImageItem } from './imageExport'

/** 缩放范围（手机相册那种手感：能放到 8 倍看清细节） */
const MIN_SCALE = 1
const MAX_SCALE = 8
/** 长按多久算"要选择" */
const LONG_PRESS_MS = 480
/** 底部胶片条一次渲染多少张（书里可能有几百张图，全渲染会卡） */
const STRIP_WINDOW = 13

export interface EpubGalleryProps {
  open: boolean
  bookId: string
  bookPath: string
  /** 打开时先看这一张（不传就从头开始） */
  startHref?: string | null
  onClose: () => void
}

/**
 * 看图器 —— 按**手机相册**的逻辑来。
 *
 * 为什么单独做一个：以前只有"导出图片"弹窗，想看一眼图得先打开一个导出界面，
 * 点一张小图才放大，而且放不大（用户的原话：别扭）。看图本来是最轻的动作，
 * 不该挂在导出流程里。
 *
 * 这一版：
 *   - 大图铺满，滚轮 / 双指 / 双击缩放，放大后拖动平移，也可一键回到 1:1；
 *   - 底部胶片条横向翻页（只渲染附近那些，几百张也不卡）；
 *   - 要导出时：点「选择」或**长按**进选择态，点图打勾，再导出选中 —— 平时点图不会误触发导出；
 *   - Esc 退出；左右方向键翻页。
 */
export function EpubGallery({
  open,
  bookId,
  bookPath,
  startHref,
  onClose
}: EpubGalleryProps): ReactNode {
  const toast = useUi((s) => s.toast)
  const [items, setItems] = useState<EpubImageItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [href, setHref] = useState<string | null>(null)
  const [src, setSrc] = useState<string | null>(null)
  const [scale, setScale] = useState(1)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const [selectMode, setSelectMode] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const [busy, setBusy] = useState(false)

  const srcRef = useRef<Map<string, string>>(new Map())
  const stageRef = useRef<HTMLDivElement | null>(null)
  const dragRef = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null)
  const pressRef = useRef<number | null>(null)

  const index = useMemo(() => items.findIndex((item) => item.href === href), [items, href])
  const current = index >= 0 ? items[index] : null

  /* ------------------------------------------------------------ 载入清单 */

  const reset = useCallback((): void => {
    for (const url of srcRef.current.values()) URL.revokeObjectURL(url)
    srcRef.current.clear()
    setSrc(null)
    setScale(1)
    setOffset({ x: 0, y: 0 })
    setSelectMode(false)
    setSelected(new Set())
  }, [])

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoading(true)
    setError(null)
    reset()
    void libraryApi
      .epubImages(bookPath)
      .then((list) => {
        if (cancelled) return
        setItems(list)
        const start = startHref && list.some((item) => item.href === startHref) ? startHref : list[0]?.href
        setHref(start ?? null)
        setLoading(false)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : '读不出图片清单')
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, bookPath, startHref, reset])

  useEffect(() => reset, [reset])

  /* -------------------------------------------------- 当前这张的原图（object URL） */

  const loadFull = useCallback(
    (target: string | null | undefined): void => {
      if (!target || srcRef.current.has(target)) return
      void fetch(epubUrlFor(bookId, target))
        .then((response) => (response.ok ? response.blob() : Promise.reject(new Error('读取失败'))))
        .then((blob) => {
          const url = URL.createObjectURL(blob)
          srcRef.current.set(target, url)
          setSrc((prev) => (prev === null || prev === srcRef.current.get(target) ? url : prev))
        })
        .catch(() => undefined)
    },
    [bookId]
  )

  useEffect(() => {
    if (!href) return
    const cached = srcRef.current.get(href)
    setSrc(cached ?? null)
    setScale(1)
    setOffset({ x: 0, y: 0 })
    loadFull(href)
    /* 预取相邻两张，翻页时不会先看到空白 */
    const at = items.findIndex((item) => item.href === href)
    loadFull(items[at + 1]?.href)
    loadFull(items[at - 1]?.href)
  }, [href, items, loadFull])

  const step = useCallback(
    (delta: number): void => {
      if (index < 0) return
      const next = items[index + delta]
      if (!next) return
      setHref(next.href)
    },
    [index, items]
  )

  /* ------------------------------------------------------------------ 缩放 */

  const zoomBy = useCallback((factor: number): void => {
    setScale((prev) => {
      const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, prev * factor))
      if (next === MIN_SCALE) setOffset({ x: 0, y: 0 })
      return next
    })
  }, [])

  const toggleZoom = useCallback((): void => {
    setScale((prev) => {
      if (prev > 1.01) {
        setOffset({ x: 0, y: 0 })
        return 1
      }
      return 2.5
    })
  }, [])

  const onWheel = useCallback(
    (event: React.WheelEvent): void => {
      /* 只接管"往下滚是缩小、往上滚是放大"；不给页面滚动，看图时不该乱跑 */
      event.preventDefault()
      zoomBy(event.deltaY < 0 ? 1.12 : 1 / 1.12)
    },
    [zoomBy]
  )

  const onPointerDown = useCallback(
    (event: React.PointerEvent): void => {
      if (event.button !== 0) return
      /* 长按进选择态：先记时间，没抬起就说明是长按 */
      const timer = window.setTimeout(() => {
        pressRef.current = null
        setSelectMode(true)
        toast('已进入选择：点图勾选，再导出选中', 'info')
      }, LONG_PRESS_MS)
      pressRef.current = timer
      if (scale > 1.01) {
        dragRef.current = { x: event.clientX, y: event.clientY, ox: offset.x, oy: offset.y }
      }
    },
    [offset.x, offset.y, scale, toast]
  )

  const onPointerMove = useCallback((event: React.PointerEvent): void => {
    const drag = dragRef.current
    if (!drag) return
    setOffset({ x: drag.ox + (event.clientX - drag.x), y: drag.oy + (event.clientY - drag.y) })
  }, [])

  const onPointerUp = useCallback((): void => {
    if (pressRef.current !== null) {
      window.clearTimeout(pressRef.current)
      pressRef.current = null
    }
    dragRef.current = null
  }, [])

  /* -------------------------------------------------------------- 键盘 */

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'ArrowLeft') {
        event.preventDefault()
        step(-1)
      } else if (event.key === 'ArrowRight') {
        event.preventDefault()
        step(1)
      } else if (event.key === 'Escape') {
        event.preventDefault()
        if (selectMode) setSelectMode(false)
        else onClose()
      } else if (event.key === '+' || event.key === '=') {
        zoomBy(1.2)
      } else if (event.key === '-') {
        zoomBy(1 / 1.2)
      } else if (event.key === '0') {
        setScale(1)
        setOffset({ x: 0, y: 0 })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, step, onClose, selectMode, zoomBy])

  /* ------------------------------------------------------------ 导出 */

  const exportItems = useCallback(
    async (targets: EpubImageItem[]): Promise<void> => {
      if (busy || targets.length === 0) return
      setBusy(true)
      try {
        const files: SaveImageFile[] = []
        for (const item of targets) {
          try {
            files.push(await fetchEpubImageFile(bookId, item))
          } catch {
            /* 单张读不出来就跳过 */
          }
        }
        if (files.length === 0) {
          toast('这些图片都读不出来', 'error')
          return
        }
        const saved = await filesApi.saveImages({ dir: '', mode: 'embedded' }, files)
        if (saved.cancelled) {
          toast('已取消保存', 'info')
          return
        }
        toast(`已导出 ${saved.files.length} 个文件到 ${saved.dir}`, 'success')
        setSelected(new Set())
        setSelectMode(false)
      } finally {
        setBusy(false)
      }
    },
    [bookId, busy, toast]
  )

  const tapImage = useCallback((): void => {
    if (!selectMode || !href) return
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(href)) next.delete(href)
      else next.add(href)
      return next
    })
  }, [href, selectMode])

  if (!open) return null

  /* 胶片条只渲染当前附近那几张 */
  const stripFrom = Math.max(0, index - Math.floor(STRIP_WINDOW / 2))
  const strip = items.slice(stripFrom, stripFrom + STRIP_WINDOW)
  const selectedItems = items.filter((item) => selected.has(item.href))

  return (
    <div className="epub-gallery" role="dialog" aria-label="看图">
      <div className="epub-gallery-bar">
        <span className="epub-gallery-title" title={current?.name ?? ''}>
          {current?.name ?? '看图'}
        </span>
        <span className="epub-gallery-meta tabular">
          {index >= 0 ? `第 ${index + 1} / ${items.length} 张` : ''}
          {current ? ` · ${Math.max(1, Math.round(current.bytes / 1024))} KB` : ''}
          {scale > 1.01 ? ` · ${Math.round(scale * 100)}%` : ''}
        </span>
        <span className="epub-gallery-spacer" />
        {selectMode ? (
          <span className="epub-gallery-count">已选 {selected.size} 张</span>
        ) : null}
        <IconButton label="缩小" onClick={() => zoomBy(1 / 1.2)}>
          <IconMinus size={15} />
        </IconButton>
        <IconButton label="放大" onClick={() => zoomBy(1.2)}>
          <IconPlus size={15} />
        </IconButton>
        <IconButton label="回到原始大小" onClick={() => { setScale(1); setOffset({ x: 0, y: 0 }) }}>
          <IconSearch size={15} />
        </IconButton>
        <Button
          size="xs"
          variant={selectMode ? 'solid' : 'outline'}
          icon={<IconCheck size={13} />}
          onClick={() => {
            setSelectMode((prev) => !prev)
            if (selectMode) setSelected(new Set())
          }}
        >
          {selectMode ? '退出选择' : '选择'}
        </Button>
        <IconButton label="关闭" onClick={onClose}>
          <IconClose size={16} />
        </IconButton>
      </div>

      <div className="epub-gallery-stage">
        {loading ? (
          <div className="epub-gallery-state">
            <Spinner /> 正在读图片清单…
          </div>
        ) : error ? (
          <div className="epub-gallery-state">{error}</div>
        ) : items.length === 0 ? (
          <div className="epub-gallery-state">这本书里没有图片。</div>
        ) : (
          <>
            <button
              type="button"
              className="epub-gallery-nav is-prev"
              onClick={() => step(-1)}
              disabled={index <= 0}
              aria-label="上一张"
            >
              <IconChevronLeft size={26} />
            </button>

            <div
              className="epub-gallery-canvas"
              ref={stageRef}
              onWheel={onWheel}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerLeave={onPointerUp}
              onDoubleClick={toggleZoom}
              onClick={tapImage}
              style={{ cursor: scale > 1.01 ? 'grab' : selectMode ? 'pointer' : 'zoom-in' }}
            >
              {src ? (
                <img
                  className="epub-gallery-img"
                  src={src}
                  alt={current?.name ?? ''}
                  draggable={false}
                  style={{ transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})` }}
                />
              ) : (
                <div className="epub-gallery-state">
                  <Spinner /> 正在读这张图…
                </div>
              )}
              {selectMode && href && selected.has(href) ? (
                <span className="epub-gallery-picked" aria-hidden="true">
                  <IconCheck size={18} />
                </span>
              ) : null}
            </div>

            <button
              type="button"
              className="epub-gallery-nav is-next"
              onClick={() => step(1)}
              disabled={index >= items.length - 1}
              aria-label="下一张"
            >
              <IconChevronRight size={26} />
            </button>
          </>
        )}
      </div>

      {/* 胶片条：手机相册那种横向缩略图，点一下就跳过去 */}
      {items.length > 1 ? (
        <div className="epub-gallery-strip">
          {strip.map((item) => {
            const at = items.indexOf(item)
            return (
              <button
                key={item.href}
                type="button"
                className={[
                  'epub-gallery-thumb',
                  item.href === href ? 'is-current' : '',
                  selected.has(item.href) ? 'is-picked' : ''
                ]
                  .filter(Boolean)
                  .join(' ')}
                title={`第 ${at + 1} 张 · ${item.name}`}
                onClick={() => {
                  if (selectMode) {
                    setSelected((prev) => {
                      const next = new Set(prev)
                      if (next.has(item.href)) next.delete(item.href)
                      else next.add(item.href)
                      return next
                    })
                    return
                  }
                  setHref(item.href)
                }}
              >
                <img src={epubUrlFor(bookId, item.href)} alt="" loading="lazy" draggable={false} />
              </button>
            )
          })}
        </div>
      ) : null}

      <div className="epub-gallery-foot">
        <span className="epub-gallery-hint">
          滚轮或双击放大，放大后可拖动；长按图片进入选择
        </span>
        <span className="epub-gallery-spacer" />
        {selectMode ? (
          <>
            <Button
              size="xs"
              variant="outline"
              onClick={() =>
                setSelected(
                  selected.size === items.length ? new Set() : new Set(items.map((item) => item.href))
                )
              }
            >
              {selected.size === items.length ? '取消全选' : '全选'}
            </Button>
            <Button
              size="xs"
              variant="solid"
              icon={<IconDownload size={13} />}
              disabled={busy || selected.size === 0}
              onClick={() => void exportItems(selectedItems)}
            >
              导出选中（{selected.size}）
            </Button>
          </>
        ) : (
          <Button
            size="xs"
            variant="outline"
            icon={<IconDownload size={13} />}
            disabled={busy || !current}
            onClick={() => void exportItems(current ? [current] : [])}
          >
            导出这张
          </Button>
        )}
      </div>
    </div>
  )
}
