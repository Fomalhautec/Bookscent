import { create } from 'zustand'

export type ToastKind = 'info' | 'success' | 'warn' | 'error'

export interface Toast {
  id: string
  kind: ToastKind
  title: string
  detail?: string
  at: number
}

export type AppView = 'shelf' | 'settings' | 'stats' | 'vocab' | 'about' | 'trash'

interface UiStore {
  toasts: Toast[]
  busy: string | null
  toast: (title: string, kind?: ToastKind, detail?: string) => string
  dismiss: (id: string) => void
  clearToasts: () => void
  setBusy: (label: string | null) => void

  view: AppView
  setView: (view: AppView) => void

  /** 右上角书籍详情抽屉 */
  detailBookId: string | null
  openDetail: (id: string) => void
  closeDetail: () => void

  /** 右键菜单：挂着书就是书的菜单，挂着书立就是书立的菜单 */
  contextMenu: { x: number; y: number; bookId?: string; bookendId?: string } | null
  openContextMenu: (payload: { x: number; y: number; bookId?: string; bookendId?: string }) => void
  closeContextMenu: () => void

  sidebarOpen: boolean
  toggleSidebar: () => void

  /**
   * 书架的多选模式：开启后单击 = 选中，双击才打开书本。
   * 放在 store 里是因为切换书架层 / 视图模式时书架视图会重新挂载，
   * 这个开关不该跟着被重置。
   */
  multiSelect: boolean
  setMultiSelect: (next: boolean) => void

  /**
   * 打开书籍时的过场动画。
   * 记下被点那本书在书架上的位置，才能从它"长"成阅读界面。
   */
  opening: { bookId: string; rect: { left: number; top: number; width: number; height: number }; at: number } | null
  playOpening: (bookId: string, rect: DOMRect) => void
  clearOpening: () => void
}

let seq = 0

export const useUi = create<UiStore>()((set, get) => ({
  toasts: [],
  busy: null,

  toast: (title, kind = 'info', detail) => {
    const id = `t${++seq}`
    const toast: Toast = { id, kind, title, detail, at: Date.now() }
    set({ toasts: [...get().toasts, toast].slice(-4) })
    const ttl = kind === 'error' ? 6000 : 3200
    setTimeout(() => get().dismiss(id), ttl)
    return id
  },

  dismiss: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
  clearToasts: () => set({ toasts: [] }),
  setBusy: (busy) => set({ busy }),

  view: 'shelf',
  setView: (view) => set({ view, contextMenu: null }),

  detailBookId: null,
  openDetail: (id) => set({ detailBookId: id, contextMenu: null }),
  closeDetail: () => set({ detailBookId: null }),

  contextMenu: null,
  openContextMenu: (contextMenu) => set({ contextMenu }),
  closeContextMenu: () => set({ contextMenu: null }),

  sidebarOpen: true,
  toggleSidebar: () => set({ sidebarOpen: !get().sidebarOpen }),

  multiSelect: false,
  setMultiSelect: (multiSelect) => set({ multiSelect }),

  opening: null,
  playOpening: (bookId, rect) =>
    set({
      opening: {
        bookId,
        rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
        at: Date.now()
      }
    }),
  clearOpening: () => set({ opening: null })
}))
