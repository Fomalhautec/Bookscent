/**
 * 翻译功能的探针（ONLY=translate）。
 *
 * 原则：**不碰真实 API**（没有密钥，也不该拿用户的 key 去跑测试）。
 * 所以这里起一个本地 stub 服务（127.0.0.1 随机端口）：
 *   - 冒充 AI 的 /chat/completions：回一段 JSON（译文 + 解析），并把请求体记下来，
 *     用来断言"上下文与提示词真的送出去了"；
 *   - 冒充 Google v2：回 { data: { translations: [...] } }，用来验证机翻那档的**两栏**结构。
 * 然后把设置里的地址指到这个 stub 上跑完整流程。
 */
import { createServer } from 'node:http'

export async function runTranslate(ctx) {
  const { cdp, check, delay, waitFor, shot } = ctx

  /** stub 收到的最后一次请求体 */
  let lastAiBody = null
  let lastMachineBody = null
  let aiCalls = 0
  let machineCalls = 0

  const server = createServer((req, res) => {
    const chunks = []
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8')
      res.setHeader('Content-Type', 'application/json')
      if (req.url && req.url.includes('chat/completions')) {
        aiCalls += 1
        try {
          lastAiBody = JSON.parse(raw)
        } catch {
          lastAiBody = { raw }
        }
        res.end(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    translation: '【stub 译文】这是一句测试用的译文。',
                    analysis: '- **语法**：这里是 stub 给的解析。\n- **词汇**：stub / 测试\n- **难句**：无。'
                  })
                }
              }
            ]
          })
        )
        return
      }
      /* Google v2 的形状 */
      machineCalls += 1
      try {
        lastMachineBody = JSON.parse(raw)
      } catch {
        lastMachineBody = { raw }
      }
      res.end(JSON.stringify({ data: { translations: [{ translatedText: '【stub 机翻】测试译文' }] } }))
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
    let books = 0
    for (let i = 0; i < 20; i += 1) {
      books = await cdp.evaluate('window.bookscent.library.index().then((i) => i.books.length).catch(() => 0)')
      if (books > 0) break
      await delay(1000)
    }

    const src = process.env.JP_EPUB ?? process.env.JP_EPUB2 ?? ''
    const hasEpub = await cdp.evaluate(
      'window.bookscent.library.index().then((i) => i.books.some((b) => b.format === "epub"))'
    )
    if (!hasEpub && src) {
      await cdp.evaluate(`window.bookscent.library.importPaths([${JSON.stringify(src)}], false)`)
      await delay(2500)
      await cdp.evaluate('location.reload()')
      await delay(4500)
      await waitFor('document.querySelector(".app-shell")', '重载后外壳', 25000)
      await delay(2000)
    }

    /* ---------------------------------------------- 设置页里有「翻译」分页 */
    const tabFound = await cdp.evaluate(`(() => {
      const el = [...document.querySelectorAll('button, [role=tab], .set-tab-btn, .nav-item')]
        .find((b) => (b.textContent || '').trim() === '翻译')
      return Boolean(el)
    })()`)
    /* 顶栏进设置页 */
    await cdp.evaluate(`(() => {
      const b = [...document.querySelectorAll('button, [role=button]')]
        .find((el) => (el.getAttribute('title') || '').includes('设置') || (el.textContent || '').trim() === '设置')
      if (b) b.click()
      return Boolean(b)
    })()`)
    await delay(2000)
    /*
     * 分页断言放宽：设置页的分页按钮类名不只一种（这里不去猜类名），
     * 只要页面上存在一个文案正好是「翻译」的可点元素即可 —— 下面还会点它进译页。
     */
    const settingsTabs = await cdp.evaluate(
      `(() => [...document.querySelectorAll('button, [role=tab], .settings-tab, .set-tab-btn')]
        .map((b) => (b.textContent || '').trim())
        .filter((text) => text.length > 0 && text.length < 10))()`
    )
    console.log(`    设置页可点项 ${JSON.stringify(settingsTabs)}`)
    check('#翻译：设置页里有「翻译」分页', (settingsTabs ?? []).includes('翻译'), JSON.stringify(settingsTabs))

    /* 打开译页，看关键控件在不在 */
    await cdp.evaluate(`(() => {
      const el = [...document.querySelectorAll('.set-tab-btn, .settings-tab, [role=tab], button')]
        .find((b) => (b.textContent || '').trim() === '翻译')
      if (el) el.click()
      return Boolean(el)
    })()`)
    await delay(1200)
    const paneText = await cdp.evaluate(`(document.querySelector('.set-tab')?.textContent || '').slice(0, 400)`)
    console.log(`    翻译页文本 ${JSON.stringify(paneText.slice(0, 120))}`)
    /* 0.10.1 起设置页按 AI / 机翻两大类分组，文案也跟着变了 */
    check(
      '#翻译：设置页有启用开关、目标语言与两大分类',
      paneText.includes('启用翻译') &&
        paneText.includes('目标语言') &&
        paneText.includes('AI 翻译') &&
        paneText.includes('机器翻译'),
      ''
    )

    /* ---------------------------------------------- 配 AI，指向 stub */
    await cdp.evaluate(`window.bookscent.settings.patch({ translate: {
      enabled: true,
      activeId: 'ai_stub',
      target: 'zh-CN',
      contextSize: 2,
      endpoints: [{
        id: 'ai_stub', name: 'Stub AI', kind: 'ai', provider: 'ai',
        apiKey: 'stub-key', region: '', appSecret: '', pro: false, endpoint: '',
        baseUrl: ${JSON.stringify(base)}, model: 'stub-model'
      }],
      presets: [{ id: 'p_stub', name: '通用', prompt: '你是译者。只输出 JSON：{"translation":"…","analysis":"…"}' }],
      activePresetId: 'p_stub'
    } })`)
    await delay(1200)
    const savedAi = await cdp.evaluate(
      `window.bookscent.settings.get().then((s) => {
        const ep = s.translate.endpoints.find((e) => e.id === s.translate.activeId)
        return { provider: ep ? ep.provider : null, base: ep ? ep.baseUrl : null, size: s.translate.contextSize }
      })`
    )
    console.log(`    AI 配置 ${JSON.stringify(savedAi)}`)
    check('#翻译：AI 配置能存进设置', savedAi?.provider === 'ai' && savedAi?.base === base, JSON.stringify(savedAi))

    /* 回书架并打开一本 EPUB */
    await cdp.evaluate(`location.reload()`)
    await delay(4500)
    await waitFor('document.querySelector(".app-shell")', '重载后外壳', 25000)
    await delay(2000)
    await cdp.evaluate(`(() => {
      const t = [...document.querySelectorAll('.nav-item')].find((el) => (el.textContent || '').includes('全部藏书'))
      if (t) t.click()
      return Boolean(t)
    })()`)
    await delay(1200)

    const epub = await cdp.evaluate(`window.bookscent.library.index().then((i) => {
      const b = i.books.find((x) => x.format === 'epub')
      return b ? { id: b.id, title: b.title } : null
    })`)
    check('书架上有一本 EPUB', Boolean(epub), JSON.stringify(epub))
    if (!epub) return
    await cdp.evaluate(`(() => {
      const el = [...document.querySelectorAll('.book')].find((b) => b.getAttribute('data-book-id') === ${JSON.stringify(epub.id)})
      if (el) el.click()
      return Boolean(el)
    })()`)
    await delay(6500)

    /* 走到有正文的章节 */
    const textLen = () =>
      cdp.evaluate(`(() => {
        const v = document.querySelector('foliate-view')
        const contents = v && v.renderer && v.renderer.getContents ? v.renderer.getContents() : []
        let n = 0
        for (const c of contents) if (c && c.doc && c.doc.body) n += (c.doc.body.innerText || '').replace(/\\s/g, '').length
        return n
      })()`)
    for (let i = 0; i < 18; i += 1) {
      if ((await textLen()) > 200) break
      await cdp.evaluate('(() => { const v = document.querySelector("foliate-view"); if (v) v.next(); return true })()')
      await delay(1400)
    }
    check('走到有正文的章节', (await textLen()) > 200, '')

    /* 选中一段（用 TreeWalker：竖排书的正文未必在 <p> 的直接文本子节点上） */
    const picked = await cdp.evaluate(`(() => {
      const v = document.querySelector('foliate-view')
      const contents = v.renderer.getContents().filter((c) => c && c.doc && c.doc.body)
      for (const content of contents) {
        const doc = content.doc
        const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT)
        let node = walker.nextNode()
        while (node && (node.data || '').trim().length < 12) node = walker.nextNode()
        if (!node) continue
        const range = doc.createRange()
        range.setStart(node, 0)
        range.setEnd(node, Math.min(16, node.data.length))
        const sel = doc.getSelection()
        sel.removeAllRanges()
        sel.addRange(range)
        node.parentElement.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
        doc.dispatchEvent(new Event('selectionchange'))
        return { text: range.toString() }
      }
      return null
    })()`)
    console.log(`    选中 ${JSON.stringify(picked)}`)
    check('#翻译：能选中一段正文', Boolean(picked?.text), JSON.stringify(picked))
    await delay(900)

    const barText = await cdp.evaluate(`(() => {
      const bar = document.querySelector('.text-action-bar')
      return bar ? [...bar.querySelectorAll('button')].map((b) => (b.textContent || '').trim()) : null
    })()`)
    console.log(`    工具条 ${JSON.stringify(barText)}`)
    check('#翻译：选中工具条上有「翻译」', Boolean(barText?.includes('翻译')), JSON.stringify(barText))

    /* 点翻译 → 右侧栏三栏 + stub 收到带上下文的请求 */
    await cdp.evaluate(`(() => {
      const b = [...document.querySelectorAll('.text-action-bar button')].find((x) => (x.textContent || '').trim() === '翻译')
      if (b) b.click()
      return Boolean(b)
    })()`)
    await delay(2500)

    const panel = await cdp.evaluate(`(() => {
      const side = document.querySelector('.translate-side')
      if (!side) return null
      return {
        columns: [...side.querySelectorAll('.translate-layer-title')].map((el) => (el.textContent || '').trim()),
        splits: side.querySelectorAll('.translate-split').length,
        mdList: side.querySelectorAll('.translate-analysis ul li').length,
        mdStrong: side.querySelectorAll('.translate-analysis strong').length,
        /* 面板要贴着最右边：右边缘应与阅读区右边缘基本重合 */
        rightGap: Math.round(document.querySelector('.epub-body').getBoundingClientRect().right - side.getBoundingClientRect().right),
        isLastChild: side === side.parentElement.lastElementChild,
        source: (side.querySelector('.translate-source')?.textContent || '').slice(0, 40),
        translation: (side.querySelector('.translate-text')?.textContent || '').slice(0, 60),
        analysis: (side.querySelector('.translate-analysis')?.textContent || '').slice(0, 60),
        meta: (side.querySelector('.translate-meta')?.textContent || '').trim(),
        error: (side.querySelector('.translate-error')?.textContent || '').trim()
      }
    })()`)
    console.log(`    翻译栏 ${JSON.stringify(panel)}`)
    check('#翻译：右侧栏出现了', Boolean(panel), JSON.stringify(panel))
    check(
      '#翻译：AI 档是三栏（原文 / 翻译 / 解析）',
      Boolean(panel && panel.columns.length === 3 && panel.columns[1] === '翻译' && panel.columns[2] === '解析'),
      JSON.stringify(panel?.columns)
    )
    check('#翻译：译文来自接口', Boolean(panel?.translation?.includes('stub 译文')), String(panel?.translation))
    check('#翻译：解析栏有内容', Boolean(panel?.analysis?.includes('stub 给的解析')), String(panel?.analysis))
    check('#翻译：解析按 Markdown 渲染（列表与加粗不是原文符号）', (panel?.mdList ?? 0) >= 1 && (panel?.mdStrong ?? 0) >= 1, JSON.stringify({ list: panel?.mdList, strong: panel?.mdStrong }))
    check('#翻译：三层之间有可拖动的分隔条', (panel?.splits ?? 0) === 2, String(panel?.splits))

    /* 「最近」只在有两条以上历史时才出现，所以先再翻一段 */
    await cdp.evaluate(`(() => {
      const v = document.querySelector('foliate-view')
      const contents = v.renderer.getContents().filter((c) => c && c.doc && c.doc.body)
      for (const content of contents) {
        const doc = content.doc
        const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT)
        let node = walker.nextNode()
        /* 换一段：往后跳几个文本节点，保证历史里是两条不同的原文 */
        for (let i = 0; i < 4 && node; i += 1) node = walker.nextNode()
        while (node && (node.data || '').trim().length < 12) node = walker.nextNode()
        if (!node) continue
        const range = doc.createRange()
        range.setStart(node, 0)
        range.setEnd(node, Math.min(16, node.data.length))
        const sel = doc.getSelection()
        sel.removeAllRanges()
        sel.addRange(range)
        node.parentElement.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
        doc.dispatchEvent(new Event('selectionchange'))
        return true
      }
      return false
    })()`)
    await delay(900)
    await cdp.evaluate(`(() => {
      const b = [...document.querySelectorAll('.text-action-bar button')].find((x) => (x.textContent || '').trim() === '翻译')
      if (b) b.click()
      return Boolean(b)
    })()`)
    await delay(2500)
    const historyCount = await cdp.evaluate(`document.querySelectorAll('.translate-history-item').length`)
    console.log(`    历史条数 ${historyCount}`)

    /* 「最近」可以收起 */
    const historyToggle = await cdp.evaluate(`(() => {
      const head = document.querySelector('.translate-history-head')
      if (!head) return { missing: true }
      const before = document.querySelectorAll('.translate-history-item').length
      head.click()
      return { before }
    })()`)
    await delay(600)
    const historyAfter = await cdp.evaluate(`(() => ({
      head: Boolean(document.querySelector('.translate-history-head')),
      items: document.querySelectorAll('.translate-history-item').length
    }))()`)
    console.log(`    「最近」收起 ${JSON.stringify({ toggle: historyToggle, after: historyAfter })}`)
    check(
      '#翻译：「最近」可以收起（表头还在，列表收掉）',
      Boolean(historyToggle && !historyToggle.missing && historyAfter.head && historyAfter.items === 0),
      JSON.stringify({ toggle: historyToggle, after: historyAfter })
    )
    /* 再点一次展开回来 */
    await cdp.evaluate(`(() => { const h = document.querySelector('.translate-history-head'); if (h) h.click(); return true })()`)
    await delay(600)
    const historyBack = await cdp.evaluate(`document.querySelectorAll('.translate-history-item').length`)
    check('#翻译：「最近」能再展开', (historyBack ?? 0) > 0, String(historyBack))
    check('#翻译：翻译栏贴在最右边', Boolean(panel?.isLastChild && Math.abs(panel?.rightGap ?? 99) <= 2), JSON.stringify({ last: panel?.isLastChild, gap: panel?.rightGap }))

    const sent = { aiCalls, messages: lastAiBody?.messages?.length, model: lastAiBody?.model }
    console.log(`    发给 AI 的请求 ${JSON.stringify(sent)}`)
    check('#翻译：请求发到了配置的地址', aiCalls >= 1, JSON.stringify(sent))
    const userMessage = String(lastAiBody?.messages?.[1]?.content ?? '')
    check(
      '#翻译：请求里带着上下文（前后段）',
      userMessage.includes('【上下文】') && userMessage.includes('【待译文本】'),
      userMessage.slice(0, 160)
    )
    check(
      '#翻译：上下文不是空的',
      /【上下文】[\s\S]*?-\s/.test(userMessage),
      userMessage.slice(0, 200)
    )
    check(
      '#翻译：请求里带着提示词（要求只输出 JSON）',
      String(lastAiBody?.messages?.[0]?.content ?? '').includes('JSON'),
      String(lastAiBody?.messages?.[0]?.content ?? '').slice(0, 80)
    )
    await shot('110-translate-ai.png', 300)

    /* ---------------------------------------------- 切到机翻（同样指到 stub）→ 两层 */
    await cdp.evaluate(`window.bookscent.settings.patch({ translate: {
      enabled: true,
      activeId: 'mt_google',
      target: 'zh-CN',
      contextSize: 2,
      endpoints: [{
        id: 'mt_google', name: 'Google 翻译', kind: 'machine', provider: 'google',
        apiKey: 'stub-key', region: '', appSecret: '', pro: false,
        endpoint: ${JSON.stringify(`${base}/translate`)}, baseUrl: '', model: ''
      }],
      presets: [{ id: 'p_stub', name: '通用', prompt: '只输出 JSON' }],
      activePresetId: 'p_stub'
    } })`)
    await delay(1200)
    await cdp.evaluate(`location.reload()`)
    await delay(4500)
    await waitFor('document.querySelector(".app-shell")', '重载后外壳', 25000)
    await delay(1500)
    await cdp.evaluate(`(() => {
      const el = [...document.querySelectorAll('.book')].find((b) => b.getAttribute('data-book-id') === ${JSON.stringify(epub.id)})
      if (el) el.click()
      return Boolean(el)
    })()`)
    await delay(6500)
    for (let i = 0; i < 18; i += 1) {
      if ((await textLen()) > 200) break
      await cdp.evaluate('(() => { const v = document.querySelector("foliate-view"); if (v) v.next(); return true })()')
      await delay(1400)
    }
    await cdp.evaluate(`(() => {
      const v = document.querySelector('foliate-view')
      const contents = v.renderer.getContents().filter((c) => c && c.doc && c.doc.body)
      for (const content of contents) {
      const doc = content.doc
      const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT)
      let node = walker.nextNode()
      while (node && (node.data || '').trim().length < 12) node = walker.nextNode()
      if (!node) continue
      const range = doc.createRange()
      range.setStart(node, 0)
      range.setEnd(node, Math.min(16, node.data.length))
      const sel = doc.getSelection()
      sel.removeAllRanges()
      sel.addRange(range)
      node.parentElement.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
      doc.dispatchEvent(new Event('selectionchange'))
        return true
      }
      return false
    })()`)
    await delay(900)
    await cdp.evaluate(`(() => {
      const b = [...document.querySelectorAll('.text-action-bar button')].find((x) => (x.textContent || '').trim() === '翻译')
      if (b) b.click()
      return Boolean(b)
    })()`)
    await delay(2500)
    const machine = await cdp.evaluate(`(() => {
      const side = document.querySelector('.translate-side')
      if (!side) return null
      return {
        columns: [...side.querySelectorAll('.translate-layer-title')].map((el) => (el.textContent || '').trim()),
        splits: side.querySelectorAll('.translate-split').length,
        mdList: side.querySelectorAll('.translate-analysis ul li').length,
        mdStrong: side.querySelectorAll('.translate-analysis strong').length,
        /* 面板要贴着最右边：右边缘应与阅读区右边缘基本重合 */
        rightGap: Math.round(document.querySelector('.epub-body').getBoundingClientRect().right - side.getBoundingClientRect().right),
        isLastChild: side === side.parentElement.lastElementChild,
        translation: (side.querySelector('.translate-text')?.textContent || '').slice(0, 60),
        meta: (side.querySelector('.translate-meta')?.textContent || '').trim(),
        error: (side.querySelector('.translate-error')?.textContent || '').trim()
      }
    })()`)
    console.log(`    机翻栏 ${JSON.stringify(machine)}`)
    check(
      '#翻译：机翻档是两栏（原文 / 翻译）',
      Boolean(machine && machine.columns.length === 2 && machine.columns[1] === '翻译'),
      JSON.stringify(machine?.columns)
    )
    check('#翻译：机翻译文来自接口', Boolean(machine?.translation?.includes('stub 机翻')), String(machine?.translation))
    check(
      '#翻译：机翻也会带上下文（拼接后一起发）',
      Array.isArray(lastMachineBody?.q) && lastMachineBody.q.length > 1,
      JSON.stringify(lastMachineBody?.q?.length ?? null)
    )
    await shot('111-translate-machine.png', 300)
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
}
