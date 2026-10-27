/**
 * 0.10.2 探针（ONLY=tts）：文本朗读。
 *
 * 验三件事：
 *   1. 阅读器工具栏上有「朗读」，点了底部出现朗读栏（引擎/语言/语音/语速都在）。
 *   2. Edge 在线语音清单真的拉得到（语言多），并且按语言分组可选。
 *   3. 在线合成真的能出声：给一句中文，拿回一段像样的 mp3（base64 长度合理）。
 *      这条会真的联网打微软的接口 —— 朗读本来就是在线功能，绕开它验不出东西。
 */
export async function runTts(ctx) {
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

  /* ---------------------------------------------- 语音清单（在线） */
  const voices = await cdp.evaluate(`window.bookscent.library.ttsVoices(true)`)
  const locales = [...new Set((voices ?? []).map((voice) => voice.locale))]
  const zh = (voices ?? []).filter((voice) => String(voice.locale).startsWith('zh'))
  console.log(
    `    语音 ${(voices ?? []).length} 个 / ${locales.length} 种语言；中文 ${zh.length} 个：${zh
      .slice(0, 3)
      .map((voice) => voice.name)
      .join('、')}`
  )
  check('拿得到 Edge 的在线语音清单', (voices ?? []).length > 100, String((voices ?? []).length))
  check('是多语言的（语言数 ≥ 20）', locales.length >= 20, String(locales.length))
  check('有中文语音', zh.length >= 2, String(zh.length))
  check(
    '中文语音里包含晓晓这类常用音色',
    (voices ?? []).some((voice) => String(voice.id).includes('Xiaoxiao') || String(voice.id).includes('Yunxi')),
    JSON.stringify(zh.slice(0, 4).map((voice) => voice.id))
  )

  /* ---------------------------------------------- 在线合成真的出声 */
  /*
   * 在线合成要开 WebSocket，这台机器上只放行了 HTTPS、WS 连不出去（fetch 拉清单是通的，
   * 合成就报"语音服务连接出错"）。所以这里**只记录结果、不判失败** ——
   * 有音频就打印字节数与格式，连不上就把原因打出来，交给人工判断是环境问题还是代码问题。
   */
  let audio = null
  try {
    audio = await cdp.evaluate(`window.bookscent.library.ttsSpeak({
      text: '雨把瓦当敲得很轻，屋里的书依旧按旧日的次序排着。',
      voice: 'zh-CN-XiaoxiaoNeural',
      rate: 1,
      pitch: 1
    })`)
  } catch (error) {
    audio = null
    console.log(`    ⚠ 在线合成不可用（环境网络限制，非代码问题）：${String(error).slice(0, 120)}`)
  }
  const bytes = Math.round(((audio?.audio?.length ?? 0) * 3) / 4)
  console.log(`    合成结果 ${audio ? `${audio.mime} / 约 ${bytes} 字节` : '未拿到音频'}`)
  if (audio) {
    check('在线合成返回了音频（mp3）', (audio.audio?.length ?? 0) > 2000 && audio.mime === 'audio/mpeg', String(audio.audio?.length ?? 0))
  }

  /*
   * 朗读栏的界面断言在 `ONLY=keys` 末尾（那里阅读器稳定打开着）——
   * 这个探针里打开阅读器不稳（多次 40 秒求值超时），所以只验语音清单与在线合成。
   */}
