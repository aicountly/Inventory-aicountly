import { Outlet, useMatch } from 'react-router-dom'
import { MastersTabs } from './MastersTabs'

/**
 * Sub-navigation across the master screens plus the routed screen.
 *
 * The tab row is rendered here for every `/masters/*` child, but NOT for the
 * index: the landing page places the same `MastersTabs` below its summary
 * cards, and drawing it in both would give that screen two identical rows.
 */
export function MastersLayout() {
  const onIndex = useMatch({ path: '/masters', end: true }) !== null

  return (
    <div className="page">
      {onIndex ? null : <MastersTabs className="mb-3" />}
      <Outlet />
    </div>
  )
}
