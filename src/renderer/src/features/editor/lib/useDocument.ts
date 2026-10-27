import { useCallback, useEffect, useRef, useState } from 'react'
import type { Book } from '@shared/types'
import { filesApi, libraryApi } from '@/lib/api'
import { useSettings } from '@/store/useSettings'
import { useUi } from '@/store/useUi'
import { computeStats, isEditable } from './doc'
import type { BookFormat } from '@shared/types'

export interface ConflictState {
  mtimeMs: number
  detectedAt: number
}

export interface DocumentState {
  /** 编辑器当前文本（也是最近一次保存的内容） */
  text: string
  loaded: boolean
  dirty: boolean
  saving: boolean
  savedAt: number | null
  loadError: string | null
  readOnly: boolean
  size: number
  conflict: ConflictState | null
  reloadToken: number
  save: () => Promise<void>
  reload: () => Promise<void>
  discardChanges: () => Promise<void>
  /** 编辑区内容变化（同时维护脏标记） */
  updateText: (next: string) => void
}

/** 文件名（不含目录），用于状态栏与报错信息 */
export function fileNameOf(path: string): string {
  const parts = path.split(/[\\/]/)
  return parts[parts.length - 1] || path
}

export function useDocument(book: Book, format: BookFormat): DocumentState {
  const editable = isEditable(format) && !book.missing
  const toast = useUi((s) => s.toast)
  const autosaveEnabled = useSettings((s) => s.settings?.ui.autosave ?? false)
  const autosaveDelay = useSettings((s) => s.settings?.ui.autosaveDelay ?? 1500)

  const [text, setText] = useState('')
  const [loadedText, setLoadedText] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [size, setSize] = useState(book.size)
  const [conflict, setConflict] = useState<ConflictState | null>(null)
  const [reloadToken, setReloadToken] = useState(0)

  const textRef = useRef('')
  const loadedRef = useRef('')
  const mtimeRef = useRef<number | null>(null)
  const savingRef = useRef(false)

  const setCurrent = useCallback((next: string, baseline: string): void => {
    textRef.current = next
    loadedRef.current = baseline
    setText(next)
    setLoadedText(baseline)
    setDirty(next !== baseline)
  }, [])

  /* ------------------------------------------------------------ 载入 */

  const load = useCallback(
    async (options: { silent?: boolean } = {}): Promise<boolean> => {
      if (!editable) {
        setLoaded(true)
        return false
      }
      try {
        const [content, stat] = await Promise.all([filesApi.readText(book.path), filesApi.stat(book.path)])
        mtimeRef.current = stat.mtimeMs
        setSize(stat.size)
        setCurrent(content, content)
        setLoaded(true)
        setLoadError(null)
        setConflict(null)
        setReloadToken((n) => n + 1)
        if (options.silent) toast('文件已在外部更新，已重新载入', 'info', fileNameOf(book.path))
        return true
      } catch (error) {
        setLoaded(true)
        setLoadError((error as Error).message)
        toast('打开文件失败', 'error', (error as Error).message)
        return false
      }
    },
    [book.path, editable, setCurrent, toast]
  )

  useEffect(() => {
    setLoaded(false)
    setLoadError(null)
    setConflict(null)
    mtimeRef.current = null
    void load()
    // 只在切书（路径变化）时重新载入
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book.path, editable])

  /* ------------------------------------------------------------ 保存 */

  const save = useCallback(async (): Promise<void> => {
    if (!editable || savingRef.current) return
    const content = textRef.current
    if (content === loadedRef.current) return
    savingRef.current = true
    setSaving(true)
    try {
      const result = await filesApi.writeText(book.path, content)
      mtimeRef.current = result.mtimeMs
      const now = Date.now()
      setCurrent(content, content)
      setSavedAt(now)
      setSize(result.size)
      setConflict(null)

      const stats = computeStats(content)
      const previousWords = book.words ?? 0
      const grew = previousWords <= 0 || Math.abs(stats.words - previousWords) / Math.max(1, previousWords) > 0.1
      if (grew) {
        try {
          const probe = await filesApi.probe(book.path)
          await libraryApi.updateBook(book.id, {
            size: result.size,
            updatedAt: now,
            words: probe.words,
            pageCount: probe.pages,
            pageCountExact: probe.exact,
            probeSize: result.size
          })
        } catch {
          await libraryApi.updateBook(book.id, { size: result.size, updatedAt: now })
        }
      } else {
        await libraryApi.updateBook(book.id, { size: result.size, updatedAt: now })
      }
    } catch (error) {
      toast('保存失败', 'error', (error as Error).message)
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }, [book.id, book.path, book.words, editable, setCurrent, toast])

  /* ---------------------------------------------------------- 自动保存 */

  useEffect(() => {
    if (!editable || !autosaveEnabled || !dirty) return
    const delay = Math.max(400, autosaveDelay || 0)
    const timer = window.setTimeout(() => {
      void save()
    }, delay)
    return () => window.clearTimeout(timer)
  }, [text, dirty, editable, autosaveEnabled, autosaveDelay, save])

  /* ------------------------------------------------- 外部改动检测 */

  useEffect(() => {
    if (!editable) return
    const check = async (): Promise<void> => {
      if (document.visibilityState !== 'visible') return
      const known = mtimeRef.current
      if (known === null) return
      try {
        const stat = await filesApi.stat(book.path)
        if (!stat.exists) {
          toast('原始文件不见了', 'warn', `${fileNameOf(book.path)} 可能被移动或删除`)
          return
        }
        if (stat.mtimeMs === known) return
        if (loadedRef.current === textRef.current) {
          mtimeRef.current = stat.mtimeMs
          const content = await filesApi.readText(book.path)
          setCurrent(content, content)
          setReloadToken((n) => n + 1)
          setSize(stat.size)
          toast('文件已在外部更新，已重新载入', 'info', fileNameOf(book.path))
        } else {
          mtimeRef.current = stat.mtimeMs
          setConflict({ mtimeMs: stat.mtimeMs, detectedAt: Date.now() })
        }
      } catch {
        /* 读不到就下次再说 */
      }
    }
    const onFocus = (): void => {
      void check()
    }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [book.path, editable, setCurrent, toast])

  /* ------------------------------------------------------------ 动作 */

  const reload = useCallback(async (): Promise<void> => {
    setConflict(null)
    await load()
  }, [load])

  const discardChanges = useCallback(async (): Promise<void> => {
    setConflict(null)
    const content = await filesApi.readText(book.path).catch(() => loadedRef.current)
    setCurrent(content, content)
    setReloadToken((n) => n + 1)
  }, [book.path, setCurrent])

  const updateText = useCallback((next: string): void => {
    textRef.current = next
    setText(next)
    setDirty(next !== loadedRef.current)
  }, [])

  return {
    text,
    loaded,
    dirty,
    saving,
    savedAt,
    loadError,
    readOnly: !editable,
    size,
    conflict,
    reloadToken,
    save,
    reload,
    discardChanges,
    updateText
  }
}
