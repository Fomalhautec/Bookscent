import type { ReactNode, SVGProps } from 'react'

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'children'> {
  size?: number
}

/**
 * 扁平线性图标集：统一 24×24 网格、1.75 描边、圆头圆角，
 * 颜色一律继承 currentColor，因此能跟着主题一起变色。
 */
function Svg({ size = 18, children, ...rest }: IconProps & { children: ReactNode }): ReactNode {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  )
}

/* ----------------------------------------------------------- 窗口 / 导航 */

export const IconMinimize = (p: IconProps): ReactNode => (
  <Svg {...p}>
    <path d="M5 12h14" />
  </Svg>
)

export const IconMaximize = (p: IconProps): ReactNode => (
  <Svg {...p}>
    <rect x="5" y="5" width="14" height="14" rx="1.5" />
  </Svg>
)

export const IconRestore = (p: IconProps): ReactNode => (
  <Svg {...p}>
    <rect x="4" y="8" width="12" height="12" rx="1.5" />
    <path d="M8 8V5.5A1.5 1.5 0 0 1 9.5 4H19a1 1 0 0 1 1 1v9.5a1.5 1.5 0 0 1-1.5 1.5H16" />
  </Svg>
)

export const IconClose = (p: IconProps): ReactNode => (
  <Svg {...p}>
    <path d="M6 6l12 12M18 6L6 18" />
  </Svg>
)

export const IconChevronLeft = (p: IconProps): ReactNode => (
  <Svg {...p}>
    <path d="M14.5 5.5L8 12l6.5 6.5" />
  </Svg>
)

export const IconChevronRight = (p: IconProps): ReactNode => (
  <Svg {...p}>
    <path d="M9.5 5.5L16 12l-6.5 6.5" />
  </Svg>
)

export const IconChevronDown = (p: IconProps): ReactNode => (
  <Svg {...p}>
    <path d="M5.5 9.5L12 16l6.5-6.5" />
  </Svg>
)

export const IconChevronUp = (p: IconProps): ReactNode => (
  <Svg {...p}>
    <path d="M5.5 14.5L12 8l6.5 6.5" />
  </Svg>
)

export const IconArrowLeft = (p: IconProps): ReactNode => (
  <Svg {...p}>
    <path d="M19 12H5" />
    <path d="M11 6l-6 6 6 6" />
  </Svg>
)

export const IconArrowRight = (p: IconProps): ReactNode => (
  <Svg {...p}>
    <path d="M5 12h14" />
    <path d="M13 6l6 6-6 6" />
  </Svg>
)

export const IconMore = (p: IconProps): ReactNode => (
  <Svg {...p}>
    <circle cx="12" cy="5.5" r="1.4" />
    <circle cx="12" cy="12" r="1.4" />
    <circle cx="12" cy="18.5" r="1.4" />
  </Svg>
)

export const IconMenu = (p: IconProps): ReactNode => (
  <Svg {...p}>
    <path d="M4 7h16M4 12h16M4 17h16" />
  </Svg>
)

/* ------------------------------------------------------------ 书架 / 书籍 */

export const IconBookshelf = (p: IconProps): ReactNode => (
  <Svg {...p}>
    <path d="M4 4v16" />
    <path d="M4 9h16M4 15h16" />
    <path d="M8 4v5M13 4v5M17.5 4v5" />
    <path d="M9 15v-5M14 15v-5M18 15v-5" />
  </Svg>
)

export const IconBook = (p: IconProps): ReactNode => (
  <Svg {...p}>
    <path d="M5 4.5A1.5 1.5 0 0 1 6.5 3H19v15H6.5A1.5 1.5 0 0 0 5 19.5z" />
    <path d="M5 19.5A1.5 1.5 0 0 1 6.5 18H19v3H6.5A1.5 1.5 0 0 1 5 19.5z" />
  </Svg>
)

export const IconBookOpen = (p: IconProps): ReactNode => (
  <Svg {...p}>
    <path d="M12 6.5C10.5 5 8.6 4.2 4 4.2v13.6c4.6 0 6.5.8 8 2.3 1.5-1.5 3.4-2.3 8-2.3V4.2c-4.6 0-6.5.8-8 2.3z" />
    <path d="M12 6.5v13.6" />
  </Svg>
)

export const IconBookStack = (p: IconProps): ReactNode => (
  <Svg {...p}>
    <rect x="3.5" y="4" width="17" height="4.2" rx="1" />
    <rect x="5" y="10" width="14" height="4.2" rx="1" />
    <rect x="3.5" y="16" width="17" height="4.2" rx="1" />
  </Svg>
)

export const IconLibrary = (p: IconProps): ReactNode => (
  <Svg {...p}>
    <path d="M4 20h16" />
    <rect x="5" y="5" width="3.4" height="13" rx="0.8" />
    <rect x="10.2" y="7" width="3.4" height="11" rx="0.8" />
    <rect x="15.4" y="4" width="3.4" height="14" rx="0.8" />
  </Svg>
)

export const IconLayers = (p: IconProps): ReactNode => (
  <Svg {...p}>
    <path d="M12 3.5l8.5 4.3-8.5 4.3-8.5-4.3z" />
    <path d="M3.5 12.2l8.5 4.3 8.5-4.3" />
    <path d="M3.5 16.5l8.5 4.3 8.5-4.3" />
  </Svg>
)

export const IconTag = (p: IconProps): ReactNode => (
  <Svg {...p}>
    <path d="M11.6 3.5H20v8.4l-8.7 8.7a1.4 1.4 0 0 1-2 0l-6.4-6.4a1.4 1.4 0 0 1 0-2z" />
    <circle cx="16.2" cy="7.8" r="1.3" />
  </Svg>
)

export const IconStar = (p: IconProps): ReactNode => (
  <Svg {...p}>
    <path d="M12 4l2.5 5.1 5.6.8-4 4 .9 5.6-5-2.7-5 2.7.9-5.6-4-4 5.6-.8z" />
  </Svg>
)

export const IconStarFilled = (p: IconProps): ReactNode => (
  <Svg {...p} fill="currentColor" stroke="none">
    <path d="M12 4l2.5 5.1 5.6.8-4 4 .9 5.6-5-2.7-5 2.7.9-5.6-4-4 5.6-.8z" />
  </Svg>
)

/* ---------------------------------------------------------------- 格式 */

export const IconFileText = (p: IconProps): ReactNode => (
  <Svg {...p}>
    <path d="M14 3H7.5A1.5 1.5 0 0 0 6 4.5v15A1.5 1.5 0 0 0 7.5 21h9a1.5 1.5 0 0 0 1.5-1.5V7z" />
    <path d="M14 3v4.5h4.5" />
    <path d="M9 12.5h6M9 16h4" />
  </Svg>
)

export const IconFilePdf = (p: IconProps): ReactNode => (
  <Svg {...p}>
    <path d="M14 3H7.5A1.5 1.5 0 0 0 6 4.5v15A1.5 1.5 0 0 0 7.5 21h9a1.5 1.5 0 0 0 1.5-1.5V7z" />
    <path d="M14 3v4.5h4.5" />
    <path d="M8.8 17.5v-4.2h1.3a1.3 1.3 0 0 1 0 2.6H8.8" />
    <path d="M13.4 13.3h1.1a1.6 1.6 0 0 1 1.6 1.6v.9a1.6 1.6 0 0 1-1.6 1.6h-1.1z" />
  </Svg>
)

export const IconFileMarkdown = (p: IconProps): ReactNode => (
  <Svg {...p}>
    <path d="M14 3H7.5A1.5 1.5 0 0 0 6 4.5v15A1.5 1.5 0 0 0 7.5 21h9a1.5 1.5 0 0 0 1.5-1.5V7z" />
    <path d="M14 3v4.5h4.5" />
    <path d="M8.6 17v-4.2l1.6 2 1.6-2V17" />
    <path d="M14.4 12.8V17h1.5" />
  </Svg>
)

export const IconFileWord = (p: IconProps): ReactNode => (
  <Svg {...p}>
    <path d="M14 3H7.5A1.5 1.5 0 0 0 6 4.5v15A1.5 1.5 0 0 0 7.5 21h9a1.5 1.5 0 0 0 1.5-1.5V7z" />
    <path d="M14 3v4.5h4.5" />
    <path d="M8.6 12.8l1 4.2 1.2-3 1.2 3 1-4.2" />
  </Svg>
)

export const IconImage = (p: IconProps): ReactNode => (
  <Svg {...p}>
    <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
    <circle cx="9" cy="10" r="1.6" />
    <path d="M4 17l4.6-4.2a1.6 1.6 0 0 1 2.1 0L16 17" />
    <path d="M14.5 15.2l1.6-1.4a1.6 1.6 0 0 1 2.1 0l1.8 1.6" />
  </Svg>
)

export const IconGlobe = (p: IconProps): ReactNode => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M3.5 12h17" />
    <path d="M12 3.5c2.2 2.4 3.3 5.3 3.3 8.5S14.2 18.1 12 20.5c-2.2-2.4-3.3-5.3-3.3-8.5S9.8 5.9 12 3.5z" />
  </Svg>
)

/* ------------------------------------------------------------ 编辑器工具栏 */

export const IconBold = (p: IconProps): ReactNode => (
  <Svg {...p}>
    <path d="M7 4.5h5.6a3.5 3.5 0 0 1 0 7H7z" />
    <path d="M7 11.5h6.4a4 4 0 0 1 0 8H7z" />
  </Svg>
)

export const IconItalic = (p: IconProps): ReactNode => (
  <Svg {...p}>
    <path d="M15 4.5h-5M14 19.5H9M13.6 4.5L10.4 19.5" />
  </Svg>
)

export const IconStrike = (p: IconProps): ReactNode => (
  <Svg {...p}>
    <path d="M4.5 12h15" />
    <path d="M16.5 7.2C15.8 5.9 14.2 5 12 5c-2.6 0-4.3 1.3-4.3 3.1 0 1 .5 1.8 1.5 2.4" />
    <path d="M7.8 16.4c.7 1.5 2.3 2.5 4.6 2.5 2.7 0 4.4-1.3 4.4-3.2 0-1-.5-1.9-1.6-2.5" />
  </Svg>
)

export const IconHeading = (p: IconProps): ReactNode => (
  <Svg {...p}>
    <path d="M6 5v14M18 5v14M6 12h12" />
  </Svg>
)

export const IconListBullet = (p: IconProps): ReactNode => (
  <Svg {...p}>
    <path d="M9 6.5h11M9 12h11M9 17.5h11" />
    <circle cx="4.7" cy="6.5" r="1.2" />
    <circle cx="4.7" cy="12" r="1.2" />
    <circle cx="4.7" cy="17.5" r="1.2" />
  </Svg>
)

export const IconListOrdered = (p: IconProps): ReactNode => (
  <Svg {...p}>
    <path d="M9.5 6.5h10.5M9.5 12h10.5M9.5 17.5h10.5" />
    <path d="M4 5.5h1.3V9" />
    <path d="M3.7 12.2c0-.7.6-1.2 1.3-1.2s1.3.5 1.3 1.1c0 1.1-2.6 1.4-2.6 2.9h2.7" />
    <path d="M3.8 16.4h2.4l-1.5 1.7c.9 0 1.5.5 1.5 1.2s-.6 1.2-1.4 1.2c-.6 0-1.1-.2-1.4-.6" />
  </Svg>
)

export const IconQuote = (p: IconProps): ReactNode => (
  <Svg {...p}>
    <path d="M9.5 6.5C7 7.4 5.5 9.6 5.5 12.6v4.9h5v-5h-3" />
    <path d="M19 6.5c-2.5.9-4 3.1-4 6.1v4.9h5v-5h-3" />
  </Svg>
)

/** 复制：两张叠起来的纸 */
export const IconCopy = (p: IconProps): ReactNode => (
  <Svg {...p}>
    <rect x="9" y="9" width="10" height="11" rx="2" />
    <path d="M15 6.5A1.5 1.5 0 0 0 13.5 5h-8A1.5 1.5 0 0 0 4 6.5v9A1.5 1.5 0 0 0 5.5 17" />
  </Svg>
)

export const IconCode = (p: IconProps): ReactNode => (
  <Svg {...p}>
    <path d="M9 7.5L4.5 12 9 16.5M15 7.5L19.5 12 15 16.5" />
  </Svg>
)

export const IconLink = (p: IconProps): ReactNode => (
  <Svg {...p}>
    <path d="M10.5 13.5a4 4 0 0 0 5.7 0l2.6-2.6a4 4 0 0 0-5.7-5.7l-1 1" />
    <path d="M13.5 10.5a4 4 0 0 0-5.7 0l-2.6 2.6a4 4 0 0 0 5.7 5.7l1-1" />
  </Svg>
)

export const IconTable = (p: IconProps): ReactNode => (
  <Svg {...p}>
    <rect x="3.5" y="5" width="17" height="14" rx="1.8" />
    <path d="M3.5 10h17M3.5 14.5h17M9.5 5v14M15 5v14" />
  </Svg>
)

export const IconDivider = (p: IconProps): ReactNode => (
  <Svg {...p}>
    <path d="M4 12h16" />
    <path d="M7 7.5h10M7 16.5h10" opacity="0.45" />
  </Svg>
)

export const IconChecklist = (p: IconProps): ReactNode => (
  <Svg {...p}>
    <path d="M4 7.2l1.6 1.6L8.5 5.9M4 16.2l1.6 1.6 2.9-2.9" />
    <path d="M11.5 7h9M11.5 17h9" />
  </Svg>
)

export const IconUndo = (p: IconProps): ReactNode => (
  <Svg {...p}>
    <path d="M4 10h9.5a5 5 0 0 1 0 10H9" />
    <path d="M7.5 6.5L4 10l3.5 3.5" />
  </Svg>
)

export const IconRedo = (p: IconProps): ReactNode => (
  <Svg {...p}>
    <path d="M20 10h-9.5a5 5 0 0 0 0 10H15" />
    <path d="M16.5 6.5L20 10l-3.5 3.5" />
  </Svg>
)

export const IconSave = (p: IconProps): ReactNode => (
  <Svg {...p}>
    <path d="M5 5.5A1.5 1.5 0 0 1 6.5 4h9L20 8.5v10a1.5 1.5 0 0 1-1.5 1.5h-12A1.5 1.5 0 0 1 5 18.5z" />
    <path d="M8.5 4v5h6V4" />
    <path d="M8 20v-5.5h8V20" />
  </Svg>
)

export const IconEye = (p: IconProps): ReactNode => (
  <Svg {...p}>
    <path d="M2.8 12S6.5 5.8 12 5.8 21.2 12 21.2 12 17.5 18.2 12 18.2 2.8 12 2.8 12z" />
    <circle cx="12" cy="12" r="2.9" />
  </Svg>
)

export const IconEyeOff = (p: IconProps): ReactNode => (
  <Svg {...p}>
    <path d="M4 4l16 16" />
    <path d="M9.6 6.3A8.8 8.8 0 0 1 12 6c5.5 0 9.2 6 9.2 6a17 17 0 0 1-3 3.6" />
    <path d="M6.4 8.2A17 17 0 0 0 2.8 12s3.7 6 9.2 6a8.7 8.7 0 0 0 3.3-.6" />
    <path d="M10.3 10.5a2.6 2.6 0 0 0 3.4 3.4" />
  </Svg>
)

export const IconSplit = (p: IconProps): ReactNode => (
  <Svg {...p}>
    <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
    <path d="M12 4.5v15" />
  </Svg>
)

export const IconEdit = (p: IconProps): ReactNode => (
  <Svg {...p}>
    <path d="M16.4 4.6l3 3L9 18l-4 1 1-4z" />
    <path d="M14.6 6.4l3 3" />
  </Svg>
)

/* ----------------------------------------------------------------- PDF */

export const IconBookmark = (p: IconProps): ReactNode => (
  <Svg {...p}>
    <path d="M6.5 4.5h11a1 1 0 0 1 1 1V20l-6.5-4.2L5.5 20V5.5a1 1 0 0 1 1-1z" />
  </Svg>
)

export const IconBookmarkFilled = (p: IconProps): ReactNode => (
  <Svg {...p} fill="currentColor">
    <path d="M6.5 4.5h11a1 1 0 0 1 1 1V20l-6.5-4.2L5.5 20V5.5a1 1 0 0 1 1-1z" />
  </Svg>
)

export const IconPen = (p: IconProps): ReactNode => (
  <Svg {...p}>
    <path d="M4 20l1-4 9.5-9.5a2.1 2.1 0 0 1 3 3L8 19z" />
    <path d="M13.5 7.5l3 3" />
    <path d="M4 20h5" />
  </Svg>
)

export const IconHighlighter = (p: IconProps): ReactNode => (
  <Svg {...p}>
    <path d="M8 14.5L4.5 18l1.5 1.5L9.5 16" />
    <path d="M8.5 13.5l6.8-6.8a2 2 0 0 1 2.8 0l1.2 1.2a2 2 0 0 1 0 2.8L12.5 17.5z" />
    <path d="M4 21h16" />
  </Svg>
)

export const IconEraser = (p: IconProps): ReactNode => (
  <Svg {...p}>
    <path d="M9 19.5H20" />
    <path d="M4.6 15.4l6-6a1.8 1.8 0 0 1 2.5 0l4.5 4.5a1.8 1.8 0 0 1 0 2.5l-3 3H8.6l-4-4a1.8 1.8 0 0 1 0-2.5z" />
    <path d="M10 10l6.5 6.5" />
  </Svg>
)

export const IconLine = (p: IconProps): ReactNode => (
  <Svg {...p}>
    <path d="M5 19L19 5" />
    <circle cx="5" cy="19" r="1.5" />
    <circle cx="19" cy="5" r="1.5" />
  </Svg>
)

export const IconArrowUpRight = (p: IconProps): ReactNode => (  <Svg {...p}>
    <path d="M6 18L18 6" />
    <path d="M10 6h8v8" />
  </Svg>
)

export const IconSquare = (p: IconProps): ReactNode => (
  <Svg {...p}>
    <rect x="4.5" y="4.5" width="15" height="15" rx="2" />
  </Svg>
)

export const IconCircle = (p: IconProps): ReactNode => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="7.8" />
  </Svg>
)

export const IconTextCursor = (p: IconProps): ReactNode => (
  <Svg {...p}>
    <path d="M5 6.5V5h14v1.5" />
    <path d="M12 5v14" />
    <path d="M9 19h6" />
  </Svg>
)

export const IconZoomIn = (p: IconProps): ReactNode => (
  <Svg {...p}>
    <circle cx="10.8" cy="10.8" r="6.3" />
    <path d="M15.5 15.5L20 20" />
    <path d="M10.8 8.3v5M8.3 10.8h5" />
  </Svg>
)

export const IconZoomOut = (p: IconProps): ReactNode => (
  <Svg {...p}>
    <circle cx="10.8" cy="10.8" r="6.3" />
    <path d="M15.5 15.5L20 20" />
    <path d="M8.3 10.8h5" />
  </Svg>
)

export const IconFitWidth = (p: IconProps): ReactNode => (
  <Svg {...p}>
    <path d="M3.5 12h17" />
    <path d="M7 8l-3.5 4L7 16M17 8l3.5 4-3.5 4" />
  </Svg>
)

export const IconFitPage = (p: IconProps): ReactNode => (
  <Svg {...p}>
    <rect x="4" y="4" width="16" height="16" rx="2" />
    <path d="M8.5 8.5h7v7h-7z" />
  </Svg>
)

export const IconRotate = (p: IconProps): ReactNode => (
  <Svg {...p}>
    <path d="M20 12a8 8 0 1 1-2.6-5.9" />
    <path d="M20 4v4.5h-4.5" />
  </Svg>
)

export const IconDownload = (p: IconProps): ReactNode => (
  <Svg {...p}>
    <path d="M12 4v10" />
    <path d="M8 10.5l4 4 4-4" />
    <path d="M5 19h14" />
  </Svg>
)

export const IconUpload = (p: IconProps): ReactNode => (
  <Svg {...p}>
    <path d="M12 16V6" />
    <path d="M8 9.5l4-4 4 4" />
    <path d="M5 19h14" />
  </Svg>
)

export const IconImport = (p: IconProps): ReactNode => (
  <Svg {...p}>
    <path d="M4 15v3.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V15" />
    <path d="M12 4v9" />
    <path d="M8 9.5l4 4 4-4" />
  </Svg>
)

export const IconImageExtract = (p: IconProps): ReactNode => (
  <Svg {...p}>
    <rect x="3.5" y="4.5" width="12" height="11" rx="1.8" />
    <path d="M4.5 13l3.2-2.8a1.3 1.3 0 0 1 1.7 0l2.6 2.4" />
    <circle cx="8" cy="8.6" r="1.2" />
    <path d="M18 14v5.5M15.5 17L18 19.5 20.5 17" />
  </Svg>
)

export const IconPrint = (p: IconProps): ReactNode => (
  <Svg {...p}>
    <path d="M7 9V4.5h10V9" />
    <rect x="4" y="9" width="16" height="7" rx="1.6" />
    <path d="M7 16h10v3.5H7z" />
  </Svg>
)

export const IconSearch = (p: IconProps): ReactNode => (
  <Svg {...p}>
    <circle cx="10.8" cy="10.8" r="6.3" />
    <path d="M15.5 15.5L20 20" />
  </Svg>
)

export const IconGrid = (p: IconProps): ReactNode => (
  <Svg {...p}>
    <rect x="4" y="4" width="7" height="7" rx="1.4" />
    <rect x="13" y="4" width="7" height="7" rx="1.4" />
    <rect x="4" y="13" width="7" height="7" rx="1.4" />
    <rect x="13" y="13" width="7" height="7" rx="1.4" />
  </Svg>
)

export const IconList = (p: IconProps): ReactNode => (
  <Svg {...p}>
    <path d="M4 6.5h16M4 12h16M4 17.5h16" />
  </Svg>
)

/* -------------------------------------------------------------- 通用 */

export const IconPlus = (p: IconProps): ReactNode => (
  <Svg {...p}>
    <path d="M12 5v14M5 12h14" />
  </Svg>
)

export const IconMinus = (p: IconProps): ReactNode => (
  <Svg {...p}>
    <path d="M5 12h14" />
  </Svg>
)

export const IconCheck = (p: IconProps): ReactNode => (
  <Svg {...p}>
    <path d="M5 12.5l4.5 4.5L19 7" />
  </Svg>
)

export const IconTrash = (p: IconProps): ReactNode => (
  <Svg {...p}>
    <path d="M4.5 7h15" />
    <path d="M9.5 7V4.8h5V7" />
    <path d="M6.5 7l.9 12.1A1.4 1.4 0 0 0 8.8 20.4h6.4a1.4 1.4 0 0 0 1.4-1.3L17.5 7" />
    <path d="M10.5 11v5.5M13.5 11v5.5" />
  </Svg>
)

export const IconFolder = (p: IconProps): ReactNode => (
  <Svg {...p}>
    <path d="M3.5 6.5A1.5 1.5 0 0 1 5 5h3.6a1.5 1.5 0 0 1 1.2.6l1 1.4H19a1.5 1.5 0 0 1 1.5 1.5v8.5A1.5 1.5 0 0 1 19 19H5a1.5 1.5 0 0 1-1.5-1.5z" />
  </Svg>
)

export const IconFolderOpen = (p: IconProps): ReactNode => (
  <Svg {...p}>
    <path d="M3.5 6.5A1.5 1.5 0 0 1 5 5h3.6a1.5 1.5 0 0 1 1.2.6l1 1.4H19a1.5 1.5 0 0 1 1.5 1.5v1H6.4a1.5 1.5 0 0 0-1.4 1l-1.5 4z" />
    <path d="M3.5 15.5a1.5 1.5 0 0 0 1.5 3.5h12a1.5 1.5 0 0 0 1.4-1z" />
  </Svg>
)

export const IconSettings = (p: IconProps): ReactNode => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="2.8" />
    <path d="M12 3.5l1 2.2 2.4-.5 1.2 2.1 2.2 1-.5 2.4 1.5 1.8-1.5 1.8.5 2.4-2.2 1-1.2 2.1-2.4-.5-1 2.2-1-2.2-2.4.5-1.2-2.1-2.2-1 .5-2.4L3.2 12l1.5-1.8-.5-2.4 2.2-1 1.2-2.1 2.4.5z" />
  </Svg>
)

export const IconPalette = (p: IconProps): ReactNode => (
  <Svg {...p}>
    <path d="M12 3.5a8.5 8.5 0 0 0 0 17c1.4 0 2-.9 2-1.8 0-1.6-1.4-1.7-1.4-3 0-1 .8-1.7 1.9-1.7h1.6a4.4 4.4 0 0 0 4.4-4.4c0-3.4-3.7-6.1-8.5-6.1z" />
    <circle cx="8" cy="10" r="1.1" />
    <circle cx="12" cy="7.6" r="1.1" />
    <circle cx="16" cy="10" r="1.1" />
  </Svg>
)

export const IconInfo = (p: IconProps): ReactNode => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 11v5.5" />
    <circle cx="12" cy="8" r="0.9" fill="currentColor" />
  </Svg>
)

export const IconRefresh = (p: IconProps): ReactNode => (
  <Svg {...p}>
    <path d="M20 12a8 8 0 1 1-2.6-5.9" />
    <path d="M20 4v4.5h-4.5" />
  </Svg>
)

export const IconExternalLink = (p: IconProps): ReactNode => (
  <Svg {...p}>
    <path d="M13.5 5H19v5.5" />
    <path d="M19 5l-7.5 7.5" />
    <path d="M17 14v4.5A1.5 1.5 0 0 1 15.5 20H5.5A1.5 1.5 0 0 1 4 18.5V8.5A1.5 1.5 0 0 1 5.5 7H10" />
  </Svg>
)

export const IconSun = (p: IconProps): ReactNode => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2.5v2.2M12 19.3v2.2M4.2 4.2l1.6 1.6M18.2 18.2l1.6 1.6M2.5 12h2.2M19.3 12h2.2M4.2 19.8l1.6-1.6M18.2 5.8l1.6-1.6" />
  </Svg>
)

export const IconMoon = (p: IconProps): ReactNode => (
  <Svg {...p}>
    <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z" />
  </Svg>
)

export const IconLamp = (p: IconProps): ReactNode => (
  <Svg {...p}>
    <path d="M8.5 4.5h7l2.5 6h-12z" />
    <path d="M12 10.5V18" />
    <path d="M8.5 20.5h7" />
    <path d="M9.5 18h5" />
  </Svg>
)

export const IconLeaf = (p: IconProps): ReactNode => (
  <Svg {...p}>
    <path d="M5 19c0-8 5-13 14-13 0 9-5 13-11 13-1.7 0-3-.7-3-3z" />
    <path d="M5.5 18.5C9 15 12.5 12.5 17 11" />
  </Svg>
)

export const IconWand = (p: IconProps): ReactNode => (
  <Svg {...p}>
    <path d="M5 19L15.5 8.5" />
    <path d="M14 7l3 3" />
    <path d="M18 3.5v3M16.5 5h3M9 3.5v2M8 4.5h2M19 12.5v2M18 13.5h2" />
  </Svg>
)

export const IconLock = (p: IconProps): ReactNode => (
  <Svg {...p}>
    <rect x="5" y="10.5" width="14" height="9.5" rx="2" />
    <path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" />
  </Svg>
)

export const IconColumns = (p: IconProps): ReactNode => (
  <Svg {...p}>
    <rect x="4" y="4.5" width="16" height="15" rx="2" />
    <path d="M12 4.5v15" />
    <path d="M4 9.5h16" />
  </Svg>
)

export const IconClock = (p: IconProps): ReactNode => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.5V12l3 2" />
  </Svg>
)

export const IconCalendar = (p: IconProps): ReactNode => (
  <Svg {...p}>
    <rect x="4" y="5.5" width="16" height="14.5" rx="2" />
    <path d="M4 10h16M9 4v3M15 4v3" />
  </Svg>
)

export const IconHash = (p: IconProps): ReactNode => (
  <Svg {...p}>
    <path d="M9.5 4.5L7.5 19.5M16.5 4.5L14.5 19.5M4.5 9h15M3.5 15h15" />
  </Svg>
)

export const IconInbox = (p: IconProps): ReactNode => (
  <Svg {...p}>
    <path d="M4 13.5L6.3 5.8A1.5 1.5 0 0 1 7.7 4.7h8.6a1.5 1.5 0 0 1 1.4 1.1L20 13.5v4.8a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18.3z" />
    <path d="M4 13.5h4l1 2.5h6l1-2.5h4" />
  </Svg>
)

export const IconFilter = (p: IconProps): ReactNode => (
  <Svg {...p}>
    <path d="M4 5.5h16l-6.2 7.3v5.4l-3.6 1.8v-7.2z" />
  </Svg>
)

export const IconSortAsc = (p: IconProps): ReactNode => (
  <Svg {...p}>
    <path d="M7 19.5V5" />
    <path d="M3.6 8.4L7 5l3.4 3.4" />
    <path d="M13 7h7M13 12h5.5M13 17h4" />
  </Svg>
)

export const IconSortDesc = (p: IconProps): ReactNode => (
  <Svg {...p}>
    <path d="M7 4.5V19" />
    <path d="M3.6 15.6L7 19l3.4-3.4" />
    <path d="M13 7h7M13 12h5.5M13 17h4" />
  </Svg>
)

export const IconGripVertical = (p: IconProps): ReactNode => (
  <Svg {...p}>
    <circle cx="9" cy="6" r="1.3" fill="currentColor" />
    <circle cx="15" cy="6" r="1.3" fill="currentColor" />
    <circle cx="9" cy="12" r="1.3" fill="currentColor" />
    <circle cx="15" cy="12" r="1.3" fill="currentColor" />
    <circle cx="9" cy="18" r="1.3" fill="currentColor" />
    <circle cx="15" cy="18" r="1.3" fill="currentColor" />
  </Svg>
)

export const IconBookFace = (p: IconProps): ReactNode => (
  <Svg {...p}>
    <rect x="4.5" y="4" width="15" height="16" rx="1.6" />
    <path d="M8 8.5h8M8 12h5" />
    <path d="M17.5 4v16" opacity="0.5" />
  </Svg>
)

export const IconBookAngle = (p: IconProps): ReactNode => (
  <Svg {...p}>
    <path d="M6 19.5h13" />
    <path d="M6 19.5V5.5" />
    <path d="M6 5.5l8.5 6" />
    <path d="M14.5 11.5l2 3" />
    <path d="M14 19.5a8 8 0 0 0 1.6-4.8" />
  </Svg>
)

export const IconRows = (p: IconProps): ReactNode => (
  <Svg {...p}>
    <rect x="4" y="4.5" width="16" height="6" rx="1.4" />
    <rect x="4" y="13.5" width="16" height="6" rx="1.4" />
  </Svg>
)

export const IconFilePlus = (p: IconProps): ReactNode => (
  <Svg {...p}>
    <path d="M13.5 3.5H7A1.5 1.5 0 0 0 5.5 5v14A1.5 1.5 0 0 0 7 20.5h10a1.5 1.5 0 0 0 1.5-1.5V8.5z" />
    <path d="M13.5 3.5v5h5" />
    <path d="M12 12v5M9.5 14.5h5" />
  </Svg>
)

/* --------------------------------------------------------- 分级标题 */
/* 一二三级标题以前共用同一个 H 图标，工具栏上根本分不出点哪个。
   现在统一是「H + 级别数字」，级别一眼可辨。 */

export const IconHeading1 = (p: IconProps): ReactNode => (
  <Svg {...p}>
    <path d="M3.5 6v12M10.5 6v12M3.5 12h7" />
    <path d="M16.5 10l2.2-1.6V18" />
  </Svg>
)

export const IconHeading2 = (p: IconProps): ReactNode => (
  <Svg {...p}>
    <path d="M3.5 6v12M10.5 6v12M3.5 12h7" />
    <path d="M15.4 10.2a2.1 2.1 0 0 1 3.9 1.2c0 1.5-3.9 3.1-3.9 6.6h4.1" />
  </Svg>
)

export const IconHeading3 = (p: IconProps): ReactNode => (
  <Svg {...p}>
    <path d="M3.5 6v12M10.5 6v12M3.5 12h7" />
    <path d="M15.2 9.8a2 2 0 0 1 3.3 1.5c0 1.3-1.3 1.9-2.2 1.9" />
    <path d="M16.3 13.2a2.1 2.1 0 1 1 2.7 3.2 2.1 2.1 0 0 1-3.6 1.2" />
  </Svg>
)

/* ------------------------------------------------------------ 代码 */

/** 行内代码：只有一对尖括号，位置在文字里 */
export const IconCodeInline = (p: IconProps): ReactNode => (
  <Svg {...p}>
    <path d="M9.5 7.5L5 12l4.5 4.5" />
    <path d="M14.5 7.5L19 12l-4.5 4.5" />
  </Svg>
)

/** 代码块：同样的尖括号，但装在一个框里 */
export const IconCodeBlock = (p: IconProps): ReactNode => (
  <Svg {...p}>
    <rect x="3" y="4.5" width="18" height="15" rx="2" />
    <path d="M10 9.5L7.5 12L10 14.5" />
    <path d="M14 9.5L16.5 12L14 14.5" />
  </Svg>
)

/** 键盘：设置页「快捷键」分页用 */
export const IconKeyboard = (p: IconProps): ReactNode => (
  <Svg {...p}>
    <rect x="2.5" y="6" width="19" height="12" rx="2.5" />
    <path d="M6 9.5h.01M9 9.5h.01M12 9.5h.01M15 9.5h.01M18 9.5h.01M6 12.5h.01M9 12.5h.01M12 12.5h.01M15 12.5h.01M18 12.5h.01M8 15.5h8" />
  </Svg>
)
export const IconPlay = (p: IconProps): ReactNode => (
  <Svg {...p}>
    <path d="M8 5.5l11 6.5-11 6.5z" />
  </Svg>
)

export const IconPause = (p: IconProps): ReactNode => (
  <Svg {...p}>
    <path d="M9 5v14M15 5v14" />
  </Svg>
)

export const IconVolume = (p: IconProps): ReactNode => (
  <Svg {...p}>
    <path d="M4 9.5h3.5L12 5.5v13L7.5 14.5H4z" />
    <path d="M16 8.5a5 5 0 010 7M18.5 6a8.5 8.5 0 010 12" />
  </Svg>
)