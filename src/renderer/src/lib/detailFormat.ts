/**
 * 详情页用到的两个格式化（与阅读界面底栏一致的说法）。
 *
 * 单独放一个小文件而不是塞进 lib/format：那边的 formatInt 语义是"字数"
 * （会带「字」后缀），这里要的是纯数字千分位。
 */
export function formatInt(value: number): string {
  return Math.round(value).toLocaleString('zh-CN')
}

export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds))
  if (total <= 0) return '还没记'
  if (total < 60) return `${total} 秒`
  const minutes = Math.floor(total / 60)
  if (minutes < 60) return `${minutes} 分`
  const hours = Math.floor(minutes / 60)
  return `${hours} 小时 ${minutes % 60} 分`
}