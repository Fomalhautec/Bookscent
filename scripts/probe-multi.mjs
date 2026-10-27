/**
 * 0.10.1 探针（ONLY=multi）：多条接口配置 + 提示词预设。
 *
 * 三件事：
 *   1. **老设置迁移**：启动前先往 profile 里塞一份 0.10.0 形状的 settings.json
 *      （provider + google.apiKey + ai.prompt 那种），断言启动后被收成接口列表，
 *      而且**用户填过的密钥/区域/模型一个不丢**，改过的提示词收成一套自定义预设。
 *   2. **多条配置**：加两条 AI 接口（都指向本地 stub，返回不同的文案），
 *      切换当前使用的那条，断言请求确实发到了对应那条、面板上的引擎名跟着变。
 *   3. **提示词预设**：断言内置预设齐了，翻译栏里切换预设后，
 *      **请求里的 system 提示词换成了那一套**（这是预设唯一真正起作用的地方）。
 */
import { createServer } from 'node:http'

export async function runMulti(ctx) {
  const { cdp, check, delay, waitFor, mouse } = ctx

  /** stub：按 URL 里的标记返回不同文案，并记下每次请求体 */
  const bodies = []
  const server = createServer((req, res) => {
    const chunks = []
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8')
      let body = null
      try {
        body = JSON.parse(raw)
      } catch {
        body = { raw }
      }
      bodies.push({ url: req.url, body })
      res.setHeader('Content-Type', 'application/json')
      res.end(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  translation: `【${req.url.includes('second') ? '第二条' : '第一条'}】译文`,
                  analysis: '- **语法**：stub\n- **词汇**：stub'
                })
              }
            }
          ]
        })
      )
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
    /* 这个探针会先塞一份老设置进去，藏书目录可能是空的 —— 缺 EPUB 就导入夹具 */
    const hasEpub = await cdp.evaluate(
      'window.bookscent.library.index().then((i) => i.books.some((b) => b.format === "epub")).catch(() => false)'
    )
    const fixture = process.env.JP_EPUB ?? ''
    if (!hasEpub && fixture) {
      console.log(`    导入夹具 ${fixture}`)
      await cdp.evaluate(`window.bookscent.library.importPaths([${JSON.stringify(fixture)}], false)`)
      await delay(3000)
    }

    /* ---------------------------------------------- 1) 老设置迁移 */
    const migrated = await cdp.evaluate(`window.bookscent.settings.get().then((s) => {
      const t = s.translate
      const google = t.endpoints.find((e) => e.provider === 'google')
      const mine = t.endpoints.find((e) => e.provider === 'ai')
      return {
        endpoints: t.endpoints.length,
        kinds: [...new Set(t.endpoints.map((e) => e.kind))].sort(),
        enabled: t.enabled,
        activeId: t.activeId,
        target: t.target,
        contextSize: t.contextSize,
        googleKey: google ? google.apiKey : null,
        googleEndpoint: google ? google.endpoint : null,
        aiKey: mine ? mine.apiKey : null,
        aiModel: mine ? mine.model : null,
        presetNames: t.presets.map((p) => p.name),
        activePresetId: t.activePresetId
      }
    })`)
    console.log(`    迁移结果 ${JSON.stringify(migrated)}`)
    /*
     * 迁移那一组只在"启动前确实塞了旧设置"时才断言 ——
     * 平时跑（干净 profile）没有旧设置可迁，硬断言只会假失败。
     * 见运行脚本里写 settings.json 的那一步（LEGACY_TRANSLATE=1）。
     */
    const legacyExpected = process.env.LEGACY_TRANSLATE === '1'
    console.log(`    迁移断言 ${legacyExpected ? '开启（本run有旧设置）' : '跳过（干净 profile）'}`)
    check(
      legacyExpected ? '迁移：接口配置成了列表（默认六条）' : '迁移：默认也摆好六条接口',
      migrated?.endpoints === 6,
      JSON.stringify(migrated?.endpoints)
    )
    check(
      '迁移：两大类都在（ai / machine）',
      JSON.stringify(migrated?.kinds) === JSON.stringify(['ai', 'machine']),
      JSON.stringify(migrated?.kinds)
    )
    if (legacyExpected) check('迁移：老 provider=google → 当前使用那条机翻，且启用', migrated?.activeId === 'mt_google' && migrated?.enabled === true, JSON.stringify({ id: migrated?.activeId, enabled: migrated?.enabled }))
    if (legacyExpected) check('迁移：用户填过的密钥没丢', migrated?.googleKey === 'LEGACY-KEY', String(migrated?.googleKey))
    if (legacyExpected) check('迁移：自定义接口地址没丢', String(migrated?.googleEndpoint).includes('/legacy/'), String(migrated?.googleEndpoint))
    if (legacyExpected) check('迁移：AI 的密钥与模型没丢', migrated?.aiKey === 'LEGACY-AI-KEY' && migrated?.aiModel === 'legacy-model', JSON.stringify({ key: migrated?.aiKey, model: migrated?.aiModel }))
    if (legacyExpected) check('迁移：target / contextSize 保留', migrated?.target === 'en' && migrated?.contextSize === 3, JSON.stringify({ t: migrated?.target, c: migrated?.contextSize }))
    check(
      '迁移：内置预设齐了（5 套）',
      (migrated?.presetNames ?? []).length === 6 && (migrated?.presetNames ?? []).includes('轻小说 / 文学'),
      JSON.stringify(migrated?.presetNames)
    )
    if (legacyExpected)
      check(
        '迁移：改过的旧提示词收成「我的提示词」预设，不丢',
        (migrated?.presetNames ?? []).includes('我的提示词'),
        JSON.stringify(migrated?.presetNames)
      )

    /* ---------------------------------------------- 2) 两条 AI 接口 + 3) 预设切换 */
    const cfg = {
      enabled: true,
      activeId: 'ai_first',
      target: 'zh-CN',
      contextSize: 2,
      endpoints: [
        {
          id: 'ai_first',
          name: '主力模型',
          kind: 'ai',
          provider: 'ai',
          apiKey: 'k1',
          region: '',
          appSecret: '',
          pro: false,
          endpoint: '',
          baseUrl: `${base}/first/v1`,
          model: 'model-a'
        },
        {
          id: 'ai_second',
          name: '备用模型',
          kind: 'ai',
          provider: 'ai',
          apiKey: 'k2',
          region: '',
          appSecret: '',
          pro: false,
          endpoint: '',
          baseUrl: `${base}/second/v1`,
          model: 'model-b'
        },
        {
          id: 'mt_google',
          name: 'Google 翻译',
          kind: 'machine',
          provider: 'google',
          apiKey: 'legacy',
          region: '',
          appSecret: '',
          pro: false,
          endpoint: `${base}/legacy/translate`,
          baseUrl: '',
          model: ''
        }
      ],
      presets: [
        { id: 'preset_general', name: '通用', prompt: '通用提示词：只输出 JSON。', builtin: true },
        { id: 'preset_novel', name: '轻小说 / 文学', prompt: '轻小说提示词：口语、语气词自然。', builtin: true },
        { id: 'preset_tech', name: '科技 / 学术', prompt: '科技提示词：术语一致、限定关系准确。', builtin: true }
      ],
      activePresetId: 'preset_general'
    }
    for (let i = 0; i < 6; i += 1) {
      await cdp.evaluate(`window.bookscent.settings.patch({ translate: ${JSON.stringify(cfg)} })`)
      await delay(1200)
      const ok = await cdp.evaluate(
        `window.bookscent.settings.get().then((s) => s.translate.activeId === 'ai_first' && s.translate.enabled === true)`
      )
      if (ok) break
    }
    await cdp.evaluate(`location.reload()`)
    await delay(4500)
    await waitFor('document.querySelector(".app-shell")', '重载后外壳', 25000)
    await delay(1800)

    /* 打开一本 EPUB 并选中一段 */
    await cdp.evaluate(`(() => {
      const t = [...document.querySelectorAll('.nav-item')].find((el) => (el.textContent || '').includes('全部藏书'))
      if (t) t.click()
      return true
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

    const select = async (label) => {
      const ok = await cdp.evaluate(`(() => {
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
      return ok
    }

    await select('first')
    await delay(900)
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
        meta: (side.querySelector('.translate-meta')?.textContent || '').trim(),
        translation: (side.querySelector('.translate-text')?.textContent || '').trim(),
        presetOptions: [...side.querySelectorAll('.translate-preset-select option')].map((o) => o.textContent),
        presetValue: side.querySelector('.translate-preset-select')?.value ?? null
      }
    })()`)
    console.log(`    第一条接口 ${JSON.stringify(panel)}`)
    check('多配置：面板显示的是当前那条的名字', String(panel?.meta).startsWith('主力模型'), String(panel?.meta))
    check('多配置：译文来自第一条接口', String(panel?.translation).includes('第一条'), String(panel?.translation))
    check('多配置：请求发到了第一条的地址', bodies.some((b) => b.url.includes('/first/')), JSON.stringify(bodies.map((b) => b.url)))
    check(
      '多配置：请求用的是那条的模型',
      bodies.some((b) => b.url.includes('/first/') && b.body?.model === 'model-a'),
      JSON.stringify(bodies.map((b) => b.body?.model))
    )
    check(
      '预设：翻译栏里有预设下拉，且列出三套',
      (panel?.presetOptions ?? []).length === 3 && (panel?.presetOptions ?? []).includes('科技 / 学术'),
      JSON.stringify(panel?.presetOptions)
    )
    check(
      '预设：请求里带的是当前那套（通用）',
      bodies.some((b) => String(b.body?.messages?.[0]?.content ?? '').includes('通用提示词')),
      JSON.stringify(bodies.map((b) => String(b.body?.messages?.[0]?.content ?? '').slice(0, 20)))
    )

    /* 在面板里把预设切到「科技 / 学术」，再翻一次 —— 请求里的提示词必须跟着换 */
    await cdp.evaluate(`(() => {
      const sel = document.querySelector('.translate-preset-select')
      if (!sel) return false
      sel.value = 'preset_tech'
      sel.dispatchEvent(new Event('change', { bubbles: true }))
      return true
    })()`)
    await delay(1400)
    const presetSaved = await cdp.evaluate(
      `window.bookscent.settings.get().then((s) => s.translate.activePresetId)`
    )
    check('预设：面板里切换后写进了设置', presetSaved === 'preset_tech', String(presetSaved))

    await select('tech')
    await delay(900)
    await cdp.evaluate(`(() => {
      const b = [...document.querySelectorAll('.text-action-bar button')].find((x) => (x.textContent || '').trim() === '翻译')
      if (b) b.click()
      return Boolean(b)
    })()`)
    await delay(2500)
    const techBody = bodies[bodies.length - 1]
    check(
      '预设：换预设后请求里的系统提示词也换了（科技那套）',
      String(techBody?.body?.messages?.[0]?.content ?? '').includes('科技提示词'),
      String(techBody?.body?.messages?.[0]?.content ?? '').slice(0, 40)
    )

    /* 切到第二条接口：引擎名与请求地址都要跟着变 */
    await cdp.evaluate(`(async () => {
      const s = await window.bookscent.settings.get()
      await window.bookscent.settings.patch({ translate: { ...s.translate, activeId: 'ai_second' } })
    })()`)
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
    await select('second')
    await delay(900)
    await cdp.evaluate(`(() => {
      const b = [...document.querySelectorAll('.text-action-bar button')].find((x) => (x.textContent || '').trim() === '翻译')
      if (b) b.click()
      return Boolean(b)
    })()`)
    await delay(2500)
    const secondPanel = await cdp.evaluate(`(() => {
      const side = document.querySelector('.translate-side')
      return side
        ? {
            meta: (side.querySelector('.translate-meta')?.textContent || '').trim(),
            translation: (side.querySelector('.translate-text')?.textContent || '').trim()
          }
        : null
    })()`)
    console.log(`    第二条接口 ${JSON.stringify(secondPanel)}`)
    check('多配置：切换后引擎名变成第二条', String(secondPanel?.meta).startsWith('备用模型'), String(secondPanel?.meta))
    check('多配置：译文来自第二条接口', String(secondPanel?.translation).includes('第二条'), String(secondPanel?.translation))
    check(
      '多配置：请求发到了第二条的地址与模型',
      bodies.some((b) => b.url.includes('/second/') && b.body?.model === 'model-b'),
      JSON.stringify(bodies.filter((b) => b.url.includes('/second/')).map((b) => b.body?.model))
    )
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
}
