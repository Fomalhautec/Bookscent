import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, statSync, unlinkSync } from 'node:fs'
import { extname, join } from 'node:path'
import type {
  AppSettings,
  AssetCleanupResult,
  AssetScanReport,
  Book,
  BookStyle
} from '@shared/types'
import { currentIndex, persist } from './library'
import { assetsDir, getSettings, saveSettings } from './settings'
import { logLine } from './log'

/**
 * 图片数据目录的体检与清理。
 *
 * 为什么需要它：书删了（或从回收站彻底删了）、封面换了以后，旧图仍然留在数据目录里 ——
 * 应用从来不会回头收拾，时间一长就是一堆谁也认不出的文件；同一张图被导入两次也会各存一份。
 * 这里做两件事，而且**先给报告、再动手**：清理是不可逆的，不该悄悄发生。
 *
 * 判定"用得到"的口径必须保守：把设置（书籍/笔记基准样式、书脊样式列表、自定义样式）
 * 与藏书索引（含回收站里的条目 —— 它们还在，只是被放在回收站）里出现过的 asset 引用全部算上。
 * 宁可漏删，不可错删。
 */



/** 从一条 asset 引用里取出文件名 */
function assetNameOf(value: unknown): string | null {
  if (typeof value !== 'string' || !value.startsWith('asset:')) return null
  const name = value.slice('asset:'.length).trim()
  return name && !name.includes('..') && !name.includes('/') && !name.includes('\\') ? name : null
}

function styleNames(style: Partial<BookStyle> | undefined, into: Set<string>): void {
  if (!style) return
  for (const key of ['spineImage', 'coverImage'] as const) {
    const name = assetNameOf(style[key])
    if (name) into.add(name)
  }
}

/**
 * 当前还被引用着的文件名。
 *
 * 覆盖范围：设置的基准样式与样式列表、自定义样式、自定义主题里的图片，
 * 以及藏书索引里每本书的封面/书脊图（回收站里的也算 —— 还原了还要用）。
 */
export function referencedAssets(settings: AppSettings, books: Book[]): Set<string> {
  const used = new Set<string>()
  styleNames(settings.bookStyle, used)
  styleNames(settings.noteStyle, used)
  for (const entry of settings.spineStyles) styleNames(entry.style, used)
  for (const entry of settings.noteSpineStyles) styleNames(entry.style, used)
  for (const entry of settings.customBookStyles) styleNames(entry.style, used)
  for (const theme of settings.customThemes ?? []) {
    const raw = theme as unknown as { preview?: string; image?: string }
    const a = assetNameOf(raw.preview)
    if (a) used.add(a)
    const b = assetNameOf(raw.image)
    if (b) used.add(b)
  }
  for (const book of books) {
    /* 书的封面图、缩略图，以及这本书自己的外观样式（书脊图/封面图） */
    /* 书的封面/书脊图存在它自己的 style 里，另有一份列表用的缩略图 */
    for (const value of [book.coverThumb]) {
      const name = assetNameOf(value)
      if (name) used.add(name)
    }
    styleNames(book.style, used)
  }
  return used
}

function sha1(file: string): string {
  try {
    return createHash('sha1').update(readFileSync(file)).digest('hex')
  } catch {
    return `unreadable:${file}`
  }
}

/** 体检：列出没被引用的文件与内容重复的文件 */
export function scanAssets(): AssetScanReport {
  const dir = assetsDir()
  const report: AssetScanReport = {
    dir,
    total: 0,
    totalSize: 0,
    used: 0,
    orphans: [],
    orphanSize: 0,
    duplicates: [],
    duplicateSize: 0
  }
  if (!existsSync(dir)) return report

  const settings = getSettings()
  const used = referencedAssets(settings, currentIndex().books)
  report.used = used.size

  const files: { name: string; size: number; modified: number }[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile()) continue
    /* 只体检图片：别的文件（比如日志、索引备份）不归它管 */
    if (!/\.(png|jpe?g|webp|gif|bmp|avif)$/i.test(extname(entry.name))) continue
    try {
      const info = statSync(join(dir, entry.name))
      files.push({ name: entry.name, size: info.size, modified: info.mtimeMs })
    } catch {
      /* 读不到就跳过：体检不该因为一个坏文件整个失败 */
    }
  }
  report.total = files.length
  report.totalSize = files.reduce((sum, file) => sum + file.size, 0)

  for (const file of files) {
    if (!used.has(file.name)) {
      report.orphans.push({ name: file.name, size: file.size, modified: file.modified })
      report.orphanSize += file.size
    }
  }

  /*
   * 重复文件：先按大小分组（大小不同绝不重复，省掉大部分哈希），
   * 同尺寸的再算内容指纹。
   */
  const bySize = new Map<number, string[]>()
  for (const file of files) {
    const list = bySize.get(file.size)
    if (list) list.push(file.name)
    else bySize.set(file.size, [file.name])
  }
  for (const [size, names] of bySize) {
    if (names.length < 2) continue
    const byHash = new Map<string, string[]>()
    for (const name of names) {
      const hash = sha1(join(dir, name))
      const list = byHash.get(hash)
      if (list) list.push(name)
      else byHash.set(hash, [name])
    }
    for (const [hash, group] of byHash) {
      if (group.length < 2) continue
      /* 保留"还被引用着"的那份；都被引用或都没被引用时保留名字稳定排序后的第一个 */
      const referenced = group.filter((name) => used.has(name))
      const ordered = [...(referenced.length > 0 ? referenced : group)].sort()
      const keep = ordered[0]
      const drop = group.filter((name) => name !== keep)
      report.duplicates.push({ hash: hash.slice(0, 8), size, keep, drop })
      report.duplicateSize += size * drop.length
    }
  }

  report.orphans.sort((a, b) => b.size - a.size)
  report.duplicates.sort((a, b) => b.size * b.drop.length - a.size * a.drop.length)
  return report
}

/**
 * 清理：删掉没被引用的图片；重复的只留一份，并把所有引用改指到留下的那份。
 *
 * 重复文件的处理顺序很重要：**先改引用、再删文件**。
 * 反过来的话，删到一半失败就会留下一堆指向空文件的引用。
 */
export function cleanupAssets(options: { orphans: boolean; duplicates: boolean }): AssetCleanupResult {
  const dir = assetsDir()
  const scan = scanAssets()
  const result: AssetCleanupResult = {
    dir,
    removedOrphans: 0,
    removedDuplicates: 0,
    freed: 0,
    repointed: 0,
    scan
  }

  /* 1) 重复：改引用 → 删多余 */
  if (options.duplicates && scan.duplicates.length > 0) {
    const mapping = new Map<string, string>()
    for (const group of scan.duplicates) {
      for (const name of group.drop) mapping.set(name, group.keep)
    }

    const settings = getSettings()
    let changed = false
    const remap = (value: unknown): string | undefined => {
      const name = assetNameOf(value)
      if (!name) return undefined
      const keep = mapping.get(name)
      if (!keep) return undefined
      changed = true
      result.repointed += 1
      return `asset:${keep}`
    }
    const patchStyle = (style: BookStyle): void => {
      const spine = remap(style.spineImage)
      if (spine) style.spineImage = spine
      const cover = remap(style.coverImage)
      if (cover) style.coverImage = cover
    }
    patchStyle(settings.bookStyle)
    patchStyle(settings.noteStyle)
    for (const entry of settings.spineStyles) patchStyle(entry.style)
    for (const entry of settings.noteSpineStyles) patchStyle(entry.style)
    for (const entry of settings.customBookStyles) patchStyle(entry.style)
    if (changed) saveSettings({ ...settings })

    const index = currentIndex()
    let indexChanged = false
    for (const book of index.books) {
      const thumb = remap(book.coverThumb)
      if (thumb) {
        book.coverThumb = thumb
        indexChanged = true
      }
      /* 这本书自己的外观样式（书脊图/封面图）也要跟着改 */
      if (book.style) {
        const before = `${book.style.spineImage ?? ''}|${book.style.coverImage ?? ''}`
        patchStyle(book.style as BookStyle)
        if (`${book.style.spineImage ?? ''}|${book.style.coverImage ?? ''}` !== before) indexChanged = true
      }
    }
    if (indexChanged) persist(index)

    for (const [name] of mapping) {
      try {
        const info = statSync(join(dir, name))
        unlinkSync(join(dir, name))
        result.removedDuplicates += 1
        result.freed += info.size
      } catch (error) {
        logLine('assets', `删除重复图片失败 ${name}: ${String(error)}`)
      }
    }
  }

  /* 2) 没被引用的：直接删（报告里已经列过，用户点了确认） */
  if (options.orphans) {
    /*
     * 重新扫一遍：上一步可能刚改过引用。
     * 口径仍是"删之前再确认一次没被引用"，避免把刚指过去的文件删掉。
     */
    const fresh = options.duplicates ? scanAssets() : scan
    const used = referencedAssets(getSettings(), currentIndex().books)
    for (const orphan of fresh.orphans) {
      if (used.has(orphan.name)) continue
      try {
        const info = statSync(join(dir, orphan.name))
        unlinkSync(join(dir, orphan.name))
        result.removedOrphans += 1
        result.freed += info.size
      } catch (error) {
        logLine('assets', `删除图片失败 ${orphan.name}: ${String(error)}`)
      }
    }
  }

  logLine(
    'assets',
    `清理完成：未使用 ${result.removedOrphans}、重复 ${result.removedDuplicates}、改指向 ${result.repointed}`
  )
  return result
}
