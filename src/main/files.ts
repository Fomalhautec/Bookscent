import { dialog } from 'electron'
import { copyFileSync, existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { basename, extname, join } from 'node:path'
import type { DialogFilter, ExtractImagesOptions, ExtractImagesResult, SaveImageFile } from '@shared/types'
import { assetRef } from '@shared/noteUrl'
import { currentIndex } from './library'
import { assetsDir, ensureLibraryDir } from './settings'
import { decodeText, mimeForExt, sanitizeFileName, uniqueName } from './util'

export function readText(filePath: string): string {
  return decodeText(readFileSync(filePath))
}

export function writeText(filePath: string, content: string): { size: number; mtimeMs: number } {
  writeFileSync(filePath, content, 'utf8')
  const st = statSync(filePath)
  return { size: st.size, mtimeMs: st.mtimeMs }
}

export function readBinary(filePath: string): Uint8Array {
  const buf = readFileSync(filePath)
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength)
}

export function fileStat(filePath: string): { exists: boolean; size: number; mtimeMs: number } {
  try {
    const st = statSync(filePath)
    return { exists: true, size: st.size, mtimeMs: st.mtimeMs }
  } catch {
    return { exists: false, size: 0, mtimeMs: 0 }
  }
}

export async function exportText(
  defaultName: string,
  content: string,
  filters?: DialogFilter[]
): Promise<{ path: string | null; cancelled: boolean }> {
  const result = await dialog.showSaveDialog({
    title: '导出为文本文件',
    defaultPath: defaultName,
    filters: filters ?? [{ name: '文本文件', extensions: ['txt', 'md'] }]
  })
  if (result.canceled || !result.filePath) return { path: null, cancelled: true }
  writeFileSync(result.filePath, content, 'utf8')
  return { path: result.filePath, cancelled: false }
}

export async function exportBinary(
  defaultName: string,
  data: Uint8Array,
  filters?: DialogFilter[]
): Promise<{ path: string | null; cancelled: boolean }> {
  const result = await dialog.showSaveDialog({
    title: '导出文件',
    defaultPath: defaultName,
    filters: filters ?? [{ name: '所有文件', extensions: ['*'] }]
  })
  if (result.canceled || !result.filePath) return { path: null, cancelled: true }
  writeFileSync(result.filePath, Buffer.from(data))
  return { path: result.filePath, cancelled: false }
}

export async function pickImages(): Promise<{ name: string; dataUrl: string; path: string }[]> {
  const result = await dialog.showOpenDialog({
    title: '选择图片',
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'avif', 'svg'] }]
  })
  if (result.canceled) return []
  return result.filePaths.map((p) => {
    const mime = mimeForExt(p)
    const data = readFileSync(p)
    return { name: basename(p), dataUrl: `data:${mime};base64,${data.toString('base64')}`, path: p }
  })
}

export function readImage(filePath: string): string {
  const mime = mimeForExt(filePath)
  const data = readFileSync(filePath)
  return `data:${mime};base64,${data.toString('base64')}`
}

/**
 * 把用户选中的图片**拷贝进数据目录**，只把文件名记进配置。
 *
 * 以前是直接把整张图 base64 塞进 library.json / settings.json，
 * 一张 2 MB 的封面会变成 2.7 MB 的字符串，索引会越来越难读写。
 */
export function storeBookImage(sourcePath: string): { ref: string; dataUrl: string; name: string } {
  const dir = assetsDir()
  const ext = extname(sourcePath).toLowerCase() || '.png'
  const stem = sanitizeFileName(basename(sourcePath, ext)).slice(0, 40) || 'image'
  const fileName = uniqueName(dir, `${stem}-${Date.now().toString(36)}${ext}`, existsSync)
  const target = join(dir, fileName)
  copyFileSync(sourcePath, target)
  return { ref: assetRef(fileName), dataUrl: readImage(target), name: fileName }
}

/** 把历史遗留的内联 data URL 图片落到数据目录，返回替换后的引用 */
export function persistDataUrlImage(dataUrl: string, hint = 'image'): string | null {
  const match = /^data:([\w.+-]+\/[\w.+-]+);base64,(.+)$/i.exec(dataUrl)
  if (!match) return null
  const ext = EXT_BY_MIME[match[1].toLowerCase()] ?? '.png'
  try {
    const dir = assetsDir()
    const fileName = uniqueName(dir, `${sanitizeFileName(hint)}-${Date.now().toString(36)}${ext}`, existsSync)
    writeFileSync(join(dir, fileName), Buffer.from(match[2], 'base64'))
    return assetRef(fileName)
  } catch {
    return null
  }
}

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

export async function chooseDirectory(title = '选择文件夹'): Promise<string | null> {
  const result = await dialog.showOpenDialog({
    title,
    properties: ['openDirectory', 'createDirectory']
  })
  if (result.canceled || !result.filePaths[0]) return null
  return result.filePaths[0]
}

export async function saveImages(
  options: ExtractImagesOptions,
  files: SaveImageFile[]
): Promise<ExtractImagesResult> {
  let dir = options.dir
  if (!dir) {
    const picked = await chooseDirectory('选择图片保存位置')
    if (!picked) return { dir: '', files: [], cancelled: true }
    dir = picked
  }
  ensureLibraryDir(dir)
  const saved: string[] = []
  for (const file of files) {
    const safe = sanitizeFileName(file.name)
    const name = uniqueName(dir, safe, existsSync)
    const full = join(dir, name)
    writeFileSync(full, Buffer.from(file.data))
    saved.push(full)
  }
  return { dir, files: saved, cancelled: false }
}

export function copyIntoLibrary(srcPath: string): string {
  const index = currentIndex()
  const dir = ensureLibraryDir(index.libraryDir)
  const name = uniqueName(dir, basename(srcPath), existsSync)
  const full = join(dir, name)
  const ext = extname(full)
  if (srcPath.toLowerCase() === full.toLowerCase()) return srcPath
  writeFileSync(full, readFileSync(srcPath))
  return ext ? full : full
}
