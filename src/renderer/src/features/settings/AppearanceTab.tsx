import { useState, type ReactNode } from 'react'
import type { AppSettings } from '@shared/types'
import { Button, Segmented } from '@/components/common/Controls'
import { IconBookStack } from '@/components/icons/Icons'
import { AppThemeTab } from './AppThemeTab'
import { ShelfThemeTab } from './ShelfThemeTab'

type SectionId = 'app' | 'shelf'

const SECTIONS: { id: SectionId; label: string; hint: string }[] = [
  { id: 'app', label: '应用主题', hint: '窗口、面板与浮层的配色' },
  { id: 'shelf', label: '书架主题', hint: '背板、木料与格内阴影' }
]

/**
 * 外观 —— 只负责「界面本身」的观感：应用配色与书架材质。
 *
 * 书籍（书脊 + 封面）长什么样是另一件事，统一放在「书籍外观」分页里，
 * 免得同一个东西在两个地方都能改，看起来像两套重复的设置。
 */
export function AppearanceTab({
  settings,
  onGoTo
}: {
  settings: AppSettings
  onGoTo?: (tab: 'spine') => void
}): ReactNode {
  const [section, setSection] = useState<SectionId>('app')
  const active = SECTIONS.find((item) => item.id === section) ?? SECTIONS[0]

  return (
    <div className="set-tab">
      <div className="set-subnav">
        <Segmented<SectionId>
          value={section}
          onChange={setSection}
          size="md"
          options={SECTIONS.map((item) => ({ value: item.id, label: item.label, title: item.hint }))}
        />
        <p className="set-subnav-hint">{active.hint}</p>
      </div>

      {section === 'app' ? <AppThemeTab settings={settings} /> : null}
      {section === 'shelf' ? <ShelfThemeTab settings={settings} /> : null}

      <div className="set-callout">
        <span className="set-callout-icon">
          <IconBookStack size={17} />
        </span>
        <div className="set-callout-body">
          <strong>书籍本身的外观不在这里</strong>
          <p>
            书脊的工艺、烫金、贴图与封面，都在「<strong>书籍外观</strong>」分页里：
            那里既有所有书的基准样式，也有可以逐套管理的样式列表。
          </p>
        </div>
        {onGoTo ? (
          <Button variant="outline" onClick={() => onGoTo('spine')}>
            去设置书籍外观
          </Button>
        ) : null}
      </div>
    </div>
  )
}
