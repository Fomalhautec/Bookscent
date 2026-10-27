import { create } from 'zustand'
import type { TranslateHistoryEntry, TranslateResult } from '@shared/types'
import type { ParsedVocabWord } from '@shared/vocab'
import { libraryApi } from '@/lib/api'

export interface TranslateEntry {
  id: string
  source: string
  context: string[]
  result: TranslateResult | null
  loading: boolean
  /** 界面自己的报错（网络层）与 result.error 分开：后者是接口说的 */
  error: string | null
  /** 第二步抽出来的词（单独一次请求，只回 JSON） */
  words?: ParsedVocabWord[]
  wordsLoading?: boolean
  wordsError?: string | null
  at: number
}

interface TranslateState {
  open: boolean
  /** 当前展示的那条 */
  current: TranslateEntry | null
  /** 最近几条，点一下切回来 */
  history: TranslateEntry[]
  setOpen: (open: boolean) => void
  toggle: () => void
  /** 翻一段：没有现成的结果就发请求 */
  run: (source: string, context: string[]) => Promise<void>
  /** 换一条历史 */
  show: (id: string) => void
  /** 第二步抽词：对当前这条重新提取（翻译成功后也会自动跑一次） */
  extractWords: () => Promise<void>
  /** 删掉一条记录 */
  remove: (id: string) => void
  clear: () => void
  /** 启动时把盘上的记录读回来（保留策略已在主进程执行过） */
  loadHistory: () => Promise<void>
}

const HISTORY_LIMIT = 12

function newId(): string {
  return `tr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`
}

/**
 * 翻译的界面状态。
 *
 * 放在 store 而不是阅读器组件里：右侧栏、选中工具条、设置页都要读同一份，
 * 而且换章、切排版时阅读器会重挂载，结果不该跟着丢（这是"读一段外语"的连续动作）。
 */
export const useTranslate = create<TranslateState>((set, get) => ({
  open: false,
  current: null,
  history: [],

  setOpen: (open) => set({ open }),
  toggle: () => set((state) => ({ open: !state.open })),

  run: async (source, context) => {
    const text = source.trim()
    if (!text) return
    const entry: TranslateEntry = {
      id: newId(),
      source: text,
      context,
      result: null,
      loading: true,
      error: null,
      at: Date.now()
    }
    /* 先把面板打开并显示"正在翻译"，用户的动作要立刻有反应 */
    set((state) => ({
      open: true,
      current: entry,
      history: [entry, ...state.history].slice(0, HISTORY_LIMIT)
    }))

    try {
      const result = await libraryApi.translate({ text, context })
      const next: TranslateEntry = { ...entry, result, loading: false, error: null }
      set((state) => ({
        current: state.current?.id === entry.id ? next : state.current,
        history: state.history.map((item) => (item.id === entry.id ? next : item))
      }))
      /* 成功了才写盘（设置里选"从不清除"时这就是全部记录） */
      persist(get().history, targetOf(result))
      /*
       * 第二步：翻译完成之后再单独发一次请求抽词。
       * 不挡住译文显示（异步跑），失败也只在自己那一行提示，不影响已经拿到的译文。
       */
      void get().extractWords()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const next: TranslateEntry = { ...entry, loading: false, error: message }
      set((state) => ({
        current: state.current?.id === entry.id ? next : state.current,
        history: state.history.map((item) => (item.id === entry.id ? next : item))
      }))
    }
  },

  show: (id) => {
    const hit = get().history.find((item) => item.id === id)
    if (hit) set({ current: hit })
  },

  /**
   * 第二步抽词。
   *
   * 为什么单独一次请求：词汇表如果跟译文挤在同一次请求里（还要求模型附一段 Markdown 表格），
   * 模型几乎每次都会写走样 —— 释义跑进词形、多词短语按空格拆开、难句混进来。
   * 这次请求只让它挑词、只回 JSON，并且能看到译文，判断"本句中的意思"更准。
   */
  extractWords: async () => {
    const entry = get().current
    const result = entry?.result
    if (!entry || !result || !result.ok) return
    const patch = (next: Partial<TranslateEntry>): void => {
      set((state) => ({
        current: state.current?.id === entry.id ? { ...state.current, ...next } : state.current,
        history: state.history.map((item) => (item.id === entry.id ? { ...item, ...next } : item))
      }))
    }
    patch({ wordsLoading: true, wordsError: null })
    try {
      const extracted = await libraryApi.translateVocab({
        source: entry.source,
        translation: result.translation,
        analysis: result.analysis
      })
      if (!extracted.ok) {
        /*
         * 抽词失败时退回"从解析里解析出来的词"（老提示词还会在解析末尾附 [[VOCAB]] 块），
         * 有一条算一条，不让面板空着。
         */
        const fallback = result.vocabulary ?? []
        patch({ wordsLoading: false, wordsError: extracted.error ?? '抽词失败', words: fallback })
        return
      }
      patch({ wordsLoading: false, wordsError: null, words: extracted.words })
    } catch (error) {
      patch({
        wordsLoading: false,
        wordsError: error instanceof Error ? error.message : '抽词请求失败',
        words: result.vocabulary ?? []
      })
    }
  },

  remove: (id) => {
    set((state) => ({
      current: state.current?.id === id ? null : state.current,
      history: state.history.filter((item) => item.id !== id)
    }))
    persist(get().history, '')
  },

  clear: () => {
    set({ current: null, history: [] })
    void libraryApi.translateHistoryClear().catch(() => undefined)
  },

  /** 启动时把盘上的记录读回来（保留策略已经在主进程执行过） */
  loadHistory: async () => {
    try {
      const rows = await libraryApi.translateHistoryGet()
      if (!Array.isArray(rows) || rows.length === 0) return
      const list = rows.map(fromPersisted).slice(0, HISTORY_LIMIT)
      set({ history: list, current: get().current ?? list[0] ?? null })
    } catch {
      /* 读不出来就当没有记录，不打扰用户 */
    }
  }
}))

/* 打开应用时读一次（store 是模块级的，这里就是"加载时"） */
void useTranslate.getState().loadHistory()

/** 记录里带上目标语言，凑不齐就留空（只影响列表展示） */
function targetOf(result: TranslateResult | null): string {
  return result?.provider ? '' : ''
}

/* --------------------------------------------------------- 记录的持久化 */

/**
 * 面板里的历史是"带结果的条目"，盘上存的是"扁平的记录"。
 * 两者之间转一道：盘上不该长成内部状态的样子（将来改内部结构也不必迁数据）。
 */
function toPersisted(entry: TranslateEntry, target: string): TranslateHistoryEntry | null {
  const result = entry.result
  if (!result || !result.ok || !result.translation.trim()) return null
  return {
    id: entry.id,
    source: entry.source,
    translation: result.translation,
    analysis: result.analysis,
    kind: result.provider === 'ai' ? 'ai' : 'machine',
    target,
    at: entry.at
  }
}

function fromPersisted(item: TranslateHistoryEntry): TranslateEntry {
  return {
    id: item.id,
    source: item.source,
    context: [],
    result: {
      ok: true,
      provider: item.kind === 'ai' ? 'ai' : 'google',
      source: item.source,
      translation: item.translation,
      analysis: item.analysis,
      contextUsed: 0,
      at: item.at
    },
    loading: false,
    error: null,
    at: item.at
  }
}

/** 只把成功的结果写盘；失败的不值得留 */
function persist(list: TranslateEntry[], target: string): void {
  const rows = list.map((entry) => toPersisted(entry, target)).filter(Boolean) as TranslateHistoryEntry[]
  void libraryApi.translateHistorySave(rows).catch(() => undefined)
}