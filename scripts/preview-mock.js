/* eslint-disable */
/**
 * 预览用假 API：在浏览器里把 window.bookscent 伪装出来，
 * 让渲染层在没有 Electron 的环境下也能完整跑起来（用于布局与视觉核对）。
 * 这不是产品代码，只是 scripts/preview.mjs 的配套夹具。
 */
;(function () {
  const NOW = Date.now()
  const FONTS = {
    serif: '"Noto Serif SC", "Source Han Serif SC", "Songti SC", SimSun, Georgia, serif',
    sans: '"Segoe UI", "Microsoft YaHei", system-ui, sans-serif',
    mono: '"Cascadia Code", Consolas, monospace'
  }

  function bookStyle(over) {
    return Object.assign(
      {
        spinePreset: 'cloth',
        spineColor: '#8a4b3a',
        spineColor2: '#6d3a2c',
        spineTextColor: '#f5e6c8',
        foilColor: '#d9b46a',
        spineImage: null,
        coverPreset: 'classic',
        coverColor: '#8a4b3a',
        coverColor2: '#5d2f24',
        coverTextColor: '#f5e6c8',
        coverImage: null,
        thicknessScale: 1,
        spineWidthOverride: null,
        ornament: 'bands',
        fontFamily: FONTS.serif,
        spineTextDirection: 'vertical',
        showFormatIcon: true,
        tilt: 0
      },
      over || {}
    )
  }

  let settings = {
    schema: 1,
    appTheme: 'parchment',
    shelfTheme: 'birch',
    bookStyle: bookStyle({ spinePreset: 'gilded', spineColor: '#233042', spineColor2: '#16202d', spineTextColor: '#e8d9a8', foilColor: '#cfa94f', ornament: 'ribs', coverPreset: 'classic', coverColor: '#233042', coverColor2: '#131b25' }),
    customThemes: [],
    customBookStyles: [],
    ui: {
      zoom: 1,
      shelfRowHeight: 250,
      booksPerShelf: 14,
      animate: true,
      showPlaque: true,
      showShadow: true,
      shelfTilt: 0.35,
      bookHeightVariation: 0.09,
      editorFontSize: 16,
      editorFontFamily: FONTS.serif,
      editorLineHeight: 1.85,
      autosave: true,
      autosaveDelay: 1500,
      pdfDefaultZoom: 'auto',
      pdfContinuous: true,
      newNoteFormat: 'md',
      sidebarOpen: true
    },
    window: { width: 1500, height: 940, x: null, y: null, maximized: false }
  }

  function bk(id, title, author, format, pageCount, exact, words, accent, style, extra) {
    return Object.assign(
      {
        id: id,
        title: title,
        author: author,
        format: format,
        path: 'C:\\Users\\Viburnum\\Documents\\Bookscent 藏书\\' + title + '.' + format,
        external: false,
        size: 180000 + pageCount * 4200,
        pageCount: pageCount,
        pageCountExact: exact,
        probeSize: 180000 + pageCount * 4200,
        words: words,
        addedAt: NOW - 86400000 * 12,
        updatedAt: NOW - 3600000 * 5,
        lastOpenedAt: NOW - 3600000 * 3,
        status: 'unread',
        rating: 0,
        tags: [],
        summary: '',
        shelfId: 'shelf_main',
        style: style || {},
        accent: accent,
        coverThumb: null,
        missing: false
      },
      extra || {}
    )
  }

  const books = [
    bk('bk_pdf1', '示例文档 · The Shape of a Shelf', 'Bookscent', 'pdf', 24, true, 0, '#2f4f4a', {
      spinePreset: 'gilded',
      spineColor: '#233042',
      spineColor2: '#16202d',
      spineTextColor: '#e8d9a8',
      foilColor: '#cfa94f',
      ornament: 'ribs',
      coverPreset: 'classic',
      coverColor: '#233042',
      coverColor2: '#131b25'
    }, { status: 'reading', rating: 4, tags: ['示例', 'PDF'], summary: '一份 24 页的示例 PDF：目录、页码、内嵌图片。' }),
    bk('bk_md1', '欢迎使用书香笔记', 'Bookscent', 'md', 4, false, 1180, '#8a4b3a', {
      spinePreset: 'leather',
      spineColor: '#6b2f26',
      spineColor2: '#4a1d17',
      spineTextColor: '#f3e0b8',
      foilColor: '#d6b26a',
      ornament: 'ribs',
      coverPreset: 'classic',
      coverColor: '#6b2f26',
      coverColor2: '#3f1812'
    }, { rating: 5, status: 'reading', tags: ['入门'] }),
    bk('bk_md2', '外观与个性化', 'Bookscent', 'md', 3, false, 890, '#3f5d54', {
      spinePreset: 'cloth',
      spineColor: '#3f5d54',
      spineColor2: '#2c443d',
      spineTextColor: '#f0e6cf',
      foilColor: '#c9b184',
      ornament: 'label',
      coverPreset: 'vintage',
      coverColor: '#3f5d54',
      coverColor2: '#26382f'
    }, { tags: ['主题'] }),
    bk('bk_txt1', '读书笔记示例', '佚名', 'txt', 2, false, 420, '#6f6a5c', {
      spinePreset: 'paper',
      spineColor: '#e7dcc4',
      spineColor2: '#d2c3a4',
      spineTextColor: '#4a3b25',
      foilColor: '#a08a5f',
      ornament: 'none',
      coverPreset: 'typewriter',
      coverColor: '#efe6d3',
      coverColor2: '#d8cbb0',
      coverTextColor: '#3b3121',
      thicknessScale: 0.8
    }, { rating: 3 }),
    bk('bk_md3', '论书架的形状 · 长篇笔记', '佚名', 'md', 48, false, 21500, '#5c3a5e', {
      spinePreset: 'leather',
      spineColor: '#5c3a5e',
      spineColor2: '#3d2540',
      spineTextColor: '#f0dcf2',
      foilColor: '#d9b46a',
      ornament: 'ribs',
      coverPreset: 'vintage',
      coverColor: '#5c3a5e',
      coverColor2: '#33203a'
    }, { status: 'reading', tags: ['长文', '随笔'] }),
    bk('bk_md4', '夜读札记', '佚名', 'md', 12, false, 6400, '#2f3b52', {
      spinePreset: 'modern',
      spineColor: '#2f3b52',
      spineColor2: '#22293a',
      spineTextColor: '#eef1f7',
      foilColor: '#7f93b8',
      ornament: 'none',
      coverPreset: 'minimal',
      coverColor: '#2f3b52',
      coverColor2: '#1d2434',
      fontFamily: FONTS.sans
    }, { status: 'finished', rating: 5 }),
    bk('bk_txt2', '摘抄本', '佚名', 'txt', 6, false, 2600, '#7a5230', {
      spinePreset: 'cloth',
      spineColor: '#7a5230',
      spineColor2: '#5b3b1f',
      spineTextColor: '#f6e8ce',
      foilColor: '#d3b078',
      ornament: 'bands'
    }, { rating: 4 }),
    bk('bk_docx', '会议纪要 · 十一月', '佚名', 'docx', 9, true, 3100, '#2f5d8f', {
      spinePreset: 'modern',
      spineColor: '#2f5d8f',
      spineColor2: '#1f3f63',
      spineTextColor: '#eef4fc',
      foilColor: '#9dc0e6',
      ornament: 'label',
      fontFamily: FONTS.sans
    }),
    bk('bk_doc', '旧版合同（Word 97）', '佚名', 'doc', 5, false, 1500, '#455a3e', {
      spinePreset: 'cloth',
      spineColor: '#455a3e',
      spineColor2: '#2f3f2b',
      spineTextColor: '#eef2e4',
      foilColor: '#bcae7c',
      ornament: 'bands'
    }, { external: true }),
    bk('bk_html', '一篇网页剪藏', '佚名', 'html', 3, false, 900, '#c07a2a', {
      spinePreset: 'paper',
      spineColor: '#e3d7d0',
      spineColor2: '#cbbab0',
      spineTextColor: '#4a3730',
      foilColor: '#b08a5f',
      ornament: 'none'
    }),
    bk('bk_img', '封面设计草图', '佚名', 'image', 1, true, 0, '#8a5c9c', {
      spinePreset: 'photo',
      spineColor: '#8a5c9c',
      spineColor2: '#6a4478',
      spineTextColor: '#f6ecfa',
      foilColor: '#d9b46a',
      ornament: 'label'
    })
  ]

  const index = {
    version: 1,
    libraryDir: 'C:\\Users\\Viburnum\\Documents\\Bookscent 藏书',
    books: books,
    shelves: [
      { id: 'shelf_main', name: '我的书架', themeId: null, order: 0 },
      { id: 'shelf_read', name: '正在读', themeId: null, order: 1 },
      { id: 'shelf_long', name: '大部头', themeId: null, order: 2 }
    ],
    scannedAt: NOW
  }
  books[4].shelfId = 'shelf_long'
  books[5].shelfId = 'shelf_read'

  const MD_WELCOME = [
    '# 欢迎来到书香笔记',
    '',
    '> 一座属于你自己的书房。书架上的每一本书，都是你读过或写下的一页。',
    '',
    '## 书架怎么用',
    '',
    '- **点击书脊** 打开阅读或编辑；**右键书脊** 打开书籍菜单。',
    '- 书脊的**厚薄由页数决定**：PDF 与 Word 读真实页数，Markdown / 纯文本按字数估算。',
    '- 想更漂亮，可以在「书籍样式」里给任意一本书换上**自定义书脊图片**或**封面**。',
    '',
    '## 支持哪些格式',
    '',
    '| 格式 | 打开方式 |',
    '| --- | --- |',
    '| `.md` `.markdown` | 内置编辑器，左侧写作、右侧实时预览 |',
    '| `.txt` | 内置纯文本编辑器 |',
    '| `.pdf` | 内置阅读器：书签、绘图批注、导出页面图片 |',
    '| `.doc` `.docx` | 文字预览，可一键交给 Word 打开 |',
    '',
    '## 一点小技巧',
    '',
    '1. 按 `Ctrl+S` 保存当前笔记，按 `Ctrl+E` 在编辑、分栏、预览之间轮转。',
    '2. 在 PDF 阅读器里按 `B` 给当前页加书签，按 `P` 切换到画笔。',
    '3. 主题、书架木板、书脊样式都可以在右上角的**外观**里随心情更换。',
    '',
    '---',
    '',
    '*书香笔记 v0.1.1*'
  ].join('\n')

  const texts = {
    'bk_md1': MD_WELCOME,
    'bk_md2': '# 外观与个性化\n\n## 三类主题，各管一段\n\n1. **应用主题** —— 决定窗口底色、文字与强调色。\n2. **书架主题** —— 决定木板纹理与整体木色。\n3. **书籍样式** —— 决定书脊预设、烫金与字体。\n\n> 三者可以自由组合，例如「墨夜」配「胡桃木」，再给书脊换上「竹节烫金」。\n\n![封面](cover.png)\n\n## 自定义到什么程度\n\n- 任意主题都可以在预设基础上**微调每一个颜色**。\n- 每本书都可以单独覆盖样式，不会影响书架上的其他书。\n- 书脊贴图与封面图片支持任意 PNG / JPG。\n',
    'bk_md3': '# 论书架的形状\n\n一架子的书，最先说话的不是哪一本，而是它们的**厚薄**。\n\n## 厚度即信息\n\n薄脊承诺一个下午，厚脊要求一个季节。电子书架常常把这件事丢掉：所有文档都变成一样大的图标，于是诗集和词典看起来一样重。\n\n> 把页数还给书脊，书架才会重新变成一张可读的地图。\n\n## 摆法\n\n- 按高度排，整齐，难读；\n- 按主题排，混乱，好读；\n- 按心情排，只有你自己读得懂。\n',
    'bk_md4': '# 夜读札记\n\n夜里读书，最要紧的是**别把别人吵醒**。\n\n- 暖色的暗书架\n- 烫金的书脊\n- 一页不刺眼的白\n\n---\n\n*灯下随笔 · 二〇二六*',
    'bk_txt1': '读书笔记 · 示例\n=========================\n\n书名：《查令十字街84号》\n作者：海莲·汉芙\n\n【摘抄】\n你们若恰好路经查令十字街84号，请代我献上一吻，\n我亏欠她良多……\n\n【我的想法】\n一间旧书店之所以动人，不在于书有多全，\n而在于有人愿意为一本你还没读过的书，等你二十年。\n',
    'bk_txt2': '摘抄本\n\n1. 一个人只有用心去看，才能看到真实。\n2. 我们读书，然后就不孤单。\n3. 所谓故乡，就是回不去的地方。\n4. 一本书最好的位置，是另一个人的手里。\n'
  }
  const contentById = texts
  function contentFor(p) {
    const b = books.filter(function (x) {
      return x.path === p
    })[0]
    return (b && contentById[b.id]) || '# 预览夹具\n\n这是一段占位内容，用来核对排版与行距。\n'
  }

  /* 允许用 URL hash 预置外观，方便一次跑出多套主题的截图：
     #appTheme=walnut&shelfTheme=bamboo&rowHeight=210&perShelf=8&zoom=1 */
  const hashParams = new URLSearchParams(String(location.hash || '').replace(/^#/, ''))
  if (hashParams.get('appTheme')) settings.appTheme = hashParams.get('appTheme')
  if (hashParams.get('shelfTheme')) settings.shelfTheme = hashParams.get('shelfTheme')
  if (hashParams.get('rowHeight')) settings.ui.shelfRowHeight = Number(hashParams.get('rowHeight'))
  if (hashParams.get('perShelf')) settings.ui.booksPerShelf = Number(hashParams.get('perShelf'))
  if (hashParams.get('zoom')) settings.ui.zoom = Number(hashParams.get('zoom'))
  if (hashParams.get('tilt')) settings.ui.shelfTilt = Number(hashParams.get('tilt'))
  if (hashParams.get('variation')) settings.ui.bookHeightVariation = Number(hashParams.get('variation'))
  if (hashParams.get('view')) settings.ui.sidebarOpen = hashParams.get('view') !== 'noside'


  const records = {}
  function recordFor(id) {
    if (!records[id]) {
      records[id] = {
        bookId: id,
        progress: { page: 1, scrollRatio: 0, zoom: 0, rotation: 0 },
        bookmarks:
          id === 'bk_pdf1'
            ? [
                { id: 'bm1', page: 1, label: '扉页', color: '#b5443a', createdAt: NOW - 8000 },
                { id: 'bm2', page: 5, label: 'II. Thickness as Information', color: '#4a8a5c', createdAt: NOW - 5000 }
              ]
            : [],
        annotations: {},
        outline:
          id === 'bk_pdf1'
            ? [
                { title: 'I. On the Shape of a Shelf', page: 3, depth: 0 },
                { title: 'II. Thickness as Information', page: 5, depth: 0 },
                { title: 'III. The Marks We Leave', page: 8, depth: 0 },
                { title: 'IV. Extraction and Return', page: 11, depth: 0 },
                { title: 'V. Night Reading', page: 16, depth: 0 },
                { title: 'Appendix', page: 21, depth: 0 }
              ]
            : [],
        updatedAt: NOW
      }
    }
    return records[id]
  }

  let samplePdfBytes = null
  let iconDataUrl = null

  async function samplePdf() {
    if (!samplePdfBytes) {
      const res = await fetch('/__sample.pdf')
      samplePdfBytes = new Uint8Array(await res.arrayBuffer())
    }
    return samplePdfBytes.slice()
  }

  async function icon() {
    if (!iconDataUrl) {
      const res = await fetch('/__icon.png')
      const buf = new Uint8Array(await res.arrayBuffer())
      let s = ''
      for (let i = 0; i < buf.length; i++) s += String.fromCharCode(buf[i])
      iconDataUrl = 'data:image/png;base64,' + btoa(s)
    }
    return iconDataUrl
  }

  function deepMerge(base, patch) {
    if (patch === null || patch === undefined) return base
    if (Array.isArray(patch)) return patch
    if (typeof patch !== 'object') return patch
    if (typeof base !== 'object' || base === null || Array.isArray(base)) return patch
    const out = Object.assign({}, base)
    Object.keys(patch).forEach(function (k) {
      if (patch[k] === undefined) return
      out[k] = deepMerge(base[k], patch[k])
    })
    return out
  }

  const noop = function () {}
  const unsub = function () {
    return noop
  }

  window.bookscent = {
    app: {
      info: async function () {
        return {
          version: '0.1.1',
          name: '书香笔记',
          platform: 'win32',
          userDataDir: 'C:\\Users\\Viburnum\\AppData\\Roaming\\bookscent',
          libraryDir: index.libraryDir,
          electron: '44.7.0',
          chrome: '142.0.0.0',
          node: '24.21.0'
        }
      },
      openPath: async function () {
        return ''
      },
      revealPath: async function () {},
      windowMinimize: async function () {},
      windowToggleMaximize: async function () {
        return false
      },
      windowClose: async function () {},
      windowIsMaximized: async function () {
        return false
      },
      getPathForFile: function () {
        return ''
      },
      onMaximizeChange: unsub,
      onRequestOpen: unsub
    },
    settings: {
      get: async function () {
        return settings
      },
      patch: async function (patch) {
        settings = deepMerge(settings, patch)
        return settings
      },
      reset: async function () {
        return settings
      },
      export: async function () {
        return { path: null, cancelled: true }
      },
      import: async function () {
        return { settings: settings, cancelled: true }
      }
    },
    library: {
      index: async function () {
        return index
      },
      rescan: async function () {
        return index
      },
      importDialog: async function () {
        return null
      },
      importPaths: async function () {
        return { added: [], skipped: [], index: index }
      },
      createNote: async function () {
        return null
      },
      updateBook: async function (id, patch) {
        const b = books.filter(function (x) {
          return x.id === id
        })[0]
        if (b) Object.assign(b, patch)
        return b
      },
      removeBooks: async function () {
        return index
      },
      record: async function (id) {
        return recordFor(id)
      },
      saveRecord: async function (r) {
        records[r.bookId] = r
        return r
      },
      chooseLibraryDir: async function () {
        return null
      },
      saveShelves: async function (shelves) {
        index.shelves = shelves
        return index
      },
      enrich: async function () {
        return true
      },
      onBookUpdated: unsub,
      onScanProgress: unsub
    },
    files: {
      readText: async function (p) {
        return contentFor(p)
      },
      writeText: async function (p, content) {
        const b = books.filter(function (x) {
          return x.path === p
        })[0]
        if (b) contentById[b.id] = content
        return { size: content.length, mtimeMs: Date.now() }
      },
      readBinary: async function (p) {
        if (/\.pdf$/i.test(p)) return await samplePdf()
        if (/image|\.png|\.jpg/i.test(p)) {
          const res = await fetch('/__icon.png')
          return new Uint8Array(await res.arrayBuffer())
        }
        return new TextEncoder().encode(contentFor(p))
      },
      exists: async function () {
        return true
      },
      stat: async function () {
        return { exists: true, size: 240000, mtimeMs: NOW - 60000 }
      },
      probe: async function (id) {
        if (/pdf/i.test(id)) return { pages: 24, exact: true, words: 0 }
        return { pages: 4, exact: false, words: 1200 }
      },
      extractDocText: async function () {
        return {
          text:
            '会议纪要 · 十一月\n\n一、书架视图改版\n二、PDF 批注与书签\n三、主题系统拆分\n\n（预览夹具中的纯文本抽取结果）',
          words: 320,
          pages: 9
        }
      },
      exportText: async function () {
        return { path: null, cancelled: true }
      },
      exportBinary: async function () {
        return { path: null, cancelled: true }
      },
      pickImages: async function () {
        return []
      },
      readImage: async function () {
        return await icon()
      },
      saveImages: async function () {
        return { dir: 'C:\\Users\\Viburnum\\Pictures', files: [], cancelled: true }
      },
      chooseDirectory: async function () {
        return null
      },
      copyIntoLibrary: async function (p) {
        return p
      }
    },
    dialog: {
      open: async function () {
        return null
      },
      confirm: async function () {
        return 0
      }
    }
  }

  document.documentElement.dataset.preview = '1'
})()
