import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useSettings } from '@/store/useSettings'
import { useTranslate } from '@/store/useTranslate'
import { useUi } from '@/store/useUi'
import { useVocab } from '@/store/useVocab'
import { detectLanguage, parseMarkdownVocab } from '@shared/vocab'
import { useLibrary } from '@/store/useLibrary'
import { Button, IconButton, Spinner } from '@/components/common/Controls'
import { IconChevronRight, IconClose, IconCopy, IconPlus, IconRefresh, IconSettings } from '@/components/icons/Icons'
import { SideResizer } from '@/components/common/SideResizer'
import { useSideWidth } from '@/lib/useSideWidth'
import { renderMarkdown } from '@/features/editor/lib/markdown'

/** 没起名字时显示什么：AI 看模型，机翻看服务 */
function engineLabel(endpoint: { kind: string; provider: string; model?: string }): string {
  if (endpoint.kind === 'ai') return endpoint.model ? `AI · ${endpoint.model}` : 'AI 翻译'
  const map: Record<string, string> = {
    google: 'Google 翻译',
    microsoft: '微软翻译',
    deepl: 'DeepL',
    youdao: '有道翻译'
  }
  return map[endpoint.provider] ?? endpoint.provider
}

/** 每一层的最小占比（占面板高度）：拖到头也不会把某一层压没 */
const MIN_RATIO = 0.12

/**
 * 翻译栏 —— 挂在阅读器**最右侧**（与左侧的目录栏各占一边）。
 *
 * 上下分三层而不是左右分栏（用户要求）：这个面板是窄长条，
 * 竖着放三列每列只剩一百多像素，中文一行放不下几个字。上下叠起来每层占满宽度，
 * 读起来舒服得多；层高还能拖着调 —— 查语法时把解析拉大，对照原文时把原文拉大。
 *
 * 「解析」是 Markdown（模型按提示词里的约定输出），这里真按 Markdown 渲染：
 * 列表、加粗、行内代码都是模型最自然的写法，当纯文本看会满屏 `**` 与 `-`。
 */
export function TranslatePanel(): ReactNode {
  const settings = useSettings((s) => s.settings)
  const patch = useSettings((s) => s.patch)
  const current = useTranslate((s) => s.current)
  const history = useTranslate((s) => s.history)
  const running = useTranslate((s) => s.run)
  const show = useTranslate((s) => s.show)
  const setOpen = useTranslate((s) => s.setOpen)
  const setView = useUi((s) => s.setView)
  /* 右栏宽度可拖（范围 260–720） */
  const side = useSideWidth('right')

  const config = settings?.translate
  const endpoint = config?.endpoints.find((item) => item.id === config.activeId) ?? null
  const enabled = config?.enabled === true && Boolean(endpoint)
  const target = config?.target ?? 'zh-CN'
  const contextSize = config?.contextSize ?? 2
  const isAi = endpoint?.kind === 'ai'
  const presets = config?.presets ?? []
  const activePreset =
    presets.find((item) => item.id === config?.activePresetId) ?? presets[0] ?? null
  const engineName = endpoint ? endpoint.name || engineLabel(endpoint) : '未设置'

  const result = current?.result ?? null
  /* 这个词从哪本书来的：单词本里会显示出处 */
  const bookTitle = useLibrary((s) => (s.index?.books ?? []).find((b) => b.id === s.openBookId)?.title ?? '')
  const bookId = useLibrary((s) => s.openBookId ?? '')

  const analysisHtml = result?.analysis ? renderMarkdown(result.analysis) : ''

  /*
   * 词汇：优先用**第二步抽词**的结果（单独一次请求、只回 JSON，格式最稳）；
   * 其次是老提示词附在解析里的 [[VOCAB]] 结构化块；
   * 再退一步才从「词汇」小节里做一次 Markdown 提取 —— 那条路最容易写走样，只当兜底。
   */
  const vocabWords = useMemo(() => {
    const extracted = current?.words ?? []
    if (extracted.length > 0) return extracted
    const structured = result?.vocabulary ?? []
    return structured.length > 0 ? structured : parseMarkdownVocab(result?.analysis)
  }, [current?.words, result])
  /* 语种取"被翻译的这段文字"：整句判断比逐词猜准 */
  const sentenceLanguage = useMemo(() => detectLanguage(result?.source ?? ''), [result?.source])
  const [vocabTab, setVocabTab] = useState<'analysis' | 'vocab'>('analysis')

  /* ------------------------------------------------ 三层高度（可拖） */
  const stackRef = useRef<HTMLDivElement | null>(null)
  const [ratios, setRatios] = useState<[number, number, number]>([1, 1, 1])
  /* 「最近」列表可以收起 */
  const [historyOpen, setHistoryOpen] = useState(true)
  const dragRef = useRef<{ index: number; y: number; a: number; b: number } | null>(null)

  const onDragStart = useCallback(
    (index: number) => (event: React.PointerEvent) => {
      event.preventDefault()
      dragRef.current = { index, y: event.clientY, a: ratios[index], b: ratios[index + 1] }
      ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
    },
    [ratios]
  )

  useEffect(() => {
    const onMove = (event: PointerEvent): void => {
      const drag = dragRef.current
      const box = stackRef.current?.getBoundingClientRect()
      if (!drag || !box || box.height <= 0) return
      const pair = drag.a + drag.b
      /* 三层都按同一尺度缩放，把"像素"换成"占比" */
      const delta = ((event.clientY - drag.y) / box.height) * 3 * pair
      const clamp = (value: number): number => Math.max(MIN_RATIO, Math.min(pair - MIN_RATIO, value))
      const nextA = clamp(drag.a + delta)
      const nextB = pair - nextA
      setRatios((prev) => {
        const next: [number, number, number] = [...prev]
        next[drag.index] = nextA
        next[drag.index + 1] = nextB
        return next
      })
    }
    const onUp = (): void => {
      dragRef.current = null
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
  }, [])

  const layers = isAi ? 3 : 2

  const section = (index: number, title: string, body: ReactNode, actions?: ReactNode): ReactNode => (
    <section className="translate-layer" style={{ flex: ratios[index] }}>
      <div className="translate-layer-head">
        <span className="translate-layer-title">{title}</span>
        <span className="translate-spacer" />
        {actions}
      </div>
      <div className="translate-layer-body">{body}</div>
    </section>
  )

  return (
    <aside className="translate-side" style={{ width: side.width }}>
      <SideResizer
        side="right"
        value={side.width}
        min={side.min}
        max={side.max}
        onDrag={side.setWidth}
        onCommit={side.commit}
      />
      <div className="translate-head">
        <IconButton label="收起翻译栏" tone="muted" onClick={() => setOpen(false)}>
          <IconChevronRight size={15} />
        </IconButton>
        <span className="translate-title">翻译</span>
        <span className="translate-meta">
          {engineName} · {target}
          {contextSize > 0 ? ` · 上下文 ${contextSize} 段` : ''}
        </span>
        <span className="translate-spacer" />
        <IconButton label="翻译设置" tone="muted" onClick={() => setView('settings')}>
          <IconSettings size={15} />
        </IconButton>
        <IconButton label="关闭" tone="muted" onClick={() => setOpen(false)}>
          <IconClose size={15} />
        </IconButton>
      </div>

      {!enabled ? (
        <div className="translate-empty">
          <p>{endpoint ? '翻译还没启用。' : '还没配置翻译接口。'}</p>
          <p className="translate-hint">
            到「设置 → 翻译」里加一条：AI 翻译填任意 OpenAI 兼容平台的地址、密钥与模型
            （DeepSeek、硅基流动都行，会多给一层语法词汇解析）；也可以加一条机翻
            （Google / 微软 / DeepL / 有道），只要填密钥。
          </p>
          <Button size="sm" variant="outline" onClick={() => setView('settings')}>
            去设置里配置
          </Button>
        </div>
      ) : !current ? (
        <div className="translate-empty">
          <p>选中正文里的一段话，点浮出工具条上的「翻译」。</p>
          <p className="translate-hint">
            会自动带上前后 {contextSize} 段作为上下文 —— 代词与省略主语靠它才不至于译飞。
          </p>
        </div>
      ) : (
        <>
          <div className="translate-stack" ref={stackRef}>
            {section(
              0,
              '原文',
              <p className="translate-source">{current.source}</p>,
              <IconButton
                label="复制原文"
                tone="muted"
                onClick={() => void navigator.clipboard.writeText(current.source).catch(() => undefined)}
              >
                <IconCopy size={13} />
              </IconButton>
            )}

            {layers === 3 ? <div className="translate-split" onPointerDown={onDragStart(0)} /> : null}

            {section(
              1,
              '翻译',
              current.loading ? (
                <span className="translate-loading">
                  <Spinner size={14} /> 正在翻译…
                </span>
              ) : current.error ? (
                <span className="translate-error">{current.error}</span>
              ) : result && !result.ok ? (
                <span className="translate-error">{result.error}</span>
              ) : result ? (
                <p className="translate-text">{result.translation}</p>
              ) : null,
              result ? (
                <IconButton
                  label="复制译文"
                  tone="muted"
                  onClick={() => void navigator.clipboard.writeText(result.translation).catch(() => undefined)}
                >
                  <IconCopy size={13} />
                </IconButton>
              ) : null
            )}

            {layers === 3 ? <div className="translate-split" onPointerDown={onDragStart(1)} /> : null}

            {layers === 3
              ? section(
                  2,
                  '解析',
                  analysisHtml || vocabWords.length > 0 ? (
                    <>
                      {/*
                        词汇单独一页签（用户提的：解析里的词汇不该埋在 Markdown 里，
                        要能看表格、能点「加入」）。默认停在"解析"，有词汇时显示条数。
                      */}
                      <div className="translate-tabs">
                        <button
                          type="button"
                          className={`translate-tab${vocabTab === 'analysis' ? ' is-active' : ''}`}
                          onClick={() => setVocabTab('analysis')}
                        >
                          解析
                        </button>
                        <button
                          type="button"
                          className={`translate-tab${vocabTab === 'vocab' ? ' is-active' : ''}`}
                          onClick={() => setVocabTab('vocab')}
                        >
                          词汇（{vocabWords.length}）
                        </button>
                        <span className="translate-spacer" />
                        {/* 第二步抽词的状态与重试入口（翻译完成后会自动跑一次） */}
                        {vocabTab === 'vocab' ? (
                          <>
                            {current?.wordsLoading ? (
                              <span className="translate-hint">正在提取词汇…</span>
                            ) : null}
                            {current?.wordsError && !current.wordsLoading ? (
                              <span className="translate-hint is-warn" title={current.wordsError}>
                                抽词失败：{current.wordsError}
                              </span>
                            ) : null}
                            <Button
                              variant="subtle"
                              size="xs"
                              onClick={() => void useTranslate.getState().extractWords()}
                            >
                              重新提取
                            </Button>
                          </>
                        ) : null}
                        {vocabTab === 'vocab' && vocabWords.length > 0 ? (
                          <Button
                            variant="subtle"
                            size="xs"
                            icon={<IconPlus size={12} />}
                            onClick={() => {
                              void useVocab.getState().addMany(
                                vocabWords.map((word) => ({
                                  ...word,
                                  language: sentenceLanguage,
                                  source: bookTitle,
                                  bookId
                                }))
                              )
                            }}
                          >
                            全部加入
                          </Button>
                        ) : null}
                      </div>

                      {vocabTab === 'vocab' ? (
                        vocabWords.length === 0 ? (
                          <span className="translate-hint">这次解析里没有可提取的词。</span>
                        ) : (
                          <div className="translate-vocab">
                            {vocabWords.map((word) => (
                              <div className="translate-vocab-row" key={`${word.term}-${word.reading}`}>
                                <span className="translate-vocab-term">{word.term}</span>
                                <span className="translate-vocab-reading">{word.reading || '—'}</span>
                                <span className="translate-vocab-meaning">{word.meaning}</span>
                                <IconButton
                                  label={`把「${word.term}」加入单词本`}
                                  tone="muted"
                                  onClick={() =>
                                    void useVocab.getState().add({
                                      ...word,
                                      /* 语种取"被翻译的这段文字"的语言：整句判断比逐词猜准 */
                                      language: sentenceLanguage,
                                      source: bookTitle,
                                      bookId
                                    })
                                  }
                                >
                                  <IconPlus size={12} />
                                </IconButton>
                              </div>
                            ))}
                          </div>
                        )
                      ) : (
                        /* 模型按提示词输出 Markdown（列表 / 加粗 / 行内代码），这里真按 Markdown 渲染 */
                        <div
                          className="translate-analysis md"
                          dangerouslySetInnerHTML={{ __html: analysisHtml }}
                        />
                      )}
                    </>
                  ) : (
                    <span className="translate-hint">
                      {current.loading ? '解析会在译文之后一起给出。' : '这次没有解析内容。'}
                    </span>
                  ),
                  result?.analysis ? (
                    <IconButton
                      label="复制解析"
                      tone="muted"
                      onClick={() =>
                        void navigator.clipboard.writeText(result.analysis ?? '').catch(() => undefined)
                      }
                    >
                      <IconCopy size={13} />
                    </IconButton>
                  ) : null
                )
              : null}
          </div>

          <div className="translate-foot">
            <Button
              size="xs"
              variant="outline"
              icon={<IconRefresh size={13} />}
              disabled={current.loading}
              onClick={() => void running(current.source, current.context)}
            >
              重新翻译
            </Button>
            <span className="translate-hint">
              带了 {current.result?.contextUsed ?? current.context.length} 段上下文
            </span>
          </div>

          {history.length > 1 ? (
            <div className="translate-history">
              {/* 「最近」可以收起：不看历史时它白占一截高度 */}
              <button
                type="button"
                className="translate-history-head"
                onClick={() => setHistoryOpen((open) => !open)}
                aria-expanded={historyOpen}
              >
                <span className="translate-history-caret" data-open={historyOpen ? 'true' : 'false'} />
                最近 {history.length} 条
              </button>
              {historyOpen ? (
                <ul className="translate-history-list">
                  {history.slice(0, 12).map((item) => (
                    <li key={item.id}>
                      <button
                        type="button"
                        className={['translate-history-item', item.id === current.id ? 'is-active' : '']
                          .filter(Boolean)
                          .join(' ')}
                        onClick={() => show(item.id)}
                        title={item.source}
                      >
                        {item.source.slice(0, 28)}
                        {item.source.length > 28 ? '…' : ''}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
        </>
      )}

      {enabled ? (
        <div className="translate-target">
          {/*
            目标语言与提示词预设并排放在底部：读的时候最常改的就是这两个
            ——换语言看原文、按文本类型换一套提示词（轻小说 / 历史 / 科技…）。
          */}
          <span className="translate-hint">目标语言</span>
          <select
            className="select"
            value={target}
            onChange={(event) => void patch({ translate: { ...config!, target: event.target.value } })}
          >
            {['zh-CN', 'zh-TW', 'en', 'ja', 'ko', 'fr', 'de', 'es', 'ru'].map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </select>

          {/* 提示词预设：按文本类型切（AI 才用得上，机翻那档不显示） */}
          {isAi && presets.length > 0 ? (
            <>
              <span className="translate-hint translate-preset-label">提示词</span>
              <select
                className="select translate-preset-select"
                value={activePreset?.id ?? ''}
                onChange={(event) =>
                  void patch({ translate: { ...config!, activePresetId: event.target.value } })
                }
                title={activePreset?.prompt.slice(0, 120)}
              >
                {presets.map((preset) => (
                  <option key={preset.id} value={preset.id}>
                    {preset.name}
                  </option>
                ))}
              </select>
            </>
          ) : null}
        </div>
      ) : null}
    </aside>
  )
}
