/**
 * 书香笔记 · 编辑 / 预览模块
 *
 * 对外只暴露一个 EditorView：按 Book.format 自动分流到
 * Markdown 编辑器（含实时预览）、纯文本编辑器、DOCX/DOC/RTF/HTML/图片只读预览，
 * 以及兜底的「用系统应用打开」信息卡。
 */
export { EditorView } from './EditorView'
export type { MarkdownEditorHandle } from './EditorSurface'
export type { MarkdownPreviewHandle } from './MarkdownPreview'
