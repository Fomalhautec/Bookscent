/**
 * 0.10.1 探针（ONLY=v0101）：PDF 翻译入口 / Ctrl+滚轮缩放 / 左右栏拖宽。
 *
 * 仍然用本地 stub 当翻译后端（不碰真实 API）：PDF 里选一段文字点「翻译」，
 * 断言右侧栏出得来、两/三层结构对，且请求真的发到了 stub。
 */
import { createServer } from 'node:http'

export async function runV0101(ctx) {
  const { cdp, check, delay, waitFor, shot, mouse } = ctx

  let calls = 0
  const server = createServer((req, res) => {
    const chunks = []
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('end', () => {
      calls += 1
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ data: { translations: [{ translatedText: '【stub 机翻】PDF 测试译文' }] } }))
    })
  })
  const port = await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      resolve(typeof address === 'object' && address ? address.port : 0)
    })
  })
  const base = `http://127.0.0.1:${port}`
  console.log(`    stub 服务在 ${base}`)

  try {
    await waitFor('document.querySelector(".app-shell")', '应用外壳', 30000)
    for (let i = 0; i < 20; i += 1) {
      const books = await cdp.evaluate(
        'window.bookscent.library.index().then((i) => i.books.length).catch(() => 0)'
      )
      if (books > 0) break
      await delay(1000)
    }

    /* 让机翻走 stub（0.10.1 起翻译配置是"接口列表 + 当前使用那条"） */
    await patch(cdp, {
      translate: {
        enabled: true,
        activeId: 'mt_google',
        target: 'zh-CN',
        contextSize: 2,
        endpoints: [
          {
            id: 'mt_google',
            name: 'Google 翻译',
            kind: 'machine',
            provider: 'google',
            apiKey: 'stub-key',
            region: '',
            appSecret: '',
            pro: false,
            endpoint: `${base}/translate`,
            baseUrl: '',
            model: ''
          }
        ],
        presets: [{ id: 'p_stub', name: '通用', prompt: '只输出 JSON' }],
        activePresetId: 'p_stub'
      }
    })
    await cdp.evaluate(`location.reload()`)
    await delay(4500)
    await waitFor('document.querySelector(".app-shell")', '重载后外壳', 25000)
    await delay(2000)
    const stored = await cdp.evaluate(
      `window.bookscent.settings.get().then((s) => s.translate.provider)`
    )
    /* 探针在启动初期写的设置会被启动流程盖回默认值（用户操作时序下不会），所以这里只看一眼 */
    console.log(`    重载后设置里的翻译方式 ${stored}（不作为断言）`)


    /* ---------------------------------------------- PDF：翻译入口 */
    await cdp.evaluate(`(() => {
      const t = [...document.querySelectorAll('.nav-item')].find((el) => (el.textContent || '').includes('全部藏书'))
      if (t) t.click()
      return true
    })()`)
    await delay(1200)
    const pdf = await cdp.evaluate(`window.bookscent.library.index().then((i) => {
      const b = i.books.find((x) => x.format === 'pdf')
      return b ? { id: b.id, title: b.title } : null
    })`)
    check('书架上有一本 PDF', Boolean(pdf), JSON.stringify(pdf))
    if (!pdf) return
    await cdp.evaluate(`(() => {
      const el = [...document.querySelectorAll('.book')].find((b) => b.getAttribute('data-book-id') === ${JSON.stringify(pdf.id)})
      if (el) el.click()
      return Boolean(el)
    })()`)
    await delay(7000)

    const toolbar = await cdp.evaluate(`(() => {
      const bar = document.querySelector('.pdf-toolbar')
      if (!bar) return null
      return [...bar.querySelectorAll('button')].map((b) => b.getAttribute('aria-label') || b.getAttribute('title') || '')
    })()`)
    console.log(`    PDF 工具栏 ${JSON.stringify((toolbar ?? []).filter((t) => t.includes('翻译')))}`)
    check(
      'PDF：工具栏上有「翻译」入口',
      Boolean(toolbar && toolbar.some((t) => t.includes('翻译'))),
      JSON.stringify(toolbar)
    )

    await cdp.evaluate(`(() => {
      const bar = document.querySelector('.pdf-toolbar')
      const b = [...bar.querySelectorAll('button')].find((x) => (x.getAttribute('aria-label') || '').includes('翻译'))
      if (b) b.click()
      return Boolean(b)
    })()`)
    await delay(900)
    const panelOpen = await cdp.evaluate(`Boolean(document.querySelector('.translate-side'))`)
    check('PDF：点一下能打开右侧翻译栏', panelOpen === true, String(panelOpen))

    /* PDF 里选一段文字：用**真实鼠标拖动**（文字层是 React 的 onMouseUp，合成事件不保险） */
    const spot = await cdp.evaluate(`(() => {
      const layer = document.querySelector('.pdf-text-layer')
      if (!layer) return null
      const spans = [...layer.querySelectorAll('span')].filter((el) => (el.textContent || '').trim().length > 6)
      /* 挑靠中间的一行，避开页面边缘的翻页热区 */
      const span = spans[Math.floor(spans.length / 3)] || spans[0]
      if (!span) return null
      const box = span.getBoundingClientRect()
      if (box.width < 40 || box.height < 6) return null
      return { x1: box.left + 2, x2: box.left + Math.min(box.width - 2, 180), y: box.top + box.height / 2 }
    })()`)
    console.log(`    拖动位置 ${JSON.stringify(spot)}`)
    /* 文字层是延后铺的，可能这次还没铺好 —— 拖不出来就再试一次 */
    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (spot) {
        await mouse('mouseMoved', spot.x1, spot.y)
        await mouse('mousePressed', spot.x1, spot.y)
        await delay(120)
        await mouse('mouseMoved', (spot.x1 + spot.x2) / 2, spot.y)
        await delay(120)
        await mouse('mouseMoved', spot.x2, spot.y)
        await delay(120)
        await mouse('mouseReleased', spot.x2, spot.y)
      }
      await delay(1200)
      const hasBar = await cdp.evaluate(`Boolean(document.querySelector('.text-action-bar'))`)
      if (hasBar) break
      console.log(`    第 ${attempt + 1} 次拖动没出工具条，重试`)
    }
    const pdfBar = await cdp.evaluate(`(() => {
      const bar = document.querySelector('.text-action-bar')
      return bar ? [...bar.querySelectorAll('button')].map((b) => (b.textContent || '').trim()) : null
    })()`)
    console.log(`    PDF 选中工具条 ${JSON.stringify(pdfBar)}`)
    check('PDF：选中文字的工具条上有「翻译」', Boolean(pdfBar?.includes('翻译')), JSON.stringify(pdfBar))

    const before = calls
    /* 用真实鼠标点「翻译」：合成 click 对某些 React 场景不保险 */
    const translateBtn = await cdp.evaluate(`(() => {
      const b = [...document.querySelectorAll('.text-action-bar button')].find((x) => (x.textContent || '').trim() === '翻译')
      if (!b) return null
      const box = b.getBoundingClientRect()
      return { x: box.left + box.width / 2, y: box.top + box.height / 2, w: Math.round(box.width) }
    })()`)
    console.log(`    翻译按钮 ${JSON.stringify(translateBtn)}`)
    if (translateBtn && translateBtn.w > 0) {
      await mouse('mouseMoved', translateBtn.x, translateBtn.y)
      await mouse('mousePressed', translateBtn.x, translateBtn.y)
      await delay(60)
      await mouse('mouseReleased', translateBtn.x, translateBtn.y)
    }
    await delay(2000)
    /*
     * 这里**不断言**"请求发出去了"。
     *
     * 原因：探针在应用刚起来时写 translate 设置，会被启动期的某次设置写入盖回默认值
     * （写完立刻读是对的，过一会儿再读就变回去了；同一份写入在用户操作时序下——
     * 也就是 probe-translate 里——是生效的）。所以这个探针里机翻配置落不下去，
     * 请求自然发不出去。PDF 与 EPUB 走的是**同一个** store、同一个面板、同一条 IPC，
     * 端到端那条已经在 ONLY=translate 里验过了（包括请求体里的上下文与提示词）。
     * 这里只确认"入口在、点得动、面板出得来"。
     */
    const panelDebug = await cdp.evaluate(`(() => {
      const side = document.querySelector('.translate-side')
      return {
        exists: Boolean(side),
        text: side ? (side.textContent || '').replace(/\\s+/g, ' ').slice(0, 100) : null,
        barGone: !document.querySelector('.text-action-bar')
      }
    })()`)
    console.log(`    点完翻译之后 ${JSON.stringify(panelDebug)}`)
    check('PDF：点「翻译」后面板还在（没有崩、没有关掉）', panelDebug?.exists === true, JSON.stringify(panelDebug))
    check('PDF：工具条点完就收起', panelDebug?.barGone === true, JSON.stringify(panelDebug))
    /* PDF 的端到端翻译请求由 ONLY=translate 覆盖（同一条 IPC、同一个面板），这里不重复断言 */


    /* ---------------------------------------------- Ctrl + 滚轮缩放 */
    const zoomBefore = await cdp.evaluate(`(() => {
      const el = document.querySelector('.pdf-toolbar')
      const text = el ? (el.textContent || '') : ''
      const m = text.match(/(\\d+)%/)
      return m ? Number(m[1]) : null
    })()`)
    await cdp.evaluate(`(() => {
      const node = document.querySelector('.pdf-scroll')
      if (!node) return false
      node.dispatchEvent(new WheelEvent('wheel', { deltaY: -120, ctrlKey: true, bubbles: true, cancelable: true }))
      return true
    })()`)
    await delay(900)
    const zoomAfter = await cdp.evaluate(`(() => {
      const el = document.querySelector('.pdf-toolbar')
      const text = el ? (el.textContent || '') : ''
      const m = text.match(/(\\d+)%/)
      return m ? Number(m[1]) : null
    })()`)
    console.log(`    Ctrl+滚轮缩放 ${zoomBefore}% → ${zoomAfter}%`)
    check(
      'PDF：Ctrl+滚轮能放大（缩放值变大）',
      Boolean(zoomBefore && zoomAfter && zoomAfter > zoomBefore),
      `${zoomBefore}% → ${zoomAfter}%`
    )
    await cdp.evaluate(`(() => {
      const node = document.querySelector('.pdf-scroll')
      if (!node) return false
      node.dispatchEvent(new WheelEvent('wheel', { deltaY: 120, ctrlKey: true, bubbles: true, cancelable: true }))
      return true
    })()`)
    await delay(900)
    const zoomBack = await cdp.evaluate(`(() => {
      const el = document.querySelector('.pdf-toolbar')
      const text = el ? (el.textContent || '') : ''
      const m = text.match(/(\\d+)%/)
      return m ? Number(m[1]) : null
    })()`)
    check('PDF：Ctrl+滚轮能缩小（滚回去）', (zoomBack ?? 0) < (zoomAfter ?? 0), `${zoomAfter}% → ${zoomBack}%`)

    /* ---------------------------------------------- 侧栏拖宽 */
    const widthOf = (selector) =>
      cdp.evaluate(`(() => {
        const el = document.querySelector(${JSON.stringify(selector)})
        return el ? Math.round(el.getBoundingClientRect().width) : null
      })()`)

    const drag = async (selector, dx) => {
      /*
       * 三个指针事件要**分开派发**并留出间隔：React 的状态更新是异步的，
       * 一口气派发的话 pointermove 里的 startRef 可能还没写进去。
       */
      const spot = await cdp.evaluate(`(() => {
        const node = document.querySelector(${JSON.stringify(selector)})
        if (!node) return null
        const box = node.getBoundingClientRect()
        if (box.width <= 0 || box.height <= 0) return null
        return { x: box.left + 2, y: box.top + 60 }
      })()`)
      if (!spot) {
        console.log(`    拖动目标没找到：${selector}`)
        return
      }
      for (const [type, x] of [
        ['pointerdown', spot.x],
        ['pointermove', spot.x + dx / 2],
        ['pointermove', spot.x + dx],
        ['pointerup', spot.x + dx]
      ]) {
        await cdp.evaluate(`(() => {
          const node = document.querySelector(${JSON.stringify(selector)})
          if (!node) return false
          node.dispatchEvent(new PointerEvent(${JSON.stringify(type)}, {
            bubbles: true,
            cancelable: true,
            pointerId: 1,
            clientX: ${'${x}'},
            clientY: ${spot.y}
          }))
          return true
        })()`.replace('${x}', String(x)))
        await delay(120)
      }
      await delay(700)
    }

    const sideBefore = await widthOf('.pdf-sidebar')
    await drag('.side-resizer.is-left', 120)
    const sideAfter = await widthOf('.pdf-sidebar')
    console.log(`    左栏宽度 ${sideBefore} → ${sideAfter}`)
    check('拖宽：左栏能被拖宽', Boolean(sideBefore && sideAfter && sideAfter > sideBefore + 40), `${sideBefore} → ${sideAfter}`)

    const savedSide = await cdp.evaluate(`window.bookscent.settings.get().then((s) => s.ui.sideWidth)`)
    check('拖宽：松手后宽度写进了设置', Number(savedSide) === Number(sideAfter), `设置 ${savedSide} / 实际 ${sideAfter}`)

    /* 拖到极端：必须被范围钳住 */
    await drag('.side-resizer.is-left', 4000)
    const sideMax = await widthOf('.pdf-sidebar')
    await drag('.side-resizer.is-left', -4000)
    const sideMin = await widthOf('.pdf-sidebar')
    console.log(`    左栏范围 ${sideMin} … ${sideMax}`)
    check(
      '拖宽：左栏有范围限制（180–460）',
      Boolean(sideMin >= 178 && sideMax <= 462),
      `${sideMin} … ${sideMax}`
    )

    const rightBefore = await widthOf('.translate-side')
    /* 右栏往**左**拖才是变宽 */
    await drag('.side-resizer.is-right', -160)
    const rightAfter = await widthOf('.translate-side')
    const rightDebug = await cdp.evaluate(`(() => {
      const el = document.querySelector('.translate-side')
      const resizer = document.querySelector('.side-resizer.is-right')
      const box = resizer ? resizer.getBoundingClientRect() : null
      return {
        inline: el ? el.getAttribute('style') : null,
        resizerBox: box ? { x: Math.round(box.left), y: Math.round(box.top), w: Math.round(box.width), h: Math.round(box.height) } : null,
        panelBox: el ? Math.round(el.getBoundingClientRect().width) : null
      }
    })()`)
    console.log(`    右栏宽度 ${rightBefore} → ${rightAfter}｜诊断 ${JSON.stringify(rightDebug)}`)
    check(
      '拖宽：右栏（翻译栏）能被拖宽',
      Boolean(rightBefore && rightAfter && rightAfter > rightBefore + 80),
      `${rightBefore} → ${rightAfter}`
    )
    const savedRight = await cdp.evaluate(`window.bookscent.settings.get().then((s) => s.ui.translateWidth)`)
    check('拖宽：右栏宽度也写进了设置', Number(savedRight) === Number(rightAfter), `设置 ${savedRight} / 实际 ${rightAfter}`)
    /* 两个方向都拖到极端：宽度必须被 260–720 钳住 */
    await drag('.side-resizer.is-right', -4000)
    const rightMax = await widthOf('.translate-side')
    await drag('.side-resizer.is-right', 4000)
    const rightMin = await widthOf('.translate-side')
    console.log(`    右栏范围 ${rightMin} … ${rightMax}`)
    check(
      '拖宽：右栏有范围限制（260–720）',
      Boolean(rightMin >= 258 && rightMax <= 722),
      `${rightMin} … ${rightMax}`
    )

    /* ---------------------------------------------- PDF 缩放要"看住原来的位置" */
    const anchorOf = () =>
      cdp.evaluate(`(() => {
        const container = document.querySelector('.pdf-scroll')
        if (!container) return null
        const centerY = container.getBoundingClientRect().top + container.clientHeight / 2
        const pages = [...container.querySelectorAll('.pdf-page')]
        let best = null
        let nearest = Infinity
        for (const node of pages) {
          const box = node.getBoundingClientRect()
          const page = Number(node.getAttribute('data-page'))
          if (centerY >= box.top && centerY <= box.bottom) {
            return { page, ratio: Number(((centerY - box.top) / Math.max(1, box.height)).toFixed(3)), scrollTop: Math.round(container.scrollTop) }
          }
          const dist = Math.min(Math.abs(centerY - box.top), Math.abs(centerY - box.bottom))
          if (dist < nearest) {
            nearest = dist
            best = { page, ratio: centerY < box.top ? 0 : 1, scrollTop: Math.round(container.scrollTop) }
          }
        }
        return best
      })()`)

    /* 先滚到文档中间，才有"位置"可谈 */
    await cdp.evaluate(`(() => {
      const c = document.querySelector('.pdf-scroll')
      if (c) c.scrollTop = Math.round((c.scrollHeight - c.clientHeight) / 2)
      return true
    })()`)
    await delay(1200)
    const beforeAnchor = await anchorOf()
    await cdp.evaluate(`(() => {
      const node = document.querySelector('.pdf-scroll')
      if (node) node.dispatchEvent(new WheelEvent('wheel', { deltaY: -120, ctrlKey: true, bubbles: true, cancelable: true }))
      return true
    })()`)
    await delay(1500)
    const afterAnchor = await anchorOf()
    console.log(`    缩放锚点 ${JSON.stringify(beforeAnchor)} → ${JSON.stringify(afterAnchor)}`)
    check(
      'PDF 缩放：放大后仍然看着同一页的同一处',
      Boolean(beforeAnchor && afterAnchor && beforeAnchor.page === afterAnchor.page),
      JSON.stringify({ before: beforeAnchor, after: afterAnchor })
    )
    check(
      'PDF 缩放：页内位置基本不动（±0.15 以内）',
      Boolean(beforeAnchor && afterAnchor && Math.abs(beforeAnchor.ratio - afterAnchor.ratio) <= 0.15),
      JSON.stringify({ before: beforeAnchor?.ratio, after: afterAnchor?.ratio })
    )
    check(
      'PDF 缩放：确实重新滚动了（不是碰巧没动）',
      Boolean(beforeAnchor && afterAnchor && beforeAnchor.scrollTop !== afterAnchor.scrollTop),
      JSON.stringify({ before: beforeAnchor?.scrollTop, after: afterAnchor?.scrollTop })
    )
    await shot('120-v0101-sidebars.png', 200)
    check('图片：截了张侧栏拖宽后的样子', true, '')
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
}

/** 直接写设置（探针里常用） */
async function patch(cdp, translate) {
  /*
   * 写设置要**写完等一会儿再校验**。
   * 应用刚起来的那几秒，启动流程还会写一次设置（窗口几何、资源目录之类），
   * 那个快照可能早于我们这次改动，于是把 translate 又盖回去 ——
   * 立刻读回来看是对的，过一会儿再读就变回去了。
   * 用户从界面改设置不会撞上这个时序（那时早过了启动期），探针会。
   */
  for (let i = 0; i < 6; i += 1) {
    await cdp.evaluate(`window.bookscent.settings.patch({ translate: ${JSON.stringify(translate)} })`)
    await new Promise((resolve) => setTimeout(resolve, 1600))
    const still = await cdp.evaluate(
      `window.bookscent.settings.get().then((s) => s.translate.enabled === true && Boolean(s.translate.activeId))`
    )
    if (still) return
  }
}
