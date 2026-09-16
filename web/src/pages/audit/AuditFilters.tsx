import { useEffect, useMemo, useState } from 'react'
import type { FormEvent, RefObject } from 'react'
import { Filter, RotateCcw, Search, SlidersHorizontal, X } from 'lucide-react'
import { Button } from '../../ui/Button'
import { Input } from '../../ui/Input'
import { Select } from '../../ui/Select'
import { AIC, cx } from '../../ui/cx'
import { FILTER_CARD, FILTER_LABEL_COMPACT } from '../../styles/designTokens'
import { AUDIT_ENTITY_TYPES } from '../../services/auditApi'
import type { AuditFacet, AuditFacets } from '../../services/auditApi'
import { formatInt, humanize } from '../../utils/format'
import { actorIdentity } from './auditPresentation'

/**
 * The filter workspace above the audit table.
 *
 * Two behaviours, and the split is deliberate rather than an oversight:
 *
 *  - The search box applies as you type (debounced by the page). It is how a
 *    reader sweeps for a word, and making them press a button after every
 *    keystroke would make it useless.
 *  - Everything else is a DRAFT until Apply. An investigation sets a type, an
 *    actor and a date range together and wants one query at the end of it, not
 *    four intermediate ones — and on a table of millions of rows those three
 *    discarded round trips are not free.
 *
 * The draft resynchronises whenever the committed filters change from anywhere
 * else — a removed chip, Clear, the browser's back button — so the form on
 * screen can never disagree with the rows beneath it.
 */

export type AuditFilterValues = Record<string, string>

export interface AuditFiltersProps {
  /** The committed filters, as held in the URL. */
  filters: AuditFilterValues
  /** Commits a whole draft in one navigation. */
  onApply: (next: AuditFilterValues) => void
  /** Drops every filter AND the search term, in one navigation. */
  onClear: () => void
  search: string
  onSearchChange: (value: string) => void
  /** Distinct values for the pickers; null until the summary lands. */
  facets: AuditFacets | null
  searchInputRef?: RefObject<HTMLInputElement | null>
}

/** Every filter key this card owns. Clearing means clearing exactly these. */
export const AUDIT_FILTER_KEYS = [
  'entity_type',
  'entity_id',
  'action',
  'action_prefix',
  'actor_uuid',
  'source_app',
  'source_document_type',
  'source_document_id',
  'request_id',
  'ip_address',
  'has_reason',
  'from',
  'to',
] as const

const ADVANCED_KEYS = ['request_id', 'ip_address', 'source_document_type', 'source_document_id', 'action_prefix']

const REASON_OPTIONS = [
  { value: '', label: 'All reasons' },
  { value: '1', label: 'With a reason' },
  { value: '0', label: 'Without a reason' },
]

function labelFor(key: string, value: string): string {
  switch (key) {
    case 'entity_type':
      return `Entity: ${humanize(value)}`
    case 'entity_id':
      return `Entity id: ${value}`
    case 'action':
      return `Action: ${value}`
    case 'action_prefix':
      return `Action starts with: ${value}`
    case 'actor_uuid':
      return `Actor: ${actorIdentity({ actor_uuid: value }).label}`
    case 'source_app':
      return `Source: ${value}`
    case 'source_document_type':
      return `Source document: ${value}`
    case 'source_document_id':
      return `Source document #${value}`
    case 'request_id':
      return `Request: ${value}`
    case 'ip_address':
      return `IP: ${value}`
    case 'has_reason':
      return value === '1' ? 'With a reason' : 'Without a reason'
    case 'from':
      return `From ${value}`
    case 'to':
      return `To ${value}`
    default:
      return `${humanize(key)}: ${value}`
  }
}

/** A facet list rendered as options, with the value kept selectable if absent. */
function FacetOptions({
  facets,
  selected,
  format,
}: {
  facets: AuditFacet[] | undefined
  selected: string
  format?: (value: string) => string
}) {
  const list = facets ?? []
  const missing = selected !== '' && !list.some((f) => f.value === selected)
  return (
    <>
      {missing ? <option value={selected}>{format ? format(selected) : selected}</option> : null}
      {list.map((f) => (
        <option key={f.value} value={f.value}>
          {`${format ? format(f.value) : f.value} (${formatInt(f.count)})`}
        </option>
      ))}
    </>
  )
}

export function AuditFilters({
  filters,
  onApply,
  onClear,
  search,
  onSearchChange,
  facets,
  searchInputRef,
}: AuditFiltersProps) {
  const committedKey = JSON.stringify(filters)
  const [draft, setDraft] = useState<AuditFilterValues>(filters)
  const [showAdvanced, setShowAdvanced] = useState(() =>
    ADVANCED_KEYS.some((k) => (filters[k] ?? '') !== ''),
  )

  // Resync whenever the committed set changes from outside this form.
  useEffect(() => {
    setDraft(JSON.parse(committedKey) as AuditFilterValues)
  }, [committedKey])

  const set = (key: string, value: string) => setDraft((d) => ({ ...d, [key]: value }))

  const dirty = useMemo(
    () => AUDIT_FILTER_KEYS.some((k) => (draft[k] ?? '') !== (filters[k] ?? '')),
    [draft, filters],
  )

  const active = useMemo(
    () => AUDIT_FILTER_KEYS.filter((k) => (filters[k] ?? '') !== '').map((k) => ({ key: k, value: filters[k] })),
    [filters],
  )

  const submit = (e: FormEvent) => {
    e.preventDefault()
    onApply(draft)
  }

  const entityTypes: AuditFacet[] =
    facets?.entity_types?.length
      ? facets.entity_types
      : AUDIT_ENTITY_TYPES.map((t) => ({ value: t, count: 0 }))

  return (
    <form className={cx(AIC, FILTER_CARD, 'space-y-2.5')} onSubmit={submit} role="search">
      {/* Row 1 — the sweep: free text, the period, and the verbs. */}
      <div className="grid grid-cols-1 gap-2 md:grid-cols-[minmax(16rem,1fr)_auto_auto] xl:grid-cols-[minmax(20rem,1fr)_auto_auto_auto]">
        {/*
          * A plain input rather than `SearchBox`: that component renders its own
          * `<form>`, and a form inside this card's form is invalid HTML — the
          * browser closes the outer one early and Apply stops submitting.
          */}
        {/*
          * `self-start` so the box hugs its own height: as a stretched grid
          * item it grows with the row, and the shortcut chip — centred inside
          * it — would drift below the field when the buttons beside it wrap.
          */}
        <div className="relative self-start">
          <Input
            ref={searchInputRef}
            type="search"
            size="md"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            leadingIcon={Search}
            placeholder="Search actions, entity, actor or reason…"
            aria-label="Search the audit log"
            className="w-full [&_input]:pr-9"
          />
          <span className="kbd pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2" aria-hidden>
            /
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <label className={cx(AIC, 'flex items-center gap-1.5')}>
            <span className={FILTER_LABEL_COMPACT}>From</span>
            <Input
              type="date"
              size="md"
              className="w-[9.5rem]"
              value={draft.from ?? ''}
              max={draft.to || undefined}
              onChange={(e) => set('from', e.target.value)}
            />
          </label>
          <label className={cx(AIC, 'flex items-center gap-1.5')}>
            <span className={FILTER_LABEL_COMPACT}>To</span>
            <Input
              type="date"
              size="md"
              className="w-[9.5rem]"
              value={draft.to ?? ''}
              min={draft.from || undefined}
              onChange={(e) => set('to', e.target.value)}
            />
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" size="md" icon={Filter} disabled={!dirty}>
            Apply
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="md"
            icon={RotateCcw}
            onClick={onClear}
            disabled={active.length === 0 && search === ''}
          >
            Clear
          </Button>
          <Button
            type="button"
            variant={showAdvanced ? 'outline' : 'secondary'}
            size="md"
            icon={SlidersHorizontal}
            onClick={() => setShowAdvanced((v) => !v)}
            aria-expanded={showAdvanced}
          >
            More filters
          </Button>
        </div>
      </div>

      {/* Row 2 — the pickers, populated from the server's own distinct values. */}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6">
        <Select
          size="md"
          aria-label="Filter by entity type"
          value={draft.entity_type ?? ''}
          onChange={(e) => set('entity_type', e.target.value)}
        >
          <option value="">All entities</option>
          <FacetOptions facets={entityTypes} selected={draft.entity_type ?? ''} format={humanize} />
        </Select>

        <Input
          size="md"
          inputMode="numeric"
          placeholder="Entity id"
          aria-label="Entity id"
          value={draft.entity_id ?? ''}
          onChange={(e) => set('entity_id', e.target.value.replace(/[^\d]/g, ''))}
        />

        <Select
          size="md"
          aria-label="Filter by action"
          value={draft.action ?? ''}
          onChange={(e) => set('action', e.target.value)}
        >
          <option value="">All actions</option>
          <FacetOptions facets={facets?.actions} selected={draft.action ?? ''} />
        </Select>

        <Select
          size="md"
          aria-label="Filter by actor"
          value={draft.actor_uuid ?? ''}
          onChange={(e) => set('actor_uuid', e.target.value)}
        >
          <option value="">All actors</option>
          <FacetOptions
            facets={facets?.actors}
            selected={draft.actor_uuid ?? ''}
            format={(v) => actorIdentity({ actor_uuid: v }).label}
          />
        </Select>

        <Select
          size="md"
          aria-label="Filter by source application"
          value={draft.source_app ?? ''}
          onChange={(e) => set('source_app', e.target.value)}
        >
          <option value="">All source apps</option>
          <FacetOptions facets={facets?.source_apps} selected={draft.source_app ?? ''} />
        </Select>

        <Select
          size="md"
          aria-label="Filter by reason"
          value={draft.has_reason ?? ''}
          onChange={(e) => set('has_reason', e.target.value)}
        >
          {REASON_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
      </div>

      {/* Row 3 — the technical identifiers, folded away until asked for. */}
      {showAdvanced ? (
        <div className="grid grid-cols-1 gap-2 border-t border-gray-100 pt-2.5 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5">
          <Input
            size="md"
            placeholder="Action starts with (document.…)"
            aria-label="Action starts with"
            value={draft.action_prefix ?? ''}
            onChange={(e) => set('action_prefix', e.target.value)}
          />
          <Input
            size="md"
            placeholder="Request id"
            aria-label="Request id"
            className="font-mono"
            value={draft.request_id ?? ''}
            onChange={(e) => set('request_id', e.target.value)}
          />
          <Input
            size="md"
            placeholder="IP address"
            aria-label="IP address"
            className="font-mono"
            value={draft.ip_address ?? ''}
            onChange={(e) => set('ip_address', e.target.value)}
          />
          <Input
            size="md"
            placeholder="Source document type (books.sales)"
            aria-label="Source document type"
            value={draft.source_document_type ?? ''}
            onChange={(e) => set('source_document_type', e.target.value)}
          />
          <Input
            size="md"
            inputMode="numeric"
            placeholder="Source document id"
            aria-label="Source document id"
            value={draft.source_document_id ?? ''}
            onChange={(e) => set('source_document_id', e.target.value.replace(/[^\d]/g, ''))}
          />
        </div>
      ) : null}

      {/* Row 4 — what is actually in force, and one click to drop any of it. */}
      {active.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5 border-t border-gray-100 pt-2.5">
          <span className={FILTER_LABEL_COMPACT}>Filtering by</span>
          {active.map(({ key, value }) => (
            <button
              key={key}
              type="button"
              onClick={() => onApply({ ...filters, [key]: '' })}
              className={cx(
                AIC,
                'inline-flex items-center gap-1 rounded-full border border-primary/20 bg-primary-light px-2 py-0.5 text-[11px] font-medium text-primary transition-colors hover:border-primary/40 focus:outline-none focus:ring-2 focus:ring-primary/30',
              )}
            >
              <span className="max-w-[16rem] truncate">{labelFor(key, value)}</span>
              <X className="h-3 w-3 shrink-0" aria-hidden />
              <span className="sr-only">Remove this filter</span>
            </button>
          ))}
          <button
            type="button"
            onClick={onClear}
            className={cx(AIC, 'ml-1 text-[11px] font-medium text-gray-500 underline underline-offset-2 hover:text-gray-800')}
          >
            Clear all
          </button>
        </div>
      ) : null}
    </form>
  )
}

export default AuditFilters
