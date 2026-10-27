import { useMemo, type ReactNode } from 'react'
import { THEME_PRESETS, getPreset } from '@shared/themes'
import type { AppSettings, ThemePreset } from '@shared/types'
import { Button, IconButton, SectionTitle, Slider, Switch } from '@/components/common/Controls'
import { IconCheck, IconTrash } from '@/components/icons/Icons'
import { useSettings } from '@/store/useSettings'
import { TEXTURE_LABELS } from './labels'
import { ShelfMock, shelfBooks } from './previews'

export function ShelfThemeTab({ settings }: { settings: AppSettings }): ReactNode {
  const setShelfTheme = useSettings((s) => s.setShelfTheme)
  const deleteCustomTheme = useSettings((s) => s.deleteCustomTheme)
  const patchUi = useSettings((s) => s.patchUi)
  const ui = settings.ui

  const gallery = useMemo<ThemePreset[]>(() => {
    const builtin = THEME_PRESETS.filter((p) => p.kind === 'shelf' || p.kind === 'both')
    const mine = settings.customThemes
      .map((c) => getPreset(c.id, settings.customThemes))
      .filter((p) => p.kind === 'shelf' || p.kind === 'both')
    return [...builtin, ...mine]
  }, [settings.customThemes])

  const active = getPreset(settings.shelfTheme, settings.customThemes)
  // 每层摆几本不再由设置决定（书架按宽度 + 厚度自动填满整行），小样固定摆一排
  const previewBooks = shelfBooks(12, ui, 'shelf-live')

  return (
    <div className={`set-tab ${ui.animate ? '' : 'set-no-anim'}`}>
      <section className="set-block">
        <SectionTitle hint={`共 ${gallery.length} 套书架主题 · 背板、格内阴影与木料都在这里换`}>书架画廊</SectionTitle>
        <div className="set-gallery">
          {gallery.map((preset) => {
            const on = preset.id === settings.shelfTheme
            const mine = settings.customThemes.some((t) => t.id === preset.id)
            return (
              <article key={preset.id} className={`set-theme-card ${on ? 'is-active' : ''}`}>
                <button
                  type="button"
                  className="set-theme-hit"
                  aria-pressed={on}
                  onClick={() => void setShelfTheme(preset.id)}
                >
                  <ShelfMock preset={preset} books={shelfBooks(4, undefined, preset.id)} height={104} />
                  <span className="set-theme-meta">
                    <span className="set-theme-name">
                      {preset.name}
                      <span className="set-tag">{TEXTURE_LABELS[preset.texture]}</span>
                      {mine ? <span className="set-tag">自定义</span> : null}
                    </span>
                    <span className="set-theme-desc">{preset.description}</span>
                  </span>
                </button>
                {on ? <span className="set-check" title="当前生效"><IconCheck size={13} /></span> : null}
                {mine ? (
                  <span className="set-theme-del">
                    <IconButton label="删除这套主题" tone="muted" onClick={() => void deleteCustomTheme(preset.id)}>
                      <IconTrash size={14} />
                    </IconButton>
                  </span>
                ) : null}
              </article>
            )
          })}
        </div>
      </section>

      <section className="set-block">
        <SectionTitle
          hint="摆法只影响书架视图，不会改动书库数据"
          action={
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                void patchUi({
                  shelfRowHeight: 250,
                  /* 两种朝向各有一份层高，恢复默认要一起归位 */
                  shelfRowHeightCover: 250,
                  shelfTilt: 0.35,
                  bookHeightVariation: 0.09,
                  showPlaque: true,
                  showShadow: true,
                  animate: true
                })
              }
            >
              恢复默认摆法
            </Button>
          }
        >
          尺寸与摆法
        </SectionTitle>
        <div className="set-split">
          <div className="set-split-preview">
            <ShelfMock
              preset={active}
              books={previewBooks}
              showPlaque={ui.showPlaque}
              showShadow={ui.showShadow}
              height={Math.round((ui.bookFacing === 'cover' ? ui.shelfRowHeightCover : ui.shelfRowHeight) * 0.38)}
              plankLabel="正在预览"
            />
            <p className="set-hint">
              当前：每层 {ui.bookFacing === 'cover' ? ui.shelfRowHeightCover : ui.shelfRowHeight} px、错落 {Math.round(ui.shelfTilt * 100)}%、
              高低差 {Math.round(ui.bookHeightVariation * 100)}%
            </p>
          </div>

          <div className="set-fields">
            <div className="set-field">
              <span className="set-field-label">
                每层高度（{ui.bookFacing === 'cover' ? '封面' : '书脊'}）
              </span>
              <Slider
                /* 与「书架」页同一个字段：两种朝向各存各的层高 */
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
              <span className="set-field-label">高低错落</span>
              <Slider
                value={ui.bookHeightVariation}
                min={0}
                max={0.3}
                step={0.01}
                onChange={(value) => void patchUi({ bookHeightVariation: value })}
                format={(value) => (value <= 0 ? '等高' : `${Math.round(value * 100)}%`)}
              />
            </div>
            {/*
              封面朝外的两档单独放。
              那边宽度 = 封面比例 × 高度（这样封面才完整），所以错落是整体缩放封面，
              和书脊"只改高矮"不是一回事 —— 共用一个值会顺手把封面也放大缩小。
            */}
            <div className="set-field">
              <span className="set-field-label" title="封面朝外时的封面大小（1 = 铺满书架可用高度）">
                封面大小
              </span>
              <Slider
                value={ui.coverHeightScale}
                min={0.6}
                max={1.3}
                step={0.02}
                onChange={(value) => void patchUi({ coverHeightScale: value })}
                format={(value) => `${Math.round(value * 100)}%`}
              />
            </div>
            <div className="set-field">
              <span className="set-field-label" title="封面朝外时，不同系列之间的封面大小差异（同系列始终一致）">
                封面错落
              </span>
              <Slider
                value={ui.coverHeightVariation}
                min={0}
                max={0.3}
                step={0.01}
                onChange={(value) => void patchUi({ coverHeightVariation: value })}
                format={(value) => (value <= 0 ? '等高' : `${Math.round(value * 100)}%`)}
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
              <span className="set-field-label">动画</span>
              <Switch checked={ui.animate} onChange={(checked) => void patchUi({ animate: checked })} />
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}
