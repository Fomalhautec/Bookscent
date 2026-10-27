import DOMPurify from 'dompurify'
import { marked } from 'marked'
import type { Token, Tokens } from 'marked'
import { imageSrc } from '@shared/noteUrl'
import { parseHeadings, type HeadingInfo } from './doc'

/* -------------------------------------------------- ==高亮== 扩展 */

interface HighlightToken extends Tokens.Generic {
  type: 'highlight'
  raw: string
  text: string
  tokens: Token[]
}

const HIGHLIGHT_START = /^==(?=\S)/
/** 一段文本里第一处成对的 `==…==` */
const HIGHLIGHT_PAIR = /==([^=\n]+?)==/

marked.use({
  /**
   * 行内文本默认是"贪婪"的：`=` 不是特殊字符，所以 `一段文字 ==高亮== 后面`
   * 会被整段吞成一个 text token，行内扩展根本没机会在中间被调用
   * （结果就是等号原样显示）。
   *
   * 修法：先按 marked 自己的规则取出这一小段文本，如果里面出现了成对的 `==…==`，
   * 就把 text token 提前切断——只切断，不多吃，所以对其它行内语法毫无影响。
   */
  tokenizer: {
    inlineText(src: string): Tokens.Text | false {
      const whole = this.rules.inline.text.exec(src)
      if (!whole) return false
      const found = HIGHLIGHT_PAIR.exec(whole[0])
      if (!found || found.index === 0) return false
      const raw = whole[0].slice(0, found.index)
      if (!raw) return false
      return { type: 'text', raw, text: raw }
    }
  },
  extensions: [
    {
      name: 'highlight',
      level: 'inline',
      tokenizer(src: string): HighlightToken | undefined {
        if (!HIGHLIGHT_START.test(src)) return undefined
        const match = /^==([^=\n]+?)==/.exec(src)
        if (!match) return undefined
        const token: HighlightToken = {
          type: 'highlight',
          raw: match[0],
          text: match[1],
          tokens: []
        }
        this.lexer.inline(token.text, token.tokens)
        return token
      },
      renderer(token: Token): string {
        const self = token as HighlightToken
        const inner = self.tokens ? this.parser.parseInline(self.tokens) : self.text
        return `<mark>${inner}</mark>`
      }
    }
  ]
})

/* ------------------------------------------------------- 目录 [TOC] */

interface TocToken extends Tokens.Generic {
  type: 'toc'
  raw: string
  text: string
  tokens: Token[]
}

/** 独占一行的 `[TOC]` 或 `[[toc]]`（大小写不敏感） */
const TOC_LINE = /^[ \t]*(\[\[toc\]\]|\[toc\])[ \t]*(?:\n+|$)/i
const TOC_PRESENT = /^[ \t]*(\[\[toc\]\]|\[toc\])[ \t]*$/im

/**
 * 目录要在渲染期就知道本文档的标题，而 marked 的 renderer 是同步纯函数。
 * 这里用一个「当前渲染上下文」传递：renderMarkdown 是同步的，不会重入，
 * 所以模块级变量是安全的；标题按需惰性解析，没写 [TOC] 就完全不付这份成本。
 */
let tocContext: { source: string; headings: HeadingInfo[] | null } | null = null

function tocHeadings(): HeadingInfo[] {
  if (!tocContext) return []
  if (!tocContext.headings) tocContext.headings = parseHeadings(tocContext.source)
  return tocContext.headings
}

marked.use({
  extensions: [
    {
      name: 'toc',
      level: 'block',
      tokenizer(src: string): TocToken | undefined {
        const match = TOC_LINE.exec(src)
        if (!match) return undefined
        return { type: 'toc', raw: match[0], text: '', tokens: [] }
      },
      renderer(): string {
        return buildTocHtml(tocHeadings())
      }
    }
  ]
})

/** 由标题列表拼出按层级缩进的目录；层级跳跃时也保持 HTML 结构合法 */
function buildTocHtml(headings: HeadingInfo[]): string {
  const head = '<nav class="bs-toc" aria-label="目录"><p class="bs-toc-title">目录</p>'
  if (headings.length === 0) {
    return `${head}<p class="bs-toc-empty">这份文档还没有标题</p></nav>`
  }

  let html = ''
  let open = 0
  let previous = 0

  for (const heading of headings) {
    if (open === 0) {
      html += '<ul>'
      open = 1
    } else if (heading.level > previous) {
      html += '<ul>'
      open += 1
    } else if (heading.level === previous) {
      html += '</li>'
    } else {
      html += '</li>'
      for (let i = 0; i < previous - heading.level && open > 1; i++) {
        html += '</ul></li>'
        open -= 1
      }
    }
    html += `<li class="bs-toc-lv${heading.level}"><a href="#${escapeAttr(heading.id)}">${escapeHtml(heading.text)}</a>`
    previous = heading.level
  }

  html += '</li>'
  html += '</ul>'.repeat(open)
  return `${head}${html}</nav>`
}

/* ------------------------------------------------------- ABC 五线谱 */

const MUSIC_LANGS = new Set(['abc', 'abcjs'])

marked.use({
  renderer: {
    /**
     * ```abc / ```abcjs → 交给 abcjs 排版的占位块。
     * 真正的 SVG 在主线程之外异步塞进去（见 lib/abc.ts）：
     * abcjs 需要 DOM，而 marked 的 renderer 必须是同步的。
     * 返回 false 让 marked 用它自己的代码块渲染器。
     */
    code(token: Tokens.Code): string | false {
      const info = (token.lang ?? '').trim().toLowerCase().split(/\s+/)[0]
      if (!MUSIC_LANGS.has(info)) return false
      return renderMusicBlock(token.text)
    }
  }
})

function renderMusicBlock(source: string): string {
  const body = source.replace(/\n+$/, '')
  return [
    '<figure class="bs-music">',
    '<div class="bs-music-score" role="img" aria-label="五线谱"></div>',
    '<p class="bs-music-status">正在排版五线谱…</p>',
    '<details class="bs-music-source"><summary>ABC 源码</summary>',
    `<pre><code>${escapeHtml(body)}</code></pre>`,
    '</details>',
    '</figure>'
  ].join('')
}

/* -------------------------------------------------------- 渲染配置 */

const ALLOWED_TAGS = [
  'a', 'b', 'blockquote', 'br', 'code', 'dd', 'del', 'details', 'div', 'dl', 'dt', 'em',
  'figcaption', 'figure', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'i', 'img', 'input',
  'kbd', 'li', 'mark', 'nav', 'ol', 'p', 'pre', 's', 'samp', 'span', 'strong', 'sub', 'summary',
  'sup', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'tr', 'u', 'ul'
]

const ALLOWED_ATTR = [
  'align', 'alt', 'checked', 'class', 'colspan', 'disabled', 'href', 'id', 'lang',
  'rel', 'rowspan', 'src', 'start', 'target', 'title', 'type', 'value'
]

/*
 * DOMPurify 默认只放行 http(s)/mailto/tel… 这类协议，`asset:` 会被整条属性删掉。
 * 应用自己注册的 `asset:`（统一图片库）与 `note:`（HTML 笔记）必须显式加进来，
 * 否则预览里的插图会静默消失。
 */
const ALLOWED_URI_REGEXP =
  /^(?:(?:(?:f|ht)tps?|mailto|tel|callto|sms|cid|xmpp|matrix|asset|note|blob|data|file):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i

/** Markdown 源码 → 安全 HTML */
export function renderMarkdown(source: string, headings?: HeadingInfo[]): string {
  tocContext = TOC_PRESENT.test(source) ? { source, headings: headings ?? null } : null
  try {
    const raw = marked.parse(source, { async: false, gfm: true, breaks: false })
    const html = typeof raw === 'string' ? raw : ''
    return resolveAssetSources(sanitizeHtml(html))
  } finally {
    tocContext = null
  }
}

/** 任意 HTML（外部 html 文件 / mammoth 输出）→ 安全 HTML */
export function sanitizeHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ALLOWED_URI_REGEXP,
    ALLOW_DATA_ATTR: false,
    FORBID_TAGS: ['style', 'script', 'iframe', 'object', 'embed', 'form', 'link', 'meta'],
    FORBID_ATTR: ['style', 'srcset', 'onerror', 'onload']
  })
}

/** 只保留内联标记：用于单行摘要、标题等 */
export function renderInline(source: string): string {
  const raw = marked.parseInline(source, { async: false, gfm: true })
  const html = typeof raw === 'string' ? raw : ''
  return resolveAssetSources(sanitizeHtml(html))
}

/**
 * 把 `asset:<文件名>` 换成真正能加载的地址。
 *
 * 原始写法 `url(asset:…)` / `src="asset:…"` 浏览器不认——`asset:` 不是标准协议，
 * 必须交给 @shared/noteUrl 的 imageSrc 翻译成 `asset://local/<文件名>`。
 * 这里统一在消毒之后做一次，既覆盖 marked 生成的 `![]()`，也覆盖笔记里手写的 <img>。
 * `(?!\/\/)` 保证已经翻译好的地址不会被二次翻译。
 */
function resolveAssetSources(html: string): string {
  return html.replace(/(\ssrc=")asset:(?!\/\/)([^"]*)(")/gi, (whole, prefix: string, ref: string, suffix: string) => {
    const resolved = imageSrc(`asset:${ref}`)
    return resolved ? `${prefix}${resolved}${suffix}` : whole
  })
}

/* ------------------------------------------------------------ 工具 */

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function escapeAttr(text: string): string {
  return escapeHtml(text).replace(/'/g, '&#39;')
}

/**
 * 在已渲染的 DOM 里按顺序给 h1~h6 补上 id，
 * 让大纲点击可以精确滚到预览中对应的标题。
 */
export function assignHeadingIds(root: HTMLElement, ids: string[]): void {
  const nodes = root.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6')
  nodes.forEach((node, index) => {
    const id = ids[index]
    if (id) node.id = id
  })
}

/** 滚动预览容器，让指定标题进入视野 */
export function scrollPreviewTo(root: HTMLElement | null, id: string): void {
  if (!root) return
  const target = root.querySelector<HTMLElement>(`#${CSS.escape(id)}`)
  if (!target) return
  const top = target.offsetTop - 24
  root.scrollTo({ top: Math.max(0, top), behavior: 'smooth' })
}

/** 目录里的 `#锚点` → 目标标题 id（交给调用方决定怎么滚） */
export function anchorIdFromHref(href: string | null | undefined): string | null {
  if (!href || !href.startsWith('#')) return null
  const id = href.slice(1)
  return id ? id : null
}
