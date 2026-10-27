import { spawn, spawnSync } from 'node:child_process'
import { createHash, createHmac, randomUUID } from 'node:crypto'
import { readFile, rm } from 'node:fs/promises'
import type { TtsVoice } from '@shared/types'
import { join } from 'node:path'
import { app } from 'electron'
import { logLine } from './log'

/**
 * 文本朗读（TTS）。
 *
 * 两条来源：
 *   1. **Edge 在线语音** —— 就是 Edge 浏览器"大声朗读"用的那套（322 个语音、几十种语言，
 *      中文有晓晓/云希/云扬等）。这里直接走它的公开接口：一次 HTTPS 取语音清单，
 *      朗读时开一个 WebSocket、送 SSML、把回来的 mp3 分片拼起来。
 *   2. **系统语音** —— 交给渲染层用 Web Speech API（离线、零延迟，语种取决于系统装了什么）。
 *
 * 为什么放主进程：在线合成要开 WebSocket、要算鉴权头（Sec-MS-GEC），
 * 渲染层做这些既受跨域限制，也会把实现细节泄进页面。
 */

const TRUSTED_TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4'
const VOICES_URL = `https://speech.platform.bing.com/consumer/speech/synthesize/readaloud/voices/list?trustedclienttoken=${TRUSTED_TOKEN}`
const WS_BASE = 'wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1'
/** 微软给的客户端版本号，鉴权要用 */
const GEC_VERSION = '1-130.0.2849.68'

/**
 * Sec-MS-GEC：把「Windows 时间戳（100ns 为单位）+ 固定 token」哈希一下。
 * 时间戳按 5 分钟取整，所以同一个窗口内可以复用。
 */
function secMsGec(): string {
  const ticks = Math.floor((Date.now() / 1000 + 11644473600) / 300) * 300 * 10000000
  return createHash('sha256').update(`${ticks}${TRUSTED_TOKEN}`, 'utf8').digest('hex').toUpperCase()
}

let voiceCache: { at: number; list: TtsVoice[] } | null = null

/** 语音清单（缓存 6 小时：这份清单很少变，但也不该每次开面板都拉一遍） */
export async function listTtsVoices(force = false): Promise<TtsVoice[]> {
  if (!force && voiceCache && Date.now() - voiceCache.at < 6 * 3600 * 1000) return voiceCache.list
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 15000)
  try {
    const response = await fetch(VOICES_URL, { signal: controller.signal })
    if (!response.ok) throw new Error(`语音清单返回 ${response.status}`)
    const raw = (await response.json()) as {
      ShortName?: string
      FriendlyName?: string
      Gender?: string
      Locale?: string
      VoiceTag?: { ContentCategories?: string[]; VoicePersonalities?: string[] }
    }[]
    const list: TtsVoice[] = raw
      .filter((item) => item.ShortName && item.Locale)
      .map((item) => ({
        id: item.ShortName as string,
        name: (item.FriendlyName ?? item.ShortName ?? '').replace(/^Microsoft\s+/, '').replace(/\s+Online.*$/, ''),
        locale: item.Locale as string,
        gender: item.Gender ?? '',
        engine: 'edge' as const,
        /* "新闻/小说/聊天"这类标签，选语音时有用 */
        styles: item.VoiceTag?.VoicePersonalities ?? []
      }))
      .sort((a, b) => a.locale.localeCompare(b.locale) || a.name.localeCompare(b.name))
    voiceCache = { at: Date.now(), list }
    return list
  } catch (error) {
    logLine('tts', `取语音清单失败（HTTPS）：${String(error)}`)
    /* HTTPS 拉不到就用 edge-tts 自带的清单兜底（它随包发布，不用联网） */
    const fallback = listVoicesViaPython()
    if (fallback.length > 0) {
      voiceCache = { at: Date.now(), list: fallback }
      return fallback
    }
    /* 都不行时把旧缓存交出去，总比空列表好 */
    return voiceCache?.list ?? []
  } finally {
    clearTimeout(timer)
  }
}

/**
 * `edge-tts --list-voices` 的输出兜底。表格长这样（语言不在列里，藏在名字里）：
 * ```
 * Name                               Gender    ContentCategories      VoicePersonalities
 * af-ZA-AdriNeural                   Female    General                Friendly, Positive
 * ```
 */
function listVoicesViaPython(): TtsVoice[] {
  if (!detectPythonEdgeTts()) return []
  try {
    const result = spawnSync(pythonState.command[0], ['-m', 'edge_tts', '--list-voices'], {
      timeout: 20000,
      encoding: 'utf8',
      windowsHide: true
    })
    if (result.status !== 0 || !result.stdout) return []
    const list: TtsVoice[] = []
    for (const line of String(result.stdout).split(/\r?\n/)) {
      const match = /^([a-z]{2,3}-[A-Za-z]{2,4}-[A-Za-z]+Neural)\s+(Male|Female)/.exec(line.trim())
      if (!match) continue
      const id = match[1]
      const parts = id.split('-')
      const locale = `${parts[0]}-${parts[1]}`
      /* zh-CN-XiaoxiaoNeural → Xiaoxiao */
      const name = parts.slice(2).join('').replace(/Neural$/, '')
      list.push({ id, name, locale, gender: match[2], engine: 'edge' })
    }
    logLine('tts', `edge-tts 清单兜底：${list.length} 个语音`)
    return list.sort((a, b) => a.locale.localeCompare(b.locale) || a.name.localeCompare(b.name))
  } catch (error) {
    logLine('tts', `edge-tts 清单兜底失败：${String(error)}`)
    return []
  }
}

export interface TtsSpeakRequest {
  text: string
  /** 语音 short name（Edge 那套）；有道/腾讯用自己的音色参数，忽略它 */
  voice: string
  /** 语速：0.5–2，1 为原速 */
  rate: number
  /** 音调：0.5–2 */
  pitch: number
  /** 走哪家：edge（Python 优先）/ youdao / tencent */
  engine?: 'edge' | 'system' | 'youdao' | 'tencent'
  youdaoAppKey?: string
  youdaoAppSecret?: string
  tencentSecretId?: string
  tencentSecretKey?: string
  tencentRegion?: string
}

/* ------------------------------------------------------------ 有道智云 */

/**
 * 有道智云「语音合成」：一次 HTTPS POST 拿到 speakUrl，再取那个 mp3。
 *
 * 鉴权与它的翻译接口同一套 v3 规则：sha256(appKey + input + salt + curtime + appSecret)，
 * input 的取法也一样（≤20 字用原文，否则前 10 + 长度 + 后 10）。
 */
async function synthesizeYoudao(request: TtsSpeakRequest): Promise<{ audio: string; mime: string }> {
  const appKey = (request.youdaoAppKey ?? '').trim()
  const appSecret = (request.youdaoAppSecret ?? '').trim()
  if (!appKey || !appSecret) throw new Error('有道语音合成还没填 appKey / appSecret（在「设置 → 阅读与编辑 → 文本朗读」里填）')
  const text = request.text.trim()
  const salt = randomUUID()
  const curtime = String(Math.floor(Date.now() / 1000))
  const input = text.length <= 20 ? text : `${text.slice(0, 10)}${text.length}${text.slice(-10)}`
  const sign = createHash('sha256').update(`${appKey}${input}${salt}${curtime}${appSecret}`, 'utf8').digest('hex')
  const form = new URLSearchParams({
    q: text,
    appKey,
    salt,
    sign,
    signType: 'v3',
    curtime,
    format: 'mp3',
    speed: String(Math.min(2, Math.max(0.5, request.rate ?? 1))),
    voice: '0',
    langType: /[\u4e00-\u9fa5]/.test(text) ? 'zh-CHS' : 'en'
  })
  const response = await fetch('https://openapi.youdao.com/ttsapi', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString()
  })
  if (!response.ok) throw new Error(`有道语音合成返回 ${response.status}`)
  const payload = (await response.json()) as { errorCode?: string; speakUrl?: string; message?: string }
  if (payload.errorCode && payload.errorCode !== '0') {
    throw new Error(`有道语音合成失败：${payload.errorCode} ${payload.message ?? ''}`)
  }
  if (!payload.speakUrl) throw new Error('有道没有返回 speakUrl')
  const audioResponse = await fetch(payload.speakUrl)
  if (!audioResponse.ok) throw new Error(`取有道音频失败 ${audioResponse.status}`)
  const audio = Buffer.from(await audioResponse.arrayBuffer())
  if (audio.length < 512) throw new Error('有道返回的音频是空的')
  return { audio: audio.toString('base64'), mime: 'audio/mpeg' }
}

/* ------------------------------------------------------------ 腾讯云 */

/**
 * 腾讯云「语音合成」（TextToVoice，2019-08-23）：TC3-HMAC-SHA256 签名 + HTTPS POST，
 * 回来的 `Response.Audio` 本身就是 base64 的 mp3。
 */
async function synthesizeTencent(request: TtsSpeakRequest): Promise<{ audio: string; mime: string }> {
  const secretId = (request.tencentSecretId ?? '').trim()
  const secretKey = (request.tencentSecretKey ?? '').trim()
  if (!secretId || !secretKey) {
    throw new Error('腾讯云语音合成还没填 SecretId / SecretKey（在「设置 → 阅读与编辑 → 文本朗读」里填）')
  }
  const region = (request.tencentRegion ?? '').trim() || 'ap-guangzhou'
  const host = 'tts.tencentcloudapi.com'
  const service = 'tts'
  const english = /^[a-zA-Z\s.,!?'"-]+$/.test(request.text)
  const payload = JSON.stringify({
    Text: request.text.trim(),
    SessionId: randomUUID().replace(/-/g, ''),
    /* 101001 / 101002 中文男女声，1051 英文 */
    VoiceType: english ? 1051 : 101001,
    Speed: Math.round((Math.min(2, Math.max(0.5, request.rate ?? 1)) - 1) * 50) / 50,
    Volume: 0,
    Codec: 'mp3'
  })
  const timestamp = Math.floor(Date.now() / 1000)
  const date = new Date(timestamp * 1000).toISOString().slice(0, 10)
  const sha256 = (value: string): string => createHash('sha256').update(value, 'utf8').digest('hex')

  const canonicalRequest = [
    'POST',
    '/',
    '',
    `content-type:application/json; charset=utf-8\nhost:${host}\n`,
    'content-type;host',
    sha256(payload)
  ].join('\n')
  const stringToSign = ['TC3-HMAC-SHA256', String(timestamp), `${date}/${service}/tc3_request`, sha256(canonicalRequest)].join(
    '\n'
  )
  const hmac = (key: Buffer, value: string): Buffer => createHmac('sha256', key).update(value, 'utf8').digest()
  const secretDate = hmac(Buffer.from(`TC3${secretKey}`, 'utf8'), date)
  const secretService = hmac(secretDate, service)
  const secretSigning = hmac(secretService, 'tc3_request')
  const signature = createHmac('sha256', secretSigning).update(stringToSign, 'utf8').digest('hex')
  const authorization = `TC3-HMAC-SHA256 Credential=${secretId}/${date}/${service}/tc3_request, SignedHeaders=content-type;host, Signature=${signature}`

  const response = await fetch(`https://${host}`, {
    method: 'POST',
    headers: {
      Authorization: authorization,
      'Content-Type': 'application/json; charset=utf-8',
      'X-TC-Action': 'TextToVoice',
      'X-TC-Version': '2019-08-23',
      'X-TC-Timestamp': String(timestamp),
      'X-TC-Region': region
    },
    body: payload
  })
  if (!response.ok) throw new Error(`腾讯云语音合成返回 ${response.status}`)
  const result = (await response.json()) as {
    Response?: { Audio?: string; Error?: { Code?: string; Message?: string } }
  }
  const error = result.Response?.Error
  if (error) throw new Error(`腾讯云语音合成失败：${error.Code ?? ''} ${error.Message ?? ''}`)
  const audio = result.Response?.Audio ?? ''
  if (audio.length < 256) throw new Error('腾讯云没有返回音频')
  return { audio, mime: 'audio/mpeg' }
}

/** 把文本夹进 SSML（转义 XML 特殊字符，换行拆成句间停顿） */
function buildSsml(request: TtsSpeakRequest): string {
  const escape = (text: string): string =>
    text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;')
  const rate = Math.round(((request.rate ?? 1) - 1) * 100)
  const pitch = Math.round(((request.pitch ?? 1) - 1) * 50)
  const body = request.text
    .split(/\n+/)
    .map((line) => escape(line.trim()))
    .filter(Boolean)
    .join('<break time="220ms"/>')
  return `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='en-US'><voice name='${escape(
    request.voice
  )}'><prosody rate='${rate >= 0 ? '+' : ''}${rate}%' pitch='${pitch >= 0 ? '+' : ''}${pitch}%'>${body}</prosody></voice></speak>`
}

/* ------------------------------------------------------------ 走 Python */

/**
 * 用 Python 的 `edge-tts` 子进程合成。
 *
 * 为什么要有这条路：Edge 的合成要开 WebSocket，而 Node 内置的 WebSocket **不读代理环境变量** ——
 * 在需要代理才能出网的环境里，内置那条路会一直连不上（实测就是这样）。
 * Python 的 aiohttp 会读 `HTTPS_PROXY`，同一个网络环境下 `edge-tts` 一次就成，
 * 所以这里优先走 Python；它不可用（没装 Python / 没装 edge-tts）时再回落到内置 WebSocket。
 *
 * 代价是要落一个临时文件（CLI 只支持写文件），用完立刻删。
 */
let pythonState: { checked: boolean; ok: boolean; command: string[] } = {
  checked: false,
  ok: false,
  command: []
}

/** 找可用的 Python + edge_tts（结果缓存，启动一次就够） */
export function detectPythonEdgeTts(force = false): boolean {
  if (pythonState.checked && !force) return pythonState.ok
  pythonState = { checked: true, ok: false, command: [] }
  const candidates: string[][] = [
    ['python'],
    ['py'],
    ['python3'],
    [join(process.env.LOCALAPPDATA ?? '', 'Python', 'pythoncore-3.14-64', 'python.exe')]
  ]
  for (const base of candidates) {
    if (!base[0]) continue
    try {
      const result = spawnSync(base[0], ['-c', 'import edge_tts; print(edge_tts.__version__)'], {
        timeout: 15000,
        encoding: 'utf8',
        windowsHide: true
      })
      if (result.status === 0 && String(result.stdout ?? '').trim().length > 0) {
        pythonState = { checked: true, ok: true, command: base }
        logLine('tts', `用 ${base[0]} 的 edge_tts ${String(result.stdout).trim()}`)
        return true
      }
    } catch {
      /* 这个候选不行，换下一个 */
    }
  }
  logLine('tts', '没有找到可用的 edge-tts（Python）')
  return false
}

/** python 那条：写临时 mp3 → 读回来 → 删掉 */
async function synthesizeWithPython(
  request: TtsSpeakRequest
): Promise<{ audio: string; mime: string }> {
  const rate = Math.round(((request.rate ?? 1) - 1) * 100)
  const pitch = Math.round(((request.pitch ?? 1) - 1) * 50)
  const file = join(app.getPath('temp'), `bookscent-tts-${randomUUID()}.mp3`)
  const args = [
    '-m',
    'edge_tts',
    '--voice',
    request.voice,
    '--text',
    request.text.trim(),
    '--rate',
    `${rate >= 0 ? '+' : ''}${rate}%`,
    '--pitch',
    `${pitch >= 0 ? '+' : ''}${pitch}Hz`,
    '--write-media',
    file
  ]
  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(pythonState.command[0], args, {
        windowsHide: true,
        /* 代理等环境变量原样传下去：Python 会读 HTTPS_PROXY */
        env: process.env
      })
      let stderr = ''
      const timer = setTimeout(() => {
        try {
          child.kill()
        } catch {
          /* 杀不掉就算了 */
        }
        reject(new Error('Python 合成超时（30 秒）'))
      }, 30000)
      child.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString()
      })
      child.on('error', (error) => {
        clearTimeout(timer)
        reject(new Error(`调不起 Python：${String(error)}`))
      })
      child.on('close', (code) => {
        clearTimeout(timer)
        if (code === 0) resolve()
        else reject(new Error(`edge-tts 退出码 ${code}：${stderr.slice(-200)}`))
      })
    })
    const audio = await readFile(file)
    if (audio.length < 512) throw new Error('edge-tts 没有产出音频')
    return { audio: audio.toString('base64'), mime: 'audio/mpeg' }
  } finally {
    try {
      await rm(file, { force: true })
    } catch {
      /* 删不掉就留着，不影响结果 */
    }
  }
}

/**
 * 对外入口：按引擎分派。
 *   - `youdao` / `tencent`：直接用它们各自的云接口；
 *   - 其余（edge）：Python 的 edge-tts 优先，不可用再回落到内置 WebSocket。
 */
export async function synthesizeSpeech(
  request: TtsSpeakRequest
): Promise<{ audio: string; mime: string }> {
  if (!request.text.trim()) throw new Error('没有要朗读的文字')
  if (request.engine === 'youdao') return synthesizeYoudao(request)
  if (request.engine === 'tencent') return synthesizeTencent(request)
  if (!request.voice) throw new Error('还没有选择语音')
  if (detectPythonEdgeTts()) {
    try {
      return await synthesizeWithPython(request)
    } catch (error) {
      logLine('tts', `Python 合成失败，改用内置 WebSocket：${String(error)}`)
    }
  }
  return synthesizeViaWebSocket(request)
}

/**
 * 内置那条：开 WebSocket → 送 config 与 SSML → 收 mp3 分片 → 拼成 base64。
 *
 * Node 内置的 WebSocket 不读代理环境变量，所以需要代理才能出网的机器上这条路会失败
 * （上面优先走 Python 就是为了这个）。帧格式：二进制帧前两字节是头长度（大端），
 * 头是文本（含 Path:audio），后面才是音频。
 */
function synthesizeViaWebSocket(
  request: TtsSpeakRequest
): Promise<{ audio: string; mime: string }> {
  return new Promise((resolve, reject) => {
    const text = request.text.trim()
    if (!text) {
      reject(new Error('没有要朗读的文字'))
      return
    }
    if (!request.voice) {
      reject(new Error('还没有选择语音'))
      return
    }
    const WebSocketImpl = (globalThis as { WebSocket?: typeof WebSocket }).WebSocket
    if (!WebSocketImpl) {
      reject(new Error('当前运行环境不支持 WebSocket，请改用系统语音'))
      return
    }

    const connectionId = randomUUID().replace(/-/g, '')
    const url = `${WS_BASE}?TrustedClientToken=${TRUSTED_TOKEN}&Sec-MS-GEC=${secMsGec()}&Sec-MS-GEC-Version=${GEC_VERSION}&ConnectionId=${connectionId}`
    let socket: WebSocket
    try {
      socket = new WebSocketImpl(url)
    } catch (error) {
      reject(new Error(`连不上语音服务：${String(error)}`))
      return
    }
    socket.binaryType = 'arraybuffer'

    const chunks: Buffer[] = []
    const stop = (error?: Error, audio?: Buffer): void => {
      clearTimeout(timer)
      try {
        socket.close()
      } catch {
        /* 关不掉就算了 */
      }
      if (error) reject(error)
      else resolve({ audio: (audio ?? Buffer.alloc(0)).toString('base64'), mime: 'audio/mpeg' })
    }
    const timer = setTimeout(() => stop(new Error('语音合成超时（20 秒）')), 20000)

    socket.onopen = () => {
      const timestamp = new Date().toISOString()
      /* 1) 告诉服务端要什么格式 */
      socket.send(
        `X-Timestamp:${timestamp}\r\nContent-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n` +
          JSON.stringify({
            context: {
              synthesis: {
                audio: {
                  metadataoptions: { sentenceBoundaryEnabled: 'false', wordBoundaryEnabled: 'false' },
                  outputFormat: 'audio-24khz-48kbitrate-mono-mp3'
                }
              }
            }
          })
      )
      /* 2) 送 SSML */
      socket.send(
        `X-RequestId:${randomUUID().replace(/-/g, '')}\r\nContent-Type:application/ssml+xml\r\nX-Timestamp:${timestamp}Z\r\nPath:ssml\r\n\r\n` +
          buildSsml(request)
      )
    }

    socket.onmessage = (event: MessageEvent) => {
      const data = event.data as ArrayBuffer | string
      if (typeof data === 'string') {
        /* turn.end = 这一句说完了 */
        if (data.includes('Path:turn.end')) stop(undefined, Buffer.concat(chunks))
        return
      }
      const buffer = Buffer.from(data)
      if (buffer.length < 2) return
      const headerLength = buffer.readUInt16BE(0)
      const header = buffer.subarray(2, 2 + headerLength).toString('utf8')
      if (!header.includes('Path:audio')) return
      const audio = buffer.subarray(2 + headerLength)
      if (audio.length > 0) chunks.push(Buffer.from(audio))
    }

    socket.onerror = () => stop(new Error('语音服务连接出错（网络或服务不可用）'))
    socket.onclose = () => {
      /* 没收到 turn.end 就断了：有内容就当成功，没内容才报错 */
      if (chunks.length > 0) stop(undefined, Buffer.concat(chunks))
    }
  })
}
