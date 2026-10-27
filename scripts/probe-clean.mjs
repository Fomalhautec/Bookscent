/**
 * 0.10.1 探针（ONLY=clean）：图片数据目录的体检与清理。
 *
 * 探针跑在 Node 里，所以能直接往数据目录里放文件、也能直接看文件在不在 ——
 * 这是验证"真的删了、真的留了"最直接的办法。
 *
 * 造的场景：
 *   - 一个没人引用的图（孤立文件）；
 *   - 两个内容相同、都没人引用的图（重复 + 孤立）；
 *   - 两个内容相同、**都被设置引用着**的图，其中设置当前指向后一个 ——
 *     清理后必须留前一个、删后一个，并且把设置里的引用改指到留下的那个。
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** 1×1 透明 PNG */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
  'base64'
)

export async function runClean(ctx) {
  const { cdp, check, delay, waitFor, shot } = ctx

  const dir = await cdp.evaluate(`window.bookscent.settings.get().then((s) => s.assetsDir)`)
  console.log(`    数据目录 ${dir}`)
  check('拿到了数据目录', Boolean(dir), String(dir))
  if (!dir) return
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })

  const files = {
    orphan: join(dir, 'probe-orphan.png'),
    dupA: join(dir, 'probe-dup-a.png'),
    dupB: join(dir, 'probe-dup-b.png'),
    refKeep: join(dir, 'probe-ref-1.png'),
    refDrop: join(dir, 'probe-ref-2.png')
  }
  writeFileSync(files.orphan, PNG)
  writeFileSync(files.dupA, PNG)
  copyFileSync(files.dupA, files.dupB)
  writeFileSync(files.refKeep, PNG)
  copyFileSync(files.refKeep, files.refDrop)
  console.log('    已放入 5 个测试图片（3 个没人用、2 组重复）')

  /*
   * 两份内容相同的图**都被引用**（书脊样式与笔记样式各指一份）：
   * 这时清理必须留一份、删另一份，并把指向被删那份的引用改指过去 ——
   * 只引用一份的话，留下的一定是被引用的那份，改指逻辑根本走不到。
   */
  await cdp.evaluate(`window.bookscent.settings.patch({
    bookStyle: { spineImage: 'asset:probe-ref-2.png' },
    noteStyle: { spineImage: 'asset:probe-ref-1.png' }
  })`)
  await delay(1000)
  const pointed = await cdp.evaluate(
    `window.bookscent.settings.get().then((s) => s.bookStyle.spineImage + '|' + s.noteStyle.spineImage)`
  )
  check(
    '准备：书脊样式指向第二份、笔记样式指向第一份',
    pointed === 'asset:probe-ref-2.png|asset:probe-ref-1.png',
    String(pointed)
  )

  /* ---------------------------------------------- 体检报告 */
  const report = await cdp.evaluate(`window.bookscent.library.scanAssets()`)
  const orphanNames = (report?.orphans ?? []).map((item) => item.name)
  const dupKeeps = (report?.duplicates ?? []).map((group) => `${group.keep}<-${group.drop.join(',')}`)
  console.log(`    体检：总数 ${report?.total} 孤立 ${orphanNames.length} 重复组 ${(report?.duplicates ?? []).length}`)
  console.log(`    孤立里含测试文件 ${JSON.stringify(orphanNames.filter((n) => n.startsWith('probe-')))}`)
  console.log(`    重复组 ${JSON.stringify(dupKeeps)}`)
  check('体检：报告里有孤立文件', orphanNames.includes('probe-orphan.png'), JSON.stringify(orphanNames.slice(0, 6)))
  check(
    '体检：两个都没人用的重复图，保留一个、列出另一个',
    (report?.duplicates ?? []).some(
      (group) => group.drop.includes('probe-dup-b.png') || group.drop.includes('probe-dup-a.png')
    ),
    JSON.stringify(dupKeeps)
  )
  check(
    '体检：都被引用的一份相同时也算重复（保留排序靠前的那份）',
    (report?.duplicates ?? []).some(
      (group) => group.keep === 'probe-ref-1.png' && group.drop.includes('probe-ref-2.png')
    ),
    JSON.stringify(dupKeeps)
  )
  check(
    '体检：报告里统计了可释放的字节数',
    (report?.orphanSize ?? 0) > 0 && (report?.duplicateSize ?? 0) > 0,
    JSON.stringify({ orphanSize: report?.orphanSize, duplicateSize: report?.duplicateSize })
  )
  check('体检：不动文件（报告阶段不该删东西）', existsSync(files.orphan) && existsSync(files.refDrop), '')

  /* ---------------------------------------------- 清理 */
  const result = await cdp.evaluate(
    `window.bookscent.library.cleanupAssets({ orphans: true, duplicates: true })`
  )
  console.log(
    `    清理结果 ${JSON.stringify({
      orphans: result?.removedOrphans,
      duplicates: result?.removedDuplicates,
      freed: result?.freed,
      repointed: result?.repointed
    })}`
  )
  check('清理：孤立文件被删掉了', !existsSync(files.orphan), 'probe-orphan.png 还在')
  check('清理：没人用的重复图也一起收拾干净', !existsSync(files.dupA) && !existsSync(files.dupB), '重复的孤立图还在')
  check('清理：被删的那一份没了', !existsSync(files.refDrop), 'probe-ref-2.png 还在')
  check('清理：留下的那一份还在', existsSync(files.refKeep), 'probe-ref-1.png 不见了')
  check('清理：释放的字节数不为 0', (result?.freed ?? 0) > 0, String(result?.freed))

  const after = await cdp.evaluate(
    `window.bookscent.settings.get().then((s) => s.bookStyle.spineImage)`
  )
  check('清理：设置里的引用改指到留下的那一份', after === 'asset:probe-ref-1.png', String(after))
  check('清理：改指计数不为 0', (result?.repointed ?? 0) > 0, String(result?.repointed))

  /* 再扫一次：测试文件应该都不在了 */
  const second = await cdp.evaluate(`window.bookscent.library.scanAssets()`)
  const left = (second?.orphans ?? []).map((item) => item.name).filter((n) => n.startsWith('probe-'))
  console.log(`    复扫剩下的测试文件 ${JSON.stringify(left)}`)
  check('清理：复扫之后没有测试文件残留', left.length === 0, JSON.stringify(left))

  /* ---------------------------------------------- 设置页上的入口 */
  await cdp.evaluate(`(() => {
    const b = [...document.querySelectorAll('button, [role=button]')]
      .find((el) => (el.getAttribute('title') || '').includes('设置') || (el.textContent || '').trim() === '设置')
    if (b) b.click()
    return Boolean(b)
  })()`)
  await delay(1800)
  await cdp.evaluate(`(() => {
    const el = [...document.querySelectorAll('button, [role=tab], .settings-tab, .set-tab-btn')]
      .find((b) => (b.textContent || '').trim() === '文件与数据')
    if (el) el.click()
    return Boolean(el)
  })()`)
  await delay(1200)
  const pane = await cdp.evaluate(`(() => {
    const text = document.querySelector('.set-tab')?.textContent || ''
    return { hasSection: text.includes('图片数据目录体检'), hasButton: text.includes('检查一遍') }
  })()`)
  console.log(`    设置页体检区 ${JSON.stringify(pane)}`)
  check('设置页：有「图片数据目录体检」一节与检查按钮', pane.hasSection && pane.hasButton, JSON.stringify(pane))

  await cdp.evaluate(`(() => {
    const b = [...document.querySelectorAll('button')].find((el) => (el.textContent || '').trim() === '检查一遍')
    if (b) b.click()
    return Boolean(b)
  })()`)
  await delay(2200)
  const shown = await cdp.evaluate(`document.querySelector('.assets-scan-line')?.textContent || ''`)
  console.log(`    报告行 ${JSON.stringify(shown.slice(0, 100))}`)
  check('设置页：点检查后显示出报告', shown.includes('仍在使用'), shown.slice(0, 80))
  await shot('130-assets-scan.png', 200)

  /* 收尾：把设置里的书脊图清掉，别让它带着测试引用 */
  await cdp.evaluate(`window.bookscent.settings.patch({ bookStyle: { spineImage: null }, noteStyle: { spineImage: null } })`)
  await delay(600)
  if (existsSync(files.refKeep)) unlinkSync(files.refKeep)
}
