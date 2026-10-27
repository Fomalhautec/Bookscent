/**
 * 导出 EPUB 图片。
 *
 * 与 PDF 阅读器的「提取图片」是同一套路子：看清单 → 勾选 → 选保存位置 →
 * 进度 → 结果 + 打开文件夹，好让两个阅读器的这个功能手感一致。
 * 差别只在取材方式：EPUB 的图本来就是独立文件，按原字节导出，不经过渲染。
 *
 * 缩略图的取法（200 张图的书不能一次拉 200 个 blob）：
 *   1. 列表分批渲染（先 40 行，「加载更多」每次再放 80 行），DOM 不至于一上来就上千节点；
 *   2. 已经渲染出来的行里，只有滚进可视区（前后多留 320px）的那几行才去 fetch；
 *   3. 同一个 href 只 fetch 一次，对象地址缓存在 ref 里，关窗 / 卸载时统一 revoke。
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react'
import type { Book, ExtractImagesOptions, SaveImageFile } from '@shared/types'
import { epubUrlFor } from '@shared/noteUrl'
import {
  Button,
  CheckRow,
  Field,
  IconButton,
  Modal,
  ProgressBar,
  Select,
  Spinner,
  TextInput
} from '@/components/common/Controls'
import { IconDownload, IconFolderOpen, IconImage } from '@/components/icons/Icons'
import { appApi, filesApi, libraryApi } from '@/lib/api'
import { formatBytes, safeFileName } from '@/lib/format'
import { useUi } from '@/store/useUi'
import { fetchEpubImageFile, type EpubImageItem } from './imageExport'

/** 一次渲染多少行 / 每次「加载更多」放多少行 */
const ROWS_FIRST = 40
const ROWS_STEP = 80

/** 最小体积过滤：封面和装饰图通常很小，正文插图才有这个量级 */
const SIZE_FILTERS = [
  { value: '0', label: '不限大小' },
  { value: '8192', label: '≥ 8 KB' },
  { value: '32768', label: '≥ 32 KB' },
  { value: '131072', label: '≥ 128 KB' }
]

type ListState = 'loading' | 'ready' | 'error'

export interface ExportImagesModalProps {
  open: boolean
  onClose: () => void
  book: Book
  /** 打开时默认勾选的图（书页里右键点中的那张） */
  presetHref: string | null
  /** 上次用过的保存位置，与阅读器共享，单张导出不用反复选目录 */
  dir: string | null
  onDirChange: (dir: string | null) => void
}

interface ResultSummary {
  dir: string
  count: number
}

export function ExportImagesModal({
  open,
  onClose,
  book,
  presetHref,
  dir,
  onDirChange
}: ExportImagesModalProps): ReactNode {
  const toast = useUi((s) => s.toast)

  const [listState, setListState] = useState<ListState>('loading')
  const [listError, setListError] = useState<string | null>(null)
  const [items, setItems] = useState<EpubImageItem[]>([])
  const [minBytes, setMinBytes] = useState(0)
  const [rendered, setRendered] = useState(ROWS_FIRST)
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [notes, setNotes] = useState<string[]>([])
  const [result, setResult] = useState<ResultSummary | null>(null)

  const [thumbs, setThumbs] = useState<Map<string, string>>(() => new Map())
  /**
   * 看图模式：当前这张的 href（null = 没在看图）。
   * 用 href 而不是下标，是因为清单可能被"最小体积"过滤改变，下标会错位。
   */
  const [viewerHref, setViewerHref] = useState<string | null>(null)
  const [thumbFailed, setThumbFailed] = useState<Set<string>>(() => new Set())

  const listRef = useRef<HTMLDivElement | null>(null)
  const thumbsRef = useRef<Map<string, string>>(new Map())
  const inflightRef = useRef<Set<string>>(new Set())
  const openRef = useRef(open)
  const busyRef = useRef(false)
  const presetRef = useRef<string | null>(presetHref)
  /** 每次开窗 / 换书 +1：迟到的缩略图响应靠它判断"这已经是另一轮了" */
  const genRef = useRef(0)

  const prefix = useMemo(() => safeFileName(book.title, 'EPUB'), [book.title])

  // presetHref 只在「开窗那一刻」需要，所以放进 ref：换默认勾选不该把清单重新拉一遍
  useEffect(() => {
    presetRef.current = presetHref
  }, [presetHref])

  /* -------------------------------------------------- 缩略图缓存的生命周期 */

  const revokeAll = useCallback((reset = true): void => {
    for (const url of thumbsRef.current.values()) URL.revokeObjectURL(url)
    thumbsRef.current.clear()
    inflightRef.current.clear()
    if (reset) {
      setThumbs(new Map())
      setThumbFailed(new Set())
    }
  }, [])

  const loadThumb = useCallback(
    (href: string): void => {
      if (thumbsRef.current.has(href) || inflightRef.current.has(href)) return
      inflightRef.current.add(href)
      const gen = genRef.current
      void (async () => {
        try {
          const response = await fetch(epubUrlFor(book.id, href))
          if (!response.ok) throw new Error(`HTTP ${response.status}`)
          const url = URL.createObjectURL(await response.blob())
          // 关窗 / 换书之后才回来：这张直接放掉，别留在缓存里
          if (!openRef.current || gen !== genRef.current) {
            URL.revokeObjectURL(url)
            return
          }
          thumbsRef.current.set(href, url)
          setThumbs(new Map(thumbsRef.current))
        } catch {
          setThumbFailed((prev) => {
            const next = new Set(prev)
            next.add(href)
            return next
          })
        } finally {
          inflightRef.current.delete(href)
        }
      })()
    },
    [book.id]
  )

  /* --------------------------------------------------------------- 开窗 / 关窗 */

  useEffect(() => {
    openRef.current = open
    if (open) return
    // 关掉就把对象地址全放掉：blob 不跟着走的话一个 200 张图的书会一直占着内存
    revokeAll()
  }, [open, revokeAll])

  useEffect(
    () => () => {
      openRef.current = false
      revokeAll(false)
    },
    [revokeAll]
  )

  useEffect(() => {
    if (!open) return
    let cancelled = false
    genRef.current += 1
    revokeAll()
    setItems([])
    setSelected(new Set())
    setRendered(ROWS_FIRST)
    setBusy(false)
    setProgress(null)
    setNotes([])
    setResult(null)
    setListError(null)
    setListState('loading')

    void (async () => {
      try {
        const list = await libraryApi.epubImages(book.path)
        if (cancelled) return
        setItems(list)
        setListState('ready')
        const preset = presetRef.current
        if (!preset) return
        // 默认勾的那张可能很小，先把体积过滤放开，免得它被过滤掉、看着像没选中
        setMinBytes(0)
        if (list.some((item) => item.href === preset)) setSelected(new Set([preset]))
        else toast('没在清单里找到这张图片，可以在列表里手动勾选', 'warn')
      } catch (error) {
        if (cancelled) return
        setListError((error as Error).message)
        setListState('error')
      }
    })()

    return () => {
      cancelled = true
    }
    // presetHref 用 ref 读：换默认勾选不该把清单重新拉一遍
  }, [open, book.path, revokeAll, toast])

  /* ------------------------------------------------------------------ 清单视图 */

  const filtered = useMemo(
    () => items.filter((item) => item.bytes >= minBytes),
    [items, minBytes]
  )
  const shown = useMemo(() => filtered.slice(0, rendered), [filtered, rendered])
  /** 勾选以清单为准（不随体积过滤丢掉）：过滤只是"看得见哪几行"，不是"能不能导出" */
  const selectedItems = useMemo(
    () => items.filter((item) => selected.has(item.href)),
    [items, selected]
  )
  const selectedBytes = useMemo(
    () => selectedItems.reduce((sum, item) => sum + item.bytes, 0),
    [selectedItems]
  )

  const toggle = useCallback((href: string): void => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(href)) next.delete(href)
      else next.add(href)
      return next
    })
  }, [])

  const selectAll = (): void => setSelected(new Set(filtered.map((item) => item.href)))
  const selectNone = (): void => setSelected(new Set())
  const invert = (): void =>
    setSelected((prev) => {
      const next = new Set<string>()
      for (const item of filtered) if (!prev.has(item.href)) next.add(item.href)
      return next
    })

  const changeFilter = (value: string): void => {
    setMinBytes(Number(value) || 0)
    // 过滤条件变了就回到第一批，免得「已渲染 500 行」这种状态跟着走
    setRendered(ROWS_FIRST)
  }

  const clearResult = (): void => {
    setResult(null)
    setNotes([])
  }

  /* -------------------------------------------------------------------- 导出 */

  const run = useCallback(
    async (targets: EpubImageItem[]): Promise<void> => {
      if (busyRef.current) return
      if (targets.length === 0) {
        toast('请先勾选要导出的图片', 'warn')
        return
      }
      busyRef.current = true
      setBusy(true)
      setResult(null)
      setNotes([])
      setProgress({ done: 0, total: targets.length })

      try {
        const files: SaveImageFile[] = []
        const failed: string[] = []
        for (let index = 0; index < targets.length; index += 1) {
          const item = targets[index]
          try {
            files.push(await fetchEpubImageFile(book.id, item))
          } catch {
            failed.push(item.name)
          }
          setProgress({ done: index + 1, total: targets.length })
        }

        const nextNotes: string[] = []
        if (failed.length > 0) {
          const head = failed.slice(0, 3).join('、')
          nextNotes.push(`跳过 ${failed.length} 张（读取失败）：${head}${failed.length > 3 ? ' 等' : ''}`)
        }
        if (files.length === 0) {
          setNotes(nextNotes)
          toast('没有可导出的图片', 'warn', nextNotes.join('；') || undefined)
          return
        }
        setNotes(nextNotes)

        const options: ExtractImagesOptions = { dir, mode: 'embedded', prefix }
        const saved = await filesApi.saveImages(options, files)
        if (saved.cancelled) {
          toast('已取消保存', 'info')
          return
        }
        setResult({ dir: saved.dir, count: saved.files.length })
        toast(
          `已导出 ${saved.files.length} 个文件到 ${saved.dir}`,
          'success',
          nextNotes.length > 0 ? nextNotes.join('；') : undefined
        )
      } catch (error) {
        toast('图片导出失败', 'error', (error as Error).message)
      } finally {
        busyRef.current = false
        setBusy(false)
        setProgress(null)
      }
    },
    [book.id, dir, prefix, toast]
  )

  const chooseDir = async (): Promise<void> => {
    try {
      const picked = await filesApi.chooseDirectory('选择图片保存位置')
      if (picked) onDirChange(picked)
    } catch (error) {
      toast('选择文件夹失败', 'error', (error as Error).message)
    }
  }

  /* -------------------------------------------------------------------- 渲染 */

  const totalBytes = useMemo(() => items.reduce((sum, item) => sum + item.bytes, 0), [items])

  /* ---------------------------------------------------------------- 看图模式 */

  const viewerItem = useMemo(
    () => (viewerHref ? (items.find((item) => item.href === viewerHref) ?? null) : null),
    [viewerHref, items]
  )
  /** 当前这张在**过滤后**清单里的位置（翻页按看得见的顺序走） */
  const viewerIndex = useMemo(
    () => (viewerHref ? filtered.findIndex((item) => item.href === viewerHref) : -1),
    [viewerHref, filtered]
  )
  const viewerSrc = viewerItem ? (thumbs.get(viewerItem.href) ?? null) : null

  /** 翻页：预取相邻那张，翻过去就不会先看到空白 */
  const stepViewer = useCallback(
    (delta: number): void => {
      if (viewerIndex < 0) return
      const next = filtered[viewerIndex + delta]
      if (!next) return
      setViewerHref(next.href)
      loadThumb(next.href)
      const after = filtered[viewerIndex + delta * 2]
      if (after) loadThumb(after.href)
    },
    [viewerIndex, filtered, loadThumb]
  )

  /* 看图时接管键盘：左右翻页、Esc 退出（别把弹窗一起关掉） */
  useEffect(() => {
    if (!viewerItem) return
    loadThumb(viewerItem.href)
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'ArrowLeft') {
        event.stopPropagation()
        stepViewer(-1)
      } else if (event.key === 'ArrowRight') {
        event.stopPropagation()
        stepViewer(1)
      } else if (event.key === 'Escape') {
        event.stopPropagation()
        setViewerHref(null)
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [viewerItem, loadThumb, stepViewer])

  return (
    <Modal
      open={open}
      title="导出图片"
      subtitle="把这本书里的图片按原文件导出，可多选、可按体积筛"
      width={680}
      onClose={() => {
        if (busy) return
        /*
         * 看图时按 Esc 先退出看图，别把整个导出弹窗一起关掉。
         * 弹窗自己的 Esc 监听和看图那层都在 window 上，谁先注册谁先跑，
         * 光靠 stopPropagation 是拦不住的 —— 在 onClose 这里挡才稳。
         */
        if (viewerHref) {
          setViewerHref(null)
          return
        }
        clearResult()
        onClose()
      }}
      footer={
        result ? (
          <>
            <Button size="sm" variant="ghost" onClick={clearResult}>
              再导一次
            </Button>
            <Button
              size="sm"
              variant="outline"
              icon={<IconFolderOpen size={15} />}
              onClick={() => void appApi.revealPath(result.dir)}
            >
              打开文件夹
            </Button>
            <Button size="sm" variant="solid" onClick={onClose}>
              完成
            </Button>
          </>
        ) : (
          <>
            <Button size="sm" variant="ghost" disabled={busy} onClick={onClose}>
              取消
            </Button>
            <Button
              size="sm"
              variant="solid"
              icon={<IconDownload size={14} />}
              disabled={busy || listState !== 'ready' || selectedItems.length === 0}
              onClick={() => void run(selectedItems)}
            >
              {busy ? '正在导出…' : `导出${selectedItems.length > 0 ? ` ${selectedItems.length} 张` : ''}`}
            </Button>
          </>
        )
      }
    >
      <div className="epub-export">
        {listState === 'loading' ? (
          <div className="epub-export-status">
            <Spinner size={16} />
            <span>正在读这本书的图片清单…</span>
          </div>
        ) : null}

        {listState === 'error' ? (
          <div className="epub-export-status is-error">
            <IconImage size={18} />
            <span>{listError ?? '读不到图片清单'}</span>
          </div>
        ) : null}

        {listState === 'ready' && items.length === 0 ? (
          <div className="epub-export-status">
            <IconImage size={18} />
            <span>这本书里没有找到图片。</span>
          </div>
        ) : null}

        {listState === 'ready' && items.length > 0 ? (
          <>
            <div className="epub-export-head">
              <span className="epub-export-count">
                共 {items.length} 张 · {formatBytes(totalBytes)}
                {filtered.length !== items.length ? ` · 符合条件 ${filtered.length} 张` : ''}
              </span>
              <span className="epub-export-picked">
                已选 {selectedItems.length} 张{selectedItems.length > 0 ? ` · ${formatBytes(selectedBytes)}` : ''}
              </span>
            </div>

            <div className="epub-export-tools">
              <div className="segmented epub-export-seg">
                <button type="button" className="segmented-item" onClick={selectAll} disabled={filtered.length === 0}>
                  全选
                </button>
                <button type="button" className="segmented-item" onClick={selectNone} disabled={selected.size === 0}>
                  全不选
                </button>
                <button type="button" className="segmented-item" onClick={invert} disabled={filtered.length === 0}>
                  反选
                </button>
              </div>
              <label className="epub-export-filter">
                最小体积
                <Select value={String(minBytes)} options={SIZE_FILTERS} onChange={changeFilter} />
              </label>
            </div>

            <div className="epub-export-list" ref={listRef}>
              {shown.map((item) => (
                <ImageRow
                  key={item.href}
                  item={item}
                  checked={selected.has(item.href)}
                  thumb={thumbs.get(item.href) ?? null}
                  failed={thumbFailed.has(item.href)}
                  busy={busy}
                  root={listRef}
                  onToggle={toggle}
                  onRequestThumb={loadThumb}
                  onExportOne={(target) => void run([target])}
                  onView={() => setViewerHref(item.href)}
                />
              ))}
              {filtered.length > shown.length ? (
                <div className="epub-export-more">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setRendered((value) => value + ROWS_STEP)}
                  >
                    加载更多（还有 {filtered.length - shown.length} 张）
                  </Button>
                </div>
              ) : null}
            </div>
          </>
        ) : null}

        <Field label="保存位置" hint={dir ?? '不选择则导出时弹出系统文件夹选择框'}>
          <div className="epub-export-dir">
            <TextInput value={dir ?? ''} readOnly placeholder="（导出时询问）" />
            <Button size="sm" variant="outline" onClick={() => void chooseDir()}>
              选择文件夹
            </Button>
          </div>
        </Field>

        {busy ? (
          <div className="epub-export-progress">
            <ProgressBar value={progress?.done ?? 0} max={progress?.total ?? 1} />
            <span className="muted tabular">
              {progress ? `${progress.done} / ${progress.total}` : '正在准备…'}
            </span>
          </div>
        ) : null}

        {result ? (
          <div className="epub-export-result">
            <p className="epub-export-result-title">已导出 {result.count} 个文件</p>
            <p className="muted epub-export-result-dir" title={result.dir}>
              {result.dir}
            </p>
            {notes.length > 0 ? (
              <ul className="epub-export-notes">
                {notes.map((note, index) => (
                  <li key={index}>{note}</li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}

        {/*
          看图模式：大图 + 左右翻 + 就地导出。
          它盖在弹窗里（不另开窗），所以清单的勾选状态、保存位置、体积过滤全都还在，
          "看着图导出"这件事是一体的 —— 这就是用户要的"在此基础上整合导出"。
        */}
        {viewerItem ? (
          <div className="epub-viewer" role="dialog" aria-label="看图">
            <div className="epub-viewer-bar">
              <span className="epub-viewer-name" title={viewerItem.href}>
                {viewerItem.name}
              </span>
              <span className="epub-viewer-meta tabular">
                {formatBytes(viewerItem.bytes)}
                {viewerIndex >= 0 ? ` · 第 ${viewerIndex + 1} / ${filtered.length} 张` : ''}
              </span>
              <span className="epub-viewer-spacer" />
              <CheckRow
                checked={selected.has(viewerItem.href)}
                onChange={() => toggle(viewerItem.href)}
                label="选中这张"
              />
              <Button
                size="sm"
                variant="solid"
                icon={<IconDownload size={14} />}
                disabled={busy}
                onClick={() => void run([viewerItem])}
              >
                导出这张
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={busy || selectedItems.length === 0}
                onClick={() => void run(selectedItems)}
              >
                导出选中（{selectedItems.length}）
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setViewerHref(null)}>
                关闭
              </Button>
            </div>

            <div className="epub-viewer-stage">
              <button
                type="button"
                className="epub-viewer-nav is-prev"
                title="上一张（←）"
                disabled={viewerIndex <= 0}
                onClick={() => stepViewer(-1)}
              >
                ‹
              </button>
              {viewerSrc ? (
                <img className="epub-viewer-img" src={viewerSrc} alt={viewerItem.name} />
              ) : (
                <div className="epub-viewer-loading">
                  <Spinner size={20} />
                  <span className="muted">正在取图…</span>
                </div>
              )}
              <button
                type="button"
                className="epub-viewer-nav is-next"
                title="下一张（→）"
                disabled={viewerIndex < 0 || viewerIndex >= filtered.length - 1}
                onClick={() => stepViewer(1)}
              >
                ›
              </button>
            </div>
            <p className="epub-viewer-hint muted">← → 翻页 · Esc 退出看图 · 勾选后可以一起导出</p>
          </div>
        ) : null}
      </div>
    </Modal>
  )
}

/* --------------------------------------------------------------- 清单里的一行 */

interface ImageRowProps {
  item: EpubImageItem
  checked: boolean
  thumb: string | null
  failed: boolean
  busy: boolean
  root: RefObject<HTMLDivElement | null>
  onToggle: (href: string) => void
  onRequestThumb: (href: string) => void
  onExportOne: (item: EpubImageItem) => void
  /** 点缩略图 → 进看图模式（大图） */
  onView: (href: string) => void
}

/**
 * 一行 = 缩略图 + 勾选（名称/体积）+「导出这张」。
 * 这一行自己盯着可视区：滚到了才去取缩略图，所以 200 张的书也只有十几张在飞。
 */
function ImageRow({
  item,
  checked,
  thumb,
  failed,
  busy,
  root,
  onToggle,
  onRequestThumb,
  onExportOne,
  onView
}: ImageRowProps): ReactNode {
  const rowRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (thumb || failed) return
    const node = rowRef.current
    if (!node) return
    if (typeof IntersectionObserver === 'undefined') {
      onRequestThumb(item.href)
      return
    }
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue
          onRequestThumb(item.href)
          observer.disconnect()
          return
        }
      },
      { root: root.current ?? null, rootMargin: '320px 0px' }
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [thumb, failed, item.href, onRequestThumb, root])

  return (
    <div className="epub-export-row" ref={rowRef} title={item.href}>
      {/*
        点缩略图进「看图模式」（大图 + 左右翻 + 就地导出）。
        缩略图本来就用原图字节生成的 object URL，所以大图能直接用同一份，不必再取一次。
      */}
      <button
        type="button"
        className="epub-export-thumb"
        title="看图（大图）"
        onClick={() => onView(item.href)}
      >
        {thumb ? (
          <img src={thumb} alt={item.name} loading="lazy" decoding="async" />
        ) : failed ? (
          <span className="epub-export-thumb-fail">无法预览</span>
        ) : (
          <Spinner size={14} />
        )}
      </button>
      <CheckRow
        checked={checked}
        onChange={() => onToggle(item.href)}
        label={item.name}
        detail={`${formatBytes(item.bytes)} · ${item.href}`}
      />
      <IconButton
        label={busy ? '正在导出…' : '导出这张图片'}
        className="epub-export-one"
        disabled={busy}
        onClick={() => onExportOne(item)}
      >
        <IconDownload size={15} />
      </IconButton>
    </div>
  )
}
