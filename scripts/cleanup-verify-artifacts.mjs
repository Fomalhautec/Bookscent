// 清理验证脚本误写进「用户真实书架」的测试产物。
//
// 背景：早期版本的验证脚本只隔离了 userData，没隔离藏书目录，
// 于是往共享的「文档\Bookscent 藏书」里写了测试笔记；用户那份应用一扫就全收进书架了。
// 现在两处都隔离了（见 verify-*.mjs 里的 BOOKSCENT_LIBRARY_DIR），这个脚本用来善后。
//
// 用 Node 读写，避免 PowerShell 把 UTF-8 中文弄坏。
// 用户自己建的「新笔记 …」一律不动，只删明确的测试痕迹。
import { copyFileSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'

const real = join(process.env.APPDATA, 'bookscent', 'library.json')
const dryRun = process.argv.includes('--dry')

if (!existsSync(real)) {
  console.log('没有找到真实书架：' + real)
  process.exit(0)
}

const index = JSON.parse(readFileSync(real, 'utf8'))

/** 测试留下的痕迹：填充笔记，以及从 dsh2 目录引用进来的样例 */
function testArtifactReason(book) {
  if (/^填充 \d+\.md$/.test(basename(book.path))) return '临时填充笔记'
  if (/^[dD]:\\Coding\\dsh2\\/i.test(book.path)) return '验证时导入的样例文件'
  return null
}

console.log(`真实书架：${index.books.length} 本，${index.shelves.length} 层`)
for (const book of index.books) {
  const reason = testArtifactReason(book)
  console.log(`  ${reason ? `[删] ${reason.padEnd(7)}` : '[留]         '} ${book.title}`)
}

const drop = index.books.filter((book) => testArtifactReason(book))
if (drop.length === 0) {
  console.log('\n没有需要清理的记录。')
  process.exit(0)
}

console.log(`\n将移除 ${drop.length} 条记录，并删除对应的测试文件`)
if (dryRun) {
  console.log('（--dry 模式，未写入）')
  process.exit(0)
}

for (const book of drop) {
  if (!/^填充 \d+\.md$/.test(basename(book.path))) continue
  try {
    if (existsSync(book.path)) {
      rmSync(book.path)
      console.log(`  已删除文件 ${book.path}`)
    }
  } catch (error) {
    console.log(`  删文件失败 ${book.path}：${error.message}`)
  }
}

copyFileSync(real, `${real}.bak`)
const keep = index.books.filter((book) => !testArtifactReason(book))
writeFileSync(real, JSON.stringify({ ...index, books: keep }, null, 2), 'utf8')
console.log(`\n已写入，剩 ${keep.length} 本。备份：${real}.bak`)
