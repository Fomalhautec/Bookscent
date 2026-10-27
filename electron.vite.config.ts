import { builtinModules } from 'node:module'
import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

/**
 * 主进程 / 预加载脚本显式外部化的模块。
 * electron-vite 自己也会加，这里再写一遍是为了让「electron 绝不能被打进 bundle」
 * 这件事在配置里一眼可见（打进去的话 app / BrowserWindow 会变成 undefined）。
 */
const NODE_EXTERNAL: (string | RegExp)[] = [
  'electron',
  /^electron\/.+/,
  ...builtinModules.flatMap((name) => [name, `node:${name}`])
]

/** 主进程与预加载统一编译成 CommonJS：__dirname 可用，Electron 支持面最广 */
const cjsOutput = {
  format: 'cjs' as const,
  entryFileNames: '[name].js',
  chunkFileNames: 'chunks/[name]-[hash].js',
  assetFileNames: 'chunks/[name]-[hash].[ext]'
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: { '@shared': resolve(__dirname, 'src/shared') }
    },
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/main/index.ts') },
        external: NODE_EXTERNAL,
        output: cjsOutput
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: { '@shared': resolve(__dirname, 'src/shared') }
    },
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/preload/index.ts') },
        external: NODE_EXTERNAL,
        output: cjsOutput
      }
    }
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src/renderer/src'),
        '@shared': resolve(__dirname, 'src/shared')
      }
    },
    plugins: [react()],
    worker: { format: 'es' },
    build: {
      chunkSizeWarningLimit: 6000,
      rollupOptions: { input: { index: resolve(__dirname, 'src/renderer/index.html') } }
    }
  }
})
