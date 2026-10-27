/**
 * 解析器的离线验算（不属于交付物，但可复现）。
 *
 * 用法（两步）：
 *   pnpm exec esbuild src/shared/vocab.ts --format=esm --platform=node --outfile=scripts/vocab.mjs
 *   node scripts/check-vocab-parse.mjs
 *
 * 验三件事：散文式解析（用户贴的那段原文）、[[VOCAB]] 表格的错列纠正、
 * 以及**第二步抽词**返回的 JSON（含代码围栏/裸数组/错列/乱码等形态）。
 */
import { parseMarkdownVocab, parseVocabBlock, parseVocabJson } from './vocab.mjs'

const plain = `infléchir：使转向、改变（趋势、进程），本句指改变历史进程。 coup d’envoi：开球、开端，donner le coup d’envoi à 意为“为……揭开序幕”。 amorcer：启动、开启（过程），本句指开启某种全新的东西。 mettre fin à：终结、结束。 organisme：生物、有机体（上下文语境为生物学意义上的生物）。`

const withHeading = `**词汇**：${plain}

**难句**：这是一句很长的话，讲的是把历史推向另一个方向，并非字面意义的"踢一脚"。`

const block = `解析如下。

[[VOCAB]]
infléchir：使转向、改变|趋势、进程|改变历史进程|word
coup d’envoi|-|开球、开端|phrase
mettre fin à|-
organisme|生物、有机体|生物学意义的生物|word`

let failures = 0

const show = (label, list) => {
  console.log(`\n== ${label}（${list.length} 条）==`)
  for (const w of list) {
    console.log(`  原词=${JSON.stringify(w.term)}  读音=${JSON.stringify(w.reading)}  释义=${JSON.stringify(w.meaning)}  ${w.kind}`)
  }
}

show('散文式（用户那段）', parseMarkdownVocab(withHeading))

const expect = ['infléchir', 'coup d’envoi', 'mettre fin à', 'organisme']
const got = parseMarkdownVocab(withHeading).map((w) => w.term)
const missing = expect.filter((t) => !got.includes(t))
if (missing.length) failures += 1
console.log(`\n期望原词都在：${missing.length === 0 ? '是' : '缺 ' + JSON.stringify(missing)}`)
const leaked = parseMarkdownVocab(withHeading).some((w) => /难句|并非字面/.test(w.meaning) || /难句/.test(w.term))
if (leaked) failures += 1
console.log(`难句没混进词汇：${leaked ? '否（混进来了）' : '是'}`)

show('[[VOCAB]] 块（含错列）', parseVocabBlock(block))


/* ------------------------------- 第二步：抽词接口回的是 JSON（新方案） ------------------------------- */

const jsonCases = [
  ['标准对象', '{"words":[{"term":"infléchir","reading":"","meaning":"使转向、改变","kind":"word"},{"term":"coup d’envoi","reading":"","meaning":"开球、开端","kind":"phrase"}]}'],
  ['带代码围栏', '```json\n{"words":[{"term":"amorcer","reading":"","meaning":"启动、开启","kind":"word"}]}\n```'],
  ['裸数组', '[{"term":"mettre fin à","reading":"","meaning":"终结、结束","kind":"phrase"}]'],
  ['词形里混了解释', '{"words":[{"term":"organisme：生物、有机体，","reading":"","meaning":"生物学意义上的生物","kind":"word"}]}'],
  ['释义写进读音列', '{"words":[{"term":"espèce","reading":"物种","meaning":"生物学物种","kind":"word"}]}'],
  ['空回复', '']
]
for (const [label, raw] of jsonCases) {
  const words = parseVocabJson(raw)
  console.log(`  ${label} → ${JSON.stringify(words.map((w) => [w.term, w.reading, w.meaning]))}`)
}
const std = parseVocabJson(jsonCases[0][1])
if (std.length !== 2 || std[1].term !== 'coup d’envoi') {
  console.error('JSON 解析（标准对象 / 多词短语）不对')
  failures += 1
}
const dirty = parseVocabJson(jsonCases[3][1])
if (dirty[0]?.term !== 'organisme' || !dirty[0]?.meaning.includes('生物学')) {
  console.error('JSON 解析（词形里混解释）没有纠正')
  failures += 1
}
const readingFix = parseVocabJson(jsonCases[4][1])
if (readingFix[0]?.reading !== '' || !readingFix[0]?.meaning.includes('物种')) {
  console.error('JSON 解析（释义写进读音列）没有纠正')
  failures += 1
}
if (parseVocabJson('实在没有 JSON').length !== 0) {
  console.error('JSON 解析对乱码应返回空')
  failures += 1
}
if (failures > 0) {
  console.error(`解析验算未通过（${failures} 项）`)
  process.exitCode = 1
} else {
  console.log('解析验算通过')
}
