import { useEffect, useState, type ReactNode } from 'react'
import type { Book, BookFormat } from '@shared/types'
import { FORMAT_LABEL } from '@shared/types'
import { appApi } from '@/lib/api'
import { formatBytes, formatDate, formatPages, formatWords } from '@/lib/format'
import { Button, EmptyState, Spinner } from '@/components/common/Controls'
import { IconExternalLink, IconFolder, IconInfo, IconRefresh } from '@/components/icons/Icons'
import { loadDoc, loadDocx, loadImage, loadRtf, loadUnknown, type LoadedContent } from './lib/readers'
import { HtmlNoteView } from './HtmlNoteView'
import { useBookmarkTarget } from '@/lib/bookmarkTarget'
import { goToScrollAnchor, ratioOf, scrollAnchor } from '@/lib/scrollAnchor'

interface Props {
  book: Book
}

/** 只读渲染：docx / doc / rtf / html / image 与未知格式都走这里 */
export function ReadOnlyPane({ book }: Props): ReactNode {
  const format: BookFormat = book.format
  const [state, setState] = useState<LoadedContent | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [nonce, setNonce] = useState(0)

  /*
   * 书签：这些格式没有可靠页码，只能记滚动比例。
   * 容器是页面上唯一那个滚动区，所以按类名现取即可（同一次只会挂一个阅读器）。
   */
  useBookmarkTarget({
    anchor: () => scrollAnchor(document.querySelector<HTMLElement>('.bs-preview-scroll, .bs-image-scroll')),
    goTo: (anchor) => goToScrollAnchor(document.querySelector<HTMLElement>('.bs-preview-scroll, .bs-image-scroll'), anchor),
    describe: () => {
      const ratio = ratioOf(document.querySelector<HTMLElement>('.bs-preview-scroll, .bs-image-scroll')) ?? 0
      const percent = Math.round(ratio * 100)
      return {
        page: Math.max(1, Math.round(ratio * Math.max(1, book.pageCount))),
        label: percent > 0 ? `${FORMAT_LABEL[format]} · 第 ${percent}% 处` : FORMAT_LABEL[format],
        excerpt: book.title
      }
    }
  })

  // HTML 笔记整页交给独立来源的 iframe，不走"净化后注入 DOM"这条路
  const isHtml = format === 'html'

  useEffect(() => {
    if (isHtml) return
    let cancelled = false
    setLoading(true)
    setError(null)
    setState(null)

    const run = async (): Promise<void> => {
      try {
        let content: LoadedContent
        switch (format) {
          case 'docx':
            content = await loadDocx(book.path)
            break
          case 'doc':
            content = await loadDoc(book.path)
            break
          case 'rtf':
            content = await loadRtf(book.path)
            break
          case 'image':
            content = await loadImage(book.path)
            break
          default:
            content = await loadUnknown(book.path)
        }
        if (cancelled) return
        setState(content)
      } catch (err) {
        if (cancelled) return
        setError((err as Error).message)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void run()
    return () => {
      cancelled = true
    }
  }, [book.path, format, nonce, isHtml])

  if (isHtml) return <HtmlNoteView book={book} />

  if (loading) {
    return (
      <div className="bs-ro-center">
        <Spinner size={22} />
        <p className="muted">正在准备预览…</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="bs-ro-center">
        <EmptyState
          icon={<IconInfo size={22} />}
          title="预览失败"
          detail={error}
          action={
            <Button variant="outline" icon={<IconRefresh size={14} />} onClick={() => setNonce((n) => n + 1)}>
              重试
            </Button>
          }
        />
      </div>
    )
  }

  if (!state) return null

  if (state.kind === 'image') {
    return (
      <div className="bs-image-scroll">
        <figure className="bs-image-paper">
          <img src={state.src} alt={book.title} />
          <figcaption>{book.title}</figcaption>
        </figure>
      </div>
    )
  }
  if (state.kind === 'unsupported') {
    return <FileInfoCard book={book} reason={state.reason} />
  }

  return (
    <div className="bs-preview-scroll">
      <article className="bs-prose is-readonly" dangerouslySetInnerHTML={{ __html: state.html }} />
      {state.warnings.length > 0 ? (
        <details className="bs-warnings">
          <summary>
            <IconInfo size={13} />
            转换提示 {state.warnings.length} 条
          </summary>
          <ul>
            {state.warnings.map((message, index) => (
              <li key={index}>{message}</li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  )
}

/** 读不出内容时的兜底信息卡 */
export function FileInfoCard({ book, reason }: { book: Book; reason: string }): ReactNode {
  const rows: { label: string; value: string }[] = [
    { label: '格式', value: FORMAT_LABEL[book.format] },
    { label: '大小', value: formatBytes(book.size) },
    { label: '页数', value: formatPages(book.pageCount, book.pageCountExact) },
    { label: '字数', value: formatWords(book.words) },
    { label: '更新', value: formatDate(book.updatedAt) },
    { label: '路径', value: book.path }
  ]

  return (
    <div className="bs-ro-center">
      <div className="bs-info-card">
        <div className="bs-info-icon">
          <IconInfo size={20} />
        </div>
        <h3 className="bs-info-title">{book.title}</h3>
        <p className="bs-info-detail">{reason}</p>
        <dl className="bs-info-rows">
          {rows.map((row) => (
            <div key={row.label} className="bs-info-row">
              <dt>{row.label}</dt>
              <dd title={row.value}>{row.value}</dd>
            </div>
          ))}
        </dl>
        <div className="bs-info-actions">
          <Button variant="solid" icon={<IconExternalLink size={14} />} onClick={() => void appApi.openPath(book.path)}>
            用系统应用打开
          </Button>
          <Button variant="outline" icon={<IconFolder size={14} />} onClick={() => void appApi.revealPath(book.path)}>
            打开所在文件夹
          </Button>
        </div>
      </div>
    </div>
  )
}
