/**
 * 阅读器工具栏 —— 页码、缩放、旋转、滚动模式、搜索与文件操作。
 * 所有按钮都带中文 title，图标复用 components/icons/Icons.tsx。
 */

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Button, IconButton, Segmented } from '@/components/common/Controls'
import {
  IconBookmark,
  IconBookmarkFilled,
  IconChevronDown,
  IconChevronLeft,
  IconChevronRight,
  IconExternalLink,
  IconFitPage,
  IconFitWidth,
  IconGlobe,
  IconFolderOpen,
  IconImageExtract,
  IconList,
  IconRotate,
  IconSearch,
  IconZoomIn,
  IconZoomOut
} from '@/components/icons/Icons'
import { clamp, ZOOM_MAX, ZOOM_MIN } from '../lib/geometry'
import { formatZoom, ZOOM_PRESETS } from '../lib/zoom'
import type { ScrollMode, ZoomValue } from '../hooks/useViewerState'

/**
 * 缩放菜单是 portal 到 body 的浮层：工具栏自己带 overflow（横向滚动 + 纵向裁切），
 * 内联的绝对定位菜单会被工具栏裁成一条缝，所以这里量好触发按钮的位置后固定定位。
 */
const ZOOM_MENU_GAP = 5
const ZOOM_MENU_MARGIN = 8

/** 三种阅读模式：连续滚动 / 单页 / 左右翻页 */
const SCROLL_MODE_OPTIONS: { value: ScrollMode; label: string; title: string }[] = [
  { value: 'continuous', label: '连续滚动', title: '连续滚动：所有页面首尾相接，一路滚下去' },
  { value: 'single', label: '单页', title: '单页：一次只显示一页，滚动查看整页' },
  { value: 'flip', label: '左右翻页', title: '左右翻页：像摊开的书，一次翻一个跨页，← / → 或点击两侧翻页' }
]

/** 左右翻页的排版：单页 / 双页跨页（默认双页） */
const FLIP_SPREAD_OPTIONS: { value: 'single' | 'double'; label: string; title: string }[] = [
  { value: 'single', label: '单页', title: '单页：左右翻页时一次只显示一页' },
  { value: 'double', label: '双页', title: '双页：左右两页并排显示，像摊开的书' }
]

export interface ToolbarProps {
  page: number
  pageCount: number
  zoom: ZoomValue
  resolvedZoom: number
  scrollMode: ScrollMode
  /** 左右翻页是否双页跨页 */
  flipSpread: boolean
  bookmarked: boolean
  sidebarOpen: boolean
  searchOpen: boolean
  busy: boolean
  /** 还能不能往前 / 往后翻（左右翻页下一次是一整个跨页，不能只看页码） */
  canPrev: boolean
  canNext: boolean
  onGoToPage: (page: number) => void
  /** 往前 / 往后翻一次：左右翻页模式下会走翻页动画（双页时是一个跨页） */
  onStepPage: (delta: 1 | -1) => void
  onFlipSpreadChange: (spread: boolean) => void
  onZoomSelect: (zoom: ZoomValue) => void
  onZoomStep: (direction: 1 | -1) => void
  onScrollModeChange: (mode: ScrollMode) => void
  onRotate: () => void
  onToggleBookmark: () => void
  onToggleSidebar: () => void
  /** 右侧翻译栏的开关 */
  translateOpen: boolean
  onToggleTranslate: () => void
  onToggleSearch: () => void
  onOpenContainingFolder: () => void
  onOpenExternal: () => void
  onExtractImages: () => void
}

export function Toolbar(props: ToolbarProps): ReactNode {
  const { page, pageCount, zoom, resolvedZoom, scrollMode, bookmarked } = props
  const [draft, setDraft] = useState(String(page))
  const [zoomMenuOpen, setZoomMenuOpen] = useState(false)
  const [zoomMenuPos, setZoomMenuPos] = useState<{ left: number; top: number } | null>(null)
  const zoomTriggerRef = useRef<HTMLButtonElement>(null)
  const zoomMenuRef = useRef<HTMLDivElement>(null)

  // 外部翻页时同步输入框，但用户正在输入时不打断
  useEffect(() => {
    setDraft((current) => (Number.parseInt(current, 10) === page ? current : String(page)))
  }, [page])

  // 摆放浮层：优先贴在触发按钮下方，下面放不下就翻到上方
  useLayoutEffect(() => {
    if (!zoomMenuOpen) {
      setZoomMenuPos(null)
      return
    }
    const place = (): void => {
      const rect = zoomTriggerRef.current?.getBoundingClientRect()
      if (!rect) return
      const menu = zoomMenuRef.current
      const width = menu?.offsetWidth ?? 132
      const height = menu?.offsetHeight ?? 0
      const left = Math.max(ZOOM_MENU_MARGIN, Math.min(rect.left, window.innerWidth - width - ZOOM_MENU_MARGIN))
      const below = rect.bottom + ZOOM_MENU_GAP
      const flip = height > 0 && below + height > window.innerHeight - ZOOM_MENU_MARGIN && rect.top - height - ZOOM_MENU_GAP > ZOOM_MENU_MARGIN
      setZoomMenuPos({ left, top: flip ? rect.top - height - ZOOM_MENU_GAP : below })
    }
    place()
    window.addEventListener('resize', place)
    // 工具栏横向滚动时不冒泡，用捕获阶段跟着触发按钮走
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [zoomMenuOpen])

  // 点击别处 / 按 Esc 关闭
  useEffect(() => {
    if (!zoomMenuOpen) return
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target as Node
      if (zoomTriggerRef.current?.contains(target) || zoomMenuRef.current?.contains(target)) return
      setZoomMenuOpen(false)
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setZoomMenuOpen(false)
    }
    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [zoomMenuOpen])

  const commitPage = (): void => {
    const value = Number.parseInt(draft, 10)
    if (Number.isFinite(value)) props.onGoToPage(clamp(value, 1, Math.max(1, pageCount)))
    else setDraft(String(page))
  }

  const zoomLabel = typeof zoom === 'number' ? formatZoom(resolvedZoom) : zoom === 'page-width' ? '适应宽度' : '适应页面'

  return (
    <div className="pdf-toolbar">
      <div className="pdf-toolbar-group">
        <IconButton label={props.sidebarOpen ? '收起左侧面板' : '展开左侧面板'} active={props.sidebarOpen} onClick={props.onToggleSidebar}>
          <IconList size={16} />
        </IconButton>
        {/*
          翻译栏（右侧）。PDF 里选中文字也能翻译，但以前没有这个开关 ——
          入口只在选中工具条上，面板打不开，等于这条功能在 PDF 里是断的。
        */}
        <IconButton
          label="翻译（选中文字后点工具条上的「翻译」）"
          active={props.translateOpen}
          onClick={props.onToggleTranslate}
        >
          <IconGlobe size={16} />
        </IconButton>
        <span className="pdf-toolbar-sep" />
        <IconButton label="上一页（PageUp）" disabled={!props.canPrev} onClick={() => props.onStepPage(-1)}>
          <IconChevronLeft size={16} />
        </IconButton>
        <div className="pdf-page-input">
          <input
            className="text-input"
            value={draft}
            inputMode="numeric"
            aria-label="当前页码"
            onChange={(event) => setDraft(event.target.value.replace(/[^\d]/g, ''))}
            onBlur={commitPage}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                commitPage()
                event.currentTarget.blur()
              }
            }}
          />
          <span className="pdf-page-total">/ {pageCount || '—'}</span>
        </div>
        <IconButton label="下一页（PageDown）" disabled={!props.canNext} onClick={() => props.onStepPage(1)}>
          <IconChevronRight size={16} />
        </IconButton>
      </div>

      <div className="pdf-toolbar-group">
        <IconButton label="缩小（-）" disabled={resolvedZoom <= ZOOM_MIN + 0.001} onClick={() => props.onZoomStep(-1)}>
          <IconZoomOut size={16} />
        </IconButton>
        <div className="pdf-zoom-menu-wrap">
          <button
            ref={zoomTriggerRef}
            type="button"
            className="pdf-zoom-trigger"
            aria-haspopup="listbox"
            aria-expanded={zoomMenuOpen}
            onClick={() => setZoomMenuOpen((open) => !open)}
          >
            <span className="tabular">{zoomLabel}</span>
            <IconChevronDown size={13} />
          </button>
        </div>
        {zoomMenuOpen
          ? createPortal(
              <div
                ref={zoomMenuRef}
                className="pdf-zoom-menu"
                role="listbox"
                style={{
                  left: zoomMenuPos?.left ?? 0,
                  top: zoomMenuPos?.top ?? 0,
                  visibility: zoomMenuPos ? 'visible' : 'hidden'
                }}
                onPointerDown={(event) => event.stopPropagation()}
              >
                {ZOOM_PRESETS.map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    role="option"
                    aria-selected={typeof zoom === 'number' && Math.abs(zoom - preset) < 0.005}
                    className="pdf-zoom-item"
                    onClick={() => {
                      props.onZoomSelect(preset)
                      setZoomMenuOpen(false)
                    }}
                  >
                    {formatZoom(preset)}
                  </button>
                ))}
                <span className="pdf-zoom-sep" />
                <button
                  type="button"
                  role="option"
                  aria-selected={zoom === 'page-width'}
                  className="pdf-zoom-item"
                  onClick={() => {
                    props.onZoomSelect('page-width')
                    setZoomMenuOpen(false)
                  }}
                >
                  适应宽度
                </button>
                <button
                  type="button"
                  role="option"
                  aria-selected={zoom === 'page-fit'}
                  className="pdf-zoom-item"
                  onClick={() => {
                    props.onZoomSelect('page-fit')
                    setZoomMenuOpen(false)
                  }}
                >
                  适应页面
                </button>
              </div>,
              document.body
            )
          : null}
        <IconButton label="放大（+）" disabled={resolvedZoom >= ZOOM_MAX - 0.001} onClick={() => props.onZoomStep(1)}>
          <IconZoomIn size={16} />
        </IconButton>
        <IconButton label="适应宽度" active={zoom === 'page-width'} onClick={() => props.onZoomSelect('page-width')}>
          <IconFitWidth size={16} />
        </IconButton>
        <IconButton label="适应页面" active={zoom === 'page-fit'} onClick={() => props.onZoomSelect('page-fit')}>
          <IconFitPage size={16} />
        </IconButton>
        <IconButton label="旋转 90°" onClick={props.onRotate}>
          <IconRotate size={16} />
        </IconButton>
      </div>

      <div className="pdf-toolbar-group pdf-toolbar-center">
        <Segmented
          value={scrollMode}
          onChange={props.onScrollModeChange}
          options={SCROLL_MODE_OPTIONS}
        />
        {scrollMode === 'flip' ? (
          <>
            <span className="pdf-toolbar-sep" />
            <span className="pdf-toolbar-label">跨页</span>
            <Segmented
              value={props.flipSpread ? 'double' : 'single'}
              onChange={(value) => props.onFlipSpreadChange(value === 'double')}
              options={FLIP_SPREAD_OPTIONS}
            />
          </>
        ) : null}
        <IconButton label="搜索（Ctrl+F）" active={props.searchOpen} onClick={props.onToggleSearch}>
          <IconSearch size={16} />
        </IconButton>
        <IconButton
          label={bookmarked ? '取消本书签（B）' : '添加书签（B）'}
          active={bookmarked}
          onClick={props.onToggleBookmark}
        >
          {bookmarked ? <IconBookmarkFilled size={16} /> : <IconBookmark size={16} />}
        </IconButton>
        <IconButton label="提取图片" onClick={props.onExtractImages}>
          <IconImageExtract size={16} />
        </IconButton>
      </div>

      <div className="pdf-toolbar-group pdf-toolbar-end">
        <Button
          size="sm"
          variant="ghost"
          icon={<IconFolderOpen size={15} />}
          onClick={props.onOpenContainingFolder}
        >
          所在文件夹
        </Button>
        <Button
          size="sm"
          variant="ghost"
          icon={<IconExternalLink size={15} />}
          onClick={props.onOpenExternal}
        >
          系统应用打开
        </Button>
      </div>
    </div>
  )
}
