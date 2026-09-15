import { describe, expect, it } from 'vitest'
import { ENTRY_GROUPS, allowedTypeCount, buildEntryHub, entryHubTypes, unavailableReason } from './entryHub'
import { HIDDEN_FROM_NEW_MENU, NATIVE_DOCUMENT_TYPES, specForCode } from './registry'
import type { Can } from './actions'

/**
 * The bug this file guards: a document type that exists, can be posted, and has
 * a permission key on the server, but appears on no screen a user can reach —
 * which is indistinguishable from a type that was never built.
 */

const allowAll: Can = () => true
const allowNone: Can = () => false

/** A profile that holds `documents.<slug>.create` for exactly these codes. */
function allowOnly(codes: readonly string[]): Can {
  const keys = new Set(codes.map((c) => `documents.${c.toLowerCase()}.create`))
  return (key) => (Array.isArray(key) ? key : [key as string]).some((k) => keys.has(k))
}

describe('the entry hub covers every creatable document type', () => {
  it('places each native type in exactly one group', () => {
    const grouped = ENTRY_GROUPS.flatMap((g) => g.codes)
    const offered = entryHubTypes().map((t) => t.code)

    expect(new Set(grouped).size, 'a code is listed in two groups').toBe(grouped.length)
    expect([...grouped].sort()).toEqual([...offered].sort())
  })

  it('leaves out only the types that have their own screens', () => {
    const grouped = new Set(ENTRY_GROUPS.flatMap((g) => g.codes))
    for (const spec of NATIVE_DOCUMENT_TYPES) {
      expect(grouped.has(spec.code), `${spec.code} missing from the hub`).toBe(
        !HIDDEN_FROM_NEW_MENU.has(spec.code),
      )
    }
  })

  it('links each type at the slug its form route reads', () => {
    for (const group of buildEntryHub(allowAll)) {
      for (const entry of group.entries) {
        expect(entry.to).toBe(`/documents/new/${entry.spec.slug}`)
        // The slug is what /documents/new/:slug resolves through specForSlug.
        expect(specForCode(entry.spec.code)?.slug).toBe(entry.spec.slug)
      }
    }
  })
})

describe('a type the profile cannot raise is shown, not hidden', () => {
  it('keeps every type in the list when nothing may be created', () => {
    const groups = buildEntryHub(allowNone)
    const shown = groups.flatMap((g) => g.entries).length
    expect(shown).toBe(entryHubTypes().length)
    expect(allowedTypeCount(groups)).toBe(0)
  })

  it('names the document in the reason, so the user knows what to ask for', () => {
    const journal = specForCode('STOCK_JOURNAL')!
    expect(unavailableReason(journal, allowNone)).toBe(
      'Your profile does not allow creating a Stock Journal.',
    )
    expect(unavailableReason(journal, allowAll)).toBeNull()
  })

  it('marks the ten a Store Keeper holds as allowed and the rest as disabled with a reason', () => {
    // A deliberately partial profile — the case that produced the bug report.
    const storeKeeper = allowOnly([
      'MATERIAL_ISSUE',
      'MATERIAL_RECEIPT',
      'STOCK_TRANSFER',
      'DELIVERY_CHALLAN',
      'INWARD_CHALLAN',
      'PACKING',
    ])
    const groups = buildEntryHub(storeKeeper)
    const entries = groups.flatMap((g) => g.entries)

    expect(allowedTypeCount(groups)).toBe(6)
    // Nothing vanished: the eleven-plus they cannot raise are still listed.
    expect(entries.length).toBe(entryHubTypes().length)

    const journal = entries.find((e) => e.spec.code === 'STOCK_JOURNAL')!
    expect(journal.allowed).toBe(false)
    expect(journal.unavailableReason).toBe('Your profile does not allow creating a Stock Journal.')

    const issue = entries.find((e) => e.spec.code === 'MATERIAL_ISSUE')!
    expect(issue.allowed).toBe(true)
    expect(issue.unavailableReason).toBeNull()
  })

  it('accepts the blanket documents.create key as well as the per-type one', () => {
    const blanket: Can = (key) =>
      (Array.isArray(key) ? key : [key as string]).includes('documents.create')
    expect(allowedTypeCount(buildEntryHub(blanket))).toBe(entryHubTypes().length)
  })
})

describe('the hub is never blank', () => {
  it('returns every group whatever the permissions, so no section silently disappears', () => {
    for (const can of [allowAll, allowNone]) {
      const groups = buildEntryHub(can)
      expect(groups.length).toBe(ENTRY_GROUPS.length)
      for (const group of groups) {
        expect(group.entries.length, `${group.key} came back empty`).toBeGreaterThan(0)
      }
    }
  })

  it('reports whether anything in a group can actually be raised', () => {
    const onlyProduction = allowOnly(['PRODUCTION'])
    const groups = buildEntryHub(onlyProduction)
    expect(groups.find((g) => g.key === 'production')!.anyAllowed).toBe(true)
    expect(groups.find((g) => g.key === 'job_work')!.anyAllowed).toBe(false)
  })
})
