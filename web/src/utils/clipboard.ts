/**
 * Copy text to the clipboard, and say whether it worked.
 *
 * `navigator.clipboard` only exists in a secure context, so it is absent on a
 * plain-HTTP sandbox host and in the happy-dom test environment. The fallback
 * is the old `execCommand` path through an off-screen textarea, which still
 * works everywhere the modern API does not.
 *
 * Returns false rather than throwing: a copy that quietly fails is a bug, but
 * it is never worth taking a screen down over.
 */
export async function copyText(value: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value)
      return true
    }
  } catch {
    // Permission denied or a non-secure context — fall through.
  }

  try {
    const area = document.createElement('textarea')
    area.value = value
    area.setAttribute('readonly', '')
    // Off-screen rather than `display:none`: a hidden element cannot be selected.
    area.style.position = 'fixed'
    area.style.top = '-1000px'
    area.style.opacity = '0'
    document.body.appendChild(area)
    area.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(area)
    return ok
  } catch {
    return false
  }
}
