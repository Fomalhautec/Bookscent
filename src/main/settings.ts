import { DEFAULT_TRANSLATE_PROMPT, TRANSLATE_PRESETS } from '@shared/translatePrompt'
import { app } from 'electron'
import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { BOOK_STYLE_PRESETS, NOTE_STYLE_PRESETS, DEFAULT_BOOK_STYLE, DEFAULT_NOTE_STYLE } from '@shared/themes'
import type {
  AppSettings,
  SpineStyleEntry,
  TranslateEndpoint,
  TranslateHistoryMode,
  TranslateKind,
  TranslateProvider,
  TranslateSettings
} from '@shared/types'
import { readJson, writeJson, ensureDir } from './store'

export const SCHEMA = 2

/** 内置书脊样式：用户可以停用、改名、另存，但不能删除内置项 */
export function defaultSpineStyles(): SpineStyleEntry[] {
  return BOOK_STYLE_PRESETS.map((preset) => ({
    id: `builtin-${preset.id}`,
    name: preset.name,
    builtin: true,
    enabled: true,
    style: { ...preset.style }
  }))
}

/**
 * 笔记那份样式列表的出厂内容。
 *
 * 用笔记专用的那几套（便笺 / 方格纸 / 索引卡 / 牛皮纸 / 手账），
 * 而不是照抄书籍的装帧预设 —— 否则笔记散列取到皮革烫金，看着像精装书。
 */
export function noteStyleSpineEntries(): SpineStyleEntry[] {
  return NOTE_STYLE_PRESETS.map((preset) => ({
    id: `builtin-${preset.id}`,
    name: preset.name,
    builtin: true,
    enabled: true,
    style: { ...preset.style }
  }))
}

export function userDataDir(): string {
  return ensureDir(app.getPath('userData'))
}

export function recordsDir(): string {
  return ensureDir(join(userDataDir(), 'records'))
}

export function settingsFile(): string {
  return join(userDataDir(), 'settings.json')
}

export function libraryIndexFile(): string {
  return join(userDataDir(), 'library.json')
}

export function recordFile(bookId: string): string {
  return join(recordsDir(), `${bookId}.json`)
}

/**
 * 默认藏书目录。
 *
 * `BOOKSCENT_LIBRARY_DIR` 可以覆盖它 —— 自动化验证必须指向自己的临时目录，
 * 否则往共享的「文档\Bookscent 藏书」里写测试文件，用户那份应用一扫就全收进书架了。
 */
export function defaultLibraryDir(): string {
  const override = process.env.BOOKSCENT_LIBRARY_DIR
  if (override && override.trim()) return override.trim()
  try {
    return join(app.getPath('documents'), 'Bookscent 藏书')
  } catch {
    return join(userDataDir(), 'library')
  }
}

export function defaultSettings(): AppSettings {
  return {
    schema: SCHEMA,
    appTheme: 'parchment',
    shelfTheme: 'birch',
    bookStyle: { ...DEFAULT_BOOK_STYLE },
    noteStyle: { ...DEFAULT_NOTE_STYLE },
    spineStyles: defaultSpineStyles(),
    spineStyleMode: 'hash',
    /*
     * 笔记那份列表独立存在，但**不能**照抄书籍那 6 套。
     *
     * 书籍预设是皮革、烫金、竹节这些装帧感的东西，笔记散列取到它们就长得像精装书，
     * 与 DEFAULT_NOTE_STYLE「笔记要朴素」的初衷相悖（子代理实现时按"默认与书籍一致"
     * 做了，这里改成用笔记自己的 5 套：便笺 / 方格纸 / 索引卡 / 牛皮纸 / 手账）。
     * 分配方式仍是 hash，所以同一架笔记之间还有变化。
     */
    noteSpineStyles: noteStyleSpineEntries(),
    noteSpineStyleMode: 'hash',
    customThemes: [],
    customBookStyles: [],
    assetsDir: defaultAssetsDir(),
    translate: {
      /*
       * 默认关着：没配密钥之前点翻译只会报错，不如让用户先去设置里挑一家。
       * 但条目先摆好 —— 六条常用接口（两条 AI、四条机翻）填上密钥就能用，
       * 用户要加就"新增"，不用从空白开始。
       */
      enabled: false,
      activeId: 'ai_deepseek',
      target: 'zh-CN',
      contextSize: 2,
      endpoints: [
        defaultEndpoint('ai_deepseek', 'DeepSeek', 'ai', 'ai', {
          baseUrl: 'https://api.deepseek.com/v1',
          model: 'deepseek-chat'
        }),
        defaultEndpoint('ai_siliconflow', '硅基流动', 'ai', 'ai', {
          baseUrl: 'https://api.siliconflow.cn/v1',
          model: 'Qwen/Qwen2.5-72B-Instruct'
        }),
        defaultEndpoint('mt_google', 'Google 翻译', 'machine', 'google', {
          endpoint: 'https://translation.googleapis.com/language/translate/v2'
        }),
        defaultEndpoint('mt_microsoft', '微软翻译', 'machine', 'microsoft', {
          endpoint: 'https://api.cognitive.microsofttranslator.com/translate'
        }),
        defaultEndpoint('mt_deepl', 'DeepL', 'machine', 'deepl'),
        defaultEndpoint('mt_youdao', '有道智云', 'machine', 'youdao', {
          endpoint: 'https://openapi.youdao.com/api'
        })
      ],
      presets: TRANSLATE_PRESETS.map((preset) => ({ ...preset, builtin: true })),
      activePresetId: TRANSLATE_PRESETS[0].id,
      /* 默认最保守：关掉应用就清掉记录 */
      historyMode: 'session',
      historyLimit: 50
    },
    ui: {
      zoom: 1,
      shelfRowHeight: 250,
  shelfRowHeightCover: 250,
      booksPerShelf: 14,
      animate: true,
      showPlaque: true,
      showShadow: true,
      shelfTilt: 0.35,
      bookHeightVariation: 0.09,
      // 封面朝外的错落单独一档，出厂 0 = 封面等高（见 lib/theme 的 coverHeightFor）
      coverHeightVariation: 0,
      coverHeightScale: 1,
      editorFontSize: 16,
      editorFontFamily: '"Noto Serif SC", "Source Han Serif SC", Georgia, "Microsoft YaHei", serif',
      editorLineHeight: 1.85,
      autosave: true,
      autosaveDelay: 1500,
      pdfDefaultZoom: 'auto',
      pdfContinuous: true,
      newNoteFormat: 'md',
      sidebarOpen: true,
      sideWidth: 240,
      translateWidth: 360,
      shortcuts: {},
      /* 默认用在线语音（多语言），语速原速 */
      tts: { engine: 'system', voice: '', rate: 1, pitch: 1, youdaoAppKey: '', youdaoAppSecret: '', tencentSecretId: '', tencentSecretKey: '', tencentRegion: 'ap-guangzhou' },
      bookFacing: 'spine',
          heightMode: 'slight',
      shelfLayout: 'grouped',
      shelfBayMaxWidth: 560,
      shelfSort: 'manual',
      shelfSortDesc: false,
      openAnimation: 'full',
      pageFlipAnimation: 'slide',
      coverBookGap: 14,
      epubWritingMode: 'auto',
      epubSpread: 'double',
  epubFontSize: 1,
  epubFontFamily: '',
  epubLineHeight: 0,
  epubIndent: 0,
      showReadingProgress: true,
      filterFormats: [],
      filterStatus: [],
      filterTags: [],
      filterMinRating: 0
    },
    window: { width: 1440, height: 930, x: null, y: null, maximized: false }
  }
}

/** 书籍外观图片的默认存放目录：跟着 userData 走，可以在设置里改 */
export /** 拼一条接口配置：只有给到的字段才写进去，其余留空（等用户填） */
function defaultEndpoint(
  id: string,
  name: string,
  kind: TranslateKind,
  provider: TranslateProvider,
  extra: Partial<TranslateEndpoint> = {}
): TranslateEndpoint {
  return {
    id,
    name,
    kind,
    provider,
    apiKey: '',
    region: '',
    appSecret: '',
    pro: false,
    endpoint: '',
    baseUrl: '',
    model: '',
    ...extra
  }
}

/**
 * 老设置（0.10.0 及以前：每家一个槽位 + 一份提示词）→ 新的"接口配置列表"。
 *
 * 关键是**别把用户已经填过的密钥弄丢**：那时 provider 指向哪家，
 * 就把哪家的字段搬进对应的条目，密钥、区域、模型原样带过来。
 * 老版本里 AI 那份自定义提示词如果改过，收成一套"我的提示词"预设，不覆盖也不丢。
 */
function migrateTranslate(raw: unknown, base: TranslateSettings): TranslateSettings {
  const legacy = raw as
    | (Partial<{
        provider: string
        target: string
        contextSize: number
        historyMode: TranslateHistoryMode
        historyLimit: number
        google: { apiKey?: string; endpoint?: string }
        microsoft: { apiKey?: string; region?: string; endpoint?: string }
        deepl: { apiKey?: string; pro?: boolean; endpoint?: string }
        youdao: { appKey?: string; appSecret?: string; endpoint?: string }
        ai: { baseUrl?: string; apiKey?: string; model?: string; prompt?: string }
      }> & Partial<TranslateSettings>)
    | undefined

  if (!legacy) return base
  /* 已经是新结构：只补齐缺失字段（列表缺了就用默认的） */
  if (Array.isArray(legacy.endpoints)) {
    return {
      ...base,
      ...legacy,
      endpoints: legacy.endpoints.length > 0 ? legacy.endpoints : base.endpoints,
      presets: Array.isArray(legacy.presets) && legacy.presets.length > 0 ? legacy.presets : base.presets
    } as TranslateSettings
  }

  const endpoints = base.endpoints.map((entry) => {
    switch (entry.provider) {
      case 'ai':
        /* 老版本只有一份 AI 配置：把它落到默认那条（DeepSeek）上 */
        return entry.id === base.activeId
          ? {
              ...entry,
              apiKey: legacy.ai?.apiKey ?? '',
              baseUrl: legacy.ai?.baseUrl || entry.baseUrl,
              model: legacy.ai?.model || entry.model
            }
          : entry
      case 'google':
        return {
          ...entry,
          apiKey: legacy.google?.apiKey ?? '',
          endpoint: legacy.google?.endpoint || entry.endpoint
        }
      case 'microsoft':
        return {
          ...entry,
          apiKey: legacy.microsoft?.apiKey ?? '',
          region: legacy.microsoft?.region ?? '',
          endpoint: legacy.microsoft?.endpoint || entry.endpoint
        }
      case 'deepl':
        return {
          ...entry,
          apiKey: legacy.deepl?.apiKey ?? '',
          pro: legacy.deepl?.pro ?? false,
          endpoint: legacy.deepl?.endpoint ?? ''
        }
      case 'youdao':
        return {
          ...entry,
          apiKey: legacy.youdao?.appKey ?? '',
          appSecret: legacy.youdao?.appSecret ?? '',
          endpoint: legacy.youdao?.endpoint || entry.endpoint
        }
      default:
        return entry
    }
  })

  /* 老 provider → 对应条目 */
  const map: Record<string, string> = {
    ai: 'ai_deepseek',
    google: 'mt_google',
    microsoft: 'mt_microsoft',
    deepl: 'mt_deepl',
    youdao: 'mt_youdao'
  }
  const activeId = legacy.provider && map[legacy.provider] ? map[legacy.provider] : base.activeId

  /* 老版本改过的 AI 提示词：收成自定义预设，别丢 */
  const presets = [...base.presets]
  const oldPrompt = legacy.ai?.prompt
  if (oldPrompt && oldPrompt.trim() && oldPrompt !== DEFAULT_TRANSLATE_PROMPT) {
    presets.push({ id: 'preset_mine', name: '我的提示词', prompt: oldPrompt })
  }

  return {
    enabled: legacy.provider ? legacy.provider !== 'off' : base.enabled,
    activeId,
    target: legacy.target || base.target,
    contextSize: typeof legacy.contextSize === 'number' ? legacy.contextSize : base.contextSize,
    endpoints,
    presets,
    activePresetId: presets.some((preset) => preset.id === legacy.activePresetId)
      ? (legacy.activePresetId as string)
      : base.activePresetId,
    /* 记录策略是 0.10.1 才有的：老设置里没有就用默认（关掉就清） */
    historyMode: legacy.historyMode ?? base.historyMode,
    historyLimit:
      typeof legacy.historyLimit === 'number' && legacy.historyLimit > 0
        ? legacy.historyLimit
        : base.historyLimit
  }
}

function defaultAssetsDir(): string {
  try {
    return join(app.getPath('userData'), 'assets')
  } catch {
    return join(process.cwd(), 'assets')
  }
}

export function assetsDir(): string {
  const configured = getSettings().assetsDir
  return ensureDir(configured && configured.trim() ? configured : defaultAssetsDir())
}

let cached: AppSettings | null = null

export function getSettings(): AppSettings {
  if (cached) return cached
  const raw = readJson<Partial<AppSettings>>(settingsFile(), {})
  cached = migrate(raw)
  return cached
}

/**
 * 把指定的设置项恢复成出厂默认，其余原样保留。
 *
 * `paths` 是点分路径（如 `ui.editorFontFamily`、`appTheme`）。
 * 之所以按路径而不是按顶层键：`ui` 一个大对象横跨好几个设置页，
 * 按顶层键重置会把别的页面上的设置一起清掉。
 *
 * 做法是"删掉这一项再迁移" —— migrate 会用默认值把缺的字段补齐，
 * 于是只有被删的那些回到默认，其余一个不动。
 * `window` 与 `schema` 不允许被重置：一个管窗口几何，一个管迁移。
 */
export function resetPaths(paths: string[]): AppSettings {
  const current = structuredClone(getSettings()) as unknown as Record<string, unknown>
  for (const path of paths) {
    const parts = path.split('.').filter(Boolean)
    if (parts.length === 0) continue
    if (parts[0] === 'window' || parts[0] === 'schema') continue
    const last = parts.pop() as string
    let target: Record<string, unknown> | undefined = current
    for (const part of parts) {
      const child: unknown = target ? target[part] : undefined
      target = child && typeof child === 'object' ? (child as Record<string, unknown>) : undefined
      if (!target) break
    }
    if (target && last in target) delete target[last]
  }
  return saveSettings(migrate(current as Partial<AppSettings>))
}

export function saveSettings(next: AppSettings): AppSettings {
  cached = next
  writeJson(settingsFile(), next)
  return next
}

/**
 * 把内置样式补进用户已有的列表。
 *
 * 升级时新增的内置样式（比如 0.4.0 的「现代平板」）应该自动出现，
 * 但用户在列表里改过的名称 / 停用状态要原样保留，所以按 id 合并而不是覆盖。
 */
function mergeSpineStyles(saved: SpineStyleEntry[] | undefined, builtin: SpineStyleEntry[]): SpineStyleEntry[] {
  if (!Array.isArray(saved) || saved.length === 0) return builtin
  const known = new Set(saved.map((entry) => entry.id))
  const missing = builtin.filter((entry) => !known.has(entry.id))
  return missing.length > 0 ? [...saved, ...missing] : saved
}

/** 用默认值补齐缺失字段（升级 / 手改配置都不至于崩） */
export function migrate(raw: Partial<AppSettings>): AppSettings {
  const base = defaultSettings()
  const merged: AppSettings = {
    ...base,
    ...raw,
    schema: SCHEMA,
    bookStyle: { ...base.bookStyle, ...(raw.bookStyle ?? {}) },
    noteStyle: { ...base.noteStyle, ...(raw.noteStyle ?? {}) },
    spineStyles: mergeSpineStyles(raw.spineStyles, base.spineStyles),
    spineStyleMode: raw.spineStyleMode ?? base.spineStyleMode,
    // 老设置文件里没有笔记那份列表 —— 用默认列表补齐，而不是让它俩共用一个数组
    noteSpineStyles: mergeSpineStyles(raw.noteSpineStyles, base.noteSpineStyles),
    noteSpineStyleMode: raw.noteSpineStyleMode ?? base.noteSpineStyleMode,
    assetsDir: raw.assetsDir && raw.assetsDir.trim() ? raw.assetsDir : base.assetsDir,
    /*
     * 0.9.7.beta：单层高度拆成「书脊 / 封面」两份。
     * 老用户只有 shelfRowHeight，就让它同时作为封面那份的初值 —— 升级后观感不变，
     * 之后想分开调再分开调。
     * 另外「自定义朝向」已删除，存量设置回落到书脊朝向。
     */
    translate: migrateTranslate(raw.translate, base.translate),
    ui: {
      ...base.ui,
      ...(raw.ui ?? {}),
      shelfRowHeightCover:
        raw.ui?.shelfRowHeightCover ?? raw.ui?.shelfRowHeight ?? base.ui.shelfRowHeight,
      bookFacing: raw.ui?.bookFacing === 'cover' ? 'cover' : 'spine'
    },
    window: { ...base.window, ...(raw.window ?? {}) },
    customThemes: raw.customThemes ?? [],
    customBookStyles: raw.customBookStyles ?? []
  }
  return merged
}

/** 首次启动时准备好默认藏书目录 */
export function ensureLibraryDir(dir?: string): string {
  const target = dir && dir.trim() ? dir : defaultLibraryDir()
  if (!existsSync(target)) {
    try {
      mkdirSync(target, { recursive: true })
    } catch {
      return ensureDir(join(userDataDir(), 'library'))
    }
  }
  return target
}
