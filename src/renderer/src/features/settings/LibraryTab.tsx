import { useMemo, useState, type ReactNode } from 'react'
import type { AppSettings, AssetScanReport, Book } from '@shared/types'
import { Button, IconButton, SectionTitle, Switch, TextInput } from '@/components/common/Controls'
// 书架层主题色与删除弹窗和侧栏共用同一套实现，两边写的是同一份 Shelf.color
import { ShelfColorPicker, ShelfDeleteModal } from '@/components/shell/Sidebar'
import {
  IconCheck,
  IconChevronDown,
  IconEdit,
  IconExternalLink,
  IconFolder,
  IconFolderOpen,
  IconImage,
  IconImport,
  IconList,
  IconRefresh,
  IconTrash,
  IconUpload
} from '@/components/icons/Icons'
import { appApi, dialogApi, libraryApi, settingsApi } from '@/lib/api'
import { formatBytes, formatDateTime } from '@/lib/format'
import { shelfFallbackFor, useLibrary } from '@/store/useLibrary'
import { useSettings } from '@/store/useSettings'
import { useUi } from '@/store/useUi'

/* --------------------------------------------------- 引用书籍的路径切分 */

/*
 * 这里刻意不用 node:path：这是渲染进程，拿不到 node 内置模块，
 * 而且库里的路径可能是 Windows 的 `\` 或用户手写/跨平台的 `/`，
 * 所以按这两种分隔符自己切——够用，也不依赖平台。
 */

/** 路径里最后一个分隔符的下标；没有分隔符时是 -1 */
function lastSeparatorIndex(path: string): number {
  return Math.max(path.lastIndexOf('\\'), path.lastIndexOf('/'))
}

/** 所在目录（不含末尾分隔符）；盘根 `D:\a.pdf` 得到 `D:`，取不到时给空串 */
function parentDirOf(path: string): string {
  const cut = lastSeparatorIndex(path)
  return cut < 0 ? '' : path.slice(0, cut)
}

/** 目录的显示名：最后一段；盘根显示盘符，切不出东西时退回整条路径 */
function dirLabelOf(dir: string): string {
  if (!dir) return '（未记录目录）'
  const cut = lastSeparatorIndex(dir)
  const tail = cut < 0 ? dir : dir.slice(cut + 1)
  return tail || dir
}

/** 文件名：最后一个分隔符之后的那段；切不出来就退回整条路径 */
function fileNameOf(path: string): string {
  const cut = lastSeparatorIndex(path)
  return (cut < 0 ? path : path.slice(cut + 1)) || path
}

/** 组标题的 title：盘根补一个分隔符（`D:` → `D:\`），看起来才像一条完整路径 */
function dirTitleOf(dir: string): string {
  if (!dir) return '（未记录目录）'
  return /^[a-zA-Z]:$/.test(dir) ? `${dir}\\` : dir
}

/** 引用书籍按所在目录分组后的一组 */
interface RefGroup {
  /** 目录完整路径，给标题的 title 用 */
  dir: string
  /** 目录最后一段（盘根就是盘符） */
  label: string
  books: Book[]
}

/**
 * 文件与数据 —— 藏书目录、数据目录（书籍外观图片）、导入、书架层与设置迁移。
 * 所有会落盘的动作都走 libraryApi / settingsApi，组件自己不碰 fs。
 */
export function LibraryTab({
  settings,
  onOpenSub
}: {
  settings: AppSettings
  /** 跳到「引用的书籍」子页 */
  onOpenSub?: (id: 'cited-books') => void
}): ReactNode {
  const index = useLibrary((s) => s.index)
  const addShelf = useLibrary((s) => s.addShelf)
  const renameShelf = useLibrary((s) => s.renameShelf)
  const removeShelf = useLibrary((s) => s.removeShelf)
  const setShelfColor = useLibrary((s) => s.setShelfColor)
  const rescan = useLibrary((s) => s.rescan)
  const importFiles = useLibrary((s) => s.importFiles)
  const importFolder = useLibrary((s) => s.importFolder)

  const exportSettings = useSettings((s) => s.exportSettings)
  const importSettings = useSettings((s) => s.importSettings)
  const reset = useSettings((s) => s.reset)
  const loadSettings = useSettings((s) => s.load)
  const toast = useUi((s) => s.toast)

  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [newShelf, setNewShelf] = useState('')
  const [busy, setBusy] = useState<string | null>(null)

  /* 图片数据目录体检：先拿到报告，再让用户决定清什么 */
  const [scan, setScan] = useState<AssetScanReport | null>(null)
  const [scanBusy, setScanBusy] = useState(false)
  const [cleanBusy, setCleanBusy] = useState(false)
  const [cleanOrphans, setCleanOrphans] = useState(true)
  const [cleanDuplicates, setCleanDuplicates] = useState(true)
  const [confirming, setConfirming] = useState(false)
  /** 正在展开主题色板的那一层 */
  const [paletteId, setPaletteId] = useState<string | null>(null)
  /** 正在等确认删除的那一层 */
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const deletingShelf = deletingId ? index?.shelves.find((s) => s.id === deletingId) : undefined
  const deleteTarget = index && deletingId ? shelfFallbackFor(index.shelves, deletingId) : undefined
  const deleteCount = index && deletingId ? index.books.filter((b) => b.shelfId === deletingId).length : 0

  /** 仅引用导入的书：文件还在库外，用户挪一下书就可能失效 */
  const referencedBooks = useMemo(() => (index?.books ?? []).filter((book) => book.external), [index])

  /**
   * 引用书籍按所在目录分组。
   *
   * 分组键用小写：Windows 路径大小写不敏感，`D:\Books` 与 `d:\books` 本来就是同一个目录；
   * 展示时保留第一次见到的写法。`D:\Books\轻小说` 与 `D:\Books` 切出来的目录不同，自然是两组。
   * 组的顺序按目录名升序，组内按书名升序。
   */
  const refGroups = useMemo((): RefGroup[] => {
    const map = new Map<string, RefGroup>()
    for (const book of referencedBooks) {
      const dir = parentDirOf(book.path)
      const key = dir.toLowerCase()
      const found = map.get(key)
      if (found) found.books.push(book)
      else map.set(key, { dir, label: dirLabelOf(dir), books: [book] })
    }
    return [...map.values()]
      .map((group) => ({
        ...group,
        books: [...group.books].sort((a, b) => a.title.localeCompare(b.title, 'zh-Hans-CN'))
      }))
      .sort(
        (a, b) => a.label.localeCompare(b.label, 'zh-Hans-CN') || a.dir.localeCompare(b.dir, 'zh-Hans-CN')
      )
  }, [referencedBooks])

  const confirm = async (message: string, detail: string): Promise<boolean> => {
    const response = await dialogApi.confirm({
      title: '书香笔记',
      message,
      detail,
      buttons: ['确定', '取消'],
      defaultId: 1,
      cancelId: 1,
      type: 'warning'
    })
    return response === 0
  }

  const run = async (key: string, task: () => Promise<void>): Promise<void> => {
    setBusy(key)
    try {
      await task()
    } catch (error) {
      toast('操作失败', 'error', (error as Error).message)
    } finally {
      setBusy(null)
    }
  }

  const reveal = (dir: string | undefined): void => {
    if (!dir) return
    void appApi.revealPath(dir).catch((error: unknown) => toast('打开失败', 'error', String(error)))
  }

  const openWithSystem = (path: string): void => {
    void appApi.openPath(path).catch((error: Error) => toast('无法用系统应用打开', 'error', error.message))
  }

  const changeLibraryDir = (): void => {
    void run('dir', async () => {
      const result = await libraryApi.chooseLibraryDir()
      if (!result) return
      await useLibrary.getState().load()
      toast('藏书目录已切换', 'success', result.dir)
    })
  }

  /* ------------------------------------------------ 图片数据目录体检 */
  const runScan = async (): Promise<void> => {
    setScanBusy(true)
    try {
      const report = await libraryApi.scanAssets()
      setScan(report)
      setConfirming(false)
    } catch (error) {
      toast('检查失败', 'error', error instanceof Error ? error.message : String(error))
    } finally {
      setScanBusy(false)
    }
  }

  const runCleanup = async (): Promise<void> => {
    setCleanBusy(true)
    try {
      const result = await libraryApi.cleanupAssets({
        orphans: cleanOrphans,
        duplicates: cleanDuplicates
      })
      setScan(result.scan)
      setConfirming(false)
      toast(
        '清理完成',
        'success',
        `删除没人用的 ${result.removedOrphans} 张、重复的 ${result.removedDuplicates} 张，` +
          `释放 ${formatBytes(result.freed)}${result.repointed > 0 ? `，改指引用 ${result.repointed} 处` : ''}`
      )
      /* 引用改过，书架要重画 */
      await useLibrary.getState().load()
    } catch (error) {
      toast('清理失败', 'error', error instanceof Error ? error.message : String(error))
    } finally {
      setCleanBusy(false)
    }
  }

  const changeAssetsDir = (): void => {
    void run('assets', async () => {
      const result = await settingsApi.chooseAssetsDir()
      if (!result) return
      await loadSettings()
      if (result.failed > 0) toast('数据目录已更换，但有图片没搬成功', 'warn', `已搬 ${result.moved} 张，失败 ${result.failed} 张`)
      else toast('数据目录已更换', 'success', `已搬 ${result.moved} 张图片到 ${result.dir}`)
    })
  }

  const migrateInline = (): void => {
    void run('migrate', async () => {
      const result = await settingsApi.migrateInlineImages()
      await loadSettings()
      if (result.failed > 0) toast('迁移完成，但有图片失败', 'warn', `已迁移 ${result.moved} 张，失败 ${result.failed} 张`)
      else if (result.moved === 0) toast('没有需要迁移的内联图片', 'info')
      else toast('内联图片已迁入数据目录', 'success', `共 ${result.moved} 张，索引会明显变小`)
    })
  }

  const submitShelf = (): void => {
    const name = newShelf.trim()
    if (!name) return
    setNewShelf('')
    void addShelf(name).then(() => toast(`已添加书架层「${name}」`, 'success'))
  }

  const commitRename = (id: string): void => {
    const name = draft.trim()
    setEditingId(null)
    if (!name) return
    void renameShelf(id, name)
  }

  const startDeleteShelf = (id: string): void => {
    // 最后一层不给删：删完书就没地方放了
    if (!index || index.shelves.length <= 1) return
    setDeletingId(id)
  }

  const confirmDeleteShelf = (): void => {
    const id = deletingId
    setDeletingId(null)
    if (id) void removeShelf(id)
  }

  const onExport = (): void => {
    void run('export', async () => {
      const path = await exportSettings()
      if (path) toast('设置已导出', 'success', path)
      else toast('已取消导出', 'info')
    })
  }

  const onImport = (): void => {
    void run('import', async () => {
      const ok = await importSettings()
      toast(ok ? '设置已导入' : '已取消导入', ok ? 'success' : 'info')
    })
  }

  const onReset = (): void => {
    void (async () => {
      const ok = await confirm('恢复默认外观与偏好？', '主题、书籍样式和阅读偏好都会回到出厂设置，书库文件不受影响。')
      if (!ok) return
      await reset()
      toast('已恢复默认外观', 'success')
    })()
  }

  return (
    <div className="set-tab">
      <section className="set-block">
        <SectionTitle
          hint={`${
            index
              ? /* 临时打开的书不算在藏书数里 */ `${index.books.filter((b) => !b.temporary).length} 本书 · ${index.shelves.length} 层书架 · 上次扫描 ${formatDateTime(index.scannedAt)}`
              : '书库尚未载入'
          }`}
        >
          藏书目录
        </SectionTitle>
        <div className="set-path-card">
          <span className="set-path-icon">
            <IconFolderOpen size={18} />
          </span>
          <code className="set-path">{index?.libraryDir ?? '—'}</code>
          <span className="set-path-actions">
            <Button variant="outline" icon={<IconFolderOpen size={14} />} disabled={!index} onClick={() => reveal(index?.libraryDir)}>
              打开所在文件夹
            </Button>
            <Button variant="solid" disabled={busy === 'dir'} onClick={changeLibraryDir}>
              {busy === 'dir' ? '正在切换…' : '更换藏书目录'}
            </Button>
          </span>
        </div>
        <div className="set-actions set-actions-left">
          <Button
            variant="subtle"
            icon={<IconRefresh size={14} />}
            disabled={busy === 'scan'}
            onClick={() =>
              void run('scan', async () => {
                await rescan()
                toast('已重新扫描藏书目录', 'success')
              })
            }
          >
            重新扫描
          </Button>
        </div>
      </section>

      <section className="set-block">
        <SectionTitle hint="书脊贴图与封面图都存在这里，目录搬走后索引里的引用会自动改写">数据目录（书籍外观图片）</SectionTitle>
        <div className="set-path-card">
          <span className="set-path-icon">
            <IconImage size={18} />
          </span>
          <code className="set-path">{settings.assetsDir || '—'}</code>
          <span className="set-path-actions">
            <Button variant="outline" icon={<IconFolderOpen size={14} />} disabled={!settings.assetsDir} onClick={() => reveal(settings.assetsDir)}>
              打开所在文件夹
            </Button>
            <Button variant="solid" disabled={busy === 'assets'} onClick={changeAssetsDir}>
              {busy === 'assets' ? '正在搬迁…' : '更改数据目录…'}
            </Button>
          </span>
        </div>
        <div className="set-actions set-actions-left">
          <Button variant="subtle" icon={<IconUpload size={14} />} disabled={busy === 'migrate'} onClick={migrateInline}>
            {busy === 'migrate' ? '正在迁移…' : '把内联图片迁移到数据目录'}
          </Button>
        </div>
        <p className="set-callout">
          以前封面与书脊是直接以 base64 存在索引里的，索引会因此变得很大；迁移到数据目录后索引会明显变小，打开也更快。
        </p>
      </section>

      {/*
        体检与清理：书删了、封面换了，旧图还留在数据目录里；
        同一张图导入两次也会各存一份。应用从来不会回头收拾，
        所以这里给一个"先看报告、再动手"的入口。
      */}
      <section className="set-block">
        <SectionTitle hint="删掉已经没人用的图；内容重复的只留一份，并把引用改指过去。清理不可逆，所以先看报告再动手。">
          图片数据目录体检
        </SectionTitle>
        <div className="set-actions set-actions-left">
          <Button variant="subtle" icon={<IconRefresh size={14} />} disabled={scanBusy} onClick={() => void runScan()}>
            {scanBusy ? '正在检查…' : '检查一遍'}
          </Button>
          {scan ? (
            <Button
              variant="outline"
              icon={<IconFolderOpen size={14} />}
              onClick={() => reveal(scan.dir)}
            >
              打开目录
            </Button>
          ) : null}
        </div>

        {scan ? (
          <div className="assets-scan">
            <p className="assets-scan-line">
              共 <b>{scan.total}</b> 张图（{formatBytes(scan.totalSize)}），
              仍在使用 <b>{scan.used}</b> 张；
              没人用的 <b>{scan.orphans.length}</b> 张（{formatBytes(scan.orphanSize)}）；
              内容重复 <b>{scan.duplicates.length}</b> 组，
              多出来的可省 {formatBytes(scan.duplicateSize)}。
            </p>

            {scan.orphans.length > 0 ? (
              <div className="assets-scan-group">
                <span className="assets-scan-title">没人用的图片（前 8 个）</span>
                <ul className="assets-scan-list">
                  {scan.orphans.slice(0, 8).map((item) => (
                    <li key={item.name}>
                      <code>{item.name}</code>
                      <span className="assets-scan-size">{formatBytes(item.size)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {scan.duplicates.length > 0 ? (
              <div className="assets-scan-group">
                <span className="assets-scan-title">内容重复（前 5 组，保留第一个）</span>
                <ul className="assets-scan-list">
                  {scan.duplicates.slice(0, 5).map((group) => (
                    <li key={group.hash}>
                      <code>{group.keep}</code>
                      <span className="assets-scan-size">
                        另有 {group.drop.length} 份相同 · {formatBytes(group.size)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            <div className="set-fields">
              <div className="set-field">
                <span className="set-field-label">删除没人用的</span>
                <Switch
                  checked={cleanOrphans}
                  disabled={scan.orphans.length === 0}
                  onChange={setCleanOrphans}
                />
              </div>
              <div className="set-field">
                <span className="set-field-label">重复的只留一份</span>
                <Switch
                  checked={cleanDuplicates}
                  disabled={scan.duplicates.length === 0}
                  onChange={setCleanDuplicates}
                />
              </div>
            </div>

            <div className="set-actions set-actions-left">
              {confirming ? (
                <>
                  <Button variant="solid" disabled={cleanBusy} onClick={() => void runCleanup()}>
                    {cleanBusy ? '正在清理…' : '确定清理（不可撤销）'}
                  </Button>
                  <Button variant="subtle" onClick={() => setConfirming(false)}>
                    再想想
                  </Button>
                </>
              ) : (
                <Button
                  variant="outline"
                  disabled={(!cleanOrphans && !cleanDuplicates) || cleanBusy}
                  onClick={() => setConfirming(true)}
                >
                  清理…
                </Button>
              )}
            </div>
            {confirming ? (
              <p className="set-callout">
                会真删文件：没人用的那些直接删；重复的保留一份并把设置与索引里的引用改过去。
              </p>
            ) : null}
          </div>
        ) : (
          <p className="set-callout">点「检查一遍」看看数据目录里有没有已经没人用的图、或者重复的图。</p>
        )}
      </section>

      <section className="set-block">
        <SectionTitle hint="「复制」会把文件搬进藏书目录，「引用」只记一个路径，文件留在原地">导入书籍</SectionTitle>
        <div className="set-fields">
          <div className="set-field">
            <span className="set-field-label">选择文件</span>
            <div className="set-actions">
              <Button
                variant="outline"
                disabled={busy === 'file-copy'}
                onClick={() =>
                  void run('file-copy', async () => {
                    await importFiles(true)
                  })
                }
              >
                {busy === 'file-copy' ? '正在导入…' : '复制到藏书目录'}
              </Button>
              <Button
                variant="ghost"
                disabled={busy === 'file-link'}
                onClick={() =>
                  void run('file-link', async () => {
                    await importFiles(false)
                  })
                }
              >
                仅引用（不复制）
              </Button>
            </div>
            <span className="set-field-hint">一次可以选多个文档。</span>
          </div>
          <div className="set-field">
            <span className="set-field-label">选择文件夹</span>
            <div className="set-actions">
              <Button
                variant="outline"
                icon={<IconImport size={14} />}
                disabled={busy === 'dir-copy'}
                onClick={() =>
                  void run('dir-copy', async () => {
                    await importFolder(true)
                  })
                }
              >
                {busy === 'dir-copy' ? '正在导入…' : '复制到藏书目录'}
              </Button>
              <Button
                variant="ghost"
                disabled={busy === 'dir-link'}
                onClick={() =>
                  void run('dir-link', async () => {
                    await importFolder(false)
                  })
                }
              >
                仅引用（不复制）
              </Button>
            </div>
            <span className="set-field-hint">整个文件夹会递归扫一遍，只收认识的文档格式。</span>
          </div>
        </div>
      </section>

      <section className="set-block">
        <SectionTitle
          hint={
            index
              ? `共 ${referencedBooks.length} 本 · 这些书只记了路径，文件仍在原处 —— 挪动或删除它们，书架上这本书就会失效`
              : '书库尚未载入'
          }
        >
          引用的书籍
        </SectionTitle>
        {!index ? (
          <p className="set-empty">书库还没有载入。</p>
        ) : referencedBooks.length === 0 ? (
          <p className="set-empty">没有引用外部文件 —— 导入时选「复制」的书都放在藏书目录里。</p>
        ) : (
          /*
            这里原来把每本书都铺开（按文件夹分组、一条一条），书一多就把整页撑得看不到别的设置。
            现在只留一句摘要 + 入口，完整清单去「引用的书籍」子页看 —— 那边是表格，一屏能扫很多条。
          */
          <div className="set-actions set-actions-left">
            <Button
              variant="outline"
              icon={<IconList size={14} />}
              disabled={!onOpenSub}
              onClick={() => onOpenSub?.('cited-books')}
            >
              查看引用的书籍（{referencedBooks.length} 本）
            </Button>
          </div>
        )}
      </section>

      <section className="set-block">
        <SectionTitle hint="书架层就是书柜的隔板，用来把书分到不同的格子里；每行左边的竖条就是这一层的主题色">书架层管理</SectionTitle>
        {!index ? (
          <p className="set-empty">书库还没有载入。</p>
        ) : (
          <div className="set-list">
            {index.shelves.map((shelf) => {
              const count = index.books.filter((book) => book.shelfId === shelf.id).length
              const editing = editingId === shelf.id
              const paletteOpen = paletteId === shelf.id
              return (
                <div className="set-shelf-block" key={shelf.id}>
                  <div className="set-list-item set-shelf-row">
                    {/* 左侧竖色条：没设主题色时留一条灰的，行的高度和边距不变 */}
                    <span
                      className={['set-shelf-bar', shelf.color ? 'is-themed' : ''].filter(Boolean).join(' ')}
                      style={shelf.color ? { background: shelf.color } : undefined}
                      aria-hidden="true"
                    />
                    <span className="set-list-text">
                      {editing ? (
                        <TextInput
                          autoFocus
                          value={draft}
                          onChange={(event) => setDraft(event.target.value)}
                          onBlur={() => commitRename(shelf.id)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') commitRename(shelf.id)
                            if (event.key === 'Escape') setEditingId(null)
                          }}
                        />
                      ) : (
                        <>
                          <span className="set-list-name">{shelf.name}</span>
                          <span className="set-list-sub">{count} 本</span>
                        </>
                      )}
                    </span>
                    <span className="set-list-actions">
                      {editing ? (
                        <Button variant="solid" size="xs" icon={<IconCheck size={13} />} onClick={() => commitRename(shelf.id)}>
                          保存
                        </Button>
                      ) : (
                        <IconButton
                          label="重命名"
                          tone="muted"
                          onClick={() => {
                            setEditingId(shelf.id)
                            setDraft(shelf.name)
                          }}
                        >
                          <IconEdit size={14} />
                        </IconButton>
                      )}
                      <button
                        type="button"
                        className={['set-shelf-color-btn', paletteOpen ? 'is-open' : ''].filter(Boolean).join(' ')}
                        title={paletteOpen ? '收起主题色' : '设置主题色'}
                        aria-label="设置主题色"
                        aria-expanded={paletteOpen}
                        onClick={() => setPaletteId(paletteOpen ? null : shelf.id)}
                      >
                        <span
                          className={['set-shelf-color-btn-fill', shelf.color ? '' : 'is-none'].filter(Boolean).join(' ')}
                          style={shelf.color ? { background: shelf.color } : undefined}
                        />
                      </button>
                      <IconButton
                        label={index.shelves.length <= 1 ? '至少要保留一层书架' : '删除这一层'}
                        tone="muted"
                        disabled={index.shelves.length <= 1}
                        onClick={() => startDeleteShelf(shelf.id)}
                      >
                        <IconTrash size={14} />
                      </IconButton>
                    </span>
                  </div>
                  {paletteOpen ? (
                    <div className="set-shelf-palette">
                      <ShelfColorPicker
                        value={shelf.color ?? null}
                        onChange={(color) => void setShelfColor(shelf.id, color)}
                      />
                    </div>
                  ) : null}
                </div>
              )
            })}
          </div>
        )}
        <div className="set-inline-add">
          <TextInput
            value={newShelf}
            placeholder="新书架层名称，例如：待读"
            onChange={(event) => setNewShelf(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') submitShelf()
            }}
          />
          <Button variant="outline" disabled={!newShelf.trim()} onClick={submitShelf}>
            添加一层
          </Button>
        </div>
      </section>

      <section className="set-block">
        <SectionTitle hint="设置文件是 JSON，可以拷到另一台机器上接着用">设置迁移</SectionTitle>
        <div className="set-actions set-actions-left">
          <Button variant="outline" icon={<IconUpload size={14} />} disabled={busy === 'export'} onClick={onExport}>
            导出设置
          </Button>
          <Button variant="outline" icon={<IconImport size={14} />} disabled={busy === 'import'} onClick={onImport}>
            导入设置
          </Button>
          <Button variant="danger" icon={<IconRefresh size={14} />} onClick={onReset}>
            恢复默认外观
          </Button>
        </div>
        <p className="set-hint">
          当前外观：应用主题 {settings.appTheme} · 书架主题 {settings.shelfTheme} · 自定义主题{' '}
          {settings.customThemes.length} 套 · 书脊样式 书籍 {settings.spineStyles.length} 套 / 笔记{' '}
          {(settings.noteSpineStyles ?? settings.spineStyles).length} 套 · 我的书籍样式{' '}
          {settings.customBookStyles.length} 套
        </p>
      </section>

      {/* 删除书架层：和侧栏同一个应用内弹窗，勾选默认打开，不勾选就不给删 */}
      <ShelfDeleteModal
        open={Boolean(deletingShelf)}
        shelfName={deletingShelf?.name ?? ''}
        targetName={deleteTarget?.name ?? ''}
        bookCount={deleteCount}
        onCancel={() => setDeletingId(null)}
        onConfirm={confirmDeleteShelf}
      />
    </div>
  )
}
