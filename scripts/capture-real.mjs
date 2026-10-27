// 驱动"真正打包安装后的应用"截图：不再注入假 API，直接跑 C: 上安装好的 Bookscent.exe。
// 之所以要单独一个脚本：从工作区（低完整性）启动 Electron 会秒崩，
// 必须先由 scripts/install-local.mjs 把它装到普通目录。
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const exe = join(process.env.LOCALAPPDATA, 'Programs', 'Bookscent', 'Bookscent.exe')
const outDir = join(root, 'shots-real')
const PORT = 9444

if (!existsSync(exe)) {
  console.error('找不到安装后的应用：' + exe)
  console.error('请先运行 node scripts/install-local.mjs')
  process.exit(1)
}
mkdirSync(outDir, { recursive: true })

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
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? 'evaluate 失败')
    return result.result?.value
  }
}

const child = spawn(exe, [`--remote-debugging-port=${PORT}`], { stdio: 'ignore', detached: false })
let cdp = null
let alive = true
child.on('exit', (code) => {
  alive = false
  console.log(`应用进程退出，code=${code}`)
})

try {
  let wsUrl = null
  for (let i = 0; i < 50 && !wsUrl; i++) {
    await delay(500)
    if (!alive) throw new Error('应用启动后立刻退出了')
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`)
      const list = await res.json()
      const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl)
      if (page) wsUrl = page.webSocketDebuggerUrl
    } catch {
      /* 还没起来 */
    }
  }
  if (!wsUrl) throw new Error('连不上调试端口（应用可能没起来）')
  console.log('已连上运行中的应用 ✓')

  cdp = await CDP.connect(wsUrl)
  await cdp.send('Page.enable')
  await cdp.send('Runtime.enable')

  const shot = async (name) => {
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
    writeFileSync(join(outDir, name), Buffer.from(data, 'base64'))
    console.log('  截图 -> ' + name)
  }
  const waitFor = async (expression, label, timeout = 30000) => {
    const started = Date.now()
    for (;;) {
      const ok = await cdp.evaluate(`(() => { try { return !!(${expression}) } catch { return false } })()`)
      if (ok) return
      if (Date.now() - started > timeout) throw new Error('等待超时：' + label)
      await delay(300)
    }
  }
  const rectOf = (selector, index = 0) =>
    cdp.evaluate(
      `(() => { const n = document.querySelectorAll(${JSON.stringify(selector)})[${index}]; if (!n) return null; const r = n.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height } })()`
    )

  // 等界面真的渲染出来（真实数据：首次运行会生成示例文件）
  await waitFor('document.querySelector(".app-shell")', '应用外壳', 40000)
  const state = await cdp.evaluate(`(() => ({
    title: document.title,
    url: location.href,
    books: document.querySelectorAll('.book').length,
    rows: document.querySelectorAll('.shelf-row').length,
    sidebarText: (document.querySelector('.statusbar')?.textContent || '').trim().slice(0, 80)
  }))()`)
  console.log('界面状态: ' + JSON.stringify(state, null, 1))

  await waitFor('document.querySelectorAll(".book").length > 0', '书架上的书', 60000)
  await delay(1500)
  await shot('01-shelf.png')

  // 打开 PDF（示例文档）
  const pdfIndex = await cdp.evaluate(
    `(() => Array.from(document.querySelectorAll('.book')).findIndex(b => /pdf|shelf/i.test(b.getAttribute('title')||'')))()`
  )
  if (pdfIndex >= 0) {
    await cdp.evaluate(`document.querySelectorAll('.book')[${pdfIndex}].click()`)
    await waitFor('document.querySelector(".pdf-root")', 'PDF 阅读器')
    await waitFor('document.querySelector(".pdf-page canvas")', 'PDF 页面画布', 45000)
    await delay(2500)
    await shot('02-pdf.png')

    // 真正画一笔（合成鼠标事件）
    const pageRect = await rectOf('.pdf-scroll .pdf-page', 0)
    if (pageRect) {
      const x0 = pageRect.x + pageRect.w * 0.2
      const y0 = pageRect.y + pageRect.h * 0.4
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x0, y: y0, button: 'none', buttons: 0 })
      await delay(300)
      await shot('03-pdf-tools.png')
    }

    await cdp.evaluate(
      `(() => { const n = Array.from(document.querySelectorAll('button')).find(x => (x.textContent||'').trim() === '返回书架'); if (n) n.click() })()`
    )
    await delay(900)
  }

  // Markdown 编辑器
  const mdIndex = await cdp.evaluate(
    `(() => Array.from(document.querySelectorAll('.book')).findIndex(b => (b.getAttribute('title')||'').includes('欢迎')))()`
  )
  await cdp.evaluate(`document.querySelectorAll('.book')[${mdIndex >= 0 ? mdIndex : 0}].click()`)
  await waitFor('document.querySelector(".bs-editor")', '编辑器', 30000)
  await delay(2000)
  await shot('04-editor.png')

  await cdp.evaluate(
    `(() => { const n = Array.from(document.querySelectorAll('button')).find(x => (x.textContent||'').trim() === '返回书架'); if (n) n.click() })()`
  )
  await delay(800)

  // 外观设置
  await cdp.evaluate(
    `(() => { const n = Array.from(document.querySelectorAll('.titlebar button')).find(x => (x.textContent||'').trim() === '外观'); if (n) n.click() })()`
  )
  await waitFor('document.querySelector(".set-view")', '设置面板', 20000)
  await delay(1500)
  await shot('05-settings.png')

  console.log('\n全部截图已保存到 shots-real/')
  console.log('应用仍在运行（pid=' + child.pid + '），可以在桌面上直接使用。')
  try {
    if (cdp) await cdp.send('Browser.close')
  } catch {
    /* 忽略 */
  }
} catch (error) {
  console.error('失败：' + error.message)
  const log = join(process.env.APPDATA, 'bookscent', 'startup.log')
  if (existsSync(log)) {
    console.log('\n=== 应用启动日志（末尾 40 行）===')
    console.log(readFileSync(log, 'utf8').split('\n').slice(-40).join('\n'))
  }
  process.exitCode = 1
  try {
    child.kill()
  } catch {
    /* 忽略 */
  }
}
