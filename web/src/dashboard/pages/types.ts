import type { DashboardScopeState } from '../useDashboardScope'
import type { DashboardView } from '../views'

/**
 * What every dashboard section is handed.
 *
 * The shell (DashboardPage) owns the scope — the company, the as-at date, the
 * warehouse and the URL that carries them — and each section owns its own
 * requests, its own refresh and its own export. That split is deliberate: the
 * five dashboards read entirely different sources at entirely different costs,
 * and a shell that fetched for all of them would load five dashboards' worth of
 * work to show one.
 */
export interface DashboardSectionProps {
  scope: DashboardScopeState
  view: DashboardView
}
