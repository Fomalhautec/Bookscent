/**
 * 0.10.1 探针（ONLY=keys）：快捷键独立成页 + 可改键 + 适用范围标注。
 *
 * 关键断言不是"设置存进去了"（那太容易过），而是**改键之后真的按新键生效、旧键失效** ——
 * 所以这里在 EPUB 里改「下一屏」的键，然后分别按旧键与新键，看页码/位置有没有动。
 */
export async function runKeys(ctx) {
  const { cdp, check, delay, waitFor, shot, mouse } = ctx

  await waitFor('document.querySelector(".app-shell")', '应用外壳', 30000)
  for (let i = 0; i < 20; i += 1) {
    const books = await cdp.evaluate(
      'window.bookscent.library.index().then((i) => i.books.length).catch(() => 0)'
    )
    if (books > 0) break
    await delay(1000)
  }
  const hasEpub = await cdp.evaluate(
    'window.bookscent.library.index().then((i) => i.books.some((b) => b.format === "epub")).catch(() => false)'
  )
  const fixture = process.env.JP_EPUB ?? ''
  if (!hasEpub && fixture) {
    await cdp.evaluate(`window.bookscent.library.importPaths([${JSON.stringify(fixture)}], false)`)
    await delay(3000)
  }

  /* ---------------------------------------------- 设置页：有这一页、分清范围 */
  await cdp.evaluate(`(() => {
    const b = [...document.querySelectorAll('button, [role=button]')]
      .find((el) => (el.getAttribute('title') || '').includes('设置') || (el.textContent || '').trim() === '设置')
    if (b) b.click()
    return Boolean(b)
  })()`)
  await delay(1800)
  const tabs = await cdp.evaluate(`(() => [...document.querySelectorAll('button, [role=tab], .settings-tab, .set-tab-btn')]
    .map((b) => (b.textContent || '').trim())
    .filter((text) => text.length > 0 && text.length < 10))()`)
  check('设置页里有「快捷键」分页', (tabs ?? []).includes('快捷键'), JSON.stringify(tabs))

  await cdp.evaluate(`(() => {
    const el = [...document.querySelectorAll('button, [role=tab], .settings-tab, .set-tab-btn')]
      .find((b) => (b.textContent || '').trim() === '快捷键')
    if (el) el.click()
    return Boolean(el)
  })()`)
  await delay(1200)

  const page = await cdp.evaluate(`(() => {
    const pane = document.querySelector('.set-tab')
    if (!pane) return null
    const text = pane.textContent || ''
    const scopes = [...pane.querySelectorAll('.set-block-title, h3, .set-block > *')].map((el) => (el.textContent || '').trim()).slice(0, 8)
    return {
      /* 整页文本都要留着：适用范围是四段标题，截断了就找不到后两个 */
      text,
      rows: pane.querySelectorAll('.keys-row').length,
      fixed: pane.querySelectorAll('.keys-fixed').length,
      captures: pane.querySelectorAll('.keys-capture').length,
      scopes
    }
  })()`)
  console.log(`    快捷键页：${JSON.stringify({ rows: page?.rows, fixed: page?.fixed, captures: page?.captures })}`)
  check('快捷键页列出了所有项', (page?.rows ?? 0) >= 20, String(page?.rows))
  check('快捷键页把固定项单独标出来（不可改）', (page?.fixed ?? 0) >= 3, String(page?.fixed))
  check('快捷键页每项都有改键按钮', (page?.captures ?? 0) >= 18, String(page?.captures))
  for (const label of ['全局', 'EPUB 阅读器', 'PDF 阅读器', 'Markdown / 纯文本编辑器']) {
    check(`快捷键页标出了适用范围「${label}」`, page?.text.includes(label) === true, '')
  }
  await shot('140-shortcuts.png', 200)

  /* ---------------------------------------------- 改键：EPUB「下一屏」→ Ctrl+Alt+N */
  const before = await cdp.evaluate(`window.bookscent.settings.get().then((s) => s.ui.shortcuts || {})`)
  check('默认没有改过任何键', Object.keys(before ?? {}).length === 0, JSON.stringify(before))

  const changed = await cdp.evaluate(`(async () => {
    const s = await window.bookscent.settings.get()
    await window.bookscent.settings.patch({ ui: { ...s.ui, shortcuts: { 'epub.nextScreen': ['Ctrl+Alt+N'] } } })
    const after = await window.bookscent.settings.get()
    return after.ui.shortcuts
  })()`)
  console.log(`    改键结果 ${JSON.stringify(changed)}`)
  check(
    '改键：新组合写进了设置',
    Array.isArray(changed?.['epub.nextScreen']) && changed['epub.nextScreen'][0] === 'Ctrl+Alt+N',
    JSON.stringify(changed)
  )

  /* 用设置页的"改键按钮"也走一遍：点开录制、按组合键 */
  await cdp.evaluate(`location.reload()`)
  await delay(4500)
  await waitFor('document.querySelector(".app-shell")', '重载后外壳', 25000)
  await delay(1800)
  await cdp.evaluate(`(() => {
    const b = [...document.querySelectorAll('button, [role=button]')]
      .find((el) => (el.getAttribute('title') || '').includes('设置') || (el.textContent || '').trim() === '设置')
    if (b) b.click()
    return Boolean(b)
  })()`)
  await delay(1500)
  await cdp.evaluate(`(() => {
    const el = [...document.querySelectorAll('button, [role=tab], .settings-tab, .set-tab-btn')]
      .find((b) => (b.textContent || '').trim() === '快捷键')
    if (el) el.click()
    return Boolean(el)
  })()`)
  await delay(1200)
  const shownAfterReload = await cdp.evaluate(`(() => {
    const btn = [...document.querySelectorAll('.keys-capture')].find((b) => (b.textContent || '').includes('Ctrl+Alt+N'))
    return Boolean(btn)
  })()`)
  check('改键：重载后设置页显示的是新键（说明存住了）', shownAfterReload === true, '')
  const resetVisible = await cdp.evaluate(`document.querySelectorAll('.keys-reset').length`)
  check('改键：改过的项多出「恢复默认」按钮', (resetVisible ?? 0) >= 1, String(resetVisible))

  /* 在设置页里录一次键：点开录制 → 按 Ctrl+Alt+M */
  /* 改键现在走弹窗：打开 → 直接按组合键 → 确定 */
  await cdp.evaluate(`(() => {
    const btn = [...document.querySelectorAll('.keys-capture')].find((b) => (b.textContent || '').includes('Ctrl+Alt+N'))
    if (btn) btn.click()
    return Boolean(btn)
  })()`)
  await delay(800)
  await cdp.evaluate(`(() => {
    const input = document.querySelector('.keys-capture-input')
    if (!input) return false
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'm', ctrlKey: true, altKey: true, bubbles: true, cancelable: true }))
    return true
  })()`)
  await delay(500)
  await cdp.evaluate(`(() => {
    const btn = [...document.querySelectorAll('.modal button')].find((el) => (el.textContent || '').trim() === '确定')
    if (btn) btn.click()
    return Boolean(btn)
  })()`)
  await delay(900)
  const recorded = await cdp.evaluate(`window.bookscent.settings.get().then((s) => s.ui.shortcuts)`)
  console.log(`    录制结果 ${JSON.stringify(recorded)}`)
  check(
    '改键：在设置页里按下组合键就能录进去',
    Array.isArray(recorded?.['epub.nextScreen']) && recorded['epub.nextScreen'][0] === 'Ctrl+Alt+M',
    JSON.stringify(recorded)
  )

  /* ---------------------------------------------- 真正生效：旧键失效、新键生效 */
  /* 从设置页回书架要走顶栏那颗（设置页没有左侧栏） */
  await cdp.evaluate(`(() => {
    const all = [...document.querySelectorAll('button, [role=button]')]
    const back =
      all.find((el) => (el.textContent || '').trim() === '书架') ||
      all.find((el) => (el.getAttribute('title') || '').includes('书架')) ||
      [...document.querySelectorAll('.nav-item')].find((el) => (el.textContent || '').includes('全部藏书'))
    if (back) back.click()
    return Boolean(back)
  })()`)
  await delay(1600)
  for (let i = 0; i < 10; i += 1) {
    if (await cdp.evaluate('Boolean(document.querySelector(".shelf-view"))')) break
    await delay(600)
  }
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

  /*
   * 翻页判据用「节索引 + 文本长度」而不是正文片段：
   * 有些节本身就是空的（只有图），只比文本会误判成"没动"。
   */
  const position = () =>
    cdp.evaluate(`(() => {
      const v = document.querySelector('foliate-view')
      if (!v || !v.renderer || !v.renderer.getContents) return null
      const contents = v.renderer.getContents()
      const sections = contents.map((c) => (c ? c.index : '?')).join(',')
      let text = 0
      for (const c of contents) if (c && c.doc && c.doc.body) text += (c.doc.body.innerText || '').length
      return sections + '|' + text
    })()`)

  /* 等正文渲染出来再开始测 */
  for (let i = 0; i < 20; i += 1) {
    const sig = await position()
    if (sig && !String(sig).endsWith('|0')) break
    await delay(800)
  }
  console.log(`    起始位置 ${JSON.stringify(await position())}`)
  const readerState = await cdp.evaluate(`(() => ({
    view: Boolean(document.querySelector('foliate-view')),
    epubView: Boolean(document.querySelector('.epub-view')),
    status: (document.querySelector('.epub-statusbar, .epub-status')?.textContent || '').slice(0, 60),
    loading: Boolean(document.querySelector('.epub-loading')),
    sections: (() => {
      const v = document.querySelector('foliate-view')
      try {
        return v && v.book ? v.book.sections.length : null
      } catch {
        return 'err'
      }
    })()
  }))()`)
  console.log(`    阅读器状态 ${JSON.stringify(readerState)}`)
  check('阅读器确实打开了', readerState?.epubView === true, JSON.stringify(readerState))

  /*
   * 用「翻译栏开关」来验改键是否真的生效 —— 比翻页可靠得多：
   * 面板在不在 DOM 里是一眼可判的事实，不受书的排版、当前节是否为空的影响。
   */
  const panelOpen = () => cdp.evaluate(`Boolean(document.querySelector('.translate-side'))`)
  /*
   * 按键前先让输入框失焦：应用刻意做到"焦点在输入框里时不抢不带修饰键的按键"
   * （否则在搜索框里打 t 就会开翻译栏），重载之后焦点可能正好落在某个输入框上。
   */
  const press = (key, extra = {}) =>
    cdp.evaluate(
      `(() => {
        const el = document.activeElement
        if (el && el.blur) el.blur()
        window.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(key)}, bubbles: true, cancelable: true, ${Object.entries(
          extra
        )
          .map(([k, v]) => `${k}: ${v}`)
          .join(', ')} }))
        return true
      })()`
    )

  /** 重载 + 进书架 + 打开那本 EPUB：每段测试都从这里开始，状态才干净 */
  const enterReader = async () => {
    await cdp.evaluate(`location.reload()`)
    await delay(4500)
    await waitFor('document.querySelector(".app-shell")', '重载后外壳', 25000)
    await delay(1600)
    await cdp.evaluate(`(() => {
      const el = [...document.querySelectorAll('.book')].find((b) => b.getAttribute('data-book-id') === ${JSON.stringify(epub.id)})
      if (el) el.click()
      return Boolean(el)
    })()`)
    await delay(6000)
  }

  await enterReader()
  check('生效：一开始翻译栏是关着的', (await panelOpen()) === false, '')

  /* 1) 默认键：T 开、再按 T 关 */
  await press('t')
  await delay(1200)
  check('生效：默认键 T 能展开翻译栏', (await panelOpen()) === true, '')
  await press('t')
  await delay(1200)
  check('生效：再按一次 T 能收起', (await panelOpen()) === false, '')

  /* 2) 把 epub.translate 改成 Ctrl+Alt+P，重载后旧键必须失效、新键生效 */
  await cdp.evaluate(`(async () => {
    const s = await window.bookscent.settings.get()
    await window.bookscent.settings.patch({ ui: { ...s.ui, shortcuts: { ...s.ui.shortcuts, 'epub.translate': ['Ctrl+Alt+P'] } } })
  })()`)
  await delay(1000)
  await enterReader()
  await press('t')
  await delay(1200)
  check('生效：改键之后旧键 T 不再展开翻译栏', (await panelOpen()) === false, '旧键居然还生效')
  await press('p', { ctrlKey: true, altKey: true })
  await delay(1400)
  check('生效：新键 Ctrl+Alt+P 能展开翻译栏', (await panelOpen()) === true, '按新键没反应')

  /* 3) 清空 = 禁用 */
  await cdp.evaluate(`(async () => {
    const s = await window.bookscent.settings.get()
    await window.bookscent.settings.patch({ ui: { ...s.ui, shortcuts: { 'epub.translate': [] } } })
  })()`)
  await delay(1000)
  await enterReader()
  await press('p', { ctrlKey: true, altKey: true })
  await delay(1200)
  check('清空：键清掉之后按它不再有反应', (await panelOpen()) === false, '清空了还在响应')
  await press('t')
  await delay(1200)
  check('清空：默认键也不该恢复（它是被主动禁用的）', (await panelOpen()) === false, '')

  /* 4) 全部恢复默认：T 又能用 */
  /* 全部恢复默认走设置页的「恢复本页默认」那条路（删路径再迁移），直接 patch 空对象会被深合并吃掉 */
  await cdp.evaluate(`window.bookscent.settings.resetPaths(['ui.shortcuts'])`)
  await delay(1000)
  const cleared = await cdp.evaluate(`window.bookscent.settings.get().then((s) => s.ui.shortcuts || {})`)
  check('恢复默认：改键记录被真正清掉了', Object.keys(cleared ?? {}).length === 0, JSON.stringify(cleared))
  await enterReader()
  await press('t')
  await delay(1200)
  check('恢复默认：T 又能用了', (await panelOpen()) === true, '恢复默认后还是没反应')
  await shot('141-shortcuts-after.png', 150)

  /* ===================== 焦点进正文 iframe 之后，快捷键还要有效 ===================== */
  /*
   * 用户报的现象：点一下正文（或选一段字），翻页/翻译等所有快捷键立刻失效。
   * 原因是正文在 iframe 里 —— 焦点一进 iframe，挂在外层 window 上的监听就收不到按键。
   * 这里用真实鼠标点正文，再用 CDP 真的按键（事件会送到焦点所在的文档，正是出问题的场景）。
   */
  await enterReader()
  /* 翻到有正文的一节（否则连个可点的文本节点都没有，坐标会是 null） */
  for (let i = 0; i < 16; i += 1) {
    const len = await cdp.evaluate(`(() => {
      const v = document.querySelector('foliate-view')
      if (!v || !v.renderer || !v.renderer.getContents) return 0
      return v.renderer.getContents().reduce(
        (sum, c) => sum + (c && c.doc && c.doc.body ? (c.doc.body.innerText || '').trim().length : 0),
        0
      )
    })()`)
    if (len > 80) break
    await cdp.evaluate('(() => { const v = document.querySelector("foliate-view"); if (v) v.next(); return true })()')
    await delay(1400)
  }
  const spot = await cdp.evaluate(`(() => {
    const v = document.querySelector('foliate-view')
    if (!v || !v.renderer) return null
    const contents = v.renderer.getContents().filter((c) => c && c.doc && c.doc.body)
    for (const content of contents) {
      const doc = content.doc
      /* 正文不一定在 <p> 里：按文本节点找，再用它的父元素取坐标 */
      const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT)
      let node = walker.nextNode()
      while (node && (node.data || '').trim().length < 8) node = walker.nextNode()
      if (!node || !node.parentElement) continue
      const box = node.parentElement.getBoundingClientRect()
      const frame = doc.defaultView && doc.defaultView.frameElement
        ? doc.defaultView.frameElement.getBoundingClientRect()
        : { left: 0, top: 0 }
      if (box.width < 30 || box.height < 8) continue
      /*
       * x 取**舞台中心**：正文盒往往是一整页那么宽，从盒左边缘量容易落到翻页热区上
       * （点下去会翻页，焦点落在按钮上而不是正文里）。
       */
      const stage = document.querySelector('.epub-stage')
      const stageBox = stage ? stage.getBoundingClientRect() : null
      const centerX = stageBox ? stageBox.left + stageBox.width / 2 : frame.left + box.left + box.width / 2
      return {
        x: Math.round(centerX),
        y: Math.round(frame.top + box.top + box.height / 2)
      }
    }
    return null
  })()`)
  console.log(`    正文坐标 ${JSON.stringify(spot)}`)
  if (spot) {
    await mouse('mouseMoved', spot.x, spot.y)
    await mouse('mousePressed', spot.x, spot.y)
    await delay(80)
    await mouse('mouseReleased', spot.x, spot.y)
    await delay(900)
  }
  const activeTag = await cdp.evaluate(`document.activeElement ? document.activeElement.tagName : ''`)
  console.log(`    点正文后的焦点 ${activeTag}`)
  /*
   * 焦点要么是 iframe 本身、要么是它的宿主 <foliate-view>（Chromium 报的是后者）。
   * 只要不再是顶层 BODY，就说明按键事件已经送到正文那一侧了 —— 这正是以前全失效的场景。
   */
  check(
    '点正文后焦点不再在顶层（进了正文那一侧，这就是快捷键失效的场景）',
    activeTag === 'IFRAME' || activeTag === 'FOLIATE-VIEW',
    activeTag
  )

  const pressKey = async (key, code, vk) => {
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: vk })
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: vk })
  }
  const beforeT = await panelOpen()
  await pressKey('t', 'KeyT', 84)
  await delay(1500)
  const afterT = await panelOpen()
  check('焦点在正文 iframe 里时 T 仍然有效（翻译栏开关）', beforeT !== afterT, `${beforeT} → ${afterT}`)

  const positionSig = () =>
    cdp.evaluate(`(() => {
      const v = document.querySelector('foliate-view')
      if (!v || !v.renderer || !v.renderer.getContents) return null
      const contents = v.renderer.getContents()
      return contents.map((c) => (c ? c.index : '?')).join(',') + '|' +
        contents.reduce((sum, c) => sum + (c && c.doc && c.doc.body ? (c.doc.body.innerText || '').length : 0), 0)
    })()`)
  const sigBefore = await positionSig()
  await pressKey('PageDown', 'PageDown', 34)
  await delay(1800)
  const sigAfter = await positionSig()
  console.log(`    iframe 里按 PageDown：${JSON.stringify(sigBefore)} → ${JSON.stringify(sigAfter)}`)
  check('焦点在正文 iframe 里时翻页键也有效', sigBefore !== sigAfter, `${sigBefore} → ${sigAfter}`)
  await shot('152-iframe-keys.png', 150)

  /* ===================== 朗读（TTS） ===================== */
  /*
   * 朗读栏现在是**一行**：没有"正在读的文字"（正文逐句高亮）、没有备注行；
   * 引擎是下拉菜单。断言按这个新结构来。
   */
  const ttsToolbar = await cdp.evaluate(`(() => {
    const bar = document.querySelector('.epub-bar')
    return bar ? [...bar.querySelectorAll('button')].map((b) => (b.textContent || '').trim()) : null
  })()`)
  check('阅读器工具栏上有「朗读」', (ttsToolbar ?? []).some((text) => text.includes('朗读')), JSON.stringify(ttsToolbar))

  await cdp.evaluate(`(() => {
    const bar = document.querySelector('.epub-bar')
    const btn = bar ? [...bar.querySelectorAll('button')].find((b) => (b.textContent || '').trim().includes('朗读')) : null
    if (btn) btn.click()
    return Boolean(btn)
  })()`)
  await delay(2500)

  const bar = await cdp.evaluate(`(() => {
    const el = document.querySelector('.tts-bar')
    if (!el) return null
    const rect = el.getBoundingClientRect()
    const body = document.querySelector('.epub-body')
    const bodyRect = body ? body.getBoundingClientRect() : null
    const selects = [...el.querySelectorAll('.tts-select')]
    return {
      rows: rect.height,
      ratio: bodyRect ? Number((rect.width / Math.max(1, bodyRect.width)).toFixed(2)) : 0,
      engineTag: selects[0] ? selects[0].tagName : '',
      engineOptions: selects[0] ? [...selects[0].querySelectorAll('option')].map((o) => (o.textContent || '').trim()) : [],
      engineValue: selects[0] ? selects[0].value : '',
      rangeCount: el.querySelectorAll('.tts-range').length,
      hasSegmentText: Boolean(el.querySelector('.tts-segment')),
      hasHint: Boolean(el.querySelector('.tts-hint')),
      continuous: Boolean(el.querySelector('.tts-continuous input')),
      progress: (el.querySelector('.tts-progress')?.textContent || '').trim(),
      buttons: [...el.querySelectorAll('button')].length
    }
  })()`)
  console.log(`    朗读栏 ${JSON.stringify(bar)}`)
  check('点「朗读」后底部出现朗读栏', Boolean(bar), '没有朗读栏')
  check('朗读栏是横向底栏且只有一行（高度很低）', Boolean(bar && bar.ratio >= 0.9 && bar.rows <= 76), JSON.stringify(bar))
  check('引擎是下拉菜单（不是一排按钮）', bar?.engineTag === 'SELECT', String(bar?.engineTag))
  check(
    '引擎下拉里有系统语音 / Edge / 有道 / 腾讯云',
    (bar?.engineOptions ?? []).length >= 4 && JSON.stringify(bar?.engineOptions).includes('腾讯云'),
    JSON.stringify(bar?.engineOptions)
  )
  check('默认引擎是系统语音（离线可用）', String(bar?.engineValue) === 'system', String(bar?.engineValue))
  check('语速与音调两个滑块都在', (bar?.rangeCount ?? 0) === 2, String(bar?.rangeCount))
  check('有「连读」开关', bar?.continuous === true, '')
  check('有进度显示（第几句 / 共几句）', /^\d+\/\d+$/.test(String(bar?.progress ?? '')), String(bar?.progress))
  check('不再显示"正在朗读的文字"行（改由正文高亮）', bar?.hasSegmentText === false, String(bar?.hasSegmentText))
  check('不再显示备注行', bar?.hasHint === false, String(bar?.hasHint))

  const sysVoices = await cdp.evaluate(`(() => {
    const synth = window.speechSynthesis
    return synth ? synth.getVoices().map((v) => ({ name: v.name, lang: v.lang })) : []
  })()`)
  console.log(`    系统语音共 ${(sysVoices ?? []).length} 个`)
  check('这个环境里能看到系统语音', (sysVoices ?? []).length > 0, String((sysVoices ?? []).length))
  const synthReady = await cdp.evaluate(`(() => ({
    supported: typeof window.speechSynthesis !== 'undefined' && typeof SpeechSynthesisUtterance !== 'undefined',
    voices: window.speechSynthesis ? window.speechSynthesis.getVoices().length : 0
  }))()`)
  check('环境支持系统语音（speechSynthesis 与 Utterance 都在）', synthReady?.supported === true, JSON.stringify(synthReady))

  /* 切到在线引擎：语言列表应能拉到几十种 */
  await cdp.evaluate(`(() => {
    const select = document.querySelector('.tts-bar .tts-select')
    if (!select) return false
    select.value = 'edge'
    select.dispatchEvent(new Event('change', { bubbles: true }))
    return true
  })()`)
  await delay(4000)
  const online = await cdp.evaluate(`(() => {
    const selects = [...document.querySelectorAll('.tts-bar .tts-select')]
    return {
      engineValue: selects[0] ? selects[0].value : '',
      languages: selects[1] ? selects[1].querySelectorAll('option').length : 0,
      voices: selects[2] ? selects[2].querySelectorAll('option').length : 0
    }
  })()`)
  console.log(`    在线引擎 ${JSON.stringify(online)}`)
  check('切成在线后语言列表有几十种', (online?.languages ?? 0) >= 20, String(online?.languages))
  check('切成在线后语音可选', (online?.voices ?? 0) >= 1, String(online?.voices))

  /* 逐句高亮：章节文档里应该有 ::highlight 样式 + CSS.highlights 支持 */
  const highlight = await cdp.evaluate(`(() => {
    const view = document.querySelector('foliate-view')
    if (!view || !view.renderer || !view.renderer.getContents) return null
    const contents = view.renderer.getContents().filter((c) => c && c.doc)
    const doc = contents[0] ? contents[0].doc : null
    if (!doc) return null
    const style = doc.getElementById('bookscent-tts-style')
    const viewWindow = doc.defaultView
    return {
      styleInjected: Boolean(style),
      styleText: style ? (style.textContent || '').includes('::highlight') : false,
      apiSupported: Boolean(viewWindow && viewWindow.CSS && viewWindow.CSS.highlights)
    }
  })()`)
  console.log(`    逐句高亮 ${JSON.stringify(highlight)}`)
  check('章节文档注入了 ::highlight 样式', highlight?.styleText === true, JSON.stringify(highlight))
  check('章节文档支持 CSS.highlights', highlight?.apiSupported === true, JSON.stringify(highlight))

  /* 朗读栏控件是否套了主题样式（下拉：有边框、非原生外观；滑条：主题色） */
  const ttsTheme = await cdp.evaluate(`(() => {
    const select = document.querySelector('.tts-bar .select')
    const range = document.querySelector('.tts-bar .tts-range')
    if (!select || !range) return null
    const s = getComputedStyle(select)
    const r = getComputedStyle(range)
    return {
      selectH: Math.round(select.getBoundingClientRect().height),
      borderStyle: s.borderStyle,
      appearance: s.appearance,
      radius: s.borderRadius,
      rangeAppearance: r.appearance,
      rangeW: Math.round(range.getBoundingClientRect().width)
    }
  })()`)
  console.log(`    朗读栏样式 ${JSON.stringify(ttsTheme)}`)
  check(
    '朗读栏下拉套了主题样式（有边框、不是原生外观）',
    Boolean(ttsTheme && ttsTheme.borderStyle !== 'none' && ttsTheme.appearance === 'none'),
    JSON.stringify(ttsTheme)
  )
  check(
    '朗读栏滑条去掉原生外观、窄条形式',
    Boolean(ttsTheme && ttsTheme.rangeAppearance === 'none' && (ttsTheme.rangeW ?? 0) <= 90),
    JSON.stringify(ttsTheme)
  )

  /* 选中文字的工具条里应该有「朗读」，点了从这句开始 */
  const speakButton = await cdp.evaluate(`(() => {
    const btn = [...document.querySelectorAll('.text-action-btn')].find((b) => (b.textContent || '').trim() === '朗读')
    return { exists: Boolean(btn), all: [...document.querySelectorAll('.text-action-btn')].map((b) => (b.textContent || '').trim()) }
  })()`)
  console.log(`    选中工具条 ${JSON.stringify(speakButton)}`)

  /* 收起 */
  await cdp.evaluate(`(() => {
    const el = document.querySelector('.tts-bar')
    const buttons = el ? [...el.querySelectorAll('button')] : []
    const close = buttons[buttons.length - 1]
    if (close) close.click()
    if (window.speechSynthesis) window.speechSynthesis.cancel()
    return true
  })()`)
  await delay(800)
  check('能收起朗读栏', (await cdp.evaluate('Boolean(document.querySelector(".tts-bar"))')) === false, '')
}
