import { useEffect, useImperativeHandle, useRef, type ReactNode, type RefObject } from 'react'
import {
  basicSetup,
  Compartment,
  Decoration,
  EditorState,
  EditorView,
  highlightActiveLine,
  keymap,
  lineNumbers,
  markdown,
  markdownKeymap,
  oneDark,
  StateEffect,
  StateField,
  defaultKeymap
} from './codemirror'
import type { DecorationSet, Text, ViewUpdate } from './codemirror'

export interface EditorStyleOptions {
  fontSize: number
  fontFamily: string
  lineHeight: number
}

export interface MarkdownEditorHandle {
  getView: () => EditorView | null
  getValue: () => string
  scrollToLine: (line: number) => void
}

/* ------------------------------------------------------------ 书签标记 */

/**
 * 书签位置的行装饰：有书签的行下面画一条线（用户要的"下划一定厚度的线"），
 * 跳过来那一行额外闪一下。
 *
 * 为什么用 StateField 而不是 ViewPlugin：装饰要跟着文档变化重映射
 * （在书签行上面插入文字，那条线得跟着往下走），StateField 的 `map(changes)`
 * 天然处理这件事。
 */
const setMarks = StateEffect.define<{ lines: number[]; flash: number | null }>()

interface MarkState {
  lines: number[]
  flash: number | null
  deco: DecorationSet
}

function buildMarks(doc: Text, lines: number[], flash: number | null): DecorationSet {
  const ranges: ReturnType<Decoration['range']>[] = []
  const total = doc.lines
  const seen = new Set<number>()
  for (const line of lines) {
    if (line < 0 || line >= total || seen.has(line)) continue
    seen.add(line)
    ranges.push(Decoration.line({ class: 'cm-bookmark-line' }).range(doc.line(line + 1).from))
  }
  if (flash !== null && flash >= 0 && flash < total && !seen.has(flash)) {
    ranges.push(Decoration.line({ class: 'cm-bookmark-flash' }).range(doc.line(flash + 1).from))
  } else if (flash !== null && flash >= 0 && flash < total) {
    // 既是书签又是刚跳过来的：两个类都要
    ranges.push(Decoration.line({ class: 'cm-bookmark-flash' }).range(doc.line(flash + 1).from))
  }
  return Decoration.set(ranges, true)
}

const markField = StateField.define<MarkState>({
  create: () => ({ lines: [], flash: null, deco: Decoration.none }),
  update(value, tr) {
    const deco = value.deco.map(tr.changes)
    let { lines, flash } = value
    let changed = false
    for (const effect of tr.effects) {
      if (effect.is(setMarks)) {
        lines = effect.value.lines
        flash = effect.value.flash
        changed = true
      }
    }
    if (changed) return { lines, flash, deco: buildMarks(tr.state.doc, lines, flash) }
    return { lines, flash, deco }
  },
  provide: (field) => EditorView.decorations.from(field, (value) => value.deco)
})

export interface MarkdownEditorProps {
  /** 有书签的行（0 基），会在那一行下面画一条线 */
  bookmarkLines?: number[]
  /** 刚从书签跳过来的那一行，闪一下提示"就是这里" */
  flashLine?: number | null
  onFlashDone?: () => void
  /** 初始文档内容；之后由 reloadToken 触发外部灌入 */
  initialValue: string
  /** 每次外部替换文档（首次载入 / 重载 / 保存回写）时递增 */
  reloadToken: number
  style: EditorStyleOptions
  dark: boolean
  editable: boolean
  markdownMode: boolean
  onChange: (value: string) => void
  onCursor: (line: number, column: number) => void
  handleRef?: RefObject<MarkdownEditorHandle | null>
  /** 粘贴进来的图片：返回要插入的 Markdown 片段（null 表示放弃） */
  onPasteImage?: (file: File) => Promise<string | null>
}

/* ------------------------------------------------------ 剪贴板图片 */

function imageFilesFrom(data: DataTransfer | null): File[] {
  const files: File[] = []
  if (!data) return files
  const items = data.items
  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    if (item.kind === 'file' && item.type.startsWith('image/')) {
      const file = item.getAsFile()
      if (file) files.push(file)
    }
  }
  return files
}

/** 有些来源只会把图片塞进 text/plain 的 data URL 里 */
function dataUrlImageFrom(data: DataTransfer | null): string | null {
  const text = data?.getData('text/plain')?.trim() ?? ''
  return /^data:image\/[\w.+-]+;base64,/i.test(text) ? text : null
}

async function fileFromDataUrl(dataUrl: string): Promise<File | null> {
  try {
    const response = await fetch(dataUrl)
    const blob = await response.blob()
    return new File([blob], 'clipboard-image.png', { type: blob.type || 'image/png' })
  } catch {
    return null
  }
}

/** 排版主题：字号 / 字体 / 行高都由设置驱动 */
function styleExtension(style: EditorStyleOptions): ReturnType<typeof EditorView.theme> {
  return EditorView.theme({
    '&': {
      height: '100%',
      fontSize: `${style.fontSize}px`,
      backgroundColor: 'transparent',
      color: 'var(--text-primary)'
    },
    '&.cm-focused': { outline: 'none' },
    '.cm-scroller': {
      fontFamily: style.fontFamily || 'var(--font-sans)',
      fontSize: `${style.fontSize}px`,
      lineHeight: String(style.lineHeight),
      padding: '22px 0 45vh'
    },
    '.cm-content': { caretColor: 'var(--accent)' },
    '.cm-gutters': {
      backgroundColor: 'transparent',
      border: 'none',
      color: 'var(--text-muted)',
      fontFamily: 'var(--font-mono)',
      fontSize: `${Math.max(10, Math.round(style.fontSize * 0.7))}px`
    },
    '.cm-activeLine': { backgroundColor: 'var(--accent-softer)' },
    '.cm-activeLineGutter': { backgroundColor: 'transparent', color: 'var(--accent)' },
    '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--accent)', borderLeftWidth: '2px' },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
      backgroundColor: 'var(--selection)'
    },
    '.cm-panels': {
      backgroundColor: 'var(--bg-elevated)',
      color: 'var(--text-primary)',
      borderColor: 'var(--border)'
    },
    '.cm-tooltip': {
      backgroundColor: 'var(--bg-elevated)',
      border: '1px solid var(--border)',
      borderRadius: 'var(--radius)'
    },
    '.cm-placeholder': { color: 'var(--text-muted)' }
  })
}

function languageExtension(markdownMode: boolean): ReturnType<typeof markdown> | [] {
  return markdownMode ? markdown() : []
}

export function EditorSurface(props: MarkdownEditorProps): ReactNode {
  const host = useRef<HTMLDivElement | null>(null)
  const view = useRef<EditorView | null>(null)
  const themeSlot = useRef(new Compartment()).current
  const styleSlot = useRef(new Compartment()).current
  const editableSlot = useRef(new Compartment()).current
  const languageSlot = useRef(new Compartment()).current
  const markdownKeySlot = useRef(new Compartment()).current

  const latest = useRef(props)
  latest.current = props

  useImperativeHandle(props.handleRef, () => ({
    getView: (): EditorView | null => view.current,
    getValue: (): string => view.current?.state.doc.toString() ?? latest.current.initialValue,
    scrollToLine: (line: number): void => {
      const target = view.current
      if (!target) return
      const clamped = Math.max(1, Math.min(target.state.doc.lines, line))
      target.dispatch({
        effects: EditorView.scrollIntoView(target.state.doc.line(clamped).from, { y: 'start', yMargin: 16 })
      })
    }
  }))

  /* 创建编辑器，只执行一次 */
  useEffect(() => {
    const parent = host.current
    if (!parent) return
    const initial = latest.current

    const state = EditorState.create({
      doc: initial.initialValue,
      extensions: [
        basicSetup,
        highlightActiveLine(),
        lineNumbers(),
        EditorView.lineWrapping,
        // 书签位置的行装饰（下划线 / 跳转高亮）
        markField,
        keymap.of(defaultKeymap),
        markdownKeySlot.of(initial.markdownMode ? keymap.of(markdownKeymap) : []),
        languageSlot.of(languageExtension(initial.markdownMode)),
        themeSlot.of(initial.dark ? oneDark : []),
        styleSlot.of(styleExtension(initial.style)),
        editableSlot.of(EditorView.editable.of(initial.editable)),
        EditorView.domEventHandlers({
          /**
           * 粘贴图片：拦下来写进统一资源库，再把 Markdown 图片语法插到光标处。
           * 落盘是异步的，所以先记下粘贴那一刻的选区，回来再按原位插入。
           */
          paste: (event: ClipboardEvent, instance: EditorView): boolean => {
            const handler = latest.current.onPasteImage
            if (!handler) return false
            const files = imageFilesFrom(event.clipboardData)
            const dataUrl = files.length === 0 ? dataUrlImageFrom(event.clipboardData) : null
            if (files.length === 0 && !dataUrl) return false
            event.preventDefault()
            const range = instance.state.selection.main
            const from = range.from
            const to = range.to
            void (async () => {
              const snippets: string[] = []
              for (const file of files) {
                const snippet = await handler(file)
                if (snippet) snippets.push(snippet)
              }
              if (dataUrl) {
                const file = await fileFromDataUrl(dataUrl)
                const snippet = file ? await handler(file) : null
                if (snippet) snippets.push(snippet)
              }
              if (snippets.length === 0) return
              // 等待期间文档若已被整体替换，就不要再插了
              if (to > instance.state.doc.length) return
              const text = snippets.join('\n')
              instance.dispatch({
                changes: { from, to, insert: text },
                selection: { anchor: from + text.length }
              })
              instance.focus()
            })()
            return true
          }
        }),
        EditorView.updateListener.of((update: ViewUpdate) => {
          if (update.docChanged) latest.current.onChange(update.state.doc.toString())
          if (update.docChanged || update.selectionSet) {
            const head = update.state.selection.main.head
            const line = update.state.doc.lineAt(head)
            latest.current.onCursor(line.number, head - line.from + 1)
          }
        })
      ]
    })

    const instance = new EditorView({ state, parent })
    view.current = instance
    const first = instance.state.doc.lineAt(0)
    latest.current.onCursor(first.number, 1)

    return () => {
      instance.destroy()
      view.current = null
    }
    // 编辑器实例只建一次，后续变化都走 Compartment
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /* 主题热切换 */
  useEffect(() => {
    const target = view.current
    if (!target) return
    target.dispatch({ effects: themeSlot.reconfigure(props.dark ? oneDark : []) })
  }, [props.dark, themeSlot])

  /* 字号 / 字体 / 行高热更新 */
  useEffect(() => {
    const target = view.current
    if (!target) return
    target.dispatch({ effects: styleSlot.reconfigure(styleExtension(props.style)) })
  }, [props.style.fontSize, props.style.fontFamily, props.style.lineHeight, styleSlot])

  /* 可编辑性 */
  useEffect(() => {
    const target = view.current
    if (!target) return
    target.dispatch({ effects: editableSlot.reconfigure(EditorView.editable.of(props.editable)) })
  }, [props.editable, editableSlot])

  /* 语言支持（md / txt 之间切换） */
  useEffect(() => {
    const target = view.current
    if (!target) return
    target.dispatch({
      effects: [
        languageSlot.reconfigure(languageExtension(props.markdownMode)),
        markdownKeySlot.reconfigure(props.markdownMode ? keymap.of(markdownKeymap) : [])
      ]
    })
  }, [props.markdownMode, languageSlot, markdownKeySlot])

  /* 外部灌入文档：载入完成、外部改动重载、撤销到上次保存 */
  useEffect(() => {
    const target = view.current
    if (!target) return
    const current = target.state.doc.toString()
    if (current === props.initialValue) return
    target.dispatch({
      changes: { from: 0, to: target.state.doc.length, insert: props.initialValue },
      selection: { anchor: 0 }
    })
    const first = target.state.doc.lineAt(0)
    latest.current.onCursor(first.number, 1)
  }, [props.reloadToken, props.initialValue])

  /*
   * 书签标记：侧栏的书签行变了就重画下划线；刚跳过来的那一行闪一下。
   * 闪完调 onFlashDone，让上层把 flashLine 清掉（否则下一次渲染它还在闪）。
   */
  useEffect(() => {
    const target = view.current
    if (!target) return
    const lines = props.bookmarkLines ?? []
    const flash = props.flashLine ?? null
    const effects: StateEffect<unknown>[] = [setMarks.of({ lines, flash })]
    if (flash !== null && flash >= 0 && flash < target.state.doc.lines) {
      effects.push(
        EditorView.scrollIntoView(target.state.doc.line(flash + 1).from, { y: 'center' })
      )
    }
    target.dispatch({ effects })
    if (flash === null) return
    const timer = window.setTimeout(() => props.onFlashDone?.(), 1400)
    return () => window.clearTimeout(timer)
  }, [props.bookmarkLines, props.flashLine, props.onFlashDone])

  return <div className="bs-cm-host" ref={host} />
}
