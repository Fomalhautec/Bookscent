import { BrowserWindow } from 'electron'

/** 主进程 → 渲染进程的单向广播 */
export function broadcast(channel: string, ...args: unknown[]): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, ...args)
  }
}
