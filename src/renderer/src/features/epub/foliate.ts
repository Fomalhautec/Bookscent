/**
 * foliate-js 的接入层。
 *
 * 这一层只做三件事：
 *   1. 把磁盘上的 epub 字节变成 foliate 认的 `File`，并建出 book 对象；
 *   2. 通过 `book.transformTarget` 往每个 XHTML 里注入阅读样式 ——
 *      这是**唯一**能在分页器判定排版方向之前改到文档的钩子
 *      （分页器在 iframe load 时读 body 的 writing-mode，晚了就来不及）；
 *   3. 把 view / renderer 的调用收成几个语义化函数。
 *
 * 之所以要 1 和 2 单独成文件：index.tsx 里只该管界面，不该出现
 * "给 blob 塞 style 字符串" 这种脏活。
 */

/** foliate 的 book 对象（只声明我们真正用到的部分） */
export interface FoliateBook {
  sections: { id: string; linear?: string }[]
  dir?: string
  toc?: FoliateTocItem[]
  metadata?: { title?: unknown; author?: unknown; language?: unknown }
  rendition?: { layout?: string }
  transformTarget?: EventTarget
  getCover?: () => Promise<Blob | null>
  resolveHref?: (href: string) => { index: number } | null
  splitTOCHref?: (href: string) => Promise<[unknown, unknown]> | [unknown, unknown]
}

export interface FoliateTocItem {
  label?: string
  href?: string
  subitems?: FoliateTocItem[]
}

/** 阅读时的位置，`relocate` 事件里给的就是它 */
export interface FoliateLocation {
  index?: number
  fraction?: number
  cfi?: string
  location?: { current?: number; next?: number; total?: number }
  tocItem?: { label?: string; href?: string }
}

export interface FoliateView extends HTMLElement {
  book?: FoliateBook
  renderer?: HTMLElement & {
    setStyles?: (styles: string | string[]) => void
    setAttribute: (name: string, value: string) => void
    getContents?: () => { doc: Document; index: number }[]
  }
  lastLocation?: FoliateLocation
  open: (book: FoliateBook | File) => Promise<void>
  init: (options?: { lastLocation?: unknown; showTextStart?: boolean }) => Promise<void>
  close: () => void
  goTo: (target: unknown) => Promise<void>
  goToFraction: (fraction: number) => Promise<void>
  goToTextStart: () => Promise<void>
  next: (distance?: number) => Promise<void>
  prev: (distance?: number) => Promise<void>
  goLeft: () => Promise<void>
  goRight: () => Promise<void>
  getSectionFractions: () => number[]
  resolveNavigation: (target: unknown) => unknown
}

interface FoliateModule {
  makeBook: (file: Blob) => Promise<FoliateBook>
  View: unknown
}

let modulePromise: Promise<FoliateModule> | null = null

/**
 * 按需加载 foliate-js（它是纯 ESM，Vite 会把它切成单独的 chunk）。
 * 阅读器以外的界面完全不该为它付出加载代价。
 */
export function loadFoliate(): Promise<FoliateModule> {
  modulePromise ??= import('@/vendor/foliate/view.js') as unknown as Promise<FoliateModule>
  return modulePromise
}

/* ------------------------------------------------------- 排版方向注入 */

export type WritingMode = 'auto' | 'horizontal' | 'vertical'

function writingModeRule(mode: WritingMode): string {
  if (mode === 'auto') return ''
  const value = mode === 'vertical' ? 'vertical-rl' : 'horizontal-tb'
  /*
   * 同时写在 html 与 body 上，并且带 !important：
   * 书籍自己的样式表常常显式写了 writing-mode，只改 html 会被 body 上的规则盖回去。
   * text-orientation 一律用 mixed —— 中文正立，英文与数字转 90° 横躺。
   *
   * 但**只改 html/body 还不够**：书里会把竖排写在**内层元素**上
   * （典型是 `.vrtl { writing-mode: vertical-rl }` 套在图片页、扉页这类章节上），
   * 内层规则不经过 body 继承，强制横排时它们仍然是竖的 ——
   * 用户看到的就是"强制横排了，图片那几章还是竖排"。
   * 所以再补一条作用于后代的规则：只有**用户明确指定方向**（非 auto）时才加，
   * 免得把书自己混排的章节也一起拧过来。
   */
  return [
    `html, body { writing-mode: ${value} !important; text-orientation: mixed !important; }`,
    `html body *:not(ruby):not(rt):not(rp) { writing-mode: ${value} !important; }`
  ].join('\n')
}

/**
 * 阅读样式：纸面、字号、图片收缩，以及排版方向。
 *
 * 纸面**跟着应用主题走**（和笔记的编辑器一致）：
 *   - 底色取应用主题的 `--bg-surface`，并写成不透明 ——
 *     书页文档在 iframe 里，书自己不画背景的地方是透明的，
 *     不写底色就会透出外层舞台，深色主题下变成"暗底黑字"。
 *   - 应用主题是深色时，还要把**正文里写死的颜色也翻过来**。
 *     只改 html/body 是不够的：书里常常写 `p { color: #000 }`，
 *     那一条会盖过继承下来的颜色，于是暗底上还是黑字。
 *     这是夜间模式的通行做法 —— 保真让位于可读。
 *   - `original`（保持原样）什么都不改，交还给书本身。
 */
export function readingStyles(options: {
  mode: WritingMode
  scale: number
  theme: 'auto' | 'original' | 'paper' | 'night'
  /** 应用主题的纸面底色与文字色（由界面传进来，跟随换肤） */
  appSurface: string
  appInk: string
  appLink: string
  /** 应用主题是不是深色 */
  dark: boolean
  /** 纸色/夜间两档的固定配色 */
  fixed: { background: string; color: string }
  /** 行距倍数；0 表示不干预，交给书自己 */
  lineHeight: number
  /** 正文字体族；空字符串表示跟随书籍 */
  fontFamily?: string
  /** 段首缩进（em）；0 表示不干预 */
  indent: number
}): string {
  const { mode, scale, theme, appSurface, appInk, appLink, dark, fixed, lineHeight, indent } = options
  const fontFamily = options.fontFamily ?? ''

  let background = ''
  let color = ''
  let forceInk = ''
  if (theme === 'auto') {
    // 跟随应用主题：底色用界面的纸面，深色时连正文颜色一起接管
    background = appSurface
    color = dark ? appInk : ''
    forceInk = dark ? appInk : ''
  } else if (theme === 'paper' || theme === 'night') {
    background = fixed.background
    color = fixed.color
    // 夜间也要接管正文里写死的颜色，否则同样是暗底黑字
    forceInk = theme === 'night' ? fixed.color : ''
  }

  return `
    html { color-scheme: ${dark && theme !== 'original' ? 'dark' : 'light'}; }
    ${writingModeRule(mode)}
    ${background ? `html, body { background: ${background} !important; }` : ''}
    ${color ? `html, body { color: ${color} !important; }` : ''}
    ${forceInk ? `html body, html body *:not(a) { color: ${forceInk} !important; }` : ''}
    ${forceInk && appLink ? `html body a { color: ${appLink} !important; }` : ''}
    body { font-size: ${scale}em !important; }
    ${fontFamily ? `html body, html body *:not(code):not(pre) { font-family: ${fontFamily} !important; }` : ''}
    ${lineHeight > 0 ? `html body, html body p, html body li, html body div { line-height: ${lineHeight} !important; }` : ''}
    ${/* 0 = 跟随书籍；负数 = 缩回（有些书自己缩了两格，只能往左调） */ ''}
    ${indent !== 0 ? `html body p { text-indent: ${indent}em !important; }` : ''}
    /* 大图按"装得下"来排：竖长的大图不能只限宽 */
    img, svg, video, image {
      max-width: 100% !important;
      max-height: 100% !important;
      object-fit: contain !important;
    }
    p, li, blockquote { hanging-punctuation: allow-end last; }
    pre { white-space: pre-wrap !important; }

    /*
     * 选中文字的颜色跟着主题走。
     *
     * 浏览器默认是那种亮蓝色，压在纸色/夜色的正文上很突兀 ——
     * 这里用应用强调色兑一点点透明，浅色主题下是暖褐、夜间是柔和的亮色，都能读。
     */
    ::selection {
      background: ${selectionColor(options)} !important;
      color: inherit !important;
    }
  `
}

/** 选中背景色：由主题底色与强调色混出来，避免"亮蓝"那种割裂感 */
function selectionColor(options: {
  theme: 'auto' | 'original' | 'paper' | 'night'
  appSurface: string
  appLink: string
  dark: boolean
}): string {
  const accent = options.appLink || '#8a4b3a'
  /* 夜间用强调色提亮一点；浅色主题下压低饱和，像马克笔轻轻划过的感觉 */
  const alpha = options.theme === 'night' || options.dark ? '46%' : '32%'
  return `color-mix(in srgb, ${accent} ${alpha}, transparent)`
}

/**
 * 往一段 XHTML 里插一份样式。
 *
 * 优先插在 `</head>` 前；没有 head 就插在 `<body>` 前；
 * 都没有（XML 片段）就整个前置 —— 浏览器解析时都能接受。
 */
export function injectStyleTag(html: string, css: string): string {
  const tag = `<style data-bookscent="reader">${css}</style>`
  if (/<\/head\s*>/i.test(html)) return html.replace(/<\/head\s*>/i, `${tag}</head>`)
  const body = /<body[^>]*>/i.exec(html)
  if (body) return `${html.slice(0, body.index)}${tag}${html.slice(body.index)}`
  return tag + html
}

/**
 * 挂上"读到 XHTML 就塞样式"的钩子。
 *
 * 必须在 `view.open()`/`init()` **之前**注册：分页器在 iframe 载入时
 * 读 body 的 writing-mode 来决定横排还是竖排，晚了这一节就按旧方向排了。
 * 返回一个卸载函数。
 *
 * 顺带把 `-webkit-writing-mode` / `-epub-writing-mode` 这类老前缀补一条无前缀声明。
 * 日文 EPUB（Calibre 转出来的尤其多）习惯写成
 *   `.vrtl { -webkit-writing-mode: vertical-rl }`
 * 引擎认这个前缀，但书里的规则一旦因为任何原因没落地，正文就会横过来；
 * 补一条成本极低，却能让这些书按本来的样子显示。
 */
export function attachStyleInjector(book: FoliateBook, getCss: () => string): () => void {
  const target = book.transformTarget
  if (!target) return () => undefined
  const onData = (event: Event): void => {
    const detail = (event as CustomEvent<{ data: unknown; type?: string }>).detail
    if (!detail) return
    const type = detail.type ?? ''
    if (type === 'text/css') {
      // CSS 也过一遍：把前缀属性补成标准写法
      detail.data = Promise.resolve(detail.data as string | Promise<string>).then((data) =>
        typeof data === 'string' ? normalizeWritingModePrefix(data) : data
      )
      return
    }
    if (type !== 'application/xhtml+xml' && type !== 'text/html') return
    const css = getCss()
    detail.data = Promise.resolve(detail.data as string | Promise<string>).then((data) =>
      typeof data === 'string' ? injectStyleTag(data, css) : data
    )
  }
  target.addEventListener('data', onData)
  return () => target.removeEventListener('data', onData)
}

/**
 * `-webkit-writing-mode: vertical-rl` → 再补一条 `writing-mode: vertical-rl`。
 * 只补这一条，别的什么也不动。
 */
export function normalizeWritingModePrefix(css: string): string {
  if (!/-(webkit|epub)-writing-mode/i.test(css)) return css
  return css.replace(
    /(-(?:webkit|epub)-writing-mode\s*:\s*([a-z-]+)\s*;?)/gi,
    (whole, _decl, value) => `${whole}\n  writing-mode: ${value};`
  )
}

/* ------------------------------------------------------------ 小工具 */

/** 把标签页里那种 `{ zh: '书名', en: '...' }` 取成一个字符串 */
export function textOf(value: unknown): string {
  if (!value) return ''
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return textOf(value[0])
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>
    const first = Object.values(record)[0]
    return typeof first === 'string' ? first : ''
  }
  return ''
}

/** 把 toc 里带层级的项压平，方便渲染缩进列表 */
export function flattenToc(
  items: FoliateTocItem[] | undefined,
  depth = 0
): { label: string; href: string; depth: number }[] {
  if (!items?.length) return []
  const out: { label: string; href: string; depth: number }[] = []
  for (const item of items) {
    if (item.href) out.push({ label: textOf(item.label) || '未命名', href: item.href, depth })
    out.push(...flattenToc(item.subitems, depth + 1))
  }
  return out
}
