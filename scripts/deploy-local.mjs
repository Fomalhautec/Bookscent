// 把打包好的绿色版装到普通用户目录并运行。
//
// 为什么需要这一步：本项目所在的工作区被 DSH 沙箱打上了「低完整性级别」标签
// （icacls 里能看到 Mandatory Label\Low Mandatory Level），这个标签会继承给目录里
// 每个文件。低完整性的 Chromium 进程在 Windows 上初始化时必然 CHECK 失败
// （退出码 0x80000003），表现就是"双击后进程一闪而过"。
//
// 拷贝到普通目录时，新文件继承目标目录的 Medium 级别，于是就能正常运行。
// 所以：构建产物留在工作区没关系，运行前拷出来即可。
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const releaseDir = join(root, 'release')
const shouldLaunch = process.argv.includes('--launch')

/**
 * 装到哪儿。
 * `--dest <路径>` 可以另选一处 —— 验证脚本用它装进 Bookscent-verify，
 * 这样即使你正开着自己那份应用，也不会被覆盖掉。
 */
const destArg = process.argv.indexOf('--dest')
const dest =
  destArg >= 0 && process.argv[destArg + 1]
    ? process.argv[destArg + 1]
    : join(process.env.LOCALAPPDATA, 'Programs', 'Bookscent')

const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version
const zips = existsSync(releaseDir) ? readdirSync(releaseDir).filter((name) => name.endsWith('.zip')) : []
if (zips.length === 0) {
  console.error('release/ 下没有 .zip，请先运行：pnpm build && pnpm exec electron-builder --win zip')
  process.exit(1)
}

// 优先选中与 package.json 版本一致的包；否则退回最近生成的那个。
// （只按名字取第一个会一直装上旧版本的包，这个坑踩过一次。）
const preferred = zips.find((name) => name.includes(version))
const zip = preferred ?? zips.map((name) => ({ name, at: statSync(join(releaseDir, name)).mtimeMs })).sort((a, b) => b.at - a.at)[0].name
if (!preferred) {
  console.warn(`注意：release/ 里没有 ${version} 的包，改用最新的 ${zip}`)
  console.warn(`      现有：${zips.join(', ')}`)
}
const zipPath = join(releaseDir, zip)
console.log(`安装包 ${zip}  (${(statSync(zipPath).size / 1048576).toFixed(1)} MB)`)

/*
 * 包比最新的构建产物还旧 → 装上去的会是上一版代码。
 * 这个坑很隐蔽：`pnpm build` 只写 out/，不会重新打包 zip，
 * 于是"改了代码、部署了、验证却没有变化"。
 */
for (const built of ['out/renderer', 'out/main']) {
  const dir = join(root, built)
  if (!existsSync(dir)) continue
  let newest = 0
  const walk = (target) => {
    for (const entry of readdirSync(target, { withFileTypes: true })) {
      const full = join(target, entry.name)
      if (entry.isDirectory()) walk(full)
      else newest = Math.max(newest, statSync(full).mtimeMs)
    }
  }
  walk(dir)
  if (newest > statSync(zipPath).mtimeMs) {
    console.error(`\n✗ ${zip} 比 ${built} 还旧，装上去的还是上一版代码。`)
    console.error('  请先重新打包：pnpm exec electron-builder --win zip\n')
    process.exit(1)
  }
}

try {
  rmSync(dest, { recursive: true, force: true })
} catch (error) {
  // 别猜原因：把真实的错误码与路径报出来。
  // 这里的失败可能是文件被占用，也可能是权限或杀软锁，
  // 随口说一句"多半是应用开着"只会把人带偏。
  console.error(`清理 ${dest} 失败：${error.code ?? ''} ${error.message}`)
  console.error('目标目录没能删除，所以没有覆盖安装。可以：')
  console.error('  · 确认没有 Bookscent.exe 进程（任务管理器里搜一下）后重试')
  console.error(`  · 或者换一个目录：node scripts/deploy-local.mjs --dest "<别的目录>"`)
  process.exit(1)
}
mkdirSync(dest, { recursive: true })

const extractStartedAt = Date.now()
const unzip = spawn(
  'powershell',
  ['-NoProfile', '-Command', `Expand-Archive -LiteralPath '${zipPath}' -DestinationPath '${dest}' -Force`],
  { stdio: 'inherit' }
)
await new Promise((resolve) => unzip.on('exit', resolve))

const exe = join(dest, 'Bookscent.exe')
if (!existsSync(exe)) {
  console.error('解压后没有找到 Bookscent.exe')
  process.exit(1)
}

/*
 * 收尾自检：app.asar 是不是刚写出来的。
 *
 * 注意这里是**警告**而不是报错：如果安装包内容和已装的一模一样，
 * Expand-Archive 可能不重写文件，时间戳就不变 —— 那不是失败。
 * 真正要防的是"内容变了、目录里却还是上一版"，那一定伴随时间戳不动，
 * 所以把时间戳打出来让人一眼能看见。（也不能拿 asar 和 zip 比时间：
 * electron-builder 先写 win-unpacked 再打包 zip，asar 天生比 zip 旧。）
 */
const deployedAsar = join(dest, 'resources', 'app.asar')
if (existsSync(deployedAsar)) {
  const asarAt = statSync(deployedAsar).mtimeMs
  console.log(`  app.asar 时间 ${new Date(asarAt).toLocaleString()}`)
  if (asarAt < extractStartedAt - 5000) {
    console.warn('  注意：本次解压没有更新 app.asar（内容相同的话是正常的；')
    console.warn('        若你刚改过代码，请确认没有 Bookscent.exe 占用该目录后重试）。')
  }
}
console.log(`已安装到 ${dest}`)
console.log('（这个目录下的文件是 Medium 完整性级别，可以正常启动）')

if (shouldLaunch) {
  console.log('启动应用…')
  const child = spawn(exe, [], { stdio: 'ignore', detached: true })
  child.unref()
  await delay(1500)
  console.log(`已启动，pid=${child.pid}`)
  console.log(`启动日志：${join(process.env.APPDATA, 'bookscent', 'startup.log')}`)
}
