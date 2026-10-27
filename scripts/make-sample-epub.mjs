// 生成一本用来验证 EPUB 阅读器的示例书。
//
// 刻意做得"有辨识度"：自带一套鲜明的 CSS（如果阅读器没加载书籍样式，
// 一眼就能看出来）、嵌套目录、一张内嵌图片、以及一段长到必须分栏的正文。
//
//   node scripts/make-sample-epub.mjs [输出路径]
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { deflateSync } from 'node:zlib'
import { zipSync, strToU8 } from 'fflate'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const target = process.argv[2] ?? join(root, 'samples', '示例电子书.epub')

const TITLE = '示例电子书 · The Shape of a Shelf'

const css = `
body {
  font-family: "Songti SC", SimSun, Georgia, serif;
  line-height: 1.9;
  color: #2b2318;
  background: #fbf7ef;
  padding: 24px 8%;
}
h1 {
  font-size: 1.6em;
  color: #8a4b3a;
  border-bottom: 3px double #c2a878;
  padding-bottom: 8px;
}
h2 { font-size: 1.25em; color: #6b4a2b; }
p.first::first-letter { font-size: 2.6em; float: left; line-height: 0.9; padding-right: 6px; color: #8a4b3a; }
blockquote {
  margin: 16px 0;
  padding: 10px 16px;
  border-left: 4px solid #c2a878;
  background: #f3ead8;
  color: #5b5040;
  font-style: italic;
}
.note {
  margin: 14px 0;
  padding: 10px 14px;
  border: 1px dashed #b8a686;
  border-radius: 6px;
  background: #fffdf8;
  font-size: 0.94em;
}
figure { margin: 18px 0; text-align: center; }
figure img { max-width: 62%; }
figcaption { font-size: 0.86em; color: #8b7f6b; margin-top: 6px; }
`

function chapter(num, heading, extra, headExtra) {
  const filler = Array.from({ length: 14 }, (_, i) => {
    return `<p>这是第 ${num} 节的第 ${i + 1} 段正文。它存在的意义是把这一节撑长，好让左右翻页模式真的需要分栏——如果一节只有两三行，分栏翻页根本看不出效果。书架上的每一本书，都是你读过或写下的一页。</p>`
  }).join('\n')
  return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="zh-CN">
<head>
  <title>${heading}</title>
  <link rel="stylesheet" type="text/css" href="style.css" />
  ${headExtra ?? ''}
</head>
<body>
  <h1>${heading}</h1>
  ${extra ?? ''}
  <p class="first">${'『' + heading + '』'}这一节用来验证 epub 自带的 CSS 有没有生效：标题应当是砖红色并带双线，首字下沉，引用块有米色底。</p>
  ${filler}
  <blockquote>一本书就是一个房间。你不一定每天都进去，但知道它在，心里就安稳。</blockquote>
  ${filler}
  <div class="note">提示：如果这段没有虚线边框和浅色底，说明书籍自带的样式表没有被加载。</div>
</body>
</html>`
}

const nav = `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="zh-CN">
<head><title>目录</title><link rel="stylesheet" type="text/css" href="style.css" /></head>
<body>
  <nav epub:type="toc" id="toc">
    <h1>目录</h1>
    <ol>
      <li><a href="ch1.xhtml">第一章 · 书架的形状</a>
        <ol>
          <li><a href="ch1.xhtml#why">为什么是书架</a></li>
        </ol>
      </li>
      <li><a href="ch2.xhtml">第二章 · 书脊的厚薄</a></li>
      <li><a href="ch3.xhtml">第三章 · 灯光与木色</a></li>
      <li><a href="ch4.xhtml">第四章 · 竖排的书</a></li>
    </ol>
  </nav>
</body>
</html>`

const opf = `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid" xml:lang="zh-CN">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">urn:uuid:bookscent-sample-epub-0001</dc:identifier>
    <dc:title>${TITLE}</dc:title>
    <dc:creator>Bookscent</dc:creator>
    <dc:language>zh-CN</dc:language>
    <meta property="dcterms:modified">2026-01-01T00:00:00Z</meta>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav" />
    <item id="css" href="style.css" media-type="text/css" />
    <item id="cover" href="cover.png" media-type="image/png" properties="cover-image" />
    <item id="ch1" href="ch1.xhtml" media-type="application/xhtml+xml" />
    <item id="ch2" href="ch2.xhtml" media-type="application/xhtml+xml" />
    <item id="ch3" href="ch3.xhtml" media-type="application/xhtml+xml" />
    <item id="ch4" href="ch4.xhtml" media-type="application/xhtml+xml" />
  </manifest>
  <spine>
    <itemref idref="ch1" />
    <itemref idref="ch2" />
    <itemref idref="ch3" />
    <itemref idref="ch4" />
  </spine>
</package>`

const container = `<?xml version="1.0" encoding="utf-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml" />
  </rootfiles>
</container>`

/** 一张 120×120 的纯色 PNG，只为验证图片也能按相对路径加载 */
function tinyPng() {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length)
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(body) >>> 0)
    return Buffer.concat([len, body, crc])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(120, 0)
  ihdr.writeUInt32BE(120, 4)
  ihdr[8] = 8
  ihdr[9] = 2
  const raw = Buffer.alloc(120 * (120 * 3 + 1))
  for (let y = 0; y < 120; y++) {
    const row = y * (120 * 3 + 1)
    raw[row] = 0
    for (let x = 0; x < 120; x++) {
      const at = row + 1 + x * 3
      raw[at] = 138
      raw[at + 1] = 75
      raw[at + 2] = 58
    }
  }
  const zlib = { deflateSync }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0))
  ])
}

let table = null
function crc32(buf) {
  if (!table) {
    table = new Uint32Array(256)
    for (let n = 0; n < 256; n++) {
      let c = n
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      table[n] = c
    }
  }
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return c ^ 0xffffffff
}

const figure = `<figure><img src="cover.png" alt="封面图" /><figcaption>一张内嵌 PNG，用来验证图片的相对路径</figcaption></figure>`

/*
 * 第四章是**原生竖排**：`writing-mode` 直接写在 html/body 上。
 * 为什么要在示例书里专门放一节：真实日文书的竖排往往是通过某个工具类
 * （比如 Calibre 的 `.vrtl`）设定的，而正文 body 上未必带着那个类 ——
 * 于是"看到 rtl 就当竖排"这类想当然的假设会把人带偏。
 * 有了这一节，"文档确实是竖排"的整条链路才有可测的用例。
 */
const verticalChapter = chapter(
  4,
  '第四章 · 竖排的书',
  '<p class="note">这一节的正文是竖排：文字自上而下、行从右向左。</p>',
  '<style>html, body { writing-mode: vertical-rl; text-orientation: mixed; }</style>'
)

const files = {
  mimetype: strToU8('application/epub+zip'),
  'META-INF/container.xml': strToU8(container),
  'OEBPS/content.opf': strToU8(opf),
  'OEBPS/nav.xhtml': strToU8(nav),
  'OEBPS/style.css': strToU8(css),
  'OEBPS/cover.png': new Uint8Array(tinyPng()),
  'OEBPS/ch1.xhtml': strToU8(
    chapter(1, '第一章 · 书架的形状', `<h2 id="why">为什么是书架</h2>${figure}`)
  ),
  'OEBPS/ch2.xhtml': strToU8(chapter(2, '第二章 · 书脊的厚薄')),
  'OEBPS/ch3.xhtml': strToU8(chapter(3, '第三章 · 灯光与木色')),
  'OEBPS/ch4.xhtml': strToU8(verticalChapter)
}

// mimetype 必须是 zip 的第一个条目且不压缩，否则严格校验的阅读器会拒绝
const zipped = zipSync(files, { level: 6, mtime: new Date('2026-01-01T00:00:00Z') })
mkdirSync(dirname(target), { recursive: true })
writeFileSync(target, Buffer.from(zipped))
console.log(`已生成 ${target}（${(zipped.length / 1024).toFixed(1)} KB，${Object.keys(files).length} 个条目）`)
