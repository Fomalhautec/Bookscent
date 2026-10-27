import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { AppSettings, TranslateHistoryEntry } from '@shared/types'
import { APP_VERSION, FORMAT_LABEL } from '@shared/types'
import { Button, IconButton, SectionTitle } from '@/components/common/Controls'
import { IconArrowLeft, IconCopy, IconExternalLink, IconRefresh, IconTrash } from '@/components/icons/Icons'
import { CHANGELOG_RECENT } from './labels'
import { renderMarkdown } from '@/features/editor/lib/markdown'
import { libraryApi } from '@/lib/api'
import { useLibrary } from '@/store/useLibrary'
import { useTranslate } from '@/store/useTranslate'
import { useUi } from '@/store/useUi'
import { formatBytes, formatDateTime } from '@/lib/format'

/**
 * 设置里的**子页**。
 *
 * 为什么要有它：翻译记录、引用的书籍、更新日志都会越积越长，
 * 摊在主分页里把别的设置都挤没了（用户提的）。所以它们各自成一页，
 * 用**表格**排（一行一条、列对齐），一屏能扫很多条，也能排序找。
 *
 * 子页仍然属于原来的分页：面包屑上写着"翻译 / 翻译记录"、"文件与数据 / 引用的书籍"，
 * 左上角是返回。
 */
/** 各表自己的列宽：说明要占剩余空间，所以给它 1fr 而不是固定窄列 */
const CITED_COLS = '1.6fr 0.7fr 0.7fr 2.4fr 0.8fr'
const LOG_COLS = '96px 220px minmax(320px, 1fr)'

export type SubPageId = 'translate-history' | 'cited-books' | 'changelog'

export interface SubPageProps {
  id: SubPageId
  onBack: () => void
  settings: AppSettings
}

/** 子页外壳：返回按钮 + 面包屑 + 标题 */
function SubShell({
  crumbs,
  title,
  hint,
  actions,
  children,
  onBack
}: {
  crumbs: string[]
  title: string
  hint?: string
  actions?: ReactNode
  children: ReactNode
  onBack: () => void
}): ReactNode {
  return (
    <div className="set-tab set-subpage">
      <div className="set-sub-head">
        <Button variant="subtle" size="sm" icon={<IconArrowLeft size={14} />} onClick={onBack}>
          返回
        </Button>
        <span className="set-sub-crumbs">{crumbs.join(' / ')}</span>
        <span className="translate-spacer" />
        {actions}
      </div>
      <SectionTitle hint={hint}>{title}</SectionTitle>
      {children}
    </div>
  )
}

/** 一行一格；列宽由各自的 cols 给（共用一套固定列宽会让"说明"被挤成窄条） */
function Row({ cells, cols, danger }: { cells: ReactNode[]; cols: string; danger?: ReactNode }): ReactNode {
  return (
    <div
      className={`set-table-row${danger ? ' has-action' : ''}`}
      style={{ gridTemplateColumns: danger ? `${cols} 46px` : cols }}
    >
      {cells.map((cell, index) => (
        <span className="set-table-cell" key={index}>
          {cell}
        </span>
      ))}
      {danger ? <span className="set-table-action">{danger}</span> : null}
    </div>
  )
}

function Head({ labels, cols, withAction }: { labels: string[]; cols: string; withAction?: boolean }): ReactNode {
  return (
    <div
      className={`set-table-head${withAction ? ' has-action' : ''}`}
      style={{ gridTemplateColumns: withAction ? `${cols} 46px` : cols }}
    >
      {labels.map((label) => (
        <span className="set-table-cell" key={label}>
          {label}
        </span>
      ))}
      {withAction ? <span className="set-table-action" /> : null}
    </div>
  )
}

/** 版本号比较：0.10.1 要大于 0.9.8（按字符串比会反过来） */
function versionRank(version: string): number[] {
  return version
    .split(/[.\-+]/)
    .map((part) => Number.parseInt(part, 10))
    .map((value) => (Number.isFinite(value) ? value : 0))
}

function compareVersion(a: string, b: string): number {
  const left = versionRank(a)
  const right = versionRank(b)
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const diff = (right[index] ?? 0) - (left[index] ?? 0)
    if (diff !== 0) return diff
  }
  return 0
}

/** 更新日志一律按版本从新到旧排（数据里偶尔有条目顺序不对，这里兜住） */
export function sortedChangelog(): typeof CHANGELOG_RECENT {
  /* sort 是稳定的：同版本的多条保持原有先后 */
  return [...CHANGELOG_RECENT].sort((a, b) => compareVersion(a.version, b.version))
}

/* ------------------------------------------------------------ 翻译记录 */

function TranslateHistoryPage({ onBack }: { onBack: () => void }): ReactNode {
  const remove = useTranslate((s) => s.remove)
  const toast = useUi((s) => s.toast)
  const [rows, setRows] = useState<TranslateHistoryEntry[]>([])
  const [busy, setBusy] = useState(false)

  const load = async (): Promise<void> => {
    setBusy(true)
    try {
      const list = await libraryApi.translateHistoryGet()
      setRows(Array.isArray(list) ? list : [])
    } catch (error) {
      toast('读取翻译记录失败', 'error', error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <SubShell
      crumbs={['设置', '翻译', '翻译记录']}
      title={`翻译记录（${rows.length} 条）`}
      hint="按时间从新到旧。删除是立刻生效的；保留多少条、什么时候清，在「翻译」页里设。"
      onBack={onBack}
      actions={
        <>
          <Button variant="subtle" size="sm" icon={<IconRefresh size={13} />} disabled={busy} onClick={() => void load()}>
            刷新
          </Button>
          <Button
            variant="outline"
            size="sm"
            icon={<IconTrash size={13} />}
            disabled={rows.length === 0}
            onClick={() => {
              useTranslate.getState().clear()
              setRows([])
              toast('翻译记录已清空', 'success')
            }}
          >
            清空全部
          </Button>
        </>
      }
    >
      {rows.length === 0 ? (
        <p className="set-empty">还没有记录。</p>
      ) : (
        /*
          不做表格：一条记录里有原文、译文、解析（AI 那档还是 Markdown 列表），
          表格一行根本放不下（用户的原话是"位置只占一行高，根本看不了具体内容"）。
          改成浏览器历史记录那种"一条一块"的排法，横排是时间与引擎，正文竖着铺开。
        */
        <div className="hist-list">
          {rows.map((row) => (
            <article className="hist-item" key={row.id}>
              <header className="hist-head">
                <span className="hist-time">{formatDateTime(row.at)}</span>
                <span className="hist-tag">{row.kind === 'ai' ? 'AI 翻译' : '机器翻译'}</span>
                <span className="hist-tag">{row.target || '—'}</span>
                <span className="translate-spacer" />
                <IconButton
                  label="复制译文"
                  tone="muted"
                  onClick={() => {
                    void navigator.clipboard.writeText(row.translation).catch(() => undefined)
                    toast('译文已复制', 'success')
                  }}
                >
                  <IconCopy size={13} />
                </IconButton>
                <IconButton
                  label="删掉这条记录"
                  tone="muted"
                  onClick={() => {
                    remove(row.id)
                    setRows((current) => current.filter((item) => item.id !== row.id))
                  }}
                >
                  <IconTrash size={13} />
                </IconButton>
              </header>
              <div className="hist-pair">
                <div className="hist-cell">
                  <span className="hist-label">原文</span>
                  <p className="hist-source">{row.source}</p>
                </div>
                <div className="hist-cell">
                  <span className="hist-label">译文</span>
                  <p className="hist-text">{row.translation}</p>
                </div>
              </div>
              {row.kind === 'ai' ? (
                <div className="hist-analysis">
                  <span className="hist-label">解析</span>
                  {row.analysis ? (
                    <div
                      className="hist-analysis-body"
                      dangerouslySetInnerHTML={{ __html: renderMarkdown(row.analysis) }}
                    />
                  ) : (
                    <p className="set-hint">这条记录没有解析内容。</p>
                  )}
                </div>
              ) : null}
            </article>
          ))}
        </div>
      )}
    </SubShell>
  )
}

/* ------------------------------------------------------------ 引用的书籍 */

function CitedBooksPage({ onBack }: { onBack: () => void }): ReactNode {
  const index = useLibrary((s) => s.index)
  const select = useLibrary((s) => s.select)
  const setView = useUi((s) => s.setView)
  const toast = useUi((s) => s.toast)

  const referenced = useMemo(
    () => (index?.books ?? []).filter((book) => book.external && book.path),
    [index]
  )

  return (
    <SubShell
      crumbs={['设置', '文件与数据', '引用的书籍']}
      title={`引用的书籍（${referenced.length} 本）`}
      hint="这些书是「引用」导入的：文件留在原地，应用只记住路径。文件被移走或删掉就会标出来。"
      onBack={onBack}
    >
      {referenced.length === 0 ? (
        <p className="set-empty">没有引用外部文件 —— 导入时选「复制」的书都放在藏书目录里。</p>
      ) : (
        <div className="set-table is-wide">
          <Head labels={['书名', '格式', '大小', '所在路径', '状态']} cols={CITED_COLS} withAction />
          {referenced.map((book) => (
            <Row
              key={book.id}
              cols={CITED_COLS}
              cells={[
                <span title={book.title}>{book.title}</span>,
                <span>{FORMAT_LABEL[book.format] ?? book.format}</span>,
                <span>{typeof book.size === 'number' ? formatBytes(book.size) : '—'}</span>,
                <span title={book.path}>
                  <code className="set-table-path">{book.path}</code>
                </span>,
                <span>{book.missing ? <span className="set-ref-badge">文件已不在</span> : '正常'}</span>
              ]}
              danger={
                <IconButton
                  label="打开这本书"
                  tone="muted"
                  onClick={() => {
                    if (book.missing) {
                      toast('文件已经不在了', 'error', book.path)
                      return
                    }
                    select(book.id)
                  }}
                >
                  <IconExternalLink size={13} />
                </IconButton>
              }
            />
          ))}
        </div>
      )}
    </SubShell>
  )
}

/* ------------------------------------------------------------ 更新日志 */

function ChangelogPage({ onBack }: { onBack: () => void }): ReactNode {
  const [keyword, setKeyword] = useState('')
  const list = useMemo(() => {
    const word = keyword.trim().toLowerCase()
    if (!word) return CHANGELOG_RECENT
    return CHANGELOG_RECENT.filter(
      (entry) =>
        entry.version.toLowerCase().includes(word) ||
        entry.title.toLowerCase().includes(word) ||
        entry.detail.toLowerCase().includes(word)
    )
  }, [keyword])

  return (
    <SubShell
      crumbs={['设置', '关于', '更新日志']}
      title={`更新日志（${list.length} / ${CHANGELOG_RECENT.length} 条）`}
      hint={`从 0.1.1 到 ${APP_VERSION}，没有 0.2。表格按版本从新到旧。`}
      onBack={onBack}
      actions={
        <input
          className="text-input set-table-filter"
          value={keyword}
          placeholder="搜版本或关键词…"
          onChange={(event) => setKeyword(event.target.value)}
        />
      }
    >
      <div className="set-table is-wide">
        <Head labels={['版本', '标题', '说明']} cols={LOG_COLS} />
        {list.map((entry) => (
          <Row
            key={`${entry.version}-${entry.title}`}
            cols={LOG_COLS}
            cells={[
              <code className="set-log-ver">{entry.version}</code>,
              <span>{entry.title}</span>,
              <span className="set-table-detail">{entry.detail}</span>
            ]}
          />
        ))}
      </div>
    </SubShell>
  )
}

/* ------------------------------------------------------------ 出口 */

export function SettingsSubPage({ id, onBack }: SubPageProps): ReactNode {
  if (id === 'translate-history') return <TranslateHistoryPage onBack={onBack} />
  if (id === 'cited-books') return <CitedBooksPage onBack={onBack} />
  return <ChangelogPage onBack={onBack} />
}
