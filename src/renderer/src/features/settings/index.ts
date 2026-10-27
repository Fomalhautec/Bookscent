/**
 * 设置模块入口。
 * 只暴露一个整页视图：SettingsView（左导航 + 右侧滚动内容）。
 * 各 Tab 单独导出，方便别处（比如引导页）复用其中一页。
 */

export { SettingsView } from './SettingsView'
export { GeneralTab } from './GeneralTab'
export { AppearanceTab } from './AppearanceTab'
export { SpineStylesTab } from './SpineStylesTab'
export { ShelfTab } from './ShelfTab'
export { ReadingTab } from './ReadingTab'
export { LibraryTab } from './LibraryTab'
export { AboutTab } from './AboutTab'

/* 外观三段式子页，保留导出以便按需嵌入 */
export { AppThemeTab } from './AppThemeTab'
export { ShelfThemeTab } from './ShelfThemeTab'
export { BookStyleTab } from './BookStyleTab'
