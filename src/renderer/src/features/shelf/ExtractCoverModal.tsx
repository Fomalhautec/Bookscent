/**
 * 「从书内图片提取封面 / 书脊」。
 *
 * 两步：
 *   1. 列图 —— 这本书内部的所有图片（缩略图 + 名字 + 体积），可筛体积、可加载更多；
 *   2. 裁剪 —— 点一张进裁剪台：拖动选框、拉角把手缩放、按封面 / 书脊比例预设，
 *      确认后画到 <canvas> 上导出 dataURL，落盘并写进 book.style。
 *
 * 裁剪全部自己算（归一化矩形的几何在 `extractCover.ts`），不引第三方裁剪库；
 * 素材永远取原始字节，不拿屏幕上的缩略图当输入，所以裁出来是原图分辨率。
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode
} from 'react'
import type { Book } from '@shared/types'
import { Button, Field, IconButton, Modal, Segmented, Select, Spinner } from '@/components/common/Controls'
import { IconImage, IconImageExtract, IconMinus, IconPlus } from '@/components/icons/Icons'
import { settingsApi } from '@/lib/api'
import { formatBytes } from '@/lib/format'
import { useLibrary } from '@/store/useLibrary'
import { useUi } from '@/store/useUi'
import {
  blobUrlOf,
  clampRect,
  decodeForCrop,
  decodeImageSize,
  drawCrop,
  fitRect,
  FULL_CROP,
  loadInternalImages,
  mimeForName,
  resizeCrop,
  type CoverExtractKind,
  type CropHandle,
  type CropRect,
  type InternalImage,
  type InternalImageSource
} from './extractCover'

/* ------------------------------------------------------------------ 常量 */

/*
 * 裁剪工作区的上限。
 *
 * 放大过一次：封面图往往是 1200×1800 这种竖长图，480 左右的高度里
 * 连封面上的字都看不清，选一块细节基本靠蒙。
 * 高度还要按窗口夹一下（见 maxStageHeight），否则小屏幕上弹窗会顶出去。
 */
const STAGE_MAX_W = 780
const STAGE_MAX_H = 660
/** 弹窗头尾 + 比例栏 + 缩放栏 + 外边距大约要占这么多高 */
const STAGE_CHROME = 300
/**
 * 小图允许放大到几倍。
 *
 * 以前这里是 `Math.min(1, …)` —— 只缩不放，所以书里一张 120px 的小图
 * 在工作区里就是 120px 的一小块，既看不清也没法精确框选，
 * 看着就像"工作区太小"。现在让它铺满可用空间，只是别放到糊掉。
 */
const MAX_UPSCALE = 3

/** 当前窗口下，裁剪台最多能有多高 */
function maxStageHeight(): number {
  if (typeof window === 'undefined') return STAGE_MAX_H
  return Math.max(320, Math.min(STAGE_MAX_H, window.innerHeight - STAGE_CHROME))
}
/** 裁剪台最多放大到几倍（再大就是马赛克了） */
const MAX_ZOOM = 8
const HANDLES: CropHandle[] = ['nw', 'ne', 'sw', 'se']

/** 一次渲染多少张缩略图；「加载更多」每次再放这么多 */
const ROWS_FIRST = 36

const SIZE_FILTERS = [
  { value: '0', label: '不限大小' },
  { value: '8192', label: '≥ 8 KB' },
  { value: '32768', label: '≥ 32 KB' },
  { value: '131072', label: '≥ 128 KB' }
]

const COVER_RATIOS: { value: string; label: string; title: string }[] = [
  { value: '1.5', label: '3 : 2', title: '封面的标准比例（宽 ÷ 高 = 1.5）' },
  { value: '0.6667', label: '2 : 3', title: '竖开的封面' },
  { value: '0.8', label: '4 : 5', title: '接近方形的一本画册' },
  { value: '1', label: '1 : 1', title: '方形' }
]

const SPINE_RATIOS: { value: string; label: string; title: string }[] = [
  { value: '0.3333', label: '1 : 3', title: '厚书书脊（宽 ÷ 高 ≈ 0.33）' },
  { value: '0.25', label: '1 : 4', title: '常见精装书脊（宽 ÷ 高 ≈ 0.25）' },
  { value: '0.1667', label: '1 : 6', title: '平装薄书（宽 ÷ 高 ≈ 0.17）' },
  { value: '0.125', label: '1 : 8', title: '极薄的小册子' }
]

type ListState = 'loading' | 'ready' | 'error'

interface PickedImage {
  item: InternalImage
  url: string
  width: number
  height: number
}

export interface ExtractCoverModalProps {
  open: boolean
  onClose: () => void
  book: Book
  kind: CoverExtractKind
  /** 裁好之后写进 book.style 的哪个字段 */
  onApply: (value: string, aspect: number | null) => void
}

/* ==================================================================== 主体 */

export function ExtractCoverModal({ open, onClose, book, kind, onApply }: ExtractCoverModalProps): ReactNode {
  const toast = useUi((s) => s.toast)

  const [listState, setListState] = useState<ListState>('loading')
  const [listError, setListError] = useState<string | null>(null)
  const [items, setItems] = useState<InternalImage[]>([])
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [minBytes, setMinBytes] = useState(0)
  const [rendered, setRendered] = useState(ROWS_FIRST)
  const [thumbs, setThumbs] = useState<Map<string, string>>(() => new Map())
  const [failed, setFailed] = useState<Set<string>>(() => new Set())

  const [picked, setPicked] = useState<PickedImage | null>(null)
  const [crop, setCrop] = useState<CropRect>(FULL_CROP)
  const [ratio, setRatio] = useState<string>(kind === 'cover' ? '1.5' : '0.25')
  const [saving, setSaving] = useState(false)

  /** 清单来源：缩略图与素材都从它取字节，不重新枚举一遍 */
  const sourceRef = useRef<InternalImageSource | null>(null)
  /** 已经 createObjectURL 出来的地址，关窗时统一 revoke */
  const urlsRef = useRef<Map<string, string>>(new Map())
  const inflightRef = useRef<Set<string>>(new Set())
  const openRef = useRef(open)
  const savedRef = useRef(false)

  const ratios = kind === 'cover' ? COVER_RATIOS : SPINE_RATIOS
  const title = kind === 'cover' ? '从书内图片选封面' : '从书内图片选书脊'

  /* -------------------------------------------------- blob 地址的生命周期 */

  const releaseUrls = useCallback((): void => {
    for (const url of urlsRef.current.values()) URL.revokeObjectURL(url)
    urlsRef.current.clear()
    inflightRef.current.clear()
  }, [])

  useEffect(() => {
    openRef.current = open
    if (open) return
    // 关窗就放掉所有 blob 地址：一屏缩略图不解引用会一直占着内存
    releaseUrls()
    setThumbs(new Map())
  }, [open, releaseUrls])

  useEffect(
    () => () => {
      releaseUrls()
    },
    [releaseUrls]
  )

  /* ------------------------------------------------------ 开窗：拉图片清单 */

  useEffect(() => {
    if (!open) return
    let cancelled = false
    releaseUrls()
    sourceRef.current = null
    setItems([])
    setThumbs(new Map())
    setFailed(new Set())
    setPicked(null)
    setProgress(null)
    setListError(null)
    setRendered(ROWS_FIRST)
    setMinBytes(0)
    setSaving(false)
    savedRef.current = false
    setListState('loading')

    void (async () => {
      try {
        const source = await loadInternalImages(book, {
          onProgress: (done, total) => {
            if (!cancelled && total > 0 && done < total) setProgress({ done, total })
          }
        })
        if (cancelled) {
          sourceRef.current = null
          return
        }
        sourceRef.current = source
        setItems(source.items)
        setProgress(null)
        setListState('ready')
      } catch (error) {
        if (cancelled) return
        setProgress(null)
        setListError((error as Error).message)
        setListState('error')
      }
    })()

    return () => {
      cancelled = true
    }
  }, [open, book, releaseUrls])

  /* ------------------------------------------------------------ 缩略图加载 */

  const loadThumb = useCallback((item: InternalImage): void => {
    const source = sourceRef.current
    if (!source) return
    if (urlsRef.current.has(item.id) || inflightRef.current.has(item.id)) return
    inflightRef.current.add(item.id)
    void (async () => {
      try {
        const bytes = await source.fetchBytes(item.id)
        const url = blobUrlOf(bytes, mimeForName(item.name))
        if (!openRef.current) {
          URL.revokeObjectURL(url)
          return
        }
        urlsRef.current.set(item.id, url)
        setThumbs(new Map(urlsRef.current))
      } catch {
        setFailed((prev) => new Set(prev).add(item.id))
      } finally {
        inflightRef.current.delete(item.id)
      }
    })()
  }, [])

  /* ------------------------------------------------------------------ 清单 */

  const filtered = useMemo(() => items.filter((item) => item.bytes >= minBytes), [items, minBytes])
  const shown = useMemo(() => filtered.slice(0, rendered), [filtered, rendered])

  useEffect(() => {
    if (!open || listState !== 'ready') return
    for (const item of shown) loadThumb(item)
  }, [open, listState, shown, loadThumb])

  /* ------------------------------------------------------------ 选中 → 裁剪 */

  const choose = async (item: InternalImage): Promise<void> => {
    const source = sourceRef.current
    if (!source) return
    try {
      const bytes = await source.fetchBytes(item.id)
      const url = blobUrlOf(bytes, mimeForName(item.name))
      const size = await decodeImageSize(url)
      if (!size) {
        URL.revokeObjectURL(url)
        toast('这张图打不开，换一张试试', 'warn')
        return
      }
      setPicked({ item, url, width: size.width, height: size.height })
      /*
       * 默认**全尺寸**框选。
       *
       * 电子书里内嵌的封面/书脊图绝大多数本来就是裁好的干净图，
       * 一进来就给个居中的小框反而要用户先放大再拖开。
       * 想按比例重裁，点上面的比例预设即可（那时才用 fitRect）。
       */
      setCrop(FULL_CROP)
      setRatio('free')
    } catch (error) {
      toast('读取这张图片失败', 'error', (error as Error).message)
    }
  }

  const backToList = (): void => {
    if (picked) URL.revokeObjectURL(picked.url)
    setPicked(null)
  }

  const applyRatio = (value: string): void => {
    setRatio(value)
    if (value === 'free') {
      setCrop((prev) => clampRect(prev))
      return
    }
    setCrop(fitRect(Number(value)))
  }

  /* ------------------------------------------------------------ 确认裁剪 */

  const confirm = async (): Promise<void> => {
    if (!picked || saving || savedRef.current) return
    setSaving(true)
    try {
      const blob = await fetchBlob(picked.url)
      const image = await decodeForCrop(blob)
      const dataUrl = drawCrop(image, crop, picked.width, picked.height)
      if (!dataUrl) throw new Error('画布导出失败')
      const aspect = (crop.w * picked.width) / Math.max(1, crop.h * picked.height)
      savedRef.current = true

      /*
       * 落盘 + 换引用。
       *
       * 渲染层写不了数据目录，所以先把结果按「内联 data URL」交给调用方写进样式
       * （BookStyle 本来就有这条兼容路径），紧接着调用设置页那个「内联图片落盘」
       * 把索引里的内联图搬进数据目录，再重读书库 —— 于是这条样式最终以
       * `asset:<文件名>` 的形式存住，索引不会长期背着 base64。
       */
      onApply(dataUrl, aspect)
      const migrated = await settingsApi.migrateInlineImages()
      if (migrated.moved > 0) await useLibrary.getState().load()

      toast(
        kind === 'cover' ? '封面已从书内图片换上' : '书脊已从书内图片换上',
        'success',
        picked.item.name
      )
      onClose()
    } catch (error) {
      toast('裁剪保存失败', 'error', (error as Error).message)
    } finally {
      setSaving(false)
    }
  }

  /* ------------------------------------------------------------------ 渲染 */

  return (
    <Modal
      open={open}
      title={title}
      subtitle={`《${book.title}》 · 书里的图片可以直接裁成${kind === 'cover' ? '封面' : '书脊'}`}
      width={picked ? 1160 : 760}
      onClose={() => {
        if (saving) return
        onClose()
      }}
      footer={
        picked ? (
          <>
            <Button size="sm" variant="ghost" disabled={saving} onClick={backToList}>
              换一张
            </Button>
            <Button size="sm" variant="solid" disabled={saving} onClick={() => void confirm()}>
              {saving ? '正在保存…' : kind === 'cover' ? '用作封面' : '用作书脊'}
            </Button>
          </>
        ) : (
          <Button size="sm" variant="ghost" onClick={onClose}>
            取消
          </Button>
        )
      }
    >
      <div className="xcover">
        {picked ? (
          <CropEditor
            picked={picked}
            crop={crop}
            ratio={ratio}
            ratios={ratios}
            kind={kind}
            onChange={setCrop}
            onRatio={applyRatio}
          />
        ) : (
          <>
            {listState === 'loading' ? (
              <div className="xcover-status">
                <Spinner size={16} />
                <span>
                  {progress
                    ? `正在扫描书里的图片…第 ${progress.done} / ${progress.total} 页`
                    : '正在读这本书的图片清单…'}
                </span>
              </div>
            ) : null}

            {listState === 'error' ? (
              <div className="xcover-status is-error">
                <IconImage size={18} />
                <span>{listError ?? '读不到这本书的图片'}</span>
              </div>
            ) : null}

            {listState === 'ready' && items.length === 0 ? (
              <div className="xcover-status">
                <IconImageExtract size={18} />
                <span>这本书里没有找到可用的图片。</span>
              </div>
            ) : null}

            {listState === 'ready' && items.length > 0 ? (
              <>
                <div className="xcover-head">
                  <span className="muted">
                    共 {items.length} 张图
                    {filtered.length !== items.length ? ` · 符合条件 ${filtered.length} 张` : ''}
                  </span>
                  <label className="xcover-filter">
                    最小体积
                    <Select
                      value={String(minBytes)}
                      options={SIZE_FILTERS}
                      onChange={(value) => {
                        setMinBytes(Number(value) || 0)
                        setRendered(ROWS_FIRST)
                      }}
                    />
                  </label>
                </div>

                <div className="xcover-grid">
                  {shown.map((item) => (
                    <button
                      type="button"
                      className="xcover-card"
                      key={item.id}
                      title={`${item.name} · ${item.id}`}
                      onClick={() => void choose(item)}
                    >
                      <span className="xcover-thumb">
                        {thumbs.get(item.id) ? (
                          <img src={thumbs.get(item.id)} alt={item.name} loading="lazy" decoding="async" />
                        ) : failed.has(item.id) ? (
                          <span className="xcover-thumb-fail">无法预览</span>
                        ) : (
                          <Spinner size={14} />
                        )}
                      </span>
                      <span className="xcover-name">{item.name}</span>
                      <span className="xcover-sub">
                        {item.width && item.height ? `${item.width}×${item.height} · ` : ''}
                        {formatBytes(item.bytes)}
                      </span>
                    </button>
                  ))}
                </div>

                {filtered.length > shown.length ? (
                  <div className="xcover-more">
                    <Button size="sm" variant="outline" onClick={() => setRendered((value) => value + ROWS_FIRST)}>
                      加载更多（还有 {filtered.length - shown.length} 张）
                    </Button>
                  </div>
                ) : null}
              </>
            ) : null}
          </>
        )}
      </div>
    </Modal>
  )
}

/* ============================================================== 裁剪编辑台 */

function CropEditor({
  picked,
  crop,
  ratio,
  ratios,
  kind,
  onChange,
  onRatio
}: {
  picked: PickedImage
  crop: CropRect
  ratio: string
  ratios: { value: string; label: string; title: string }[]
  kind: CoverExtractKind
  onChange: (rect: CropRect) => void
  onRatio: (value: string) => void
}): ReactNode {
  const [pending, setPending] = useState<CropRect>(crop)

  useEffect(() => {
    setPending(crop)
  }, [crop])

  const commit = useCallback(
    (rect: CropRect) => {
      setPending(rect)
      onChange(rect)
    },
    [onChange]
  )

  const outW = Math.max(1, Math.round(pending.w * picked.width))
  const outH = Math.max(1, Math.round(pending.h * picked.height))

  return (
    <div className="xcover-crop">
      <div className="xcover-seg">
        <Segmented
          value={ratio}
          onChange={onRatio}
          options={[
            ...ratios.map((entry) => ({ value: entry.value, label: entry.label, title: entry.title })),
            { value: 'free', label: '自由', title: '不锁定比例，宽高各拉各的' }
          ]}
        />
      </div>

      <CropStage
        url={picked.url}
        width={picked.width}
        height={picked.height}
        rect={pending}
        aspect={ratio === 'free' ? null : Number(ratio)}
        onChange={commit}
      />

      <div className="xcover-facts">
        <span>
          原图 {picked.width}×{picked.height}
        </span>
        <span>
          裁出 {outW}×{outH}（宽高比 {(outW / outH).toFixed(2)}）
        </span>
        <span className="xcover-facts-name" title={picked.item.name}>
          {picked.item.name}
        </span>
      </div>

      <Field
        label={kind === 'cover' ? '封面比例' : '书脊比例'}
        hint={
          kind === 'cover'
            ? '3 : 2 是封面的标准比例；裁出来的宽高比会顺手记进书籍样式。'
            : '书脊是细长的一条，按书架上惯用的厚度挑一个就好。'
        }
      >
        <p className="xcover-tip muted">拖动虚框内部平移，拉四角把手缩放；上面的比例按钮一键换形状。</p>
      </Field>
    </div>
  )
}

/* ------------------------------------------------------------------ 裁剪台 */

function CropStage({
  url,
  width,
  height,
  rect,
  aspect,
  onChange
}: {
  url: string
  width: number
  height: number
  rect: CropRect
  aspect: number | null
  onChange: (rect: CropRect) => void
}): ReactNode {
  const stageRef = useRef<HTMLDivElement | null>(null)
  const dragRef = useRef<
    { kind: 'rect'; handle: CropHandle; x: number; y: number; rect: CropRect } | { kind: 'pan'; x: number; y: number; panX: number; panY: number } | null
  >(null)
  const [live, setLive] = useState<CropRect>(rect)
  /*
   * 缩放与平移：选框坐标始终是**图片归一化坐标**，
   * 放大只是把"图片 + 选框"这一整块（.xcover-plane）一起放大再平移，
   * 所以放大之后拖选框的换算只需除以 zoom，不用重算任何几何。
   */
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })

  useEffect(() => {
    setLive(rect)
  }, [rect])

  const scale = Math.min(
    STAGE_MAX_W / Math.max(1, width),
    maxStageHeight() / Math.max(1, height),
    MAX_UPSCALE
  )
  const dispW = Math.max(1, Math.round(width * scale))
  const dispH = Math.max(1, Math.round(height * scale))

  /** 平移量必须夹住，否则能把图拖出视口、只剩一片空白 */
  const clampPan = useCallback(
    (x: number, y: number, z: number): { x: number; y: number } => ({
      x: Math.max(0, Math.min(x, dispW * z - dispW)),
      y: Math.max(0, Math.min(y, dispH * z - dispH))
    }),
    [dispW, dispH]
  )

  /** 以某个视口坐标为不动点改缩放 */
  const zoomAt = useCallback(
    (nextZoom: number, clientX: number, clientY: number): void => {
      const node = stageRef.current
      if (!node) return
      const box = node.getBoundingClientRect()
      const z = Math.max(1, Math.min(MAX_ZOOM, nextZoom))
      if (z === zoom) return
      const localX = clientX - box.left
      const localY = clientY - box.top
      // 光标下的图片位置（放大前后要落在同一处）
      const imageX = (localX + pan.x) / (dispW * zoom)
      const imageY = (localY + pan.y) / (dispH * zoom)
      setZoom(z)
      setPan(clampPan(imageX * dispW * z - localX, imageY * dispH * z - localY, z))
    },
    [clampPan, dispW, dispH, pan.x, pan.y, zoom]
  )

  const resetZoom = useCallback((): void => {
    setZoom(1)
    setPan({ x: 0, y: 0 })
  }, [])

  /** 按钮缩放：以舞台中心为不动点 */
  const zoomByButton = useCallback(
    (factor: number): void => {
      const box = stageRef.current?.getBoundingClientRect()
      zoomAt(zoom * factor, box ? box.left + box.width / 2 : 0, box ? box.top + box.height / 2 : 0)
    },
    [zoom, zoomAt]
  )

  /*
   * 滚轮缩放用原生监听而不是 React 的 onWheel。
   * React 把 wheel 注册成**被动**监听，里面的 preventDefault() 不生效 ——
   * 那样滚轮既缩放又滚动弹窗内容，手感是坏的。这里显式 passive: false。
   */
  useEffect(() => {
    const node = stageRef.current
    if (!node) return
    const onWheel = (event: WheelEvent): void => {
      event.preventDefault()
      const factor = event.deltaY < 0 ? 1.18 : 1 / 1.18
      zoomAt(zoomRef.current * factor, event.clientX, event.clientY)
    }
    node.addEventListener('wheel', onWheel, { passive: false })
    return () => node.removeEventListener('wheel', onWheel)
  }, [zoomAt])

  /** zoomAt 要读最新 zoom，但它自身的依赖里有 zoom —— 用 ref 打断这个循环 */
  const zoomRef = useRef(zoom)
  zoomRef.current = zoom

  /**
   * 由「拖动起点 + 当前指针」算新选框。
   *
   * drag 是**参数**而不是从 dragRef 里读：早先的写法让 compute() 自己去看
   * dragRef.current，结果 onPointerUp 里一旦先清空 ref（或将来有人调整顺序），
   * 就算不出结果、松手不提交 —— 表现是"框能拖，但确认裁剪出来还是整张图"。
   * 现在起点由调用方传进来，顺序写错也不会再犯这个错。
   */
  const compute = (
    drag: { handle: CropHandle; x: number; y: number; rect: CropRect },
    clientX: number,
    clientY: number
  ): CropRect | null => {
    const node = stageRef.current
    if (!node) return null
    const box = node.getBoundingClientRect()
    if (box.width < 2 || box.height < 2) return null
    // 除以 zoom：选框跟着图片一起被放大了，同样的鼠标位移在图片坐标里更小
    const dx = (clientX - drag.x) / (box.width * zoom)
    const dy = (clientY - drag.y) / (box.height * zoom)
    return resizeCrop(drag.rect, aspect, drag.handle, dx, dy)
  }

  return (
    <div className="xcover-stage-wrap">
      <div className="xcover-stage-col">
        <div
          className="xcover-stage"
          ref={stageRef}
          style={{ width: dispW, height: dispH }}
          onPointerDown={(event) => {
            /*
             * 在选框外面按下 = 平移画面。
             * 放大之后选框常常盖住大半个视口，得留出能拖图的地方，
             * 所以这个处理放在舞台（选框和把手会 stopPropagation，够不到这里）。
             */
            if (zoom <= 1) return
            event.preventDefault()
            dragRef.current = { kind: 'pan', x: event.clientX, y: event.clientY, panX: pan.x, panY: pan.y }
            try {
              stageRef.current?.setPointerCapture(event.pointerId)
            } catch {
              // 拿不到指针捕获也能拖，只是拖出画面会中断
            }
          }}
          onPointerMove={(event) => {
            const drag = dragRef.current
            if (drag?.kind === 'pan') {
              const box = stageRef.current?.getBoundingClientRect()
              if (!box) return
              setPan(clampPan(drag.panX - (event.clientX - drag.x), drag.panY - (event.clientY - drag.y), zoom))
              return
            }
            if (drag?.kind !== 'rect') return
            const next = compute(drag, event.clientX, event.clientY)
            if (next) setLive(next)
          }}
          onPointerUp={(event) => {
            const drag = dragRef.current
            if (!drag) return
            dragRef.current = null
            try {
              event.currentTarget.releasePointerCapture(event.pointerId)
            } catch {
              // 指针早就没了，忽略
            }
            if (drag.kind !== 'rect') return
            // 松手即提交（最后再算一次，位置以松开的那一刻为准）
            const next = compute(drag, event.clientX, event.clientY)
            if (next) {
              setLive(next)
              onChange(next)
            }
          }}
          onPointerCancel={() => {
            if (dragRef.current?.kind === 'rect') setLive(rect)
            dragRef.current = null
          }}
        >
          {/* 图片与选框一起缩放、一起平移：两者始终对齐 */}
          <div
            className="xcover-plane"
            style={{
              width: dispW * zoom,
              height: dispH * zoom,
              transform: `translate(${-pan.x}px, ${-pan.y}px)`,
              ['--span' as string]: `${Math.max(1, live.w * dispW * zoom)}px`
            }}
          >
            <img className="xcover-stage-img" src={url} alt="" draggable={false} />
            <div
              className="xcover-box"
              style={{
                left: `${live.x * 100}%`,
                top: `${live.y * 100}%`,
                width: `${live.w * 100}%`,
                height: `${live.h * 100}%`
              }}
              onPointerDown={(event) => {
                event.preventDefault()
                event.stopPropagation()
                dragRef.current = { kind: 'rect', handle: 'move', x: event.clientX, y: event.clientY, rect: live }
                try {
                  stageRef.current?.setPointerCapture(event.pointerId)
                } catch {
                  // 拿不到指针捕获也能拖，只是拖出画面会中断
                }
              }}
            >
              {HANDLES.map((handle) => (
                <span
                  key={handle}
                  className={`xcover-handle is-${handle}`}
                  onPointerDown={(event) => {
                    event.preventDefault()
                    event.stopPropagation()
                    dragRef.current = { kind: 'rect', handle, x: event.clientX, y: event.clientY, rect: live }
                    try {
                      stageRef.current?.setPointerCapture(event.pointerId)
                    } catch {
                      // 同上
                    }
                  }}
                />
              ))}
            </div>
          </div>
        </div>

        <div className="xcover-zoom">
          <IconButton label="缩小" onClick={() => zoomByButton(1 / 1.4)} disabled={zoom <= 1}>
            <IconMinus size={14} />
          </IconButton>
          <span className="xcover-zoom-value" title="滚轮也能缩放（以鼠标位置为中心）">
            {Math.round(zoom * 100)}%
          </span>
          <IconButton label="放大" onClick={() => zoomByButton(1.4)} disabled={zoom >= MAX_ZOOM}>
            <IconPlus size={14} />
          </IconButton>
          <Button variant="ghost" size="xs" onClick={resetZoom} disabled={zoom <= 1}>
            适应
          </Button>
          <span className="xcover-zoom-hint">
            滚轮缩放，放大后在选框外拖动可移动画面 · 原图 {width}×{height}
          </span>
        </div>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ 小工具 */

/** 取 blob 地址背后的原始字节；地址一定是我们自己 createObjectURL 出来的 */
async function fetchBlob(url: string): Promise<Blob> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`读取失败（HTTP ${response.status}）`)
  return response.blob()
}
