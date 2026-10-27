import {
  APP_TOKEN_KEYS,
  SHELF_TOKEN_KEYS,
  TOKEN_KEYS,
  getPreset,
  hashString,
  readableOn,
  resolveTokens,
  withAlpha
} from '@shared/themes'
import { spineImageWidth } from '@/features/shelf/spineStyle'
import type {
  AppSettings,
  Book,
  BookFacing,
  BookKind,
  BookStyle,
  CustomTheme,
  HeightMode,
  SpineStyleEntry,
  SpineStyleMode,
  ThemePreset,
  ThemeTokens,
  UiSettings
} from '@shared/types'

/* -------------------------------------------------------- 书籍样式合并 */

function definedOnly<T extends object>(value: T | undefined): Partial<T> {
  if (!value) return {}
  const out: Record<string, unknown> = {}
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    if (v !== undefined) out[key] = v
  }
  return out as Partial<T>
}

/** 单本书的样式 = 基准样式 ⊕ 该书覆盖 */
export function resolveBookStyle(book: Pick<Book, 'style'> | undefined, global: BookStyle): BookStyle {
  return { ...global, ...definedOnly(book?.style) }
}

/** 朝向相关的几何计算放在 shelf 特性里，这里转出去给书架视图用 */
export { bookFootprint, coverDepth, coverImageDepth, spineImageWidth, tiltSpill } from '@/features/shelf/spineStyle'

/**
 * 从用户管理的样式列表里挑一套。
 *
 * - `single`：全部套用基准样式（书籍用 bookStyle，笔记用 noteStyle）
 * - `rotate`：按书架位置轮换，摆出来像一排真书
 * - `hash`  ：按书名稳定散列，同一本书永远同一套，重排也不会变
 *
 * 书籍与笔记各有**独立的一份列表与分配方式**（`spineStyles`/`spineStyleMode`
 * 与 `noteSpineStyles`/`noteSpineStyleMode`），这里按 kind 对称地取用：
 * 改书籍的外观不会连带改到笔记，反之亦然。
 * 用户对某本书的显式覆盖始终优先，不受分配方式影响。
 */
export function pickStyleForBook(
  book: Pick<Book, 'id' | 'title' | 'style'> & { kind?: Book['kind'] },
  settings: AppSettings,
  indexInShelf = 0
): BookStyle {
  const override = definedOnly(book?.style)
  const kind = bookKindOf(book)
  const mode = spineStyleModeFor(settings, kind)
  const pool = enabledSpineStylesFor(settings, kind)

  const base: BookStyle = kind === 'note' ? (settings.noteStyle ?? settings.bookStyle) : settings.bookStyle
  let picked = base
  if (mode !== 'single' && pool.length > 0) {
    picked =
      mode === 'rotate'
        ? pool[((indexInShelf % pool.length) + pool.length) % pool.length].style
        : pool[hashString(`${book.title}#${book.id}`) % pool.length].style
  }
  return { ...picked, ...override }
}

/** 书的 kind 可能缺省（老数据 / 局部对象），缺省一律当书籍处理 */
function bookKindOf(book: { kind?: Book['kind'] } | undefined): BookKind {
  return book?.kind === 'note' ? 'note' : 'book'
}

/** 某一类（书籍 / 笔记）的样式列表；老设置文件缺 note 那份时回落到书籍那份 */
export function spineStylesFor(settings: AppSettings, kind: BookKind): SpineStyleEntry[] {
  if (kind === 'note') return settings.noteSpineStyles ?? settings.spineStyles ?? []
  return settings.spineStyles ?? []
}

/** 挑出某一类的书（设置页算"用到几次"用） */
export function booksOfKind(books: Book[], kind: BookKind): Book[] {
  return books.filter((book) => bookKindOf(book) === kind)
}

/** 某一类里"已启用"的样式列表；全都停用时退回整份列表（免得书架没样式可用） */
export function enabledSpineStylesFor(settings: AppSettings, kind: BookKind): SpineStyleEntry[] {
  const list = spineStylesFor(settings, kind)
  const enabled = list.filter((entry) => entry.enabled)
  return enabled.length > 0 ? enabled : list
}

/** 书籍样式列表的已启用项（书架的批量套用菜单用；笔记用 enabledSpineStylesFor） */
export function enabledSpineStyles(settings: AppSettings): SpineStyleEntry[] {
  return enabledSpineStylesFor(settings, 'book')
}

/** 某一类的样式分配方式；笔记那份老设置文件里没有时跟随书籍 */
export function spineStyleModeFor(settings: AppSettings, kind: BookKind): SpineStyleMode {
  if (kind === 'note') return settings.noteSpineStyleMode ?? settings.spineStyleMode
  return settings.spineStyleMode
}

/** 统计每套样式被分到多少本，设置页用它显示"用到几次"（按 kind 各算各的） */
export function spineStyleUsage(books: Book[], settings: AppSettings, kind: BookKind = 'book'): Map<string, number> {
  const usage = new Map<string, number>()
  const pool = enabledSpineStylesFor(settings, kind)
  const mode = spineStyleModeFor(settings, kind)
  if (mode === 'single' || pool.length === 0) return usage
  booksOfKind(books, kind).forEach((book, index) => {
    const entry =
      mode === 'rotate'
        ? pool[((index % pool.length) + pool.length) % pool.length]
        : pool[hashString(`${book.title}#${book.id}`) % pool.length]
    usage.set(entry.id, (usage.get(entry.id) ?? 0) + 1)
  })
  return usage
}

/** 高度模式 → 错落幅度（保持向后兼容：老的 bookHeightVariation 仍然生效） */
export function heightVariationFor(ui: UiSettings): number {
  if (ui.heightMode === 'uniform') return 0
  if (ui.heightMode === 'mixed') return 0.16
  if (ui.heightMode === 'slight') return 0.07
  return ui.bookHeightVariation ?? 0.07
}

export function heightModePatch(mode: HeightMode): Partial<UiSettings> {
  return { heightMode: mode, bookHeightVariation: heightVariationFor({ heightMode: mode } as UiSettings) }
}

/**
 * 封面朝外时的错落幅度。
 *
 * 为什么**单独一档**：封面模式下宽度是由封面比例乘高度算出来的（这样封面才完整），
 * 所以这里的错落是**整体缩放封面**，而不是像书脊那样只改高矮 ——
 * 两者性质不同，共用一个值会让"书架错落"顺手把封面也放大缩小。
 * 默认 0：封面一律等高，想要不同开本的感觉再单独调。
 */
export function coverVariationFor(ui: UiSettings): number {
  return Math.max(0, Math.min(0.4, ui.coverHeightVariation ?? 0))
}

/** 封面整体的缩放（1 = 铺满书架可用高度） */
export function coverScaleFor(ui: UiSettings): number {
  return Math.max(0.5, Math.min(1.3, ui.coverHeightScale ?? 1))
}

export function coverHeightPatch(value: number): Partial<UiSettings> {
  return { coverHeightVariation: Math.max(0, Math.min(0.4, value)) }
}

/* ------------------------------------------------------------ 书脊尺寸 */

/**
 * 书脊厚度由页数决定：1 页的最薄，1200 页封顶。
 * 用对数映射，避免一本 800 页的 PDF 把整层书架挤爆。
 */
export function spineWidthFor(pages: number, style: BookStyle, height?: number): number {
  /*
   * 贴了书脊图就按图的比例来：厚度由图片决定，页数让位 ——
   * 否则盒子比图片窄/宽，cover 就会把图裁掉一条（用户报的"书脊上边被裁掉"）。
   */
  if (style.spineImage && height && height > 0) return spineImageWidth(height, style)
  if (style.spineWidthOverride && style.spineWidthOverride > 0) return style.spineWidthOverride
  const safe = Math.max(1, pages || 1)
  const t = Math.log10(1 + Math.min(safe, 4000)) / Math.log10(1 + 1200)
  /*
   * 页数 → 厚度。
   *
   * 系数比早期版本**减半**（用户拿真书比过：原来偏厚约一倍）。
   * 常数项与斜率一起减半，所以薄书厚书都按同一比例变薄；
   * 想再微调用样式里的 thicknessScale。
   */
  const base = (34 + 66 * Math.pow(Math.min(1, t), 0.92)) * 0.5
  return Math.round(base * (style.thicknessScale || 1))
}

/** 由 id 得到稳定的伪随机数（0..1），让书架有错落感但每次渲染一致 */
export function stableRandom(seed: string, salt = 0): number {
  const h = hashString(`${seed}#${salt}`)
  return (h % 100000) / 100000
}

/**
 * 这一层书架上，这本书该多高。
 *
 * 错落感来自一个稳定的伪随机数：**同一系列共用同一个数**，
 * 所以一套书（比如上中下三册）在架子上是齐的，不同系列之间才有高低差。
 * 没填系列的书就按自己的 id 散列，跟以前一样。
 * 想整层完全齐平，把「高度」设成"完全统一"即可（variation = 0）。
 */
export function spineHeightFor(book: Book, available: number, ui: UiSettings): number {
  // 高度模式是主开关；bookHeightVariation 只是自定义模式下的微调值
  const variation = Math.max(0, Math.min(0.4, heightVariationFor(ui)))
  if (variation <= 0) return available
  const series = book.series?.trim()
  const r = stableRandom(series ? `series:${series}` : book.id, 7)
  const factor = 1 - variation * r
  return Math.round(available * factor)
}

/**
 * 封面朝外时，这本书该多高（宽度由调用方按封面比例算）。
 *
 * 与书脊那边是两套参数：
 *   - `coverHeightScale` 整体缩放封面（"封面基准高度"）
 *   - `coverHeightVariation` 封面之间的错落，默认 0（等高）
 * 错落同样按**系列**齐平：同系列同开本，一套书摆出来是齐的。
 */
export function coverHeightFor(book: Book, available: number, ui: UiSettings): number {
  const base = available * coverScaleFor(ui)
  const variation = coverVariationFor(ui)
  if (variation <= 0) return Math.round(base)
  const series = book.series?.trim()
  const r = stableRandom(series ? `series:${series}` : book.id, 7)
  return Math.round(base * (1 - variation * r))
}

/** 两种朝向各自的高度：书脊看厚度那一套，封面看封面那一套 */
export function bookHeightFor(book: Book, available: number, ui: UiSettings, facing: BookFacing): number {
  return facing === 'spine' ? spineHeightFor(book, available, ui) : coverHeightFor(book, available, ui)
}

export function tiltFor(book: Book, ui: UiSettings, style: BookStyle): number {
  /*
   * 封面朝外时不该有倾角。
   *
   * 书脊朝外的书是"插"在架子上的，被抽出来又塞回去确实会歪一点；
   * 但封面朝外是**平放**展示，歪着没有物理依据，看着像贴歪了。
   * 所以只要不是书脊朝向，一律直立（单本的 style.tilt 也一并让位）。
   */
  if (ui.bookFacing === 'cover') return 0
  if (style.tilt) return style.tilt
  const amount = Math.max(0, Math.min(1, ui.shelfTilt))
  if (amount <= 0) return 0
  const r = stableRandom(book.id, 23)
  // 大部分书直立，偶尔有几本略微歪斜，像真的被人抽出来又塞回去
  if (r > 0.18) return 0
  const sign = r > 0.09 ? 1 : -1
  return sign * (1.5 + r * 22) * amount
}

/* ------------------------------------------------------------ 主题应用 */

export interface ThemeRuntime {
  app: ThemePreset
  shelf: ThemePreset
  tokens: ThemeTokens
  dark: boolean
}

export function resolveThemeRuntime(
  appThemeId: string,
  shelfThemeId: string,
  customThemes: CustomTheme[]
): ThemeRuntime {
  const app = getPreset(appThemeId, customThemes)
  const shelf = getPreset(shelfThemeId, customThemes)
  const customById = new Map(customThemes.map((c) => [c.id, c]))
  const merged: ThemeTokens = {
    ...resolveTokens(app),
    ...pick(resolveTokens(shelf), SHELF_TOKEN_KEYS)
  }
  // 自定义主题的令牌覆盖也要参与（getPreset 已经合过，这里再兜一层）
  for (const id of [appThemeId, shelfThemeId]) {
    const custom = customById.get(id)
    if (custom) Object.assign(merged, custom.tokens)
  }
  return { app, shelf, tokens: merged, dark: app.dark }
}

function pick(tokens: ThemeTokens, keys: readonly string[]): Partial<ThemeTokens> {
  const out: Record<string, string> = {}
  for (const key of keys) out[key] = tokens[key as keyof ThemeTokens]
  return out as Partial<ThemeTokens>
}

/** 把主题写进 <html> 的 CSS 变量与 data-* 属性，整套界面靠它换肤 */
export function applyTheme(runtime: ThemeRuntime, zoom: number): void {
  const root = document.documentElement
  for (const key of TOKEN_KEYS) {
    root.style.setProperty(`--${key}`, runtime.tokens[key])
  }
  // 派生令牌
  root.style.setProperty('--accent-softer', withAlpha(runtime.tokens.accent, 0.08))
  root.style.setProperty('--border-soft', withAlpha(runtime.tokens['border-strong'], 0.35))
  root.style.setProperty('--text-on-accent', readableOn(runtime.tokens.accent))
  root.style.setProperty('--cover-ink', readableOn(runtime.tokens['bg-surface']))
  root.dataset.appTheme = runtime.app.id
  root.dataset.shelfTheme = runtime.shelf.id
  root.dataset.texture = runtime.shelf.texture
  root.dataset.dark = runtime.dark ? 'true' : 'false'
  // 界面缩放：交给 .app-shell 的 zoom 处理（见 layout.css），这里只负责传值
  root.style.setProperty('--ui-zoom', String(zoom))
}

export function themeSwatchLabels(preset: ThemePreset): string[] {
  return preset.swatch.slice(0, 3)
}

export { APP_TOKEN_KEYS, SHELF_TOKEN_KEYS }
