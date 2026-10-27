declare module 'word-extractor' {
  interface WordDocument {
    getBody(): string
    getFootnotes(): string
    getEndnotes(): string
    getHeaders(): string
    getFooters(): string
    getAnnotations(): string
    getTextboxes(): string
  }

  class WordExtractor {
    extract(source: string | Buffer): Promise<WordDocument>
  }

  export = WordExtractor
}
