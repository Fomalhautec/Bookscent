import { useEffect, useState, type ReactNode } from 'react'
import type { AppSettings, TtsVoice } from '@shared/types'
import { Button, SectionTitle, Select, Slider, Switch } from '@/components/common/Controls'
import { libraryApi } from '@/lib/api'
import { useSettings } from '@/store/useSettings'
import { systemVoices } from '@/store/useTts'

/**
 * 「阅读与编辑」里的朗读设置。
 *
 * 朗读栏里也能改，但那是"读的时候顺手调"；这里是"定个默认"：
 * 引擎、语音、语速、音调。之所以两边都放，是因为用户既可能先设好再读，
 * 也可能读着读着才发现要换 —— 两处写的是同一份设置（`ui.tts`）。
 */
const LANGUAGE_LABEL: Record<string, string> = {
  'zh-CN': '中文（普通话）',
  'zh-TW': '中文（台湾）',
  'zh-HK': '中文（粤语）',
  'en-US': '英语（美国）',
  'en-GB': '英语（英国）',
  'ja-JP': '日语',
  'ko-KR': '韩语',
  'fr-FR': '法语',
  'de-DE': '德语',
  'es-ES': '西班牙语',
  'ru-RU': '俄语'
}

export function TtsSettingsBlock({ settings }: { settings: AppSettings }): ReactNode {
  const patch = useSettings((s) => s.patch)
  const config = settings.ui.tts ?? { engine: 'system', voice: '', rate: 1, pitch: 1 }
  const [onlineVoices, setOnlineVoices] = useState<TtsVoice[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (config.engine !== 'edge' || onlineVoices.length > 0) return
    setLoading(true)
    void libraryApi
      .ttsVoices()
      .then((list) => setOnlineVoices(Array.isArray(list) ? list : []))
      .catch(() => setOnlineVoices([]))
      .finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.engine])

  const save = (next: Partial<typeof config>): void => {
    void patch({ ui: { ...settings.ui, tts: { ...config, ...next } } })
  }

  const voices = config.engine === 'edge' ? onlineVoices : systemVoices()
  const locales = [...new Set(voices.map((voice) => voice.locale))].sort()
  const current = voices.find((voice) => voice.id === config.voice)
  const locale = current?.locale ?? locales[0] ?? ''

  return (
    <section className="set-block">
      <SectionTitle hint="阅读器工具栏上的「朗读」用它；朗读栏里也能临时改">
        文本朗读
      </SectionTitle>
      <div className="set-fields">
        <div className="set-field">
          <span className="set-field-label">引擎</span>
          <Select
            value={config.engine}
            options={[
              { value: 'system', label: '系统语音（离线）' },
              { value: 'edge', label: 'Edge 在线语音（多语言）' }
            ]}
            onChange={(value) => save({ engine: value as 'edge' | 'system', voice: '' })}
          />
        </div>
        <div className="set-field">
          <span className="set-field-label">语言</span>
          <Select
            value={locale}
            options={
              locales.length === 0
                ? [{ value: '', label: loading ? '正在取语音列表…' : '（没有可选语言）' }]
                : locales.map((code) => ({ value: code, label: LANGUAGE_LABEL[code] ?? code }))
            }
            onChange={(value) => {
              const first = voices.find((voice) => voice.locale === value)
              if (first) save({ voice: first.id })
            }}
          />
        </div>
        <div className="set-field">
          <span className="set-field-label">语音</span>
          <Select
            value={config.voice}
            options={
              voices.filter((voice) => voice.locale === locale).length === 0
                ? [{ value: '', label: '（这个语言还没有语音）' }]
                : voices
                    .filter((voice) => voice.locale === locale)
                    .map((voice) => ({
                      value: voice.id,
                      label: `${voice.name}${voice.gender === 'Female' ? ' · 女' : voice.gender === 'Male' ? ' · 男' : ''}`
                    }))
            }
            onChange={(value) => save({ voice: value })}
          />
        </div>
        <div className="set-field">
          <span className="set-field-label">语速</span>
          <Slider
            value={config.rate}
            min={0.5}
            max={2}
            step={0.05}
            onChange={(value) => save({ rate: value })}
          />
        </div>
        <div className="set-field">
          <span className="set-field-label">音调</span>
          <Slider
            value={config.pitch}
            min={0.5}
            max={2}
            step={0.05}
            onChange={(value) => save({ pitch: value })}
          />
        </div>
      </div>
      <p className="set-hint">
        {config.engine === 'edge'
          ? `${loading ? '正在取…' : `已取到 ${onlineVoices.length} 个在线语音、${locales.length} 种语言`}（来自 Edge「大声朗读」，需要联网；连不上时朗读栏会提示改用系统语音）`
          : '系统语音离线可用，语种取决于系统里装了什么；想要多语言高质量请切到 Edge 在线语音。'}
      </p>
      {config.engine === 'edge' && onlineVoices.length === 0 && !loading ? (
        <div className="set-actions set-actions-left">
          <Button
            variant="outline"
            onClick={() => {
              setLoading(true)
              void libraryApi
                .ttsVoices(true)
                .then((list) => setOnlineVoices(Array.isArray(list) ? list : []))
                .catch(() => setOnlineVoices([]))
                .finally(() => setLoading(false))
            }}
          >
            重新获取语音列表
          </Button>
        </div>
      ) : null}
    </section>
  )
}
