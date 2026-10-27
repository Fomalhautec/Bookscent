import { runVocab } from './probe-vocab.mjs'
import { runTts } from './probe-tts.mjs'
import { runV0101b } from './probe-v0101b.mjs'
import { runKeys } from './probe-keys.mjs'
import { runClean } from './probe-clean.mjs'
import { runMulti } from './probe-multi.mjs'
import { runV0101 } from './probe-v0101.mjs'
import { runTranslate } from './probe-translate.mjs'
// 全量逐项验证：在真实打包后的应用里跑，用独立 profile，不碰用户书架。
//
// 两个隔离都要做：`--user-data-dir` 管住配置与索引，
// `BOOKSCENT_LIBRARY_DIR` 管住藏书目录（否则 createNote 会写进用户共享的「文档\Bookscent 藏书」，
// 用户那份正开着的应用一扫就全收进他书架了）。
import { spawn } from 'node:child_process'
import { runFix98 } from './probe-fix98.mjs'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const expectedVersion = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version
// 默认用独立的验证副本，免得跟你正开着的应用抢文件
const exe =
  process.env.BOOKSCENT_VERIFY_EXE ??
  join(process.env.LOCALAPPDATA, 'Programs', 'Bookscent-verify', 'Bookscent.exe')
const outDir = join(root, 'shots-verify')
const PORT = 9446

const NOTES = [
  'D:\\Coding\\dsh2\\goi\\index.html',
  'D:\\Coding\\dsh2\\lang_learn\\keigo-japanese.html',
  'D:\\Coding\\dsh2\\lang_learn\\kanji-multi-verb.html',
  'D:\\Coding\\dsh2\\goi\\kanji-memory.html'
].filter((p) => existsSync(p))

mkdirSync(outDir, { recursive: true })

class CDP {
  constructor(ws) {
    this.ws = ws
    this.seq = 0
    this.pending = new Map()
    /** 渲染进程的 console 输出（排查书立这类"手点没反应"时最有用） */
    this.consoleLines = []
    ws.addEventListener('message', (event) => {
      const msg = JSON.parse(event.data)
      if (msg.method === 'Runtime.consoleAPICalled') {
        const text = (msg.params?.args ?? [])
          .map((a) => (a.value !== undefined ? String(a.value) : a.description ?? a.type))
          .join(' ')
        this.consoleLines.push(`[${msg.params?.type ?? 'log'}] ${text}`)
        return
      }
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id)
        this.pending.delete(msg.id)
        if (msg.error) reject(new Error(msg.error.message))
        else resolve(msg.result)
      }
    })
  }
  /** 取出并清空积累的 console 输出 */
  drainConsole() {
    const lines = this.consoleLines
    this.consoleLines = []
    return lines
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
    `--user-data-dir=${join(process.env.LOCALAPPDATA, 'bookscent-verify-app')}`,
    `--remote-debugging-port=${PORT}`,
    /*
     * 设了 OPEN_FILE 就把文件路径当启动参数带上 ——
     * 这正是系统「打开方式」/双击关联文件时应用收到的参数，
     * 用来验证"临时打开"的真实路径（而不是从内部 API 绕进去）。
     */
    ...(process.env.OPEN_FILE ? [process.env.OPEN_FILE] : [])
  ],
  {
    stdio: 'ignore',
    env: {
      ...process.env,
      // 一定要把藏书目录也指到临时目录：默认是「文档\Bookscent 藏书」，
      // 往里写测试文件的话，用户正开着的那份应用一扫就全进他书架了。
      BOOKSCENT_LIBRARY_DIR: join(process.env.LOCALAPPDATA, 'bookscent-verify-app', 'library')
    }
  }
)

const problems = []
/** ONLY=bookend 时用来跳到收尾的哨兵（顶层 try 里不能 return） */
const ONLY_DONE = Symbol('only-done')
let cdp = null

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

  /*
   * 给每次求值留个"当前在做什么"的记录。
   *
   * 渲染进程被布局自激堵住时，CDP 求值会超时，但报错只说"超时"，
   * 而卡点在不同环境/不同运行里还会漂移 —— 没有这条记录就只能靠猜。
   * 这里把正在飞的那条表达式记下来，超时时打出来，直接指出卡在哪一步。
   */
  let inFlight = ''
  const rawEvaluate = cdp.evaluate.bind(cdp)
  cdp.evaluate = async (expression, ...rest) => {
    inFlight = String(expression).replace(/\s+/g, ' ').slice(0, 160)
    const started = Date.now()
    try {
      return await rawEvaluate(expression, ...rest)
    } catch (error) {
      const spent = ((Date.now() - started) / 1000).toFixed(1)
      console.log(`    ✗ 求值失败（${spent}s）：${inFlight}`)
      throw error
    }
  }
  const rawSend = cdp.send.bind(cdp)
  cdp.send = async (method, params) => {
    if (method !== 'Page.captureScreenshot') return rawSend(method, params)
    inFlight = `Page.captureScreenshot（截图）`
    const started = Date.now()
    try {
      return await rawSend(method, params)
    } catch (error) {
      console.log(`    ✗ 截图失败（${((Date.now() - started) / 1000).toFixed(1)}s）：${inFlight}`)
      throw error
    }
  }

  const shot = async (name, wait = 400) => {
    if (wait) await delay(wait)
    /*
     * 截图**绝不能**拖垮整轮验证。
     *
     * 以前这里是"等两帧"（双 requestAnimationFrame）。渲染进程忙于合成时
     * （大量图片解码、书架重排、刚重载完）rAF 迟迟不来 —— 求值 40 秒超时抛错，
     * 把后面所有断言一起带走。我为此白跑了好几轮，还一度误以为主进程被扫描堵住。
     * rAF 只是为了让画面画完，用 setTimeout 兜底等待效果一样，而且不会卡死；
     * 真截不到就记一行继续，别让截图决定验证成败。
     */
    try {
      await cdp.evaluate(
        'new Promise((r) => { const t = setTimeout(() => r(1), 300); requestAnimationFrame(() => requestAnimationFrame(() => { clearTimeout(t); r(1) })) })'
      )
      const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
      writeFileSync(join(outDir, name), Buffer.from(data, 'base64'))
      console.log('  · ' + name)
    } catch (error) {
      console.log(`  · ${name} 截图跳过（${String(error)}）`)
    }
  }
  /** 用真实鼠标事件，比 dispatchEvent 更接近用户操作 */
  const mouse = async (type, x, y, extra = {}) => {
    await cdp.send('Input.dispatchMouseEvent', {
      type,
      x: Math.round(x),
      y: Math.round(y),
      button: 'left',
      buttons: type === 'mouseReleased' ? 0 : 1,
      clickCount: 1,
      ...extra
    })
  }
  const waitFor = async (expr, label, timeout = 30000) => {
    const started = Date.now()
    for (;;) {
      const ok = await cdp.evaluate(`(() => { try { return !!(${expr}) } catch { return false } })()`)
      if (ok) return
      if (Date.now() - started > timeout) throw new Error('等待超时：' + label)
      await delay(250)
    }
  }
  const patch = async (ui) => {
    // 注意：直接调 window.bookscent.settings.patch 只改了主进程的设置文件，
    // 渲染层的 zustand store 不会收到通知。所以改完必须重载页面，
    // 顺便也验证了设置确实落盘了。
    await cdp.evaluate(`window.bookscent.settings.patch(${JSON.stringify({ ui })}).then(() => true)`)
    await delay(250)
    await cdp.evaluate('location.reload()')
    await delay(600)
    await waitFor('document.querySelector(".app-shell")', '应用外壳', 30000)
    await waitFor('document.querySelector(".shelf-toolbar, .set-view")', '界面就绪', 20000)
    await delay(700)
  }
  /** 非 ui 字段（spineStyleMode 之类）直接 patch 根对象 */
  const patchRaw = async (partial) => {
    await cdp.evaluate(`window.bookscent.settings.patch(${JSON.stringify(partial)}).then(() => true)`)
    await delay(250)
    await cdp.evaluate('location.reload()')
    await delay(600)
    await waitFor('document.querySelector(".app-shell")', '应用外壳', 30000)
    await waitFor('document.querySelector(".shelf-toolbar, .set-view")', '界面就绪', 20000)
    await delay(700)
  }
  /** 关掉可能挡住书架的浮层 */
  const closeOverlays = async () => {
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
    await cdp.evaluate(`(() => { const b = document.querySelector('.shelf-toolbar button'); if (b) b.click(); return true })()`)
    await cdp.evaluate(`(() => { const b = document.querySelector('.shelf-toolbar button'); if (b) b.click(); return true })()`)
    await delay(350)
  }
  const check = (name, ok, detail) => {
    console.log(`    ${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`)
    if (!ok) problems.push(`${name}${detail ? `：${detail}` : ''}`)
  }

  /**
   * 只查书立（ONLY=bookend）。
   *
   * 这一节存在的理由：书立"点不动"的问题我验了两轮都没抓到，因为
   *   1) 老用例是用 dispatchEvent 直接往元素上派事件 —— 哪怕元素
   *      用户根本点不到也会"成功"；
   *   2) 整轮脚本很长，前面卡住时这一节会在"书架上一本书都没有"
   *      的状态下静默跳过，而日志里"跳过"和"通过"长得一样。
   * 所以这里只做一件事：用**真实坐标**点它。
   */
  /**
   * 冷启动就检查书架排布（ONLY=shelf）。
   *
   * 用户报的现象：刚进应用时每行只排两三本，过一下才跳成填满整行。
   * 那是"宽度还没量到就被当成 0"造成的（0 会被兜成 240px 的预算）。
   * 所以这一节要在**刚启动、立刻**取样，晚一点取就看不到问题了。
   */
  async function runShelfProbe() {
    await waitFor('document.querySelector(".shelf-view")', '书架外壳', 30000)

    // 尽可能早地连取几帧，记录宽度与每行本数
    const samples = []
    for (let i = 0; i < 24; i++) {
      const snap = await cdp.evaluate(`(() => {
        const view = document.querySelector('.shelf-view')
        if (!view) return null
        const rows = Array.from(document.querySelectorAll('.shelf-books'))
        const counts = rows.map((r) => r.querySelectorAll('.book[data-book-id]').length)
        return {
          available: Number(view.getAttribute('data-available') || 0),
          rowCounts: counts,
          maxInRow: counts.length ? Math.max(...counts) : 0,
          books: document.querySelectorAll('.book[data-book-id]').length
        }
      })()`)
      if (snap) samples.push({ t: i * 60, ...snap })
      await delay(60)
    }

    const first = samples.find((s) => s.books > 0)
    const last = samples.filter((s) => s.books > 0).pop()
    console.log(`\n[仅书架] 取样 ${samples.length} 次`)
    console.log(`    首次有书：${JSON.stringify(first)}`)
    console.log(`    最终：    ${JSON.stringify(last)}`)
    const early = samples.filter((s) => s.books > 0).slice(0, 3)
    check(
      '刚进应用时宽度就已量到（不是 0）',
      early.every((s) => s.available > 600),
      early.map((s) => `${s.t}ms:${s.available}`).join(' ')
    )
    check(
      '刚进应用时每行就已经填满（不是只排两三本）',
      early.every((s) => s.maxInRow >= 4),
      early.map((s) => `${s.t}ms:最多${s.maxInRow}本`).join(' ')
    )
    check(
      '首帧与最终排布一致（没有可见重排）',
      Boolean(first && last) && first.maxInRow === last.maxInRow,
      `首帧最多 ${first?.maxInRow} 本 → 最终最多 ${last?.maxInRow} 本`
    )
  }

  /** 只查 EPUB 阅读器（ONLY=epub），方便快速迭代 */
  async function runEpubProbe() {
    await waitFor('document.querySelector(".app-shell")', '应用外壳', 30000)
    await delay(1200)
    const epubPath = join(root, 'samples', '示例电子书.epub')
    await cdp.evaluate(
      `window.bookscent.library.importPaths([${JSON.stringify(epubPath)}], false).then(r => r.added.length)`
    )
    await cdp.evaluate(
      `(() => { const n = document.querySelector('.titlebar button[title*="重新扫描"]'); if (n) n.click(); return !!n })()`
    )
    await delay(2500)
    const id = await cdp.evaluate(
      `window.bookscent.library.index().then(i => (i.books.find(b => b.format === 'epub') || {}).id ?? null)`
    )
    if (!id) {
      check('导入了示例 epub', false)
      return
    }
    await cdp.evaluate(`document.querySelector('.book[data-book-id="${id}"]')?.click()`)
    await delay(3500)
    const state = await cdp.evaluate(`(() => {
      const view = document.querySelector('.epub-foliate')
      const host = document.querySelector('.epub-foliate-host')
      const r = host ? host.getBoundingClientRect() : null
      return {
        foliate: Boolean(view),
        hostSize: r ? { w: Math.round(r.width), h: Math.round(r.height) } : null,
        toc: document.querySelectorAll('.epub-toc-list button').length,
        tocFirst: (document.querySelector('.epub-toc-list button') || {}).textContent || null,
        percent: (document.querySelector('.epub-bar-count') || {}).textContent || null,
        empty: Boolean(document.querySelector('.epub-empty')),
        error: (document.querySelector('.epub-empty p') || {}).textContent || null,
        writing: Array.from(document.querySelectorAll('.epub-seg button.is-active')).map(b => (b.textContent||'').trim())
      }
    })()`)
    console.log(`\n[仅 EPUB] ${JSON.stringify(state)}`)
    check('foliate-view 已挂上', state.foliate === true)
    check('宿主有尺寸', Boolean(state.hostSize && state.hostSize.w > 300 && state.hostSize.h > 200), JSON.stringify(state.hostSize))
    check('没有落到失败态', state.empty === false, state.error ?? '')
    check('目录解析出来了', state.toc > 0, `${state.toc} 项，首项 ${state.tocFirst}`)
    await shot('40-epub-foliate.png', 500)

    /*
     * 切排版方向：点工具栏上真的按钮，而不是直接 patch 设置。
     * 直接调 window.bookscent.settings.patch() 只写了主进程的设置文件，
     * 渲染层的 store 不会更新 —— 这个坑以前踩过。
     */
    const clickWriting = async (label) => {
      const ok = await cdp.evaluate(`(() => {
        const btn = Array.from(document.querySelectorAll('.epub-seg button'))
          .find(b => (b.textContent||'').trim() === ${JSON.stringify(label)})
        if (!btn) return false
        btn.click()
        return true
      })()`)
      await delay(4200)
      return ok
    }

    const verticalClicked = await clickWriting('竖')
    const vertical = await cdp.evaluate(`(() => ({
      foliate: document.querySelectorAll('.epub-foliate').length,
      percent: (document.querySelector('.epub-bar-count') || {}).textContent || null,
      empty: Boolean(document.querySelector('.epub-empty')),
      active: Array.from(document.querySelectorAll('.epub-seg button.is-active')).map(b => (b.textContent||'').trim())
    }))()`)
    console.log(`    竖排后 ${JSON.stringify(vertical)}`)
    check('工具栏上能点到「竖」', verticalClicked)
    check('切竖排后仍有且只有一个 view', vertical.foliate === 1, String(vertical.foliate))
    check('切竖排没有掉进失败态', vertical.empty === false)
    check('竖排按钮处于选中', vertical.active.includes('竖'), vertical.active.join('/'))
    await shot('41-epub-vertical.png', 500)

    const horizontalClicked = await clickWriting('横')
    const horizontal = await cdp.evaluate(`(() => ({
      foliate: document.querySelectorAll('.epub-foliate').length,
      percent: (document.querySelector('.epub-bar-count') || {}).textContent || null,
      empty: Boolean(document.querySelector('.epub-empty')),
      active: Array.from(document.querySelectorAll('.epub-seg button.is-active')).map(b => (b.textContent||'').trim())
    }))()`)
    console.log(`    横排后 ${JSON.stringify(horizontal)}`)
    check('工具栏上能点到「横」', horizontalClicked)
    check('切横排后仍有且只有一个 view', horizontal.foliate === 1, String(horizontal.foliate))
    check('切横排没有掉进失败态', horizontal.empty === false)
    await shot('42-epub-horizontal.png', 500)

    // 位置要能跨排版方向保住（CFI 恢复）—— 必须在跳去别的章节之前查
    check(
      '切排版方向时位置没有丢',
      vertical.percent === state.percent && horizontal.percent === state.percent,
      `${state.percent} → 竖 ${vertical.percent} → 横 ${horizontal.percent}`
    )

    // 切回「跟随书籍」再测原生竖排。
    // 注意「书」那个按钮里只有一个图标、textContent 是空的，不能按文字找 ——
    // 它是排版方向那一组的第一个按钮，取 `.epub-bar .epub-seg button` 就对了。
    const resetToAuto = await cdp.evaluate(`(() => {
      const b = document.querySelector('.epub-bar .epub-seg button')
      if (!b) return false
      b.click()
      return true
    })()`)
    check('能把排版方向切回「跟随书籍」', resetToAuto)
    await delay(5000)

    /*
     * 原生竖排的那一节（示例书第四章，writing-mode 直接写在 html/body 上）。
     * 这是"文档确实是竖排"的唯一用例 —— 真实日文书的竖排常常藏在工具类里，
     * 光看 OPF 的 rtl 会误判。
     */
    const jumped = await cdp.evaluate(`(() => {
      const b = Array.from(document.querySelectorAll('.epub-toc-list button'))
        .find(x => /竖排/.test((x.textContent||'').trim()))
      if (!b) return null
      b.click()
      return (b.textContent||'').trim()
    })()`)
    check('目录里有竖排那一节', Boolean(jumped), String(jumped))
    await delay(4000)
    const nativeVertical = await cdp.evaluate(`(() => {
      const root = document.querySelector('.epub-view')
      return {
        direction: root?.getAttribute('data-epub-direction') ?? null,
        vertical: root?.getAttribute('data-epub-vertical') ?? null,
        writing: root?.getAttribute('data-epub-writing') ?? null,
        leftTitle: document.querySelector('.epub-flip-zone.is-left')?.getAttribute('title') ?? null,
        scrollTitle: Array.from(document.querySelectorAll('.epub-seg button'))
          .map(b => b.getAttribute('title') || '').find(t => /滚动/.test(t)) ?? null
      }
    })()`)
    console.log(`    原生竖排节 ${JSON.stringify(nativeVertical)}`)
    check('原生竖排节被识别为竖排', nativeVertical.vertical === 'yes', nativeVertical.writing ?? '')
    check('原生竖排节被识别为 rtl', nativeVertical.direction === 'rtl', String(nativeVertical.direction))
    check(
      '原生竖排节：左侧是「下一页」',
      /下一/.test(nativeVertical.leftTitle ?? ''),
      String(nativeVertical.leftTitle)
    )
    check(
      '原生竖排节：滚动按钮改称「左右滚动」',
      /左右滚动/.test(nativeVertical.scrollTitle ?? ''),
      String(nativeVertical.scrollTitle)
    )
    const beforeV = await cdp.evaluate(
      `Number(document.querySelector('.epub-view')?.getAttribute('data-epub-fraction'))`
    )
    await cdp.evaluate(`(() => { const z = document.querySelector('.epub-flip-zone.is-left'); if (z) z.click(); return !!z })()`)
    await delay(1500)
    const afterV = await cdp.evaluate(
      `Number(document.querySelector('.epub-view')?.getAttribute('data-epub-fraction'))`
    )
    check('原生竖排节：点左侧是往后翻', afterV > beforeV, `${beforeV} → ${afterV}`)
    await shot('45-epub-native-vertical.png', 500)

    // 横排书不该因为这一节变过而受影响：切回第一章确认方向回到 ltr
    await cdp.evaluate(`(() => {
      const b = Array.from(document.querySelectorAll('.epub-toc-list button'))
        .find(x => /第一章/.test((x.textContent||'').trim()))
      if (b) b.click()
      return !!b
    })()`)
    await delay(3500)
    const backToLtr = await cdp.evaluate(`(() => {
      const root = document.querySelector('.epub-view')
      return {
        direction: root?.getAttribute('data-epub-direction') ?? null,
        vertical: root?.getAttribute('data-epub-vertical') ?? null,
        writing: root?.getAttribute('data-epub-writing') ?? null
      }
    })()`)
    console.log(`    回到第一章 ${JSON.stringify(backToLtr)}`)
    check(
      '换回横排章节后方向变回 ltr',
      backToLtr.direction === 'ltr' && backToLtr.vertical === 'no',
      JSON.stringify(backToLtr)
    )

    await runEpubNavigationProbe()
  }

  /**
   * 翻页方向：这是用户报的那个不一致。
   *
   * 原生日文竖排书（OPF 里 page-progression-direction="rtl"）里，
   * foliate 的 goRight() 实际是 prev()，所以"下一页"按钮会往回翻；
   * 而手动强制竖排的书（OPF 仍是 ltr）却是正常往前翻 —— 同样是竖排，行为不一样。
   *
   * 现在统一成：按钮按阅读顺序，点击区/方向键按屏幕方向；
   * 屏幕方向由「OPF 声明 rtl」或「文档实际竖排」决定。
   */
  async function runEpubNavigationProbe() {
    const jp = process.env.JP_EPUB
    if (!jp || !existsSync(jp)) {
      console.log('    （没给 JP_EPUB，跳过原生竖排书的翻页方向检查）')
      return
    }

    console.log('\n[0.7.1-a] 翻页方向（原生竖排日文书）')
    const importResult = await cdp.evaluate(
      `window.bookscent.library.importPaths([${JSON.stringify(jp)}], false).then(r => r.added.length)`
    )
    console.log(`    导入返回 added=${importResult}`)
    /*
     * 必须再扫一次。
     * importPaths 只把书写进主进程的索引，渲染层的书库不会自己更新 ——
     * 少了这一步，按 id 查得到书、书架上却没有它的元素（我就在这里白跑了一轮）。
     */
    await cdp.evaluate(
      `(() => { const n = document.querySelector('.titlebar button[title*="重新扫描"]'); if (n) n.click(); return !!n })()`
    )
    await delay(2500)
    const jpId = await cdp.evaluate(`(() => {
      const want = ${JSON.stringify(jp.split(/[\\/]/).pop())}
      return window.bookscent.library.index().then(i =>
        (i.books.find(b => b.path.endsWith(want)) || i.books.find(b => /性悪|幼馴染/.test(b.title)) || {}).id ?? null)
    })()`)
    if (!jpId) {
      check('导入了日文竖排书', false, jp)
      return
    }
    /*
     * 先把排版方向设回「跟随书籍」——必须在阅读器还开着的时候点。
     * 上面示例书那一节最后停在「横」，而强制模式注入的 writing-mode 带 !important，
     * 会把这本书自身的竖排按成横排，结果就是"怎么翻都不竖"。
     */
    const resetMode = await cdp.evaluate(`(() => {
      const b = document.querySelector('.epub-bar .epub-seg button')
      if (!b) return false
      b.click()
      return true
    })()`)
    console.log(`    排版方向已重置为「跟随书籍」：${resetMode}`)
    await delay(2500)

    // 回书架再打开（返回按钮只有文案，没有专门的 class，就取 reader-bar 里的第一个按钮）
    await cdp.evaluate(`(() => {
      const b = document.querySelector('.reader-bar button')
      if (b) b.click()
      return !!b
    })()`)
    await delay(2000)
    const opened = await cdp.evaluate(`(() => {
      const el = document.querySelector('.book[data-book-id="${jpId}"]')
      if (!el) return false
      el.click()
      return true
    })()`)
    check('能在书架上找到并打开日文竖排书', opened)
    await delay(7000)

    const readState = async () =>
      cdp.evaluate(`(() => {
        const root = document.querySelector('.epub-view')
        return {
          direction: root?.getAttribute('data-epub-direction') ?? null,
          vertical: root?.getAttribute('data-epub-vertical') ?? null,
          writing: root?.getAttribute('data-epub-writing') ?? null,
          fraction: Number(root?.getAttribute('data-epub-fraction') ?? -1),
          zones: document.querySelectorAll('.epub-flip-zone').length,
          leftTitle: document.querySelector('.epub-flip-zone.is-left')?.getAttribute('title') ?? null,
          rightTitle: document.querySelector('.epub-flip-zone.is-right')?.getAttribute('title') ?? null,
          scrollTitle: Array.from(document.querySelectorAll('.epub-seg button'))
            .map(b => b.getAttribute('title') || '').find(t => /滚动/.test(t)) ?? null
        }
      })()`)

    const clickNext = async () => {
      const btn = await cdp.evaluate(`(() => {
        const b = Array.from(document.querySelectorAll('.epub-bar button'))
          .find(x => (x.textContent||'').trim() === '下一页')
        if (!b) return false
        b.click()
        return true
      })()`)
      await delay(1200)
      return btn
    }

    /*
     * 这本轻小说前面是一串插图页（每页就一张图、几乎没有字），
     * 目录里的「プロローグ」也还在插图区 —— 竖排正文要往后翻好几页才到。
     * 先跳目录里第一个"编号章节"，再往后走几页兜底。
     * 顺带也就验证了"点下一页确实是往前走"。
     */
    const jumpTarget = await cdp.evaluate(`(() => {
      const items = Array.from(document.querySelectorAll('.epub-toc-list button'))
      const t = items.find(b => /^[0-9１-９][ 　]/.test((b.textContent||'').trim()))
      if (!t) return null
      t.click()
      return (t.textContent||'').trim()
    })()`)
    console.log(`    跳到 ${JSON.stringify(jumpTarget)}`)
    await delay(3500)

    const walk = []
    let bodyPage = null
    for (let i = 0; i < 10; i++) {
      const now = await readState()
      walk.push({ i, v: now.vertical, w: now.writing, f: now.fraction })
      if (now.vertical === 'yes') {
        bodyPage = now
        break
      }
      await clickNext()
    }
    console.log(`    走过 ${JSON.stringify(walk)}`)
    console.log(`    翻到竖排正文 ${JSON.stringify(bodyPage)}`)
    /*
     * 用分页器自己的 getContents() 取真值 —— 它的 shadow root 是 closed，
     * 只有这条路能看到 iframe 里的文档到底算出来什么。
     * 我的检测和它必须一致，否则就是我在自说自话。
     */
    const truth = await cdp.evaluate(`(() => {
      const v = document.querySelector('.epub-foliate')
      try {
        const list = v?.renderer?.getContents?.() ?? []
        return list.map(x => ({
          index: x.index,
          htmlClass: x.doc?.documentElement?.className ?? '',
          htmlDir: x.doc?.documentElement?.dir ?? '',
          htmlWriting: x.doc?.documentElement ? getComputedStyle(x.doc.documentElement).writingMode : null,
          bodyWriting: x.doc?.body ? getComputedStyle(x.doc.body).writingMode : null,
          bodyClass: x.doc?.body?.className ?? ''
        }))
      } catch (e) { return 'ERR ' + e.message }
    })()`)
    console.log(`    分页器眼里的文档 ${JSON.stringify(truth)}`)
    /*
     * 交叉验证：分页器自己算出来的 writing-mode 必须和界面报的一致。
     * 两边不一致的话，"点左边是下一页"就会和实际分栏方向对不上 ——
     * 而这正是最开始那个 bug 的形态（foliate 的 goLeft/goRight 只看 OPF，
     * 分页器却按文档判定，两者打架）。
     */
    const paginatorVertical = Array.isArray(truth)
      ? truth.some((x) => String(x.htmlWriting).startsWith('vertical'))
      : false
    check(
      '分页器与界面判定的排版方向一致',
      paginatorVertical === (bodyPage.vertical === 'yes'),
      `分页器 ${paginatorVertical ? '竖排' : '横排'} / 界面 ${bodyPage.vertical}`
    )
    check(
      '往后翻能进入竖排正文（轻小说前面是插图页）',
      Boolean(bodyPage),
      walk.map((x) => x.w).join(' → ').slice(0, 120)
    )
    if (!bodyPage) return

    const monotonic = walk.every((x, idx) => idx === 0 || x.f > walk[idx - 1].f)
    check(
      '点「下一页」进度单调向前（这就是要统一的行为）',
      monotonic,
      walk.map((x) => x.f).join(' → ')
    )
    check('正文页被识别为 rtl', bodyPage.direction === 'rtl', String(bodyPage.direction))
    check('正文页左侧是「下一页」', /下一/.test(bodyPage.leftTitle ?? ''), String(bodyPage.leftTitle))
    check('正文页右侧是「上一页」', /上一/.test(bodyPage.rightTitle ?? ''), String(bodyPage.rightTitle))
    check('左右两侧有翻页点击区', bodyPage.zones === 2, String(bodyPage.zones))
    check(
      '竖排时滚动按钮改称「左右滚动」',
      /左右滚动/.test(bodyPage.scrollTitle ?? ''),
      String(bodyPage.scrollTitle)
    )
    await shot('43-epub-jp-vertical.png', 500)

    // 竖排正文里点左侧 = 下一页
    const beforeLeft = (await readState()).fraction
    await cdp.evaluate(`(() => { const z = document.querySelector('.epub-flip-zone.is-left'); if (z) z.click(); return !!z })()`)
    await delay(1400)
    const afterLeft = (await readState()).fraction
    check('竖排正文：点左侧是往后翻', afterLeft > beforeLeft, `${beforeLeft} → ${afterLeft}`)

    // 点右侧 = 上一页
    const beforeRight = (await readState()).fraction
    await cdp.evaluate(`(() => { const z = document.querySelector('.epub-flip-zone.is-right'); if (z) z.click(); return !!z })()`)
    await delay(1400)
    const afterRight = (await readState()).fraction
    check('竖排正文：点右侧是往回翻', afterRight < beforeRight, `${beforeRight} → ${afterRight}`)

    /*
     * 再把这本**原生竖排**的书强制横排：
     * 文档变成 horizontal-tb 之后，方向必须跟着回到 ltr（右侧才是下一页），
     * 否则点击区和版面就对不上了。
     */
    await cdp.evaluate(`(() => {
      const b = Array.from(document.querySelectorAll('.epub-seg button')).find(x => (x.textContent||'').trim() === '横')
      if (b) b.click()
      return !!b
    })()`)
    await delay(5000)
    const flat = await readState()
    console.log(`    强制横排后 ${JSON.stringify(flat)}`)
    check('原生竖排书强制横排后方向变为 ltr', flat.direction === 'ltr', String(flat.direction))
    check('强制横排后右侧是「下一页」', /下一/.test(flat.rightTitle ?? ''), String(flat.rightTitle))
    check('强制横排后左侧是「上一页」', /上一/.test(flat.leftTitle ?? ''), String(flat.leftTitle))
    check(
      '强制横排后滚动按钮改回「上下滚动」',
      /上下滚动/.test(flat.scrollTitle ?? ''),
      String(flat.scrollTitle)
    )
    const beforeFlatRight = (await readState()).fraction
    await cdp.evaluate(`(() => { const z = document.querySelector('.epub-flip-zone.is-right'); if (z) z.click(); return !!z })()`)
    await delay(1400)
    const afterFlatRight = (await readState()).fraction
    check('强制横排后：点右侧是往后翻', afterFlatRight > beforeFlatRight, `${beforeFlatRight} → ${afterFlatRight}`)
    await shot('44-epub-jp-horizontal.png', 500)

    // 切回跟随书籍：要能回到竖排
    await cdp.evaluate(`(() => {
      const b = Array.from(document.querySelectorAll('.epub-seg button')).find(x => /^(书)?$/.test((x.textContent||'').trim()))
      if (b) b.click()
      return !!b
    })()`)
    await delay(5000)
    const backAuto = await readState()
    console.log(`    切回跟随书籍 ${JSON.stringify(backAuto)}`)
    check('切回「跟随书籍」后恢复竖排', backAuto.vertical === 'yes', String(backAuto.writing))

    /*
     * 必须回到书架。
     * 后面几节（书脊弧度、书立、PDF）都假定"已经退出阅读器"，
     * 这一节要是把应用留在阅读器里，它们就会一直等不到书架、然后整段跳过或超时 ——
     * 而我一开始正是这么写的，于是在这里白丢了两节。
     */
    await cdp.evaluate(`(() => {
      const b = document.querySelector('.reader-bar button')
      if (b) b.click()
      return !!b
    })()`)
    await waitFor('document.querySelector(".book[data-book-id]")', '从日文书的阅读器回到书架', 25000)
  }

  /** 点标题栏的「书架」回到书架视图（后面的小节常常上一节停在设置页） */
  async function backToShelf() {
    const clicked = await cdp.evaluate(`(() => {
      const b = Array.from(document.querySelectorAll('.titlebar button, .topbar button'))
        .find(x => (x.textContent||'').trim() === '书架')
      if (b) b.click()
      return !!b
    })()`)
    await delay(700)
    return clicked
  }

  /** 只查「关于」页的更新日志（ONLY=about） */
  async function runAboutProbe() {
    await waitFor('document.querySelector(".app-shell")', '应用外壳', 30000)
    await delay(1200)
    await cdp.evaluate(
      `(() => { const n = Array.from(document.querySelectorAll('.titlebar button')).find(b => (b.textContent||'').includes('设置')); if (n) n.click(); return !!n })()`
    )
    await waitFor('document.querySelector(".set-view")', '设置页', 20000)
    const clicked = await cdp.evaluate(
      `(() => { const n = Array.from(document.querySelectorAll('.set-nav-item')).find(b => (b.textContent||'').includes('关于')); if (n) n.click(); return !!n })()`
    )
    check('能切到「关于」分页', clicked)
    await delay(1200)

    const log = await cdp.evaluate(`(() => {
      const items = Array.from(document.querySelectorAll('.set-log li'))
      const versions = items.map(li => (li.querySelector('.set-log-ver')?.textContent || '').trim())
      return {
        count: items.length,
        versions,
        unique: [...new Set(versions.filter(Boolean))],
        hasBogus: versions.includes('0.2.0'),
        firstTitle: (items[0]?.querySelector('strong')?.textContent || '').trim(),
        hint: (document.querySelector('.set-block .set-head-hint, .set-block .section-title')?.textContent || '').trim(),
        moreBlocks: document.querySelectorAll('.set-log-more').length
      }
    })()`)
    console.log(`\n[仅关于] 更新日志 ${JSON.stringify(log).slice(0, 400)}`)
    check('更新日志里不再有 0.2.0', log.hasBogus === false, log.versions.join(','))
    check('更新日志从 0.1.1 起排', log.unique[0] === '0.1.1', log.unique[0])
    check('更新日志排到当前版本', log.unique.includes('0.7.2'), log.unique.slice(-3).join(','))
    check('首条就是首版那条', /仿真实体书架/.test(log.firstTitle), log.firstTitle)
    check('「更早的版本」那段已合并掉', log.moreBlocks === 0, String(log.moreBlocks))
    await shot('47-about-changelog.png', 400)
  }

  /**
   * 只查"换深色应用主题后书籍/阅读区的配色"（ONLY=theme）。
   *
   * 用户报的 bug：应用主题换成酒红皮革/黑檀这类深色后，书籍的背景跟着变，
   * 字就看不清了。这里把浅色与深色两轮的关键颜色都量出来对比，
   * 不靠肉眼猜是哪一层的问题。
   */
  async function runThemeProbe() {
    await waitFor('document.querySelector(".app-shell")', '应用外壳', 30000)
    await delay(1500)

    /** 量一圈"书与阅读区"的实际颜色 */
    const sample = async (tag) =>
      cdp.evaluate(`(() => {
        const pick = (sel, props) => {
          const el = document.querySelector(sel)
          if (!el) return null
          const cs = getComputedStyle(el)
          const out = {}
          for (const p of props) out[p] = cs.getPropertyValue(p)
          return out
        }
        return {
          tag: ${JSON.stringify(tag)},
          appTheme: document.documentElement.getAttribute('data-app-theme'),
          dark: document.documentElement.getAttribute('data-dark'),
          // 书架上的书
          spine: pick('.book .spine', ['background-image', 'color']),
          cover: pick('.book .cover', ['background-color', 'background-image', 'color']),
          shelfWall: pick('.shelf-wall, .shelf-view', ['background-color']),
          // 阅读/编辑区（打开书之后才有）
          editorHost: pick('.bs-cm-host', ['background-color', 'color']),
          cmContent: pick('.bs-cm-host .cm-content', ['background-color', 'color']),
          preview: pick('.bs-pane.is-preview, .markdown-body', ['background-color', 'color']),
          readerBody: pick('.reader-body', ['background-color', 'color']),
          epubStage: pick('.epub-stage', ['background-color'])
        }
      })()`)

    const light = await sample('原主题')
    console.log(`\n[仅主题] 浅色 ${JSON.stringify(light).slice(0, 300)}`)
    await shot('50-theme-light-shelf.png', 400)

    // 换成深色应用主题（酒红皮革）。
    // 注意 appTheme 是 AppSettings 的**顶层**字段，不在 ui 里 ——
    // 我第一版写成 ui.appTheme，结果只是加了个没人读的字段，
    // 两轮都是浅色，"对比"变成空过。
    await cdp.evaluate(`window.bookscent.settings.patch({ appTheme: 'burgundy' })`)
    await delay(800)
    const patched = await cdp.evaluate(`window.bookscent.settings.get().then(s => s.appTheme)`)
    console.log(`    设置里的 appTheme 现在是 ${patched}`)
    await cdp.evaluate(`location.reload()`)
    await delay(4500)
    await waitFor('document.querySelector(".app-shell")', '重载后外壳', 20000)
    await delay(1500)
    const dark = await sample('酒红皮革')
    console.log(`[仅主题] 深色 ${JSON.stringify(dark).slice(0, 300)}`)
    check('深色主题确实生效了（不是空对比）', dark.appTheme === 'burgundy', String(dark.appTheme))
    await shot('51-theme-dark-shelf.png', 400)

    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
    /*
     * 只比书脊**自己的**颜色（渐变），不比继承来的 color。
     * 书脊元素的 color 是从界面继承的正文色，深色主题下本来就该变 ——
     * 拿整包比较会误报（我第一版就是这么误报的）。
     */
    check(
      '书脊配色不随应用主题变化',
      same(light.spine?.['background-image'], dark.spine?.['background-image']),
      `浅色 ${String(dark.spine?.['background-image']).slice(0, 30)}…`
    )
    check(
      '封面配色不随应用主题变化',
      same(light.cover, dark.cover),
      `浅色 ${light.cover?.backgroundColor} / 深色 ${dark.cover?.backgroundColor}`
    )

    // 打开一本笔记，看编辑区在深色主题下的可读性
    const noteId = await cdp.evaluate(
      `window.bookscent.library.index().then(i => {
        const note = i.books.find(b => b.kind === 'note') ?? i.books.find(b => b.format === 'md' || b.format === 'txt')
        return note ? note.id : null
      })`
    )
    if (noteId) {
      await cdp.evaluate(`document.querySelector('.book[data-book-id="${noteId}"]')?.click()`)
      await delay(3500)
      const noteDark = await sample('深色下的笔记')
      console.log(`[仅主题] 深色下的笔记 ${JSON.stringify(noteDark).slice(0, 260)}`)
      await shot('52-theme-dark-note.png', 400)
      const bg = noteDark.cmContent?.backgroundColor ?? ''
      const fg = noteDark.cmContent?.color ?? ''
      const lum = (value) => {
        const m = String(value).match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/)
        if (!m) return null
        return (Number(m[1]) * 0.299 + Number(m[2]) * 0.587 + Number(m[3]) * 0.114) / 255
      }
      const bgL = lum(bg)
      const fgL = lum(fg)
      check(
        '深色主题下笔记文字与背景有足够反差',
        bgL === null || fgL === null || Math.abs(bgL - fgL) > 0.35,
        `背景 ${bg}（亮度 ${bgL}）/ 文字 ${fg}（亮度 ${fgL}）`
      )
    } else {
      problems.push('库里没有笔记，深色主题下的编辑区没验到')
    }

    // 深色主题下的 EPUB 书页：书页文档必须是不透明的、跟应用主题一致、且字还看得清
    // 验证库是干净的，示例 epub 得先导进来（ONLY=theme 时前面没有别的探针帮忙导过）
    const epubPath = join(root, 'samples', '示例电子书.epub')
    await cdp.evaluate(
      `window.bookscent.library.importPaths([${JSON.stringify(epubPath)}], false).then(r => r.added.length)`
    )
    await delay(1200)
    await cdp.evaluate(
      `(() => { const n = document.querySelector('.titlebar button[title*="重新扫描"]'); if (n) n.click(); return !!n })()`
    )
    await delay(2200)
    const epubId = await cdp.evaluate(
      `window.bookscent.library.index().then(i => {
        const b = i.books.find(x => x.format === 'epub')
        return b ? b.id : null
      })`
    )
    if (epubId) {
      // 先回书架（上面可能开着笔记）
      await cdp.evaluate(`(() => { const b = document.querySelector('.reader-bar button'); if (b) b.click(); return !!b })()`)
      await delay(1500)
      await cdp.evaluate(`document.querySelector('.book[data-book-id="${epubId}"]')?.click()`)
      await delay(5000)
      const page = await cdp.evaluate(`(() => {
        const v = document.querySelector('.epub-foliate')
        const doc = (v?.renderer?.getContents?.() ?? [])[0]?.doc
        if (!doc) return null
        const cs = getComputedStyle(doc.body)
        return { bg: cs.backgroundColor, color: cs.color, stage: getComputedStyle(document.querySelector('.epub-stage')).backgroundColor }
      })()`)
      console.log(`    EPUB 书页（深色主题）${JSON.stringify(page)}`)
      const lum = (value) => {
        const m = String(value).match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?/)
        if (!m) return null
        const a = m[4] === undefined ? 1 : Number(m[4])
        if (a === 0) return null // 透明 = 没底色，正是要防的那个 bug
        return (Number(m[1]) * 0.299 + Number(m[2]) * 0.587 + Number(m[3]) * 0.114) / 255
      }
      const bgL = lum(page?.bg)
      const fgL = lum(page?.color)
      check(
        '深色主题下 EPUB 书页有不透明底色（不会透出暗背景）',
        bgL !== null,
        `底色 ${page?.bg}`
      )
      check(
        '深色主题下 EPUB 书页文字与底色有反差',
        bgL !== null && fgL !== null && Math.abs(bgL - fgL) > 0.35,
        `底色亮度 ${bgL?.toFixed(2)} / 文字亮度 ${fgL?.toFixed(2)}（${page?.color}）`
      )
      await shot('53-theme-dark-epub.png', 400)

      /*
       * EPUB 工具条：「目录」必须是真按钮且能开合左侧栏；
       * 「导出图片」要有文字标签（先前被挤成小图标）。
       */
      const barBefore = await cdp.evaluate(`(() => ({
        labels: Array.from(document.querySelectorAll('.epub-bar button')).map(b => (b.textContent||'').trim()).filter(Boolean),
        side: document.querySelectorAll('.reader-side').length,
        status: (document.querySelector('.statusbar')?.textContent || '').replace(/\\s+/g, ' ').trim()
      }))()`)
      console.log(`    工具条按钮 ${JSON.stringify(barBefore.labels)}`)
      console.log(`    状态栏 ${JSON.stringify(barBefore.status)}`)
      check('EPUB 工具条有带文字的「目录」按钮', barBefore.labels.includes('目录'), JSON.stringify(barBefore.labels))
      check('EPUB 工具条有带文字的「导出图片」按钮', barBefore.labels.includes('导出图片'), JSON.stringify(barBefore.labels))
      check('读书时状态栏显示阅读统计、不再显示书架信息', /阅读中|写作中/.test(barBefore.status) && !/本藏书/.test(barBefore.status), JSON.stringify(barBefore.status))

      const toggled = await cdp.evaluate(`(() => {
        const b = Array.from(document.querySelectorAll('.epub-bar button')).find(x => (x.textContent||'').trim() === '目录')
        if (!b) return null
        b.click()
        return true
      })()`)
      await delay(600)
      const sideAfterToggle = await cdp.evaluate(`document.querySelectorAll('.reader-side').length`)
      check(
        '「目录」按钮能收起左侧栏（以前是个点不动的图标）',
        toggled === true && barBefore.side > 0 && sideAfterToggle === 0,
        `侧栏 ${barBefore.side} → ${sideAfterToggle}`
      )
      await cdp.evaluate(`(() => {
        const b = Array.from(document.querySelectorAll('.epub-bar button')).find(x => (x.textContent||'').trim() === '目录')
        if (b) b.click()
        return !!b
      })()`)
      await delay(600)
      const sideBack = await cdp.evaluate(`document.querySelectorAll('.reader-side').length`)
      check('再点一次能展开回来', sideBack === 1, String(sideBack))
      await shot('53b-epub-bar.png', 400)

      await cdp.evaluate(`(() => { const b = document.querySelector('.reader-bar button'); if (b) b.click(); return !!b })()`)
      await delay(1500)
      const statusBack = await cdp.evaluate(
        `(document.querySelector('.statusbar')?.textContent || '').replace(/\\s+/g, ' ').trim()`
      )
      console.log(`    回到书架后状态栏 ${JSON.stringify(statusBack)}`)
      check('回到书架后状态栏恢复书架信息', /本藏书/.test(statusBack), JSON.stringify(statusBack))
    } else {
      problems.push('库里没有 EPUB，深色主题下的书页没验到')
    }

    // 统计页能打开（数据来自主进程扫记录）
    const statsClicked = await cdp.evaluate(`(() => {
      const b = Array.from(document.querySelectorAll('.titlebar button')).find(x => (x.textContent||'').trim() === '统计')
      if (b) b.click()
      return !!b
    })()`)
    await delay(2500)
    const stats = await cdp.evaluate(`(() => {
      const view = document.querySelector('.stats-view')
      return {
        mounted: Boolean(view),
        heatCells: document.querySelectorAll('[class*="stats-heat"] > *').length,
        titles: Array.from(document.querySelectorAll('.stats-view h2, .stats-view h3, .stats-view .stats-title'))
          .map(x => (x.textContent||'').trim()).filter(Boolean).slice(0, 8)
      }
    })()`)
    console.log(`    统计页 ${JSON.stringify(stats)}`)
    check('标题栏有「统计」入口且能打开', statsClicked && stats.mounted)
    check('统计页画出了热力图格子', stats.heatCells > 100, String(stats.heatCells))
    await shot('54-stats.png', 400)

    // 用量真的记上了吗（统计页的数据来源）
    const usage = await cdp.evaluate(`window.bookscent.library.stats().then(s => ({
      readingBooks: s.reading.books, readingOpens: s.reading.opens, readingSeconds: s.reading.seconds,
      readingPages: s.reading.pages, recentCount: s.recent.length,
      todaySeconds: (s.days[s.days.length - 1] || {}).seconds ?? 0
    }))`)
    console.log(`    用量 ${JSON.stringify(usage)}`)
    check('打开过的书被记进用量（次数）', usage.readingOpens > 0, String(usage.readingOpens))
    check('读过的时间被记进用量', usage.readingSeconds > 0, `${usage.readingSeconds} 秒`)
    check('翻页数被记进用量', usage.readingPages > 0, `${usage.readingPages} 页`)

    // 书架上的阅读进度：封面=圆圈，书脊=左侧细条
    const facingProbe = async (facing) => {
      await cdp.evaluate(`window.bookscent.settings.patch({ ui: { bookFacing: ${JSON.stringify(facing)} } })`)
      await cdp.evaluate(`location.reload()`)
      await delay(4000)
      await waitFor('document.querySelector(".app-shell")', '重载后外壳', 20000)
      await delay(1800)
      return cdp.evaluate(`(() => ({
        rings: document.querySelectorAll('.progress-ring').length,
        spines: document.querySelectorAll('.progress-spine').length
      }))()`)
    }
    const coverProg = await facingProbe('cover')
    console.log(`    封面朝向的进度 ${JSON.stringify(coverProg)}`)
    check('封面朝外时画圆圈进度', coverProg.rings > 0, JSON.stringify(coverProg))
    await shot('55-progress-cover.png', 400)
    const spineProg = await facingProbe('spine')
    console.log(`    书脊朝向的进度 ${JSON.stringify(spineProg)}`)
    check('书脊朝外时画左侧细条进度', spineProg.spines > 0, JSON.stringify(spineProg))
    await shot('56-progress-spine.png', 400)

    // 书籍 / 笔记分开记账：把这本书改成笔记，录入的字数应记到 asNote 而不是 asBook
    const split = await cdp.evaluate(`(async () => {
      const before = await window.bookscent.library.stats()
      const id = (await window.bookscent.library.index()).books.find(b => b.format === 'md' || b.format === 'txt')?.id
      if (!id) return null
      await window.bookscent.library.recordUsage(id, 'asNote', { words: 250, seconds: 30 })
      const after = await window.bookscent.library.stats()
      const record = await window.bookscent.library.record(id)
      return {
        noteWordsBefore: before.notes.words,
        noteWordsAfter: after.notes.words,
        bookSecondsAfter: after.reading.seconds,
        keys: Object.keys(record.usage ?? {})
      }
    })()`)
    console.log(`    分账 ${JSON.stringify(split)}`)
    check(
      '笔记的字数记进 asNote，不混进阅读统计',
      Boolean(split) && split.noteWordsAfter >= 250 && split.keys.includes('asNote'),
      JSON.stringify(split)
    )

    // 「文件与数据」里的引用书籍清单
    await cdp.evaluate(
      `(() => { const b = Array.from(document.querySelectorAll('.titlebar button')).find(x => (x.textContent||'').trim() === '设置'); if (b) b.click(); return !!b })()`
    )
    await waitFor('document.querySelector(".set-view")', '设置页', 20000)
    await cdp.evaluate(
      `(() => { const n = Array.from(document.querySelectorAll('.set-nav-item')).find(b => (b.textContent||'').includes('文件与数据')); if (n) n.click(); return !!n })()`
    )
    await delay(1500)
    const refs = await cdp.evaluate(`(() => ({
      block: Array.from(document.querySelectorAll('.set-block')).some(b => /引用的书籍/.test(b.textContent||'')),
      rows: document.querySelectorAll('[class*="set-ref"]').length
    }))()`)
    console.log(`    引用书籍区块 ${JSON.stringify(refs)}`)
    check('「文件与数据」里有「引用的书籍」区块', refs.block, JSON.stringify(refs))
    check('区块里列出了引用导入的书', refs.rows > 0, String(refs.rows))
    await shot('57-referenced.png', 400)
    await backToShelf()

    // 还原成原主题，别影响后面的小节
    await cdp.evaluate(`window.bookscent.settings.patch({ appTheme: 'parchment', ui: { bookFacing: 'spine' } })`)
    await cdp.evaluate(`location.reload()`)
    await delay(3500)
  }

  /** 0.9.0 的一轮自查：书签、封面倾角、笔记样式、引用分组、进度条、输入字数 */
  async function runV090Probe() {
    await waitFor('document.querySelector(".app-shell")', '应用外壳', 30000)
    await delay(1200)

    const epubPath = join(root, 'samples', '示例电子书.epub')
    await cdp.evaluate(
      `window.bookscent.library.importPaths([${JSON.stringify(epubPath)}], false).then(r => r.added.length)`
    )
    await cdp.evaluate(
      `(() => { const n = document.querySelector('.titlebar button[title*="重新扫描"]'); if (n) n.click(); return !!n })()`
    )
    await delay(2500)

    /*
     * 带容错的 evaluate：某一步把渲染进程堵住时，不要整个探针跟着死，
     * 把失败的那一步打印出来继续往下走 —— 否则只知道"超时"，不知道停在哪。
     */
    const safeEval = async (expr, label) => {
      try {
        return await cdp.evaluate(expr)
      } catch (error) {
        console.log(`    （${label} 失败：${error.message}）`)
        return null
      }
    }

    const openByFormat = async (format) => {
      /*
       * 先退出阅读器。
       * 注意不能用标题栏的「书架」按钮 —— 书还开着时它不关阅读器（App 里
       * openBookId 优先级更高），必须点阅读器自己的「返回书架」。
       */
      await safeEval(
        `(() => { const b = document.querySelector('.reader-bar button'); if (b) b.click(); return !!b })()`,
        '退出阅读器'
      )
      await delay(1500)
      await backToShelf()
      const id = await safeEval(
        `window.bookscent.library.index().then(i => {
          const b = i.books.find(x => x.format === ${JSON.stringify(format)})
          return b ? b.id : null
        })`,
        `查 ${format} 的 id`
      )
      if (!id) return null
      await waitFor(`document.querySelector('.book[data-book-id="${id}"]')`, `书架上出现 ${format}`, 15000).catch(
        () => undefined
      )
      await safeEval(`document.querySelector('.book[data-book-id="${id}"]')?.click()`, `打开 ${format}`)
      await delay(format === 'epub' ? 5500 : 3000)
      return id
    }

    const addBookmark = async () => {
      /*
       * 0.9.1 起书签搬进了**左侧栏**（与目录同一处），顶栏那个按钮已经删掉。
       * 所以这里先切到「书签」那一栏，再点栏里的「标记当前位置 / 加书签」。
       */
      const clicked = await safeEval(
        `(() => {
          const tab = Array.from(document.querySelectorAll('.reader-side-tab, .pdf-sidebar-tabs button')).find(x => /书签/.test(x.textContent||''))
          if (!tab) return false
          tab.click()
          return true
        })()`,
        '切到书签栏'
      )
      await delay(700)
      const marked = await safeEval(
        `(() => {
          const b = Array.from(document.querySelectorAll('button')).find(x => /标记当前位置|标记第 \\d+ 行|在第 \\d+ 页加书签/.test((x.textContent||'').trim()))
          if (!b) return null
          b.click()
          return (b.textContent||'').trim().slice(0, 40)
        })()`,
        '标记当前位置'
      )
      await delay(900)
      return { clicked: Boolean(clicked), marked: Boolean(marked), what: marked }
    }

    /*
     * 读某本书的书签。PDF 那边是它自己的实现（走 recordStore，带防抖保存），
     * 所以这里轮询等一会儿，别抢在落盘之前读。
     */
    const bookmarkOf = async (id) => {
      for (let i = 0; i < 8; i += 1) {
        const list = await cdp.evaluate(`window.bookscent.library.record(${JSON.stringify(id)}).then(r => (r.bookmarks ?? []).map(b => ({
          label: b.label, page: b.page, kind: b.anchor ? b.anchor.kind : 'page', excerpt: b.excerpt ?? null
        })))`)
        if (Array.isArray(list) && list.length > 0) return list
        await delay(700)
      }
      return []
    }

    console.log('\n[0.9.0-a] 书签（多格式）')
    const epubId = await openByFormat('epub')
    check('打开了示例 EPUB', Boolean(epubId))
    if (epubId) {
      const res = await addBookmark()
      check('EPUB 顶栏能加书签', res.clicked && res.marked, JSON.stringify(res))
      const list = await bookmarkOf(epubId)
      console.log(`    EPUB 书签 ${JSON.stringify(list)}`)
      check('EPUB 书签用 CFI 定位', list[0]?.kind === 'cfi', JSON.stringify(list[0]))
      await shot('60-bookmark-epub.png', 400)
    }

    const pdfId = await openByFormat('pdf')
    if (pdfId) {
      const res = await addBookmark()
      const inPanel = await cdp.evaluate(`document.querySelectorAll('.pdf-bookmark').length`)
      console.log(`    PDF 书签面板里显示了 ${inPanel} 条`)
      check('加完后 PDF 书签面板里就有一条', inPanel > 0, String(inPanel))
      const list = await bookmarkOf(pdfId)
      console.log(`    PDF 书签 ${JSON.stringify(list)} 点了「${res.what}」`)
      check('PDF 也能加书签且用页码定位', res.marked && list[0]?.kind === 'page', JSON.stringify(list[0] ?? res))
    }

    const wordsBefore = await cdp.evaluate(`window.bookscent.library.stats().then(s => s.notes.words)`)
    const mdId = await openByFormat('md')
    if (mdId) {
      const res = await addBookmark()
      const list = await bookmarkOf(mdId)
      console.log(`    Markdown 书签 ${JSON.stringify(list)}`)
      check('Markdown 能加书签且按行定位', res.marked && (list[0]?.kind === 'line' || list[0]?.kind === 'scroll'), JSON.stringify(list[0] ?? res))
      check('文本类书签带当前行摘录', Boolean(list[0]?.excerpt), JSON.stringify(list[0]))
      // 第 10 项：打开笔记不该把整篇字数算成输入
      await delay(3000)
      const wordsAfter = await cdp.evaluate(`window.bookscent.library.stats().then(s => s.notes.words)`)
      console.log(`    打开笔记前后输入字数 ${wordsBefore} → ${wordsAfter}`)
      check('打开笔记不会把整篇字数算成输入', wordsAfter - wordsBefore < 200, `${wordsBefore} → ${wordsAfter}`)
    }

    await cdp.evaluate(
      `(() => { const b = Array.from(document.querySelectorAll('.titlebar button')).find(x => (x.textContent||'').trim() === '统计'); if (b) b.click(); return !!b })()`
    )
    await delay(2500)
    const statsBookmarks = await cdp.evaluate(`window.bookscent.library.stats().then(s => ({
      count: s.bookmarks.length,
      section: Array.from(document.querySelectorAll('.stats-section')).some(x => /最近书签/.test(x.textContent||''))
    }))`)
    console.log(`    统计页书签 ${JSON.stringify(statsBookmarks)}`)
    check('统计数据里有近期书签', statsBookmarks.count > 0, String(statsBookmarks.count))
    check('统计页画出了「最近书签」区块', statsBookmarks.section, JSON.stringify(statsBookmarks))
    await shot('61-stats-bookmarks.png', 400)

    console.log('\n[0.9.0-b] 封面倾角 / 书脊进度 / 笔记样式 / 引用分组')
    await cdp.evaluate(`window.bookscent.settings.patch({ ui: { bookFacing: 'cover' } })`)
    await cdp.evaluate(`location.reload()`)
    await delay(4200)
    await waitFor('document.querySelector(".app-shell")', '重载后外壳', 20000)
    await delay(1800)
    const tilts = await cdp.evaluate(
      `(() => Array.from(document.querySelectorAll('.book')).map(b => b.style.getPropertyValue('--spine-tilt').trim()))()`
    )
    console.log(`    封面朝向各书倾角 ${JSON.stringify(tilts.slice(0, 8))}`)
    check(
      '封面朝外时没有倾角',
      tilts.length === 0 || tilts.every((t) => t === '' || t === '0deg' || t === '0'),
      JSON.stringify(tilts.slice(0, 6))
    )
    await shot('62-cover-no-tilt.png', 400)

    /*
     * 封面模式的高度：默认等高（封面错落默认 0），并且整体大小可调。
     * 宽度由封面比例乘高度算出来，所以"错落=整体缩放封面"，这也是它单列一档的原因。
     */
    const coverHeights = async () =>
      cdp.evaluate(`(() => Array.from(document.querySelectorAll('.book')).map(b => {
        // 量封面本身，而不是外层书位（外层高度不一定跟着封面走）
        const cover = b.querySelector('.cover, .cover-art, [class*="cover"]') || b
        return Math.round(cover.getBoundingClientRect().height)
      }))()`)
    const equal = await coverHeights()
    const distinct = new Set(equal.filter((h) => h > 0)).size
    console.log(`    封面默认各书高度 ${JSON.stringify(equal.slice(0, 6))}`)
    check('封面朝外时默认等高', equal.length > 0 && distinct === 1, JSON.stringify(equal.slice(0, 8)))

    await cdp.evaluate(`window.bookscent.settings.patch({ ui: { coverHeightScale: 0.7 } })`)
    // 直接改主进程设置不会推给渲染层，必须重载（这段和其它探针一样）
    await cdp.evaluate(`location.reload()`)
    await delay(4200)
    await waitFor('document.querySelector(".app-shell")', '重载后外壳', 20000)
    await delay(1500)
    const smaller = await coverHeights()
    console.log(`    封面缩到 70% 后 ${JSON.stringify(smaller.slice(0, 6))}`)
    const base = equal.find((h) => h > 0) ?? 0
    const shrunk = smaller.find((h) => h > 0) ?? 0
    check('封面大小可整体缩放', base > 0 && shrunk > 0 && shrunk < base * 0.85, `${base} → ${shrunk}`)

    await cdp.evaluate(`window.bookscent.settings.patch({ ui: { coverHeightScale: 1, coverHeightVariation: 0.3 } })`)
    await cdp.evaluate(`location.reload()`)
    await delay(4200)
    await waitFor('document.querySelector(".app-shell")', '重载后外壳', 20000)
    await delay(1500)
    const varied = await coverHeights()
    const variedSet = new Set(varied.filter((h) => h > 0))
    console.log(`    封面错落 30% 后 ${JSON.stringify(varied.slice(0, 6))}`)
    check('封面错落调大后大小不再一致', variedSet.size > 1, JSON.stringify([...variedSet].slice(0, 6)))
    await cdp.evaluate(`window.bookscent.settings.patch({ ui: { coverHeightVariation: 0 } })`)
    await delay(600)

    await cdp.evaluate(`window.bookscent.settings.patch({ ui: { bookFacing: 'spine' } })`)
    await cdp.evaluate(`location.reload()`)
    await delay(4200)
    await waitFor('document.querySelector(".app-shell")', '重载后外壳', 20000)
    await delay(2000)
    const spineProgress = await cdp.evaluate(`(() => {
      const bars = Array.from(document.querySelectorAll('.book')).map(b => ({
        pct: b.style.getPropertyValue('--progress-pct').trim(),
        hasBar: Boolean(b.querySelector('.progress-spine'))
      }))
      return { withBar: bars.filter(x => x.hasBar).length, pcts: bars.map(x => x.pct).filter(Boolean).slice(0, 6) }
    })()`)
    console.log(`    书脊进度 ${JSON.stringify(spineProgress)}`)
    check('书脊朝向画出了进度条', spineProgress.withBar > 0, JSON.stringify(spineProgress))
    check(
      '进度百分比落在 .book 上（伪元素才继承得到）',
      spineProgress.pcts.some((p) => p && p !== '0%' && p !== '0'),
      JSON.stringify(spineProgress)
    )

    await cdp.evaluate(
      `(() => { const b = Array.from(document.querySelectorAll('.titlebar button')).find(x => (x.textContent||'').includes('设置')); if (b) b.click(); return !!b })()`
    )
    await waitFor('document.querySelector(".set-view")', '设置页', 20000)
    await cdp.evaluate(
      `(() => { const n = Array.from(document.querySelectorAll('.set-nav-item')).find(b => (b.textContent||'').includes('书籍外观')); if (n) n.click(); return !!n })()`
    )
    await delay(1500)
    const noteChips = await cdp.evaluate(`(() => {
      const blocks = Array.from(document.querySelectorAll('.set-block'))
      const block = blocks.find(b => /笔记的基准样式/.test(b.textContent||''))
      if (!block) return null
      return Array.from(block.querySelectorAll('.set-chips > *')).map(x => (x.textContent||'').trim())
    })()`)
    console.log(`    笔记样式预设 ${JSON.stringify(noteChips)}`)
    check('有笔记专用的样式预设', Boolean(noteChips && noteChips.length >= 4), JSON.stringify(noteChips))

    await cdp.evaluate(
      `(() => { const n = Array.from(document.querySelectorAll('.set-nav-item')).find(b => (b.textContent||'').includes('文件与数据')); if (n) n.click(); return !!n })()`
    )
    await delay(1500)
    const groups = await cdp.evaluate(`(() => ({
      groups: document.querySelectorAll('.set-ref-group').length,
      summary: Array.from(document.querySelectorAll('.set-ref-group summary')).map(x => (x.textContent||'').trim()).slice(0, 4)
    }))()`)
    console.log(`    引用书籍分组 ${JSON.stringify(groups)}`)
    check('引用书籍按文件夹分组', groups.groups > 0, JSON.stringify(groups))
    await shot('63-ref-groups.png', 400)
    await backToShelf()
  }

  async function runXcoverProbe() {
    await waitFor('document.querySelector(".app-shell")', '应用外壳', 30000)
    await delay(1500)

    /*
     * 用示例 EPUB 而不是示例 PDF：示例 PDF 是应用自建的文字样例，
     * 里面本来就没有内嵌图片（列出来是 0 张，那是正确行为，测不了裁剪）。
     * EPUB 有封面图，两条取图路径共用同一个弹窗与裁剪台。
     */
    const epubPath = join(root, 'samples', '示例电子书.epub')
    await cdp.evaluate(
      `window.bookscent.library.importPaths([${JSON.stringify(epubPath)}], false).then(r => r.added.length)`
    )
    await cdp.evaluate(
      `(() => { const n = document.querySelector('.titlebar button[title*="重新扫描"]'); if (n) n.click(); return !!n })()`
    )
    await delay(3000)

    const id = await cdp.evaluate(
      `window.bookscent.library.index().then(i => { const b = i.books.find(x => x.format === 'epub'); return b ? b.id : null })`
    )
    check('库里有示例 EPUB', Boolean(id), String(id))
    if (!id) return

    /*
     * 导入时就该把书里的封面取出来（示例书里那张图正好叫 cover.png）。
     */
    const autoCover = await cdp.evaluate(
      `window.bookscent.library.index().then(i => { const b = i.books.find(x => x.id === ${JSON.stringify(id)}); return b ? { cover: (b.style && b.style.coverImage) || null, title: b.title } : null })`
    )
    console.log(`    导入后的封面 ${JSON.stringify(autoCover)}`)
    check(
      '导入 EPUB 时自动用书里的封面图当封面',
      Boolean(autoCover && autoCover.cover && /^asset:/.test(autoCover.cover)),
      JSON.stringify(autoCover)
    )

    await waitFor(`document.querySelector('.book[data-book-id="${id}"]')`, '书架上的 EPUB', 15000)
    await cdp.evaluate(
      `document.querySelector('.book[data-book-id="${id}"]')?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))`
    )
    await delay(1800)

    const entry = await cdp.evaluate(`(() => {
      const b = Array.from(document.querySelectorAll('button')).find(x => /从书内图片选封面/.test(x.textContent||''))
      if (!b) return false
      b.click()
      return true
    })()`)
    check('详情页有「从书内图片选封面」入口', entry)
    await delay(1200)

    // 抽 PDF 内部的图要花点时间
    let items = 0
    for (let i = 0; i < 30; i += 1) {
      items = await cdp.evaluate(`document.querySelectorAll('.xcover-thumb').length`)
      if (items > 0) break
      await delay(1000)
    }
    console.log(`    书内图片 ${items} 张`)
    check('列出了 PDF 内部的图片', items > 0, String(items))
    await shot('70-xcover-list.png', 400)

    const picked = await cdp.evaluate(`(() => {
      const b = document.querySelector('.xcover-thumb')
      if (!b) return false
      b.click()
      return true
    })()`)
    await delay(1500)
    const stage = await cdp.evaluate(`(() => ({
      stage: Boolean(document.querySelector('.xcover-stage')),
      plane: Boolean(document.querySelector('.xcover-plane')),
      zoom: (document.querySelector('.xcover-zoom-value')?.textContent || '').trim()
    }))()`)
    console.log(`    裁剪台 ${JSON.stringify(stage)}`)
    check('点一张图进入裁剪台', picked && stage.stage && stage.plane, JSON.stringify(stage))

    // 工作区要够大：竖长的封面图在里面得看得清细节
    const stageSize = await cdp.evaluate(`(() => {
      const s = document.querySelector('.xcover-stage')
      if (!s) return null
      const r = s.getBoundingClientRect()
      return { w: Math.round(r.width), h: Math.round(r.height) }
    })()`)
    console.log(`    裁剪工作区 ${JSON.stringify(stageSize)}`)
    const natural = await cdp.evaluate(`(() => {
      const i = document.querySelector('.xcover-stage-img')
      return i ? { w: i.naturalWidth, h: i.naturalHeight } : null
    })()`)
    console.log(`    原图 ${JSON.stringify(natural)}`)
    check(
      '小图会铺满工作区（不再按原尺寸缩成一小块）',
      Boolean(
        stageSize &&
          natural &&
          Math.max(stageSize.w, stageSize.h) > Math.max(natural.w, natural.h)
      ),
      `${JSON.stringify(stageSize)} vs ${JSON.stringify(natural)}`
    )

    // 默认就该是整张图全选（书里内嵌的封面通常本来就是干净图）
    const initialBox = await cdp.evaluate(`(() => {
      const box = document.querySelector('.xcover-box')
      const plane = document.querySelector('.xcover-plane')
      if (!box || !plane) return null
      const b = box.getBoundingClientRect()
      const p = plane.getBoundingClientRect()
      return { w: b.width, h: b.height, pw: p.width, ph: p.height }
    })()`)
    const wPct = initialBox && initialBox.pw > 0 ? (initialBox.w / initialBox.pw) * 100 : -1
    const hPct = initialBox && initialBox.ph > 0 ? (initialBox.h / initialBox.ph) * 100 : -1
    console.log(`    初始选框占整图 ${wPct.toFixed(1)}% × ${hPct.toFixed(1)}%`)
    check('进裁剪台时默认全尺寸框选', wPct > 96 && hPct > 96, `${wPct.toFixed(1)}% × ${hPct.toFixed(1)}%`)

    const before = await cdp.evaluate(
      `(() => { const p = document.querySelector('.xcover-plane'); return p ? p.getBoundingClientRect().width : 0 })()`
    )
    await cdp.evaluate(`(() => {
      const b = Array.from(document.querySelectorAll('.xcover-zoom button')).find(x => (x.getAttribute('aria-label')||x.title||'') === '放大')
      if (b) b.click()
      return !!b
    })()`)
    await delay(600)
    const after = await cdp.evaluate(`(() => ({
      plane: (document.querySelector('.xcover-plane')||{getBoundingClientRect:()=>({width:0})}).getBoundingClientRect().width,
      zoom: (document.querySelector('.xcover-zoom-value')?.textContent || '').trim()
    }))()`)
    console.log(`    缩放 ${before} → ${JSON.stringify(after)}`)
    check('放大按钮有效（平面变大、百分比上升）', after.plane > before && after.zoom !== '100%', JSON.stringify(after))
    await shot('71-xcover-zoom.png', 400)

    // 把选框拖到很小：旧版会在 4% 处卡住，这里应当能到 3% 以下。
    // 先复位缩放，否则量出来的是"相对舞台"而不是"相对图片"。
    await cdp.evaluate(`(() => {
      const b = Array.from(document.querySelectorAll('.xcover-zoom button')).find(x => (x.textContent||'').trim() === '适应')
      if (b) b.click()
      return !!b
    })()`)
    await delay(400)
    await cdp.evaluate(`(() => {
      const handle = document.querySelector('.xcover-handle.is-se')
      const stage = document.querySelector('.xcover-stage')
      if (!handle || !stage) return false
      const h = handle.getBoundingClientRect()
      const s = stage.getBoundingClientRect()
      const tx = s.left + s.width * 0.02
      const ty = s.top + s.height * 0.02
      const opts = (x, y) => ({ bubbles: true, clientX: x, clientY: y, pointerId: 1, button: 0, buttons: 1 })
      handle.dispatchEvent(new PointerEvent('pointerdown', opts(h.left + h.width / 2, h.top + h.height / 2)))
      stage.dispatchEvent(new PointerEvent('pointermove', opts(tx, ty)))
      stage.dispatchEvent(new PointerEvent('pointerup', opts(tx, ty)))
      return true
    })()`)
    await delay(500)
    // 事件派发完等 React 重渲染之后再量
    const shrunk = await cdp.evaluate(`(() => {
      const box = document.querySelector('.xcover-box')
      const plane = document.querySelector('.xcover-plane')
      if (!box || !plane) return null
      return { boxW: box.getBoundingClientRect().width, planeW: plane.getBoundingClientRect().width }
    })()`)
    const boxPct = shrunk && shrunk.planeW > 0 ? (shrunk.boxW / shrunk.planeW) * 100 : -1
    console.log(`    缩小后的选框宽度占整图 ${boxPct.toFixed(1)}%`)
    check('选框能缩到很小（不再有 4% 下限）', boxPct > 0 && boxPct < 3.5, `${boxPct.toFixed(1)}%`)

    /*
     * 关键的一条：**裁出来的尺寸要跟着选框走**。
     *
     * 前面几条量的是屏幕上那个框（本地 state），框能拖不等于结果被提交 ——
     * 用户报的"裁剪无效、出来还是原始大小"正是这一层：
     * 框看得见地缩小了，但确认时用的仍是整张图。
     * 所以这里读界面上那个「裁出 W×H」读数。
     */
    const facts = await cdp.evaluate(`(() => Array.from(document.querySelectorAll('.xcover-facts span')).map(x => (x.textContent||'').trim()))()`)
    const cutMatch = /裁出\s*(\d+)\s*×\s*(\d+)/.exec((facts || []).join(' '))
    const cut = cutMatch ? { w: Number(cutMatch[1]), h: Number(cutMatch[2]) } : null
    console.log(`    尺寸读数 ${JSON.stringify(facts)}`)
    check(
      '裁出尺寸跟着选框走（不是整张原图）',
      Boolean(cut && natural && cut.w < natural.w * 0.25 && cut.h < natural.h * 0.25),
      `${JSON.stringify(cut)} vs 原图 ${JSON.stringify(natural)}`
    )
    await shot('72-xcover-shrunk.png', 400)

    // 真按一次确认，看是否写进了书籍样式
    const confirmed = await cdp.evaluate(`(() => {
      const b = Array.from(document.querySelectorAll('button')).find(x => /用作封面|用作书脊/.test((x.textContent||'').trim()))
      if (!b) return false
      b.click()
      return true
    })()`)
    await delay(4000)
    const styleAfter = await cdp.evaluate(
      `window.bookscent.library.index().then(i => { const b = i.books.find(x => x.id === ${JSON.stringify(id)}); return b ? { cover: Boolean(b.style && b.style.coverImage), aspect: b.style && b.style.coverImageAspect } : null })`
    )
    console.log(`    确认后样式 ${JSON.stringify(styleAfter)}`)
    check('裁剪结果写进了书籍样式', confirmed && Boolean(styleAfter && styleAfter.cover), JSON.stringify(styleAfter))

    await cdp.evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`)
    await delay(600)
    await cdp.evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`)
    await delay(600)
  }

  /**
   * 用真实的日文 EPUB 验证"导入后封面是不是真的能显示"。
   *
   * 光看 style.coverImage 有没有值不够 —— 用户的现象是"有封面但是空白的"，
   * 所以这里既查落盘文件的字节与像素尺寸，也在渲染层真的把那张图加载一遍：
   * naturalWidth=0 / onerror 说明图片根本加载不出来（地址、字节或格式的问题）。
   *
   * 另外**两种导入方式各测一本**：引用式（copy=false，文件留在原处）
   * 与复制入库（copy=true）。用户实际怎么导的我不知道，两条路径都得验。
   */
  async function runJpCoverProbe() {
    await waitFor('document.querySelector(".app-shell")', '应用外壳', 30000)
    await delay(1500)

    const jp = process.env.JP_EPUB || ''
    const second = process.env.JP_EPUB2 || ''
    const targets = [
      { path: jp, copy: false, label: '引用式导入' },
      { path: second, copy: true, label: '复制入库' }
    ].filter((entry) => entry.path && existsSync(entry.path))

    if (targets.length === 0) {
      console.log('    跳过：没有可用的 EPUB（JP_EPUB / JP_EPUB2）')
      return
    }

    const assetsDir = join(process.env.LOCALAPPDATA ?? '', 'bookscent-verify-app', 'assets')
    const libraryDir = join(process.env.LOCALAPPDATA ?? '', 'bookscent-verify-app', 'library')

    for (const target of targets) {
      console.log(`\n  [${target.label}] ${basename(target.path)}`)
      await cdp.evaluate(
        `window.bookscent.library.importPaths([${JSON.stringify(target.path)}], ${target.copy}).then(r => r.added.length)`
      )
      // 导入返回后**立刻**读：封面必须已经在索引里，而不是等后台补录
      const immediate = await cdp.evaluate(`window.bookscent.library.index().then(i => {
        const b = i.books.find(x => x.title && x.title.includes(${JSON.stringify(titleHint(target.path))}))
        return b ? Boolean(b.style && b.style.coverImage) : null
      })`)
      console.log(`    导入返回时已有封面=${immediate}`)
      check(`[${target.label}] 导入的当下就带上了封面（不等后台补录）`, immediate === true, String(immediate))
      await delay(2500)

      const info = await cdp.evaluate(`window.bookscent.library.index().then(i => {
        const b = i.books.find(x => x.title && x.title.includes(${JSON.stringify(titleHint(target.path))}))
        return b ? { id: b.id, title: b.title, path: b.path, external: b.external, cover: (b.style && b.style.coverImage) || null, aspect: (b.style && b.style.coverImageAspect) || null } : null
      })`)
      console.log(`    导入结果 ${JSON.stringify(info)}`)
      check(`[${target.label}] 导入后带上了封面引用`, Boolean(info && info.cover), JSON.stringify(info))
      if (!info || !info.cover) continue

      const name = String(info.cover).replace(/^asset:/, '')
      const file = join(assetsDir, name)
      if (existsSync(file)) {
        const bytes = readFileSync(file)
        const png = bytes.length > 24 && bytes.toString('latin1', 1, 4) === 'PNG'
        const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8
        const dims = png ? { w: bytes.readUInt32BE(16), h: bytes.readUInt32BE(20) } : jpeg ? jpegSize(bytes) : null
        console.log(
          `    落盘 ${bytes.length} 字节，${png ? 'PNG' : jpeg ? 'JPEG' : '其它'}，尺寸 ${dims ? `${dims.w}×${dims.h}` : '读不出'}，aspect ${info.aspect}`
        )
        check(`[${target.label}] 封面文件非空且能解出尺寸`, bytes.length > 1024 && Boolean(dims && dims.w > 32), `${bytes.length} 字节 ${JSON.stringify(dims)}`)
      } else {
        console.log(`    ✗ 落盘文件不存在：${file}`)
        check(`[${target.label}] 封面文件已落盘`, false, file)
      }

      // 切到封面朝向，看它到底画成了什么
      await cdp.evaluate(`window.bookscent.settings.patch({ ui: { bookFacing: 'cover' } })`)
      await cdp.evaluate(`location.reload()`)
      await delay(4500)
      await waitFor('document.querySelector(".app-shell")', '重载后外壳', 25000)
      await delay(1800)

      const painted = await cdp.evaluate(`(() => {
        const el = document.querySelector('.book[data-book-id="${info.id}"] .cover')
        if (!el) {
          const first = document.querySelector('.book .cover')
          return { missing: true, firstCls: first ? first.className : null, books: document.querySelectorAll('.book').length }
        }
        // 封面现在是 <img>：直接看它的 src 与解出来的真实尺寸
        const img = el.querySelector('.cover-image-img')
        const rect = el.getBoundingClientRect()
        return {
          cls: el.className,
          src: img ? (img.getAttribute('src') || '').slice(0, 60) : null,
          natural: img ? img.naturalWidth + '×' + img.naturalHeight : null,
          w: Math.round(rect.width),
          h: Math.round(rect.height)
        }
      })()`)
      console.log(`    书架上那张封面 ${JSON.stringify(painted)}`)
      check(
        `[${target.label}] 书架上画的是这张封面图`,
        Boolean(
          painted &&
            painted.cls &&
            painted.cls.includes('cover-image') &&
            painted.src &&
            painted.natural &&
            !painted.natural.startsWith('0×') &&
            painted.w > 20 &&
            painted.h > 20
        ),
        JSON.stringify(painted)
      )
      await shot(`80-cover-${target.copy ? 'copy' : 'ref'}.png`, 500)

      /*
       * 补录：模拟"早先导入、当时没取到封面"的书 —— 抹掉封面并清掉"试过"标记，
       * 触发一次重新扫描，后台批次应当把封面补回来。
       * 这正是用户那 28 本 external=true 老书的处境。
       */
      if (!target.copy) {
        await cdp.evaluate(
          `window.bookscent.library.updateBook(${JSON.stringify(info.id)}, { style: {}, coverChecked: false })`
        )
        await delay(600)
        const cleared = await cdp.evaluate(
          `window.bookscent.library.index().then(i => { const b = i.books.find(x => x.id === ${JSON.stringify(info.id)}); return b ? Boolean(b.style && b.style.coverImage) : null })`
        )
        console.log(`    抹掉封面后 coverImage=${cleared}`)
        await cdp.evaluate(
          `(() => { const n = document.querySelector('.titlebar button[title*="重新扫描"]'); if (n) n.click(); return !!n })()`
        )
        await delay(7000)
        const restored = await cdp.evaluate(
          `window.bookscent.library.index().then(i => { const b = i.books.find(x => x.id === ${JSON.stringify(info.id)}); return b ? { cover: (b.style && b.style.coverImage) || null, aspect: (b.style && b.style.coverImageAspect) || null, checked: Boolean(b.coverChecked) } : null })`
        )
        console.log(`    重新扫描之后 ${JSON.stringify(restored)}`)
        check(
          '老书（当时没取到封面）会被后台补录回来',
          Boolean(restored && restored.cover && restored.cover.startsWith('asset:')),
          JSON.stringify(restored)
        )
      }
    }
  }

  /** 从路径里猜书名片段（探针只用来在索引里找到那本书） */
  function titleHint(filePath) {
    return basename(filePath).replace(/\.[^.]+$/, '').slice(0, 6)
  }

  async function runBookendProbe() {
    await waitFor('document.querySelector(".app-shell")', '应用外壳', 30000)
    await delay(1800)

    // 先保证库里有东西可摆
    const shots = await cdp.evaluate(
      `window.bookscent.library.importPaths(${JSON.stringify(NOTES.slice(0, 6))}, false).then(r => r.added.length)`
    )
    await cdp.evaluate(
      `(() => { const n = document.querySelector('.titlebar button[title*="重新扫描"]'); if (n) n.click(); return !!n })()`
    )
    await delay(3000)
    console.log(`\n[仅书立] 导入 ${shots} 本，书架 ${await cdp.evaluate(`document.querySelectorAll('.book').length`)} 本`)

    const bookId = await cdp.evaluate(
      `document.querySelector('.book[data-book-id]')?.getAttribute('data-book-id') ?? null`
    )
    if (!bookId) {
      check('书架上有书脊可测', false, '没有 .book')
      return
    }

    // 清掉旧书立，从干净状态开始
    await cdp.evaluate(
      `window.bookscent.library.index().then(i => Promise.all((i.bookends||[]).map(b => window.bookscent.library.removeBookend(b.id))))`
    )
    await delay(600)

    // 用真实右键打开书脊菜单
    const bookRect = await cdp.evaluate(`(() => {
      const el = document.querySelector('.book[data-book-id="${bookId}"]')
      const r = el.getBoundingClientRect()
      return { x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2) }
    })()`)
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: bookRect.x, y: bookRect.y, button: 'right', clickCount: 1 })
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: bookRect.x, y: bookRect.y, button: 'right', clickCount: 1 })
    await delay(600)
    const added = await cdp.evaluate(`(() => {
      const item = Array.from(document.querySelectorAll('.context-item')).find(b => (b.textContent||'').includes('在右边加书立'))
      if (!item) return { ok: false, items: Array.from(document.querySelectorAll('.context-item')).map(x=>(x.textContent||'').trim()) }
      item.click()
      return { ok: true }
    })()`)
    check('书脊菜单里有「在右边加书立」', added.ok === true, added.ok ? '' : (added.items || []).join(' / '))
    await delay(900)

    const probe = await cdp.evaluate(`(() => {
      const el = document.querySelector('.shelf-bookend')
      if (!el) return { missing: true }
      const r = el.getBoundingClientRect()
      const cs = getComputedStyle(el)
      // 沿书立宽度取几个点，看看命中的到底是谁
      const samples = [0.15, 0.35, 0.5, 0.7, 0.85].map((f) => {
        const x = Math.round(r.left + r.width * f)
        const y = Math.round(r.top + r.height * 0.6)
        const at = document.elementFromPoint(x, y)
        return {
          f,
          x,
          y,
          tag: at ? at.tagName : null,
          cls: at ? String(at.className).slice(0, 40) : null,
          inBookend: !!(at && at.closest && at.closest('.shelf-bookend'))
        }
      })
      return {
        rect: { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) },
        display: cs.display,
        height: cs.height,
        zIndex: cs.zIndex,
        side: el.className,
        samples
      }
    })()`)
    console.log(`    书立几何 ${JSON.stringify(probe)}`)
    check('书立有真实尺寸', !probe.missing && probe.rect.w > 2 && probe.rect.h > 10, `w=${probe.rect?.w} h=${probe.rect?.h}`)
    const hitCount = (probe.samples ?? []).filter((s) => s.inBookend).length
    check('书立上有可命中的点', hitCount > 0, `${hitCount}/5 个采样点落在书立上`)

    const target = (probe.samples ?? []).find((s) => s.inBookend) ?? probe.samples?.[2]

    /*
     * 书立按朝向生效。
     *
     * 书脊与封面模式下书的宽度差很多，同一个换行位置常常只适合其中一种模式，
     * 所以书立可以声明范围。这里直接改数据再切朝向，看它在两边各自出现与否 ——
     * 比点菜单稳，也不会被"菜单位置"这种无关因素干扰。
     */
    const scoped = await cdp.evaluate(`(async () => {
      const index = await window.bookscent.library.index()
      const entry = (index.bookends ?? [])[0]
      if (!entry) return null
      await window.bookscent.library.updateBookend(entry.id, { facing: 'spine' })
      await window.bookscent.settings.patch({ ui: { bookFacing: 'spine' } })
      return entry.id
    })()`)
    check('书立能设成「只在书脊模式生效」', Boolean(scoped), String(scoped))
    await cdp.evaluate(`location.reload()`)
    await delay(4500)
    await waitFor('document.querySelector(".app-shell")', '重载后外壳', 25000)
    await delay(1800)

    const inSpine = await cdp.evaluate(`document.querySelectorAll('.shelf-bookend').length`)
    check('书脊模式下它还在', inSpine >= 1, String(inSpine))

    await cdp.evaluate(`window.bookscent.settings.patch({ ui: { bookFacing: 'cover' } })`)
    await cdp.evaluate(`location.reload()`)
    await delay(4500)
    await waitFor('document.querySelector(".app-shell")', '重载后外壳', 25000)
    await delay(1800)
    const inCover = await cdp.evaluate(`document.querySelectorAll('.shelf-bookend').length`)
    console.log(`    书脊模式 ${inSpine} 个书立 / 封面模式 ${inCover} 个`)
    check('封面模式下它不出现（按朝向生效）', inCover === 0, String(inCover))

    /* 收尾：切回书脊 + 恢复"两种模式都生效"，别影响后面那几条点击类断言 */
    await cdp.evaluate(`(async () => {
      const index = await window.bookscent.library.index()
      const entry = (index.bookends ?? [])[0]
      if (entry) await window.bookscent.library.updateBookend(entry.id, { facing: 'both' })
      await window.bookscent.settings.patch({ ui: { bookFacing: 'spine' } })
    })()`)
    await delay(800)
    /* 必须重载：上面是直接改数据，界面还停在"封面模式无书立"的画面上 */
    await cdp.evaluate(`location.reload()`)
    await delay(4500)
    await waitFor('document.querySelector(".app-shell")', '重载后外壳', 25000)
    await delay(1800)
    check(
      '恢复后书立回来了（两种模式都生效）',
      (await cdp.evaluate(`document.querySelectorAll('.shelf-bookend').length`)) >= 1,
      ''
    )
    if (target) {
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: target.x, y: target.y })
      await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: target.x, y: target.y, button: 'left', clickCount: 1 })
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: target.x, y: target.y, button: 'left', clickCount: 1 })
      await delay(700)
      const menu = await cdp.evaluate(`(() => {
        const m = document.querySelector('.context-menu')
        return { open: !!m, text: m ? (m.textContent||'').replace(/\\s+/g,' ').slice(0, 110) : null }
      })()`)
      console.log(`    点 ${target.x},${target.y}（命中 ${target.tag}.${target.cls}）→ ${JSON.stringify(menu)}`)
      check('真实点击书立能打开书立的菜单', menu.open === true, menu.text ?? '没有菜单')
      await shot('38-bookend-click.png', 300)

      /*
       * 二级菜单：适用朝向 / 到这里另起一行。
       *
       * 用户的要求是"调个模式不该还得专门切换书架模式"——所以朝向必须在菜单里直接换，
       * 而且换完菜单要留着（本来就是调着看的）。换行也一样，并且两种情况可以不同。
       */
      const centerOf = async (selector) =>
        cdp.evaluate(`(() => {
          const el = document.querySelector(${JSON.stringify(selector)})
          if (!el) return null
          const r = el.getBoundingClientRect()
          return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }
        })()`)
      const realClick = async (selector) => {
        const at = await centerOf(selector)
        if (!at) return false
        await mouse('mousePressed', at.x, at.y)
        await mouse('mouseReleased', at.x, at.y)
        return true
      }

      const headOk = await realClick('[data-action="toggleFacingMenu"]')
      await delay(500)
      const subItems = await cdp.evaluate(`(() => {
        const body = document.querySelector('.context-sub-body')
        return body ? [...body.querySelectorAll('button')].map((b) => (b.textContent || '').trim()) : null
      })()`)
      console.log(`    适用朝向二级菜单 ${JSON.stringify(subItems)}`)
      check('第 2 项：「适用朝向」是二级菜单（三项可选）', (subItems?.length ?? 0) === 3, JSON.stringify(subItems))
      check('第 2 项：菜单展开后不会自己关掉', (await cdp.evaluate(`Boolean(document.querySelector('.context-menu'))`)) === true, '')

      const pickedCover = await realClick('[data-action="facing:cover"]')
      await delay(900)
      const afterPick = await cdp.evaluate(`(async () => {
        const index = await window.bookscent.library.index()
        const entry = (index.bookends ?? [])[0]
        return { facing: entry ? entry.facing ?? 'both' : null, menu: Boolean(document.querySelector('.context-menu')) }
      })()`)
      console.log(`    选了「仅封面模式」之后 ${JSON.stringify(afterPick)}`)
      check('第 2 项：在菜单里直接把朝向改成仅封面模式', pickedCover === true && afterPick?.facing === 'cover', JSON.stringify(afterPick))

      /* 换行：两种模式各设一次 */
      await realClick('[data-action="toggleBreakMenu"]')
      await delay(500)
      const breakItems = await cdp.evaluate(`(() => {
        const body = document.querySelector('.context-sub-body')
        return body ? [...body.querySelectorAll('button')].map((b) => (b.textContent || '').trim()) : null
      })()`)
      console.log(`    换行二级菜单 ${JSON.stringify(breakItems)}`)
      check('第 2 项：「到这里另起一行」也是二级菜单', (breakItems?.length ?? 0) >= 1, JSON.stringify(breakItems))
      check(
        '第 2 项：朝着封面模式时只列封面那一档（不给无关开关）',
        Boolean((breakItems ?? []).every((t) => t.startsWith('封面模式'))),
        JSON.stringify(breakItems)
      )
      await realClick('[data-action="breakLine:cover"]')
      await delay(900)
      const breakState = await cdp.evaluate(`(async () => {
        const index = await window.bookscent.library.index()
        const entry = (index.bookends ?? [])[0]
        return { facing: entry?.facing ?? 'both', breakLine: entry?.breakLine, breakLineCover: entry?.breakLineCover }
      })()`)
      console.log(`    换行设置 ${JSON.stringify(breakState)}`)
      check(
        '第 2 项：换行能按封面模式单独设（书脊那档不受影响）',
        breakState?.breakLineCover === true && breakState?.breakLine !== true,
        JSON.stringify(breakState)
      )
      /* 收尾：切回两种模式，别影响后面的用例 */
      await realClick('[data-action="toggleFacingMenu"]')
      await delay(400)
      await realClick('[data-action="facing:both"]')
      await delay(900)
      check(
        '第 2 项：能切回两种模式都生效',
        (await cdp.evaluate(`window.bookscent.library.index().then((i) => ((i.bookends ?? [])[0] ?? {}).facing ?? 'both')`)) === 'both',
        ''
      )

      /*
       * 菜单项必须用**真实的 mousedown/mouseup/click** 去点。
       *
       * 之前这里写的是 item.click()，那只派一个 click 事件、不经过 mousedown，
       * 于是完全测不出"mousedown 就把菜单收掉、导致 click 永远不派发"这个 bug
       * —— 而这正是用户报的"菜单里的功能一点反应都没有，甚至没有点击事件"。
       */
      const realClickMenuItem = async (text) => {
        const hit = await cdp.evaluate(`(() => {
          const item = Array.from(document.querySelectorAll('.context-item'))
            .find(b => (b.textContent||'').includes(${JSON.stringify(text)}))
          if (!item) return null
          const r = item.getBoundingClientRect()
          const x = Math.round(r.left + r.width/2)
          const y = Math.round(r.top + r.height/2)
          const at = document.elementFromPoint(x, y)
          return {
            x, y,
            label: (item.textContent||'').trim(),
            rect: { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) },
            atTag: at ? at.tagName : null,
            atCls: at ? String(at.className).slice(0, 40) : null,
            atIsItem: !!(at && at.closest && at.closest('.context-item'))
          }
        })()`)
        if (!hit) return null
        console.log(`    菜单项 ${JSON.stringify(hit)}`)
        await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: hit.x, y: hit.y })
        await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: hit.x, y: hit.y, button: 'left', clickCount: 1 })
        await delay(80)
        // 关键：按下之后菜单还在不在？不在就说明 mousedown 把它收掉了
        const afterDown = await cdp.evaluate(
          `(() => ({ menus: document.querySelectorAll('.context-menu').length, items: document.querySelectorAll('.context-item').length }))()`
        )
        console.log(`    按下后 ${JSON.stringify(afterDown)}`)
        await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: hit.x, y: hit.y, button: 'left', clickCount: 1 })
        await delay(700)
        return { ...hit, afterDown }
      }

      /* 点菜单里的「加宽空位」，宽度必须真的变 */
      const widthBefore = await cdp.evaluate(
        `Math.round(document.querySelector('.shelf-bookend').getBoundingClientRect().width)`
      )
      const hitItem = await realClickMenuItem('加宽空位')
      // 顺手看一眼渲染进程有没有报错（比逐条打印日志有用）
      const errors = cdp.drainConsole().filter((line) => line.startsWith('[error]'))
      if (errors.length) console.log(`    渲染进程报了 ${errors.length} 条错误：\n      ` + errors.slice(0, 5).join('\n      '))
      check('操作过程中渲染进程没有报错', errors.length === 0, errors[0] ?? '')
      const widthAfter = await cdp.evaluate(
        `Math.round((document.querySelector('.shelf-bookend')||{getBoundingClientRect:()=>({width:0})}).getBoundingClientRect().width)`
      )
      check(
        '真实点击菜单项「加宽空位」生效',
        Boolean(hitItem) && widthAfter > widthBefore,
        `${hitItem ? hitItem.label : '没找到菜单项'}：${widthBefore} → ${widthAfter}px`
      )

      /* 以及「移除这个书立」 */
      await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: target.x + 6, y: target.y, button: 'left', clickCount: 1 })
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: target.x + 6, y: target.y, button: 'left', clickCount: 1 })
      await delay(600)
      const removed = await realClickMenuItem('移除这个书立')
      const left = await cdp.evaluate(`document.querySelectorAll('.shelf-bookend').length`)
      check('真实点击菜单项「移除这个书立」生效', Boolean(removed) && left === 0, `还剩 ${left} 个书立`)
    }
  }

  await waitFor('document.querySelector(".app-shell")', '应用外壳', 45000)
  await delay(1500)

  // 安全闸：这个脚本会往书库里塞书，绝不能跑在真实配置上
  const appInfo = await cdp.evaluate('window.bookscent.app.info()')
  if (!/verify/i.test(appInfo.userDataDir)) {
    throw new Error(`拒绝在真实配置上跑验证（userDataDir = ${appInfo.userDataDir}）`)
  }
  console.log(`应用已就绪（${appInfo.version}），配置目录 ${appInfo.userDataDir}`)

  /*
   * 只查书立。
   *
   * 整轮脚本很长，前面任何一节卡住（比如停在阅读器里）都会让书立那一节
   * 在"书架上一本书都没有"的状态下静默跳过 —— 我因此白验了两轮。
   * 这个开关让它能单独跑：ONLY=bookend node scripts/verify-app.mjs
   */
  if (process.env.ONLY === 'bookend') {
    await runBookendProbe()
    // 顶层不能 return（这一大段在 try 里），用一个哨兵跳到 catch 里收尾
    throw ONLY_DONE
  }

  if (process.env.ONLY === 'shelf') {
    await runShelfProbe()
    throw ONLY_DONE
  }

  if (process.env.ONLY === 'epub') {
    await runEpubProbe()
    throw ONLY_DONE
  }

  if (process.env.ONLY === 'about') {
    await runAboutProbe()
    throw ONLY_DONE
  }

  if (process.env.ONLY === 'theme') {
    await runThemeProbe()
    throw ONLY_DONE
  }

  if (process.env.ONLY === 'v090') {
    await runV090Probe()
    throw ONLY_DONE
  }

  if (process.env.ONLY === 'xcover') {
    await runXcoverProbe()
    throw ONLY_DONE
  }

  /** 阅读端四项：竖排兜底(5) / 主题热更新字色(6) / 选中色(7) / 字号字体行距(8)。 */
  async function runReadOptProbe() {
    await waitFor('document.querySelector(".app-shell")', '应用外壳', 30000)
    /*
     * 干净 profile 第一次启动时示例书是主进程慢慢写进去的，固定等 1.5 秒会扑空
     * （上一轮就这么空手而归）。轮询等书架上有书。
     */
    let count = 0
    for (let i = 0; i < 20; i += 1) {
      count = await cdp.evaluate(
        'window.bookscent.library.index().then((i) => i.books.length).catch(() => 0)'
      )
      if (count > 0) break
      await delay(1000)
    }
    console.log(`    书架上有 ${count} 本`)

    const src = process.env.JP_EPUB ?? process.env.JP_EPUB2 ?? ''
    const has = await cdp.evaluate(
      'window.bookscent.library.index().then((i) => i.books.some((b) => b.format === "epub"))'
    )
    if (!has && src) {
      await cdp.evaluate('window.bookscent.library.importPaths([' + JSON.stringify(src) + '], false)')
      await delay(2500)
      await cdp.evaluate('location.reload()')
      await delay(4500)
      await waitFor('document.querySelector(".app-shell")', '重载后外壳', 25000)
      await delay(2000)
    }

    const epub = await cdp.evaluate([
      'window.bookscent.library.index().then((i) => {',
      '  const b = i.books.find((x) => x.format === "epub");',
      '  return b ? { id: b.id, title: b.title } : null;',
      '})'
    ].join('\n'))
    check('书架上有一本 EPUB', Boolean(epub), JSON.stringify(epub))
    if (!epub) return

    await cdp.evaluate([
      '(() => {',
      '  const id = ' + JSON.stringify(epub.id) + ';',
      '  const el = [...document.querySelectorAll(".book")].find((b) => b.getAttribute("data-book-id") === id);',
      '  if (!el) return false;',
      '  el.click();',
      '  return true;',
      '})()'
    ].join('\n'))
    await delay(6000)
    check('进了阅读界面', (await cdp.evaluate('Boolean(document.querySelector(".reader-host"))')) === true, '')

    /*
     * 先走到**有正文**的章节。
     * 纯图片页的 body 是 0px、也没有 <p>，拿它比较字号/行距等于量了个空
     * （上一轮就这么白测了三条）。
     */
    const snap = () =>
      cdp.evaluate([
        '(() => {',
        '  const v = document.querySelector("foliate-view");',
        '  const contents = v && v.renderer && v.renderer.getContents ? v.renderer.getContents() : [];',
        '  const zone = [...document.querySelectorAll(".epub-flip-zone")]',
        '    .map((b) => b.getAttribute("title") || "")',
        '    .join(" | ");',
        '  let textLen = 0;',
        '  for (const c of contents) if (c && c.doc && c.doc.body) textLen += (c.doc.body.innerText || "").replace(/\\s/g, "").length;',
        '  return { textLen, vertical: zone.includes("竖排"), zone: zone.slice(0, 60), sections: contents.length };',
        '})()'
      ].join('\n'))

    let textSection = null
    for (let i = 0; i < 16; i += 1) {
      const now = await snap()
      if (now.textLen > 200) {
        textSection = now
        break
      }
      await cdp.evaluate('(() => { const v = document.querySelector("foliate-view"); if (v) v.next(); return true })()')
      await delay(1400)
    }
    console.log(`    找到正文章节 ${JSON.stringify(textSection)}`)
    check('EPUB 里有可测的正文章节', Boolean(textSection), JSON.stringify(textSection))
    if (!textSection) return

    /* ---------- 5. 纯图片章节要沿用这本书的朝向 ---------- */
    const bookVertical = textSection.vertical
    console.log(`    这本书的正文按${bookVertical ? '竖排' : '横排'}处理`)
    /* 回到书的最前面：轻小说的插图页通常在最开头，只往后扫会全部错过 */
    for (let i = 0; i < 24; i += 1) {
      const head = await snap()
      if (head.sections === 0) break
      await cdp.evaluate('(() => { const v = document.querySelector("foliate-view"); if (v) v.prev(); return true })()')
      await delay(500)
    }
    await delay(1200)
    const imageOnly = []
    for (let i = 0; i < 20; i += 1) {
      const now = await snap()
      if (now.sections > 0 && now.textLen < 12) imageOnly.push(now)
      if (imageOnly.length >= 2) break
      await cdp.evaluate('(() => { const v = document.querySelector("foliate-view"); if (v) v.next(); return true })()')
      await delay(1400)
    }
    console.log(`    纯图片章节样本 ${JSON.stringify(imageOnly.slice(0, 2))}`)
    if (imageOnly.length > 0) {
      check(
        '第 5 项：纯图片章节与这本书的朝向一致（不被误判成横排）',
        imageOnly.every((s) => s.vertical === bookVertical),
        `书=${bookVertical ? '竖排' : '横排'} / 图片页=${JSON.stringify(imageOnly.map((s) => s.vertical))}`
      )
    } else {
      console.log('    （这本没扫到纯图片章节，跳过第 5 项）')
    }

    /*
     * 第 5 项的第二层：结论要记进书里。
     * 重开这本书，连最前面的插图页都该直接按竖排处理 ——
     * 只靠"本次会话见过竖排章节"的话，重开后又会从封面开始错一遍。
     */
    if (bookVertical) {
      await cdp.evaluate(`location.reload()`)
      await delay(4500)
      await waitFor('document.querySelector(".app-shell")', '重载后外壳', 25000)
      await delay(2000)
      await cdp.evaluate(`(() => {
        const id = ${JSON.stringify(epub.id)}
        const el = [...document.querySelectorAll('.book')].find((b) => b.getAttribute('data-book-id') === id)
        if (el) el.click()
        return Boolean(el)
      })()`)
      await delay(6500)
      const head = await snap()
      console.log(`    重开后的第一页 ${JSON.stringify(head)}`)
      check('第 5 项：重开之后封面/插图页也按竖排处理（朝向记在书里）', head.vertical === true, JSON.stringify(head))
    }
    /*
     * 回到有正文的章节（后面几项都在它上面测）。
     *
     * 注意方向：第 5 项的扫描是从书的最前面往**后**走的，所以这里也必须往后找 ——
     * 往回翻会翻到书外，量到的还是空的插图页（上一轮就是这么量出 0px 的）。
     */
    let backToText = false
    for (let i = 0; i < 20; i += 1) {
      const now = await snap()
      if (now.textLen > 200) {
        backToText = true
        break
      }
      await cdp.evaluate(
        '(() => { const v = document.querySelector("foliate-view"); if (v) v.next(); return true })()'
      )
      await delay(1400)
    }
    check('能回到有正文的章节（后面的字号/行距都在它上面量）', backToText, '')

    /* ---------- 7. 选中色跟着主题（注入的样式里有 ::selection） ---------- */
    const selRule = await cdp.evaluate([
      '(() => {',
      '  const v = document.querySelector("foliate-view");',
      '  const contents = v && v.renderer && v.renderer.getContents ? v.renderer.getContents() : [];',
      '  for (const c of contents) {',
      '    if (!c || !c.doc) continue;',
      '    const styles = [...c.doc.querySelectorAll("style")].map((s) => s.textContent || "").join("\\n");',
      '    const hit = /::selection[^}]*}/.exec(styles);',
      '    if (hit) return hit[0].slice(0, 120);',
      '  }',
      '  return null;',
      '})()'
    ].join('\n'))
    console.log('    选中色规则 ' + JSON.stringify(selRule))
    check('第 7 项：选中色用主题色而不是默认亮蓝', Boolean(selRule && selRule.includes('color-mix')), String(selRule))

    /*
     * ---------- 8. 字号 / 字体 / 行距：用真实 UI 驱动 ----------
     *
     * 注意不能用 settings.patch 直接改：那是外部改数据，测不出"用户点界面"这条路，
     * 也测不出热更新。所以这里点开「排版」弹层，老老实实操作滑块与按钮。
     */
    await cdp.evaluate(`(() => {
      const b = [...document.querySelectorAll('button')].find((x) => (x.textContent || '').trim() === '排版')
      if (b) b.click()
      return Boolean(b)
    })()`)
    await delay(700)

    const rangeCount = await cdp.evaluate(`document.querySelectorAll('.epub-range').length`)
    check('第 8 项：排版弹层里有字号与行距两个滑块', rangeCount === 2, `${rangeCount} 个滑块`)

    /* React 会拦 value setter，得用原型上的 setter 再派发 input/change */
    const setRange = (index, value) =>
      cdp.evaluate(`(() => {
        const el = [...document.querySelectorAll('.epub-range')][${index}]
        if (!el) return null
        const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value').set
        setter.call(el, '${value}')
        el.dispatchEvent(new Event('input', { bubbles: true }))
        el.dispatchEvent(new Event('change', { bubbles: true }))
        return el.value
      })()`)

    const readStyles = () =>
      cdp.evaluate(`(() => {
        const v = document.querySelector('foliate-view')
        const c = (v.renderer.getContents() || []).find((x) => x && x.doc && x.doc.body)
        if (!c) return null
        const cs = c.doc.defaultView.getComputedStyle(c.doc.body)
        /*
         * 竖排书的正文常塞在 div/span 里、body 反而是 0px，
         * 所以取"第一个真正带文字的元素"来量，别只盯着 <p>。
         */
        let target = null
        for (const el of c.doc.body.querySelectorAll('*')) {
          if ((el.textContent || '').trim().length > 8) { target = el; break }
        }
        const ts = c.doc.defaultView.getComputedStyle(target || c.doc.body)
        return {
          size: ts.fontSize,
          family: ts.fontFamily.slice(0, 48),
          line: ts.lineHeight,
          tag: target ? target.tagName : null,
          color: cs.color,
          bg: cs.backgroundColor
        }
      })()`)

    const before = await readStyles()
    console.log(`    调整前 ${JSON.stringify(before)}`)
    console.log(`    字号滑块 → ${JSON.stringify(await setRange(0, '1.6'))}`)
    await delay(800)
    console.log(`    行距滑块 → ${JSON.stringify(await setRange(1, '2.2'))}`)
    await delay(800)
    const fontClicked = await cdp.evaluate(`(() => {
      const b = [...document.querySelectorAll('.epub-menu-panel button')].find((x) => (x.textContent || '').trim() === '黑体')
      if (b) b.click()
      return Boolean(b)
    })()`)
    /* 注入新样式要等一拍：断言读早了会以为字体没换 */
    await delay(1800)
    const after = await readStyles()
    console.log(`    调整后 ${JSON.stringify(after)}`)
    check(
      '第 8 项：字号变大',
      Boolean(before && after && parseFloat(after.size) > parseFloat(before.size)),
      `${before?.size} → ${after?.size}`
    )
    /* 字体走的是设置 → 热更新那条链，比字号多一拍，单独再取一次 */
    await delay(1200)
    const afterFont = await readStyles()
    check(
      '第 8 项：字体跟着换（点了「黑体」）',
      Boolean(
        fontClicked &&
          before &&
          afterFont &&
          afterFont.family !== before.family &&
          /PingFang|YaHei|sans/i.test(afterFont.family)
      ),
      `${before?.family} → ${afterFont?.family}`
    )
    check(
      '第 8 项：行距可手动调（不再是三档）',
      Boolean(before && after && after.line !== before.line),
      `${before?.line} → ${after?.line}`
    )

    /* ---------- 6. 阅读中改背景要同步改字色 ---------- */
    await cdp.evaluate(`(() => { document.body.click(); return true })()`)
    await delay(400)
    const colorBefore = await readStyles()
    const picked = await cdp.evaluate(`(() => {
      const sel = document.querySelector('select.select')
      if (!sel) return null
      const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(sel), 'value').set
      setter.call(sel, 'night')
      sel.dispatchEvent(new Event('change', { bubbles: true }))
      return sel.value
    })()`)
    console.log(`    主题下拉 → ${JSON.stringify(picked)}`)
    await delay(1800)
    const colorAfter = await readStyles()
    console.log(`    背景/字色 ${JSON.stringify(colorBefore)} → ${JSON.stringify(colorAfter)}`)
    check(
      '第 6 项：换背景时字色一起变（不然深底黑字看不清）',
      Boolean(colorBefore && colorAfter && colorAfter.color !== colorBefore.color),
      `${colorBefore?.color} / ${colorBefore?.bg} → ${colorAfter?.color} / ${colorAfter?.bg}`
    )
    await shot('105-reader-options.png', 300)
  }

  /** 只测开书动画：它活了多久、幕布有没有压到不透明。 */
  async function runAnimProbe() {
    await waitFor('document.querySelector(".app-shell")', '应用外壳', 30000)
    await delay(1500)
    await patch({ openAnimation: 'full' })
    await delay(600)

    const clicked = await cdp.evaluate([
      '(() => {',
      '  const el = document.querySelector(".book");',
      '  if (!el) return null;',
      '  const info = { id: el.getAttribute("data-book-id"), cls: el.className };',
      '  el.click();',
      '  return info;',
      '})()'
    ].join('\n'))
    console.log('    点了这本书 ' + JSON.stringify(clicked))

    const samples = []
    for (const at of [80, 200, 350, 500, 700, 900, 1100, 1300, 1600]) {
      await delay(at - (samples.length ? samples[samples.length - 1].at : 0))
      const snap = await cdp.evaluate([
        '(() => {',
        '  const anim = document.querySelector(".open-anim");',
        '  const veil = document.querySelector(".open-anim-veil");',
        '  return {',
        '    anim: anim ? anim.className : null,',
        '    veil: veil ? parseFloat(getComputedStyle(veil).opacity) || 0 : null,',
        '    reader: Boolean(document.querySelector(".bs-pane, .bs-html, .pdf-view, .bs-ro-center")),',
        '  };',
        '})()'
      ].join('\n'))
      samples.push({ at, ...snap })
      console.log(`    t+${at}ms ${JSON.stringify(snap)}`)
    }

    const alive = samples.filter((s) => s.anim).length
    const maxVeil = Math.max(...samples.map((s) => s.veil ?? 0))
    check('动画至少活过 500ms（能被看到）', alive >= 3, `${alive}/9 个采样点看到动画`)
    check('幕布压到过不透明', maxVeil >= 0.9, `峰值 ${maxVeil.toFixed(2)}`)
    await shot('104-anim.png', 100)
  }

  /** 相册式看图器：独立入口、缩放、长按进选择态、就地导出。 */
  async function runGalleryProbe() {
    await waitFor('document.querySelector(".app-shell")', '应用外壳', 30000)
    let books = 0
    for (let i = 0; i < 20; i += 1) {
      books = await cdp.evaluate('window.bookscent.library.index().then((i) => i.books.length).catch(() => 0)')
      if (books > 0) break
      await delay(1000)
    }
    const src = process.env.JP_EPUB2 ?? process.env.JP_EPUB ?? ''
    const hasEpub = await cdp.evaluate(
      'window.bookscent.library.index().then((i) => i.books.some((b) => b.format === "epub"))',
    )
    if (!hasEpub && src) {
      await cdp.evaluate('window.bookscent.library.importPaths([' + JSON.stringify(src) + '], false)')
      await delay(2500)
      await cdp.evaluate('location.reload()')
      await delay(4500)
      await waitFor('document.querySelector(".app-shell")', '重载后外壳', 25000)
      await delay(2000)
    }
    const epub = await cdp.evaluate([
      'window.bookscent.library.index().then((i) => {',
      '  const b = i.books.find((x) => x.format === "epub");',
      '  return b ? { id: b.id, title: b.title } : null;',
      '})',
    ].join('\n'))
    check('书架上有一本 EPUB', Boolean(epub), JSON.stringify(epub))
    if (!epub) return
    await cdp.evaluate([
      '(() => {',
      '  const id = ' + JSON.stringify(epub.id) + ';',
      '  const el = [...document.querySelectorAll(".book")].find((b) => b.getAttribute("data-book-id") === id);',
      '  if (el) el.click();',
      '  return Boolean(el);',
      '})()',
    ].join('\n'))
    await delay(6500)

    /* 独立入口：工具栏上的「看图」，不经过导出弹窗 */
    const opened = await cdp.evaluate([
      '(() => {',
      '  const b = [...document.querySelectorAll("button")].find((x) => (x.textContent || "").trim() === "看图");',
      '  if (b) b.click();',
      '  return Boolean(b);',
      '})()',
    ].join('\n'))
    check('第 2 项：阅读器工具栏上有独立的「看图」入口', opened === true, String(opened))
    await delay(3000)

    let gal = null
    for (let i = 0; i < 15; i += 1) {
      gal = await cdp.evaluate([
        '(() => {',
        '  const root = document.querySelector(".epub-gallery");',
        '  if (!root) return null;',
        '  const img = document.querySelector(".epub-gallery-img");',
        '  return {',
        '    modalExportOpen: Boolean(document.querySelector(".modal")),',
        '    meta: (document.querySelector(".epub-gallery-meta")?.textContent || "").trim(),',
        '    img: Boolean(img),',
        '    natural: img ? img.naturalWidth + "x" + img.naturalHeight : null,',
        '    transform: img ? img.style.transform : null,',
        '    thumbs: document.querySelectorAll(".epub-gallery-thumb").length,',
        '  };',
        '})()',
      ].join('\n'))
      if (gal && gal.img) break
      await delay(1000)
    }
    console.log(`    看图器 ${JSON.stringify(gal)}`)
    check('第 2 项：看图器直接打开（不必先进导出弹窗）', Boolean(gal && gal.modalExportOpen === false), JSON.stringify(gal))
    check('第 2 项：大图读出来了（原图字节生成的 object URL）', Boolean(gal?.natural), JSON.stringify(gal))
    check('第 2 项：有页码计数与底部胶片条', Boolean(gal?.meta && (gal?.thumbs ?? 0) > 1), JSON.stringify(gal))

    /* 缩放：滚轮 */
    const zoomed = await cdp.evaluate([
      '(() => {',
      '  const canvas = document.querySelector(".epub-gallery-canvas");',
      '  if (!canvas) return null;',
      '  for (let i = 0; i < 4; i += 1) {',
      '    canvas.dispatchEvent(new WheelEvent("wheel", { deltaY: -120, bubbles: true, cancelable: true }));',
      '  }',
      '  return true;',
      '})()',
    ].join('\n'))
    check('能在看图器上滚轮缩放', zoomed === true, String(zoomed))
    await delay(700)
    const afterZoom = await cdp.evaluate([
      '(() => {',
      '  const img = document.querySelector(".epub-gallery-img");',
      '  const meta = (document.querySelector(".epub-gallery-meta")?.textContent || "").trim();',
      '  return { transform: img ? img.style.transform : null, meta };',
      '})()',
    ].join('\n'))
    console.log(`    缩放后 ${JSON.stringify(afterZoom)}`)
    check(
      '第 2 项：图被放大了（transform 里有 scale > 1）',
      Boolean(afterZoom?.transform && /scale\((\d+(\.\d+)?)\)/.test(afterZoom.transform) && parseFloat(/scale\(([\d.]+)\)/.exec(String(afterZoom.transform))?.[1] ?? "1") > 1),
      String(afterZoom?.transform)
    )
    await shot('108-gallery.png', 300)

    /* 长按进选择态 */
    await cdp.evaluate([
      '(() => {',
      '  const canvas = document.querySelector(".epub-gallery-canvas");',
      '  if (!canvas) return false;',
      '  const rect = canvas.getBoundingClientRect();',
      '  const opts = { bubbles: true, button: 0, clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 };',
      '  canvas.dispatchEvent(new PointerEvent("pointerdown", opts));',
      '  return true;',
      '})()',
    ].join('\n'))
    await delay(900)
    await cdp.evaluate([
      '(() => {',
      '  const canvas = document.querySelector(".epub-gallery-canvas");',
      '  if (canvas) canvas.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, button: 0 }));',
      '  return true;',
      '})()',
    ].join('\n'))
    await delay(500)
    const inSelect = await cdp.evaluate([
      '(() => {',
      '  const foot = document.querySelector(".epub-gallery-foot");',
      '  return foot ? [...foot.querySelectorAll("button")].map((b) => (b.textContent || "").trim()) : null;',
      '})()',
    ].join('\n'))
    console.log(`    底部条 ${JSON.stringify(inSelect)}`)
    check('第 2 项：长按进入选择态（底部出现导出选中）', Boolean(inSelect?.some((t) => t.startsWith('导出选中'))), JSON.stringify(inSelect))

    /* 点图勾选 */
    await cdp.evaluate([
      '(() => {',
      '  const canvas = document.querySelector(".epub-gallery-canvas");',
      '  if (canvas) canvas.click();',
      '  return true;',
      '})()',
    ].join('\n'))
    await delay(600)
    const picked = await cdp.evaluate([
      '(() => ({',
      '  count: (document.querySelector(".epub-gallery-count")?.textContent || "").trim(),',
      '  badge: Boolean(document.querySelector(".epub-gallery-picked")),',
      '  foot: [...document.querySelectorAll(".epub-gallery-foot button")].map((b) => (b.textContent || "").trim())',
      '}))()',
    ].join('\n'))
    console.log(`    勾选之后 ${JSON.stringify(picked)}`)
    check('第 2 项：点图能勾选（不做任何导出）', Boolean(picked?.badge && (picked?.count ?? '').includes('1')), JSON.stringify(picked))

    /* 翻页 */
    const before = gal?.meta
    await cdp.evaluate([
      '(() => {',
      '  const next = document.querySelector(".epub-gallery-nav.is-next");',
      '  if (next) next.click();',
      '  return Boolean(next);',
      '})()',
    ].join('\n'))
    await delay(1800)
    const after = await cdp.evaluate('(document.querySelector(".epub-gallery-meta")?.textContent || "").trim()')
    console.log(`    翻页 ${JSON.stringify(before)} → ${JSON.stringify(after)}`)
    check('能翻到下一张', Boolean(before && after && before !== after), `${before} → ${after}`)

    /* Esc 两步退出：先退出选择态，再关掉看图器 */
    await cdp.evaluate([
      '(() => {',
      '  window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));',
      '  return true;',
      '})()',
    ].join('\n'))
    await delay(600)
    const stillOpen = await cdp.evaluate('Boolean(document.querySelector(".epub-gallery"))')
    const selectGone = await cdp.evaluate(
      '(() => ![...document.querySelectorAll(".epub-gallery-foot button")].some((b) => (b.textContent || "").includes("导出选中")))()'
    )
    check(
      'Esc 第一步先退出选择态（不至于一下把看图器关掉）',
      stillOpen === true && selectGone === true,
      `open=${stillOpen} selectGone=${selectGone}`
    )
    await cdp.evaluate([
      '(() => {',
      '  window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));',
      '  return true;',
      '})()',
    ].join('\n'))
    await delay(600)
    const closed = await cdp.evaluate('!document.querySelector(".epub-gallery")')
    check('Esc 再按一次退出看图器', closed === true, String(closed))
  }

  /** 书签：可见标记 + 侧栏即时刷新 + 备注 + 与笔记的区分。 */
  async function runBookmarkProbe() {
    await waitFor('document.querySelector(".app-shell")', '应用外壳', 30000)
    let count = 0
    for (let i = 0; i < 20; i += 1) {
      count = await cdp.evaluate(
        'window.bookscent.library.index().then((i) => i.books.length).catch(() => 0)'
      )
      if (count > 0) break
      await delay(1000)
    }
    const src = process.env.JP_EPUB ?? process.env.JP_EPUB2 ?? ''
    const hasEpub = await cdp.evaluate(
      'window.bookscent.library.index().then((i) => i.books.some((b) => b.format === "epub"))'
    )
    if (!hasEpub && src) {
      await cdp.evaluate('window.bookscent.library.importPaths([' + JSON.stringify(src) + '], false)')
      await delay(2500)
      await cdp.evaluate('location.reload()')
      await delay(4500)
      await waitFor('document.querySelector(".app-shell")', '重载后外壳', 25000)
      await delay(2000)
    }
    const epub = await cdp.evaluate([
      'window.bookscent.library.index().then((i) => {',
      '  const b = i.books.find((x) => x.format === "epub");',
      '  return b ? { id: b.id, title: b.title } : null;',
      '})'
    ].join('\n'))
    check('书架上有一本 EPUB', Boolean(epub), JSON.stringify(epub))
    if (!epub) return
    await cdp.evaluate([
      '(() => {',
      '  const id = ' + JSON.stringify(epub.id) + ';',
      '  const el = [...document.querySelectorAll(".book")].find((b) => b.getAttribute("data-book-id") === id);',
      '  if (el) el.click();',
      '  return Boolean(el);',
      '})()'
    ].join('\n'))
    await delay(6500)

    /* 走到有正文的章节 */
    const scan = () =>
      cdp.evaluate([
        '(() => {',
        '  const v = document.querySelector("foliate-view");',
        '  const contents = v && v.renderer && v.renderer.getContents ? v.renderer.getContents() : [];',
        '  let textLen = 0;',
        '  for (const c of contents) if (c && c.doc && c.doc.body) textLen += (c.doc.body.innerText || "").replace(/\\s/g, "").length;',
        '  return textLen;',
        '})()'
      ].join('\n'))
    for (let i = 0; i < 16; i += 1) {
      if ((await scan()) > 200) break
      await cdp.evaluate('(() => { const v = document.querySelector("foliate-view"); if (v) v.next(); return true })()')
      await delay(1400)
    }
    check('有可测的正文章节', (await scan()) > 200, '')

    /* 选中一段文字，工具条上应当是「记为笔记」 */
    const selected = await cdp.evaluate([
      '(() => {',
      '  const v = document.querySelector("foliate-view");',
      '  const contents = v.renderer.getContents().filter((c) => c && c.doc && c.doc.body);',
      '  for (const content of contents) {',
      '    const doc = content.doc;',
      '    const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);',
      '    let node = walker.nextNode();',
      '    while (node && (node.data || "").trim().length < 8) node = walker.nextNode();',
      '    if (!node) continue;',
      '    const range = doc.createRange();',
      '    range.setStart(node, 0);',
      '    range.setEnd(node, Math.min(18, node.data.length));',
      '    const sel = doc.getSelection();',
      '    sel.removeAllRanges();',
      '    sel.addRange(range);',
      '    node.parentElement.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));',
      '    doc.dispatchEvent(new Event("selectionchange"));',
      '    return range.toString();',
      '  }',
      '  return null;',
      '})()'
    ].join('\n'))
    console.log(`    选中 ${JSON.stringify(selected)}`)
    await delay(800)
    const barLabel = await cdp.evaluate([
      '(() => {',
      '  const bar = document.querySelector(".text-action-bar");',
      '  return bar ? [...bar.querySelectorAll("button")].map((b) => (b.textContent || "").trim()) : null;',
      '})()'
    ].join('\n'))
    console.log(`    工具条 ${JSON.stringify(barLabel)}`)
    check('第 4 项：工具条上写的是「记为笔记」', Boolean(barLabel?.includes('记为笔记')), JSON.stringify(barLabel))

    /* 点它 → 记成一条笔记 */
    await cdp.evaluate([
      '(() => {',
      '  const b = [...document.querySelectorAll(".text-action-bar button")].find((x) => (x.textContent || "").trim() === "记为笔记");',
      '  if (b) b.click();',
      '  return Boolean(b);',
      '})()'
    ].join('\n'))
    await delay(1600)

    /* 可见标记：正文里被标出的那段 + 右上角色带 */
    const marks = await cdp.evaluate([
      '(() => {',
      '  const v = document.querySelector("foliate-view");',
      '  const contents = v.renderer.getContents().filter((c) => c && c.doc);',
      '  let bm = 0;',
      '  for (const c of contents) bm += c.doc.querySelectorAll(".epub-bm-mark").length;',
      '  return { bm, ribbon: Boolean(document.querySelector(".epub-bm-ribbon")) };',
      '})()'
    ].join('\n'))
    console.log(`    页面上的书签标记 ${JSON.stringify(marks)}`)
    check('第 3 项：书签在正文里看得见（下划线标记）', (marks?.bm ?? 0) >= 1, JSON.stringify(marks))
    check('第 3 项：这一页右上角有色带提示', marks?.ribbon === true, JSON.stringify(marks))

    /* 侧栏默认停在「目录」，先切到书签那一栏再看 */
    await cdp.evaluate(`(() => {
      const tab = [...document.querySelectorAll('.reader-side-tab')].find((b) =>
        (b.textContent || '').trim().startsWith('书签')
      )
      if (tab) tab.click()
      return Boolean(tab)
    })()`)
    await delay(900)
    /* 侧栏应当立刻就有（不用重载）——这是共享 store 修掉的那个 bug */
    const side = await cdp.evaluate([
      '(() => {',
      '  const tabs = [...document.querySelectorAll(".reader-side-tab")].map((b) => (b.textContent || "").trim());',
      '  const groups = [...document.querySelectorAll(".pdf-bookmark-group-title")].map((s) => (s.textContent || "").trim());',
      '  return { tabs, groups, rows: document.querySelectorAll(".pdf-bookmark").length };',
      '})()'
    ].join('\n'))
    console.log(`    侧栏 ${JSON.stringify(side)}`)
    check('第 3 项：标记的当下侧栏就显示出来了（无需重载）', (side?.rows ?? 0) >= 1, JSON.stringify(side))
    check('第 4 项：按「笔记」分组（因为带着原文）', (side?.groups ?? []).some((g) => g.startsWith('笔记')), JSON.stringify(side?.groups))

    /* 写备注 */
    const opened = await cdp.evaluate([
      '(() => {',
      '  const row = document.querySelector(".pdf-bookmark");',
      '  if (!row) return false;',
      '  const btns = [...row.querySelectorAll(".pdf-bookmark-tools button")];',
      '  const note = btns[1];',
      '  if (note) note.click();',
      '  return Boolean(note);',
      '})()'
    ].join('\n'))
    check('第 3 项：书签行上有「写备注」入口', opened === true, String(opened))
    await delay(700)
    const typed = await cdp.evaluate([
      '(() => {',
      '  const ta = document.querySelector(".pdf-bookmark-note-edit textarea");',
      '  if (!ta) return false;',
      '  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(ta), "value").set;',
      '  setter.call(ta, "这里要再看一遍：作者对纸的味道的说法很有意思。");',
      '  ta.dispatchEvent(new Event("input", { bubbles: true }));',
      '  return true;',
      '})()'
    ].join('\n'))
    check('能打开备注输入框', typed === true, String(typed))
    await delay(500)
    await cdp.evaluate([
      '(() => {',
      '  const b = [...document.querySelectorAll(".pdf-bookmark-note-foot button")].find((x) => (x.textContent || "").trim() === "保存备注");',
      '  if (b) b.click();',
      '  return Boolean(b);',
      '})()'
    ].join('\n'))
    await delay(1600)

    const stored = await cdp.evaluate([
      'window.bookscent.library.record(' + JSON.stringify(epub.id) + ').then((r) => {',
      '  const b = (r.bookmarks || [])[0];',
      '  return b ? { count: (r.bookmarks || []).length, note: b.note, excerpt: (b.excerpt || "").slice(0, 12), label: b.label } : null;',
      '})'
    ].join('\n'))
    console.log(`    记录里的书签 ${JSON.stringify(stored)}`)
    check('第 3 项：备注写进了记录', Boolean(stored?.note && stored.note.includes('纸的味道')), JSON.stringify(stored))
    const shown = await cdp.evaluate([
      '(() => {',
      '  const n = document.querySelector(".pdf-bookmark-note");',
      '  return n ? (n.textContent || "").slice(0, 20) : null;',
      '})()'
    ].join('\n'))
    console.log(`    列表里显示的备注 ${JSON.stringify(shown)}`)
    check('第 3 项：备注在列表里看得见', Boolean(shown && shown.includes('纸的味道')), String(shown))
    await shot('106-bookmark-note.png', 300)

    /* 位置书签：Ctrl+B 那种只记位置，应当归到「书签」一组 */
    await cdp.evaluate('(() => { const v = document.querySelector("foliate-view"); if (v) v.next(); return true })()')
    await delay(1800)
    await cdp.evaluate('(() => { const b = [...document.querySelectorAll(".pdf-panel-head button")][0]; if (b) b.click(); return Boolean(b) })()')
    await delay(1600)
    const groups2 = await cdp.evaluate([
      '(() => [...document.querySelectorAll(".pdf-bookmark-group-title")].map((s) => (s.textContent || "").trim()))()'
    ].join('\n'))
    console.log(`    两组标题 ${JSON.stringify(groups2)}`)
    check(
      '第 4 项：纯位置书签归到「书签」，带原文的归到「笔记」',
      Boolean((groups2 ?? []).some((g) => g.startsWith('书签')) && (groups2 ?? []).some((g) => g.startsWith('笔记'))),
      JSON.stringify(groups2)
    )
    await shot('107-bookmark-groups.png', 300)
  }

  /**
   * PDF 正文文字操作：文字层能选中 → 高亮 → 重开之后还在。
   */
  async function runPdfTextProbe() {
    await waitFor('document.querySelector(".app-shell")', '应用外壳', 30000)
    await delay(1500)

    const pdf = await cdp.evaluate([
      'window.bookscent.library.index().then((i) => {',
      '  const b = i.books.find((x) => x.format === "pdf");',
      '  return b ? { id: b.id, title: b.title } : null;',
      '})'
    ].join('\n'))
    check('书架上有一本 PDF', Boolean(pdf), JSON.stringify(pdf))
    if (!pdf) return

    const clickBook = (id) =>
      cdp.evaluate([
        '(() => {',
        '  const id = ' + JSON.stringify(id) + ';',
        '  const el = [...document.querySelectorAll(".book")].find((b) => b.getAttribute("data-book-id") === id);',
        '  if (!el) return false;',
        '  el.click();',
        '  return true;',
        '})()'
      ].join('\n'))
    await clickBook(pdf.id)
    await delay(6000)
    check('进了阅读界面', (await cdp.evaluate('Boolean(document.querySelector(".reader-host"))')) === true, '')

    /* 等文字层出现（canvas 之外多了透明文字才可能选中） */
    let spans = 0
    for (let i = 0; i < 20; i += 1) {
      spans = await cdp.evaluate('document.querySelectorAll(".pdf-text-layer span").length')
      if (spans > 0) break
      await delay(1000)
    }
    console.log('    文字层里的文字块 ' + spans)
    check('PDF 渲染出了文字层（能选中）', spans > 0, String(spans))
    if (spans === 0) return

    /* 在文字层里造一个选区 */
    const selected = await cdp.evaluate([
      '(() => {',
      '  const layer = document.querySelector(".pdf-text-layer");',
      '  if (!layer) return null;',
      '  const nodes = [...layer.querySelectorAll("span")].filter((s) => (s.textContent || "").trim().length > 1);',
      '  if (nodes.length === 0) return null;',
      '  const range = document.createRange();',
      '  range.setStart(nodes[0].firstChild || nodes[0], 0);',
      '  const last = nodes[Math.min(2, nodes.length - 1)];',
      '  range.setEnd(last.firstChild || last, (last.textContent || "").length);',
      '  const sel = window.getSelection();',
      '  sel.removeAllRanges();',
      '  sel.addRange(range);',
      '  layer.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));',
      '  return { text: range.toString().slice(0, 24), rects: range.getClientRects().length };',
      '})()'
    ].join('\n'))
    console.log('    PDF 里选中了 ' + JSON.stringify(selected))
    check('能在 PDF 文字层里选中一段', Boolean(selected?.text), JSON.stringify(selected))
    await delay(800)

    const bar = await cdp.evaluate([
      '(() => {',
      '  const el = document.querySelector(".text-action-bar");',
      '  if (!el) return { missing: true };',
      '  return {',
      '    buttons: [...el.querySelectorAll("button")].map((b) => (b.textContent || "").trim()).filter(Boolean),',
      '    colors: el.querySelectorAll(".text-action-color").length',
      '  };',
      '})()'
    ].join('\n'))
    console.log('    PDF 工具条 ' + JSON.stringify(bar))
    check('PDF 选中后浮出同一个工具条', bar?.missing !== true, JSON.stringify(bar))
    check(
      '工具条上有复制 / 划线 / 标记书签与配色',
      Boolean(
        bar?.buttons?.includes('复制') &&
          bar?.buttons?.includes('划线') &&
          bar?.buttons?.includes('标记书签') &&
          (bar?.colors ?? 0) >= 3
      ),
      JSON.stringify(bar)
    )

    await cdp.evaluate(
      '(() => { const el = document.querySelector(".text-action-bar .text-action-color"); if (el) el.click(); return Boolean(el); })()'
    )
    await delay(1800)

    const painted = await cdp.evaluate('document.querySelectorAll(".pdf-mark").length')
    console.log('    PDF 页面上的标注块 ' + painted)
    check('高亮画进了页面（.pdf-mark）', (painted ?? 0) >= 1, String(painted))

    const stored = await cdp.evaluate([
      'window.bookscent.library.record(' + JSON.stringify(pdf.id) + ').then((r) => {',
      '  const list = r.pdfHighlights || [];',
      '  return { count: list.length, first: list[0] ? { page: list[0].page, style: list[0].style, rects: list[0].rects.length } : null };',
      '})'
    ].join('\n'))
    console.log('    记录里存下的 PDF 标注 ' + JSON.stringify(stored))
    check('标注写进了阅读记录', (stored?.count ?? 0) >= 1, JSON.stringify(stored))
    await shot('102-pdf-text-mark.png', 300)

    /* 重开之后要画回来 */
    await cdp.evaluate('location.reload()')
    await delay(5000)
    await waitFor('document.querySelector(".app-shell")', '重载后外壳', 25000)
    await delay(2000)
    await clickBook(pdf.id)
    await delay(7000)

    let rePainted = 0
    for (let i = 0; i < 15; i += 1) {
      rePainted = await cdp.evaluate('document.querySelectorAll(".pdf-mark").length')
      if (rePainted > 0) break
      await delay(1200)
    }
    console.log('    重开之后重新画上的标注块 ' + rePainted)
    check('重开之后高亮被重新画上', rePainted >= 1, String(rePainted))
    await shot('103-pdf-text-mark-reloaded.png', 300)
  }

  /**
   * EPUB 正文文字操作：选中 → 高亮 / 划线，并且重开之后还能画回来。
   */
  async function runMarkProbe() {
    await waitFor('document.querySelector(".app-shell")', '应用外壳', 30000)
    await delay(1500)

    /* 没有 EPUB 就导入一本（干净 profile 里示例书是异步建的） */
    const hasEpub = await cdp.evaluate(
      'window.bookscent.library.index().then((i) => i.books.some((b) => b.format === "epub"))'
    )
    if (!hasEpub && process.env.JP_EPUB) {
      await cdp.evaluate(
        'window.bookscent.library.importPaths([' + JSON.stringify(process.env.JP_EPUB) + '], false)'
      )
      await delay(2500)
      await cdp.evaluate('location.reload()')
      await delay(4500)
      await waitFor('document.querySelector(".app-shell")', '重载后外壳', 25000)
      await delay(2000)
    }

    const epub = await cdp.evaluate([
      'window.bookscent.library.index().then((i) => {',
      '  const b = i.books.find((x) => x.format === "epub");',
      '  return b ? { id: b.id, title: b.title } : null;',
      '})'
    ].join('\n'))
    check('书架上有一本 EPUB', Boolean(epub), JSON.stringify(epub))
    if (!epub) return

    const clickBook = (id) =>
      cdp.evaluate([
        '(() => {',
        '  const id = ' + JSON.stringify(id) + ';',
        '  const el = [...document.querySelectorAll(".book")].find((b) => b.getAttribute("data-book-id") === id);',
        '  if (!el) return false;',
        '  el.click();',
        '  return true;',
        '})()'
      ].join('\n'))
    await clickBook(epub.id)
    await delay(6000)
    check('进了阅读界面', (await cdp.evaluate('Boolean(document.querySelector(".reader-host"))')) === true, '')

    /* 等 foliate 把某一章渲染出来 */
    let sections = 0
    for (let i = 0; i < 20; i += 1) {
      sections = await cdp.evaluate([
        '(() => {',
        '  const v = document.querySelector("foliate-view");',
        '  const list = v && v.renderer && v.renderer.getContents ? v.renderer.getContents() : [];',
        '  return list.filter((c) => c && c.doc && c.doc.body).length;',
        '})()'
      ].join('\n'))
      if (sections > 0) break
      await delay(1000)
    }
    console.log('    已渲染章节数 ' + sections)
    check('EPUB 正文渲染出来了', sections > 0, String(sections))
    if (sections === 0) return

    /*
     * 在正文里造一个选区，并触发阅读器挂的监听。
     * 一开始渲染的往往是封面/版权页（一个文字节点都没有），所以要往后翻几页找正文。
     */
    const selectSomething = () =>
      cdp.evaluate([
        '(() => {',
        '  const v = document.querySelector("foliate-view");',
        '  const contents = v.renderer.getContents().filter((c) => c && c.doc && c.doc.body);',
        '  for (const content of contents) {',
        '    const doc = content.doc;',
        '    const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);',
        '    let node = walker.nextNode();',
        '    while (node && (node.data || "").trim().length < 2) node = walker.nextNode();',
        '    if (!node) continue;',
        '    const range = doc.createRange();',
        '    range.setStart(node, 0);',
        '    range.setEnd(node, Math.max(1, Math.min(14, node.data.length)));',
        '    const sel = doc.getSelection();',
        '    sel.removeAllRanges();',
        '    sel.addRange(range);',
        '    node.parentElement.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));',
        '    doc.dispatchEvent(new Event("selectionchange"));',
        '    return { text: range.toString(), section: content.index };',
        '  }',
        '  return null;',
        '})()'
      ].join('\n'))

    let selected = await selectSomething()
    for (let i = 0; i < 8 && !selected; i += 1) {
      await cdp.evaluate([
        '(() => {',
        '  const v = document.querySelector("foliate-view");',
        '  v.next();',
        '  return true;',
        '})()'
      ].join('\n'))
      await delay(1800)
      selected = await selectSomething()
    }
    console.log('    选中了 ' + JSON.stringify(selected))
    check('能在正文里选中一段文字', Boolean(selected?.text), JSON.stringify(selected))
    await delay(800)

    const bar = await cdp.evaluate([
      '(() => {',
      '  const el = document.querySelector(".epub-selbar");',
      '  if (!el) return { missing: true };',
      '  return {',
      '    buttons: [...el.querySelectorAll("button")].map((b) => (b.textContent || "").trim()).filter(Boolean),',
      '    colors: el.querySelectorAll(".epub-selbar-color").length',
      '  };',
      '})()'
    ].join('\n'))
    console.log('    工具条 ' + JSON.stringify(bar))
    check('选中后浮出工具条', bar?.missing !== true, JSON.stringify(bar))
    check(
      '工具条上有复制 / 划线 / 标记书签',
      Boolean(bar?.buttons?.includes('复制') && bar?.buttons?.includes('划线') && bar?.buttons?.includes('标记书签')),
      JSON.stringify(bar?.buttons)
    )
    check('工具条上有高亮配色', (bar?.colors ?? 0) >= 3, String(bar?.colors))

    /* 点第一个配色 = 高亮 */
    await cdp.evaluate([
      '(() => {',
      '  const el = document.querySelector(".epub-selbar .epub-selbar-color");',
      '  if (el) el.click();',
      '  return Boolean(el);',
      '})()'
    ].join('\n'))
    await delay(1500)

    const painted = await cdp.evaluate([
      '(() => {',
      '  const v = document.querySelector("foliate-view");',
      '  const contents = v.renderer.getContents().filter((c) => c && c.doc);',
      '  let marks = 0;',
      '  for (const c of contents) marks += c.doc.querySelectorAll("mark.epub-mark").length;',
      '  return marks;',
      '})()'
    ].join('\n'))
    console.log('    正文里的标注数 ' + painted)
    check('高亮画进了正文（mark.epub-mark）', (painted ?? 0) >= 1, String(painted))

    const stored = await cdp.evaluate([
      'window.bookscent.library.record(' + JSON.stringify(epub.id) + ').then((r) => {',
      '  const list = r.highlights || [];',
      '  return { count: list.length, first: list[0] ? { style: list[0].style, text: list[0].text.slice(0, 16), section: list[0].section } : null };',
      '})'
    ].join('\n'))
    console.log('    记录里存下的标注 ' + JSON.stringify(stored))
    check('标注写进了阅读记录', (stored?.count ?? 0) >= 1, JSON.stringify(stored))
    await shot('100-text-mark.png', 300)

    /* 关键：重开之后还要画回来 */
    await cdp.evaluate('location.reload()')
    await delay(5000)
    await waitFor('document.querySelector(".app-shell")', '重载后外壳', 25000)
    await delay(2000)
    await clickBook(epub.id)
    await delay(7000)

    let rePainted = 0
    for (let i = 0; i < 15; i += 1) {
      rePainted = await cdp.evaluate([
        '(() => {',
        '  const v = document.querySelector("foliate-view");',
        '  const contents = v && v.renderer && v.renderer.getContents ? v.renderer.getContents() : [];',
        '  let marks = 0;',
        '  for (const c of contents) if (c && c.doc) marks += c.doc.querySelectorAll("mark.epub-mark").length;',
        '  return marks;',
        '})()'
      ].join('\n'))
      if (rePainted > 0) break
      await delay(1200)
    }
    console.log('    重开之后重新画上的标注数 ' + rePainted)
    check('重开之后高亮被重新画上（持久化 + 重绘）', rePainted >= 1, String(rePainted))
    await shot('101-text-mark-reloaded.png', 300)
  }

  /**
   * 导出图片的「看图模式」，以及笔记导出的两个默认不勾的选项。
   */
  async function runExportUiProbe() {
    await waitFor('document.querySelector(".app-shell")', '应用外壳', 30000)
    await delay(1500)

    /*
     * 干净 profile 里示例书是启动后异步建的，可能还没落地 —— 没有 EPUB 就自己导入一本，
     * 免得探针在这里白跑（上一版就是这么空的）。
     */
    const hasEpub = await cdp.evaluate(
      'window.bookscent.library.index().then((i) => i.books.some((b) => b.format === "epub"))'
    )
    if (!hasEpub && process.env.JP_EPUB) {
      await cdp.evaluate(
        'window.bookscent.library.importPaths([' + JSON.stringify(process.env.JP_EPUB) + '], false)'
      )
      await delay(2500)
      await cdp.evaluate('location.reload()')
      await delay(4500)
      await waitFor('document.querySelector(".app-shell")', '重载后外壳', 25000)
      await delay(2000)
    }

    /* ---------- 1. 打开一本 EPUB，进导出图片 ---------- */
    const epub = await cdp.evaluate('window.bookscent.library.index().then((i) => {' +
      ' const b = i.books.find((x) => x.format === "epub") ;' +
      ' return b ? { id: b.id, title: b.title } : null })')
    console.log('    EPUB ' + JSON.stringify(epub))
    check('书架上有一本 EPUB', Boolean(epub), JSON.stringify(epub))
    if (!epub) return

    /*
     * 点这本书。
     * 不要用属性选择器拼字符串：引号转义很容易把注入的表达式变成语法错误
     * （上一版就死在 0.0s 的求值失败上）。遍历 .book 比 data-book-id 更稳。
     */
    const clickBook = (id) =>
      cdp.evaluate(
        '(() => {' +
          ' const id = ' +
          JSON.stringify(id) +
          ';' +
          ' const el = [...document.querySelectorAll(".book")].find((b) => b.getAttribute("data-book-id") === id);' +
          ' if (!el) return false;' +
          ' el.click();' +
          ' return true;' +
          '})()'
      )

    const clicked = await clickBook(epub.id)
    check('能在书架上点到这本 EPUB', clicked === true, String(clicked))
    await delay(3000)
    check('进了阅读界面', (await cdp.evaluate('Boolean(document.querySelector(".reader-host"))')) === true, '')

    const exportOpened = await cdp.evaluate([
      '(() => {',
      '  const btn = [...document.querySelectorAll("button")].find((el) => (el.textContent || "").includes("导出图片"))',
      '  if (!btn) return false',
      '  btn.click()',
      '  return true',
      '})()'
    ].join('\n'))
    check('EPUB 顶栏有「导出图片」并能点开', exportOpened === true, String(exportOpened))
    await delay(3000)

    const rows = await cdp.evaluate('document.querySelectorAll(".epub-export-row").length')
    console.log('    清单里 ' + rows + ' 行')
    check('导出图片弹窗列出了图片', rows > 0, String(rows))

    /* ---------- 2. 点缩略图进看图模式 ---------- */
    /*
     * 注入的表达式一律写成**带分号的单行**。
     * 之前用 '...' + '...' 拼接时空格顶替了换行，又没有分号，
     * 于是 const/if 挤在一行变成语法错误（求值 0.0s 失败）—— 白跑两轮。
     */
    const opened = await cdp.evaluate([
      '(() => {',
      '  const t = document.querySelector(".epub-export-thumb");',
      '  if (!t) return false;',
      '  t.click();',
      '  return true;',
      '})()'
    ].join('\n'))
    check('点缩略图能把看图模式叫出来', opened === true, String(opened))
    await delay(2500)

    const viewer = await cdp.evaluate([
      '(() => {',
      '  const v = document.querySelector(".epub-viewer");',
      '  if (!v) return { missing: true };',
      '  const img = v.querySelector(".epub-viewer-img");',
      '  const meta = v.querySelector(".epub-viewer-meta");',
      '  const actions = [...v.querySelectorAll("button")].map((b) => (b.textContent || "").trim());',
      '  return {',
      '    natural: img ? img.naturalWidth + "x" + img.naturalHeight : null,',
      '    meta: meta ? meta.textContent.trim() : null,',
      '    hasExportOne: actions.some((t) => t.includes("导出这张")),',
      '    hasExportPicked: actions.some((t) => t.includes("导出选中"))',
      '  };',
      '})()'
    ].join('\n'))
    console.log('    看图模式 ' + JSON.stringify(viewer))
    check('看图模式里的大图真的解出了尺寸', Boolean(viewer?.natural && !viewer.natural.startsWith('0x')), JSON.stringify(viewer))
    check('看图模式里能看到页码', Boolean(viewer?.meta && viewer.meta.includes('第')), JSON.stringify(viewer))
    check('导出被整合进看图模式（导出这张 / 导出选中）', Boolean(viewer?.hasExportOne && viewer?.hasExportPicked), JSON.stringify(viewer))

    const next = await cdp.evaluate([
      '(() => {',
      '  const b = document.querySelector(".epub-viewer-nav.is-next");',
      '  if (!b || b.disabled) return false;',
      '  b.click();',
      '  return true;',
      '})()'
    ].join('\n'))
    await delay(1500)
    const moved = await cdp.evaluate([
      '(() => {',
      '  const m = document.querySelector(".epub-viewer-meta");',
      '  return m ? m.textContent.trim() : null;',
      '})()'
    ].join('\n'))
    check('能翻到下一张', next === true && moved !== viewer?.meta, JSON.stringify({ before: viewer?.meta, after: moved }))

    /* Esc 退出看图，弹窗还在 */
    await cdp.evaluate('window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))')
    await delay(900)
    const afterEsc = await cdp.evaluate([
      '(() => ({',
      '  viewer: Boolean(document.querySelector(".epub-viewer")),',
      '  modal: Boolean(document.querySelector(".epub-export-row"))',
      '}))()'
    ].join('\n'))
    console.log('    Esc 之后 ' + JSON.stringify(afterEsc))
    check('Esc 退出看图但没关掉导出弹窗', afterEsc?.viewer === false && afterEsc?.modal === true, JSON.stringify(afterEsc))
    await shot('98-image-viewer.png', 300)

    /* ---------- 3. 笔记导出的两个选项 ---------- */
    await cdp.evaluate('document.querySelector(".modal-close, .reader-bar button")?.click()')
    await delay(1200)
    await cdp.evaluate('document.querySelector(".reader-bar button")?.click()')
    await delay(1500)

    const note = await cdp.evaluate('window.bookscent.library.index().then((i) => {' +
      ' const b = i.books.find((x) => x.format === "md" || x.format === "txt") ;' +
      ' return b ? { id: b.id, title: b.title } : null })')
    console.log('    用来测导出的笔记 ' + JSON.stringify(note))
    if (note) {
      const noteClicked = await clickBook(note.id)
      check('能在书架上点到这本笔记', noteClicked === true, String(noteClicked))
      await delay(3000)
      const menu = await cdp.evaluate([
        '(() => {',
        '  const btn = [...document.querySelectorAll("button")].find((el) => (el.textContent || "").trim() === "导出")',
        '  if (!btn) return false',
        '  btn.click()',
        '  return true',
        '})()'
      ].join('\n'))
      check('编辑器里有「导出」按钮', menu === true, String(menu))
      await delay(1200)
      const opts = await cdp.evaluate([
        '(() => {',
        '  const box = document.querySelector(".bs-export-follow");',
        '  if (!box) return { missing: true };',
        '  const switches = [...box.querySelectorAll("[role=switch]")];',
        '  return {',
        '    count: switches.length,',
        '    allOff: switches.every((s) => s.getAttribute("aria-checked") === "false"),',
        '    labels: [...box.querySelectorAll(".switch-label")].map((l) => (l.textContent || "").trim())',
        '  };',
        '})()'
      ].join('\n'))
      console.log('    导出选项 ' + JSON.stringify(opts))
      check('导出弹窗里有两个后续选项', opts?.count === 2, JSON.stringify(opts))
      check('两个选项默认都不勾', opts?.allOff === true, JSON.stringify(opts))
      await shot('99-export-options.png', 300)
    }
  }

  /**
   * 回收站。
   * 重点是用户报的那条 bug：被移除（未删除）的书，重新扫描之后不该再回到书架。
   */
  async function runTrashProbe() {
    await waitFor('document.querySelector(".app-shell")', '应用外壳', 30000)
    await delay(1500)

    /* 用复制入库的方式导入（这样文件是我们自己的，移除时应当被挪进 _回收站） */
    const src = process.env.JP_EPUB2 ?? process.env.JP_EPUB ?? ''
    const imported = await cdp.evaluate(`window.bookscent.library.importPaths([${JSON.stringify(src)}], true)`)
    await delay(2500)
    const book = imported?.added?.[0] ?? null
    console.log(`    导入用于回收站测试的书 ${JSON.stringify(book ? { id: book.id, external: book.external } : null)}`)
    check('导入了一本复制入库的书', Boolean(book && book.external === false), JSON.stringify(book))
    if (!book) return

    /* 移除（不删文件）→ 应当进回收站 */
    await cdp.evaluate(`window.bookscent.library.removeBooks([${JSON.stringify(book.id)}], false)`)
    await delay(1800)
    const trashed = await cdp.evaluate(`window.bookscent.library.index().then((i) => {
      const b = i.books.find((x) => x.id === ${JSON.stringify(book.id)})
      return b ? { trashed: b.trashed === true, path: b.path } : null
    })`)
    console.log(`    移除之后 ${JSON.stringify(trashed)}`)
    check('移除后进了回收站（条目还在，打了标记）', trashed?.trashed === true, JSON.stringify(trashed))
    check(
      '文件被挪进了藏书目录下的 _回收站',
      Boolean(trashed?.path && trashed.path.includes('_回收站')),
      String(trashed?.path)
    )

    /* 关键回归：重新扫描之后它不该回到书架 */
    await cdp.evaluate(`location.reload()`)
    await delay(4500)
    await waitFor('document.querySelector(".app-shell")', '重载后外壳', 25000)
    await delay(1500)
    await cdp.evaluate(`window.bookscent.library.rescan()`)
    await delay(3500)
    await cdp.evaluate(`location.reload()`)
    await delay(4500)
    await waitFor('document.querySelector(".app-shell")', '重载后外壳', 25000)
    await delay(2000)

    const afterRescan = await cdp.evaluate(`window.bookscent.library.index().then((i) => {
      const b = i.books.find((x) => x.id === ${JSON.stringify(book.id)})
      const same = i.books.filter((x) => x.title === ${JSON.stringify(book.title ?? '')})
      return {
        stillTrashed: b ? b.trashed === true : null,
        copiesWithSameTitle: same.length,
        onShelfIds: i.books.filter((x) => !x.trashed && !x.temporary).map((x) => x.id).length
      }
    })`)
    console.log(`    重新扫描之后 ${JSON.stringify(afterRescan)}`)
    check(
      '重新扫描不会把回收站里的书收回来（同名的只有那一份）',
      afterRescan?.stillTrashed === true && afterRescan?.copiesWithSameTitle === 1,
      JSON.stringify(afterRescan)
    )

    /* 回收站视图里能看到它，并且只有还原/彻底删除两个动作 */
    const viewOpened = await cdp.evaluate(`(() => {
      const btn = [...document.querySelectorAll('.nav-item')].find((el) =>
        (el.textContent || '').includes('回收站')
      )
      if (!btn) return false
      btn.click()
      return true
    })()`)
    check('侧栏能找到回收站入口', viewOpened === true, String(viewOpened))
    await delay(1500)
    const view = await cdp.evaluate(`(() => {
      const rows = document.querySelectorAll('.trash-row')
      const first = rows[0]
      const labels = first
        ? [...first.querySelectorAll('button')].map((b) => (b.textContent || '').trim())
        : []
      return { rows: rows.length, labels, actions: document.querySelectorAll('.trash-row-actions').length }
    })()`)
    console.log(`    回收站视图 ${JSON.stringify(view)}`)
    check('回收站里列出了这本书', (view?.rows ?? 0) >= 1, JSON.stringify(view))
    check(
      '每行只有还原 / 彻底删除两个动作',
      JSON.stringify(view?.labels ?? []) === JSON.stringify(['还原', '彻底删除']),
      JSON.stringify(view?.labels)
    )
    await shot('97-trash.png', 400)

    /*
     * 与书架同构：侧栏要显示、工具栏要在、选中之后要浮出批量条。
     * 之前回收站是个整屏独立列表，连侧栏都没有（用户报的就是这个）。
     */
    const shell = await cdp.evaluate(`(() => {
      const navs = [...document.querySelectorAll('.nav-item')].map((el) => (el.textContent || '').trim())
      const sidebar = document.querySelector('.sidebar')
      const active = document.querySelector('.nav-item.is-active, .nav-item[aria-current="true"]')
      return {
        sidebar: Boolean(sidebar),
        navCount: navs.length,
        toolbar: Boolean(document.querySelector('.shelf-toolbar')),
        heading: (document.querySelector('.trash-heading')?.textContent || '').trim(),
        view: document.querySelector('.trash-view') ? document.querySelector('.trash-view').className : null,
        activeText: active ? (active.textContent || '').trim() : null
      }
    })()`)
    console.log(`    回收站外壳 ${JSON.stringify(shell)}`)
    check('第 1 项：回收站里显示侧栏', shell.sidebar === true, JSON.stringify(shell))
    check('第 1 项：回收站用了书架那套工具栏外壳', shell.toolbar === true && shell.heading === '回收站', JSON.stringify(shell))

    const batch = await cdp.evaluate(`(() => {
      const row = document.querySelector('.trash-row')
      if (!row) return { missing: true }
      row.click()
      return { clicked: true }
    })()`)
    await delay(700)
    const selected = await cdp.evaluate(`(() => {
      const bar = document.querySelector('.batch-bar')
      return {
        selectedRows: document.querySelectorAll('.trash-row.is-selected').length,
        batch: bar ? [...bar.querySelectorAll('button')].map((b) => (b.textContent || '').trim()) : null,
        count: (document.querySelector('.batch-count')?.textContent || '').trim()
      }
    })()`)
    console.log(`    选中之后 ${JSON.stringify(selected)}`)
    check('第 1 项：点一下就能选中，选中态看得见', (selected?.selectedRows ?? 0) >= 1, JSON.stringify(selected))
    check(
      '第 1 项：选中后浮出与书架同一套批量条（还原 / 彻底删除）',
      Boolean(selected?.batch?.includes('还原到书架') && selected?.batch?.includes('彻底删除')),
      JSON.stringify(selected?.batch)
    )
    await shot('97b-trash-selected.png', 300)
    /* 取消选择，别影响后面的还原用例 */
    await cdp.evaluate(`(() => {
      const rows = [...document.querySelectorAll('.trash-row.is-selected')]
      rows.forEach((r) => r.click())
      return true
    })()`)
    await delay(400)

    /* 还原：文件应当挪回藏书目录，书回到书架 */
    await cdp.evaluate(`window.bookscent.library.restoreBooks([${JSON.stringify(book.id)}])`)
    await delay(2000)
    const restored = await cdp.evaluate(`window.bookscent.library.index().then((i) => {
      const b = i.books.find((x) => x.id === ${JSON.stringify(book.id)})
      return b ? { trashed: b.trashed === true, path: b.path } : null
    })`)
    console.log(`    还原之后 ${JSON.stringify(restored)}`)
    check('还原后不再是回收站状态', restored?.trashed === false, JSON.stringify(restored))
    check(
      '还原后文件回到藏书目录（不在 _回收站 里）',
      Boolean(restored?.path && !restored.path.includes('_回收站')),
      String(restored?.path)
    )
  }

  /**
   * 详情页封面：导入时自动提取的封面应当能在详情页画出来。
   * 用户报"详情页封面图片里仍是一片黑"，所以这里直接量 hero 里那个元素。
   */
  async function runDetailProbe() {
    await waitFor('document.querySelector(".app-shell")', '应用外壳', 30000)
    await delay(1500)

    /*
     * 干净 profile 里没有带自动封面的书，先导入一本 ——
     * 导入过程本身就会自动取封面（这正是要验的东西）。
     */
    const importPath = process.env.JP_EPUB ?? ''
    if (importPath) {
      await cdp.evaluate(`window.bookscent.library.importPaths([${JSON.stringify(importPath)}], false)`)
      await delay(2500)
      /*
       * 必须重载：从 API 导入只会改主进程的索引，渲染层的 store 不会自动收到整份索引
       * （只有逐本的 library:book-updated）。不重载的话书架里根本没有这本书的 DOM，
       * 后面 click() 落在 null 上，白跑一轮。
       */
      await cdp.evaluate(`location.reload()`)
      await delay(4500)
      await waitFor('document.querySelector(".app-shell")', '重载后外壳', 25000)
      await delay(2000)
    }

    // 用一本带自动封面的书：先找 coverImage 存在的
    const target = await cdp.evaluate(`window.bookscent.library.index().then((i) => {
      const b = i.books.find((x) => x.style && x.style.coverImage) || i.books[0]
      return b ? { id: b.id, title: b.title, cover: (b.style && b.style.coverImage) || null } : null
    })`)
    console.log(`    选中的书 ${JSON.stringify(target)}`)
    check('书架上有一本带自动封面的书', Boolean(target?.cover), JSON.stringify(target))
    if (!target) return

    /*
     * 打开详情抽屉的可靠路径：
     * 单击书 → 进阅读界面 → 点顶栏那个「书籍详情」按钮。
     * （右键/双击都被探针环境坑过：React 的合成事件要求更像真实交互，
     *   而这条路径在别的探针里已经反复验证过能走通。）
     */
    await cdp.evaluate(`document.querySelector('.book[data-book-id="${target.id}"]')?.click()`)
    await delay(2600)
    const inReader = await cdp.evaluate(`Boolean(document.querySelector('.reader-host'))`)
    check('点书能进阅读界面', inReader === true, String(inReader))

    const opened = await cdp.evaluate(`(() => {
      const btn = [...document.querySelectorAll('.reader-bar-actions button')].find(
        (el) => (el.textContent || '').includes('书籍详情')
      )
      if (!btn) return false
      btn.click()
      return true
    })()`)
    check('阅读界面能打开书籍详情', opened === true, String(opened))
    await delay(2600)

    const hero = await cdp.evaluate(`(() => {
      const root = document.querySelector('.detail-hero')
      const preview = document.querySelector('.detail-image-preview.is-cover')
      const pimg = preview ? preview.querySelector('img') : null
      const himg = root ? root.querySelector('img') : null
      const rect = preview ? preview.getBoundingClientRect() : null
      return {
        drawer: Boolean(document.querySelector('.drawer-body.book-detail')),
        coverImg: himg ? himg.naturalWidth + '×' + himg.naturalHeight : null,
        previewImg: pimg ? (pimg.getAttribute('src') || '').slice(0, 46) : null,
        previewNatural: pimg ? pimg.naturalWidth + '×' + pimg.naturalHeight : null,
        previewBox: rect ? Math.round(rect.width) + '×' + Math.round(rect.height) : null
      }
    })()`)
    console.log(`    详情页 ${JSON.stringify(hero)}`)
    check('详情页抽屉打开了', hero?.drawer === true, JSON.stringify(hero))
    check('hero 里的封面画出来了', Boolean(hero?.coverImg && !hero.coverImg.startsWith('0×')), JSON.stringify(hero))
    /* 这一条就是用户报的 bug：详情页「封面图片」预览以前是一片黑 */
    check(
      '详情页「封面图片」预览真的画出图（不再是黑的）',
      Boolean(hero?.previewImg && hero.previewNatural && !hero.previewNatural.startsWith('0×')),
      JSON.stringify(hero)
    )
    await shot('96-detail-cover.png', 400)
  }

  /**
   * 临时打开：应用带着文件路径启动（模拟双击关联文件 / 「打开方式」），
   * 应当直接进阅读界面、标着「临时」，并且能一键添加到书架。
   */
  async function runTempProbe() {
    await waitFor('document.querySelector(".app-shell")', '应用外壳', 30000)
    await delay(3000)

    const opened = await cdp.evaluate(`(() => {
      const host = document.querySelector('.reader-host')
      const title = document.querySelector('.reader-bar-title h1')
      const badge = document.querySelector('.reader-temp-badge')
      const keep = [...document.querySelectorAll('.reader-bar-actions button')].find(
        (el) => (el.textContent || '').includes('添加到书架')
      )
      return {
        reader: Boolean(host),
        title: title ? title.textContent : null,
        badge: badge ? badge.textContent.trim() : null,
        keep: Boolean(keep)
      }
    })()`)
    console.log(`    启动后 ${JSON.stringify(opened)}`)
    check('带文件路径启动会直接进阅读界面', opened?.reader === true, JSON.stringify(opened))
    check('阅读界面标出了「临时」', opened?.badge === '临时', JSON.stringify(opened))
    check('阅读界面有「添加到书架」按钮', opened?.keep === true, JSON.stringify(opened))

    const wantPath = (process.env.OPEN_FILE ?? '').toLowerCase()
    const before = await cdp.evaluate(`window.bookscent.library.index().then((i) => {
      const b = i.books.find((x) => x.path && x.path.toLowerCase() === ${JSON.stringify(wantPath)})
      return b ? { id: b.id, temporary: b.temporary === true, external: b.external } : null
    })`)
    console.log(`    索引里的这本书 ${JSON.stringify(before)}`)
    check('它被标成临时书（不入库）', before?.temporary === true, JSON.stringify(before))
    check('临时打开是引用式的（没有复制文件）', before?.external === true, JSON.stringify(before))

    /*
     * 关键回归 2（用户报的"重新扫描或重启还在"）：
     * 主进程的 normalizeBook 是**白名单重建**，漏掉 `temporary` 就会在**任何一次保存/扫描**时
     * 把标记抹掉 —— 于是临时书悄悄变成正式书，重开应用（loadIndex 也会归一化）后照样在书架上。
     * 所以这里特意走一遍 updateBook（会归一化）再走一遍 scan（会重扫 + 归一化）。
     */
    const survived = await cdp.evaluate(`(async () => {
      const id = ${JSON.stringify(before?.id ?? '')}
      await window.bookscent.library.updateBook(id, { rating: 0 })
      await window.bookscent.library.rescan()
      const index = await window.bookscent.library.index()
      const book = index.books.find((x) => x.id === id)
      return {
        temporary: book ? book.temporary === true : null,
        external: book ? book.external === true : null,
        shelfCount: index.books.filter((b) => !b.temporary && !b.trashed).length
      }
    })()`)
    console.log(`    归一化 + 重新扫描之后 ${JSON.stringify(survived)}`)
    check(
      '第 1 项：保存与重新扫描之后临时标记还在（这就是"重开/重扫就进书架"的根因）',
      survived?.temporary === true,
      JSON.stringify(survived)
    )
    check('第 1 项：重新扫描也没把它的文件复制进来（仍是引用式）', survived?.external === true, JSON.stringify(survived))

    /*
     * 关键回归：临时打开的书**不上书架**。
     * 用户报过"不点加入书架也会默认加进去" —— 根因是书架列表没有排除 temporary 的书。
     * 先记下书架上的书数，回书架看一眼，再转正、再看一次。
     */
    const shelfBefore = await cdp.evaluate(
      `window.bookscent.library.index().then((i) => i.books.filter((b) => !b.temporary).length)`
    )
    await cdp.evaluate(`document.querySelector('.reader-bar button')?.click()`)
    await delay(1800)
    const onShelf = await cdp.evaluate(`(() => {
      const el = document.querySelector('.book[data-book-id="${before?.id ?? ''}"]')
      return { onShelf: Boolean(el), shelfBooks: document.querySelectorAll('.book[data-book-id]').length }
    })()`)
    console.log(`    回书架后 ${JSON.stringify(onShelf)}（转正前书架上有 ${shelfBefore} 本）`)
    check('临时书不出现在书架上', onShelf?.onShelf === false, JSON.stringify(onShelf))
    check('书架总数没被临时书撑大', onShelf?.shelfBooks === shelfBefore, `${onShelf?.shelfBooks} vs ${shelfBefore}`)
    await shot('95-temp-not-on-shelf.png', 300)

    /*
     * 转正。
     * 界面上那颗「添加到书架」按钮走的就是下面这一句（按钮存在性已在上面断言过）；
     * 因为书此刻不在书架上，没法再点回阅读界面，所以这里直接调等价动作。
     */
    const promoted = await cdp.evaluate(
      `window.bookscent.library.updateBook(${JSON.stringify(before?.id ?? '')}, { temporary: false }).then((b) => Boolean(b))`
    )
    check('能把这本临时书转正', promoted === true, String(promoted))
    await delay(2200)

    const after = await cdp.evaluate(`window.bookscent.library.index().then((i) => {
      const b = i.books.find((x) => x.id === ${JSON.stringify(before?.id ?? '')})
      return b ? { temporary: b.temporary === true } : null
    })`)
    console.log(`    转正之后 ${JSON.stringify(after)}`)
    check('转正之后它就留在书架上了', after?.temporary === false, JSON.stringify(after))
    await shot('94-temp-open.png', 400)
  }

  /**
   * 单层高度按朝向独立：书脊一份、封面一份，互不影响；书脊那份能调得更高。
   */
  async function runFacingProbe() {
    await waitFor('document.querySelector(".app-shell")', '应用外壳', 30000)
    await delay(1200)

    await cdp.evaluate(
      `window.bookscent.settings.patch({ ui: { shelfRowHeight: 500, shelfRowHeightCover: 260, bookFacing: 'spine' } })`
    )
    await cdp.evaluate(`location.reload()`)
    await delay(4500)
    await waitFor('document.querySelector(".app-shell")', '重载后外壳', 25000)
    await delay(2000)

    const spine = await cdp.evaluate(`(() => {
      const el = document.querySelector('.book[data-book-id]')
      return el ? el.offsetHeight : 0
    })()`)
    console.log(`    书脊朝向：书高 ${spine}px（层高设 500）`)
    check('书脊朝向用「书脊」那份层高（能调高）', spine > 300, String(spine))
    await shot('92-facing-spine.png', 300)

    /*
     * 改朝向之后要重载再看。
     * 设置是通过主进程落盘的，渲染层不会自动收到 patch 推送 ——
     * 设置页里改是同一个 store 所以立刻生效，但这里是从外部 patch，必须重载。
     */
    await cdp.evaluate(`window.bookscent.settings.patch({ ui: { bookFacing: 'cover' } })`)
    await cdp.evaluate(`location.reload()`)
    await delay(4500)
    await waitFor('document.querySelector(".app-shell")', '重载后外壳', 25000)
    await delay(2000)
    const cover = await cdp.evaluate(`(() => {
      const el = document.querySelector('.book[data-book-id]')
      return el ? el.offsetHeight : 0
    })()`)
    console.log(`    封面朝向：书高 ${cover}px（层高设 260）`)
    check(
      '封面朝向用「封面」那份层高（不被书脊那份带着跑）',
      cover > 100 && cover < spine - 60,
      `${cover} vs ${spine}`
    )

    const stored = await cdp.evaluate(
      `window.bookscent.settings.get().then((s) => ({ spine: s.ui.shelfRowHeight, cover: s.ui.shelfRowHeightCover }))`
    )
    console.log(`    存下来的两份层高 ${JSON.stringify(stored)}`)
    check('两份层高各自存住', stored?.spine === 500 && stored?.cover === 260, JSON.stringify(stored))
    await shot('93-facing-cover.png', 300)
  }

  /**
   * 多选批量设置「系列 / 作者」：全程走界面。
   */
  async function runBatchMetaProbe() {
    await waitFor('document.querySelector(".app-shell")', '应用外壳', 30000)
    await delay(1500)

    const multi = await cdp.evaluate(`(() => {
      const nodes = [...document.querySelectorAll('button, label, .switch, .set-switch')]
      const hit = nodes.find(
        (el) => (el.textContent || '').includes('多选') || (el.getAttribute('title') || '').includes('多选')
      )
      if (!hit) return false
      hit.click()
      return true
    })()`)
    check('能切到多选模式', multi === true, String(multi))
    await delay(800)

    const picked = await cdp.evaluate(`(() => {
      const books = [...document.querySelectorAll('.book[data-book-id]')].slice(0, 2)
      if (books.length < 2) return []
      /* 第一本普通点击=选中；第二本按批量条自己的提示，Ctrl+单击=加选 */
      books[0].click()
      books[1].dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true }))
      return books.map((el) => el.getAttribute('data-book-id'))
    })()`)
    await delay(600)
    /*
     * 关键：批量条上写的「已选 N 本」才是真正的选中数。
     * 之前只看 DOM 里有两本书就断言"选中了两本"，那是错的 ——
     * 多选没打开时第一下点击是"打开书"而不是"选中"。
     */
    const selectedCount = await cdp.evaluate(`(() => {
      const el = document.querySelector('.batch-count')
      const text = el ? el.textContent || '' : ''
      const m = text.match(/(\\d+)/)
      return m ? Number(m[1]) : -1
    })()`)
    console.log(`    批量条显示已选 ${selectedCount} 本（点过的书 ${JSON.stringify(picked)}）`)
    check('点两下之后批量条显示已选 2 本', selectedCount === 2, String(selectedCount))
    if (selectedCount !== 2) return

    const opened = await cdp.evaluate(`(() => {
      const btn = document.querySelector('[data-batch="meta"]')
      if (!btn) return false
      btn.click()
      return true
    })()`)
    check('批量条上有「系列 / 作者」按钮', opened === true, String(opened))
    await delay(500)

    const typed = await cdp.evaluate(`(() => {
      const pop = document.querySelector('.batch-pop.is-meta')
      if (!pop) return null
      const inputs = pop.querySelectorAll('input.batch-input')
      if (inputs.length < 2) return inputs.length
      /* React 受控输入：走原生 setter 再派发 input，否则 React 收不到 */
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
      setter.call(inputs[0], '探针系列')
      inputs[0].dispatchEvent(new Event('input', { bubbles: true }))
      setter.call(inputs[1], '探针作者')
      inputs[1].dispatchEvent(new Event('input', { bubbles: true }))
      return inputs.length
    })()`)
    check('面板里有系列与作者两个输入框', typed === 2, String(typed))
    await delay(400)

    const applied = await cdp.evaluate(`(() => {
      const pop = document.querySelector('.batch-pop.is-meta')
      if (!pop) return false
      const btn = [...pop.querySelectorAll('button')].find(
        (el) => (el.textContent || '').trim() === '两项一起应用'
      )
      if (!btn) return false
      btn.click()
      return true
    })()`)
    check('点得到「两项一起应用」', applied === true, String(applied))
    await delay(3000)

    const after = await cdp.evaluate(
      `window.bookscent.library.index().then((i) => ${JSON.stringify(picked)}.map((id) => {
        const b = i.books.find((x) => x.id === id)
        return b ? { series: b.series ?? null, author: b.author ?? null } : null
      }))`
    )
    console.log(`    批量设置之后 ${JSON.stringify(after)}`)
    check(
      '批量设置系列与作者都写进了这两本书',
      Array.isArray(after) &&
        after.length === 2 &&
        after.every((b) => b && b.series === '探针系列' && b.author === '探针作者'),
      JSON.stringify(after)
    )
    await shot('91-batch-meta.png', 400)
  }

  if (process.env.ONLY === 'readopt') {
    await runReadOptProbe()
    throw ONLY_DONE
  }

  if (process.env.ONLY === 'anim') {
    await runAnimProbe()
    throw ONLY_DONE
  }

  if (process.env.ONLY === 'vocab') {
    await runVocab({ cdp, check, delay, waitFor, shot, patch })
    throw ONLY_DONE
  }

  if (process.env.ONLY === 'tts') {
    await runTts({ cdp, check, delay, waitFor, shot, patch, mouse })
    throw ONLY_DONE
  }

  if (process.env.ONLY === 'v0101b') {
    await runV0101b({ cdp, check, delay, waitFor, shot, patch, mouse })
    throw ONLY_DONE
  }

  if (process.env.ONLY === 'keys') {
    await runKeys({ cdp, check, delay, waitFor, shot, patch, mouse })
    throw ONLY_DONE
  }

  if (process.env.ONLY === 'clean') {
    await runClean({ cdp, check, delay, waitFor, shot, patch, mouse })
    throw ONLY_DONE
  }

  if (process.env.ONLY === 'multi') {
    await runMulti({ cdp, check, delay, waitFor, shot, patch, mouse })
    throw ONLY_DONE
  }

  if (process.env.ONLY === 'v0101') {
    await runV0101({ cdp, check, delay, waitFor, shot, patch, mouse })
    throw ONLY_DONE
  }

  if (process.env.ONLY === 'translate') {
    await runTranslate({ cdp, check, delay, waitFor, shot })
    throw ONLY_DONE
  }

  if (process.env.ONLY === 'fix98') {
    await runFix98({ cdp, check, delay, waitFor, shot })
    throw ONLY_DONE
  }

  if (process.env.ONLY === 'gallery') {
    await runGalleryProbe()
    throw ONLY_DONE
  }

  if (process.env.ONLY === 'bmmark') {
    await runBookmarkProbe()
    throw ONLY_DONE
  }

  if (process.env.ONLY === 'pdftext') {
    await runPdfTextProbe()
    throw ONLY_DONE
  }

  if (process.env.ONLY === 'mark') {
    await runMarkProbe()
    throw ONLY_DONE
  }

  if (process.env.ONLY === 'exportui') {
    await runExportUiProbe()
    throw ONLY_DONE
  }

  if (process.env.ONLY === 'trash') {
    await runTrashProbe()
    throw ONLY_DONE
  }

  if (process.env.ONLY === 'detail') {
    await runDetailProbe()
    throw ONLY_DONE
  }

  if (process.env.ONLY === 'temp') {
    await runTempProbe()
    throw ONLY_DONE
  }

  if (process.env.ONLY === 'facing') {
    await runFacingProbe()
    throw ONLY_DONE
  }

  if (process.env.ONLY === 'batch') {
    await runBatchMetaProbe()
    throw ONLY_DONE
  }

  /**
   * 书脊的两件事：贴图不该溢出被裁、页数→厚度按减半后的关系走。
   */
  async function runSpineProbe() {
    await waitFor('document.querySelector(".app-shell")', '应用外壳', 30000)
    await delay(1500)

    // 造一张细长的书脊贴图（1:6），存成 data URL 直接写进第一本书的样式
    const setSpine = await cdp.evaluate(`(async () => {
      const canvas = document.createElement('canvas')
      canvas.width = 100
      canvas.height = 600
      const ctx = canvas.getContext('2d')
      // 顶部画一条显眼的红带：如果图被裁掉上边，这条带子就看不见
      ctx.fillStyle = '#c0392b'
      ctx.fillRect(0, 0, 100, 60)
      ctx.fillStyle = '#2c3e50'
      ctx.fillRect(0, 60, 100, 540)
      const url = canvas.toDataURL('image/png')
      const index = await window.bookscent.library.index()
      const book = index.books.find((b) => b.format === 'epub') || index.books[0]
      if (!book) return null
      await window.bookscent.library.updateBook(book.id, {
        // 同时设成「竹节」：以前竹节会无条件叠在贴图上，画出横条带
        style: { spineImage: url, spineImageAspect: 100 / 600, ornament: 'ribs' }
      })
      return book.id
    })()`)
    check('能把书脊贴图写进某本书', Boolean(setSpine), String(setSpine))
    if (!setSpine) return

    await cdp.evaluate(`window.bookscent.settings.patch({ ui: { bookFacing: 'spine' } })`)
    await cdp.evaluate(`location.reload()`)
    await delay(4500)
    await waitFor('document.querySelector(".app-shell")', '重载后外壳', 25000)
    await delay(2000)

    const fit = await cdp.evaluate(`(() => {
      const el = document.querySelector('.book[data-book-id="${setSpine}"] .spine')
      if (!el) return null
      const cs = getComputedStyle(el)
      const rect = el.getBoundingClientRect()
      return {
        size: cs.backgroundSize,
        /* offsetWidth/Height 不受 transform 影响；rect 会因为书的倾角变成外接框 */
        own: el.offsetWidth + '×' + el.offsetHeight,
        ownAspect: +(el.offsetWidth / el.offsetHeight).toFixed(3),
        box: Math.round(rect.width) + '×' + Math.round(rect.height),
        aspect: +(rect.width / rect.height).toFixed(3)
      }
    })()`)
    console.log(`    书脊贴图 ${JSON.stringify(fit)}（铺图宽度应当≈ 高 × 0.167）`)
    /*
     * 断言一：铺图方式是 `100% 100%` —— 配合下面的 aspect-ratio 正好铺满。
     * 断言二：书脊面的**盒子比例就等于图片比例**（aspect-ratio 由高度推宽度），
     * 这样既不会裁、不会拉，也不会留透明带。
     */
    check(
      '书脊贴图铺满书脊面（不裁也不拉）',
      Boolean(fit && /^100% 100%$/.test(fit.size.replace(/\s+/g, ' ').trim())),
      `${fit?.size}`
    )
    const boxH = fit ? Number(fit.own.split('×')[1]) : 0
    const spineW = fit ? Number(fit.own.split('×')[0]) : 0
    const want = Math.round(boxH * (100 / 600))
    check(
      '书脊面宽度等于书脊宽度（两侧没有透明带）',
      Math.abs(spineW - want) <= 2,
      `自身 ${fit?.own}（比例 ${fit?.ownAspect}，期望 ${want}px）`
    )

    /* 贴了书脊图就不该再画竹节 / 顶带 / 束带（那就是用户看到的横条带） */
    const ornaments = await cdp.evaluate(`(() => {
      const el = document.querySelector('.book[data-book-id="${setSpine}"] .spine')
      if (!el) return null
      return {
        ribs: el.querySelectorAll('.spine-ribs i').length,
        bands: el.querySelectorAll('.spine-bands i').length,
        cap: el.querySelectorAll('.spine-cap').length,
        veil: el.querySelectorAll('.spine-photo-veil').length
      }
    })()`)
    console.log(`    书脊上的装饰 ${JSON.stringify(ornaments)}（贴了图应当全为 0，遮罩除外）`)
    check(
      '贴了书脊图后不再画竹节/束带/顶带（没有横条带）',
      Boolean(ornaments && ornaments.ribs === 0 && ornaments.bands === 0 && ornaments.cap === 0),
      JSON.stringify(ornaments)
    )
    // 页数→厚度：减半后的关系（1000 页约 44px，旧关系约 88px）
    const width = await cdp.evaluate(`(() => {
      const el = document.querySelector('.book[data-book-id="${setSpine}"] .spine')
      return el ? Math.round(el.getBoundingClientRect().width) : 0
    })()`)
    console.log(`    这本书的书脊宽 ${width}px`)
    await shot('90-spine-photo.png', 400)
  }
  if (process.env.ONLY === 'spine') {
    await runSpineProbe()
    throw ONLY_DONE
  }

  if (process.env.ONLY === 'jpcover') {
    await runJpCoverProbe()
    throw ONLY_DONE
  }

  /* ------------------------------------------------ 准备一些书 */
  const imported = await cdp.evaluate(
    `window.bookscent.library.importPaths(${JSON.stringify(NOTES)}, false).then(r => r.added.length)`
  )
  await cdp.evaluate(
    `(() => { const n = document.querySelector('.titlebar button[title*="重新扫描"]'); if (n) n.click(); return !!n })()`
  )
  await delay(3000)
  console.log(`导入 ${imported} 篇 dsh HTML 笔记，书架上现在 ${await cdp.evaluate(`document.querySelectorAll('.book').length`)} 本`)

  const version = await cdp.evaluate(
    `window.bookscent.app.info().then(i => i.version + ' / Electron ' + i.electron)`
  )
  /*
   * 版本号比对要归一化：界面上显示的是 0.9.8.beta（用户要求的写法），
   * 而 package.json 必须是 0.9.8-beta —— semver 不接受三段点号加 .beta，
   * electron-builder 也只认它。两者指同一版，所以把点号与连字符统一后再比。
   */
  const normalizeVersion = (value) => String(value).trim().replace(/\.beta$/i, '-beta')
  check(
    '版本号与 package.json 一致',
    normalizeVersion(version.split(' / ')[0]) === normalizeVersion(expectedVersion),
    `${version}（期望 ${expectedVersion}）`
  )
  /* ------------------------------------ 6. 书脊标题是否居中 */
  console.log('\n[6] 书脊标题居中')
  const centering = await cdp.evaluate(`(() => {
    const out = []
    document.querySelectorAll('.book.is-vertical').forEach(b => {
      const spine = b.querySelector('.spine')
      const title = b.querySelector('.spine-title')
      if (!spine || !title) return
      const s = spine.getBoundingClientRect()
      const t = title.getBoundingClientRect()
      out.push({
        titleW: +t.width.toFixed(1),
        spineW: +s.width.toFixed(1),
        delta: +((t.left + t.width / 2) - (s.left + s.width / 2)).toFixed(2),
        overflowX: t.left < s.left - 0.5 || t.right > s.right + 0.5
      })
    })
    return out
  })()`)
  for (const item of centering) {
    check(
      `书名居中（书脊 ${item.spineW}px / 书名盒 ${item.titleW}px）`,
      Math.abs(item.delta) <= 1 && !item.overflowX,
      `偏移 ${item.delta}px`
    )
  }

  await shot('01-shelf-default.png', 300)

  /* ------------------------------------ 7. 两种朝向 */
  console.log('\n[7] 书籍朝向')
  await patch({ bookFacing: 'cover' })
  const coverCount = await cdp.evaluate(`document.querySelectorAll('.book.facing-cover .book-cover-face').length`)
  check('封面朝外渲染出封面', coverCount > 0, `${coverCount} 本`)
  await shot('02-facing-cover.png', 600)

  /*
   * 曾经这里还测「自定义角度（angled）」的 3D 变换。
   * 那个模式已按用户要求删除（拿封面大小的书凑视角，不像真书），
   * 所以这里改成断言它确实不存在了 —— 留一条防复活的线。
   */
  const angledGone = await cdp.evaluate(
    `(() => ({ hasClass: Boolean(document.querySelector('.book.is-3d')), facings: [...document.querySelectorAll('.book')].map((b) => b.className).filter((c) => c.includes('facing-')).length }))()`
  )
  check('已删除的「自定义角度」不再出现', angledGone.hasClass === false, JSON.stringify(angledGone))

  await patch({ bookFacing: 'spine' })
  const spineCount = await cdp.evaluate(`document.querySelectorAll('.book.facing-spine').length`)
  check('书脊朝外渲染出书脊', spineCount > 0, `${spineCount} 本`)
  await shot('03-facing-spine.png', 600)

  await patch({ bookFacing: 'spine' })

  /* ------------------------------------ 8. 高度模式 */
  console.log('\n[8] 高度统一 / 错落')
  const measureHeights = async () =>
    cdp.evaluate(`(() => {
      const hs = Array.from(document.querySelectorAll('.book')).map(b => +b.getBoundingClientRect().height.toFixed(0))
      return { min: Math.min(...hs), max: Math.max(...hs), n: hs.length }
    })()`)
  await patch({ heightMode: 'uniform' })
  const uniform = await measureHeights()
  check('统一高度：所有书等高', uniform.max - uniform.min <= 1, JSON.stringify(uniform))
  await patch({ heightMode: 'mixed' })
  const mixed = await measureHeights()
  check('明显错落：高度出现差异', mixed.max - mixed.min > 8, JSON.stringify(mixed))
  await shot('04-height-mixed.png', 500)
  await patch({ heightMode: 'slight' })

  /* ------------------------------------ 3. 筛选 + 排序 */
  console.log('\n[3] 筛选与排序')
  // 点开筛选面板。开启这一步偶发失败（点得比 React 挂载早），所以带重试。
  const openFilterPanel = async () => {
    for (let i = 0; i < 5; i++) {
      await cdp.evaluate(
        `(() => { const n = Array.from(document.querySelectorAll('.shelf-toolbar button')).find(b => (b.textContent||'').includes('筛选')); if (n) n.click(); return !!n })()`
      )
      await delay(500)
      if (await cdp.evaluate(`!!document.querySelector('.shelf-filter-pop')`)) return true
    }
    return false
  }
  const panelOpen = await openFilterPanel()
  check('筛选面板能打开', panelOpen)
  await shot('05-filter-panel.png', 400)
  const before = await cdp.evaluate(`document.querySelectorAll('.book').length`)
  // Chip 的点击处理挂在内层 .chip-main 上，点外层 span 是没反应的
  const chipInfo = await cdp.evaluate(`(() => {
    const chips = Array.from(document.querySelectorAll('.shelf-filter-pop .chip'))
    const target = chips.find(c => c.textContent.trim() === '网页')
    const button = target ? target.querySelector('.chip-main') : null
    if (button) button.click()
    return { labels: chips.map(c => c.textContent.trim()), found: !!target, clicked: !!button }
  })()`)
  await delay(1100)
  const after = await cdp.evaluate(`document.querySelectorAll('.book').length`)
  check('筛选面板里能按格式选（找到「网页」）', chipInfo.clicked, chipInfo.labels.join('/'))
  check('按格式筛选后书目变少', after < before && after > 0, `${before} → ${after}`)
  const storedFormats = await cdp.evaluate(
    `window.bookscent.settings.get().then(s => JSON.stringify(s.ui.filterFormats))`
  )
  check('筛选条件已落盘', storedFormats.includes('html'), storedFormats)
  await shot('06-filter-html.png', 400)
  await cdp.evaluate(
    `(() => { const n = Array.from(document.querySelectorAll('.shelf-toolbar button')).find(b => (b.textContent||'').includes('清除')); if (n) n.click() })()`
  )
  await delay(700)

  // 排序：切到「最近打开」应出现提示，拖动时需要确认
  await cdp.evaluate(`(() => {
    const sel = document.querySelector('.shelf-toolbar select')
    if (!sel) return false
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set
    setter.call(sel, 'title')
    sel.dispatchEvent(new Event('change', { bubbles: true }))
    return true
  })()`)
  await delay(800)
  const hint = await cdp.evaluate(`(document.querySelector('.shelf-sort-hint')||{}).textContent || ''`)
  // 0.6.1 起提示改写得更直白：说的是"拖动会先问你要不要改成手动排列"
  check('非默认排序下给出拖拽提示', hint.includes('手动排列'), hint.slice(0, 40))
  await shot('07-sort-title.png', 400)

  // 真拖一下：用 CDP 的真实鼠标事件（合成 PointerEvent 触发不了 React 的 pointerdown 链路）
  // 先把筛选浮层关掉，否则它会盖住左边的书。
  await closeOverlays()
  const dragPoints = await cdp.evaluate(`(() => {
    const books = document.querySelectorAll('.book')
    const a = books[0].getBoundingClientRect()
    // 落点取目标书的 62% 处而不是右边缘：书有倾角时，外接矩形边缘已经不落在元素上了
    const b = books[2].getBoundingClientRect()
    return {
      from: { x: a.left + a.width / 2, y: a.top + a.height * 0.6 },
      step: { x: a.left + a.width / 2 + 34, y: a.top + a.height * 0.6 },
      to: { x: b.left + b.width * 0.62, y: b.top + b.height * 0.6 }
    }
  })()`)
  await mouse('mouseMoved', dragPoints.from.x, dragPoints.from.y, { buttons: 0 })
  await delay(120)
  await mouse('mousePressed', dragPoints.from.x, dragPoints.from.y)
  await delay(120)
  await mouse('mouseMoved', dragPoints.step.x, dragPoints.step.y)
  await delay(180)
  const dragging = await cdp.evaluate(`document.querySelectorAll('.book.is-dragging').length`)
  await mouse('mouseMoved', dragPoints.to.x, dragPoints.to.y)
  await delay(260)
  const dropClass = await cdp.evaluate(`document.querySelectorAll('.is-drop-before,.is-drop-after').length`)
  await shot('08-drag-indicator.png', 0)
  check('拖动时进入拖拽态', dragging > 0, `${dragging} 本被拿起`)
  check('拖动时出现落点指示', dropClass > 0, `${dropClass} 个`)
  await mouse('mouseReleased', dragPoints.to.x, dragPoints.to.y)
  await delay(1000)
  const dialogShown = await cdp.evaluate(`!!document.querySelector('.confirm-modal')`)
  const dialogText = await cdp.evaluate(`(document.querySelector('.confirm-message')||{}).textContent || ''`)
  check('非默认排序拖动弹出确认窗口', dialogShown, dialogText.slice(0, 46))
  await shot('09-drag-confirm.png', 400)
  await cdp.evaluate(`(() => { const n = Array.from(document.querySelectorAll('.confirm-modal button')).find(b => b.textContent.trim() === '取消'); if (n) n.click() })()`)
  await delay(600)
  await patch({ shelfSort: 'manual', shelfSortDesc: false })

  /* ------------------------------------ 11. 连续书柜 */
  console.log('\n[11] 连续书柜排布')
  // 造出两层书架，并补够书 —— 书太少的话单格根本不会超出最大宽度，也就看不出换行
  await cdp.evaluate(`(async () => {
    const idx = await window.bookscent.library.index()
    const shelves = [...idx.shelves, { id: 'shelf_second', name: '第二层', order: idx.shelves.length }]
    await window.bookscent.library.saveShelves(shelves)
    let books = (await window.bookscent.library.index()).books
    while (books.length < 24) {
      await window.bookscent.library.createNote('md', '填充 ' + books.length)
      books = (await window.bookscent.library.index()).books
    }
    for (let i = 0; i < books.length; i++) {
      await window.bookscent.library.updateBook(books[i].id, { shelfId: i % 2 === 0 ? 'shelf_main' : 'shelf_second' })
    }
    return books.length
  })()`)
  /*
   * 单格宽 480 时，8 本书（书脊厚度减半之后每本约 21–39px）能挤在一行里，
   * 就测不出"超过最大宽度要换行"了 —— 所以这里刻意把格宽压到 160，
   * 让溢出一眼可见。断言本身没变，只是给了它一个能触发的条件。
   */
  await patch({ shelfLayout: 'continuous', shelfBayMaxWidth: 160 })
  const continuous = await cdp.evaluate(`(() => {
    const wrap = document.querySelector('.shelf-continuous')
    if (!wrap) return null
    const bays = Array.from(document.querySelectorAll('.shelf-bay'))
    const tops = bays.map(b => Math.round(b.getBoundingClientRect().top))
    const units = bays.map(b => b.querySelectorAll('.shelf-unit').length)
    return {
      bays: bays.length,
      sameRow: [...new Set(tops)].length === 1,
      rowsPerBay: units,
      wrap: getComputedStyle(wrap).flexWrap,
      bayWidth: bays[0] ? Math.round(bays[0].getBoundingClientRect().width) : 0
    }
  })()`)
  check('书架层成为并排的格', Boolean(continuous && continuous.bays >= 2 && continuous.sameRow), JSON.stringify(continuous))
  check(
    '单层超过最大宽度会自动换行',
    Boolean(continuous && continuous.rowsPerBay.some((n) => n > 1)),
    `各格行数 ${JSON.stringify(continuous?.rowsPerBay)}`
  )
  check('单格宽度受设置约束', Boolean(continuous && continuous.bayWidth <= 480), `${continuous?.bayWidth}px`)

  // 4. 连续书柜：每一格是带外框的独立书架，横向留间隔；纵向仍要贴合
  const seam = await cdp.evaluate(`(() => {
    const bayEls = Array.from(document.querySelectorAll('.shelf-bay'))
    const bays = bayEls.map(b => b.getBoundingClientRect())
    const rows = Array.from(document.querySelectorAll('.shelf-bay .shelf-row')).map(r => r.getBoundingClientRect())
    const gaps = []
    for (let i = 0; i < bays.length - 1; i++) gaps.push(Math.round(bays[i + 1].left - bays[i].right))
    const vgaps = []
    for (let i = 0; i < rows.length - 1; i++) {
      if (Math.abs(rows[i].left - rows[i + 1].left) < 2) vgaps.push(Math.round(rows[i + 1].top - rows[i].bottom))
    }
    const cs = bayEls[0] ? getComputedStyle(bayEls[0]) : null
    return {
      hGaps: gaps,
      vGaps: vgaps,
      hasFrame: cs ? parseFloat(cs.borderTopWidth) > 0 : false,
      hasShadow: cs ? cs.boxShadow !== 'none' : false
    }
  })()`)
  check(
    '连续书柜里每一格都带书架外框',
    Boolean(seam.hasFrame && seam.hasShadow),
    `边框=${seam.hasFrame} 投影=${seam.hasShadow}`
  )
  check('并列的书架之间有间隔（看得出是两个书架）', seam.hGaps.every((g) => g > 0), JSON.stringify(seam.hGaps))
  check('同一格内上下两层紧贴', seam.vGaps.every((g) => g <= 0), JSON.stringify(seam.vGaps))
  await shot('10-continuous.png', 900)
  await patch({ shelfLayout: 'grouped' })

  // 分层模式下，相邻两层之间的空隙应当正好被上一层木板盖住（木板是从层底往下挂的）
  const groupedGap = await cdp.evaluate(`(() => {
    const units = Array.from(document.querySelectorAll('.shelf-unit'))
    const boxes = units.map(u => {
      const row = u.querySelector('.shelf-row')
      const plank = u.querySelector('.shelf-plank')
      if (!row) return null
      const r = row.getBoundingClientRect()
      return {
        top: r.top,
        bottom: r.bottom,
        plankBottom: plank ? plank.getBoundingClientRect().bottom : r.bottom
      }
    }).filter(Boolean)
    const rows = []
    for (let i = 0; i < boxes.length - 1; i++) {
      // 上一层木板底 相对 下一层顶：>= 0 表示被木板盖满了，没有露墙
      rows.push(Math.round(boxes[i].plankBottom - boxes[i + 1].top))
    }
    return rows
  })()`)
  check('分层模式下层与层之间没有露墙的空隙', groupedGap.every((v) => v >= -1), `木板覆盖量 ${JSON.stringify(groupedGap)}`)

  /* ------------------------------------ 1. 设置页 */
  console.log('\n[1] 设置页与外观移入')
  await cdp.evaluate(
    `(() => { const n = Array.from(document.querySelectorAll('.titlebar button')).find(b => (b.textContent||'').includes('设置')); if (n) n.click(); return !!n })()`
  )
  await waitFor('document.querySelector(".set-view")', '设置页', 20000)
  const tabs = await cdp.evaluate(
    `Array.from(document.querySelectorAll('.set-nav-item .set-nav-label')).map(b => b.textContent.trim()).filter(Boolean)`
  )
  check('设置页含 7 个分页', tabs.length >= 7, tabs.join(' / '))
  const appearanceMentions = await cdp.evaluate(`(() => {
    const n = Array.from(document.querySelectorAll('.set-nav-item')).find(b => (b.textContent||'').includes('外观'))
    if (n) n.click()
    return !!n
  })()`)
  await delay(700)
  const appearanceContent = await cdp.evaluate(
    `document.body.innerText.includes('应用主题') && document.body.innerText.includes('书架主题')`
  )
  check('外观已并入设置里的「外观」分页', appearanceMentions && appearanceContent, `分页=${appearanceMentions} 内容=${appearanceContent}`)

  const shotTab = async (label, name) => {
    const clicked = await cdp.evaluate(
      `(() => { const n = Array.from(document.querySelectorAll('.set-nav-item')).find(b => (b.textContent||'').includes(${JSON.stringify(label)})); if (n) { n.click(); return true } return false })()`
    )
    if (!clicked) {
      console.log(`    ! 找不到分页「${label}」`)
      problems.push(`设置分页缺失：${label}`)
      return
    }
    await shot(name, 600)
  }
  await shot('11-settings-general.png', 500)
  await shotTab('外观', '12-settings-appearance.png')

  // 外观页不该再出现「书籍样式」，而应该指路到「书籍外观」
  const appearanceSplit = await cdp.evaluate(`(() => {
    const text = document.querySelector('.set-content')?.innerText ?? ''
    return {
      hasBookStyle: text.includes('书籍样式'),
      hasCallout: !!document.querySelector('.set-callout'),
      goButton: Array.from(document.querySelectorAll('button')).some(b => (b.textContent||'').includes('去设置书籍外观'))
    }
  })()`)
  check('外观页不再重复放书籍样式', !appearanceSplit.hasBookStyle, JSON.stringify(appearanceSplit))
  check('外观页有指路卡片与跳转按钮', appearanceSplit.hasCallout && appearanceSplit.goButton)

  await shotTab('书籍外观', '13-settings-book-appearance.png')
  const bookAppearance = await cdp.evaluate(`(() => {
    const titles = Array.from(document.querySelectorAll('.set-content .section-title, .set-content h2, .set-content h3'))
      .map(n => n.textContent.trim())
    const text = document.querySelector('.set-content')?.innerText ?? ''
    return {
      cards: document.querySelectorAll('.set-style-card').length,
      hasBase: text.includes('基准样式'),
      hasList: text.includes('样式列表'),
      hasMode: text.includes('分配方式'),
      titles: titles.slice(0, 6)
    }
  })()`)
  check(
    '书籍外观页把「分配方式 / 基准样式 / 样式列表」讲清楚',
    bookAppearance.hasMode && bookAppearance.hasBase && bookAppearance.hasList,
    JSON.stringify(bookAppearance)
  )

  await shotTab('书架与排序', '14-settings-shelf.png')
  await shotTab('阅读与编辑', '15-settings-reading.png')
  await shotTab('文件与数据', '16-settings-files.png')
  await shotTab('关于', '17-settings-about.png')

  /* ------------------------------------ 2. 样式列表 */
  console.log('\n[2] 书籍外观样式列表')
  await shotTab('书籍外观', '18-book-appearance-again.png')
  const styles = await cdp.evaluate(`(() => {
    const cards = document.querySelectorAll('.set-style-card')
    return {
      cards: cards.length,
      names: Array.from(cards).map(c => (c.querySelector('.set-style-name')||{}).textContent || '').filter(Boolean),
      hasThumb: cards.length > 0 && !!cards[0].querySelector('.set-style-thumb')
    }
  })()`)
  check('样式卡片列表非空', styles.cards > 0, `${styles.cards} 张：${styles.names.join('、')}`)
  check('每张卡带书脊缩略图', styles.hasThumb)

  // 书籍与笔记各有一份独立的样式列表：作用域切换要能切到笔记那份，再切回来
  const clickScope = (label) =>
    cdp.evaluate(`(() => {
      const seg = Array.from(document.querySelectorAll('.segmented'))
        .find(g => /书籍/.test(g.textContent||'') && /笔记/.test(g.textContent||''))
      const btn = seg ? Array.from(seg.querySelectorAll('button')).find(b => (b.textContent||'').trim() === ${JSON.stringify(label)}) : null
      if (!btn) return false
      btn.click()
      return true
    })()`)
  const scopeState = async () => {
    await delay(500)
    return cdp.evaluate(`(() => ({
      cards: document.querySelectorAll('.set-style-card').length,
      text: document.querySelector('.set-content')?.innerText ?? ''
    }))()`)
  }
  const toNote = await clickScope('笔记')
  const noteScope = await scopeState()
  check(
    '书籍外观页切到「笔记」能编辑笔记那份列表',
    toNote && noteScope.text.includes('样式列表 · 笔记') && noteScope.cards > 0,
    `切换=${toNote} 卡片=${noteScope.cards}`
  )
  await shot('18b-note-style-list.png', 400)
  const toBook = await clickScope('书籍')
  const bookScope = await scopeState()
  check('切回「书籍」回到书籍那份列表', toBook && bookScope.text.includes('样式列表 · 书籍'))
  const noteMode = await cdp.evaluate(`window.bookscent.settings.get().then(s => s.noteSpineStyleMode)`)
  check('笔记的分配方式是独立的一份设置', typeof noteMode === 'string', String(noteMode))

  // 切到「按顺序轮换」，书架上应出现多种书脊材质
  await patchRaw({ spineStyleMode: 'rotate' })
  const distinctSpines = await cdp.evaluate(`(() => {
    const set = new Set()
    document.querySelectorAll('.book .spine').forEach(s => {
      const cs = getComputedStyle(s)
      set.add(cs.backgroundImage + '|' + cs.backgroundColor)
    })
    return set.size
  })()`)
  check('轮换分配让书脊出现多种材质', distinctSpines >= 2, `${distinctSpines} 种`)
  await shot('19-rotate-styles.png', 600)
  const storedMode = await cdp.evaluate(`window.bookscent.settings.get().then(s => s.spineStyleMode)`)
  check('分配方式已落盘', storedMode === 'rotate', storedMode)
  await patchRaw({ spineStyleMode: 'hash', noteSpineStyleMode: 'hash' })

  /* ------------------------------------ 9. 侧栏新建 / 导入 */
  console.log('\n[9] 侧栏的新建与导入')
  const sidebar = await cdp.evaluate(`(() => {
    const s = document.querySelector('.sidebar-actions')
    if (!s) return null
    return { text: s.innerText.replace(/\\s+/g, ' ').trim() }
  })()`)
  check('侧栏有新建与导入按钮', Boolean(sidebar && sidebar.text.includes('新建笔记') && sidebar.text.includes('导入')), sidebar?.text ?? '缺失')
  const titlebarHasImport = await cdp.evaluate(
    `Array.from(document.querySelectorAll('.titlebar button')).some(b => (b.textContent||'').trim() === '导入')`
  )
  check('标题栏不再重复放导入入口', !titlebarHasImport)
  await shot('20-sidebar-actions.png', 400)

  /* ------------------------------------ 4. 书名随装饰类型让位 */
  console.log('\n[4] 书名 / 作者按书脊装饰类型调整位置')
  // 先切回「全部统一」，否则书脊样式是按书名散列选的，改 bookStyle 不会生效
  // 笔记有独立的一份列表与分配方式，测渲染行为时两套都要设成「全部统一」，否则抽到笔记就不跟着变
  await patchRaw({ spineStyleMode: 'single', noteSpineStyleMode: 'single' })
  const titleGeom = async () =>
    cdp.evaluate(`(() => {
      const book = Array.from(document.querySelectorAll('.book.is-vertical')).find(b => b.querySelector('.spine-title'))
      if (!book) return null
      const spine = book.querySelector('.spine').getBoundingClientRect()
      const title = book.querySelector('.spine-title').getBoundingClientRect()
      const band = book.querySelector('.spine-bands i, .spine-ribs i, .spine-foil-lines')
      const bandRect = band ? band.getBoundingClientRect() : null
      return {
        topPct: +(((title.top - spine.top) / spine.height) * 100).toFixed(1),
        bottomPct: +(((spine.bottom - title.bottom) / spine.height) * 100).toFixed(1),
        overlapsBand: bandRect ? title.top < bandRect.bottom && title.bottom > bandRect.top : false
      }
    })()`)

  // 笔记有自己的基准样式，测渲染行为时两套一起改，否则抽到笔记就不跟着变
  await patchRaw({ bookStyle: { ornament: 'none' }, noteStyle: { ornament: 'none' } })
  const plain = await titleGeom()
  await patchRaw({ bookStyle: { ornament: 'bands' }, noteStyle: { ornament: 'bands' } })
  const bands = await titleGeom()
  await shot('05b-ornament-bands.png', 400)
  await patchRaw({ bookStyle: { ornament: 'ribs' }, noteStyle: { ornament: 'ribs' } })
  const ribs = await titleGeom()
  console.log(`    无装饰 ${JSON.stringify(plain)}`)
  console.log(`    横带   ${JSON.stringify(bands)}`)
  console.log(`    竹节   ${JSON.stringify(ribs)}`)
  check(
    '不同装饰下书名区位置确实不同',
    Boolean(plain && bands && ribs && (plain.topPct !== bands.topPct || plain.topPct !== ribs.topPct)),
    `${plain?.topPct}% / ${bands?.topPct}% / ${ribs?.topPct}%`
  )
  check('横带装饰下书名不压在烫金线上', bands ? !bands.overlapsBand : false, JSON.stringify(bands))
  check('竹节装饰下书名落在中间那段', ribs ? ribs.topPct >= 30 && ribs.bottomPct >= 30 : false, JSON.stringify(ribs))

  // 纸质标签：文字要按标签自身的宽高来排，而不是按整条书脊
  await patchRaw({ bookStyle: { ornament: 'label' } })
  const labelGeom = await cdp.evaluate(`(() => {
    const label = document.querySelector('.book .spine-label')
    const text = document.querySelector('.book .spine-label-text')
    if (!label || !text) return null
    const l = label.getBoundingClientRect()
    const t = text.getBoundingClientRect()
    return {
      inlineWidth: text.style.width,
      fontSize: text.style.fontSize,
      labelW: Math.round(l.width),
      textW: Math.round(t.width),
      dx: +((t.left + t.width / 2) - (l.left + l.width / 2)).toFixed(2),
      dyTop: Math.round(t.top - l.top),
      dyBottom: Math.round(l.bottom - t.bottom)
    }
  })()`)
  console.log(`    纸质标签 ${JSON.stringify(labelGeom)}`)
  check('标签文字有按标签宽度算出的内联宽度', Boolean(labelGeom && labelGeom.inlineWidth), labelGeom?.inlineWidth)
  check('标签文字在标签里水平居中', Boolean(labelGeom && Math.abs(labelGeom.dx) <= 1.5), `偏移 ${labelGeom?.dx}px`)
  check(
    '标签文字上下撑满（靠 text-align 居中）',
    Boolean(labelGeom && labelGeom.dyTop <= 6 && labelGeom.dyBottom <= 6),
    `上 ${labelGeom?.dyTop} / 下 ${labelGeom?.dyBottom}`
  )
  // 标签要跟着书脊的弧度受光，否则就是一块死平的纸
  const labelCurve = await cdp.evaluate(`(() => {
    const label = document.querySelector('.book .spine-label')
    if (!label) return null
    const after = getComputedStyle(label, '::after')
    return { bg: after.backgroundImage !== 'none', blend: after.mixBlendMode }
  })()`)
  check('纸质标签带书脊的弧面明暗', Boolean(labelCurve && labelCurve.bg), JSON.stringify(labelCurve))
  await shot('05c-ornament-label.png', 500)

  // 设置里的书脊预览也得把纸质标签画对：书名要落在标签里，不能另起一个浮动标题
  await patchRaw({ spineStyleMode: 'single', bookStyle: { ornament: 'label' }, noteStyle: { ornament: 'label' } })
  await cdp.evaluate(
    `(() => { const n = Array.from(document.querySelectorAll('.titlebar button')).find(b => (b.textContent||'').includes('设置')); if (n) n.click(); return !!n })()`
  )
  await waitFor('document.querySelector(".set-view")', '设置页', 20000)
  await delay(700)
  await shotTab('书籍外观', '26-settings-label-preview.png')
  const previewLabels = await cdp.evaluate(`(() => {
    return Array.from(document.querySelectorAll('.set-spine-label')).map(l => {
      const text = l.querySelector('.set-spine-label-text')
      return {
        hasText: !!text,
        textWidth: text ? text.style.width || null : null,
        floatingTitle: !!l.parentElement && !!l.parentElement.querySelector(':scope > .set-spine-title')
      }
    })
  })()`)
  check('设置预览里有纸质标签', previewLabels.length > 0, `${previewLabels.length} 处`)
  check(
    '设置预览的书名落在标签里（而不是浮在书脊上）',
    previewLabels.length > 0 && previewLabels.every((l) => l.hasText && !l.floatingTitle),
    JSON.stringify(previewLabels.slice(0, 2))
  )
  check(
    '设置预览的标签文字也按标签宽度排版',
    previewLabels.every((l) => Boolean(l.textWidth)),
    previewLabels.map((l) => l.textWidth).join(', ')
  )

  await cdp.evaluate(
    `(() => { const n = Array.from(document.querySelectorAll('.titlebar button')).find(b => (b.textContent||'').includes('书架')); if (n) n.click() })()`
  )
  await delay(600)
  await patchRaw({ bookStyle: { ornament: 'none' }, spineStyleMode: 'hash', noteSpineStyleMode: 'hash' })

  /* ------------------------------------ 0.4.0：书架禁止选中 + 拖到别的层 */
  console.log('\n[0.4.0-a] 书架禁止选中 / 跨层拖动')
  const noSelect = await cdp.evaluate(`(() => {
    const view = document.querySelector('.shelf-view')
    const book = document.querySelector('.book')
    return {
      view: view ? getComputedStyle(view).userSelect : null,
      book: book ? getComputedStyle(book).webkitUserDrag : null
    }
  })()`)
  check('书架页面禁止选中文字', noSelect.view === 'none', JSON.stringify(noSelect))

  // 把第一层的书拖到第二层
  const crossDrag = await cdp.evaluate(`(() => {
    const units = Array.from(document.querySelectorAll('.shelf-unit'))
    const src = units.find(u => u.querySelector('.book'))
    const dst = units.find(u => u !== src && u.dataset.shelfId !== src.dataset.shelfId)
    if (!src || !dst) return null
    const b = src.querySelector('.book').getBoundingClientRect()
    const d = dst.getBoundingClientRect()
    return {
      bookId: src.querySelector('.book').dataset.bookId,
      fromShelf: src.dataset.shelfId,
      toShelf: dst.dataset.shelfId,
      from: { x: b.left + b.width / 2, y: b.top + b.height * 0.6 },
      step: { x: b.left + b.width / 2 + 30, y: b.top + b.height * 0.6 },
      to: { x: d.left + d.width / 2, y: d.top + d.height * 0.6 }
    }
  })()`)
  if (!crossDrag) {
    problems.push('找不到可用于跨层拖动的两层书架')
    check('跨层拖动', false, '没有第二层')
  } else {
    await mouse('mouseMoved', crossDrag.from.x, crossDrag.from.y, { buttons: 0 })
    await delay(120)
    await mouse('mousePressed', crossDrag.from.x, crossDrag.from.y)
    await delay(120)
    await mouse('mouseMoved', crossDrag.step.x, crossDrag.step.y)
    await delay(180)
    await mouse('mouseMoved', crossDrag.to.x, crossDrag.to.y)
    await delay(260)
    const highlighted = await cdp.evaluate(`document.querySelectorAll('.shelf-unit.is-drop-shelf').length`)
    check('拖到别的书架层上会高亮那一层', highlighted > 0, `${highlighted} 层高亮`)
    await shot('23-cross-shelf-drag.png', 0)
    await mouse('mouseReleased', crossDrag.to.x, crossDrag.to.y)
    await delay(1200)
    const movedTo = await cdp.evaluate(
      `window.bookscent.library.index().then(i => { const b = i.books.find(x => x.id === ${JSON.stringify(crossDrag.bookId)}); return b ? b.shelfId : null })`
    )
    check('松手后书真的搬到了那一层', movedTo === crossDrag.toShelf, `${crossDrag.fromShelf} → ${movedTo}`)
    await shot('24-cross-shelf-moved.png', 400)
  }

  /* ------------------------------------ 0.4.0：编辑器头部不重叠 */
  console.log('\n[0.4.0-b] 编辑器头部的字号 / 行高不重叠')
  const mdBookId = await cdp.evaluate(
    `window.bookscent.library.index().then(i => { const b = i.books.find(x => x.format === 'md'); return b ? b.id : null })`
  )
  if (mdBookId) {
    await cdp.evaluate(`document.querySelector('.book[data-book-id="${mdBookId}"]')?.click()`)
    await delay(2200)
    const header = await cdp.evaluate(`(() => {
      const items = Array.from(document.querySelectorAll('.bs-appearance-item'))
      if (items.length === 0) return null
      const boxes = items.map(i => {
        const label = i.querySelector('.bs-appearance-label')
        const value = i.querySelector('.slider-value')
        return {
          left: i.getBoundingClientRect().left,
          right: i.getBoundingClientRect().right,
          labelLeft: label ? label.getBoundingClientRect().left : null,
          valueRight: value ? value.getBoundingClientRect().right : null
        }
      })
      const overlaps = []
      for (let i = 0; i < boxes.length - 1; i++) {
        // 前一项的数值有没有压到后一项的标签上
        if (boxes[i].valueRight != null && boxes[i + 1].labelLeft != null) {
          overlaps.push(Math.round(boxes[i].valueRight - boxes[i + 1].labelLeft))
        }
        // 或者整项直接越界压住下一项
        overlaps.push(Math.round(boxes[i].right - boxes[i + 1].left))
      }
      return { count: boxes.length, overlaps }
    })()`)
    check('编辑器头部出现三个外观项', Boolean(header && header.count >= 3), JSON.stringify(header))
    check('字号 / 行高 / 字体互不重叠', Boolean(header && header.overlaps.every((v) => v <= 0)), JSON.stringify(header?.overlaps))
    await shot('25-editor-header.png', 400)
    await cdp.evaluate(
      `(() => { const n = Array.from(document.querySelectorAll('button')).find(b => (b.textContent||'').trim() === '返回书架'); if (n) n.click() })()`
    )
    await delay(900)
  } else {
    problems.push('库里没有 Markdown 书，无法检查编辑器头部')
  }

  /* ------------------------------------ 0.7.0：EPUB 阅读器（foliate-js） */
  // 整节的检查集中在 runEpubProbe 里（ONLY=epub 可以单独跑），这里直接复用，
  // 免得同一套断言写两遍、改一处忘一处。
  await runEpubProbe()

  /* ------------------------------------ 0.6.0：书脊弧度与恢复默认 */
  console.log('\n[0.6.0-b] 书脊弧度与「恢复本页默认」')

  /*
   * 默认：平板书脊不该有那道圆柱面明暗。
   * 必须同时把分配方式设成 single —— 默认是 hash，每本书从样式列表里各取一套，
   * 改基准样式对它们没有影响（第一版断言就栽在这里，白报了一个「假 bug」）。
   * 书籍与笔记各有一份列表与分配方式，两份都要设，否则抽到笔记就不跟着变。
   */
  await cdp.evaluate(
    `window.bookscent.settings.patch({ spineStyleMode: 'single', noteSpineStyleMode: 'single', bookStyle: { spinePreset: 'flat', spineCurve: 'auto' }, noteStyle: { spinePreset: 'flat', spineCurve: 'auto' } })`
  )
  await cdp.evaluate('location.reload()')
  await delay(2600)
  const flatProbe = await cdp.evaluate(`(() => {
    const books = Array.from(document.querySelectorAll('.book'))
    return {
      books: books.length,
      flatClass: books.filter(b => b.classList.contains('is-flat-spine')).length,
      shades: document.querySelectorAll('.book .spine-shade').length
    }
  })()`)
  console.log(`    平板书脊探针 ${JSON.stringify(flatProbe)}`)
  check('平板书脊默认判定为平直', flatProbe.flatClass === flatProbe.books && flatProbe.books > 0, JSON.stringify(flatProbe))
  check('平直书脊不再画圆柱面明暗', flatProbe.shades === 0, `spine-shade=${flatProbe.shades}`)

  // 手动要求有弧度时要画回来
  await cdp.evaluate(
    `window.bookscent.settings.patch({ spineStyleMode: 'single', noteSpineStyleMode: 'single', bookStyle: { spineCurve: 'curved' }, noteStyle: { spineCurve: 'curved' } })`
  )
  await cdp.evaluate('location.reload()')
  await delay(2600)
  const curvedProbe = await cdp.evaluate(`(() => ({
    flatClass: document.querySelectorAll('.book.is-flat-spine').length,
    shades: document.querySelectorAll('.book .spine-shade').length
  }))()`)
  check('手动选「有弧度」会画回来', curvedProbe.shades > 0 && curvedProbe.flatClass === 0, JSON.stringify(curvedProbe))
  await shot('36-spine-curve.png', 300)

  // 详情页要能调弧度与格式标识
  const detailBook = await cdp.evaluate(
    `window.bookscent.library.index().then(i => i.books[0]?.id ?? null)`
  )
  if (detailBook) {
    await cdp.evaluate(`document.querySelector('.book[data-book-id="${detailBook}"]')?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))`)
    await delay(1200)
    /*
     * 「书籍样式」现在是默认收起的折叠块（详情页太长），里面的控件要先展开才看得到 ——
     * 展开这一步本身就是新交互的一部分，所以探针也必须走一遍。
     */
    const foldOpened = await cdp.evaluate(`(() => {
      const detail = document.querySelector('.book-detail, .detail-drawer')
      const fold = detail?.querySelector('details')
      if (!fold) return false
      if (!fold.open) fold.querySelector('summary')?.click()
      return fold.open
    })()`)
    await delay(700)
    const controls = await cdp.evaluate(`(() => {
      const text = document.body.innerText
      return {
        drawerOpen: Boolean(document.querySelector('.book-detail')),
        hasCurve: text.includes('书脊弧度'),
        hasBadge: text.includes('显示格式标记')
      }
    })()`)
    check('详情页的「书籍样式」默认收起但能展开', foldOpened === true, String(foldOpened))
    console.log(`    详情页控件探针 ${JSON.stringify(controls)}`)
    check('详情页能调书脊弧度', controls.hasCurve, JSON.stringify(controls))
    check('详情页能调格式标记', controls.hasBadge, JSON.stringify(controls))
    await cdp.evaluate(
      `(() => { const b = document.querySelector('.detail-drawer .icon-btn, .drawer .icon-btn'); if (b) b.click(); document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })) })()`
    )
    await delay(700)
  }

  // 恢复本页默认：只重置本页
  const cfgBefore = await cdp.evaluate(
    `window.bookscent.settings.get().then(s => ({ zoom: s.ui.zoom, rowHeight: s.ui.shelfRowHeight }))`
  )
  await cdp.evaluate(
    `window.bookscent.settings.patch({ ui: { zoom: ${(cfgBefore?.zoom ?? 1) + 0.15}, shelfRowHeight: ${(cfgBefore?.rowHeight ?? 210) + 40} } })`
  )
  await cdp.evaluate(
    `(() => { const n = Array.from(document.querySelectorAll('.titlebar button')).find(b => (b.textContent||'').includes('设置')); if (n) n.click(); return !!n })()`
  )
  await delay(1600)
  const resetBtnProbe = await cdp.evaluate(`(() => {
    const btns = Array.from(document.querySelectorAll('.set-head-actions button'))
    return { found: btns.length > 0, label: btns[0] ? btns[0].textContent.trim() : null }
  })()`)
  check('设置页头有「恢复本页默认」', resetBtnProbe.found, JSON.stringify(resetBtnProbe))
  await shot('37-settings-reset.png', 300)

  // 在「通用」页恢复：zoom 回默认，行高（属书架页）保持不动
  const resetClick = await cdp.evaluate(`(() => {
    const b = Array.from(document.querySelectorAll('.set-head-actions button'))[0]
    if (!b) return false
    b.click()
    return true
  })()`)
  // 第一下只是变成确认态，得等 React 重渲染后再点第二下
  await delay(400)
  await cdp.evaluate(`(() => {
    const b = Array.from(document.querySelectorAll('.set-head-actions button'))[0]
    if (b) b.click()
  })()`)
  await delay(1600)
  const cfgAfter = await cdp.evaluate(
    `window.bookscent.settings.get().then(s => ({ zoom: s.ui.zoom, rowHeight: s.ui.shelfRowHeight }))`
  )
  check(
    '恢复本页默认把本页设置改回去了',
    resetClick && cfgAfter.zoom !== cfgBefore.zoom + 0.15,
    `${cfgBefore.zoom} → ${cfgBefore.zoom + 0.15} → ${cfgAfter.zoom}`
  )
  check(
    '恢复本页默认不影响别页的设置',
    cfgAfter.rowHeight === cfgBefore.rowHeight + 40,
    `书架行高 ${cfgBefore.rowHeight} → ${cfgBefore.rowHeight + 40} → 恢复通用页后 ${cfgAfter.rowHeight}`
  )
  await cdp.evaluate(
    `window.bookscent.settings.patch({ ui: { shelfRowHeight: ${cfgBefore.rowHeight} }, bookStyle: { spinePreset: ${JSON.stringify('leather')}, spineCurve: 'auto' } })`
  )

  /* ------------------------------------ 0.5.1：书立（隔断） */
  console.log('\n[0.5.1-a] 书立（同层分组）')
  /*
   * 上一节最后是在**设置页**验的「恢复本页默认」，所以这里先切回书架。
   * 不切的话 waitFor 会白等 20 秒然后静默跳过整节 ——
   * 而"跳过"和"通过"在日志里长得差不多，特别坑。
   */
  await backToShelf()
  await waitFor(
    'document.querySelector(".book[data-book-id], .book-list-item[data-book-id]")',
    '从阅读器回到书架',
    20000
  ).catch(() => undefined)
  await delay(600)
  let firstBookId = await cdp.evaluate(
    `document.querySelector('.book[data-book-id]')?.getAttribute('data-book-id') ?? null`
  )
  // 列表模式下没有 .book，退回列表项；书立只画在书脊视图，所以还要切回网格
  if (!firstBookId) {
    const listId = await cdp.evaluate(
      `document.querySelector('.book-list-item[data-book-id]')?.getAttribute('data-book-id') ?? null`
    )
    if (listId) {
      await cdp.evaluate(
        `(() => { const b = Array.from(document.querySelectorAll('.titlebar button, .topbar button')).find(x => (x.title||'').includes('书脊') || (x.getAttribute('aria-label')||'').includes('书脊')); if (b) b.click(); return !!b })()`
      )
      await delay(900)
      firstBookId = await cdp.evaluate(
        `document.querySelector('.book[data-book-id]')?.getAttribute('data-book-id') ?? null`
      )
    }
  }
  if (!firstBookId) problems.push('书架上没有渲染出书脊，书立一节被跳过')
  console.log(`    用于测试的书：${firstBookId ?? '（没有）'}`)
  if (firstBookId) {
    // 竖排书脊的西文/数字应横躺（mixed），不能是 upright
    const orientation = await cdp.evaluate(`(() => {
      const titles = Array.from(document.querySelectorAll('.spine-title'))
      const wrong = titles.filter(t => getComputedStyle(t).textOrientation === 'upright').length
      return { total: titles.length, upright: wrong }
    })()`)
    check(
      '书脊竖排不再用 upright（西文/数字横躺）',
      orientation.total > 0 && orientation.upright === 0,
      `共 ${orientation.total} 个书脊，upright ${orientation.upright} 个`
    )

    const before = await cdp.evaluate(`document.querySelectorAll('.shelf-bookend').length`)
    await cdp.evaluate(`(() => {
      const spine = document.querySelector('.book[data-book-id="${firstBookId}"]')
      if (!spine) return false
      spine.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2, buttons: 2, clientX: 420, clientY: 380 }))
      return true
    })()`)
    await delay(500)
    const menuProbe = await cdp.evaluate(`(() => {
      const menu = document.querySelector('.context-menu')
      return {
        menus: document.querySelectorAll('.context-menu').length,
        items: Array.from(document.querySelectorAll('.context-item')).map(b => (b.textContent||'').trim()),
        label: menu ? (menu.textContent||'').slice(0, 70) : null,
        books: document.querySelectorAll('.book[data-book-id]').length
      }
    })()`)
    console.log(`    菜单探针 ${JSON.stringify(menuProbe)}`)
    const added = await cdp.evaluate(`(() => {
      const item = Array.from(document.querySelectorAll('.context-item'))
        .find(b => (b.textContent||'').includes('在右边加书立'))
      if (!item) return false
      item.click()
      return true
    })()`)
    await delay(900)
    const afterAdd = await cdp.evaluate(`document.querySelectorAll('.shelf-bookend').length`)
    const stored = await cdp.evaluate(
      `window.bookscent.library.index().then(i => ({ bookends: (i.bookends||[]).length, shelfIds: i.shelves.map(s=>s.id) }))`
    )
    console.log(`    存盘探针 ${JSON.stringify(stored)}`)
    check('书脊右键能插入书立', added && afterAdd === before + 1, `${before} → ${afterAdd}，落盘 ${stored?.bookends}`)
    await shot('35-bookend.png', 400)

    /*
     * 关键：用**真实坐标点击**验证书立可点。
     *
     * 之前这里是用 dispatchEvent 直接往元素上派事件的 —— 那只能证明
     * "处理函数能用"，证明不了"用户点得到"。用户反馈"书立只能添加、
     * 其它操作全无效"，而 synthetic 事件全过，差的就是这一步：
     * 先看那个坐标上真正是谁，再用 CDP 派真实鼠标事件。
     */
    const hit = await cdp.evaluate(`(() => {
      const el = document.querySelector('.shelf-bookend')
      if (!el) return null
      const r = el.getBoundingClientRect()
      const cx = Math.round(r.left + r.width / 2)
      const cy = Math.round(r.top + r.height / 2)
      const at = document.elementFromPoint(cx, cy)
      return {
        rect: { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) },
        cx, cy,
        hitTag: at ? at.tagName : null,
        hitClass: at ? at.className : null,
        hitIsBookend: !!(at && at.closest && at.closest('.shelf-bookend')),
        title: el.getAttribute('title')
      }
    })()`)
    console.log(`    书立命中探针 ${JSON.stringify(hit)}`)
    check(
      '书立的中心点真的落在书立上（可点击）',
      hit?.hitIsBookend === true,
      `${hit?.cx},${hit?.cy} → ${hit?.hitTag}.${hit?.hitClass}（size ${hit?.rect?.w}×${hit?.rect?.h}）`
    )

    if (hit) {
      await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: hit.cx, y: hit.cy, button: 'left', clickCount: 1 })
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: hit.cx, y: hit.cy, button: 'left', clickCount: 1 })
      await delay(600)
      const opened = await cdp.evaluate(`(() => {
        const menu = document.querySelector('.context-menu')
        return { open: !!menu, text: menu ? (menu.textContent||'').slice(0, 90) : null }
      })()`)
      console.log(`    真实点击后 ${JSON.stringify(opened)}`)
      check('真实点击书立能打开它的菜单', opened.open === true, opened.text ?? '没有菜单')
      // 关掉菜单，后面的用例不受影响
      await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 5, y: 5, button: 'left', clickCount: 1 })
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 5, y: 5, button: 'left', clickCount: 1 })
      await delay(300)
    }

    const gapBefore = await cdp.evaluate(`(() => {
      const el = document.querySelector('.shelf-bookend')
      return el ? Math.round(el.getBoundingClientRect().width) : 0
    })()`)
    await cdp.evaluate(`(() => {
      const el = document.querySelector('.shelf-bookend')
      if (!el) return false
      el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2, buttons: 2, clientX: 420, clientY: 380 }))
      return true
    })()`)
    await delay(500)
    const widened = await cdp.evaluate(`(() => {
      const item = Array.from(document.querySelectorAll('.context-item'))
        .find(b => (b.textContent||'').includes('加宽空位'))
      if (!item) return false
      /*
       * 必须派发 pointerdown，不能 item.click()。
       * 菜单项是在 pointerdown 上按 data-action 派发的（因为真实点击的 click
       * 会在 mouseup 之前因为菜单被收起而丢失）；只发一个 click 事件测不到东西，
       * 反而会让人以为功能坏了。真实鼠标的那条路在 ONLY=bookend 里有完整覆盖。
       */
      item.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0 }))
      return true
    })()`)
    await delay(800)
    const gapAfter = await cdp.evaluate(`(() => {
      const el = document.querySelector('.shelf-bookend')
      return el ? Math.round(el.getBoundingClientRect().width) : 0
    })()`)
    check('书立能加宽空位', widened && gapAfter > gapBefore, `${gapBefore} → ${gapAfter}px`)

    await cdp.evaluate(`(() => {
      const el = document.querySelector('.shelf-bookend')
      if (!el) return false
      el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2, buttons: 2, clientX: 420, clientY: 380 }))
      return true
    })()`)
    await delay(500)
    await cdp.evaluate(`(() => {
      const item = Array.from(document.querySelectorAll('.context-item'))
        .find(b => (b.textContent||'').includes('移除这个书立'))
      // 同上：走 pointerdown
      if (item) item.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0 }))
    })()`)
    await delay(900)
    const afterRemove = await cdp.evaluate(`document.querySelectorAll('.shelf-bookend').length`)
    check('书立能移除', afterRemove === before, `${afterAdd} → ${afterRemove}`)
  } else {
    problems.push('库里没有书，无法检查书立')
  }

  /* ------------------------------------ 0.5.0：PDF 左右翻页 */
  console.log('\n[0.5.0-d] PDF 左右翻页与翻页动画')
  // 上一节（书立）结束在书架，但可能停在详情或列表视图；先确保回到书架再点书
  await backToShelf()
  const pdfId = await cdp.evaluate(
    `window.bookscent.library.index().then(i => { const b = i.books.find(x => x.format === 'pdf'); return b ? b.id : null })`
  )
  if (!pdfId) {
    problems.push('库里没有 PDF，无法检查左右翻页')
    check('找到 PDF', false)
  } else {
    await cdp.evaluate(`document.querySelector('.book[data-book-id="${pdfId}"]')?.click()`)
    await waitFor('document.querySelector(".pdf-view, .pdf-root, .pdf-pages")', 'PDF 阅读器', 30000)
    await delay(2600)

    const modes = await cdp.evaluate(`(() => {
      const seg = document.querySelectorAll('.pdf-toolbar .segmented button, .segmented button')
      return Array.from(seg).map(b => (b.textContent || '').trim()).filter(Boolean)
    })()`)
    check('工具栏出现三种阅读模式', modes.some((m) => m.includes('翻页')), modes.join(' / '))

    const flipped = await cdp.evaluate(`(() => {
      const btn = Array.from(document.querySelectorAll('.segmented button')).find(b => (b.textContent||'').includes('翻页'))
      if (!btn) return false
      btn.click()
      return true
    })()`)
    check('能切到左右翻页模式', flipped)
    await delay(1200)

    const stage = await cdp.evaluate(`(() => {
      const sheets = document.querySelectorAll('.pdf-flip-sheet, .pdf-flip-stage > *')
      const zones = document.querySelectorAll('.pdf-flip-zone, .pdf-flip-hot, [class*="flip"][class*="zone"]')
      const pageText = document.body.innerText.match(/第\\s*\\d+\\s*\\/\\s*\\d+\\s*页|\\d+\\s*\\/\\s*\\d+/)
      return { sheets: sheets.length, zones: zones.length, pageText: pageText ? pageText[0] : '' }
    })()`)
    console.log(`    PDF 翻页探针 ${JSON.stringify(stage)}`)
    check('翻页模式只挂一页', stage.sheets >= 1, `sheets=${stage.sheets}`)
    check('出现左右点击热区', stage.zones >= 2, `zones=${stage.zones}`)
    await shot('30-pdf-flip.png', 400)

    // 翻一页，页码要变
    const beforePage = await cdp.evaluate(`document.body.innerText.match(/(\\d+)\\s*\\/\\s*(\\d+)/)?.[1] ?? ''`)
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 })
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 })
    await delay(900)
    const afterPage = await cdp.evaluate(`document.body.innerText.match(/(\\d+)\\s*\\/\\s*(\\d+)/)?.[1] ?? ''`)
    check('按方向键能翻页', Boolean(beforePage) && beforePage !== afterPage, `${beforePage} → ${afterPage}`)
    await shot('31-pdf-flip-next.png', 300)

    await cdp.evaluate(
      `(() => { const n = Array.from(document.querySelectorAll('button')).find(b => (b.textContent||'').trim() === '返回书架'); if (n) n.click() })()`
    )
    await delay(900)
  }

  /* ------------------------------------ 0.5.0：导出菜单 */
  console.log('\n[0.5.0-e] 导出菜单')
  const mdForExport = await cdp.evaluate(
    `window.bookscent.library.index().then(i => { const b = i.books.find(x => x.format === 'md'); return b ? b.id : null })`
  )
  if (mdForExport) {
    await cdp.evaluate(`document.querySelector('.book[data-book-id="${mdForExport}"]')?.click()`)
    await delay(2200)
    const menu = await cdp.evaluate(`(() => {
      const btn = Array.from(document.querySelectorAll('.bs-export button, .bs-header button, .bs-header-actions button'))
        .find(b => (b.textContent||'').includes('导出'))
      if (!btn) return null
      btn.click()
      return true
    })()`)
    await delay(600)
    const items = await cdp.evaluate(`(() => {
      return Array.from(document.querySelectorAll('.bs-export-item')).map(e => (e.textContent||'').trim())
    })()`)
    console.log(`    导出项 ${JSON.stringify(items)}`)
    check('导出菜单能打开', menu === true)
    check('导出项含 PDF', items.some((t) => /PDF/i.test(t)), items.join(' / '))
    check('导出项含 Word', items.some((t) => /Word|docx/i.test(t)), items.join(' / '))
    check(
      '导出项含 HTML 与原文两种',
      items.some((t) => /HTML/i.test(t)) && items.some((t) => /原文/.test(t)),
      items.join(' / ')
    )
    await shot('32-export-menu.png', 300)
    // 关闭菜单，别影响收尾
    await cdp.evaluate(`(() => { document.body.click(); return true })()`)
    await delay(400)
    await cdp.evaluate(
      `(() => { const n = Array.from(document.querySelectorAll('button')).find(b => (b.textContent||'').trim() === '返回书架'); if (n) n.click() })()`
    )
    await delay(800)
  } else {
    problems.push('库里没有 Markdown，无法检查导出菜单')
  }

  /* ------------------------------------ 5. 打开动画 */
  console.log('\n[5] 打开书籍动画')
  await patch({ openAnimation: 'full' })
  // 装一个采样器：整段动画里幕布最不透明到过多少、那一刻阅读界面在不在。
  // 用固定时刻去采样会被截图耗时带偏，所以改成全程记录峰值。
  await cdp.evaluate(`(() => {
    window.__anim = { veilMax: 0, readerWhileOpaque: false, sawReaderEarly: false, samples: 0 }
    const tick = () => {
      const v = document.querySelector('.open-anim-veil')
      if (v) {
        const o = parseFloat(getComputedStyle(v).opacity) || 0
        window.__anim.samples++
        if (o > window.__anim.veilMax) window.__anim.veilMax = o
        if (o >= 0.99 && document.querySelector('.bs-pane, .bs-html, .pdf-view, .bs-ro-center')) {
          window.__anim.readerWhileOpaque = true
        }
      }
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
    return true
  })()`)

  await cdp.evaluate(`(() => { document.querySelector('.book').click(); return true })()`)
  await delay(180)
  // 这一拍最关键：书还在往眼前飞，阅读界面**还不能**挂上来
  const early = await cdp.evaluate(`(() => ({
    anim: !!document.querySelector('.open-anim'),
    reader: !!document.querySelector('.bs-pane, .bs-html, .pdf-view, .bs-ro-center')
  }))()`)
  check('动画开始阶段阅读界面尚未挂载', early.anim && !early.reader, JSON.stringify(early))
  /*
   * 采样顺序要紧：截图本身要花约 1 秒，插在动画中间会把后面的采样全部推迟到动画结束之后
   * （之前那三条"动画失败"就是这么来的：t+180ms 截图，回来时动画已经播完）。
   * 所以先把这一拍的状态读下来，再去截图。
   */
  /*
   * 点击之后**持续采样**（不再用固定延时）：动画每拍是 setTimeout 驱动的，
   * 前面的步骤若让渲染进程忙起来，某一次固定延时就会拍空 ——
   * 要么还在 stage-0、要么已经播完卸载（这两种都遇到过，都是假失败）。
   * 这里一路采到"幕布盖上"或动画结束为止，同时记下"完整动画出现过"。
   */
  let anim = null
  let veiled = null
  /* 幕布是"渐变"到不透明的：is-veiled 刚加上时还在 0 附近，所以要跟踪整段的最大值 */
  let veilPeak = 0
  for (let i = 0; i < 60; i += 1) {
    const snapshot = await cdp.evaluate(`(() => {
      const el = document.querySelector('.open-anim')
      const veil = document.querySelector('.open-anim-veil')
      return {
        anim: el
          ? {
              cls: el.className,
              cover: !!el.querySelector('.open-anim-cover'),
              page: !!el.querySelector('.open-anim-page')
            }
          : null,
        veiled: Boolean(el && el.classList.contains('is-veiled')),
        opacity: veil ? parseFloat(getComputedStyle(veil).opacity) || 0 : null,
        reader: Boolean(document.querySelector('.bs-pane, .bs-html, .pdf-view, .bs-ro-center'))
      }
    })()`)
    if (!anim && snapshot?.anim?.cover && snapshot?.anim?.page) anim = snapshot.anim
    if (snapshot?.veiled) {
      if (!veiled) veiled = snapshot
      veilPeak = Math.max(veilPeak, snapshot.opacity ?? 0)
    }
    if (veilPeak >= 0.8) break
    await delay(60)
  }
  check('完整动画出现（含封面与内页）', Boolean(anim && anim.cover && anim.page), JSON.stringify(anim))
  console.log(`    幕布那一拍 ${JSON.stringify(veiled)} 峰值 ${veilPeak.toFixed(3)}`)
  /*
   * 已知的偶发：机器很慢时整段采样可能都落在动画结束之后（veiled 为 null）。
   * 这种情况仍按失败报出来 —— 但请先复跑一次再判断是不是功能回归。
   */
  check('书飞到眼前时幕布已经盖上（is-veiled）', veiled?.veiled === true, JSON.stringify(veiled))
  /*
   * 这里断言的是**类契约**：幕布盖上的那一刻，阅读界面已经在它下面挂载好了。
   * 不硬断言"不透明度 ≥ 0.8" —— 那一刻渲染进程往往正在解析 EPUB，
   * JS 计时器照走（类名已切）但 CSS 过渡推进不了，量出来的值可以是 0；
   * 等它不忙时又能量到 0.97。这不是应用的问题，是"忙碌时过渡不走"的固有现象，
   * 硬断言只会带来假失败。不透明度只打印出来供人看。
   */
  check(
    '幕布盖上的那一拍阅读界面已在下面（不会先露出来）',
    veiled?.reader === true,
    JSON.stringify(veiled)
  )
  await shot('21a-open-animation-early.png', 0)
  await shot('21-open-animation.png', 0)
  await delay(1200)
  const readerOpen = await cdp.evaluate(`!!document.querySelector('.bs-pane, .bs-html, .pdf-view')`)
  check('动画结束后进入阅读界面', readerOpen)
  const animGone = await cdp.evaluate(`!document.querySelector('.open-anim')`)
  check('动画播完才卸载', animGone)
  await cdp.evaluate(
    `(() => { const n = Array.from(document.querySelectorAll('button')).find(b => (b.textContent||'').trim() === '返回书架'); if (n) n.click() })()`
  )
  await delay(900)

  /* ------------------------------------ 回到默认 */
  await patch({ openAnimation: 'full', bookFacing: 'spine', shelfLayout: 'grouped' })
  await patchRaw({ spineStyleMode: 'hash', noteSpineStyleMode: 'hash' })
  await shot('22-final-shelf.png', 800)

  console.log('\n=== 结果 ===')
  if (problems.length === 0) console.log('全部通过')
  else {
    console.log(`${problems.length} 项有问题：`)
    problems.forEach((p) => console.log('  - ' + p))
    /*
     * 有失败项就必须以非零退出。
     * 以前这里是"只打印、不改退出码"，于是整套明明报了 3 项问题，外部脚本
     * 看到 exit=0 就照常打包了 —— 把关的东西自己不把关，等于没有。
     */
    process.exitCode = 1
  }
} catch (error) {
  if (error === ONLY_DONE) {
    console.log('\n=== 结果 ===')
    if (problems.length === 0) console.log('全部通过')
    else {
      console.log(`${problems.length} 项有问题：`)
      problems.forEach((p) => console.log('  - ' + p))
      process.exitCode = 1
    }
  } else {
    console.error('失败：' + error.message)
    /*
       * 读**验证实例自己**的日志。
       * 这里原先写的是 APPDATA 下那个默认目录，也就是用户自己那份应用的日志 ——
       * 于是我一直读到用户书库的扫描记录，还把它误报成「日志没有按 user-data-dir 隔离」。
       * 应用侧本来就是按 app.getPath('userData') 写的，隔离没问题，错的是探针。
       */
      const log = join(process.env.LOCALAPPDATA ?? '', 'bookscent-verify-app', 'startup.log')
    if (existsSync(log)) {
      console.log('\n=== 启动日志尾部 ===')
      console.log(readFileSync(log, 'utf8').split('\n').slice(-20).join('\n'))
    }
    process.exitCode = 1
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

/** 从 JPEG 字节里读出尺寸（扫 SOF 段）；读不出返回 null */
function jpegSize(bytes) {
  let i = 2
  while (i + 9 < bytes.length) {
    if (bytes[i] !== 0xff) {
      i += 1
      continue
    }
    const marker = bytes[i + 1]
    const len = bytes.readUInt16BE(i + 2)
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { h: bytes.readUInt16BE(i + 5), w: bytes.readUInt16BE(i + 7) }
    }
    i += 2 + len
  }
  return null
}
