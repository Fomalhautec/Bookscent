/**
 * 页面栅格化的串行队列。
 *
 * 缩放 / 滚动时可能同时有十几页想重画，浏览器只有那么多带宽，
 * 与其并发抢资源把画面拖花，不如排队逐页画：
 * 每页进入队列时带一个「优先级」（离视口越近越小），
 * 每次只取优先级最高的那页执行，并且限制并发为 1。
 */

export interface RenderJobHandle {
  promise: Promise<void>
  cancel: () => void
}

interface QueuedJob {
  id: number
  priority: number
  run: () => RenderJobHandle
  resolve: () => void
  reject: (error: unknown) => void
  cancelled: boolean
}

export class RenderQueue {
  private readonly jobs: QueuedJob[] = []
  private running = false
  private seq = 0

  enqueue(priority: number, run: () => RenderJobHandle): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.jobs.push({
        id: ++this.seq,
        priority,
        run,
        resolve,
        reject,
        cancelled: false
      })
      void this.pump()
    })
  }

  /** 丢弃所有还没开始的作业（切书 / 切模式时用） */
  clear(): void {
    const pending = this.jobs.splice(0, this.jobs.length)
    for (const job of pending) {
      job.cancelled = true
      job.resolve()
    }
  }

  get size(): number {
    return this.jobs.length
  }

  private takeNext(): QueuedJob | null {
    if (this.jobs.length === 0) return null
    let best = 0
    for (let i = 1; i < this.jobs.length; i += 1) {
      if (this.jobs[i].priority < this.jobs[best].priority) best = i
    }
    return this.jobs.splice(best, 1)[0]
  }

  private async pump(): Promise<void> {
    if (this.running) return
    this.running = true
    try {
      for (;;) {
        const job = this.takeNext()
        if (!job) break
        if (job.cancelled) {
          job.resolve()
          continue
        }
        try {
          const handle = job.run()
          await handle.promise
          job.resolve()
        } catch (error) {
          job.reject(error)
        }
      }
    } finally {
      this.running = false
    }
  }
}
