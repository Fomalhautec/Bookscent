/**
 * 翻译服务（主进程）。
 *
 * 为什么放在主进程：一是避开渲染层的跨域限制，二是**密钥不出现在页面里** ——
 * 阅读视图里的书是第三方内容（EPUB/PDF 里的脚本也算），密钥不该跟它同处一个上下文。
 *
 * 四家机翻 + 一家 AI，各自只要"把一段文本换成另一段文本"，差异都收在这里：
 *   - Google Cloud Translation v2（key 走 query）
 *   - Microsoft Translator（Ocp-Apim-Subscription-Key + region）
 *   - DeepL（free / pro 两个域名，Authorization: DeepL-Auth-Key）
 *   - 有道智云 v3（appKey + salt + curtime + sha256 签名）
 *   - AI：任何 OpenAI 兼容的 /chat/completions（DeepSeek、硅基流动、本地 ollama…）
 *
 * 上下文：翻译一句话最容易译飞的地方是代词与省略主语，所以支持把前后各若干段
 * 一起送过去。机翻那几家没有"上下文"参数，就按段拼接、只取目标那段的译文回来；
 * AI 那边则是把上下文写进提示词，让它先读懂再翻。
 */

import { createHash, randomUUID } from 'node:crypto'
import { existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import type {
  TranslateEndpoint,
  TranslateHistoryEntry,
  TranslateProvider,
  TranslateResult
} from '@shared/types'
import { DEFAULT_TRANSLATE_PROMPT } from '@shared/translatePrompt'
import { getSettings } from './settings'
import { readJson, writeJson } from './store'
import { parseVocabBlock, parseVocabJson, stripVocabBlock } from '@shared/vocab'
import { VOCAB_EXTRACT_PROMPT, buildVocabExtractMessage } from '@shared/translatePrompt'
import { logLine } from './log'
import { defaultSettings } from './settings'

/** 单次请求超时：机翻很快，AI 慢一些，统一 25 秒 */
const TIMEOUT_MS = 25_000
/** 送进模型/接口的正文上限，防止一次选了一整章 */
const MAX_CHARS = 4000

export interface TranslateRequest {
  text: string
  /** 前后段落（已按顺序排好，source 是待译那段） */
  context: string[]
  /** 用哪条接口配置（由 IPC 层从设置里解析出来） */
  endpoint?: TranslateEndpoint | null
  /** 目标语言 */
  target?: string
  /** AI 用的提示词（由 IPC 层按当前预设解析出来） */
  prompt?: string
}

/** 有道 v3 的签名：sha256(appKey + truncate(q) + salt + curtime + appSecret) */
function youdaoSign(appKey: string, appSecret: string, q: string, salt: string, curtime: string): string {
  const input = q.length <= 20 ? q : `${q.slice(0, 10)}${q.length}${q.slice(-10)}`
  return createHash('sha256').update(`${appKey}${input}${salt}${curtime}${appSecret}`).digest('hex')
}

/** 短码转各家要的写法：DeepL 要大写且只有语言部分，微软/Google 用 BCP-47 */
function targetFor(provider: TranslateProvider, target: string): string {
  if (provider === 'deepl') return target.split('-')[0].toUpperCase()
  return target
}

async function postJson(
  url: string,
  init: RequestInit,
  what: string
): Promise<{ ok: true; data: unknown } | { ok: false; error: string }> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const response = await fetch(url, { ...init, signal: controller.signal })
    const raw = await response.text()
    if (!response.ok) {
      /* 接口的报错正文通常就写着原因（密钥错、配额用完、参数不对），原样带出来最有帮助 */
      return { ok: false, error: `${what} 返回 ${response.status}：${raw.slice(0, 300)}` }
    }
    try {
      return { ok: true, data: JSON.parse(raw) }
    } catch {
      return { ok: false, error: `${what} 返回的不是 JSON：${raw.slice(0, 160)}` }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { ok: false, error: `${what} 请求失败：${message}${message.includes('aborted') ? '（超时）' : ''}` }
  } finally {
    clearTimeout(timer)
  }
}

/** 从模型回复里抠出 JSON（有些平台会习惯性包一层 ```json） */
function parseAiJson(text: string): { translation: string; analysis?: string } {
  let body = text.trim()
  const fence = /```(?:json)?\s*([\s\S]*?)```/.exec(body)
  if (fence) body = fence[1].trim()
  const start = body.indexOf('{')
  const end = body.lastIndexOf('}')
  if (start >= 0 && end > start) body = body.slice(start, end + 1)
  try {
    const parsed = JSON.parse(body) as { translation?: unknown; analysis?: unknown }
    return {
      translation: typeof parsed.translation === 'string' ? parsed.translation : '',
      analysis: typeof parsed.analysis === 'string' ? parsed.analysis : undefined
    }
  } catch {
    /* 没按 JSON 回也不至于白跑一趟：整段当译文，解析留空 */
    return { translation: text.trim() }
  }
}

function buildAiMessages(prompt: string, text: string, context: string[], target: string) {
  const contextBlock = context.length > 0 ? context.map((line) => `- ${line}`).join('\n') : '（无）'
  return [
    { role: 'system' as const, content: prompt },
    {
      role: 'user' as const,
      content: [
        `目标语言：${target}`,
        '',
        '【上下文】（仅供理解，不要翻译它们）',
        contextBlock,
        '',
        '【待译文本】',
        text
      ].join('\n')
    }
  ]
}

async function translateWithAi(
  endpoint: TranslateEndpoint,
  prompt: string,
  target: string,
  text: string,
  context: string[]
): Promise<{ ok: true; translation: string; analysis?: string; vocabulary?: { term: string; reading: string; meaning: string; kind: 'word' | 'phrase' }[] } | { ok: false; error: string }> {
  const baseUrl = endpoint.baseUrl
  const apiKey = endpoint.apiKey
  const model = endpoint.model
  if (!baseUrl.trim()) return { ok: false, error: '还没填 API 地址（设置 → 翻译 → AI）' }
  if (!model.trim()) return { ok: false, error: '还没填模型名（例如 deepseek-chat）' }
  const url = `${baseUrl.replace(/\/+$/, '')}/chat/completions`
  const result = await postJson(
    url,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey.trim() ? { Authorization: `Bearer ${apiKey.trim()}` } : {})
      },
      body: JSON.stringify({
        model: model.trim(),
        /*
       * 第一步只做翻译 + 解析。词汇表不再让它顺手附一段 Markdown 表格 ——
       * 那次请求里塞三件事，模型每次都能写走样（释义进词形、多词短语被拆）。
       * 抽词改由 extractVocab() 单独发一次请求，见 VOCAB_EXTRACT_PROMPT。
       */
      messages: buildAiMessages(prompt, text, context, target),
        temperature: 0.2,
        stream: false
      })
    },
    'AI 接口'
  )
  if (!result.ok) return result
  const data = result.data as { choices?: { message?: { content?: string } }[] }
  const content = data?.choices?.[0]?.message?.content
  if (typeof content !== 'string' || !content.trim()) {
    return { ok: false, error: 'AI 没有返回内容（检查模型名是否可用）' }
  }
  const parsed = parseAiJson(content)
  if (!parsed.translation) return { ok: false, error: 'AI 返回里没有译文' }
  /*
   * 解析里那段词汇表（[[VOCAB]] 之后的行）单独解析成结构数据：
   * 面板上把它渲染成表格（每行一个"加入单词本"的按钮），
   * 正文里则把这段剔掉，避免同一份词汇显示两遍。
   */
  return {
    ok: true,
    translation: parsed.translation,
    analysis: stripVocabBlock(parsed.analysis),
    vocabulary: parseVocabBlock(parsed.analysis)
  }
}

async function translateMachine(
  provider: TranslateProvider,
  config: TranslateEndpoint,
  target: string,
  text: string,
  context: string[]
): Promise<{ ok: true; translation: string } | { ok: false; error: string }> {
  if (provider === 'google') {
    if (!config.apiKey.trim()) return { ok: false, error: '还没填 Google 的 API Key' }
    const url = config.endpoint || 'https://translation.googleapis.com/language/translate/v2'
    /* 上下文拼接：只取最后一段（也就是待译那句）的译文 */
    const joined = [...context, text]
    const result = await postJson(
      `${url}?key=${encodeURIComponent(config.apiKey.trim())}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ q: joined, target, format: 'text' })
      },
      'Google 翻译'
    )
    if (!result.ok) return result
    const data = result.data as { data?: { translations?: { translatedText?: string }[] } }
    const list = data?.data?.translations ?? []
    const last = list[list.length - 1]?.translatedText
    return last ? { ok: true, translation: last } : { ok: false, error: 'Google 没有返回译文' }
  }

  if (provider === 'microsoft') {
    if (!config.apiKey.trim()) return { ok: false, error: '还没填微软的 API Key' }
    const url = config.endpoint || 'https://api.cognitive.microsofttranslator.com/translate'
    const result = await postJson(
      `${url}?api-version=3.0&to=${encodeURIComponent(target)}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Ocp-Apim-Subscription-Key': config.apiKey.trim(),
          ...(config.region.trim() ? { 'Ocp-Apim-Subscription-Region': config.region.trim() } : {})
        },
        body: JSON.stringify([...context, text].map((line) => ({ Text: line })))
      },
      '微软翻译'
    )
    if (!result.ok) return result
    const data = result.data as { translations?: { text?: string }[] }[]
    const last = Array.isArray(data) ? data[data.length - 1]?.translations?.[0]?.text : undefined
    return last ? { ok: true, translation: last } : { ok: false, error: '微软没有返回译文' }
  }

  if (provider === 'deepl') {
    if (!config.apiKey.trim()) return { ok: false, error: '还没填 DeepL 的 API Key' }
    const url =
      config.endpoint ||
      (config.pro ? 'https://api.deepl.com/v2/translate' : 'https://api-free.deepl.com/v2/translate')
    const result = await postJson(
      url,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `DeepL-Auth-Key ${config.apiKey.trim()}`
        },
        body: JSON.stringify({ text: [...context, text], target_lang: target })
      },
      'DeepL'
    )
    if (!result.ok) return result
    const data = result.data as { translations?: { text?: string }[] }
    const list = data?.translations ?? []
    const last = list[list.length - 1]?.text
    return last ? { ok: true, translation: last } : { ok: false, error: 'DeepL 没有返回译文' }
  }

  if (provider === 'youdao') {
    if (!config.apiKey.trim() || !config.appSecret.trim()) {
      return { ok: false, error: '还没填有道的应用 ID 与密钥' }
    }
    const salt = randomUUID()
    const curtime = String(Math.floor(Date.now() / 1000))
    const sign = youdaoSign(config.apiKey.trim(), config.appSecret.trim(), text, salt, curtime)
    const body = new URLSearchParams({
      q: text,
      from: 'auto',
      to: target.split('-')[0],
      appKey: config.apiKey.trim(),
      salt,
      sign,
      signType: 'v3',
      curtime
    })
    const result = await postJson(
      config.endpoint || 'https://openapi.youdao.com/api',
      { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body },
      '有道翻译'
    )
    if (!result.ok) return result
    const data = result.data as { errorCode?: string; translation?: string[] }
    if (data?.errorCode && data.errorCode !== '0') {
      return { ok: false, error: `有道返回错误码 ${data.errorCode}（常见：1081 应用 ID 不对，202 签名不对）` }
    }
    const joined = (data?.translation ?? []).join('\n').trim()
    return joined ? { ok: true, translation: joined } : { ok: false, error: '有道没有返回译文' }
  }

  return { ok: false, error: '还没有选择翻译方式（设置 → 翻译）' }
}

/**
 * 翻译一段文本。上下文由阅读器按 `contextSize` 取好传进来；
 * 用哪条接口配置、哪套提示词，由调用方（IPC 层）从设置里解析好传进来。
 */
export async function translateText(request: TranslateRequest): Promise<TranslateResult> {
  const config = request.endpoint ?? null
  const provider: TranslateProvider = config?.provider ?? 'ai'
  const target = request.target || 'zh-CN'
  const text = request.text.trim().slice(0, MAX_CHARS)
  const context = request.context
    .map((line) => line.trim().slice(0, MAX_CHARS))
    .filter((line) => line.length > 0 && line !== text)
  const base = { provider, source: text, contextUsed: context.length, at: Date.now() }

  if (!text) return { ...base, ok: false, translation: '', error: '没有选中任何文字' }
  if (!config) {
    return { ...base, ok: false, translation: '', error: '还没有选择翻译方式（设置 → 翻译）' }
  }

  const result =
    config.kind === 'ai'
      ? await translateWithAi(
          config,
          request.prompt?.trim() || DEFAULT_TRANSLATE_PROMPT,
          target,
          text,
          context
        )
      : await translateMachine(config.provider, config, targetFor(config.provider, target), text, context)

  if (!result.ok) return { ...base, ok: false, translation: '', error: result.error }
  const analysis = (result as { analysis?: string }).analysis
  return {
    ...base,
    ok: true,
    translation: result.translation,
    analysis: typeof analysis === 'string' ? analysis : undefined
  }
}

/* ------------------------------------------------------ 第二步：抽词 */

export interface VocabExtractRequest {
  /** 原文 */
  source: string
  /** 第一步得到的译文 */
  translation: string
  /** 第一步得到的解析（可空） */
  analysis?: string
  target?: string
  /** 用哪条接口；空则退到第一条可用的 AI 接口 */
  endpoint?: TranslateEndpoint | null
  /** 备选的 AI 接口（当前是机器翻译时用它们兜底） */
  aiEndpoints?: TranslateEndpoint[]
}

export interface VocabExtractResult {
  ok: boolean
  words: { term: string; reading: string; meaning: string; kind: 'word' | 'phrase' }[]
  error?: string
  /** 实际用了哪条接口（面板上给个提示，便于排查） */
  endpointName?: string
}

/**
 * 从"原文 + 译文"里抽词。
 *
 * 单独一次请求，只让它回 JSON —— 这是把词汇识别从"翻译请求的附带格式"里解放出来：
 * 模型这一轮不需要操心译文，只要老老实实挑词、原样抄词形、别把释义写进第一列。
 * 机器翻译没有模型可用，所以这里会退到一条 AI 接口；一条都没有就明确报错。
 */
export async function extractVocab(request: VocabExtractRequest): Promise<VocabExtractResult> {
  const source = request.source.trim()
  const translation = request.translation.trim()
  if (!source) return { ok: false, words: [], error: '没有原文可抽词' }

  const candidates: TranslateEndpoint[] = []
  if (request.endpoint && request.endpoint.kind === 'ai') candidates.push(request.endpoint)
  for (const item of request.aiEndpoints ?? []) {
    if (item.kind === 'ai' && !candidates.some((c) => c.id === item.id)) candidates.push(item)
  }
  if (candidates.length === 0) {
    return { ok: false, words: [], error: '抽词要调用 AI 接口：设置 → 翻译 里配一条 AI 接口（或把当前接口切成 AI）' }
  }

  let lastError = ''
  for (const endpoint of candidates) {
    if (!endpoint.baseUrl?.trim() || !endpoint.model?.trim()) {
      lastError = 'AI 接口缺少 API 地址或模型名（设置 → 翻译）'
      continue
    }
    try {
      const result = await postJson(
        `${endpoint.baseUrl.replace(/\/+$/, '')}/chat/completions`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(endpoint.apiKey?.trim() ? { Authorization: `Bearer ${endpoint.apiKey.trim()}` } : {})
          },
          body: JSON.stringify({
            model: endpoint.model.trim(),
            messages: [
              { role: 'system', content: VOCAB_EXTRACT_PROMPT },
              {
                role: 'user',
                content: buildVocabExtractMessage({
                  source,
                  translation,
                  analysis: request.analysis,
                  target: request.target
                })
              }
            ],
            temperature: 0.1,
            stream: false
          })
        },
        'AI 接口'
      )
      if (!result.ok) {
        lastError = result.error
        continue
      }
      const data = result.data as { choices?: { message?: { content?: string } }[] }
      const content = data?.choices?.[0]?.message?.content
      if (typeof content !== 'string' || !content.trim()) {
        lastError = 'AI 没有返回内容'
        continue
      }
      const words = parseVocabJson(content)
      if (words.length === 0) {
        lastError = 'AI 返回里没有认出任何词'
        continue
      }
      logLine('translate', `抽词完成：${words.length} 条（${endpoint.name ?? endpoint.id}）`)
      return { ok: true, words, endpointName: endpoint.name ?? endpoint.id }
    } catch (error) {
      lastError = error instanceof Error ? error.message : '抽词请求失败'
    }
  }
  return { ok: false, words: [], error: lastError || '抽词失败' }
}

/* ------------------------------------------------------------ 翻译记录 */

/**
 * 翻译记录（面板上的「最近」）存在 userData 下的独立小文件里，不塞进 settings。
 *
 * 为什么不放设置文件：记录是"数据"不是"偏好"，会随使用不断增长，
 * 混进 settings.json 会让每次读写设置都拖着它一起走。
 *
 * 保留策略由设置决定：
 *   session —— **启动时**清掉（每次退出或加载时清除）
 *   limited —— 超过上限时丢掉最旧的
 *   keep    —— 从不清除
 */
function historyFile(): string {
  return join(app.getPath('userData'), 'translate-history.json')
}

export function readTranslateHistory(): TranslateHistoryEntry[] {
  const list = readJson<TranslateHistoryEntry[]>(historyFile(), [])
  return Array.isArray(list) ? list.filter((item) => item && typeof item.source === 'string') : []
}

/** 应用启动时按策略清一次（session 模式就是"加载时清除"） */
export function applyHistoryPolicyOnStart(): void {
  const settings = getSettings().translate
  if (settings.historyMode === 'session') {
    try {
      if (existsSync(historyFile())) rmSync(historyFile(), { force: true })
    } catch (error) {
      logLine('translate', `清理翻译记录失败：${String(error)}`)
    }
  }
}

export function saveTranslateHistory(entries: TranslateHistoryEntry[]): TranslateHistoryEntry[] {
  const settings = getSettings().translate
  let next = Array.isArray(entries) ? entries.slice(0, 500) : []
  if (settings.historyMode === 'session') {
    /* session 模式下本次运行内仍然保留（关了应用才清），所以照常写盘 */
    next = next.slice(0, 200)
  } else if (settings.historyMode === 'limited') {
    next = next.slice(0, Math.max(1, Math.min(500, settings.historyLimit || 50)))
  }
  writeJson(historyFile(), next)
  return next
}

export function clearTranslateHistory(): void {
  try {
    if (existsSync(historyFile())) rmSync(historyFile(), { force: true })
  } catch (error) {
    logLine('translate', `清空翻译记录失败：${String(error)}`)
  }
}
