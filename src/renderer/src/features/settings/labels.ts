/**
 * 设置 · 文案表
 * 所有中文名集中在这里，组件只负责摆放，避免同一件事出现两种叫法。
 */

import type {
  BookFacing,
  BookFormat,
  BookStatus,
  CoverPreset,
  HeightMode,
  OpenAnimation,
  ShelfLayout,
  ShelfSortMode,
  SpineOrnament,
  SpinePreset,
  SpineStyleMode,
  ThemePreset,
  ThemeTokenKey
} from '@shared/types'

/* --------------------------------------------------------------- 主题令牌 */

export const TOKEN_LABELS: Record<ThemeTokenKey, string> = {
  'bg-app': '窗口底色',
  'bg-surface': '面板底色',
  'bg-elevated': '浮层底色',
  'bg-sunken': '凹陷底色',
  border: '描边',
  'border-strong': '强调描边',
  'text-primary': '主文字',
  'text-secondary': '次文字',
  'text-muted': '弱文字',
  accent: '强调色',
  'accent-soft': '强调色浅',
  'accent-contrast': '强调色文字',
  shadow: '阴影',
  'shelf-back': '书架背板',
  'shelf-cavity': '格内阴影',
  'shelf-plank': '木板正面',
  'shelf-plank-top': '木板高光',
  'shelf-plank-edge': '木板侧沿',
  'shelf-wood-1': '木色 · 一',
  'shelf-wood-2': '木色 · 二',
  'shelf-wood-3': '木色 · 三',
  selection: '选区'
}

/** 少量额外说明，只给最容易被问到的几个令牌写 */
export const TOKEN_HINTS: Partial<Record<ThemeTokenKey, string>> = {
  accent: '按钮、选中态与书脊高光都取自这里',
  'accent-soft': '支持 rgba()，用来做悬停与选中背景',
  shadow: '支持 rgba()，卡片与浮层的投影颜色',
  selection: '支持 rgba()，划选文字时的底色'
}

/* ------------------------------------------------------------------ 书籍样式 */

export const SPINE_PRESETS: SpinePreset[] = ['leather', 'cloth', 'paper', 'modern', 'flat', 'gilded', 'photo']

export const SPINE_PRESET_LABELS: Record<SpinePreset, string> = {
  leather: '皮革烫金',
  cloth: '布纹精装',
  paper: '纸质平装',
  modern: '现代扁平',
  flat: '现代平板',
  gilded: '竹节烫金',
  photo: '贴图书脊'
}

export const SPINE_PRESET_HINTS: Record<SpinePreset, string> = {
  leather: '摩洛哥皮纹 + 压印',
  cloth: '亚麻织纹，柔和无反光',
  paper: '哑光纸面，薄而轻',
  modern: '纯色色块，干净利落',
  flat: '完全平面，无弧面高光与纹理',
  gilded: '深色底 + 多道金线',
  photo: '可贴自己的图'
}

export const ORNAMENTS: SpineOrnament[] = ['none', 'bands', 'label', 'foil', 'ribs']

export const ORNAMENT_LABELS: Record<SpineOrnament, string> = {
  none: '无',
  bands: '横带',
  label: '纸质标签',
  foil: '烫金线',
  ribs: '竹节'
}

export const ORNAMENT_HINTS: Record<SpineOrnament, string> = {
  none: '素脊',
  bands: '两道压印横带',
  label: '贴一张纸标签',
  foil: '两道细金线',
  ribs: '四道凸起竹节'
}

export const COVER_PRESETS: CoverPreset[] = [
  'classic',
  'minimal',
  'vintage',
  'gradient',
  'typewriter',
  'plain',
  'corner',
  'sidebar',
  'panel',
  'swiss'
]

export const COVER_PRESET_LABELS: Record<CoverPreset, string> = {
  classic: '古典花框',
  minimal: '极简留白',
  vintage: '复古藏书票',
  gradient: '渐变',
  typewriter: '打字机',
  plain: '纯色',
  corner: '书名右上角',
  sidebar: '书名竖排右侧',
  panel: '书名压色块',
  swiss: '居中一条线'
}

export const COVER_PRESET_HINTS: Record<CoverPreset, string> = {
  classic: '双线花框，庄重',
  minimal: '只有一道压印线',
  vintage: '藏书票小方框',
  gradient: '斜向渐变过渡',
  typewriter: '稿纸横线',
  plain: '不施纹样',
  corner: '书名与署名都靠右上，左上角一枚压角短线',
  sidebar: '书名竖排在右缘，署名横躺在左',
  panel: '书名压在整块深色块上，块外只留底色',
  swiss: '书名居中，一条细线，其余全空'
}

export const TEXTURE_LABELS: Record<ThemePreset['texture'], string> = {
  wood: '木纹',
  paper: '纸纹',
  linen: '亚麻',
  stone: '石纹',
  flat: '纯色',
  gradient: '渐变'
}

/* -------------------------------------------------------------------- 字体 */

export const FONT_SERIF_VAR = 'var(--font-serif)'
export const FONT_SANS_VAR = 'var(--font-sans)'
export const FONT_MONO_VAR = 'var(--font-mono)'
export const FONT_SERIF_SC = '"Noto Serif SC", "Source Han Serif SC", "Songti SC", SimSun, serif'
export const FONT_SANS_UI = '"Segoe UI", "Microsoft YaHei", system-ui, sans-serif'
/** 楷体：标题书卷气最足的一档，Windows 自带 KaiTi，macOS 走 STKaiti */
export const FONT_KAI = 'KaiTi, STKaiti, "Kaiti SC", "Noto Serif SC", serif'
/** 仿宋：公文体，适合书名与卷册 */
export const FONT_FANGSONG = 'FangSong, STFangsong, "FangSong SC", "Noto Serif SC", serif'
/** 黑体：粗重的标题面 */
export const FONT_HEI = 'SimHei, "Heiti SC", "Microsoft YaHei", sans-serif'
/** 圆体：现代轻松一点的语气 */
export const FONT_ROUND = 'YouYuan, "Yuanti SC", "Microsoft YaHei", sans-serif'
/** 隶书：装饰性强，适合藏书票一类的书脊 */
export const FONT_LI = 'LiSu, STLiti, "Baoli SC", "Noto Serif SC", serif'
/** 西文衬线：英文书名比中文栈更好看 */
export const FONT_SERIF_EN = 'Georgia, "Times New Roman", "Noto Serif", serif'
/** 手写感：备忘、随笔类笔记的封面 */
export const FONT_HAND = '"Segoe Script", "Bradley Hand", "Comic Sans MS", cursive'

export interface FontChoice {
  value: string
  label: string
  hint: string
}

/**
 * 书脊 / 封面书名的字体库。
 *
 * 全部是「系统里大概率已经有」的中文字体栈，不依赖下载字体 ——
 * 书脊只有一两厘米宽，装不上字比字体不够花哨糟糕得多。
 */
export const FONT_CHOICES: FontChoice[] = [
  { value: FONT_SERIF_VAR, label: '衬线（跟随界面）', hint: '默认，取自 --font-serif' },
  { value: FONT_SERIF_SC, label: '宋体 / 思源宋体', hint: '最稳的中文衬线，正文与书名都合适' },
  { value: FONT_KAI, label: '楷体', hint: '书卷气，适合文集与随笔' },
  { value: FONT_FANGSONG, label: '仿宋', hint: '公文体，书名显得端正' },
  { value: FONT_HEI, label: '黑体', hint: '笔画重，窄书脊上也认得出' },
  { value: FONT_ROUND, label: '圆体', hint: '轻松现代，配平板书脊' },
  { value: FONT_LI, label: '隶书', hint: '装饰性强，适合藏书票一路' },
  { value: FONT_HAND, label: '手写体', hint: '随性，适合手账与备忘' },
  { value: FONT_SERIF_EN, label: '西文衬线', hint: '英文书名比中文栈排得漂亮' },
  { value: FONT_SANS_UI, label: '无衬线', hint: '微软雅黑 / Segoe UI' },
  { value: FONT_MONO_VAR, label: '等宽', hint: '取自 --font-mono，适合工具书' }
]

export const EDITOR_FONT_CHOICES: FontChoice[] = [
  { value: FONT_SERIF_VAR, label: '衬线（跟随界面）', hint: '取自 --font-serif' },
  { value: FONT_SERIF_SC, label: '宋体 / 思源宋体', hint: '长文阅读最舒服' },
  { value: FONT_KAI, label: '楷体', hint: '偏书卷气，写随笔顺手' },
  { value: FONT_SANS_UI, label: '无衬线', hint: '屏幕显示清晰' },
  { value: FONT_MONO_VAR, label: '等宽', hint: '取自 --font-mono' }
]

/* ------------------------------------------------------------------ PDF 缩放 */

export type PdfZoomValue = 'auto' | 'page-width' | 'page-fit' | '50' | '75' | '100' | '125' | '150'

export const PDF_ZOOM_CHOICES: { value: PdfZoomValue; label: string }[] = [
  { value: 'auto', label: '自动' },
  { value: 'page-width', label: '适应宽度' },
  { value: 'page-fit', label: '适应页面' },
  { value: '50', label: '50%' },
  { value: '75', label: '75%' },
  { value: '100', label: '100%' },
  { value: '125', label: '125%' },
  { value: '150', label: '150%' }
]

/* -------------------------------------------------------------- 预览样书 */

export const SAMPLE_BOOKS: { pages: number; title: string; format: BookFormat }[] = [
  { pages: 24, title: '灯下随笔', format: 'txt' },
  { pages: 260, title: '中国建筑史', format: 'pdf' },
  { pages: 940, title: '追忆似水年华', format: 'md' }
]

/* ------------------------------------------------------------ 书架：朝向 */

export const BOOK_FACINGS: BookFacing[] = ['spine', 'cover']

export const BOOK_FACING_LABELS: Record<BookFacing, string> = {
  spine: '书脊朝外',
  cover: '封面朝外'
}

export const BOOK_FACING_HINTS: Record<BookFacing, string> = {
  spine: '最省地方，像真正的书架',
  cover: '一眼看到封面，适合画册'
}

/* ------------------------------------------------------------ 书架：高度 */

export const HEIGHT_MODES: HeightMode[] = ['uniform', 'slight', 'mixed']

export const HEIGHT_MODE_LABELS: Record<HeightMode, string> = {
  uniform: '完全统一',
  slight: '轻微错落',
  mixed: '明显错落'
}

export const HEIGHT_MODE_HINTS: Record<HeightMode, string> = {
  uniform: '每本书一样高，像尺子量过',
  slight: '大约一成的起伏，看着自然',
  mixed: '高低差明显，更像旧书摊'
}

/* ------------------------------------------------------------ 书架：排布 */

export const SHELF_LAYOUTS: ShelfLayout[] = ['grouped', 'continuous']

export const SHELF_LAYOUT_LABELS: Record<ShelfLayout, string> = {
  grouped: '分层显示',
  continuous: '连续书柜'
}

export const SHELF_LAYOUT_HINTS: Record<ShelfLayout, string> = {
  grouped: '每层独占一段，层与层之间留出间隔',
  continuous: '各层紧挨着排成一面整墙，单层太宽会自动换行'
}

/* ------------------------------------------------------------ 书架：排序 */

export const SHELF_SORTS: ShelfSortMode[] = [
  'manual',
  'recent',
  'added',
  'title',
  'author',
  'pages',
  'rating',
  'format'
]

export const SHELF_SORT_LABELS: Record<ShelfSortMode, string> = {
  manual: '默认（手动）',
  recent: '最近打开',
  added: '加入时间',
  title: '书名',
  author: '作者',
  pages: '页数',
  rating: '评分',
  format: '格式'
}

export const SHELF_SORT_HINTS: Record<ShelfSortMode, string> = {
  manual: '你自己摆的顺序，可以随手拖',
  recent: '读过的书浮到最前面',
  added: '新上架的书排在前面',
  title: '按书名字典序，适合找书',
  author: '按作者归类，同一位作者挨在一起',
  pages: '按厚度排，厚书先出场',
  rating: '高分在前，打分低的往后站',
  format: '按文件格式分组，PDF 与笔记各归一处'
}

/* ------------------------------------------------------------ 书架：状态 */

export const BOOK_STATUSES: BookStatus[] = ['unread', 'reading', 'finished']

export const BOOK_STATUS_LABELS: Record<BookStatus, string> = {
  unread: '未读',
  reading: '在读',
  finished: '已读完'
}

/* ------------------------------------------------------------ 书架：格式 */

/** 筛选栏里可以勾选的格式（md 与 markdown 合并成一项） */
export const FILTER_FORMATS: BookFormat[] = [
  'pdf',
  'md',
  'txt',
  'docx',
  'doc',
  'rtf',
  'html',
  'epub',
  'image',
  'unknown'
]

/* -------------------------------------------------------- 书脊样式：分配 */

export const SPINE_STYLE_MODES: SpineStyleMode[] = ['hash', 'single', 'rotate']

export const SPINE_STYLE_MODE_LABELS: Record<SpineStyleMode, string> = {
  single: '全部统一',
  hash: '按书名分配',
  rotate: '按顺序轮换'
}

export const SPINE_STYLE_MODE_HINTS: Record<SpineStyleMode, string> = {
  single: '所有书都套用基准样式，书脊整齐划一。',
  hash: '同一本书永远同一套样式，怎么重排都不会变样。（推荐默认）',
  rotate: '沿着书架依次套用，一排看过去像真的书，各不相同。'
}

/** 笔记那份列表的同一套分配说明：三种方式一样，只是主语换成"笔记" */
export const SPINE_STYLE_MODE_HINTS_NOTE: Record<SpineStyleMode, string> = {
  single: '所有笔记都套用笔记的基准样式，书脊整齐划一。',
  hash: '同一条笔记永远同一套样式，怎么重排都不会变样。（推荐默认）',
  rotate: '沿着书架依次套用，一排笔记看过去各不相同。'
}

/* ----------------------------------------------------------- 打开动画 */

export const OPEN_ANIMATIONS: OpenAnimation[] = ['full', 'simple', 'off']

export const OPEN_ANIMATION_LABELS: Record<OpenAnimation, string> = {
  full: '完整',
  simple: '简洁',
  off: '关闭'
}

export const OPEN_ANIMATION_HINTS: Record<OpenAnimation, string> = {
  full: '书从架上抽出再摊开，最像真的',
  simple: '只做淡入，快一些',
  off: '点开即见，不做任何过渡'
}

/* ---------------------------------------------------------------- 快捷键 */

export const SHORTCUTS: { keys: string; label: string }[] = [
  { keys: 'Ctrl + S', label: '保存当前笔记' },
  { keys: 'Ctrl + E', label: '切换预览' },
  { keys: 'Ctrl + F', label: '搜索全文' },
  { keys: 'Ctrl + N', label: '新建笔记' },
  { keys: 'Ctrl + ,', label: '打开设置' },
  { keys: 'B', label: '添加书签' },
  { keys: 'P', label: '画笔批注' },
  { keys: 'Esc', label: '回到书架' }
]

/* --------------------------------------------------------------- 更新日志 */

/*
 * 只用真人明确指定过的版本号。
 *
 * 版本号是你在需求里直接指定的（早期每批需求的最后一条往往就是"版本号改为 x.y.z"），
 * 所以这里不自己编中间版本：0.1.1 之后下一个就是 0.3.0 —— **没有 0.2**。
 * （这两条 0.2.0 曾经存在过，是我当时凭空补的中间号，现已归回 0.3.0。）
 */
export const CHANGELOG_RECENT: { version: string; title: string; detail: string }[] = [
  {
    version: '0.11.0',
    title: '词汇识别修好了，原词也能改',
    detail:
      '以前从解析里收词会出三种错：多词短语被空格劈开（coup d’envoi 变成 coup + d’envoi）、释义被逗号截断（只剩「使转向、改变，」）、“本句指…”被塞进原词栏 —— 根因是兜底取词时那条“字母词 + 空格”的启发式规则排在冒号规则前面。现在**冒号式优先**：冒号前整段就是词形（多词短语整条保留），冒号后整段是释义；难句那一节也不会再混进词汇表（边界不再只认换行）。提示词同时收严：第一列只写词形、不许带释义，难句/语法不进词汇表。**单词本里的原词现在可以编辑**，改成已存在的词会自动合并，不会留两条同名。'
  },
  {
    version: '0.11.0',
    title: '单词本：按语种分开记，翻译解析里的词一键收进来',
    detail:
      '侧栏多了一个与书架并列的「单词本」。翻译的解析末尾现在会附一份**结构化词汇表**（原词 / 读音 / 释义），面板里按行列出，每条带「加入」，也能「全部加入」；收进来的词自动按语种分组（日 / 英 / 中 / 韩…，靠字符集判断，可手动改），可以搜索、按时间或字母排序、编辑释义与备注、单条删除。词条存在单独的 vocabulary.json 里，重复词会合并补全而不是重复占位。'
  },
  {
    version: '0.10.2',
    title: '文本朗读：Edge 在线语音（142 种语言）与系统语音',
    detail:
      '阅读器工具栏上多了「朗读」，点了底部出现一条朗读栏。**在线语音**就是 Edge 浏览器「大声朗读」用的那一套：322 个语音、142 种语言（中文 14 个，晓晓 / 云希 / 云扬…），按语言分组挑，语速与音调都能调；音频由主进程合成，避开跨域。也可以切到**系统语音**（离线，语种取决于系统装了什么）。朗读按段落切分，上一段 / 下一段、暂停 / 继续都立刻有反应，栏里会显示正在读的那一段；勾上「连读下一节」就会读完一节自动翻页接着读。'
  },
  {
    version: '0.10.1',
    title: '翻译可配多条接口、提示词预设、快捷键独立成页、数据目录体检',
    detail:
      '**翻译接口可以配多条**：设置里按「AI 翻译」与「机器翻译」两大类分组，每类是一张列表 —— 点一下切换当前使用，可以起名字、逐条填密钥与模型、随时增删（默认摆好 DeepSeek / 硅基流动 / Google / 微软 / DeepL / 有道 六条）。老设置会自动迁移，**已经填过的密钥与模型一个不丢**。**提示词预设**按文本类型内置五套（轻小说 / 历史 / 科技 / 商务…），可增删改，翻译栏里在目标语言旁边就能切换。**快捷键独立成一页**：一条条列出并标明适用范围（全局 / EPUB / PDF / 编辑器），每项都能点一下再按组合键改键、能清空、能恢复默认，撞车会标红；文本标记也有快捷键了（H 高亮 / U 划线 / W 波浪 / N 记为笔记 / Ctrl+T 翻译选中）。另外：PDF 补上了翻译入口与 **Ctrl+滚轮缩放**（缩放时看住原来的位置，不会跑位）；阅读器左右两条侧栏都能**拖动调宽**（有范围限制、双击复位）；设置里多了**图片数据目录体检** —— 找出已经没人用的图和重复的图，确认后清掉并把引用改指到留下的那份。这一版还修了：记为笔记之后正文里的标记又没了（摘录把全角空格压成半角导致找不回原文）、点一下正文所有快捷键就失效（正文在 iframe 里，监听没挂进去）、快捷键不支持 Alt/Shift 且默认会莫名撞车（现改成弹窗点选组合键）、PDF 缩放跑位、翻页热区太小（88–150px）、强制横排时图片章节仍按竖排（内层元素也加了 !important）、翻译设置里目标语言溢出（改下拉）、右栏拖手高度为 0 抓不到、侧栏书架层右边那个没用的小删除按钮。长列表（翻译记录 / 引用的书籍 / 更新日志）各自独立成一页并用表格排。'
  },
  {
    version: '0.10.0',
    title: '选中文字就能翻译（阅读器右侧栏）',
    detail:
      '选中正文，浮出的工具条上多了「翻译」，结果显示在**最右侧的翻译栏**（与左边的目录栏各占一边，点一下就能收起），不遮挡原文 —— 读双语要能对着看。栏里**上下分三层**：原文 / 翻译 / 解析（机翻只有前两层），层高可以**拖动分隔条**调整：查语法时把解析拉大，对照原文时把原文拉大。解析是真按 **Markdown** 渲染的（列表、加粗、行内代码各归各位），因为模型本来就是那么写的。两种方式：**机翻**接 Google / 微软 / DeepL / 有道；**AI 翻译**在设置里填任意 OpenAI 兼容平台的地址、密钥与模型（DeepSeek、硅基流动、本地 ollama 都行）。翻译默认带上**前后各若干段上下文**：孤零零一句最容易把代词与省略主语译飞。AI 那份提示词可以改（也能一键恢复默认），它要求模型先读懂上下文再翻，解析里分语法、词汇、难句三类落到具体词句。请求由主进程发出 —— 密钥不会落进页面上下文。'
  },
  {
    version: '0.9.8',
    title: '标注能改了：换色、换样式、波浪线、删除',
    detail:
      '以前划完就定死在那儿：颜色改不了、删不掉，只能整段删了重划。现在**点标注任何位置**（不用精确点到那条线）都会浮出一条编辑条：**复制原文**、五种颜色随手换、高亮 / 划线 / 波浪线三选一、或者直接删掉，改完立刻画到正文里。为此修了两个真问题：重画时遇到"已经画过"的那条会跳过（原本防重复包），于是改了色页面上不动；拿不到章节下标时又把所有标注重画都略过。另外新增了**波浪线**标注。'
  },
  {
    version: '0.9.8',
    title: '竖排书的划线只画一小段 —— 修好了',
    detail:
      '以前下划线用的是 border-bottom。竖排（vertical-rl）时文字竖着走，"下面"根本不是该画线的方向 —— 所以只在最后一个字底下出现一小段。现在改用**逻辑属性** border-block-end，横排竖排都会落在正确的一侧；波浪线用 text-decoration，浏览器自己会按书写方向画。'
  },
  {
    version: '0.9.8',
    title: '阅读侧栏：书签与笔记分成两栏',
    detail:
      '「书签」只记位置（"我读到这儿了"），「笔记」带着原文与备注（"这句话我有想法"），两回事不该挤在一栏里数不清。现在阅读侧栏是 目录 / 书签 / 笔记 三栏，各自只列自己那一类、各自计数；笔记栏里每条都能一键复制原文。'
  },
  {
    version: '0.9.8',
    title: '统计页新增「最近心得」',
    detail:
      '正文里划出来的高亮 / 划线 / 波浪线，以及写了备注的书签，现在单独统计成一段叫「最近心得」（带总条数），点一下直接打开那本书。与「最近书签」分开：书签只是"我读到这儿了"。'
  },
  {
    version: '0.9.8',
    title: '回收站能用侧栏走回去，排版细节也修了',
    detail:
      '在回收站页面点侧栏的书架/全部藏书，以前只是改了"当前书架"、视图却留在回收站，看着像点不动；现在会真的回到书架。排版弹层里「衬线 / 黑体 / 楷体」两个字被挤到溢出，已给足宽度。段首缩进改成**可正可负**的滑块：有些书自己就缩了两格，再往上加只会更深，现在能往左"缩回"（最左 -3em）。'
  },
  {
    version: '0.9.8',
    title: '「临时打开」真的不留痕了',
    detail:
      '这个毛病一直在：临时打开的书过一阵子还是会出现在书架上，重开应用或重新扫描更是一定跑出来。根因不在"书架没过滤"，而在主进程重建书籍条目时用的是一张**字段白名单** —— 里边漏了 temporary（以及 trashed、trashedAt、coverChecked），于是**任何一次保存或扫描**都会把"临时"这个标记悄悄抹掉，那本书就变成正式书了。现在这几个状态位原样保留；回收站也顺带堵住了同一个隐患（回收站里的书重启后不会再溜回书架）。'
  },
  {
    version: '0.9.8',
    title: '书立：朝向与换行改成了二级菜单',
    detail:
      '以前「适用朝向」是个循环按钮，想看另一档还得先把书架切到那个模式才能看出效果，很别扭。现在它是个二级菜单，三项直接选，而且**选完菜单不关**（本来就是调着看的）。「到这里另起一行」同样做成二级菜单，并且**可以按模式分别设**：有些书立两种模式都要留，只是换行位置不同 —— 书脊模式一本几十像素、封面模式是一整张图的进深，同一个断点很难两头都对。菜单里只列这个书立真正生效的那一档，不给无关的开关。'
  },
  {
    version: '0.9.8',
    title: '看图：手机相册那样翻',
    detail:
      '阅读器工具栏多了「看图」——看图不用再钻进「导出图片」里点小图了，那个入口本来就别扭。现在是相册逻辑：大图铺满，滚轮或双击放大、放大后可拖动、一键回到原始大小；底部胶片条横向翻页；要导出时点「选择」或**长按图片**进选择态，点图打勾，再「导出选中」。平时点图只翻看，不会误触发导出。Esc 两步退出：先退选择态，再关看图器。'
  },
  {
    version: '0.9.8',
    title: '书签看得见了，也可以写备注',
    detail:
      '以前加完书签页面上什么都没有，侧栏那份清单还是旧的 —— 因为清单被阅读器和侧栏各自读了一份，标记完不会同步。现在书签是一份共享状态，标记当场就出现在侧栏；加了书签的那段文字会在正文里被划出来（按你选中的原文定位），右上角还有一条「这一页有 N 个书签」的色带。每条书签都能写备注 / 读书笔记，写在列表里、看得见。'
  },
  {
    version: '0.9.8',
    title: '书签与笔记分开了',
    detail:
      '选中文字时工具条上那个按钮改叫「记为笔记」，会把**你选中的原文**一起记下来；平时按 Ctrl+B 加的是「书签」，只记位置。侧栏按这个分成「笔记」与「书签」两组，各数各的。'
  },
  {
    version: '0.9.8',
    title: '回收站与书架并排',
    detail:
      '回收站以前是个孤零零的整屏列表，连左侧栏都没有，用起来像另一个软件。现在它和「全部藏书」同构：侧栏照常显示（进回收站时高亮回收站那条），用的是书架那套工具栏与外壳，点一下行就能选中，选中后浮出「已选 N 本 / 还原到书架 / 彻底删除」，操作手感与书架一致。动作仍然只有还原与彻底删除两件。'
  },
  {
    version: '0.9.8',
    title: '字号、字体、行距都能调了',
    detail:
      'EPUB 排版弹层里新增：字号滑块 70%–200%、字体四选一（跟随书籍 / 衬线 / 黑体 / 楷体）、**行距连续可调**（最左是"跟随书籍"，往右 1.2 到 2.6 倍）—— 原来的「书 / 紧 / 松」三档确实太难用。这三项存在设置里，换书、重开都记得。另外改背景时会**连字色一起换**：以前换主题只对新加载的章节生效，眼前这页还是旧配色，深色底配黑字就看不清了。'
  },
  {
    version: '0.9.8',
    title: '竖排书的插图页不再被当成横排',
    detail:
      '轻小说开头常有一堆纯插图页，它们不声明书写方向（有的还自带 horizontal-tb），于是一整节被当成横排书 —— 翻页方向跟着反。现在没有文字的页面不参与判断，一律跟随这本书的朝向；而这个结论会记进这本书的记录里，下次打开连封面页都是对的。'
  },
  {
    version: '0.9.8',
    title: '选中文字不再是刺眼的亮蓝',
    detail:
      '正文里选中文字的颜色改成跟随主题（浅色主题是柔和的暖色，夜间提亮一档），不再是浏览器默认那种亮蓝。'
  },
  {
    version: '0.9.8',
    title: '正文划线与高亮',
    detail:
      'EPUB 里选中文字会浮出一条工具条：复制、五种颜色的高亮、划线、以及直接标记书签。标注会跟着书存下来 —— 切章、换字号、重开都还在原处。这一层也是后面「翻译」等能力的挂载点。'
  },
  {
    version: '0.9.8',
    title: '回收站',
    detail:
      '「从书架移除」不再直接把书扔掉：复制入库的书，文件会挪进藏书目录下的「_回收站」，条目也留着 —— 所以「重新扫描」不会再把它们收回来（之前移除过的书一扫就复活，很烦）。侧栏有「回收站」入口，里面只有还原与彻底删除两个动作。'
  },
  {
    version: '0.9.8',
    title: '导出图片能看大图了',
    detail:
      '导出图片的清单里点缩略图即可进「看图模式」：大图、左右翻页、页码与体积，导出直接整合在里面（导出这张 / 导出选中）。Esc 只退出看图，不会把整个弹窗关掉。'
  },
  {
    version: '0.9.8',
    title: '导出笔记的两个后续选项',
    detail:
      '导出为 PDF / Word / HTML 时多了两个开关，默认都不勾：「导出后把新文件加入书架」「导出后把原笔记移入回收站」。导出本身仍是一次干净的动作，不勾就不会动书架和你写的东西。'
  },
  {
    version: '0.9.8',
    title: '详情页的封面预览修好了',
    detail:
      '自动提取的封面以前在详情页只显示一块黑：那里的预览把 `asset:xxx` 这种简写当成了真 URL，浏览器解析不了。现在走统一的地址转换，并且改用 <img> 画，比例也对。'
  },
  {
    version: '0.9.7',
    title: '临时打开电脑里的文件',
    detail:
      '「导入」菜单第一项是「临时打开…」：挑一个文件直接看，不占书架。系统里双击关联格式的文件也会走这条路 —— 以前一律复制入库，太霸道。临时书退出应用即消失，想留下就点阅读界面右上角的「添加到书架」。'
  },
  {
    version: '0.9.7',
    title: '注册成这些格式的打开方式',
    detail:
      '安装时在注册表里登记本应用能打开 EPUB / PDF / Markdown / TXT / Word 正文（HKCU，不需要管理员权限）。只登记「能打开」，不会偷偷改你已有的默认程序；要不要设成默认，由你在系统里点。'
  },
  {
    version: '0.9.7.beta',
    title: '单层书架高度按朝向分开',
    detail:
      '书脊朝外与封面朝外各自记一份单层高度，互不影响：书脊模式可以调到 560 px，把书脊上的书名看清；封面模式保持 420 px 上限，免得大图把藏书量挤掉。'
  },
  {
    version: '0.9.7.beta',
    title: '删掉「自定义朝向」',
    detail:
      '那个模式是拿封面大小的书去凑视角的，既不像真书，也没法还原真实透视 —— 书脊与封面本该同时出现，靠两个平面拼不出可信的立体感。与其留着半成品，不如只保留「书脊朝外」「封面朝外」两种名副其实的朝向。'
  },
  {
    version: '0.9.7.beta',
    title: '批量设置系列与作者',
    detail:
      '多选之后可以一次给这批书填上「系列」和「作者」（留空即清空），两项可分别应用，也可一起应用。同一系列的书会自动共用书脊高度，所以整理书架时这是最省事的入口。'
  },
  {
    version: '0.9.7.beta',
    title: '贴了书脊图就不再画竹节',
    detail:
      '书脊贴图上的横向条带来自样式里的「竹节 / 束带 / 烫印」与顶部压边 —— 它们原本无条件叠在图上画。现在贴了图就只显示图本身，横条带不再出现。'
  },
  {
    version: '0.9.6',
    title: '书脊贴图按真实比例铺满',
    detail:
      '书脊贴图此前会被裁、被拉宽，或在两侧留透明带：因为书脊面的宽度取的是 footprint（含倾斜外扩），而算书脊宽度用的布局高度又与实际渲染高度不一致。现在改成由 aspect-ratio 按图片自身比例推出宽度，倾斜与不倾斜的书脊厚度一致。'
  },
  {
    version: '0.9.6',
    title: '扫描完成有回执',
    detail: '页数统计与封面补录跑完后弹出「藏书目录已扫描完成 · 共 N 本」，不再只转个圈就消失。'
  },
  {
    version: '0.9.6',
    title: '书脊厚度减半',
    detail: '页数与厚度的映射整体减半（1 页 42→21px、300 页 88→44px、1200 页 100→50px），更接近真书。'
  },
  {
    version: '0.9.6',
    title: 'PDF 书签能存住了',
    detail:
      '「在第 N 页加书签」以前不落盘：立即保存走的是 flush()，而它只读自己的 pending，从不接收刚改好的记录 —— 于是要么不写，要么把上一次的旧记录写回去。现在 flush 接收记录，书签、大纲、批注都能立即存住。'
  },
  {
    version: '0.1.1',
    title: '仿真实体书架',
    detail:
      '书架上先有书。书的厚薄由页数决定；书脊可以只放图标与书名，也可以直接换成自己的图片（贴了图就不再压书名），封面同样可自定义。'
  },
  {
    version: '0.1.1',
    title: '三种格式，各得其所',
    detail: 'Markdown 与纯文本可以直接在里面写；Word 与 PDF 可以直接在里面读。空书架会放一本文档格式的示例书。'
  },
  {
    version: '0.1.1',
    title: 'PDF 阅读器',
    detail: '目录、书签、画笔批注，以及把书里的图片按页抽出来另存。'
  },
  {
    version: '0.1.1',
    title: '三套外观分开挑',
    detail:
      '书架主题（木色与材质）、应用主题（界面配色）、书籍样式（书脊与封面）各管一摊，互不牵扯；预设之外还能自己调色存成一套。'
  },
  {
    version: '0.1.1',
    title: '书香与扁平图标',
    detail: '整体取木色与纸色的暖调，图标一律是等线宽的线性图标，靠加粗、下划线区分层级，不靠色块堆叠。'
  },
  {
    version: '0.1.1',
    title: 'HTML 笔记',
    detail:
      '支持 dsh 等工具生成的自包含 HTML 页面：只读预览、自动识别标题做书名、按去脚本后的字数估页数。'
  },
  {
    version: '0.3.0',
    title: '书脊样式工作台',
    detail: '可以自己攒一柜子书脊样式，按书名分配或依次轮换；内置样式能停用、改名、另存。'
  },
  {
    version: '0.3.0',
    title: '书架排布与筛选',
    detail: '朝向、高度错落、分层或整墙书柜、八种排序，以及一套默认筛选条件。'
  },
  {
    version: '0.3.0',
    title: '设置重新分区',
    detail: '七页设置各归其位：通用、外观、书脊样式、书架与排序、阅读与编辑、文件与数据、关于。'
  },
  {
    version: '0.3.0',
    title: '数据目录与图片搬家',
    detail: '书籍外观图片统一放进数据目录；历史遗留的内联 base64 图片可以一键落盘，索引会明显变小。'
  },
  {
    version: '0.4.0',
    title: '打开书籍真的先播动画',
    detail: '阅读界面改成幕布压成不透明之后才挂载；以前它从第一帧就渲染在透明幕布后面，看着像"动画还没开始书就开了"。'
  },
  {
    version: '0.4.0',
    title: '书脊装饰各就各位',
    detail: '书名与署名按横带、竹节、烫金线的位置让开；纸质标签跟着书脊的弧度受光，书名按标签自身的宽高折列居中。'
  },
  {
    version: '0.4.0',
    title: '拖到别的书架层',
    detail: '拖动时落在另一层会高亮整层，松手即搬家；空的书架层也会摆出一层，所以有地方可以放。'
  },
  {
    version: '0.4.0',
    title: '现代书房与平板书脊',
    detail: '新增无木纹的平板书架与完全平面的书脊（无弧面高光与纹理）；默认仍是有木纹的复古风，想要干净观感在设置里选。'
  },
  {
    version: '0.4.0',
    title: '书架更整齐',
    detail: '层与层之间不再露墙；连续书柜改回带间隔并加上书架外框，一眼看得出是两个独立书架；书架页面禁止选中文字。'
  },
  {
    version: '0.4.0',
    title: '新增样式可以从预设起步',
    detail: '「新增样式」先挑起点 —— 基准样式、任意内置预设或你存过的预设，不用再从一个空壳手动调。'
  },
  {
    version: '0.5.0',
    title: 'EPUB 阅读器',
    detail: '解开 zip 后在内存里按需供给，章节与目录一应俱全；书籍自带的 CSS 原样生效，排版还原度就是原书的排版。'
  },
  {
    version: '0.5.0',
    title: '左右翻页与翻页动画',
    detail: 'PDF 与 EPUB 都能单页居中、点击两侧或按方向键翻页；滑动 / 卷页 / 淡入 / 不使用四档动画可在设置里换。'
  },
  {
    version: '0.5.0',
    title: '五线谱、目录与统一图床',
    detail: 'Markdown 里的 abc 围栏渲染成真乐谱，[TOC] 生成可点目录；插入或粘贴的图片统一收进数据目录。'
  },
  {
    version: '0.5.0',
    title: '导出为 PDF / Word / HTML',
    detail: 'PDF 走 Electron 的排版引擎，图片、目录、五线谱都保留；Word 是真正的 .docx，图片内嵌、目录可点。'
  },
  {
    version: '0.5.0',
    title: '书架层主题色',
    detail: '侧栏右键即可给书架层上色，表现为图标描边色；删除时会问是否把书归到「我的书架」，默认勾选。'
  },
  {
    version: '0.5.0',
    title: '字体库与一键风格',
    detail: '书名可选楷体、仿宋、黑体、圆体、隶书等 11 档字体；基准样式新增古典 / 现代 / 极简三条成套风格。'
  },
  {
    version: '0.5.1',
    title: 'EPUB 按书页大小排版',
    detail: '页宽固定成像一本真书，可切「适应窗口」；一屏一页或一屏两页（摊开的书）都能选。'
  },
  {
    version: '0.5.1',
    title: '书立：同一层里做分组',
    detail: '书脊右键插入书立，书立右键调整空位宽度或移除 —— 一层书架可以再分成几组。'
  },
  {
    version: '0.5.1',
    title: '书脊西文与数字横躺',
    detail: '竖排时中文正立、英文与数字转 90°，不再把 2024 摞成四块数字。'
  },
  {
    version: '0.5.1',
    title: '翻页一次两页',
    detail: 'PDF 与 EPUB 的左右翻页都是一屏一个跨页，像摊开的书。EPUB 页数也改为按正文估算。'
  },
  {
    version: '0.5.2',
    title: '贴图自己定书脊尺寸',
    detail: '选图时记下宽高比，书脊厚度与封面宽度都按图来，图片不再被裁掉；贴了书脊图就不再压书名。'
  },
  {
    version: '0.5.2',
    title: 'EPUB 竖排能翻页了',
    detail: '竖排里多列布局不成立，以前页数恒为 1、点下一页直接跳章；现在按屏宽横向滚动。大图也改为按页缩放。'
  },
  {
    version: '0.5.2',
    title: 'EPUB 有留白与书中缝',
    detail: '正文四周留白，双页模式下两页之间有真正的凹陷书脊。'
  },
  {
    version: '0.6.0',
    title: 'EPUB 翻页不再跨中缝',
    detail: '列数写死，一页的步距正好等于页宽；中缝只在「书页 + 左右翻页 + 双页」下出现，且收成一条细线。'
  },
  {
    version: '0.6.0',
    title: '贴图尺寸与书架排列',
    detail: '书脊/封面贴图按书的实际高度算宽度；倾斜的书不再顶出边框；连续书柜改为左右滚动。'
  },
  {
    version: '0.6.0',
    title: '书立与打开动画',
    detail: '书立改成成对的「】【」并可左右挪位；打开动画先显示书脊，不再一闪变成封面。'
  },
  {
    version: '0.6.1',
    title: '书立菜单终于能用',
    detail:
      '菜单项改为在 pointerdown 上派发：真实点击里菜单会在 mousedown 时被收起，按钮还没等到 click 就被卸载了。'
  },
  {
    version: '0.6.1',
    title: '冷启动不再每行两三本',
    detail: '书架宽度初值为 0，而冷启动第一次渲染时书库还没到、量不到 DOM，装箱预算被兜成了 240px。'
  },
  {
    version: '0.7.0',
    title: 'EPUB 改用 foliate-js',
    detail:
      '分栏、留白、单双页、竖排的推进方向都交给它的分页器；阅读位置改用 EPUB CFI 保存，换字号也不会漂。'
  },
  {
    version: '0.7.0',
    title: '横排 / 竖排开关',
    detail: '可以强制把竖排书横着读，或者把横排书竖着排 —— 往每个 XHTML 注入一条 writing-mode 即可。'
  },
  {
    version: '0.7.1',
    title: '修好了：书籍自带的样式表被 CSP 拦掉',
    detail:
      '书页是 blob: 文档，它继承界面的 CSP；而 style-src 里没有 blob:，于是每本真实 EPUB 自带的 CSS 全部不生效（图片能显示是因为 img-src 里有 blob:）。'
  },
  {
    version: '0.7.1',
    title: '点击左右两侧翻页',
    detail: '页面左右边缘各有一条窄带，点一下就翻页；中间留给书里的链接与选词。竖排时左边才是下一页。'
  },
  {
    version: '0.7.1',
    title: '翻页方向统一',
    detail:
      '上一页/下一页按阅读顺序，点击区与方向键按屏幕方向。原来 foliate 只看 OPF 声明，原生竖排书点「下一页」会往回翻。'
  },
  {
    version: '0.7.1',
    title: '兼容 -webkit-writing-mode',
    detail: '日文 EPUB（Calibre 转出的尤其多）常写 -webkit-writing-mode，注入时补一条无前缀声明。'
  },
  {
    version: '0.7.2',
    title: '更新日志补上首版',
    detail:
      '补 0.1.1 的条目，并删掉两条标着 0.2.0 的记录 —— 那个版本号从没存在过（0.1.1 之后直接跳到 0.3.0），是我当时凭空补的中间号。'
  },
  {
    version: '0.8.0',
    title: '书籍与笔记分开',
    detail:
      '按"应用能不能改这个文件"定默认：PDF/EPUB/Word/网页是书籍，Markdown/纯文本是笔记；详情页与右键都能改。两者的默认长相也分开，笔记默认是一本朴素的便笺。'
  },
  {
    version: '0.8.0',
    title: '深色主题下书页不再"暗底黑字"',
    detail:
      '书页文档在 iframe 里，书自己不画背景的地方透出的是外层舞台 —— 深色主题下书页变黑而字还是黑的。现在书页底色跟应用主题一致，深色时连正文里写死的颜色一起接管。'
  },
  {
    version: '0.8.0',
    title: '统计页',
    detail:
      '与书架并列：打卡热力图、阅读统计（书目/时间/页数/读完）、笔记统计（字数/时间/书目）、近期阅读与最近使用的笔记。同一份文件"当书读"与"当笔记写"分开记账。'
  },
  {
    version: '0.8.0',
    title: '书架上的阅读进度',
    detail: '封面朝外时画圆圈，书脊朝外时是书脊左侧等高的细长进度条；开关在「书架与排序」，只对书籍显示。'
  },
  {
    version: '0.8.0',
    title: '引用书籍的文件信息',
    detail: '「文件与数据」里列出所有"仅引用"导入的书：路径、大小、是否还在，并能直接打开所在文件夹。'
  },
  {
    version: '0.9.0',
    title: '书签',
    detail:
      '一个入口适配所有格式：PDF 记页码、EPUB 记 CFI、Markdown/纯文本记滚动比例加当前行摘录；顶栏按钮或 Ctrl+B 加，点书签跳过去。统计页也能看到最近书签。'
  },
  {
    version: '0.9.0',
    title: '五套笔记专用样式',
    detail: '便笺、方格纸、索引卡、牛皮纸、手账 —— 在「书籍外观 → 笔记的基准样式」里一键套用。'
  },
  {
    version: '0.9.0',
    title: '菜单与详情页更顺手',
    detail:
      '右键菜单的「阅读状态」「移动到书架层」收进二级菜单；详情页能一站式完成打开、书立、移除等操作，书籍样式默认收起。'
  },
  {
    version: '0.9.0',
    title: '两处修复',
    detail:
      '书脊朝向的进度条不显示进度（封面圆圈本来是好的）；打开笔记时输入字数会被整篇字数顶一截 —— 加载完之前的字数不算输入。'
  },
  {
    version: '0.9.1',
    title: '目录与书签合成左侧栏',
    detail:
      'PDF 的目录本来就在左边、编辑器的大纲却在右边，忽左忽右；现在都是左栏两栏：目录 · 书签。书签也搬进来了，不再单独占一个顶栏面板。'
  },
  {
    version: '0.9.1',
    title: '书签只留一套交互',
    detail: '以 PDF 那套为准：颜色圆点、内联重命名、改色、删除；简版面板已删除。位置仍按各格式自己的方式记。'
  },
  {
    version: '0.9.1',
    title: '详情页减负',
    detail: '去掉「加左右书立」与「标记五星」——书立属于书架右键，评分在书目信息里点星星。'
  },
  {
    version: '0.9.2',
    title: '封面与书脊可以取自书里的图',
    detail:
      '从 PDF / EPUB 内部的图片里挑一张当封面或书脊，并带裁剪（拖动选框、按封面或书脊比例）。封面还新增了几种版式。'
  },
  {
    version: '0.9.2',
    title: '打卡读写分离',
    detail: '连续阅读、连续写作各算一条，另留读写合计；一天要累计满 5 分钟才算打卡，顺手打开看一眼不再点亮格子。'
  },
  {
    version: '0.9.2',
    title: '阅读界面更顺手',
    detail:
      '底栏显示本次时长与累计打开次数；详情页新增阅读/写作信息；EPUB 顶栏不再重复书名、改成进度条，并新增边框距离/行距/段首缩进。'
  },
  {
    version: '0.9.2',
    title: '几处修正',
    detail:
      '连续书柜的横向滚动条固定在屏幕下方；PDF 缩放菜单不再被阅读区遮住；设置里的滑杆都能直接输入数值；移除已失效的「每层摆放书数量」。'
  },
  {
    version: '0.9.3',
    title: '裁剪台能缩放了',
    detail:
      '滚轮以鼠标位置为中心缩放（1×–8×），放大后可在选框外拖动画面；进裁剪台默认就是全尺寸框选（书内封面多半本来就是干净图）；选框的最小宽高限制也去掉了，能一路框到很小。'
  },
  {
    version: '0.9.3',
    title: '同系列的书高度齐平',
    detail: '书籍详情页新增「系列」一栏：同一系列的书书脊高度一致，不同系列之间才保留错落。错落幅度仍可在「书架主题」里调。'
  },
  {
    version: '0.9.3',
    title: '修掉裁剪台卡死',
    detail:
      '0.9.2 里点开裁剪台会卡死渲染进程：选框外那圈变暗的 9999px 投影被带进了合成层，把层撑到两万像素见方。现已在舞台边界裁掉溢出。'
  },
  {
    version: '0.9.4',
    title: '封面大小单独一档',
    detail:
      '封面朝外时宽度由封面比例乘高度算出，所以错落是整体缩放封面 —— 与书脊"只改高矮"不同。现在封面错落（默认 0 = 等高）与封面大小各自可调。'
  },
  {
    version: '0.9.5',
    title: '裁剪工作区更大',
    detail:
      '舞台上限提到 780×660 并按窗口高度夹紧；小图不再按原尺寸缩成一小块（以前只缩不放，120px 的插图就显示 120px），现在会铺满可用空间、最多放大 3 倍。'
  },
  {
    version: '0.9.5',
    title: '裁剪提交更稳',
    detail: '算选框所需的拖动起点改为显式传参，避免指针事件顺序变化时出现"框能拖、裁出来却还是整张图"的静默失效。'
  },
  {
    version: '0.9.5',
    title: 'EPUB 工具条不再挤',
    detail:
      '边框距离/行距/段首缩进收进「排版」弹层，「目录」与「导出图片」变成带文字的正常按钮；「目录」也修好了 —— 0.9.1 曾把它做成纯图标，点了没反应。'
  },
  {
    version: '0.9.5',
    title: '阅读统计挪到状态栏',
    detail:
      '读书时「46 本藏书 · 4 层书架」那一行换成本书的统计（本次时长/打开次数/累计/翻页或字数），回到书架再恢复；阅读界面里另加的那条底栏已撤掉。'
  },
  {
    version: '0.9.6',
    title: '导入 EPUB 自动取封面',
    detail:
      '依次找 EPUB3 的 cover-image、EPUB2 的 meta name="cover"，最后兜底找文件名里带 cover 的图；取到的图落盘成 asset 引用写进书籍样式，找不到就照旧用程序化封面。'
  }
]

/*
 * 原先这里还有一段不标版本的「更早的版本」。
 * 现在 0.1.1 已经有正式条目了，那四条摘要（书脊样式工作台 / 主题画廊 / 阅读与编辑 /
 * 藏书目录搬家）全都被各自的版本条目覆盖，留着只会让人以为还有更早的东西，
 * 所以合并掉：主题并入 0.1.1 的「三套外观分开挑」，其余见 0.3.0 各条。
 */

/* ------------------------------------------------------------------ 小工具 */

/** 把任意中文标签转成稳定的 DOM id 片段 */
export function slug(input: string): string {
  return input.replace(/[^a-zA-Z0-9-]+/g, '-').replace(/^-+|-+$/g, '') || 'item'
}
