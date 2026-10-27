/// <reference types="vite/client" />

import type { BookscentApi } from '@shared/ipc'

declare global {
  interface Window {
    bookscent: BookscentApi
  }
}

declare module '*.png' {
  const src: string
  export default src
}

declare module '*.svg' {
  const src: string
  export default src
}
