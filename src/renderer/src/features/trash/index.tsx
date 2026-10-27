import { useMemo, useState, type ReactNode } from 'react'
import { FORMAT_LABEL } from '@shared/types'
import { useLibrary } from '@/store/useLibrary'
import { useUi } from '@/store/useUi'
import { formatDateTime } from '@/lib/format'
import { IconRefresh, IconTrash } from '@/components/icons/Icons'
import { Button } from '@/components/common/Controls'

/**
 * 回收站。
 *
 * 被「移除」的书会进到这里：复制入库的书文件已经挪进藏书目录下的 `_回收站`，
 * 引用式的书文件留在原处（那本来就不是我们的文件）。
 * 所以重新扫描不会再把它们扫回书架 —— 用户报过这个问题。
 *
 * 它与书架是**并列**的一处，所以外壳也照着书架来：同一套 .shelf-view / .shelf-toolbar 结构、
 * 左侧栏照常显示（回收站那条高亮），选中与批量操作的手感和书架一致 ——
 * 之前它是个孤零零的整屏列表，连侧栏都没有，用起来像另一个软件。
 *
 * 动作上仍然刻意克制：只有还原与彻底删除。免得一个"已经不要了"的书还能改样式、写笔记。
 */
export function TrashView(): ReactNode {
  const index = useLibrary((s) => s.index)
  const restoreBooks = useLibrary((s) => s.restoreBooks)
  const purgeBooks = useLibrary((s) => s.purgeBooks)
  const setView = useUi((s) => s.setView)

  const [selected, setSelected] = useState<Set<string>>(() => new Set())

  const trashed = useMemo(
    () =>
      (index?.books ?? [])
        .filter((book) => book.trashed)
        .sort((a, b) => (b.trashedAt ?? 0) - (a.trashedAt ?? 0)),
    [index?.books]
  )
  const selectedBooks = trashed.filter((book) => selected.has(book.id))
  const allSelected = trashed.length > 0 && selectedBooks.length === trashed.length

  const toggle = (id: string): void =>
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const afterAction = (): void => setSelected(new Set())

  return (
    /* 与书架同一套外壳：工具栏 + 滚动区 + 底部批量条 */
    <div className="shelf-view trash-view">
      <div className="shelf-toolbar">
        <div className="shelf-toolbar-left">
          <strong className="trash-heading">回收站</strong>
          <span className="trash-count">{trashed.length} 本</span>
          <span className="trash-hint">
            复制入库的书，文件已在藏书目录的 <code>_回收站</code> 里；引用式的书文件仍在原处。
          </span>
        </div>
        <div className="shelf-toolbar-right">
          {trashed.length > 0 ? (
            <Button
              size="xs"
              variant="outline"
              onClick={() => setSelected(allSelected ? new Set() : new Set(trashed.map((book) => book.id)))}
            >
              {allSelected ? '取消全选' : '全选'}
            </Button>
          ) : null}
          {trashed.length > 0 ? (
            <Button
              size="xs"
              variant="danger"
              icon={<IconTrash size={13} />}
              onClick={() => {
                if (!window.confirm(`彻底删除这 ${trashed.length} 本书？文件也会一起删掉，不能恢复。`)) return
                void purgeBooks(trashed.map((book) => book.id)).then(afterAction)
              }}
            >
              清空回收站
            </Button>
          ) : null}
        </div>
      </div>

      <div className="trash-scroll">
        {trashed.length === 0 ? (
          <p className="trash-empty">回收站是空的。从书架移除的书会先来到这里。</p>
        ) : (
          <ul className="trash-list">
            {trashed.map((book) => {
              const isSelected = selected.has(book.id)
              return (
                <li
                  key={book.id}
                  className={`trash-row${isSelected ? ' is-selected' : ''}`}
                  onClick={() => toggle(book.id)}
                >
                  <span className={`trash-check${isSelected ? ' is-on' : ''}`} aria-hidden="true" />
                  <div className="trash-main">
                    <span className="trash-title" title={book.path}>
                      {book.title}
                    </span>
                    <span className="trash-meta">
                      {FORMAT_LABEL[book.format]}
                      {book.author ? ` · ${book.author}` : ''}
                      {book.trashedAt ? ` · 移除于 ${formatDateTime(book.trashedAt)}` : ''}
                      {book.external ? ' · 引用式（文件留在原处）' : ' · 文件在 _回收站'}
                    </span>
                    <span className="trash-path" title={book.path}>
                      {book.path}
                    </span>
                  </div>
                  {/* 单行上也留动作：不想选的时候点一下就还原 */}
                  <div className="trash-row-actions" onClick={(event) => event.stopPropagation()}>
                    <Button
                      size="xs"
                      variant="outline"
                      icon={<IconRefresh size={13} />}
                      onClick={() => void restoreBooks([book.id]).then(afterAction)}
                    >
                      还原
                    </Button>
                    <Button
                      size="xs"
                      variant="danger"
                      icon={<IconTrash size={13} />}
                      onClick={() => {
                        if (!window.confirm(`彻底删除「${book.title}」？文件也会一起删掉，不能恢复。`)) return
                        void purgeBooks([book.id]).then(afterAction)
                      }}
                    >
                      彻底删除
                    </Button>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      {/* 批量条：与书架同一个 .batch-bar，选中之后才浮出来 */}
      {selectedBooks.length > 0 ? (
        <div className="batch-bar">
          <span className="batch-count">已选 {selectedBooks.length} 本</span>
          <Button
            size="xs"
            variant="outline"
            icon={<IconRefresh size={13} />}
            onClick={() => void restoreBooks(selectedBooks.map((book) => book.id)).then(afterAction)}
          >
            还原到书架
          </Button>
          <Button
            size="xs"
            variant="danger"
            icon={<IconTrash size={13} />}
            onClick={() => {
              if (!window.confirm(`彻底删除选中的 ${selectedBooks.length} 本？文件也会一起删掉。`)) return
              void purgeBooks(selectedBooks.map((book) => book.id)).then(afterAction)
            }}
          >
            彻底删除
          </Button>
          <Button size="xs" variant="ghost" onClick={() => setSelected(new Set())}>
            取消选择
          </Button>
        </div>
      ) : null}
    </div>
  )
}
