import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Book } from '@shared/types'
import { noteUrlFor } from '@shared/noteUrl'
import type { HtmlAssetReport } from '@shared/ipc'
import { appApi, dialogApi, filesApi } from '@/lib/api'
import { useLibrary } from '@/store/useLibrary'
import { useUi } from '@/store/useUi'
import { Button, IconButton, Tooltip } from '@/components/common/Controls'
import {
  IconExternalLink,
  IconFolder,
  IconInfo,
  IconMinus,
  IconPlus,
  IconRefresh,
  IconFitWidth,
  IconLock,
  IconTrash
} from '@/components/icons/Icons'

const ZOOM_STEPS = [0.5, 0.67, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2]

/**
 * HTML 笔记阅读器。
 *
 * 为什么用 iframe 而不是"净化后注入 DOM"：
 * DSH 这类工具生成的笔记是**自包含的交互式页面**（内联 CSS/JS，常引用同目录的
 * .js/.css）。注入 DOM 会丢掉脚本、也会让相对路径失效。
 *
 * 所以这里让它以 `note://` 独立来源整页加载：
 *  - 相对资源按原路径解析，样式与脚本都按原样生效；
 *  - 与 `app://bundle` 不同源，笔记脚本碰不到 window.bookscent；
 *  - sandbox 里不放 allow-top-navigation，笔记无法把我们的窗口导航走。
 */
export function HtmlNoteView({ book }: { book: Book }): ReactNode {
  const [nonce, setNonce] = useState(0)
  const [zoom, setZoom] = useState(1)
  const [status, setStatus] = useState<'loading' | 'ready' | 'failed'>('loading')
  const [assets, setAssets] = useState<HtmlAssetReport | null>(null)
  const [fileMissing, setFileMissing] = useState(false)
  const frameWrap = useRef<HTMLDivElement | null>(null)
  const [frameSize, setFrameSize] = useState({ width: 0, height: 0 })

  const src = useMemo(() => noteUrlFor(book.id, book.path), [book.id, book.path])
  const removeBooks = useLibrary((s) => s.removeBooks)
  const select = useLibrary((s) => s.select)
  const toast = useUi((s) => s.toast)

  const handleRemoveRecord = async (): Promise<void> => {
    const response = await dialogApi.confirm({
      title: '移除记录',
      message: '文件已经不在原位置了，要把这条书架记录移除吗？',
      detail: '只会移除书架记录，不会删除任何文件。',
      buttons: ['取消', '移除'],
      defaultId: 0,
      cancelId: 0,
      type: 'question'
    })
    if (response !== 1) return
    await removeBooks([book.id], false)
    select(null)
    toast('已从书架移除', 'success')
  }

  // 换算缩放：iframe 按 1/zoom 的"逻辑尺寸"布局，再整体放大，等价于页面缩放
  useEffect(() => {
    const node = frameWrap.current
    if (!node) return
    const observer = new ResizeObserver(() => {
      setFrameSize({ width: node.clientWidth, height: node.clientHeight })
    })
    observer.observe(node)
    setFrameSize({ width: node.clientWidth, height: node.clientHeight })
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    let cancelled = false
    setStatus('loading')
    setAssets(null)
    void (async () => {
      const exists = await filesApi.exists(book.path).catch(() => false)
      if (cancelled) return
      setFileMissing(!exists)
      if (!exists) {
        setStatus('failed')
        return
      }
      const report = await filesApi.checkHtmlAssets(book.path).catch(() => null)
      if (!cancelled) setAssets(report)
    })()
    return () => {
      cancelled = true
    }
  }, [book.path, nonce])

  const missingCount = assets?.missing.length ?? 0
  const zoomIn = (): void => {
    setZoom((current) => ZOOM_STEPS.find((step) => step > current + 0.001) ?? current)
  }
  const zoomOut = (): void => {
    setZoom((current) => [...ZOOM_STEPS].reverse().find((step) => step < current - 0.001) ?? current)
  }

  return (
    <div className="bs-html">
      <div className="bs-html-bar">
        <span className="bs-html-badge">
          <IconLock size={12} />
          独立来源加载
        </span>
        <span className="bs-html-hint" title={book.path}>
          {assets
            ? assets.referenced > 0
              ? `引用同级资源 ${assets.referenced} 个${missingCount ? `，缺失 ${missingCount} 个` : '，全部就绪'}`
              : '自包含页面'
            : '正在检查资源…'}
        </span>

        {missingCount > 0 ? (
          <Tooltip label={assets?.missing.slice(0, 8).join('\n') ?? ''}>
            <span className="bs-html-warn">
              <IconInfo size={13} />
              缺失 {missingCount} 个同级文件
            </span>
          </Tooltip>
        ) : null}

        <span className="bs-html-grow" />

        <div className="bs-html-zoom">
          <IconButton label="缩小" onClick={zoomOut} disabled={zoom <= ZOOM_STEPS[0]}>
            <IconMinus size={14} />
          </IconButton>
          <button type="button" className="bs-html-zoom-value" onClick={() => setZoom(1)} title="点击还原为 100%">
            {Math.round(zoom * 100)}%
          </button>
          <IconButton label="放大" onClick={zoomIn} disabled={zoom >= ZOOM_STEPS[ZOOM_STEPS.length - 1]}>
            <IconPlus size={14} />
          </IconButton>
          <IconButton label="适应宽度" onClick={() => setZoom(1)} active={zoom === 1}>
            <IconFitWidth size={14} />
          </IconButton>
        </div>

        <Button icon={<IconRefresh size={14} />} onClick={() => setNonce((n) => n + 1)}>
          重新载入
        </Button>
        <IconButton label="打开所在文件夹" onClick={() => void appApi.revealPath(book.path)}>
          <IconFolder size={15} />
        </IconButton>
        <Button
          variant="outline"
          icon={<IconExternalLink size={14} />}
          onClick={() => void appApi.openPath(book.path)}
        >
          用浏览器打开
        </Button>
      </div>

      {missingCount > 0 ? (
        <div className="bs-html-missing">
          这个 HTML 引用了同目录（或子目录）的文件，但它们在磁盘上不存在，页面可能缺样式或缺数据：
          <ul>
            {assets?.missing.slice(0, 6).map((item) => (
              <li key={item}>
                <code>{item}</code>
              </li>
            ))}
            {missingCount > 6 ? <li>…还有 {missingCount - 6} 个</li> : null}
          </ul>
          <p>
            如果是从别处「导入并复制」进来的，可以用右键菜单里的<strong>「引用外部文件（不复制）」</strong>
            改用原位置，或者把同级文件一起放进藏书目录。
          </p>
        </div>
      ) : null}

      <div className="bs-html-stage" ref={frameWrap}>
        {fileMissing ? (
          <div className="bs-html-error">
            <IconInfo size={22} />
            <h3>文件不在了</h3>
            <p className="mono">{book.path}</p>
            <div className="bs-html-error-actions">
              <Button variant="outline" icon={<IconRefresh size={14} />} onClick={() => setNonce((n) => n + 1)}>
                重试
              </Button>
              <Button variant="danger" icon={<IconTrash size={14} />} onClick={() => void handleRemoveRecord()}>
                从书架移除记录
              </Button>
            </div>
          </div>
        ) : (
          <iframe
            key={`${nonce}-${src}`}
            className="bs-html-frame"
            title={book.title}
            src={src}
            sandbox="allow-scripts allow-same-origin allow-forms allow-modals allow-downloads allow-popups"
            referrerPolicy="no-referrer"
            onLoad={() => setStatus('ready')}
            onError={() => setStatus('failed')}
            style={
              frameSize.width > 0
                ? {
                    width: frameSize.width / zoom,
                    height: frameSize.height / zoom,
                    transform: `scale(${zoom})`,
                    transformOrigin: '0 0'
                  }
                : undefined
            }
          />
        )}

        {status === 'loading' && !fileMissing ? (
          <div className="bs-html-loading">
            <span className="spinner" />
            <span>正在载入笔记…</span>
          </div>
        ) : null}

        {status === 'failed' && !fileMissing ? (
          <div className="bs-html-error">
            <IconInfo size={22} />
            <h3>这个 HTML 没能载入</h3>
            <p>可能是文件被移动、加密，或者内容不是有效的 HTML。</p>
            <div className="bs-html-error-actions">
              <Button variant="outline" icon={<IconRefresh size={14} />} onClick={() => setNonce((n) => n + 1)}>
                重试
              </Button>
              <Button
                variant="solid"
                icon={<IconExternalLink size={14} />}
                onClick={() => void appApi.openPath(book.path)}
              >
                用浏览器打开
              </Button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}
