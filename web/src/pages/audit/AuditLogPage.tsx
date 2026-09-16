import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Copy,
  ExternalLink,
  Filter,
  Link2,
  MoreVertical,
  RotateCcw,
  ScrollText,
  ShieldCheck,
} from 'lucide-react'
import { useCompany } from '../../company/CompanyContext'
import { Notice } from '../../components/Notice'
import { ListSheetActions } from '../../components/ListSheetActions'
import { RequirePermission } from '../../components/RequirePermission'
import { ExportActions } from '../../export/ExportActions'
import { slugifyExportFilename } from '../../export/exportActions'
import { useExportIdentity } from '../../export/useExportIdentity'
import { Badge } from '../../ui/Badge'
import { Button } from '../../ui/Button'
import { EmptyState } from '../../ui/EmptyState'
import { MenuButton } from '../../ui/MenuButton'
import type { MenuAction } from '../../ui/MenuButton'
import { Tooltip } from '../../ui/Tooltip'
import { AIC, cx } from '../../ui/cx'
import { notify } from '../../ui/notify'
import { BreadcrumbHeader } from '../../ui/shell/BreadcrumbHeader'
import { PageShell } from '../../ui/shell/PageShell'
import { SmartTable } from '../../ui/shell/SmartTable'
import type { SmartColumn } from '../../ui/shell/SmartTable'
import { ServerTablePagination } from '../../ui/shell/TablePagination'
import { useDebounce } from '../../hooks/useDebounce'
import { useInterval } from '../../hooks/useInterval'
import { useListParams } from '../../hooks/useListParams'
import { useQuery } from '../../hooks/useQuery'
import type { ExportableColumn } from '../../registers/registerCells'
import { P } from '../../services/access'
import { auditApi } from '../../services/auditApi'
import type { AuditLogRow } from '../../services/auditApi'
import { fetchAllRows } from '../../services/listAll'
import { copyText } from '../../utils/clipboard'
import { formatDateTime, formatInt, humanize, todayIso } from '../../utils/format'
import { AuditDetailDrawer } from './AuditDetailDrawer'
import { AuditFilters, AUDIT_FILTER_KEYS } from './AuditFilters'
import type { AuditFilterValues } from './AuditFilters'
import { AuditSummaryCards } from './AuditSummaryCards'
import {
  actionTone,
  actorIdentity,
  changedFields,
  entityIdentity,
  shortId,
  sourceIdentity,
  splitTimestamp,
} from './auditPresentation'

/**
 * The audit log.
 *
 * Read-only by construction. There is no create, edit or delete path on this
 * screen and there is none behind it either: `inv_audit_log` carries BEFORE
 * UPDATE and BEFORE DELETE triggers (migration 007) that refuse the statement
 * outright, and the retention policy declines to purge. Everything here reads.
 *
 * What the screen has to get right is investigation. An auditor arrives with a
 * question — who changed this rate, what did the nightly job touch, which
 * request produced these four writes — and the whole layout is arranged around
 * answering it: the figures say how big the filtered set is, the filters narrow
 * it server-side, the table identifies each event at a glance, and the drawer
 * shows what actually changed.
 *
 * Paging, filtering and sorting are all the server's work. The table never
 * holds more than one page, and the export walks the pages itself.
 */

const SEARCH_DEBOUNCE_MS = 350

/**
 * How often Live View re-runs the query.
 *
 * A poll, not a socket: the API has no streaming endpoint and inventing one for
 * a checkbox would be a lie about what the screen is doing. Forty-five seconds
 * is slow enough to cost nothing on a table this size and quick enough that a
 * reader watching a posting run see it land.
 */
const LIVE_REFRESH_MS = 45_000

/**
 * The sheet's columns.
 *
 * The before / after snapshots stay in, and stay last. They are the reason an
 * auditor asks for this file at all, and a sheet that showed only the changed
 * field names would answer a different question than the one that was asked.
 */
const EXPORT_COLUMNS: ExportableColumn<AuditLogRow>[] = [
  { key: 'created_at', csvHeader: 'When', format: 'datetime' },
  { key: 'action', csvHeader: 'Action' },
  { key: 'entity_type', csvHeader: 'Entity type', csv: (r) => humanize(r.entity_type) },
  { key: 'entity_id', csvHeader: 'Entity id', align: 'right', format: 'int' },
  { key: 'actor_uuid', csvHeader: 'Actor', csv: (r) => r.actor_uuid ?? 'system' },
  { key: 'source_app', csvHeader: 'Source app', csv: (r) => r.source_app ?? '' },
  { key: 'source_document', csvHeader: 'Source document', csv: (r) => (r.source_document_id ? `${r.source_document_type ?? ''} #${r.source_document_id}`.trim() : '') },
  { key: 'reason', csvHeader: 'Reason', csv: (r) => r.reason ?? '' },
  { key: 'changed_fields', csvHeader: 'Changed fields', csv: (r) => changedFields(r).join('; ') },
  { key: 'before', csvHeader: 'Before', csv: (r) => (r.before ? JSON.stringify(r.before) : '') },
  { key: 'after', csvHeader: 'After', csv: (r) => (r.after ? JSON.stringify(r.after) : '') },
  { key: 'request_id', csvHeader: 'Request id', csv: (r) => r.request_id ?? '' },
  { key: 'ip_address', csvHeader: 'IP', csv: (r) => r.ip_address ?? '' },
]

function Dash() {
  return <span className="text-gray-300">—</span>
}

/** Field names the write touched, as chips, with the tail folded away. */
function ChangedFieldChips({ fields }: { fields: string[] }) {
  const [expanded, setExpanded] = useState(false)
  if (fields.length === 0) return <Dash />
  const shown = expanded ? fields : fields.slice(0, 3)
  const hidden = fields.length - shown.length
  return (
    <span className="flex flex-wrap items-center gap-1">
      {shown.map((f) => (
        <code
          key={f}
          className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-[10px] font-medium text-gray-600"
        >
          {f}
        </code>
      ))}
      {hidden > 0 ? (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            setExpanded(true)
          }}
          className="rounded px-1 text-[10px] font-semibold text-primary hover:underline focus:outline-none focus:ring-2 focus:ring-primary/30"
        >
          +{hidden} more
        </button>
      ) : null}
    </span>
  )
}

export function AuditLogPage() {
  const { scope, companyName } = useCompany()
  const exportIdentity = useExportIdentity()
  const params = useListParams({
    sort: 'created_at',
    order: 'desc',
    limit: 50,
    filterKeys: AUDIT_FILTER_KEYS,
  })
  const { state, query } = params
  const searchInputRef = useRef<HTMLInputElement | null>(null)

  /* -- search: typed locally, committed to the URL once it settles ---------- */
  const [searchDraft, setSearchDraft] = useState(state.q)
  const debouncedSearch = useDebounce(searchDraft, SEARCH_DEBOUNCE_MS)
  useEffect(() => {
    setSearchDraft(state.q)
  }, [state.q])
  useEffect(() => {
    if (debouncedSearch !== state.q) params.setQ(debouncedSearch)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only the settled value may commit
  }, [debouncedSearch])

  const cmpId = scope?.cmp_id ?? null
  const queryKey = JSON.stringify(query)
  const list = useQuery((signal) => auditApi.list(query, signal), [queryKey, cmpId], {
    enabled: scope !== null,
    resetKey: cmpId,
  })

  /**
   * The summary is keyed on the FILTERS, not the page.
   *
   * Turning to page four must not re-count the set or move the figures above
   * the table, and it must not pay for an aggregate scan it already paid for.
   */
  const summaryFilters = useMemo(() => {
    const { page: _p, limit: _l, offset: _o, sort: _s, order: _or, ...rest } = query
    return rest
  }, [query])
  const summaryKey = JSON.stringify(summaryFilters)
  const summary = useQuery((signal) => auditApi.summary(summaryFilters, signal), [summaryKey, cmpId], {
    enabled: scope !== null,
    resetKey: cmpId,
  })

  const rows = list.data?.data ?? []
  const [detail, setDetail] = useState<AuditLogRow | null>(null)
  const [selected, setSelected] = useState<ReadonlySet<number>>(new Set())
  const [live, setLive] = useState(false)

  const refresh = useCallback(() => {
    list.reload()
    summary.reload()
  }, [list, summary])

  useInterval(refresh, live ? LIVE_REFRESH_MS : null)

  // A selection is about the rows in front of the reader; a new page, a new
  // filter or a refresh is a different set of rows, so it does not survive one.
  useEffect(() => {
    setSelected(new Set())
  }, [queryKey, cmpId])

  const applyFilters = useCallback(
    (next: AuditFilterValues) => {
      params.setFilters(Object.fromEntries(AUDIT_FILTER_KEYS.map((k) => [k, next[k] ?? ''])))
    },
    [params],
  )

  const clearFilters = useCallback(() => {
    params.setFilters({
      ...Object.fromEntries(AUDIT_FILTER_KEYS.map((k) => [k, ''])),
      q: '',
    })
  }, [params])

  /** One filter, set from a row — the "show me everything by this actor" move. */
  const filterBy = useCallback(
    (key: string, value: string) => {
      params.setFilters({ [key]: value })
      notify.info(`Filtered by ${humanize(key)}`)
    },
    [params],
  )

  const copy = useCallback(async (value: string, what: string) => {
    const ok = await copyText(value)
    ok ? notify.success(`${what} copied`) : notify.error(`Could not copy the ${what.toLowerCase()}`)
  }, [])

  const toggleRow = useCallback((id: number) => {
    setSelected((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }, [])

  const allOnPageSelected = rows.length > 0 && rows.every((r) => selected.has(r.audit_id))

  const columns = useMemo<SmartColumn<AuditLogRow>[]>(
    () => [
      {
        key: '__select',
        width: 36,
        headerClassName: 'print:hidden',
        cellClassName: 'print:hidden',
        header: (
          <>
            <input
              type="checkbox"
              className="h-3.5 w-3.5 cursor-pointer accent-[rgb(var(--color-primary))]"
              checked={allOnPageSelected}
              onChange={() =>
                setSelected(allOnPageSelected ? new Set() : new Set(rows.map((r) => r.audit_id)))
              }
              aria-label="Select every entry on this page"
            />
          </>
        ),
        render: (r) => (
          <input
            type="checkbox"
            className="h-3.5 w-3.5 cursor-pointer accent-[rgb(var(--color-primary))]"
            checked={selected.has(r.audit_id)}
            onClick={(e) => e.stopPropagation()}
            onChange={() => toggleRow(r.audit_id)}
            aria-label={`Select the ${r.action} entry on ${formatDateTime(r.created_at)}`}
          />
        ),
      },
      {
        key: 'created_at',
        header: 'When',
        sortKey: 'created_at',
        width: 112,
        minWidth: 112,
        render: (r) => {
          const when = splitTimestamp(r.created_at)
          return (
            <Tooltip label={`${formatDateTime(r.created_at)} — open this entry`}>
              <button
                type="button"
                onClick={() => setDetail(r)}
                className="inline-flex flex-col items-start whitespace-nowrap text-left font-semibold tabular-nums text-primary hover:underline focus:outline-none focus:ring-2 focus:ring-primary/30"
              >
                <span>{when.date}</span>
                {when.time ? <span className="text-[11px] font-normal">{when.time}</span> : null}
              </button>
            </Tooltip>
          )
        },
      },
      {
        key: 'action',
        header: 'Action',
        sortKey: 'action',
        width: 128,
        minWidth: 128,
        render: (r) => (
          <button
            type="button"
            onClick={() => setDetail(r)}
            aria-label={`${r.action} — open this entry`}
            className="focus:outline-none focus:ring-2 focus:ring-primary/30 rounded-full"
          >
            <Badge tone={actionTone(r.action)} size="xs" className="normal-case font-mono">
              {r.action}
            </Badge>
          </button>
        ),
      },
      {
        key: 'entity',
        header: 'Entity',
        sortKey: 'entity_type',
        width: 146,
        minWidth: 146,
        render: (r) => {
          const entity = entityIdentity(r)
          return (
            <>
              {entity.to ? (
                <Link
                  to={entity.to}
                  onClick={(e) => e.stopPropagation()}
                  className="font-semibold text-primary hover:underline"
                >
                  {entity.label}
                </Link>
              ) : (
                <span className="font-semibold text-gray-700">{entity.label}</span>
              )}
              {entity.subtitle ? (
                <span className="mt-0.5 block text-[11px] text-gray-500">{entity.subtitle}</span>
              ) : null}
            </>
          )
        },
      },
      {
        key: 'actor_uuid',
        header: 'Actor',
        sortKey: 'actor_uuid',
        width: 132,
        minWidth: 132,
        render: (r) => {
          const actor = actorIdentity(r)
          return (
            <span className="flex items-center gap-2" title={actor.title}>
              <span
                aria-hidden
                className={cx(
                  'inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[9px] font-bold',
                  actor.kind === 'system'
                    ? 'bg-teal-50 text-teal-700'
                    : actor.kind === 'automation'
                      ? 'bg-violet-50 text-violet-700'
                      : 'bg-sky-50 text-sky-700',
                )}
              >
                {actor.initials}
              </span>
              {/*
                * An explicit cap, not just `truncate`: `truncate` sets
                * `white-space: nowrap`, which makes the cell's MIN-content the
                * full string, and an auto-layout table sizes the column to that
                * — one `cli:inventory-reconcile` row widened the whole table
                * past the card and pushed the row menu off the right edge.
                */}
              <span className="min-w-0 max-w-[6rem] truncate">{actor.label}</span>
            </span>
          )
        },
      },
      {
        key: 'source',
        header: 'Source app',
        width: 144,
        minWidth: 144,
        render: (r) => {
          const source = sourceIdentity(r)
          if (!source.label) return <Dash />
          return (
            <>
              <span className="block break-words">{source.label}</span>
              {source.reference ? (
                <span className="mt-0.5 block text-[11px] text-gray-500">{source.reference}</span>
              ) : null}
            </>
          )
        },
      },
      {
        key: 'reason',
        header: 'Reason',
        width: 112,
        minWidth: 112,
        render: (r) =>
          r.reason ? (
            // Truncated on screen, never truncated in the export or the drawer:
            // a reason is the note that explains a change and losing it would
            // be losing evidence.
            <Tooltip label={r.reason}>
              <span className="line-clamp-2 max-w-[16rem] break-words">{r.reason}</span>
            </Tooltip>
          ) : (
            <Dash />
          ),
      },
      {
        key: 'changed_fields',
        header: 'Changed fields',
        width: 190,
        minWidth: 190,
        render: (r) => <ChangedFieldChips fields={changedFields(r)} />,
      },
      {
        key: 'request_id',
        header: 'Request id',
        width: 120,
        minWidth: 120,
        render: (r) =>
          r.request_id ? (
            <Tooltip label="Copy request id">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  void copy(r.request_id as string, 'Request id')
                }}
                className="inline-flex items-center gap-1 font-mono text-[11px] text-gray-600 hover:text-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
              >
                {shortId(r.request_id)}
                <Copy className="h-3 w-3 shrink-0 opacity-50" aria-hidden />
              </button>
            </Tooltip>
          ) : (
            <Dash />
          ),
      },
      {
        key: 'ip_address',
        header: 'IP',
        width: 108,
        minWidth: 108,
        render: (r) =>
          r.ip_address ? (
            <code className="font-mono text-[11px] text-gray-600">{r.ip_address}</code>
          ) : (
            <Dash />
          ),
      },
      {
        key: '__actions',
        header: '',
        align: 'right',
        width: 44,
        headerClassName: 'print:hidden',
        cellClassName: 'print:hidden',
        render: (r) => {
          const actor = actorIdentity(r)
          const entity = entityIdentity(r)
          const actions: MenuAction[] = [
            { key: 'view', label: 'View audit details', icon: ScrollText, onSelect: () => setDetail(r) },
          ]
          if (entity.to) {
            actions.push({
              key: 'open',
              label: `Open ${entity.label}`,
              icon: ExternalLink,
              onSelect: () => window.open(entity.to as string, '_self'),
            })
          }
          if (r.request_id) {
            actions.push({
              key: 'copy-request',
              label: 'Copy request id',
              icon: Copy,
              separated: true,
              onSelect: () => void copy(r.request_id as string, 'Request id'),
            })
            actions.push({
              key: 'filter-request',
              label: 'Filter by this request',
              icon: Filter,
              onSelect: () => filterBy('request_id', r.request_id as string),
            })
          }
          if (actor.filterValue) {
            actions.push({
              key: 'filter-actor',
              label: `Filter by ${actor.label}`,
              icon: Filter,
              separated: !r.request_id,
              onSelect: () => filterBy('actor_uuid', actor.filterValue as string),
            })
          }
          actions.push({
            key: 'filter-entity',
            label: `Filter by ${entity.label}`,
            icon: Filter,
            onSelect: () =>
              params.setFilters({ entity_type: r.entity_type, entity_id: String(r.entity_id) }),
          })
          if (r.source_app) {
            actions.push({
              key: 'filter-source',
              label: `Filter by ${r.source_app}`,
              icon: Filter,
              onSelect: () => filterBy('source_app', r.source_app as string),
            })
          }
          return (
            <MenuButton
              label="Audit entry actions"
              icon={MoreVertical}
              actions={actions}
              width={232}
            />
          )
        },
      },
    ],
    [allOnPageSelected, rows, selected, toggleRow, copy, filterBy, params],
  )

  const selectedRows = useMemo(
    () => rows.filter((r) => selected.has(r.audit_id)),
    [rows, selected],
  )

  const metaLines = useMemo(
    () =>
      [
        state.q ? `Search: ${state.q}` : '',
        state.filters.entity_type
          ? `Entity: ${humanize(state.filters.entity_type)}${state.filters.entity_id ? ` #${state.filters.entity_id}` : ''}`
          : '',
        state.filters.action ? `Action: ${state.filters.action}` : '',
        state.filters.action_prefix ? `Action starts with: ${state.filters.action_prefix}` : '',
        state.filters.actor_uuid ? `Actor: ${state.filters.actor_uuid}` : '',
        state.filters.source_app ? `Source app: ${state.filters.source_app}` : '',
        state.filters.request_id ? `Request: ${state.filters.request_id}` : '',
        state.filters.ip_address ? `IP: ${state.filters.ip_address}` : '',
        state.filters.from || state.filters.to
          ? `Between: ${state.filters.from || '…'} and ${state.filters.to || '…'}`
          : '',
      ].filter(Boolean),
    [state.q, state.filters],
  )

  const moreActions: MenuAction[] = [
    {
      key: 'copy-link',
      label: 'Copy link to this view',
      icon: Link2,
      onSelect: () => void copy(window.location.href, 'Link'),
    },
    {
      key: 'reset',
      label: 'Reset all filters',
      icon: RotateCcw,
      onSelect: clearFilters,
    },
  ]

  return (
    <PageShell fullBleed>
      <BreadcrumbHeader
        breadcrumbs={[{ label: 'Audit', to: '/audit' }, { label: 'Audit log' }]}
        icon={ShieldCheck}
        title="Audit log"
        description="Track every change in your Inventory data. Know who changed what, when and why."
        escBack={false}
        actions={
          <>
            <Button
              variant={live ? 'outline' : 'secondary'}
              size="sm"
              aria-pressed={live}
              onClick={() => setLive((v) => !v)}
              title={`Re-run this query every ${LIVE_REFRESH_MS / 1000} seconds`}
            >
              <span
                aria-hidden
                className={cx(
                  'mr-1.5 inline-block h-2 w-2 rounded-full',
                  live ? 'animate-pulse bg-primary' : 'bg-gray-300',
                )}
              />
              Live view
              <span className="sr-only">{live ? ' is on' : ' is off'}</span>
            </Button>
            <ListSheetActions<AuditLogRow>
              columns={EXPORT_COLUMNS}
              rows={rows}
              fetchAll={() => fetchAllRows<AuditLogRow>((page, limit) => auditApi.list({ ...query, page, limit }))}
              filenameBase="audit-log"
              title="Audit log"
              description="Append-only record of every write, with the before and after snapshot"
              metaLines={metaLines}
              onRefresh={refresh}
              refreshing={list.loading}
              searchInputRef={searchInputRef}
              disabled={!list.data || list.data.meta.total === 0}
            />
            <MenuButton
              label="More audit actions"
              icon={MoreVertical}
              variant="secondary"
              size="sm"
              actions={moreActions}
            />
          </>
        }
      />

      <RequirePermission permission={P.auditRead} what="the audit log">
        <AuditSummaryCards
          summary={summary.data}
          loading={summary.loading}
          error={summary.error}
          onRetry={summary.reload}
        />

        <AuditFilters
          filters={state.filters}
          onApply={applyFilters}
          onClear={clearFilters}
          search={searchDraft}
          onSearchChange={setSearchDraft}
          facets={summary.data?.facets ?? null}
          searchInputRef={searchInputRef}
        />

        {selected.size > 0 ? (
          <div
            className={cx(
              AIC,
              'flex flex-wrap items-center gap-2 rounded-xl border border-primary/30 bg-primary-light px-3 py-2 text-xs text-gray-700 print:hidden',
            )}
            role="status"
          >
            <strong className="font-semibold text-primary">
              {formatInt(selected.size)} selected
            </strong>
            <span className="text-gray-500">on this page</span>
            <div className="ml-auto flex items-center gap-2">
              {/*
                * ExportActions directly rather than ListSheetActions: the
                * latter also claims Ctrl+P for the whole page, and two claims
                * on one screen is a print button whose behaviour depends on
                * mount order. Print is left off here for the same reason —
                * the header's Print is the page's.
                */}
              <ExportActions<AuditLogRow>
                columns={EXPORT_COLUMNS}
                rows={selectedRows}
                filename={slugifyExportFilename(['audit-log-selection', companyName, todayIso()])}
                identity={exportIdentity}
                title="Audit log — selected entries"
                description="Append-only record of every write, with the before and after snapshot"
                metaLines={[`Selection: ${formatInt(selectedRows.length)} of the entries on this page`, ...metaLines]}
                formats={['csv', 'excel', 'pdf']}
                size="xs"
              />
              <Button variant="ghost" size="xs" onClick={() => setSelected(new Set())}>
                Clear selection
              </Button>
            </div>
          </div>
        ) : null}

        {list.error && rows.length > 0 ? (
          <Notice
            kind="warning"
            title="Showing the last result that loaded."
            actions={
              <Button variant="secondary" size="xs" onClick={list.reload}>
                Retry
              </Button>
            }
          >
            The audit log could not be refreshed.
          </Notice>
        ) : null}

        <SmartTable<AuditLogRow>
          columns={columns}
          rows={rows}
          rowKey={(r) => r.audit_id}
          loading={list.loading}
          error={
            list.error && rows.length === 0
              ? {
                  title: 'Unable to load the audit log.',
                  description: 'The entries could not be fetched. Your filters have been kept.',
                  onRetry: list.reload,
                }
              : null
          }
          empty={
            <EmptyState
              icon={ShieldCheck}
              title="No audit events found"
              description="Try changing your filters or date range."
              action={
                <Button variant="secondary" size="sm" icon={RotateCcw} onClick={clearFilters}>
                  Clear filters
                </Button>
              }
            />
          }
          sort={{ key: state.sort, order: state.order }}
          onSort={params.toggleSort}
          onRowActivate={(r) => setDetail(r)}
          keyboardResetKey={`${queryKey}`}
          searchInputRef={searchInputRef}
          stickyHeader
          minWidth={1272}
          caption="Audit log entries"
          footer={
            <ServerTablePagination
              meta={list.data?.meta ?? null}
              limit={state.limit}
              onPage={params.setPage}
              onLimit={params.setLimit}
              numbered
            />
          }
        />
      </RequirePermission>

      <AuditDetailDrawer row={detail} onClose={() => setDetail(null)} onSelect={setDetail} />
    </PageShell>
  )
}

export default AuditLogPage
