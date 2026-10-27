import { BrowserWindow, dialog } from 'electron'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ExportPdfOptions, ExportResult } from '@shared/ipc'
import { logLine } from './log'
import { userDataDir } from './settings'

/**
 * 用 Electron 自己的排版引擎把 HTML 导成 PDF。
 *
 * 为什么不在渲染层用 pdf-lib 画：那样等于把排版重写一遍，图片、TOC、五线谱
 * 都要各自想办法塞进去。`printToPDF` 直接复用 Chromium 的排版结果，
 * 屏幕上长什么样，纸上就什么样。
 */
export async function renderHtmlToPdf(options: ExportPdfOptions): Promise<ExportResult> {
  const saved = await dialog.showSaveDialog({
    title: '导出为 PDF',
    defaultPath: `${options.defaultName}.pdf`,
    filters: [{ name: 'PDF', extensions: ['pdf'] }]
  })
  if (saved.canceled || !saved.filePath) return { path: null, cancelled: true }

  const html = wrapForPrint(options)
  const worker = new BrowserWindow({
    show: false,
    width: 900,
    height: 1200,
    webPreferences: {
      // 只用来排版，不给它任何能力
      javascript: false,
      sandbox: true,
      offscreen: true,
      contextIsolation: true
    }
  })

  try {
    await worker.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
    // 给图片/字体一点时间落位，否则第一页可能是空的
    await new Promise((resolve) => setTimeout(resolve, 350))
    const data = await worker.webContents.printToPDF({
      pageSize: options.pageSize ?? 'A4',
      landscape: Boolean(options.landscape),
      printBackground: true,
      margins: {
        top: options.marginInch ?? 0.6,
        bottom: options.marginInch ?? 0.6,
        left: options.marginInch ?? 0.6,
        right: options.marginInch ?? 0.6
      }
    })
    await writeFile(saved.filePath, data)
    logLine('export', `PDF 已导出 ${saved.filePath}（${data.length} 字节）`)
    return { path: saved.filePath, cancelled: false }
  } catch (error) {
    logLine('export', `PDF 导出失败：${(error as Error).message}`)
    throw new Error(`导出 PDF 失败：${(error as Error).message}`)
  } finally {
    if (!worker.isDestroyed()) worker.destroy()
  }
}

/**
 * 把渲染好的 HTML 包成一份可打印的文档。
 *
 * - `asset:` 引用换成本地文件绝对路径（file:// 能被 Chromium 直接加载）
 * - 补一份打印用 CSS：去掉应用外壳、按纸张分页、避免表格和图片被切断
 */
function wrapForPrint(options: ExportPdfOptions): string {
  const base = options.baseDir ?? userDataDir()
  /*
   * `asset:` 图片换成本地文件路径。
   *
   * 注意地址形如 asset://local/<文件名>：host（local）必须单独匹配掉，
   * 早期只用一个捕获组会把 host 一起当成文件名，拼出来的路径根本不存在。
   */
  const withLocalImages = options.html.replace(
    /asset:\/\/[^/"'\s]+\/([^"')\s]+)/g,
    (_match, encodedName: string) => {
      let name = encodedName
      try {
        name = decodeURIComponent(encodedName)
      } catch {
        /* 编码坏了就按原样用 */
      }
      const abs = join(base, name).replace(/\\/g, '/')
      return `file:///${encodeURI(abs)}`
    }
  )

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>${escapeHtml(options.defaultName)}</title>
<style>
  @page { margin: 0; }
  html, body { margin: 0; padding: 0; background: #fff; }
  body {
    font-family: "Noto Serif SC", "Source Han Serif SC", "Songti SC", SimSun, Georgia, serif;
    font-size: 11.5pt;
    line-height: 1.75;
    color: #241d14;
  }
  img, svg, table, pre, blockquote { break-inside: avoid; page-break-inside: avoid; }
  h1, h2, h3, h4 { break-after: avoid; page-break-after: avoid; }
  h1 { font-size: 20pt; }
  h2 { font-size: 16pt; }
  h3 { font-size: 13.5pt; }
  a { color: inherit; text-decoration: none; }
  pre {
    padding: 10px 12px;
    border: 1px solid #ded3c0;
    border-radius: 6px;
    background: #faf6ee;
    white-space: pre-wrap;
    word-break: break-word;
    font-size: 10pt;
  }
  code { font-family: "Cascadia Mono", Consolas, monospace; font-size: 10pt; }
  blockquote {
    margin: 10px 0;
    padding: 6px 14px;
    border-left: 3px solid #c2a878;
    background: #f7f1e6;
  }
  table { border-collapse: collapse; width: 100%; }
  th, td { border: 1px solid #d8ccb8; padding: 5px 8px; }
  th { background: #f2ebdd; }
  hr { border: 0; border-top: 1px solid #ded3c0; margin: 18px 0; }
  .bs-toc, .bs-music { break-inside: avoid; page-break-inside: avoid; }
</style>
</head>
<body>
${withLocalImages}
</body>
</html>`
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
