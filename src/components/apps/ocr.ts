import { normalizeOcrTables } from './ocrTable.js'

export type OcrBox = [number, number, number, number]
export type OcrRegion = { type: 'text' | 'image'; text: string; box?: OcrBox; table?: string[][] }
/** Layout markers use coordinates in a 0–1000 page space. Preserve the Markdown body. */
export function parseOcr(text: string): OcrRegion[] {
  const pattern =
    /<[｜|]ref[｜|]>([\s\S]*?)<[｜|]\/ref[｜|]>\s*<[｜|]box[｜|]>\s*\[\[\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*\]\]\s*<[｜|]\/box[｜|]>/g
  const matches = [...text.matchAll(pattern)]
  if (!matches.length) {
    return [{ type: 'text', ...normalizeOcrTables(cleanOcr(text)) }]
  }
  const regions: OcrRegion[] = []
  const prefix = cleanOcr(text.slice(0, matches[0].index))
  if (prefix) {
    regions.push({ type: 'text', ...normalizeOcrTables(prefix) })
  }
  for (let i = 0; i < matches.length; i++) {
    const match = matches[i]
    const label = match[1].trim()
    const image = /^(image|figure|图片|图像|插图)$/i.test(label)
    const body = cleanOcr(
      text.slice((match.index ?? 0) + match[0].length, matches[i + 1]?.index ?? text.length)
    )
    let content =
      body ||
      (image || /^(title|text|table|caption|header|footer|list|equation)$/i.test(label)
        ? ''
        : label)
    if (label === 'title' && content && !content.startsWith('#')) {
      content = '# ' + content
    }
    const coords = match.slice(2, 6).map(Number) as OcrBox
    const valid =
      coords.every((n) => n >= 0 && n <= 1000) && coords[2] > coords[0] && coords[3] > coords[1]
    // 图片通常只有坐标，仍保留该块以便从原文还原配图。
    if (content || image) {
      regions.push({
        type: image ? 'image' : 'text',
        ...normalizeOcrTables(content),
        box: valid ? coords : undefined,
      })
    }
  }
  return regions.length ? regions : [{ type: 'text', ...normalizeOcrTables(cleanOcr(text)) }]
}
export const cleanOcr = (text: string) =>
  text
    .replace(/<[｜|]ref[｜|]>[\s\S]*?<[｜|]\/ref[｜|]>/g, '')
    .replace(/<[｜|]box[｜|]>[\s\S]*?<[｜|]\/box[｜|]>/g, '')
    .replace(/<[｜|](?:det|\/det|eos|end)[｜|]>/g, '')
    .trim()
export const ocrMarkdown = (
  documents: { name: string; pages: { index: number; text: string }[] }[]
) =>
  documents
    .map(
      (doc) =>
        `# ${doc.name}\n\n` +
        doc.pages
          .map(
            (page) =>
              `## 第 ${page.index + 1} 页\n\n` +
              parseOcr(page.text)
                .map((r) => r.text)
                .filter(Boolean)
                .join('\n\n')
          )
          .join('\n\n')
    )
    .join('\n\n')
