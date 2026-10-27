import type { EditorView } from '../codemirror'
import { EditorSelection, redo, undo } from '../codemirror'

/* ---------------------------------------------------------- 基础工具 */

interface Segment {
  /** 文档绝对起点 */
  from: number
  /** 文档绝对终点 */
  to: number
  text: string
}

/** 把当前选区按行切开，每段带绝对坐标，方便直接拼 dispatch 的 changes */
function selectionSegments(view: EditorView): Segment[] | null {
  const { state } = view
  const range = state.selection.main
  const startLine = state.doc.lineAt(range.from)
  const endLine = state.doc.lineAt(range.to)

  const segments: Segment[] = []
  for (let n = startLine.number; n <= endLine.number; n++) {
    const line = state.doc.line(n)
    segments.push({ from: line.from, to: line.to, text: line.text })
  }
  return segments.length > 0 ? segments : null
}

function isBlankLine(text: string): boolean {
  return /^\s*$/.test(text)
}

/* ------------------------------------------------------------ 行内标记 */

/** 行内包裹：加粗 / 斜体 / 删除线 / 高亮 / 行内代码 */
export function wrapInline(view: EditorView, marker: string, placeholder: string): void {
  const { state } = view
  const changes: { from: number; to: number; insert: string }[] = []
  const selections: ReturnType<typeof EditorSelection.range>[] = []

  for (const range of state.selection.ranges) {
    const selected = state.sliceDoc(range.from, range.to)
    const inner = selected || placeholder
    changes.push({ from: range.from, to: range.to, insert: `${marker}${inner}${marker}` })
    const start = range.from + marker.length
    selections.push(EditorSelection.range(start, start + inner.length))
  }

  view.dispatch({ changes, selection: EditorSelection.create(selections) })
  view.focus()
}

/* ------------------------------------------------------------ 行前缀 */

/** 标题：同一层级再点一次则取消 */
export function setHeading(view: EditorView, level: number): void {
  const { state } = view
  const line = state.doc.lineAt(state.selection.main.from)
  const current = /^\s*(#{1,6})\s+/.exec(line.text)
  const body = line.text.replace(/^\s*#{1,6}\s+/, '')
  if (current && current[1].length === level) {
    view.dispatch({ changes: { from: line.from, to: line.to, insert: body } })
  } else {
    view.dispatch({ changes: { from: line.from, to: line.to, insert: `${'#'.repeat(level)} ${body}` } })
  }
  view.focus()
}

/** 引用：整块加 "> "，已全是引用则去掉 */
export function toggleQuote(view: EditorView): void {
  const segments = selectionSegments(view)
  if (!segments) return
  const allQuoted = segments.every((seg) => /^\s{0,3}>\s?/.test(seg.text) || isBlankLine(seg.text))
  const changes = segments.map((seg) => {
    if (isBlankLine(seg.text)) return { from: seg.from, to: seg.to, insert: seg.text }
    if (allQuoted) return { from: seg.from, to: seg.to, insert: seg.text.replace(/^(\s{0,3}>\s?)/, '') }
    return { from: seg.from, to: seg.to, insert: `> ${seg.text.replace(/^\s+/, '')}` }
  })
  view.dispatch({ changes })
  view.focus()
}

/* -------------------------------------------------------------- 列表 */

export type ListKind = 'bullet' | 'ordered' | 'task'

export function toggleList(view: EditorView, kind: ListKind): void {
  const segments = selectionSegments(view)
  if (!segments) return

  const detect =
    kind === 'bullet'
      ? /^\s*[-*+]\s+(?!\[[ xX]\]\s)/
      : kind === 'ordered'
        ? /^\s*\d+[.)]\s+/
        : /^\s*[-*+]\s+\[[ xX]\]\s+/
  const allMarked = segments.every((seg) => detect.test(seg.text) || isBlankLine(seg.text))

  let counter = 1
  const changes = segments.map((seg) => {
    if (isBlankLine(seg.text)) {
      const insert =
        kind === 'ordered' ? `${counter++}. ` : kind === 'task' ? '- [ ] ' : '- '
      return { from: seg.from, to: seg.to, insert }
    }
    if (allMarked) {
      const cleaned =
        kind === 'bullet'
          ? seg.text.replace(/^(\s*)[-*+]\s+/, '$1')
          : kind === 'ordered'
            ? seg.text.replace(/^(\s*)\d+[.)]\s+/, '$1')
            : seg.text.replace(/^(\s*)[-*+]\s+\[[ xX]\]\s+/, '$1')
      return { from: seg.from, to: seg.to, insert: cleaned }
    }
    const stripped = seg.text
      .replace(/^(\s*)[-*+]\s+\[[ xX]\]\s+/, '$1')
      .replace(/^(\s*)[-*+]\s+/, '$1')
      .replace(/^(\s*)\d+[.)]\s+/, '$1')
    const leading = /^\s*/.exec(stripped)?.[0] ?? ''
    const body = stripped.slice(leading.length)
    if (kind === 'bullet') return { from: seg.from, to: seg.to, insert: `${leading}- ${body}` }
    if (kind === 'ordered') return { from: seg.from, to: seg.to, insert: `${leading}${counter++}. ${body}` }
    return { from: seg.from, to: seg.to, insert: `${leading}- [ ] ${body}` }
  })

  view.dispatch({ changes })
  view.focus()
}

/* ------------------------------------------------------------ 块级插入 */

export function insertBlock(
  view: EditorView,
  block: string,
  selection?: { from: number; to: number }
): void {
  const { state } = view
  const range = state.selection.main
  const line = state.doc.lineAt(range.from)
  const prefix = range.from === line.from ? '' : '\n'
  const insert = `${prefix}${block}\n`
  const base = range.from + prefix.length
  view.dispatch({
    changes: { from: range.from, to: range.to, insert },
    selection: selection
      ? { anchor: base + selection.from, head: base + selection.to }
      : { anchor: base + insert.length }
  })
  view.focus()
}

/** 代码块：把选中内容包进围栏 */
export function insertCodeBlock(view: EditorView): void {
  const { state } = view
  const range = state.selection.main
  const selected = state.sliceDoc(range.from, range.to)
  const body = selected || '代码'
  const insert = `\`\`\`\n${body}\n\`\`\`\n`
  const start = range.from + 4
  view.dispatch({
    changes: { from: range.from, to: range.to, insert },
    selection: { anchor: start, head: start + body.length }
  })
  view.focus()
}

/** 链接：选中文字变成链接文字 */
export function insertLink(view: EditorView): void {
  const { state } = view
  const range = state.selection.main
  const selected = state.sliceDoc(range.from, range.to)
  const label = selected || '链接文字'
  const insert = `[${label}](https://)`
  const start = range.from + label.length + 3
  view.dispatch({
    changes: { from: range.from, to: range.to, insert },
    selection: { anchor: start, head: start + 8 }
  })
  view.focus()
}

/** 表格骨架 */
export function insertTable(view: EditorView): void {
  insertBlock(
    view,
    ['| 列一 | 列二 | 列三 |', '| --- | --- | --- |', '| 内容 | 内容 | 内容 |', '| 内容 | 内容 | 内容 |'].join('\n')
  )
}

/** 分割线 */
export function insertDivider(view: EditorView): void {
  insertBlock(view, '---')
}

/* ---------------------------------------------------------- 撤销重做 */

export function applyUndo(view: EditorView): void {
  undo(view)
  view.focus()
}

export function applyRedo(view: EditorView): void {
  redo(view)
  view.focus()
}
