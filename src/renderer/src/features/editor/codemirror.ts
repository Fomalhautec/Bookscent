/**
 * 书香笔记 · 编辑器模块的 CodeMirror 汇聚层
 *
 * 编辑器只用这一个文件接触 CodeMirror：集中再导出用到的 API，
 * 其余文件一律从这里取，保证类型完整、模块实例唯一（不会出现两份 @codemirror/state）。
 */

export { basicSetup, EditorView } from 'codemirror'
export { markdown, markdownKeymap, markdownLanguage } from '@codemirror/lang-markdown'
export { oneDark } from '@codemirror/theme-one-dark'

export {
  Compartment,
  EditorSelection,
  EditorState,
  RangeSetBuilder,
  StateEffect,
  StateField
} from '@codemirror/state'
export type { Extension, Text, Transaction } from '@codemirror/state'

export {
  Decoration,
  ViewPlugin,
  WidgetType,
  highlightActiveLine,
  keymap,
  lineNumbers
} from '@codemirror/view'
export type { DecorationSet, KeyBinding, PluginValue, ViewUpdate } from '@codemirror/view'

export { defaultKeymap, redo, undo } from '@codemirror/commands'
