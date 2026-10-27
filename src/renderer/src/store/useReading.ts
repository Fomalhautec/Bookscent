import { create } from 'zustand'

/**
 * 当前正在读的那本书的用量摘要。
 *
 * 为什么要一个小 store：这份数既要显示在**全局状态栏**（用户希望的位置，
 * 与"46 本藏书 · 4 层书架"同一行），又要被阅读界面自己用到，
 * 而计时的钩子只能挂在阅读界面上（它要知道 book）。
 * 所以钩子算完写进这里，状态栏读它 —— 一处计算，两处显示不重复。
 */
export interface ReadingActive {
  bookId: string
  title: string
  /** 当作书还是当笔记，决定显示"页"还是"字" */
  asNote: boolean
  sessionSeconds: number
  opens: number
  seconds: number
  pages: number
  words: number
}

interface ReadingState {
  active: ReadingActive | null
  setActive: (value: ReadingActive | null) => void
}

export const useReading = create<ReadingState>((set) => ({
  active: null,
  setActive: (active) => set({ active })
}))
