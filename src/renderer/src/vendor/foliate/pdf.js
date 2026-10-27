/**
 * foliate-js 的 PDF 适配器占位。
 *
 * `view.js` 会动态 `import('./pdf.js')`，而上游那份依赖 vendor/pdfjs
 * （pdf.mjs 加上 worker 与 cmaps，接近 15MB）。书香笔记有自己的 PDF 阅读器，
 * PDF 永远不会走到 foliate 这边，所以这里留一个能解析、但明确报错的占位，
 * 免得为了一个用不到的路径把整个 pdf.js 打进包里。
 */
export const makePDF = async () => {
  throw new Error('这本 PDF 请用书香笔记自带的 PDF 阅读器打开')
}
