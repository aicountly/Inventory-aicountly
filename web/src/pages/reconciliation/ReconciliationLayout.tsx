import { Outlet } from 'react-router-dom'

/**
 * The reconciliation module's route shell.
 *
 * It deliberately holds no navigation of its own. The five tabs sit UNDER the
 * headline figures on each screen (`ReconciliationTabs`), where the figures
 * they belong to can be read first — a bar rendered here would always land
 * above the page title instead.
 */
export function ReconciliationLayout() {
  return <Outlet />
}

export default ReconciliationLayout
