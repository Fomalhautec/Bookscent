import { useState, type ReactNode } from 'react'
import { BOOK_STYLE_PRESETS, DEFAULT_NOTE_STYLE, NOTE_STYLE_PRESETS } from '@shared/themes'
import type { AppSettings, BookStyle } from '@shared/types'
import { Button, Chip, IconButton, SectionTitle } from '@/components/common/Controls'
import { IconCheck, IconRestore, IconTrash } from '@/components/icons/Icons'
import { settingsApi } from '@/lib/api'
import { spineWidthFor } from '@/lib/theme'
import { useSettings } from '@/store/useSettings'
import { useUi } from '@/store/useUi'
import { COVER_PRESET_LABELS, ORNAMENT_LABELS, SAMPLE_BOOKS, SPINE_PRESET_LABELS } from './labels'
import { CoverView, SpineView } from './previews'
import { NamePrompt } from './NamePrompt'
import { measureImageAspect } from '@/lib/image'
import {
  BookColorFields,
  CoverPresetPicker,
  OrnamentPicker,
  SpineImageField,
  SpinePresetPicker,
  StyleImageField,
  StyleQuickPicks,
  ThicknessFields
} from './StyleFields'

/**
 * 外观 · 书籍样式
 * 这里改的是「基准样式」settings.bookStyle —— 分配方式为「全部统一」时，
 * 所有书都用它；其它分配方式下它是兜底与新增样式的蓝本。
 */
export function BookStyleTab({ settings }: { settings: AppSettings }): ReactNode {
  const patchBookStyle = useSettings((s) => s.patchBookStyle)
  const patchNoteStyle = useSettings((s) => s.patchNoteStyle)
  const applyBookStylePreset = useSettings((s) => s.applyBookStylePreset)
  const saveBookStylePreset = useSettings((s) => s.saveBookStylePreset)
  const deleteBookStylePreset = useSettings((s) => s.deleteBookStylePreset)
  const toast = useUi((s) => s.toast)

  const [askName, setAskName] = useState(false)
  const [picking, setPicking] = useState<'spine' | 'cover' | null>(null)
  const style = settings.bookStyle
  const noteStyle = settings.noteStyle ?? DEFAULT_NOTE_STYLE

  const widths = SAMPLE_BOOKS.map((book) => spineWidthFor(book.pages, style))

  const patch = (next: Partial<BookStyle>): void => {
    void patchBookStyle(next)
  }

  const patchNote = (next: Partial<BookStyle>): void => {
    void patchNoteStyle(next)
  }

  /**
   * 量一张图的宽高比。
   *
   * 书脊贴上来之后，书脊的厚度就该听图片的 —— 不然 cover 会把图裁掉一条。
   * 比例在这里顺手量出来存进样式，渲染时就不用每帧去解码图片了。
   */
  const pickImage = async (kind: 'spine' | 'cover'): Promise<void> => {
    setPicking(kind)
    try {
      const picked = await settingsApi.pickBookImage(kind)
      if (!picked) return
      const aspect = await measureImageAspect(picked.dataUrl)
      await patchBookStyle(
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
    <div className="set-tab">
      <div className="set-bookstyle">
        <div className="set-bookstyle-editor">
          <StyleQuickPicks value={style} onChange={patch} />
          <SpinePresetPicker value={style} onChange={patch} />
          <BookColorFields value={style} onChange={patch} />
          <OrnamentPicker value={style} onChange={patch} />
          <CoverPresetPicker value={style} onChange={patch} />
          <ThicknessFields value={style} onChange={patch} />
          <SpineImageField value={style} onChange={patch} picking={picking === 'spine'} onPick={() => void pickImage('spine')} />
          <StyleImageField kind="cover" value={style} onChange={patch} picking={picking === 'cover'} onPick={() => void pickImage('cover')} />

          <section className="set-block">
            <SectionTitle
              action={
                <Button variant="solid" icon={<IconCheck size={14} />} onClick={() => setAskName(true)}>
                  保存为我的样式
                </Button>
              }
              hint="点一下套用整套书脊方案，之后还能继续改"
            >
              样式预设
            </SectionTitle>
            <div className="set-chips">
              {BOOK_STYLE_PRESETS.map((preset) => (
                <Chip key={preset.id} title={preset.description} onClick={() => void applyBookStylePreset(preset.id)}>
                  {preset.name}
                </Chip>
              ))}
            </div>
            {settings.customBookStyles.length === 0 ? (
              <p className="set-empty">还没有「我的样式」。调好一套后点右上角保存，就不会再弄丢了。</p>
            ) : (
              <div className="set-list">
                {settings.customBookStyles.map((preset) => (
                  <div className="set-list-item" key={preset.id}>
                    <span className="set-list-swatches">
                      <SpineView style={preset.style} pages={260} title="样" width={18} height={40} />
                    </span>
                    <span className="set-list-text">
                      <span className="set-list-name">{preset.name}</span>
                      <span className="set-list-sub">
                        {SPINE_PRESET_LABELS[preset.style.spinePreset]} · {ORNAMENT_LABELS[preset.style.ornament]} ·{' '}
                        {COVER_PRESET_LABELS[preset.style.coverPreset]}
                      </span>
                    </span>
                    <span className="set-list-actions">
                      <Button variant="ghost" size="xs" onClick={() => void applyBookStylePreset(preset.id)}>
                        应用
                      </Button>
                      <IconButton label="删除这套样式" tone="muted" onClick={() => void deleteBookStylePreset(preset.id)}>
                        <IconTrash size={14} />
                      </IconButton>
                    </span>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/*
            笔记的基准样式。
            书是"读"的、笔记是"写"的，摆在同一层书架上的观感本就该不一样，
            所以默认长相分开：这一节改的是 settings.noteStyle，只作用于 kind === 'note' 的书。
            它是笔记那份样式列表（settings.noteSpineStyles）的兜底与「新增样式」的蓝本 ——
            笔记的列表与分配方式都和书籍各自独立，见 pickStyleForBook。
          */}
          <section className="set-block">
            <SectionTitle
              action={
                <Button
                  variant="ghost"
                  size="xs"
                  icon={<IconRestore size={13} />}
                  onClick={() => void patchNoteStyle({ ...DEFAULT_NOTE_STYLE })}
                >
                  恢复默认笔记样式
                </Button>
              }
              hint="书的样式管「读」，这里的管「写」—— 只作用于标记为笔记的书"
            >
              笔记的基准样式
            </SectionTitle>
            <div className="set-note-style-row">
              <span className="set-note-style-swatch">
                <SpineView style={noteStyle} pages={90} title="笔记" format="md" width={20} height={120} />
                <CoverView style={noteStyle} width={62} title="笔记" />
              </span>
              <span className="set-note-style-hint">
                笔记默认是一本朴素的便笺：纸色书脊、不烫金、不竹节、极简封面。
                厚度仍然按页数算，所以一摞笔记摆在书架上，一眼能和书分开。
              </span>
            </div>
            <div className="set-chips">
              {NOTE_STYLE_PRESETS.map((preset) => (
                <Chip
                  key={preset.id}
                  title={preset.description}
                  onClick={() => void patchNoteStyle({ ...preset.style })}
                >
                  {preset.name}
                </Chip>
              ))}
            </div>
            <SpinePresetPicker value={noteStyle} onChange={patchNote} />
            <BookColorFields value={noteStyle} onChange={patchNote} />
            <OrnamentPicker value={noteStyle} onChange={patchNote} />
            <CoverPresetPicker value={noteStyle} onChange={patchNote} />
          </section>
        </div>

        <aside className="set-bookstyle-preview">
          <div className="set-preview-head">
            <h3>实时预览</h3>
            <p>厚度由页数决定，越厚越占地方</p>
          </div>
          <div className="set-preview-shelf">
            {SAMPLE_BOOKS.map((book, index) => (
              <span className="set-chan" key={book.title}>
                <span className="set-chan-book">
                  <SpineView style={style} pages={book.pages} title={book.title} format={book.format} height={168} />
                </span>
                <span className="set-chan-title">{book.title}</span>
                <span className="set-chan-meta">
                  {book.pages} 页 · {widths[index]} px
                </span>
              </span>
            ))}
          </div>
          <div className="set-preview-cover">
            <CoverView style={style} width={78} title={style.coverImage ? '封面图' : '书香'} />
            <div className="set-preview-notes">
              <p className="set-preview-note">
                书脊：{SPINE_PRESET_LABELS[style.spinePreset]} · {ORNAMENT_LABELS[style.ornament]}
              </p>
              <p className="set-preview-note">
                排版：{style.spineTextDirection === 'vertical' ? '竖排' : '横排'}
                {style.showFormatIcon ? ' · 带格式图标' : ''}
              </p>
              <p className="set-preview-note">
                厚度：{style.spineWidthOverride ? `固定 ${style.spineWidthOverride} px` : `自动 ×${style.thicknessScale.toFixed(2)}`}
              </p>
            </div>
          </div>
        </aside>
      </div>

      <NamePrompt
        open={askName}
        title="保存为我的样式"
        subtitle="把当前书脊与封面的全部设置存成一套预设"
        placeholder="例如：夜读蓝金"
        initial="我的书脊样式"
        submitLabel="保存样式"
        onSubmit={async (name) => {
          await saveBookStylePreset(name)
          toast(`已保存样式「${name}」`, 'success')
        }}
        onClose={() => setAskName(false)}
      />
    </div>
  )
}
