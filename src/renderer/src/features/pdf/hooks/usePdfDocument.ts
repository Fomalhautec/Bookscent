/**
 * 文档加载状态机。
 *
 * 关键点：
 *  - pdfjs 会把传入的 Uint8Array 转交给 worker 并「中立化」原缓冲，
 *    所以这里先复制一份给 pdfjs，原始字节留在 rawBytes 里供导出批注使用；
 *  - book.id 变化或组件卸载时必须 destroy，否则 worker 会越积越多。
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { Book } from '@shared/types'
import { filesApi } from '@/lib/api'
import { destroyPdf, loadPdf, PdfLoadError, type PDFDocumentLoadingTask, type PDFDocumentProxy } from '../lib/engine'
import { useUi } from '@/store/useUi'

export type PdfStatus = 'idle' | 'loading' | 'ready' | 'error'

export interface PdfDocumentState {
  status: PdfStatus
  doc: PDFDocumentProxy | null
  pageCount: number
  /** 原始文件字节，用于「导出批注 PDF」；pdfjs 拿到的是它的副本 */
  rawBytes: Uint8Array | null
  error: string | null
  errorKind: PdfLoadError['kind'] | null
  reload: () => void
}

export function usePdfDocument(book: Book): PdfDocumentState {
  const [status, setStatus] = useState<PdfStatus>('loading')
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null)
  const [pageCount, setPageCount] = useState(0)
  const [rawBytes, setRawBytes] = useState<Uint8Array | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [errorKind, setErrorKind] = useState<PdfLoadError['kind'] | null>(null)
  const [nonce, setNonce] = useState(0)
  const taskRef = useRef<PDFDocumentLoadingTask | null>(null)

  useEffect(() => {
    let disposed = false
    setStatus('loading')
    setError(null)
    setErrorKind(null)
    setDoc(null)
    setPageCount(0)
    setRawBytes(null)

    const run = async (): Promise<void> => {
      try {
        const exists = await filesApi.exists(book.path)
        if (!exists) throw new PdfLoadError('missing', '文件不在原来的位置了，可能被移动或删除。')
        const bytes = await filesApi.readBinary(book.path)
        if (disposed) return
        if (!bytes || bytes.byteLength === 0) {
          throw new PdfLoadError('invalid', '文件是空的。')
        }
        setRawBytes(bytes)
        // slice 出独立副本：pdfjs 会接管并中立化这份缓冲
        const loaded = await loadPdf(bytes.slice())
        if (disposed) {
          await destroyPdf(loaded.task)
          return
        }
        taskRef.current = loaded.task
        setDoc(loaded.doc)
        setPageCount(loaded.pageCount)
        setStatus('ready')
      } catch (err) {
        if (disposed) return
        const failure = err instanceof PdfLoadError ? err : new PdfLoadError('unknown', (err as Error).message)
        setError(failure.message)
        setErrorKind(failure.kind)
        setStatus('error')
        useUi.getState().toast('PDF 打开失败', 'error', failure.message)
      }
    }

    void run()

    return () => {
      disposed = true
      const current = taskRef.current
      taskRef.current = null
      void destroyPdf(current)
    }
  }, [book.id, book.path, nonce])

  const reload = useCallback(() => setNonce((n) => n + 1), [])

  return { status, doc, pageCount, rawBytes, error, errorKind, reload }
}
