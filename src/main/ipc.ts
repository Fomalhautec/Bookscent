import { BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { IPC } from '@shared/ipc'
import type { DeepPartial, ExportPdfOptions } from '@shared/ipc'
import type {
  AppInfo,
  AppSettings,
  Book,
  BookendSide,
  BookRecord,
  DialogFilter,
  ExtractImagesOptions,
  LibraryIndex,
  SaveImageFile,
  Shelf,
  StatsOverview,
  UsageDelta,
  UsageKey,
  WordEntry
} from '@shared/types'
import { APP_VERSION } from '@shared/types'
import * as files from './files'
import * as library from './library'
import { logLine } from './log'
import { takeOpen } from './openQueue'
import { defaultSettings, getSettings, resetPaths, saveSettings, userDataDir } from './settings'
import { extractVocab, translateText } from './translate'
import { cleanupAssets, scanAssets } from './cleanup'
import { listTtsVoices, synthesizeSpeech, type TtsSpeakRequest } from './tts'
import { addWord, addWords, listWords, removeWord, updateWord, type AddWordInput } from './vocabulary'
import {
  applyHistoryPolicyOnStart,
  clearTranslateHistory,
  readTranslateHistory,
  saveTranslateHistory
} from './translate'
import type { TranslateHistoryEntry } from '@shared/types'
import { deepMerge, writeJson } from './store'
import { DOCUMENT_FILTERS } from './util'
import { checkHtmlAssets } from './protocols'
import { epubImages, epubInfo } from './epub'
import { migrateInlineImages, moveAssets } from './assets'
import { renderHtmlToPdf } from './exportPdf'
import { broadcast } from './events'

/** 统一包一层：任何异常都变成可读的 reject，而不是把主进程打崩 */
function handle<A extends unknown[], R>(channel: string, fn: (...args: A) => R | Promise<R>): void {
  ipcMain.handle(channel, async (_event, ...args) => {
    try {
      return await fn(...(args as A))
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(message)
    }
  })
}

function win(): BrowserWindow | null {
  return BrowserWindow.getAllWindows()[0] ?? null
}

export function registerIpc(): void {
  /*
   * 启动时按设置的策略清一次翻译记录（`session` 模式就是"每次加载都清"）。
   * 放在注册 IPC 的最前面：这时候设置已经读得到了。
   */
  applyHistoryPolicyOnStart()

  /* ------------------------------------------------------------ 应用信息 */

  handle(IPC.appInfo, (): AppInfo => {
    const index = library.currentIndex()
    return {
      version: APP_VERSION,
      name: '书香笔记',
      platform: process.platform,
      userDataDir: userDataDir(),
      libraryDir: index.libraryDir,
      electron: process.versions.electron ?? '',
      chrome: process.versions.chrome ?? '',
      node: process.versions.node ?? ''
    }
  })

  handle(IPC.appOpenPath, (path: string) => shell.openPath(path))
  handle(IPC.appRevealPath, (path: string) => {
    shell.showItemInFolder(path)
  })

  /*
   * 开发者控制台。
   * 应用里 Ctrl+Shift+I 被「导入」占了，所以给设置页一个显式入口；
   * 顺手也绑 F12，跟浏览器一个习惯。
   */
  handle(IPC.appToggleDevTools, () => {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    if (!win) return false
    win.webContents.toggleDevTools()
    return win.webContents.isDevToolsOpened()
  })

  /* ------------------------------------------------------------ 窗口控制 */

  handle(IPC.winMinimize, () => {
    win()?.minimize()
  })

  handle(IPC.winToggleMaximize, (): boolean => {
    const w = win()
    if (!w) return false
    if (w.isMaximized()) w.unmaximize()
    else w.maximize()
    return w.isMaximized()
  })

  handle(IPC.winClose, () => {
    win()?.close()
  })

  handle(IPC.winIsMaximized, (): boolean => win()?.isMaximized() ?? false)

  /* ------------------------------------------------------------ 设置 */

  handle(IPC.settingsGet, (): AppSettings => getSettings())

  handle(IPC.settingsPatch, (patch: DeepPartial<AppSettings>): AppSettings => {
    const current = getSettings()
    const merged = deepMerge(current, patch)
    return saveSettings({ ...merged, schema: current.schema })
  })

  handle(IPC.settingsReset, (): AppSettings => saveSettings(defaultSettings()))

  handle(IPC.settingsExport, async () => {
    const result = await dialog.showSaveDialog({
      title: '导出外观与偏好设置',
      defaultPath: 'bookscent-settings.json',
      filters: [{ name: 'JSON', extensions: ['json'] }]
    })
    if (result.canceled || !result.filePath) return { path: null, cancelled: true }
    writeJson(result.filePath, getSettings())
    return { path: result.filePath, cancelled: false }
  })

  handle(IPC.settingsImport, async () => {
    const result = await dialog.showOpenDialog({
      title: '导入设置',
      properties: ['openFile'],
      filters: [{ name: 'JSON', extensions: ['json'] }]
    })
    if (result.canceled || !result.filePaths[0]) {
      return { settings: getSettings(), cancelled: true }
    }
    const raw = JSON.parse(files.readText(result.filePaths[0])) as Partial<AppSettings>
    return { settings: saveSettings(deepMerge(defaultSettings(), raw)), cancelled: false }
  })

  handle(IPC.settingsResetPaths, (paths: string[]) => resetPaths(paths))

  handle(IPC.settingsMigrateInlineImages, async () => {
    return migrateInlineImages()
  })

  handle(IPC.settingsPickBookImage, async (hint?: string) => {
    const picked = await files.pickImages()
    if (picked.length === 0) return null
    return files.storeBookImage(picked[0].path)
  })

  handle(IPC.settingsChooseAssetsDir, async () => {
    const dir = await files.chooseDirectory('选择书籍外观图片的存放目录')
    if (!dir) return null
    const current = getSettings()
    if (current.assetsDir === dir) return { dir, moved: 0, failed: 0 }
    const previous = current.assetsDir
    saveSettings({ ...current, assetsDir: dir })
    const moved = previous ? moveAssets(previous, dir) : { moved: 0, failed: 0 }
    return { dir, ...moved }
  })

  /* ------------------------------------------------------------ 书架 */

  handle(IPC.libraryIndex, (): LibraryIndex => library.currentIndex())

  handle(IPC.libraryRescan, (): LibraryIndex => {
    const next = library.rescan()
    void enrichLibrary()
    return next
  })

  /*
   * 导入分成两个入口。
   * 之前把 openFile 和 openDirectory 写在同一个 properties 里，
   * Windows 只会给一个"选文件夹"的对话框 —— 于是"只能导入整个文件夹"。
   */
  handle(IPC.libraryImportFiles, async (copy: boolean) => {
    const result = await dialog.showOpenDialog(win() ?? undefined!, {
      title: copy ? '导入文件（复制到藏书目录）' : '引用外部文件（不复制）',
      properties: ['openFile', 'multiSelections'],
      filters: DOCUMENT_FILTERS
    })
    if (result.canceled || result.filePaths.length === 0) {
      logLine('import', '文件对话框取消或没选文件')
      return null
    }
    /* 导入链路的每一步都留痕，出问题时照着日志就能定位（用户要求） */
    logLine('import', `对话框选中 ${result.filePaths.length} 个文件（copy=${copy}）：${result.filePaths.join(' | ')}`)
    const imported = library.importPaths(result.filePaths, copy)
    logLine('import', `导入结束：新增 ${imported.added.length}，跳过 ${imported.skipped.length}`)
    void enrichLibrary()
    return imported
  })

  handle(IPC.libraryImportFolder, async (copy: boolean) => {
    const result = await dialog.showOpenDialog(win() ?? undefined!, {
      title: copy ? '导入文件夹（递归复制到藏书目录）' : '引用文件夹（不复制）',
      properties: ['openDirectory', 'multiSelections']
    })
    if (result.canceled || result.filePaths.length === 0) {
      logLine('import', '文件夹对话框取消或没选目录')
      return null
    }
    logLine('import', `对话框选中 ${result.filePaths.length} 个目录（copy=${copy}）：${result.filePaths.join(' | ')}`)
    const imported = library.importPaths(result.filePaths, copy)
    logLine('import', `导入结束：新增 ${imported.added.length}，跳过 ${imported.skipped.length}`)
    void enrichLibrary()
    return imported
  })

  handle(IPC.libraryReorder, (orderedIds: string[]): LibraryIndex => library.reorderBooks(orderedIds))

  handle(IPC.libraryImportPaths, (paths: string[], copy: boolean) => {
    logLine('import', `接口导入 ${paths.length} 个路径（copy=${copy}）：${paths.join(' | ')}`)
    const imported = library.importPaths(paths, copy)
    logLine('import', `导入结束：新增 ${imported.added.length}，跳过 ${imported.skipped.length}`)
    void enrichLibrary()
    return imported
  })

  /*
   * 渲染层挂载后来取"本次启动要打开的文件"（双击关联文件 / 打开方式）。
   * 用取而不是推：窗口建好时渲染层还没订阅 IPC，推出去必然丢。
   */
  handle(IPC.appTakePendingOpen, (): string[] => takeOpen())

  handle(IPC.libraryCreateNote, (kind: 'md' | 'txt', title?: string) => library.createNote(kind, title))

  /*
   * 临时打开：只为看一眼电脑里的文件，不进书架。
   * 走的是同一条阅读通道（阅读器 / 书签 / 进度都能用），只是在索引里打了 temporary 标记，
   * 下次启动会被丢掉；用户在阅读界面点「添加到书架」就转正。
   */
  handle(IPC.libraryOpenTemporary, (path: string) => {
    logLine('import', `临时打开：${path}`)
    const book = library.openTemporary(path)
    void enrichLibrary()
    return { book, index: library.currentIndex() }
  })

  handle(IPC.libraryPickTemporary, async () => {
    const result = await dialog.showOpenDialog(win() ?? undefined!, {
      title: '临时打开（不进书架）',
      properties: ['openFile', 'multiSelections'],
      filters: DOCUMENT_FILTERS
    })
    if (result.canceled || result.filePaths.length === 0) {
      logLine('import', '临时打开：对话框取消')
      return null
    }
    /* 多选时只开第一个 —— 临时看的语义是"这一份"，其余忽略 */
    const book = library.openTemporary(result.filePaths[0])
    logLine('import', `临时打开：${book.title}（选了 ${result.filePaths.length} 个，开第一个）`)
    void enrichLibrary()
    return { book, index: library.currentIndex() }
  })

  handle(IPC.libraryUpdateBook, (id: string, patch: Partial<Book>) => library.updateBook(id, patch))

  handle(IPC.libraryRemoveBooks, (ids: string[], deleteFiles: boolean) => library.removeBooks(ids, deleteFiles))

  handle(IPC.libraryRestoreBooks, (ids: string[]) => library.restoreBooks(ids))

  handle(IPC.libraryPurgeBooks, (ids: string[]) => library.purgeBooks(ids))

  handle(IPC.libraryRecord, (id: string): BookRecord => library.getRecord(id))

  handle(IPC.librarySaveRecord, (record: BookRecord): BookRecord => library.saveRecord(record))
  handle(IPC.libraryRecordUsage, (id: string, key: UsageKey, delta: UsageDelta): BookRecord =>
    library.recordUsage(id, key, delta)
  )
  handle(IPC.libraryProgressMap, (): Record<string, number> => library.progressMap())
  handle(IPC.libraryStats, (): StatsOverview => library.statsOverview())

  /*
   * 翻译：配置由主进程自己的设置文件提供，渲染层只送文本与上下文。
   * 这里把「用哪条接口配置」与「用哪套提示词」解析好再交给服务 ——
   * 服务只管发请求，不关心设置结构。
   */
  /* 图片数据目录的体检与清理（先报告、再动手） */
  /* 翻译记录：读取 / 保存 / 清空（保留策略在主进程按设置执行） */
  handle(IPC.translateHistoryGet, () => readTranslateHistory())
  handle(IPC.translateHistorySave, (entries: TranslateHistoryEntry[]) => saveTranslateHistory(entries))
  handle(IPC.translateHistoryClear, () => {
    clearTranslateHistory()
  })

  /* 单词本 */
  handle(IPC.vocabList, () => listWords())
  handle(IPC.vocabAdd, (input: AddWordInput) => addWord(input))
  handle(IPC.vocabAddMany, (inputs: AddWordInput[]) => addWords(inputs))
  handle(IPC.vocabUpdate, (id: string, patch: Partial<WordEntry>) => updateWord(id, patch))
  handle(IPC.vocabRemove, (id: string) => removeWord(id))

  /* 朗读：语音清单与在线合成 */
  handle(IPC.ttsVoices, (force: boolean) => listTtsVoices(force === true))
  handle(IPC.ttsSpeak, (request: TtsSpeakRequest) => synthesizeSpeech(request))

  handle(IPC.assetsScan, () => scanAssets())
  handle(IPC.assetsCleanup, (options: { orphans: boolean; duplicates: boolean }) =>
    cleanupAssets({ orphans: options?.orphans === true, duplicates: options?.duplicates === true })
  )

  handle(IPC.translateText, async (request: { text: string; context: string[] }) => {
    const translate = getSettings().translate
    const endpoint = translate.endpoints.find((item) => item.id === translate.activeId) ?? null
    const prompt =
      translate.presets.find((preset) => preset.id === translate.activePresetId)?.prompt ?? null
    return translateText({
      text: request.text,
      context: request.context ?? [],
      endpoint,
      target: translate.target,
      prompt: prompt ?? undefined
    })
  })

  /*
   * 第二步：从"原文 + 译文"里抽词。
   * 翻译接口是机器翻译时没有模型可用，所以这里把全部 AI 接口作为候选一并传给 extractVocab，
   * 由它自己挑一条能用的并发请求。
   */
  handle(
    IPC.translateVocab,
    (request: { source: string; translation: string; analysis?: string }) => {
      const translate = getSettings().translate
      const endpoint = translate.endpoints.find((item) => item.id === translate.activeId) ?? null
      return extractVocab({
        source: request.source,
        translation: request.translation,
        analysis: request.analysis,
        target: translate.target,
        endpoint,
        aiEndpoints: translate.endpoints.filter((item) => item.kind === 'ai')
      })
    }
  )

  handle(IPC.libraryChooseDir, async () => {
    const dir = await files.chooseDirectory('选择藏书目录')
    if (!dir) return null
    return { dir, index: library.chooseLibraryDir(dir) }
  })

  handle(IPC.librarySaveShelves, (shelves: Shelf[]): LibraryIndex => library.saveShelves(shelves))
  handle(IPC.libraryAddBookend, (shelfId: string, anchorBookId: string | null, side?: BookendSide) =>
    library.addBookend(shelfId, anchorBookId, side)
  )
  handle(
    IPC.libraryUpdateBookend,
    (id: string, patch: { gap?: number; label?: string; side?: BookendSide; breakLine?: boolean }) =>
      library.updateBookend(id, patch)
  )
  handle(IPC.libraryRemoveMissing, () => library.removeMissing())
  handle(IPC.libraryMoveBookend, (id: string, direction: -1 | 1) =>
    library.moveBookend(id, direction)
  )
  handle(IPC.libraryRemoveBookend, (id: string) => library.removeBookend(id))

  handle(IPC.libraryEpubImages, (path: string) => {
    const book = library.currentIndex().books.find((item) => item.path === path)
    if (!book) return []
    return epubImages(book.id, path)
  })

  handle(IPC.libraryEpubInfo, (path: string) => {
    const book = library.currentIndex().books.find((item) => item.path === path)
    if (!book) return null
    return epubInfo(book.id, path)
  })

  handle('library:enrich', async (): Promise<boolean> => {
    await enrichLibrary()
    return true
  })

  /* ------------------------------------------------------------ 文件 */

  handle(IPC.filesReadText, (path: string) => files.readText(path))
  handle(IPC.filesWriteText, (path: string, content: string) => files.writeText(path, content))
  handle(IPC.filesReadBinary, (path: string) => files.readBinary(path))
  handle(IPC.filesExists, (path: string) => files.fileStat(path).exists)
  handle(IPC.filesStat, (path: string) => files.fileStat(path))
  handle(IPC.filesProbe, (path: string) => library.probeFile(path))
  handle(IPC.filesExtractDocText, (path: string) => library.extractDocText(path))

  handle(IPC.filesExportText, (defaultName: string, content: string, filters?: DialogFilter[]) =>
    files.exportText(defaultName, content, filters)
  )
  handle(IPC.filesExportBinary, (defaultName: string, data: Uint8Array, filters?: DialogFilter[]) =>
    files.exportBinary(defaultName, data, filters)
  )
  handle(IPC.filesPickImages, () => files.pickImages())
  handle(IPC.filesReadImage, (path: string) => files.readImage(path))
  handle(IPC.filesSaveImages, (options: ExtractImagesOptions, payload: SaveImageFile[]) =>
    files.saveImages(options, payload)
  )
  handle(IPC.filesExportPdf, async (options: ExportPdfOptions) => renderHtmlToPdf(options))
  handle(IPC.filesChooseDirectory, (title?: string) => files.chooseDirectory(title))
  handle(IPC.filesCopyIntoLibrary, (path: string) => files.copyIntoLibrary(path))
  handle(IPC.filesCheckHtmlAssets, (path: string) => checkHtmlAssets(path))

  /* ------------------------------------------------------------ 对话框 */

  handle(
    IPC.dialogOpen,
    async (options: {
      title?: string
      filters?: DialogFilter[]
      properties?: string[]
      defaultPath?: string
    }) => {
      const result = await dialog.showOpenDialog(win() ?? undefined!, {
        title: options?.title,
        defaultPath: options?.defaultPath,
        filters: options?.filters,
        properties: (options?.properties ?? ['openFile']) as never
      })
      return result.canceled ? null : result.filePaths
    }
  )

  handle(
    IPC.dialogConfirm,
    async (options: {
      title?: string
      message: string
      detail?: string
      buttons?: string[]
      defaultId?: number
      cancelId?: number
      type?: 'none' | 'info' | 'error' | 'question' | 'warning'
    }) => {
      const result = await dialog.showMessageBox(win() ?? undefined!, {
        ...options,
        noLink: true
      })
      return result.response
    }
  )
}

/* ------------------------------------------------------ 页数补齐（后台） */

let enriching = false

/**
 * 首次扫描只做目录遍历，页数留给后台补齐：每完成一本就推送一次，
 * 书架上的书脊宽度会随之"长"到应有的厚度，界面不会被大库卡住。
 */
export async function enrichLibrary(): Promise<void> {
  if (enriching) return
  enriching = true
  try {
    const index = library.currentIndex()
    const pending = index.books.filter((b) => !b.missing && (b.pageCount === 0 || b.probeSize !== b.size))
    /*
     * 顺手补录封面：早先导入的 EPUB（尤其 external=true 的引用式导入，
     * 那时钩子只挂在 rescan 上）永远不会有封面，架上就是一张空白封面。
     * 每轮**限量**，避免一次解开几十本书把启动拖长；没补完的下一轮继续
     * （试过的书打 coverChecked 标记，不会反复解包）。
     */
    const covers = index.books.filter((b) => library.needsCover(b)).slice(0, 12)
    if (pending.length === 0 && covers.length === 0) return

    const total = pending.length + covers.length
    let done = 0
    broadcast('library:scan-progress', { done, total, finished: false })
    const queue = [...pending]
    const worker = async (): Promise<void> => {
      for (;;) {
        const book = queue.shift()
        if (!book) return
        const probe = await library.probeFile(book.path)
        const current = library.currentIndex()
        const at = current.books.findIndex((b) => b.id === book.id)
        if (at >= 0) {
          current.books[at] = {
            ...current.books[at],
            pageCount: probe.pages,
            pageCountExact: probe.exact,
            words: probe.words || current.books[at].words || 0,
            probeSize: current.books[at].size
          }
          library.persist(current)
          broadcast('library:book-updated', current.books[at])
        }
        done++
        broadcast('library:scan-progress', { done, total, finished: false })
      }
    }
    await Promise.all([worker(), worker(), worker()])

    logLine('import', `后台补录封面：本轮 ${covers.length} 本`)
    for (const book of covers) {
      /*
       * 每本之间让出一次事件循环。
       * 补录跑在**主进程**上，连着解包几十本书会把界面（以及探针的求值）堵住 ——
       * 用户反馈的"启动变慢"和整套验证时的卡顿都有这一份。
       */
      await new Promise((resolve) => setTimeout(resolve, 30))
      const current = library.currentIndex()
      const at = current.books.findIndex((b) => b.id === book.id)
      if (at >= 0 && library.needsCover(current.books[at])) {
        current.books[at] = library.applyEpubCover(current.books[at])
        library.persist(current)
        broadcast('library:book-updated', current.books[at])
      }
      const after = library.currentIndex().books.find((b) => b.id === book.id)
      logLine(
        'import',
        `补录结果：${book.title.slice(0, 24)} → ${after?.style?.coverImage ?? '（这本书里没有可用封面）'}`
      )
      done++
      broadcast('library:scan-progress', { done, total, finished: false })
    }
    broadcast('library:scan-progress', { done: total, total, finished: true })
  } finally {
    enriching = false
  }
}
