/**
 * `/dashboard` — the Inventory overview.
 *
 * The screen itself lives in src/dashboard/OverviewDashboard.tsx; this module
 * stays as the route's entry point so src/router.tsx needs no edit (it is a
 * shared file several agents are working in). The previous hand-styled version
 * of this page — a flat list of `.kpi-tile` counters with no charts, no
 * skeletons and mostly un-clickable numbers — has been replaced wholesale.
 */
export { OverviewDashboard as default } from '../dashboard/OverviewDashboard'
