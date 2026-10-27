/**
 * 待打开文件的队列。
 *
 * 为什么单独一个模块：写入方在 index.ts（启动参数、second-instance、open-file），
 * 读取方是 ipc.ts 里的渲染层请求 —— 两边都要拿到同一份队列，
 * 放在 index.ts 里会造成 ipc ↔ index 的循环依赖。
 *
 * 设计上取过一次就清空：渲染层挂载后主动来取（见 IPC.appTakePendingOpen），
 * 这样不存在"推早了渲染层还没订阅"的时序问题。
 */
const pending: string[] = []

export function pushOpen(paths: string[]): void {
  for (const path of paths) {
    if (path && !pending.includes(path)) pending.push(path)
  }
}

export function takeOpen(): string[] {
  const out = [...pending]
  pending.length = 0
  return out
}

export function hasOpen(): boolean {
  return pending.length > 0
}
