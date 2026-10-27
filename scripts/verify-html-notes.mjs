// 针对 HTML 笔记的端到端验证（一次性脚本）。
// 流程：启动真实安装后的应用 → 走应用自己的 importPaths 导入几篇 dsh 笔记 →
//       逐篇打开截图 → 验证完把导入的记录删掉，不给用户的书架留垃圾。
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const exe =
  process.env.BOOKSCENT_VERIFY_EXE ??
  join(process.env.LOCALAPPDATA, 'Programs', 'Bookscent-verify', 'Bookscent.exe')
const outDir = join(root, 'shots-html')
const PORT = 9445

// 三篇有代表性的：
//  - goi/index.html          引用同目录 kanji-data.js（必须能解析相对路径）
//  - keigo-japanese.html     自包含、125 KB、纯内联
//  - music_master/.../index.html  只有 1 KB 的外壳 + design-tokens.css（最容易露馅）
const NOTES = [
  'D:\\Coding\\dsh2\\goi\\index.html',
  'D:\\Coding\\dsh2\\lang_learn\\keigo-japanese.html',
  'D:\\Coding\\dsh2\\music_master\\design\\session-e9aa9391-5715-4602-9080-bf3635b4f3d4\\index.html'
].filter((p) => existsSync(p))

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
      }, 40000)
    })
  }
  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? 'evaluate 失败')
    return result.result?.value
  }
}

const child = spawn(
  exe,
  [
    // 独立的 userData：既避开用户正在运行的那个实例（单实例锁是按 userData 分的），
    // 也保证这次验证不会往用户的书架里塞东西
    `--user-data-dir=${join(process.env.LOCALAPPDATA, 'bookscent-verify')}`,
    `--remote-debugging-port=${PORT}`
  ],
  {
    stdio: 'ignore',
    env: {
      ...process.env,
      // 藏书目录也要跟着走，否则会写进用户共享的「文档\Bookscent 藏书」
      BOOKSCENT_LIBRARY_DIR: join(process.env.LOCALAPPDATA, 'bookscent-verify', 'library')
    }
  }
)
let cdp = null
let importedIds = []

try {
  let wsUrl = null
  for (let i = 0; i < 60 && !wsUrl; i++) {
    await delay(500)
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`)
      const list = await res.json()
      const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl)
      if (page) wsUrl = page.webSocketDebuggerUrl
    } catch {
      /* 还没起来 */
    }
  }
  if (!wsUrl) throw new Error('连不上应用')
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

  await waitFor('document.querySelector(".app-shell")', '应用外壳', 40000)
  await delay(1200)

  // 安全闸：这个脚本会往书库里导入书，绝不能跑在真实配置上
  const appInfo = await cdp.evaluate('window.bookscent.app.info()')
  if (!/verify/i.test(appInfo.userDataDir)) {
    throw new Error(`拒绝在真实配置上跑验证（userDataDir = ${appInfo.userDataDir}）`)
  }
  console.log(`应用已就绪，配置目录 ${appInfo.userDataDir}`)

  /* ---------------------------------------------- 用应用自己的 API 导入 */
  console.log('导入测试笔记（外部引用，不复制）…')
  const imported = await cdp.evaluate(
    `window.bookscent.library.importPaths(${JSON.stringify(NOTES)}, false).then(r => ({ added: r.added.map(b => b.id), skipped: r.skipped }))`
  )
  importedIds = imported.added
  if (imported.skipped.length) console.log('  跳过: ' + JSON.stringify(imported.skipped))

  // 触发界面刷新（走标题栏那个"重新扫描"按钮，等于走真实路径）
  await cdp.evaluate(
    `(() => { const n = document.querySelector('.titlebar button[title*="重新扫描"]'); if (n) n.click(); return !!n })()`
  )
  await delay(2500)

  // 等页数统计补齐（enrich 是后台跑的），再看最终的书名 / 页数 / 字数
  console.log('等待页数统计…')
  for (let i = 0; i < 30; i++) {
    const done = await cdp.evaluate(
      `window.bookscent.library.index().then(idx => ${JSON.stringify(importedIds)}.every(id => { const b = idx.books.find(x => x.id === id); return b && b.pageCount > 0 }))`
    )
    if (done) break
    await delay(500)
  }
  const final = await cdp.evaluate(
    `window.bookscent.library.index().then(idx => ${JSON.stringify(importedIds)}.map(id => { const b = idx.books.find(x => x.id === id); return b ? { id: b.id, title: b.title, pages: b.pageCount, exact: b.pageCountExact, words: b.words } : null }))`
  )
  console.log('  导入结果（统计完成后）:')
  for (const b of final.filter(Boolean)) {
    console.log(`    ${String(b.pages).padStart(4)} 页   ${String(b.words).padStart(6)} 字   ${b.title}`)
  }

  console.log('书架上的书: ' + (await cdp.evaluate(`document.querySelectorAll('.book').length`)))
  await shot('00-shelf-with-html.png')

  /* ------------------------------------------------------ 逐篇打开截图 */
  const targets = [
    ['goi\\index.html', '01-html-kanji-memory.png'],
    ['keigo-japanese', '02-html-keigo.png'],
    ['session-e9aa9391-5715-4602-9080-bf3635b4f3d4\\index.html', '03-html-shell.png']
  ]

  for (const [key, file] of targets) {
    const bookId = await cdp.evaluate(
      `window.bookscent.library.index().then(idx => { const b = idx.books.find(x => x.path.toLowerCase().includes(${JSON.stringify(key.toLowerCase())})); return b ? b.id : null })`
    )
    if (!bookId) {
      console.log(`  跳过 ${key}（没找到）`)
      continue
    }
    await cdp.evaluate(`document.querySelector('.book[data-book-id="${bookId}"]').click()`)
    await waitFor('document.querySelector(".bs-html")', 'HTML 阅读器', 25000)
    await delay(3500)

    const info = await cdp.evaluate(`(() => {
      const frame = document.querySelector('.bs-html-frame')
      const bar = document.querySelector('.bs-html-hint')
      const warn = document.querySelector('.bs-html-warn')
      return {
        hasFrame: !!frame,
        src: frame ? frame.getAttribute('src') : null,
        hint: bar ? bar.textContent : '',
        warn: warn ? warn.textContent : '',
        error: document.querySelector('.bs-html-error h3') ? document.querySelector('.bs-html-error h3').textContent : null
      }
    })()`)
    console.log(`  [${key}]`)
    console.log(`      ${info.hint}${info.warn ? ' | ' + info.warn : ''}${info.error ? ' | 错误: ' + info.error : ''}`)
    console.log(`      src=${info.src}`)
    await shot(file)

    // 回到书架
    await cdp.evaluate(
      `(() => { const n = Array.from(document.querySelectorAll('button')).find(x => (x.textContent||'').trim() === '返回书架'); if (n) n.click() })()`
    )
    await delay(800)
  }

  /* -------------------------------------------------- 清理：删掉测试记录 */
  console.log('清理测试记录…')
  await cdp.evaluate(`window.bookscent.library.removeBooks(${JSON.stringify(importedIds)}, false)`)
  await cdp.evaluate(
    `(() => { const n = document.querySelector('.titlebar button[title*="重新扫描"]'); if (n) n.click(); return !!n })()`
  )
  await delay(1500)
  console.log('清理后书架上的书: ' + (await cdp.evaluate(`document.querySelectorAll('.book').length`)))

  console.log('\n完成，截图在 shots-html/')
} catch (error) {
  console.error('失败：' + error.message)
  const log = join(process.env.APPDATA, 'bookscent', 'startup.log')
  if (existsSync(log)) {
    console.log('\n=== 启动日志尾部 ===')
    console.log(readFileSync(log, 'utf8').split('\n').slice(-25).join('\n'))
  }
  process.exitCode = 1
  try {
    if (importedIds.length && cdp) await cdp.evaluate(`window.bookscent.library.removeBooks(${JSON.stringify(importedIds)}, false)`)
  } catch {
    /* 忽略 */
  }
} finally {
  try {
    if (cdp) await cdp.send('Browser.close')
  } catch {
    /* 忽略 */
  }
  await delay(600)
  try {
    child.kill()
  } catch {
    /* 忽略 */
  }
}
