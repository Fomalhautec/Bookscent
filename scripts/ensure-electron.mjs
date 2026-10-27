// electron 包的 postinstall 在部分 pnpm 版本下不会执行，导致 node_modules/electron/dist 缺失。
// 这个脚本在 pnpm install 之后补上：只检查、只安装，不做别的事。
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const electronDir = join(root, 'node_modules', 'electron')
const installer = join(electronDir, 'install.js')
const binary = join(electronDir, 'dist', process.platform === 'win32' ? 'electron.exe' : 'electron')

if (!existsSync(installer)) {
  console.log('[ensure-electron] 未找到 electron 包，跳过。')
  process.exit(0)
}

if (existsSync(binary)) {
  console.log('[ensure-electron] Electron 二进制已就绪。')
  process.exit(0)
}

console.log('[ensure-electron] 正在下载 Electron 二进制…')
process.env.ELECTRON_MIRROR ||= 'https://npmmirror.com/mirrors/electron/'
const result = spawnSync(process.execPath, [installer], {
  cwd: electronDir,
  stdio: 'inherit',
  env: process.env
})

if (result.status !== 0 || !existsSync(binary)) {
  console.error('[ensure-electron] 下载失败。可以手动执行：')
  console.error('  set ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/')
  console.error('  node node_modules/electron/install.js')
  process.exit(1)
}
console.log('[ensure-electron] 完成。')
