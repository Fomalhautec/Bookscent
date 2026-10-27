/**
 * 统计 —— 把用量记录读成一眼看得懂的样子。
 *
 * 数据全部来自 `libraryApi.stats()` 一次调用：热力图、阅读、笔记、近期使用
 * 都在同一份 StatsOverview 里，所以这一页没有第二个数据源，也不需要在
 * 组件之间传状态。外壳只负责给一个 `onOpen`（点某一行就打开那本书/笔记）。
 *
 * 图表一律用 div + CSS 画：热力图是 grid（一列 = 一周，7 行 = 周一到周日），
 * 进度用现成的 ProgressBar，不引第三方图表库。
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { FORMAT_LABEL, type StatsDayCell, type StatsOverview } from '@shared/types'
import { Button, ProgressBar, SectionTitle, Spinner } from '@/components/common/Controls'
import {
  IconBookOpen,
  IconBookStack,
  IconCalendar,
  IconCheck,
  IconClock,
  IconBookmark,
  IconQuote,
  IconFileText,
  IconInfo,
  IconLeaf,
  IconPen,
  IconRefresh,
  IconTextCursor
} from '@/components/icons/Icons'
import { libraryApi } from '@/lib/api'
import '@/styles/stats.css'

export interface StatsViewProps {
  /** 点列表里的一项：打开对应的书 / 笔记 */
  onOpen: (id: string) => void
}

/** 列表空着时统一的一句话 */
const EMPTY_HINT = '还没有记录 —— 打开一本书读一会儿，这里就有数据了'

/** 热力图 7 行，从上到下 = 周一到周日 */
const WEEKDAY_LABELS = ['一', '二', '三', '四', '五', '六', '日']

/** 热力图的分钟分档：不到 20 分 / 不到 45 分 / 不到 90 分 / 90 分以上 */
const HEAT_STEPS = [20, 45, 90]

/** 天数不够时的兜底：主进程一般会给满 182 天，这里只保证格子永远画得出来 */
const HEAT_FALLBACK_DAYS = 182

/* ------------------------------------------------------------------ 小工具 */

function pad2(value: number): string {
  return value < 10 ? `0${value}` : String(value)
}

/** 'YYYY-MM-DD' 按本地时区解析 —— new Date(string) 会当 UTC 处理，日期会差一天 */
function parseDate(date: string): Date {
  const [y, m, d] = date.split('-').map((part) => Number.parseInt(part, 10))
  return new Date(y || 1970, (m || 1) - 1, d || 1)
}

/** 秒 → 「3 小时 12 分」/「12 分钟」/「不到 1 分钟」 */
function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0 分钟'
  const total = Math.round(seconds)
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  if (hours > 0) return minutes > 0 ? `${hours} 小时 ${minutes} 分` : `${hours} 小时`
  if (minutes > 0) return `${minutes} 分钟`
  return '不到 1 分钟'
}

function formatInt(value: number): string {
  return Math.round(value).toLocaleString('zh-CN')
}

/** 时间戳 → 「2026-10-13 14:32」 */
function formatStamp(at: number): string {
  const d = new Date(at)
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}

/** 时间戳 → 「今天 14:32」/「昨天 09:10」/「3 天前」/「2026-10-13」 */
function formatWhen(at: number): string {
  const dayMs = 86400000
  const now = new Date()
  const then = new Date(at)
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const that = new Date(then.getFullYear(), then.getMonth(), then.getDate()).getTime()
  const clock = `${pad2(then.getHours())}:${pad2(then.getMinutes())}`
  const diff = today - that
  if (diff <= 0) return `今天 ${clock}`
  if (diff === dayMs) return `昨天 ${clock}`
  if (diff < 7 * dayMs) return `${Math.round(diff / dayMs)} 天前`
  return `${then.getFullYear()}-${pad2(then.getMonth() + 1)}-${pad2(then.getDate())}`
}

function clampPercent(percent: number): number {
  if (!Number.isFinite(percent)) return 0
  return Math.max(0, Math.min(100, Math.round(percent)))
}

/** 当天秒数落在第几档：0 是空格，1–4 依次加深 */
function heatLevel(seconds: number): number {
  if (!(seconds > 0)) return 0
  const minutes = seconds / 60
  if (minutes < HEAT_STEPS[0]) return 1
  if (minutes < HEAT_STEPS[1]) return 2
  if (minutes < HEAT_STEPS[2]) return 3
  return 4
}

/** 格子的悬停说明：「2026-10-13 · 12 分钟 · 2 本书/笔记」 */
function heatTitle(cell: StatsDayCell): string {
  if (cell.seconds <= 0 && cell.opens <= 0 && cell.words <= 0) return `${cell.date} · 没有记录`
  const parts = [cell.date, formatDuration(cell.seconds)]
  if (cell.opens > 0) parts.push(`${cell.opens} 本书/笔记`)
  if (cell.words > 0) parts.push(`${formatInt(cell.words)} 字`)
  return parts.join(' · ')
}

/** 没有任何数据时也得画出 182 个空格子 */
function buildEmptyDays(count: number): StatsDayCell[] {
  const now = new Date()
  const out: StatsDayCell[] = []
  for (let back = count - 1; back >= 0; back -= 1) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - back)
    out.push({
      date: `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`,
      seconds: 0,
      opens: 0,
      words: 0,
      readingSeconds: 0,
      noteSeconds: 0
    })
  }
  return out
}

/* -------------------------------------------------------------- 小组件 */

function ListEmpty(): ReactNode {
  return <p className="stats-empty">{EMPTY_HINT}</p>
}

function StatCard({
  icon,
  label,
  value,
  unit,
  hint,
  compact
}: {
  icon: ReactNode
  label: string
  value: string
  unit?: string
  hint?: string
  /** 时长这类长文本用小一号，免得撑破卡片 */
  compact?: boolean
}): ReactNode {
  return (
    <div className="stats-card">
      <span className="stats-card-label">
        {icon}
        {label}
      </span>
      <span className={['stats-card-value', compact ? 'is-compact' : ''].filter(Boolean).join(' ')}>
        {value}
        {unit ? <em>{unit}</em> : null}
      </span>
      {hint ? <span className="stats-card-hint">{hint}</span> : null}
    </div>
  )
}

/* ------------------------------------------------------------------ 视图 */

export function StatsView({ onOpen }: StatsViewProps): ReactNode {
  const [overview, setOverview] = useState<StatsOverview | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const asked = useRef(false)

  const load = useCallback(async (): Promise<void> => {
    setLoading(true)
    setError(null)
    try {
      setOverview(await libraryApi.stats())
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [])

  // 挂载时拉一次；StrictMode 下 effect 会跑两遍，用 ref 挡住第二次
  useEffect(() => {
    if (asked.current) return
    asked.current = true
    void load()
  }, [load])

  /** 热力图：每天的格子按周分列（列首补空，凑成周一到周日） */
  const heat = useMemo(() => {
    const days = overview && overview.days.length > 0 ? overview.days : buildEmptyDays(HEAT_FALLBACK_DAYS)
    const columns: (StatsDayCell | null)[][] = []
    let column: (StatsDayCell | null)[] = []
    const lead = (parseDate(days[0].date).getDay() + 6) % 7
    for (let i = 0; i < lead; i += 1) column.push(null)
    for (const cell of days) {
      column.push(cell)
      if (column.length === 7) {
        columns.push(column)
        column = []
      }
    }
    if (column.length > 0) {
      while (column.length < 7) column.push(null)
      columns.push(column)
    }
    // 每列只在"月份变了"的那一列标一次月份
    let lastMonth = ''
    const months = columns.map((week) => {
      const first = week.find((cell): cell is StatsDayCell => cell !== null)
      if (!first) return ''
      const month = first.date.slice(0, 7)
      if (month === lastMonth) return ''
      lastMonth = month
      return `${Number(first.date.slice(5, 7))} 月`
    })
    return { columns, months, count: days.length }
  }, [overview])

  /** 本月合计：秒数 + 真正"打过卡"的天数（门槛与连击一致，5 分钟） */
  const monthTotal = useMemo(() => {
    const now = new Date()
    const prefix = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}`
    const min = overview?.streakMinSeconds ?? 300
    let seconds = 0
    let active = 0
    for (const cell of overview?.days ?? []) {
      if (!cell.date.startsWith(prefix)) continue
      seconds += cell.seconds
      if (cell.seconds >= min) active += 1
    }
    return { seconds, active }
  }, [overview])

  const recentBooks = useMemo(
    () => (overview?.recent ?? []).filter((item) => item.kind === 'book'),
    [overview]
  )
  const recentNotes = useMemo(
    () => (overview?.recent ?? []).filter((item) => item.kind === 'note'),
    [overview]
  )
  // recent 里没有字数，笔记的字数得从 notes.items 里对一下
  const noteWords = useMemo(
    () => new Map((overview?.notes.items ?? []).map((item) => [item.id, item.words] as const)),
    [overview]
  )

  return (
    <div className="stats-view">
      <header className="stats-head">
        <div className="stats-head-main">
          <h1>统计</h1>
          <p>阅读与书写留下的痕迹 —— 打卡节奏、时长、页数、字数与进度，都在这一页。</p>
        </div>
        <div className="stats-head-actions">
          {overview ? (
            <span className="stats-head-tag">更新于 {formatStamp(overview.generatedAt)}</span>
          ) : null}
          <Button
            variant="outline"
            size="sm"
            icon={<IconRefresh size={14} />}
            disabled={loading}
            title="重新汇总一次用量记录"
            onClick={() => void load()}
          >
            {loading ? '正在汇总…' : '刷新'}
          </Button>
        </div>
      </header>

      <div className="stats-content">
        {error ? (
          <div className="stats-error" role="alert">
            <IconInfo size={15} />
            <span className="stats-error-text">{error}</span>
            <Button variant="outline" size="sm" disabled={loading} onClick={() => void load()}>
              重试
            </Button>
          </div>
        ) : null}

        {!overview ? (
          loading ? (
            <div className="stats-loading">
              <Spinner size={22} />
              <span>正在汇总统计…</span>
            </div>
          ) : null
        ) : (
          <>
            {/* ------------------------------------------------ 1 打卡热力图 */}
            <section className="stats-section">
              <SectionTitle hint={`最近 ${heat.count} 天的读写记录，一格一天 —— 颜色越深，那天坐得越久。`}>
                <IconCalendar size={16} />
                打卡热力图
              </SectionTitle>
              <div className="stats-section-body">
                <div className="stats-heat">
                  <div className="stats-heat-grid">
                    <div className="stats-heat-months" aria-hidden="true">
                      {heat.months.map((label, index) => (
                        <span className="stats-heat-month" key={`month-${index}`}>
                          {label}
                        </span>
                      ))}
                    </div>
                    <div className="stats-heat-body">
                      <div className="stats-heat-weekdays" aria-hidden="true">
                        {WEEKDAY_LABELS.map((label, index) => (
                          <span className="stats-heat-weekday" key={label}>
                            {index === 0 || index === 2 || index === 4 ? label : ''}
                          </span>
                        ))}
                      </div>
                      <div
                        className="stats-heat-weeks"
                        role="img"
                        aria-label={`最近 ${heat.count} 天的打卡热力图`}
                      >
                        {heat.columns.map((week, wi) =>
                          week.map((cell, ci) =>
                            cell ? (
                              <div
                                key={cell.date}
                                className={`stats-heat-cell is-l${heatLevel(cell.seconds)}`}
                                title={heatTitle(cell)}
                              />
                            ) : (
                              <div
                                key={`blank-${wi}-${ci}`}
                                className="stats-heat-cell is-blank"
                                aria-hidden="true"
                              />
                            )
                          )
                        )}
                      </div>
                    </div>
                  </div>

                  <aside className="stats-heat-side">
                    {/*
                      打卡分开显示：读书、写字各一条，外加把两者合起来的总打卡。
                      一天要累计满 streakMinSeconds（默认 5 分钟）才算打过卡。
                    */}
                    <div className="stats-heat-stat">
                      <span className="stats-heat-stat-value">
                        <strong>{overview.readingStreak}</strong> 天
                      </span>
                      <span className="stats-heat-stat-label">
                        连续阅读 · 每天满 {Math.round(overview.streakMinSeconds / 60)} 分钟
                      </span>
                    </div>
                    <div className="stats-heat-stat">
                      <span className="stats-heat-stat-value">
                        <strong>{overview.noteStreak}</strong> 天
                      </span>
                      <span className="stats-heat-stat-label">连续写作</span>
                    </div>
                    <div className="stats-heat-stat">
                      <span className="stats-heat-stat-value">
                        <strong>{overview.streak}</strong> 天
                      </span>
                      <span className="stats-heat-stat-label">连续打卡（读写合计）</span>
                    </div>
                    <div className="stats-heat-stat">
                      <span className="stats-heat-stat-value is-duration">
                        {formatDuration(monthTotal.seconds)}
                      </span>
                      <span className="stats-heat-stat-label">
                        本月合计 · 共 {monthTotal.active} 天
                      </span>
                    </div>
                    <div className="stats-legend">
                      <span>少</span>
                      {[0, 1, 2, 3, 4].map((level) => (
                        <span
                          key={level}
                          className={`stats-heat-cell stats-legend-cell is-l${level}`}
                          aria-hidden="true"
                        />
                      ))}
                      <span>多</span>
                    </div>
                  </aside>
                </div>
              </div>
            </section>

            {/* ------------------------------------------------- 2 阅读统计 */}
            <section className="stats-section">
              <SectionTitle hint="读过的书、花掉的时间、翻过的页数，以及读完的数量。">
                <IconBookOpen size={16} />
                阅读统计
              </SectionTitle>
              <div className="stats-section-body">
                <div className="stats-cards">
                  <StatCard
                    icon={<IconBookStack size={13} />}
                    label="阅读书目"
                    value={formatInt(overview.reading.books)}
                    unit="本"
                    hint={`累计打开 ${formatInt(overview.reading.opens)} 次`}
                  />
                  <StatCard
                    icon={<IconClock size={13} />}
                    label="阅读时间"
                    value={formatDuration(overview.reading.seconds)}
                    hint="全部书籍累计"
                    compact
                  />
                  <StatCard
                    icon={<IconFileText size={13} />}
                    label="阅读页数"
                    value={formatInt(overview.reading.pages)}
                    unit="页"
                    hint="已翻过的页数"
                  />
                  <StatCard
                    icon={<IconCheck size={13} />}
                    label="读完"
                    value={formatInt(overview.reading.finished)}
                    unit="本"
                    hint="进度 98% 以上"
                  />
                </div>

                <h4 className="stats-subhead">
                  <IconClock size={13} />
                  进行中
                </h4>
                {overview.reading.inProgress.length > 0 ? (
                  <div className="stats-list">
                    {overview.reading.inProgress.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        className="stats-row"
                        title={`打开《${item.title}》`}
                        onClick={() => onOpen(item.id)}
                      >
                        <span className="stats-row-main">
                          <span className="stats-row-title">{item.title}</span>
                          <span className="stats-row-sub">上次打开 {formatWhen(item.at)}</span>
                        </span>
                        <span className="stats-row-meter">
                          <ProgressBar value={clampPercent(item.percent)} max={100} />
                        </span>
                        <span className="stats-row-side">
                          <span className="stats-row-value">{clampPercent(item.percent)}%</span>
                        </span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <ListEmpty />
                )}
              </div>
            </section>

            {/* ------------------------------------------------- 3 笔记统计 */}
            <section className="stats-section">
              <SectionTitle hint="写了多少、累计输入多少字，以及今天敲下的字数。">
                <IconPen size={16} />
                笔记统计
              </SectionTitle>
              <div className="stats-section-body">
                <div className="stats-cards">
                  <StatCard
                    icon={<IconPen size={13} />}
                    label="笔记数"
                    value={formatInt(overview.notes.count)}
                    unit="篇"
                    hint={`累计打开 ${formatInt(overview.notes.opens)} 次`}
                  />
                  <StatCard
                    icon={<IconTextCursor size={13} />}
                    label="累计输入字数"
                    value={formatInt(overview.notes.words)}
                    unit="字"
                    hint="所有笔记加起来"
                  />
                  <StatCard
                    icon={<IconLeaf size={13} />}
                    label="今天输入字数"
                    value={formatInt(overview.notes.wordsToday)}
                    unit="字"
                    hint="今天敲下的字"
                  />
                  <StatCard
                    icon={<IconClock size={13} />}
                    label="笔记时间"
                    value={formatDuration(overview.notes.seconds)}
                    hint="写笔记累计"
                    compact
                  />
                </div>

                <h4 className="stats-subhead">
                  <IconPen size={13} />
                  写过的笔记
                </h4>
                {overview.notes.items.length > 0 ? (
                  <div className="stats-list">
                    {overview.notes.items.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        className="stats-row"
                        title={`打开《${item.title}》`}
                        onClick={() => onOpen(item.id)}
                      >
                        <span className="stats-row-main">
                          <span className="stats-row-title">{item.title}</span>
                          <span className="stats-row-sub">最近书写 {formatWhen(item.at)}</span>
                        </span>
                        <span className="stats-row-side">
                          <span className="stats-row-value">{formatInt(item.words)} 字</span>
                        </span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <ListEmpty />
                )}
              </div>
            </section>

            {/* ------------------------------------------------- 4 近期阅读 */}
            <section className="stats-section">
              <SectionTitle hint="最近打开过的书，从近到远 —— 继续读就从这里进去。">
                <IconBookStack size={16} />
                近期阅读
              </SectionTitle>
              <div className="stats-section-body">
                {recentBooks.length > 0 ? (
                  <div className="stats-list">
                    {recentBooks.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        className="stats-row"
                        title={`打开《${item.title}》`}
                        onClick={() => onOpen(item.id)}
                      >
                        <span className="stats-row-main">
                          <span className="stats-row-title">{item.title}</span>
                          <span className="stats-row-sub">
                            {FORMAT_LABEL[item.format]} · {formatWhen(item.at)}
                          </span>
                        </span>
                        <span className="stats-row-meter">
                          {item.percent === null ? null : (
                            <ProgressBar value={clampPercent(item.percent)} max={100} />
                          )}
                        </span>
                        <span className="stats-row-side">
                          <span className="stats-row-value">{formatDuration(item.seconds)}</span>
                          <span className="stats-row-note">
                            {item.percent === null ? '进度未记录' : `${clampPercent(item.percent)}%`}
                          </span>
                        </span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <ListEmpty />
                )}
              </div>
            </section>

            {/* ------------------------------------------- 5 最近使用的笔记 */}
            <section className="stats-section">
              <SectionTitle hint="最近写过的笔记，带上累计时长与字数。">
                <IconFileText size={16} />
                最近使用的笔记
              </SectionTitle>
              <div className="stats-section-body">
                {recentNotes.length > 0 ? (
                  <div className="stats-list">
                    {recentNotes.map((item) => {
                      const words = noteWords.get(item.id)
                      return (
                        <button
                          key={item.id}
                          type="button"
                          className="stats-row"
                          title={`打开《${item.title}》`}
                          onClick={() => onOpen(item.id)}
                        >
                          <span className="stats-row-main">
                            <span className="stats-row-title">{item.title}</span>
                            <span className="stats-row-sub">
                              {FORMAT_LABEL[item.format]} · {formatWhen(item.at)}
                            </span>
                          </span>
                          <span className="stats-row-side">
                            <span className="stats-row-value">{formatDuration(item.seconds)}</span>
                            <span className="stats-row-note">
                              {words === undefined ? '字数未记录' : `${formatInt(words)} 字`}
                            </span>
                          </span>
                        </button>
                      )
                    })}
                  </div>
                ) : (
                  <ListEmpty />
                )}
              </div>
            </section>

            {/* ------------------------------------------- 7 最近心得 */}
            {/*
              「心得」= 我自己在书里标注出来的东西（正文高亮 / 划线 / 波浪线，以及写了备注的书签）。
              与「最近书签」分开：书签只是"读到这儿了"，心得是"这句话我有想法"。
            */}
            <section className="stats-section">
              <SectionTitle
                hint={`正文里划出来的标注，以及写了备注的书签 —— 一共 ${overview.insights.count} 条，这里列出最近的。`}
              >
                <IconQuote size={16} />
                最近心得
                <span className="stats-title-count">{overview.insights.count}</span>
              </SectionTitle>
              <div className="stats-section-body">
                {overview.insights.items.length > 0 ? (
                  <div className="stats-list">
                    {overview.insights.items.map((item) => (
                      <button
                        key={`${item.bookId}-${item.id}`}
                        type="button"
                        className="stats-row"
                        title={`打开《${item.bookTitle}》`}
                        onClick={() => onOpen(item.bookId)}
                      >
                        <span className="stats-row-main">
                          <span className="stats-row-title">{item.text || '（没有留下原文）'}</span>
                          {item.note ? <span className="stats-insight-note">{item.note}</span> : null}
                          <span className="stats-row-sub">
                            {item.bookTitle} ·{' '}
                            {item.kind === 'highlight'
                              ? '高亮'
                              : item.kind === 'underline'
                                ? '划线'
                                : item.kind === 'wavy'
                                  ? '波浪线'
                                  : '书签备注'}
                          </span>
                        </span>
                        <span className="stats-row-side">
                          <span className="stats-row-value">{formatWhen(item.at)}</span>
                        </span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <ListEmpty />
                )}
              </div>
            </section>

            {/* ------------------------------------------- 8 最近书签 */}
            <section className="stats-section">
              <SectionTitle hint="最近加的书签，点一下直接跳到那一处。">
                <IconBookmark size={16} />
                最近书签
              </SectionTitle>
              <div className="stats-section-body">
                {overview.bookmarks.length > 0 ? (
                  <div className="stats-list">
                    {overview.bookmarks.map((item) => (
                      <button
                        key={`${item.bookId}-${item.id}`}
                        type="button"
                        className="stats-row"
                        title={`打开《${item.bookTitle}》`}
                        onClick={() => onOpen(item.bookId)}
                      >
                        <span className="stats-row-main">
                          <span className="stats-row-title">{item.excerpt || item.label}</span>
                          <span className="stats-row-sub">
                            {item.bookTitle} · {item.label} · {item.kind === 'note' ? '笔记' : '书籍'}
                          </span>
                        </span>
                        <span className="stats-row-side">
                          <span className="stats-row-value">{formatWhen(item.at)}</span>
                        </span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <ListEmpty />
                )}
              </div>
            </section>
          </>
        )}
      </div>
    </div>
  )
}
