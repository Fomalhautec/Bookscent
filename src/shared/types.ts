/**
 * 书香笔记 Bookscent — 共享领域模型
 * 主进程与渲染进程共用，禁止在此引入 electron / DOM 依赖。
 */

export const APP_VERSION = '0.11.0'

/* ------------------------------------------------------------------ 文档格式 */

export type BookFormat =
  | 'pdf'
  | 'md'
  | 'markdown'
  | 'txt'
  | 'doc'
  | 'docx'
  | 'rtf'
  | 'html'
  | 'epub'
  | 'image'
  | 'unknown'

/** 可编辑格式（内置编辑器直接写回原文件） */
export const EDITABLE_FORMATS: BookFormat[] = ['md', 'markdown', 'txt']

/** 可阅读（只读渲染）格式 */
export const READABLE_FORMATS: BookFormat[] = ['pdf', 'doc', 'docx', 'rtf', 'html', 'epub', 'image']

export const ALL_FORMATS: BookFormat[] = [...EDITABLE_FORMATS, ...READABLE_FORMATS, 'unknown']

export const FORMAT_LABEL: Record<BookFormat, string> = {
  pdf: 'PDF',
  md: 'Markdown',
  markdown: 'Markdown',
  txt: '纯文本',
  doc: 'Word 97',
  docx: 'Word',
  rtf: 'RTF',
  html: '网页',
  epub: 'EPUB',
  image: '图片',
  unknown: '文件'
}

/* ------------------------------------------------------------------ 书签 / 批注 */

/**
 * 书签位置：每种格式能准确定位的方式不一样，所以分开记。
 *
 * - `page`  ：有真实页码的（PDF，以及按页数估算的文档）—— 最直观
 * - `cfi`   ：EPUB 的绝对位置（换字号、换单双页都不会漂）
 * - `scroll`：其余（网页、Word、图片、预览）只能记滚动比例
 *
 * 之所以不用一个"页码"糊弄所有格式：文本类的页码是按字数**估**出来的，
 * 字号一改就对不上，书签会跳偏。
 */
export type BookmarkAnchor =
  | { kind: 'page'; page: number }
  | { kind: 'cfi'; cfi: string; fraction: number }
  | { kind: 'scroll'; ratio: number }
  /** 文本类：按行号定位，才能在那一行下面画线、跳过去时高亮 */
  | { kind: 'line'; line: number }

export interface Bookmark {
  id: string
  /** 1 基页码（PDF 与"按页数估算"的格式都用它；显示与排序用） */
  page: number
  label: string
  color: string
  note?: string
  createdAt: number
  /** 各格式各自的定位方式。老记录里没有这个字段，按 `page` 处理 */
  anchor?: BookmarkAnchor
  /** 加书签时那一段的摘录，列表里好认（保留原始文本，用于在章节里定位） */
  excerpt?: string
  /** 去掉振假名的干净摘录，只用于复制与展示 */
  plain?: string
  /**
   * 这一条是「书签」还是「笔记」。
   *
   * 书签 = 只记位置（「我读到这里了」）；笔记 = 从选中文本记下来的（「这句话我有想法」）。
   * 不能只看有没有摘录：EPUB 的位置书签也会顺手带一句所在页的文字，按摘录分会全被算成笔记。
   * 老数据没有这个字段，就按「有摘录的算笔记」兼容。
   */
  kind?: 'bookmark' | 'note'
}

export type AnnotationTool =
  | 'pen'
  | 'highlighter'
  | 'underline'
  | 'eraser'
  | 'line'
  | 'arrow'
  | 'rect'
  | 'ellipse'
  | 'text'

export interface Point {
  x: number
  y: number
}

/** 文字标注的形态：高亮（底色）或划线（下划线） */
export type TextMarkStyle = 'highlight' | 'underline' | 'wavy'

/**
 * EPUB 正文里的一处文字标注。
 *
 * 定位方式是「章节下标 + 该章节正文纯文本的起止偏移」，见 BookRecord.highlights 的说明。
 * 同时存下原文 `text`：万一偏移对不上（例如书被替换过），还能按文字在章节里找一次。
 */
export interface TextHighlight {
  id: string
  /** 章节下标（foliate 的 section index） */
  section: number
  /** 正文纯文本里的起始偏移（含） */
  start: number
  /** 结束偏移（不含） */
  end: number
  /** 选中的原文（原始 DOM 文本，用于兜底匹配与定位） */
  text: string
  /**
   * 去掉振假名之后的干净原文，只用于复制与展示。
   * 日文书的 <ruby>剥<rt>む</rt>き出し</ruby> 会把读音混进纯文本（剥むき出だし），
   * 那份是排版注音，不该出现在剪贴板里。定位仍用 text + 偏移，所以两份都留。
   */
  plain?: string
  style: TextMarkStyle
  color: string
  createdAt: number
}

/** 归一化矩形（0..1，相对页面左上角），与缩放/分栏无关 */
export interface NormRect {
  x: number
  y: number
  width: number
  height: number
}

/**
 * PDF 正文里的一处文字标注（高亮 / 划线）。
 *
 * PDF 没法像 EPUB 那样往正文里插标记（正文是 canvas 上的一张图），
 * 所以用 pdf.js 的文字层拿到"选中文字在页面上的矩形"，把这些矩形归一化存下来，
 * 再当作覆盖层画上去。好处是缩放、旋转、双页并排都不用重算 —— 百分比自适应。
 */
export interface PdfTextHighlight {
  id: string
  /** 页码（1 起算，与书签一致） */
  page: number
  /** 选中文字覆盖的若干矩形（归一化） */
  rects: NormRect[]
  text: string
  style: TextMarkStyle
  color: string
  createdAt: number
}

/** 一笔批注。坐标归一化到 0..1（相对页面左上角），因此与缩放无关。 */
export interface AnnotationStroke {
  id: string
  tool: AnnotationTool
  color: string
  /** 线宽，单位为页面宽度百分比（0..1 归一化后换算） */
  width: number
  opacity: number
  points: Point[]
  text?: string
  fontSize?: number
  createdAt: number
}

/** 按页码（1 基）索引的批注集合 */
export type AnnotationMap = Record<string, AnnotationStroke[]>

/* --------------------------------------------------------------- 书籍样式 */

export type SpinePreset =
  | 'leather' // 皮革烫金
  | 'cloth' // 布纹精装
  | 'paper' // 纸质平装
  | 'modern' // 现代扁平（轻微竖向明暗）
  | 'flat' // 平板（完全平面，无弧面高光与纹理）
  | 'gilded' // 竹节烫金
  | 'photo' // 贴图书脊

export type CoverPreset =
  | 'classic' // 古典花框
  | 'minimal' // 极简留白
  | 'vintage' // 复古藏书票
  | 'gradient' // 渐变
  | 'typewriter' // 打字机
  | 'plain' // 纯色
  | 'corner' // 书名在右上角
  | 'sidebar' // 书名竖排在右侧
  | 'panel' // 书名压在色块上
  | 'swiss' // 居中极简细线

export type SpineOrnament = 'none' | 'bands' | 'label' | 'foil' | 'ribs'

export interface BookStyle {
  spinePreset: SpinePreset
  /** 书脊底色 */
  spineColor: string
  /** 书脊第二色（渐变 / 竹节） */
  spineColor2: string
  /** 书脊文字颜色 */
  spineTextColor: string
  /** 书脊烫金/描边色 */
  foilColor: string
  /** 自定义书脊贴图：`asset:<文件名>`（存在数据目录）或内联 data URL */
  spineImage: string | null
  /**
   * 书脊贴图的宽高比（宽 ÷ 高）。
   * 贴上图之后书脊的厚度就该听贴图的 —— 否则图会被裁掉一块。
   * 选图时顺手把比例记下来，书架按它算宽度。
   */
  spineImageAspect?: number | null
  coverPreset: CoverPreset
  coverColor: string
  coverColor2: string
  coverTextColor: string
  /** 自定义封面图片：`asset:<文件名>`（存在数据目录）或内联 data URL */
  coverImage: string | null
  /** 封面图片的宽高比（宽 ÷ 高），用途同 spineImageAspect */
  coverImageAspect?: number | null
  /**
   * 书脊弧度：那道圆柱面明暗。
   * `auto` 会按装帧判断 —— 平板书脊与贴了书脊图的都不该有弧度（照片上加假明暗很脏），
   * 皮革/布纹这类传统装帧才有。
   */
  spineCurve?: SpineCurve
  /** 书脊厚度像素上限（1 页 → 最小，极厚书 → 最大） */
  thicknessScale: number
  /** 手动覆盖厚度，null = 由页数决定 */
  spineWidthOverride: number | null
  /** 书脊装饰 */
  ornament: SpineOrnament
  /** 书脊字体 */
  fontFamily: string
  /** 书脊书名排版方向 */
  spineTextDirection: 'vertical' | 'horizontal'
  /** 是否显示格式图标 */
  showFormatIcon: boolean
  /** 书脊倾角（度），0 = 完全直立 */
  tilt: number
}

/* ------------------------------------------------------------------ 书籍 */

export interface OutlineItem {
  title: string
  page: number | null
  depth: number
  children?: OutlineItem[]
}

/** 当作书籍读，还是当作笔记写 */
export type BookKind = 'book' | 'note'

export const KIND_LABEL: Record<BookKind, string> = { book: '书籍', note: '笔记' }

/**
 * 各格式的默认归类：应用改不了的文件是书籍，能改的是笔记。
 *
 * 网页（html）算书籍 —— 书香笔记里它是只读预览，不能编辑，
 * 按"能不能改"这条规则就该归到书籍那边。
 * 这只是默认值，用户随时能改（写完的笔记当然可以当书读）。
 */
export const KIND_BY_FORMAT: Record<BookFormat, BookKind> = {
  pdf: 'book',
  epub: 'book',
  doc: 'book',
  docx: 'book',
  rtf: 'book',
  html: 'book',
  image: 'book',
  unknown: 'book',
  md: 'note',
  markdown: 'note',
  txt: 'note'
}

/** 用量按"当作书籍"与"当作笔记"分开记账，键名不同 */
export type UsageKey = 'asBook' | 'asNote'

export const USAGE_KEY_OF: Record<BookKind, UsageKey> = { book: 'asBook', note: 'asNote' }

export interface UsageStats {
  /** 累计使用秒数 */
  seconds: number
  /** 累计打开次数 */
  opens: number
  /** 累计翻过的页数（阅读类才有意义） */
  pages: number
  /** 累计输入字数（笔记类才有意义） */
  words: number
  /** 最近一次使用的时间戳 */
  lastAt: number | null
  /** 按天累计的秒数，键是本地日期 YYYY-MM-DD，打卡热力图用 */
  days: Record<string, number>
}

/** 渲染层只上报增量，由主进程读改写合并 —— 免得整份记录互相覆盖 */
export interface UsageDelta {
  seconds?: number
  opens?: number
  pages?: number
  words?: number
}

/* -------------------------------------------------------------- 统计总览 */

export interface StatsRecentItem {
  id: string
  title: string
  kind: BookKind
  format: BookFormat
  /** 最近一次使用时间 */
  at: number
  /** 该阶段累计秒数 */
  seconds: number
  /** 阅读进度百分比（0–100，笔记类为 null） */
  percent: number | null
}

export interface StatsDayCell {
  /** 本地日期 YYYY-MM-DD */
  date: string
  seconds: number
  /** 当天打开过的书籍/笔记数 */
  opens: number
  words: number
  /** 当天的时长按读写分开（打卡要分开看） */
  readingSeconds: number
  noteSeconds: number
}

export interface StatsBookmarkItem {
  /** 书签 id，删除时用 */
  id: string
  /** 所属书/笔记 id，点了直接打开 */
  bookId: string
  bookTitle: string
  kind: BookKind
  label: string
  excerpt?: string
  at: number
}

/**
 * 一条「心得」：我自己在书里标注出来的东西。
 *
 * 与 `StatsBookmarkItem` 分开是有意的 —— 书签只是"我读到这儿了"，
 * 心得是"这句话我有想法"：正文里划出来的高亮/划线/波浪线，以及写了备注的那几条。
 * 统计页里单独一段，避免和书签混在一起看不出所以然（用户提的）。
 */
export interface StatsInsightItem {
  id: string
  bookId: string
  bookTitle: string
  /** 原文片段 */
  text: string
  /** 自己写的备注（有就显示） */
  note?: string
  /** 高亮 / 划线 / 波浪线 / 书签备注 */
  kind: 'highlight' | 'underline' | 'wavy' | 'note'
  at: number
}

export interface StatsOverview {
  generatedAt: number
  reading: {
    /** 读过（有 asBook 用量）的书数 */
    books: number
    /** 读完的（进度 ≥ 98%） */
    finished: number
    seconds: number
    opens: number
    pages: number
    /** 进行中的书，按最近使用排序 */
    inProgress: { id: string; title: string; percent: number; at: number }[]
  }
  notes: {
    count: number
    seconds: number
    opens: number
    /** 累计输入字数 */
    words: number
    /** 今天输入的字数 */
    wordsToday: number
    /** 写过的笔记，按最近使用排序 */
    items: { id: string; title: string; words: number; at: number }[]
  }
  /** 最近使用（书籍与笔记混排，各带 kind） */
  recent: StatsRecentItem[]
  /** 最近加的书签，按时间倒序 */
  bookmarks: StatsBookmarkItem[]
  /** 最近的心得（正文标注 + 写了备注的书签），按时间倒序 */
  insights: {
    /** 一共标注过多少条 */
    count: number
    items: StatsInsightItem[]
  }
  /** 打卡热力图：最近若干天的逐日数据 */
  days: StatsDayCell[]
  /**
   * 连续打卡天数。
   *
   * 三个数分开算：**读书**与**写字**各自一条，外加把两者合起来的"总打卡"。
   * 分开的理由是这两种事常常一阵一阵地做 —— 连着读一周书、那周没写字，
   * 用一个数表示会把两边都搅浑。
   */
  streak: number
  readingStreak: number
  noteStreak: number
  /**
   * 一天要算"打卡"，至少要累计这么久（秒）。
   * 打开看一眼不算打卡 —— 否则热力图会全是点。
   */
  streakMinSeconds: number
}

export interface Book {
  id: string
  title: string
  author: string
  /**
   * 系列名（可选）。
   *
   * 只影响一件事：书脊高度的错落。同一系列的书共用同一个高度系数，
   * 所以一套上中下册在架子上是齐的 —— 这正是用户要的"控制错落值，
   * 让同一系列高度相同"。留空就按每本书自己散列。
   */
  series?: string
  /**
   * 封面是否已经尝试提取过（成功或失败都算）。
   *
   * 封面补录是在后台按批次跑的（见 main/ipc.ts 的 enrichLibrary）。
   * 没有这个标记的话，书里根本没有合适封面图的那些书会被每一批重新解包一次 ——
   * 白读几百兆。
   */
  coverChecked?: boolean
  /**
   * 临时打开的书：只在本次运行里存在，退出后自动消失（见 library 的 pruneTemporary）。
   * 用户在阅读界面点「添加到书架」就把它转正（temporary = false）。
   */
  temporary?: boolean
  /**
   * 已移入回收站。
   *
   * 「从书架移除」不再直接扔掉条目：复制入库的书会把文件挪进藏书目录下的「_回收站」，
   * 条目保留并打上这个标记 —— 于是重新扫描**不会**把它又收回来
   * （用户报过：移除过的书一扫就回到书架）。
   * 回收站里只保留两件事：还原、彻底删除。
   */
  trashed?: boolean
  /** 移入回收站的时间（排序与显示用） */
  trashedAt?: number
  format: BookFormat
  /**
   * 当作书籍还是当作笔记。
   *
   * 默认按"应用能不能改这个文件"来分（见 KIND_BY_FORMAT）：PDF/EPUB/Word 这类
   * 只能读的是书籍，Markdown/纯文本这类能写的是笔记。用户随时可以改 ——
   * 一本写完的笔记当然可以当成书来读。
   *
   * 为什么要有这个字段：阅读和写作是两种行为，混在一起统计出来的数字没意义。
   * 用量数据也按它分开存（见 BookRecord.usage）。
   */
  kind: BookKind
  /** 绝对路径 */
  path: string
  /** true = 引用的库外文件，不随库移动 */
  external: boolean
  size: number
  /** 页数（md/txt 为按字数估算的虚拟页数） */
  pageCount: number
  /** 页数是否来自文档本身（PDF 精确 / DOCX 元数据） */
  pageCountExact: boolean
  /** 计算 pageCount 时对应的文件字节数，用于判断是否需要重新探测 */
  probeSize?: number
  /** 字数（文本类） */
  words?: number
  addedAt: number
  updatedAt: number
  lastOpenedAt: number | null
  status: BookStatus
  rating: number
  tags: string[]
  summary: string
  /** 所在书架层 */
  shelfId: string
  /** 手动排序位置（仅 shelfSort = manual 时有意义） */
  order: number
  /** 每本书的样式覆盖（未覆盖项从书脊样式列表继承） */
  style: Partial<BookStyle>
  /** 主色，用于书架点缀（默认取书脊色） */
  accent: string
  /** 自定义封面/书脊后，列表中的缩略图缓存 */
  coverThumb?: string | null
  missing?: boolean
}

export interface BookRecord {
  bookId: string
  /** 上次阅读进度 */
  progress: {
    page: number
    scrollRatio: number
    zoom: number
    rotation: number
    /**
     * EPUB 的阅读位置（EPUB CFI 字符串）。
     * 只记章节下标不够用：同一章可能有几十屏，靠比例恢复会漂；
     * CFI 是书里的绝对位置，换字号、换单双页都能落回原处。
     */
    cfi?: string
  }
  /**
   * 用量统计，按"当作书籍"与"当作笔记"分开存。
   *
   * 同一份文件可以先当笔记写、后来当书读，两段数据不能混在一起，
   * 所以键名分开（asBook / asNote），互不覆盖。旧记录里没有这个字段。
   */
  usage?: Partial<Record<UsageKey, UsageStats>>
  bookmarks: Bookmark[]
  annotations: AnnotationMap
  /**
   * EPUB 正文里的文字标注（高亮 / 划线）。
   *
   * 为什么不用 CFI：foliate 的 View 没暴露稳定的"CFI → Range"反向解析
   * （不同版本 API 名字都不一样），而正文某一段的文字在章节 DOM 里是稳定的 ——
   * 所以用「章节下标 + 正文文本偏移」定位：重新打开、换字号、换单双页都能对上，
   * 只有书本身被换掉才会失效（那时按 text 兜底匹配一次）。
   */
  highlights?: TextHighlight[]
  /** PDF 的文字标注（同一套高亮/划线，只是定位方式不同） */
  pdfHighlights?: PdfTextHighlight[]
  /**
   * 这本书确认过的正文朝向。
   *
   * 轻小说开头那些纯插图页既不带文字、也不声明 writing-mode，量出来是横排 ——
   * 只靠「见过竖排章节再兜底」来不及（插图页就在最前面），所以把结论记在书上，
   * 下次开书连封面页都按竖排处理。
   */
  epubVertical?: boolean
  /** PDF 内嵌目录缓存 */
  outline: OutlineItem[]
  updatedAt: number
}

export interface Shelf {
  id: string
  name: string
  /** 该层的木板样式覆盖 */
  themeId?: string | null
  /** 书架层主题色：侧栏图标的描边色，也是设置里的色条 */
  color?: string | null
  order: number
}

/**
 * 书立：同一层书架里的隔断，用来把一层再分成几组。
 *
 * 现实里的书立是**单侧**的：一块挡板压在某一摞书的一头。
 * 所以这里也按单侧来记 —— `side: 'right'` 表示它贴在锚点书的右边，
 * 挡住右边的书；`left` 则贴在左边。
 * 想要隔出一段空位，就一本书加「右书立」、后面那本加「左书立」，
 * 两个书立面对面的那段就是空位（各自的 `gap` 累加）。
 *
 * `order` 与书的 `order` 在同一把尺子上比较，插在两本书之间取中点，
 * 所以反复插也不用重排任何东西。`breakLine` 让这一层从这里另起一行。
 */
export interface Bookend {
  id: string
  shelfId: string
  order: number
  /** 贴在锚点书的哪一侧 */
  side: BookendSide
  /** 贴着哪本书（供菜单显示"贴在《书名》右边"） */
  anchorBookId?: string | null
  /** 书立挡板外侧留出的空位（px） */
  gap: number
  /** 从这里另起一行 */
  breakLine?: boolean
  /**
   * 封面模式下的"另起一行"。
   *
   * 有些书立在两种朝向下都存在（facing: 'both'），但换行位置只在其中一种下合适 ——
   * 书脊模式一本书几十像素、封面模式是一整张图的进深，同一个断点很难两头都对。
   * 没设这个字段就沿用 `breakLine`。
   */
  breakLineCover?: boolean
  /** 可选的分组名，仅作展示 */
  label?: string
  /**
   * 这个书立在哪些朝向模式下生效。
   *
   * 为什么需要：书脊模式与封面模式下**书的宽度差很多**（书脊几十像素、封面是整张图），
   * 同一个换行位置在一种模式下正合适，在另一种下就把书架切得很难看。
   * 所以书立可以声明"只在书脊模式生效"或"只在封面模式生效"。
   * 老数据没有这个字段 = 两种模式都生效（'both'）。
   */
  facing?: BookendFacing
}

/** 书立适用的朝向 */
export type BookendFacing = 'both' | 'spine' | 'cover'

/** 书立贴在书的哪一侧 */
export type BookendSide = 'left' | 'right'

/* ------------------------------------------------------------------ EPUB */

export interface EpubChapter {  /** zip 内的路径（相对解包根），也就是阅读顺序里的一节 */
  href: string
  title: string
  /** 目录里的层级，0 为顶层 */
  depth: number
}

export interface EpubInfo {
  chapters: EpubChapter[]
  fileCount: number
  title: string
  author: string
  /**
   * 封面图的内部路径（相对解包根）。
   *
   * 导入时用它把封面取出来当书籍封面 —— 用户要求"默认使用名为 cover 的图片"。
   * 找不到就是 undefined，此时照旧按程序化封面渲染。
   */
  cover?: string
}

export interface LibraryIndex {
  version: number
  libraryDir: string
  books: Book[]
  shelves: Shelf[]
  /** 各层书架里的书立（隔断） */
  bookends: Bookend[]
  scannedAt: number
}

/* ------------------------------------------------------------------ 设置 */

export interface UiSettings {
  /** 界面缩放 */
  zoom: number
  /** 书架每层高度 px */
  shelfRowHeight: number
  /**
   * 封面朝向下的单层高度（px）。
   * 与书脊朝向**各自独立**：书脊要看清书名得高一些，封面本来就是大图，太高会挤掉藏书量。
   */
  shelfRowHeightCover: number
  /**
   * 已废弃：仅为了兼容旧设置文件而保留，界面上已经没有这一项。
   *
   * 书架现在按"可用宽度 + 每本书的厚度"自动填满整行，不再按本数装箱，
   * 所以改这个值对书架没有任何影响。新代码不要再读它。
   */
  booksPerShelf: number
  /** 动画开关 */
  animate: boolean
  /** 书架显示书名铭牌 */
  showPlaque: boolean
  /** 书架是否显示书籍立体投影 */
  showShadow: boolean
  /** 书脊倾角幅度：0 = 完全整齐，1 = 明显错落 */
  shelfTilt: number
  /** 书籍高度错落幅度：0 = 等高，0.2 = 明显高低不一 */
  bookHeightVariation: number
  /**
   * **封面朝外**时的错落幅度，与书脊那一档分开。
   *
   * 分开的原因：封面模式下宽度 = 封面比例 × 高度（这样封面才完整），
   * 所以错落在这里是整体缩放封面，而不是像书脊那样只改高矮。
   * 默认 0：封面一律等高，想要不同开本的感觉再单独调。
   */
  coverHeightVariation: number
  /** 封面整体的缩放：1 = 铺满书架可用高度，小于 1 就是统缩小一圈 */
  coverHeightScale: number
  /** 编辑器字号 */
  editorFontSize: number
  editorFontFamily: string
  /** 编辑器行高 */
  editorLineHeight: number
  /** 自动保存 */
  autosave: boolean
  autosaveDelay: number
  /** PDF 默认缩放（'auto' 或百分比数值） */
  pdfDefaultZoom: 'auto' | 'page-fit' | 'page-width' | number
  /** PDF 连续滚动 */
  pdfContinuous: boolean
  /** 新建笔记默认格式 */
  newNoteFormat: 'md' | 'txt'
  /** 侧栏默认展开 */
  sidebarOpen: boolean
  /**
   * 用户改过的快捷键（只存改过的那些：id → 按键数组）。
   * 空数组表示主动禁用；没出现的 id 一律用注册表里的默认值。
   */
  shortcuts?: Record<string, string[]>
  /**
   * 朗读：默认引擎与语音、语速音调。
   * 引擎 edge 走在线（多语言高质量），system 走系统语音（离线）。
   */
  tts?: TtsSettings
  /**
   * 阅读器**左**侧栏宽度（目录/书签/笔记）。
   * 拖动时只改本地状态，松手才写这里 —— 每帧写设置会把 IPC 与磁盘拖垮。
   */
  sideWidth?: number
  /**
   * 阅读器**右**侧栏（翻译栏）宽度。
   * 与左栏各存一份：左边看目录要窄、右边读译文要宽，共用一个值总觉得别扭。
   */
  translateWidth?: number

  /* ------------------------------------------------ 书架：排布与外观 */

  /** 书籍朝向 */
  bookFacing: BookFacing
  /** 高度模式 */
  heightMode: HeightMode
  /** 书架层的排布方式 */
  shelfLayout: ShelfLayout
  /** 连续模式下单个书架层的最大宽度（px），超出自动换行 */
  shelfBayMaxWidth: number
  /** 排序方式（默认 = 手动排序，可拖拽） */
  shelfSort: ShelfSortMode
  /** 排序方向 */
  shelfSortDesc: boolean
  /** 打开书籍的动画强度 */
  openAnimation: OpenAnimation
  /** 左右翻页模式下的翻页动画 */
  pageFlipAnimation: PageFlipAnimation
  /** 封面朝外时，两本书之间的间距（px） */
  coverBookGap: number
  /** EPUB 排版方向：跟随书籍 / 强制横排 / 强制竖排 */
  epubWritingMode: EpubWritingMode
  /** EPUB 一屏一页还是两页 */
  epubSpread: EpubSpread
  /** 正文字号倍数（1 = 书自带大小） */
  epubFontSize?: number
  /** 正文字体：'' = 跟随书籍，其它为字体族名 */
  epubFontFamily?: string
  /** 行距倍数：0 = 跟随书籍 */
  epubLineHeight?: number
  /**
   * 段首缩进（em）。0 = 跟随书籍，**可以是负数**。
   * 有些书自己就缩进了两格，再往上加只会越来越深，所以要能往左"缩回"。
   */
  epubIndent?: number
  /** 书架（与列表）上是否显示阅读进度 */
  showReadingProgress: boolean

  /* ------------------------------------------------------ 书架：筛选 */

  filterFormats: BookFormat[]
  filterStatus: BookStatus[]
  filterTags: string[]
  /** 最低评分，0 = 不限 */
  filterMinRating: number
}

/** 书籍阅读状态 */
export type BookStatus = 'unread' | 'reading' | 'finished'

/** 书架排序方式；manual 是唯一可自由拖拽的"默认排序" */
export type ShelfSortMode = 'manual' | 'recent' | 'added' | 'title' | 'author' | 'pages' | 'format' | 'rating'

/** 书籍朝向：书脊朝外 / 封面朝外 / 自定义角度 */
/**
 * 书籍朝向。
 *
 * 曾经还有第三种「自定义角度」（用 preserve-3d 把书脊与封面两个面转出来）——
 * 那个实现是拿封面大小的书去凑视角的，既不像真书，也没法还原真实透视，
 * 用户反馈"有点抽象、用处不大"，已删除。现在只剩两种名副其实的朝向。
 */
export type BookFacing = 'spine' | 'cover'

/** 高度：完全统一 / 轻微错落 / 明显错落 */
export type HeightMode = 'uniform' | 'slight' | 'mixed'

/** 书架层排布：分层显示（每层独占一段）/ 连续书柜（层成格并排、上下相连） */
export type ShelfLayout = 'grouped' | 'continuous'

/** 书脊的弧度（那道圆柱面明暗）。auto = 按装帧自己判断 */
export type SpineCurve = 'auto' | 'curved' | 'flat'

/** 打开书籍时的动画 */
export type OpenAnimation = 'off' | 'simple' | 'full'

/**
 * EPUB 的排版方向。
 * `auto` 跟随书本身（竖排书保持竖排），另外两个强制覆盖 ——
 * 中文竖排书想横着读、或横排书想竖着读，都靠它。
 */
export type EpubWritingMode = 'auto' | 'horizontal' | 'vertical'

/** EPUB 一屏一页还是两页 */
export type EpubSpread = 'single' | 'double'

/** 翻页动画：PDF / EPUB 的左右翻页模式用 */
export type PageFlipAnimation = 'none' | 'slide' | 'fade' | 'curl'

/** 书脊样式在书架上的分配方式 */
export type SpineStyleMode = 'single' | 'rotate' | 'hash'

/** 一条命名的书脊/封面样式 */
export interface SpineStyleEntry {
  id: string
  name: string
  /** 内置样式不可删除，但可以停用或"另存为" */
  builtin: boolean
  enabled: boolean
  style: BookStyle
}

/**
 * 翻译：机翻与 AI 两套配置。
 *
 * 为什么把密钥放在设置里而不是环境变量：这是个桌面应用，用户自己填自己的 key 最直接，
 * 设置文件本来也支持导出/导入（换电脑跟着走）。密钥只落在本机的 settings.json 里，
 * 请求由**主进程**发出（避开渲染层的跨域，也不把 key 暴露给页面里的第三方内容）。
 */
/** 每一家翻译服务的实现；AI 是一类，底下可以挂多条不同平台的配置 */
export type TranslateProvider = 'ai' | 'google' | 'microsoft' | 'deepl' | 'youdao'
/** 两档：AI 会多给一层语法词汇解析，机翻只给译文 */
export type TranslateKind = 'ai' | 'machine'

/**
 * 一条翻译接口配置。
 *
 * 为什么做成"列表"：同时用 DeepSeek 翻日语、用硅基流动翻英语、偶尔切回 Google 应急，
 * 是很常见的用法。以前每家只有一个槽位，想换模型得把地址密钥全改一遍再改回来。
 */
export interface TranslateEndpoint {
  id: string
  /** 显示名，用户自己起（如"DeepSeek 主力""硅基流动 便宜"） */
  name: string
  kind: TranslateKind
  provider: TranslateProvider
  /** 机翻用：密钥 / 区域 / 应用密钥（有道）/ Pro 版 / 接口地址 */
  apiKey: string
  region: string
  appSecret: string
  pro: boolean
  endpoint: string
  /** AI 用：OpenAI 兼容的地址与模型 */
  baseUrl: string
  model: string
}

/** 一套提示词预设（按文本类型分：轻小说 / 历史 / 科技…） */
export interface TranslatePreset {
  id: string
  name: string
  prompt: string
  /** 内置：能改、能恢复默认，但不能删（删了就没有可回退的基准了） */
  builtin?: boolean
}

export interface TranslateSettings {
  /** 关掉时选中正文不出现翻译入口 */
  enabled: boolean
  /** 当前使用的那条接口配置（endpoints 里的 id） */
  activeId: string
  /** 目标语言（用各家通用的短码：zh-CN / en / ja / ko / fr …） */
  target: string
  /**
   * 带上多少上下文（前后各取多少段）。
   *
   * 机翻的输入是孤零零一句时最容易译飞（代词、语气、省略主语），
   * 把前后段落一起给它，质量差别很明显。
   */
  contextSize: number
  /** 所有接口配置：AI 与机翻混在一张表里，用 kind 区分 */
  endpoints: TranslateEndpoint[]
  /** 提示词预设（AI 用） */
  presets: TranslatePreset[]
  /** 当前使用的提示词预设 */
  activePresetId: string
  /**
   * 翻译记录的保留策略：
   *   session = 每次退出或加载时清除（默认）
   *   limited = 超过 historyLimit 条时丢掉最旧的
   *   keep    = 从不清除
   */
  historyMode: TranslateHistoryMode
  /** limited 模式下的上限 */
  historyLimit: number
}

export type TranslateHistoryMode = 'session' | 'limited' | 'keep'

/** 一条翻译记录（面板上的「最近」与设置里的记录列表共用） */
export interface TranslateHistoryEntry {
  id: string
  source: string
  translation: string
  /** AI 那档才有：语法词汇解析（Markdown） */
  analysis?: string
  /** 是 AI 还是机翻（列表里区分一下） */
  kind: TranslateKind
  /** 目标语言 */
  target: string
  at: number
}

/** 一次翻译的结果 */
export interface TranslateResult {
  ok: boolean
  provider: TranslateProvider
  /** 送去的原文 */
  source: string
  translation: string
  /** 只有 AI 才有：语法 / 词汇 / 难句解析（Markdown） */
  analysis?: string
  /** 解析里那段词汇表（已解析成结构化数据，可直接加入单词本） */
  vocabulary?: { term: string; reading: string; meaning: string; kind: 'word' | 'phrase' }[]
  /** 失败时的说明（要能看懂：密钥没填、超时、接口报错…） */
  error?: string
  /** 实际带上了几段上下文（0 表示没带） */
  contextUsed: number
  at: number
}

export interface TtsSettings {
  engine: 'edge' | 'system' | 'youdao' | 'tencent'
  /** 选中的语音 id（edge: zh-CN-XiaoxiaoNeural 这种） */
  voice: string
  /** 语速 0.5–2 */
  rate: number
  /** 有道智云（语音合成） */
  youdaoAppKey?: string
  youdaoAppSecret?: string
  /** 腾讯云（语音合成 TextToVoice） */
  tencentSecretId?: string
  tencentSecretKey?: string
  tencentRegion?: string
  /** 音调 0.5–2 */
  pitch: number
}

export interface AppSettings {
  schema: number
  appTheme: string
  shelfTheme: string
  /** 全部套用同一套时的基准样式（书籍用这套） */
  bookStyle: BookStyle
  /**
   * 笔记的基准样式。
   *
   * 书是"读"的、笔记是"写"的，摆在同一层书架上的观感本就该不一样，
   * 所以默认样式分开：书籍可以厚重烫金，笔记默认朴素得像一本便笺。
   * 单本书自己的 `style` 覆盖优先级仍然更高。
   */
  noteStyle: BookStyle
  /** 书籍的书脊样式列表（用户可增删改） */
  spineStyles: SpineStyleEntry[]
  /** 书籍的样式分配方式 */
  spineStyleMode: SpineStyleMode
  /**
   * 笔记专用的书脊样式列表。
   *
   * 书是"读"的、笔记是"写"的，两份列表各自独立：
   * 在「书籍外观」里改书籍那份，笔记的外观不会跟着变，反之亦然。
   * 老设置文件里没有这个字段时，主进程读设置会用默认列表补齐（见 main/settings.ts）。
   */
  noteSpineStyles: SpineStyleEntry[]
  /** 笔记的样式分配方式；与书籍那份各自独立，默认与书籍一致 */
  noteSpineStyleMode: SpineStyleMode
  /** 自定义主题（在预设基础上覆盖令牌） */
  customThemes: CustomTheme[]
  /** 自定义书籍样式预设 */
  customBookStyles: { id: string; name: string; style: BookStyle }[]
  /** 书籍外观图片（书脊贴图 / 封面图）的存放目录 */
  assetsDir: string
  ui: UiSettings
  /** 翻译：机翻（各家 API）与 AI 两套配置 */
  translate: TranslateSettings
  window: {
    width: number
    height: number
    x: number | null
    y: number | null
    maximized: boolean
  }
}

export type ThemeTokenKey =
  | 'bg-app'
  | 'bg-surface'
  | 'bg-elevated'
  | 'bg-sunken'
  | 'border'
  | 'border-strong'
  | 'text-primary'
  | 'text-secondary'
  | 'text-muted'
  | 'accent'
  | 'accent-soft'
  | 'accent-contrast'
  | 'shadow'
  | 'shelf-back'
  | 'shelf-cavity'
  | 'shelf-plank'
  | 'shelf-plank-top'
  | 'shelf-plank-edge'
  | 'shelf-wood-1'
  | 'shelf-wood-2'
  | 'shelf-wood-3'
  | 'selection'

export type ThemeTokens = Record<ThemeTokenKey, string>

export interface CustomTheme {
  id: string
  name: string
  base: string
  tokens: Partial<ThemeTokens>
}

export interface ThemePreset {
  id: string
  name: string
  /** 书香气质描述 */
  description: string
  /** 可用于应用界面 / 书架 / 两者 */
  kind: 'app' | 'shelf' | 'both'
  dark: boolean
  tokens: Partial<ThemeTokens>
  /** 书架背景纹理 */
  texture: 'wood' | 'paper' | 'linen' | 'stone' | 'flat' | 'gradient'
  /** 色板预览用 */
  swatch: string[]
}

/* ------------------------------------------------------------------ IPC 载荷 */

export interface ImportResult {
  added: Book[]
  skipped: { path: string; reason: string }[]
  index: LibraryIndex
}

export interface SaveImageFile {
  name: string
  data: Uint8Array
}

export interface ExtractImagesOptions {
  /** 目标目录；null 则弹出选择框 */
  dir: string | null
  /** 提取模式 */
  mode: 'embedded' | 'page'
  /** page 模式：页码（1 基）；不传则整本 */
  pages?: number[]
  /** page 模式：渲染倍率 */
  scale?: number
  /** page 模式：图片格式 */
  imageType?: 'png' | 'jpeg'
  /** 命名前缀 */
  prefix?: string
}

export interface ExtractImagesResult {
  dir: string
  files: string[]
  cancelled: boolean
}

export interface AppInfo {
  version: string
  name: string
  platform: string
  userDataDir: string
  libraryDir: string
  electron: string
  chrome: string
  node: string
}

export interface DialogFilter {
  name: string
  extensions: string[]
}

/** 图片数据目录体检报告（清理前先给用户看的东西） */
export interface AssetOrphan {
  name: string
  size: number
  modified: number
}

export interface AssetDuplicateGroup {
  /** 内容指纹前 8 位，仅用于展示 */
  hash: string
  size: number
  /** 保留哪一个 */
  keep: string
  /** 其余可删的 */
  drop: string[]
}

export interface AssetScanReport {
  dir: string
  total: number
  totalSize: number
  used: number
  orphans: AssetOrphan[]
  orphanSize: number
  duplicates: AssetDuplicateGroup[]
  duplicateSize: number
}

export interface AssetCleanupResult {
  dir: string
  removedOrphans: number
  removedDuplicates: number
  /** 释放的字节数 */
  freed: number
  /** 改指的引用数量 */
  repointed: number
  scan: AssetScanReport
}
/** 一个可用于朗读的语音 */
export interface TtsVoice {
  /** Edge 那套的 short name；系统语音是系统的 voiceURI */
  id: string
  name: string
  /** BCP-47：zh-CN / en-US … */
  locale: string
  gender: string
  engine: 'edge' | 'system'
  /** "新闻 / 小说 / 聊天"这类风格标签（Edge 才给） */
  styles?: string[]
}
/* ------------------------------------------------------------ 单词本 */

/** 词条语种（按字符集判断，可手动改） */
export type VocabLanguage = 'ja' | 'zh' | 'en' | 'ko' | 'fr' | 'de' | 'es' | 'ru' | 'ar' | 'other'

/** 一条词条 */
export interface WordEntry {
  id: string
  term: string
  /** 读音：日文假名、英文音标都放这里（可空） */
  reading: string
  meaning: string
  language: VocabLanguage
  /** 单词 / 词组 */
  kind: 'word' | 'phrase'
  /** 从哪来：书名（手工加的为空） */
  source: string
  bookId: string
  note: string
  createdAt: number
  updatedAt: number
}