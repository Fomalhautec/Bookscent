import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { Book, BookFormat, BookStatus, ShelfSortMode } from '@shared/types'
import { FORMAT_LABEL } from '@shared/types'
import { Button, CheckRow, Chip, IconButton, Modal, Select } from '@/components/common/Controls'
import { IconChecklist, IconClose, IconFilter, IconSortAsc, IconSortDesc, IconTrash } from '@/components/icons/Icons'
import { SORT_LABEL, activeFilterCount, collectTags, defaultDescFor, type ShelfFilter } from './shelfOrder'

const SORT_MODES: ShelfSortMode[] = ['manual', 'recent', 'added', 'title', 'author', 'pages', 'rating', 'format']
const FORMATS: BookFormat[] = ['pdf', 'md', 'markdown', 'txt', 'doc', 'docx', 'rtf', 'html', 'epub', 'image']
const STATUSES: { value: BookStatus; label: string }[] = [
  { value: 'unread', label: '未读' },
  { value: 'reading', label: '在读' },
  { value: 'finished', label: '读完' }
]

/** 批量操作栏里可以展开的小面板 */
type BatchPanel = 'move' | 'tags' | 'style' | 'rating' | 'status' | 'meta'

/** 「跟随基准样式」的哨兵值：清掉单本书的覆盖，让它重新继承全局样式 */
export const BASE_STYLE_PICK = '__base__'

export interface ShelfToolbarProps {
  filter: ShelfFilter
  onFilter: (patch: Partial<ShelfFilter>) => void
  onClearFilter: () => void
  sort: ShelfSortMode
  sortDesc: boolean
  onSort: (mode: ShelfSortMode, desc: boolean) => void
  /** 当前书目里出现过的格式，只显示实际用得上的 */
  availableFormats: BookFormat[]
  allBooks: Book[]
  /** 排序不是「默认」时给出提示，说明拖动的后果 */
  manualHint: boolean
  /** 有多少本书的文件已经找不到了 */
  missingCount?: number
  /** 一键把这些失效书从书架上清掉（不动磁盘） */
  onRemoveMissing?: () => void
  /** 多选模式：普通单击 = 选中，双击才打开 */
  multiSelect: boolean
  onToggleMultiSelect: (next: boolean) => void
  /** 已选中的书本数（只算当前可见的） */
  selectedCount: number
}

/** 书架顶部的筛选 + 排序条 */
export function ShelfToolbar({
  filter,
  onFilter,
  onClearFilter,
  sort,
  sortDesc,
  onSort,
  availableFormats,
  allBooks,
  manualHint,
  missingCount,
  onRemoveMissing,
  multiSelect,
  onToggleMultiSelect,
  selectedCount
}: ShelfToolbarProps): ReactNode {
  const [open, setOpen] = useState(false)
  const popRef = useRef<HTMLDivElement>(null)
  const count = activeFilterCount(filter)
  const tags = collectTags(allBooks)

  useEffect(() => {
    if (!open) return
    const onDown = (event: MouseEvent): void => {
      if (popRef.current && !popRef.current.contains(event.target as Node)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  const toggleFormat = (format: BookFormat): void => {
    const next = filter.formats.includes(format)
      ? filter.formats.filter((f) => f !== format)
      : [...filter.formats, format]
    onFilter({ formats: next })
  }

  const toggleStatus = (status: BookStatus): void => {
    const next = filter.status.includes(status)
      ? filter.status.filter((s) => s !== status)
      : [...filter.status, status]
    onFilter({ status: next })
  }

  const toggleTag = (tag: string): void => {
    const next = filter.tags.includes(tag) ? filter.tags.filter((t) => t !== tag) : [...filter.tags, tag]
    onFilter({ tags: next })
  }

  return (
    <div className="shelf-toolbar">
      <div className="shelf-toolbar-left" ref={popRef}>
        <Button
          size="sm"
          variant={count > 0 ? 'solid' : 'outline'}
          icon={<IconFilter size={14} />}
          onClick={() => setOpen((v) => !v)}
        >
          筛选{count > 0 ? ` · ${count}` : ''}
        </Button>

        {open ? (
          <div className="shelf-filter-pop">
            <div className="shelf-filter-section">
              <span className="shelf-filter-label">格式</span>
              <div className="shelf-filter-chips">
                {FORMATS.filter((f) => availableFormats.includes(f)).map((format) => (
                  <Chip key={format} active={filter.formats.includes(format)} onClick={() => toggleFormat(format)}>
                    {FORMAT_LABEL[format]}
                  </Chip>
                ))}
                {availableFormats.length === 0 ? <span className="muted">还没有书</span> : null}
              </div>
            </div>

            <div className="shelf-filter-section">
              <span className="shelf-filter-label">状态</span>
              <div className="shelf-filter-chips">
                {STATUSES.map((item) => (
                  <Chip
                    key={item.value}
                    active={filter.status.includes(item.value)}
                    onClick={() => toggleStatus(item.value)}
                  >
                    {item.label}
                  </Chip>
                ))}
              </div>
            </div>

            <div className="shelf-filter-section">
              <span className="shelf-filter-label">最低评分</span>
              <div className="shelf-filter-chips">
                {[0, 3, 4, 5].map((value) => (
                  <Chip key={value} active={filter.minRating === value} onClick={() => onFilter({ minRating: value })}>
                    {value === 0 ? '不限' : `${value} 星以上`}
                  </Chip>
                ))}
              </div>
            </div>

            {tags.length > 0 ? (
              <div className="shelf-filter-section">
                <span className="shelf-filter-label">标签</span>
                <div className="shelf-filter-chips">
                  {tags.slice(0, 24).map((tag) => (
                    <Chip key={tag} active={filter.tags.includes(tag)} onClick={() => toggleTag(tag)}>
                      {tag}
                    </Chip>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="shelf-filter-foot">
              <Button size="xs" variant="ghost" onClick={onClearFilter} disabled={count === 0}>
                清除全部筛选
              </Button>
            </div>
          </div>
        ) : null}

        {count > 0 ? (
          <button type="button" className="shelf-filter-clear" onClick={onClearFilter} title="清除筛选">
            <IconClose size={12} />
            清除
          </button>
        ) : null}
      </div>

      <span className="shelf-toolbar-spacer" />

      <div className="shelf-toolbar-right">
        <button
          type="button"
          className={['shelf-multi-toggle', multiSelect ? 'is-on' : ''].filter(Boolean).join(' ')}
          aria-pressed={multiSelect}
          onClick={() => onToggleMultiSelect(!multiSelect)}
          title={
            multiSelect
              ? '已开启多选：单击选中 / 取消，双击才打开书本'
              : '开启后单击即选中、双击才打开；按住 Ctrl / Shift 单击随时也能多选'
          }
        >
          多选
        </button>
        {selectedCount > 0 ? <span className="shelf-toolbar-selected">已选 {selectedCount} 本</span> : null}
        <Select
          value={sort}
          options={SORT_MODES.map((mode) => ({ value: mode, label: SORT_LABEL[mode] }))}
          onChange={(value) => onSort(value as ShelfSortMode, defaultDescFor(value as ShelfSortMode))}
        />
        <IconButton label={sortDesc ? '当前：从大到小' : '当前：从小到大'} onClick={() => onSort(sort, !sortDesc)}>
          {sortDesc ? <IconSortDesc size={15} /> : <IconSortAsc size={15} />}
        </IconButton>
        {manualHint ? (
          <span className="shelf-sort-hint" title={`当前按「${SORT_LABEL[sort]}」排序。拖动书脊会先问你要不要改成手动排列，确认后按你拖的样子排。`}>
            拖动排序会问你是否改为手动排列
          </span>
        ) : (
          <span className="shelf-sort-hint" title="手动排列：直接拖动书脊换位置">
            手动排列：直接拖动换位置
          </span>
        )}
        {(missingCount ?? 0) > 0 ? (
          <Button
            variant="outline"
            size="xs"
            icon={<IconClose size={13} />}
            onClick={onRemoveMissing}
            title="这些书的文件已不在原处（移动过，或所在磁盘没插上）。只从书架移除，不动磁盘。"
          >
            移除失效书籍（{missingCount}）
          </Button>
        ) : null}
      </div>
    </div>
  )
}

/* ==========================================================================
   批量操作栏
   ========================================================================== */

export interface BatchStyleOption {
  id: string
  name: string
  enabled: boolean
  color: string
}

export interface BatchBarProps {
  /** 当前真正有效的选中项（已经剔除被筛掉的书） */
  books: Book[]
  shelves: { id: string; name: string }[]
  /** 这些书共同拥有的标签，用于「一起移除标签」 */
  commonTags: string[]
  styles: BatchStyleOption[]
  /** 当前筛出来能看到的书有多少本，用于「全选可见」 */
  visibleCount: number
  onSelectAllVisible: () => void
  onClear: () => void
  onDelete: (deleteFiles: boolean) => Promise<void>
  onMove: (shelfId: string) => Promise<void>
  onAddTags: (raw: string) => Promise<void>
  onRemoveTag: (tag: string) => Promise<void>
  onApplyStyle: (styleId: string) => Promise<void>
  onRate: (rating: number) => Promise<void>
  /** 批量设置系列（空字符串 = 清空） */
  onSetSeries: (value: string) => Promise<void>
  /** 批量设置作者（空字符串 = 清空） */
  onSetAuthor: (value: string) => Promise<void>
  onSetStatus: (status: BookStatus) => Promise<void>
}

/**
 * 选中至少一本书时出现的批量管理条。
 *
 * 每个动作都走 zustand store 里既有的 action（会落盘），
 * 这里只负责收集参数、给一句中文提示，不直接碰 libraryApi。
 */
export function ShelfBatchBar({
  books,
  shelves,
  commonTags,
  styles,
  visibleCount,
  onSelectAllVisible,
  onClear,
  onDelete,
  onMove,
  onAddTags,
  onRemoveTag,
  onApplyStyle,
  onRate,
  onSetSeries,
  onSetAuthor,
  onSetStatus
}: BatchBarProps): ReactNode {
  const [panel, setPanel] = useState<BatchPanel | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [deleteFiles, setDeleteFiles] = useState(false)
  const [tagText, setTagText] = useState('')
  const [removeTag, setRemoveTag] = useState('')
  const [shelfPick, setShelfPick] = useState('')
  const [stylePick, setStylePick] = useState('')
  const [seriesText, setSeriesText] = useState('')
  const [authorText, setAuthorText] = useState('')
  const [busy, setBusy] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  const count = books.length

  useEffect(() => {
    if (!panel) return
    const onDown = (event: MouseEvent): void => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setPanel(null)
    }
    const onKey = (event: KeyboardEvent): void => {
      // 删除确认弹窗自己也听着 Esc，别把两层一起关掉
      if (event.key === 'Escape' && !confirmOpen) setPanel(null)
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [panel, confirmOpen])

  // 选中项变化时收起展开的面板，避免对着上一批书继续操作
  useEffect(() => setPanel(null), [count])
  useEffect(() => {
    if (removeTag && !commonTags.includes(removeTag)) setRemoveTag('')
  }, [commonTags, removeTag])

  const togglePanel = (next: BatchPanel): void => setPanel((current) => (current === next ? null : next))

  const run = async (task: () => Promise<void>): Promise<void> => {
    setBusy(true)
    try {
      await task()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="batch-bar" ref={rootRef}>
      <div className="batch-lead">
        <span className="batch-count">已选 {count} 本</span>
        <button
          type="button"
          className="batch-all"
          onClick={onSelectAllVisible}
          title="把当前筛选、排序下能看到的书全部选中"
        >
          <IconChecklist size={13} />
          全选可见（{visibleCount} 本）
        </button>
      </div>

      <span className="batch-hint">Ctrl / Shift + 单击加减选择 · Esc 清除</span>

      <span className="batch-spacer" />

      <div className="batch-actions">
        <Button
          size="sm"
          variant="danger"
          icon={<IconTrash size={13} />}
          disabled={busy}
          onClick={() => {
            setDeleteFiles(false)
            setConfirmOpen(true)
          }}
        >
          删除
        </Button>

        <div className="batch-group">
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            data-batch="move"
            onClick={() => togglePanel('move')}
          >
            移动到书架层
          </Button>
          {panel === 'move' ? (
            <div className="batch-pop is-move">
              <span className="batch-pop-title">移动到</span>
              <Select
                value={shelfPick}
                onChange={(value) => setShelfPick(value)}
                options={[
                  { value: '', label: '选择书架层…' },
                  ...shelves.map((shelf) => ({ value: shelf.id, label: shelf.name }))
                ]}
              />
              <div className="batch-pop-foot">
                <Button
                  size="xs"
                  variant="solid"
                  disabled={!shelfPick || busy}
                  onClick={() =>
                    void run(async () => {
                      await onMove(shelfPick)
                      setShelfPick('')
                      setPanel(null)
                    })
                  }
                >
                  移过去
                </Button>
              </div>
            </div>
          ) : null}
        </div>

        <div className="batch-group">
          <Button size="sm" variant="outline" disabled={busy} data-batch="tags" onClick={() => togglePanel('tags')}>
            贴标签
          </Button>
          {panel === 'tags' ? (
            <div className="batch-pop is-tags">
              <span className="batch-pop-title">给这 {count} 本加上标签</span>
              <input
                className="text-input batch-input"
                value={tagText}
                placeholder="多个标签用空格或逗号分开"
                spellCheck={false}
                onChange={(event) => setTagText(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key !== 'Enter' || !tagText.trim() || busy) return
                  void run(async () => {
                    await onAddTags(tagText)
                    setTagText('')
                  })
                }}
              />
              <div className="batch-pop-foot">
                <Button
                  size="xs"
                  variant="solid"
                  disabled={!tagText.trim() || busy}
                  onClick={() =>
                    void run(async () => {
                      await onAddTags(tagText)
                      setTagText('')
                    })
                  }
                >
                  添加
                </Button>
              </div>

              <span className="batch-pop-title is-sub">从这 {count} 本一起移除标签</span>
              {commonTags.length > 0 ? (
                <div className="batch-tag-picks">
                  {commonTags.map((tag) => (
                    <Chip
                      key={tag}
                      active={removeTag === tag}
                      onClick={() => setRemoveTag((current) => (current === tag ? '' : tag))}
                    >
                      {tag}
                    </Chip>
                  ))}
                </div>
              ) : (
                <p className="batch-pop-empty">这些书没有共同的标签</p>
              )}
              <div className="batch-pop-foot">
                <Button
                  size="xs"
                  variant="danger"
                  disabled={!removeTag || busy}
                  onClick={() =>
                    void run(async () => {
                      await onRemoveTag(removeTag)
                      setRemoveTag('')
                    })
                  }
                >
                  移除标签
                </Button>
              </div>
            </div>
          ) : null}
        </div>

        <div className="batch-group">
          <Button size="sm" variant="outline" disabled={busy} data-batch="style" onClick={() => togglePanel('style')}>
            设置样式 / 主题
          </Button>
          {panel === 'style' ? (
            <div className="batch-pop is-style">
              <span className="batch-pop-title">套用样式</span>
              <div className="batch-style-list">
                {styles.map((entry) => (
                  <button
                    key={entry.id}
                    type="button"
                    className={['batch-style-item', stylePick === entry.id ? 'is-active' : ''].filter(Boolean).join(' ')}
                    disabled={busy}
                    onClick={() => setStylePick(entry.id)}
                  >
                    <span className="batch-style-swatch" style={{ background: entry.color }} />
                    <span className="batch-style-name">{entry.name}</span>
                    {entry.enabled ? null : <span className="batch-style-tag">已停用</span>}
                  </button>
                ))}
                <button
                  type="button"
                  className={['batch-style-item', stylePick === BASE_STYLE_PICK ? 'is-active' : ''].filter(Boolean).join(' ')}
                  disabled={busy}
                  onClick={() => setStylePick(BASE_STYLE_PICK)}
                >
                  <span className="batch-style-swatch is-base" />
                  <span className="batch-style-name">跟随基准样式</span>
                </button>
              </div>
              <p className="batch-pop-note">
                「跟随基准样式」会清掉这几本书的单独外观，之后重新跟着设置里的分配方式走。
              </p>
              <div className="batch-pop-foot">
                <Button
                  size="xs"
                  variant="solid"
                  disabled={!stylePick || busy}
                  onClick={() =>
                    void run(async () => {
                      await onApplyStyle(stylePick)
                      setStylePick('')
                      setPanel(null)
                    })
                  }
                >
                  套用
                </Button>
              </div>
            </div>
          ) : null}
        </div>

        <div className="batch-group">
          <Button size="sm" variant="outline" disabled={busy} data-batch="rating" onClick={() => togglePanel('rating')}>
            评分
          </Button>
          {panel === 'rating' ? (
            <div className="batch-pop is-rating">
              <span className="batch-pop-title">设为</span>
              <div className="batch-rating">
                {[1, 2, 3, 4, 5].map((value) => (
                  <button
                    key={value}
                    type="button"
                    className="batch-star"
                    disabled={busy}
                    aria-label={`${value} 星`}
                    onClick={() =>
                      void run(async () => {
                        await onRate(value)
                        setPanel(null)
                      })
                    }
                  >
                    {value} ★
                  </button>
                ))}
              </div>
              <div className="batch-pop-foot">
                <Button
                  size="xs"
                  variant="ghost"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      await onRate(0)
                      setPanel(null)
                    })
                  }
                >
                  清除评分
                </Button>
              </div>
            </div>
          ) : null}
        </div>

        <div className="batch-group">
          <Button size="sm" variant="outline" disabled={busy} data-batch="status" onClick={() => togglePanel('status')}>
            标记状态
          </Button>
          {panel === 'status' ? (
            <div className="batch-pop is-status">
              <span className="batch-pop-title">标记为</span>
              {STATUSES.map((item) => (
                <button
                  key={item.value}
                  type="button"
                  className="batch-status-item"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      await onSetStatus(item.value)
                      setPanel(null)
                    })
                  }
                >
                  {item.label}
                </button>
              ))}
            </div>
          ) : null}
        </div>

        {/*
          批量设置系列与作者。
          同一系列的书会自动用统一的书脊高度（见系列分组），所以"一次给一批书填上系列"
          是整理书架最省事的入口；作者同理，同一作者的书排在一起。
          两项都可留空 = 清空。
        */}
        <div className="batch-group">
          <Button size="sm" variant="outline" disabled={busy} data-batch="meta" onClick={() => togglePanel('meta')}>
            系列 / 作者
          </Button>
          {panel === 'meta' ? (
            <div className="batch-pop is-meta">
              <span className="batch-pop-title">给这 {count} 本设置</span>
              <label className="batch-pop-label">
                系列
                <input
                  className="text-input batch-input"
                  value={seriesText}
                  placeholder="留空 = 清空系列"
                  spellCheck={false}
                  onChange={(event) => setSeriesText(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key !== 'Enter' || busy) return
                    void run(async () => {
                      await onSetSeries(seriesText.trim())
                      setPanel(null)
                    })
                  }}
                />
              </label>
              <label className="batch-pop-label">
                作者
                <input
                  className="text-input batch-input"
                  value={authorText}
                  placeholder="留空 = 清空作者"
                  spellCheck={false}
                  onChange={(event) => setAuthorText(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key !== 'Enter' || busy) return
                    void run(async () => {
                      await onSetAuthor(authorText.trim())
                      setPanel(null)
                    })
                  }}
                />
              </label>
              <div className="batch-pop-foot">
                <Button
                  size="xs"
                  variant="solid"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      await onSetSeries(seriesText.trim())
                      await onSetAuthor(authorText.trim())
                      setPanel(null)
                    })
                  }
                >
                  两项一起应用
                </Button>
                <Button
                  size="xs"
                  variant="outline"
                  disabled={busy || !seriesText.trim()}
                  onClick={() =>
                    void run(async () => {
                      await onSetSeries(seriesText.trim())
                      setPanel(null)
                    })
                  }
                >
                  只设系列
                </Button>
                <Button
                  size="xs"
                  variant="outline"
                  disabled={busy || !authorText.trim()}
                  onClick={() =>
                    void run(async () => {
                      await onSetAuthor(authorText.trim())
                      setPanel(null)
                    })
                  }
                >
                  只设作者
                </Button>
              </div>
            </div>
          ) : null}
        </div>

        <Button size="sm" variant="ghost" onClick={onClear}>
          清除选择
        </Button>
      </div>

      <Modal
        open={confirmOpen}
        title={`删除选中的 ${count} 本书`}
        subtitle="这个操作不可撤销，请先确认下面的选项。"
        width={480}
        className="confirm-modal"
        onClose={() => setConfirmOpen(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmOpen(false)}>
              取消
            </Button>
            <Button
              variant="danger"
              data-confirm="1"
              onClick={() => {
                setConfirmOpen(false)
                void run(() => onDelete(deleteFiles))
              }}
            >
              删除
            </Button>
          </>
        }
      >
        <div className="confirm-body">
          <p className="confirm-message">将从书架移除 {count} 本书。</p>
          <p className="confirm-detail">被移除的书如果还在筛选结果里，会一起从选中列表里去掉。</p>
        </div>
        <CheckRow
          checked={deleteFiles}
          onChange={setDeleteFiles}
          label="同时删除磁盘上的文件"
          detail="默认不勾选：只把书从书架移除，原文件留在藏书目录里。勾选后文件会被永久删除，无法撤销。"
        />
      </Modal>
    </div>
  )
}
