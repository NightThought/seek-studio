import type { PDFPageProxy } from 'pdfjs-dist'
import type { OcrBox, OcrRegion } from './ocr.js'

export type DisplayRegion = OcrRegion & { id: string }
export type PdfTextLine = { text: string; box: OcrBox }

const clampPage = (coordinate: number) => Math.max(0, Math.min(1000, coordinate))
const area = ([x1, y1, x2, y2]: OcrBox) => (x2 - x1) * (y2 - y1)
const intersection = (a: OcrBox, b: OcrBox) =>
  Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0])) *
  Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]))

const sameArea = (a: OcrBox, b: OcrBox) => {
  const shared = intersection(a, b)
  return shared / (area(a) + area(b) - shared) >= 0.6
}

/** PDF.js records three corners of each painted bitmap in normalized page space. */
export const pdfImageBoxes = (coordinates: ArrayLike<number> | null): OcrBox[] => {
  const boxes: OcrBox[] = []
  if (!coordinates) {
    return boxes
  }
  for (let i = 0; i + 5 < coordinates.length; i += 6) {
    const x = [coordinates[i], coordinates[i + 2], coordinates[i + 4]]
    const y = [coordinates[i + 1], coordinates[i + 3], coordinates[i + 5]]
    x.push(x[1] + x[2] - x[0])
    y.push(y[1] + y[2] - y[0])
    const box: OcrBox = [Math.min(...x), Math.min(...y), Math.max(...x), Math.max(...y)]
    const bounds = box.map((value) => clampPage(value * 1000)) as OcrBox
    const width = bounds[2] - bounds[0]
    const height = bounds[3] - bounds[1]
    // Skip tiny icons and full-page scan images.
    if (
      width >= 120 &&
      height >= 70 &&
      area(bounds) >= 15000 &&
      !(width >= 800 && height >= 800) &&
      !boxes.some((other) => sameArea(bounds, other))
    ) {
      boxes.push(bounds)
    }
  }
  return boxes
}

export const overlapsPdfFigure = (region: OcrRegion, images: OcrBox[]) => {
  const { box, table } = region
  return Boolean(table && box && images.some((image) => sameArea(image, box)))
}

const textKey = (value: string) =>
  value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, '')

/** Move a table only if a unique set of consecutive rows also matches the original PDF text. */
const locateTable = (rows: string[][], lines: PdfTextLine[]): OcrBox | undefined => {
  const header = rows[0].map(textKey).filter(Boolean)
  const body = rows
    .slice(1)
    .map((row) => textKey(row.join('')))
    .filter(Boolean)
  if (header.length < 2 || !body.length) {
    return undefined
  }
  const pdfKeys = lines.map((line) => textKey(line.text))
  // The PDF text layer can omit a header glyph. Require matching data rows before using its box.
  const minHeaders = Math.max(2, Math.ceil(header.length * 0.75))
  const starts = pdfKeys.flatMap((key, index) => {
    if (header.filter((cell) => key.includes(cell)).length < minHeaders) {
      return []
    }
    return body.every((row, offset) => pdfKeys[index + offset + 1] === row) ? [index] : []
  })
  if (starts.length !== 1) {
    return undefined
  }
  const matched = lines.slice(starts[0], starts[0] + body.length + 1).map((line) => line.box)
  return [
    clampPage(Math.min(...matched.map((box) => box[0])) - 8),
    clampPage(matched[0][1] - 4),
    clampPage(Math.max(...matched.map((box) => box[2])) + 8),
    clampPage(matched[matched.length - 1][3] + 4),
  ]
}

export const completePdfLayout = (
  regions: DisplayRegion[],
  images: OcrBox[],
  lines: PdfTextLine[] = []
): DisplayRegion[] => {
  const additions: (DisplayRegion & { box: OcrBox })[] = []
  const remaining = regions.filter((region) => {
    if (!region.table || !overlapsPdfFigure(region, images)) {
      return true
    }
    const box = locateTable(region.table, lines)
    if (!box || images.some((image) => sameArea(image, box))) {
      return true
    }
    additions.push({ ...region, box })
    return false
  })
  for (const [index, box] of images.entries()) {
    const existing = regions.some(
      (region) =>
        region.type === 'image' &&
        region.box &&
        intersection(region.box, box) / Math.min(area(region.box), area(box)) >= 0.65
    )
    if (!existing) {
      additions.push({ type: 'image', text: '', box, id: `pdf-${index}` })
    }
  }
  if (!additions.length) {
    return regions
  }
  for (const region of additions.sort((a, b) => a.box[1] - b.box[1])) {
    const next = remaining.findIndex((other) => other.box && other.box[1] > region.box[1])
    remaining.splice(next < 0 ? remaining.length : next, 0, region)
  }
  return remaining
}

export const readPdfTextLines = async (page: PDFPageProxy): Promise<PdfTextLine[]> => {
  if (page.rotate % 360 !== 0) {
    return []
  }
  const viewport = page.getViewport({ scale: 1 })
  const { items } = await page.getTextContent()
  const spans = items
    .flatMap((item) => {
      if (!('str' in item) || !item.str.trim()) {
        return []
      }
      const [x, baseline] = viewport.convertToViewportPoint(item.transform[4], item.transform[5])
      return [{ x, baseline, width: item.width, height: item.height, text: item.str }]
    })
    .sort((a, b) => a.baseline - b.baseline)
  const groups: (typeof spans)[] = []
  for (const span of spans) {
    const line = groups.at(-1)
    if (line && span.baseline - line[0].baseline <= 2) {
      line.push(span)
    } else {
      groups.push([span])
    }
  }
  return groups.map((line) => {
    line.sort((a, b) => a.x - b.x)
    const left = line[0].x
    const top = Math.min(...line.map((span) => span.baseline - span.height))
    const right = Math.max(...line.map((span) => span.x + span.width))
    const bottom = Math.max(...line.map((span) => span.baseline))
    return {
      text: line.map((span) => span.text).join(''),
      box: [
        left / viewport.width,
        top / viewport.height,
        right / viewport.width,
        bottom / viewport.height,
      ].map((n) => clampPage(n * 1000)) as OcrBox,
    }
  })
}
