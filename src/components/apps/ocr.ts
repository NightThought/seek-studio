export type OcrRegion = { text: string; box?: [number, number, number, number] }
/** Layout markers use coordinates in a 0–1000 page space. Preserve the Markdown body. */
export function parseOcr(text: string): OcrRegion[] {
  const pattern =
    /<[｜|]ref[｜|]>([\s\S]*?)<[｜|]\/ref[｜|]>\s*<[｜|]box[｜|]>\s*\[\[\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*\]\]\s*<[｜|]\/box[｜|]>/g
  const matches = [...text.matchAll(pattern)]
  if (!matches.length) {
    return [{ text: cleanOcr(text) }]
  }
  const regions: OcrRegion[] = []
  const prefix = cleanOcr(text.slice(0, matches[0].index))
  if (prefix) {
    regions.push({ text: prefix })
  }
  for (let i = 0; i < matches.length; i++) {
    const match = matches[i]
    const label = match[1].trim()
    const body = cleanOcr(
      text.slice((match.index ?? 0) + match[0].length, matches[i + 1]?.index ?? text.length)
    )
    let content =
      body ||
      (/^(title|text|table|image|figure|caption|header|footer|list|equation)$/i.test(label)
        ? ''
        : label)
    if (label === 'title' && content && !content.startsWith('#')) {
      content = '# ' + content
    }
    const coords = match.slice(2, 6).map(Number)
    const valid =
      coords.every((n) => n >= 0 && n <= 1000) && coords[2] > coords[0] && coords[3] > coords[1]
    if (content) {
      regions.push({ text: content, ...(valid ? { box: coords as OcrRegion['box'] } : {}) })
    }
  }
  return regions.length ? regions : [{ text: cleanOcr(text) }]
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
                .join('\n\n')
          )
          .join('\n\n')
    )
    .join('\n\n')
