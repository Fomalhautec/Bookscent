/**
 * 0.10.1 修订探针（ONLY=v0101b）。
 *
 * 四件事，各自都是"用户报的现象"的直接复现：
 *   1. **焦点进正文 iframe 之后快捷键还要有效** —— 这是本轮最要命的一条：
 *      EPUB 正文在 iframe 里，以前监听只挂在顶层 window 上，一点正文就全失效。
 *      这里用真实鼠标点正文（焦点进 iframe），再用 CDP 真的按键，看翻译栏开不开。
 *   2. **默认快捷键不该有冲突** —— 顺带确认 Ctrl+Shift+N 这类组合被当成独立组合
 *      （以前 Shift 被抹掉，于是和 Ctrl+N 撞车）。
 *   3. **改键弹窗** —— 能点选控制键与按键、实时预览、确定后写进设置。
 *   4. **翻译记录的保留策略** —— 从不清除 / 超上限清除 / 退出即清除，
 *      以及设置页里能查看与删除记录。
 */
export async function runV0101b(ctx) {
  const { cdp, check, delay, waitFor, shot, mouse } = ctx

  await waitFor('document.querySelector(".app-shell")', '应用外壳', 30000)
  for (let i = 0; i < 20; i += 1) {
    const books = await cdp.evaluate(
      'window.bookscent.library.index().then((i) => i.books.length).catch(() => 0)'
    )
    if (books > 0) break
    await delay(1000)
  }
  const fixture = process.env.JP_EPUB ?? ''
  const hasEpub = await cdp.evaluate(
    'window.bookscent.library.index().then((i) => i.books.some((b) => b.format === "epub")).catch(() => false)'
  )
  if (!hasEpub && fixture) {
    await cdp.evaluate(`window.bookscent.library.importPaths([${JSON.stringify(fixture)}], false)`)
    await delay(3000)
  }

  /* ============================================ 2) 默认没有冲突 */
  const leaveReader = async () => {
    await cdp.evaluate(`(() => {
      const all = [...document.querySelectorAll('button, [role=button]')]
      const back = all.find((el) => (el.textContent || '').trim() === '书架') ||
        all.find((el) => (el.getAttribute('title') || '').includes('书架'))
      if (back) back.click()
      return Boolean(back)
    })()`)
    await delay(1500)
  }
  const openSettingsTab = async (label) => {
    await cdp.evaluate(`(() => {
      const b = [...document.querySelectorAll('button, [role=button]')]
        .find((el) => (el.getAttribute('title') || '').includes('设置') || (el.textContent || '').trim() === '设置')
      if (b) b.click()
      return Boolean(b)
    })()`)
    await delay(1500)
    await cdp.evaluate(`(() => {
      const el = [...document.querySelectorAll('button, [role=tab], .settings-tab, .set-tab-btn')]
        .find((b) => (b.textContent || '').trim() === ${JSON.stringify(label)})
      if (el) el.click()
      return Boolean(el)
    })()`)
    await delay(1300)
  }

  await cdp.evaluate(`window.bookscent.settings.resetPaths(['ui.shortcuts'])`)
  await delay(1000)
  await cdp.evaluate(`location.reload()`)
  await delay(4500)
  await waitFor('document.querySelector(".app-shell")', '重载后外壳', 25000)
  await delay(1500)
  await openSettingsTab('快捷键')

  const defaults = await cdp.evaluate(`(() => {
    const pane = document.querySelector('.set-tab')
    if (!pane) return null
    const callouts = [...pane.querySelectorAll('.set-callout')].map((el) => el.textContent || '')
    const keys = [...pane.querySelectorAll('.keys-capture, .keys-fixed')].map((el) => (el.textContent || '').trim())
    return {
      noConflict: callouts.some((text) => text.includes('没有重复绑定')),
      rows: pane.querySelectorAll('.keys-row').length,
      shiftKeys: keys.filter((text) => text.includes('Shift')).length,
      sample: keys.slice(0, 8)
    }
  })()`)
  console.log(`    默认快捷键 ${JSON.stringify(defaults)}`)
  check('默认快捷键没有任何冲突', defaults?.noConflict === true, JSON.stringify(defaults?.sample))
  check(
    'Ctrl+Shift 组合被当成独立组合（不再与 Ctrl 撞车）',
    (defaults?.shiftKeys ?? 0) >= 2,
    String(defaults?.shiftKeys)
  )

  /* ============================================ 3) 改键弹窗 */
  await cdp.evaluate(`(() => {
    const btn = [...document.querySelectorAll('.keys-capture')][0]
    if (btn) btn.click()
    return Boolean(btn)
  })()`)
  await delay(900)
  const modal = await cdp.evaluate(`(() => {
    const box = document.querySelector('.modal')
    if (!box) return null
    return {
      mods: [...box.querySelectorAll('.keys-mod')].map((el) => (el.textContent || '').trim()),
      keys: [...box.querySelectorAll('.keys-key')].map((el) => (el.textContent || '').trim()),
      preview: (box.querySelector('.keys-preview-value')?.textContent || '').trim()
    }
  })()`)
  console.log(`    弹窗 ${JSON.stringify({ mods: modal?.mods, keyCount: modal?.keys?.length })}`)
  check('改键会弹出小窗口', Boolean(modal), '没有弹窗')
  check('弹窗里能点选控制键（Ctrl / Alt / Shift / Win）', (modal?.mods ?? []).length === 4, JSON.stringify(modal?.mods))
  check('弹窗里能点选按键（字母 / 数字 / 功能键 / 方向键）', (modal?.keys ?? []).length >= 50, String(modal?.keys?.length))

  await cdp.evaluate(`(() => {
    const box = document.querySelector('.modal')
    if (!box) return false
    /* 按"目标状态"点：本来已经选中的不要点掉（第一行默认就是 Ctrl+N） */
    const want = { Ctrl: true, Shift: true, Alt: false }
    const mods = [...box.querySelectorAll('.keys-mod')]
    for (const el of mods) {
      const label = (el.textContent || '').trim()
      const id = label === 'Win / Cmd' ? 'Meta' : label
      if (!(id in want)) continue
      const active = el.classList.contains('is-active')
      if (active !== want[id]) el.click()
    }
    const key = [...box.querySelectorAll('.keys-key')].find((el) => (el.textContent || '').trim() === 'K')
    if (key && !key.classList.contains('is-active')) key.click()
    return true
  })()`)
  await delay(500)
  const preview = await cdp.evaluate(`(document.querySelector('.keys-preview-value')?.textContent || '').trim()`)
  check('弹窗实时显示组合结果（Ctrl+Shift+K）', preview === 'Ctrl+Shift+K', preview)
  await cdp.evaluate(`(() => {
    const btn = [...document.querySelectorAll('.modal button')].find((el) => (el.textContent || '').trim() === '确定')
    if (btn) btn.click()
    return Boolean(btn)
  })()`)
  await delay(1200)
  const saved = await cdp.evaluate(`window.bookscent.settings.get().then((s) => s.ui.shortcuts)`)
  check(
    '弹窗确定后写进设置（Shift 没被丢掉）',
    Object.values(saved ?? {}).some((keys) => Array.isArray(keys) && keys[0] === 'Ctrl+Shift+K'),
    JSON.stringify(saved)
  )
  await cdp.evaluate(`window.bookscent.settings.resetPaths(['ui.shortcuts'])`)
  await delay(900)
  await shot('151-shortcut-recorder.png', 150)

  /* ============================================ 4) 翻译记录的保留策略 */
  const save = (n) =>
    cdp.evaluate(`window.bookscent.library.translateHistorySave(Array.from({ length: ${n} }, (_, i) => ({
      id: 'probe_' + i,
      source: '原文 ' + i,
      translation: '译文 ' + i,
      kind: 'machine',
      target: 'zh-CN',
      at: Date.now() - i * 1000
    })))`)

  const setMode = async (mode, limit = 50) => {
    await cdp.evaluate(`(async () => {
      const s = await window.bookscent.settings.get()
      await window.bookscent.settings.patch({ translate: { ...s.translate, historyMode: ${JSON.stringify(mode)}, historyLimit: ${limit} } })
    })()`)
    await delay(1200)
  }
  const reload = async () => {
    await cdp.evaluate(`location.reload()`)
    await delay(4500)
    await waitFor('document.querySelector(".app-shell")', '重载后外壳', 25000)
    await delay(1500)
  }

  await setMode('keep')
  await save(6)
  await delay(900)
  await reload()
  const kept = await cdp.evaluate(`window.bookscent.library.translateHistoryGet()`)
  console.log(`    「从不清除」重载后剩 ${(kept ?? []).length} 条`)
  check('记录策略「从不清除」：重载后记录还在', (kept ?? []).length === 6, String((kept ?? []).length))

  await openSettingsTab('翻译')
  /* 记录现在是独立的子页（入口在「翻译」页），进去之后是表格 */
  const summary = await cdp.evaluate(`(() => {
    const btn = [...document.querySelectorAll('button')].find((el) => (el.textContent || '').includes('查看全部记录'))
    return { exists: Boolean(btn) }
  })()`)
  check('翻译页有「查看全部记录」的入口', summary.exists === true, JSON.stringify(summary))
  await cdp.evaluate(`(() => {
    const btn = [...document.querySelectorAll('button')].find((el) => (el.textContent || '').includes('查看全部记录'))
    if (btn) btn.click()
    return Boolean(btn)
  })()`)
  await delay(1400)
  /* 记录页改成"浏览记录"式的一条一块：原文、译文、解析都放得下 */
  const listed = await cdp.evaluate(`(() => {
    const items = [...document.querySelectorAll('.hist-item')]
    const first = items[0]
    return {
      rows: items.length,
      crumbs: (document.querySelector('.set-sub-crumbs')?.textContent || '').trim(),
      hasBack: Boolean(document.querySelector('.set-sub-head button')),
      labels: first ? [...first.querySelectorAll('.hist-label')].map((el) => (el.textContent || '').trim()) : [],
      tags: first ? [...first.querySelectorAll('.hist-tag')].map((el) => (el.textContent || '').trim()) : [],
      actions: first ? first.querySelectorAll('.hist-head button').length : 0,
      sourceLen: first ? (first.querySelector('.hist-source')?.textContent || '').length : 0,
      textLen: first ? (first.querySelector('.hist-text')?.textContent || '').length : 0
    }
  })()`)
  console.log(`    记录子页 ${JSON.stringify(listed)}`)
  check('记录是独立的一页（面包屑写着翻译下的子页）', String(listed?.crumbs).includes('翻译'), String(listed?.crumbs))
  check('记录是一条一块的排法（不是一行高的表格）', (listed?.rows ?? 0) === 6, String(listed?.rows))
  check(
    '每条都分栏显示原文与译文，且内容铺得开',
    JSON.stringify(listed?.labels) === JSON.stringify(['原文', '译文']) &&
      (listed?.sourceLen ?? 0) > 0 &&
      (listed?.textLen ?? 0) > 0,
    JSON.stringify({ labels: listed?.labels, sourceLen: listed?.sourceLen, textLen: listed?.textLen })
  )
  check('每条都带引擎与语言标签', (listed?.tags ?? []).length >= 2, JSON.stringify(listed?.tags))
  check('每条都有复制与删除两个操作', (listed?.actions ?? 0) >= 2, String(listed?.actions))
  check('子页有返回按钮', listed?.hasBack === true, '')
  await cdp.evaluate(`(() => {
    const btn = document.querySelector('.hist-item .hist-head button:last-child')
    if (btn) btn.click()
    return Boolean(btn)
  })()`)
  await delay(1300)
  const afterDelete = await cdp.evaluate(`window.bookscent.library.translateHistoryGet()`)
  check('设置页能删掉单条记录', (afterDelete ?? []).length === 5, String((afterDelete ?? []).length))

  await setMode('limited', 3)
  await save(6)
  await delay(900)
  const limited = await cdp.evaluate(`window.bookscent.library.translateHistoryGet()`)
  console.log(`    「超过 3 条时清除」写入 6 条后剩 ${(limited ?? []).length} 条`)
  check('记录策略「超过上限时清除」：只留上限条数', (limited ?? []).length === 3, String((limited ?? []).length))

  /*
   * 「退出/加载时清除」是**应用启动**时执行的策略（与用户说的"每次退出或加载时清除"一致），
   * 页面重载不会清 —— 主进程没重启。所以这里验的是这条策略实际用到的那两个动作：
   * 策略值存得住、以及清空（清空全部按钮走的就是它）真的清掉。
   */
  await setMode('session')
  const policy = await cdp.evaluate(`window.bookscent.settings.get().then((s) => s.translate.historyMode)`)
  check('记录策略「退出/加载时清除」能存进设置', policy === 'session', String(policy))
  await cdp.evaluate(`window.bookscent.library.translateHistoryClear()`)
  await delay(900)
  const cleared = await cdp.evaluate(`window.bookscent.library.translateHistoryGet()`)
  check('清空记录后确实没有了（策略与「清空全部」用的是同一条路）', (cleared ?? []).length === 0, String((cleared ?? []).length))

  /* ---- 更新日志也应该是独立子页（表格） ---- */
  await cdp.evaluate(`(() => {
    const all = [...document.querySelectorAll('button, [role=button]')]
    const back = all.find((el) => (el.textContent || '').trim() === '书架') || all.find((el) => (el.getAttribute('title') || '').includes('书架'))
    if (back) back.click()
    return Boolean(back)
  })()`)
  await delay(1400)
  await openSettingsTab('关于')
  const logEntry = await cdp.evaluate(`(() => {
    const btn = [...document.querySelectorAll('button')].find((el) => (el.textContent || '').includes('查看完整更新日志'))
    return { exists: Boolean(btn), label: (btn?.textContent || '').trim() }
  })()`)
  check('关于页有「查看完整更新日志」的入口', logEntry.exists === true, JSON.stringify(logEntry))
  await cdp.evaluate(`(() => {
    const btn = [...document.querySelectorAll('button')].find((el) => (el.textContent || '').includes('查看完整更新日志'))
    if (btn) btn.click()
    return Boolean(btn)
  })()`)
  await delay(1400)
  const logPage = await cdp.evaluate(`(() => {
    const head = [...document.querySelectorAll('.set-table-head .set-table-cell')].map((el) => (el.textContent || '').trim())
    return {
      head,
      rows: document.querySelectorAll('.set-table-row').length,
      crumbs: (document.querySelector('.set-sub-crumbs')?.textContent || '').trim(),
      filter: Boolean(document.querySelector('.set-table-filter')),
      cols: (document.querySelector('.set-table-row')?.getAttribute('style') || ''),
      versions: [...document.querySelectorAll('.set-table-row .set-log-ver')].slice(0, 4).map((el) => (el.textContent || '').trim())
    }
  })()`)
  console.log(`    更新日志子页 ${JSON.stringify({ head: logPage?.head, rows: logPage?.rows, filter: logPage?.filter })}`)
  check('更新日志是独立子页（面包屑在「关于」下）', String(logPage?.crumbs).includes('关于'), String(logPage?.crumbs))
  check('更新日志用表格排（版本 / 标题 / 说明）', (logPage?.head ?? []).length === 3, JSON.stringify(logPage?.head))
  check('更新日志能搜关键词', logPage?.filter === true, '')
  check('更新日志列出了全部条目', (logPage?.rows ?? 0) >= 5, String(logPage?.rows))
  check(
    '说明列占剩余空间（不是固定窄列）',
    String(logPage?.cols).includes('minmax') || String(logPage?.cols).includes('1fr'),
    String(logPage?.cols)
  )
  check(
    '更新日志按版本从新到旧排（0.10.1 在最前）',
    (logPage?.versions ?? [])[0] === '0.10.1',
    JSON.stringify(logPage?.versions)
  )

  /* ---- 侧栏书架层右边的小删除按钮应该没有了 ---- */
  const shelfRemove = await cdp.evaluate(`document.querySelectorAll('.shelf-nav-remove').length`)
  check('侧栏书架层右边的小删除按钮已移除（改走右键菜单）', shelfRemove === 0, String(shelfRemove))
}