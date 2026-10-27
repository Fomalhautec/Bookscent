import { create } from 'zustand'
import type { TtsSettings, TtsVoice } from '@shared/types'
import { cleanSpeechText } from '@/lib/speechText'
import { libraryApi } from '@/lib/api'
import { useSettings } from '@/store/useSettings'

/**
 * 朗读状态。
 *
 * 两套引擎共用一套"分段播放"的流程：
 *   - **在线（Edge）**：一段文字 → 主进程合成 mp3 → 一个 <audio> 播完再下一段；
 *   - **系统**：交给 Web Speech API，直接 speak 一段、onend 再下一段。
 *
 * 为什么要分段：整章一次性合成既慢又没法暂停/跳段；按段落切，点"下一段"立刻有反应，
 * 读到哪一段也看得见（面板里显示当前那段的文字）。
 */
interface TtsState {
  open: boolean
  segments: string[]
  index: number
  playing: boolean
  loading: boolean
  error: string | null
  /** 自动接着读下一节（长文连着听） */
  continuous: boolean
  /** 从哪个界面发起的（阅读器按"朗读"时设置，用来决定读到末尾时要不要翻页） */
  source: 'epub' | 'pdf' | null
  setOpen: (open: boolean) => void
  setContinuous: (value: boolean) => void
  /** 用一批段落开始朗读 */
  play: (segments: string[], source: 'epub' | 'pdf') => void
  pause: () => void
  resume: () => void
  stop: () => void
  next: () => void
  prev: () => void
  /** 读到这一节末尾了，问界面要不要续下一节（返回 true 表示还有下一节） */
  onBoundary: (() => boolean) | null
  setBoundary: (handler: (() => boolean) | null) => void
}

/* --------------------------------------------------------------- 播放器 */

/** 在线那档用一个复用的 <audio>：换段只换 src，暂停/继续就是原生行为 */
let audio: HTMLAudioElement | null = null
function getAudio(): HTMLAudioElement {
  if (!audio) {
    audio = new Audio()
    audio.preload = 'auto'
  }
  return audio
}

/**
 * 合成结果缓存 + 预取。
 *
 * 用户提的问题是"两段之间有几秒加载"，原因是每段都要等一次合成。
 * 解法很直接：这一段开始播时，**立刻把下一段合成好**放进缓存；
 * 轮到下一段时就直接从缓存取，中间几乎无缝。
 * 缓存键带上语音/语速/音调 —— 换了参数就该重新合成，不能复用。
 */
const audioCache = new Map<string, string>()
const CACHE_LIMIT = 60

function cacheKey(text: string, config: { voice: string; rate: number; pitch: number; engine: string }): string {
  return `${config.engine}|${config.voice}|${config.rate}|${config.pitch}|${text}`
}

function rememberAudio(key: string, dataUrl: string): void {
  if (audioCache.size >= CACHE_LIMIT) {
    /* 满了就丢最早的一个（Map 保持插入顺序） */
    const first = audioCache.keys().next().value
    if (first) audioCache.delete(first)
  }
  audioCache.set(key, dataUrl)
}

/** 后台把某一段合成好塞进缓存（失败就算了，真正播时会再试一次） */
function prefetch(index: number): void {
  const state = useTts.getState()
  const text = state.segments[index]
  if (!text) return
  const config = ttsOf()
  if (config.engine === 'system') return
  const key = cacheKey(text, config)
  if (audioCache.has(key)) return
  void libraryApi
    .ttsSpeak({
      text,
      voice: config.voice,
      rate: config.rate,
      pitch: config.pitch,
      engine: config.engine,
      youdaoAppKey: config.youdaoAppKey,
      youdaoAppSecret: config.youdaoAppSecret,
      tencentSecretId: config.tencentSecretId,
      tencentSecretKey: config.tencentSecretKey,
      tencentRegion: config.tencentRegion
    })
    .then((result) => rememberAudio(key, `data:${result.mime};base64,${result.audio}`))
    .catch(() => undefined)
}
/** 系统那档：取消上一段再念新的（speechSynthesis 是全局队列） */
function stopSystemSpeech(): void {
  try {
    window.speechSynthesis?.cancel()
  } catch {
    /* 没有实现就算了 */
  }
}

function ttsOf(): TtsSettings {
  return (
    useSettings.getState().settings?.ui.tts ?? {
      engine: 'system',
      voice: '',
      rate: 1,
      pitch: 1
    }
  )
}

/** 把语音选择记进设置（下次打开还是这套） */
function remember(patch: Partial<TtsSettings>): void {
  const store = useSettings.getState()
  const settings = store.settings
  if (!settings) return
  void store.patch({
    ui: { ...settings.ui, tts: { ...ttsOf(), ...patch } }
  })
}

export const useTts = create<TtsState>((set, get) => {
  /** 播完一段：自动下一段，没有下一段就问界面要不要续 */
  const advance = (): void => {
    const state = get()
    const nextIndex = state.index + 1
    if (nextIndex < state.segments.length) {
      set({ index: nextIndex })
      void speakCurrent()
      return
    }
    /* 这一节读完了 */
    if (state.continuous && state.onBoundary?.()) {
      /* 界面翻页后会重新调用 play()，这里先把播放态停掉 */
      set({ playing: false })
      return
    }
    set({ playing: false })
  }

  const speakCurrent = async (): Promise<void> => {
    const state = get()
    const text = state.segments[state.index]
    if (!text) {
      set({ playing: false })
      return
    }
    const config = ttsOf()
    set({ error: null })

    if (config.engine === 'system') {
      const synth = window.speechSynthesis
      if (!synth) {
        set({ error: '系统不支持语音朗读，请改用在线语音', playing: false })
        return
      }
      stopSystemSpeech()
      const utterance = new SpeechSynthesisUtterance(text)
      utterance.rate = Math.min(2, Math.max(0.5, config.rate))
      utterance.pitch = Math.min(2, Math.max(0.5, config.pitch))
      utterance.lang = (config.voice.split(/[-_]/).slice(0, 2).join('-') || 'zh-CN')
      const voices = synth.getVoices()
      const picked = voices.find((voice) => voice.voiceURI === config.voice || voice.name === config.voice)
      if (picked) utterance.voice = picked
      utterance.onend = () => {
        if (get().playing) advance()
      }
      utterance.onerror = () => set({ playing: false })
      set({ playing: true })
      synth.speak(utterance)
      return
    }

    /* 在线：合成 → 播放 */
    set({ loading: true })
    try {
      /* 先看缓存：上一段播放时已经预取过这一段，这里通常直接命中 */
      const key = cacheKey(text, config)
      let dataUrl = audioCache.get(key) ?? ''
      if (!dataUrl) {
        const result = await libraryApi.ttsSpeak({
          text,
          voice: config.voice || 'zh-CN-XiaoxiaoNeural',
          rate: config.rate,
          pitch: config.pitch,
          engine: config.engine,
          youdaoAppKey: config.youdaoAppKey,
          youdaoAppSecret: config.youdaoAppSecret,
          tencentSecretId: config.tencentSecretId,
          tencentSecretKey: config.tencentSecretKey,
          tencentRegion: config.tencentRegion
        })
        dataUrl = `data:${result.mime};base64,${result.audio}`
        rememberAudio(key, dataUrl)
      }
      /*
       * 这一段开播就把**后面三句**都合成好 —— 短句多的时候，只预备一句仍会露空档。
       * 缓存命中是即时的，多合成几句的代价只是后台多跑几次请求。
       */
      for (let ahead = 1; ahead <= 3; ahead += 1) prefetch(state.index + ahead)
      const player = getAudio()
      player.src = dataUrl
      player.playbackRate = 1
      player.onended = () => {
        if (get().playing) advance()
      }
      player.onerror = () => set({ playing: false, error: '音频播放失败' })
      await player.play()
      set({ playing: true, loading: false })
    } catch (error) {
      set({
        playing: false,
        loading: false,
        error: error instanceof Error ? error.message : '合成失败（检查网络）'
      })
    }
  }

  return {
    open: false,
    segments: [],
    index: 0,
    playing: false,
    loading: false,
    error: null,
    continuous: true,
    source: null,
    onBoundary: null,

    setOpen: (open) => {
      if (!open) get().stop()
      set({ open })
    },
    setContinuous: (continuous) => set({ continuous }),
    setBoundary: (handler) => set({ onBoundary: handler }),

    play: (segments, source) => {
      /* 所有调用方（工具条/朗读按钮/连读）都从这里过一遍，注音在这里被剥掉 */
      const list = segments.map((item) => cleanSpeechText(item)).filter(Boolean)
      if (list.length === 0) {
        set({ open: true, error: '这一节没有可朗读的文字' })
        return
      }
      stopSystemSpeech()
      getAudio().pause()
      set({ open: true, segments: list, index: 0, playing: true, error: null, source })
      void speakCurrent()
    },

    pause: () => {
      if (ttsOf().engine === 'system') stopSystemSpeech()
      else getAudio().pause()
      set({ playing: false })
    },

    resume: () => {
      const state = get()
      if (state.segments.length === 0) return
      if (ttsOf().engine === 'system') {
        set({ playing: true })
        void speakCurrent()
        return
      }
      const player = getAudio()
      if (player.src && player.paused && player.currentTime > 0) {
        set({ playing: true })
        void player.play().catch(() => void speakCurrent())
        return
      }
      set({ playing: true })
      void speakCurrent()
    },

    stop: () => {
      stopSystemSpeech()
      const player = getAudio()
      player.pause()
      player.removeAttribute('src')
      set({ playing: false, loading: false })
    },

    next: () => {
      const state = get()
      if (state.index + 1 >= state.segments.length) return
      stopSystemSpeech()
      getAudio().pause()
      set({ index: state.index + 1, playing: true })
      void speakCurrent()
    },

    prev: () => {
      const state = get()
      if (state.index === 0) return
      stopSystemSpeech()
      getAudio().pause()
      set({ index: state.index - 1, playing: true })
      void speakCurrent()
    }
  }
})

/** 语音选择与语速同样要能改（朗读栏里用） */
export function setTtsConfig(patch: Partial<TtsSettings>): void {
  remember(patch)
  /* 正在播的话，改完立刻用新设置重念当前这段 */
  const state = useTts.getState()
  if (state.playing) {
    state.pause()
    state.resume()
  }
}

/** 系统语音（按语言排好） */
export function systemVoices(): TtsVoice[] {
  try {
    const synth = window.speechSynthesis
    if (!synth) return []
    return synth
      .getVoices()
      .map((voice) => ({
        id: voice.voiceURI,
        name: voice.name,
        locale: voice.lang,
        gender: '',
        engine: 'system' as const
      }))
      .sort((a, b) => a.locale.localeCompare(b.locale) || a.name.localeCompare(b.name))
  } catch {
    return []
  }
}
