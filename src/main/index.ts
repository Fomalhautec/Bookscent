import { app, BrowserWindow, Menu, shell } from 'electron'
import { existsSync } from 'node:fs'
import { pushOpen } from './openQueue'
import { join } from 'node:path'
import { broadcast } from './events'
import { enrichLibrary, registerIpc } from './ipc'
import { currentIndex, rescan, seedFirstRun } from './library'
import { logFilePath, logLine, logSessionStart } from './log'
import { APP_ORIGIN, APP_SCHEME, registerProtocolHandlers, registerProtocolSchemes } from './protocols'
import { getSettings, saveSettings, userDataDir } from './settings'
import { ensureDir } from './store'

const isDev = !app.isPackaged
let mainWindow: BrowserWindow | null = null
let fallbackTried = false

/**
 * 这些扩展名会被当成"要打开的文件"。
 * 与 electron-builder.yml 里的 fileAssociations 对应 —— 系统双击关联文件时，
 * 路径会作为命令行参数传给本应用。
 */
const FILE_ARG = /\.(pdf|md|markdown|txt|docx?|rtf|html?|epub|png|jpe?g|webp|gif|bmp)$/i

/** 从命令行参数里挑出文件（跳过 --switch，并确认文件真的在） */
function fileArgsFrom(argv: string[]): string[] {
  return argv.filter((arg) => !arg.startsWith('-') && FILE_ARG.test(arg) && existsSync(arg))
}

/*
 * 首次启动时也要解析 argv。
 *
 * 以前只处理了 second-instance（已有实例）与 macOS 的 open-file，
 * 于是"双击关联文件、应用还没开着"这条最常见的情况**什么都不会发生**。
 */
pushOpen(fileArgsFrom(process.argv.slice(1)))

/** app://（应用自身）与 note://（HTML 笔记）都必须在 ready 之前登记 */
registerProtocolSchemes()

function iconPath(): string {
  return join(__dirname, '../../build/icon.ico')
}

function createWindow(): BrowserWindow {
  const settings = getSettings()
  const win = new BrowserWindow({
    width: settings.window.width,
    height: settings.window.height,
    x: settings.window.x ?? undefined,
    y: settings.window.y ?? undefined,
    minWidth: 1040,
    minHeight: 680,
    show: false,
    frame: false,
    autoHideMenuBar: true,
    title: '书香笔记',
    backgroundColor: settings.appTheme.includes('midnight') ? '#12151f' : '#f2ece1',
    icon: iconPath(),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
      webSecurity: true
    }
  })

  if (settings.window.maximized) win.maximize()

  let shown = false
  const reveal = (reason: string): void => {
    if (shown || win.isDestroyed()) return
    shown = true
    logLine('window', `显示窗口（${reason}）`)
    win.show()
    /*
     * F12 开关开发者控制台。
     * 应用里 Ctrl+Shift+I 被「导入」占了，所以在主进程这一层再绑一个 ——
     * 放在 before-input-event 里，不管焦点在输入框还是 iframe 里都管用。
     */
    win.webContents.on('before-input-event', (event, input) => {
      if (input.type === 'keyDown' && input.key === 'F12') {
        event.preventDefault()
        win.webContents.toggleDevTools()
      }
    })
    /*
     * 这里**不再**推送 pendingOpen。
     * 窗口刚建好、渲染层还没订阅 IPC，这时候发出去必然丢 ——
     * 改成渲染层挂载后自己来取（IPC.appTakePendingOpen），时序上就没有猜测了。
     */
  }

  win.on('ready-to-show', () => reveal('ready-to-show'))

  // 兜底：渲染层万一没走到 ready-to-show（资源加载失败、GPU 异常……），
  // 也必须在几秒后把窗口露出来，否则用户看到的就是"双击了但什么都没发生"。
  const fallback = setTimeout(() => reveal('5 秒超时兜底'), 5000)
  win.on('closed', () => clearTimeout(fallback))

  win.webContents.on('did-finish-load', () => {
    logLine('renderer', 'did-finish-load')
    clearTimeout(fallback)
  })

  win.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    logLine('renderer', `did-fail-load code=${errorCode} "${errorDescription}" url=${validatedURL} main=${isMainFrame}`)
    if (!isMainFrame) return
    // 自定义协议不可用时退回 file://，至少让界面出来（PDF worker 会受限）
    if (validatedURL.startsWith(APP_SCHEME) && !fallbackTried) {
      fallbackTried = true
      logLine('renderer', '改用 file:// 重新加载')
      void win.loadFile(join(__dirname, '../renderer/index.html')).catch((error: Error) => {
        logLine('renderer', 'file:// 回退也失败：' + error.message)
      })
      return
    }
    reveal('加载失败，仍要显示窗口')
  })

  win.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    if (level >= 2) logLine('renderer-console', `${message} (${sourceId}:${line})`)
  })

  win.webContents.on('render-process-gone', (_event, details) => {
    logLine('renderer', `render-process-gone reason=${details.reason} exitCode=${details.exitCode}`)
  })

  win.on('unresponsive', () => logLine('window', 'unresponsive'))

  win.on('maximize', () => broadcast('win:maximize-changed', true))
  win.on('unmaximize', () => broadcast('win:maximize-changed', false))

  const persistBounds = (): void => {
    if (win.isDestroyed()) return
    const current = getSettings()
    const maximized = win.isMaximized()
    const bounds = win.getNormalBounds()
    saveSettings({
      ...current,
      window: {
        width: bounds.width,
        height: bounds.height,
        x: bounds.x,
        y: bounds.y,
        maximized
      }
    })
  }

  win.on('resized', persistBounds)
  win.on('moved', persistBounds)
  win.on('close', persistBounds)

  const openExternalSafely = (url: string, source: string): boolean => {
    if (!/^(https?|mailto):/i.test(url)) return false
    logLine('window', `${source} → 交给系统浏览器：${url}`)
    void shell.openExternal(url)
    return true
  }

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (!openExternalSafely(url, 'window.open')) {
      logLine('window', `已拦截 window.open：${url}`)
    }
    return { action: 'deny' }
  })

  // HTML 笔记里的普通链接：不要在 iframe 里把笔记导航走，交给系统浏览器
  win.webContents.on('will-frame-navigate', (details) => {
    if (!/^https?:/i.test(details.url)) return
    details.preventDefault()
    openExternalSafely(details.url, '笔记内链接')
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    logLine('window', '开发模式，加载 ' + process.env.ELECTRON_RENDERER_URL)
    void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    logLine('window', '加载 ' + `${APP_ORIGIN}/index.html`)
    void win.loadURL(`${APP_ORIGIN}/index.html`)
  }

  return win
}

function buildMenu(): void {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: '文件',
      submenu: [
        { role: 'quit', label: '退出' }
      ]
    },
    {
      label: '编辑',
      submenu: [
        { role: 'undo', label: '撤销' },
        { role: 'redo', label: '重做' },
        { type: 'separator' },
        { role: 'cut', label: '剪切' },
        { role: 'copy', label: '复制' },
        { role: 'paste', label: '粘贴' },
        { role: 'selectAll', label: '全选' }
      ]
    },
    {
      label: '视图',
      submenu: [
        { role: 'reload', label: '重新载入' },
        { role: 'toggleDevTools', label: '开发者工具' },
        { type: 'separator' },
        { role: 'resetZoom', label: '重置缩放' },
        { role: 'zoomIn', label: '放大' },
        { role: 'zoomOut', label: '缩小' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: '全屏' }
      ]
    }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', (_event, argv) => {
    const files = fileArgsFrom(argv)
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
      if (files.length) broadcast('app:request-open', files)
    } else {
      pushOpen(files)
    }
  })

  app.on('open-file', (event, path) => {
    event.preventDefault()
    if (mainWindow) broadcast('app:request-open', [path])
    else pushOpen([path])
  })

  void app.whenReady().then(() => {
    logSessionStart()
    logLine('boot', `启动日志：${logFilePath()}`)
    logLine('boot', `单实例锁 ${gotLock ? '已取得' : '未取得'}`)
    app.setAppUserModelId('com.bookscent.note')
    ensureDir(userDataDir())
    registerProtocolHandlers()
    buildMenu()
    registerIpc()
    logLine('boot', 'IPC 已注册')
    try {
      rescan()
      logLine('boot', '藏书目录已扫描')
    } catch (error) {
      logLine('boot', '★ 扫描失败：' + (error as Error).message)
    }
    mainWindow = createWindow()
    logLine('boot', '主窗口已创建')

    // 首次运行放示例文件；放完再扫一遍，书架上就会出现那几本"样书"
    void seedFirstRun()
      .then(() => {
        rescan()
        logLine('boot', '示例文件已就绪')
      })
      .catch((error: Error) => logLine('boot', '★ 示例文件生成失败：' + error.message))

    mainWindow.webContents.once('did-finish-load', () => {
      void enrichLibrary().catch((error: Error) => logLine('boot', '★ 页数统计失败：' + error.message))
    })

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) mainWindow = createWindow()
    })
  })

  process.on('uncaughtException', (error) => {
    logLine('fatal', 'uncaughtException: ' + (error.stack ?? error.message))
  })
  process.on('unhandledRejection', (reason) => {
    logLine('fatal', 'unhandledRejection: ' + String(reason))
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })

  app.on('before-quit', () => {
    try {
      void currentIndex()
    } catch {
      /* 退出时不要再抛错 */
    }
  })
}

export { isDev }
