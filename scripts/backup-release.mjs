// 每个版本留一份带时间戳的备份。
//
// 用户明确要求"往后每个版本记得备份留痕"，理由很现实：上一版出问题时，
// 我手里只有"当前源码"，没法回答"上一版到底长什么样"。
//
// 备份的是**源码 + 安装包 + 一个清单**，放在 backups/<版本>/ 下。
// 源码只备 src/、scripts/ 与几个配置文件 —— node_modules 与 out/ 是产物，没必要。
//
//   node scripts/backup-release.mjs            按 package.json 的版本备份
//   node scripts/backup-release.mjs --note "…" 附一句这次改了什么
//   node scripts/backup-release.mjs --note-from-file note.txt
//
// 注意（Windows）：命令行里的中文会经过控制台代码页，容易被转成乱码。
// 要写中文备注就用 --note-from-file，文件按 UTF-8 存。
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const version = pkg.version

const noteIndex = process.argv.indexOf('--note')
const noteFileIndex = process.argv.indexOf('--note-from-file')
const note =
  noteFileIndex >= 0
    ? readFileSync(process.argv[noteFileIndex + 1] ?? '', 'utf8').trim()
    : noteIndex >= 0
      ? (process.argv[noteIndex + 1] ?? '')
      : ''

const dest = join(root, 'backups', version)
mkdirSync(dest, { recursive: true })

/* ---------------------------------------------------------------- 源码 */

const SOURCE_DIRS = ['src', 'scripts']
const SOURCE_FILES = [
  'package.json',
  'electron.vite.config.ts',
  'electron-builder.yml',
  'tsconfig.json',
  'tsconfig.node.json',
  'tsconfig.web.json',
  'pnpm-workspace.yaml',
  '.npmrc',
  'README.md'
]

let files = 0
for (const dir of SOURCE_DIRS) {
  const from = join(root, dir)
  if (!existsSync(from)) continue
  cpSync(from, join(dest, dir), { recursive: true })
  files += countFiles(from)
}
for (const file of SOURCE_FILES) {
  const from = join(root, file)
  if (!existsSync(from)) continue
  cpSync(from, join(dest, file))
  files += 1
}

/* ------------------------------------------------------------ 安装包 */

const artifacts = []
const releaseDir = join(root, 'release')
if (existsSync(releaseDir)) {
  mkdirSync(join(dest, 'release'), { recursive: true })
  for (const name of readdirSync(releaseDir)) {
    if (!/\.(exe|zip|blockmap|yml)$/.test(name)) continue
    if (!name.includes(version)) continue
    cpSync(join(releaseDir, name), join(dest, 'release', name))
    artifacts.push({ name, bytes: statSync(join(releaseDir, name)).size })
  }
}

/* ---------------------------------------------------------------- 清单 */

const manifest = {
  version,
  backedUpAt: new Date().toISOString(),
  note,
  sourceFiles: files,
  artifacts,
  appVersionInCode: /APP_VERSION = '([^']+)'/.exec(
    readFileSync(join(root, 'src/shared/types.ts'), 'utf8')
  )?.[1],
  node: process.version
}
writeFileSync(join(dest, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')

console.log(`已备份 ${version} → ${relative(root, dest)}`)
console.log(`  源码 ${files} 个文件`)
console.log(`  安装包 ${artifacts.length} 个${artifacts.length ? `（${artifacts.map((a) => a.name).join(', ')}）` : '（release/ 里还没有这一版的包）'}`)
if (manifest.appVersionInCode !== version) {
  console.warn(`  注意：代码里的 APP_VERSION 是 ${manifest.appVersionInCode}，与 package.json 的 ${version} 不一致`)
}

function countFiles(dir) {
  let n = 0
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) n += countFiles(join(dir, entry.name))
    else n += 1
  }
  return n
}
