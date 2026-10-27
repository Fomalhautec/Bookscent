import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Button } from './Controls'
import { IconInfo, IconRefresh } from '@/components/icons/Icons'

interface Props {
  children: ReactNode
  /** 出问题时给用户一个可读的名字，例如「PDF 阅读器」 */
  label: string
  onReset?: () => void
}

interface State {
  error: Error | null
  info: string
  detailOpen: boolean
}

/**
 * 单个功能区出错时不该把整个书房带走。
 * 这一层把异常圈在功能模块内部，并给用户一条明确的退路。
 */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null, info: '', detailOpen: false }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error }
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // 留在控制台里方便排查；界面只显示简短信息
    console.error(`[书香笔记] ${this.props.label} 出错：`, error, info.componentStack)
    this.setState({ info: info.componentStack ?? '' })
  }

  private reset = (): void => {
    this.setState({ error: null, info: '', detailOpen: false })
    this.props.onReset?.()
  }

  override render(): ReactNode {
    const { error, info, detailOpen } = this.state
    if (!error) return this.props.children

    return (
      <div className="crash-panel">
        <div className="crash-card">
          <span className="crash-icon">
            <IconInfo size={22} />
          </span>
          <h2>{this.props.label}遇到了一个错误</h2>
          <p className="crash-message">{error.message || String(error)}</p>
          <p className="crash-hint">
            你的文件和笔记没有被修改。可以重试，或者回到书架换一本书打开。
          </p>
          <div className="crash-actions">
            <Button variant="solid" icon={<IconRefresh size={14} />} onClick={this.reset}>
              重试
            </Button>
            <Button variant="outline" onClick={() => this.setState({ detailOpen: !detailOpen })}>
              {detailOpen ? '收起技术细节' : '查看技术细节'}
            </Button>
          </div>
          {detailOpen ? <pre className="crash-detail">{info || error.stack || ''}</pre> : null}
        </div>
      </div>
    )
  }
}
