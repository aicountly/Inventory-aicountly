/** Mac gets ⌘/⌥/⇧ glyphs with no separator; everyone else gets word labels joined by "+". */

interface NavigatorUAData {
  platform?: string
}

export function isMacPlatform(): boolean {
  if (typeof navigator === 'undefined') return false
  const uaData = (navigator as Navigator & { userAgentData?: NavigatorUAData }).userAgentData
  const platform = uaData?.platform || navigator.platform || navigator.userAgent || ''
  return /mac/i.test(platform)
}

const MAC_GLYPH: Record<string, string> = { ctrl: '⌘', cmd: '⌘', alt: '⌥', shift: '⇧', enter: '⏎', escape: 'Esc' }
const WORD_LABEL: Record<string, string> = { ctrl: 'Ctrl', cmd: 'Ctrl', alt: 'Alt', shift: 'Shift', enter: 'Enter', escape: 'Esc' }

/** `"ctrl+enter"` → `"⌘⏎"` on Mac, `"Ctrl+Enter"` elsewhere. */
export function comboLabel(combo: string, mac: boolean = isMacPlatform()): string {
  const parts = combo.split('+').map((p) => p.trim().toLowerCase())
  const labelled = parts.map((p) => (mac ? (MAC_GLYPH[p] ?? p.toUpperCase()) : (WORD_LABEL[p] ?? (p.length === 1 ? p.toUpperCase() : p.charAt(0).toUpperCase() + p.slice(1)))))
  return labelled.join(mac ? '' : '+')
}
