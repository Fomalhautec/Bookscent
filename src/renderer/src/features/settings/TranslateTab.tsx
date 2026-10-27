import { useEffect, useState, type ReactNode } from 'react'
import type {
  AppSettings,
  TranslateEndpoint,
  TranslateHistoryEntry,
  TranslateHistoryMode,
  TranslatePreset,
  TranslateProvider
} from '@shared/types'
import { Button, IconButton, SectionTitle, Segmented, Select, Switch, TextInput } from '@/components/common/Controls'
import { IconList, IconPlus, IconRefresh, IconTrash } from '@/components/icons/Icons'
import { DEFAULT_TRANSLATE_PROMPT, TRANSLATE_PRESETS } from '@shared/translatePrompt'
import { libraryApi } from '@/lib/api'
import { useTranslate } from '@/store/useTranslate'
import { useSettings } from '@/store/useSettings'
import { useUi } from '@/store/useUi'

const TARGETS = ['zh-CN', 'zh-TW', 'en', 'ja', 'ko', 'fr', 'de', 'es', 'ru']

/** 机翻四家的字段差异（哪几家要区域、要应用密钥、要 Pro 开关） */
const MACHINE_PROVIDERS: {
  value: TranslateProvider
  label: string
  hint: string
  needsRegion?: boolean
  needsSecret?: boolean
  needsPro?: boolean
}[] = [
  { value: 'google', label: 'Google', hint: 'Cloud Translation v2，用 API Key。' },
  { value: 'microsoft', label: '微软', hint: 'Azure Translator，需要 Key 与区域。', needsRegion: true },
  { value: 'deepl', label: 'DeepL', hint: 'Free 与 Pro 是两个域名。', needsPro: true },
  { value: 'youdao', label: '有道', hint: '文本翻译 v3，需要应用 ID 与密钥（本地签名）。', needsSecret: true }
]

function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`
}

function blankEndpoint(kind: 'ai' | 'machine'): TranslateEndpoint {
  return {
    id: newId(kind === 'ai' ? 'ai' : 'mt'),
    name: kind === 'ai' ? '新的 AI 接口' : '新的机翻接口',
    kind,
    provider: kind === 'ai' ? 'ai' : 'google',
    apiKey: '',
    region: '',
    appSecret: '',
    pro: false,
    endpoint: '',
    baseUrl: kind === 'ai' ? 'https://api.deepseek.com/v1' : '',
    model: kind === 'ai' ? 'deepseek-chat' : ''
  }
}

/**
 * 「翻译」设置页。
 *
 * 两块内容，按用户提的重排过：
 *   1. **接口配置**分成「AI 翻译」与「机器翻译」两大类，每类是一张列表 ——
 *      同时用 DeepSeek 翻日语、硅基流动翻英语、偶尔切 Google 应急，是很常见的用法，
 *      所以每条都能单独命名、单独存密钥，点一下就切换当前使用的那条。
 *   2. **提示词预设**按文本类型分（轻小说 / 历史 / 科技…），能改、能加、能删
 *      （内置的删不掉但能恢复默认）。翻译栏里也能切换，读的时候随手换一套。
 */
export function TranslateTab({
  settings,
  onOpenSub
}: {
  settings: AppSettings
  /** 跳到「翻译记录」子页 */
  onOpenSub?: (id: 'translate-history') => void
}): ReactNode {
  /* 一进这一页就把记录读出来 */
  useEffect(() => {
    void reloadHistory() 
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const patch = useSettings((s) => s.patch)
  const toast = useUi((s) => s.toast)
  const config = settings.translate
  const [showKey, setShowKey] = useState(false)
  /* 记录列表：从主进程读回来，删一条就同步一次 */
  const [historyList, setHistoryList] = useState<TranslateHistoryEntry[]>([])
  const loadHistory = useTranslate((s) => s.loadHistory)
  const removeHistory = useTranslate((s) => s.remove)
  const clearHistory = useTranslate((s) => s.clear)

  const save = (next: Partial<AppSettings['translate']>): void => {
    void patch({ translate: { ...config, ...next } })
  }

  const active = config.endpoints.find((item) => item.id === config.activeId) ?? config.endpoints[0] ?? null
  const aiList = config.endpoints.filter((item) => item.kind === 'ai')
  const machineList = config.endpoints.filter((item) => item.kind === 'machine')
  const keyType = showKey ? 'text' : 'password'

  const updateEndpoint = (id: string, next: Partial<TranslateEndpoint>): void => {
    save({
      endpoints: config.endpoints.map((item) => (item.id === id ? { ...item, ...next } : item))
    })
  }

  const removeEndpoint = (id: string): void => {
    const rest = config.endpoints.filter((item) => item.id !== id)
    save({
      endpoints: rest,
      activeId: config.activeId === id ? (rest[0]?.id ?? '') : config.activeId
    })
  }

  const addEndpoint = (kind: 'ai' | 'machine'): void => {
    const entry = blankEndpoint(kind)
    save({ endpoints: [...config.endpoints, entry], activeId: entry.id, enabled: true })
  }

  /* ------------------------------------------------ 预设 */
  const activePreset =
    config.presets.find((item) => item.id === config.activePresetId) ?? config.presets[0] ?? null

  const updatePreset = (id: string, next: Partial<TranslatePreset>): void => {
    save({ presets: config.presets.map((item) => (item.id === id ? { ...item, ...next } : item)) })
  }

  const builtinPromptOf = (id: string): string =>
    TRANSLATE_PRESETS.find((item) => item.id === id)?.prompt ?? DEFAULT_TRANSLATE_PROMPT

  const addPreset = (): void => {
    const entry: TranslatePreset = {
      id: newId('preset'),
      name: `我的预设 ${config.presets.filter((item) => !item.builtin).length + 1}`,
      prompt: activePreset?.prompt ?? DEFAULT_TRANSLATE_PROMPT
    }
    save({ presets: [...config.presets, entry], activePresetId: entry.id })
  }

  const reloadHistory = async (): Promise<void> => {
    try {
      const rows = await libraryApi.translateHistoryGet()
      setHistoryList(Array.isArray(rows) ? rows : [])
    } catch (error) {
      toast('读取翻译记录失败', 'error', error instanceof Error ? error.message : String(error))
    }
  }

  const endpointRow = (entry: TranslateEndpoint): ReactNode => (
    <div
      key={entry.id}
      className={['translate-ep-row', entry.id === config.activeId ? 'is-active' : ''].filter(Boolean).join(' ')}
    >
      <button
        type="button"
        className="translate-ep-pick"
        onClick={() => save({ activeId: entry.id, enabled: true })}
        title="设为当前使用"
      >
        <span className="translate-ep-radio" data-on={entry.id === config.activeId ? 'true' : 'false'} />
        <span className="translate-ep-name">{entry.name || '未命名'}</span>
        <span className="translate-ep-sub">
          {entry.kind === 'ai'
            ? `${entry.model || '未填模型'}${entry.baseUrl ? '' : ' · 未填地址'}`
            : MACHINE_PROVIDERS.find((item) => item.value === entry.provider)?.label ?? entry.provider}
        </span>
      </button>
      <IconButton label="删除这条" tone="muted" onClick={() => removeEndpoint(entry.id)}>
        <IconTrash size={14} />
      </IconButton>
    </div>
  )

  return (
    <div className="set-tab">
      <section className="set-block">
        <SectionTitle hint="选中正文时是否出现「翻译」入口；关掉则整条功能不打扰。">
          翻译
        </SectionTitle>
        <div className="set-fields">
          <div className="set-field">
            <span className="set-field-label">启用翻译</span>
            <Switch checked={config.enabled} onChange={(enabled) => save({ enabled })} />
          </div>
          <div className="set-field">
            <span className="set-field-label">目标语言</span>
            {/*
              九种语言用分段控件会撑破一行（用户反馈"溢出来了"）——
              换成下拉，窄栏里也放得下，语言再多也不怕。
            */}
            <Select
              value={config.target}
              options={TARGETS.map((code) => ({ value: code, label: code }))}
              onChange={(value) => save({ target: value })}
            />
          </div>
          <div className="set-field">
            <span className="set-field-label">上下文段数</span>
            <TextInput
              value={String(config.contextSize)}
              onChange={(event) => {
                const size = Math.max(0, Math.min(8, Number(event.target.value.replace(/[^\d]/g, '')) || 0))
                save({ contextSize: size })
              }}
            />
          </div>
          <div className="set-field">
            <span className="set-field-label">显示密钥</span>
            <Switch checked={showKey} onChange={setShowKey} />
          </div>
        </div>
        <p className="set-hint">
          上下文段数：翻译时把前后各这么多段一起送过去（机翻也支持）——
          代词、省略主语靠它才不会译飞；0 表示只译那一段。
        </p>
      </section>

      {/* ------------------------------------------------ AI 类 */}
      <section className="set-block">
        <SectionTitle hint="任何 OpenAI 兼容平台：DeepSeek、硅基流动、火山、本地 ollama / LM Studio。译文之外还给语法词汇解析。">
          AI 翻译
        </SectionTitle>
        <div className="translate-ep-list">
          {aiList.map(endpointRow)}
          {aiList.length === 0 ? <p className="set-hint">还没有 AI 接口，点下面的「新增」加一条。</p> : null}
        </div>
        <div className="translate-ep-actions">
          <Button size="xs" variant="outline" icon={<IconPlus size={13} />} onClick={() => addEndpoint('ai')}>
            新增 AI 接口
          </Button>
        </div>

        {active?.kind === 'ai' ? (
          <div className="translate-ep-editor">
            <div className="set-fields">
              <div className="set-field">
                <span className="set-field-label">名称</span>
                <TextInput
                  value={active.name}
                  placeholder="例如 DeepSeek 主力"
                  onChange={(event) => updateEndpoint(active.id, { name: event.target.value })}
                />
              </div>
              <div className="set-field">
                <span className="set-field-label">API 地址</span>
                <TextInput
                  value={active.baseUrl}
                  placeholder="https://api.deepseek.com/v1"
                  onChange={(event) => updateEndpoint(active.id, { baseUrl: event.target.value })}
                />
              </div>
              <div className="set-field">
                <span className="set-field-label">API Key</span>
                <TextInput
                  value={active.apiKey}
                  type={keyType}
                  placeholder="sk-…（本地模型可留空）"
                  onChange={(event) => updateEndpoint(active.id, { apiKey: event.target.value })}
                />
              </div>
              <div className="set-field">
                <span className="set-field-label">模型</span>
                <TextInput
                  value={active.model}
                  placeholder="deepseek-chat"
                  onChange={(event) => updateEndpoint(active.id, { model: event.target.value })}
                />
              </div>
            </div>
            <p className="set-hint">地址填到 /v1 为止即可，程序自己拼 /chat/completions。</p>
          </div>
        ) : null}
      </section>

      {/* ------------------------------------------------ 机翻类 */}
      <section className="set-block">
        <SectionTitle hint="只给译文，不含语法解析；胜在便宜、快、稳定。">
          机器翻译
        </SectionTitle>
        <div className="translate-ep-list">
          {machineList.map(endpointRow)}
          {machineList.length === 0 ? <p className="set-hint">还没有机翻接口。</p> : null}
        </div>
        <div className="translate-ep-actions">
          <Button
            size="xs"
            variant="outline"
            icon={<IconPlus size={13} />}
            onClick={() => addEndpoint('machine')}
          >
            新增机翻接口
          </Button>
        </div>

        {active?.kind === 'machine' ? (
          <div className="translate-ep-editor">
            <div className="set-fields">
              <div className="set-field">
                <span className="set-field-label">名称</span>
                <TextInput
                  value={active.name}
                  onChange={(event) => updateEndpoint(active.id, { name: event.target.value })}
                />
              </div>
              <div className="set-field">
                <span className="set-field-label">服务</span>
                <Segmented
                  value={active.provider}
                  onChange={(value) =>
                    updateEndpoint(active.id, {
                      provider: value,
                      /* 换服务时把不适用的字段清掉，免得带着上一家的密钥发请求 */
                      appSecret: value === 'youdao' ? active.appSecret : '',
                      region: value === 'microsoft' ? active.region : '',
                      pro: value === 'deepl' ? active.pro : false
                    })
                  }
                  options={MACHINE_PROVIDERS.map((item) => ({
                    value: item.value,
                    label: item.label,
                    title: item.hint
                  }))}
                />
              </div>
              <div className="set-field">
                <span className="set-field-label">
                  {active.provider === 'youdao' ? '应用 ID' : 'API Key'}
                </span>
                <TextInput
                  value={active.apiKey}
                  type={keyType}
                  onChange={(event) => updateEndpoint(active.id, { apiKey: event.target.value })}
                />
              </div>
              {active.provider === 'youdao' ? (
                <div className="set-field">
                  <span className="set-field-label">应用密钥</span>
                  <TextInput
                    value={active.appSecret}
                    type={keyType}
                    onChange={(event) => updateEndpoint(active.id, { appSecret: event.target.value })}
                  />
                </div>
              ) : null}
              {active.provider === 'microsoft' ? (
                <div className="set-field">
                  <span className="set-field-label">区域</span>
                  <TextInput
                    value={active.region}
                    placeholder="eastasia（全球资源可留空）"
                    onChange={(event) => updateEndpoint(active.id, { region: event.target.value })}
                  />
                </div>
              ) : null}
              {active.provider === 'deepl' ? (
                <div className="set-field">
                  <span className="set-field-label">Pro 版</span>
                  <Switch
                    checked={active.pro}
                    onChange={(pro) => updateEndpoint(active.id, { pro })}
                  />
                </div>
              ) : null}
              <div className="set-field">
                <span className="set-field-label">接口地址</span>
                <TextInput
                  value={active.endpoint}
                  placeholder="留空即用官方地址"
                  onChange={(event) => updateEndpoint(active.id, { endpoint: event.target.value })}
                />
              </div>
            </div>
            <p className="set-hint">
              {MACHINE_PROVIDERS.find((item) => item.value === active.provider)?.hint}
            </p>
          </div>
        ) : null}
      </section>

      {/* ------------------------------------------------ 翻译记录 */}
      <section className="set-block">
        <SectionTitle hint="面板里「最近」的那些记录。默认关掉应用就清掉；想留着复习就改成「超过上限再清」或「从不清除」。">
          翻译记录
        </SectionTitle>
        <div className="set-fields">
          <div className="set-field">
            <span className="set-field-label">清除时机</span>
            <Segmented
              value={config.historyMode}
              onChange={(value) => save({ historyMode: value as TranslateHistoryMode })}
              options={[
                { value: 'session', label: '退出/加载时清除', title: '每次关掉应用或重新打开时清空' },
                { value: 'limited', label: '超过上限时清除', title: '只保留最近的若干条' },
                { value: 'keep', label: '从不清除', title: '一直留着，需要时自己去删' }
              ]}
            />
          </div>
          {config.historyMode === 'limited' ? (
            <div className="set-field">
              <span className="set-field-label">保留条数</span>
              <TextInput
                value={String(config.historyLimit)}
                onChange={(event) => {
                  const limit = Math.max(
                    1,
                    Math.min(500, Number(event.target.value.replace(/[^\d]/g, '')) || 50)
                  )
                  save({ historyLimit: limit })
                }}
              />
            </div>
          ) : null}
        </div>

        {/*
          记录列表搬到「翻译记录」子页去了（一条一行的表格，能放下更多也更好找）。
          这里只留一句摘要 + 入口 —— 用户提的："应该有单独的跳转页面，而且应该分栏、类似表格"。
        */}
        <p className="set-hint">
          {historyList.length === 0
            ? '还没有记录。'
            : `现有 ${historyList.length} 条记录：最新一条是「${historyList[0].source.slice(0, 24)}」。`}
        </p>
        <div className="set-actions set-actions-left">
          <Button
            variant="outline"
            icon={<IconList size={14} />}
            disabled={!onOpenSub}
            onClick={() => onOpenSub?.('translate-history')}
          >
            查看全部记录
          </Button>
          <Button
            variant="outline"
            icon={<IconTrash size={14} />}
            disabled={historyList.length === 0}
            onClick={() => {
              clearHistory()
              setHistoryList([])
              toast('翻译记录已清空', 'success')
            }}
          >
            清空全部
          </Button>
        </div>
      </section>

      {/* ------------------------------------------------ 提示词预设 */}
      <section className="set-block">
        <SectionTitle hint="按文本类型分：同是一句话，轻小说要口语与语气，论文要术语与限定关系。翻译栏里也能切换。">
          提示词预设
        </SectionTitle>
        <div className="translate-preset-list">
          {config.presets.map((preset) => (
            <button
              key={preset.id}
              type="button"
              className={['translate-preset-chip', preset.id === config.activePresetId ? 'is-active' : '']
                .filter(Boolean)
                .join(' ')}
              onClick={() => save({ activePresetId: preset.id })}
              title={preset.prompt.slice(0, 80)}
            >
              {preset.name}
            </button>
          ))}
        </div>
        <div className="translate-ep-actions">
          <Button size="xs" variant="outline" icon={<IconPlus size={13} />} onClick={addPreset}>
            新增预设
          </Button>
          {activePreset?.builtin ? (
            <Button
              size="xs"
              variant="outline"
              icon={<IconRefresh size={13} />}
              onClick={() => {
                updatePreset(activePreset.id, { prompt: builtinPromptOf(activePreset.id) })
                toast('已恢复这套预设的默认提示词', 'success')
              }}
            >
              恢复默认
            </Button>
          ) : (
            <Button
              size="xs"
              variant="outline"
              icon={<IconTrash size={13} />}
              disabled={config.presets.filter((item) => !item.builtin).length <= 1 && !activePreset?.builtin}
              onClick={() => {
                if (!activePreset) return
                const rest = config.presets.filter((item) => item.id !== activePreset.id)
                save({ presets: rest, activePresetId: rest[0]?.id ?? '' })
              }}
            >
              删除这套
            </Button>
          )}
        </div>

        {activePreset ? (
          <div className="translate-prompt">
            <div className="translate-prompt-head">
              <span className="set-field-label">预设名称</span>
              <TextInput
                value={activePreset.name}
                onChange={(event) => updatePreset(activePreset.id, { name: event.target.value })}
              />
              <span className="translate-spacer" />
              {activePreset.builtin ? <span className="set-hint">内置预设</span> : null}
            </div>
            <textarea
              className="text-input translate-prompt-area"
              value={activePreset.prompt}
              spellCheck={false}
              onChange={(event) => updatePreset(activePreset.id, { prompt: event.target.value })}
            />
            <p className="set-hint">
              提示词要求模型：先读懂上下文再翻译 → 译文自然、不逐字硬译 →
              解析分「语法 / 词汇 / 难句」三类，并且**只输出 JSON**（界面靠它分层）。
            </p>
          </div>
        ) : null}
      </section>
    </div>
  )
}
