/**
 * 批注工具条专用图标。
 *
 * 共享图标集（components/icons/Icons.tsx）里没有「下划线」和「手型」，
 * 而硬约束要求不在 features/pdf 之外改动文件，所以这两个图标放这里，
 * 保持与共享图标一致的 24×24 网格、1.75 描边、圆头圆角。
 */

import type { ReactNode, SVGProps } from 'react'

interface LocalIconProps extends Omit<SVGProps<SVGSVGElement>, 'children'> {
  size?: number
}

function Svg({ size = 18, children, ...rest }: LocalIconProps & { children: ReactNode }): ReactNode {
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

export const IconUnderline = (props: LocalIconProps): ReactNode => (
  <Svg {...props}>
    <path d="M7 4.5v6.2a5 5 0 0 0 10 0V4.5" />
    <path d="M5 20h14" />
  </Svg>
)

export const IconHand = (props: LocalIconProps): ReactNode => (
  <Svg {...props}>
    <path d="M8.6 11.4V5.8a1.4 1.4 0 0 1 2.8 0v4.6" />
    <path d="M11.4 10.4V4.6a1.4 1.4 0 0 1 2.8 0v5.8" />
    <path d="M14.2 10.6V6.4a1.4 1.4 0 0 1 2.8 0v7.4" />
    <path d="M17 9.8a1.4 1.4 0 0 1 2.8 0v3.4c0 4-2.6 6.6-6.4 6.6s-6-2-7.2-4.6L5 12.6a1.4 1.4 0 0 1 2.4-1.4l1.2 1.9" />
  </Svg>
)
