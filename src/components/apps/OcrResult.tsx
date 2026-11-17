import { useEffect, useMemo, useRef, useState } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { Markdown } from '../markdown/Markdown.js'
import { assetUrl, type Asset, type Result } from './api.js'
import { parseOcr, type OcrRegion } from './ocr.js'
import styles from './OcrResult.module.css'

const PdfPage = ({ fileId, page }: { fileId: string; page: number }) => {
  const canvas = useRef<HTMLCanvasElement>(null)
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null)
  const [error, setError] = useState('')
  const [renderedKey, setRenderedKey] = useState('')
  const ready = renderedKey === `${fileId}:${page}`
  useEffect(() => {
    let alive = true
    let destroy: undefined | (() => void)
    setDoc(null)
    setError('')
    setRenderedKey('')
    void import('pdfjs-dist')
      .then((pdf) => {
        if (!alive) {
          return
        }
        pdf.GlobalWorkerOptions.workerSrc = new URL('pdf.worker.min.mjs', document.baseURI).href
        const task = pdf.getDocument({ url: assetUrl(fileId) })
        destroy = () => {
          void task.destroy()
        }
        return task.promise.then((value) => {
          if (alive) {
            setDoc(value)
          }
        })
      })
      .catch((e) => {
        if (alive) {
          setError((e as Error).message)
        }
      })
    return () => {
      alive = false
      destroy?.()
    }
  }, [fileId])
  useEffect(() => {
    let alive = true
    let cancel: undefined | (() => void)
    setRenderedKey('')
    setError('')
    if (!doc) {
      return
    }
    void doc
      .getPage(page + 1)
      .then((value) => {
        if (!alive || !canvas.current) {
          return
        }
        const viewport = value.getViewport({ scale: 1.5 })
        const target = canvas.current
        target.width = viewport.width
        target.height = viewport.height
        const task = value.render({ canvas: target, viewport })
        cancel = () => task.cancel()
        return task.promise.then(() => {
          if (alive) {
            setRenderedKey(`${fileId}:${page}`)
          }
        })
      })
      .catch((e) => {
        if (alive) {
          setError((e as Error).message)
        }
      })
    return () => {
      alive = false
      cancel?.()
    }
  }, [doc, page, fileId])
  return (
    <>
      {error ? <p role="alert">原文加载失败：{error}。可下载原文件查看。</p> : null}
      {!ready && !error ? <p role="status">正在加载第 {page + 1} 页…</p> : null}
      <canvas
        ref={canvas}
        aria-label={`PDF 原文第 ${page + 1} 页`}
        data-ready={ready}
        style={{ display: ready ? 'block' : 'none' }}
      />
    </>
  )
}

export const OcrResult = ({
  documents,
  assets,
}: {
  documents: NonNullable<Result['documents']>
  assets: Asset[]
}) => {
  const [docIndex, setDocIndex] = useState(0),
    [pageIndex, setPageIndex] = useState(0),
    [regionIndex, setRegionIndex] = useState<number | null>(null)
  const source = useRef<HTMLDivElement>(null)
  const doc = documents[docIndex] ?? documents[0]
  const pages = useMemo(
    () => doc?.pages.map((page) => ({ ...page, regions: parseOcr(page.text) })) ?? [],
    [doc]
  )
  const page = pages[pageIndex] ?? pages[0]
  if (!doc || !page) {
    return <p>没有页面结果</p>
  }
  const asset = assets.find((f) => f.id === doc.fileId)
  const selected = regionIndex === null ? undefined : page.regions[regionIndex]
  const select = (p: number, r: number) => {
    setPageIndex(p)
    setRegionIndex(r)
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
            setRegionIndex(null)
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
              setRegionIndex(null)
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
        点击或选择右侧文字，左侧自动显示对应原文页；识别结果含区域坐标时会高亮原文位置。
      </p>
      <div className={styles.columns}>
        <div className={styles.source} ref={source}>
          <strong>原文 · 第 {page.index + 1} 页</strong>
          <div className={styles.preview}>
            {asset?.mime === 'application/pdf' || doc.name.toLowerCase().endsWith('.pdf') ? (
              <PdfPage fileId={doc.fileId} page={page.index} />
            ) : asset?.mime.startsWith('image/') ? (
              <img src={assetUrl(doc.fileId)} alt={doc.name} />
            ) : (
              <p>此格式可下载原文件查看。</p>
            )}
            {selected ? overlay(selected) : null}
          </div>
          <a href={assetUrl(doc.fileId)} download>
            下载原文件
          </a>
          {regionIndex !== null && !selected?.box ? (
            <p className={styles.hint}>当前文字未返回区域坐标，已定位到对应页。</p>
          ) : null}
        </div>
        <div className={styles.recognized} aria-label="Markdown 识别结果">
          {pages.map((p, pi) => (
            <section key={p.index}>
              <h3>第 {p.index + 1} 页</h3>
              {p.regions.map((r, ri) => (
                <div
                  key={ri}
                  role="button"
                  tabIndex={0}
                  aria-label={`定位第 ${p.index + 1} 页区域 ${ri + 1}`}
                  aria-pressed={pageIndex === pi && regionIndex === ri}
                  className={styles.regionText}
                  onClick={() => select(pi, ri)}
                  onMouseUp={() => select(pi, ri)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      select(pi, ri)
                    }
                  }}
                >
                  <Markdown
                    content={r.text}
                    cacheKey={`${doc.fileId}:${p.index}:${ri}`}
                    loading={false}
                    disableLink={false}
                  />
                </div>
              ))}
            </section>
          ))}
        </div>
      </div>
    </div>
  )
}
