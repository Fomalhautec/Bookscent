import { useMemo, useState, type ReactNode } from 'react'
import type { AppSettings, UiSettings } from '@shared/types'
import { SectionTitle, Segmented, Select, Slider, Switch, type Option } from '@/components/common/Controls'
import { truncate } from '@/lib/format'
import { PAGE_FLIP_OPTIONS } from '@/features/reader/pageFlip'
import { TtsSettingsBlock } from './TtsSettingsBlock'
import { useSettings } from '@/store/useSettings'
import { EDITOR_FONT_CHOICES, PDF_ZOOM_CHOICES, type PdfZoomValue } from './labels'

function encodeZoom(zoom: UiSettings['pdfDefaultZoom']): PdfZoomValue {
  return typeof zoom === 'number' ? (String(zoom) as PdfZoomValue) : zoom
}

function decodeZoom(value: PdfZoomValue): UiSettings['pdfDefaultZoom'] {
  if (value === 'auto' || value === 'page-fit' || value === 'page-width') return value
  return Number(value)
}

export function ReadingTab({ settings }: { settings: AppSettings }): ReactNode {
  const patchUi = useSettings((s) => s.patchUi)
  const ui = settings.ui
  const [sampleOpen, setSampleOpen] = useState(true)

  const fontOptions = useMemo<Option<string>[]>(() => {
    const list: Option<string>[] = EDITOR_FONT_CHOICES.map((choice) => ({
      value: choice.value,
      label: choice.label,
      hint: choice.hint
    }))
    if (!EDITOR_FONT_CHOICES.some((choice) => choice.value === ui.editorFontFamily)) {
      list.push({ value: ui.editorFontFamily, label: `当前（${truncate(ui.editorFontFamily, 20)}）` })
    }
    return list
  }, [ui.editorFontFamily])

  const flipHint = PAGE_FLIP_OPTIONS.find((item) => item.value === ui.pageFlipAnimation)?.hint ?? ''

  return (
    <div className="set-tab">
      <section className="set-block">
        <SectionTitle hint="编辑器与 PDF 阅读器都会读取这里的值">阅读与编辑</SectionTitle>
        <div className="set-split">
          <div className="set-split-preview">
            <div className="set-sample">
              <div className="set-sample-bar">
                <span className="set-sample-title">灯下随笔 · 第一章</span>
                <button type="button" className="set-sample-toggle" onClick={() => setSampleOpen((open) => !open)}>
                  {sampleOpen ? '收起' : '展开'}
                </button>
              </div>
              {sampleOpen ? (
                <p
                  className="set-sample-text"
                  style={{
                    fontSize: ui.editorFontSize,
                    lineHeight: ui.editorLineHeight,
                    fontFamily: ui.editorFontFamily
                  }}
                >
                  雨把瓦当敲得很轻。屋里的书依旧按旧日的次序排着，我抽出一本，纸页间还留着上一回夹进去的
                  银杏叶——原来读书这件事，也是要一点点积攒的。
                </p>
              ) : null}
              <div className="set-sample-foot">
                <span>{ui.editorFontSize} px</span>
                <span>行高 {ui.editorLineHeight.toFixed(2)}</span>
                <span>自动保存 {ui.autosave ? `${ui.autosaveDelay} ms` : '关闭'}</span>
              </div>
            </div>
          </div>

          <div className="set-fields">
            <div className="set-field">
              <span className="set-field-label">编辑器字号</span>
              <Slider
                value={ui.editorFontSize}
                min={12}
                max={24}
                step={1}
                onChange={(value) => void patchUi({ editorFontSize: value })}
                format={(value) => `${value} px`}
              />
            </div>
            <div className="set-field">
              <span className="set-field-label">编辑器行高</span>
              <Slider
                value={ui.editorLineHeight}
                min={1.3}
                max={2.4}
                step={0.05}
                onChange={(value) => void patchUi({ editorLineHeight: value })}
                format={(value) => value.toFixed(2)}
              />
            </div>
            <div className="set-field">
              <span className="set-field-label">编辑器字体</span>
              <Select
                value={ui.editorFontFamily}
                onChange={(value) => void patchUi({ editorFontFamily: value })}
                options={fontOptions}
              />
            </div>
            <div className="set-field">
              <span className="set-field-label">界面缩放</span>
              <Slider
                value={ui.zoom}
                min={0.85}
                max={1.3}
                step={0.05}
                onChange={(value) => void patchUi({ zoom: value })}
                format={(value) => `${Math.round(value * 100)}%`}
              />
            </div>
            <div className="set-field">
              <span className="set-field-label">新建笔记默认格式</span>
              <Segmented
                value={ui.newNoteFormat}
                onChange={(value) => void patchUi({ newNoteFormat: value })}
                options={[
                  { value: 'md', label: 'Markdown' },
                  { value: 'txt', label: '纯文本' }
                ]}
              />
            </div>
            <div className="set-field">
              <span className="set-field-label">动画</span>
              <Switch checked={ui.animate} onChange={(checked) => void patchUi({ animate: checked })} />
            </div>
          </div>
        </div>
      </section>

      <section className="set-block">
        <SectionTitle hint="编辑 .md / .txt 时的自动保存行为">保存</SectionTitle>
        <div className="set-fields">
          <div className="set-field">
            <span className="set-field-label">自动保存</span>
            <Switch checked={ui.autosave} onChange={(checked) => void patchUi({ autosave: checked })} />
            <span className="set-field-hint">关闭后请用 Ctrl + S 手动保存</span>
          </div>
          <div className="set-field">
            <span className="set-field-label">保存延时</span>
            <Slider
              value={ui.autosaveDelay}
              min={500}
              max={5000}
              step={100}
              onChange={(value) => void patchUi({ autosaveDelay: value })}
              format={(value) => `${value} ms`}
            />
            <span className="set-field-hint">停止输入多久之后写回磁盘</span>
          </div>
        </div>
      </section>

      <section className="set-block">
        <SectionTitle hint="打开 PDF 时使用的初始视图">PDF 阅读</SectionTitle>
        <div className="set-fields">
          <div className="set-field">
            <span className="set-field-label">默认缩放</span>
            <Select
              value={encodeZoom(ui.pdfDefaultZoom)}
              onChange={(value) => void patchUi({ pdfDefaultZoom: decodeZoom(value) })}
              options={PDF_ZOOM_CHOICES}
            />
          </div>
          <div className="set-field">
            <span className="set-field-label">连续滚动</span>
            <Switch checked={ui.pdfContinuous} onChange={(checked) => void patchUi({ pdfContinuous: checked })} />
            <span className="set-field-hint">关闭后一次只显示一页，翻页更专注</span>
          </div>
          <div className="set-field">
            <span className="set-field-label">翻页动画</span>
            <Select
              value={ui.pageFlipAnimation}
              onChange={(value) => void patchUi({ pageFlipAnimation: value })}
              options={PAGE_FLIP_OPTIONS}
            />
            <span className="set-field-hint">
              左右翻页时用这一档动画，PDF 与 EPUB 共用；{flipHint}
            </span>
          </div>
        </div>
      </section>

      {/* 朗读的默认引擎/语音/语速：阅读器工具栏上的「朗读」用它 */}
      <TtsSettingsBlock settings={settings} />
    </div>
  )
}
