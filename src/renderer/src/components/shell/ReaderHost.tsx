import type { ReactNode } from 'react'
import { EDITABLE_FORMATS, FORMAT_LABEL } from '@shared/types'
import { useLibrary } from '@/store/useLibrary'
import { useUi } from '@/store/useUi'
import { appApi } from '@/lib/api'
import { formatPages } from '@/lib/format'
import { useUsage } from '@/lib/usage'
import { IconArrowLeft, IconInfo, IconPlus } from '@/components/icons/Icons'
import { Button, IconButton } from '@/components/common/Controls'
import { PdfViewer } from '@/features/pdf'
import { EpubView } from '@/features/epub'
import { EditorView } from '@/features/editor'

/** 打开一本书：PDF 交给阅读器，其余格式交给编辑器 / 预览器 */
export function ReaderHost(): ReactNode {
  const openBookId = useLibrary((s) => s.openBookId)
  const book = useLibrary((s) => s.index?.books.find((b) => b.id === openBookId))
  const select = useLibrary((s) => s.select)
  const openDetail = useUi((s) => s.openDetail)
  const keepTemporary = useLibrary((s) => s.keepTemporary)

  // 打开着就算时长与次数（按书籍/笔记分开记账），摘要交给全局状态栏显示
  useUsage(book)

  if (!book) return null

  const editable = EDITABLE_FORMATS.includes(book.format)

  return (
    <div className="reader-host">
      <div className="reader-bar">
        <Button icon={<IconArrowLeft size={15} />} onClick={() => select(null)}>
          返回书架
        </Button>
        <span className="reader-bar-divider" />
        <div className="reader-bar-title">
          <h1>{book.title}</h1>
          <p>
            {FORMAT_LABEL[book.format]}
            {book.author ? ` · ${book.author}` : ''} · {formatPages(book.pageCount, book.pageCountExact)}
            {editable ? ' · 可直接编辑' : ''}
          </p>
        </div>
        <div className="reader-bar-actions">
          {/*
            临时打开的书：明确标出来，并给一个"留下它"的出口。
            临时书退出应用就没了（见 library.loadIndex），不提示的话用户会以为丢了。
          */}
          {book.temporary ? (
            <>
              <span className="reader-temp-badge" title="临时打开的书，退出应用后不会留下">
                临时
              </span>
              <Button
                variant="solid"
                icon={<IconPlus size={14} />}
                onClick={() => void keepTemporary(book.id)}
              >
                添加到书架
              </Button>
            </>
          ) : null}
          {/*
            详情入口：光一个 ⓘ 图标不够显眼（用户说"阅读界面也要能打开详情"），
            所以带上文字标签。
          */}
          <Button variant="outline" icon={<IconInfo size={14} />} onClick={() => openDetail(book.id)}>
            书籍详情
          </Button>
        </div>
      </div>

      <div className="reader-body">
        {book.format === 'pdf' ? (
          <PdfViewer book={book} />
        ) : book.format === 'epub' ? (
          <EpubView book={book} />
        ) : (
          <EditorView book={book} />
        )}
      </div>

      {/*
        阅读统计不在这里重复一遍 —— 它是显示在**全局状态栏**那一行上的
        （用户希望的位置：就是"46 本藏书 · 4 层书架"那里，读书时换成本书的统计）。
        这里只负责计时并把摘要交给 store，见 lib/usage 与 store/useReading。
      */}
    </div>
  )
}
