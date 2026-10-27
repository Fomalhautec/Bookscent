import type { BookStyle, SpinePreset, ThemePreset, ThemeTokens, ThemeTokenKey } from './types'

/* ------------------------------------------------------------ 令牌与默认值 */

export const TOKEN_KEYS: ThemeTokenKey[] = [
  'bg-app',
  'bg-surface',
  'bg-elevated',
  'bg-sunken',
  'border',
  'border-strong',
  'text-primary',
  'text-secondary',
  'text-muted',
  'accent',
  'accent-soft',
  'accent-contrast',
  'shadow',
  'shelf-back',
  'shelf-cavity',
  'shelf-plank',
  'shelf-plank-top',
  'shelf-plank-edge',
  'shelf-wood-1',
  'shelf-wood-2',
  'shelf-wood-3',
  'selection'
]

/** 界面令牌（应用主题负责） */
export const APP_TOKEN_KEYS: ThemeTokenKey[] = [
  'bg-app',
  'bg-surface',
  'bg-elevated',
  'bg-sunken',
  'border',
  'border-strong',
  'text-primary',
  'text-secondary',
  'text-muted',
  'accent',
  'accent-soft',
  'accent-contrast',
  'shadow',
  'selection'
]

/** 书架令牌（书架主题负责） */
export const SHELF_TOKEN_KEYS: ThemeTokenKey[] = [
  'shelf-back',
  'shelf-cavity',
  'shelf-plank',
  'shelf-plank-top',
  'shelf-plank-edge',
  'shelf-wood-1',
  'shelf-wood-2',
  'shelf-wood-3'
]

export const DEFAULT_TOKENS: ThemeTokens = {
  'bg-app': '#f2ece1',
  'bg-surface': '#fffdf8',
  'bg-elevated': '#ffffff',
  'bg-sunken': '#e7dfd0',
  border: '#dbd0bb',
  'border-strong': '#b8a686',
  'text-primary': '#2c2418',
  'text-secondary': '#5b5040',
  'text-muted': '#8b7f6b',
  accent: '#9c6b3f',
  'accent-soft': 'rgba(156, 107, 63, 0.14)',
  'accent-contrast': '#fffaf2',
  shadow: 'rgba(60, 45, 25, 0.18)',
  'shelf-back': '#6b4a2b',
  'shelf-cavity': 'rgba(24, 13, 4, 0.38)',
  'shelf-plank': '#a9743f',
  'shelf-plank-top': '#c48f55',
  'shelf-plank-edge': '#7a5026',
  'shelf-wood-1': '#8a5a30',
  'shelf-wood-2': '#a9743f',
  'shelf-wood-3': '#68421f',
  selection: 'rgba(156, 107, 63, 0.28)'
}

export function resolveTokens(preset: Pick<ThemePreset, 'tokens'> | undefined | null): ThemeTokens {
  return { ...DEFAULT_TOKENS, ...(preset?.tokens ?? {}) }
}

export function tokensToCssVars(tokens: Partial<ThemeTokens>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const key of TOKEN_KEYS) {
    const value = tokens[key]
    if (value) out[`--${key}`] = value
  }
  return out
}

/** 把 #rrggbb / rgba() 转成带透明度的颜色 */
export function withAlpha(color: string, alpha: number): string {
  const hex = color.trim()
  if (hex.startsWith('#')) {
    let h = hex.slice(1)
    if (h.length === 3) h = h.split('').map((c) => c + c).join('')
    const n = Number.parseInt(h.slice(0, 6), 16)
    if (Number.isNaN(n)) return color
    const r = (n >> 16) & 255
    const g = (n >> 8) & 255
    const b = n & 255
    return `rgba(${r}, ${g}, ${b}, ${alpha})`
  }
  const m = hex.match(/rgba?\(([^)]+)\)/)
  if (m) {
    const parts = m[1].split(',').map((p) => p.trim())
    return `rgba(${parts[0]}, ${parts[1]}, ${parts[2]}, ${alpha})`
  }
  return color
}

/** 按比例混合两个十六进制颜色，t=0 → a，t=1 → b */
export function mix(a: string, b: string, t: number): string {
  const pa = hexToRgb(a)
  const pb = hexToRgb(b)
  if (!pa || !pb) return a
  const c = (x: number, y: number): number => Math.round(x + (y - x) * t)
  return rgbToHex(c(pa[0], pb[0]), c(pa[1], pb[1]), c(pa[2], pb[2]))
}

export function hexToRgb(hex: string): [number, number, number] | null {
  const h = hex.trim()
  if (!h.startsWith('#')) return null
  let s = h.slice(1)
  if (s.length === 3) s = s.split('').map((c) => c + c).join('')
  if (s.length < 6) return null
  const n = Number.parseInt(s.slice(0, 6), 16)
  if (Number.isNaN(n)) return null
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

export function rgbToHex(r: number, g: number, b: number): string {
  const p = (v: number): string => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')
  return `#${p(r)}${p(g)}${p(b)}`
}

/** 相对亮度，用于自动决定文字颜色 */
export function luminance(color: string): number {
  const rgb = hexToRgb(color)
  if (!rgb) return 0.5
  const [r, g, b] = rgb.map((v) => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

export function readableOn(background: string, light = '#fdf8ee', dark = '#221a10'): string {
  return luminance(background) > 0.45 ? dark : light
}

/* --------------------------------------------------------------- 主题预设 */

export const THEME_PRESETS: ThemePreset[] = [
  {
    id: 'parchment',
    name: '羊皮纸',
    description: '暖米底色与琥珀描边，像午后摊开的旧书',
    kind: 'both',
    dark: false,
    texture: 'paper',
    swatch: ['#f2ece1', '#9c6b3f', '#6b4a2b'],
    tokens: {
      'bg-app': '#f2ece1',
      'bg-surface': '#fffdf8',
      'bg-elevated': '#ffffff',
      'bg-sunken': '#e7dfd0',
      border: '#dbd0bb',
      'border-strong': '#b8a686',
      'text-primary': '#2c2418',
      'text-secondary': '#5b5040',
      'text-muted': '#8b7f6b',
      accent: '#9c6b3f',
      'accent-soft': 'rgba(156, 107, 63, 0.14)',
      'accent-contrast': '#fffaf2',
      shadow: 'rgba(60, 45, 25, 0.18)',
      selection: 'rgba(156, 107, 63, 0.28)',
      'shelf-back': '#6b4a2b',
      'shelf-cavity': 'rgba(30, 17, 5, 0.4)',
      'shelf-plank': '#a9743f',
      'shelf-plank-top': '#c48f55',
      'shelf-plank-edge': '#7a5026',
      'shelf-wood-1': '#8a5a30',
      'shelf-wood-2': '#a9743f',
      'shelf-wood-3': '#68421f'
    }
  },
  {
    id: 'walnut',
    name: '胡桃木书房',
    description: '深胡桃木、暖黄灯下的一室书墙',
    kind: 'both',
    dark: true,
    texture: 'wood',
    swatch: ['#241a12', '#c89a5c', '#6b4423'],
    tokens: {
      'bg-app': '#241a12',
      'bg-surface': '#2e2217',
      'bg-elevated': '#3a2b1d',
      'bg-sunken': '#1b130c',
      border: '#4a3522',
      'border-strong': '#6b5236',
      'text-primary': '#f0e2cc',
      'text-secondary': '#c9b394',
      'text-muted': '#95805f',
      accent: '#c89a5c',
      'accent-soft': 'rgba(200, 154, 92, 0.18)',
      'accent-contrast': '#2a1c0e',
      shadow: 'rgba(0, 0, 0, 0.5)',
      selection: 'rgba(200, 154, 92, 0.3)',
      'shelf-back': '#3a2617',
      'shelf-cavity': 'rgba(0, 0, 0, 0.55)',
      'shelf-plank': '#7a4f2a',
      'shelf-plank-top': '#96643a',
      'shelf-plank-edge': '#43290f',
      'shelf-wood-1': '#5c3a1e',
      'shelf-wood-2': '#7a4f2a',
      'shelf-wood-3': '#3a2617'
    }
  },
  {
    id: 'ink',
    name: '宣纸墨',
    description: '素白纸面、松烟墨字与一点朱砂',
    kind: 'both',
    dark: false,
    texture: 'paper',
    swatch: ['#f7f6f2', '#b03a2e', '#33312c'],
    tokens: {
      'bg-app': '#f7f6f2',
      'bg-surface': '#ffffff',
      'bg-elevated': '#ffffff',
      'bg-sunken': '#ecebe5',
      border: '#dedcd3',
      'border-strong': '#b6b3a6',
      'text-primary': '#26241f',
      'text-secondary': '#55524a',
      'text-muted': '#8b887e',
      accent: '#b03a2e',
      'accent-soft': 'rgba(176, 58, 46, 0.12)',
      'accent-contrast': '#fff8f6',
      shadow: 'rgba(40, 36, 28, 0.16)',
      selection: 'rgba(176, 58, 46, 0.22)',
      'shelf-back': '#4a463d',
      'shelf-cavity': 'rgba(30, 28, 22, 0.34)',
      'shelf-plank': '#8f8878',
      'shelf-plank-top': '#a9a294',
      'shelf-plank-edge': '#6b6558',
      'shelf-wood-1': '#787062',
      'shelf-wood-2': '#8f8878',
      'shelf-wood-3': '#5c564b'
    }
  },
  {
    id: 'midnight',
    name: '墨夜',
    description: '深靛夜空与铜色书脊，适合夜读',
    kind: 'both',
    dark: true,
    texture: 'flat',
    swatch: ['#12151f', '#c9a227', '#2a3350'],
    tokens: {
      'bg-app': '#12151f',
      'bg-surface': '#1a1f2e',
      'bg-elevated': '#232a3d',
      'bg-sunken': '#0c0f17',
      border: '#2f3750',
      'border-strong': '#475073',
      'text-primary': '#e6e9f2',
      'text-secondary': '#a8b0c8',
      'text-muted': '#767e96',
      accent: '#c9a227',
      'accent-soft': 'rgba(201, 162, 39, 0.16)',
      'accent-contrast': '#161a25',
      shadow: 'rgba(0, 0, 0, 0.55)',
      selection: 'rgba(201, 162, 39, 0.28)',
      'shelf-back': '#1b2133',
      'shelf-cavity': 'rgba(0, 0, 0, 0.6)',
      'shelf-plank': '#3a4463',
      'shelf-plank-top': '#4c587c',
      'shelf-plank-edge': '#232a40',
      'shelf-wood-1': '#2c3450',
      'shelf-wood-2': '#3a4463',
      'shelf-wood-3': '#1b2133'
    }
  },
  {
    id: 'celadon',
    name: '青瓷',
    description: '雨过天青的瓷釉色，清冷静气',
    kind: 'both',
    dark: false,
    texture: 'linen',
    swatch: ['#eef2ee', '#5c8a7a', '#3f5f55'],
    tokens: {
      'bg-app': '#eef2ee',
      'bg-surface': '#fafcf9',
      'bg-elevated': '#ffffff',
      'bg-sunken': '#dfe7e1',
      border: '#cfdad3',
      'border-strong': '#a7b8ae',
      'text-primary': '#1f2b26',
      'text-secondary': '#4a5b53',
      'text-muted': '#7c8c84',
      accent: '#3f7a66',
      'accent-soft': 'rgba(63, 122, 102, 0.14)',
      'accent-contrast': '#f6fffb',
      shadow: 'rgba(24, 46, 38, 0.16)',
      selection: 'rgba(63, 122, 102, 0.24)',
      'shelf-back': '#3f5f55',
      'shelf-cavity': 'rgba(18, 38, 32, 0.34)',
      'shelf-plank': '#7d9c8e',
      'shelf-plank-top': '#96b2a5',
      'shelf-plank-edge': '#5b7a6d',
      'shelf-wood-1': '#6b8a7c',
      'shelf-wood-2': '#7d9c8e',
      'shelf-wood-3': '#4e6a5e'
    }
  },
  {
    id: 'burgundy',
    name: '酒红皮革',
    description: '老图书馆的摩洛哥皮革与烫金',
    kind: 'both',
    dark: true,
    texture: 'wood',
    swatch: ['#221314', '#d9b46a', '#5a2126'],
    tokens: {
      'bg-app': '#221314',
      'bg-surface': '#2d1a1c',
      'bg-elevated': '#3a2225',
      'bg-sunken': '#180d0e',
      border: '#4b2c2f',
      'border-strong': '#6d4145',
      'text-primary': '#f4e6d8',
      'text-secondary': '#cbafa2',
      'text-muted': '#9a7c72',
      accent: '#d9b46a',
      'accent-soft': 'rgba(217, 180, 106, 0.16)',
      'accent-contrast': '#2a1416',
      shadow: 'rgba(0, 0, 0, 0.5)',
      selection: 'rgba(217, 180, 106, 0.28)',
      'shelf-back': '#3a1f22',
      'shelf-cavity': 'rgba(0, 0, 0, 0.55)',
      'shelf-plank': '#7a3b3f',
      'shelf-plank-top': '#94494d',
      'shelf-plank-edge': '#4a2124',
      'shelf-wood-1': '#5e2b2f',
      'shelf-wood-2': '#7a3b3f',
      'shelf-wood-3': '#3a1f22'
    }
  },
  {
    id: 'birch',
    name: '白桦',
    description: '北欧浅木与棉麻，明亮通透',
    kind: 'both',
    dark: false,
    texture: 'wood',
    swatch: ['#f6f3ee', '#c08a52', '#dcc9ae'],
    tokens: {
      'bg-app': '#f6f3ee',
      'bg-surface': '#ffffff',
      'bg-elevated': '#ffffff',
      'bg-sunken': '#ebe5dc',
      border: '#e0d8cb',
      'border-strong': '#c2b39c',
      'text-primary': '#2f2a23',
      'text-secondary': '#5f584d',
      'text-muted': '#8f887b',
      accent: '#b07840',
      'accent-soft': 'rgba(176, 120, 64, 0.13)',
      'accent-contrast': '#fffaf3',
      shadow: 'rgba(70, 55, 35, 0.14)',
      selection: 'rgba(176, 120, 64, 0.24)',
      'shelf-back': '#e3d6c2',
      'shelf-cavity': 'rgba(120, 95, 60, 0.16)',
      'shelf-plank': '#dcbf95',
      'shelf-plank-top': '#efdab9',
      'shelf-plank-edge': '#b8946a',
      'shelf-wood-1': '#c9a877',
      'shelf-wood-2': '#dcbf95',
      'shelf-wood-3': '#a9895f'
    }
  },
  {
    id: 'ebony',
    name: '黑檀',
    description: '近黑的深木与哑金细节，沉静有力',
    kind: 'both',
    dark: true,
    texture: 'wood',
    swatch: ['#161513', '#b99a5e', '#3a352c'],
    tokens: {
      'bg-app': '#161513',
      'bg-surface': '#1f1d1a',
      'bg-elevated': '#2a2723',
      'bg-sunken': '#0e0d0c',
      border: '#332f29',
      'border-strong': '#4d463c',
      'text-primary': '#ece7de',
      'text-secondary': '#b6ae9f',
      'text-muted': '#837b6d',
      accent: '#b99a5e',
      'accent-soft': 'rgba(185, 154, 94, 0.16)',
      'accent-contrast': '#1a1815',
      shadow: 'rgba(0, 0, 0, 0.6)',
      selection: 'rgba(185, 154, 94, 0.26)',
      'shelf-back': '#221f1b',
      'shelf-cavity': 'rgba(0, 0, 0, 0.62)',
      'shelf-plank': '#3f382d',
      'shelf-plank-top': '#524938',
      'shelf-plank-edge': '#241f18',
      'shelf-wood-1': '#302a22',
      'shelf-wood-2': '#3f382d',
      'shelf-wood-3': '#1e1a15'
    }
  },
  {
    id: 'bamboo',
    name: '竹简',
    description: '竹青与米黄麻绳，清简的书斋气',
    kind: 'both',
    dark: false,
    texture: 'linen',
    swatch: ['#f3f0e2', '#6f8f4a', '#cbb87c'],
    tokens: {
      'bg-app': '#f3f0e2',
      'bg-surface': '#fbfaef',
      'bg-elevated': '#ffffff',
      'bg-sunken': '#e6e1cc',
      border: '#d9d2b5',
      'border-strong': '#b5ab86',
      'text-primary': '#2a2a1c',
      'text-secondary': '#55543c',
      'text-muted': '#86856a',
      accent: '#5f7f3c',
      'accent-soft': 'rgba(95, 127, 60, 0.14)',
      'accent-contrast': '#f8fcef',
      shadow: 'rgba(50, 50, 20, 0.16)',
      selection: 'rgba(95, 127, 60, 0.24)',
      'shelf-back': '#5c6b3a',
      'shelf-cavity': 'rgba(35, 42, 18, 0.32)',
      'shelf-plank': '#b9a765',
      'shelf-plank-top': '#cdbb7c',
      'shelf-plank-edge': '#8e7f45',
      'shelf-wood-1': '#a4954f',
      'shelf-wood-2': '#b9a765',
      'shelf-wood-3': '#7d7139'
    }
  },
  {
    id: 'stone',
    name: '石室',
    description: '冷灰石壁配铁灰书脊，安静克制',
    kind: 'both',
    dark: true,
    texture: 'stone',
    swatch: ['#22252a', '#8fa8c8', '#3b4048'],
    tokens: {
      'bg-app': '#22252a',
      'bg-surface': '#2b2f36',
      'bg-elevated': '#363b43',
      'bg-sunken': '#181b1f',
      border: '#3d434c',
      'border-strong': '#565e6a',
      'text-primary': '#e8ebef',
      'text-secondary': '#b0b7c1',
      'text-muted': '#7e858f',
      accent: '#8fa8c8',
      'accent-soft': 'rgba(143, 168, 200, 0.16)',
      'accent-contrast': '#1c2026',
      shadow: 'rgba(0, 0, 0, 0.5)',
      selection: 'rgba(143, 168, 200, 0.26)',
      'shelf-back': '#2f343b',
      'shelf-cavity': 'rgba(0, 0, 0, 0.5)',
      'shelf-plank': '#4e555f',
      'shelf-plank-top': '#616a75',
      'shelf-plank-edge': '#333941',
      'shelf-wood-1': '#414851',
      'shelf-wood-2': '#4e555f',
      'shelf-wood-3': '#2a2f35'
    }
  },
  {
    /**
     * 现代风：没有木纹、没有弧面高光，平板材质 + 中性灰。
     * 默认主题一律不用它 —— 木色书架配现代平板书脊会显得两张皮，
     * 想要这种干净观感的用户在「外观 / 书籍外观」里主动选即可。
     */
    id: 'studio',
    name: '现代书房',
    description: '无木纹的平板书架与中性灰，干净利落',
    kind: 'both',
    dark: false,
    texture: 'flat',
    swatch: ['#f4f5f7', '#4a5a72', '#c8ccd2'],
    tokens: {
      'bg-app': '#f4f5f7',
      'bg-surface': '#ffffff',
      'bg-elevated': '#ffffff',
      'bg-sunken': '#eceef1',
      border: '#e0e3e8',
      'border-strong': '#c3c8d0',
      'text-primary': '#1f2328',
      'text-secondary': '#4d545e',
      'text-muted': '#868d98',
      accent: '#4a5a72',
      'accent-soft': 'rgba(74, 90, 114, 0.12)',
      'accent-contrast': '#ffffff',
      shadow: 'rgba(23, 29, 38, 0.14)',
      selection: 'rgba(74, 90, 114, 0.2)',
      'shelf-back': '#e6e8ec',
      'shelf-cavity': 'rgba(31, 38, 48, 0.14)',
      'shelf-plank': '#d3d7dd',
      'shelf-plank-top': '#e8eaee',
      'shelf-plank-edge': '#b3b9c2',
      'shelf-wood-1': '#dcdfe4',
      'shelf-wood-2': '#e9ebef',
      'shelf-wood-3': '#c9ced6'
    }
  }
]

export function getPreset(id: string, custom: { id: string; name: string; base: string; tokens: Partial<ThemeTokens> }[] = []): ThemePreset {
  const preset = THEME_PRESETS.find((p) => p.id === id)
  if (preset) return preset
  const mine = custom.find((c) => c.id === id)
  if (mine) {
    const base = THEME_PRESETS.find((p) => p.id === mine.base) ?? THEME_PRESETS[0]
    return {
      ...base,
      id: mine.id,
      name: mine.name,
      description: '自定义主题',
      tokens: { ...base.tokens, ...mine.tokens },
      swatch: [base.swatch[0], base.swatch[1], base.swatch[2]]
    }
  }
  return THEME_PRESETS[0]
}

/* --------------------------------------------------------- 默认书籍样式 */

export const DEFAULT_BOOK_STYLE: BookStyle = {
  spinePreset: 'cloth',
  spineColor: '#8a4b3a',
  spineColor2: '#6d3a2c',
  spineTextColor: '#f5e6c8',
  foilColor: '#d9b46a',
  spineImage: null,
  coverPreset: 'classic',
  coverColor: '#8a4b3a',
  coverColor2: '#5d2f24',
  coverTextColor: '#f5e6c8',
  coverImage: null,
  thicknessScale: 1,
  spineWidthOverride: null,
  ornament: 'bands',
  fontFamily: '"Noto Serif SC", "Source Han Serif SC", "Songti SC", SimSun, serif',
  spineTextDirection: 'vertical',
  showFormatIcon: true,
  tilt: 0
}

export interface BookStylePreset {
  id: string
  name: string
  description: string
  style: BookStyle
}

/**
 * 笔记的默认长相：一本朴素的便笺。
 *
 * 不烫金、不竹节，颜色取纸与墨（而不是皮革与金），封面用极简留白。
 * 厚度仍然按页数算，所以一摞笔记摆在书架上，一眼就能和"书"分开 ——
 * 这正是用户要的"书籍与笔记默认样式分开"。
 */
export const DEFAULT_NOTE_STYLE: BookStyle = {
  ...DEFAULT_BOOK_STYLE,
  spinePreset: 'paper',
  spineColor: '#d8ccb2',
  spineColor2: '#c2b493',
  spineTextColor: '#3b3327',
  foilColor: '#8d7c5c',
  ornament: 'none',
  coverPreset: 'minimal',
  coverColor: '#eee5d0',
  coverColor2: '#d5c9ae',
  coverTextColor: '#3b3327',
  showFormatIcon: true,
  tilt: 0
}

export const BOOK_STYLE_PRESETS: BookStylePreset[] = [
  {
    id: 'classic-leather',
    name: '古典皮革',
    description: '摩洛哥皮革 + 烫金竹节',
    style: {
      ...DEFAULT_BOOK_STYLE,
      spinePreset: 'leather',
      spineColor: '#6b2f26',
      spineColor2: '#4a1d17',
      spineTextColor: '#f3e0b8',
      foilColor: '#d6b26a',
      coverPreset: 'classic',
      coverColor: '#6b2f26',
      coverColor2: '#3f1812',
      ornament: 'ribs'
    }
  },
  {
    id: 'cloth-hardcover',
    name: '布纹精装',
    description: '亚麻布面 + 纸质标签',
    style: {
      ...DEFAULT_BOOK_STYLE,
      spinePreset: 'cloth',
      spineColor: '#3f5d54',
      spineColor2: '#2c443d',
      spineTextColor: '#f0e6cf',
      foilColor: '#c9b184',
      coverPreset: 'vintage',
      coverColor: '#3f5d54',
      coverColor2: '#26382f',
      ornament: 'label'
    }
  },
  {
    id: 'modern-flat',
    name: '现代扁平',
    description: '纯色色块 + 无衬线字，干净利落',
    style: {
      ...DEFAULT_BOOK_STYLE,
      spinePreset: 'modern',
      spineColor: '#2f3b52',
      spineColor2: '#22293a',
      spineTextColor: '#eef1f7',
      foilColor: '#7f93b8',
      coverPreset: 'minimal',
      coverColor: '#2f3b52',
      coverColor2: '#1d2434',
      ornament: 'none',
      fontFamily: '"Segoe UI", "Microsoft YaHei", system-ui, sans-serif',
      tilt: 0
    }
  },
  {
    id: 'flat-modern',
    name: '现代平板',
    description: '完全平面的书脊，无弧面高光与纹理，配现代书房最搭',
    style: {
      ...DEFAULT_BOOK_STYLE,
      spinePreset: 'flat',
      spineColor: '#3d4757',
      spineColor2: '#333c4a',
      spineTextColor: '#f2f4f8',
      foilColor: '#8fa3c4',
      coverPreset: 'plain',
      coverColor: '#3d4757',
      coverColor2: '#2b3340',
      coverTextColor: '#f2f4f8',
      ornament: 'none',
      showFormatIcon: true,
      fontFamily: '"Segoe UI", "Microsoft YaHei", system-ui, sans-serif',
      tilt: 0
    }
  },
  {
    id: 'gilded-ribs',
    name: '竹节烫金',
    description: '深色书脊 + 多道烫金横线',
    style: {
      ...DEFAULT_BOOK_STYLE,
      spinePreset: 'gilded',
      spineColor: '#233042',
      spineColor2: '#16202d',
      spineTextColor: '#e8d9a8',
      foilColor: '#cfa94f',
      coverPreset: 'classic',
      coverColor: '#233042',
      coverColor2: '#131b25',
      ornament: 'ribs'
    }
  },
  {
    id: 'paperback',
    name: '平装纸书',
    description: '薄纸书脊，轻盈日常',
    style: {
      ...DEFAULT_BOOK_STYLE,
      spinePreset: 'paper',
      spineColor: '#e7dcc4',
      spineColor2: '#d2c3a4',
      spineTextColor: '#4a3b25',
      foilColor: '#a08a5f',
      coverPreset: 'typewriter',
      coverColor: '#efe6d3',
      coverColor2: '#d8cbb0',
      coverTextColor: '#3b3121',
      ornament: 'none',
      thicknessScale: 0.75
    }
  },
  {
    id: 'exlibris',
    name: '藏书票',
    description: '米色书脊 + 方形书签框',
    style: {
      ...DEFAULT_BOOK_STYLE,
      spinePreset: 'photo',
      spineColor: '#c2a878',
      spineColor2: '#a98d5c',
      spineTextColor: '#33291a',
      foilColor: '#7d6234',
      coverPreset: 'vintage',
      coverColor: '#d9c49a',
      coverColor2: '#b89e6f',
      coverTextColor: '#3a2f1c',
      ornament: 'label'
    }
  }
]

/* ----------------------------------------------------------- 随机配色池 */

/** 为没有显式指定颜色的书分配一个"书脊色"，由书名哈希决定，保证稳定 */
export const SPINE_PALETTE: string[] = [
  '#8a4b3a', // 赭红
  '#2f4f4a', // 松绿
  '#3b4a6b', // 藏青
  '#6b4a2b', // 胡桃
  '#5c3a5e', // 紫檀
  '#7a5230', // 驼
  '#455a3e', // 苔绿
  '#7d3f3f', // 砖红
  '#2e4756', // 黛蓝
  '#6d5a2f', // 橄榄金
  '#4a3f5c', // 夜紫
  '#38524a', // 青铜
  '#8a6a3a', // 琥珀
  '#5a3f4a', // 梅
  '#33484f', // 岩青
  '#6b3f2f' // 檀
]

export function hashString(input: string): number {
  let h = 2166136261
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

export function paletteColorFor(seed: string): string {
  return SPINE_PALETTE[hashString(seed) % SPINE_PALETTE.length]
}

/** 预设 → 该预设下推荐的一小组书脊色 */
export const SPINE_PRESET_COLORS: Record<SpinePreset, string[]> = {
  leather: ['#6b2f26', '#3f5240', '#2f3b52', '#4a3520', '#4a2f4a'],
  cloth: ['#8a4b3a', '#2f4f4a', '#3b4a6b', '#6b4a2b', '#5c3a5e', '#455a3e'],
  paper: ['#e7dcc4', '#e3d7d0', '#d8e0d6', '#e0dbe8', '#efe6d3'],
  modern: ['#2f3b52', '#39434c', '#4a3f4a', '#2f4a44', '#533b3b'],
  flat: ['#3d4757', '#40474d', '#4a4048', '#3a4a45', '#4d3f3f', '#2f3a44'],
  gilded: ['#233042', '#2b2338', '#1f3328', '#3a2a20', '#2a2a2a'],
  photo: ['#c2a878', '#a98d5c', '#b9a98c', '#8f9d8a']
}

/**
 * 笔记专用的样式预设。
 *
 * 书脊只有二三十像素宽，笔记与书摆在一起时能区分开的其实只有"颜色 + 装饰"，
 * 所以这几套不追求装帧感，而是照着常见纸品的观感做：
 * 便笺、方格纸、索引卡、牛皮纸、手账。
 * 它们只作用于 `kind === 'note'` 的书（见 pickStyleForBook）。
 */
export const NOTE_STYLE_PRESETS: BookStylePreset[] = [
  {
    id: 'note-plain',
    name: '便笺',
    description: '暖白纸色，什么都没有',
    style: { ...DEFAULT_NOTE_STYLE }
  },
  {
    id: 'note-grid',
    name: '方格纸',
    description: '偏冷的浅灰蓝，像方格本',
    style: {
      ...DEFAULT_NOTE_STYLE,
      spineColor: '#c9d2d8',
      spineColor2: '#b0bcc4',
      spineTextColor: '#2f3a42',
      foilColor: '#6d818d',
      coverColor: '#eef2f4',
      coverColor2: '#d3dce1',
      coverTextColor: '#2f3a42'
    }
  },
  {
    id: 'note-index',
    name: '索引卡',
    description: '白卡纸配一道红线',
    style: {
      ...DEFAULT_NOTE_STYLE,
      spineColor: '#f0ece2',
      spineColor2: '#ded7c6',
      spineTextColor: '#3a332a',
      foilColor: '#b4483c',
      ornament: 'bands',
      coverColor: '#fbf9f3',
      coverColor2: '#e6e0d1',
      coverTextColor: '#3a332a'
    }
  },
  {
    id: 'note-kraft',
    name: '牛皮纸',
    description: '粗粝的黄褐色，像旧信封',
    style: {
      ...DEFAULT_NOTE_STYLE,
      spinePreset: 'leather',
      spineColor: '#b08a5c',
      spineColor2: '#93714a',
      spineTextColor: '#fbf4e6',
      foilColor: '#6f5334',
      coverColor: '#c69c6a',
      coverColor2: '#9c7648',
      coverTextColor: '#fdf7ea'
    }
  },
  {
    id: 'note-journal',
    name: '手账',
    description: '布面深绿，带一条书签带',
    style: {
      ...DEFAULT_NOTE_STYLE,
      spinePreset: 'cloth',
      spineColor: '#4a6154',
      spineColor2: '#3b4f44',
      spineTextColor: '#eef3ee',
      foilColor: '#c9b27a',
      ornament: 'label',
      coverColor: '#546b5d',
      coverColor2: '#3c4f45',
      coverTextColor: '#f2f6f1'
    }
  }
]