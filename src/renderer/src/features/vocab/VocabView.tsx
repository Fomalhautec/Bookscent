import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { VocabLanguage, WordEntry } from '@shared/types'
import { Button, IconButton, SectionTitle, Select, TextInput } from '@/components/common/Controls'
import { IconPlus, IconRefresh, IconTrash } from '@/components/icons/Icons'
import { VOCAB_LANGUAGE_LABEL } from '@shared/vocab'
import { useVocab } from '@/store/useVocab'

/**
 * 单词本主页面（与书架、统计并列）。
 *
 * 重点在"**按语种分开**"：同一个词本里会混着日语、英语、中文的词，
 * 语种靠字符集自动判断，允许手动改。所以顶部是语种标签（带条数），
 * 下面才是列表 —— 而不是一个大杂烩列表配一个下拉筛选。
 */
const LANGUAGE_ORDER: VocabLanguage[] = ['ja', 'en', 'zh', 'ko', 'fr', 'de', 'es', 'ru', 'ar', 'other']

export function VocabView(): ReactNode {
  const words = useVocab((s) => s.words)
  const loading = useVocab((s) => s.loading)
  const filter = useVocab((s) => s.filter)
  const setFilter = useVocab((s) => s.setFilter)
  const load = useVocab((s) => s.load)
  const add = useVocab((s) => s.add)
  const update = useVocab((s) => s.update)
  const remove = useVocab((s) => s.remove)

  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState({ term: '', reading: '', meaning: '', language: 'ja' as VocabLanguage })
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState({ term: '', reading: '', meaning: '', note: '' })

  useEffect(() => {
    void load()
  }, [load])

  const counts = useMemo(() => {
    const map = new Map<VocabLanguage | 'all', number>()
    map.set('all', words.length)
    for (const word of words) map.set(word.language, (map.get(word.language) ?? 0) + 1)
    return map
  }, [words])

  const languages = useMemo(() => {
    const present = LANGUAGE_ORDER.filter((code) => (counts.get(code) ?? 0) > 0)
    return present.length > 0 ? present : LANGUAGE_ORDER.slice(0, 3)
  }, [counts])

  const visible = useMemo(() => {
    const keyword = filter.keyword.trim().toLowerCase()
    let list = words.filter((word) => {
      if (filter.language !== 'all' && word.language !== filter.language) return false
      if (!keyword) return true
      return (
        word.term.toLowerCase().includes(keyword) ||
        word.reading.toLowerCase().includes(keyword) ||
        word.meaning.toLowerCase().includes(keyword) ||
        word.source.toLowerCase().includes(keyword)
      )
    })
    list = [...list].sort((a, b) => {
      if (filter.sort === 'alpha') return a.term.localeCompare(b.term)
      if (filter.sort === 'source') return (a.source || '～').localeCompare(b.source || '～')
      return b.createdAt - a.createdAt
    })
    return list
  }, [words, filter])

  const startEdit = (word: WordEntry): void => {
    setEditingId(word.id)
    setEditDraft({ term: word.term, reading: word.reading, meaning: word.meaning, note: word.note })
  }

  return (
    <div className="vocab-view">
      <header className="vocab-head">
        <SectionTitle hint={`共 ${words.length} 条 · 按语种分开记，词条可以来自翻译解析，也能手敲`}>单词本</SectionTitle>
        <div className="vocab-head-actions">
          <TextInput
            className="vocab-search"
            value={filter.keyword}
            placeholder="搜词、读音、释义或出处…"
            onChange={(event) => setFilter({ keyword: event.target.value })}
          />
          <Select
            value={filter.sort}
            options={[
              { value: 'new', label: '按加入时间' },
              { value: 'alpha', label: '按字母/假名' },
              { value: 'source', label: '按出处' }
            ]}
            onChange={(value) => setFilter({ sort: value as 'new' | 'alpha' | 'source' })}
          />
          <Button
            variant="subtle"
            icon={<IconRefresh size={14} />}
            onClick={() => void load()}
            disabled={loading}
          >
            刷新
          </Button>
          <Button variant="solid" icon={<IconPlus size={14} />} onClick={() => setAdding((open) => !open)}>
            加一个词
          </Button>
        </div>
      </header>

      {/* 语种标签：一眼看出这本子里有哪几种语言的词 */}
      <div className="vocab-langs">
        <button
          type="button"
          className={`vocab-lang${filter.language === 'all' ? ' is-active' : ''}`}
          onClick={() => setFilter({ language: 'all' })}
        >
          全部
          <span className="vocab-lang-count">{counts.get('all') ?? 0}</span>
        </button>
        {languages.map((code) => (
          <button
            key={code}
            type="button"
            className={`vocab-lang${filter.language === code ? ' is-active' : ''}`}
            onClick={() => setFilter({ language: code })}
          >
            {VOCAB_LANGUAGE_LABEL[code]}
            <span className="vocab-lang-count">{counts.get(code) ?? 0}</span>
          </button>
        ))}
      </div>

      {adding ? (
        <div className="vocab-add">
          <TextInput
            value={draft.term}
            placeholder="原词（如 詩 / serendipity / 湿度が高い）"
            onChange={(event) => setDraft({ ...draft, term: event.target.value })}
          />
          <TextInput
            value={draft.reading}
            placeholder="读音（可选，如 し / ˌserənˈdipəti）"
            onChange={(event) => setDraft({ ...draft, reading: event.target.value })}
          />
          <TextInput
            value={draft.meaning}
            placeholder="释义"
            onChange={(event) => setDraft({ ...draft, meaning: event.target.value })}
          />
          <Select
            value={draft.language}
            options={LANGUAGE_ORDER.map((code) => ({ value: code, label: VOCAB_LANGUAGE_LABEL[code] }))}
            onChange={(value) => setDraft({ ...draft, language: value as VocabLanguage })}
          />
          <Button
            variant="solid"
            disabled={!draft.term.trim() || !draft.meaning.trim()}
            onClick={() => {
              void add({ ...draft, kind: draft.term.includes(' ') ? 'phrase' : 'word' })
              setDraft({ term: '', reading: '', meaning: '', language: draft.language })
              setAdding(false)
            }}
          >
            加入
          </Button>
          <Button variant="ghost" onClick={() => setAdding(false)}>
            取消
          </Button>
        </div>
      ) : null}

      {visible.length === 0 ? (
        <p className="vocab-empty">
          {words.length === 0
            ? '本子还是空的。翻译时把解析里的词点「加入」，或者点上面的「加一个词」。'
            : '没有符合条件的词。'}
        </p>
      ) : (
        <div className="vocab-table">
          <div className="vocab-row is-head">
            <span>原词</span>
            <span>读音</span>
            <span>释义</span>
            <span>出处</span>
            <span>语种</span>
            <span />
          </div>
          {visible.map((word) =>
            editingId === word.id ? (
              <div className="vocab-row is-editing" key={word.id}>
                {/* 原词也能改：解析偶尔会把释义塞进词形，得让用户修得动 */}
                <TextInput
                  value={editDraft.term}
                  placeholder="原词"
                  title="原词也可以改；改成已存在的词会自动合并"
                  onChange={(event) => setEditDraft({ ...editDraft, term: event.target.value })}
                />
                <TextInput
                  value={editDraft.reading}
                  placeholder="读音"
                  onChange={(event) => setEditDraft({ ...editDraft, reading: event.target.value })}
                />
                <TextInput
                  value={editDraft.meaning}
                  placeholder="释义"
                  onChange={(event) => setEditDraft({ ...editDraft, meaning: event.target.value })}
                />
                <TextInput
                  value={editDraft.note}
                  placeholder="备注"
                  onChange={(event) => setEditDraft({ ...editDraft, note: event.target.value })}
                />
                <span className="vocab-lang-cell">{VOCAB_LANGUAGE_LABEL[word.language]}</span>
                <span className="vocab-row-actions">
                  <Button
                    variant="solid"
                    size="xs"
                    onClick={() => {
                      void update(word.id, editDraft)
                      setEditingId(null)
                    }}
                  >
                    保存
                  </Button>
                  <Button variant="ghost" size="xs" onClick={() => setEditingId(null)}>
                    取消
                  </Button>
                </span>
              </div>
            ) : (
              <div className="vocab-row" key={word.id}>
                <span className="vocab-term" title={word.kind === 'phrase' ? '词组' : '单词'}>
                  {word.term}
                </span>
                <span className="vocab-reading">{word.reading || '—'}</span>
                <span className="vocab-meaning" title={word.note || word.meaning}>
                  {word.meaning}
                  {word.note ? <em className="vocab-note">（{word.note}）</em> : null}
                </span>
                <span className="vocab-source" title={word.source}>
                  {word.source || '手工添加'}
                </span>
                <span className="vocab-lang-cell">{VOCAB_LANGUAGE_LABEL[word.language]}</span>
                <span className="vocab-row-actions">
                  <Button variant="ghost" size="xs" onClick={() => startEdit(word)}>
                    编辑
                  </Button>
                  <IconButton label="删掉这个词" tone="muted" onClick={() => void remove(word.id)}>
                    <IconTrash size={13} />
                  </IconButton>
                </span>
              </div>
            )
          )}
        </div>
      )}
    </div>
  )
}
