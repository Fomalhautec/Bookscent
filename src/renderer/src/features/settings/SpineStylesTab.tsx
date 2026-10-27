import { useMemo, useState, type ReactNode } from 'react'
import { BOOK_STYLE_PRESETS, DEFAULT_NOTE_STYLE } from '@shared/themes'
import type { DeepPartial } from '@shared/ipc'
import { KIND_LABEL } from '@shared/types'
import type { AppSettings, BookKind, BookStyle, SpineStyleEntry, SpineStyleMode } from '@shared/types'
import { Button, IconButton, Modal, SectionTitle, Segmented, Switch, TextInput } from '@/components/common/Controls'
import { IconBookStack, IconCheck, IconEdit, IconLayers, IconPlus, IconStarFilled, IconTrash } from '@/components/icons/Icons'
import { dialogApi, settingsApi } from '@/lib/api'
import { booksOfKind, spineStyleModeFor, spineStyleUsage, spineStylesFor, spineWidthFor } from '@/lib/theme'
import { useLibrary } from '@/store/useLibrary'
import { useSettings } from '@/store/useSettings'
import { useUi } from '@/store/useUi'
import { BookStyleTab } from './BookStyleTab'
import {
  COVER_PRESET_LABELS,
  ORNAMENT_LABELS,
  SPINE_PRESET_LABELS,
  SPINE_STYLE_MODE_HINTS,
  SPINE_STYLE_MODE_HINTS_NOTE,
  SPINE_STYLE_MODE_LABELS,
  SPINE_STYLE_MODES
} from './labels'
import { SpineView } from './previews'
import { NamePrompt } from './NamePrompt'
import { measureImageAspect } from '@/lib/image'
import {
  BookColorFields,
  CoverPresetPicker,
  OrnamentPicker,
  SpineImageField,
  SpinePresetPicker,
  StyleImageField,
  ThicknessFields
} from './StyleFields'

/** 卡片缩略图的假页数：取一个中等厚度的值，让所有卡片宽度可比 */
const CARD_PAGES = 260

/* ------------------------------------------------------------ 分区外壳 */

/**
 * 顶层分区卡。
 *
 * 这一页有"分配方式 / 基准样式 / 样式列表"三层完全不同的作用域，
 * 所以每个分区都包一张自己的卡片，并用编号 + 一句作用域说明把边界讲清楚。
 */
function SetSection({
  step,
  title,
  scope,
  hint,
  action,
  id,
  className,
  children
}: {
  step: number
  title: string
  /** 一句话说清"改这里会影响什么" */
  scope: string
  hint?: string
  action?: ReactNode
  id?: string
  className?: string
  children: ReactNode
}): ReactNode {
  return (
    <section id={id} className={['set-block', 'set-section', className].filter(Boolean).join(' ')}>
      <SectionTitle action={action} hint={scope}>
        <span className="set-section-step" aria-hidden>
          {step}
        </span>
        {title}
      </SectionTitle>
      {hint ? <p className="set-section-note">{hint}</p> : null}
      <div className="set-section-body">{children}</div>
    </section>
  )
}

/* ---------------------------------------------------- 新增样式：起点画廊 */

interface StyleSeed {
  key: string
  name: string
  /** 卡片上的短标签：内置 / 我的预设 / 基准 */
  tag: string
  desc: string
  style: BookStyle
}

/** 按起点推一个还不错的默认样式名，用户仍然可以改 */
const SEED_STUB_NAMES: Record<string, string> = {
  'classic-leather': '皮革',
  'cloth-hardcover': '布纹',
  'modern-flat': '扁平',
  'paper-back': '纸装',
  'gilded-ribs': '烫金竹节',
  'photo-spine': '贴图'
}

function stubNameFor(seed: StyleSeed): string {
  if (seed.tag === '基准') return '新样式'
  return SEED_STUB_NAMES[seed.key.split(':')[1] ?? ''] ?? seed.name
}

function SeedGallery({
  seeds,
  selected,
  onSelect
}: {
  seeds: StyleSeed[]
  selected: string
  onSelect: (key: string) => void
}): ReactNode {
  const groups: { tag: string; items: StyleSeed[] }[] = []
  for (const seed of seeds) {
    const bucket = groups.find((item) => item.tag === seed.tag)
    if (bucket) bucket.items.push(seed)
    else groups.push({ tag: seed.tag, items: [seed] })
  }

  return (
    <div className="set-seed-wrap">
      <div className="set-seed-scroll">
        {groups.map((group) => (
          <div className="set-seed-group" key={group.tag}>
            <span className="set-seed-group-title">{group.tag}</span>
            <div className="set-seed-grid">
              {group.items.map((seed) => (
                <button
                  key={seed.key}
                  type="button"
                  className={`set-seed ${selected === seed.key ? 'is-active' : ''}`}
                  aria-pressed={selected === seed.key}
                  onClick={() => onSelect(seed.key)}
                >
                  <span className="set-seed-thumb">
                    <SpineView style={seed.style} pages={CARD_PAGES} title={seed.name} width={26} height={72} />
                  </span>
                  <span className="set-seed-text">
                    <span className="set-seed-name">{seed.name}</span>
                    <span className="set-seed-desc">{seed.desc}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

/**
 * 新增样式弹窗：两步走。
 * 第一步挑起点（内置预设 / 我的预设 / 基准样式），第二步才起名字——
 * 分开的好处是改选起点时会顺手换掉默认名字，而已经敲进去的名字不会被抹掉。
 */
function SeedDialog({
  open,
  seeds,
  scope,
  onSubmit,
  onClose
}: {
  open: boolean
  seeds: StyleSeed[]
  /** 作用域名称：书籍 / 笔记 —— 只用来把标题写清楚 */
  scope: string
  onSubmit: (name: string, seed: StyleSeed) => void
  onClose: () => void
}): ReactNode {
  const [stage, setStage] = useState<'pick' | 'name'>('pick')
  const [selected, setSelected] = useState(seeds[0]?.key ?? 'base')
  const [name, setName] = useState(() => (seeds[0] ? stubNameFor(seeds[0]) : ''))
  const seed = seeds.find((item) => item.key === selected) ?? seeds[0]

  /** 换起点时顺手把默认名字换上，已经敲进去的名字不动 */
  const pickSeed = (key: string): void => {
    setSelected(key)
    const next = seeds.find((item) => item.key === key)
    setName(next ? stubNameFor(next) : '')
  }

  const submitName = (): void => {
    const value = name.trim()
    if (!value || !seed) return
    onSubmit(value, seed)
  }

  if (stage === 'pick') {
    return (
      <Modal
        open={open}
        title={`新增${scope}样式`}
        subtitle="先挑一个起点：内置预设、你保存的预设，或者当前的基准样式。"
        onClose={onClose}
        width={560}
        footer={
          <>
            <Button variant="ghost" onClick={onClose}>
              取消
            </Button>
            <Button variant="solid" disabled={!seed} onClick={() => setStage('name')}>
              下一步：起名字
            </Button>
          </>
        }
      >
        <SeedGallery seeds={seeds} selected={selected} onSelect={pickSeed} />
      </Modal>
    )
  }

  return (
    <Modal
      open={open}
      title="给新样式起个名字"
      subtitle={`起点：${seed?.name ?? '基准样式'}，新增后仍然可以逐项微调。`}
      onClose={onClose}
      width={520}
      footer={
        <>
          <Button variant="ghost" onClick={() => setStage('pick')}>
            上一步
          </Button>
          <Button variant="solid" disabled={!name.trim()} onClick={submitName}>
            新增
          </Button>
        </>
      }
    >
      <TextInput
        autoFocus
        value={name}
        placeholder="例如：青蓝布纹"
        onChange={(event) => setName(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') submitName()
        }}
      />
    </Modal>
  )
}

/* ------------------------------------------------------------ 编辑面板 */

function newEntryId(): string {
  return `style-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
}

function summaryOf(style: BookStyle): string {
  const bits = [
    SPINE_PRESET_LABELS[style.spinePreset],
    ORNAMENT_LABELS[style.ornament],
    style.spineTextDirection === 'vertical' ? '竖排' : '横排'
  ]
  if (style.spineImage) bits.push('贴图')
  if (style.spineWidthOverride) bits.push(`固定厚 ${style.spineWidthOverride}px`)
  return bits.join(' · ')
}

function StyleEditPanel({
  entry,
  onChange,
  onName
}: {
  entry: SpineStyleEntry
  onChange: (patch: Partial<BookStyle>) => void
  onName: () => void
}): ReactNode {
  const toast = useUi((s) => s.toast)
  const [picking, setPicking] = useState<'spine' | 'cover' | null>(null)
  const value = entry.style

  const pickImage = async (kind: 'spine' | 'cover'): Promise<void> => {
    setPicking(kind)
    try {
      const picked = await settingsApi.pickBookImage(kind)
      if (!picked) return
      const aspect = await measureImageAspect(picked.dataUrl)
      onChange(
        kind === 'spine'
          ? { spineImage: picked.ref, ...(aspect ? { spineImageAspect: aspect } : null) }
          : { coverImage: picked.ref, ...(aspect ? { coverImageAspect: aspect } : null) }
      )
      toast(kind === 'spine' ? '已换上书脊贴图' : '已换上封面图片', 'success', picked.name)
    } catch (error) {
      toast('选择图片失败', 'error', (error as Error).message)
    } finally {
      setPicking(null)
    }
  }

  return (
    <div className="set-style-editor">
      <div className="set-style-editor-head">
        <div className="set-style-editor-book">
          <SpineView style={value} pages={CARD_PAGES} title={entry.name} width={40} height={132} />
        </div>
        <div className="set-style-editor-meta">
          <span className="set-field-label">样式名称</span>
          <div className="set-style-name-row">
            <strong>{entry.name}</strong>
            <Button variant="ghost" size="xs" icon={<IconEdit size={13} />} onClick={onName}>
              重命名
            </Button>
            {entry.builtin ? <span className="set-tag">内置</span> : <span className="set-tag">自定义</span>}
          </div>
          <p className="set-hint">改动即时保存，书架上立刻生效，不用再点确认。</p>
        </div>
      </div>

      <SpinePresetPicker value={value} onChange={onChange} />
      <BookColorFields value={value} onChange={onChange} />
      <OrnamentPicker value={value} onChange={onChange} />
      <CoverPresetPicker value={value} onChange={onChange} />
      <ThicknessFields value={value} onChange={onChange} />
      <SpineImageField value={value} onChange={onChange} picking={picking === 'spine'} onPick={() => void pickImage('spine')} />
      <StyleImageField kind="cover" value={value} onChange={onChange} picking={picking === 'cover'} onPick={() => void pickImage('cover')} />
    </div>
  )
}

/* ---------------------------------------------------------------- 主视图 */

export function SpineStylesTab({ settings }: { settings: AppSettings }): ReactNode {
  const books = useLibrary((s) => s.index?.books ?? [])
  const patch = useSettings((s) => s.patch)
  const toast = useUi((s) => s.toast)

  /**
   * 正在编辑哪一份列表。
   *
   * 书籍与笔记的样式列表、分配方式各自独立，用这个分段控件切作用域：
   * 第 1 区（分配方式）与第 3 区（样式列表）都跟着它走，编辑 UI 只写一份。
   */
  const [kind, setKind] = useState<BookKind>('book')
  const kindLabel = KIND_LABEL[kind]

  const entries = spineStylesFor(settings, kind)
  const mode = spineStyleModeFor(settings, kind)
  /** 当前作用域的基准样式：书籍用 bookStyle，笔记用 noteStyle */
  const baseStyle: BookStyle = kind === 'book' ? settings.bookStyle : (settings.noteStyle ?? DEFAULT_NOTE_STYLE)
  const baseStyleName = kind === 'book' ? '书籍的基准样式' : '笔记的基准样式'

  const [editingId, setEditingId] = useState<string | null>(null)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [savingCurrent, setSavingCurrent] = useState(false)

  const usage = useMemo(() => spineStyleUsage(books, settings, kind), [books, settings, kind])
  const poolSize = entries.filter((entry) => entry.enabled).length || entries.length
  const kindCount = useMemo(() => booksOfKind(books, kind).length, [books, kind])

  /**
   * 新增样式的可选取起点。
   * 内置预设与「我的预设」（settings.customBookStyles）都列出来，
   * 否则存下来的预设没有任何地方能用上。
   */
  const seeds = useMemo<StyleSeed[]>(() => {
    const list: StyleSeed[] = [
      {
        key: 'base',
        name: baseStyleName,
        tag: '基准',
        desc: `用第 2 区「基准样式」里${kindLabel}当前的样子，所有${kindLabel}的兜底外观`,
        style: baseStyle
      }
    ]
    for (const preset of BOOK_STYLE_PRESETS) {
      list.push({
        key: `builtin:${preset.id}`,
        name: preset.name,
        tag: '内置预设',
        desc: preset.description,
        style: preset.style
      })
    }
    for (const preset of settings.customBookStyles) {
      list.push({
        key: `custom:${preset.id}`,
        name: preset.name,
        tag: '我的预设',
        desc: '在外观 · 书籍样式里保存的自定义样式',
        style: preset.style
      })
    }
    return list
  }, [baseStyle, baseStyleName, kindLabel, settings.customBookStyles])

  const openAdd = (): void => setAdding(true)

  const editing = entries.find((entry) => entry.id === editingId) ?? null
  const renaming = entries.find((entry) => entry.id === renamingId) ?? null

  const usageText = (entry: SpineStyleEntry): string => {
    if (mode === 'single') return '未被单独分配'
    const count = usage.get(entry.id) ?? 0
    return count > 0 ? `已分到 ${count} ${kind === 'book' ? '本' : '条'}` : `还没分到${kindLabel}`
  }

  /** 改当前作用域的那份列表 */
  const commit = (list: SpineStyleEntry[], note?: string): void => {
    const next: DeepPartial<AppSettings> = kind === 'book' ? { spineStyles: list } : { noteSpineStyles: list }
    void patch(next).then(() => {
      if (note) toast(note, 'success')
    })
  }

  /** 改当前作用域的那份分配方式 */
  const changeMode = (next: SpineStyleMode): void => {
    const body: DeepPartial<AppSettings> =
      kind === 'book' ? { spineStyleMode: next } : { noteSpineStyleMode: next }
    void patch(body)
  }

  const patchEntry = (id: string, patchStyle: Partial<BookStyle>): void => {
    commit(entries.map((entry) => (entry.id === id ? { ...entry, style: { ...entry.style, ...patchStyle } } : entry)))
  }

  const renameEntry = (id: string, name: string): void => {
    commit(
      entries.map((entry) => (entry.id === id ? { ...entry, name } : entry)),
      `已改名为「${name}」`
    )
  }

  const toggleEntry = (id: string, enabled: boolean): void => {
    commit(entries.map((entry) => (entry.id === id ? { ...entry, enabled } : entry)))
  }

  const duplicateEntry = (entry: SpineStyleEntry): void => {
    const copy: SpineStyleEntry = {
      id: newEntryId(),
      name: `${entry.name} 副本`,
      builtin: false,
      enabled: true,
      style: { ...entry.style }
    }
    const at = entries.findIndex((item) => item.id === entry.id)
    const list = [...entries.slice(0, at + 1), copy, ...entries.slice(at + 1)]
    commit(list, `已复制一份「${copy.name}」`)
  }

  const removeEntry = (entry: SpineStyleEntry): void => {
    void (async () => {
      const response = await dialogApi.confirm({
        title: '书香笔记',
        message: `删除样式「${entry.name}」？`,
        detail: '只是不再用这套外观，书架上的书与文件都不会动。',
        buttons: ['删除', '取消'],
        defaultId: 1,
        cancelId: 1,
        type: 'warning'
      })
      if (response !== 0) return
      commit(
        entries.filter((item) => item.id !== entry.id),
        `已删除样式「${entry.name}」`
      )
      if (editingId === entry.id) setEditingId(null)
    })()
  }

  /** 用选中的起点复制出一条新样式 */
  const addStyle = (name: string, seed: StyleSeed): void => {
    const entry: SpineStyleEntry = {
      id: newEntryId(),
      name,
      builtin: false,
      enabled: true,
      style: { ...seed.style }
    }
    commit([...entries, entry], `已从「${seed.name}」新增样式「${name}」`)
    setEditingId(entry.id)
  }

  const saveCurrentAsStyle = (name: string): void => {
    const entry: SpineStyleEntry = {
      id: newEntryId(),
      name,
      builtin: false,
      enabled: true,
      style: { ...baseStyle }
    }
    commit([...entries, entry], `已把当前${baseStyleName}另存为「${name}」`)
  }

  return (
    <div className="set-tab">
      <div className="set-callout">
        <span className="set-callout-icon">
          <IconBookStack size={17} />
        </span>
        <div className="set-callout-body">
          <strong>这一页决定每一本书与每一条笔记长什么样</strong>
          <p>
            <strong>基准样式</strong>是兜底与蓝本；<strong>样式列表</strong>是参与分配的多套外观。
            <strong>书籍与笔记各有一份独立的列表与分配方式</strong>：用第 1 区右上角的「书籍 / 笔记」
            切换作用域，第 1 区与第 3 区就都在编辑那一份。单本书自己的覆盖始终最优先。
          </p>
        </div>
      </div>

      <SetSection
        step={1}
        title="分配方式"
        scope={`改这里 = 决定每${kind === 'book' ? '本书' : '条笔记'}去${kindLabel}那份列表里取哪一套样式；单本书自己的覆盖始终最优先。`}
        hint="只影响「取哪一套」，不改变任何一套样式长什么样。"
        action={
          <Segmented
            value={kind}
            onChange={(value) => setKind(value)}
            size="md"
            options={[
              { value: 'book', label: '书籍', title: '编辑书籍那份样式列表与分配方式' },
              { value: 'note', label: '笔记', title: '编辑笔记那份样式列表与分配方式' }
            ]}
          />
        }
      >
        <Segmented
          value={mode}
          onChange={changeMode}
          size="md"
          options={SPINE_STYLE_MODES.map((item) => ({
            value: item,
            label: SPINE_STYLE_MODE_LABELS[item],
            title: SPINE_STYLE_MODE_HINTS[item]
          }))}
        />
        <p className="set-mode-note">{kind === 'book' ? SPINE_STYLE_MODE_HINTS[mode] : SPINE_STYLE_MODE_HINTS_NOTE[mode]}</p>
        <p className="set-hint">
          {mode === 'single'
            ? `当前所有${kindLabel}都用第 2 区里${baseStyleName}。`
            : `当前${kindLabel}那份列表有 ${poolSize} 套已启用的样式参与分配，停用的样式不参与。`}
        </p>
      </SetSection>

      <SetSection
        step={2}
        title="基准样式"
        id="book-base-style"
        scope="改这里 = 所有书与笔记的兜底外观，也是「新增样式」选中「基准样式」作起点时取用的那一份。"
        hint="这一区同时管着两份基准样式：书籍基准样式 + 下面的笔记基准样式；它们不属于任何一份列表，第 3 区里正在编辑的那一套才是列表项。"
      >
        <div className="set-base-scope">
          <span className="set-base-scope-badge">基准样式 · 全局兜底</span>
          <p className="set-base-scope-note">
            这里每一项都是<strong>所有书共用的兜底外观</strong>，下面「笔记的基准样式」则是<strong>所有笔记共用的</strong>：
            分配方式选「全部统一」时各自都用自己那份基准；其它分配方式下，没被单独分配到的也回落到它。
          </p>
        </div>
        <BookStyleTab settings={settings} />
      </SetSection>

      <SetSection
        step={3}
        title={`样式列表 · ${kindLabel}`}
        scope={`改这里 = ${kindLabel}那份列表里参与分配的那几套外观；一套样式只影响分到它的${kind === 'book' ? '书' : '笔记'}。`}
        action={
          <div className="set-actions">
            <Button variant="outline" icon={<IconPlus size={14} />} onClick={openAdd}>
              新增样式
            </Button>
            <Button
              variant="solid"
              icon={<IconCheck size={14} />}
              onClick={() => setSavingCurrent(true)}
            >
              保存当前为样式
            </Button>
          </div>
        }
        hint="「新增样式」会让你先挑一个起点（内置预设 / 我的预设 / 基准样式）；「保存当前为样式」把基准样式当前的样子另存成列表里的一条。"
      >
        {entries.length === 0 ? (
          <p className="set-empty">还没有任何{kindLabel}样式，先点「新增样式」攒一套吧。</p>
        ) : (
          <div className="set-styles">
            {entries.map((entry) => {
              const count = usage.get(entry.id) ?? 0
              return (
                <article
                  key={entry.id}
                  className={`set-style-card ${entry.enabled ? '' : 'is-off'} ${
                    editingId === entry.id ? 'is-editing' : ''
                  }`}
                >
                  <div className="set-style-thumb">
                    <SpineView
                      style={entry.style}
                      pages={CARD_PAGES}
                      title={entry.name}
                      width={spineWidthFor(CARD_PAGES, entry.style)}
                      height={124}
                    />
                  </div>
                  <div className="set-style-body">
                    <h4 className="set-style-name">
                      {entry.name}
                      {entry.builtin ? <span className="set-tag">内置</span> : null}
                      {entry.enabled ? null : <span className="set-tag is-off">已停用</span>}
                    </h4>
                    <p className="set-style-summary">{summaryOf(entry.style)}</p>
                    <p className="set-style-usage">
                      <IconStarFilled size={11} />
                      {usageText(entry)}
                      {mode !== 'single' && count > 0 ? <span className="set-style-share">占 {Math.round((count / Math.max(1, kindCount)) * 100)}%</span> : null}
                    </p>
                  </div>
                  <div className="set-style-side">
                    <Switch checked={entry.enabled} onChange={(next) => toggleEntry(entry.id, next)} />
                    <div className="set-style-actions">
                      <Button
                        variant="outline"
                        size="xs"
                        icon={<IconEdit size={13} />}
                        onClick={() => setEditingId(editingId === entry.id ? null : entry.id)}
                      >
                        {editingId === entry.id ? '收起' : '编辑'}
                      </Button>
                      <IconButton label="重命名" tone="muted" onClick={() => setRenamingId(entry.id)}>
                        <IconEdit size={14} />
                      </IconButton>
                      <IconButton label="复制一份" tone="muted" onClick={() => duplicateEntry(entry)}>
                        <IconLayers size={14} />
                      </IconButton>
                      {entry.builtin ? null : (
                        <IconButton label="删除这套样式" tone="muted" onClick={() => removeEntry(entry)}>
                          <IconTrash size={14} />
                        </IconButton>
                      )}
                    </div>
                  </div>
                </article>
              )
            })}
          </div>
        )}
        <p className="set-hint">
          内置样式不能删除，但可以停用或改名；想留住改动就「复制一份」变成自己的。
          这份列表只作用于{kindLabel}，切换作用域改的是另一份。
        </p>
      </SetSection>

      {editing ? (
        <SetSection
          step={4}
          title={`正在编辑：${editing.name}`}
          className="set-style-edit-block"
          scope={`改这里 = 只改这一套样式，分到它的${kind === 'book' ? '书' : '笔记'}才跟着变。`}
          action={
            <Button variant="ghost" onClick={() => setEditingId(null)}>
              收起编辑面板
            </Button>
          }
        >
          <StyleEditPanel
            entry={editing}
            onChange={(patchStyle) => patchEntry(editing.id, patchStyle)}
            onName={() => setRenamingId(editing.id)}
          />
        </SetSection>
      ) : null}

      {/* 编辑面板之外再给一份基准小样，方便对照 */}
      <SetSection
        step={5}
        title={`${baseStyleName}对照`}
        scope={`只做对照用：看不同页数的${kindLabel}在${baseStyleName}下有多厚，不能在这里改设置。`}
      >
        <div className="set-preview-shelf">
          {[24, 260, 940].map((pages, index) => (
            <span className="set-chan" key={pages}>
              <span className="set-chan-book">
                <SpineView
                  style={baseStyle}
                  pages={pages}
                  title={['灯下随笔', '中国建筑史', '追忆似水年华'][index]}
                  height={150}
                />
              </span>
              <span className="set-chan-title">{['灯下随笔', '中国建筑史', '追忆似水年华'][index]}</span>
              <span className="set-chan-meta">
                {pages} 页 · {spineWidthFor(pages, baseStyle)} px
              </span>
            </span>
          ))}
        </div>
        <p className="set-hint">
          {baseStyleName}：{SPINE_PRESET_LABELS[baseStyle.spinePreset]} ·{' '}
          {ORNAMENT_LABELS[baseStyle.ornament]} · {COVER_PRESET_LABELS[baseStyle.coverPreset]}
        </p>
      </SetSection>

      {/* 每次打开都重新挂载，起点与名字自然回到默认 */}
      {adding ? <SeedDialog open seeds={seeds} scope={kindLabel} onSubmit={addStyle} onClose={() => setAdding(false)} /> : null}

      <NamePrompt
        open={savingCurrent}
        title="保存当前为样式"
        subtitle={`把「外观 · 书籍样式」里${baseStyleName}当前的样子存成${kindLabel}列表里的一条`}
        placeholder="例如：夜读蓝金"
        initial={kind === 'book' ? '我的书脊样式' : '我的笔记样式'}
        submitLabel="保存"
        onSubmit={saveCurrentAsStyle}
        onClose={() => setSavingCurrent(false)}
      />

      <NamePrompt
        open={renaming !== null}
        title="重命名样式"
        subtitle={renaming?.builtin ? '内置样式也可以改成你习惯的叫法' : undefined}
        placeholder="样式名称"
        initial={renaming?.name ?? ''}
        submitLabel="保存"
        onSubmit={(name) => {
          if (renaming) renameEntry(renaming.id, name)
        }}
        onClose={() => setRenamingId(null)}
      />
    </div>
  )
}
