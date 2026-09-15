/** True when the event target is a text-entry control (skip global shortcuts). */
export function isTypingTarget(el: EventTarget | null): boolean {
  if (!el || typeof el !== 'object') return false
  const node = el as HTMLElement
  const tag = node.tagName?.toLowerCase()
  if (tag === 'input') {
    const type = ((node as HTMLInputElement).type || 'text').toLowerCase()
    // These take key presses but not text — shortcuts should still fire.
    if (
      ['checkbox', 'radio', 'button', 'submit', 'reset', 'file', 'hidden', 'range', 'color'].includes(
        type,
      )
    ) {
      return false
    }
    return true
  }
  if (tag === 'textarea' || tag === 'select') return true
  if (node.isContentEditable) return true
  if (node.closest?.('[data-combo-open="true"]')) return true
  if (node.closest?.('[data-keyboard-ignore="true"]')) return false
  return false
}

/** True when focus is inside a modal, drawer or command palette. */
export function isInOverlay(el: EventTarget | null): boolean {
  const node = el as HTMLElement | null
  return Boolean(node?.closest?.('[data-keyboard-overlay="true"]'))
}
