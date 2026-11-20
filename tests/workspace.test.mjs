import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseOcr, ocrMarkdown } from '../.cache/tests/components/apps/ocr.js'
import { completePdfLayout, pdfImageBoxes } from '../.cache/tests/components/apps/ocrLayout.js'
test('OCR renders semantic Markdown with page mapping, retaining tables and rejecting invalid boxes', () => {
  const source =
    '<｜ref｜>title<｜/ref｜><｜box｜>[[10,20,900,150]]<｜/box｜>\nReport\n<｜ref｜>table<｜/ref｜><｜box｜>[[10,200,900,700]]<｜/box｜>\n| A | B |\n|---|---|\n| 1 | 2 |'
  const result = parseOcr(source)
  assert.equal(result[0].text, '# Report')
  assert.deepEqual(result[1].box, [10, 200, 900, 700])
  assert.match(result[1].text, /\| 1 \| 2 \|/)
  const exported = ocrMarkdown([{ name: 'report.pdf', pages: [{ index: 1, text: source }] }])
  assert.match(exported, /第 2 页/)
  assert.ok(!exported.includes('<｜'))
  assert.equal(parseOcr('## No coordinates')[0].box, undefined)
  assert.equal(
    parseOcr('<｜ref｜>text<｜/ref｜><｜box｜>[[900,200,10,700]]<｜/box｜>Text')[0].box,
    undefined
  )
  assert.equal(
    parseOcr('<｜ref｜>Actual text<｜/ref｜><｜box｜>[[10,20,100,80]]<｜/box｜>')[0].text,
    'Actual text'
  )
})

test('OCR converts HTML into Markdown columns, retaining empty and spanned cells', () => {
  const raw =
    '<table><tr><th rowspan="2">Item</th><td colspan="2">Details</td></tr><tr><td>a|b</td><td></td></tr><tr><td>A</td><td><b>Help</b><br>line</td><td>4</td></tr></table>'
  const [region] = parseOcr(raw)
  assert.deepEqual(region.table, [
    ['Item', 'Details', ''],
    ['', 'a|b', ''],
    ['A', 'Help line', '4'],
  ])
  assert.match(region.text, /\| --- \| --- \| --- \|/)
  assert.ok(region.text.includes('a\\|b') && !region.text.includes('<table'))

  const example = ['```html', raw, '```'].join('\n')
  const [mixed] = parseOcr(`${example}\n\n${raw}`)
  assert.ok(mixed.text.startsWith(example))
  assert.ok(mixed.text.slice(example.length).trimStart().startsWith('| Item'))
  assert.deepEqual(mixed.table, region.table)
})

test('PDF figures fill missing OCR images and repair overlapping table coordinates', () => {
  const images = pdfImageBoxes([
    0.1, 0.3, 0.1, 0.55, 0.9, 0.3, 0.5, 0.72, 0.5, 0.73, 0.51, 0.72, 0, 0, 0, 1, 1, 0,
  ])
  assert.deepEqual(images, [[100, 300, 900, 550]])
  const table = parseOcr(
    '<｜ref｜>table<｜/ref｜><｜box｜>[[100,300,900,550]]<｜/box｜>\n<table><tr><td>Item</td><td>Amount</td></tr><tr><td>Widget</td><td>2</td></tr></table>'
  )[0]
  const region = { ...table, id: 'ocr-0' }
  const ending = { type: 'text', text: 'End', box: [100, 820, 900, 850], id: 'ocr-1' }
  const repaired = completePdfLayout([region, ending], images, [
    { text: 'Item Amount', box: [100, 600, 900, 625] },
    { text: 'Widget 2', box: [100, 650, 900, 675] },
  ])
  assert.deepEqual(
    repaired.map((r) => r.id),
    ['pdf-0', 'ocr-0', 'ocr-1']
  )
  assert.equal(repaired[0].type, 'image')
  assert.ok(repaired[1].box[1] > repaired[0].box[3])
  assert.equal(completePdfLayout(repaired, images), repaired)
})

test('OCR retains image-only regions in reading order with their original coordinates', () => {
  const source = [
    '<｜ref｜>title<｜/ref｜><｜box｜>[[10,20,900,150]]<｜/box｜>\nReport',
    '<｜ref｜>image<｜/ref｜><｜box｜>[[100,200,900,700]]<｜/box｜>',
    '<|ref|>caption<|/ref|><|box|>[[100,700,900,760]]<|/box|>\nFigure 1',
    '<|ref|>image<|/ref|><|box|>[[900,800,100,999]]<|/box|>',
  ].join('\n\n')
  const regions = parseOcr(source)
  assert.deepEqual(
    regions.map((region) => region.type),
    ['text', 'image', 'text', 'image']
  )
  assert.deepEqual(regions[1], { type: 'image', text: '', box: [100, 200, 900, 700] })
  assert.equal(regions[2].text, 'Figure 1')
  assert.equal(regions[3].box, undefined)
  const markdown = ocrMarkdown([{ name: 'report.pdf', pages: [{ index: 0, text: source }] }])
  assert.match(markdown, /# Report\n\nFigure 1$/)
})
