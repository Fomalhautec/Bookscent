import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { TtsSettings, TtsVoice } from '@shared/types'
import { IconButton } from '@/components/common/Controls'
import { IconClose, IconPause, IconPlay } from '@/components/icons/Icons'
import { libraryApi } from '@/lib/api'
import { setTtsConfig, systemVoices, useTts } from '@/store/useTts'
import { useSettings } from '@/store/useSettings'

/**
 * 朗读栏 —— 阅读区底部**一行**。
 *
 * 设计取舍（按用户反馈改过两轮）：
 *   - 不显示"正在读的文字"：正文里已经逐句高亮，再抄一遍是浪费高度；
 *   - 不要备注行：说明文字只在出错时出现；
 *   - 引擎用下拉而不是四个按钮：按钮太占横向空间，一行放不下别的控件；
 *   - 整条只有一行：播放/暂停、上一句/下一句、进度、引擎、语言、语音、语速、音调、连读、收起。
 */
const LANGUAGE_LABEL: Record<string, string> = {
  'zh-CN': '中文',
  'zh-TW': '中文（台）',
  'zh-HK': '粤语',
  'en-US': '英语（美）',
  'en-GB': '英语（英）',
  'ja-JP': '日语',
  'ko-KR': '韩语',
  'fr-FR': '法语',
  'de-DE': '德语',
  'es-ES': '西语',
  'it-IT': '意语',
  'ru-RU': '俄语'
}

const ENGINE_OPTIONS: { value: TtsSettings['engine']; label: string }[] = [
  { value: 'system', label: '系统语音（离线）' },
  { value: 'edge', label: '在线 · Edge' },
  { value: 'youdao', label: '有道智云' },
  { value: 'tencent', label: '腾讯云' }
]

function localeLabel(locale: string): string {
  return LANGUAGE_LABEL[locale] ?? locale
}

export function TtsBar(): ReactNode {
  const open = useTts((s) => s.open)
  const segments = useTts((s) => s.segments)
  const index = useTts((s) => s.index)
  const playing = useTts((s) => s.playing)
  const error = useTts((s) => s.error)
  const continuous = useTts((s) => s.continuous)
  const setContinuous = useTts((s) => s.setContinuous)
  const pause = useTts((s) => s.pause)
  const resume = useTts((s) => s.resume)
  const stop = useTts((s) => s.stop)
  const next = useTts((s) => s.next)
  const prev = useTts((s) => s.prev)
  const setOpen = useTts((s) => s.setOpen)

  const settings = useSettings((s) => s.settings)
  const config: TtsSettings = settings?.ui.tts ?? { engine: 'system', voice: '', rate: 1, pitch: 1 }

  const [onlineVoices, setOnlineVoices] = useState<TtsVoice[]>([])
  const [loadingVoices, setLoadingVoices] = useState(false)

  useEffect(() => {
    if (!open || config.engine !== 'edge' || onlineVoices.length > 0) return
    setLoadingVoices(true)
    void libraryApi
      .ttsVoices()
      .then((list) => setOnlineVoices(Array.isArray(list) ? list : []))
      .catch(() => setOnlineVoices([]))
      .finally(() => setLoadingVoices(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, config.engine])

  /** 云端那两家用它们自己的音色，不列语言/语音 */
  const usesVoiceList = config.engine === 'edge' || config.engine === 'system'
  const voices = config.engine === 'edge' ? onlineVoices : usesVoiceList ? systemVoices() : []
  const locales = useMemo(() => [...new Set(voices.map((voice) => voice.locale))].sort(), [voices])
  const [pickedLocale, setPickedLocale] = useState('')
  const activeLocale = useMemo(() => {
    if (pickedLocale && locales.includes(pickedLocale)) return pickedLocale
    const current = voices.find((voice) => voice.id === config.voice)
    return current?.locale ?? locales[0] ?? ''
  }, [pickedLocale, locales, voices, config.voice])
  const inLocale = voices.filter((voice) => voice.locale === activeLocale)

  if (!open) return null

  return (
    <div className="tts-bar" role="region" aria-label="朗读">
      <IconButton
        label={playing ? '暂停' : '播放'}
        tone="default"
        onClick={() => (playing ? pause() : resume())}
      >
        {playing ? <IconPause size={15} /> : <IconPlay size={15} />}
      </IconButton>
      <IconButton label="上一句" tone="muted" disabled={index === 0} onClick={prev}>
        <span className="tts-step">◀</span>
      </IconButton>
      <IconButton label="下一句" tone="muted" disabled={index >= segments.length - 1} onClick={next}>
        <span className="tts-step">▶</span>
      </IconButton>
      <span className="tts-progress">
        {segments.length === 0 ? '—' : `${index + 1}/${segments.length}`}
      </span>

      <select
        className="select tts-select"
        value={config.engine}
        title="朗读引擎"
        onChange={(event) => setTtsConfig({ engine: event.target.value as TtsSettings['engine'] })}
      >
        {ENGINE_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>

      {usesVoiceList ? (
        <>
          <select
            className="select tts-select is-narrow"
            value={activeLocale}
            title="语言"
            onChange={(event) => {
              setPickedLocale(event.target.value)
              const first = voices.find((voice) => voice.locale === event.target.value)
              if (first) setTtsConfig({ voice: first.id })
            }}
          >
            {locales.length === 0 ? <option value="">{loadingVoices ? '读取中…' : '—'}</option> : null}
            {locales.map((code) => (
              <option key={code} value={code}>
                {localeLabel(code)}
              </option>
            ))}
          </select>
          <select
            className="select tts-select is-wide"
            value={config.voice}
            title="语音"
            onChange={(event) => setTtsConfig({ voice: event.target.value })}
          >
            {inLocale.length === 0 ? <option value="">（无）</option> : null}
            {inLocale.map((voice) => (
              <option key={voice.id} value={voice.id}>
                {voice.name}
                {voice.gender === 'Female' ? '·女' : voice.gender === 'Male' ? '·男' : ''}
              </option>
            ))}
          </select>
        </>
      ) : null}

      <input
        className="tts-range"
        type="range"
        min={0.5}
        max={2}
        step={0.05}
        value={config.rate}
        title={`语速 ${config.rate.toFixed(2)}×`}
        onChange={(event) => setTtsConfig({ rate: Number(event.target.value) })}
      />
      <input
        className="tts-range"
        type="range"
        min={0.5}
        max={2}
        step={0.05}
        value={config.pitch}
        title={`音调 ${config.pitch.toFixed(2)}`}
        onChange={(event) => setTtsConfig({ pitch: Number(event.target.value) })}
      />

      <label className="tts-continuous" title="读完这一节自动翻页接着读">
        <input
          type="checkbox"
          checked={continuous}
          onChange={(event) => setContinuous(event.target.checked)}
        />
        连读
      </label>

      {error ? <span className="tts-error" title={error}>{error}</span> : null}

      <IconButton
        label="收起朗读栏"
        tone="muted"
        onClick={() => {
          stop()
          setOpen(false)
        }}
      >
        <IconClose size={14} />
      </IconButton>
    </div>
  )
}
