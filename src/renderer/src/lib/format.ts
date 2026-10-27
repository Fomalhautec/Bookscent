import type { BookFormat } from '@shared/types'

export function formatBytes(bytes: number): string {
  if (!bytes) return '—'
  const units = ['B', 'KB', 'MB', 'GB']
  let value = bytes
  let i = 0
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024
    i++
  }
  return `${value < 10 && i > 0 ? value.toFixed(1) : Math.round(value)} ${units[i]}`
}

const DATE_FMT = new Intl.DateTimeFormat('zh-CN', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit'
})

const TIME_FMT = new Intl.DateTimeFormat('zh-CN', {
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit'
})

export function formatDate(ms: number | null | undefined): string {
  if (!ms) return '—'
  return DATE_FMT.format(new Date(ms))
}

export function formatDateTime(ms: number | null | undefined): string {
  if (!ms) return '—'
  return TIME_FMT.format(new Date(ms))
}

export function relativeTime(ms: number | null | undefined): string {
  if (!ms) return '从未打开'
  const diff = Date.now() - ms
  const minute = 60_000
  const hour = 60 * minute
  const day = 24 * hour
  if (diff < minute) return '刚刚'
  if (diff < hour) return `${Math.floor(diff / minute)} 分钟前`
  if (diff < day) return `${Math.floor(diff / hour)} 小时前`
  if (diff < 30 * day) return `${Math.floor(diff / day)} 天前`
  if (diff < 365 * day) return `${Math.floor(diff / (30 * day))} 个月前`
  return `${Math.floor(diff / (365 * day))} 年前`
}

export function formatPages(pages: number, exact: boolean): string {
  if (!pages) return '正在统计…'
  return exact ? `${pages} 页` : `约 ${pages} 页`
}

export function formatWords(words: number | undefined): string {
  if (!words) return '—'
  if (words < 10_000) return `${words.toLocaleString('zh-CN')} 字`
  return `${(words / 10_000).toFixed(1)} 万字`
}

export const FORMAT_ACCENT: Record<BookFormat, string> = {
  pdf: '#b5443a',
  md: '#3f6f8f',
  markdown: '#3f6f8f',
  txt: '#6f6a5c',
  doc: '#2f5d8f',
  docx: '#2f5d8f',
  rtf: '#7a5aa8',
  html: '#c07a2a',
  epub: '#4a8a5c',
  image: '#8a5c9c',
  unknown: '#7a7a7a'
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export function truncate(text: string, max: number): string {
  if (text.length <= max) return text
  return `${text.slice(0, max - 1)}…`
}

/** 把任意字符串变成可用的文件名 */
export function safeFileName(name: string, fallback = 'untitled'): string {
  const cleaned = name.replace(/[\\/:*?"<>|]/g, '_').trim()
  return cleaned || fallback
}

export function nextTick(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()))
}

export function download(filename: string, data: Blob): void {
  const url = URL.createObjectURL(data)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 4000)
}
