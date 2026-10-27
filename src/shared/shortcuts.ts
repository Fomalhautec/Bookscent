/**
 * 快捷键注册表。
 *
 * 为什么要有这么一张表：快捷键散落在各个组件里时，"一共有哪些、在哪个界面能用"
 * 谁也说不清（用户提的正是这一点）。这里把它收成一份声明式清单：
 * 每一项都写清楚**适用范围**（global / epub / pdf / editor），设置页直接照着渲染，
 * 用户能改键、能恢复默认。
 *
 * 按键写法统一成 `Ctrl+Shift+K` 这种规范形式（`Mod` 等同于平台的主修饰键），
 * 比较之前一律先规范化 —— 否则 "ctrl+k" 与 "Control+K" 会被当成两个键。
 */

export type ShortcutScope = 'global' | 'epub' | 'pdf' | 'editor'

export interface ShortcutDef {
  /** 稳定 id，用户的改键按它存 */
  id: string
  label: string
  scope: ShortcutScope
  /** 默认按键；一个动作可以有多个等价键 */
  keys: string[]
  /** 固定不可改（组件约定：Esc 关浮层、方向键跟随滚动模式…），只展示 */
  fixed?: boolean
  /** 为什么固定 / 有什么讲究 */
  note?: string
}

export const SHORTCUT_SCOPES: { id: ShortcutScope; label: string; hint: string }[] = [
  { id: 'global', label: '全局', hint: '任何界面都生效（书架、阅读器、编辑器里都能按）' },
  { id: 'epub', label: 'EPUB 阅读器', hint: '只在读 EPUB 时生效' },
  { id: 'pdf', label: 'PDF 阅读器', hint: '只在读 PDF 时生效' },
  { id: 'editor', label: 'Markdown / 纯文本编辑器', hint: '只在编辑笔记时生效' }
]

export const SHORTCUTS: ShortcutDef[] = [
  /* ---------------------------------------------------------------- 全局 */
  { id: 'global.newNote', label: '新建笔记', scope: 'global', keys: ['Ctrl+N'] },
  { id: 'global.newText', label: '新建纯文本', scope: 'global', keys: ['Ctrl+Shift+N'] },
  { id: 'global.import', label: '导入文件（复制进藏书）', scope: 'global', keys: ['Ctrl+I'] },
  { id: 'global.tempOpen', label: '临时打开文件（不导入）', scope: 'global', keys: ['Ctrl+Shift+I'] },
  { id: 'global.settings', label: '打开设置', scope: 'global', keys: ['Ctrl+,'] },
  { id: 'global.detail', label: '查看当前这本书的详情', scope: 'global', keys: ['Ctrl+L'] },
  { id: 'global.rescan', label: '重新扫描书架', scope: 'global', keys: ['F5'] },
  {
    id: 'global.escape',
    label: '关闭浮层 / 取消当前操作',
    scope: 'global',
    keys: ['Escape'],
    fixed: true,
    note: '弹窗、菜单、编辑条都靠它退出，各处约定一致，所以固定'
  },

  /* ---------------------------------------------------------------- EPUB */
  { id: 'epub.nextScreen', label: '下一屏（按阅读顺序）', scope: 'epub', keys: ['PageDown', 'Space'] },
  { id: 'epub.prevScreen', label: '上一屏（按阅读顺序）', scope: 'epub', keys: ['PageUp'] },
  { id: 'epub.nextPage', label: '向右翻（按屏幕方向，竖排书也一致）', scope: 'epub', keys: ['ArrowRight'] },
  { id: 'epub.prevPage', label: '向左翻（按屏幕方向）', scope: 'epub', keys: ['ArrowLeft'] },
  { id: 'epub.bookmark', label: '把当前位置记为书签', scope: 'epub', keys: ['B'] },
  { id: 'epub.highlight', label: '把选中文字设为高亮标注', scope: 'epub', keys: ['H'] },
  { id: 'epub.underline', label: '把选中文字设为划线标注', scope: 'epub', keys: ['U'] },
  { id: 'epub.wavy', label: '把选中文字设为波浪线标注', scope: 'epub', keys: ['W'] },
  { id: 'epub.note', label: '把选中文字记为笔记', scope: 'epub', keys: ['N'] },
  { id: 'epub.translateSelection', label: '翻译选中的文字', scope: 'epub', keys: ['Ctrl+T'] },
  { id: 'epub.speakSelection', label: '从选中处开始朗读', scope: 'epub', keys: ['Ctrl+Shift+R'] },
  { id: 'epub.sidebar', label: '展开 / 收起目录与书签栏', scope: 'epub', keys: ['Ctrl+B'] },
  { id: 'epub.translate', label: '展开 / 收起翻译栏', scope: 'epub', keys: ['T'] },
  { id: 'epub.fontUp', label: '正文字号调大', scope: 'epub', keys: ['Ctrl+='] },
  { id: 'epub.fontDown', label: '正文字号调小', scope: 'epub', keys: ['Ctrl+-'] },

  /* ---------------------------------------------------------------- PDF */
  { id: 'pdf.nextPage', label: '下一页 / 下一屏', scope: 'pdf', keys: ['PageDown'] },
  { id: 'pdf.prevPage', label: '上一页 / 上一屏', scope: 'pdf', keys: ['PageUp'] },
  { id: 'pdf.search', label: '全文搜索', scope: 'pdf', keys: ['Ctrl+F'] },
  { id: 'pdf.undo', label: '撤销上一笔手写标注', scope: 'pdf', keys: ['Ctrl+Z'] },
  { id: 'pdf.zoomIn', label: '放大', scope: 'pdf', keys: ['+', '='] },
  { id: 'pdf.zoomOut', label: '缩小', scope: 'pdf', keys: ['-', '_'] },
  { id: 'pdf.bookmark', label: '添加书签', scope: 'pdf', keys: ['B'] },
  { id: 'pdf.highlight', label: '把选中文字设为高亮标注', scope: 'pdf', keys: ['H'] },
  { id: 'pdf.underline', label: '把选中文字设为划线标注', scope: 'pdf', keys: ['U'] },
  { id: 'pdf.wavy', label: '把选中文字设为波浪线标注', scope: 'pdf', keys: ['W'] },
  { id: 'pdf.note', label: '把选中文字记为笔记', scope: 'pdf', keys: ['N'] },
  { id: 'pdf.translateSelection', label: '翻译选中的文字', scope: 'pdf', keys: ['Ctrl+T'] },
  { id: 'pdf.translate', label: '展开 / 收起翻译栏', scope: 'pdf', keys: ['T'] },
  {
    id: 'pdf.arrows',
    label: '方向键翻页 / Home·End 跳首尾',
    scope: 'pdf',
    keys: ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'],
    fixed: true,
    note: '连续滚动模式下方向键是滚动而不是翻页，行为随滚动模式变，所以固定'
  },
  {
    id: 'pdf.escape',
    label: '取消当前绘制工具',
    scope: 'pdf',
    keys: ['Escape'],
    fixed: true,
    note: '与"关闭浮层"共用 Esc'
  },

  /* ---------------------------------------------------------------- 编辑器 */
  { id: 'editor.save', label: '保存', scope: 'editor', keys: ['Ctrl+S'] },
  { id: 'editor.cycleMode', label: '编辑 / 分栏 / 预览 轮转（Markdown）', scope: 'editor', keys: ['Ctrl+E'] }
]

const MODIFIER_ORDER = ['Ctrl', 'Alt', 'Shift', 'Meta'] as const
const MODIFIER_ALIAS: Record<string, string> = {
  ctrl: 'Ctrl',
  control: 'Ctrl',
  cmdorctrl: 'Ctrl',
  mod: 'Ctrl',
  alt: 'Alt',
  option: 'Alt',
  shift: 'Shift',
  meta: 'Meta',
  cmd: 'Meta',
  command: 'Meta',
  super: 'Meta'
}

/**
 * 规范按键名：`ctrl + shift + k` → `Ctrl+Shift+K`。
 *
 * 解析方式很讲究：**修饰键只从前缀取**，剩下的整段就是主键。
 * 以前用 `split('+')` 一把切开，于是 `'+'`（加号键）被切成两个空串、
 * `Ctrl++` 直接解析成 `Ctrl` —— 加号、减号这类键的绑定全是坏的，
 * 设置页里还会量出"默认就有冲突"。
 *
 * 另外**不再丢掉字母键的 Shift**：`event.key` 对字母是区分大小写的
 * （Shift+N 给 'N'、N 给 'n'），所以 `Ctrl+Shift+N` 与 `Ctrl+N` 本来就是两个键，
 * 以前把 Shift 抹掉才导致"新建笔记"和"新建纯文本"撞在一起。
 */
export function normalizeKey(spec: string): string {
  let rest = spec.trim()
  const mods: string[] = []
  for (;;) {
    const match = /^(ctrl|control|cmdorctrl|mod|alt|option|shift|meta|cmd|command|super)\s*\+\s*/i.exec(rest)
    if (!match) break
    const mod = MODIFIER_ALIAS[match[1].toLowerCase()]
    if (mod) mods.push(mod)
    rest = rest.slice(match[0].length)
  }
  const base = rest.trim()
  if (!base) return ''
  /* 单字母统一大写；其余原样（'+'、'-'、'='、'Space'、'ArrowRight'…） */
  const key = base.length === 1 && /[a-z]/i.test(base) ? base.toUpperCase() : base
  const ordered = MODIFIER_ORDER.filter((mod) => mods.includes(mod))
  return [...ordered, key].join('+')
}

/**
 * 键盘事件 → 规范按键名；返回 null 说明这个事件不该当快捷键（例如只按了 Shift）。
 *
 * 参数用结构化类型而不是 `KeyboardEvent`：这份文件同时被主进程与渲染层引用，
 * 主进程那边没有 DOM 的类型。渲染层传真实的 KeyboardEvent 进来，形状是兼容的。
 */
export function eventKeyName(event: {
  key: string
  ctrlKey: boolean
  altKey: boolean
  shiftKey: boolean
  metaKey: boolean
}): string | null {
  const key = event.key
  if (key === 'Shift' || key === 'Control' || key === 'Alt' || key === 'Meta') return null
  const parts: string[] = []
  if (event.ctrlKey) parts.push('Ctrl')
  if (event.altKey) parts.push('Alt')
  if (event.shiftKey) parts.push('Shift')
  if (event.metaKey) parts.push('Meta')
  /* 空格用 'Space' 表示，' ' 容易被误读 */
  const base = key === ' ' ? 'Space' : key.length === 1 ? key.toUpperCase() : key
  parts.push(base)
  return normalizeKey(parts.join('+'))
}

/** 展示用：把默认值/用户键渲染成人看的样子 */
export function formatKeys(keys: string[]): string {
  return keys.map((key) => key.replace('Ctrl', 'Ctrl').replace('Meta', 'Cmd')).join(' / ')
}

/**
 * 合并默认值与用户改键，得到"某个 id 当前生效的键"。
 * 用户把某个动作改成空数组 = 主动禁用这个快捷键。
 */
export function resolveShortcuts(overrides: Record<string, string[]> | undefined): Record<string, string[]> {
  const result: Record<string, string[]> = {}
  for (const def of SHORTCUTS) {
    if (def.fixed) {
      result[def.id] = def.keys.map(normalizeKey)
      continue
    }
    const custom = overrides?.[def.id]
    result[def.id] = Array.isArray(custom) ? custom.map(normalizeKey).filter(Boolean) : def.keys.map(normalizeKey)
  }
  return result
}

/** 找出与别人撞车的项（同一范围里同一个键绑了两个动作） */
export function findConflicts(
  overrides: Record<string, string[]> | undefined
): { scope: ShortcutScope; key: string; ids: string[] }[] {
  const resolved = resolveShortcuts(overrides)
  const byScopeKey = new Map<string, { scope: ShortcutScope; key: string; ids: string[] }>()
  for (const def of SHORTCUTS) {
    for (const key of resolved[def.id] ?? []) {
      const id = `${def.scope}|${key}`
      const hit = byScopeKey.get(id)
      if (hit) hit.ids.push(def.id)
      else byScopeKey.set(id, { scope: def.scope, key, ids: [def.id] })
    }
  }
  return [...byScopeKey.values()].filter((entry) => entry.ids.length > 1)
}
