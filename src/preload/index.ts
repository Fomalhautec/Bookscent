import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { IPC } from '@shared/ipc'
import type { BookscentApi, DeepPartial, ExportPdfOptions } from '@shared/ipc'
import type {
  AppSettings,
  Book,
  BookendSide,
  BookRecord,
  DialogFilter,
  ExtractImagesOptions,
  SaveImageFile,
  Shelf,
  StatsOverview,
  TranslateHistoryEntry,
  UsageDelta,
  UsageKey
} from '@shared/types'

function subscribe(channel: string, cb: (...args: never[]) => void): () => void {
  const listener = (_event: unknown, ...args: unknown[]): void => {
    ;(cb as (...a: unknown[]) => void)(...args)
  }
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const api: BookscentApi = {
  app: {
    info: () => ipcRenderer.invoke(IPC.appInfo),
    openPath: (path: string) => ipcRenderer.invoke(IPC.appOpenPath, path),
    revealPath: (path: string) => ipcRenderer.invoke(IPC.appRevealPath, path),
    windowMinimize: () => ipcRenderer.invoke(IPC.winMinimize),
    windowToggleMaximize: () => ipcRenderer.invoke(IPC.winToggleMaximize),
    windowClose: () => ipcRenderer.invoke(IPC.winClose),
    windowIsMaximized: () => ipcRenderer.invoke(IPC.winIsMaximized),
    getPathForFile: (file: unknown): string => {
      try {
        return webUtils.getPathForFile(file as Parameters<typeof webUtils.getPathForFile>[0])
      } catch {
        return ''
      }
    },
    onMaximizeChange: (cb) => subscribe(IPC.winMaximizeChanged, cb),
    onRequestOpen: (cb) => subscribe(IPC.appRequestOpen, cb),
    takePendingOpen: () => ipcRenderer.invoke(IPC.appTakePendingOpen),
    toggleDevTools: () => ipcRenderer.invoke(IPC.appToggleDevTools)
  },
  settings: {
    get: () => ipcRenderer.invoke(IPC.settingsGet),
    patch: (patch: DeepPartial<AppSettings>) => ipcRenderer.invoke(IPC.settingsPatch, patch),
    reset: () => ipcRenderer.invoke(IPC.settingsReset),
    export: () => ipcRenderer.invoke(IPC.settingsExport),
    import: () => ipcRenderer.invoke(IPC.settingsImport),
    pickBookImage: (hint?: string) => ipcRenderer.invoke(IPC.settingsPickBookImage, hint),
    chooseAssetsDir: () => ipcRenderer.invoke(IPC.settingsChooseAssetsDir),
    migrateInlineImages: () => ipcRenderer.invoke(IPC.settingsMigrateInlineImages),
    resetPaths: (paths: string[]) => ipcRenderer.invoke(IPC.settingsResetPaths, paths)
  },
  library: {
    index: () => ipcRenderer.invoke(IPC.libraryIndex),
    rescan: () => ipcRenderer.invoke(IPC.libraryRescan),
    importFilesDialog: (copy: boolean) => ipcRenderer.invoke(IPC.libraryImportFiles, copy),
    importFolderDialog: (copy: boolean) => ipcRenderer.invoke(IPC.libraryImportFolder, copy),
    importPaths: (paths: string[], copy: boolean) => ipcRenderer.invoke(IPC.libraryImportPaths, paths, copy),
    openTemporary: (path: string) => ipcRenderer.invoke(IPC.libraryOpenTemporary, path),
    pickTemporary: () => ipcRenderer.invoke(IPC.libraryPickTemporary),
    reorderBooks: (orderedIds: string[]) => ipcRenderer.invoke(IPC.libraryReorder, orderedIds),
    createNote: (kind: 'md' | 'txt', title?: string) => ipcRenderer.invoke(IPC.libraryCreateNote, kind, title),
    updateBook: (id: string, patch: Partial<Book>) => ipcRenderer.invoke(IPC.libraryUpdateBook, id, patch),
    removeBooks: (ids: string[], deleteFiles: boolean) =>
      ipcRenderer.invoke(IPC.libraryRemoveBooks, ids, deleteFiles),
    restoreBooks: (ids: string[]) => ipcRenderer.invoke(IPC.libraryRestoreBooks, ids),
    purgeBooks: (ids: string[]) => ipcRenderer.invoke(IPC.libraryPurgeBooks, ids),
    record: (id: string) => ipcRenderer.invoke(IPC.libraryRecord, id),
    saveRecord: (record: BookRecord) => ipcRenderer.invoke(IPC.librarySaveRecord, record),
  recordUsage: (id: string, key: UsageKey, delta: UsageDelta) =>
    ipcRenderer.invoke(IPC.libraryRecordUsage, id, key, delta),
  progressMap: () => ipcRenderer.invoke(IPC.libraryProgressMap),
  stats: () => ipcRenderer.invoke(IPC.libraryStats),
  translate: (request: { text: string; context: string[] }) => ipcRenderer.invoke(IPC.translateText, request),
  /** 第二步抽词：只让模型挑词，回 JSON */
  translateVocab: (request: { source: string; translation: string; analysis?: string }) =>
    ipcRenderer.invoke(IPC.translateVocab, request),
  vocabList: () => ipcRenderer.invoke(IPC.vocabList),
  vocabAdd: (input: unknown) => ipcRenderer.invoke(IPC.vocabAdd, input),
  vocabAddMany: (inputs: unknown[]) => ipcRenderer.invoke(IPC.vocabAddMany, inputs),
  vocabUpdate: (id: string, patch: unknown) => ipcRenderer.invoke(IPC.vocabUpdate, id, patch),
  vocabRemove: (id: string) => ipcRenderer.invoke(IPC.vocabRemove, id),
  ttsVoices: (force?: boolean) => ipcRenderer.invoke(IPC.ttsVoices, force === true),
  ttsSpeak: (request: { text: string; voice: string; rate: number; pitch: number; engine?: 'edge' | 'system' | 'youdao' | 'tencent'; youdaoAppKey?: string; youdaoAppSecret?: string; tencentSecretId?: string; tencentSecretKey?: string; tencentRegion?: string }) =>
    ipcRenderer.invoke(IPC.ttsSpeak, request),
  translateHistoryGet: () => ipcRenderer.invoke(IPC.translateHistoryGet),
  translateHistorySave: (entries: TranslateHistoryEntry[]) =>
    ipcRenderer.invoke(IPC.translateHistorySave, entries),
  translateHistoryClear: () => ipcRenderer.invoke(IPC.translateHistoryClear),
  scanAssets: () => ipcRenderer.invoke(IPC.assetsScan),
  cleanupAssets: (options: { orphans: boolean; duplicates: boolean }) =>
    ipcRenderer.invoke(IPC.assetsCleanup, options),
    chooseLibraryDir: () => ipcRenderer.invoke(IPC.libraryChooseDir),
    saveShelves: (shelves: Shelf[]) => ipcRenderer.invoke(IPC.librarySaveShelves, shelves),
    addBookend: (shelfId: string, anchorBookId: string | null, side?: BookendSide) =>
      ipcRenderer.invoke(IPC.libraryAddBookend, shelfId, anchorBookId, side),
    updateBookend: (
      id: string,
      patch: { gap?: number; label?: string; side?: BookendSide; breakLine?: boolean }
    ) => ipcRenderer.invoke(IPC.libraryUpdateBookend, id, patch),
    moveBookend: (id: string, direction: -1 | 1) =>
      ipcRenderer.invoke(IPC.libraryMoveBookend, id, direction),
    removeMissing: () => ipcRenderer.invoke(IPC.libraryRemoveMissing),
    removeBookend: (id: string) => ipcRenderer.invoke(IPC.libraryRemoveBookend, id),
    epubInfo: (path: string) => ipcRenderer.invoke(IPC.libraryEpubInfo, path),
    epubImages: (path: string) => ipcRenderer.invoke(IPC.libraryEpubImages, path),
    enrich: () => ipcRenderer.invoke(IPC.libraryEnrich),
    onBookUpdated: (cb) => subscribe(IPC.libraryBookUpdated, cb),
    onScanProgress: (cb) => subscribe(IPC.libraryScanProgress, cb)
  },
  files: {
    readText: (path: string) => ipcRenderer.invoke(IPC.filesReadText, path),
    writeText: (path: string, content: string) => ipcRenderer.invoke(IPC.filesWriteText, path, content),
    readBinary: (path: string) => ipcRenderer.invoke(IPC.filesReadBinary, path),
    exists: (path: string) => ipcRenderer.invoke(IPC.filesExists, path),
    stat: (path: string) => ipcRenderer.invoke(IPC.filesStat, path),
    probe: (path: string) => ipcRenderer.invoke(IPC.filesProbe, path),
    extractDocText: (path: string) => ipcRenderer.invoke(IPC.filesExtractDocText, path),
    exportText: (defaultName: string, content: string, filters?: DialogFilter[]) =>
      ipcRenderer.invoke(IPC.filesExportText, defaultName, content, filters),
    exportBinary: (defaultName: string, data: Uint8Array, filters?: DialogFilter[]) =>
      ipcRenderer.invoke(IPC.filesExportBinary, defaultName, data, filters),
    exportPdf: (options: ExportPdfOptions) => ipcRenderer.invoke(IPC.filesExportPdf, options),
    pickImages: () => ipcRenderer.invoke(IPC.filesPickImages),
    readImage: (path: string) => ipcRenderer.invoke(IPC.filesReadImage, path),
    saveImages: (options: ExtractImagesOptions, payload: SaveImageFile[]) =>
      ipcRenderer.invoke(IPC.filesSaveImages, options, payload),
    chooseDirectory: (title?: string) => ipcRenderer.invoke(IPC.filesChooseDirectory, title),
    copyIntoLibrary: (path: string) => ipcRenderer.invoke(IPC.filesCopyIntoLibrary, path),
    checkHtmlAssets: (path: string) => ipcRenderer.invoke(IPC.filesCheckHtmlAssets, path)
  },
  dialog: {
    open: (options) => ipcRenderer.invoke(IPC.dialogOpen, options),
    confirm: (options) => ipcRenderer.invoke(IPC.dialogConfirm, options)
  }
}

contextBridge.exposeInMainWorld('bookscent', api)
