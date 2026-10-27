/**
 * 设置 · 书籍外观编辑件
 *
 * 书脊样式的编辑面板与「外观 · 书籍样式」改的是同一个 BookStyle 形状，
 * 所以把这些表单块抽出来共用一份，避免两处各写一套颜色控件。
 * 这一组组件是"受控"的：只管显示 value、把改动交给 onChange，
 * 持久化（走 useSettings().patch）由调用方决定。
 */

import { useMemo, type ReactNode } from 'react'
import { SPINE_PRESET_COLORS, mix } from '@shared/themes'
import { imageSrc } from '@shared/noteUrl'
import type { BookStyle, SpineCurve } from '@shared/types'
import {
  Button,
  ColorInput,
  SectionTitle,
  Segmented,
  Select,
  Slider,
  Switch,
  type Option
} from '@/components/common/Controls'
import { IconImage } from '@/components/icons/Icons'
import { formatPages, truncate } from '@/lib/format'
import { spineWidthFor } from '@/lib/theme'
import {
  COVER_PRESET_HINTS,
  COVER_PRESET_LABELS,
  COVER_PRESETS,
  FONT_CHOICES,
  FONT_SANS_UI,
  FONT_SERIF_SC,
  ORNAMENT_HINTS,
  ORNAMENT_LABELS,
  ORNAMENTS,
  SAMPLE_BOOKS,
  SPINE_PRESET_HINTS,
  SPINE_PRESET_LABELS,
  SPINE_PRESETS
} from './labels'
import { CoverView, SpineView, Swatch } from './previews'

/** 小样：只换一个维度，其它保持当前的选择 */
export function demoStyle(style: BookStyle, patch: Partial<BookStyle>): BookStyle {
  return { ...style, ...patch, spineImage: patch.spineImage === undefined ? null : patch.spineImage }
}

/* ------------------------------------------------------------ 书脊预设 */

/**
 * 一键风格：把「工艺 + 装饰 + 字体 + 配色 + 封面」这一整套一次配齐。
 *
 * 单看「书脊预设」列表很难意识到"现代"是可以用一套组合表达出来的
 * —— 平板书脊配竹节烫金并不现代。这里给三条成型的路子，
 * 之后仍然可以逐项微调。
 */
export const STYLE_QUICK_PICKS: {
  id: string
  label: string
  hint: string
  patch: Partial<BookStyle>
}[] = [
  {
    id: 'classic',
    label: '古典藏书',
    hint: '皮革烫金 · 竹节 · 中文衬线',
    patch: {
      spinePreset: 'leather',
      ornament: 'ribs',
      spineColor: '#6b2f26',
      spineColor2: '#4a1d17',
      spineTextColor: '#f3e0b8',
      foilColor: '#d6b26a',
      coverPreset: 'classic',
      coverColor: '#6b2f26',
      coverColor2: '#3f1d16',
      coverTextColor: '#f3e0b8',
      fontFamily: FONT_SERIF_SC,
      showFormatIcon: true
    }
  },
  {
    id: 'modern',
    label: '现代书房',
    hint: '平板书脊 · 无装饰 · 无衬线字',
    patch: {
      spinePreset: 'flat',
      ornament: 'none',
      spineColor: '#3d4757',
      spineColor2: '#333c4a',
      spineTextColor: '#f2f4f8',
      foilColor: '#8fa3c4',
      coverPreset: 'plain',
      coverColor: '#3d4757',
      coverColor2: '#2b3340',
      coverTextColor: '#f2f4f8',
      fontFamily: FONT_SANS_UI,
      showFormatIcon: true
    }
  },
  {
    id: 'minimal',
    label: '极简纸本',
    hint: '纸质平装 · 纸质标签 · 无衬线字',
    patch: {
      spinePreset: 'paper',
      ornament: 'none',
      spineColor: '#e7dcc4',
      spineColor2: '#d8cbb0',
      spineTextColor: '#3f3527',
      foilColor: '#b08a52',
      coverPreset: 'minimal',
      coverColor: '#efe7d6',
      coverColor2: '#ded2ba',
      coverTextColor: '#3f3527',
      fontFamily: FONT_SANS_UI,
      showFormatIcon: false
    }
  }
]

export function StyleQuickPicks({
  onChange
}: {
  value: BookStyle
  onChange: (patch: Partial<BookStyle>) => void
}): ReactNode {
  return (
    <section className="set-block">
      <SectionTitle hint="一次配齐工艺、装饰、字体、配色与封面；套用后仍可逐项微调">
        一键风格
      </SectionTitle>
      <div className="set-picker">
        {STYLE_QUICK_PICKS.map((pick) => (
          <button
            key={pick.id}
            type="button"
            className="set-picker-item"
            onClick={() => onChange(pick.patch)}
          >
            <SpineView
              style={demoStyle({ ...pick.patch } as BookStyle, {})}
              pages={260}
              title="书脊"
              width={30}
              height={62}
            />
            <span className="set-picker-name">{pick.label}</span>
            <span className="set-picker-hint">{pick.hint}</span>
          </button>
        ))}
      </div>
    </section>
  )
}

export function SpinePresetPicker({
  value,
  onChange
}: {
  value: BookStyle
  onChange: (patch: Partial<BookStyle>) => void
}): ReactNode {
  return (
    <section className="set-block">
      <SectionTitle hint="换的是书脊的工艺，颜色另行调整">书脊预设</SectionTitle>
      <div className="set-picker">
        {SPINE_PRESETS.map((preset) => (
          <button
            key={preset}
            type="button"
            className={`set-picker-item ${value.spinePreset === preset ? 'is-active' : ''}`}
            aria-pressed={value.spinePreset === preset}
            onClick={() => onChange({ spinePreset: preset })}
          >
            <SpineView style={demoStyle(value, { spinePreset: preset })} pages={260} title="书脊" width={30} height={62} />
            <span className="set-picker-name">{SPINE_PRESET_LABELS[preset]}</span>
            <span className="set-picker-hint">{SPINE_PRESET_HINTS[preset]}</span>
          </button>
        ))}
      </div>
    </section>
  )
}

/* ---------------------------------------------------------------- 颜色 */

const COLOR_ROWS: { key: keyof BookStyle; label: string; hint?: string }[] = [
  { key: 'spineColor', label: '书脊底色', hint: '颜色决定它在架上的脾气' },
  { key: 'spineColor2', label: '书脊第二色' },
  { key: 'spineTextColor', label: '书脊文字' },
  { key: 'foilColor', label: '烫金 / 描边' },
  { key: 'coverColor', label: '封面底色' },
  { key: 'coverColor2', label: '封面第二色' },
  { key: 'coverTextColor', label: '封面文字' }
]

export function BookColorFields({
  value,
  onChange,
  showCover = true
}: {
  value: BookStyle
  onChange: (patch: Partial<BookStyle>) => void
  showCover?: boolean
}): ReactNode {
  const rows = showCover ? COLOR_ROWS : COLOR_ROWS.slice(0, 4)
  return (
    <section className="set-block">
      <SectionTitle hint="书脊色、烫金与封面都在这里；点下面的色板可以套用该预设的推荐配色">颜色</SectionTitle>
      <div className="set-tokens">
        {rows.map((row) => (
          <div className="set-token" key={row.key}>
            <span className="set-token-head">
              <span className="set-token-label">{row.label}</span>
              <code className="set-token-key">{row.key}</code>
            </span>
            <ColorInput
              value={String(value[row.key] ?? '#000000')}
              label={row.label}
              onChange={(next) => onChange({ [row.key]: next } as Partial<BookStyle>)}
            />
            {row.hint ? <span className="set-token-hint">{row.hint}</span> : null}
          </div>
        ))}
      </div>
      {showCover ? (
        <div className="set-recommend">
          <span className="set-recommend-label">「{SPINE_PRESET_LABELS[value.spinePreset]}」推荐配色</span>
          {SPINE_PRESET_COLORS[value.spinePreset].map((color) => (
            <button
              key={color}
              type="button"
              className="set-recommend-dot"
              title={`使用 ${color}`}
              onClick={() =>
                onChange({
                  spineColor: color,
                  spineColor2: mix(color, '#000000', 0.28),
                  coverColor: color,
                  coverColor2: mix(color, '#000000', 0.4)
                })
              }
            >
              <Swatch color={color} size={18} />
            </button>
          ))}
        </div>
      ) : null}
    </section>
  )
}

/* ------------------------------------------------------------ 书脊装饰 */

export function OrnamentPicker({
  value,
  onChange
}: {
  value: BookStyle
  onChange: (patch: Partial<BookStyle>) => void
}): ReactNode {
  return (
    <section className="set-block">
      <SectionTitle hint="书脊上的压印花样">书脊装饰</SectionTitle>
      <div className="set-picker set-picker-tight">
        {ORNAMENTS.map((ornament) => (
          <button
            key={ornament}
            type="button"
            className={`set-picker-item ${value.ornament === ornament ? 'is-active' : ''}`}
            aria-pressed={value.ornament === ornament}
            onClick={() => onChange({ ornament })}
          >
            <SpineView
              style={demoStyle(value, { ornament, showFormatIcon: false })}
              pages={260}
              title="装饰"
              width={30}
              height={62}
            />
            <span className="set-picker-name">{ORNAMENT_LABELS[ornament]}</span>
            <span className="set-picker-hint">{ORNAMENT_HINTS[ornament]}</span>
          </button>
        ))}
      </div>
    </section>
  )
}

/* ------------------------------------------------------------ 封面预设 */

export function CoverPresetPicker({
  value,
  onChange
}: {
  value: BookStyle
  onChange: (patch: Partial<BookStyle>) => void
}): ReactNode {
  return (
    <section className="set-block">
      <SectionTitle hint="书脊之外，翻开书会看到的那一面">封面预设</SectionTitle>
      <div className="set-picker set-picker-tight">
        {COVER_PRESETS.map((preset) => (
          <button
            key={preset}
            type="button"
            className={`set-picker-item ${value.coverPreset === preset ? 'is-active' : ''}`}
            aria-pressed={value.coverPreset === preset}
            onClick={() => onChange({ coverPreset: preset })}
          >
            <CoverView style={demoStyle(value, { coverPreset: preset })} width={52} title="书香" />
            <span className="set-picker-name">{COVER_PRESET_LABELS[preset]}</span>
            <span className="set-picker-hint">{COVER_PRESET_HINTS[preset]}</span>
          </button>
        ))}
      </div>
    </section>
  )
}

/* -------------------------------------------------------- 厚度与排版 */

export function ThicknessFields({
  value,
  onChange
}: {
  value: BookStyle
  onChange: (patch: Partial<BookStyle>) => void
}): ReactNode {
  const manual = value.spineWidthOverride !== null
  const widths = SAMPLE_BOOKS.map((book) => spineWidthFor(book.pages, value))

  const fontOptions = useMemo<Option<string>[]>(() => {
    const list: Option<string>[] = FONT_CHOICES.map((choice) => ({
      value: choice.value,
      label: choice.label,
      hint: choice.hint
    }))
    if (!FONT_CHOICES.some((choice) => choice.value === value.fontFamily)) {
      list.push({ value: value.fontFamily, label: `当前（${truncate(value.fontFamily, 20)}）` })
    }
    return list
  }, [value.fontFamily])

  return (
    <section className="set-block">
      <SectionTitle
        hint={`当前：${formatPages(24, true)} → ${widths[0]} px，${formatPages(940, true)} → ${widths[2]} px`}
      >
        厚度与排版
      </SectionTitle>
      <div className="set-fields">
        <div className="set-field">
          <span className="set-field-label">厚度倍率</span>
          <Slider
            value={value.thicknessScale}
            min={0.4}
            max={2}
            step={0.05}
            onChange={(next) => onChange({ thicknessScale: next })}
            format={(next) => `${next.toFixed(2)}×`}
          />
        </div>
        <div className="set-field">
          <span className="set-field-label">手动指定厚度</span>
          <Switch
            checked={manual}
            onChange={(checked) => onChange({ spineWidthOverride: checked ? (value.spineWidthOverride ?? 48) : null })}
          />
          {manual ? (
            <Slider
              value={value.spineWidthOverride ?? 48}
              min={18}
              max={140}
              step={1}
              onChange={(next) => onChange({ spineWidthOverride: next })}
              format={(next) => `${next} px`}
            />
          ) : (
            <span className="set-field-hint">0 = 自动，由页数决定</span>
          )}
        </div>
        <div className="set-field">
          <span className="set-field-label">书脊倾角</span>
          <Slider
            value={value.tilt}
            min={-12}
            max={12}
            step={1}
            onChange={(next) => onChange({ tilt: next })}
            format={(next) => `${next}°`}
          />
        </div>
        <div className="set-field">
          <span className="set-field-label">书名方向</span>
          <Segmented
            value={value.spineTextDirection}
            onChange={(next) => onChange({ spineTextDirection: next })}
            options={[
              { value: 'vertical', label: '竖排' },
              { value: 'horizontal', label: '横排' }
            ]}
          />
        </div>
        <div className="set-field">
          <span className="set-field-label">显示格式图标</span>
          <Switch checked={value.showFormatIcon} onChange={(checked) => onChange({ showFormatIcon: checked })} />
        </div>
        <div className="set-field">
          <span className="set-field-label" title="平板装帧与贴了自己的书脊图时，自动就是平直的">
            书脊弧度
          </span>
          <Segmented<SpineCurve>
            value={value.spineCurve ?? 'auto'}
            onChange={(next) => onChange({ spineCurve: next })}
            options={[
              { value: 'auto', label: '自动' },
              { value: 'curved', label: '有' },
              { value: 'flat', label: '平直' }
            ]}
          />
        </div>
        <div className="set-field">
          <span className="set-field-label">书脊字体</span>
          <Select value={value.fontFamily} onChange={(next) => onChange({ fontFamily: next })} options={fontOptions} />
        </div>
      </div>
    </section>
  )
}

/* ---------------------------------------------------------------- 贴图 */

/**
 * 书脊贴图 / 封面图共用的选择器。
 *
 * 图片以 `asset:<文件名>` 的形式存在数据目录里，不能直接丢进 `<img src>`，
 * 必须先过一遍 imageSrc() 换成 asset:// 地址（历史数据里的内联 data URL 也能兼容）。
 */
export function StyleImageField({
  kind,
  value,
  onChange,
  picking,
  onPick
}: {
  kind: 'spine' | 'cover'
  value: BookStyle
  onChange: (patch: Partial<BookStyle>) => void
  picking: boolean
  onPick: () => void
}): ReactNode {
  const isSpine = kind === 'spine'
  const field = isSpine ? 'spineImage' : 'coverImage'
  const current = value[field]
  return (
    <section className="set-block">
      <SectionTitle hint={isSpine ? '选一张图片当作书脊材质' : '选一张图片当作封面'}>
        {isSpine ? '书脊贴图' : '封面图片'}
      </SectionTitle>
      <div className="set-image-row">
        <span className={['set-image-thumb', isSpine ? 'is-spine' : 'is-cover'].filter(Boolean).join(' ')}>
          {current ? (
            <img src={imageSrc(current)} alt={isSpine ? '书脊贴图' : '封面图片'} />
          ) : (
            <span className="set-image-empty">
              <IconImage size={22} />
            </span>
          )}
        </span>
        <div className="set-image-actions">
          <Button variant="outline" icon={<IconImage size={14} />} disabled={picking} onClick={onPick}>
            {picking ? '正在选择…' : '选择图片'}
          </Button>
          <Button
            variant="ghost"
            disabled={!current}
            onClick={() => onChange({ [field]: null } as Partial<BookStyle>)}
          >
            清除
          </Button>
          <p className="set-hint">
            {isSpine
              ? '建议使用竖向长条图（例如 200 × 1200），会按比例铺满书脊，并复制进数据目录。'
              : '建议使用 2:3 的竖图（例如 600 × 900）。设置后书架上的封面陈列与抽出预览都会用它。'}
          </p>
        </div>
      </div>
    </section>
  )
}

export function SpineImageField(props: {
  value: BookStyle
  onChange: (patch: Partial<BookStyle>) => void
  picking: boolean
  onPick: () => void
}): ReactNode {
  return <StyleImageField kind="spine" {...props} />
}
