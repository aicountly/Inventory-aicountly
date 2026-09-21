import { describe, expect, it } from 'vitest'
import type { RecalcJob, RecalcSummary } from '../../../services/valuationApi'
import {
  booksPublication,
  formatCogsDelta,
  formatElapsed,
  hasSettledCounts,
  isLive,
  recalcFailure,
  recalcKpis,
  recalcMode,
  recalcReference,
  recalcScope,
  rowAbilities,
  shareOfTotal,
  statusMeta,
  triggerLabel,
} from './recalculationModel'

function job(over: Partial<RecalcJob> = {}): RecalcJob {
  return {
    job_id: 12,
    job_uuid: 'b0c1d2e3-0000-4000-8000-000000000000',
    cmp_id: 1,
    fy_id: 3,
    item_id: null,
    warehouse_id: null,
    from_date: '2026-08-01',
    to_date: null,
    trigger_kind: 'manual',
    trigger_document_id: null,
    status: 'COMPLETED',
    dry_run: false,
    affected_line_count: 318,
    revised_line_count: 306,
    cogs_delta: 48620,
    failure_reason: null,
    remarks: null,
    requested_by: 'user-a',
    cancelled_by: null,
    created_at: '2026-09-18 14:00:00',
    started_at: '2026-09-18 14:30:00',
    finished_at: '2026-09-18 14:32:10',
    item_name: null,
    item_sku: null,
    warehouse_name: null,
    trigger_document_no: null,
    trigger_document_type: null,
    affected_document_ids: [],
    ...over,
  }
}

describe('status', () => {
  it('gives every status a word as well as a colour', () => {
    for (const status of ['QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED']) {
      const meta = statusMeta(status)
      expect(meta.label).toBeTruthy()
      expect(meta.icon).toBeTruthy()
      expect(meta.hint).toBeTruthy()
    }
  })

  it('does not crash on a status the server invented', () => {
    expect(statusMeta('SOMETHING_NEW').label).toBe('Something new')
    expect(statusMeta(null).label).toBe('Unknown')
  })

  it('treats only queued and running as still moving', () => {
    expect(isLive(job({ status: 'QUEUED' }))).toBe(true)
    expect(isLive(job({ status: 'RUNNING' }))).toBe(true)
    expect(isLive(job({ status: 'COMPLETED' }))).toBe(false)
    expect(isLive(job({ status: 'FAILED' }))).toBe(false)
    expect(isLive(job({ status: 'CANCELLED' }))).toBe(false)
  })
})

describe('reference', () => {
  it('pads the job id the way the screen and the export both print it', () => {
    expect(recalcReference(12)).toBe('RC-00012')
    expect(recalcReference(4182)).toBe('RC-04182')
    // Never truncated: a six-digit id is still the id.
    expect(recalcReference(123456)).toBe('RC-123456')
  })
})

describe('scope', () => {
  it('reads all items when neither item nor warehouse is set', () => {
    const scope = recalcScope(job())
    expect(scope.type).toBe('all')
    expect(scope.label).toBe('All items')
    expect(scope.to).toBeNull()
  })

  it('links an item scope to that item’s cost layers', () => {
    const scope = recalcScope(job({ item_id: 7, item_name: 'Dimmer', item_sku: 'DIM-001' }))
    expect(scope.type).toBe('item')
    expect(scope.label).toBe('Dimmer · DIM-001')
    expect(scope.to).toBe('/valuation/cost-layers?item_id=7')
  })

  it('names a warehouse rather than printing its id', () => {
    expect(recalcScope(job({ warehouse_id: 4, warehouse_name: 'Mumbai' })).label).toBe('Mumbai')
    expect(recalcScope(job({ warehouse_id: 4 })).label).toBe('Warehouse #4')
  })
})

describe('mode', () => {
  it('says what each mode does to Books', () => {
    expect(recalcMode({ dry_run: true }).label).toBe('Dry run')
    expect(recalcMode({ dry_run: true }).hint).toMatch(/nothing is published/i)
    expect(recalcMode({ dry_run: false }).label).toBe('Live run')
    expect(recalcMode({ dry_run: false }).hint).toMatch(/publishes/i)
  })
})

describe('trigger', () => {
  it('uses the reader’s words for the stored vocabulary', () => {
    expect(triggerLabel('backdated_document')).toBe('Back-dated document')
    expect(triggerLabel('method_change')).toBe('Valuation method change')
    // An unknown kind is humanised, not dropped.
    expect(triggerLabel('some_new_kind')).toBe('Some new kind')
    expect(triggerLabel(null)).toBe('—')
  })
})

describe('failure', () => {
  it('shortens the engine’s two named refusals without losing them', () => {
    const unpriced = recalcFailure(
      'Refusing to recalculate: 3 inward line(s) carry no cost to replay (line_id 1, 2, 3). Record a cost on them first.',
    )
    expect(unpriced?.short).toBe('Unpriced inward lines')
    expect(unpriced?.full).toContain('line_id 1, 2, 3')

    const transfer = recalcFailure(
      'Refusing to recalculate: the receiving side of a transfer (line_id 9, document_id 4) has no cost to replay.',
    )
    expect(transfer?.short).toBe('Unpaired transfer')
  })

  it('clips an unknown reason to its first sentence', () => {
    const f = recalcFailure('Deadlock detected on inv_stock_movements. Retry the job in a moment.')
    expect(f?.short).toBe('Deadlock detected on inv_stock_movements.')
    expect(f?.full).toContain('Retry the job')
  })

  it('is null when nothing failed', () => {
    expect(recalcFailure(null)).toBeNull()
    expect(recalcFailure('   ')).toBeNull()
  })
})

describe('COGS delta', () => {
  it('signs the figure and carries the company currency', () => {
    expect(formatCogsDelta(48620)).toBe('₹ 48,620.00')
    expect(formatCogsDelta(-12450)).toBe('-₹ 12,450.00')
    expect(formatCogsDelta(0)).toBe('₹ 0.00')
  })

  it('never assumes rupees', () => {
    expect(formatCogsDelta(1000, 'USD')).toBe('$ 1,000.00')
  })

  it('shows nothing rather than zero when there is no figure', () => {
    expect(formatCogsDelta(null)).toBe('—')
    expect(formatCogsDelta(undefined)).toBe('—')
  })
})

describe('counts', () => {
  it('only trusts counts from a replay that actually finished', () => {
    expect(hasSettledCounts(job({ status: 'COMPLETED' }))).toBe(true)
    // A failed job's counts are the row's defaults — the service writes the
    // status and the reason and nothing else — so showing them would read as
    // "it examined the period and found nothing", which is the opposite of
    // what happened.
    expect(hasSettledCounts(job({ status: 'FAILED' }))).toBe(false)
    expect(hasSettledCounts(job({ status: 'CANCELLED' }))).toBe(false)
    expect(hasSettledCounts(job({ status: 'RUNNING' }))).toBe(false)
    expect(hasSettledCounts(job({ status: 'QUEUED' }))).toBe(false)
  })
})

describe('KPIs', () => {
  const summary: RecalcSummary = {
    total: 12,
    by_status: { QUEUED: 1, RUNNING: 0, COMPLETED: 10, FAILED: 1, CANCELLED: 0 },
    in_progress: 1,
    cogs_delta: 248320,
    queued_this_month: 3,
    queued_prev_month: 2,
    cogs_delta_this_month: 60000,
    cogs_delta_prev_month: 53000,
    month_start: '2026-09-01',
    ignores_status_filter: true,
  }

  it('reads the server’s figures straight through', () => {
    const k = recalcKpis(summary)
    expect(k.total).toBe(12)
    expect(k.completed).toBe(10)
    expect(k.failed).toBe(1)
    expect(k.inProgress).toBe(1)
    expect(k.cogsDelta).toBe(248320)
  })

  it('rates success over jobs that reached an outcome, not over the queue', () => {
    // 10 completed of 11 settled (10 completed + 1 failed) — the queued job is
    // not counted against the rate.
    expect(recalcKpis(summary).successRate).toBeCloseTo(90.909, 2)
  })

  it('has no success rate at all before anything finishes', () => {
    const k = recalcKpis({ ...summary, by_status: { QUEUED: 2 }, total: 2 })
    expect(k.successRate).toBeNull()
  })

  it('reports a share only when there is something to share of', () => {
    expect(shareOfTotal(1, 12)).toBe('8% of total')
    expect(shareOfTotal(0, 0)).toBeNull()
  })
})

describe('row actions', () => {
  it('mirrors what the server accepts for each status', () => {
    const queued = rowAbilities(job({ status: 'QUEUED' }), true)
    expect(queued).toMatchObject({ canRun: true, canCancel: true, canRetry: false })

    const failed = rowAbilities(job({ status: 'FAILED' }), true)
    expect(failed).toMatchObject({ canRetry: true, canRun: false, canCancel: false })

    // A running replay has no checkpoint to stop at, and a completed one is
    // undone by recalculating again — neither may offer Cancel.
    expect(rowAbilities(job({ status: 'RUNNING' }), true).canCancel).toBe(false)
    expect(rowAbilities(job({ status: 'COMPLETED' }), true).canCancel).toBe(false)
  })

  it('offers nothing that changes data without the permission', () => {
    const able = rowAbilities(job({ status: 'QUEUED' }), false)
    expect(able.canRun).toBe(false)
    expect(able.canCancel).toBe(false)
    expect(able.canRetry).toBe(false)
  })

  it('links to revisions only when a live run actually wrote some', () => {
    expect(rowAbilities(job({ revised_line_count: 306 }), true).canOpenRevisions).toBe(true)
    expect(rowAbilities(job({ dry_run: true }), true).canOpenRevisions).toBe(false)
    expect(rowAbilities(job({ revised_line_count: 0 }), true).canOpenRevisions).toBe(false)
  })
})

describe('Books publication', () => {
  it('never claims a dry run published anything', () => {
    expect(booksPublication(job({ dry_run: true })).state).toBe('not_applicable')
  })

  it('separates “nothing changed” from “not yet acknowledged”', () => {
    expect(
      booksPublication(job({ revision_summary: { revisions: 0, delta_total: 0, unacknowledged: 0, published: 0 } })).state,
    ).toBe('nothing_to_publish')
    expect(
      booksPublication(job({ revision_summary: { revisions: 5, delta_total: 10, unacknowledged: 0, published: 5 } })).state,
    ).toBe('published')
    expect(
      booksPublication(job({ revision_summary: { revisions: 5, delta_total: 10, unacknowledged: 2, published: 5 } })).state,
    ).toBe('partly_acknowledged')
    expect(
      booksPublication(job({ revision_summary: { revisions: 5, delta_total: 10, unacknowledged: 5, published: 0 } })).state,
    ).toBe('pending')
  })

  it('says nothing about Books for a job that has not completed', () => {
    expect(booksPublication(job({ status: 'FAILED' })).state).toBe('not_applicable')
  })
})

describe('elapsed', () => {
  const at = (iso: string) => Date.parse(iso.replace(' ', 'T'))

  it('measures between two stamps', () => {
    expect(formatElapsed('2026-09-18 14:30:00', '2026-09-18 14:30:42')).toBe('42s')
    expect(formatElapsed('2026-09-18 14:30:00', '2026-09-18 14:32:10')).toBe('2m 10s')
    expect(formatElapsed('2026-09-18 12:00:00', '2026-09-18 13:35:00')).toBe('1h 35m')
  })

  it('measures to now when a job has not finished', () => {
    expect(formatElapsed('2026-09-18 14:30:00', null, at('2026-09-18 14:30:30'))).toBe('30s')
  })

  it('refuses to invent a duration from a missing or broken stamp', () => {
    expect(formatElapsed(null)).toBeNull()
    expect(formatElapsed('not a date')).toBeNull()
    // A clock that reads before the start is a clock skew, not a negative run.
    expect(formatElapsed('2026-09-18 14:30:00', '2026-09-18 14:29:00')).toBeNull()
  })
})
