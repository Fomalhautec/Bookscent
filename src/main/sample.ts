import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib'

/**
 * 生成一份内容丰富的示例 PDF，用于首次启动时让书架上有真正的"厚书"可读：
 * 24 页、带章节标题、页码、目录，并在其中一页嵌入一张位图，
 * 这样 PDF 阅读器的目录、批注、页面导出与"内嵌图片提取"都有真实对象可用。
 *
 * 说明：这里只用 StandardFonts（拉丁字形），因为内置字体无法编码中文；
 * 中文 PDF 由用户自己的文件提供。
 */

const A4: [number, number] = [595.28, 841.89]
const MARGIN = 64

interface Section {
  heading: string
  paragraphs: string[]
  image?: boolean
}

const SECTIONS: Section[] = [
  {
    heading: 'I. On the Shape of a Shelf',
    paragraphs: [
      'A shelf is a promise that things will stay where you put them. It is also, quietly, a claim about proportion: how much of the world you intend to keep within reach.',
      'Books shelved by height look tidy and read badly, because height has nothing to do with argument. Books shelved by subject look argumentative and read well, because the neighbour of a book is the first commentary on it.',
      'This sample document exists so that the reader has something honest to measure: real pages, real paragraphs, a real image, and a page count that will widen its spine on the shelf.'
    ]
  },
  {
    heading: 'II. Thickness as Information',
    paragraphs: [
      'Before you open a book you already know something about it, and almost all of that knowledge is thickness. A thin spine promises an afternoon; a thick one asks for a season.',
      'An electronic library usually throws this away. Every document becomes an icon of identical size, arranged in a grid, so that a haiku and a dictionary look the same.',
      'Bookscent restores the signal. Where the format carries a page count — PDF, DOCX — the number is read directly. Where it does not, the text is measured and the estimate is reported as an estimate, never as a fact.'
    ]
  },
  {
    heading: 'III. The Marks We Leave',
    paragraphs: [
      'A used book is a record of two readers: the one who wrote it and the one who argued with it in the margins.',
      'Underlining is the cheapest form of attention. A highlighter says: this sentence survived a first reading. A pencil note in the margin says something better: this sentence did not survive a second one.',
      'Annotations in this application are stored as normalised geometry, which is a formal way of saying that a mark made at 100% zoom still lands on the same word at 400%.'
    ]
  },
  {
    heading: 'IV. Extraction and Return',
    paragraphs: [
      'Pages can be exported as images. Embedded images can be lifted out at their native resolution, which is usually far larger than anything the screen ever showed you.',
      'The reverse direction matters too: the marks you made can be flattened back into a standard PDF, so that what you thought about a document travels with the document.'
    ],
    image: true
  },
  {
    heading: 'V. Night Reading',
    paragraphs: [
      'The best argument for a dark theme is not aesthetics but the fact that reading at night happens in a room where someone else is asleep.',
      'A warm dark shelf, a gold foil spine, and a page that does not glare: these are not decorations. They are the conditions under which a book gets finished.'
    ]
  }
]

function wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = text.split(/\s+/)
  const lines: string[] = []
  let line = ''
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
      line = candidate
    } else {
      if (line) lines.push(line)
      line = word
    }
  }
  if (line) lines.push(line)
  return lines
}

export async function buildSamplePdf(iconPath: string): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  doc.setTitle('The Shape of a Shelf — a Bookscent sample')
  doc.setAuthor('Bookscent')
  doc.setSubject('Sample document')
  doc.setCreator('Bookscent 0.9.6')
  doc.setProducer('Bookscent 0.9.6')

  const serif = await doc.embedFont(StandardFonts.TimesRoman)
  const serifBold = await doc.embedFont(StandardFonts.TimesRomanBold)
  const serifItalic = await doc.embedFont(StandardFonts.TimesRomanItalic)
  const sans = await doc.embedFont(StandardFonts.Helvetica)

  const contentWidth = A4[0] - MARGIN * 2

  let image: Awaited<ReturnType<typeof doc.embedPng>> | null = null
  if (existsSync(iconPath)) {
    try {
      image = await doc.embedPng(readFileSync(iconPath))
    } catch {
      image = null
    }
  }

  const pageCount = 24
  const pages: PDFPage[] = []
  for (let i = 0; i < pageCount; i++) pages.push(doc.addPage(A4))

  const drawFooter = (page: PDFPage, index: number): void => {
    page.drawLine({
      start: { x: MARGIN, y: 62 },
      end: { x: A4[0] - MARGIN, y: 62 },
      thickness: 0.6,
      color: rgb(0.78, 0.72, 0.62)
    })
    page.drawText('The Shape of a Shelf', {
      x: MARGIN,
      y: 46,
      size: 8.5,
      font: serifItalic,
      color: rgb(0.45, 0.4, 0.34)
    })
    const label = String(index + 1)
    page.drawText(label, {
      x: A4[0] - MARGIN - sans.widthOfTextAtSize(label, 9),
      y: 46,
      size: 9,
      font: sans,
      color: rgb(0.45, 0.4, 0.34)
    })
  }

  /* ---------------------------------------------------------- 扉页 */
  const title = pages[0]
  title.drawRectangle({ x: 0, y: 0, width: A4[0], height: A4[1], color: rgb(0.976, 0.957, 0.925) })
  title.drawRectangle({ x: MARGIN, y: 250, width: contentWidth, height: 1.2, color: rgb(0.61, 0.42, 0.25) })
  const t1 = 'The Shape of a Shelf'
  title.drawText(t1, {
    x: MARGIN,
    y: 620,
    size: 30,
    font: serifBold,
    color: rgb(0.17, 0.14, 0.1)
  })
  title.drawText('Notes on reading, thickness, and the marks we leave', {
    x: MARGIN,
    y: 585,
    size: 13,
    font: serifItalic,
    color: rgb(0.36, 0.32, 0.26)
  })
  title.drawText('A SAMPLE DOCUMENT FOR BOOKSCENT 0.9.6', {
    x: MARGIN,
    y: 300,
    size: 9.5,
    font: sans,
    color: rgb(0.55, 0.42, 0.26)
  })
  title.drawText('24 pages · one embedded image · margin notes welcome', {
    x: MARGIN,
    y: 220,
    size: 10.5,
    font: serif,
    color: rgb(0.42, 0.37, 0.31)
  })
  drawFooter(title, 0)

  /* ---------------------------------------------------------- 目录 */
  const toc = pages[1]
  toc.drawText('Contents', { x: MARGIN, y: A4[1] - 96, size: 20, font: serifBold, color: rgb(0.17, 0.14, 0.1) })
  toc.drawLine({
    start: { x: MARGIN, y: A4[1] - 112 },
    end: { x: A4[0] - MARGIN, y: A4[1] - 112 },
    thickness: 1,
    color: rgb(0.61, 0.42, 0.25)
  })
  SECTIONS.forEach((section, i) => {
    const y = A4[1] - 156 - i * 30
    toc.drawText(section.heading, { x: MARGIN, y, size: 12.5, font: serif, color: rgb(0.22, 0.18, 0.13) })
    const page = 5 + i * 3
    const label = String(page)
    toc.drawText(label, {
      x: A4[0] - MARGIN - sans.widthOfTextAtSize(label, 11),
      y,
      size: 11,
      font: sans,
      color: rgb(0.45, 0.4, 0.34)
    })
    toc.drawText('·'.repeat(48), { x: MARGIN + 4, y: y + 2, size: 8, font: serif, color: rgb(0.82, 0.78, 0.71) })
  })
  drawFooter(toc, 1)

  /* --------------------------------------------- 正文：把章节铺到 24 页 */
  let cursor = 2
  let pageIndex = 2

  const writeParagraphs = (
    page: PDFPage,
    startY: number,
    paragraphs: string[],
    size: number
  ): number => {
    let y = startY
    for (const paragraph of paragraphs) {
      for (const line of wrap(paragraph, serif, size, contentWidth)) {
        if (y < 100) return y
        page.drawText(line, { x: MARGIN, y, size, font: serif, color: rgb(0.19, 0.16, 0.12) })
        y -= size * 1.55
      }
      y -= size * 0.7
    }
    return y
  }

  while (pageIndex < pageCount - 4) {
    const section = SECTIONS[cursor % SECTIONS.length]
    const page = pages[pageIndex]
    let y = A4[1] - 110

    if (cursor < SECTIONS.length) {
      page.drawText(section.heading, {
        x: MARGIN,
        y,
        size: 17,
        font: serifBold,
        color: rgb(0.17, 0.14, 0.1)
      })
      y -= 16
      page.drawLine({
        start: { x: MARGIN, y },
        end: { x: MARGIN + 120, y },
        thickness: 1.2,
        color: rgb(0.61, 0.42, 0.25)
      })
      y -= 32
    } else {
      page.drawText(`${section.heading} (continued)`, {
        x: MARGIN,
        y,
        size: 11,
        font: serifItalic,
        color: rgb(0.5, 0.45, 0.38)
      })
      y -= 34
    }

    y = writeParagraphs(page, y, section.paragraphs, 11.5)

    if (section.image && image && y > 260) {
      const boxWidth = 220
      const boxHeight = (image.height / image.width) * boxWidth
      page.drawImage(image, {
        x: MARGIN,
        y: y - boxHeight - 18,
        width: boxWidth,
        height: boxHeight
      })
      page.drawText('Fig. 1 — the application icon, embedded at native resolution', {
        x: MARGIN,
        y: y - boxHeight - 34,
        size: 9,
        font: serifItalic,
        color: rgb(0.45, 0.4, 0.34)
      })
      y -= boxHeight + 50
    }

    if (y > 160) {
      page.drawText(
        `Section ${cursor + 1} of ${SECTIONS.length} · page ${pageIndex + 1} of ${pageCount}`,
        { x: MARGIN, y: 108, size: 9, font: sans, color: rgb(0.55, 0.5, 0.44) }
      )
    }
    drawFooter(page, pageIndex)
    pageIndex++
    cursor++
  }

  /* ---------------------------------------------------------- 附录 */
  const appendix: string[] = [
    'A. Keyboard: PageUp / PageDown turn pages, B drops a bookmark, P selects the pen.',
    'B. Annotations are stored per page as normalised geometry, so zoom and rotation do not move them.',
    'C. Page export renders at 1x to 4x; embedded extraction keeps the original pixel dimensions.',
    'D. Annotated exports are flattened with a standard PDF writer and open in any reader.',
    'E. Bookmarks live with the book, not with the file, so the original document is never modified.'
  ]
  for (let i = 0; i < 4 && pageIndex < pageCount; i++) {
    const page = pages[pageIndex]
    page.drawText('Appendix', { x: MARGIN, y: A4[1] - 110, size: 17, font: serifBold, color: rgb(0.17, 0.14, 0.1) })
    page.drawLine({
      start: { x: MARGIN, y: A4[1] - 126 },
      end: { x: MARGIN + 120, y: A4[1] - 126 },
      thickness: 1.2,
      color: rgb(0.61, 0.42, 0.25)
    })
    if (i > 0) {
      page.drawText('Appendix (continued)', {
        x: MARGIN,
        y: A4[1] - 150,
        size: 10.5,
        font: serifItalic,
        color: rgb(0.5, 0.45, 0.38)
      })
    }
    let y = A4[1] - 180
    for (let n = 0; n < 4; n++) {
      const line = appendix[(i * 4 + n) % appendix.length]
      page.drawText(line, { x: MARGIN, y, size: 11, font: serif, color: rgb(0.19, 0.16, 0.12) })
      y -= 18
    }
    drawFooter(page, pageIndex)
    pageIndex++
  }

  return await doc.save()
}

export function samplePdfPath(dir: string): string {
  return join(dir, '示例文档 · The Shape of a Shelf.pdf')
}
