import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, Layers, Save } from 'lucide-react'
import { useAccess } from '../../../access/AccessContext'
import { useCompany } from '../../../company/CompanyContext'
import { useScopeLabel } from '../../../company/useScopeLabel'
import { ConfirmDialog } from '../../../components/ConfirmDialog'
import { Notice } from '../../../components/Notice'
import { useDebounce } from '../../../hooks/useDebounce'
import { useDocumentTitle } from '../../../hooks/useDocumentTitle'
import { invalidateFormOptions, useFormOptions } from '../../../hooks/useFormOptions'
import { useListParams } from '../../../hooks/useListParams'
import { useQuery } from '../../../hooks/useQuery'
import { useUnsavedChanges } from '../../../hooks/useUnsavedChanges'
import { useKeyboardScope } from '../../../keyboard/useKeyboardScope'
import { usePageKeyboard } from '../../../keyboard/usePageKeyboard'
import { P } from '../../../services/access'
import { errorMessage } from '../../../services/api'
import { auditApi } from '../../../services/auditApi'
import { itemsApi } from '../../../services/items'
import type { ItemListRow } from '../../../services/items'
import { BreadcrumbHeader } from '../../../ui/shell/BreadcrumbHeader'
import { PageShell } from '../../../ui/shell/PageShell'
import { Button } from '../../../ui/Button'
import { useToast } from '../../../ui/ToastContext'
import { formatInt } from '../../../utils/format'
import { actorIdentity } from '../../audit/auditPresentation'
import { BulkEditAssistantCard } from './BulkEditAssistantCard'
import { BulkEditConfigPanel } from './BulkEditConfigPanel'
import { BulkEditHistoryCard } from './BulkEditHistoryCard'
import { BulkEditHistoryDrawer } from './BulkEditHistoryDrawer'
import { BulkEditItemsTable } from './BulkEditItemsTable'
import { BulkEditKpiCards } from './BulkEditKpiCards'
import { BulkEditPreviewDialog } from './BulkEditPreviewDialog'
import { BulkEditTemplateDialog } from './BulkEditTemplateDialog'
import { BulkEditValidationCard } from './BulkEditValidationCard'
import {
  checkNewValue,
  currentValueKey,
  findBulkField,
  formatFieldValue,
  isReadOnlyField,
  suggestNormalizedValue,
} from './bulkEditFields'
import type { BulkEditBatch } from './bulkEditHistory'
import { groupBulkEdits } from './bulkEditHistory'
import {
  applyGate,
  buildChips,
  buildPayload,
  normalizedKey,
  planBulkEdit,
  selectMissing,
  summarizeOutcome,
  toggleVisibleSelection,
} from './bulkEditModel'
import type { ApplyOutcome, ChipKey, RowPlan } from './bulkEditModel'
import type { BulkEditTemplate, TemplateDraft } from './bulkEditTemplates'
import { deleteTemplate, loadTemplates, saveTemplate, templatesAvailable } from './bulkEditTemplates'

/**
 * `/items/bulk-edit` — change one field across many items at once.
 *
 * ## The shape of the screen
 *
 * Select → validate → preview → apply → audit, in that order and visible in
 * that order: the filters and the change at the top, every affected row under
 * them, and a rail that says what would happen, offers the deterministic help
 * there is, and shows what was done last time. Nothing is written until the
 * confirmation is answered.
 *
 * ## Where every number comes from
 *
 * The rows, their current values, the filtered total and the history are all
 * server responses. The counters are computed from the rows the server sent and
 * the value in the editor by one function (`planBulkEdit`), which the table,
 * the cards, the rail, the preview, the confirmation and the payload all read.
 * A second way of counting the same thing is how a dialog promises 24 and
 * writes 22.
 *
 * ## Selection spans pages, and is explicit
 *
 * Ticking a row keeps the ROW, not just its id (`selection`), so a selection
 * made across several pages can still be classified, previewed and exported
 * once those pages are gone. The write carries explicit ids — there is no
 * "select all 248 matching", because `POST /v1/items/bulk-update` takes ids and
 * caps a batch at 500, and a control implying otherwise would promise a write
 * this screen cannot make.
 */

const HISTORY_LIMIT = 60
const HISTORY_SHOWN = 5

export function ItemsBulkEditPage() {
  useDocumentTitle('Bulk edit items | Aicountly Inventory')
  const toast = useToast()
  const { scope } = useCompany()
  const scopeLabel = useScopeLabel()
  const { can, member, loading: accessLoading } = useAccess()
  const canRead = can(P.masters('items', 'read'))
  const canWrite = can(P.masters('items', 'write'))
  const canAudit = can(P.auditRead)
  const { options, loading: optionsLoading } = useFormOptions()

  const params = useListParams({ sort: 'item_name', order: 'asc', limit: 25, filterKeys: ['item_grp_id', 'status', 'field'] })
  const { state, setQ, setPage, setLimit, setFilter, setFilters } = params
  const groupFilter = state.filters.item_grp_id ?? ''
  /*
   * "All statuses" travels as the word `all`, not as an empty parameter.
   *
   * useListParams drops a filter whose value is empty, so `status=` and "no
   * status at all" arrive identically — and the screen's default is Active,
   * not All. Spelling the third choice out keeps the URL shareable and makes
   * clearing the chip mean "back to the default" rather than "widen silently".
   */
  const statusParam = state.filters.status || 'active'
  const apiStatus: 'active' | 'inactive' | '' = statusParam === 'all' ? '' : (statusParam as 'active' | 'inactive')

  const field = findBulkField(state.filters.field)
  const readOnlyField = isReadOnlyField(field)

  const [newValue, setNewValue] = useState('')
  const [selection, setSelection] = useState<Map<number, ItemListRow>>(new Map())
  const [showOnlySelected, setShowOnlySelected] = useState(false)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [templateOpen, setTemplateOpen] = useState(false)
  const [applying, setApplying] = useState(false)
  const [applyError, setApplyError] = useState<string | null>(null)
  const [outcome, setOutcome] = useState<ApplyOutcome | null>(null)
  const [historyBatch, setHistoryBatch] = useState<BulkEditBatch | null>(null)
  const [pendingNav, setPendingNav] = useState<{ to: string; proceed: () => void } | null>(null)
  /** Bumped after a write so the rows and the history refetch. */
  const [applied, setApplied] = useState(0)
  const [templates, setTemplates] = useState<BulkEditTemplate[]>([])
  const searchRef = useRef<HTMLInputElement | null>(null)
  const tableRef = useRef<HTMLDivElement | null>(null)

  /* ---- search: typed locally, pushed to the URL once it settles ---------- */
  const [searchDraft, setSearchDraft] = useState(state.q)
  const debouncedSearch = useDebounce(searchDraft, 300)
  useEffect(() => {
    if (debouncedSearch !== state.q) setQ(debouncedSearch)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only the settled value drives this
  }, [debouncedSearch])

  /* ---- templates: this browser, this member, this company --------------- */
  const templateScope = useMemo(
    () => ({ cmpId: scope?.cmp_id ?? null, userUuid: member?.uuid ?? null }),
    [scope?.cmp_id, member?.uuid],
  )
  const canStoreTemplates = templatesAvailable(templateScope)
  useEffect(() => {
    setTemplates(loadTemplates(templateScope))
  }, [templateScope])

  /* ---- data ------------------------------------------------------------- */
  const list = useQuery(
    (signal) =>
      itemsApi.list(
        {
          limit: state.limit,
          page: state.page,
          sort: state.sort,
          order: state.order,
          q: state.q || undefined,
          item_grp_id: groupFilter ? Number(groupFilter) : '',
          status: apiStatus,
        },
        signal,
      ),
    [scope?.cmp_id, state.q, state.limit, state.page, state.sort, state.order, groupFilter, apiStatus, applied],
    { enabled: !!scope && canRead, resetKey: scope?.cmp_id ?? null },
  )

  const history = useQuery(
    (signal) =>
      auditApi.list(
        { entity_type: 'item', action: 'item.bulk_update', limit: HISTORY_LIMIT, sort: 'created_at', order: 'desc' },
        signal,
      ),
    [scope?.cmp_id, applied],
    { enabled: !!scope && canAudit, resetKey: scope?.cmp_id ?? null },
  )

  const rows = useMemo(() => list.data?.data ?? [], [list.data])
  const filteredTotal = list.data?.meta.total ?? null

  /* A fresh page carries fresh values for rows that are already ticked, so the
     selection is refreshed from it — otherwise an item written a moment ago
     would still be counted as "will update" from its pre-write snapshot. */
  useEffect(() => {
    if (rows.length === 0) return
    setSelection((prev) => {
      if (prev.size === 0) return prev
      let touched = false
      const next = new Map(prev)
      for (const row of rows) {
        if (next.has(row.item_id)) {
          next.set(row.item_id, row)
          touched = true
        }
      }
      return touched ? next : prev
    })
  }, [rows])

  /* Another company is another catalogue: ids from the last one mean nothing. */
  useEffect(() => {
    setSelection(new Map())
    setOutcome(null)
  }, [scope?.cmp_id])

  /* ---- the plan --------------------------------------------------------- */
  const selectedIds = useMemo(() => new Set(selection.keys()), [selection])
  const check = useMemo(() => checkNewValue(field, newValue), [field, newValue])
  const nextKey = readOnlyField || check.blocking ? null : normalizedKey(field, newValue)

  /** Over the whole selection, across every page it was made on. */
  const selectionPlan = useMemo(
    () => planBulkEdit({ rows: [...selection.values()], field, newValue, selectedIds, check }),
    [selection, field, newValue, selectedIds, check],
  )
  /** Over the rows on screen — what the table renders. */
  const visiblePlan = useMemo(
    () => planBulkEdit({ rows, field, newValue, selectedIds, check }),
    [rows, field, newValue, selectedIds, check],
  )

  const gate = applyGate(selectionPlan, field, check, canWrite)
  const suggestion = readOnlyField ? null : suggestNormalizedValue(field, newValue)
  /*
   * Two figures, because one cannot say what the card needs to say: how many
   * rows on this page have no value at all, and how many of those are not
   * already ticked. With only the second, a page whose empty rows were all
   * selected would read "every item already has a brand", which is false.
   */
  const missing = useMemo(() => {
    const empty = rows.filter((r) => currentValueKey(r, field) === '')
    return { total: empty.length, unselected: empty.filter((r) => !selectedIds.has(r.item_id)).length }
  }, [rows, field, selectedIds])

  const groupLabel = useMemo(() => {
    if (!groupFilter) return null
    return options?.item_groups.find((g) => String(g.item_grp_id) === groupFilter)?.grp_name ?? `#${groupFilter}`
  }, [groupFilter, options])

  const chips = useMemo(
    () =>
      buildChips({
        search: state.q,
        groupId: groupFilter,
        groupLabel,
        // The default (Active) is not a chip: a control that cannot be cleared
        // to anything else is noise in a row about what the reader has chosen.
        status: statusParam === 'active' ? '' : statusParam,
        field,
        newValue,
        newValueLabel: nextKey === null ? newValue.trim() : nextKey === '' ? 'Cleared' : formatFieldValue(field, nextKey, options),
        selectedCount: selection.size,
      }),
    [state.q, groupFilter, groupLabel, statusParam, field, newValue, nextKey, options, selection.size],
  )

  /* ---- history ---------------------------------------------------------- */
  const batches = useMemo(() => groupBulkEdits(history.data?.data ?? []), [history.data])
  const lastBatch = batches[0] ?? null
  const lastActorLabel = useMemo(() => {
    if (!lastBatch) return null
    if (lastBatch.actorUuid && member?.uuid && lastBatch.actorUuid === member.uuid) {
      return member.display_name?.trim() || 'you'
    }
    return actorIdentity({ actor_uuid: lastBatch.actorUuid }).label
  }, [lastBatch, member])

  /* ---- selection handlers ----------------------------------------------- */
  const toggleRow = useCallback((plan: RowPlan) => {
    setSelection((prev) => {
      const next = new Map(prev)
      if (next.has(plan.row.item_id)) next.delete(plan.row.item_id)
      else next.set(plan.row.item_id, plan.row)
      return next
    })
  }, [])

  const toggleVisibleRows = useCallback(() => {
    setSelection((prev) => toggleVisibleSelection(rows, prev))
  }, [rows])

  const clearSelection = useCallback(() => setSelection(new Map()), [])

  const handleSelectMissing = useCallback(() => {
    const { next, added } = selectMissing(rows, field, selection)
    if (added === 0) return
    setSelection(next)
    toast.info(`${added} item${added === 1 ? '' : 's'} with no ${field.label.toLowerCase()} ticked`)
  }, [rows, field, selection, toast])

  /* ---- chips ------------------------------------------------------------ */
  const clearChip = useCallback(
    (key: ChipKey) => {
      switch (key) {
        case 'q':
          setSearchDraft('')
          setQ('')
          break
        case 'item_grp_id':
          setFilter('item_grp_id', '')
          break
        case 'status':
          setFilter('status', '')
          break
        case 'value':
          setNewValue('')
          break
        case 'selection':
          clearSelection()
          break
        default:
          break
      }
    },
    [setQ, setFilter, clearSelection],
  )

  const clearFilters = useCallback(() => {
    setSearchDraft('')
    setFilters({ q: '', item_grp_id: '', status: '' })
  }, [setFilters])

  /* ---- templates -------------------------------------------------------- */
  const handleApplyTemplate = useCallback(
    (template: BulkEditTemplate) => {
      setFilters({ field: template.field, item_grp_id: template.groupId, status: template.status })
      setNewValue(template.value)
      setTemplateOpen(false)
      toast.info(`Template “${template.name}” applied`)
    },
    [setFilters, toast],
  )

  const handleSaveTemplate = useCallback(
    (draft: TemplateDraft) => {
      const saved = saveTemplate(templateScope, draft)
      setTemplates(saved)
      if (saved.some((t) => t.name.toLowerCase() === draft.name.trim().toLowerCase())) {
        toast.success(`Template “${draft.name.trim()}” saved in this browser`)
      } else {
        toast.error('This browser would not store the template')
      }
    },
    [templateScope, toast],
  )

  const handleDeleteTemplate = useCallback(
    (id: string) => {
      setTemplates(deleteTemplate(templateScope, id))
    },
    [templateScope],
  )

  /* ---- apply ------------------------------------------------------------ */
  const openConfirm = useCallback(() => {
    if (!gate.canApply) return
    setApplyError(null)
    setPreviewOpen(false)
    setConfirmOpen(true)
  }, [gate.canApply])

  const performApply = useCallback(async () => {
    const payload = buildPayload(selectionPlan, field, newValue)
    const sentIds = payload.map((r) => r.item_id)
    if (sentIds.length === 0) return
    setApplying(true)
    setApplyError(null)
    try {
      const result = await itemsApi.bulkUpdate(payload)
      const summary = summarizeOutcome(sentIds, selectionPlan.counts.unchanged, result)
      setOutcome(summary)
      // Group, category and brand counts move with the write, and every item
      // form reads those lists from the same short-lived cache.
      invalidateFormOptions()
      setConfirmOpen(false)
      setApplied((n) => n + 1)
      if (summary.complete) {
        toast.success(`${formatInt(summary.updated)} item${summary.updated === 1 ? '' : 's'} updated successfully.`)
      } else {
        // Never a success toast for a write that came back short.
        toast.error('Bulk update completed with issues')
      }
    } catch (err: unknown) {
      // Nothing was written: the endpoint rolls the whole batch back on any rejected row.
      setApplyError(errorMessage(err))
      setOutcome(null)
    } finally {
      setApplying(false)
    }
  }, [selectionPlan, field, newValue, toast])

  /* ---- leaving with a change set up ------------------------------------- */
  const dirty = canWrite && selectionPlan.counts.willUpdate > 0 && !applying
  useUnsavedChanges({
    when: dirty,
    onBlocked: (to, proceed) => setPendingNav({ to, proceed }),
  })

  /* ---- keyboard --------------------------------------------------------- */
  usePageKeyboard({ searchInputRef: searchRef, onRefresh: list.reload })
  const shortcuts = useMemo(
    () => ({
      'alt+p': (e: KeyboardEvent) => {
        e.preventDefault()
        setPreviewOpen(true)
      },
      'alt+a': (e: KeyboardEvent) => {
        e.preventDefault()
        openConfirm()
      },
    }),
    [openConfirm],
  )
  useKeyboardScope('page', shortcuts, { enabled: !previewOpen && !confirmOpen && !templateOpen && historyBatch === null })

  /** Item names for a short write — an id tells the reader nothing on its own. */
  const namesOf = useCallback(
    (ids: readonly number[]) => {
      const shown = ids.slice(0, 6).map((id) => selection.get(id)?.item_name ?? `#${id}`)
      return ids.length > shown.length ? `${shown.join(', ')} and ${ids.length - shown.length} more` : shown.join(', ')
    },
    [selection],
  )

  const viewSelected = useCallback(() => {
    setShowOnlySelected(true)
    tableRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [])

  /* ---- render ----------------------------------------------------------- */
  const header = (
    <BreadcrumbHeader
      breadcrumbs={[{ label: 'Items', to: '/items' }, { label: 'Bulk edit' }]}
      title="Bulk edit items"
      description="Change one field across many items at once. Save time and keep your master data consistent."
      icon={Layers}
      escDirty={dirty}
      actions={
        <>
          <Button variant="secondary" icon={Save} onClick={() => setTemplateOpen(true)} disabled={!canStoreTemplates}>
            Save as template
          </Button>
          <Link
            to="/items"
            className="aic inline-flex h-8 items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 text-sm font-medium text-gray-700 no-underline transition-colors hover:border-primary/40 hover:bg-primary-light hover:text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden />
            Back to items
          </Link>
        </>
      }
    />
  )

  if (!accessLoading && !canRead) {
    return (
      <PageShell>
        {header}
        <Notice kind="error" title="Not permitted">
          Viewing items needs the items read permission.
        </Notice>
      </PageShell>
    )
  }

  return (
    <PageShell>
      {header}

      {!accessLoading && !canWrite ? (
        <Notice kind="warning" title="You can review, but not apply">
          Changing items needs the items write permission. The filters, the preview and the export below all work; the
          Apply button does not.
        </Notice>
      ) : null}

      <BulkEditKpiCards
        selectedCount={selection.size}
        filteredTotal={filteredTotal}
        counts={selectionPlan.counts}
        valueIssue={check.blocking && !readOnlyField}
        lastBatch={lastBatch}
        lastActorLabel={lastActorLabel}
        historyLoading={history.loading}
        historyReadable={canAudit}
        loading={list.loading && list.data === null}
        onViewSelected={viewSelected}
      />

      {/* A count this page cannot honour, stated once rather than discovered at Apply. */}
      {selectionPlan.counts.willUpdate > 500 ? (
        <Notice kind="warning" title="Too many items for one write">
          {formatInt(selectionPlan.counts.willUpdate)} items would change, and the API writes at most 500 per request.
          Narrow the filters, or work through the selection a page at a time.
        </Notice>
      ) : null}

      {outcome ? (
        <Notice
          kind={outcome.complete ? 'success' : 'warning'}
          title={outcome.complete ? 'Bulk update applied' : 'Bulk update completed with issues'}
          actions={
            <Button variant="ghost" size="xs" onClick={() => setOutcome(null)}>
              Dismiss
            </Button>
          }
        >
          {formatInt(outcome.updated)} item{outcome.updated === 1 ? '' : 's'} updated
          {outcome.skippedUnchanged > 0
            ? `, ${formatInt(outcome.skippedUnchanged)} already had this value and ${outcome.skippedUnchanged === 1 ? 'was' : 'were'} not written`
            : ''}
          {outcome.missing.length > 0
            ? `. ${formatInt(outcome.missing.length)} item${outcome.missing.length === 1 ? '' : 's'} did not come back from the server and may not have been written (${namesOf(outcome.missing)}). Check them before relying on this run.`
            : '.'}
        </Notice>
      ) : null}

      {/*
        The rail joins the content at `wide` (1400px), not at `xl`.

        The page sits inside a 15rem sidebar, so an `xl` split leaves the table
        about 700px on a 1280 laptop and it scrolls sideways inside its own box
        with the status column half off the edge. Below 1400 the rail stacks
        under the table instead, two-up where there is room — the same
        arrangement every other workspace in this app uses, for the same reason.
      */}
      <div className="grid min-w-0 items-start gap-3 wide:grid-cols-[minmax(0,1fr)_19rem] ultra:grid-cols-[minmax(0,1fr)_21rem]">
        <div className="min-w-0 space-y-3">
          <BulkEditConfigPanel
            search={searchDraft}
            onSearch={setSearchDraft}
            groupId={groupFilter}
            onGroup={(v) => setFilter('item_grp_id', v)}
            status={statusParam}
            onStatus={(v) => setFilter('status', v)}
            field={field}
            onField={(key) => {
              setFilter('field', key)
              setNewValue('')
              setOutcome(null)
            }}
            newValue={newValue}
            onNewValue={(v) => {
              setNewValue(v)
              setOutcome(null)
            }}
            options={options}
            optionsLoading={optionsLoading}
            check={check}
            suggestion={suggestion}
            onApplySuggestion={() => suggestion && setNewValue(suggestion)}
            chips={chips}
            onClearChip={clearChip}
            gate={gate}
            selectedCount={selection.size}
            applying={applying}
            onApply={openConfirm}
            onPreview={() => setPreviewOpen(true)}
            templates={templates}
            templatesAvailable={canStoreTemplates}
            onApplyTemplate={handleApplyTemplate}
            onOpenTemplateDialog={() => setTemplateOpen(true)}
          />

          <div ref={tableRef}>
            <BulkEditItemsTable
              plan={visiblePlan}
              selectedRows={selectionPlan.rows}
              field={field}
              options={options}
              nextKey={nextKey}
              loading={list.loading}
              error={list.error}
              onRetry={list.reload}
              meta={list.data?.meta ?? null}
              limit={state.limit}
              onPage={setPage}
              onLimit={setLimit}
              showOnlySelected={showOnlySelected}
              onShowOnlySelected={setShowOnlySelected}
              onToggleRow={toggleRow}
              onToggleVisible={showOnlySelected ? clearSelection : toggleVisibleRows}
              filteredTotal={filteredTotal}
              scopeLabel={scopeLabel}
              hasFilters={Boolean(state.q || groupFilter || statusParam !== 'active')}
              onClearFilters={clearFilters}
            />
          </div>
        </div>

        <aside className="grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-3 wide:grid-cols-1" aria-label="Bulk edit assistance">
          <BulkEditAssistantCard
            field={field}
            suggestion={suggestion}
            missingTotal={missing.total}
            missingUnselected={missing.unselected}
            onTidy={() => suggestion && setNewValue(suggestion)}
            onSelectMissing={handleSelectMissing}
            onSaveTemplate={() => setTemplateOpen(true)}
            templatesAvailable={canStoreTemplates}
            canWrite={canWrite}
          />
          <BulkEditValidationCard
            plan={selectionPlan}
            field={field}
            check={check}
            nextKey={nextKey}
            options={options}
            canApply={gate.canApply}
            selectedCount={selection.size}
          />
          <BulkEditHistoryCard
            batches={batches.slice(0, HISTORY_SHOWN)}
            options={options}
            loading={history.loading}
            error={history.error}
            onRetry={history.reload}
            readable={canAudit}
            onOpen={setHistoryBatch}
          />
        </aside>
      </div>

      {/* A live count for a screen reader: the table's tick boxes change a
          number that is otherwise only visible at the top of the page. */}
      <p className="sr-only" role="status" aria-live="polite">
        {selection.size} item{selection.size === 1 ? '' : 's'} selected, {selectionPlan.counts.willUpdate} would change.
      </p>

      <BulkEditPreviewDialog
        open={previewOpen}
        onClose={() => setPreviewOpen(false)}
        onConfirm={openConfirm}
        plan={selectionPlan}
        field={field}
        nextKey={nextKey}
        options={options}
        canApply={gate.canApply}
      />

      <ConfirmDialog
        open={confirmOpen}
        busy={applying}
        error={applyError}
        title={`Apply changes to ${formatInt(selectionPlan.counts.willUpdate)} item${selectionPlan.counts.willUpdate === 1 ? '' : 's'}?`}
        confirmLabel={`Apply to ${formatInt(selectionPlan.counts.willUpdate)} item${selectionPlan.counts.willUpdate === 1 ? '' : 's'}`}
        onCancel={() => {
          setConfirmOpen(false)
          setApplyError(null)
        }}
        onConfirm={() => void performApply()}
        message={
          <div className="space-y-2">
            <p>
              <span className="text-gray-500">Field:</span>{' '}
              <strong className="font-semibold text-gray-900">{field.label}</strong>
            </p>
            <p>
              <span className="text-gray-500">New value:</span>{' '}
              <strong className="font-semibold tabular-nums text-gray-900">
                {nextKey === null || nextKey === '' ? 'Cleared' : formatFieldValue(field, nextKey, options)}
              </strong>
            </p>
            <p>
              {formatInt(selectionPlan.counts.willUpdate)} item record
              {selectionPlan.counts.willUpdate === 1 ? '' : 's'} will be updated
              {selectionPlan.counts.unchanged > 0
                ? `, and ${formatInt(selectionPlan.counts.unchanged)} already holding this value will be left alone`
                : ''}
              .
            </p>
            {field.key === 'is_active' ? (
              <p className="text-amber-700">
                Deactivated items stop appearing on new documents. Existing stock, history and valuation are untouched.
              </p>
            ) : null}
          </div>
        }
      />

      <BulkEditTemplateDialog
        open={templateOpen}
        onClose={() => setTemplateOpen(false)}
        onSave={handleSaveTemplate}
        onDelete={handleDeleteTemplate}
        onApply={handleApplyTemplate}
        templates={templates}
        available={canStoreTemplates}
        field={field}
        newValue={newValue}
        groupId={groupFilter}
        groupLabel={groupLabel}
        status={statusParam}
      />

      <BulkEditHistoryDrawer batch={historyBatch} options={options} onClose={() => setHistoryBatch(null)} />

      <ConfirmDialog
        open={pendingNav !== null}
        title="Leave without applying?"
        confirmLabel="Leave"
        danger
        message={`${formatInt(selectionPlan.counts.willUpdate)} item${selectionPlan.counts.willUpdate === 1 ? '' : 's'} are set up to change and nothing has been written yet. Leaving discards the selection.`}
        onCancel={() => setPendingNav(null)}
        onConfirm={() => {
          const go = pendingNav?.proceed
          setPendingNav(null)
          go?.()
        }}
      />
    </PageShell>
  )
}

export default ItemsBulkEditPage
