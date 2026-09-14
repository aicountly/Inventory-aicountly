/**
 * Sidebar collapse state, per browser.
 *
 * A rail that forgets it was collapsed on every navigation is worse than no
 * rail at all, and this is a per-device preference (a laptop user collapses
 * it, the same person on a wide monitor does not), so localStorage is right
 * and syncing it to the server would be wrong.
 */
const KEY = 'inventory.sidebar.collapsed'

export function readSidebarCollapsed(): boolean {
  try {
    return window.localStorage.getItem(KEY) === '1'
  } catch {
    return false
  }
}

export function writeSidebarCollapsed(collapsed: boolean): void {
  try {
    window.localStorage.setItem(KEY, collapsed ? '1' : '0')
  } catch {
    // Private mode / blocked storage — the choice still holds for this session.
  }
}
