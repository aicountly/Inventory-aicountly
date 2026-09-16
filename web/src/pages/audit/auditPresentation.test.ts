import { describe, expect, it } from 'vitest'
import type { AuditLogRow } from '../../services/auditApi'
import {
  actionTone,
  actorIdentity,
  buildChanges,
  changedFields,
  entityIdentity,
  formatChangeValue,
  shortId,
  sourceIdentity,
  splitTimestamp,
} from './auditPresentation'

function row(overrides: Partial<AuditLogRow> = {}): AuditLogRow {
  return {
    audit_id: 1,
    cmp_id: 1,
    entity_type: 'document',
    entity_id: 71621,
    entity_uuid: null,
    action: 'document.post',
    actor_uuid: '7',
    source_app: 'books',
    source_document_type: 'books.sales',
    source_document_id: 71958,
    source_document_uuid: null,
    reason: null,
    approval_ref: null,
    reversal_ref: null,
    before: null,
    after: null,
    meta: null,
    request_id: 'ab7657170d9c4e11',
    ip_address: '106.193.24.18',
    created_at: '2026-09-16 10:15:42',
    ...overrides,
  }
}

describe('actionTone', () => {
  it('colours by the verb', () => {
    expect(actionTone('document.post')).toBe('success')
    expect(actionTone('document.create')).toBe('info')
    expect(actionTone('document.update')).toBe('warning')
    expect(actionTone('document.delete')).toBe('danger')
    expect(actionTone('settings.update')).toBe('warning')
  })

  /** The domain wins: a reconciliation run is not "a run" in general. */
  it('lets a domain claim its own colour', () => {
    expect(actionTone('reconciliation.run')).toBe('violet')
    expect(actionTone('valuation.run')).toBe('teal')
    expect(actionTone('access.grant')).toBe('indigo')
  })

  /**
   * An event type this build has never seen must not borrow the green that
   * means "posted" on the rest of the screen.
   */
  it('leaves an unknown action neutral rather than guessing', () => {
    expect(actionTone('warp.core.breach')).toBe('neutral')
    expect(actionTone('mystery')).toBe('neutral')
  })
})

describe('actorIdentity', () => {
  it('names a bare user id the way the rest of Inventory does', () => {
    const actor = actorIdentity({ actor_uuid: '7' })
    expect(actor.kind).toBe('user')
    expect(actor.label).toBe('User #7')
    expect(actor.filterValue).toBe('7')
  })

  /**
   * "No actor" and "a scheduled job" are different answers to the question an
   * auditor is asking, so they must not render the same.
   */
  it('tells the system apart from an automation', () => {
    const system = actorIdentity({ actor_uuid: null })
    expect(system.kind).toBe('system')
    expect(system.label).toBe('System')
    // Nothing to filter by: there is no actor value on the row.
    expect(system.filterValue).toBeNull()

    const cron = actorIdentity({ actor_uuid: 'cli:inventory-reconcile' })
    expect(cron.kind).toBe('automation')
    expect(cron.label).toBe('cli:inventory-reconcile')
    expect(cron.initials).toBe('IR')
    expect(cron.filterValue).toBe('cli:inventory-reconcile')
  })

  it('shortens a uuid on screen but keeps the whole one to filter and hover', () => {
    const uuid = '9f1c2d3e-4a5b-6c7d-8e9f-0a1b2c3d4e5f'
    const actor = actorIdentity({ actor_uuid: uuid })
    expect(actor.label.length).toBeLessThan(uuid.length)
    expect(actor.filterValue).toBe(uuid)
    expect(actor.title).toBe(uuid)
  })
})

describe('entityIdentity', () => {
  it('links the entity types that have a screen', () => {
    expect(entityIdentity(row()).to).toBe('/documents/71621')
    expect(entityIdentity(row({ entity_type: 'item', entity_id: 12 })).to).toBe('/items/12')
  })

  /** A link to a screen that does not exist reads as "this record was deleted". */
  it('does not link an entity type with no screen behind it', () => {
    expect(entityIdentity(row({ entity_type: 'period_lock', entity_id: 4 })).to).toBeNull()
    expect(entityIdentity(row({ entity_type: 'period_lock', entity_id: 4 })).label).toBe(
      'Period lock #4',
    )
  })

  it('takes the subtitle from the snapshot, not from the Books voucher', () => {
    const withType = entityIdentity(row({ after: { document_type: 'sales_invoice' } }))
    expect(withType.subtitle).toBe('Sales invoice')
    // `source_document_type` is still books.sales here, and is deliberately unused.
    expect(entityIdentity(row()).subtitle).toBeNull()
  })
})

describe('sourceIdentity', () => {
  it('splits the app, the module and the voucher reference', () => {
    expect(sourceIdentity(row())).toEqual({ label: 'books · books.sales', reference: '#71958' })
  })

  it('reports nothing rather than an empty string when no source was recorded', () => {
    expect(sourceIdentity(row({ source_app: null })).label).toBeNull()
  })
})

describe('changedFields', () => {
  it('reads the keys of the after snapshot', () => {
    expect(changedFields(row({ after: { status: 'posted', valuation_total: 1 } }))).toEqual([
      'status',
      'valuation_total',
    ])
  })

  it('is empty, not undefined, when the entry carries no snapshot', () => {
    expect(changedFields(row())).toEqual([])
  })
})

describe('buildChanges', () => {
  it('reports what actually differs, and flags the rest as unchanged', () => {
    const changes = buildChanges(
      { status: 'draft', valuation_total: 58200, doc_no: 'SI-1' },
      { status: 'posted', valuation_total: 59750, doc_no: 'SI-1' },
    )
    const changed = changes.filter((c) => c.kind !== 'unchanged')
    expect(changed.map((c) => c.path)).toEqual(['status', 'valuation_total'])
    expect(changed[0]).toMatchObject({ before: 'draft', after: 'posted', kind: 'changed' })
    expect(changes.find((c) => c.path === 'doc_no')?.kind).toBe('unchanged')
  })

  it('distinguishes an added key from a removed one', () => {
    const changes = buildChanges({ gone: 1 }, { fresh: 2 })
    expect(changes.find((c) => c.path === 'gone')?.kind).toBe('removed')
    expect(changes.find((c) => c.path === 'fresh')?.kind).toBe('added')
  })

  it('walks into nested objects and arrays with a readable path', () => {
    const changes = buildChanges(
      { lines: [{ quantity: 2 }], warehouse: { id: 3 } },
      { lines: [{ quantity: 5 }], warehouse: { id: 4 } },
    )
    const paths = changes.filter((c) => c.kind !== 'unchanged').map((c) => c.path)
    expect(paths).toContain('lines[0].quantity')
    expect(paths).toContain('warehouse.id')
  })

  /**
   * A fifty-line document expanded in full buries the two fields the reader
   * came for. Past the depth limit the subtree is reported as one change and
   * the Raw JSON tab carries the rest.
   */
  it('stops descending rather than producing hundreds of rows', () => {
    const deep = (v: number) => ({ a: { b: { c: { d: { e: { f: v } } } } } })
    const changes = buildChanges(deep(1), deep(2)).filter((c) => c.kind !== 'unchanged')
    expect(changes).toHaveLength(1)
    expect(changes[0].path).toBe('a.b.c.d')
  })

  it('has nothing to say about an entry with no snapshots at all', () => {
    expect(buildChanges(null, null)).toEqual([])
  })

  /**
   * A creation and a deletion are the commonest entries in the log. Both have
   * one side missing, and reporting that as a single opaque row holding the
   * whole record as JSON is the one shape the diff must not take.
   */
  it('treats a creation as every field added and a deletion as every field removed', () => {
    const created = buildChanges(null, { status: 'draft', doc_no: 'SI-1' })
    expect(created.map((c) => c.kind)).toEqual(['added', 'added'])
    expect(created.map((c) => c.path).sort()).toEqual(['doc_no', 'status'])

    const deleted = buildChanges({ status: 'draft' }, null)
    expect(deleted).toEqual([{ path: 'status', before: 'draft', after: undefined, kind: 'removed' }])
  })
})

describe('formatChangeValue', () => {
  it('keeps null and empty string distinguishable', () => {
    expect(formatChangeValue(null)).toBe('null')
    expect(formatChangeValue('')).toBe('""')
    // `undefined` means the key was absent, which the caller draws as an em dash.
    expect(formatChangeValue(undefined)).toBeNull()
  })

  it('renders numbers and objects without throwing', () => {
    expect(formatChangeValue(59750)).toBe('59750')
    expect(formatChangeValue({ a: 1 })).toBe('{"a":1}')
  })
})

describe('splitTimestamp', () => {
  /**
   * The server sends company-local time as a plain string. Re-reading it in the
   * browser's zone would move every row on the screen by hours and contradict
   * the record it is displaying.
   */
  it('splits the stamp without shifting it into the reader zone', () => {
    expect(splitTimestamp('2026-09-16 10:15:42')).toEqual({ date: '16 Sept 2026', time: '10:15' })
    expect(splitTimestamp('2026-09-16T07:30:00')).toEqual({ date: '16 Sept 2026', time: '07:30' })
  })

  it('survives a date with no time on it', () => {
    expect(splitTimestamp('2026-09-16').time).toBeNull()
  })
})

describe('shortId', () => {
  it('trims a long identifier and leaves a short one alone', () => {
    expect(shortId('ab7657170d9c4e11')).toBe('ab7657170d9c')
    expect(shortId('req-3')).toBe('req-3')
  })
})
