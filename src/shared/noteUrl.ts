/**
 * HTML 笔记的专用来源（origin）规则。
 *
 * 为什么需要它：DSH 这类工具生成的 HTML 笔记是**自包含的交互式页面**——
 * 内联 CSS/JS，常常还引用同目录（或 lib/ 子目录）下的 .js / .css。
 * 如果把它净化后塞进应用自己的 DOM，脚本会被清掉、相对路径也会失效。
 *
 * 所以这类笔记用独立协议 `note://` 加载到 iframe 里：
 *  - 路径按原样保留，相对资源因此能正确解析；
 *  - 每本书一个 host，与 `app://bundle` 不同源，笔记脚本碰不到我们的界面与 API；
 *  - 主进程只允许访问"这本书所在的那个目录"及其子目录，越界一律 403。
 */

export const NOTE_SCHEME = 'note'

/**
 * 由书籍 id 推出 host。
 * host 只能包含字母、数字和连字符，所以这里把 `bk_ab12..` 里的下划线等换成连字符。
 */
export function noteHostFor(bookId: string): string {
  return 'b' + bookId.toLowerCase().replace(/[^a-z0-9]/g, '-')
}

/** 逐段编码磁盘路径：保留目录层级，相对资源才能正确解析 */
export function encodeNotePath(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/').replace(/^\/+/, '')
  return normalized
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/')
}

/** bookId + 绝对路径 → iframe 可以直接用的 note:// 地址 */
export function noteUrlFor(bookId: string, filePath: string): string {
  return `${NOTE_SCHEME}://${noteHostFor(bookId)}/${encodeNotePath(filePath)}`
}

/** note:// 的 pathname → 正斜杠路径（主进程再交给 path.win32 归一化） */
export function decodeNotePath(pathname: string): string {
  return pathname
    .replace(/^\/+/, '')
    .split('/')
    .map((segment) => {
      try {
        return decodeURIComponent(segment)
      } catch {
        return segment
      }
    })
    .join('/')
}

/* ---------------------------------------------------- 书籍外观图片资源 */

export const ASSET_SCHEME = 'asset'
export const ASSET_HOST = 'local'
/** 存在数据目录里的图片用这个前缀引用，避免把 base64 塞进 library.json */
export const ASSET_PREFIX = 'asset:'

export function assetRef(fileName: string): string {
  return `${ASSET_PREFIX}${fileName}`
}

export function isAssetRef(value: string | null | undefined): boolean {
  return Boolean(value && value.startsWith(ASSET_PREFIX))
}

export function assetUrl(fileName: string): string {
  return `${ASSET_SCHEME}://${ASSET_HOST}/${encodeURIComponent(fileName)}`
}

/** 图片字段 → 可以直接放进 <img>/background 的地址（兼容历史的内联 data URL） */
export function imageSrc(value: string | null | undefined): string | undefined {
  if (!value) return undefined
  if (isAssetRef(value)) return assetUrl(value.slice(ASSET_PREFIX.length))
  return value
}

/* -------------------------------------------------------------- EPUB 资源 */

/**
 * EPUB 内部文件挂在 app:// 之下，与界面同源。
 * 同源是刻意的：渲染层要能往书页里注入阅读样式、控制分栏翻页。
 * 代价是必须剥掉书里的脚本，这件事由主进程的协议处理负责。
 */
export const EPUB_URL_PREFIX = '/__epub/'

export function epubUrlFor(bookId: string, href: string): string {
  const encoded = href
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/')
  return `${EPUB_URL_PREFIX}${encodeURIComponent(bookId)}/${encoded}`
}
