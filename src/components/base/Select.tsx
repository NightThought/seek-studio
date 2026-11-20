import clsx from 'clsx'
import { useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useAnchoredPosition, useDismiss } from './anchored.js'
import { IconCheckOutline16, IconChevronDownOutline14 } from './icons.js'
import styles from './Select.module.css'

export type SelectOption<T extends string> = {
  value: T
  label: string
  lang?: string
  icon?: ReactNode
}

const OptionLabel = ({ option }: { option: SelectOption<string> }) =>
  option.icon ? (
    <span className={styles.labelWithIcon} lang={option.lang}>
      <span className={styles.optionIcon} aria-hidden="true">
        {option.icon}
      </span>
      <span className={styles.labelText}>{option.label}</span>
    </span>
  ) : (
    <span lang={option.lang}>{option.label}</span>
  )

/**
 * 胶囊形选择器：触发器高 36px、圆角 18px、浅灰底，下拉菜单选中项右侧打勾；
 * 点外部或 Esc 关闭。value 不匹配任何选项时触发器显示 placeholder。
 */
export const Select = <T extends string>({
  value,
  options,
  onChange,
  placeholder,
  ariaLabel,
  className,
  disabled = false,
  matchTriggerWidth = false,
}: {
  value: T
  options: SelectOption<T>[]
  onChange: (value: T) => void
  placeholder?: string
  ariaLabel?: string
  className?: string
  disabled?: boolean
  matchTriggerWidth?: boolean
}) => {
  const [open, setOpen] = useState(false)
  const selectedIndex = options.findIndex((option) => option.value === value)
  const [activeIndex, setActiveIndex] = useState(selectedIndex >= 0 ? selectedIndex : 0)
  const current = selectedIndex >= 0 ? options[selectedIndex] : undefined
  // 菜单贴右侧展开（或与触发器等宽），最多 320px 高，超出在菜单内滚动
  const { anchorRef, floatingRef, position } = useAnchoredPosition<
    HTMLButtonElement,
    HTMLDivElement
  >(open, { align: 'end', maxHeight: 320, minSpace: 160, matchWidth: matchTriggerWidth })
  // Esc 只关菜单，不让外层弹窗一起关闭
  useDismiss(open, [anchorRef, floatingRef], () => setOpen(false), { captureEscape: true })

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        className={clsx(styles.trigger, open && styles.open, className)}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => {
          setOpen((prev) => {
            if (!prev) {
              setActiveIndex(selectedIndex >= 0 ? selectedIndex : 0)
            }
            return !prev
          })
        }}
        onKeyDown={(event) => {
          if (disabled || !options.length) {
            return
          }
          if (event.key === 'ArrowDown') {
            event.preventDefault()
            if (!open) {
              setOpen(true)
              setActiveIndex(selectedIndex >= 0 ? selectedIndex : 0)
            } else {
              setActiveIndex((prev) => (prev + 1) % options.length)
            }
          } else if (event.key === 'ArrowUp') {
            event.preventDefault()
            if (!open) {
              setOpen(true)
              setActiveIndex(selectedIndex >= 0 ? selectedIndex : options.length - 1)
            } else {
              setActiveIndex((prev) => (prev - 1 + options.length) % options.length)
            }
          } else if (open && (event.key === 'Enter' || event.key === ' ')) {
            event.preventDefault()
            const chosen = options[activeIndex]
            if (chosen) {
              setOpen(false)
              onChange(chosen.value)
            }
          }
        }}
      >
        {current ? (
          <OptionLabel option={current} />
        ) : (
          <span className={styles.placeholder}>{placeholder}</span>
        )}
        <span className={styles.arrow}>
          <IconChevronDownOutline14 />
        </span>
      </button>
      {open && !disabled
        ? createPortal(
            <div
              ref={floatingRef}
              className={styles.menu}
              style={position ?? undefined}
              role="listbox"
              aria-label={ariaLabel}
            >
              {options.map((option, index) => (
                <div
                  key={option.value}
                  role="option"
                  lang={option.lang}
                  aria-selected={option.value === value}
                  className={clsx(styles.option, index === activeIndex && styles.optionActive)}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => {
                    setOpen(false)
                    onChange(option.value)
                  }}
                >
                  <OptionLabel option={option} />
                  {option.value === value ? <IconCheckOutline16 /> : null}
                </div>
              ))}
            </div>,
            document.body
          )
        : null}
    </>
  )
}
