import { useId, useState } from 'react'
import { IconCloseOutline16, IconPaperclipOutline16, IconUploadOutline14 } from '../base/icons.js'
import styles from './AppsStudio.module.css'

export const AppFilePicker = ({
  title,
  inputLabel,
  accept,
  limit,
  files,
  uploading,
  disabled,
  onUpload,
  onRemove,
}: {
  title: string
  inputLabel: string
  accept: string
  limit: number
  files: { id: string; name: string }[]
  uploading: boolean
  disabled: boolean
  onUpload: (files: FileList) => void
  onRemove: (id: string) => void
}) => {
  const id = useId()
  const [dragging, setDragging] = useState(false)
  const uploadLabel = uploading
    ? '正在上传…'
    : limit === 1 && files.length
      ? '更换录音或拖入文件'
      : files.length
        ? '继续添加或拖入文件'
        : '选择文件或拖到这里'

  return (
    <div className={styles.filePicker}>
      <div className={styles.fileHeader}>
        <label htmlFor={id}>{title}</label>
        {files.length ? (
          <span>
            {files.length} / {limit}
          </span>
        ) : null}
      </div>
      <div
        className={styles.uploadZone}
        data-dragging={dragging && !disabled}
        data-disabled={disabled}
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes('Files')) {
            e.preventDefault()
            e.stopPropagation()
            e.dataTransfer.dropEffect = disabled ? 'none' : 'copy'
            setDragging(!disabled)
          }
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault()
          e.stopPropagation()
          setDragging(false)
          if (!disabled && e.dataTransfer.files.length) {
            onUpload(e.dataTransfer.files)
          }
        }}
      >
        <input
          id={id}
          type="file"
          aria-label={inputLabel}
          aria-describedby={`${id}-hint`}
          accept={accept}
          multiple={limit > 1}
          disabled={disabled}
          onChange={(e) => {
            if (e.target.files?.length) {
              onUpload(e.target.files)
            }
            e.target.value = ''
          }}
        />
        <span className={styles.uploadIcon} aria-hidden="true">
          <IconUploadOutline14 />
        </span>
        <div className={styles.uploadCopy}>
          <strong aria-live="polite">{uploadLabel}</strong>
          <span id={`${id}-hint`}>
            {limit === 1 ? '音频或 MP4 · 每次 1 个' : `最多 ${limit} 个文件`} · 单个不超过 100 MiB
          </span>
        </div>
      </div>
      {files.length ? (
        <ul className={styles.files} aria-label={`${title}列表`}>
          {files.map(({ id, name }) => (
            <li key={id}>
              <span aria-hidden="true">
                <IconPaperclipOutline16 />
              </span>
              <span className={styles.fileName} title={name}>
                {name}
              </span>
              <button
                type="button"
                aria-label={`移除文件 ${name}`}
                disabled={disabled}
                onClick={() => onRemove(id)}
              >
                <IconCloseOutline16 />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
