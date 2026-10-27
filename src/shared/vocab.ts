import type { VocabLanguage, WordEntry } from '@shared/types'

/**
 * 单词本的语言与"解析里的词汇"的解析。
 *
 * 为什么单独一个文件：主进程（存盘、去重）、渲染层（分组、加词）、
 * 以及翻译面板（把 AI 解析里那段词汇解析出来）都要用同一套规则 ——
 * 三处各自实现一遍必然会漂。
 */

/** 按字符集判断语种（有假名读音时优先据此判为日文）。判不出来的归 `other`（用户可以自己改）。 */
export function detectLanguage(term: string, reading = ''): VocabLanguage {
  const text = term.trim()
  if (!text) return 'other'
  /*
   * 单看一个汉字分不出中文还是日文（書 / 詩 两边都用）——
   * 但**读音是假名**就说明是日文。有读音时优先看读音，比按字符集猜准得多。
   */
  if (/[\u3040-\u309F\u30A0-\u30FF]/.test(reading)) return 'ja'
  if (/[\uAC00-\uD7AF\u1100-\u11FF\u3130-\u318F]/.test(text)) return 'ko'
  if (/[\u3040-\u309F\u30A0-\u30FF]/.test(text)) return 'ja'
  /* 有汉字但没假名：中文（纯汉字的日文词确实难分，交给用户改） */
  if (/[\u4E00-\u9FFF]/.test(text)) return 'zh'
  if (/[\u0400-\u04FF]/.test(text)) return 'ru'
  if (/[\u0600-\u06FF]/.test(text)) return 'ar'
  if (/[A-Za-z]/.test(text)) return 'en'
  return 'other'
}

export const VOCAB_LANGUAGE_LABEL: Record<VocabLanguage, string> = {
  ja: '日语',
  zh: '中文',
  en: '英语',
  ko: '韩语',
  fr: '法语',
  de: '德语',
  es: '西班牙语',
  ru: '俄语',
  ar: '阿拉伯语',
  other: '其他'
}

/**
 * 去重键：**只看词形**，不看语种。
 *
 * 原因：同一个词从不同来源进来时语种判断可能不一致 —— 比如「詩」带假名读音判为日语、
 * 不带读音就判成中文。若键里带语种，这同一个词就会变成两条。词形相同即同一个词，
 * 语种以先入的那条为准（用户也能手动改）。
 */
export function vocabKey(term: string): string {
  return term.trim().toLowerCase()
}

/**
 * 解析块的分隔体。AI 的解析是 Markdown，中间可能夹着任何东西，
 * 所以约定一个**独占一行**的标记，后面的每行一条词，竖线分隔：
 *
 * ```
 * [[VOCAB]]
 * 詩|し|诗，诗歌|word
 * 湿度が高い|しつどがたかい|湿度高|phrase
 * ```
 */
export const VOCAB_MARKER = '[[VOCAB]]'

export interface ParsedVocabWord {
  term: string
  reading: string
  meaning: string
  kind: 'word' | 'phrase'
}

/** 从 AI 解析里取出词汇表（没有标记就返回空数组，不影响原有 Markdown 展示） */
export function parseVocabBlock(analysis: string | undefined): ParsedVocabWord[] {
  if (!analysis) return []
  const at = analysis.indexOf(VOCAB_MARKER)
  if (at < 0) return []
  const tail = analysis.slice(at + VOCAB_MARKER.length)
  const words: ParsedVocabWord[] = []
  for (const raw of tail.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) continue
    /* 遇到新的标题/围栏就收工：词汇表只到下一个块为止 */
    if (/^#{1,6}\s/.test(line) || line.startsWith('```') || line.startsWith('[')) break
    const cells = line.split('|').map((cell) => cell.trim())
    if (cells.length < 3) continue
    const [rawTerm, rawReading, rawMeaning, kind] = cells

    /*
     * 模型不一定老实：常见两种走样——
     *   1. 把释义写进了第一列（`infléchir：使转向、改变`），
     *   2. 把释义写进了第二列（读音那格），于是面板上"读音"显示成「趋势、进程」。
     * 所以这里对列做一次纠正，而不是照单全收。
     */
    let term = rawTerm.trim()
    let meaning = (rawMeaning ?? '').trim()
    let reading = (rawReading ?? '').trim()

    /* 第一列里带冒号：冒号前才是词形，后面是释义 */
    const colon = findColon(term)
    if (colon > 0) {
      const tail = term.slice(colon + 1).trim().replace(/[、，,;；:：。]+$/, '')
      term = term.slice(0, colon).trim()
      if (tail && !meaning.includes(tail)) meaning = meaning ? `${tail}；${meaning}` : tail
    }
    /* 词形去掉行尾标点与包裹引号 */
    term = term
      .replace(/^[「『“"]|[」』”"]$/g, '')
      .replace(/[、，,;；:：。]+$/, '')
      .trim()
    if (!term || !meaning) continue

    /* 第二列不像读音（含中文且没有假名/音标）→ 它是释义的一部分，接在后面 */
    if (reading && reading !== '-' && !looksLikeReading(reading) && /[\u4E00-\u9FFF]/.test(reading)) {
      meaning = meaning ? `${meaning}；${reading}` : reading
      reading = ''
    }
    words.push({
      term,
      reading: reading === '-' ? '' : reading,
      meaning,
      kind: kind === 'phrase' ? 'phrase' : 'word'
    })
    if (words.length >= 40) break
  }
  return words
}

/** 把解析里的词汇表从正文里剔掉（面板上单独渲染成表格，避免重复显示） */
export function stripVocabBlock(analysis: string | undefined): string {
  if (!analysis) return ''
  const at = analysis.indexOf(VOCAB_MARKER)
  return at < 0 ? analysis : analysis.slice(0, at).trimEnd()
}

/**
 * 解析"第二步抽词"返回的 JSON。
 *
 * 为什么现在走 JSON：之前词汇表跟译文挤在同一次请求里、要求模型最后附一段 Markdown 表格，
 * 模型经常写走样（释义进词形、多词短语被拆、难句混进来）。改成**第二次请求专门抽词**、
 * 只让它回一个 JSON 对象之后，格式就稳了 —— 不用再猜 Markdown 的排版。
 *
 * 容错：允许 `{words:[…]}`、`{vocabulary:[…]}`，也允许直接是一个数组；
 * 每个词条还允许用 `word/term/en`、`gloss/meaning/zh`、`kana/reading/ipa` 这些别名。
 */
export function parseVocabJson(raw: string | undefined): ParsedVocabWord[] {
  if (!raw) return []
  const text = raw.trim()
  if (!text) return []

  const pickArray = (value: unknown): unknown[] | null => {
    if (Array.isArray(value)) return value
    if (value && typeof value === 'object') {
      const obj = value as Record<string, unknown>
      for (const key of ['words', 'vocabulary', 'vocab', 'items', 'list', 'entries']) {
        if (Array.isArray(obj[key])) return obj[key] as unknown[]
      }
    }
    return null
  }

  const readJson = (text: string): unknown => {
    try {
      return JSON.parse(text)
    } catch {
      /* 模型偶尔会包一层 ```json … ``` 或前后多写一句话：从第一个 { 或 [ 截到最后一个 } 或 ] */
      const start = text.search(/[[{]/)
      const endBrace = text.lastIndexOf('}')
      const endBracket = text.lastIndexOf(']')
      const end = Math.max(endBrace, endBracket)
      if (start < 0 || end <= start) return null
      try {
        return JSON.parse(text.slice(start, end + 1))
      } catch {
        return null
      }
    }
  }

  const array = pickArray(readJson(text))
  if (!array) return []

  const words: ParsedVocabWord[] = []
  for (const raw of array) {
    if (!raw || typeof raw !== 'object') continue
    const item = raw as Record<string, unknown>
    const str = (keys: string[]): string => {
      for (const key of keys) {
        const value = item[key]
        if (typeof value === 'string' && value.trim()) return value.trim()
      }
      return ''
    }
    let term = str(['term', 'word', 'headword', 'en', 'original'])
    let reading = str(['reading', 'kana', 'ipa', 'pron', 'pronunciation', 'transcription'])
    let meaning = str(['meaning', 'gloss', 'zh', 'translation', 'definition', 'sense'])
    const kind = str(['kind', 'type']).toLowerCase() === 'phrase' ? 'phrase' : 'word'

    /* 与表格那套一样做一次纠正：词形里带冒号就拆开；"读音"其实是说明就并回释义 */
    const colon = findColon(term)
    if (colon > 0) {
      const tail = term.slice(colon + 1).trim().replace(/[、，,;；:：。]+$/, '')
      term = term.slice(0, colon).trim()
      if (tail && !meaning.includes(tail)) meaning = meaning ? `${tail}；${meaning}` : tail
    }
    term = term.replace(/^[「『“"]|[」』”"]$/g, '').replace(/[、，,;；:：。]+$/, '').trim()
    if (!term || !meaning) continue
    if (reading && !looksLikeReading(reading) && /[\u4E00-\u9FFF]/.test(reading)) {
      meaning = `${meaning}；${reading}`
      reading = ''
    }
    words.push({ term, reading, meaning, kind })
    if (words.length >= 40) break
  }
  return words
}

/** 新建一条词条 */
export function makeWordEntry(
  input: {
    term: string
    reading?: string
    meaning: string
    kind?: 'word' | 'phrase'
    language?: VocabLanguage
  },
  extra: { source?: string; bookId?: string } = {}
): WordEntry {
  const term = input.term.trim()
  const language = input.language ?? detectLanguage(term, (input.reading ?? '').trim())
  const now = Date.now()
  return {
    id: `w_${now.toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    term,
    reading: (input.reading ?? '').trim(),
    meaning: input.meaning.trim(),
    language,
    kind: input.kind ?? (term.includes(' ') || term.length > 6 ? 'phrase' : 'word'),
    source: extra.source ?? '',
    bookId: extra.bookId ?? '',
    note: '',
    createdAt: now,
    updatedAt: now
  }
}

/**
 * 从**普通 Markdown 解析**里提取词汇（兜底）。
 *
 * 模型的实际输出有四种样子，全都得认：
 *
 * 1. 列表式（一行一词、冒号分隔）：
 *    ```
 *    - 期間中（きかんちゅう）：期间、活动期间。
 *    ```
 * 2. **散文式**（一整段、分号连排）：
 *    ```
 *    词汇：呼び捨て（よびすて）指不加敬称直呼姓名；同い年（おないどし）指同岁。
 *    ```
 * 3. **带书名号/引号的一行一条**（释义里还带分号，绝不能按分号切）：
 *    ```
 *    「呼び捨て（よびすて）」：不加敬称直呼姓名，此处指省去「さん」。
 *    「さんづけ」「ちゃんづけ」：名字后加「さん」「ちゃん」的称呼方式；「づけ」为「付け」的连浊。
 *    ```
 * 4. **标记词很花**（不是"指"，而是"此处指 / 生物学 / 人类学意义的 / 为"）：
 *    ```
 *    词汇：organisme 此处指"生物体"，非"机构"；espèce 生物学"物种"；culture 此处为人类学意义的"文化"。
 *    ```
 *
 * 所以策略是：
 *   - 先把「词汇：…」这一节截出来（到 难句/语法 为止）；
 *   - 这一节**有多行就按行切**（一行一条最可靠，释义里的分号不会被误切）；
 *     只有单行（散文）时才按 `；;。` 切；
 *   - 每条再拆：引号/书名号里的词优先；否则取"开头到第一个标记词"为词，
 *     标记词之后（去掉引号）为释义。
 */

/** 词前面可能出现的"标记词"：到这里为止是词，往后是释义 */
const MARK_WORDS =
  /^(.{1,30}?)\s*(?:此处指|此处为|在这里指|本句指|本句中|指|意为|意即|表示|意思是|相当于|即|为|是)\s*(.{2,})$/

/**
 * 找到"原词"与"释义"之间的那个冒号。
 *
 * 只看**第一个**冒号，且要求它足够靠前（冒号前的词形一般不超过 30 字）——
 * 免得把释义里的「比如：」「意思是：」也当成分隔。
 */
function findColon(text: string): number {
  const cn = text.indexOf('：')
  const en = text.indexOf(':')
  const at = cn < 0 ? en : en < 0 ? cn : Math.min(cn, en)
  if (at <= 0 || at > 30) return -1
  return at
}

/**
 * 清理冒号左边那截，得到干净的原词。
 *
 * - 去掉书名号/引号（「呼び捨て」→ 呼び捨て）；
 * - 去掉行尾的逗号、顿号、分号、冒号（用户报的第一例就是 `infléchir：使转向、改变，` 带了逗号）；
 * - 括号里的说明性内容（不是读音的那种）剥出来交给释义，不留进词形里。
 */
function cleanHead(raw: string): string {
  let head = raw
    .replace(/[「『“”"”]/g, '')
    .replace(/[」』]/g, '')
    .trim()
    .replace(/^[、，,;；:：\s]+/, '')
    .replace(/[、，,;；:：。]+$/, '')
    .trim()
  /* 明显的句子不是词形：含句号或逗号的一律不算 */
  if (/[。，,;；]/.test(head)) return ''
  head = head.replace(/\s+/g, ' ').trim()
  if (!head || head.length > 30) return ''
  return head
}

/** 括号里的东西像不像"读音"（假名 / 音标 / 拼音）；不像就说明是释义，要留在释义里 */
function looksLikeReading(inner: string): boolean {
  if (/^[\u3040-\u309F\u30A0-\u30FFー・\s]+$/.test(inner)) return true
  if (/^[ˈˌa-zəˈɪʊːæɑɒɔɜʌŋθðʃʒ.\-'\s]+$/i.test(inner) && /[a-z]/i.test(inner)) return true
  return false
}

/** 去掉包裹词的书名号/引号，并取出里面的读音 */
function splitQuoted(part: string): { term: string; reading: string } | null {
  const quoted = [...part.matchAll(/[「『"“]([^」』"”]{1,24})[」』"”]/g)].map((match) => match[1].trim())
  if (quoted.length > 0) {
    const term = quoted.join('／')
    const inner = /[（(]([^）)]{1,24})[）)]/.exec(quoted[0])
    const reading = inner ? inner[1].trim() : ''
    return { term: term.replace(/[（(][^）)]*[）)]/g, '').trim(), reading }
  }
  return null
}

/** 解析一行 / 一段：原词（读音）标记 释义 */
function parseEntry(chunk: string): ParsedVocabWord | null {
  const text = chunk
    .trim()
    .replace(/^[-*・•]\s*/, '')
    .replace(/^\d+[.、)]\s*/, '')
    .trim()
  if (text.length < 3) return null

  /*
   * A0) **冒号式优先**：`原词：释义`。
   *
   * 这条必须排在所有启发式规则之前，尤其是「字母词 + 空格」那条 ——
   * 否则 `coup d’envoi：开球、开端…` 会被劈成 `coup` / `d’envoi：…`，
   * `mettre fin à：终结、结束。` 会被劈成 `mettre fin` / `à：…`（用户报的就是这两例）。
   * 冒号左边通常就是完整词形（多词短语也整条保留），右边整段是释义。
   */
  const colon = findColon(text)
  if (colon > 0) {
    const head = cleanHead(text.slice(0, colon))
    const gloss = text.slice(colon + 1).trim()
    if (head && gloss.length >= 2) {
      /* 括号里的假名/音标当读音，其余（中文说明）留在释义里 */
      const paren = /[（(]([^）)]{1,24})[）)]/.exec(head)
      const inner = paren ? paren[1].trim() : ''
      const isReading = inner.length > 0 && looksLikeReading(inner)
      return {
        term: isReading ? head.replace(paren![0], '').trim() : head,
        reading: isReading ? inner : '',
        meaning: gloss,
        kind: (isReading ? head.replace(paren![0], '') : head).includes(' ') ? 'phrase' : 'word'
      }
    }
  }

  /* A) 引号包裹的词：……「词（音）」：释义  /  「词」：释义 */
  const quotedHead = /^([「『"“][^」』"”]*[」』"”](?:\s*[「『"“][^」』"”]*[」』"”])*)\s*[：:]?\s*(.*)$/.exec(text)
  if (quotedHead) {
    const termPart = splitQuoted(quotedHead[1])
    if (termPart && termPart.term) {
      const rest = quotedHead[2].trim()
      /* 释义也可能用引号包着，或者干脆在括号外 */
      const meaning = rest.replace(/[「」『』"“”]/g, '').replace(/^[：:，,\s]+/, '').trim()
      if (meaning.length >= 2) {
        return { term: termPart.term, reading: termPart.reading, meaning, kind: termPart.term.includes(' ') ? 'phrase' : 'word' }
      }
    }
  }

  /* B) 有括号读音 + 冒号：原词（读音）：释义 */
  let match = /^(.{1,24}?)[（(]([^）)]{1,24})[）)]\s*[：:]\s*(.{2,})$/.exec(text)
  if (match) {
    return { term: match[1].trim(), reading: match[2].trim(), meaning: match[3].trim(), kind: 'word' }
  }

  /* C) 标记词（指/此处指/意为/为/是…）：原词 标记 释义 */
  match = MARK_WORDS.exec(text)
  if (match) {
    const term = match[1].replace(/^[「『"“]|[」』"”]$/g, '').trim()
    const inner = /[（(]([^）)]{1,24})[）)]/.exec(term)
    const meaning = match[2].replace(/[「」『』"“”]/g, '').replace(/^[：:，,\s]+/, '').trim()
    if (term.length >= 1 && meaning.length >= 2) {
      return {
        term: term.replace(/[（(][^）)]*[）)]/g, '').trim(),
        reading: inner ? inner[1].trim() : '',
        meaning,
        kind: term.includes(' ') ? 'phrase' : 'word'
      }
    }
  }

  /* D) 原词（释义）—— 括号里不是假名/音标时就是释义（法语输出常见） */
  match = /^(.{1,24}?)[（(]([^）)]{1,40})[）)]\s*$/.exec(text)
  if (match) {
    const inner = match[2].trim()
    const isReading =
      /^[\u3040-\u309F\u30A0-\u30FFー・\s]+$/.test(inner) || /^[ˈˌa-zəˈɪʊːæɑɒɔɜʌŋθðʃʒ. \-']+$/i.test(inner)
    if (!isReading) return { term: match[1].trim(), reading: '', meaning: inner, kind: 'word' }
  }

  /*
   * F) 兜底：词在前、释义在后，中间是任意"说明性字眼"（生物学 / 人类学 / 此处 / 口语 / 贬义…）。
   * 法语输出里常见：`espèce 生物学"物种"` —— 标记词不是"指/意为"，前面的规则都接不住。
   * 取开头的**字母词**（1–3 个词，含重音字母）当原词，其余当释义，并把说明性字眼去掉。
   */
  match = /^([A-Za-zÀ-ÖØ-öø-ÿĀ-ž·'’-]+(?:\s+[A-Za-zÀ-ÖØ-öø-ÿĀ-ž·'’-]+){0,2})\s+(.{2,})$/.exec(text)
  if (match) {
    const meaning = match[2]
      .replace(/^[，,\s]+/, '')
      .replace(/^(?:此处|这里|本句|生物学|人类学|口语|书面语|贬义|褒义|音标|复数|略语)(?:意义上?|中的?)?\s*/, '')
      .replace(/[「」『』"“”]/g, '')
      .trim()
    if (meaning.length >= 2) {
      return { term: match[1].trim(), reading: '', meaning, kind: match[1].includes(' ') ? 'phrase' : 'word' }
    }
  }
  /* E) 冒号式：原词（读音）：释义 / 原词：释义 */
  match = /^(.{1,24}?)[（(]([^）)]{1,24})[）)]\s*[：:]\s*(.{2,})$/.exec(text)
  if (match) {
    return { term: match[1].trim(), reading: match[2].trim(), meaning: match[3].trim(), kind: 'word' }
  }
  match = /^(.{1,20}?)\s*[：:]\s*(.{2,})$/.exec(text)
  if (match) {
    const inner = /[（(]([^）)]{1,24})[）)]/.exec(match[1])
    return {
      term: match[1].replace(/[（(][^）)]*[）)]/g, '').trim(),
      reading: inner ? inner[1].trim() : '',
      meaning: match[2].trim(),
      kind: 'word'
    }
  }
  return null
}

export function parseMarkdownVocab(analysis: string | undefined): ParsedVocabWord[] {
  if (!analysis) return []
  const text = analysis.replace(/\r\n/g, '\n')

  /* 1) 截出词汇那一节 */
  const sectionMatch = /(?:^|\n)\s*(?:[-*]\s*)?(?:\*\*)?(?:词汇|单词|語彙|単語|Vocabulary)(?:\*\*)?\s*[：:]?\s*/i.exec(text)
  if (!sectionMatch) return []
  const from = sectionMatch.index + sectionMatch[0].length
  const rest = text.slice(from)
  /*
   * 截到"难句/语法…"那一节为止。
   * 边界不能只认换行：解析常是「…句子。 难句：…」这样连排的，
   * 只按 \n 找就会把难句里的句子也当成词汇收进来（用户报过这个）。
   */
  const stopMatch = /(?:^|[\n。；;])\s*(?:[-*]\s*)?(?:\*\*)?(?:难句|语法|语感|注释|说明|用法|读音|翻译技巧)(?:\*\*)?\s*[：:]/i.exec(rest)
  const section = stopMatch ? rest.slice(0, stopMatch.index) : rest

  /* 2) 有换行就按行切（一行一条，释义里的分号不会被误切）；单行才按标点切 */
  const lines = section
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
  const chunks: string[] = []
  if (lines.length > 1) {
    for (const line of lines) {
      /* 一行里若明显塞了多条（有多个分号且都不在引号里），再细切 */
      if (/[；;]/.test(line) && (line.match(/[「『"“]/g) ?? []).length === 0) {
        chunks.push(...line.split(/[；;]+/))
      } else {
        chunks.push(line)
      }
    }
  } else {
    chunks.push(...(lines[0] ?? section).split(/[；;。]+/))
  }

  const words: ParsedVocabWord[] = []
  for (const chunk of chunks) {
    const entry = parseEntry(chunk)
    if (!entry || !entry.term || !entry.meaning) continue
    words.push(entry)
    if (words.length >= 40) break
  }
  return words
}
