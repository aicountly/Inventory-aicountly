import { useEffect, useRef } from 'react'
import type { RefObject } from 'react'

const FOCUSABLE =
  'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),[tabindex]:not([tabindex="-1"])'

function getFocusables(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (el) => el.offsetParent !== null || el.closest('[role="dialog"]'),
  )
}

function pickInitialFocus(dialog: HTMLElement): HTMLElement | null {
  const focusables = getFocusables(dialog)
  if (focusables.length === 0) return null
  const isCloseButton = (el: HTMLElement) =>
    el.getAttribute('aria-label') === 'Close' || Boolean(el.closest('[data-modal-close]'))
  const field = focusables.find(
    (el) => !isCloseButton(el) && ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName),
  )
  if (field) return field
  return focusables.find((el) => !isCloseButton(el)) ?? focusables[0]
}

export interface ModalKeyboardOptions {
  initialFocusRef?: RefObject<HTMLElement | null>
}

/**
 * Focus trap + Escape close for dialogs. Initial focus runs once per opening,
 * never on a re-render — otherwise focus is yanked away mid-typing.
 */
export function useModalKeyboard(
  open: boolean,
  onClose: (() => void) | undefined,
  dialogRef: RefObject<HTMLElement | null>,
  options: ModalKeyboardOptions = {},
): void {
  const previousFocusRef = useRef<HTMLElement | null>(null)
  const wasOpenRef = useRef(false)
  const onCloseRef = useRef(onClose)
  const initialFocusRef = options.initialFocusRef

  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  useEffect(() => {
    if (!open) {
      if (wasOpenRef.current) previousFocusRef.current?.focus?.()
      wasOpenRef.current = false
      return undefined
    }
    const justOpened = !wasOpenRef.current
    wasOpenRef.current = true
    if (!justOpened) return undefined

    previousFocusRef.current = document.activeElement as HTMLElement | null
    const t = setTimeout(() => {
      if (initialFocusRef?.current) {
        initialFocusRef.current.focus()
        return
      }
      const dialog = dialogRef.current
      if (dialog) pickInitialFocus(dialog)?.focus()
    }, 50)
    return () => clearTimeout(t)
    // Refs are stable; re-running on open is the whole contract.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  useEffect(() => {
    if (!open) return undefined
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        onCloseRef.current?.()
        return
      }
      if (e.key !== 'Tab') return
      const dialog = dialogRef.current
      if (!dialog) return
      const focusables = getFocusables(dialog)
      if (focusables.length === 0) return
      const first = focusables[0]
      const last = focusables[focusables.length - 1]
      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault()
          last.focus()
        }
      } else if (document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [open, dialogRef])
}
