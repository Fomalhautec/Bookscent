/**
 * 0.9.8 修 bug 批的探针（ONLY=fix98）。
 *
 * 单独一个模块：以前把这些塞进 verify-app.mjs 的字符串数组里拼，
 * 一行漏个逗号就整个探针文件语法错误（已经栽过两次）。这里就是普通 JS，helper 由调用方传进来。
 *
 * 两个必须记住的点：
 *  - EPUB 的正文在 foliate 的 iframe 里，**标注只能在章节文档里找**（PDF 的覆盖层才在主文档）；
 *  - 跟正文有关的测量（缩进、字号）要先走到有文字的章节，封面页往往没有 <p>。
 */
export async function runFix98(ctx) {
  const { cdp, check, delay, waitFor, shot } = ctx

  /** 在已加载的章节文档里跑一段代码，把所有章节的结果并起来 */
  const inSections = (body) =>
    cdp.evaluate(`(() => {
      const v = document.querySelector('foliate-view')
      const contents = (v && v.renderer && v.renderer.getContents ? v.renderer.getContents() : [])
        .filter((c) => c && c.doc && c.doc.body)
      const out = []
      for (const content of contents) {
        const doc = content.doc
        ${body}
      }
      return out
    })()`)

  /** 第一个已加载章节的文档里跑一段代码（返回单值） */
  const inFirstSection = (body) =>
    cdp.evaluate(`(() => {
      const v = document.querySelector('foliate-view')
      const contents = (v && v.renderer && v.renderer.getContents ? v.renderer.getContents() : [])
        .filter((c) => c && c.doc && c.doc.body)
      const content = contents[0]
      if (!content) return null
      const doc = content.doc
      ${body}
    })()`)

  const textLen = () =>
    cdp.evaluate(`(() => {
      const v = document.querySelector('foliate-view')
      const contents = v && v.renderer && v.renderer.getContents ? v.renderer.getContents() : []
      let n = 0
      for (const c of contents) if (c && c.doc && c.doc.body) n += (c.doc.body.innerText || '').replace(/\\s/g, '').length
      return n
    })()`)

  const gotoText = async () => {
    for (let i = 0; i < 18; i += 1) {
      if ((await textLen()) > 200) return true
      await cdp.evaluate('(() => { const v = document.querySelector("foliate-view"); if (v) v.next(); return true })()')
      await delay(1400)
    }
    return (await textLen()) > 200
  }

  await waitFor('document.querySelector(".app-shell")', '应用外壳', 30000)
  let books = 0
  for (let i = 0; i < 20; i += 1) {
    books = await cdp.evaluate('window.bookscent.library.index().then((i) => i.books.length).catch(() => 0)')
    if (books > 0) break
    await delay(1000)
  }
  console.log(`    书架上有 ${books} 本`)

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

  /* ---------------------------------------------- #1 回收站 → 侧栏回书架 */
  const navLabels = await cdp.evaluate(
    `(() => [...document.querySelectorAll('.nav-item')].map((el) => (el.textContent || '').trim()))()`
  )
  console.log(`    侧栏项 ${JSON.stringify(navLabels)}`)
  await cdp.evaluate(`(() => {
    const t = [...document.querySelectorAll('.nav-item')].find((el) => (el.textContent || '').includes('回收站'))
    if (t) t.click()
    return Boolean(t)
  })()`)
  await delay(1300)
  check('#1：进得了回收站', (await cdp.evaluate('Boolean(document.querySelector(".trash-view"))')) === true, '')

  const clickedAll = await cdp.evaluate(`(() => {
    const all = [...document.querySelectorAll('.nav-item')].find((el) => (el.textContent || '').includes('全部藏书'))
    if (all) all.click()
    return Boolean(all)
  })()`)
  await delay(1500)
  const back = await cdp.evaluate(`(() => ({
    trash: Boolean(document.querySelector('.trash-view')),
    shelf: Boolean(document.querySelector('.shelf-view')),
    books: document.querySelectorAll('.book[data-book-id]').length
  }))()`)
  console.log(`    #1 回书架 ${JSON.stringify(back)} (clicked=${clickedAll})`)
  check('#1：从回收站点侧栏能回到书架', back.trash === false && back.shelf === true, JSON.stringify(back))

  /* ---------------------------------------------- #3 统计页「最近心得」
   * 放到最后测：统计页没有侧栏，测完不好回书架；等阅读部分做完再切过去。
   */
  const checkStats = async () => {
    const clickedStats = await cdp.evaluate(`(() => {
      const all = [...document.querySelectorAll('button, [role=button]')]
      const t =
        all.find((el) => (el.getAttribute('title') || '').includes('统计')) ||
        all.find((el) => (el.textContent || '').trim() === '统计')
      if (t) t.click()
      return Boolean(t)
    })()`)
    let stats = { hasInsight: false, count: null, sectionCount: 0 }
    for (let i = 0; i < 15; i += 1) {
      await delay(1000)
      stats = await cdp.evaluate(`(() => {
        const sections = [...document.querySelectorAll('.stats-section')]
        const section = sections.find((s) => (s.textContent || '').includes('最近心得'))
        return {
          hasInsight: Boolean(section),
          count: section ? (section.querySelector('.stats-title-count')?.textContent || '').trim() : null,
          sectionCount: sections.length
        }
      })()`)
      if (stats.sectionCount > 0) break
    }
    console.log(`    #3 统计 ${JSON.stringify(stats)} (clicked=${clickedStats})`)
    check('#3：统计页有「最近心得」一段', stats.hasInsight === true, JSON.stringify(stats))
    check('#3：心得带条数', stats.count !== null && stats.count !== '', String(stats.count))
  }

  /* 先回书架（统计数据要等下面标注做完才有意义，所以这里先跳过） */

  /* ---------------------------------------------- 打开一本 EPUB 并走到正文 */
  const epub = await cdp.evaluate(`window.bookscent.library.index().then((i) => {
    const b = i.books.find((x) => x.format === 'epub')
    return b ? { id: b.id, title: b.title, tags: b.tags } : null
  })`)
  check('书架上有一本 EPUB', Boolean(epub), JSON.stringify(epub))
  if (!epub) return
  await cdp.evaluate(`(() => {
    const el = [...document.querySelectorAll('.book')].find((b) => b.getAttribute('data-book-id') === ${JSON.stringify(epub.id)})
    if (el) el.click()
    return Boolean(el)
  })()`)
  await delay(6500)
  check('走到有正文的章节', await gotoText(), '')

  /* ---------------------------------------------- #2 书签 / 笔记分栏 */
  const tabs = await cdp.evaluate(
    `(() => [...document.querySelectorAll('.reader-side-tab')].map((b) => (b.textContent || '').trim()))()`
  )
  console.log(`    #2 侧栏 ${JSON.stringify(tabs)}`)
  check(
    '#2：阅读侧栏把「书签」与「笔记」分成两栏',
    Boolean((tabs ?? []).some((t) => t.startsWith('书签')) && (tabs ?? []).some((t) => t.startsWith('笔记'))),
    JSON.stringify(tabs)
  )
  /* 两栏各自只显示自己那一类：先加点东西再看 */
  await cdp.evaluate(`(() => {
    const t = [...document.querySelectorAll('.reader-side-tab')].find((b) => (b.textContent || '').trim().startsWith('书签'))
    if (t) t.click()
    return Boolean(t)
  })()`)
  await delay(700)
  const bookmarkTab = await cdp.evaluate(`(() => ({
    panel: Boolean(document.querySelector('.pdf-bookmarks')),
    emptyTitle: (document.querySelector('.pdf-sidebar-body .empty-state-title, .empty-state')?.textContent || '').trim().slice(0, 8)
  }))()`)
  console.log(`    #2 书签栏 ${JSON.stringify(bookmarkTab)}`)
  check('#2：书签栏是独立的一栏', bookmarkTab.panel === true, JSON.stringify(bookmarkTab))
  await cdp.evaluate(`(() => {
    const t = [...document.querySelectorAll('.reader-side-tab')].find((b) => (b.textContent || '').trim().startsWith('笔记'))
    if (t) t.click()
    return Boolean(t)
  })()`)
  await delay(700)
  const noteTab = await cdp.evaluate(`(() => ({
    panel: Boolean(document.querySelector('.pdf-bookmarks')),
    addLabel: (document.querySelector('.pdf-panel-head button')?.textContent || '').trim()
  }))()`)
  console.log(`    #2 笔记栏 ${JSON.stringify(noteTab)}`)
  check('#2：笔记栏也是独立的一栏', noteTab.panel === true, JSON.stringify(noteTab))
  /* 切回目录栏，免得下面的键盘/选区被面板吃掉 */
  await cdp.evaluate(`(() => {
    const t = [...document.querySelectorAll('.reader-side-tab')].find((b) => (b.textContent || '').trim().startsWith('目录'))
    if (t) t.click()
    return Boolean(t)
  })()`)
  await delay(600)

  /* ---------------------------------------------- #9 / #10 排版弹层 */
  await cdp.evaluate(`(() => {
    const b = [...document.querySelectorAll('button')].find((x) => (x.textContent || '').trim() === '排版')
    if (b) b.click()
    return Boolean(b)
  })()`)
  await delay(800)
  const segFit = await cdp.evaluate(`(() => {
    const wanted = ['书', '衬线', '黑体', '楷体']
    return [...document.querySelectorAll('.epub-menu-panel .epub-seg button')]
      .filter((b) => wanted.includes((b.textContent || '').trim()))
      .map((b) => ({
        label: (b.textContent || '').trim(),
        overflow: b.scrollWidth > b.clientWidth + 1,
        w: Math.round(b.getBoundingClientRect().width)
      }))
  })()`)
  console.log(`    #9 字体格子 ${JSON.stringify(segFit)}`)
  check(
    '#9：字体选项两个字放得下（不溢出）',
    (segFit ?? []).length >= 3 && (segFit ?? []).every((item) => item.overflow === false),
    JSON.stringify(segFit)
  )

  const indentSet = await cdp.evaluate(`(() => {
    const sliders = [...document.querySelectorAll('.epub-menu-panel .epub-range')]
    const el = sliders[sliders.length - 1]
    if (!el) return { missing: true, count: sliders.length }
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value').set
    setter.call(el, '-1.5')
    el.dispatchEvent(new Event('input', { bubbles: true }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
    return { min: el.min, value: el.value, count: sliders.length }
  })()`)
  await delay(1700)
  const indentComputed = await inFirstSection(
    `const p = doc.querySelector('p')
     const cs = p ? doc.defaultView.getComputedStyle(p) : null
     return { indent: cs ? cs.textIndent : null, hasP: Boolean(p) }`
  )
  console.log(`    #10 缩进 ${JSON.stringify(indentSet)} → ${JSON.stringify(indentComputed)}`)
  check('#10：缩进滑块能拉到负数（缩回）', Boolean(indentSet && !indentSet.missing && parseFloat(indentSet.min) < 0), JSON.stringify(indentSet))
  check(
    '#10：负缩进真的作用到正文',
    Boolean(indentComputed?.indent && String(indentComputed.indent).trim().startsWith('-')),
    JSON.stringify(indentComputed)
  )
  await cdp.evaluate(`window.bookscent.settings.patch({ ui: { epubIndent: 0 } })`)
  await delay(1300)
  await cdp.evaluate(`(() => { document.body.click(); return true })()`)
  await delay(500)

  /* ---------------------------------------------- #7 波浪线 */
  await cdp.evaluate(`(() => {
    const v = document.querySelector('foliate-view')
    const contents = v.renderer.getContents().filter((c) => c && c.doc && c.doc.body)
    for (const content of contents) {
      const doc = content.doc
      const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT)
      let node = walker.nextNode()
      while (node && (node.data || '').trim().length < 8) node = walker.nextNode()
      if (!node) continue
      const range = doc.createRange()
      range.setStart(node, 0)
      range.setEnd(node, Math.min(10, node.data.length))
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
  const wavyClicked = await cdp.evaluate(`(() => {
    const b = [...document.querySelectorAll('.text-action-bar button')].find((x) => (x.textContent || '').trim() === '波浪')
    if (b) b.click()
    return Boolean(b)
  })()`)
  check('#7：选中工具条上有「波浪」', wavyClicked === true, String(wavyClicked))
  await delay(1600)
  const madeWavy = await inSections(
    `out.push({
       wavy: doc.querySelectorAll('.epub-mark-wavy').length,
       any: doc.querySelectorAll('.epub-mark').length
     })`
  )
  console.log(`    #7 波浪 ${JSON.stringify(madeWavy)}`)
  check(
    '#7：波浪线画在了正文里',
    (madeWavy ?? []).some((item) => item.wavy >= 1),
    JSON.stringify(madeWavy)
  )

  /* ---------------------------------------------- #8 点标注（整条）→ 编辑条 */
  const clickedMark = await cdp.evaluate(`(() => {
    const v = document.querySelector('foliate-view')
    const contents = (v.renderer.getContents() || []).filter((c) => c && c.doc)
    for (const content of contents) {
      const mark = content.doc.querySelector('.epub-mark')
      if (!mark) continue
      const textNode = mark.firstChild
      const target = textNode && textNode.nodeType === 3 ? textNode.parentElement : mark
      const rect = target.getBoundingClientRect()
      target.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: rect.left + 2, clientY: rect.top + 2 }))
      return true
    }
    return false
  })()`)
  await delay(1000)
  const editBar = await cdp.evaluate(`(() => {
    const bar = document.querySelector('.text-action-bar.is-edit')
    return bar ? [...bar.querySelectorAll('button')].map((b) => (b.textContent || '').trim() || '色') : null
  })()`)
  console.log(`    #8 编辑条 ${JSON.stringify(editBar)} (clicked=${clickedMark})`)
  check('#8：点标注浮出编辑条（点整条都算）', Boolean(editBar), JSON.stringify(editBar))
  check(
    '#4：编辑条里有复制 / 换样式 / 删除',
    Boolean(
      (editBar ?? []).some((t) => t.includes('删除')) &&
        (editBar ?? []).some((t) => t === '高亮') &&
        (editBar ?? []).some((t) => t === '波浪')
    ),
    JSON.stringify(editBar)
  )
  await shot('109-mark-edit.png', 300)

  /* ---------------------------------------------- #6 改颜色 */
  const colorOf = () =>
    cdp.evaluate(`window.bookscent.library.record(${JSON.stringify(epub.id)}).then((r) => (r.highlights || []).map((m) => m.color))`)
  const beforeColor = await colorOf()
  const recolored = await cdp.evaluate(`(() => {
    const bar = document.querySelector('.text-action-bar.is-edit')
    if (!bar) return false
    const dots = [...bar.querySelectorAll('.text-action-color')]
    const pick = dots[dots.length - 1]
    if (pick) pick.click()
    return Boolean(pick)
  })()`)
  await delay(1600)
  const afterColor = await colorOf()
  console.log(`    #6 颜色 ${JSON.stringify(beforeColor)} → ${JSON.stringify(afterColor)} (clicked=${recolored})`)
  check(
    '#6：能改已有标注的颜色',
    Boolean(recolored && JSON.stringify(beforeColor) !== JSON.stringify(afterColor)),
    `${JSON.stringify(beforeColor)} → ${JSON.stringify(afterColor)}`
  )
  /* 颜色确实画到正文里了（--epub-mark-color 跟着变） */
  const domColor = await inFirstSection(
    `const mark = doc.querySelector('.epub-mark')
     return mark ? mark.style.getPropertyValue('--epub-mark-color') : null`
  )
  console.log(`    #6 正文里的颜色 ${JSON.stringify(domColor)}`)
  check('#6：改完的颜色立刻画到正文里', Boolean(domColor && domColor.trim() !== ''), String(domColor))

  /* 换回高亮 */
  await cdp.evaluate(`(() => {
    const b = [...document.querySelectorAll('.text-action-bar.is-edit button')].find((x) => (x.textContent || '').trim() === '高亮')
    if (b) b.click()
    return Boolean(b)
  })()`)
  await delay(1300)
  const styleNow = await cdp.evaluate(
    `window.bookscent.library.record(${JSON.stringify(epub.id)}).then((r) => (r.highlights || []).map((m) => m.style))`
  )
  check('#4：样式可改（波浪能换回高亮）', JSON.stringify(styleNow).includes('highlight'), JSON.stringify(styleNow))

  /* ---------------------------------------------- #5 竖排要用逻辑属性 */
  const logical = await inFirstSection(
    `const injected = [...doc.querySelectorAll('style')].map((s) => s.textContent || '').join('\\n')
     return {
       usesLogical: injected.includes('border-block-end'),
       usesPhysicalBottom: /\\.epub-mark-underline[^}]*border-bottom:/.test(injected),
       hasMark: Boolean(doc.querySelector('.epub-mark'))
     }`
  )
  console.log(`    #5 逻辑属性 ${JSON.stringify(logical)}`)
  check(
    '#5：标注下划线用逻辑属性（竖排才画在正确的一侧）',
    logical?.usesLogical === true && logical?.usesPhysicalBottom === false,
    JSON.stringify(logical)
  )

  /* ---------------------------------------------- #4 删除 */
  await cdp.evaluate(`(() => {
    const v = document.querySelector('foliate-view')
    const contents = (v.renderer.getContents() || []).filter((c) => c && c.doc)
    for (const content of contents) {
      const mark = content.doc.querySelector('.epub-mark')
      if (!mark) continue
      mark.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      return true
    }
    return false
  })()`)
  await delay(900)
  const deleteClicked = await cdp.evaluate(`(() => {
    const b = [...document.querySelectorAll('.text-action-bar.is-edit button')].find((x) => (x.textContent || '').trim().includes('删除'))
    if (b) b.click()
    return Boolean(b)
  })()`)
  await delay(1700)
  const inRecord = await cdp.evaluate(
    `window.bookscent.library.record(${JSON.stringify(epub.id)}).then((r) => (r.highlights || []).length)`
  )
  const inDom = await inSections(`out.push(doc.querySelectorAll('.epub-mark').length)`)
  console.log(`    #4 删除之后 record=${inRecord} dom=${JSON.stringify(inDom)} (clicked=${deleteClicked})`)
  check(
    '#4：能删除标注（记录与正文都清掉）',
    inRecord === 0 && (inDom ?? []).every((n) => n === 0),
    `record=${inRecord} dom=${JSON.stringify(inDom)}`
  )

  /* 最后再回书架看统计页：这时候刚标过波浪线、也写过备注，心得应该数得出来 */
  await cdp.evaluate(`(() => { const b = document.querySelector('.reader-bar button'); if (b) b.click(); return true })()`)
  await delay(1800)
  await checkStats()

  /*
   * 0.10.0 精修：一条操作条 / 振假名 / 翻页热区。
   * 单独包一个块：上面的用例已经用过 editBar 这些名字，块里重名会直接语法错。
   */
  {
    /* 上面刚看完统计页，先回书架、把这本书重新打开，才有 foliate-view 可断言 */
    await cdp.evaluate(`(() => {
      /* 统计页没有左侧栏，回书架要走顶栏那颗 */
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
    check('回到阅读器（下面几条要在正文上验）', (await textLen()) > 200, '')

    const barButtons = () =>
    cdp.evaluate(`(() => {
      const bar = document.querySelector('.text-action-bar')
      return bar ? [...bar.querySelectorAll('button')].map((b) => (b.textContent || '').trim() || '色') : null
    })()`)

  /* 造一个 <ruby> 插进正文，选中它 —— 日文书的振假名就是这种结构 */
  const rubyPicked = await cdp.evaluate(`(() => {
    const v = document.querySelector('foliate-view')
    const contents = v.renderer.getContents().filter((c) => c && c.doc && c.doc.body)
    for (const content of contents) {
      const doc = content.doc
      const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT)
      let node = walker.nextNode()
      while (node && (node.data || '').trim().length < 4) node = walker.nextNode()
      if (!node || !node.parentNode) continue
      const host = node.parentNode
      const ruby = doc.createElement('ruby')
      ruby.appendChild(doc.createTextNode('剥'))
      const rt = doc.createElement('rt')
      rt.textContent = 'む'
      ruby.appendChild(rt)
      ruby.appendChild(doc.createTextNode('き出し'))
      host.insertBefore(ruby, node)
      const range = doc.createRange()
      range.selectNodeContents(ruby)
      const sel = doc.getSelection()
      sel.removeAllRanges()
      sel.addRange(range)
      ruby.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
      doc.dispatchEvent(new Event('selectionchange'))
      return { raw: range.toString(), plain: doc.defaultView.getSelection().toString() }
    }
    return null
  })()`)
  console.log(`    振假名选区 ${JSON.stringify(rubyPicked)}`)
  check(
    '振假名：选区原文里确实带着注音（剥 + む + き出し）',
    Boolean(rubyPicked && rubyPicked.raw.includes('む')),
    JSON.stringify(rubyPicked)
  )
  await delay(900)
  const rubyBar = await barButtons()
  check(
    '操作条：选中时是「复制 / 配色 / 高亮 / 划线 / 波浪 / 记为笔记 / 翻译」',
    Boolean(rubyBar && rubyBar.includes('复制') && rubyBar.includes('高亮') && rubyBar.includes('翻译')),
    JSON.stringify(rubyBar)
  )
  /* 用这条选区建一个标注，再看存下来的 plain 有没有剥掉注音 */
  await cdp.evaluate(`(() => {
    const b = [...document.querySelectorAll('.text-action-bar button')].find((x) => (x.textContent || '').trim() === '高亮')
    if (b) b.click()
    return Boolean(b)
  })()`)
  await delay(1600)
  const saved = await cdp.evaluate(`window.bookscent.library.record(${JSON.stringify(epub.id)}).then((r) => {
    const last = (r.highlights || [])[(r.highlights || []).length - 1]
    return last ? { text: last.text, plain: last.plain } : null
  })`)
  console.log(`    存下的标注 ${JSON.stringify(saved)}`)
  check(
    '振假名：标注的 text 保留原始文本（定位用）',
    Boolean(saved?.text && saved.text.includes('剥')),
    JSON.stringify(saved)
  )
  check(
    '振假名：plain 里没有注音（复制/翻译用干净那份）',
    Boolean(saved?.plain && !saved.plain.includes('む') && saved.plain.includes('剥き出し')),
    JSON.stringify(saved)
  )

  /* 点这条标注：出现的是**同一条**操作条（只是多了删除与关闭） */
  await cdp.evaluate(`(() => {
    const v = document.querySelector('foliate-view')
    const contents = (v.renderer.getContents() || []).filter((c) => c && c.doc)
    for (const content of contents) {
      const mark = content.doc.querySelector('.epub-mark')
      if (!mark) continue
      mark.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      return true
    }
    return false
  })()`)
  await delay(1000)
  const editBar = await barButtons()
  const sameBar = await cdp.evaluate(
    `document.querySelectorAll('.text-action-bar').length`
  )
  console.log(`    编辑态操作条 ${JSON.stringify(editBar)}（条数 ${sameBar}）`)
  check('操作条：编辑态也只有一条（不再有第二种样式）', sameBar === 1, String(sameBar))
  check(
    '操作条：选中与编辑共用同一套按钮（顺序一致，编辑态另有删除与关闭）',
    Boolean(
      editBar &&
        editBar[0] === '复制' &&
        editBar.includes('高亮') &&
        editBar.includes('划线') &&
        editBar.includes('波浪') &&
        editBar.includes('删除')
    ),
    JSON.stringify(editBar)
  )

  /* 翻页热区宽度：跟留白走，不再固定 16% */
  const zones = await cdp.evaluate(`(() => {
    const list = [...document.querySelectorAll('.epub-flip-zone')]
    return list.map((el) => Math.round(el.getBoundingClientRect().width))
  })()`)
  console.log(`    翻页热区宽度 ${JSON.stringify(zones)}`)
  check(
    '翻页热区：宽度既够好按、也不超过留白余量（88–150）',
    (zones ?? []).length > 0 && (zones ?? []).every((w) => w >= 88 && w <= 150),
    JSON.stringify(zones)
  )
  }

  /* ---------------------------------------------- 「记为笔记」的正文高亮提示 */
  {
    /* 先选中一段 */
    const picked = await cdp.evaluate(`(() => {
      const v = document.querySelector('foliate-view')
      const contents = v.renderer.getContents().filter((c) => c && c.doc && c.doc.body)
      for (const content of contents) {
        const doc = content.doc
        const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT)
        let node = walker.nextNode()
        while (node && (node.data || '').trim().length < 14) node = walker.nextNode()
        if (!node) continue
        const range = doc.createRange()
        range.setStart(node, 0)
        range.setEnd(node, Math.min(18, node.data.length))
        const sel = doc.getSelection()
        sel.removeAllRanges()
        sel.addRange(range)
        node.parentElement.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
        doc.dispatchEvent(new Event('selectionchange'))
        return { text: range.toString() }
      }
      return null
    })()`)
    console.log(`    选中的原文 ${JSON.stringify(picked)}`)
    await delay(900)

    const before = await cdp.evaluate(`(() => {
      const v = document.querySelector('foliate-view')
      const contents = v.renderer.getContents()
      let marks = 0
      for (const c of contents) if (c && c.doc) marks += c.doc.querySelectorAll('.epub-bm-mark').length
      return marks
    })()`)

    /* 点「记为笔记」 */
    const clicked = await cdp.evaluate(`(() => {
      const b = [...document.querySelectorAll('.text-action-bar button')].find((x) => (x.textContent || '').trim() === '记为笔记')
      if (b) b.click()
      return Boolean(b)
    })()`)
    check('#记为笔记：选中工具条上有这个按钮', clicked === true, '')
    await delay(1800)

    const after = await cdp.evaluate(`(() => {
      const v = document.querySelector('foliate-view')
      const contents = v.renderer.getContents()
      let marks = 0
      let sample = ''
      for (const c of contents) {
        if (!c || !c.doc) continue
        const list = c.doc.querySelectorAll('.epub-bm-mark')
        marks += list.length
        if (list[0]) sample = (list[0].textContent || '').slice(0, 20)
      }
      return { marks, sample }
    })()`)
    console.log(`    书签标记 ${JSON.stringify({ before, after })}`)
    check('#记为笔记：正文里出现了书签标记（这是用户说的"高亮提示"）', (after?.marks ?? 0) > (before ?? 0), JSON.stringify({ before, after }))
    check('#记为笔记：标记包住的正是选中的那段', Boolean(after?.sample), JSON.stringify(after))

    /* 诊断：是"没存进去"还是"没画出来" */
    const diagnostic = await cdp.evaluate(`(async () => {
      const index = await window.bookscent.library.index()
      const book = index.books.find((b) => b.format === 'epub')
      const record = book ? await window.bookscent.library.record(book.id) : null
      const v = document.querySelector('foliate-view')
      const contents = v && v.renderer ? v.renderer.getContents() : []
      let bm = 0
      let mk = 0
      for (const c of contents) {
        if (!c || !c.doc) continue
        bm += c.doc.querySelectorAll('.epub-bm-mark').length
        mk += c.doc.querySelectorAll('.epub-mark').length
      }
      return {
        bookmarks: (record && record.bookmarks ? record.bookmarks : []).map((b) => ({
          kind: b.kind,
          excerpt: (b.excerpt || '').slice(0, 24),
          plain: (b.plain || '').slice(0, 24)
        })),
        domBmMarks: bm,
        domMarks: mk
      }
    })()`)
    console.log(`    诊断 ${JSON.stringify(diagnostic)}`)
    check(
      '#记为笔记：记录里确实存下了这条笔记',
      (diagnostic?.bookmarks ?? []).length > 0,
      JSON.stringify(diagnostic?.bookmarks)
    )

    /* ---------------------------------------------- 文本标记的快捷键（H / U / W / N） */
    const marksNow = () =>
      cdp.evaluate(`(() => {
        const v = document.querySelector('foliate-view')
        const contents = v && v.renderer ? v.renderer.getContents() : []
        let mk = 0
        for (const c of contents) if (c && c.doc) mk += c.doc.querySelectorAll('.epub-mark').length
        return mk
      })()`)

    /* 重新选一段（上一步的选区已经用掉了） */
    await cdp.evaluate(`(() => {
      const v = document.querySelector('foliate-view')
      const contents = v.renderer.getContents().filter((c) => c && c.doc && c.doc.body)
      for (const content of contents) {
        const doc = content.doc
        const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT)
        let node = walker.nextNode()
        while (node && (node.data || '').trim().length < 14) node = walker.nextNode()
        if (!node) continue
        const range = doc.createRange()
        range.setStart(node, 0)
        range.setEnd(node, Math.min(20, node.data.length))
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
    const beforeKey = await marksNow()
    await cdp.evaluate(`(() => {
      const el = document.activeElement
      if (el && el.blur) el.blur()
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'h', bubbles: true, cancelable: true }))
      return true
    })()`)
    await delay(1500)
    const afterKey = await marksNow()
    console.log(`    快捷键 H：标注数 ${beforeKey} → ${afterKey}`)
    check('#快捷键：按 H 能给选中文字加高亮', (afterKey ?? 0) > (beforeKey ?? 0), `${beforeKey} → ${afterKey}`)
  }
}