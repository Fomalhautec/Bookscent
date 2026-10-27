import type {
  AppInfo,
  AppSettings,
  Book,
  BookendFacing,
  BookendSide,
  BookRecord,
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
} from './types'

export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends (infer U)[]
    ? U[]
    : T[K] extends object
      ? DeepPartial<T[K]>
      : T[K]
}

export interface DocTextResult {
  text: string
  words: number
  pages: number | null
}

export interface ExportResult {
  path: string | null
  cancelled: boolean
}

/** HTML 笔记引用到的同级资源体检结果 */
export interface HtmlAssetReport {
  referenced: number
  missing: string[]
  external: number
}

/** 已经落到数据目录里的一张图 */
export interface StoredImage {
  /** `asset:<文件名>`，存进 BookStyle */
  ref: string
  /** 立刻预览用的 data URL */
  dataUrl: string
  name: string
}

/** 用 printToPDF 导出 PDF 的参数 */
export interface ExportPdfOptions {
  /** 已经渲染好的完整 HTML（含内联样式） */
  html: string
  /** 相对资源（图片等）的基准目录，会转换成本地可加载的地址 */
  baseDir?: string
  /** 文件名（不含扩展名） */
  defaultName: string
  /** 页面尺寸 */
  pageSize?: 'A4' | 'A5' | 'Letter'
  landscape?: boolean
  /** 页边距（英寸） */
  marginInch?: number
}

export interface BookscentApi {
  app: {
    info(): Promise<AppInfo>
    openPath(path: string): Promise<string>
    revealPath(path: string): Promise<void>
    windowMinimize(): Promise<void>
    windowToggleMaximize(): Promise<boolean>
    windowClose(): Promise<void>
    windowIsMaximized(): Promise<boolean>
    /** 拖放进来的文件取真实磁盘路径（Electron 32+ 已移除 File.path） */
    getPathForFile(file: unknown): string
    /**
     * 开/关开发者控制台，返回打开后的状态。
     * 应用里 Ctrl+Shift+I 被「导入」占了，所以给一个显式入口。
     */
    toggleDevTools(): Promise<boolean>
    onMaximizeChange(cb: (maximized: boolean) => void): () => void
    onRequestOpen(cb: (paths: string[]) => void): () => void
    /** 取走"本次启动要打开的文件"，取一次就清空 */
    takePendingOpen(): Promise<string[]>
  }
  settings: {
    get(): Promise<AppSettings>
    patch(patch: DeepPartial<AppSettings>): Promise<AppSettings>
    reset(): Promise<AppSettings>
    export(): Promise<ExportResult>
    import(): Promise<{ settings: AppSettings; cancelled: boolean }>
    /** 选一张图 → 拷进数据目录，返回 `asset:` 引用与预览用 data URL */
    pickBookImage(hint?: string): Promise<StoredImage | null>
    /** 更改书籍外观图片的存放目录，并把已有图片搬过去 */
    chooseAssetsDir(): Promise<{ dir: string; moved: number; failed: number } | null>
    /** 把历史遗留的内联 base64 图片落盘，减小 library.json / settings.json */
    migrateInlineImages(): Promise<{ moved: number; failed: number }>
    /**
     * 只把指定的设置项恢复成出厂默认，其余不动。
     * `paths` 是点分路径（`ui.editorFontFamily`、`appTheme`）——
     * 设置页的「恢复本页默认」用它，一键全清太粗暴了。
     */
    resetPaths(paths: string[]): Promise<AppSettings>
  }
  library: {
    index(): Promise<LibraryIndex>
    rescan(): Promise<LibraryIndex>
    /** 只选文件（可以多选） */
    importFilesDialog(copy: boolean): Promise<ImportResult | null>
    /** 只选文件夹，递归导入其中的文档 */
    importFolderDialog(copy: boolean): Promise<ImportResult | null>
    importPaths(paths: string[], copy: boolean): Promise<ImportResult>
    /** 临时打开（返回这本书 + 新的索引） */
    openTemporary(path: string): Promise<{ book: Book; index: LibraryIndex } | null>
    /** 弹对话框挑一个文件临时打开 */
    pickTemporary(): Promise<{ book: Book; index: LibraryIndex } | null>
    /** 手动排序：按给定顺序重排这些书 */
    reorderBooks(orderedIds: string[]): Promise<LibraryIndex>
    createNote(kind: 'md' | 'txt', title?: string): Promise<Book>
    updateBook(id: string, patch: Partial<Book>): Promise<Book>
    removeBooks(ids: string[], deleteFiles: boolean): Promise<LibraryIndex>
    /** 从回收站还原 */
    restoreBooks(ids: string[]): Promise<LibraryIndex>
    /** 彻底删除（文件 + 条目 + 记录） */
    purgeBooks(ids: string[]): Promise<LibraryIndex>
    record(id: string): Promise<BookRecord>
    saveRecord(record: BookRecord): Promise<BookRecord>
    /** 上报用量增量，由主进程读改写合并（进度/批注/用量是三个写入方，不能各自整份覆盖） */
    recordUsage(id: string, key: UsageKey, delta: UsageDelta): Promise<BookRecord>
    /** 每本书的阅读进度百分比，一趟取完，书架画进度条用 */
    progressMap(): Promise<Record<string, number>>
    /** 统计页要的全部数字 */
    stats(): Promise<StatsOverview>
    /**
     * 翻译一段文字（机翻走各家 API，AI 走 OpenAI 兼容的 /chat/completions）。
     * 请求由主进程发出：避开跨域，也让密钥不落进页面上下文。
     */
    translate(request: { text: string; context: string[] }): Promise<TranslateResult>
    /**
     * 第二步：从原文与译文里抽词。
     * 单独一次请求、只回 JSON —— 免得词汇表跟译文挤在同一次请求里被写成各种奇怪格式。
     */
    translateVocab(request: {
      source: string
      translation: string
      analysis?: string
    }): Promise<{
      ok: boolean
      words: { term: string; reading: string; meaning: string; kind: 'word' | 'phrase' }[]
      error?: string
      endpointName?: string
    }>
    /** 单词本：读 / 加 / 批量加 / 改 / 删 */
    vocabList(): Promise<WordEntry[]>
    vocabAdd(input: {
      term: string
      reading?: string
      meaning: string
      kind?: 'word' | 'phrase'
      language?: WordEntry['language']
      source?: string
      bookId?: string
    }): Promise<{ entry: WordEntry; merged: boolean }>
    vocabAddMany(inputs: {
      term: string
      reading?: string
      meaning: string
      kind?: 'word' | 'phrase'
      language?: WordEntry['language']
      source?: string
      bookId?: string
    }[]): Promise<{ added: number; merged: number }>
    vocabUpdate(id: string, patch: Partial<WordEntry>): Promise<WordEntry | null>
    vocabRemove(id: string): Promise<boolean>

    /** 可用的朗读语音（在线那套，几十种语言） */
    ttsVoices(force?: boolean): Promise<TtsVoice[]>
    /** 在线合成一段语音，回 mp3 的 base64 */
    ttsSpeak(request: { text: string; voice: string; rate: number; pitch: number; engine?: 'edge' | 'system' | 'youdao' | 'tencent'; youdaoAppKey?: string; youdaoAppSecret?: string; tencentSecretId?: string; tencentSecretKey?: string; tencentRegion?: string }): Promise<{ audio: string; mime: string }>
    /** 读取翻译记录（按设置里的保留策略） */
    translateHistoryGet(): Promise<TranslateHistoryEntry[]>
    /** 写入翻译记录（主进程按策略裁剪） */
    translateHistorySave(entries: TranslateHistoryEntry[]): Promise<TranslateHistoryEntry[]>
    /** 清空翻译记录 */
    translateHistoryClear(): Promise<void>
    /** 体检图片数据目录：哪些图没人用了、哪些是重复的（不动文件） */
    scanAssets(): Promise<AssetScanReport>
    /** 清理：删掉没人用的图；重复的只留一份并把引用改指过去 */
    cleanupAssets(options: { orphans: boolean; duplicates: boolean }): Promise<AssetCleanupResult>
    chooseLibraryDir(): Promise<{ dir: string; index: LibraryIndex } | null>
    /** EPUB 的章节与目录：主进程解开 zip 后返回阅读顺序 */
    epubInfo(path: string): Promise<EpubInfo | null>
    /** EPUB 里的图片清单（导出图片用） */
    epubImages(path: string): Promise<{ href: string; name: string; bytes: number }[]>
    saveShelves(shelves: Shelf[]): Promise<LibraryIndex>
    /** 在某一侧加一个书立；anchorBookId 为 null 表示这一层的开头/结尾 */
    addBookend(shelfId: string, anchorBookId: string | null, side?: BookendSide): Promise<LibraryIndex>
    /** 书立补丁：朝向也在里面 */
    updateBookend(
      id: string,
      patch: {
        gap?: number
        label?: string
        side?: BookendSide
        breakLine?: boolean
        /** 封面模式下的换行（不设就沿用 breakLine） */
        breakLineCover?: boolean
        /** 在哪些朝向模式下生效（书脊与封面模式下书宽差很多） */
        facing?: BookendFacing
      }
    ): Promise<LibraryIndex>
    /** 书立左右挪一位（-1 左、1 右），与相邻的一件交换位置 */
    moveBookend(id: string, direction: -1 | 1): Promise<LibraryIndex>
    /** 一次移除所有找不到文件的失效书籍（只从书架删，不动磁盘） */
    removeMissing(): Promise<{ removed: Book[]; index: LibraryIndex }>
    removeBookend(id: string): Promise<LibraryIndex>
    enrich(): Promise<boolean>
    onBookUpdated(cb: (book: Book) => void): () => void
    onScanProgress(cb: (progress: { done: number; total: number; finished: boolean }) => void): () => void
  }
  files: {
    readText(path: string): Promise<string>
    writeText(path: string, content: string): Promise<{ size: number; mtimeMs: number }>
    readBinary(path: string): Promise<Uint8Array>
    exists(path: string): Promise<boolean>
    stat(path: string): Promise<{ exists: boolean; size: number; mtimeMs: number }>
    probe(path: string): Promise<{ pages: number; exact: boolean; words: number }>
    extractDocText(path: string): Promise<DocTextResult | null>
    exportText(defaultName: string, content: string, filters?: DialogFilter[]): Promise<ExportResult>
    exportBinary(defaultName: string, data: Uint8Array, filters?: DialogFilter[]): Promise<ExportResult>
    /**
     * 用 Electron 的 printToPDF 把一段渲染好的 HTML 导成 PDF。
     * 走的是真实的排版引擎，所以图片、TOC、五线谱这些渲染结果都能原样保留。
     */
    exportPdf(options: ExportPdfOptions): Promise<ExportResult>
    pickImages(): Promise<{ name: string; dataUrl: string; path: string }[]>
    readImage(path: string): Promise<string>
    saveImages(options: ExtractImagesOptions, files: SaveImageFile[]): Promise<ExtractImagesResult>
    chooseDirectory(title?: string): Promise<string | null>
    copyIntoLibrary(srcPath: string): Promise<string>
    /** 检查 HTML 笔记引用的同级 css/js/图片是否都在 */
    checkHtmlAssets(path: string): Promise<HtmlAssetReport>
  }
  dialog: {
    open(options: {
      title?: string
      filters?: DialogFilter[]
      properties?: ('openFile' | 'openDirectory' | 'multiSelections')[]
      defaultPath?: string
    }): Promise<string[] | null>
    confirm(options: {
      title?: string
      message: string
      detail?: string
      buttons?: string[]
      defaultId?: number
      cancelId?: number
      type?: 'none' | 'info' | 'error' | 'question' | 'warning'
    }): Promise<number>
  }
}

export const IPC = {
  appInfo: 'app:info',
  appOpenPath: 'app:open-path',
  appRevealPath: 'app:reveal-path',
  appToggleDevTools: 'app:toggle-dev-tools',
  winMinimize: 'win:minimize',
  winToggleMaximize: 'win:toggle-maximize',
  winClose: 'win:close',
  winIsMaximized: 'win:is-maximized',
  winMaximizeChanged: 'win:maximize-changed',
  appRequestOpen: 'app:request-open',
  /** 渲染层来取"本次启动要打开的文件"（惰性握手，避免推早了丢事件） */
  appTakePendingOpen: 'app:take-pending-open',

  settingsGet: 'settings:get',
  settingsPatch: 'settings:patch',
  settingsReset: 'settings:reset',
  settingsExport: 'settings:export',
  settingsImport: 'settings:import',
  settingsPickBookImage: 'settings:pick-book-image',
  settingsChooseAssetsDir: 'settings:choose-assets-dir',
  settingsMigrateInlineImages: 'settings:migrate-inline-images',
  settingsResetPaths: 'settings:reset-paths',

  libraryIndex: 'library:index',
  libraryRescan: 'library:rescan',
  libraryImportFiles: 'library:import-files',
  libraryImportFolder: 'library:import-folder',
  libraryImportPaths: 'library:import-paths',
  /** 临时打开一个文件（不进书架，退出即消失） */
  libraryOpenTemporary: 'library:open-temporary',
  /** 弹文件对话框挑一个文件临时打开 */
  libraryPickTemporary: 'library:pick-temporary',
  libraryReorder: 'library:reorder',
  libraryCreateNote: 'library:create-note',
  libraryUpdateBook: 'library:update-book',
  libraryRemoveBooks: 'library:remove-books',
  /** 从回收站还原 */
  libraryRestoreBooks: 'library:restore-books',
  /** 彻底删除（文件 + 条目） */
  libraryPurgeBooks: 'library:purge-books',
  libraryRecord: 'library:record',
  librarySaveRecord: 'library:save-record',
  libraryRecordUsage: 'library:record-usage',
  libraryProgressMap: 'library:progress-map',
  libraryStats: 'library:stats',
  translateText: 'app:translate',
  vocabList: 'vocab:list',
  vocabAdd: 'vocab:add',
  vocabAddMany: 'vocab:addMany',
  vocabUpdate: 'vocab:update',
  vocabRemove: 'vocab:remove',
  ttsVoices: 'tts:voices',
  ttsSpeak: 'tts:speak',
  /** 第二步：从原文与译文里抽词（只走 AI 接口） */
  translateVocab: 'translate:vocab',
  translateHistoryGet: 'translate:history-get',
  translateHistorySave: 'translate:history-save',
  translateHistoryClear: 'translate:history-clear',
  assetsScan: 'assets:scan',
  assetsCleanup: 'assets:cleanup',
  libraryChooseDir: 'library:choose-dir',
  librarySaveShelves: 'library:save-shelves',
  libraryEpubInfo: 'library:epub-info',
  libraryEpubImages: 'library:epub-images',
  libraryAddBookend: 'library:add-bookend',
  libraryUpdateBookend: 'library:update-bookend',
  libraryMoveBookend: 'library:move-bookend',
  libraryRemoveMissing: 'library:remove-missing',
  libraryRemoveBookend: 'library:remove-bookend',
  libraryEnrich: 'library:enrich',
  libraryBookUpdated: 'library:book-updated',
  libraryScanProgress: 'library:scan-progress',

  filesReadText: 'files:read-text',
  filesWriteText: 'files:write-text',
  filesReadBinary: 'files:read-binary',
  filesExists: 'files:exists',
  filesStat: 'files:stat',
  filesProbe: 'files:probe',
  filesExtractDocText: 'files:extract-doc-text',
  filesExportText: 'files:export-text',
  filesExportBinary: 'files:export-binary',
  filesExportPdf: 'files:export-pdf',
  filesPickImages: 'files:pick-images',
  filesReadImage: 'files:read-image',
  filesSaveImages: 'files:save-images',
  filesChooseDirectory: 'files:choose-directory',
  filesCopyIntoLibrary: 'files:copy-into-library',
  filesCheckHtmlAssets: 'files:check-html-assets',

  dialogOpen: 'dialog:open',
  dialogConfirm: 'dialog:confirm'
} as const
