import { app } from 'electron'
import { appendFileSync, existsSync, mkdirSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * 启动诊断日志。
 *
 * 打包后的应用"双击没反应"是最难猜的一类故障：窗口没出现，用户看不到任何信息。
 * 所以主进程从第一行就把关键节点写进 userData/startup.log，
 * 出问题时只要把这份日志发出来，就能定位到底是加载失败、渲染进程崩溃，还是根本没过协议层。
 */
const MAX_BYTES = 512 * 1024

let logFile = ''

function file(): string {
  if (logFile) return logFile
  try {
    const dir = app.getPath('userData')
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    logFile = join(dir, 'startup.log')
  } catch {
    logFile = join(process.cwd(), 'startup.log')
  }
  return logFile
}

function rotate(path: string): void {
  try {
    if (existsSync(path) && statSync(path).size > MAX_BYTES) {
      renameSync(path, `${path}.1`)
    }
  } catch {
    /* 轮转失败不影响记录 */
  }
}

export function logLine(scope: string, message: string): void {
  const stamp = new Date().toISOString()
  const line = `${stamp} [${scope}] ${message}\n`
  try {
    const path = file()
    rotate(path)
    appendFileSync(path, line, 'utf8')
  } catch {
    /* 磁盘不可写时静默 */
  }
  if (!app.isPackaged || process.env.BOOKSCENT_DEBUG) {
    console.log(`[${scope}] ${message}`)
  }
}

/** 每次启动写一段新的会话头，方便把多天的日志分开看 */
export function logSessionStart(): void {
  try {
    const path = file()
    if (!existsSync(path)) {
      // 带 UTF-8 BOM，保证记事本 / Excel 打开不乱码
      writeFileSync(path, '\ufeff', 'utf8')
    }
    appendFileSync(path, `\n===== 启动 ${new Date().toISOString()} =====\n${sessionInfo()}\n`, 'utf8')
  } catch {
    /* 忽略 */
  }
}

/** 逐项取值，任何一项拿不到都不能让整段诊断信息丢失 */
function sessionInfo(): string {
  const lines: string[] = []
  const push = (label: string, read: () => string): void => {
    try {
      lines.push(`${label} ${read()}`)
    } catch (error) {
      lines.push(`${label} (读取失败：${(error as Error).message})`)
    }
  }
  push('版本', () => `${app.getVersion()} · Electron ${process.versions.electron} · Chrome ${process.versions.chrome} · Node ${process.versions.node}`)
  push('运行方式', () => `打包=${app.isPackaged} · 可执行文件 ${app.getPath('exe')}`)
  push('appPath', () => app.getAppPath())
  push('userData', () => safePath('userData'))
  push('documents', () => safePath('documents'))
  push('argv', () => process.argv.slice(1).join(' ') || '(空)')
  return lines.join('\n')
}

function safePath(name: Parameters<typeof app.getPath>[0]): string {
  try {
    return app.getPath(name)
  } catch {
    return '(不可用)'
  }
}

export function logFilePath(): string {
  return file()
}
