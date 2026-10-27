/**
 * 朗读前的文本清洗。
 *
 * 日文书的注音有三种常见写法，只处理 `<rt>` 是不够的（用户反馈"又出现了"）：
 *
 *   1. HTML ruby：`<ruby>漢字<rt>かんじ</rt></ruby>` —— 取文本时已经跳过 `<rt>`；
 *   2. 青空文库式：`｜漢字《かんじ》` 或 `漢字《かんじ》` —— 竖线是范围标记，书名号里是读音；
 *   3. 括号式：`漢字（かんじ）` / `漢字(かんじ)` —— 括号里是读音。
 *
 * 后两种在没有 ruby 标记的书里就是**正文的一部分**，念出来会重复、也会让逐句高亮对不上。
 * 所以这里按"形态"去掉：只要括号/书名号里的内容**全是假名**（不含汉字、数字、拉丁字母），
 * 就当成读音删掉。真正有意义的括号（比如「（笑）」）含汉字或不是纯假名，会保留。
 *
 * 另外把竖排书里常见的 `｜` 范围标记也去掉，并压平多余空白。
 */

const KANA_ONLY = /^[\u3040-\u309F\u30A0-\u30FF\u30FC\u3005ー〜・\s]+$/

/** 一个字符串是不是"纯假名"（读音的特征：没有汉字、没有数字和拉丁字母） */
function isKanaOnly(text: string): boolean {
  return text.length > 0 && text.length <= 24 && KANA_ONLY.test(text)
}

export function cleanSpeechText(input: string): string {
  let text = input
  /* 青空文库的注音标记：｜汉字《かな》 / 汉字《かな》 */
  text = text.replace(/｜/g, '')
  text = text.replace(/《([^》]{1,24})》/g, (whole, inner: string) => (isKanaOnly(inner) ? '' : whole))
  /* 括号注音：（かな） / (かな) / ［かな］ */
  text = text.replace(/[（(［\[]([^）)］\]]{1,24})[）)］\]]/g, (whole, inner: string) =>
    isKanaOnly(inner) ? '' : whole
  )
  /* 全角/半角空白压平，但保留换行（朗读引擎会当停顿） */
  text = text.replace(/[ \t\u3000]+/g, ' ')
  return text.replace(/\s*\n\s*/g, '\n').trim()
}
