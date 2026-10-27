/**
 * 笔记图片的统一存放与读取。
 *
 * 「统一存储」指的是：图片一律落到设置里的 assetsDir（`asset:` 协议指向的目录），
 * 笔记正文里只留 `asset:<文件名>` 这样一个短引用，而不是把 base64 塞进 .md 文件、
 * 也不是散落一堆相对路径。这样换机器只搬 assetsDir 就够了。
 *
 * 本模块只走已有的 IPC（settings.pickBookImage / files.readImage / files.saveImages），
 * 不新增主进程能力。
 */

import { ASSET_PREFIX, isAssetRef } from '@shared/noteUrl'
import { filesApi, settingsApi } from '@/lib/api'
import { useSettings } from '@/store/useSettings'

/* ------------------------------------------------------------ 目录 */

export function currentAssetsDir(): string {
  return useSettings.getState().settings?.assetsDir ?? ''
}

function joinAsset(dir: string, name: string): string {
  // Windows 也接受正斜杠；统一成 '/' 免得拼接出错
  return `${dir.replace(/[\\/]+$/, '')}/${name}`
}

function baseName(filePath: string): string {
  const parts = filePath.replace(/\\/g, '/').split('/')
  return parts[parts.length - 1] ?? ''
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

/** 只接受「纯文件名」，挡住 `..` 与任何路径分隔符 */
function isPlainName(name: string): boolean {
  return Boolean(name) && !name.includes('..') && !/[\\/]/.test(name)
}

/* -------------------------------------------------------- 引用解析 */

/**
 * `asset:foo.png` / `asset://local/foo.png` / `asset://local/foo%20bar.png`
 * → 文件名；不是 asset 引用则返回 null。
 */
export function assetNameFromSrc(src: string | null | undefined): string | null {
  if (!src) return null
  const value = src.trim()
  if (value.startsWith(`${ASSET_PREFIX}//`)) {
    const rest = value.slice(ASSET_PREFIX.length + 2)
    const slash = rest.indexOf('/')
    const encoded = slash >= 0 ? rest.slice(slash + 1) : rest
    const name = safeDecode(encoded.split(/[?#]/)[0])
    return isPlainName(name) ? name : null
  }
  if (isAssetRef(value)) {
    const name = safeDecode(value.slice(ASSET_PREFIX.length).split(/[?#]/)[0])
    return isPlainName(name) ? name : null
  }
  return null
}

/** asset 引用 → 磁盘绝对路径 */
export function assetAbsolutePath(src: string | null | undefined): string | null {
  const name = assetNameFromSrc(src)
  const dir = currentAssetsDir()
  if (!name || !dir) return null
  return joinAsset(dir, name)
}

/* -------------------------------------------------------- 写入资源库 */

const EXT_BY_MIME: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/bmp': '.bmp',
  'image/avif': '.avif',
  'image/svg+xml': '.svg'
}

function sanitizeStem(stem: string): string {
  const cleaned = stem
    .replace(/\.[^.]*$/, '')
    .replace(/[^\w\u4e00-\u9fff.-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
  return cleaned || 'note-image'
}

/**
 * 把一段字节写进统一资源库，返回 `asset:<文件名>`。
 * 复用 files.saveImages（传 dir 时不会弹目录选择框）。
 */
export async function saveBytesAsAsset(bytes: Uint8Array, fileName: string): Promise<string | null> {
  const dir = currentAssetsDir()
  if (!dir || bytes.byteLength === 0) return null
  const suffix = fileName.match(/\.[a-z0-9]+$/i)?.[0] ?? '.png'
  const stem = sanitizeStem(fileName)
  const result = await filesApi.saveImages({ dir, mode: 'embedded', prefix: 'note' }, [
    { name: `${stem}-${Date.now().toString(36)}${suffix}`, data: bytes }
  ])
  const saved = result.files[0]
  if (!saved) return null
  const name = baseName(saved)
  return isPlainName(name) ? `${ASSET_PREFIX}${name}` : null
}

/** 把 data URL 落盘进统一资源库 */
export async function storeDataUrlImage(dataUrl: string, hint = 'image'): Promise<string | null> {
  const parsed = parseDataUrl(dataUrl)
  if (!parsed) return null
  return saveBytesAsAsset(parsed.bytes, `${hint}${EXT_BY_MIME[parsed.mime] ?? '.png'}`)
}

/** 剪贴板里的图片文件 → `asset:<文件名>` */
export async function storeClipboardImage(file: File, hint = '剪贴板图片'): Promise<string | null> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  if (bytes.byteLength === 0) return null
  const ext = EXT_BY_MIME[file.type] ?? '.png'
  return saveBytesAsAsset(bytes, `${hint}${ext}`)
}

/** 「插入图片」按钮：选一张图并拷进统一资源库 */
export async function pickNoteImage(): Promise<string | null> {
  const picked = await settingsApi.pickBookImage('note')
  if (!picked?.ref) return null
  return picked.ref
}

/** `asset:<文件名>` → 便于阅读的 Markdown alt 文案 */
export function labelForAsset(ref: string): string {
  const name = assetNameFromSrc(ref)
  if (!name) return '图片'
  const stem = name.replace(/\.[^.]+$/, '')
  return stem || '图片'
}

/* -------------------------------------------------------- 读出内容 */

export interface AssetContent {
  bytes: Uint8Array
  mime: string
  ext: string
}

const MIME_BY_EXT: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  bmp: 'image/bmp',
  avif: 'image/avif',
  svg: 'image/svg+xml'
}

export function mimeForExtName(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  return MIME_BY_EXT[ext] ?? 'application/octet-stream'
}

function parseDataUrl(value: string): AssetContent | null {
  const match = /^data:([\w.+-]+\/[\w.+-]+)?(;base64)?,(.*)$/is.exec(value)
  if (!match) return null
  const mime = match[1] ?? 'application/octet-stream'
  const ext = Object.keys(MIME_BY_EXT).find((key) => MIME_BY_EXT[key] === mime) ?? 'png'
  try {
    if (match[2]) {
      const binary = atob(match[3].replace(/\s+/g, ''))
      const bytes = new Uint8Array(binary.length)
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
      return { bytes, mime, ext }
    }
    const text = decodeURIComponent(match[3])
    return { bytes: new TextEncoder().encode(text), mime, ext }
  } catch {
    return null
  }
}

function fileUrlToPath(value: string): string | null {
  try {
    const url = new URL(value)
    if (url.protocol !== 'file:') return null
    return safeDecode(url.pathname.replace(/^\//, ''))
  } catch {
    return null
  }
}

/**
 * 把 Markdown 里可能出现的图片来源解析成字节。
 * 支持 `asset:`、`data:`、`file:` 与绝对路径；相对路径与网络地址返回 null
 * （预览里原本怎么显示，导出时就怎么保留）。
 */
export async function readImageContent(src: string | null | undefined): Promise<AssetContent | null> {
  if (!src) return null
  const value = src.trim()
  if (!value) return null

  if (value.startsWith('data:')) return parseDataUrl(value)

  let path: string | null = null
  if (value.startsWith('asset:')) path = assetAbsolutePath(value)
  else if (value.startsWith('file:')) path = fileUrlToPath(value)
  else if (/^[a-zA-Z]:[\\/]/.test(value) || value.startsWith('\\\\')) path = value
  if (!path) return null

  try {
    const bytes = await filesApi.readBinary(path)
    return { bytes, mime: mimeForExtName(path), ext: path.split('.').pop()?.toLowerCase() ?? 'png' }
  } catch {
    return null
  }
}

/** 图片来源 → data URL（用于自包含 HTML / PDF） */
export async function readImageDataUrl(src: string | null | undefined): Promise<string | null> {
  if (!src) return null
  const value = src.trim()
  if (value.startsWith('data:')) return value
  const content = await readImageContent(value)
  if (!content) return null
  return `data:${content.mime};base64,${bytesToBase64(content.bytes)}`
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunk = 0x2000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}
