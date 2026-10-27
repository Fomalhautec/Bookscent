import { useEffect, useState, type ReactNode } from 'react'
import { APP_VERSION, type AppInfo } from '@shared/types'
import { Button, SectionTitle } from '@/components/common/Controls'
import { IconBookOpen, IconFolderOpen, IconImage, IconInfo, IconList } from '@/components/icons/Icons'
import { appApi } from '@/lib/api'
import { useLibrary } from '@/store/useLibrary'
import { useSettings } from '@/store/useSettings'
import { useUi } from '@/store/useUi'
import { sortedChangelog } from './SubPages'
import { CHANGELOG_RECENT, SHORTCUTS } from './labels'

export function AboutTab({
  onOpenSub
}: {
  /** 跳到「更新日志」子页 */
  onOpenSub?: (id: 'changelog') => void
} = {}): ReactNode {
  const index = useLibrary((s) => s.index)
  const settings = useSettings((s) => s.settings)
  const toast = useUi((s) => s.toast)
  const [info, setInfo] = useState<AppInfo | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    appApi
      .info()
      .then((data) => {
        if (alive) setInfo(data)
      })
      .catch((reason: unknown) => {
        if (alive) setError(reason instanceof Error ? reason.message : String(reason))
      })
    return () => {
      alive = false
    }
  }, [])

  const reveal = (dir: string | undefined): void => {
    if (!dir) return
    void appApi.revealPath(dir).catch((reason: unknown) => toast('打开失败', 'error', String(reason)))
  }

  const toggleDevTools = async (): Promise<void> => {
    try {
      const open = await appApi.toggleDevTools()
      toast(open ? '控制台已打开' : '控制台已关闭', 'success', open ? 'F12 也能开关' : undefined)
    } catch (reason) {
      toast('打不开控制台', 'error', String(reason))
    }
  }

  const libraryDir = info?.libraryDir ?? index?.libraryDir
  const userDataDir = info?.userDataDir
  const assetsDir = settings?.assetsDir

  return (
    <div className="set-tab">
      <div className="set-about">
        <div className="set-about-book">
          <span className="set-about-cover">
            <span className="set-about-frame" />
            <span className="set-about-title">书香笔记</span>
            <span className="set-about-sub">Bookscent</span>
            <span className="set-about-seal">藏</span>
          </span>
          <span className="set-about-spine">设置 · v{APP_VERSION}</span>
        </div>

        <div className="set-about-info">
          <SectionTitle hint="一处安静的地方，放你的书与笔记">书香笔记 · Bookscent</SectionTitle>
          <dl className="set-about-list">
            <div>
              <dt>版本</dt>
              <dd>
                {APP_VERSION}
                <span className="set-tag is-on">当前版本</span>
              </dd>
            </div>
            <div>
              <dt>运行平台</dt>
              <dd>{info?.platform ?? '读取中…'}</dd>
            </div>
            <div>
              <dt>Electron</dt>
              <dd>{info?.electron ?? '读取中…'}</dd>
            </div>
            <div>
              <dt>Chrome</dt>
              <dd>{info?.chrome ?? '读取中…'}</dd>
            </div>
            <div>
              <dt>Node</dt>
              <dd>{info?.node ?? '读取中…'}</dd>
            </div>
            <div>
              <dt>应用主题</dt>
              <dd>{settings?.appTheme ?? '—'}</dd>
            </div>
          </dl>
          {error ? (
            <p className="set-hint">
              <IconInfo size={12} /> 运行环境读取失败：{error}
            </p>
          ) : null}
        </div>
      </div>

      <section className="set-block">
        <SectionTitle hint="排查问题时先看这里；应用里 Ctrl+Shift+I 被「导入」占了，所以单独给一个入口">
          开发者
        </SectionTitle>
        <div className="set-list">
          <div className="set-list-item">
            <span className="set-list-swatches">
              <IconInfo size={16} />
            </span>
            <span className="set-list-text">
              <span className="set-list-name">开发者控制台</span>
              <span className="set-list-sub">看报错、看网络请求；F12 也可以随时开关</span>
            </span>
            <span className="set-list-actions">
              <Button variant="ghost" size="xs" onClick={() => void toggleDevTools()}>
                打开控制台
              </Button>
            </span>
          </div>
        </div>

        <SectionTitle hint="都在本机磁盘上，点一下就能打开所在文件夹">数据位置</SectionTitle>
        <div className="set-list">
          <div className="set-list-item">
            <span className="set-list-swatches">
              <IconBookOpen size={16} />
            </span>
            <span className="set-list-text">
              <span className="set-list-name">藏书目录</span>
              <span className="set-list-sub">
                <code>{libraryDir ?? '—'}</code>
              </span>
            </span>
            <span className="set-list-actions">
              <Button variant="ghost" size="xs" disabled={!libraryDir} onClick={() => reveal(libraryDir)}>
                打开
              </Button>
            </span>
          </div>
          <div className="set-list-item">
            <span className="set-list-swatches">
              <IconImage size={16} />
            </span>
            <span className="set-list-text">
              <span className="set-list-name">数据目录（书籍外观图片）</span>
              <span className="set-list-sub">
                <code>{assetsDir ?? '—'}</code>
              </span>
            </span>
            <span className="set-list-actions">
              <Button variant="ghost" size="xs" disabled={!assetsDir} onClick={() => reveal(assetsDir)}>
                打开
              </Button>
            </span>
          </div>
          <div className="set-list-item">
            <span className="set-list-swatches">
              <IconFolderOpen size={16} />
            </span>
            <span className="set-list-text">
              <span className="set-list-name">配置目录</span>
              <span className="set-list-sub">
                <code>{userDataDir ?? '—'}</code>
              </span>
            </span>
            <span className="set-list-actions">
              <Button variant="outline" size="xs" disabled={!userDataDir} onClick={() => reveal(userDataDir)}>
                打开配置目录
              </Button>
            </span>
          </div>
        </div>
      </section>

      <section className="set-block">
        <SectionTitle hint="很长，所以单独一页用表格排 —— 能搜版本、能搜关键词">更新日志</SectionTitle>
        {/* 摘要只留最近三条，完整列表去子页看 */}
        <ul className="set-log is-compact">
          {sortedChangelog().slice(0, 3).map((entry) => (
            <li key={`${entry.version}-${entry.title}`}>
              <strong>{entry.title}</strong>
              <span>
                <code className="set-log-ver">{entry.version}</code>
                {entry.detail.slice(0, 90)}
                {entry.detail.length > 90 ? '…' : ''}
              </span>
            </li>
          ))}
        </ul>
        <div className="set-actions set-actions-left">
          <Button
            variant="outline"
            icon={<IconList size={14} />}
            disabled={!onOpenSub}
            onClick={() => onOpenSub?.('changelog')}
          >
            查看完整更新日志（{CHANGELOG_RECENT.length} 条）
          </Button>
        </div>
      </section>

      <section className="set-block">
        <SectionTitle hint="在书架、阅读与编辑界面里都可用">快捷键</SectionTitle>
        <div className="set-keys">
          {SHORTCUTS.map((item) => (
            <span className="set-key" key={item.keys}>
              <kbd>{item.keys}</kbd>
              <span>{item.label}</span>
            </span>
          ))}
        </div>
      </section>

      <p className="set-license">
        书香笔记 Bookscent 以 MIT 许可证发布：可自由使用、修改与分发，请保留版权声明。
      </p>
    </div>
  )
}
