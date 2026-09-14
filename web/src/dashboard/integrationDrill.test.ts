import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { IntegrationWidget } from './widgets/OpsWidgets'
import type { DashboardData } from '../services/dashboard'
import { RECALC_IN_PROGRESS, RECALC_STATUS_FILTERS } from '../services/valuationApi'
import { drill } from './kpiNavigation'

/**
 * The figure a user clicks and the rows they land on have to be the same set.
 *
 * `integration.recalculations_in_progress` is counted server-side as
 * QUEUED + RUNNING (DashboardController), so a drill-through that asks for
 * RUNNING alone lands on a shorter list than the number that was clicked —
 * which reads as data loss, not as a filter.
 */

const DATA = {
  integration: {
    outbox: { PENDING: 2 },
    outbox_pending: 2,
    outbox_failed: 0,
    inbound: {},
    unacknowledged_revisions: { count: 1, delta_total: 250 },
    recalculations_in_progress: 3,
  },
} as unknown as DashboardData

function render(): string {
  return renderToStaticMarkup(
    createElement(
      MemoryRouter,
      null,
      createElement(IntegrationWidget, {
        query: { data: DATA, loading: false, error: null, reload: () => {} },
      }),
    ),
  )
}

describe('the recalculations filter', () => {
  it('offers the value the dashboard links to, so the control is not left blank', () => {
    expect(RECALC_STATUS_FILTERS.map((o) => o.value)).toContain(RECALC_IN_PROGRESS)
    expect(decodeURIComponent(drill.recalculations(RECALC_IN_PROGRESS))).toContain(
      `status=${RECALC_IN_PROGRESS}`,
    )
  })
})

describe('the Books integration widget', () => {
  it('drills the recalculation count through to every status it counted', () => {
    const html = render()
    expect(html).toContain('Recalculations running')
    const href = /href="([^"]*recalculations[^"]*)"/.exec(html)?.[1] ?? ''
    expect(decodeURIComponent(href)).toBe('/valuation/recalculations?status=QUEUED,RUNNING')
  })

  it('links to the unfiltered list when nothing is running', () => {
    const idle = { ...DATA, integration: { ...DATA.integration, recalculations_in_progress: 0 } }
    const html = renderToStaticMarkup(
      createElement(
        MemoryRouter,
        null,
        createElement(IntegrationWidget, {
          query: { data: idle, loading: false, error: null, reload: () => {} },
        }),
      ),
    )
    const href = /href="([^"]*recalculations[^"]*)"/.exec(html)?.[1] ?? ''
    expect(href).toBe('/valuation/recalculations')
  })
})
