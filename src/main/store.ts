import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

/**
 * 极简 JSON 持久化：同步读、原子写（先写 .tmp 再改名）。
 * 解析失败时回退到默认值，绝不因为一个坏文件让应用起不来。
 */
export function readJson<T>(file: string, fallback: T): T {
  try {
    if (!existsSync(file)) return fallback
    const raw = readFileSync(file, 'utf8')
    if (!raw.trim()) return fallback
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

export function writeJson(file: string, value: unknown): void {
  const dir = dirname(file)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  const tmp = `${file}.tmp`
  writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8')
  try {
    renameSync(tmp, file)
  } catch {
    writeFileSync(file, JSON.stringify(value, null, 2), 'utf8')
  }
}

export function ensureDir(dir: string): string {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

/** 合并补丁：对象递归合并，数组整体覆盖，null 视为显式赋值 */
export function deepMerge<T>(base: T, patch: unknown): T {
  if (patch === null || patch === undefined) return base
  if (Array.isArray(patch)) return patch as unknown as T
  if (typeof patch !== 'object') return patch as unknown as T
  if (typeof base !== 'object' || base === null || Array.isArray(base)) {
    return patch as unknown as T
  }
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) }
  for (const [key, value] of Object.entries(patch as Record<string, unknown>)) {
    if (value === undefined) continue
    out[key] = deepMerge((base as Record<string, unknown>)[key], value)
  }
  return out as T
}
