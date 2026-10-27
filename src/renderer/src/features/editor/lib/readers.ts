import mammoth from 'mammoth'
import { filesApi } from '@/lib/api'
import { sanitizeHtml } from './markdown'
import { rtfToText } from './rtf'

export type LoadedContent =
  | { kind: 'html'; html: string; warnings: string[] }
  | { kind: 'image'; src: string }
  /** 无法直接渲染（或读不出内容）：交给信息卡 + 用系统应用打开 */
  | { kind: 'unsupported'; reason: string }

/** 纯文本 → 段落 HTML，保留换行 */
export function textToHtml(text: string): string {
  return text
    .split(/\r\n|\r|\n/)
    .map((line) => (line.trim() ? `<p>${escapeHtml(line)}</p>` : ''))
    .join('\n')
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** 判断是不是二进制（含 NUL 或大量控制字符） */
export function looksBinary(text: string): boolean {
  const sample = text.slice(0, 4096)
  if (sample.includes('\u0000')) return true
  let control = 0
  for (let i = 0; i < sample.length; i++) {
    const code = sample.charCodeAt(i)
    if (code < 9 || (code > 13 && code < 32)) control++
  }
  return sample.length > 0 && control / sample.length > 0.05
}

/** Word 97 .doc：主进程用 word-extractor 抽正文 */
export async function loadDoc(path: string): Promise<LoadedContent> {
  const result = await filesApi.extractDocText(path)
  if (!result || !result.text.trim()) {
    return {
      kind: 'unsupported',
      reason: '没能从这个 .doc 文件里抽出文字，可能是加密文档、扫描件或早期二进制格式。'
    }
  }
  return { kind: 'html', html: textToHtml(result.text), warnings: [] }
}

/** Word .docx：mammoth 转 HTML */
export async function loadDocx(path: string): Promise<LoadedContent> {
  const bytes = await filesApi.readBinary(path)
  const arrayBuffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength
  ) as ArrayBuffer
  const result = await mammoth.convertToHtml({ arrayBuffer })
  const warnings = result.messages.map((message) => message.message).filter(Boolean)
  return { kind: 'html', html: sanitizeHtml(result.value), warnings }
}

/** RTF：轻量转纯文本（能抽出文字就按段落渲染） */
export async function loadRtf(path: string): Promise<LoadedContent> {
  const raw = await filesApi.readText(path)
  const text = rtfToText(raw)
  if (!text) {
    return { kind: 'unsupported', reason: '这个 RTF 文件没有解析出可读文字，里面可能只有图片或特殊对象。' }
  }
  return { kind: 'html', html: textToHtml(text), warnings: [] }
}

/** 图片：主进程读成 data URL */
export async function loadImage(path: string): Promise<LoadedContent> {
  const src = await filesApi.readImage(path)
  return { kind: 'image', src }
}

/** 兜底：先当文本试读，像二进制就退回信息卡 */
export async function loadUnknown(path: string): Promise<LoadedContent> {
  try {
    const text = await filesApi.readText(path)
    if (looksBinary(text)) {
      return { kind: 'unsupported', reason: '这是二进制文件，没法直接当文字读。' }
    }
    return { kind: 'html', html: textToHtml(text), warnings: [] }
  } catch {
    return { kind: 'unsupported', reason: '这个格式暂时没法在应用内预览。' }
  }
}
