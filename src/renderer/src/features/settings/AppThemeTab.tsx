import { useMemo, useState, type ReactNode } from 'react'
import { APP_TOKEN_KEYS, THEME_PRESETS, getPreset, readableOn, resolveTokens } from '@shared/themes'
import type { AppSettings, ThemePreset, ThemeTokenKey } from '@shared/types'
import { Button, ColorInput, IconButton, SectionTitle } from '@/components/common/Controls'
import { IconCheck, IconMoon, IconSun, IconTrash } from '@/components/icons/Icons'
import { useSettings } from '@/store/useSettings'
import { useUi } from '@/store/useUi'
import { TOKEN_HINTS, TOKEN_LABELS } from './labels'
import { Swatch, ThemeMock } from './previews'
import { NamePrompt } from './NamePrompt'

/** 微调出来的主题固定用这个 id，避免每拖一下颜色就多出一个主题 */
const TUNING_THEME_ID = 'custom-tuning'

export function AppThemeTab({ settings }: { settings: AppSettings }): ReactNode {
  const setAppTheme = useSettings((s) => s.setAppTheme)
  const deleteCustomTheme = useSettings((s) => s.deleteCustomTheme)
  const toast = useUi((s) => s.toast)
  const [askName, setAskName] = useState(false)

  const active = getPreset(settings.appTheme, settings.customThemes)
  const activeCustom = settings.customThemes.find((t) => t.id === settings.appTheme) ?? null
  const tokens = resolveTokens(active)

  const gallery = useMemo<ThemePreset[]>(() => {
    const builtin = THEME_PRESETS.filter((p) => p.kind === 'app' || p.kind === 'both')
    const mine = settings.customThemes.map((c) => getPreset(c.id, settings.customThemes))
    return [...builtin, ...mine]
  }, [settings.customThemes])

  /**
   * 改一个令牌 = 写一个自定义主题（并让它立即生效）。
   * 当前主题本身就是自定义主题时直接改它，否则先把它"接"下来再改。
   */
  const tuneToken = async (key: ThemeTokenKey, value: string): Promise<void> => {
    const store = useSettings.getState()
    const current = store.settings
    if (!current) return
    const custom = current.customThemes.find((t) => t.id === current.appTheme) ?? null
    const base = getPreset(current.appTheme, current.customThemes)
    if (custom) {
      await store.upsertCustomTheme({ ...custom, tokens: { ...custom.tokens, [key]: value } })
      return
    }
    await store.upsertCustomTheme({
      id: TUNING_THEME_ID,
      name: `${base.name} · 微调`,
      base: base.id,
      tokens: { [key]: value }
    })
    await store.setAppTheme(TUNING_THEME_ID)
  }

  const saveAsTheme = async (name: string): Promise<void> => {
    const store = useSettings.getState()
    const current = store.settings
    if (!current) return
    const custom = current.customThemes.find((t) => t.id === current.appTheme) ?? null
    const base = getPreset(current.appTheme, current.customThemes)
    const id = `custom-${Date.now()}`
    await store.upsertCustomTheme({
      id,
      name,
      base: custom?.base ?? base.id,
      tokens: custom?.tokens ?? {}
    })
    await store.setAppTheme(id)
    toast(`已保存主题「${name}」`, 'success')
  }

  const revert = async (): Promise<void> => {
    const store = useSettings.getState()
    const current = store.settings
    if (!current) return
    const custom = current.customThemes.find((t) => t.id === current.appTheme)
    if (!custom) return
    const base = getPreset(custom.base, current.customThemes)
    await store.deleteCustomTheme(custom.id)
    await store.setAppTheme(custom.base)
    toast(`已还原为基础预设「${base.name}」`, 'info')
  }

  return (
    <div className="set-tab">
      <section className="set-block">
        <SectionTitle hint={`共 ${gallery.length} 套主题，点一下立刻换肤`}>主题画廊</SectionTitle>
        <div className="set-gallery">
          {gallery.map((preset) => {
            const on = preset.id === settings.appTheme
            const mine = settings.customThemes.some((t) => t.id === preset.id)
            return (
              <article key={preset.id} className={`set-theme-card ${on ? 'is-active' : ''}`}>
                <button
                  type="button"
                  className="set-theme-hit"
                  aria-pressed={on}
                  onClick={() => void setAppTheme(preset.id)}
                >
                  <ThemeMock preset={preset} />
                  <span className="set-theme-meta">
                    <span className="set-theme-name">
                      {preset.name}
                      <span className={`set-tag ${preset.dark ? 'is-dark' : 'is-light'}`}>
                        {preset.dark ? <IconMoon size={11} /> : <IconSun size={11} />}
                        {preset.dark ? '深色' : '浅色'}
                      </span>
                      {mine ? <span className="set-tag">自定义</span> : null}
                    </span>
                    <span className="set-theme-desc">{preset.description}</span>
                  </span>
                </button>
                {on ? (
                  <span
                    className="set-check"
                    style={{ background: tokens.accent, color: readableOn(tokens.accent) }}
                    title="当前生效"
                  >
                    <IconCheck size={13} />
                  </span>
                ) : null}
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
          hint={`当前生效：${active.name}${activeCustom ? '（自定义主题）' : '（内置预设）'} · 改色即保存并立即生效`}
          action={
            <div className="set-actions">
              {activeCustom ? (
                <Button variant="ghost" onClick={() => void revert()}>
                  还原为基础预设
                </Button>
              ) : null}
              <Button variant="solid" icon={<IconCheck size={14} />} onClick={() => setAskName(true)}>
                保存为自定义主题
              </Button>
            </div>
          }
        >
          微调当前主题
        </SectionTitle>
        <div className="set-tokens">
          {APP_TOKEN_KEYS.map((key) => (
            <div className="set-token" key={key}>
              <span className="set-token-head">
                <span className="set-token-label">{TOKEN_LABELS[key]}</span>
                <code className="set-token-key">{key}</code>
              </span>
              <ColorInput value={tokens[key]} label={TOKEN_LABELS[key]} onChange={(value) => void tuneToken(key, value)} />
              {TOKEN_HINTS[key] ? <span className="set-token-hint">{TOKEN_HINTS[key]}</span> : null}
            </div>
          ))}
        </div>
      </section>

      <section className="set-block">
        <SectionTitle hint="自定义主题可以随时切换、删除；删除正在使用的主题会自动退回羊皮纸">我的自定义主题</SectionTitle>
        {settings.customThemes.length === 0 ? (
          <p className="set-empty">还没有自定义主题。在上面调几个颜色，或把喜欢的预设「保存为自定义主题」。</p>
        ) : (
          <div className="set-list">
            {settings.customThemes.map((theme) => {
              const resolved = resolveTokens(getPreset(theme.id, settings.customThemes))
              const base = getPreset(theme.base, settings.customThemes)
              const on = theme.id === settings.appTheme
              return (
                <div className={`set-list-item ${on ? 'is-active' : ''}`} key={theme.id}>
                  <span className="set-list-swatches">
                    <Swatch color={resolved['bg-app']} size={14} />
                    <Swatch color={resolved['bg-surface']} size={14} />
                    <Swatch color={resolved.accent} size={14} />
                  </span>
                  <span className="set-list-text">
                    <span className="set-list-name">
                      {theme.name}
                      {on ? <span className="set-tag is-on">使用中</span> : null}
                    </span>
                    <span className="set-list-sub">
                      基于「{base.name}」 · 覆盖 {Object.keys(theme.tokens).length} 项令牌
                    </span>
                  </span>
                  <span className="set-list-actions">
                    <Button variant="ghost" size="xs" disabled={on} onClick={() => void setAppTheme(theme.id)}>
                      {on ? '已应用' : '应用'}
                    </Button>
                    <IconButton label="删除主题" tone="muted" onClick={() => void deleteCustomTheme(theme.id)}>
                      <IconTrash size={14} />
                    </IconButton>
                  </span>
                </div>
              )
            })}
          </div>
        )}
      </section>

      <NamePrompt
        open={askName}
        title="保存为自定义主题"
        subtitle="以当前配色为底，存在「我的自定义主题」里"
        placeholder="例如：暖阳书桌"
        initial={`${active.name} 我的配色`}
        submitLabel="保存主题"
        onSubmit={saveAsTheme}
        onClose={() => setAskName(false)}
      />
    </div>
  )
}
