import { useMemo, useState, type ReactNode } from 'react'
import type { AppSettings } from '@shared/types'
import type { ShortcutScope } from '@shared/shortcuts'
import {
  SHORTCUTS,
  SHORTCUT_SCOPES,
  findConflicts,
  formatKeys,
  normalizeKey,
  resolveShortcuts
} from '@shared/shortcuts'
import { Button, SectionTitle } from '@/components/common/Controls'
import { ShortcutRecorder } from './ShortcutRecorder'
import { IconClose, IconRefresh } from '@/components/icons/Icons'
import { useSettings } from '@/store/useSettings'
import { useUi } from '@/store/useUi'

/**
 * 「快捷键」设置页。
 *
 * 一条一条列出来，并且**标明适用范围** —— 用户提的正是"分不清哪个键在哪种文件里能用"：
 * 全局的（新建、导入、设置…）在哪儿都好使；EPUB / PDF / 编辑器各自的只在那个界面里生效。
 * 固定项（Esc、方向键之类组件约定）也列出来，但注明为什么不能改，
 * 免得用户以为"漏了"或者"改了没用"。
 */
export function ShortcutTab({ settings }: { settings: AppSettings }): ReactNode {
  const patch = useSettings((s) => s.patch)
  const resetPaths = useSettings((s) => s.resetPaths)
  const toast = useUi((s) => s.toast)
  const overrides = settings.ui.shortcuts ?? {}
  /** 正在录制按键的那一项 */
  const [capturing, setCapturing] = useState<string | null>(null)

  const resolved = useMemo(() => resolveShortcuts(overrides), [overrides])
  const conflicts = useMemo(() => findConflicts(overrides), [overrides])
  const conflictIds = useMemo(() => {
    const set = new Set<string>()
    for (const item of conflicts) for (const id of item.ids) set.add(id)
    return set
  }, [conflicts])

  const save = (next: Record<string, string[]>): void => {
    void patch({ ui: { ...settings.ui, shortcuts: next } })
  }

  const resetOne = (id: string): void => {
    /*
     * 单项恢复默认：把这个 id 写回注册表里的默认键。
     * 不能"删掉这个 id" —— 设置是深合并的，删键传过去等于没传，旧值会留着。
     */
    const def = SHORTCUTS.find((item) => item.id === id)
    if (!def) return
    save({ ...overrides, [id]: def.keys.map(normalizeKey) })
    setCapturing(null)
  }

  /**
   * 全部恢复默认：走设置页通用的「恢复本页默认」——
   * 它是"删掉路径再迁移"，能真正把键清掉（直接 patch 空对象会被深合并吃掉）。
   */
  const resetAll = (): void => {
    void resetPaths(['ui.shortcuts'])
    setCapturing(null)
    toast('快捷键已全部恢复默认', 'success')
  }

  /**
   * 改键：打开录制弹窗（弹出小窗口、点选控制键与按键）。
   * 以前是"点一下再随便按"，用户既看不出能按哪些键，也容易把手感弄乱。
   */
  const recorderDef = SHORTCUTS.find((item) => item.id === capturing) ?? null

  const rowsFor = (scope: ShortcutScope): ReactNode => {
    const defs = SHORTCUTS.filter((item) => item.scope === scope)
    const hint = SHORTCUT_SCOPES.find((item) => item.id === scope)?.hint ?? ''
    const scopeLabel = SHORTCUT_SCOPES.find((item) => item.id === scope)?.label ?? scope
    return (
      <section className="set-block" key={scope}>
        <SectionTitle hint={hint}>{scopeLabel}</SectionTitle>
        <div className="keys-list">
          {defs.map((def) => {
            const keys = resolved[def.id] ?? []
            /*
             * 比"键值"而不是"有没有覆盖"：单项恢复默认是写回默认键，
             * 覆盖项仍然在设置里，用「有没有覆盖」判断会让"恢复默认"按钮一直挂着。
             */
            const defaultKeys = def.keys.map(normalizeKey)
            const isDefault =
              keys.length === defaultKeys.length && keys.every((key, index) => key === defaultKeys[index])
            return (
              <div
                key={def.id}
                className={['keys-row', conflictIds.has(def.id) ? 'is-conflict' : ''].filter(Boolean).join(' ')}
              >
                <span className="keys-label">
                  {def.label}
                  {def.note ? <span className="keys-note">{def.note}</span> : null}
                </span>
                <span className="keys-keys">
                  {def.fixed ? (
                    <span className="keys-fixed">{formatKeys(keys)}</span>
                                    ) : (
                    <>
                      <button
                        type="button"
                        className="keys-capture"
                        onClick={() => setCapturing(def.id)}
                        title="点一下，在弹出的窗口里点选控制键与按键"
                      >
                        {keys.length > 0 ? formatKeys(keys) : '未设置'}
                      </button>
                      <button
                        type="button"
                        className="keys-clear"
                        title="清空这个快捷键（等于禁用）"
                        onClick={() => save({ ...overrides, [def.id]: [] })}
                      >
                        <IconClose size={12} />
                      </button>
                      {!isDefault ? (
                        <button type="button" className="keys-reset" onClick={() => resetOne(def.id)}>
                          恢复默认
                        </button>
                      ) : null}
                    </>
                  )}
                </span>
              </div>
            )
          })}
        </div>
      </section>
    )
  }

  return (
    <div className="set-tab">
      <section className="set-block">
        <SectionTitle hint="点右侧的按键按钮，然后直接按下你想要的组合键；清空即禁用。">
          快捷键
        </SectionTitle>
        <div className="set-actions set-actions-left">
          <Button variant="outline" icon={<IconRefresh size={14} />} onClick={resetAll}>
            全部恢复默认
          </Button>
        </div>
        {conflicts.length > 0 ? (
          <p className="set-callout">
            有 {conflicts.length} 处撞车：{conflicts
              .map((item) => `${item.key}（${item.ids.length} 个动作）`)
              .join('、')}
            。同一个界面里同一个键只能对应一个动作，建议改掉其中一个。
          </p>
        ) : (
          <p className="set-callout">目前没有重复绑定。</p>
        )}
      </section>

      {SHORTCUT_SCOPES.map((scope) => rowsFor(scope.id))}

      <ShortcutRecorder
        open={Boolean(recorderDef)}
        label={recorderDef?.label ?? ''}
        value={recorderDef ? (resolved[recorderDef.id] ?? []) : []}
        onClose={() => setCapturing(null)}
        onConfirm={(key) => {
          if (!recorderDef) return
          save({ ...overrides, [recorderDef.id]: [key] })
          setCapturing(null)
          toast('快捷键已更新', 'success', key)
        }}
        onDisable={() => {
          if (!recorderDef) return
          save({ ...overrides, [recorderDef.id]: [] })
          setCapturing(null)
          toast('已禁用这个快捷键', 'success', recorderDef.label)
        }}
      />
    </div>
  )
}
