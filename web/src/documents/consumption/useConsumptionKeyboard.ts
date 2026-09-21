import { useMemo } from 'react'
import { useKeyboardScope } from '../../keyboard/useKeyboardScope'

export interface ConsumptionKeyboardOptions {
  onSavePost?: () => void
  onAddLine?: () => void
  onToggleBarcode?: () => void
  enabled?: boolean
}

/**
 * Consumption's own shortcuts, layered on top of the app's standard entry-form scope
 * (Ctrl+S save / Escape cancel, from `useFormKeyboard`) rather than replacing it:
 * Ctrl/Cmd+Enter = Save & Post, Alt+A = Add line, Alt+B = toggle the barcode scanner.
 */
export function useConsumptionKeyboard({ onSavePost, onAddLine, onToggleBarcode, enabled = true }: ConsumptionKeyboardOptions): void {
  const bindings = useMemo(
    () => ({
      'ctrl+enter': (e: KeyboardEvent) => {
        if (!enabled || !onSavePost) return
        e.preventDefault()
        onSavePost()
      },
      'alt+a': (e: KeyboardEvent) => {
        if (!enabled || !onAddLine) return
        e.preventDefault()
        onAddLine()
      },
      'alt+b': (e: KeyboardEvent) => {
        if (!enabled || !onToggleBarcode) return
        e.preventDefault()
        onToggleBarcode()
      },
    }),
    [enabled, onSavePost, onAddLine, onToggleBarcode],
  )

  useKeyboardScope('form', bindings, { allowInInput: true })
}
