import { useMemo, useState, type ReactNode } from 'react'
import { THEME_PRESETS } from '@shared/themes'
import { FORMAT_LABEL, type AppSettings, type BookFacing, type BookFormat, type BookStatus, type HeightMode, type ShelfSortMode } from '@shared/types'
import {
  Button,
  Chip,
  SectionTitle,
  Segmented,
  Select,
  Slider,
  Switch,
  TextInput,
  type Option
} from '@/components/common/Controls'
import { heightModePatch } from '@/lib/theme'
import { useSettings } from '@/store/useSettings'
import {
  BOOK_FACINGS,
  BOOK_FACING_HINTS,
  BOOK_FACING_LABELS,
  BOOK_STATUSES,
  BOOK_STATUS_LABELS,
  FILTER_FORMATS,
  HEIGHT_MODE_HINTS,
  HEIGHT_MODE_LABELS,
  HEIGHT_MODES,
  SHELF_LAYOUTS,
  SHELF_LAYOUT_HINTS,
  SHELF_LAYOUT_LABELS,
  SHELF_SORT_HINTS,
  SHELF_SORT_LABELS,
  SHELF_SORTS
} from './labels'
import { ShelfMock, shelfBooks } from './previews'

/** 朝向示意图：俯视一层书架，一本小书按角度"倒"下来或立起来 */
function FacingDiagram({ angle, facing }: { angle: number; facing: BookFacing }): ReactNode {
  const tilt = facing === 'spine' ? 0 : facing === 'cover' ? 90 : angle
  return (
    <div className="set-facing" aria-hidden="true">
      <span className="set-facing-label">俯视一层书架</span>
      <span className="set-facing-back" />
      <span className="set-facing-book" style={{ transform: `translate(-50%, -50%) rotate(${-tilt}deg)` }} />
      <span className="set-facing-plank" />
      <span className="set-facing-hint">
        {tilt}° · {tilt === 0 ? '正对书脊' : tilt === 90 ? '正对封面' : '斜着摆'}
      </span>
    </div>
  )
}

export function ShelfTab({ settings }: { settings: AppSettings }): ReactNode {
  const patchUi = useSettings((s) => s.patchUi)
  const shelfPreset = useSettings((s) => s.runtime?.shelf ?? THEME_PRESETS[0])
  const ui = settings.ui
  const [tagDraft, setTagDraft] = useState(ui.filterTags.join(', '))

  const sortOptions = useMemo<Option<ShelfSortMode>[]>(
    () => SHELF_SORTS.map((item) => ({ value: item, label: SHELF_SORT_LABELS[item], hint: SHELF_SORT_HINTS[item] })),
    []
  )

  // 每层摆几本不再由设置决定：书架按可用宽度 + 每本书的厚度自动填满整行，
  // 这里的小样固定摆一排，只用来预览朝向与错落。
  const previewBooks = shelfBooks(12, ui, 'shelf-order-live')

  const toggleFormat = (format: BookFormat): void => {
    const next = ui.filterFormats.includes(format)
      ? ui.filterFormats.filter((item) => item !== format)
      : [...ui.filterFormats, format]
    void patchUi({ filterFormats: next })
  }

  const toggleStatus = (status: BookStatus): void => {
    const next = ui.filterStatus.includes(status)
      ? ui.filterStatus.filter((item) => item !== status)
      : [...ui.filterStatus, status]
    void patchUi({ filterStatus: next })
  }

  const commitTags = (): void => {
    const tags = tagDraft
      .split(',')
      .map((tag) => tag.trim())
      .filter(Boolean)
    void patchUi({ filterTags: tags })
  }

  return (
    <div className={`set-tab ${ui.animate ? '' : 'set-no-anim'}`}>
      <section className="set-block">
        <SectionTitle hint="朝向与高度决定书架的骨架，下面的小样就是书架上真实的样子">书籍朝向</SectionTitle>
        <div className="set-split">
          <div className="set-split-preview">
            {/* 示意图按朝向摆正；'angled' 已删除，不再需要角度参数 */}
            <FacingDiagram angle={0} facing={ui.bookFacing} />
            <ShelfMock
              preset={shelfPreset}
              books={previewBooks}
              showPlaque={ui.showPlaque}
              showShadow={ui.showShadow}
              height={Math.round(
                (ui.bookFacing === 'cover' ? ui.shelfRowHeightCover : ui.shelfRowHeight) * 0.36
              )}
              plankLabel="正在预览"
            />
          </div>

          <div className="set-fields">
            <div className="set-field">
              <span className="set-field-label">书籍朝向</span>
              <Segmented
                value={ui.bookFacing}
                onChange={(value) => void patchUi({ bookFacing: value })}
                options={BOOK_FACINGS.map((item) => ({
                  value: item,
                  label: BOOK_FACING_LABELS[item],
                  title: BOOK_FACING_HINTS[item]
                }))}
              />
              <span className="set-field-hint">{BOOK_FACING_HINTS[ui.bookFacing]}</span>
            </div>

            <div className="set-field">
              <span className="set-field-label">书籍高度</span>
              <Segmented
                value={ui.heightMode}
                onChange={(value: HeightMode) => void patchUi(heightModePatch(value))}
                options={HEIGHT_MODES.map((item) => ({
                  value: item,
                  label: HEIGHT_MODE_LABELS[item],
                  title: HEIGHT_MODE_HINTS[item]
                }))}
              />
              <span className="set-field-hint">{HEIGHT_MODE_HINTS[ui.heightMode]}</span>
            </div>

            <div className="set-field">
              <span className="set-field-label">书架层排布</span>
              <Segmented
                value={ui.shelfLayout}
                onChange={(value) => void patchUi({ shelfLayout: value })}
                options={SHELF_LAYOUTS.map((item) => ({
                  value: item,
                  label: SHELF_LAYOUT_LABELS[item],
                  title: SHELF_LAYOUT_HINTS[item]
                }))}
              />
              <span className="set-field-hint">{SHELF_LAYOUT_HINTS[ui.shelfLayout]}</span>
            </div>

            {ui.shelfLayout === 'continuous' ? (
              <div className="set-field">
                <span className="set-field-label">单层最大宽度</span>
                <Slider
                  value={ui.shelfBayMaxWidth}
                  min={480}
                  max={1400}
                  step={20}
                  onChange={(value) => void patchUi({ shelfBayMaxWidth: value })}
                  format={(value) => `${value} px`}
                />
                <span className="set-field-hint">单层超过这个宽度会自动换行，各层紧挨着排成一面整墙。</span>
              </div>
            ) : null}

            <div className="set-field">
              <span className="set-field-label">
                每层高度（{ui.bookFacing === 'cover' ? '封面' : '书脊'}）
              </span>
              <Slider
                /*
                 * 两种朝向各存各的高度：书脊模式靠加大层高把书名看清，
                 * 封面模式本来就是大图，层高太大会挤掉藏书量。
                 */
                value={ui.bookFacing === 'cover' ? ui.shelfRowHeightCover : ui.shelfRowHeight}
                min={180}
                max={ui.bookFacing === 'cover' ? 420 : 560}
                step={5}
                onChange={(value) =>
                  void patchUi(
                    ui.bookFacing === 'cover'
                      ? { shelfRowHeightCover: value }
                      : { shelfRowHeight: value }
                  )
                }
                format={(value) => `${value} px`}
              />
              <span className="set-field-hint">
                书脊模式可以调到 560 px，好把书脊上的字看清；两种朝向分开记。
              </span>
            </div>

            <div className="set-field">
              <span className="set-field-label">书脊错落</span>
              <Slider
                value={ui.shelfTilt}
                min={0}
                max={1}
                step={0.05}
                onChange={(value) => void patchUi({ shelfTilt: value })}
                format={(value) => (value <= 0 ? '整齐' : `${Math.round(value * 100)}%`)}
              />
            </div>

            <div className="set-field">
              <span className="set-field-label">书名铭牌</span>
              <Switch checked={ui.showPlaque} onChange={(checked) => void patchUi({ showPlaque: checked })} />
            </div>

            <div className="set-field">
              <span className="set-field-label">书影</span>
              <Switch checked={ui.showShadow} onChange={(checked) => void patchUi({ showShadow: checked })} />
            </div>

            <div className="set-field">
              <span className="set-field-label">在书架上显示阅读进度</span>
              <Switch
                checked={ui.showReadingProgress}
                onChange={(checked) => void patchUi({ showReadingProgress: checked })}
              />
              <span className="set-field-hint">
                封面朝外时是封面右下角的圆环，书脊朝外时是书脊左侧的细长进度条；只对书籍生效，笔记不显示。
              </span>
            </div>
          </div>
        </div>
      </section>

      <section className="set-block">
        <SectionTitle hint="排序只改变显示顺序，不会动书库里的任何数据">排序</SectionTitle>
        <div className="set-fields">
          <div className="set-field">
            <span className="set-field-label">排序方式</span>
            <Select value={ui.shelfSort} onChange={(value) => void patchUi({ shelfSort: value })} options={sortOptions} />
            <span className="set-field-hint">{SHELF_SORT_HINTS[ui.shelfSort]}</span>
          </div>
          <div className="set-field">
            <span className="set-field-label">倒序</span>
            <Switch checked={ui.shelfSortDesc} onChange={(checked) => void patchUi({ shelfSortDesc: checked })} />
            <span className="set-field-hint">把上面这条排序反过来排一遍。</span>
          </div>
        </div>
        <p className="set-callout">
          只有「默认（手动）」可以自由拖拽排序；在其他排序下拖动会把当前顺序固化成新的默认顺序。
        </p>
      </section>

      <section className="set-block">
        <SectionTitle hint="每次打开书架时筛选栏的初始状态，空了就是不筛">筛选默认值</SectionTitle>

        <div className="set-filter-group">
          <span className="set-filter-label">
            格式
            {ui.filterFormats.length > 0 ? <span className="set-tag is-on">{ui.filterFormats.length} 项</span> : <span className="set-tag">不限</span>}
          </span>
          <div className="set-chips">
            {FILTER_FORMATS.map((format) => (
              <Chip key={format} active={ui.filterFormats.includes(format)} onClick={() => toggleFormat(format)}>
                {FORMAT_LABEL[format]}
              </Chip>
            ))}
          </div>
          <button type="button" className="set-link" disabled={ui.filterFormats.length === 0} onClick={() => void patchUi({ filterFormats: [] })}>
            清空格式筛选
          </button>
        </div>

        <div className="set-filter-group">
          <span className="set-filter-label">
            阅读状态
            {ui.filterStatus.length > 0 ? <span className="set-tag is-on">{ui.filterStatus.length} 项</span> : <span className="set-tag">不限</span>}
          </span>
          <div className="set-chips">
            {BOOK_STATUSES.map((status) => (
              <Chip key={status} active={ui.filterStatus.includes(status)} onClick={() => toggleStatus(status)}>
                {BOOK_STATUS_LABELS[status]}
              </Chip>
            ))}
          </div>
          <button type="button" className="set-link" disabled={ui.filterStatus.length === 0} onClick={() => void patchUi({ filterStatus: [] })}>
            清空状态筛选
          </button>
        </div>

        <div className="set-filter-group">
          <span className="set-filter-label">标签</span>
          <div className="set-inline-add">
            <TextInput
              value={tagDraft}
              placeholder="例如：待读, 论文, 工具书"
              onChange={(event) => setTagDraft(event.target.value)}
              onBlur={commitTags}
              onKeyDown={(event) => {
                if (event.key === 'Enter') commitTags()
              }}
            />
            <Button variant="outline" onClick={commitTags}>
              应用标签
            </Button>
          </div>
          <p className="set-hint">用逗号分隔多个标签；留空表示不按标签筛。</p>
          {ui.filterTags.length > 0 ? (
            <div className="set-chips">
              {ui.filterTags.map((tag) => (
                <Chip key={tag} onRemove={() => void patchUi({ filterTags: ui.filterTags.filter((item) => item !== tag) })}>
                  {tag}
                </Chip>
              ))}
            </div>
          ) : null}
        </div>

        <div className="set-filter-group">
          <span className="set-filter-label">最低评分</span>
          <div className="set-range-row">
            <Slider
              value={ui.filterMinRating}
              min={0}
              max={5}
              step={1}
              onChange={(value) => void patchUi({ filterMinRating: value })}
              format={(value) => (value <= 0 ? '不限' : `${value} 星以上`)}
            />
          </div>
          <p className="set-hint">只显示评分不低于这个值的书；0 表示把没打分的也算进来。</p>
        </div>
      </section>
    </div>
  )
}
