/**
 * 导出用的「渲染结果」装配。
 *
 * 关键取舍：导出不重新实现一遍排版，而是**复用预览那一套渲染管线**——
 * 同一个 renderMarkdown（TOC、五线谱占位、表格、图片都在里面）+
 * 同一套阅读样式（editor.css 原样内联），因此屏幕上看到什么，导出就是什么。
 */

import { DEFAULT_TOKENS, TOKEN_KEYS, getPreset, readableOn, resolveTokens, withAlpha } from '@shared/themes'
import type { ThemeTokenKey } from '@shared/types'
import editorCss from '@/styles/editor.css?raw'
import { useSettings } from '@/store/useSettings'
import { enhanceSheetMusic, type SheetMusicStats } from './abc'
import type { HeadingInfo } from './doc'
import { readImageDataUrl } from './imageStore'
import { assignHeadingIds, renderMarkdown } from './markdown'

/* -------------------------------------------------------- 阅读样式 */

/** base.css 里与主题无关的结构性变量，导出文档也必须带上 */
const STRUCTURAL_VARS: Record<string, string> = {
  '--font-serif': "'Noto Serif SC', 'Source Han Serif SC', 'Songti SC', 'SimSun', Georgia, serif",
  '--font-sans': "'Segoe UI', 'Microsoft YaHei UI', 'Microsoft YaHei', system-ui, -apple-system, sans-serif",
  '--font-mono': "'Cascadia Code', 'JetBrains Mono', Consolas, 'Courier New', monospace",
  '--radius-sm': '5px',
  '--radius': '8px',
  '--radius-lg': '13px',
  '--radius-xl': '18px',
  '--shadow-soft': '0 1px 2px var(--shadow)',
  '--shadow-card': '0 3px 10px -2px var(--shadow), 0 1px 2px var(--shadow)',
  '--shadow-float': '0 14px 38px -10px var(--shadow), 0 3px 10px -3px var(--shadow)',
  '--ease': 'cubic-bezier(0.32, 0.72, 0, 1)',
  '--dur-fast': '120ms',
  '--dur': '220ms',
  '--statusbar-h': '28px',
  '--titlebar-h': '42px'
}

/**
 * 取一套**纸面用**的主题令牌。
 *
 * 导出永远是白纸黑字：深色主题的令牌（浅色文字）印在白底上会看不见，
 * 所以深色主题一律退回默认的浅色令牌，同时把各种背景压成纯白。
 */
function paperTokens(): Record<string, string> {
  const settings = useSettings.getState().settings
  const preset = settings ? getPreset(settings.appTheme, settings.customThemes) : null
  const tokens = preset && !preset.dark ? resolveTokens(preset) : { ...DEFAULT_TOKENS }

  const out: Record<string, string> = {}
  for (const key of TOKEN_KEYS) out[`--${key}`] = tokens[key as ThemeTokenKey]
  out['--accent-softer'] = withAlpha(tokens.accent, 0.08)
  out['--border-soft'] = withAlpha(tokens['border-strong'], 0.35)
  out['--text-on-accent'] = readableOn(tokens.accent)
  // 纸面：背景一律纯白（表格斑马纹等仍靠 accent 派生色）
  out['--bg-app'] = '#ffffff'
  out['--bg-surface'] = '#ffffff'
  out['--bg-elevated'] = '#ffffff'
  out['--selection'] = withAlpha(tokens.accent, 0.2)
  return out
}

function varsToCss(vars: Record<string, string>): string {
  return Object.entries(vars)
    .map(([name, value]) => `${name}:${value};`)
    .join('')
}

let cachedCss: string | null = null

/**
 * 导出文档的样式：主题令牌（纸面版）+ editor.css 原文 + 少量导出/打印修正。
 * 直接内联 editor.css，是为了让导出的排版与编辑器预览逐像素一致。
 */
export function readingCss(): string {
  if (cachedCss) return cachedCss
  cachedCss = [
    `:root{${varsToCss({ ...STRUCTURAL_VARS, ...paperTokens() })}}`,
    editorCss,
    /* ---- 导出修正：去掉应用外壳的排版假设，交给纸张 ---- */
    `html,body{margin:0;padding:0;background:#fff;}`,
    `body{color:var(--text-primary);font-family:var(--font-serif);}`,
    `.bs-prose{max-width:none;margin:0;padding:0;font-size:15.5px;line-height:1.85;}`,
    `.bs-prose img{box-shadow:none;border-radius:4px;}`,
    `.bs-prose pre{box-shadow:none;}`,
    `*,*::before,*::after{-webkit-print-color-adjust:exact;print-color-adjust:exact;}`,
    `img,svg,table,pre,blockquote,.bs-music,.bs-toc{break-inside:avoid;page-break-inside:avoid;}`,
    `h1,h2,h3,h4,h5,h6{break-after:avoid;page-break-after:avoid;}`
  ].join('\n')
  return cachedCss
}

/** 令牌随主题变化，切换主题后要重新生成 */
export function invalidateReadingCss(): void {
  cachedCss = null
}

/* ------------------------------------------------------ 导出根节点 */

export interface ExportBuild {
  root: HTMLDivElement
  sheetMusic: SheetMusicStats
}

/**
 * 按预览的方式渲染一份离屏 DOM：标题 id、目录、五线谱 SVG 全部就位。
 * 离屏渲染让导出与当前视图模式（编辑 / 分栏 / 预览）无关。
 */
export async function buildExportRoot(source: string, headings: HeadingInfo[]): Promise<ExportBuild> {
  const root = document.createElement('div')
  root.className = 'bs-prose'
  root.innerHTML = renderMarkdown(source, headings)
  assignHeadingIds(root, headings.map((heading) => heading.id))
  const sheetMusic = await enhanceSheetMusic(root, { staffWidth: 720 })
  return { root, sheetMusic }
}

/* -------------------------------------------------------- 图片内联 */

/** 把 asset:/file:/绝对路径的图片换成 data URL；返回成功替换的张数 */
export async function inlineImages(root: HTMLElement): Promise<number> {
  const images = Array.from(root.querySelectorAll('img'))
  let done = 0
  for (const image of images) {
    const src = image.getAttribute('src') ?? ''
    if (!src || src.startsWith('data:')) continue
    const dataUrl = await readImageDataUrl(src)
    if (!dataUrl) continue
    image.setAttribute('src', dataUrl)
    image.removeAttribute('srcset')
    done += 1
  }
  return done
}

/* ------------------------------------------------------ 序列化输出 */

function serialize(root: HTMLElement): string {
  const clone = root.cloneNode(true) as HTMLElement
  // 渲染状态只对内存里的 DOM 有意义，导出产物里不需要
  clone.querySelectorAll('[data-bs-music-state]').forEach((node) => {
    node.removeAttribute('data-bs-music-state')
  })
  return clone.innerHTML
}

/** 自包含 .html：内联样式 + 图片 data URI */
export function selfContainedHtml(title: string, root: HTMLElement): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
${readingCss()}
body{display:flex;justify-content:center;}
.bs-prose{width:100%;max-width:760px;padding:38px 30px 80px;}
</style>
</head>
<body>
<article class="bs-prose">
${serialize(root)}
</article>
</body>
</html>`
}

/**
 * 交给 exportPdf 的片段。
 *
 * 主进程会把这段 HTML 塞进它自己的打印外壳（自带 @page 与打印 CSS），
 * 所以这里只给正文 + 一份把阅读样式带过去的 <style>。
 */
export function pdfFragment(root: HTMLElement): string {
  return `<style>${readingCss()}</style><article class="bs-prose">${serialize(root)}</article>`
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
