import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import type { FocusEvent, MouseEvent, RefObject } from 'react'
import { isTypingTarget } from './isTypingTarget'
import { TABLE_ROW_SELECTED } from '../styles/designTokens'

/**
 * Tally-style list keyboard navigation — the thing that makes a register feel
 * like accounting software rather than a web page: arrow keys walk the rows,
 * Enter opens the focused one, Enter from the search box opens the first hit,
 * and F12 fires the row's quick action.
 *
 * Ported from books-react-app/web/src/keyboard/useListKeyboardNav.js. Stable
 * across renders on purpose: callbacks live in refs so the focus-reset and
 * keydown effects fire only when `resetKey`, `enabled` or `autoSelectFirst`
 * actually change — a list that re-binds on every render loses key presses.
 */

export type ResetKey = string | number | null | undefined | readonly (string | number)[]

function normalizeResetKey(resetKey: ResetKey): string {
  if (resetKey == null) return ''
  return Array.isArray(resetKey) ? resetKey.join('|') : String(resetKey)
}

function clampIndex(index: number, length: number): number {
  if (length <= 0) return -1
  return Math.max(0, Math.min(index, length - 1))
}

function firstFocusIndex<T>(rows: readonly T[], isRowActivatable?: (row: T) => boolean): number {
  if (!rows.length) return -1
  if (typeof isRowActivatable !== 'function') return 0
  const idx = rows.findIndex((row) => isRowActivatable(row))
  return idx >= 0 ? idx : 0
}

export interface ListRowProps {
  tabIndex: number
  'data-row-index': number
  className: string
  ref: (el: HTMLTableRowElement | null) => void
  onFocus: (e: FocusEvent<HTMLTableRowElement>) => void
  onClick: (e: MouseEvent<HTMLTableRowElement>) => void
}

export interface ListKeyboardNavOptions<T> {
  rows: readonly T[]
  onActivate?: (row: T, index: number) => void
  isRowActivatable?: (row: T) => boolean
  onQuickAction?: (row: T, index: number) => void
  /** Change it (page, filters, sort) to move focus back to the first row. */
  resetKey?: ResetKey
  searchInputRef?: RefObject<HTMLInputElement | null>
  autoSelectFirst?: boolean
  enabled?: boolean
  listenScope?: 'window' | 'container'
  containerRef?: RefObject<HTMLDivElement | null>
}

export interface ListKeyboardNav<T> {
  containerRef: RefObject<HTMLDivElement | null>
  focusIndex: number
  setFocusIndex: (index: number) => void
  getRowProps: (row: T, index: number) => Partial<ListRowProps>
  focusRow: (index: number) => void
  activateAt: (index: number) => void
}

export function useListKeyboardNav<T>({
  rows,
  onActivate,
  isRowActivatable,
  onQuickAction,
  resetKey,
  searchInputRef,
  autoSelectFirst = true,
  enabled = true,
  listenScope = 'window',
  containerRef: externalContainerRef,
}: ListKeyboardNavOptions<T>): ListKeyboardNav<T> {
  const internalContainerRef = useRef<HTMLDivElement | null>(null)
  const containerRef = externalContainerRef ?? internalContainerRef
  const rowRefs = useRef(new Map<number, HTMLTableRowElement>())
  const propsCacheRef = useRef(new Map<number, { isSelected: boolean; props: ListRowProps }>())
  const [focusIndex, setFocusIndexState] = useState(-1)
  const focusIndexRef = useRef(-1)
  const resetToken = normalizeResetKey(resetKey)

  const rowsRef = useRef(rows)
  const isRowActivatableRef = useRef(isRowActivatable)
  const onActivateRef = useRef(onActivate)
  const onQuickActionRef = useRef(onQuickAction)
  const searchInputElRef = useRef<HTMLInputElement | null>(null)

  useLayoutEffect(() => {
    rowsRef.current = rows
    isRowActivatableRef.current = isRowActivatable
    onActivateRef.current = onActivate
    onQuickActionRef.current = onQuickAction
    searchInputElRef.current = searchInputRef?.current ?? null
  })

  useEffect(() => {
    focusIndexRef.current = focusIndex
  }, [focusIndex])

  const registerRowRef = useCallback((index: number, el: HTMLTableRowElement | null) => {
    if (el) rowRefs.current.set(index, el)
    else rowRefs.current.delete(index)
  }, [])

  const moveFocusTo = useCallback((next: number) => {
    focusIndexRef.current = next
    setFocusIndexState(next)
    if (next < 0) return
    requestAnimationFrame(() => {
      const el = rowRefs.current.get(next)
      el?.focus?.({ preventScroll: true })
      el?.scrollIntoView?.({ block: 'nearest' })
    })
  }, [])

  const focusRow = useCallback(
    (index: number) => moveFocusTo(clampIndex(index, rowsRef.current.length)),
    [moveFocusTo],
  )

  // Focus reset — fires only on resetKey / enabled / autoSelectFirst change.
  useEffect(() => {
    rowRefs.current.clear()
    propsCacheRef.current.clear()
    if (!enabled || !autoSelectFirst) {
      setFocusIndexState(-1)
      focusIndexRef.current = -1
      return
    }
    const initial = firstFocusIndex(rowsRef.current, isRowActivatableRef.current)
    focusIndexRef.current = initial
    setFocusIndexState(initial)
    if (initial < 0) return
    requestAnimationFrame(() => {
      const active = document.activeElement
      // Never steal focus from the search box the user is typing in.
      if (searchInputElRef.current && active === searchInputElRef.current) return
      if (isTypingTarget(active)) return
      rowRefs.current.get(initial)?.focus?.({ preventScroll: true })
    })
  }, [resetToken, enabled, autoSelectFirst])

  const canActivate = useCallback((row: T | undefined): boolean => {
    if (!row) return false
    const fn = isRowActivatableRef.current
    return typeof fn === 'function' ? fn(row) : true
  }, [])

  const activateAt = useCallback(
    (index: number) => {
      const row = rowsRef.current[index]
      if (!row || !canActivate(row)) return
      onActivateRef.current?.(row, index)
    },
    [canActivate],
  )

  useEffect(() => {
    if (!enabled) return undefined

    const onKey = (e: KeyboardEvent) => {
      if (!['ArrowDown', 'ArrowUp', 'Enter', 'F12', 'Home', 'End'].includes(e.key)) return
      const liveRows = rowsRef.current
      if (liveRows.length === 0) return

      const searchEl = searchInputElRef.current
      const isSearchFocused = Boolean(searchEl) && document.activeElement === searchEl
      if (isTypingTarget(e.target) && !isSearchFocused) return

      if (listenScope === 'container') {
        const container = containerRef.current
        const active = document.activeElement
        if (!container?.contains(active) && active !== searchEl) return
      }

      const current = focusIndexRef.current

      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        const delta = e.key === 'ArrowDown' ? 1 : -1
        moveFocusTo(clampIndex(current < 0 ? 0 : current + delta, liveRows.length))
        return
      }

      if (e.key === 'Home' || e.key === 'End') {
        if (isSearchFocused) return
        e.preventDefault()
        moveFocusTo(e.key === 'Home' ? 0 : liveRows.length - 1)
        return
      }

      if (e.key === 'Enter') {
        // Enter from the search box opens the top hit — the fastest path from
        // "type a code" to "the document is open".
        if (isSearchFocused) {
          if (canActivate(liveRows[0])) {
            e.preventDefault()
            onActivateRef.current?.(liveRows[0], 0)
          }
          return
        }
        const idx = clampIndex(current < 0 ? 0 : current, liveRows.length)
        if (idx >= 0 && canActivate(liveRows[idx])) {
          e.preventDefault()
          onActivateRef.current?.(liveRows[idx], idx)
        }
        return
      }

      if (e.key === 'F12') {
        const idx = clampIndex(current < 0 ? 0 : current, liveRows.length)
        if (idx >= 0 && canActivate(liveRows[idx]) && onQuickActionRef.current) {
          e.preventDefault()
          onQuickActionRef.current(liveRows[idx], idx)
        }
      }
    }

    const target: Window | HTMLElement | null =
      listenScope === 'window' ? window : containerRef.current
    if (!target) return undefined
    target.addEventListener('keydown', onKey as EventListener)
    return () => target.removeEventListener('keydown', onKey as EventListener)
  }, [enabled, listenScope, containerRef, canActivate, moveFocusTo])

  // Stable per-row prop objects: same identity for the same (index, selected)
  // tuple, so rows do not re-render on unrelated state changes.
  const getRowProps = useCallback(
    (_row: T, index: number): Partial<ListRowProps> => {
      if (!enabled) return {}
      const isSelected = index === focusIndex
      const cached = propsCacheRef.current.get(index)
      if (cached && cached.isSelected === isSelected) return cached.props
      const props: ListRowProps = {
        tabIndex: isSelected ? 0 : -1,
        'data-row-index': index,
        className: isSelected ? TABLE_ROW_SELECTED : '',
        ref: (el) => registerRowRef(index, el),
        onFocus: () => {
          focusIndexRef.current = index
          setFocusIndexState(index)
        },
        onClick: (e) => {
          e.stopPropagation()
          focusIndexRef.current = index
          setFocusIndexState(index)
          rowRefs.current.get(index)?.focus?.({ preventScroll: true })
        },
      }
      propsCacheRef.current.set(index, { isSelected, props })
      return props
    },
    [enabled, focusIndex, registerRowRef],
  )

  return useMemo(
    () => ({
      containerRef,
      focusIndex,
      setFocusIndex: setFocusIndexState,
      getRowProps,
      focusRow,
      activateAt,
    }),
    [containerRef, focusIndex, getRowProps, focusRow, activateAt],
  )
}
