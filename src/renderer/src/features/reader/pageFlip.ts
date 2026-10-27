import type { PageFlipAnimation } from '@shared/types'

/**
 * 左右翻页模式下的翻页动画。
 *
 * PDF 与 EPUB 共用这一份定义：两个阅读器各有各的 DOM 结构，
 * 但"翻页时用什么动画"这件事必须只有一种叫法，否则设置里会出现两套同义词。
 */
export interface PageFlipOption {
  value: PageFlipAnimation
  label: string
  hint: string
}

export const PAGE_FLIP_OPTIONS: PageFlipOption[] = [
  { value: 'slide', label: '滑动', hint: '新页从侧面推入，像翻一本厚书' },
  { value: 'curl', label: '卷页', hint: '页角卷起再落下，最有纸感' },
  { value: 'fade', label: '淡入', hint: '前后两页交叉淡化，安静不打扰' },
  { value: 'none', label: '不使用', hint: '直接切换，最省性能' }
]

export function pageFlipLabel(value: PageFlipAnimation): string {
  return PAGE_FLIP_OPTIONS.find((item) => item.value === value)?.label ?? '滑动'
}

/** 动画时长的上限：太慢会让人等，太快又看不出是动画 */
export const FLIP_DURATION_MS = 280
