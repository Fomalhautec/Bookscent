import { create } from 'zustand'
import type { DeepPartial } from '@shared/ipc'
import { BOOK_STYLE_PRESETS, DEFAULT_BOOK_STYLE } from '@shared/themes'
import type { AppSettings, BookStyle, CustomTheme, UiSettings } from '@shared/types'
import { settingsApi } from '@/lib/api'
import { resolveThemeRuntime, type ThemeRuntime } from '@/lib/theme'

interface SettingsStore {
  settings: AppSettings | null
  runtime: ThemeRuntime | null
  loading: boolean
  error: string | null

  load: () => Promise<void>
  patch: (patch: DeepPartial<AppSettings>) => Promise<void>
  reset: () => Promise<void>
  /** 只把指定设置项恢复出厂默认（设置页的「恢复本页默认」） */
  resetPaths: (paths: string[]) => Promise<void>
  setAppTheme: (id: string) => Promise<void>
  setShelfTheme: (id: string) => Promise<void>
  patchBookStyle: (patch: Partial<BookStyle>) => Promise<void>
  /** 改笔记的基准样式（书籍与笔记默认长相分开） */
  patchNoteStyle: (patch: Partial<BookStyle>) => Promise<void>
  patchUi: (patch: Partial<UiSettings>) => Promise<void>
  applyBookStylePreset: (presetId: string) => Promise<void>
  saveBookStylePreset: (name: string) => Promise<void>
  deleteBookStylePreset: (id: string) => Promise<void>
  upsertCustomTheme: (theme: CustomTheme) => Promise<void>
  deleteCustomTheme: (id: string) => Promise<void>
  importSettings: () => Promise<boolean>
  exportSettings: () => Promise<string | null>
  setWindowBounds: (bounds: Partial<AppSettings['window']>) => void
}

function derive(settings: AppSettings): ThemeRuntime {
  return resolveThemeRuntime(settings.appTheme, settings.shelfTheme, settings.customThemes)
}

export const useSettings = create<SettingsStore>()((set, get) => {
  const commit = (settings: AppSettings): void => {
    set({ settings, runtime: derive(settings), error: null })
  }

  return {
    settings: null,
    runtime: null,
    loading: true,
    error: null,

    load: async () => {
      set({ loading: true })
      try {
        const settings = await settingsApi.get()
        commit(settings)
      } catch (error) {
        set({ error: (error as Error).message })
      } finally {
        set({ loading: false })
      }
    },

    patch: async (patch) => {
      const settings = await settingsApi.patch(patch)
      commit(settings)
    },

    reset: async () => {
      const settings = await settingsApi.reset()
      commit(settings)
    },

    resetPaths: async (paths) => {
      const settings = await settingsApi.resetPaths(paths)
      commit(settings)
    },

    setAppTheme: async (id) => {
      await get().patch({ appTheme: id })
    },

    setShelfTheme: async (id) => {
      await get().patch({ shelfTheme: id })
    },

    patchBookStyle: async (patch) => {
      const current = get().settings
      if (!current) return
      await get().patch({ bookStyle: patch as BookStyle })
    },

    patchNoteStyle: async (patch) => {
      const current = get().settings
      if (!current) return
      await get().patch({ noteStyle: patch as BookStyle })
    },

    patchUi: async (patch) => {
      await get().patch({ ui: patch as UiSettings })
    },

    applyBookStylePreset: async (presetId) => {
      const current = get().settings
      const preset = BOOK_STYLE_PRESETS.find((p) => p.id === presetId)
      if (preset) {
        await get().patch({ bookStyle: { ...preset.style } })
        return
      }
      const custom = current?.customBookStyles.find((p) => p.id === presetId)
      if (custom) await get().patch({ bookStyle: { ...custom.style } })
    },

    saveBookStylePreset: async (name) => {
      const current = get().settings
      if (!current) return
      const id = `custom-style-${Date.now().toString(36)}`
      await get().patch({
        customBookStyles: [
          ...current.customBookStyles,
          { id, name: name.trim() || '我的书脊样式', style: { ...current.bookStyle } }
        ]
      })
    },

    deleteBookStylePreset: async (id) => {
      const current = get().settings
      if (!current) return
      await get().patch({ customBookStyles: current.customBookStyles.filter((p) => p.id !== id) })
    },

    upsertCustomTheme: async (theme) => {
      const current = get().settings
      if (!current) return
      const list = current.customThemes.filter((t) => t.id !== theme.id)
      await get().patch({ customThemes: [...list, theme] })
    },

    deleteCustomTheme: async (id) => {
      const current = get().settings
      if (!current) return
      const next = current.customThemes.filter((t) => t.id !== id)
      const patch: DeepPartial<AppSettings> = { customThemes: next }
      if (current.appTheme === id) patch.appTheme = 'parchment'
      if (current.shelfTheme === id) patch.shelfTheme = 'parchment'
      await get().patch(patch)
    },

    importSettings: async () => {
      const result = await settingsApi.importFile()
      if (result.cancelled) return false
      commit(result.settings)
      return true
    },

    exportSettings: async () => {
      const result = await settingsApi.exportFile()
      return result.cancelled ? null : result.path
    },

    setWindowBounds: (bounds) => {
      const current = get().settings
      if (!current) return
      set({ settings: { ...current, window: { ...current.window, ...bounds } } })
    }
  }
})

/** 当前生效的书籍全局样式（设置还没加载时用内置默认值兜底） */
export function globalBookStyle(settings: AppSettings | null): BookStyle {
  return settings?.bookStyle ?? DEFAULT_BOOK_STYLE
}

export function defaultBookStyle(): BookStyle {
  return DEFAULT_BOOK_STYLE
}
