/**
 * 阅读器核心状态 —— 缩放 / 旋转 / 滚动模式 / 当前页 / 进度回填。
 *
 * 这里刻意不渲染任何 JSX：所有 DOM 相关的东西通过回调 ref 与状态暴露，
 * 让组件层只关心「长什么样」。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Book } from '@shared/types'
import { PAGE_GAP, useElementRef, useElementSize } from '../lib/dom'
import {
  clamp,
  fitPageZoom,
  fitWidthZoom,
  makePageBox,
  normalizeRotation,
  rotatedSize,
  ZOOM_MAX,
  ZOOM_MIN,
  type PageBox
} from '../lib/geometry'
import type { PDFDocumentProxy } from '../lib/engine'
import { FLIP_GUTTER, spreadCount, spreadSliceAt } from '../lib/spread'
import type { BookRecordStore } from './useBookRecord'

export type ScrollMode = 'continuous' | 'single' | 'flip'
export type ZoomValue = number | 'page-width' | 'page-fit'

export interface ViewerState {
  /** 挂到滚动容器的 ref */
  scrollRef: (node: HTMLDivElement | null) => void
  scrollElement: HTMLDivElement | null
  /** 挂到「页面列表」容器的 ref（IntersectionObserver 的观察目标集合） */
  pagesRef: (node: HTMLDivElement | null) => void
  pageBoxes: PageBox[]
  viewport: { width: number; height: number }
  currentPage: number
  zoom: ZoomValue
  resolvedZoom: number
  rotation: number
  scrollMode: ScrollMode
  /**
   * 左右翻页是否以「双页跨页」展示（摊开的书）。
   * 只有 scrollMode === 'flip' 且用户选了双页时才为 true。
   */
  spreadPages: boolean
  scrollRatio: number
  /** 点击目录 / 缩略图后要滚动到的页码，null 表示无待处理跳转 */
  pendingScrollPage: number | null
  setScrollMode: (mode: ScrollMode) => void
  setZoom: (zoom: ZoomValue) => void
  zoomBy: (delta: number) => void
  rotate: () => void
  goToPage: (page: number) => void
  /**
   * 只改「当前页」，不做滚动定位。
   * 双页跨页里在同一叠纸内换当前页时用：落笔在哪一页，批注工具条就跟着哪一页，
   * 但画面（滚动位置）不能因为落笔跳一下。
   */
  setCurrentPage: (page: number) => void
  registerPage: (page: number, node: HTMLDivElement | null) => void
  /** 用户主动滚动过之后，恢复进度不再叠加页内比例 */
  noteUserScroll: () => void
}

export function useViewerState(
  book: Book,
  doc: PDFDocumentProxy | null,
  pageCount: number,
  recordStore: BookRecordStore,
  defaults: { zoom: ZoomValue; scrollMode: ScrollMode; spreadPages: boolean }
): ViewerState {
  const scroll = useElementRef<HTMLDivElement>()
  const pages = useElementRef<HTMLDivElement>()
  const viewport = useElementSize(scroll.node)
  const pageNodes = useRef(new Map<number, HTMLDivElement>())
  const visibleRef = useRef(new Map<number, number>())

  const [baseSizes, setBaseSizes] = useState<{ width: number; height: number; rotation: number }[]>([])
  const [currentPage, setCurrentPage] = useState(1)
  const [zoom, setZoomState] = useState<ZoomValue>(defaults.zoom)
  const [rotation, setRotation] = useState(0)
  const [scrollMode, setScrollModeState] = useState<ScrollMode>(defaults.scrollMode)
  const [scrollRatio, setScrollRatio] = useState(0)
  const [pendingScrollPage, setPendingScrollPage] = useState<number | null>(null)
  const [nonce, setNonce] = useState(0)

  /** 双页跨页只在左右翻页模式下成立 */
  const spreadPages = defaults.spreadPages && scrollMode === 'flip'

  const hydratedRef = useRef(false)
  const consumedPending = useRef(false)
  const currentPageRef = useRef(currentPage)
  currentPageRef.current = currentPage

  // 阅读偏好变了（设置里改默认缩放）就跟随，除非用户已经手动调过
  const userAdjusted = useRef(false)

  /* ---------------------------------------------------- 页面尺寸表 */

  useEffect(() => {
    if (!doc || pageCount <= 0) {
      setBaseSizes([])
      return
    }
    let disposed = false
    const run = async (): Promise<void> => {
      const sizes: { width: number; height: number; rotation: number }[] = []
      for (let page = 1; page <= pageCount; page += 1) {
        if (disposed) return
        try {
          const proxy = await doc.getPage(page)
          const vp = proxy.getViewport({ scale: 1 })
          sizes.push({ width: vp.width, height: vp.height, rotation: proxy.rotate })
        } catch {
          // 个别页解析失败时给一个 A4 兜底，保证版面不塌
          sizes.push({ width: 595, height: 842, rotation: 0 })
        }
      }
      if (!disposed) setBaseSizes(sizes)
    }
    void run()
    return () => {
      disposed = true
    }
  }, [doc, pageCount, nonce])

  /* ---------------------------------------------------- 进度回填 */

  useEffect(() => {
    if (!doc || pageCount <= 0 || hydratedRef.current) return
    const progress = recordStore.record.progress
    setRotation(normalizeRotation(progress.rotation || 0))
    if (progress.zoom && progress.zoom > 0.05) {
      userAdjusted.current = true
      setZoomState(clamp(progress.zoom, ZOOM_MIN, ZOOM_MAX))
    } else if (!userAdjusted.current) {
      setZoomState(defaults.zoom)
    }
    const page = clamp(Math.round(progress.page || 1), 1, Math.max(1, pageCount))
    setCurrentPage(page)
    setScrollRatio(clamp(progress.scrollRatio || 0, 0, 1))
    currentPageRef.current = page
    setPendingScrollPage(page)
    hydratedRef.current = true
    setNonce((n) => n + 1)
    // 仅在文档就绪时回填一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, pageCount])

  // 换书时重置
  useEffect(() => {
    hydratedRef.current = false
    userAdjusted.current = false
    consumedPending.current = false
    visibleRef.current.clear()
  }, [book.id])

  /* ---------------------------------------------------- 缩放解析 */

  /**
   * 适应宽度 / 适应页面时要「装进可视区」的那个盒子。
   * 单页模式是当前页；左右翻页的双页模式是「最大的那个跨页」——
   * 把左右两页（缺半边时按等大留白补足）的屏幕方向尺寸拼成一个大页面，
   * 书缝另外按固定像素扣掉，于是缩放 / 旋转对整叠纸一起生效。
   */
  const fitBase = useMemo(() => {
    if (!baseSizes.length) return null
    const index = clamp(currentPage, 1, baseSizes.length) - 1
    const base = baseSizes[index] ?? baseSizes[0]
    if (!base) return null

    if (!spreadPages) {
      return {
        baseWidth: base.width,
        baseHeight: base.height,
        rotation: normalizeRotation(base.rotation + rotation),
        gap: 0,
        preRotated: false
      }
    }

    /*
      双页跨页：缩放要对「所有跨页里最大的那一叠」成立。
        · 翻页时缩放不跳，舞台尺寸也不跳；
        · 缺半边的那一叠（第 1 页 / 偶数总页数的最后半页）在版面上留着等大的空白，
          所以这里也按两页的宽度算，否则会横向溢出。
      每页各自的旋转先算进「屏幕方向」的尺寸里，再用 preRotated 告诉几何函数别再交换宽高。
    */
    const sizeAt = (page: number): { width: number; height: number } => {
      const size = baseSizes[page - 1] ?? base
      return rotatedSize(size.width, size.height, normalizeRotation(size.rotation + rotation), 1)
    }

    let stageWidth = 0
    let stageHeight = 0
    // 遍历所有跨页取最大值：缩放对整本都成立，翻页时不会一会儿大一会儿小
    const total = spreadCount(baseSizes.length)
    for (let index = 0; index < total; index += 1) {
      const slice = spreadSliceAt(index, baseSizes.length)
      const left = slice.left === null ? null : sizeAt(slice.left)
      const right = slice.right === null ? null : sizeAt(slice.right)
      const present = left ?? right
      if (!present) continue
      // 缺的那半边在版面上是等大的留白，所以两边都按 present 计宽
      stageWidth = Math.max(stageWidth, (left ?? present).width + (right ?? present).width)
      stageHeight = Math.max(stageHeight, left?.height ?? 0, right?.height ?? 0)
    }

    return {
      baseWidth: stageWidth,
      baseHeight: stageHeight,
      rotation: 0,
      gap: stageWidth > 0 ? FLIP_GUTTER : 0,
      preRotated: true
    }
  }, [baseSizes, currentPage, rotation, spreadPages])

  const resolvedZoom = useMemo(() => {
    if (typeof zoom === 'number') return clamp(zoom, ZOOM_MIN, ZOOM_MAX)
    if (!fitBase || viewport.width <= 0) return 1
    const input = {
      viewportWidth: viewport.width,
      viewportHeight: viewport.height,
      baseWidth: fitBase.baseWidth,
      baseHeight: fitBase.baseHeight,
      rotation: fitBase.rotation,
      paddingX: 72,
      paddingY: 56,
      gap: fitBase.gap,
      preRotated: fitBase.preRotated
    }
    return zoom === 'page-width' ? fitWidthZoom(input) : fitPageZoom(input)
  }, [fitBase, viewport.width, viewport.height, zoom])

  /* ---------------------------------------------------- 页面盒子 */

  const pageBoxes = useMemo<PageBox[]>(
    () =>
      baseSizes.map((size, index) =>
        makePageBox(
          index + 1,
          size.width,
          size.height,
          normalizeRotation(size.rotation + rotation),
          resolvedZoom
        )
      ),
    [baseSizes, rotation, resolvedZoom]
  )

  /* ------------------------------------------------ 进度持久化 */

  const setProgress = recordStore.setProgress
  const pageBoxesRef = useRef(pageBoxes)
  pageBoxesRef.current = pageBoxes
  const zoomRef = useRef(zoom)
  zoomRef.current = zoom
  const resolvedZoomRef = useRef(resolvedZoom)
  resolvedZoomRef.current = resolvedZoom
  const rotationRef = useRef(rotation)
  rotationRef.current = rotation
  const scrollModeRef = useRef(scrollMode)
  scrollModeRef.current = scrollMode

  /*
   * 缩放时"看住原来的位置"。
   *
   * 不锁的话，页面尺寸一变，滚动高度跟着变，视口里那一行字就跑掉了 ——
   * 用户的原话是"当前的位置也会由于大小的变化而变化，不会固定在我在看的区域"。
   *
   * 做法：缩放前记下**视口中心正对着哪一页的哪个比例位置**，缩放（重排）之后
   * 把同一个页内位置挪回视口中心。用比例而不是像素，所以换字号/换缩放都能对上。
   */
  const zoomAnchorRef = useRef<{ page: number; ratio: number } | null>(null)

  const captureZoomAnchor = useCallback((): void => {
    const container = scroll.node
    if (!container || pageNodes.current.size === 0) return
    const centerY = container.getBoundingClientRect().top + container.clientHeight / 2
    let best: { page: number; ratio: number } | null = null
    let nearest = Number.POSITIVE_INFINITY
    for (const [page, node] of pageNodes.current) {
      const box = node.getBoundingClientRect()
      if (centerY >= box.top && centerY <= box.bottom) {
        best = { page, ratio: (centerY - box.top) / Math.max(1, box.height) }
        break
      }
      /* 视口中心落在页间空隙里：取最近的那一页，比例取贴边值 */
      const dist = Math.min(Math.abs(centerY - box.top), Math.abs(centerY - box.bottom))
      if (dist < nearest) {
        nearest = dist
        best = { page, ratio: centerY < box.top ? 0 : 1 }
      }
    }
    zoomAnchorRef.current = best
  }, [scroll.node])

  /* 重排之后把锚点挪回视口中心 */
  useEffect(() => {
    const anchor = zoomAnchorRef.current
    const container = scroll.node
    if (!anchor || !container) return undefined
    const raf = requestAnimationFrame(() => {
      zoomAnchorRef.current = null
      const node = pageNodes.current.get(anchor.page)
      if (!node) return
      const box = node.getBoundingClientRect()
      const containerTop = container.getBoundingClientRect().top
      const offsetInPage = box.top - containerTop + box.height * anchor.ratio
      container.scrollTop += offsetInPage - container.clientHeight / 2
    })
    return () => cancelAnimationFrame(raf)
  }, [resolvedZoom, rotation, scroll.node])

  /** 读取当前滚动位置，折算成「第几页 + 页内比例」后写进记录 */
  const snapshotProgress = useCallback((): void => {
    const container = scroll.node
    const boxes = pageBoxesRef.current
    let page = currentPageRef.current
    let ratio = 0
    // 只有连续滚动才能用滚动偏移反推页码：单页 / 左右翻页一次只挂一页，
    // 那样反推出来永远是第 1 页，会把阅读进度写坏。
    if (scrollModeRef.current === 'continuous' && container && boxes.length > 0) {
      const top = container.scrollTop
      let offset = 0
      for (let i = 0; i < boxes.length; i += 1) {
        const height = boxes[i].height
        if (top < offset + height + PAGE_GAP || i === boxes.length - 1) {
          page = i + 1
          ratio = clamp((top - offset) / Math.max(1, height), 0, 1)
          break
        }
        offset += height + PAGE_GAP
      }
    }
    const zoomValue = zoomRef.current
    setProgress({
      page: clamp(page, 1, Math.max(1, boxes.length || 1)),
      scrollRatio: Number.isFinite(ratio) ? ratio : 0,
      zoom: typeof zoomValue === 'number' ? zoomValue : resolvedZoomRef.current,
      rotation: rotationRef.current
    })
  }, [setProgress, scroll.node])

  // 依赖只放真正会变化的「进度信号」，回调本身保持稳定，
  // 否则连续滚动会把 600ms 的防抖窗口一直往后推。
  useEffect(() => {
    if (!doc || !hydratedRef.current) return
    const timer = window.setTimeout(snapshotProgress, 600)
    return () => window.clearTimeout(timer)
  }, [doc, currentPage, scrollRatio, zoom, rotation, snapshotProgress])

  useEffect(() => {
    return () => {
      if (hydratedRef.current) snapshotProgress()
    }
  }, [snapshotProgress])

  /* ------------------------------------------------ 滚动位置跟踪 */

  useEffect(() => {
    const container = scroll.node
    if (!container || !doc) return
    let frame = 0
    const onScroll = (): void => {
      if (frame) return
      frame = window.requestAnimationFrame(() => {
        frame = 0
        const max = Math.max(1, container.scrollHeight - container.clientHeight)
        setScrollRatio(clamp(container.scrollTop / max, 0, 1))
      })
    }
    container.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      if (frame) window.cancelAnimationFrame(frame)
      container.removeEventListener('scroll', onScroll)
    }
  }, [doc, scroll.node])

  /**
   * 用户松手后就不再需要「恢复进度时叠加页内比例」了。
   * 用 scrollend（Chromium 支持）+ 兜底定时器判断，比在滚动过程中判定更准。
   */
  useEffect(() => {
    const container = scroll.node
    if (!container) return
    const onScrollEnd = (): void => {
      consumedPending.current = true
    }
    container.addEventListener('scrollend', onScrollEnd)
    return () => container.removeEventListener('scrollend', onScrollEnd)
  }, [scroll.node])

  /**
   * 用 IntersectionObserver 判断「当前页」：取与容器可视区相交、且最靠上的那一页。
   * 比纯数学分页更稳，尤其是页面高度不一致时。
   */
  const registerPage = useCallback((page: number, node: HTMLDivElement | null): void => {
    if (node) pageNodes.current.set(page, node)
    else {
      pageNodes.current.delete(page)
      visibleRef.current.delete(page)
    }
  }, [])

  useEffect(() => {
    const container = scroll.node
    if (!container || !doc) return
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const page = Number((entry.target as HTMLElement).dataset.page ?? '0')
          if (!page) continue
          if (entry.isIntersecting) visibleRef.current.set(page, entry.intersectionRatio)
          else visibleRef.current.delete(page)
        }
        // 单页 / 左右翻页模式下一次只挂一页（翻页动画时会有两页），
        // 当前页由 goToPage 说了算，不能被观察器按「最靠上的一页」改回去
        if (scrollModeRef.current !== 'continuous') return
        const visible = [...visibleRef.current.keys()]
        if (visible.length === 0) return
        const next = Math.min(...visible)
        if (next !== currentPageRef.current) {
          currentPageRef.current = next
          setCurrentPage(next)
        }
      },
      { root: container, threshold: [0, 0.04, 0.2, 0.5], rootMargin: '-6% 0px -52% 0px' }
    )
    const observed = new WeakSet<Element>()
    const sync = (): void => {
      for (const node of pageNodes.current.values()) {
        if (observed.has(node)) continue
        observed.add(node)
        observer.observe(node)
      }
    }
    sync()
    const target = pages.node ?? container
    const mutation = new MutationObserver(sync)
    mutation.observe(target, { childList: true, subtree: true })
    const interval = window.setInterval(sync, 400)
    return () => {
      observer.disconnect()
      mutation.disconnect()
      window.clearInterval(interval)
    }
  }, [doc, scroll.node, pages.node, scrollMode])

  /* ------------------------------------------------ 跳转与首次定位 */

  useEffect(() => {
    if (pendingScrollPage === null || pageBoxes.length === 0) return
    const page = clamp(pendingScrollPage, 1, pageBoxes.length)
    let cancelled = false

    const apply = (): void => {
      if (cancelled) return
      const node = pageNodes.current.get(page)
      const container = scroll.node
      if (node && container) {
        const pageHeight = pageBoxes[page - 1]?.height ?? node.offsetHeight
        const top = node.offsetTop - PAGE_GAP
        // 首次恢复进度时叠加记录里的页内比例
        const extra = !consumedPending.current ? pageHeight * clamp(scrollRatio, 0, 1) : 0
        container.scrollTop = Math.max(0, top + extra)
        consumedPending.current = true
        currentPageRef.current = page
        setCurrentPage(page)
        setPendingScrollPage(null)
      }
    }

    const raf = window.requestAnimationFrame(apply)
    // 页面刚切换时节点可能还没挂载，稍后再试一次
    const retry = window.setTimeout(apply, 180)
    return () => {
      cancelled = true
      window.cancelAnimationFrame(raf)
      window.clearTimeout(retry)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingScrollPage, pageBoxes, scrollMode, nonce])

  /* ---------------------------------------------------- 对外动作 */

  const resolvedRef = useRef(resolvedZoom)
  resolvedRef.current = resolvedZoom

  const setZoom = useCallback(
    (next: ZoomValue): void => {
      userAdjusted.current = true
      consumedPending.current = true
      /* 先记住"现在看的是哪一页的哪个位置"，重排之后再挪回去 */
      captureZoomAnchor()
      setZoomState(next)
    },
    [captureZoomAnchor]
  )

  const zoomBy = useCallback(
    (delta: number): void => {
      userAdjusted.current = true
      consumedPending.current = true
      captureZoomAnchor()
      setZoomState((current) => {
        const base = typeof current === 'number' ? current : resolvedRef.current
        return Math.round(clamp(base + delta, ZOOM_MIN, ZOOM_MAX) * 1000) / 1000
      })
    },
    [captureZoomAnchor]
  )

  const rotate = useCallback((): void => {
    consumedPending.current = true
    setRotation((current) => normalizeRotation(current + 90))
  }, [])

  /** 只改页码、不做滚动定位：同一叠纸内换当前页时用 */
  const focusPage = useCallback(
    (page: number): void => {
      const target = clamp(Math.round(page), 1, Math.max(1, pageCount))
      if (target === currentPageRef.current) return
      currentPageRef.current = target
      setCurrentPage(target)
    },
    [pageCount]
  )

  const goToPage = useCallback(
    (page: number): void => {
      const target = clamp(Math.round(page), 1, Math.max(1, pageCount))
      currentPageRef.current = target
      setCurrentPage(target)
      setPendingScrollPage(target)
      setNonce((n) => n + 1)
    },
    [pageCount]
  )

  const setScrollMode = useCallback((mode: ScrollMode): void => {
    setScrollModeState(mode)
    setPendingScrollPage(currentPageRef.current)
  }, [])

  const noteUserScroll = useCallback((): void => {
    consumedPending.current = true
  }, [])

  return {
    scrollRef: scroll.ref,
    scrollElement: scroll.node,
    pagesRef: pages.ref,
    pageBoxes,
    viewport,
    currentPage,
    zoom,
    resolvedZoom,
    rotation,
    scrollMode,
    spreadPages,
    scrollRatio,
    pendingScrollPage,
    setScrollMode,
    setZoom,
    zoomBy,
    rotate,
    goToPage,
    setCurrentPage: focusPage,
    registerPage,
    noteUserScroll
  }
}
