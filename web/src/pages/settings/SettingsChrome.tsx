import { createContext, useContext } from 'react'
import { createPortal } from 'react-dom'
import type { ReactNode } from 'react'

/**
 * What a settings tab may ask of the shell around it.
 *
 * The header sits ABOVE the tab strip — one title, one status card, one Save button, whichever tab
 * is open — so the actions belong to the page but the place they are drawn belongs to the layout.
 * Rather than lifting each tab's state into the layout, the layout lends the tab a DOM node and the
 * tab portals into it: no state travels upward, and a tab that renders nothing simply leaves the
 * slot empty.
 *
 * `setDirty` is the other half. The layout owns the unsaved-changes guard because it is the layout
 * that renders the tab links, and the guard has to be in place before one of them is clicked.
 */
export interface SettingsChromeValue {
  /** Null until the layout has mounted its header row. */
  headerSlot: HTMLElement | null
  /** Report unsaved edits. Stable — safe to call from an effect. */
  setDirty: (dirty: boolean) => void
}

export const SettingsChromeContext = createContext<SettingsChromeValue>({
  headerSlot: null,
  setDirty: () => {},
})

export function useSettingsChrome(): SettingsChromeValue {
  return useContext(SettingsChromeContext)
}

/**
 * Put a tab's own actions in the shared header, above the tab strip.
 *
 * Renders nothing until the layout has handed over the node, which is one render later than the
 * first paint of the tab — deliberately, because the alternative is every tab reaching for a DOM
 * node that may not exist yet.
 */
export function SettingsHeaderActions({ children }: { children: ReactNode }) {
  const { headerSlot } = useSettingsChrome()
  if (!headerSlot) return null
  return createPortal(<>{children}</>, headerSlot)
}
