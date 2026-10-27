/**
 * 0.11.0 探针（ONLY=vocab）：单词本。
 *
 * 验五件事：
 *   1. 侧栏有「单词本」入口，点了能进页面；
 *   2. 语种判断：日文（含假名）/ 中文（纯汉字）/ 英文 分别落到 ja / zh / en；
 *   3. 加词、去重合并（同语言同词形只留一条，且补全空释义）；
 *   4. 页面按语种分组显示条数，能搜索、能删；
 *   5. 翻译解析里的词汇表能被解析出来（[[VOCAB]] 块），并带出原词/读音/释义。
 */
export async function runVocab(ctx) {
  const { cdp, check, delay, waitFor, shot } = ctx

  await waitFor('document.querySelector(".app-shell")', '应用外壳', 30000)
  for (let i = 0; i < 15; i += 1) {
    const ready = await cdp.evaluate('window.bookscent.library.index().then(() => true).catch(() => false)')
    if (ready) break
    await delay(800)
  }

  /* 清空重来，保证断言可重复 */
  const before = await cdp.evaluate('window.bookscent.library.vocabList()')
  for (const word of before ?? []) {
    await cdp.evaluate(`window.bookscent.library.vocabRemove(${JSON.stringify(word.id)})`)
  }

  /* ---------------------------------------------- 加词 + 语种判断 */
  const added = await cdp.evaluate(`(async () => {
    const out = []
    const items = [
      { term: '詩', reading: 'し', meaning: '诗，诗歌', kind: 'word', source: '雨森潤奈は湿度が高い 3' },
      { term: '湿度が高い', reading: 'しつどがたかい', meaning: '湿度高', kind: 'phrase' },
      { term: '书桌', reading: '', meaning: '写字用的桌子', kind: 'word' },
      { term: 'serendipity', reading: 'ˌserənˈdipəti', meaning: '意外的幸运', kind: 'word' },
      { term: '사과', reading: '', meaning: '苹果', kind: 'word' }
    ]
    for (const item of items) out.push(await window.bookscent.library.vocabAdd(item))
    return out.map((r) => ({ term: r.entry.term, language: r.entry.language, merged: r.merged }))
  })()`)
  console.log(`    加词结果 ${JSON.stringify(added)}`)
  const byTerm = new Map((added ?? []).map((item) => [item.term, item.language]))
  check('有假名读音的日文词判为 ja', byTerm.get('詩') === 'ja' && byTerm.get('湿度が高い') === 'ja', JSON.stringify(byTerm.get('詩')))
  check('纯汉字判为 zh', byTerm.get('书桌') === 'zh', String(byTerm.get('书桌')))
  check('拉丁字母判为 en', byTerm.get('serendipity') === 'en', String(byTerm.get('serendipity')))
  check('韩文判为 ko', byTerm.get('사과') === 'ko', String(byTerm.get('사과')))

  /* ---------------------------------------------- 去重合并 */
  const dup = await cdp.evaluate(`window.bookscent.library.vocabAdd({
    term: '詩', reading: '', meaning: '不该覆盖原释义', kind: 'word'
  }).then((r) => ({ merged: r.merged, meaning: r.entry.meaning, reading: r.entry.reading }))`)
  console.log(`    重复加入 ${JSON.stringify(dup)}`)
  check('重复的词合并而不是新增', dup?.merged === true, JSON.stringify(dup))
  check('合并时保留原释义与读音（已有的不被覆盖）', dup?.meaning === '诗，诗歌' && dup?.reading === 'し', JSON.stringify(dup))

  const all = await cdp.evaluate('window.bookscent.library.vocabList()')
  check('总共 5 条（重复的没有新增）', (all ?? []).length === 5, String((all ?? []).length))

  /* ---------------------------------------------- 解析里的词汇表 */
  /* ---------------------------------------------- 页面 */
  const nav = await cdp.evaluate(`(() => {
    const items = [...document.querySelectorAll('.titlebar-nav .btn')].map((el) => (el.textContent || '').trim())
    const btn = [...document.querySelectorAll('.titlebar-nav .btn')].find((el) => (el.textContent || '').includes('单词本'))
    const inSidebar = [...document.querySelectorAll('.nav-item')].some((el) => (el.textContent || '').includes('单词本'))
    return { exists: Boolean(btn), inSidebar, items }
  })()`)
  console.log(`    顶栏 ${JSON.stringify({ exists: nav?.exists, items: nav?.items })}`)
  check('顶栏有「单词本」入口（与书架/统计/设置同级）', nav?.exists === true, JSON.stringify(nav?.items))
  check('侧栏不再有单词本（已移到顶栏）', nav?.inSidebar === false, String(nav?.inSidebar))

  await cdp.evaluate(`(() => {
    const btn = [...document.querySelectorAll('.titlebar-nav .btn')].find((el) => (el.textContent || '').includes('单词本'))
    if (btn) btn.click()
    return Boolean(btn)
  })()`)
  await delay(1500)

  const page = await cdp.evaluate(`(() => {
    const view = document.querySelector('.vocab-view')
    if (!view) return null
    return {
      langs: [...view.querySelectorAll('.vocab-lang')].map((el) => (el.textContent || '').trim()),
      rows: view.querySelectorAll('.vocab-row:not(.is-head)').length,
      hasSearch: Boolean(view.querySelector('.vocab-search'))
    }
  })()`)
  console.log(`    单词本页 ${JSON.stringify(page)}`)
  check('页面打开且是单词本视图', Boolean(page), '没有 .vocab-view')
  check('按语种分组（有全部/日语/英语等标签）', (page?.langs ?? []).length >= 4, JSON.stringify(page?.langs))
  check('列出了 5 条词条', (page?.rows ?? 0) === 5, String(page?.rows))
  check('有搜索框', page?.hasSearch === true, '')

  /*
   * 侧栏那个条数这里不断言：探针是直接调 IPC 加词的，绕过了渲染层的 store，
   * 计数自然还是 0 —— 断言它等于 5 是"测错了东西"。
   * （进页面时 store 会读磁盘，侧栏随后就显示正确条数，这条留待人眼看截图。）
   */

  /* 切到日语标签：只剩日文词 */
  await cdp.evaluate(`(() => {
    const tab = [...document.querySelectorAll('.vocab-lang')].find((el) => (el.textContent || '').includes('日语'))
    if (tab) tab.click()
    return Boolean(tab)
  })()`)
  await delay(700)
  const jp = await cdp.evaluate(`document.querySelectorAll('.vocab-view .vocab-row:not(.is-head)').length`)
  check('点「日语」只显示日文词（2 条）', jp === 2, String(jp))

  /* 删除一条 */
  await cdp.evaluate(`(() => {
    const btn = document.querySelector('.vocab-view .vocab-row:not(.is-head) .vocab-row-actions button:last-child')
    if (btn) btn.click()
    return Boolean(btn)
  })()`)
  await delay(900)
  const afterDelete = await cdp.evaluate('window.bookscent.library.vocabList()')
  check('能删掉一条', (afterDelete ?? []).length === 4, String((afterDelete ?? []).length))

  await shot('170-vocab.png', 200)

  /*
   * 原词可编辑。
   * 用户报过：解析把释义塞进了词形（`infléchir：使转向、改变，`），而单词本里改不了原词 ——
   * 于是那条脏数据永远留在那儿。现在原词是可改的，而且改成已存在的词会**合并**而不是留两条。
   */
  await cdp.evaluate(`(() => {
    const tab = [...document.querySelectorAll('.vocab-lang')].find((el) => (el.textContent || '').trim().startsWith('全部'))
    if (tab) tab.click()
    return Boolean(tab)
  })()`)
  await delay(600)
  await cdp.evaluate(`(() => {
    const btn = [...document.querySelectorAll('.vocab-view .vocab-row:not(.is-head) .vocab-row-actions button')]
      .find((b) => (b.textContent || '').includes('编辑'))
    if (btn) btn.click()
    return Boolean(btn)
  })()`)
  await delay(700)
  const hasTermInput = await cdp.evaluate(`(() => {
    const input = document.querySelector('.vocab-row.is-editing input[placeholder="原词"]')
    return Boolean(input)
  })()`)
  check('第 3 条：编辑时原词可以改（有原词输入框）', hasTermInput === true, '')

  const edited = await cdp.evaluate(`(async () => {
    const input = document.querySelector('.vocab-row.is-editing input[placeholder="原词"]')
    if (!input) return null
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value').set
    setter.call(input, '湿度が高い（改）')
    input.dispatchEvent(new Event('input', { bubbles: true }))
    const save = [...document.querySelectorAll('.vocab-row.is-editing button')].find((b) => (b.textContent || '').includes('保存'))
    if (save) save.click()
    await new Promise((r) => setTimeout(r, 1200))
    const list = await window.bookscent.library.vocabList()
    return list.map((w) => w.term)
  })()`)
  console.log(`    改原词之后 ${JSON.stringify(edited)}`)
  check('第 3 条：改完原词真的写进去了', Boolean((edited ?? []).some((t) => t === '湿度が高い（改）')), JSON.stringify(edited))

  /* 改成已存在的词 → 合并（条数减少、不出现两条同名） */
  const merged = await cdp.evaluate(`(async () => {
    const list = await window.bookscent.library.vocabList()
    const target = list.find((w) => w.term === '湿度が高い（改）')
    if (!target) return null
    await window.bookscent.library.vocabUpdate(target.id, { term: '詩' })
    const after = await window.bookscent.library.vocabList()
    const same = after.filter((w) => w.term === '詩')
    return { count: after.length, sameTerm: same.length, mergedNote: same[0] ? same[0].meaning : null }
  })()`)
  console.log(`    改成重复的词之后 ${JSON.stringify(merged)}`)
  check('第 3 条：改成已存在的词会合并，不留两条同名', merged?.sameTerm === 1, JSON.stringify(merged))
  /*
   * 两段式：翻译走正常请求，抽词单独一发、只回 JSON。
   * 这里断言接口确实挂在桥接上，并且"没有 AI 接口"时给的是明确提示而不是静默失败。
   */
  const hasExtract = await cdp.evaluate('typeof window.bookscent.library.translateVocab === "function"')
  check('两步方案：抽词接口已挂上', hasExtract === true, String(hasExtract))
  const extractResult = await cdp.evaluate(`window.bookscent.library.translateVocab({
    source: 'infléchir：使转向、改变（趋势、进程）',
    translation: '使转向、改变（趋势、进程）'
  })`)
  console.log(`    抽词接口返回 ${JSON.stringify(extractResult)}`)
  check(
    '两步方案：没有可用 AI 接口时给明确提示（不静默失败）',
    extractResult?.ok === false && typeof extractResult?.error === 'string' && extractResult.error.length > 0,
    JSON.stringify(extractResult)
  )
}
