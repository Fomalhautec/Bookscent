import type { ReactNode } from 'react'
import { IconHash, IconList } from '@/components/icons/Icons'
import type { HeadingInfo } from './lib/doc'

interface Props {
  headings: HeadingInfo[]
  activeId: string | null
  onJump: (heading: HeadingInfo) => void
}

export function OutlinePanel(props: Props): ReactNode {
  const { headings, activeId, onJump } = props

  return (
    <aside className="bs-outline" aria-label="文档大纲">
      <header className="bs-outline-head">
        <IconList size={14} />
        <span>大纲</span>
        <span className="bs-outline-count">{headings.length}</span>
      </header>
      {headings.length === 0 ? (
        <p className="bs-outline-empty">用 # 写标题，这里会自动生成目录。</p>
      ) : (
        <nav className="bs-outline-list">
          {headings.map((heading, index) => (
            <button
              key={`${heading.id}-${index}`}
              type="button"
              className={['bs-outline-item', heading.id === activeId ? 'is-active' : ''].join(' ')}
              style={{ paddingLeft: `${10 + (heading.level - 1) * 12}px` }}
              onClick={() => onJump(heading)}
              title={`第 ${heading.line} 行 · ${heading.text}`}
            >
              <IconHash size={11} />
              <span className="bs-outline-text">{heading.text}</span>
            </button>
          ))}
        </nav>
      )}
    </aside>
  )
}
