/**
 * 让主进程能在"没有图形环境"的机器上被真正执行一遍。
 *
 * 用法（ELECTRON_RUN_AS_NODE 下，Electron 就是 Node）：
 *   electron.exe -r scripts/fake-electron.cjs out/main/index.js
 *   Bookscent.exe -r scripts/fake-electron.cjs release/win-unpacked/resources/app.asar
 *
 * 它把 require('electron') 换成一个足够真的事件桩：模块是否缺失、启动流程是否会抛错、
 * 首次运行生成示例 PDF 是否会失败，都能在这里暴露出来。
 * 这是产品代码之外的诊断夹具，不参与打包。
 */
const Module = require('node:module')
const path = require('node:path')
const os = require('node:os')
const fs = require('node:fs')
const { EventEmitter } = require('node:events')

const sandbox = path.join(process.cwd(), '.smoke-sandbox')
const userData = path.join(sandbox, 'userData')
const documents = path.join(sandbox, 'documents')
fs.rmSync(sandbox, { recursive: true, force: true })
fs.mkdirSync(userData, { recursive: true })
fs.mkdirSync(documents, { recursive: true })

const log = (msg) => console.log('[smoke] ' + msg)

const app = new EventEmitter()
Object.assign(app, {
  isPackaged: process.env.BOOKSCENT_SMOKE_PACKAGED === '1',
  getVersion: () => '0.1.1',
  getPath: (name) => {
    if (name === 'userData') return userData
    if (name === 'documents') return documents
    if (name === 'temp') return os.tmpdir()
    return sandbox
  },
  getAppPath: () => process.env.BOOKSCENT_SMOKE_APP_PATH || process.cwd(),
  setAppUserModelId: () => {},
  requestSingleInstanceLock: () => true,
  quit: () => log('app.quit() 被调用'),
  whenReady: () => Promise.resolve()
})

let windowCount = 0
class FakeWebContents extends EventEmitter {
  setWindowOpenHandler() {}
  send(channel) {
    log('webContents.send ' + channel)
  }
  once(name, fn) {
    super.once(name, fn)
    return this
  }
}

class FakeBrowserWindow extends EventEmitter {
  constructor(options) {
    super()
    windowCount += 1
    this.options = options
    this.webContents = new FakeWebContents()
    this.id = windowCount
    this.destroyed = false
    this.maximized = false
    FakeBrowserWindow.instances.push(this)
    log(`BrowserWindow #${this.id} 创建：frame=${options.frame} 尺寸=${options.width}x${options.height}`)
    if (options.webPreferences?.preload) {
      const preload = options.webPreferences.preload
      log('  preload 是否存在: ' + fs.existsSync(preload) + '  ' + preload)
      if (!fs.existsSync(preload)) throw new Error('preload 脚本不存在：' + preload)
    }
  }
  on(name, fn) {
    super.on(name, fn)
    return this
  }
  once(name, fn) {
    super.once(name, fn)
    return this
  }
  show() {
    this.emit('ready-to-show')
  }
  loadURL(url) {
    log('  loadURL: ' + url)
    if (url.startsWith('app://')) {
      const pathname = decodeURIComponent(new URL(url).pathname) || '/index.html'
      const target = path.join(process.env.BOOKSCENT_SMOKE_APP_PATH || process.cwd(), 'out', 'renderer', pathname)
      log('  该 URL 对应的静态文件存在: ' + fs.existsSync(target))
    }
    setTimeout(() => this.webContents.emit('did-finish-load'), 30)
    return Promise.resolve()
  }
  loadFile() {
    return Promise.resolve()
  }
  maximize() {
    this.maximized = true
  }
  unmaximize() {
    this.maximized = false
  }
  isMaximized() {
    return this.maximized
  }
  isMinimized() {
    return false
  }
  isDestroyed() {
    return this.destroyed
  }
  minimize() {}
  restore() {}
  focus() {}
  close() {}
  getNormalBounds() {
    return { x: 0, y: 0, width: 1500, height: 940 }
  }
  static getAllWindows() {
    return FakeBrowserWindow.instances
  }
  static fromWebContents() {
    return FakeBrowserWindow.instances[0] ?? null
  }
}
FakeBrowserWindow.instances = []

const ipcHandlers = new Map()
const stub = {
  app,
  BrowserWindow: FakeBrowserWindow,
  Menu: {
    buildFromTemplate: (t) => ({ template: t }),
    setApplicationMenu: () => {}
  },
  protocol: {
    registerSchemesAsPrivileged: (s) => log('registerSchemesAsPrivileged ' + JSON.stringify(s.map((x) => x.scheme))),
    handle: (scheme, handler) => {
      log('protocol.handle ' + scheme)
      stub.__appProtocol = handler
    }
  },
  ipcMain: {
    handle: (channel, fn) => {
      ipcHandlers.set(channel, fn)
    },
    on: (channel, fn) => {
      ipcHandlers.set(channel, fn)
    }
  },
  shell: {
    openPath: async () => '',
    showItemInFolder: () => {}
  },
  dialog: {
    showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
    showSaveDialog: async () => ({ canceled: true, filePath: undefined }),
    showMessageBox: async () => ({ response: 0 })
  },
  webUtils: { getPathForFile: () => '' }
}

const originalLoad = Module._load
Module._load = function (request, parent, isMain) {
  if (request === 'electron') return stub
  return originalLoad.call(this, request, parent, isMain)
}

// 让 BrowserWindow 知道 renderer 目录，好检查静态资源是否真的存在
const appPath = process.env.BOOKSCENT_SMOKE_APP_PATH || process.cwd()

process.on('uncaughtException', (error) => {
  console.error('[smoke] ★ 未捕获异常：' + error.stack)
  process.exitCode = 1
  setTimeout(() => process.exit(1), 50)
})

log('sandbox: ' + sandbox)
log('appPath: ' + appPath)
log('打包模式: ' + app.isPackaged)

setTimeout(() => {
  log('检查点：窗口数 = ' + windowCount + '，已注册 IPC 通道 = ' + ipcHandlers.size)

  // 真正跑一遍 app:// 协议处理器，确认渲染层资源能取到
  if (stub.__appProtocol) {
    const root = path.join(appPath, 'out', 'renderer')
    Promise.all([
      stub.__appProtocol({ url: 'app://bundle/index.html' }),
      stub.__appProtocol({ url: 'app://bundle/assets/index-CCkVH5ES.js' }),
      stub.__appProtocol({ url: 'app://bundle/../package.json' })
    ])
      .then(async (responses) => {
        log('app:// index.html -> ' + responses[0].status + ' ' + responses[0].headers.get('content-type'))
        log('app:// 越权路径 -> ' + responses[2].status + '（期望 403）')
        const html = await responses[0].text()
        const asset = html.match(/src="\.\/(assets\/[^"]+)"/)
        if (asset) {
          const assetPath = path.join(root, asset[1])
          log('index.html 引用的入口脚本: ' + asset[1] + ' -> 存在=' + fs.existsSync(assetPath))
        } else {
          log('★ index.html 里没找到入口脚本引用')
        }
        finish()
      })
      .catch((error) => {
        log('★ app:// 处理器抛错：' + error.message)
        finish(1)
      })
  } else {
    finish()
  }
}, 2500)

function finish(code) {
  log('完成。')
  setTimeout(() => process.exit(code ?? 0), 100)
}
