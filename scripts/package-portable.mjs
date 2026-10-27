// 便携版打包：用 @electron/packager 生成 release/Bookscent-win32-x64 目录，
// 不依赖 electron-builder 去 GitHub 拉 NSIS / winCodeSign，离线也能出包。
import { packager } from '@electron/packager'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))

const paths = await packager({
  dir: root,
  out: join(root, 'release'),
  overwrite: true,
  platform: 'win32',
  arch: 'x64',
  name: 'Bookscent',
  appVersion: pkg.version,
  executableName: 'Bookscent',
  appCopyright: 'Copyright © 2026 Bookscent',
  icon: join(root, 'build', 'icon.ico'),
  prune: true,
  asar: true,
  ignore: [
    /^\/src($|\/)/,
    /^\/scripts($|\/)/,
    /^\/release($|\/)/,
    /^\/shots($|\/)/,
    /^\/out\/(?!main|preload|renderer)/,
    /^\/\.vite($|\/)/,
    /^\/\.gitignore$/,
    /^\/.*\.log$/,
    /^\/electron\.vite\.config\.ts$/,
    /^\/tsconfig.*\.json$/,
    /^\/electron-builder\.yml$/,
    /^\/pnpm-workspace\.yaml$/,
    /^\/\.npmrc$/,
    /^\/README\.md$/
  ],
  win32metadata: {
    CompanyName: 'Bookscent',
    FileDescription: '书香笔记 Bookscent',
    ProductName: '书香笔记 Bookscent',
    InternalName: 'Bookscent'
  }
})

console.log('portable build ->')
for (const p of paths) console.log('  ' + p)
