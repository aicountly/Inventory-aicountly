import { describe, expect, it } from 'vitest'
import type { RevisionSummary, ValuationRevision } from '../../../services/valuationApi'
import {
  BOOKS_STATE_SHEET_LABEL,
  DELTA_MEANING,
  HIGH_IMPACT_THRESHOLD,
  PENDING_ATTENTION_THRESHOLD,
  ackProgress,
  ackSelection,
  booksFilterQuery,
  booksState,
  buildActions,
  buildInsights,
  clearPatch,
  deltaDirection,
  dominantTrigger,
  filterSummaryLines,
  findAnomalies,
  isQuickFilterActive,
  quickFilters,
  sourceSlices,
  timelineColumns,
  triggerLabel,
  weekStart,
} from './revisionsModel'

function revision(over: Partial<ValuationRevision> = {}): ValuationRevision {
  return {
    revision_id: 1,
    revision_uuid: 'uuid-1',
    job_id: 7,
    document_id: 500,
    line_id: 900,
    source_app: 'books',
    source_document_type: 'books.sales',
    source_document_id: 33,
    source_document_uuid: null,
    old_valuation_rate: 100,
    new_valuation_rate: 120,
    old_valuation_amount: 1000,
    new_valuation_amount: 1200,
    delta_amount: 200,
    published_at: null,
    acknowledged_at: null,
    acknowledged_by_app: null,
    created_at: '2026-06-18 10:24:00',
    document_no: 'GRN-1064',
    document_type: 'purchase',
    document_date: '2026-06-17',
    document_status: 'POSTED',
    source_document_no: 'PI-77',
    item_id: 12,
    direction: 'in',
    base_qty: 10,
    item_name: 'Steel coil',
    item_sku: 'RM-STEEL-01',
    acknowledged: false,
    ...over,
  }
}

function summary(over: Partial<RevisionSummary> = {}): RevisionSummary {
  const totals = {
    revisions: 8,
    net_delta: 4000,
    abs_delta: 10000,
    increased: 5,
    decreased: 3,
    unchanged: 0,
    items_affected: 4,
    items_increased: 3,
    items_decreased: 2,
    jobs: 2,
    acknowledged: 0,
    published_unacknowledged: 3,
    awaiting_publish: 5,
  }
  return {
    window: {
      from: '2026-06-15',
      to: '2026-06-18',
      days: 4,
      explicit_range: false,
      previous_from: '2026-06-11',
      previous_to: '2026-06-14',
    },
    filtered: totals,
    previous: { ...totals, revisions: 4, abs_delta: 25000 },
    company: {
      revisions: 40,
      acknowledged: 28,
      pending: 12,
      pending_delta: 4800,
      awaiting_publish: 5,
      published_unacknowledged: 7,
      created_last_7d: 9,
      created_prev_7d: 6,
      acknowledged_today: 28,
      acknowledged_yesterday: 16,
    },
    jobs: { queued: 2, running: 1, failed: 0 },
    timeline: [
      { day: '2026-06-15', revisions: 2, increased: 2, decreased: 0, net_delta: 500 },
      { day: '2026-06-18', revisions: 6, increased: 3, decreased: 3, net_delta: 3500 },
    ],
    by_source: [
      { document_type: 'purchase', revisions: 5, net_delta: 6000, abs_delta: 7000 },
      { document_type: 'stock_journal', revisions: 3, net_delta: -2000, abs_delta: 3000 },
    ],
    top_items: [
      {
        item_id: 12,
        item_name: 'Steel coil',
        item_sku: 'RM-STEEL-01',
        revisions: 3,
        net_delta: 3500,
        abs_delta: 3500,
        peak_change_pct: 7,
        baseline_pct: 6,
        baseline_samples: 9,
      },
    ],
    baseline_days: 30,
    triggers: [{ trigger_kind: 'backdated_document', jobs: 2, revisions: 6, net_delta: 4000, abs_delta: 9000 }],
    ...over,
  }
}

describe('Books lifecycle', () => {
  it('keeps generated, published and acknowledged apart', () => {
    expect(booksState(revision())).toBe('pending')
    expect(booksState(revision({ published_at: '2026-06-18 11:00:00' }))).toBe('published')
    expect(booksState(revision({ acknowledged: true, published_at: '2026-06-18 11:00:00' }))).toBe('applied')
    // A revision acknowledged without ever being published is still applied — the
    // acknowledgement is the fact that matters to reconciliation.
    expect(booksState(revision({ acknowledged: true }))).toBe('applied')
  })

  it('never renames a state the sheet has already printed', () => {
    expect(BOOKS_STATE_SHEET_LABEL).toEqual({
      pending: 'Pending',
      published: 'Published to Books',
      applied: 'Applied in Books',
    })
  })

  it('sends the legacy acknowledged flag alongside the new books filter', () => {
    expect(booksFilterQuery('unacknowledged')).toEqual({ books: 'unacknowledged', acknowledged: '0' })
    expect(booksFilterQuery('pending')).toEqual({ books: 'awaiting', acknowledged: '0' })
    expect(booksFilterQuery('published')).toEqual({ books: 'published', acknowledged: '0' })
    expect(booksFilterQuery('acknowledged')).toEqual({ books: 'acknowledged', acknowledged: '1' })
  })

  it('narrows nothing for "all", and nothing for a value it does not know', () => {
    expect(booksFilterQuery('all')).toEqual({})
    expect(booksFilterQuery('something-else')).toEqual({})
  })
})

describe('valuation delta', () => {
  it('reads a cost increase as pressure, not as a gain', () => {
    expect(deltaDirection(3500)).toBe('increase')
    expect(DELTA_MEANING.increase.tone).toBe('danger')
    expect(DELTA_MEANING.increase.srLabel).toBe('cost increase')
  })

  it('reads a cost decrease as relief', () => {
    expect(deltaDirection(-3500)).toBe('decrease')
    expect(DELTA_MEANING.decrease.tone).toBe('success')
  })

  it('treats a missing delta as no change rather than as a fall', () => {
    expect(deltaDirection(null)).toBe('flat')
    expect(deltaDirection(undefined)).toBe('flat')
    expect(deltaDirection(0)).toBe('flat')
  })
})

describe('acknowledgement selection', () => {
  const rows = [
    revision({ revision_id: 1, delta_amount: 200, published_at: '2026-06-18 09:00:00' }),
    revision({ revision_id: 2, delta_amount: -500 }),
    revision({ revision_id: 3, delta_amount: 900, acknowledged: true, acknowledged_at: '2026-06-18 10:00:00' }),
  ]

  it('never offers up a revision Books has already applied', () => {
    const picked = ackSelection(rows, new Set([1, 2, 3]))
    expect(picked.eligible.map((r) => r.revision_id)).toEqual([1, 2])
    expect(picked.ineligible.map((r) => r.revision_id)).toEqual([3])
  })

  it('sums the net and the gross movement of what will actually be acknowledged', () => {
    const picked = ackSelection(rows, new Set([1, 2, 3]))
    expect(picked.netDelta).toBe(-300)
    expect(picked.absDelta).toBe(700)
  })

  it('counts the eligible rows Books has never been sent', () => {
    expect(ackSelection(rows, new Set([1, 2])).awaitingPublish).toBe(1)
    expect(ackSelection(rows, new Set([1])).awaitingPublish).toBe(0)
  })

  it('ignores ids that are not on the page', () => {
    expect(ackSelection(rows, new Set([99])).eligible).toEqual([])
  })
})

describe('timeline', () => {
  it('puts the quiet days back so the axis is real time', () => {
    const cols = timelineColumns(summary())
    expect(cols.categories).toHaveLength(4)
    expect(cols.increased).toEqual([2, 0, 0, 3])
    expect(cols.decreased).toEqual([0, 0, 0, 3])
    expect(cols.empty).toBe(false)
  })

  it('reports an empty window rather than drawing an empty chart', () => {
    expect(timelineColumns(summary({ timeline: [] })).empty).toBe(true)
    expect(timelineColumns(null).empty).toBe(true)
  })

  it('says so when the range is longer than it will draw, instead of clipping quietly', () => {
    const long = summary({ window: { ...summary().window, from: '2025-01-01', to: '2026-06-18' } })
    const cols = timelineColumns(long, 90)
    expect(cols.categories).toHaveLength(90)
    expect(cols.truncated).toBe(true)
    expect(timelineColumns(summary()).truncated).toBe(false)
  })
})

describe('impact by source', () => {
  it('slices gross movement, so a rise and an equal fall both count as work', () => {
    const slices = sourceSlices(summary(), (code) => `label:${code}`)
    expect(slices.map((s) => s.value)).toEqual([7000, 3000])
    expect(slices[0].share).toBeCloseTo(70)
    expect(slices[1].netDelta).toBe(-2000)
    expect(slices[0].label).toBe('label:purchase')
  })

  it('drops sources that moved nothing', () => {
    const s = summary({ by_source: [{ document_type: 'purchase', revisions: 2, net_delta: 0, abs_delta: 0 }] })
    expect(sourceSlices(s, () => 'x')).toEqual([])
  })
})

describe('acknowledgement progress', () => {
  it('reports the company backlog, not the filtered page', () => {
    const p = ackProgress(summary())!
    expect(p.total).toBe(40)
    expect(p.acknowledged).toBe(28)
    expect(p.percent).toBe(70)
  })

  it('asks for action once the backlog passes the threshold', () => {
    expect(ackProgress(summary())!.state).toBe('attention')
    expect(PENDING_ATTENTION_THRESHOLD).toBe(10)
  })

  it('does not congratulate anybody while work is outstanding', () => {
    const few = summary({ company: { ...summary().company, pending: 3, acknowledged: 37 } })
    expect(ackProgress(few)!.state).toBe('on-track')
    const clear = summary({ company: { ...summary().company, pending: 0, acknowledged: 40 } })
    expect(ackProgress(clear)!.state).toBe('clear')
    expect(ackProgress(clear)!.percent).toBe(100)
  })

  it('calls an empty company 100% rather than dividing by zero', () => {
    const none = summary({ company: { ...summary().company, revisions: 0, acknowledged: 0, pending: 0 } })
    expect(ackProgress(none)!.percent).toBe(100)
  })
})

describe('anomaly detection', () => {
  const withItem = (over: Partial<RevisionSummary['top_items'][number]>) =>
    summary({ top_items: [{ ...summary().top_items[0], ...over }] })

  it('flags a move well past the item’s own baseline', () => {
    const found = findAnomalies(withItem({ peak_change_pct: 41, baseline_pct: 6, baseline_samples: 9 }))
    expect(found).toHaveLength(1)
  })

  it('stays quiet on an item with no history to compare against', () => {
    expect(findAnomalies(withItem({ peak_change_pct: 41, baseline_pct: 6, baseline_samples: 2 }))).toEqual([])
    expect(findAnomalies(withItem({ peak_change_pct: 41, baseline_pct: null }))).toEqual([])
  })

  it('does not call a tiny drift an anomaly just because it is a big multiple', () => {
    expect(findAnomalies(withItem({ peak_change_pct: 0.9, baseline_pct: 0.1, baseline_samples: 40 }))).toEqual([])
  })

  it('does not flag a move that is merely above average', () => {
    expect(findAnomalies(withItem({ peak_change_pct: 11, baseline_pct: 9, baseline_samples: 9 }))).toEqual([])
  })
})

describe('insights', () => {
  it('states the driver as a share of the movement in view', () => {
    const driver = buildInsights(summary()).find((i) => i.kind === 'driver')!
    expect(driver.title).toBe('RM-STEEL-01')
    expect(driver.amount).toBe(3500)
    expect(driver.detail).toContain('35% of the valuation movement in view')
    expect(driver.link?.to).toBe('/valuation/cost-layers?item_id=12')
  })

  it('never claims a cause — the strongest word available is "possible contributor"', () => {
    const contributor = buildInsights(summary()).find((i) => i.kind === 'contributor')!
    expect(contributor.label).toBe('Possible contributor')
    expect(contributor.title).toBe('Back-dated document postings')
    expect(contributor.detail).toContain('6 of the 8 revisions in view')
    expect(buildInsights(summary()).some((i) => /because/i.test(i.detail))).toBe(false)
  })

  it('offers no contributor at all when no trigger accounts for half the revisions', () => {
    const split = summary({
      triggers: [
        { trigger_kind: 'backdated_document', jobs: 1, revisions: 3, net_delta: 1, abs_delta: 1 },
        { trigger_kind: 'revaluation', jobs: 1, revisions: 2, net_delta: 1, abs_delta: 1 },
      ],
    })
    expect(buildInsights(split).some((i) => i.kind === 'contributor')).toBe(false)
    expect(dominantTrigger(split.triggers, 8)).toBeNull()
  })

  it('surfaces the reconciliation exposure while anything is unacknowledged', () => {
    const backlog = buildInsights(summary()).find((i) => i.kind === 'backlog')!
    expect(backlog.title).toBe('12 awaiting Books')
    expect(backlog.link?.to).toBe('/reconciliation/posting-status')
  })

  it('says nothing at all without data', () => {
    expect(buildInsights(null)).toEqual([])
  })

  it('names the recorded trigger, and humanises one it has no phrase for', () => {
    expect(triggerLabel('method_change')).toBe('A valuation method change')
    expect(triggerLabel('some_new_kind')).toBe('Some new kind')
    expect(triggerLabel(null)).toBe('Recalculations with no recorded trigger')
  })
})

describe('recommended actions', () => {
  it('only suggests a screen the reader is allowed to open', () => {
    const none = buildActions(summary(), { recalculate: false, reconcile: false })
    expect(none.every((a) => !a.to.startsWith('/reconciliation'))).toBe(true)

    const all = buildActions(summary(), { recalculate: true, reconcile: true })
    expect(all.some((a) => a.to === '/reconciliation/posting-status')).toBe(true)
  })

  it('points at the jobs behind the revisions rather than at a dead end', () => {
    const actions = buildActions(summary(), { recalculate: true, reconcile: true })
    expect(actions.some((a) => a.to === '/valuation/recalculations?trigger_kind=backdated_document')).toBe(true)
  })

  it('is capped so the panel cannot become a to-do list', () => {
    expect(buildActions(summary(), { recalculate: true, reconcile: true }).length).toBeLessThanOrEqual(4)
  })
})

describe('quick filters', () => {
  it('starts the week on Monday', () => {
    // 2026-06-18 is a Thursday.
    expect(weekStart(new Date(2026, 5, 18))).toBe('2026-06-15')
    // A Sunday belongs to the week that just ended, not the one about to start.
    expect(weekStart(new Date(2026, 5, 21))).toBe('2026-06-15')
  })

  it('states its threshold instead of moving with the data', () => {
    const chip = quickFilters(new Date(2026, 5, 18)).find((c) => c.key === 'high-impact')!
    expect(chip.patch).toEqual({ min_abs_delta: String(HIGH_IMPACT_THRESHOLD) })
  })

  it('knows when it is already on, and clears only its own keys', () => {
    const chip = quickFilters().find((c) => c.key === 'this-week')!
    expect(isQuickFilterActive(chip, {})).toBe(false)
    expect(isQuickFilterActive(chip, chip.patch)).toBe(true)
    expect(clearPatch(chip)).toEqual({ from: '', to: '' })
  })
})

describe('sheet meta lines', () => {
  it('always prints the Books state, so a sheet cannot read as the whole year', () => {
    expect(filterSummaryLines({}, '', {})[0]).toBe('Books: Awaiting Books')
  })

  it('prints only the filters that are set', () => {
    const lines = filterSummaryLines(
      { books: 'acknowledged', job_id: '427', min_abs_delta: '10000', from: '2026-06-01', to: '2026-06-30' },
      'steel',
      { warehouse: 'Main store' },
    )
    expect(lines).toContain('Books: Applied in Books')
    expect(lines).toContain('Search: steel')
    expect(lines).toContain('Warehouse: Main store')
    expect(lines).toContain('Recalculation job: #427')
    expect(lines).toContain('Minimum absolute delta: 10000')
    expect(lines.some((l) => l.startsWith('Created between'))).toBe(true)
    expect(lines.some((l) => l.startsWith('Document id'))).toBe(false)
  })
})
