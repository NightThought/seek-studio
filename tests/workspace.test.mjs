import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseOcr, ocrMarkdown } from '../.cache/tests/components/apps/ocr.js'
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
