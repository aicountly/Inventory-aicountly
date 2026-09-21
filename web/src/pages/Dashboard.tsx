/**
 * `/dashboard` — the five Inventory dashboards.
 *
 * The screen itself lives in src/dashboard/DashboardPage.tsx; this module stays
 * as the route's entry point so src/router.tsx needs no edit (it is a shared
 * file several agents work in). Which of the five is shown comes from
 * `?view=overview|operations|replenishment|valuation|controls`, so every
 * existing link to a bare `/dashboard` keeps working and lands on the user's
 * remembered dashboard.
 */
export { DashboardPage as default } from '../dashboard/DashboardPage'
