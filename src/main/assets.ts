import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs'
import { basename, join } from 'node:path'
import type { AppSettings, BookStyle } from '@shared/types'
import { isAssetRef } from '@shared/noteUrl'
import { persistDataUrlImage } from './files'
import { currentIndex, persist } from './library'
import { getSettings, saveSettings } from './settings'
import { logLine } from './log'

export interface MigrateResult {
  moved: number
  failed: number
}

/** 把一个 BookStyle 里的内联图片落盘，返回是否有改动 */
function migrateStyle(style: Partial<BookStyle>, hint: string, result: MigrateResult): boolean {
  let changed = false
  for (const key of ['spineImage', 'coverImage'] as const) {
    const value = style[key]
    if (!value || isAssetRef(value) || !value.startsWith('data:')) continue
    const ref = persistDataUrlImage(value, `${hint}-${key === 'spineImage' ? 'spine' : 'cover'}`)
    if (ref) {
      style[key] = ref
      result.moved += 1
      changed = true
    } else {
      result.failed += 1
    }
  }
  return changed
}

/**
 * 把历史遗留的 base64 内联图片搬到数据目录。
 *
 * 早期版本把书脊贴图/封面直接塞进 library.json 与 settings.json，
 * 一张 2 MB 的图会变成 2.7 MB 的字符串，索引会越来越难读写。
 */
export function migrateInlineImages(): MigrateResult {
  const result: MigrateResult = { moved: 0, failed: 0 }

  const settings: AppSettings = getSettings()
  const nextSettings: AppSettings = {
    ...settings,
    bookStyle: { ...settings.bookStyle },
    noteStyle: { ...settings.noteStyle },
    spineStyles: settings.spineStyles.map((entry) => ({ ...entry, style: { ...entry.style } })),
    noteSpineStyles: settings.noteSpineStyles.map((entry) => ({ ...entry, style: { ...entry.style } })),
    customBookStyles: settings.customBookStyles.map((entry) => ({ ...entry, style: { ...entry.style } }))
  }

  let settingsChanged = migrateStyle(nextSettings.bookStyle, 'global', result)
  if (migrateStyle(nextSettings.noteStyle, 'global-note', result)) settingsChanged = true
  for (const entry of nextSettings.spineStyles) {
    if (migrateStyle(entry.style, entry.id, result)) settingsChanged = true
  }
  for (const entry of nextSettings.noteSpineStyles) {
    if (migrateStyle(entry.style, entry.id, result)) settingsChanged = true
  }
  for (const entry of nextSettings.customBookStyles) {
    if (migrateStyle(entry.style, entry.id, result)) settingsChanged = true
  }
  if (settingsChanged) saveSettings(nextSettings)

  const index = currentIndex()
  let indexChanged = false
  for (const book of index.books) {
    if (!book.style) continue
    if (migrateStyle(book.style, book.id, result)) indexChanged = true
  }
  if (indexChanged) persist(index)

  logLine('assets', `内联图片迁移：成功 ${result.moved}，失败 ${result.failed}`)
  return result
}

/** 更换数据目录：把已有图片搬过去 */
export function moveAssets(fromDir: string, toDir: string): MigrateResult {
  const result: MigrateResult = { moved: 0, failed: 0 }
  if (!fromDir || !toDir || fromDir === toDir || !existsSync(fromDir)) return result
  try {
    if (!existsSync(toDir)) mkdirSync(toDir, { recursive: true })
  } catch {
    return { moved: 0, failed: 1 }
  }

  for (const name of readdirSync(fromDir)) {
    const source = join(fromDir, name)
    try {
      if (!statSync(source).isFile()) continue
      const target = join(toDir, basename(name))
      if (existsSync(target)) continue
      copyFileSync(source, target)
      result.moved += 1
    } catch (error) {
      result.failed += 1
      logLine('assets', `搬迁 ${name} 失败：${(error as Error).message}`)
    }
  }
  return result
}
