import { create } from 'zustand'
import type { VocabLanguage, WordEntry } from '@shared/types'
import { libraryApi } from '@/lib/api'
import { useUi } from '@/store/useUi'

/**
 * 单词本状态。
 *
 * 数据在磁盘上（主进程的 vocabulary.json），这里只是内存镜像 + 现成的筛选条件：
 * 语种、搜索词、只看某一本书。页面组件从这份状态里取，避免各页面自己拉一遍。
 */
export interface VocabFilter {
  /** 空的 = 全部语种 */
  language: VocabLanguage | 'all'
  keyword: string
  sort: 'new' | 'alpha' | 'source'
}

interface VocabState {
  words: WordEntry[]
  loading: boolean
  filter: VocabFilter
  load: () => Promise<void>
  setFilter: (patch: Partial<VocabFilter>) => void
  add: (input: {
    term: string
    reading?: string
    meaning: string
    kind?: 'word' | 'phrase'
    language?: VocabLanguage
    source?: string
    bookId?: string
  }) => Promise<void>
  addMany: (inputs: {
    term: string
    reading?: string
    meaning: string
    kind?: 'word' | 'phrase'
    language?: VocabLanguage
    source?: string
    bookId?: string
  }[]) => Promise<void>
  update: (id: string, patch: Partial<WordEntry>) => Promise<void>
  remove: (id: string) => Promise<void>
}

export const useVocab = create<VocabState>((set, get) => ({
  words: [],
  loading: false,
  filter: { language: 'all', keyword: '', sort: 'new' },

  load: async () => {
    set({ loading: true })
    try {
      const list = await libraryApi.vocabList()
      set({ words: Array.isArray(list) ? list : [], loading: false })
    } catch {
      set({ loading: false })
    }
  },

  setFilter: (patch) => set({ filter: { ...get().filter, ...patch } }),

  add: async (input) => {
    const toast = useUi.getState().toast
    try {
      const result = await libraryApi.vocabAdd(input)
      await get().load()
      toast(result.merged ? `「${input.term}」已在单词本里，已补全释义` : `已加入单词本：${input.term}`, 'success')
    } catch (error) {
      toast('加入单词本失败', 'error', error instanceof Error ? error.message : String(error))
    }
  },

  addMany: async (inputs) => {
    const toast = useUi.getState().toast
    if (inputs.length === 0) return
    try {
      const result = await libraryApi.vocabAddMany(inputs)
      await get().load()
      toast(
        `已加入单词本：新增 ${result.added} 个${result.merged > 0 ? `，合并 ${result.merged} 个` : ''}`,
        'success'
      )
    } catch (error) {
      toast('批量加入失败', 'error', error instanceof Error ? error.message : String(error))
    }
  },

  update: async (id, patch) => {
    await libraryApi.vocabUpdate(id, patch).catch(() => null)
    await get().load()
  },

  remove: async (id) => {
    await libraryApi.vocabRemove(id).catch(() => false)
    set({ words: get().words.filter((word) => word.id !== id) })
  }
}))
