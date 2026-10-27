import type { AppSettings } from '@shared/types'
import type { ReactNode } from 'react'
import { SectionTitle, Segmented, Slider, Switch } from '@/components/common/Controls'
import { useSettings } from '@/store/useSettings'
import { OPEN_ANIMATION_HINTS, OPEN_ANIMATION_LABELS, OPEN_ANIMATIONS } from './labels'

/**
 * 通用 —— 只放与"整个应用怎么用"有关的最小一撮开关：
 * 新建笔记的默认格式、界面缩放、动画、启动时侧栏是否展开。
 */
export function GeneralTab({ settings }: { settings: AppSettings }): ReactNode {
  const patchUi = useSettings((s) => s.patchUi)
  const ui = settings.ui

  return (
    <div className={`set-tab ${ui.animate ? '' : 'set-no-anim'}`}>
      <section className="set-block">
        <SectionTitle hint="这些偏好只影响界面本身的顺手程度，不动你的书">常用</SectionTitle>
        <div className="set-split">
          <div className="set-split-preview">
            <div className="set-sample">
              <div className="set-sample-bar">
                <span className="set-sample-title">新建的笔记长这样</span>
                <span className="set-sample-toggle">{ui.newNoteFormat === 'md' ? 'Markdown' : '纯文本'}</span>
              </div>
              <p
                className="set-sample-text"
                style={{
                  fontSize: ui.editorFontSize,
                  lineHeight: ui.editorLineHeight,
                  fontFamily: ui.editorFontFamily
                }}
              >
                {ui.newNoteFormat === 'md'
                  ? '# 灯下随笔\n\n雨把瓦当敲得很轻。**屋里的书**依旧按旧日的次序排着……'
                  : '灯下随笔\n\n雨把瓦当敲得很轻。屋里的书依旧按旧日的次序排着……'}
              </p>
              <div className="set-sample-foot">
                <span>缩放 {Math.round(ui.zoom * 100)}%</span>
                <span>{ui.animate ? '动画开' : '动画关'}</span>
                <span>侧栏{ui.sidebarOpen ? '展开' : '收起'}</span>
              </div>
            </div>
          </div>

          <div className="set-fields">
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
              <span className="set-field-hint">
                {ui.newNoteFormat === 'md'
                  ? '带标题、列表与强调的 .md 文件，编辑器会做语法高亮。'
                  : '干净的 .txt 文件，写什么都原样落盘。'}
              </span>
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
              <span className="set-field-hint">按钮、字号与间隙整体放大或缩小，书架的尺寸不受影响。</span>
            </div>

            <div className="set-field">
              <span className="set-field-label">界面动画</span>
              <Switch checked={ui.animate} onChange={(checked) => void patchUi({ animate: checked })} />
              <span className="set-field-hint">关掉后过渡变干脆，老机器上更跟手。</span>
            </div>

            <div className="set-field">
              <span className="set-field-label">启动时侧栏展开</span>
              <Switch checked={ui.sidebarOpen} onChange={(checked) => void patchUi({ sidebarOpen: checked })} />
              <span className="set-field-hint">只决定下次打开时的初始状态，临时收起不会改这里。</span>
            </div>
          </div>
        </div>
      </section>

      <section className="set-block">
        <SectionTitle hint="从书架抽出一本书、把它摊开的那一下">打开书籍的动画</SectionTitle>
        <div className="set-picker set-picker-tight">
          {OPEN_ANIMATIONS.map((mode) => (
            <button
              key={mode}
              type="button"
              className={`set-picker-item ${ui.openAnimation === mode ? 'is-active' : ''}`}
              aria-pressed={ui.openAnimation === mode}
              onClick={() => void patchUi({ openAnimation: mode })}
            >
              <span className={`set-anim-demo is-${mode} ${ui.animate ? '' : 'is-static'}`}>
                <span className="set-anim-book" />
                <span className="set-anim-page" />
              </span>
              <span className="set-picker-name">{OPEN_ANIMATION_LABELS[mode]}</span>
              <span className="set-picker-hint">{OPEN_ANIMATION_HINTS[mode]}</span>
            </button>
          ))}
        </div>
      </section>
    </div>
  )
}
