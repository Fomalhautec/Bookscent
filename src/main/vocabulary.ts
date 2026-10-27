import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app } from 'electron'
import type { WordEntry } from '@shared/types'
import { makeWordEntry, vocabKey } from '@shared/vocab'
import { logLine } from './log'

/**
 * 单词本存盘。
 *
 * 单独一个文件（`vocabulary.json`），不塞进设置也不塞进书籍索引：
 *   - 词条会越积越多，塞进 settings 会让每次改设置都重写一大坨；
 *   - 它跟"书"没关系（可以来自翻译、也可以手敲），不属于书籍索引。
 *
 * 写入是"读-改-写"整份文件：词条量级在几千条以内，够用且简单；
 * 真要上十万条再换 SQLite。
 */

function vocabFile(): string {
  return join(app.getPath('userData'), 'vocabulary.json')
}

async function readAll(): Promise<WordEntry[]> {
  try {
    const raw = await readFile(vocabFile(), 'utf8')
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (item): item is WordEntry =>
        Boolean(item) && typeof (item as WordEntry).id === 'string' && typeof (item as WordEntry).term === 'string'
    )
  } catch {
    /* 文件不存在或坏了：当成空本子，不阻断应用 */
    return []
  }
}

async function writeAll(list: WordEntry[]): Promise<void> {
  await writeFile(vocabFile(), JSON.stringify(list, null, 2), 'utf8')
}

export async function listWords(): Promise<WordEntry[]> {
  const list = await readAll()
  /* 新的在前 */
  return list.sort((a, b) => b.createdAt - a.createdAt)
}

export interface AddWordInput {
  term: string
  reading?: string
  meaning: string
  kind?: 'word' | 'phrase'
  language?: WordEntry['language']
  source?: string
  bookId?: string
  note?: string
}

/**
 * 加词：同语言同词形**合并**而不是报错 ——
 * 从不同书里遇到同一个词很常见，合并时补全空的释义/读音，并保留最早来源。
 */
export async function addWord(input: AddWordInput): Promise<{ entry: WordEntry; merged: boolean }> {
  const entry = makeWordEntry(input, { source: input.source, bookId: input.bookId })
  if (!entry.term || !entry.meaning) throw new Error('词条需要同时有原词和释义')
  const list = await readAll()
  const key = vocabKey(entry.term)
  const existing = list.find((item) => vocabKey(item.term) === key)
  if (existing) {
    const next: WordEntry = {
      ...existing,
      reading: existing.reading || entry.reading,
      meaning: existing.meaning || entry.meaning,
      note: existing.note || entry.note,
      source: existing.source || entry.source,
      bookId: existing.bookId || entry.bookId,
      updatedAt: Date.now()
    }
    await writeAll(list.map((item) => (item.id === existing.id ? next : item)))
    logLine('vocab', `合并已有词条 ${next.term}`)
    return { entry: next, merged: true }
  }
  list.push(entry)
  await writeAll(list)
  logLine('vocab', `新增词条 ${entry.term}（${entry.language}）`)
  return { entry, merged: false }
}

/** 批量加词（翻译解析里的词汇表"全部加入"用） */
export async function addWords(inputs: AddWordInput[]): Promise<{ added: number; merged: number }> {
  let added = 0
  let merged = 0
  for (const input of inputs) {
    try {
      const result = await addWord(input)
      if (result.merged) merged += 1
      else added += 1
    } catch (error) {
      logLine('vocab', `批量加词跳过一条：${String(error)}`)
    }
  }
  return { added, merged }
}

export async function updateWord(
  id: string,
  patch: Partial<Pick<WordEntry, 'term' | 'reading' | 'meaning' | 'language' | 'kind' | 'note'>>
): Promise<WordEntry | null> {
  const list = await readAll()
  const target = list.find((item) => item.id === id)
  if (!target) return null
  const next: WordEntry = {
    ...target,
    ...patch,
    term: (patch.term ?? target.term).trim(),
    meaning: (patch.meaning ?? target.meaning).trim(),
    reading: (patch.reading ?? target.reading).trim(),
    updatedAt: Date.now()
  }
  if (!next.term) return target

  /*
   * 改原词时可能撞上已有的词条（比如把「infléchir：使转向…」这种脏数据改成正常的 infléchir，
   * 而正常的 infléchir 已经在本子里）。这时候**合并**，不要留两条一样的词：
   * 合并规则与"从解析里加词"一致 —— 已有的释义/读音不被空值覆盖，备注两边都留。
   */
  const key = vocabKey(next.term)
  const clash = list.find((item) => item.id !== id && vocabKey(item.term) === key)
  if (clash) {
    const merged: WordEntry = {
      ...clash,
      reading: next.reading || clash.reading,
      meaning: next.meaning || clash.meaning,
      note: [clash.note, next.note].filter(Boolean).join(' / ') || '',
      language: patch.language ?? clash.language,
      updatedAt: Date.now()
    }
    /* 先把撞车的那条去掉，再把当前这条替换成合并结果 */
    await writeAll(list.filter((item) => item.id !== clash.id).map((item) => (item.id === id ? merged : item)))
    logLine('vocab', `改原词撞上已有词条，已合并：${next.term}`)
    return merged
  }

  await writeAll(list.map((item) => (item.id === id ? next : item)))
  return next
}

export async function removeWord(id: string): Promise<boolean> {
  const list = await readAll()
  const next = list.filter((item) => item.id !== id)
  if (next.length === list.length) return false
  await writeAll(next)
  return true
}

export async function clearWords(): Promise<number> {
  const list = await readAll()
  await writeAll([])
  return list.length
}
