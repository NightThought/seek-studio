import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist'
import { assetUrl } from './api.js'
import type { OcrBox } from './ocr.js'
import {
  completePdfLayout,
  overlapsPdfFigure,
  pdfImageBoxes,
  type DisplayRegion,
  readPdfTextLines,
} from './ocrLayout.js'
import styles from './OcrResult.module.css'

export type OriginalFormat = 'pdf' | 'image'
type Original =
  | { format: 'pdf'; pdf: PDFDocumentProxy }
  | { format: 'image'; image: HTMLImageElement }
type OriginalLoad = { fileId: string; format: OriginalFormat; source?: Original; failed?: true }

/** One decoded source feeds the page preview and all figures of the selected file. */
export const useOcrOriginal = (fileId: string | undefined, format: OriginalFormat | undefined) => {
  const [loaded, setLoaded] = useState<OriginalLoad | null>(null)
  useEffect(() => {
    setLoaded(null)
    if (!fileId || !format) {
      return
    }
    let active = true
    let release: (() => void) | undefined
    const load = async () => {
      try {
        if (format === 'image') {
          const image = new Image()
          image.src = assetUrl(fileId)
          release = () => image.removeAttribute('src')
          await image.decode()
          if (active) {
            setLoaded({ fileId, format, source: { format, image } })
          }
        } else {
          const pdfjs = await import('pdfjs-dist')
          if (!active) {
            return
          }
          pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdf.worker.min.mjs', document.baseURI).href
          const task = pdfjs.getDocument({ url: assetUrl(fileId) })
          release = () => {
            void task.destroy().catch(() => undefined)
          }
          const pdf = await task.promise
          if (active) {
            setLoaded({ fileId, format, source: { format, pdf } })
          }
        }
      } catch {
        if (active) {
          setLoaded({ fileId, format, failed: true })
        }
      }
    }
    void load()
    return () => {
      active = false
      release?.()
    }
  }, [fileId, format])
  return loaded?.fileId === fileId && loaded?.format === format ? loaded : null
}

const maxSide = 1920
const pixelRect = (
  width: number,
  height: number,
  [left, top, right, bottom]: OcrBox = [0, 0, 1000, 1000]
) => ({
  x: (left * width) / 1000,
  y: (top * height) / 1000,
  width: ((right - left) * width) / 1000,
  height: ((bottom - top) * height) / 1000,
})

const drawPdfPage = async (
  pdfPage: PDFPageProxy,
  canvas: HTMLCanvasElement,
  signal: AbortSignal,
  box?: OcrBox,
  maxSize = maxSide
) => {
  signal.throwIfAborted()
  const base = pdfPage.getViewport({ scale: 1 })
  const area = pixelRect(base.width, base.height, box)
  const scale = Math.min(1.5, maxSize / Math.max(area.width, area.height))
  const viewport = pdfPage.getViewport({ scale })
  const crop = pixelRect(viewport.width, viewport.height, box)
  canvas.width = Math.ceil(crop.width)
  canvas.height = Math.ceil(crop.height)
  const task = pdfPage.render({
    canvas,
    viewport,
    recordImages: !box,
    // Page rotation is already in the viewport. Translate its rendered coordinates to the crop.
    transform: box ? [1, 0, 0, 1, -crop.x, -crop.y] : undefined,
  })
  const cancel = () => task.cancel()
  signal.addEventListener('abort', cancel, { once: true })
  try {
    await task.promise
  } finally {
    signal.removeEventListener('abort', cancel)
  }
}

const drawOriginal = async (
  source: Original,
  page: number,
  canvas: HTMLCanvasElement,
  signal: AbortSignal,
  box?: OcrBox
) => {
  if (source.format === 'image') {
    if (page !== 0) {
      throw new Error('只能预览图片的首页')
    }
    const { image } = source
    const area = pixelRect(image.naturalWidth, image.naturalHeight, box)
    const scale = Math.min(1, maxSide / Math.max(area.width, area.height))
    canvas.width = Math.ceil(area.width * scale)
    canvas.height = Math.ceil(area.height * scale)
    const context = canvas.getContext('2d')
    if (!context) {
      throw new Error('无法绘制图片')
    }
    context.drawImage(
      image,
      area.x,
      area.y,
      area.width,
      area.height,
      0,
      0,
      canvas.width,
      canvas.height
    )
    return
  }

  await drawPdfPage(await source.pdf.getPage(page + 1), canvas, signal, box)
}

const useNearViewport = (element: RefObject<HTMLElement>, enabled: boolean) => {
  const [nearby, setNearby] = useState(false)
  useEffect(() => {
    const target = element.current
    if (!target || !enabled || nearby) {
      return
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          observer.disconnect()
          setNearby(true)
        }
      },
      { rootMargin: '200px 0px' }
    )
    observer.observe(target)
    return () => observer.disconnect()
  }, [element, enabled, nearby])
  return nearby
}

export const OcrPageSection = ({
  original,
  page,
  pageKey,
  regions,
  onLayout,
  children,
}: {
  original: OriginalLoad | null
  page: number
  pageKey: string
  regions: DisplayRegion[]
  onLayout: (pageKey: string, regions: DisplayRegion[]) => void
  children: ReactNode
}) => {
  const element = useRef<HTMLElement>(null)
  const pdf = original?.source?.format === 'pdf' ? original.source.pdf : null
  const nearby = useNearViewport(element, Boolean(pdf))
  useEffect(() => {
    if (!pdf || !nearby) {
      return
    }
    const controller = new AbortController()
    const { signal } = controller
    const inspect = async () => {
      const source = await pdf.getPage(page + 1)
      signal.throwIfAborted()
      if (!source.imageCoordinates) {
        const canvas = document.createElement('canvas')
        try {
          await drawPdfPage(source, canvas, signal, undefined, 360)
        } finally {
          canvas.width = 0
        }
      }
      const images = pdfImageBoxes(source.imageCoordinates ?? null)
      if (!images.length) {
        return
      }
      const lines = regions.some((region) => overlapsPdfFigure(region, images))
        ? await readPdfTextLines(source).catch(() => [])
        : []
      const result = completePdfLayout(regions, images, lines)
      if (!signal.aborted && result !== regions) {
        onLayout(pageKey, result)
      }
    }
    // Keep the OCR output usable if the original PDF has no readable layout metadata.
    void inspect().catch(() => undefined)
    return () => controller.abort()
  }, [pdf, nearby, page, pageKey, regions, onLayout])
  return <section ref={element}>{children}</section>
}

export const OcrPagePreview = ({
  original,
  page,
  label,
}: {
  original: OriginalLoad | null
  page: number
  label: string
}) => {
  const canvas = useRef<HTMLCanvasElement>(null)
  const [frame, setFrame] = useState<{ source: Original; page: number; failed?: true } | null>(null)
  const source = original?.source
  const current = frame?.source === source && frame?.page === page ? frame : null
  const ready = Boolean(current && !current.failed)
  const failed = original?.failed || current?.failed
  useEffect(() => {
    const target = canvas.current
    if (!source || !target) {
      return
    }
    const controller = new AbortController()
    void drawOriginal(source, page, target, controller.signal)
      .then(() => {
        if (!controller.signal.aborted) {
          setFrame({ source, page })
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setFrame({ source, page, failed: true })
        }
      })
    return () => controller.abort()
  }, [source, page])
  return (
    <>
      {failed ? <p role="alert">原文加载失败，可下载原文件查看。</p> : null}
      {!ready && !failed ? <p role="status">正在加载第 {page + 1} 页…</p> : null}
      <canvas ref={canvas} role="img" aria-label={label} data-ready={ready} hidden={!ready} />
    </>
  )
}

const pngBlob = (canvas: HTMLCanvasElement) =>
  new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('无法生成插图'))))
  })

export const OcrFigure = ({
  original,
  format,
  page,
  box,
}: {
  original: OriginalLoad | null
  format: OriginalFormat | undefined
  page: number
  box: OcrBox | undefined
}) => {
  const element = useRef<HTMLDivElement>(null)
  const nearby = useNearViewport(element, Boolean(format && box))
  const [url, setUrl] = useState('')
  const [failed, setFailed] = useState(false)
  const source = original?.source

  useEffect(() => {
    if (!nearby || !source || !box) {
      return
    }
    const controller = new AbortController()
    const canvas = document.createElement('canvas')
    let objectUrl = ''
    setUrl('')
    setFailed(false)
    void drawOriginal(source, page, canvas, controller.signal, box)
      .then(() => pngBlob(canvas))
      .then((blob) => {
        if (!controller.signal.aborted) {
          objectUrl = URL.createObjectURL(blob)
          setUrl(objectUrl)
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setFailed(true)
        }
      })
      .finally(() => {
        canvas.width = 0
      })
    return () => {
      controller.abort()
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl)
      }
    }
  }, [nearby, source, page, box])

  return (
    <div ref={element} className={styles.figure}>
      {url ? (
        <img src={url} alt={`第 ${page + 1} 页原文插图`} draggable={false} />
      ) : (
        <span className={styles.figurePlaceholder}>
          {!box
            ? '此插图缺少可用的区域坐标'
            : !format
              ? '此插图可下载原文件查看'
              : failed || original?.failed
                ? '插图加载失败，可下载原文件查看'
                : '正在加载原文插图…'}
        </span>
      )}
    </div>
  )
}
