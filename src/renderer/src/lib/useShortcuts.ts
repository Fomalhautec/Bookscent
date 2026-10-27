import { useCallback, useEffect, useMemo, useRef } from 'react'
import type { ShortcutScope } from '@shared/shortcuts'
import { eventKeyName, resolveShortcuts } from '@shared/shortcuts'
import { useSettings } from '@/store/useSettings'

/**
 * 把一组动作接到快捷键上。
 *
 * 用法：
 * ```tsx
 * const onKey = useShortcuts({ 'epub.nextScreen': () => goLogical('next') })
 * // 顶层窗口自动接上；EPUB 还要把它挂到每个章节 iframe 的 document 上（见下）
 * ```
 * 只处理传进来的这些 id —— 各界面各管各的，撞不到一起。
 *
 * 几个刻意的行为：
 *   - 焦点在输入框/文本域里时，**不带修饰键**的快捷键一律不触发（否则在搜索框里打 "b"
 *     就会加书签）；带 Ctrl/Alt 的照旧触发（Ctrl+S 在编辑器里就该保存）。
 *   - 命中就 preventDefault，避免浏览器把 Space/PageDown 当成滚动。
 *   - handlers 用 ref 存，调用方不必为了"每次渲染都是新函数"而包 useCallback。
 *
 * **返回值**：这个 keydown 处理函数。EPUB 的正文在 iframe 里 ——
 * 用户一点正文，焦点就进了 iframe 的 document，挂在外层 window 上的监听**收不到任何按键**
 * （这正是"点一下正文快捷键就全失效"的原因）。所以把返回的处理函数也挂到每个章节文档上。
 */
export function useShortcuts(handlers: Record<string, () => void>): (event: KeyboardEvent) => void {
  const settings = useSettings((s) => s.settings)
  const overrides = settings?.ui.shortcuts
  const bindings = useMemo(() => resolveShortcuts(overrides), [overrides])

  const handlersRef = useRef(handlers)
  handlersRef.current = handlers
  /* 作用范围直接从 id 前缀取（'epub.nextScreen' → 'epub'），少一个容易写错的参数 */
  const scope: ShortcutScope = (Object.keys(handlers)[0]?.split('.')[0] ?? 'global') as ShortcutScope
  const bindingsRef = useRef(bindings)
  bindingsRef.current = bindings

  const onKeyDown = useCallback(
    (event: KeyboardEvent): void => {
      /* 输入中不抢键：只有带修饰键的组合才继续往下走 */
      const target = event.target as HTMLElement | null
      const tag = target?.tagName ?? ''
      const editing =
        tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable === true
      const name = eventKeyName(event)
      if (!name) return
      const hasModifier = /Ctrl|Alt|Meta/.test(name)
      if (editing && !hasModifier) return

      for (const def of Object.keys(handlersRef.current)) {
        if (!def.startsWith(`${scope}.`)) continue
        const keys = bindingsRef.current[def] ?? []
        if (!keys.includes(name)) continue
        event.preventDefault()
        event.stopPropagation()
        handlersRef.current[def]?.()
        return
      }
    },
    [scope]
  )

  useEffect(() => {
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onKeyDown])

  return onKeyDown
}
