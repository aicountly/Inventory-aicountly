import { describe, expect, it } from 'vitest'
import type { AuditLogRow } from '../../services/auditApi'
import { MASTER_DEFINITIONS } from './masterDefinitions'
import type { MasterDefinition } from './masterDefinitions'
import {
  formatRelativeTime,
  isWithinDays,
  masterActivity,
  masterHealth,
  recentlyUpdatedCount,
} from './mastersOverview'
import type { MasterStats } from './mastersOverview'

/**
 * The landing page promises that no figure on it is invented. These tests are
 * where that promise is kept: every "unknown" path has to survive as null all
 * the way to the caller, because the moment one of them returns 0 instead, the
 * screen starts making claims about a company's data that nobody checked.
 */

const NOW = Date.parse('2026-09-16T12:00:00Z')
const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

const iso = (offsetMs: number) => new Date(NOW - offsetMs).toISOString()

/** A definition with only the fields the model reads. */
function def(key: string, essential = false): MasterDefinition {
  return {
    key,
    title: key,
    description: '',
    route: `/masters/${key}`,
    icon: (() => null) as unknown as MasterDefinition['icon'],
    permissionSlug: key,
    auditEntity: key,
    createRoute: `/masters/${key}?new=1`,
    api: { list: async () => ({ data: [], meta: { total: 0, limit: 1, offset: 0 } }) },
    essential,
  }
}

function stats(entries: Record<string, { count: number | null; updatedAt?: string | null }>): MasterStats {
  const out: Record<string, { count: number | null; updatedAt: string | null; failed: boolean }> = {}
  for (const [key, value] of Object.entries(entries)) {
    out[key] = { count: value.count, updatedAt: value.updatedAt ?? null, failed: false }
  }
  return out
}

function auditRow(over: Partial<AuditLogRow>): AuditLogRow {
  return {
    audit_id: 1,
    cmp_id: 1,
    entity_type: 'brand',
    entity_id: 7,
    entity_uuid: null,
    action: 'brand.update',
    actor_uuid: null,
    source_app: null,
    source_document_type: null,
    source_document_id: null,
    source_document_uuid: null,
    reason: null,
    approval_ref: null,
    reversal_ref: null,
    before: null,
    after: null,
    meta: null,
    request_id: null,
    ip_address: null,
    created_at: iso(2 * HOUR),
    ...over,
  }
}

describe('formatRelativeTime', () => {
  it('has nothing to say about a missing or unparseable stamp', () => {
    expect(formatRelativeTime(null, NOW)).toBeNull()
    expect(formatRelativeTime(undefined, NOW)).toBeNull()
    expect(formatRelativeTime('', NOW)).toBeNull()
    expect(formatRelativeTime('not a date', NOW)).toBeNull()
  })

  it('spells the unit out, and singularises it', () => {
    expect(formatRelativeTime(iso(30_000), NOW)).toBe('just now')
    expect(formatRelativeTime(iso(MINUTE), NOW)).toBe('1 minute ago')
    expect(formatRelativeTime(iso(8 * MINUTE), NOW)).toBe('8 minutes ago')
    expect(formatRelativeTime(iso(HOUR), NOW)).toBe('1 hour ago')
    expect(formatRelativeTime(iso(6 * HOUR), NOW)).toBe('6 hours ago')
    expect(formatRelativeTime(iso(DAY), NOW)).toBe('1 day ago')
    expect(formatRelativeTime(iso(2 * DAY), NOW)).toBe('2 days ago')
    expect(formatRelativeTime(iso(45 * DAY), NOW)).toBe('1 month ago')
    expect(formatRelativeTime(iso(400 * DAY), NOW)).toBe('1 year ago')
  })

  it('reads a stamp from the future as "just now" rather than a negative age', () => {
    expect(formatRelativeTime(iso(-5 * MINUTE), NOW)).toBe('just now')
  })
})

describe('isWithinDays', () => {
  it('accepts the window and rejects everything outside it', () => {
    expect(isWithinDays(iso(2 * DAY), 7, NOW)).toBe(true)
    expect(isWithinDays(iso(8 * DAY), 7, NOW)).toBe(false)
    expect(isWithinDays(null, 7, NOW)).toBe(false)
    expect(isWithinDays('nonsense', 7, NOW)).toBe(false)
  })
})

describe('recentlyUpdatedCount', () => {
  const masters = [def('a'), def('b'), def('c')]

  it('is null when not one master could be read — never 0', () => {
    expect(recentlyUpdatedCount({}, masters, 7, NOW)).toBeNull()
    expect(recentlyUpdatedCount(stats({ a: { count: null } }), masters, 7, NOW)).toBeNull()
  })

  it('counts the master types touched inside the window', () => {
    const s = stats({
      a: { count: 4, updatedAt: iso(2 * DAY) },
      b: { count: 9, updatedAt: iso(20 * DAY) },
      c: { count: 1, updatedAt: iso(6 * HOUR) },
    })
    expect(recentlyUpdatedCount(s, masters, 7, NOW)).toBe(2)
  })

  it('is 0, not null, when the masters were read and none is recent', () => {
    const s = stats({ a: { count: 4, updatedAt: iso(30 * DAY) } })
    expect(recentlyUpdatedCount(s, masters, 7, NOW)).toBe(0)
  })
})

describe('masterHealth', () => {
  it('assesses nothing, and scores nothing, when no count came back', () => {
    const health = masterHealth({}, [def('a'), def('b', true)])
    expect(health.assessed).toBe(0)
    expect(health.percent).toBeNull()
    expect(health.label).toBe('Configuration overview')
    expect(health.message).toBeNull()
  })

  it('calls a master with records good, whether or not it is essential', () => {
    const health = masterHealth(stats({ a: { count: 3 }, b: { count: 1 } }), [def('a'), def('b', true)])
    expect(health).toMatchObject({ good: 2, review: 0, missing: 0, assessed: 2, percent: 100, label: 'Healthy' })
    expect(health.message).toBe('Great! Your master data is in good shape.')
  })

  it('separates an empty essential master from an empty optional one', () => {
    const health = masterHealth(stats({ a: { count: 0 }, b: { count: 0 }, c: { count: 5 } }), [
      def('a'),
      def('b', true),
      def('c'),
    ])
    expect(health).toMatchObject({ good: 1, review: 1, missing: 1, assessed: 3 })
    expect(health.byMaster).toEqual({ a: 'review', b: 'missing', c: 'good' })
    expect(health.percent).toBe(33)
    expect(health.label).toBe('Missing setup')
  })

  it('only says the data is in good shape when nothing is outstanding', () => {
    const review = masterHealth(stats({ a: { count: 0 }, b: { count: 2 } }), [def('a'), def('b')])
    expect(review.label).toBe('Need review')
    expect(review.message).toBe('1 optional master is still empty.')
    expect(review.message).not.toContain('good shape')
  })

  it('leaves a master it could not read out of the score entirely', () => {
    const health = masterHealth(stats({ a: { count: 2 }, b: { count: null } }), [def('a'), def('b', true)])
    expect(health.assessed).toBe(1)
    expect(health.percent).toBe(100)
    expect(health.missing).toBe(0)
  })
})

describe('masterActivity', () => {
  it('names the record from the snapshot the audit row carries', () => {
    const [entry] = masterActivity([auditRow({ after: { brand_id: 7, brand_name: 'Acme Electronics' } })])
    expect(entry).toMatchObject({ title: 'Brand updated', subject: 'Acme Electronics', to: '/masters/brands' })
  })

  it('falls back to the before snapshot, then to the id', () => {
    const [deleted] = masterActivity([
      auditRow({ action: 'brand.delete', before: { brand_name: 'Old label' }, after: null }),
    ])
    expect(deleted).toMatchObject({ title: 'Brand deleted', subject: 'Old label' })

    const [bare] = masterActivity([auditRow({ entity_id: 42, before: null, after: null })])
    expect(bare?.subject).toBe('#42')
  })

  it('knows each master by the column it keeps its name in', () => {
    const rows = [
      auditRow({ audit_id: 1, entity_type: 'item', action: 'item.create', after: { item_name: 'Wireless Mouse' } }),
      auditRow({ audit_id: 2, entity_type: 'warehouse', action: 'warehouse.update', after: { warehouse_name: 'Main Warehouse' } }),
      auditRow({ audit_id: 3, entity_type: 'item_group', action: 'item_group.create', after: { grp_name: 'Office Supplies' } }),
      auditRow({ audit_id: 4, entity_type: 'batch', action: 'batch.create', after: { batch_no: 'BATCH-2407-A' } }),
    ]
    expect(masterActivity(rows).map((a) => `${a.title}: ${a.subject}`)).toEqual([
      'Item created: Wireless Mouse',
      'Warehouse updated: Main Warehouse',
      'Item group created: Office Supplies',
      'Batch created: BATCH-2407-A',
    ])
  })

  it('drops rows that are not a master change', () => {
    const rows = [
      auditRow({ audit_id: 1, entity_type: 'document', action: 'document.post' }),
      auditRow({ audit_id: 2, entity_type: 'access', action: 'access.denied' }),
      auditRow({ audit_id: 3, entity_type: 'brand', action: 'brand.something_else' }),
      auditRow({ audit_id: 4, after: { brand_name: 'Kept' } }),
    ]
    expect(masterActivity(rows).map((a) => a.subject)).toEqual(['Kept'])
  })

  it('stops at the limit', () => {
    const rows = Array.from({ length: 12 }, (_, i) =>
      auditRow({ audit_id: i + 1, after: { brand_name: `Brand ${i}` } }),
    )
    expect(masterActivity(rows)).toHaveLength(5)
    expect(masterActivity(rows, 3)).toHaveLength(3)
  })

  it('gives every real master an icon and a route to drill into', () => {
    for (const master of MASTER_DEFINITIONS) {
      const [entry] = masterActivity([
        auditRow({ entity_type: master.auditEntity, action: `${master.auditEntity}.update` }),
      ])
      expect(entry, master.key).toBeDefined()
      expect(entry.to).toBe(master.route)
      expect(entry.icon).toBe(master.icon)
    }
  })
})
