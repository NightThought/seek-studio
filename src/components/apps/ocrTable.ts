import type { Nodes } from 'mdast'
import { fromMarkdown } from 'mdast-util-from-markdown'

const htmlTable = /<table\b[^>]*>[\s\S]*?<\/table\s*>/gi
const htmlRow = /<tr\b[^>]*>([\s\S]*?)<\/tr\s*>/gi
const htmlCell = /<(th|td)\b([^>]*)>([\s\S]*?)<\/\1\s*>/gi
const maxColumns = 64

const cellText = (html: string) =>
  html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|template)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim()

const span = (attributes: string, name: 'rowspan' | 'colspan', limit: number) => {
  const match = attributes.match(new RegExp(`\\b${name}\\s*=\\s*["']?(\\d+)`, 'i'))
  return Math.min(Math.max(Number(match?.[1]) || 1, 1), limit)
}

const parseTable = (html: string) => {
  const rows = [...html.matchAll(htmlRow)]
  const grid: string[][] = rows.map(() => [])
  for (let y = 0; y < rows.length; y++) {
    let x = 0
    for (const cell of rows[y][1].matchAll(htmlCell)) {
      const width = span(cell[2], 'colspan', maxColumns)
      const height = span(cell[2], 'rowspan', rows.length - y)
      while (x < maxColumns && grid[y][x] !== undefined) {
        x++
      }
      if (x + width > maxColumns) {
        return null
      }
      for (let dy = 0; dy < height; dy++) {
        for (let dx = 0; dx < width; dx++) {
          const row = grid[y + dy]
          if (row[x + dx] !== undefined) {
            return null
          }
          row[x + dx] = dx === 0 && dy === 0 ? cellText(cell[3]) : ''
        }
      }
      x += width
    }
  }
  const columnCount = grid.reduce((count, row) => Math.max(count, row.length), 0)
  return columnCount
    ? grid.map((row) => Array.from({ length: columnCount }, (_, i) => row[i] ?? ''))
    : null
}

const markdownTable = (rows: string[][]) => {
  const row = (cells: string[]) =>
    `| ${cells.map((cell) => cell.replace(/[\\|`*_[\]~<>]/g, '\\$&')).join(' | ')} |`
  return [row(rows[0]), row(rows[0].map(() => '---')), ...rows.slice(1).map(row)].join('\n')
}

const codeRanges = (markdown: string) => {
  const ranges: { start: number; end: number }[] = []
  const visit = (node: Nodes) => {
    if (node.type === 'code' || node.type === 'inlineCode') {
      const start = node.position?.start.offset
      const end = node.position?.end.offset
      if (start !== undefined && end !== undefined) {
        ranges.push({ start, end })
      }
    } else if ('children' in node) {
      node.children.forEach(visit)
    }
  }
  visit(fromMarkdown(markdown))
  return ranges
}

/** Convert OCR table markup to GFM without rendering HTML from the provider. */
export const normalizeOcrTables = (markdown: string) => {
  if (!/<table\b/i.test(markdown)) {
    return { text: markdown.trim() }
  }
  const code = codeRanges(markdown)
  let table: string[][] | undefined
  let count = 0
  const text = markdown
    .replace(htmlTable, (html, offset: number) => {
      if (code.some(({ start, end }) => offset < end && start < offset + html.length)) {
        return html
      }
      const rows = parseTable(html)
      if (!rows) {
        return html
      }
      count++
      table = rows
      const caption = cellText(html.match(/<caption\b[^>]*>([\s\S]*?)<\/caption\s*>/i)?.[1] ?? '')
      return `\n\n${caption ? `${caption}\n\n` : ''}${markdownTable(rows)}\n\n`
    })
    .trim()
  return { text, ...(count === 1 ? { table } : {}) }
}
