import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { Icon } from './Icon'
import styles from './FilterableSelect.module.css'

export interface SelectOption {
  value: string
  label: string
  hint?: string
  group?: string
  groupLabel?: string
  disabled?: boolean
}

interface FilterableSelectProps {
  options: SelectOption[]
  value: string | null
  onChange: (value: string) => void
  placeholder?: string
  disabled?: boolean
  className?: string
  align?: 'start' | 'end'
  emptyText?: string
  ariaLabel?: string
  title?: string
  trigger?: (selected: SelectOption | null) => ReactNode
  size?: 'sm' | 'md'
}

interface Group {
  key: string
  label?: string
  items: Array<{ option: SelectOption; index: number }>
}

interface Position {
  left: number
  width: number
  maxHeight: number
  up: boolean
  top: number
  bottom: number
}

const GAP = 6
const MARGIN = 8

export function FilterableSelect({
  options,
  value,
  onChange,
  placeholder = '请选择',
  disabled = false,
  className,
  align = 'start',
  emptyText = '没有匹配项',
  ariaLabel,
  title,
  trigger,
  size = 'md',
}: FilterableSelectProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const [position, setPosition] = useState<Position | null>(null)

  const wrapRef = useRef<HTMLDivElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const listId = useId()

  const selected = useMemo(
    () => options.find((option) => option.value === value) ?? null,
    [options, value],
  )

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return options
    return options.filter((option) =>
      [option.label, option.hint, option.groupLabel]
        .filter(Boolean)
        .some((text) => (text as string).toLowerCase().includes(q)),
    )
  }, [options, query])

  const groups = useMemo<Group[]>(() => {
    const map = new Map<string, Group>()
    let index = 0
    for (const option of filtered) {
      const key = option.group ?? ''
      let group = map.get(key)
      if (!group) {
        group = { key, label: option.groupLabel, items: [] }
        map.set(key, group)
      }
      group.items.push({ option, index })
      index++
    }
    return [...map.values()]
  }, [filtered])

  const measure = () => {
    const el = wrapRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const spaceBelow = window.innerHeight - rect.bottom - MARGIN - GAP
    const spaceAbove = rect.top - MARGIN - GAP
    // 下方放不下完整列表且上方更宽敞时向上展开
    const up = spaceBelow < 240 && spaceAbove > spaceBelow
    const available = up ? spaceAbove : spaceBelow
    const maxHeight = Math.max(150, Math.min(360, available))
    const width = Math.min(Math.max(rect.width, 248), window.innerWidth - MARGIN * 2)
    let left = align === 'end' ? rect.right - width : rect.left
    left = Math.max(MARGIN, Math.min(left, window.innerWidth - width - MARGIN))
    setPosition({
      left,
      width,
      maxHeight,
      up,
      top: rect.bottom + GAP,
      bottom: window.innerHeight - rect.top + GAP,
    })
  }

  useEffect(() => {
    if (!open) return
    setQuery('')
    const initial = filtered.findIndex((option) => option.value === value)
    setActiveIndex(initial >= 0 ? initial : 0)
    measure()
    const timer = setTimeout(() => inputRef.current?.focus(), 0)
    return () => clearTimeout(timer)
    // 只在打开时初始化
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  useEffect(() => {
    if (!open) return
    let frame = 0
    const schedule = () => {
      if (frame) return
      frame = requestAnimationFrame(() => {
        frame = 0
        measure()
      })
    }
    window.addEventListener('resize', schedule)
    window.addEventListener('scroll', schedule, true)
    return () => {
      if (frame) cancelAnimationFrame(frame)
      window.removeEventListener('resize', schedule)
      window.removeEventListener('scroll', schedule, true)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node
      if (wrapRef.current?.contains(target)) return
      if (popoverRef.current?.contains(target)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    return () => document.removeEventListener('mousedown', onPointerDown)
  }, [open])

  useEffect(() => {
    if (!open) return
    const el = listRef.current?.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex, open])

  const moveActive = (delta: number) => {
    if (filtered.length === 0) return
    let next = activeIndex
    for (let step = 0; step < filtered.length; step++) {
      next = (next + delta + filtered.length) % filtered.length
      if (!filtered[next].disabled) break
    }
    setActiveIndex(next)
  }

  const commit = (option: SelectOption) => {
    if (option.disabled) return
    onChange(option.value)
    setOpen(false)
  }

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      moveActive(1)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      moveActive(-1)
    } else if (event.key === 'Enter') {
      event.preventDefault()
      const option = filtered[activeIndex]
      if (option) commit(option)
    } else if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      setOpen(false)
    } else if (event.key === 'Tab') {
      setOpen(false)
    }
  }

  const popover =
    open && position
      ? createPortal(
          <div
            ref={popoverRef}
            className={styles.popover}
            role="listbox"
            id={listId}
            style={{
              left: position.left,
              width: position.width,
              maxHeight: position.maxHeight,
              ...(position.up ? { bottom: position.bottom } : { top: position.top }),
            }}
          >
            <div className={styles.searchRow}>
              <Icon name="search" size={14} className={styles.searchIcon} />
              <input
                ref={inputRef}
                className={styles.search}
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value)
                  setActiveIndex(0)
                }}
                onKeyDown={onKeyDown}
                placeholder="搜索…"
                aria-label="搜索选项"
                spellCheck={false}
              />
              {query ? (
                <button
                  type="button"
                  className={styles.clear}
                  onClick={() => {
                    setQuery('')
                    inputRef.current?.focus()
                  }}
                  aria-label="清除搜索"
                >
                  <Icon name="close" size={12} />
                </button>
              ) : null}
            </div>

            <div className={styles.list} ref={listRef}>
              {filtered.length === 0 ? (
                <div className={styles.empty}>{emptyText}</div>
              ) : (
                groups.map((group) => (
                  <div key={group.key} className={styles.group}>
                    {group.label ? <div className={styles.groupLabel}>{group.label}</div> : null}
                    {group.items.map(({ option, index }) => (
                      <button
                        key={`${option.value}@${index}`}
                        type="button"
                        data-index={index}
                        role="option"
                        aria-selected={option.value === value}
                        className={[
                          styles.option,
                          index === activeIndex ? styles.active : '',
                          option.value === value ? styles.selected : '',
                          option.disabled ? styles.disabled : '',
                        ]
                          .filter(Boolean)
                          .join(' ')}
                        onMouseEnter={() => setActiveIndex(index)}
                        onClick={() => commit(option)}
                        disabled={option.disabled}
                      >
                        <span className={styles.optionMain}>
                          <span className={styles.optionLabel}>{option.label}</span>
                          {option.hint ? (
                            <span className={styles.optionHint}>{option.hint}</span>
                          ) : null}
                        </span>
                        {option.value === value ? (
                          <Icon name="check" size={14} className={styles.check} />
                        ) : null}
                      </button>
                    ))}
                  </div>
                ))
              )}
            </div>
          </div>,
          document.body,
        )
      : null

  return (
    <div ref={wrapRef} className={`${styles.wrap} ${className ?? ''}`}>
      <button
        type="button"
        className={`${styles.trigger} ${size === 'sm' ? styles.triggerSm : ''}`}
        onClick={() => !disabled && setOpen((prev) => !prev)}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        title={title}
      >
        <span className={styles.triggerContent}>
          {trigger ? (
            trigger(selected)
          ) : (
            <span className={selected ? styles.value : styles.placeholder}>
              {selected?.label ?? placeholder}
            </span>
          )}
        </span>
        <Icon name="chevron-down" size={14} className={styles.caret} />
      </button>
      {popover}
    </div>
  )
}
