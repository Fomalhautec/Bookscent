import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Book, BookRecord, BookStyle, CoverPreset, SpineOrnament, SpinePreset } from '@shared/types'
import { EDITABLE_FORMATS, FORMAT_LABEL } from '@shared/types'
import { useLibrary } from '@/store/useLibrary'
import { useSettings } from '@/store/useSettings'
import { useUi } from '@/store/useUi'
import { filesApi, appApi, dialogApi, libraryApi } from '@/lib/api'
import { pickStyleForBook, spineWidthFor } from '@/lib/theme'
import { FINISHED_PERCENT, readingPercent } from '@shared/progress'
import { formatDuration, formatInt } from '@/lib/detailFormat'
import { formatBytes, formatDate, formatPages, formatWords, relativeTime } from '@/lib/format'
import { ORNAMENT_LABELS, SPINE_PRESET_LABELS } from '@/features/settings/labels'
import {
  Button,
  ColorInput,
  Field,
  IconButton,
  SectionTitle,
  Segmented,
  Select,
  Slider,
  Switch,
  TextArea,
  TextInput
} from '@/components/common/Controls'
import {
  IconChevronDown,
  IconClose,
  IconColumns,
  IconEdit,
  IconExternalLink,
  IconFolder,
  IconImage,
  IconImageExtract,
  IconLock,
  IconRefresh,
  IconStar,
  IconStarFilled,
  IconTrash,
  IconWand
} from '@/components/icons/Icons'
import { BookCoverArt } from './BookCoverArt'
import { measureImageAspect } from '@/lib/image'
import { imageSrc } from '@shared/noteUrl'
import { BookSpine } from './BookSpine'
import { canExtractInternalImages, type CoverExtractKind } from './extractCover'
import { ExtractCoverModal } from './ExtractCoverModal'

const SPINE_PRESETS: { value: SpinePreset; label: string }[] = [
  { value: 'leather', label: '皮革烫金' },
  { value: 'cloth', label: '布纹精装' },
  { value: 'paper', label: '纸质平装' },
  { value: 'modern', label: '现代扁平' },
  { value: 'gilded', label: '竹节烫金' },
  { value: 'photo', label: '贴图书脊' }
]

const COVER_PRESETS: { value: CoverPreset; label: string }[] = [
  { value: 'classic', label: '古典花框' },
  { value: 'minimal', label: '极简留白' },
  { value: 'vintage', label: '复古藏书票' },
  { value: 'gradient', label: '渐变' },
  { value: 'typewriter', label: '打字机' },
  { value: 'plain', label: '纯色' },
  { value: 'corner', label: '书名右上角' },
  { value: 'sidebar', label: '书名竖排右侧' },
  { value: 'panel', label: '书名压色块' },
  { value: 'swiss', label: '居中一条线' }
]

const ORNAMENTS: { value: SpineOrnament; label: string }[] = [
  { value: 'none', label: '无' },
  { value: 'bands', label: '横带' },
  { value: 'label', label: '纸质标签' },
  { value: 'foil', label: '烫金线' },
  { value: 'ribs', label: '竹节' }
]

const FONT_OPTIONS = [
  { value: 'serif', label: '衬线（书香）' },
  { value: 'sans', label: '无衬线（清爽）' },
  { value: 'mono', label: '等宽（打字机）' }
]

const FONT_STACKS: Record<string, string> = {
  serif: '"Noto Serif SC", "Source Han Serif SC", "Songti SC", SimSun, Georgia, serif',
  sans: '"Segoe UI", "Microsoft YaHei", system-ui, sans-serif',
  mono: '"Cascadia Code", Consolas, "Courier New", monospace'
}

function fontKeyOf(stack: string): string {
  if (stack.includes('Cascadia') || stack.includes('Consolas')) return 'mono'
  if (stack.includes('Segoe') || stack.includes('sans-serif')) return 'sans'
  return 'serif'
}

export function BookDetailDrawer({ book, onClose }: { book: Book; onClose: () => void }): ReactNode {
  const settings = useSettings((s) => s.settings)
  const updateBook = useLibrary((s) => s.updateBook)
  const removeBooks = useLibrary((s) => s.removeBooks)
  const libraryIndex = useLibrary((s) => s.index)
  const assignShelf = useLibrary((s) => s.assignShelf)
  const addBookend = useLibrary((s) => s.addBookend)
  const select = useLibrary((s) => s.select)
  const toast = useUi((s) => s.toast)
  const shelves = useMemo(() => libraryIndex?.shelves ?? [], [libraryIndex])

  const globalStyle = settings?.bookStyle
  // 详情页要和书架上看到的是同一套外观：书架的分配方式可能给这本书分了另一套样式，
  // 这里不能直接用基准样式，否则"架上是一本、点开是另一本"。
  const effective = useMemo(() => {
    if (!settings || !globalStyle) return {} as BookStyle
    const order = libraryIndex?.books ?? []
    const index = order.findIndex((item) => item.id === book.id)
    return pickStyleForBook(book, settings, index < 0 ? 0 : index)
  }, [settings, globalStyle, book, libraryIndex?.books])
  const useGlobal = Object.keys(book.style ?? {}).length === 0

  const [title, setTitle] = useState(book.title)
  const [author, setAuthor] = useState(book.author)
  const [series, setSeries] = useState(book.series ?? '')
  const [tagDraft, setTagDraft] = useState('')
  const [summary, setSummary] = useState(book.summary)
  /*
   * 阅读 / 写作信息。
   *
   * 和统计页读的是同一份记录（usage 按 asBook / asNote 分键），
   * 只是这里只算这一本。进度用 readingPercent，读完了显示"已读完"。
   */
  const [record, setRecord] = useState<BookRecord | null>(null)
  useEffect(() => {
    let cancelled = false
    void libraryApi
      .record(book.id)
      .then((value) => {
        if (!cancelled) setRecord(value)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [book.id])

  const usageStats = useMemo(() => {
    const usage = record?.usage?.[book.kind === 'note' ? 'asNote' : 'asBook']
    return {
      opens: usage?.opens ?? 0,
      seconds: usage?.seconds ?? 0,
      pages: usage?.pages ?? 0,
      words: usage?.words ?? 0,
      lastAt: usage?.lastAt ?? 0
    }
  }, [record, book.kind])

  const readPercent = readingPercent(book, record)
  const usageSince = usageStats.lastAt ? relativeTime(usageStats.lastAt) : '还没读过'

  /** 打开「从书内图片选封面 / 书脊」弹窗；null = 没开 */
  const [extractTarget, setExtractTarget] = useState<CoverExtractKind | null>(null)

  useEffect(() => {
    setTitle(book.title)
    setAuthor(book.author)
    setSeries(book.series ?? '')
    setSummary(book.summary)
  }, [book.id, book.title, book.author, book.summary])

  if (!globalStyle) return null

  const patchStyle = (patch: Partial<BookStyle>): void => {
    void updateBook(book.id, { style: { ...book.style, ...patch } })
  }

  const pickImage = async (key: 'spineImage' | 'coverImage'): Promise<void> => {
    const picked = await filesApi.pickImages()
    if (!picked.length) return
    // 顺手记下比例：书脊厚度/封面宽度要跟着图片走，否则图会被裁掉一条
    const aspect = await measureImageAspect(picked[0].dataUrl)
    const aspectKey = key === 'spineImage' ? 'spineImageAspect' : 'coverImageAspect'
    patchStyle({ [key]: picked[0].dataUrl, ...(aspect ? { [aspectKey]: aspect } : null) } as Partial<BookStyle>)
    toast(key === 'spineImage' ? '书脊贴图已更新' : '封面已更新', 'success')
  }

  /*
   * 「从书内图片选封面 / 书脊」弹窗交回来的结果。
   * 裁剪过的图是一段 dataURL：先写进样式（内存里立刻可见），
   * 弹窗那边紧接着会把内联图落盘成 `asset:` 再重读书库，所以这里不用再做什么。
   */
  const handleExtracted = (value: string, aspect: number | null): void => {
    const key = extractTarget === 'spine' ? 'spineImage' : 'coverImage'
    const aspectKey = key === 'spineImage' ? 'spineImageAspect' : 'coverImageAspect'
    patchStyle({ [key]: value, ...(aspect && aspect > 0 ? { [aspectKey]: aspect } : null) } as Partial<BookStyle>)
  }

  const canExtract = canExtractInternalImages(book)

  const reProbe = async (): Promise<void> => {    const probe = await filesApi.probe(book.path)
    await updateBook(book.id, {
      pageCount: probe.pages,
      pageCountExact: probe.exact,
      words: probe.words || book.words,
      probeSize: book.size
    })
    toast(`已重新统计：${probe.pages} 页`, 'success')
  }

  const editable = EDITABLE_FORMATS.includes(book.format)

  const copyPath = async (): Promise<void> => {
    await navigator.clipboard.writeText(book.path)
    toast('路径已复制', 'success', book.path)
  }

  const exportTxt = async (): Promise<void> => {
    const content = await filesApi.readText(book.path)
    const result = await filesApi.exportText(`${book.title}.txt`, content, [
      { name: '纯文本', extensions: ['txt'] }
    ])
    if (!result.cancelled) toast('已导出', 'success', result.path ?? '')
  }

  /*
   * 移除与删除都走书架右键菜单那一套 dialogApi.confirm ——
   * 文案、按钮顺序、默认项都照抄，别在详情页另造一个确认流程。
   */
  const removeFromShelf = async (): Promise<void> => {
    const response = await dialogApi.confirm({
      title: '移除书籍',
      message: `确定把《${book.title}》从书架移除吗？`,
      detail: book.external ? '文件不在藏书目录里，只会移除书架记录。' : '文件本身会保留在藏书目录中。',
      buttons: ['取消', '移除'],
      defaultId: 1,
      cancelId: 0,
      type: 'question'
    })
    if (response !== 1) return
    await removeBooks([book.id], false)
    onClose()
    toast('已从书架移除', 'success')
  }

  const deleteFile = async (): Promise<void> => {
    const response = await dialogApi.confirm({
      title: '删除文件',
      message: `将永久删除《${book.title}》的文件，无法撤销。`,
      detail: book.path,
      buttons: ['取消', '删除'],
      defaultId: 0,
      cancelId: 0,
      type: 'warning'
    })
    if (response !== 1) return
    await libraryApi.removeBooks([book.id], true)
    await useLibrary.getState().load()
    onClose()
    toast('文件已删除', 'success')
  }

  /* 折叠起来的「书籍样式」要在标题行给出概要，不用展开也知道现在是哪一套 */
  const styleSummary = [
    SPINE_PRESET_LABELS[effective.spinePreset],
    ORNAMENT_LABELS[effective.ornament],
    effective.spineTextDirection === 'vertical' ? '竖排' : '横排'
  ].join(' · ')

  const previewHeight = 210
  const spineWidth = spineWidthFor(book.pageCount || 1, effective, previewHeight)

  return (
    <>
      <header className="drawer-head">
        <div>
          <h2>{book.title}</h2>
          <p className="drawer-subtitle">
            {FORMAT_LABEL[book.format]} · {formatPages(book.pageCount, book.pageCountExact)} · {formatBytes(book.size)}
          </p>
        </div>
        <IconButton label="关闭" onClick={onClose}>
          <IconClose size={16} />
        </IconButton>
      </header>

      <div className="drawer-body book-detail">
        <div className="detail-hero">
          <BookCoverArt book={{ ...book, title }} style={effective} width={132} />
          <div className="detail-hero-spine">
            <BookSpine
              book={{ ...book, title, author }}
              style={effective}
              width={spineWidth}
              footprint={spineWidth}
              height={previewHeight}
              tilt={effective.tilt}
              facing="spine"
              ui={settings.ui}
              selected={false}
              marked={false}
              onOpen={() => undefined}
              onContext={() => undefined}
            />
            <span className="detail-hero-caption">书脊 {spineWidth}px</span>
          </div>
        </div>

        {/*
          原先只在书架右键菜单里的动作，现在详情页也能直接做；
          这一块就是右键菜单的详情页版本，不用再退回书架右键。
        */}
        <SectionTitle hint="原来只在书架右键里的动作，这里也能直接做">操作</SectionTitle>
        <div className="detail-ops">
          <div className="detail-actions">
            <Button variant="solid" icon={<IconEdit size={14} />} onClick={() => select(book.id)}>
              打开这本书
            </Button>
            <Button
              variant="outline"
              icon={<IconExternalLink size={14} />}
              onClick={() => void appApi.openPath(book.path)}
            >
              用系统应用打开
            </Button>
            <Button
              variant="outline"
              icon={<IconFolder size={14} />}
              onClick={() => void appApi.revealPath(book.path)}
            >
              打开所在文件夹
            </Button>
            <Button variant="outline" icon={<IconLock size={14} />} onClick={() => void copyPath()}>
              复制文件路径
            </Button>
            {/*
              加左右书立、标记五星不放在这里（用户要求移除）：
              书立是"书架上的动作"，在书架右键里做才顺手；评分在下面「书目信息」里点星星就行。
            */}
            <Button variant="outline" icon={<IconRefresh size={14} />} onClick={() => void reProbe()}>
              重新统计页数
            </Button>
            {editable ? (
              <Button variant="outline" icon={<IconEdit size={14} />} onClick={() => void exportTxt()}>
                导出为 TXT
              </Button>
            ) : null}
          </div>
          <div className="detail-danger detail-actions">
            <Button variant="danger" icon={<IconTrash size={14} />} onClick={() => void removeFromShelf()}>
              从书架移除
            </Button>
            {!book.external ? (
              <Button variant="danger" icon={<IconTrash size={14} />} onClick={() => void deleteFile()}>
                连同文件一起删除
              </Button>
            ) : null}
          </div>
        </div>

        <SectionTitle hint="打开次数、累计时长、翻过的页数或输入的字数，都来自实际使用">
          {book.kind === 'note' ? '写作信息' : '阅读信息'}
        </SectionTitle>
        <div className="detail-stats">
          <div className="detail-stat">
            <span className="detail-stat-value">{usageStats.opens}</span>
            <span className="detail-stat-label">打开次数</span>
          </div>
          <div className="detail-stat">
            <span className="detail-stat-value">{formatDuration(usageStats.seconds)}</span>
            <span className="detail-stat-label">累计时长</span>
          </div>
          {book.kind === 'note' ? (
            <div className="detail-stat">
              <span className="detail-stat-value">{formatInt(usageStats.words)}</span>
              <span className="detail-stat-label">累计输入字数</span>
            </div>
          ) : (
            <div className="detail-stat">
              <span className="detail-stat-value">{formatInt(usageStats.pages)}</span>
              <span className="detail-stat-label">累计翻页</span>
            </div>
          )}
          {book.kind === 'book' ? (
            <div className="detail-stat">
              <span className="detail-stat-value">{readPercent}%</span>
              <span className="detail-stat-label">
                {readPercent >= FINISHED_PERCENT ? '已读完' : '阅读进度'}
              </span>
            </div>
          ) : null}
          <div className="detail-stat">
            <span className="detail-stat-value">{usageSince}</span>
            <span className="detail-stat-label">最近一次</span>
          </div>
        </div>

        <SectionTitle hint="改完即时生效，并写回书库索引">书目信息</SectionTitle>
        <div className="detail-grid">
          <Field label="书名">
            <TextInput
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              onBlur={() => title.trim() && title !== book.title && void updateBook(book.id, { title: title.trim() })}
            />
          </Field>
          <Field label="作者">
            <TextInput
              value={author}
              onChange={(event) => setAuthor(event.target.value)}
              onBlur={() => author !== book.author && void updateBook(book.id, { author })}
            />
          </Field>
          {/*
            系列：填了之后，同一系列的书在书架上高度一致
            （错落是按系列名散列的，见 lib/theme 的 spineHeightFor）。
          */}
          <Field label="系列">
            <TextInput
              value={series}
              placeholder="同一系列的书高度会齐平"
              onChange={(event) => setSeries(event.target.value)}
              onBlur={() => series !== (book.series ?? '') && void updateBook(book.id, { series: series.trim() })}
            />
          </Field>
          <Field label="所属书架层">
            <Select
              value={book.shelfId}
              onChange={(value) => void assignShelf([book.id], value)}
              options={shelves.map((s) => ({ value: s.id, label: s.name }))}
            />
          </Field>
          <Field
            label="当作"
            hint={
              book.kind === 'note'
                ? '笔记：算「写作」，用笔记的基准样式'
                : '书籍：算「阅读」，用书籍的基准样式'
            }
          >
            <Segmented
              value={book.kind}
              options={[
                { value: 'book', label: '书籍' },
                { value: 'note', label: '笔记' }
              ]}
              onChange={(value) => void updateBook(book.id, { kind: value as Book['kind'] })}
            />
          </Field>
          <Field label="阅读状态">
            <Select
              value={book.status}
              onChange={(value) =>
                void updateBook(book.id, { status: value as Book['status'] })
              }
              options={[
                { value: 'unread', label: '未读' },
                { value: 'reading', label: '在读' },
                { value: 'finished', label: '读完' }
              ]}
            />
          </Field>
        </div>

        <Field label="评分">
          <div className="detail-stars">
            {[1, 2, 3, 4, 5].map((n) => (
              <IconButton
                key={n}
                label={`${n} 星`}
                active={n <= book.rating}
                onClick={() => void updateBook(book.id, { rating: n === book.rating ? 0 : n })}
              >
                {n <= book.rating ? <IconStarFilled size={16} /> : <IconStar size={16} />}
              </IconButton>
            ))}
          </div>
        </Field>

        <Field label="标签" hint="回车添加，点击标签右侧的 × 移除">
          <div className="detail-tags">
            {book.tags.map((tag) => (
              <span className="detail-tag" key={tag}>
                {tag}
                <button
                  type="button"
                  onClick={() => void updateBook(book.id, { tags: book.tags.filter((t) => t !== tag) })}
                  aria-label={`移除 ${tag}`}
                >
                  <IconClose size={10} />
                </button>
              </span>
            ))}
            <TextInput
              className="detail-tag-input"
              value={tagDraft}
              placeholder="添加标签"
              onChange={(event) => setTagDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && tagDraft.trim()) {
                  const next = Array.from(new Set([...book.tags, tagDraft.trim()]))
                  void updateBook(book.id, { tags: next })
                  setTagDraft('')
                }
              }}
            />
          </div>
        </Field>

        <Field label="简介 / 备注">
          <TextArea
            value={summary}
            placeholder="写下这本书对你的意义…"
            onChange={(event) => setSummary(event.target.value)}
            onBlur={() => summary !== book.summary && void updateBook(book.id, { summary })}
          />
        </Field>

        {/*
          这一节最长（十几个 Field + 一排颜色），默认收起来；
          标题行上给出「预设 · 装饰 · 方向」的概要，要调再展开。
          里面的东西一件不少，只是从 <details> 里露出来。
        */}
        <details className="detail-fold">
          <summary className="detail-fold-summary">
            <span className="detail-fold-caret">
              <IconChevronDown size={14} />
            </span>
            <span className="detail-fold-title">书籍样式</span>
            <span className="detail-fold-value">{styleSummary}</span>
          </summary>
          <div className="detail-fold-body">
            <Field inline label="跟随全局书籍样式">
              <Switch
                checked={useGlobal}
                onChange={(checked) => {
                  if (checked) void updateBook(book.id, { style: {} })
                  else void updateBook(book.id, { style: { ...effective } })
                }}
              />
            </Field>

            {/*
             * 这里以前是 `{!useGlobal ? … : null}` —— 跟随全局样式的书根本看不到
             * 这些控件，于是"详情页调不了书脊弧度 / 格式标记"。
             * patchStyle 本来就会把改动并成这本书自己的覆盖，所以控件一直摆着就好。
             */}
            {useGlobal ? (
              <p className="detail-hint">
                这本书现在跟随基准样式。改动下面任意一项，就会自动变成它自己的覆盖。
              </p>
            ) : null}
            <div className="detail-style" hidden={false}>
              <Field label="书脊预设">
                <Select
                  value={effective.spinePreset}
                  onChange={(value) => patchStyle({ spinePreset: value as SpinePreset })}
                  options={SPINE_PRESETS}
                />
              </Field>
              <Field label="封面预设">
                <Select
                  value={effective.coverPreset}
                  onChange={(value) => patchStyle({ coverPreset: value as CoverPreset })}
                  options={COVER_PRESETS}
                />
              </Field>
              <Field label="书脊装饰">
                <Select
                  value={effective.ornament}
                  onChange={(value) => patchStyle({ ornament: value as SpineOrnament })}
                  options={ORNAMENTS}
                />
              </Field>
              <Field label="书脊字体">
                <Select
                  value={fontKeyOf(effective.fontFamily)}
                  onChange={(value) => patchStyle({ fontFamily: FONT_STACKS[value] })}
                  options={FONT_OPTIONS}
                />
              </Field>
              <Field label="书名方向">
                <Segmented
                  value={effective.spineTextDirection}
                  onChange={(value) => patchStyle({ spineTextDirection: value })}
                  options={[
                    { value: 'vertical', label: '竖排' },
                    { value: 'horizontal', label: '横排' }
                  ]}
                />
              </Field>
              <Field inline label="显示格式标记">
                <Switch checked={effective.showFormatIcon} onChange={(v) => patchStyle({ showFormatIcon: v })} />
              </Field>
              <Field label="书脊弧度" hint="平板装帧与贴了自己的书脊图时，自动就是平直的">
                <Segmented
                  value={effective.spineCurve ?? 'auto'}
                  onChange={(value) => patchStyle({ spineCurve: value })}
                  options={[
                    { value: 'auto', label: '自动' },
                    { value: 'curved', label: '有弧度' },
                    { value: 'flat', label: '平直' }
                  ]}
                />
              </Field>

              <Field label="书脊底色">
                <div className="detail-color-row">
                  <ColorInput value={effective.spineColor} onChange={(v) => patchStyle({ spineColor: v })} />
                  <ColorInput value={effective.spineColor2} onChange={(v) => patchStyle({ spineColor2: v })} />
                </div>
              </Field>
              <Field label="书脊文字 / 烫金">
                <div className="detail-color-row">
                  <ColorInput value={effective.spineTextColor} onChange={(v) => patchStyle({ spineTextColor: v })} />
                  <ColorInput value={effective.foilColor} onChange={(v) => patchStyle({ foilColor: v })} />
                </div>
              </Field>
              <Field label="封面配色">
                <div className="detail-color-row">
                  <ColorInput value={effective.coverColor} onChange={(v) => patchStyle({ coverColor: v })} />
                  <ColorInput value={effective.coverColor2} onChange={(v) => patchStyle({ coverColor2: v })} />
                  <ColorInput value={effective.coverTextColor} onChange={(v) => patchStyle({ coverTextColor: v })} />
                </div>
              </Field>

              <Field label="书脊厚度比例" hint="在「由页数决定」的基础上整体缩放">
                <Slider
                  value={effective.thicknessScale}
                  min={0.4}
                  max={2}
                  step={0.05}
                  onChange={(v) => patchStyle({ thicknessScale: v })}
                  format={(v) => `${v.toFixed(2)}×`}
                />
              </Field>
              <Field inline label="手动指定厚度">
                <Switch
                  checked={Boolean(effective.spineWidthOverride)}
                  onChange={(checked) =>
                    patchStyle({
                      spineWidthOverride: checked
                        ? spineWidthFor(book.pageCount, effective, previewHeight) || spineWidth
                        : null
                    })
                  }
                />
              </Field>
              {effective.spineWidthOverride ? (
                <Field label="书脊宽度">
                  <Slider
                    value={effective.spineWidthOverride}
                    min={26}
                    max={140}
                    onChange={(v) => patchStyle({ spineWidthOverride: v })}
                    format={(v) => `${v}px`}
                  />
                </Field>
              ) : null}
              <Field label="倾角">
                <Slider
                  value={effective.tilt}
                  min={-12}
                  max={12}
                  step={0.5}
                  onChange={(v) => patchStyle({ tilt: v })}
                  format={(v) => `${v}°`}
                />
              </Field>
            </div>
          </div>
        </details>

        <SectionTitle hint="书脊贴图优先于上面的程序化样式">自定义图片</SectionTitle>
        <div className="detail-images">
          <div className="detail-image-card">
            <div className="detail-image-preview is-spine">
              {/*
                必须走 imageSrc()：库里存的是 `asset:xxx.jpg` 这种简写，
                它不是合法 URL —— 直接塞进 url(...) 浏览器解析不了，预览就是一块黑。
                （用户报的"详情页封面图片里仍是一片黑"就是这个。）
                用 <img> 而不是背景图，顺便让比例和不失真跟书架保持一致。
              */}
              {effective.spineImage ? (
                <img
                  className="detail-image-img"
                  src={imageSrc(effective.spineImage)}
                  alt=""
                  draggable={false}
                />
              ) : (
                <span className="muted">程序化书脊</span>
              )}
            </div>
            <div className="detail-image-actions">
              <Button size="xs" icon={<IconImage size={13} />} onClick={() => void pickImage('spineImage')}>
                选择书脊图片
              </Button>
              {canExtract ? (
                <Button
                  size="xs"
                  variant="outline"
                  className="is-extract"
                  icon={<IconImageExtract size={13} />}
                  onClick={() => setExtractTarget('spine')}
                >
                  从书内图片选书脊
                </Button>
              ) : null}
              {effective.spineImage ? (
                <Button size="xs" variant="danger" onClick={() => patchStyle({ spineImage: null })}>
                  清除
                </Button>
              ) : null}
            </div>
          </div>
          <div className="detail-image-card">
            <div className="detail-image-preview is-cover">
              {/* 同上：asset: 简写要经 imageSrc 转成 asset://local/... 才画得出来 */}
              {effective.coverImage ? (
                <img
                  className="detail-image-img"
                  src={imageSrc(effective.coverImage)}
                  alt=""
                  draggable={false}
                />
              ) : (
                <span className="muted">程序化封面</span>
              )}
            </div>
            <div className="detail-image-actions">
              <Button size="xs" icon={<IconWand size={13} />} onClick={() => void pickImage('coverImage')}>
                选择封面图片
              </Button>
              {canExtract ? (
                <Button
                  size="xs"
                  variant="outline"
                  className="is-extract"
                  icon={<IconImageExtract size={13} />}
                  onClick={() => setExtractTarget('cover')}
                >
                  从书内图片选封面
                </Button>
              ) : null}
              {effective.coverImage ? (
                <Button size="xs" variant="danger" onClick={() => patchStyle({ coverImage: null })}>
                  清除
                </Button>
              ) : null}
            </div>
          </div>
        </div>

        <SectionTitle>文件</SectionTitle>
        <dl className="detail-facts">
          <div>
            <dt>路径</dt>
            <dd className="mono">{book.path}</dd>
          </div>
          <div>
            <dt>大小</dt>
            <dd>{formatBytes(book.size)}</dd>
          </div>
          <div>
            <dt>页数</dt>
            <dd>
              {formatPages(book.pageCount, book.pageCountExact)}
              {book.pageCountExact ? '（文档自带）' : '（按字数估算）'}
            </dd>
          </div>
          <div>
            <dt>字数</dt>
            <dd>{formatWords(book.words)}</dd>
          </div>
          <div>
            <dt>加入时间</dt>
            <dd>{formatDate(book.addedAt)}</dd>
          </div>
          <div>
            <dt>上次打开</dt>
            <dd>{relativeTime(book.lastOpenedAt)}</dd>
          </div>
          <div>
            <dt>来源</dt>
            <dd>{book.external ? '外部引用（未复制）' : '藏书目录内'}</dd>
          </div>
        </dl>
      </div>

      {/*
        「从书内图片选封面 / 书脊」：只有 EPUB 与 PDF 才有书内图片，
        按钮也只在 canExtract 时出现，所以这里不用再判格式。
      */}
      {canExtract ? (
        <ExtractCoverModal
          open={extractTarget !== null}
          kind={extractTarget ?? 'cover'}
          book={{ ...book, title, author }}
          onClose={() => setExtractTarget(null)}
          onApply={handleExtracted}
        />
      ) : null}
    </>
  )
}
