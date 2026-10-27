/**
 * 图片提取弹窗 —— 两种模式：
 *   1. 页面导出：把整页栅格化，可选当前页 / 全部页 / 自定义页码范围，1×–4×，PNG 或 JPEG（带质量）
 *   2. 内嵌图片提取：走 getOperatorList() 找 paintImageXObject，按原生尺寸导出 PNG
 *
 * 完成后给一句总结，并提供「打开文件夹」。
 */

import { useMemo, useState, type ReactNode } from 'react'
import type { ExtractImagesOptions } from '@shared/types'
import { Button, Field, Modal, ProgressBar, Select, Slider, TextInput } from '@/components/common/Controls'
import { IconFolderOpen, IconImageExtract } from '@/components/icons/Icons'
import { appApi, filesApi } from '@/lib/api'
import { useUi } from '@/store/useUi'
import type { PDFDocumentProxy } from '../lib/engine'
import { exportPages, extractEmbeddedImages, parsePageRange } from '../lib/extract'
import { safeFileName } from '@/lib/format'

type Mode = 'page' | 'embedded'
type PageScope = 'current' | 'all' | 'custom'

export interface ExtractImagesModalProps {
  open: boolean
  onClose: () => void
  doc: PDFDocumentProxy | null
  pageCount: number
  currentPage: number
  bookTitle: string
}

interface ResultSummary {
  dir: string
  count: number
  notes: string[]
}

export function ExtractImagesModal({
  open,
  onClose,
  doc,
  pageCount,
  currentPage,
  bookTitle
}: ExtractImagesModalProps): ReactNode {
  const [mode, setMode] = useState<Mode>('page')
  const [scope, setScope] = useState<PageScope>('current')
  const [rangeText, setRangeText] = useState('')
  const [scale, setScale] = useState(2)
  const [imageType, setImageType] = useState<'png' | 'jpeg'>('png')
  const [quality, setQuality] = useState(92)
  const [dir, setDir] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [result, setResult] = useState<ResultSummary | null>(null)

  const prefix = useMemo(() => safeFileName(bookTitle, 'PDF'), [bookTitle])

  const parsedRange = useMemo(() => parsePageRange(rangeText, pageCount), [rangeText, pageCount])

  const targetPages = useMemo<number[]>(() => {
    if (scope === 'current') return [currentPage]
    if (scope === 'all') return Array.from({ length: pageCount }, (_, i) => i + 1)
    return parsedRange.pages
  }, [scope, currentPage, pageCount, parsedRange.pages])

  const reset = (): void => {
    setBusy(false)
    setProgress(null)
    setResult(null)
  }

  const chooseDir = async (): Promise<void> => {
    try {
      const picked = await filesApi.chooseDirectory('选择图片保存位置')
      if (picked) setDir(picked)
    } catch (error) {
      useUi.getState().toast('选择文件夹失败', 'error', (error as Error).message)
    }
  }

  const run = async (): Promise<void> => {
    if (!doc) return
    if (mode === 'page' && targetPages.length === 0) {
      useUi.getState().toast('请先指定要导出的页码', 'warn')
      return
    }
    setBusy(true)
    setResult(null)
    setProgress(null)

    try {
      let payload: { name: string; data: Uint8Array }[] = []
      const notes: string[] = []

      if (mode === 'page') {
        const exported = await exportPages(
          doc,
          { pages: targetPages, scale, imageType, quality: quality / 100, prefix },
          (done, total) => setProgress({ done, total })
        )
        payload = exported.files
        notes.push(...exported.notes)
      } else {
        const report = await extractEmbeddedImages(doc, prefix, (done, total) => setProgress({ done, total }))
        payload = report.images.map((image) => image.file)
        notes.push(`共发现 ${report.found} 个图片对象`)
        notes.push(...report.notes)
      }

      if (payload.length === 0) {
        setBusy(false)
        setProgress(null)
        useUi.getState().toast('没有可导出的图片', 'warn', notes.join('；') || undefined)
        return
      }

      const options: ExtractImagesOptions = {
        dir,
        mode,
        pages: mode === 'page' ? targetPages : undefined,
        scale: mode === 'page' ? scale : undefined,
        imageType: mode === 'page' ? imageType : 'png',
        prefix
      }
      const saved = await filesApi.saveImages(options, payload)
      setBusy(false)
      setProgress(null)
      if (saved.cancelled) {
        useUi.getState().toast('已取消保存', 'info')
        return
      }
      setResult({ dir: saved.dir, count: saved.files.length, notes })
      useUi
        .getState()
        .toast(
          `已导出 ${saved.files.length} 个文件到 ${saved.dir}`,
          'success',
          notes.length > 0 ? notes.join('；') : undefined
        )
    } catch (error) {
      setBusy(false)
      setProgress(null)
      useUi.getState().toast('图片导出失败', 'error', (error as Error).message)
    }
  }

  return (
    <Modal
      open={open}
      title="提取图片"
      subtitle="把页面或文档里的内嵌图片导出成独立文件"
      width={620}
      onClose={() => {
        if (busy) return
        reset()
        onClose()
      }}
      footer={
        result ? (
          <>
            <Button size="sm" variant="ghost" onClick={reset}>
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
            <Button size="sm" variant="solid" disabled={busy || !doc} onClick={() => void run()}>
              {busy ? '正在导出…' : '开始导出'}
            </Button>
          </>
        )
      }
    >
      <div className="pdf-extract">
        <div className="segmented pdf-extract-mode">
          <button
            type="button"
            className={['segmented-item', mode === 'page' ? 'is-active' : ''].filter(Boolean).join(' ')}
            onClick={() => setMode('page')}
          >
            页面导出
          </button>
          <button
            type="button"
            className={['segmented-item', mode === 'embedded' ? 'is-active' : ''].filter(Boolean).join(' ')}
            onClick={() => setMode('embedded')}
          >
            内嵌图片提取
          </button>
        </div>

        {mode === 'page' ? (
          <>
            <Field label="导出范围">
              <div className="segmented">
                {(
                  [
                    ['current', `当前页（第 ${currentPage} 页）`],
                    ['all', `全部页（共 ${pageCount} 页）`],
                    ['custom', '自定义页码范围']
                  ] as [PageScope, string][]
                ).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    className={['segmented-item', scope === value ? 'is-active' : ''].filter(Boolean).join(' ')}
                    onClick={() => setScope(value)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </Field>

            {scope === 'custom' ? (
              <Field
                label="页码范围"
                hint={
                  parsedRange.invalid.length > 0
                    ? `忽略了无法识别的片段：${parsedRange.invalid.join('、')}`
                    : `将导出 ${targetPages.length} 页，例如 1-5, 8, 12`
                }
              >
                <TextInput
                  value={rangeText}
                  placeholder="1-5, 8, 12-14"
                  onChange={(event) => setRangeText(event.target.value)}
                />
              </Field>
            ) : null}

            <div className="pdf-extract-row">
              <Field label="渲染倍率">
                <Slider
                  value={scale}
                  min={1}
                  max={4}
                  step={0.5}
                  onChange={setScale}
                  format={(value) => `${value}×`}
                />
              </Field>
              <Field label="图片格式">
                <Select
                  value={imageType}
                  onChange={(value) => setImageType(value as 'png' | 'jpeg')}
                  options={[
                    { value: 'png', label: 'PNG（无损，体积大）' },
                    { value: 'jpeg', label: 'JPEG（有损，体积小）' }
                  ]}
                />
              </Field>
            </div>

            {imageType === 'jpeg' ? (
              <Field label="JPEG 质量">
                <Slider
                  value={quality}
                  min={40}
                  max={100}
                  step={1}
                  onChange={setQuality}
                  format={(value) => `${value}%`}
                />
              </Field>
            ) : null}
          </>
        ) : (
          <div className="pdf-extract-note">
            <IconImageExtract size={18} />
            <p>
              会遍历每一页的绘图指令，取出其中的位图对象并按原生尺寸导出 PNG。
              重复出现的图片只导一次，小于 32 像素的图标与蒙版会被跳过。
            </p>
          </div>
        )}

        <Field label="保存位置" hint={dir ?? '不选择则导出时弹出系统文件夹选择框'}>
          <div className="pdf-extract-dir">
            <TextInput value={dir ?? ''} readOnly placeholder="（导出时询问）" />
            <Button size="sm" variant="outline" onClick={() => void chooseDir()}>
              选择文件夹
            </Button>
          </div>
        </Field>

        {busy ? (
          <div className="pdf-extract-progress">
            <ProgressBar value={progress?.done ?? 0} max={progress?.total ?? 1} />
            <span className="muted tabular">
              {progress ? `${progress.done} / ${progress.total}` : '正在准备…'}
            </span>
          </div>
        ) : null}

        {result ? (
          <div className="pdf-extract-result">
            <p className="pdf-extract-result-title">已导出 {result.count} 个文件</p>
            <p className="muted pdf-extract-result-dir" title={result.dir}>
              {result.dir}
            </p>
            {result.notes.length > 0 ? (
              <ul className="pdf-extract-notes">
                {result.notes.map((note, index) => (
                  <li key={index}>{note}</li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </div>
    </Modal>
  )
}
