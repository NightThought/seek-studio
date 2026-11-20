import { useCallback, useMemo, useRef, useState } from 'react'
import { Markdown } from '../markdown/Markdown.js'
import { assetUrl, type Asset, type Result } from './api.js'
import { parseOcr, type OcrRegion } from './ocr.js'
import { OcrFigure, OcrPagePreview, OcrPageSection, useOcrOriginal } from './OcrRaster.js'
import type { DisplayRegion } from './ocrLayout.js'
import styles from './OcrResult.module.css'

export const OcrResult = ({
  documents,
  assets,
  includeFigures,
}: {
  documents: NonNullable<Result['documents']>
  assets: Asset[]
  includeFigures: boolean
}) => {
  const [docIndex, setDocIndex] = useState(0),
    [pageIndex, setPageIndex] = useState(0),
    [regionId, setRegionId] = useState<string | null>(null)
  const [layouts, setLayouts] = useState<Record<string, DisplayRegion[]>>({})
  const applyLayout = useCallback((key: string, regions: DisplayRegion[]) => {
    setLayouts((current) => ({ ...current, [key]: regions }))
  }, [])
  const source = useRef<HTMLDivElement>(null)
  const doc = documents[docIndex] ?? documents[0]
  const pages = useMemo(
    () =>
      doc?.pages.map((page) => ({
        ...page,
        key: `${doc.fileId}:${page.index}`,
        regions: parseOcr(page.text)
          .filter((region) => includeFigures || region.type === 'text' || region.text)
          .map((region, i) => ({
            ...region,
            type: includeFigures ? region.type : ('text' as const),
            id: `ocr-${i}`,
          })),
      })) ?? [],
    [doc, includeFigures]
  )
  const page = pages[pageIndex] ?? pages[0]
  const asset = assets.find((f) => f.id === doc?.fileId)
  const name = doc?.name ?? ''
  const format =
    asset?.mime === 'application/pdf' || /\.pdf$/i.test(name)
      ? 'pdf'
      : asset?.mime.startsWith('image/') || /\.(png|jpe?g|webp|gif|bmp)$/i.test(name)
        ? 'image'
        : undefined
  const original = useOcrOriginal(doc?.fileId, format)
  if (!doc || !page) {
    return <p>没有页面结果</p>
  }
  const selected = (layouts[page.key] ?? page.regions).find((region) => region.id === regionId)
  const select = (p: number, id: string) => {
    setPageIndex(p)
    setRegionId(id)
    source.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }
  const overlay = (region: OcrRegion) =>
    region.box ? (
      <div
        className={styles.highlight}
        data-testid="ocr-highlight"
        style={{
          left: `${region.box[0] / 10}%`,
          top: `${region.box[1] / 10}%`,
          width: `${(region.box[2] - region.box[0]) / 10}%`,
          height: `${(region.box[3] - region.box[1]) / 10}%`,
        }}
      />
    ) : null
  return (
    <div>
      <div className={styles.toolbar}>
        <select
          aria-label="识别文档"
          value={docIndex}
          onChange={(e) => {
            setDocIndex(+e.target.value)
            setPageIndex(0)
            setRegionId(null)
          }}
        >
          {documents.map((d, i) => (
            <option key={d.fileId} value={i}>
              {d.name}
            </option>
          ))}
        </select>
        <label>
          原文页码{' '}
          <select
            aria-label="原文页码"
            value={pageIndex}
            onChange={(e) => {
              setPageIndex(+e.target.value)
              setRegionId(null)
            }}
          >
            {pages.map((p, i) => (
              <option key={i} value={i}>
                第 {p.index + 1} 页
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className={styles.hint}>
        点击右侧{includeFigures ? '文字或插图' : '文字'}
        可跳到对应原文页，有区域坐标时会高亮原文位置。
      </p>
      <div className={styles.columns}>
        <div className={styles.source} ref={source}>
          <strong>原文 · 第 {page.index + 1} 页</strong>
          <div className={styles.preview}>
            {format ? (
              <OcrPagePreview
                key={page.key}
                original={original}
                page={page.index}
                label={format === 'pdf' ? `PDF 原文第 ${page.index + 1} 页` : doc.name}
              />
            ) : (
              <p>此格式可下载原文件查看。</p>
            )}
            {selected ? overlay(selected) : null}
          </div>
          <a href={assetUrl(doc.fileId)} download>
            下载原文件
          </a>
          {regionId !== null && !selected?.box ? (
            <p className={styles.hint}>当前内容缺少区域坐标，已定位到对应页。</p>
          ) : null}
        </div>
        <div className={styles.recognized} aria-label="Markdown 识别结果">
          {pages.map((p, pi) => (
            <OcrPageSection
              key={p.key}
              original={includeFigures ? original : null}
              page={p.index}
              pageKey={p.key}
              regions={p.regions}
              onLayout={applyLayout}
            >
              <h3>第 {p.index + 1} 页</h3>
              {(layouts[p.key] ?? p.regions).map((r, ri) => (
                <div
                  key={r.id}
                  role="button"
                  tabIndex={0}
                  aria-label={`定位第 ${p.index + 1} 页${r.type === 'image' ? '插图' : r.table ? '表格' : '区域'} ${ri + 1}`}
                  aria-pressed={pageIndex === pi && regionId === r.id}
                  className={styles.regionText}
                  data-region-type={r.type}
                  onClick={() => select(pi, r.id)}
                  onMouseUp={() => select(pi, r.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      select(pi, r.id)
                    }
                  }}
                >
                  {r.type === 'image' ? (
                    <OcrFigure original={original} format={format} page={p.index} box={r.box} />
                  ) : null}
                  {r.text ? (
                    <Markdown
                      content={r.text}
                      cacheKey={`${p.key}:${r.id}`}
                      loading={false}
                      disableLink={false}
                    />
                  ) : null}
                </div>
              ))}
            </OcrPageSection>
          ))}
        </div>
      </div>
    </div>
  )
}
