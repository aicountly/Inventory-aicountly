import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, ArrowRight, CalendarClock, CheckCircle2, Eye, Filter, RotateCcw } from 'lucide-react'
import { useAccess } from '../../access/AccessContext'
import { Notice } from '../../components/Notice'
import { useDocumentTitle } from '../../hooks/useDocumentTitle'
import { P } from '../../services/access'
import { ApiError, errorMessage } from '../../services/api'
import {
  applyBulkTaxUpdate,
  fetchBulkTaxCategories,
  fetchBulkTaxUpdateRecords,
  taxCategoryOptionLabel,
  validateBulkTaxUpdate,
} from '../../services/bulkTaxUpdateApi'
import type {
  BooksTaxCategory,
  BulkTaxUpdateApplyResult,
  BulkTaxUpdateRow,
  BulkTaxUpdateValidation,
} from '../../services/bulkTaxUpdateApi'
import { fetchItemFormOptions } from '../../services/items'
import type { ItemFormOptions } from '../../services/items'
import { BreadcrumbHeader } from '../../ui/shell/BreadcrumbHeader'
import { PageShell } from '../../ui/shell/PageShell'
import { Button } from '../../ui/Button'
import { Card } from '../../ui/Card'
import { EmptyState } from '../../ui/EmptyState'
import { Input } from '../../ui/Input'
import { LoadingState } from '../../ui/LoadingState'
import { Select } from '../../ui/Select'
import { useToast } from '../../ui/ToastContext'
import { formatInt } from '../../utils/format'
import { BulkTaxUpdatePreviewDialog } from './BulkTaxUpdatePreviewDialog'

const PAGE_SIZE_OPTIONS = [25, 50, 100, 500]

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

interface Filters {
  q: string
  itemGrpId: string
  stockCatId: string
  currentTaxCatId: string
  hsn: string
}

const EMPTY_FILTERS: Filters = { q: '', itemGrpId: '', stockCatId: '', currentTaxCatId: '', hsn: '' }

/**
 * `/items/bulk-tax-update` — re-assign the GST tax category across many items at once.
 *
 * Inventory owns none of this data: the tax rate is a Books tax-category row and the
 * with-effect-from history that carries it forward. So every read and write here goes
 * through `bulkTaxUpdateApi`, which proxies to Books' own Operations → Bulk Update
 * engine under the operator's own Books session — this screen is a filter-and-select
 * front end onto that, not a second implementation of it.
 *
 * The flow is deliberately narrower than Bulk edit: one new tax category and one
 * effective date apply to every ticked item, because that is what a rate revision
 * actually is — the government does not notify a different rate per item. Preview
 * calls Books' own `validate`, so the before/after table can never disagree with what
 * Apply is about to write.
 */
export function BulkTaxUpdatePage() {
  useDocumentTitle('Bulk tax rate update | Aicountly Inventory')
  const toast = useToast()
  const { can, loading: accessLoading } = useAccess()
  const canRead = can(P.masters('items', 'read'))
  const canWrite = can(P.masters('items', 'write'))

  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)

  const [rows, setRows] = useState<BulkTaxUpdateRow[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [formOptions, setFormOptions] = useState<ItemFormOptions | null>(null)
  const [taxCategories, setTaxCategories] = useState<BooksTaxCategory[]>([])
  const [taxCategoriesError, setTaxCategoriesError] = useState<string | null>(null)

  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [newTaxCatId, setNewTaxCatId] = useState('')
  const [effectiveFrom, setEffectiveFrom] = useState(todayIso)

  const [previewOpen, setPreviewOpen] = useState(false)
  const [validating, setValidating] = useState(false)
  const [validation, setValidation] = useState<BulkTaxUpdateValidation | null>(null)
  const [applying, setApplying] = useState(false)
  const [applyResult, setApplyResult] = useState<BulkTaxUpdateApplyResult | null>(null)

  // Options load once — they do not depend on the filters or the grid.
  useEffect(() => {
    let cancelled = false
    fetchItemFormOptions()
      .then((opts) => {
        if (!cancelled) setFormOptions(opts)
      })
      .catch((err) => {
        if (!cancelled) toast.error(errorMessage(err, 'Failed to load item groups / categories'))
      })
    fetchBulkTaxCategories()
      .then((cats) => {
        if (!cancelled) setTaxCategories(cats)
      })
      .catch((err) => {
        if (!cancelled) setTaxCategoriesError(errorMessage(err, 'Failed to load tax categories from Books'))
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const loadRecords = useCallback(() => {
    if (!canRead) return
    setLoading(true)
    setLoadError(null)
    fetchBulkTaxUpdateRecords({
      q: filters.q || undefined,
      item_grp_id: filters.itemGrpId ? Number(filters.itemGrpId) : '',
      stock_cat_id: filters.stockCatId ? Number(filters.stockCatId) : '',
      tax_cat_id: filters.currentTaxCatId ? Number(filters.currentTaxCatId) : '',
      hsn: filters.hsn || undefined,
      page,
      limit: pageSize,
    })
      .then((res) => {
        setRows(res.data ?? [])
        setTotal(res.meta?.total ?? (res.data ?? []).length)
      })
      .catch((err) => {
        const message = errorMessage(err, 'Failed to load items')
        setLoadError(message)
        toast.error(message)
      })
      .finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canRead, filters, page, pageSize])

  useEffect(() => {
    loadRecords()
  }, [loadRecords])

  // Filters change the result set — page 1 and a clean selection, every time.
  const setFilter = useCallback((key: keyof Filters, value: string) => {
    setFilters((prev) => ({ ...prev, [key]: value }))
    setPage(1)
    setSelected(new Set())
  }, [])

  const clearFilters = useCallback(() => {
    setFilters(EMPTY_FILTERS)
    setPage(1)
    setSelected(new Set())
  }, [])

  const hasActiveFilters = Object.values(filters).some((v) => v !== '')

  const toggleRow = useCallback((id: number) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const allOnPageSelected = rows.length > 0 && rows.every((r) => selected.has(r.id))
  const toggleAllOnPage = useCallback(() => {
    setSelected((prev) => {
      const next = new Set(prev)
      const selectAll = !rows.every((r) => next.has(r.id))
      rows.forEach((r) => (selectAll ? next.add(r.id) : next.delete(r.id)))
      return next
    })
  }, [rows])

  const newCat = useMemo(() => taxCategories.find((c) => String(c.tax_cat_id) === newTaxCatId) ?? null, [taxCategories, newTaxCatId])
  const canPreview = selected.size > 0 && newTaxCatId !== '' && effectiveFrom !== ''

  const buildBatch = useCallback(
    () => Array.from(selected).map((id) => ({ id, values: { tax_cat_id: Number(newTaxCatId) } })),
    [selected, newTaxCatId],
  )

  const handlePreview = useCallback(async () => {
    if (!canPreview) return
    setValidating(true)
    try {
      const res = await validateBulkTaxUpdate(buildBatch(), effectiveFrom)
      setValidation(res.data)
      setPreviewOpen(true)
    } catch (err) {
      if (err instanceof ApiError && err.status === 422 && err.details?.rows) {
        setValidation(err.details as unknown as BulkTaxUpdateValidation)
        setPreviewOpen(true)
        toast.error('Some rows failed validation — review them before applying')
      } else {
        toast.error(errorMessage(err, 'Validation failed'))
      }
    } finally {
      setValidating(false)
    }
  }, [canPreview, buildBatch, effectiveFrom, toast])

  const handleApply = useCallback(async () => {
    setApplying(true)
    try {
      const res = await applyBulkTaxUpdate(buildBatch(), effectiveFrom)
      setApplyResult(res.data)
      setPreviewOpen(false)
      setSelected(new Set())
      setValidation(null)
      toast.success(`Updated ${res.data.updated} item(s)`)
      loadRecords()
    } catch (err) {
      if (err instanceof ApiError && err.status === 422 && err.details?.rows) {
        setValidation(err.details as unknown as BulkTaxUpdateValidation)
        toast.error('Validation failed on the server — review the highlighted rows')
      } else {
        toast.error(errorMessage(err, 'Bulk update failed'))
      }
    } finally {
      setApplying(false)
    }
  }, [buildBatch, effectiveFrom, toast, loadRecords])

  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  return (
    <PageShell paddingBottom>
      <BreadcrumbHeader
        breadcrumbs={[{ label: 'Items', to: '/items' }, { label: 'Bulk Tax Rate Update' }]}
        title="Bulk Tax Rate Update"
        description="Re-assign the GST tax category across many items at once — e.g. moving every item on a superseded slab to the rate a government notification puts in force. Writes go through Aicountly Books, which owns the tax rate and its with-effect-from history."
        backTo="/items"
      />

      {!canRead ? (
        accessLoading ? (
          <LoadingState label="Checking access…" />
        ) : (
          <EmptyState title="No access" description="You need read access to items to use this screen." />
        )
      ) : (
        <>
          {applyResult ? (
            <Card padding="md" className="border-emerald-200 bg-emerald-50">
              <div className="flex items-start gap-3">
                <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" aria-hidden />
                <div>
                  <p className="text-sm font-semibold text-emerald-900">
                    Updated {formatInt(applyResult.updated)} item{applyResult.updated === 1 ? '' : 's'}
                    {applyResult.unchanged ? ` — ${formatInt(applyResult.unchanged)} already matched and were left as-is` : ''}.
                  </p>
                  <p className="mt-0.5 text-xs text-emerald-700">
                    Effective {effectiveFrom}. Inventory's own list picks up the new tax category once Books syncs it back.
                  </p>
                </div>
                <Button variant="ghost" size="xs" icon={RotateCcw} className="ml-auto" onClick={() => setApplyResult(null)}>
                  Dismiss
                </Button>
              </div>
            </Card>
          ) : null}

          <Card padding="md">
            <h2 className="mb-3 flex items-center gap-1.5 text-[15px] font-semibold text-gray-900">
              <Filter className="h-4 w-4 text-gray-400" aria-hidden />
              1. Find items
            </h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              <Input
                size="md"
                type="search"
                placeholder="Search name, alias, SKU…"
                value={filters.q}
                onChange={(e) => setFilter('q', e.target.value)}
              />
              <Select size="md" value={filters.itemGrpId} onChange={(e) => setFilter('itemGrpId', e.target.value)}>
                <option value="">All groups</option>
                {(formOptions?.item_groups ?? []).map((g) => (
                  <option key={g.item_grp_id} value={g.item_grp_id}>
                    {g.grp_name}
                  </option>
                ))}
              </Select>
              <Select size="md" value={filters.stockCatId} onChange={(e) => setFilter('stockCatId', e.target.value)}>
                <option value="">All categories</option>
                {(formOptions?.stock_categories ?? []).map((c) => (
                  <option key={c.stock_cat_id} value={c.stock_cat_id}>
                    {c.cat_name}
                  </option>
                ))}
              </Select>
              <Select size="md" value={filters.currentTaxCatId} onChange={(e) => setFilter('currentTaxCatId', e.target.value)}>
                <option value="">Any current tax category</option>
                {taxCategories.map((c) => (
                  <option key={c.tax_cat_id} value={c.tax_cat_id}>
                    {taxCategoryOptionLabel(c)}
                  </option>
                ))}
              </Select>
              <Input
                size="md"
                placeholder="HSN/SAC contains…"
                value={filters.hsn}
                onChange={(e) => setFilter('hsn', e.target.value.toUpperCase())}
              />
            </div>
            {hasActiveFilters ? (
              <Button variant="link" size="xs" className="mt-2" onClick={clearFilters}>
                Clear filters
              </Button>
            ) : null}
          </Card>

          <Card padding="md">
            <h2 className="mb-3 text-[15px] font-semibold text-gray-900">2. Choose the new rate</h2>
            {taxCategoriesError ? (
              <Notice kind="error" className="mb-3">
                {taxCategoriesError} — this Books session may be missing permission to read tax categories.
              </Notice>
            ) : null}
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <div>
                <label className="text-[11px] font-semibold uppercase tracking-wide text-gray-500" htmlFor="new-tax-cat">
                  New tax category
                </label>
                <div className="mt-1">
                  <Select id="new-tax-cat" size="md" value={newTaxCatId} onChange={(e) => setNewTaxCatId(e.target.value)}>
                    <option value="">Choose…</option>
                    {taxCategories.map((c) => (
                      <option key={c.tax_cat_id} value={c.tax_cat_id}>
                        {taxCategoryOptionLabel(c)}
                      </option>
                    ))}
                  </Select>
                </div>
              </div>
              <div>
                <label className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-500" htmlFor="effective-from">
                  <CalendarClock className="h-3.5 w-3.5" aria-hidden />
                  Effective from
                </label>
                <div className="mt-1">
                  <Input id="effective-from" size="md" type="date" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} />
                </div>
              </div>
            </div>
            <p className="mt-2 text-xs text-gray-500">
              The date this change takes effect — e.g. the date a government notification puts a revised rate into
              force. A new with-effect-from profile opens on this date for every ticked item; an item with a change
              already scheduled for a later date keeps that date.
            </p>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <Button size="lg" icon={Eye} onClick={handlePreview} loading={validating} disabled={!canPreview}>
                Preview {selected.size || ''} item{selected.size === 1 ? '' : 's'}
              </Button>
              {!canWrite ? <span className="text-xs text-amber-700">Read-only — you can preview but not apply.</span> : null}
            </div>
          </Card>

          <Card padding="none" className="overflow-hidden">
            {loading ? (
              <LoadingState label="Loading items…" />
            ) : loadError ? (
              <EmptyState
                icon={AlertTriangle}
                title="Could not load items"
                description={loadError}
                action="Retry"
                onAction={loadRecords}
              />
            ) : rows.length === 0 ? (
              <EmptyState title="No items match" description="Adjust the filters to see more items." />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] text-sm">
                  <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
                    <tr>
                      <th scope="col" className="w-10 px-2.5 py-2">
                        <input
                          type="checkbox"
                          aria-label="Select all items on this page"
                          checked={allOnPageSelected}
                          onChange={toggleAllOnPage}
                        />
                      </th>
                      <th scope="col" className="px-2.5 py-2 text-left font-semibold">Item</th>
                      <th scope="col" className="px-2.5 py-2 text-left font-semibold">Group</th>
                      <th scope="col" className="px-2.5 py-2 text-left font-semibold">Category</th>
                      <th scope="col" className="px-2.5 py-2 text-left font-semibold">Current tax category</th>
                      <th scope="col" className="px-2.5 py-2 text-left font-semibold">HSN</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {rows.map((row) => (
                      <tr key={row.id} className={selected.has(row.id) ? 'bg-primary-light/30' : 'hover:bg-gray-50'}>
                        <td className="px-2.5 py-1.5 align-top">
                          <input
                            type="checkbox"
                            aria-label={`Select ${row.label}`}
                            checked={selected.has(row.id)}
                            onChange={() => toggleRow(row.id)}
                          />
                        </td>
                        <td className="px-2.5 py-1.5 align-top font-medium text-gray-900">{row.label}</td>
                        <td className="px-2.5 py-1.5 align-top text-gray-600">{row.item_grp_name || '—'}</td>
                        <td className="px-2.5 py-1.5 align-top text-gray-600">{row.stock_cat_name || '—'}</td>
                        <td className="px-2.5 py-1.5 align-top text-gray-600">{row.tax_cat_name || '—'}</td>
                        <td className="px-2.5 py-1.5 align-top text-gray-600">{row.hsn_sac || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-gray-100 px-3 py-2 text-xs text-gray-500">
              <span>{formatInt(total)} item(s) match</span>
              <div className="flex items-center gap-2">
                <Select size="sm" value={String(pageSize)} onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1) }}>
                  {PAGE_SIZE_OPTIONS.map((n) => (
                    <option key={n} value={n}>
                      {n} / page
                    </option>
                  ))}
                </Select>
                <Button variant="secondary" size="xs" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                  Prev
                </Button>
                <span>
                  Page {page} of {totalPages}
                </span>
                <Button
                  variant="secondary"
                  size="xs"
                  icon={ArrowRight}
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Next
                </Button>
              </div>
            </div>
          </Card>
        </>
      )}

      <BulkTaxUpdatePreviewDialog
        open={previewOpen}
        onClose={() => setPreviewOpen(false)}
        onConfirm={handleApply}
        validation={validation}
        taxCategories={taxCategories}
        newCategoryLabel={newCat ? taxCategoryOptionLabel(newCat) : ''}
        effectiveFrom={effectiveFrom}
        applying={applying}
        canApply={canWrite}
      />
    </PageShell>
  )
}
