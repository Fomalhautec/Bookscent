// 视觉核对夹具：用本机 Edge（headless）打开构建产物，注入假的桌面 API，再逐屏截图。
// 之所以需要它：这台机器上 Electron 无法创建窗口（GUI 进程被环境限制），
// 但界面本身是纯 Web 的，浏览器里能完整跑起来。
//
//   node scripts/preview.mjs            # 全部场景
//   node scripts/preview.mjs shelf      # 只跑名字里含 shelf 的场景
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { readFile, mkdir, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const rendererDir = join(root, 'out', 'renderer')
const shotsDir = join(root, 'shots')
const only = process.argv[2] ?? ''
const PORT = 5199
const CDP_PORT = 9333

const EDGE_CANDIDATES = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
]

if (!existsSync(join(rendererDir, 'index.html'))) {
  console.error('找不到 out/renderer，请先执行 pnpm build')
  process.exit(1)
}

const browserPath = EDGE_CANDIDATES.find((p) => existsSync(p))
if (!browserPath) {
  console.error('找不到 Edge / Chrome')
  process.exit(1)
}

/* ------------------------------------------------------------ 示例 PDF */

async function buildSamplePdf() {
  const doc = await PDFDocument.create()
  doc.setTitle('The Shape of a Shelf — a Bookscent sample')
  const serif = await doc.embedFont(StandardFonts.TimesRoman)
  const bold = await doc.embedFont(StandardFonts.TimesRomanBold)
  const italic = await doc.embedFont(StandardFonts.TimesRomanItalic)
  const sans = await doc.embedFont(StandardFonts.Helvetica)
  let image = null
  try {
    image = await doc.embedPng(await readFile(join(root, 'build', 'icon.png')))
  } catch {
    image = null
  }

  const W = 595.28
  const H = 841.89
  const M = 64
  const sections = [
    ['I. On the Shape of a Shelf', 'A shelf is a promise that things will stay where you put them. It is also, quietly, a claim about proportion: how much of the world you intend to keep within reach.'],
    ['II. Thickness as Information', 'Before you open a book you already know something about it, and almost all of that knowledge is thickness. A thin spine promises an afternoon; a thick one asks for a season.'],
    ['III. The Marks We Leave', 'A used book is a record of two readers: the one who wrote it and the one who argued with it in the margins. Underlining is the cheapest form of attention.'],
    ['IV. Extraction and Return', 'Pages can be exported as images. Embedded images can be lifted out at their native resolution, which is usually far larger than anything the screen ever showed you.'],
    ['V. Night Reading', 'The best argument for a dark theme is not aesthetics but the fact that reading at night happens in a room where someone else is asleep.']
  ]
  const pages = []
  for (let i = 0; i < 24; i++) pages.push(doc.addPage([W, H]))

  const wrap = (text, font, size, maxWidth) => {
    const out = []
    let line = ''
    for (const word of text.split(/\s+/)) {
      const candidate = line ? line + ' ' + word : word
      if (font.widthOfTextAtSize(candidate, size) <= maxWidth) line = candidate
      else {
        if (line) out.push(line)
        line = word
      }
    }
    if (line) out.push(line)
    return out
  }

  const footer = (page, i) => {
    page.drawLine({ start: { x: M, y: 62 }, end: { x: W - M, y: 62 }, thickness: 0.6, color: rgb(0.78, 0.72, 0.62) })
    page.drawText('The Shape of a Shelf', { x: M, y: 46, size: 8.5, font: italic, color: rgb(0.45, 0.4, 0.34) })
    const label = String(i + 1)
    page.drawText(label, { x: W - M - sans.widthOfTextAtSize(label, 9), y: 46, size: 9, font: sans, color: rgb(0.45, 0.4, 0.34) })
  }

  const title = pages[0]
  title.drawRectangle({ x: 0, y: 0, width: W, height: H, color: rgb(0.976, 0.957, 0.925) })
  title.drawText('The Shape of a Shelf', { x: M, y: 620, size: 30, font: bold, color: rgb(0.17, 0.14, 0.1) })
  title.drawText('Notes on reading, thickness, and the marks we leave', { x: M, y: 585, size: 13, font: italic, color: rgb(0.36, 0.32, 0.26) })
  title.drawText('A SAMPLE DOCUMENT FOR BOOKSCENT 0.1.1', { x: M, y: 300, size: 9.5, font: sans, color: rgb(0.55, 0.42, 0.26) })
  footer(title, 0)

  const toc = pages[1]
  toc.drawText('Contents', { x: M, y: H - 96, size: 20, font: bold, color: rgb(0.17, 0.14, 0.1) })
  toc.drawLine({ start: { x: M, y: H - 112 }, end: { x: W - M, y: H - 112 }, thickness: 1, color: rgb(0.61, 0.42, 0.25) })
  sections.forEach((s, i) => {
    const y = H - 156 - i * 30
    toc.drawText(s[0], { x: M, y, size: 12.5, font: serif, color: rgb(0.22, 0.18, 0.13) })
    const page = String(3 + i * 3)
    toc.drawText(page, { x: W - M - sans.widthOfTextAtSize(page, 11), y, size: 11, font: sans, color: rgb(0.45, 0.4, 0.34) })
  })
  footer(toc, 1)

  let cursor = 0
  for (let i = 2; i < 20; i++) {
    const page = pages[i]
    const s = sections[cursor % sections.length]
    let y = H - 110
    page.drawText(s[0], { x: M, y, size: 17, font: bold, color: rgb(0.17, 0.14, 0.1) })
    y -= 16
    page.drawLine({ start: { x: M, y }, end: { x: M + 120, y }, thickness: 1.2, color: rgb(0.61, 0.42, 0.25) })
    y -= 32
    for (const line of wrap(s[1], serif, 11.5, W - M * 2)) {
      page.drawText(line, { x: M, y, size: 11.5, font: serif, color: rgb(0.19, 0.16, 0.12) })
      y -= 18
    }
    if (cursor % 5 === 3 && image && y > 300) {
      const bw = 200
      const bh = (image.height / image.width) * bw
      page.drawImage(image, { x: M, y: y - bh - 16, width: bw, height: bh })
      page.drawText('Fig. — the application icon, embedded at native resolution', { x: M, y: y - bh - 32, size: 9, font: italic, color: rgb(0.45, 0.4, 0.34) })
    }
    page.drawText('Section ' + ((cursor % sections.length) + 1) + ' · page ' + (i + 1) + ' of 24', { x: M, y: 108, size: 9, font: sans, color: rgb(0.55, 0.5, 0.44) })
    footer(page, i)
    cursor++
  }

  for (let i = 20; i < 24; i++) {
    const page = pages[i]
    page.drawText('Appendix', { x: M, y: H - 110, size: 17, font: bold, color: rgb(0.17, 0.14, 0.1) })
    page.drawLine({ start: { x: M, y: H - 126 }, end: { x: M + 120, y: H - 126 }, thickness: 1.2, color: rgb(0.61, 0.42, 0.25) })
    const items = [
      'PageUp / PageDown turn pages, B drops a bookmark, P selects the pen.',
      'Annotations are stored per page as normalised geometry.',
      'Page export renders at 1x to 4x; embedded extraction keeps native pixels.',
      'Annotated exports are flattened with a standard PDF writer.'
    ]
    items.forEach((line, n) => {
      page.drawText(line, { x: M, y: H - 180 - n * 18, size: 11, font: serif, color: rgb(0.19, 0.16, 0.12) })
    })
    footer(page, i)
  }

  return new Uint8Array(await doc.save())
}

/* --------------------------------------------------------- 静态服务器 */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
  '.map': 'application/json; charset=utf-8'
}

async function startServer(samplePdfBytes) {
  const mock = await readFile(join(root, 'scripts', 'preview-mock.js'), 'utf8')
  const icon = await readFile(join(root, 'build', 'icon.png'))

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1')
    const path = url.pathname

    if (path === '/__mock.js') {
      res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' })
      res.end(mock)
      return
    }
    if (path === '/__sample.pdf') {
      res.writeHead(200, { 'content-type': 'application/pdf' })
      res.end(Buffer.from(samplePdfBytes))
      return
    }
    if (path === '/__icon.png') {
      res.writeHead(200, { 'content-type': 'image/png' })
      res.end(icon)
      return
    }

    const rel = path === '/' ? '/index.html' : path
    const file = join(rendererDir, rel)
    if (!file.startsWith(rendererDir)) {
      res.writeHead(403).end('forbidden')
      return
    }
    try {
      let body = await readFile(file)
      if (rel === '/index.html') {
        // 让假 API 在应用模块之前执行
        body = Buffer.from(
          body.toString('utf8').replace('<script type="module"', '<script src="/__mock.js"></script><script type="module"')
        )
      }
      res.writeHead(200, { 'content-type': MIME[extname(file).toLowerCase()] ?? 'application/octet-stream' })
      res.end(body)
    } catch {
      res.writeHead(404).end('not found')
    }
  })

  await new Promise((resolve) => server.listen(PORT, '127.0.0.1', resolve))
  return server
}

/* ----------------------------------------------------------- CDP 驱动 */

class CDP {
  constructor(ws) {
    this.ws = ws
    this.seq = 0
    this.pending = new Map()
    ws.addEventListener('message', (event) => {
      const msg = JSON.parse(event.data)
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id)
        this.pending.delete(msg.id)
        if (msg.error) reject(new Error(msg.error.message))
        else resolve(msg.result)
      }
    })
  }

  static connect(url) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url)
      ws.addEventListener('open', () => resolve(new CDP(ws)))
      ws.addEventListener('error', () => reject(new Error('WebSocket 连接失败')))
    })
  }

  send(method, params = {}) {
    const id = ++this.seq
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.ws.send(JSON.stringify({ id, method, params }))
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id)
          reject(new Error(method + ' 超时'))
        }
      }, 30000)
    })
  }

  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description ?? 'evaluate 失败')
    }
    return result.result?.value
  }
}

/* ---------------------------------------------------------------- 主流程 */

const userDataDir = join(process.env.TEMP ?? '/tmp', 'bookscent-preview-profile')

let server = null
let browser = null
let cdp = null

try {
  console.log('生成示例 PDF…')
  const samplePdfBytes = await buildSamplePdf()
  console.log('  ' + samplePdfBytes.length + ' bytes')

  // 先建目录再启动；清空放在最后成功之后做，免得中途失败把已有截图全删了
  await mkdir(shotsDir, { recursive: true })

  server = await startServer(samplePdfBytes)
  console.log('预览服务 http://127.0.0.1:' + PORT)

  browser = spawn(
    browserPath,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      '--disable-features=Translate,MediaRouter',
      '--remote-debugging-port=' + CDP_PORT,
      '--user-data-dir=' + userDataDir,
      '--window-size=1500,940',
      'about:blank'
    ],
    { stdio: 'ignore' }
  )

  let wsUrl = null
  for (let i = 0; i < 60 && !wsUrl; i++) {
    await delay(500)
    try {
      const res = await fetch('http://127.0.0.1:' + CDP_PORT + '/json/list')
      const list = await res.json()
      const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl)
      if (page) wsUrl = page.webSocketDebuggerUrl
    } catch {
      /* 还没起来 */
    }
  }
  if (!wsUrl) throw new Error('没能连上浏览器的调试端口')

  cdp = await CDP.connect(wsUrl)
  await cdp.send('Page.enable')
  await cdp.send('Runtime.enable')
  await cdp.send('Log.enable').catch(() => {})
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 1500,
    height: 940,
    deviceScaleFactor: 1,
    mobile: false
  })

  const consoleErrors = []
  cdp.ws.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data)
    if (msg.method === 'Runtime.exceptionThrown') {
      consoleErrors.push(msg.params.exceptionDetails?.exception?.description ?? 'exception')
    }
    if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') {
      consoleErrors.push(msg.params.entry.text)
    }
  })

  const shot = async (name, clip) => {
    if (only && !name.includes(only)) return
    const params = { format: 'png', captureBeyondViewport: false }
    if (clip) params.clip = { ...clip, scale: clip.scale ?? 1 }
    const { data } = await cdp.send('Page.captureScreenshot', params)
    await writeFileSafe(join(shotsDir, name), Buffer.from(data, 'base64'))
    console.log('  截图 -> ' + name)
  }

  /** 局部放大：用来核对书脊上那些十几个像素的细节 */
  const shotZoom = async (name, selector, index = 0, scale = 2, pad = 8) => {
    const r = await rectOf(selector, index)
    if (!r) return
    await shot(name, {
      x: Math.max(0, r.x - pad),
      y: Math.max(0, r.y - pad),
      width: Math.min(1500 - Math.max(0, r.x - pad), r.w + pad * 2),
      height: Math.min(940 - Math.max(0, r.y - pad), r.h + pad * 2),
      scale
    })
  }

  const waitFor = async (expression, label, timeout = 25000) => {
    const started = Date.now()
    for (;;) {
      const ok = await cdp.evaluate('(() => { try { return !!(' + expression + ') } catch (e) { return false } })()')
      if (ok) return
      if (Date.now() - started > timeout) throw new Error('等待超时：' + label)
      await delay(250)
    }
  }

  const clickText = async (text, selector = 'button') => {
    const ok = await cdp.evaluate(
      '(() => { const n = Array.from(document.querySelectorAll(' + JSON.stringify(selector) + ')).find(x => (x.textContent||"").trim() === ' +
        JSON.stringify(text) + '); if (!n) return false; n.click(); return true })()'
    )
    if (!ok) throw new Error('找不到按钮：' + text)
  }

  const clickSelector = async (selector, index = 0) => {
    const ok = await cdp.evaluate(
      '(() => { const n = document.querySelectorAll(' + JSON.stringify(selector) + ')[' + index + ']; if (!n) return false; n.click(); return true })()'
    )
    if (!ok) throw new Error('找不到元素：' + selector + '[' + index + ']')
  }

  const rectOf = async (selector, index = 0) =>
    cdp.evaluate(
      '(() => { const n = document.querySelectorAll(' + JSON.stringify(selector) + ')[' + index + ']; if (!n) return null; const r = n.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height } })()'
    )

  const hover = async (selector, index = 0, fx = 0.5, fy = 0.6) => {
    const r = await rectOf(selector, index)
    if (!r) return
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: r.x + r.w * fx,
      y: r.y + r.h * fy,
      button: 'none',
      buttons: 0
    })
  }

  const baseUrl = 'http://127.0.0.1:' + PORT + '/'
  let navSeq = 0
  const loadShelf = async (hash, settle = 1500) => {
    // 带一个自增 query，保证换 hash 时是整页重载（hash 本身不会触发重载）
    navSeq += 1
    await cdp.send('Page.navigate', { url: baseUrl + '?r=' + navSeq + (hash || '') })
    await waitFor('document.querySelector(".app-shell")', '应用外壳')
    await waitFor('document.querySelectorAll(".book").length > 0', '书架上的书')
    await delay(settle)
  }

  console.log('打开页面…')
  await loadShelf('', 1600)

  const summary = await cdp.evaluate(
    '(() => ({ books: document.querySelectorAll(".book").length, rows: document.querySelectorAll(".shelf-row").length, title: document.title }))()'
  )
  console.log('书架: ' + JSON.stringify(summary))

  const measurements = await cdp.evaluate(
    '(() => Array.from(document.querySelectorAll(".book")).slice(0, 8).map(b => {' +
      ' const t = b.querySelector(".spine-title") || b.querySelector(".spine-label-text");' +
      ' const cs = t ? getComputedStyle(t) : null;' +
      ' return {' +
      '  name: (b.getAttribute("title") || "").split("\\n")[0].slice(0, 22),' +
      '  w: Math.round(b.getBoundingClientRect().width),' +
      '  h: Math.round(b.getBoundingClientRect().height),' +
      '  font: cs ? cs.fontSize : null,' +
      '  writingMode: cs ? cs.writingMode : null,' +
      '  overX: t ? t.scrollWidth > t.clientWidth + 1 : null,' +
      '  overY: t ? t.scrollHeight > t.clientHeight + 1 : null,' +
      '  box: t ? t.clientWidth + "x" + t.clientHeight : null,' +
      '  content: t ? t.scrollWidth + "x" + t.scrollHeight : null' +
      ' };' +
      '}))()'
  )
  console.log('书脊测量:')
  for (const m of measurements ?? []) console.log('  ' + JSON.stringify(m))

  await shot('01-shelf.png')
  await shotZoom('01b-shelf-detail.png', '.shelf-unit', 0, 2)
  await shotZoom('01c-book-0.png', '.book', 0, 4)
  await shotZoom('01d-book-1.png', '.book', 1, 4)

  // 悬停一本厚书，看"抽出来露封面"（合成鼠标事件在 headless 下不总能触发 :hover，
  // 这里同时派发真实 mouseMoved 并给一份 JS 兜底，确保看到的是设计稿的样子）
  const thickIndex = await cdp.evaluate(
    '(() => Array.from(document.querySelectorAll(".book")).findIndex(b => (b.getAttribute("title")||"").includes("论书架")))()'
  )
  const peekIndex = thickIndex >= 0 ? thickIndex : 3
  const peekRect = await rectOf('.book', peekIndex)
  if (peekRect) {
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: peekRect.x + peekRect.w / 2,
      y: peekRect.y + peekRect.h * 0.7,
      button: 'none',
      buttons: 0
    })
    await delay(900)
  }
  await shot('02-shelf-hover.png')

  if (peekRect) {
    // 兜底：直接触发一次 React 的 mouseenter
    await cdp.evaluate(
      '(() => { const b = document.querySelectorAll(".book")[' + peekIndex + ']; if (!b) return false;' +
        ' b.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));' +
        ' b.dispatchEvent(new MouseEvent("mouseenter", { bubbles: false }));' +
        ' b.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: ' + Math.round(peekRect.x + peekRect.w / 2) + ', clientY: ' + Math.round(peekRect.y + peekRect.h * 0.7) + ' }));' +
        ' return true })()'
    )
    await delay(900)
    await shotZoom('02b-shelf-hover-detail.png', '.cover-peek', 0, 1.6)
  }

  // 换几套书架主题
  for (const [hash, file] of [
    ['#appTheme=walnut&shelfTheme=walnut', '03-shelf-walnut.png'],
    ['#appTheme=ink&shelfTheme=bamboo', '03b-shelf-bamboo.png'],
    ['#appTheme=celadon&shelfTheme=stone', '03c-shelf-stone.png'],
    ['#appTheme=midnight&shelfTheme=ebony', '03d-shelf-ebony.png']
  ]) {
    await loadShelf(hash, 1300)
    await shot(file)
  }

  await loadShelf('', 1400)

  // PDF 阅读器
  const pdfIndex = await cdp.evaluate(
    '(() => Array.from(document.querySelectorAll(".book")).findIndex(b => (b.getAttribute("title")||"").includes("A Shelf")))()'
  )
  await clickSelector('.book', pdfIndex >= 0 ? pdfIndex : 0)
  await waitFor('document.querySelector(".pdf-root")', 'PDF 阅读器', 30000)
  await waitFor('document.querySelector(".pdf-page canvas")', 'PDF 页面画布', 40000)
  await delay(2200)
  await shot('04-pdf-reader.png')

  // 画一笔
  const pageRect = await rectOf('.pdf-scroll .pdf-page', 0)
  if (pageRect) {
    const y0 = pageRect.y + pageRect.h * 0.34
    const x0 = pageRect.x + pageRect.w * 0.16
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x0, y: y0, button: 'none', buttons: 0 })
    await delay(200)
    await shot('05-pdf-hover-tools.png')
  }

  // 缩略图 / 目录 / 书签面板
  const tabClicked = await cdp.evaluate(
    '(() => { const n = Array.from(document.querySelectorAll("button")).find(x => (x.textContent||"").trim() === "书签"); if (!n) return false; n.click(); return true })()'
  )
  if (tabClicked) {
    await delay(1400)
    await shot('06-pdf-bookmarks.png')
  }

  // 退出阅读器，打开 Markdown
  await clickText('返回书架')
  await delay(900)
  const mdIndex = await cdp.evaluate(
    '(() => Array.from(document.querySelectorAll(".book")).findIndex(b => (b.getAttribute("title")||"").includes("欢迎")))()'
  )
  await clickSelector('.book', mdIndex >= 0 ? mdIndex : 1)
  await waitFor('document.querySelector(".bs-editor")', '编辑器')
  await delay(1800)
  await shot('07-editor.md.png')

  // 列表视图
  await clickText('返回书架')
  await delay(700)
  await cdp.evaluate(
    '(() => { const n = document.querySelector(".titlebar button[title=\\"列表视图\\"]"); if (n) n.click(); return !!n })()'
  )
  await delay(900)
  await shot('08-shelf-list.png')
  await cdp.evaluate(
    '(() => { const n = document.querySelector(".titlebar button[title=\\"书架视图\\"]"); if (n) n.click(); return !!n })()'
  )
  await delay(600)

  // 设置（标题栏的入口现在叫「设置」，里面再分页）
  await clickText('设置')
  await waitFor('document.querySelector(".set-view")', '设置面板')
  await delay(1300)
  await shot('09-settings-general.png')

  await clickText('外观')
  await delay(1100)
  await shot('10-settings-appearance.png')

  for (const [tab, file] of [
    ['书籍外观', '11-settings-bookstyle.png'],
    ['书架与排序', '12-settings-shelf.png'],
    ['阅读与编辑', '13-settings-reading.png'],
    ['文件与数据', '14-settings-library.png'],
    ['关于', '15-settings-about.png']
  ]) {
    const ok = await cdp.evaluate(
      '(() => { const n = Array.from(document.querySelectorAll(".set-nav-item")).find(x => (x.textContent||"").trim() === ' +
        JSON.stringify(tab) + '); if (!n) return false; n.click(); return true })()'
    )
    if (ok) {
      await delay(1100)
      await shot(file)
    }
  }

  // 换一套深色主题看设置页
  navSeq += 1
  await cdp.send('Page.navigate', { url: baseUrl + '?r=' + navSeq + '#appTheme=midnight&shelfTheme=midnight' })
  await waitFor('document.querySelector(".app-shell")', '应用外壳')
  await delay(1300)
  await clickText('设置')
  await waitFor('document.querySelector(".set-view")', '设置面板')
  await delay(1200)
  await shot('15-settings-dark.png')

  if (consoleErrors.length) {
    console.log('\n页面报错 ' + consoleErrors.length + ' 条：')
    for (const line of consoleErrors.slice(0, 12)) console.log('  ! ' + String(line).split('\n')[0])
  } else {
    console.log('\n页面无 JS 报错')
  }
  console.log('完成。')
} catch (error) {
  console.error('预览失败：' + error.message)
  process.exitCode = 1
} finally {
  try {
    if (cdp) await cdp.send('Browser.close')
  } catch {
    /* 忽略 */
  }
  await delay(600)
  try {
    browser?.kill()
  } catch {
    /* 忽略 */
  }
  server?.close()
}

async function writeFileSafe(file, data) {
  const { writeFile } = await import('node:fs/promises')
  await writeFile(file, data)
}
