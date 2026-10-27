import type { DeepPartial } from '@shared/ipc'
import type { ExportPdfOptions, ExportResult } from '@shared/ipc'
import type {
  AppSettings,
  Book,
  BookendFacing,
  BookendSide,
  BookRecord,
  BookStyle,
  DialogFilter,
  EpubInfo,
  ExtractImagesOptions,
  ExtractImagesResult,
  ImportResult,
  LibraryIndex,
  SaveImageFile,
  Shelf,
  StatsOverview,
  AssetCleanupResult,
  AssetScanReport,
  TranslateHistoryEntry,
  TranslateResult,
  TtsVoice,
  WordEntry,
  UsageDelta,
  UsageKey
} from '@shared/types'

/**
 * 主进程能力的唯一入口。渲染进程永远不直接摸 fs / dialog，
 * 这样所有磁盘访问都集中在主进程里，便于出错处理和权限控制。
 */
export const api = window.bookscent

export type { DeepPartial }

export const appApi = {
  info: () => api.app.info(),
  openPath: (path: string) => api.app.openPath(path),
  revealPath: (path: string) => api.app.revealPath(path),
  getPathForFile: (file: unknown): string => api.app.getPathForFile(file),
  toggleDevTools: (): Promise<boolean> => api.app.toggleDevTools(),
  /** 取"本次启动要打开的文件"（双击关联文件 / 打开方式进来的） */
  takePendingOpen: (): Promise<string[]> => api.app.takePendingOpen()
}

export const settingsApi = {
  get: (): Promise<AppSettings> => api.settings.get(),
  patch: (patch: DeepPartial<AppSettings>): Promise<AppSettings> => api.settings.patch(patch),
  reset: (): Promise<AppSettings> => api.settings.reset(),
  exportFile: () => api.settings.export(),
  importFile: () => api.settings.import(),
  pickBookImage: (hint?: string) => api.settings.pickBookImage(hint),
  chooseAssetsDir: () => api.settings.chooseAssetsDir(),
  migrateInlineImages: () => api.settings.migrateInlineImages(),
  resetPaths: (paths: string[]): Promise<AppSettings> => api.settings.resetPaths(paths)
}

export const libraryApi = {
  index: (): Promise<LibraryIndex> => api.library.index(),
  rescan: (): Promise<LibraryIndex> => api.library.rescan(),
  importFilesDialog: (copy: boolean): Promise<ImportResult | null> => api.library.importFilesDialog(copy),
  importFolderDialog: (copy: boolean): Promise<ImportResult | null> => api.library.importFolderDialog(copy),
  importPaths: (paths: string[], copy: boolean): Promise<ImportResult> => api.library.importPaths(paths, copy),
  openTemporary: (path: string): Promise<{ book: Book; index: LibraryIndex } | null> =>
    api.library.openTemporary(path),
  pickTemporary: (): Promise<{ book: Book; index: LibraryIndex } | null> => api.library.pickTemporary(),
  reorderBooks: (orderedIds: string[]): Promise<LibraryIndex> => api.library.reorderBooks(orderedIds),
  createNote: (kind: 'md' | 'txt', title?: string): Promise<Book> => api.library.createNote(kind, title),
  updateBook: (id: string, patch: Partial<Book>): Promise<Book> => api.library.updateBook(id, patch),
  removeBooks: (ids: string[], deleteFiles: boolean): Promise<LibraryIndex> =>
    api.library.removeBooks(ids, deleteFiles),
  restoreBooks: (ids: string[]): Promise<LibraryIndex> => api.library.restoreBooks(ids),
  purgeBooks: (ids: string[]): Promise<LibraryIndex> => api.library.purgeBooks(ids),
  record: (id: string): Promise<BookRecord> => api.library.record(id),
  saveRecord: (record: BookRecord): Promise<BookRecord> => api.library.saveRecord(record),
  recordUsage: (id: string, key: UsageKey, delta: UsageDelta): Promise<BookRecord> =>
    api.library.recordUsage(id, key, delta),
  progressMap: (): Promise<Record<string, number>> => api.library.progressMap(),
  /** 翻译一段文字（配置在主进程，渲染层只送文本与上下文） */
  translate: (request: { text: string; context: string[] }): Promise<TranslateResult> =>
    api.library.translate(request),
  /** 第二步抽词：模型专门挑词、只回 JSON */
  translateVocab: (request: {
    source: string
    translation: string
    analysis?: string
  }): Promise<{
    ok: boolean
    words: { term: string; reading: string; meaning: string; kind: 'word' | 'phrase' }[]
    error?: string
    endpointName?: string
  }> => api.library.translateVocab(request),
  /** 单词本 */
  vocabList: (): Promise<WordEntry[]> => api.library.vocabList(),
  vocabAdd: (input: {
    term: string
    reading?: string
    meaning: string
    kind?: 'word' | 'phrase'
    language?: WordEntry['language']
    source?: string
    bookId?: string
  }): Promise<{ entry: WordEntry; merged: boolean }> => api.library.vocabAdd(input),
  vocabAddMany: (inputs: {
    term: string
    reading?: string
    meaning: string
    kind?: 'word' | 'phrase'
    language?: WordEntry['language']
    source?: string
    bookId?: string
  }[]): Promise<{ added: number; merged: number }> => api.library.vocabAddMany(inputs),
  vocabUpdate: (id: string, patch: Partial<WordEntry>): Promise<WordEntry | null> => api.library.vocabUpdate(id, patch),
  vocabRemove: (id: string): Promise<boolean> => api.library.vocabRemove(id),

  /** 朗读：语音清单（在线那套）与在线合成 */
  ttsVoices: (force?: boolean): Promise<TtsVoice[]> => api.library.ttsVoices(force),
  ttsSpeak: (request: { text: string; voice: string; rate: number; pitch: number; engine?: 'edge' | 'system' | 'youdao' | 'tencent'; youdaoAppKey?: string; youdaoAppSecret?: string; tencentSecretId?: string; tencentSecretKey?: string; tencentRegion?: string }): Promise<{ audio: string; mime: string }> =>
    api.library.ttsSpeak(request),
  /** 翻译记录：读 / 写 / 清空（保留策略在主进程执行） */
  translateHistoryGet: (): Promise<TranslateHistoryEntry[]> => api.library.translateHistoryGet(),
  translateHistorySave: (entries: TranslateHistoryEntry[]): Promise<TranslateHistoryEntry[]> =>
    api.library.translateHistorySave(entries),
  translateHistoryClear: (): Promise<void> => api.library.translateHistoryClear(),
  /** 图片数据目录体检（不动文件） */
  scanAssets: (): Promise<AssetScanReport> => api.library.scanAssets(),
  /** 清理图片数据目录 */
  cleanupAssets: (options: { orphans: boolean; duplicates: boolean }): Promise<AssetCleanupResult> =>
    api.library.cleanupAssets(options),
  stats: (): Promise<StatsOverview> => api.library.stats(),
  chooseLibraryDir: () => api.library.chooseLibraryDir(),
  saveShelves: (shelves: Shelf[]): Promise<LibraryIndex> => api.library.saveShelves(shelves),
  addBookend: (shelfId: string, anchorBookId: string | null, side?: BookendSide): Promise<LibraryIndex> =>
    api.library.addBookend(shelfId, anchorBookId, side),
  updateBookend: (
    id: string,
    patch: {
      gap?: number
      label?: string
      side?: BookendSide
      breakLine?: boolean
      breakLineCover?: boolean
      facing?: BookendFacing
    }
  ): Promise<LibraryIndex> => api.library.updateBookend(id, patch),
  moveBookend: (id: string, direction: -1 | 1): Promise<LibraryIndex> =>
    api.library.moveBookend(id, direction),
  removeBookend: (id: string): Promise<LibraryIndex> => api.library.removeBookend(id),
  removeMissing: (): Promise<{ removed: Book[]; index: LibraryIndex }> => api.library.removeMissing(),
  epubInfo: (path: string): Promise<EpubInfo | null> => api.library.epubInfo(path),
  epubImages: (path: string): Promise<{ href: string; name: string; bytes: number }[]> =>
    api.library.epubImages(path),
  enrich: (): Promise<boolean> => api.library.enrich(),
  onBookUpdated: (cb: (book: Book) => void) => api.library.onBookUpdated(cb),
  onScanProgress: (cb: (p: { done: number; total: number; finished: boolean }) => void) =>
    api.library.onScanProgress(cb)
}

export const filesApi = {
  readText: (path: string): Promise<string> => api.files.readText(path),
  writeText: (path: string, content: string): Promise<{ size: number; mtimeMs: number }> =>
    api.files.writeText(path, content),
  readBinary: (path: string): Promise<Uint8Array> => api.files.readBinary(path),
  exists: (path: string): Promise<boolean> => api.files.exists(path),
  stat: (path: string): Promise<{ exists: boolean; size: number; mtimeMs: number }> => api.files.stat(path),
  probe: (path: string): Promise<{ pages: number; exact: boolean; words: number }> => api.files.probe(path),
  extractDocText: (path: string): Promise<{ text: string; words: number; pages: number | null } | null> =>
    api.files.extractDocText(path),
  exportText: (defaultName: string, content: string, filters?: DialogFilter[]) =>
    api.files.exportText(defaultName, content, filters),
  exportBinary: (defaultName: string, data: Uint8Array, filters?: DialogFilter[]) =>
    api.files.exportBinary(defaultName, data, filters),
  exportPdf: (options: ExportPdfOptions): Promise<ExportResult> => api.files.exportPdf(options),
  pickImages: () => api.files.pickImages(),
  readImage: (path: string): Promise<string> => api.files.readImage(path),
  saveImages: (options: ExtractImagesOptions, payload: SaveImageFile[]): Promise<ExtractImagesResult> =>
    api.files.saveImages(options, payload),
  chooseDirectory: (title?: string): Promise<string | null> => api.files.chooseDirectory(title),
  copyIntoLibrary: (path: string): Promise<string> => api.files.copyIntoLibrary(path),
  checkHtmlAssets: (path: string) => api.files.checkHtmlAssets(path)
}

export const dialogApi = {
  open: api.dialog.open,
  confirm: (options: {
    title?: string
    message: string
    detail?: string
    buttons?: string[]
    defaultId?: number
    cancelId?: number
    type?: 'none' | 'info' | 'error' | 'question' | 'warning'
  }): Promise<number> => api.dialog.confirm(options)
}

/** 方便在组件里直接取全局样式 */
export type { BookStyle }
