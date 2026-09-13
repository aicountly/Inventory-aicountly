import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAccess } from '../../access/AccessContext'
import { useCompany } from '../../company/CompanyContext'
import { Notice } from '../../components/Notice'
import { PageHeader } from '../../components/PageHeader'
import { invalidateFormOptions, useFormOptions } from '../../hooks/useFormOptions'
import { useQuery } from '../../hooks/useQuery'
import { P } from '../../services/access'
import { errorMessage } from '../../services/api'
import { itemsApi } from '../../services/items'
import type { BulkUpdateRow, ItemFormOptions, ItemListRow } from '../../services/items'
import { useToast } from '../../ui/ToastContext'

/** Items fetched per page of the working set. The endpoint applies at most 500 per request. */
const PAGE = 500
const MAX_PER_APPLY = 500

type FieldKey = 'hsn_sac' | 'mrp' | 'item_grp_id' | 'stock_cat_id' | 'brand_id' | 'is_active' | 'min_stock_qty' | 'reorder_point_qty'

interface FieldSpec {
  key: FieldKey
  label: string
  /** How the new value is entered, and how the current value is shown in the table. */
  kind: 'text' | 'number' | 'group' | 'category' | 'brand' | 'status'
  hint?: string
}

/**
 * Only fields whose worst case is a wrong label or price. Units, the valuation method and
 * batch / serial tracking change how stock is counted or costed, so they stay one item at a
 * time on the item form, where the consequences are spelled out.
 */
const FIELDS: FieldSpec[] = [
  { key: 'hsn_sac', label: 'HSN / SAC', kind: 'text', hint: '4 to 8 letters or digits' },
  { key: 'mrp', label: 'MRP', kind: 'number' },
  { key: 'item_grp_id', label: 'Item group', kind: 'group' },
  { key: 'stock_cat_id', label: 'Stock category', kind: 'category' },
  { key: 'brand_id', label: 'Brand', kind: 'brand' },
  { key: 'min_stock_qty', label: 'Minimum stock', kind: 'number' },
  { key: 'reorder_point_qty', label: 'Reorder point', kind: 'number' },
  { key: 'is_active', label: 'Status', kind: 'status' },
]

function currentValue(row: ItemListRow, field: FieldSpec, options: ItemFormOptions | null): string {
  switch (field.kind) {
    case 'group':
      return options?.item_groups.find((g) => g.item_grp_id === row.item_grp_id)?.grp_name ?? '—'
    case 'category':
      return options?.stock_categories.find((c) => c.stock_cat_id === row.stock_cat_id)?.cat_name ?? '—'
    case 'brand':
      return options?.brands.find((b) => b.brand_id === row.brand_id)?.brand_name ?? '—'
    case 'status':
      return Number(row.is_active) === 1 ? 'Active' : 'Inactive'
    default: {
      const v = (row as unknown as Record<string, unknown>)[field.key]
      return v === null || v === undefined || v === '' ? '—' : String(v)
    }
  }
}

/**
 * Change one field across many items at once.
 *
 * The flow is deliberately three steps with the count visible at each: narrow the catalogue,
 * tick the items, set the value. Nothing is written until Apply, and the write is all or
 * nothing — a half-applied price list would be worse than none.
 */
export function ItemsBulkEditPage() {
  const toast = useToast()
  const { scope } = useCompany()
  const { can, loading: accessLoading } = useAccess()
  const canWrite = can(P.masters('items', 'write'))
  const { options } = useFormOptions()

  const [search, setSearch] = useState('')
  const [groupFilter, setGroupFilter] = useState<number | ''>('')
  const [statusFilter, setStatusFilter] = useState<'active' | 'inactive' | ''>('active')
  const [applied, setApplied] = useState(0)

  const [fieldKey, setFieldKey] = useState<FieldKey>('hsn_sac')
  const [newValue, setNewValue] = useState('')
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<string | null>(null)

  const field = FIELDS.find((f) => f.key === fieldKey) as FieldSpec

  // `applied` is in the deps so the list refetches after a write and shows the new values.
  const list = useQuery(
    async (signal) =>
      itemsApi.list(
        { limit: PAGE, offset: 0, sort: 'item_name', order: 'asc', q: search || undefined, item_grp_id: groupFilter || '', status: statusFilter },
        signal,
      ),
    [scope?.cmp_id, search, groupFilter, statusFilter, applied],
    { enabled: !!scope },
  )

  const rows = useMemo(() => list.data?.data ?? [], [list.data])
  const total = list.data?.meta.total ?? 0
  const selectedRows = useMemo(() => rows.filter((r) => selected.has(r.item_id)), [rows, selected])
  const overLimit = selectedRows.length > MAX_PER_APPLY

  function toggle(itemId: number) {
    setSelected((prev) => {
      const next = new Set(prev)
      next.has(itemId) ? next.delete(itemId) : next.add(itemId)
      return next
    })
  }

  function toggleAll() {
    setSelected((prev) => (rows.every((r) => prev.has(r.item_id)) ? new Set() : new Set(rows.map((r) => r.item_id))))
  }

  /** '' clears an optional field; only Status refuses to be blank, having no empty meaning. */
  function payloadValue(): string | number | null {
    const raw = newValue.trim()
    if (field.kind === 'status') return raw === 'active' ? 1 : 0
    if (raw === '') return null
    if (field.kind === 'number') return Number(raw)
    if (field.kind === 'group' || field.kind === 'category' || field.kind === 'brand') return Number(raw)
    return raw
  }

  function validate(): string | null {
    if (selectedRows.length === 0) return 'Tick at least one item.'
    if (overLimit) return `Select at most ${MAX_PER_APPLY} items per apply; narrow the filter or do it in batches.`
    if (field.kind === 'status' && newValue.trim() === '') return 'Choose Active or Inactive.'
    if (field.kind === 'number' && newValue.trim() !== '' && !Number.isFinite(Number(newValue))) return 'Enter a number.'
    if (field.key === 'hsn_sac' && newValue.trim() !== '' && !/^[0-9A-Za-z]{4,8}$/.test(newValue.trim())) {
      return 'HSN / SAC must be 4 to 8 letters or digits.'
    }
    return null
  }

  async function apply() {
    const problem = validate()
    if (problem) {
      setError(problem)
      setResult(null)
      return
    }
    setSaving(true)
    setError(null)
    setResult(null)
    try {
      const value = payloadValue()
      const payload: BulkUpdateRow[] = selectedRows.map((r) => ({ item_id: r.item_id, [field.key]: value }) as BulkUpdateRow)
      const res = await itemsApi.bulkUpdate(payload)
      // The group, category and brand lists feed every item form's dropdowns; item counts moved.
      invalidateFormOptions()
      setSelected(new Set())
      setNewValue('')
      setApplied((n) => n + 1)
      setResult(`${field.label} updated on ${res.updated} item${res.updated === 1 ? '' : 's'}.`)
      toast.success(`${res.updated} item${res.updated === 1 ? '' : 's'} updated`)
    } catch (err: unknown) {
      // Nothing was written: the endpoint rolls the whole batch back on any rejected row.
      setError(errorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  if (!accessLoading && !canWrite) {
    return (
      <>
        <PageHeader title="Bulk edit items" breadcrumbs={[{ label: 'Items', to: '/items' }, { label: 'Bulk edit' }]} />
        <Notice kind="error" title="Not permitted">
          Editing items needs the items write permission.
        </Notice>
      </>
    )
  }

  return (
    <>
      <PageHeader
        title="Bulk edit items"
        subtitle="Change one field across many items at once."
        breadcrumbs={[{ label: 'Items', to: '/items' }, { label: 'Bulk edit' }]}
        actions={<Link className="btn" to="/items">Back to items</Link>}
      />

      <section className="card">
        <div className="filters">
          <input
            className="input"
            type="search"
            placeholder="Search name, alias, SKU or barcode…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search items"
          />
          <select className="select" value={groupFilter} onChange={(e) => setGroupFilter(e.target.value ? Number(e.target.value) : '')} aria-label="Item group">
            <option value="">All groups</option>
            {(options?.item_groups ?? []).map((g) => (
              <option key={g.item_grp_id} value={g.item_grp_id}>{g.grp_name}</option>
            ))}
          </select>
          <select className="select" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as 'active' | 'inactive' | '')} aria-label="Status">
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
            <option value="">All</option>
          </select>
        </div>
        {total > rows.length ? (
          <p className="muted">
            Showing the first {rows.length} of {total} matching items. Narrow the search or group to reach the rest.
          </p>
        ) : null}
      </section>

      <section className="card">
        <div className="filters">
          <label>
            Field
            <select className="select" value={fieldKey} onChange={(e) => { setFieldKey(e.target.value as FieldKey); setNewValue('') }}>
              {FIELDS.map((f) => (
                <option key={f.key} value={f.key}>{f.label}</option>
              ))}
            </select>
          </label>
          <label>
            New value
            {field.kind === 'status' ? (
              <select className="select" value={newValue} onChange={(e) => setNewValue(e.target.value)}>
                <option value="">Choose…</option>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            ) : field.kind === 'group' || field.kind === 'category' || field.kind === 'brand' ? (
              <select className="select" value={newValue} onChange={(e) => setNewValue(e.target.value)}>
                <option value="">None</option>
                {field.kind === 'group' && (options?.item_groups ?? []).map((g) => <option key={g.item_grp_id} value={g.item_grp_id}>{g.grp_name}</option>)}
                {field.kind === 'category' && (options?.stock_categories ?? []).map((c) => <option key={c.stock_cat_id} value={c.stock_cat_id}>{c.cat_name}</option>)}
                {field.kind === 'brand' && (options?.brands ?? []).map((b) => <option key={b.brand_id} value={b.brand_id}>{b.brand_name}</option>)}
              </select>
            ) : (
              <input
                className="input"
                type={field.kind === 'number' ? 'number' : 'text'}
                value={newValue}
                onChange={(e) => setNewValue(e.target.value)}
                placeholder={field.hint ?? 'Leave blank to clear'}
              />
            )}
          </label>
          <button className="btn btn-primary" type="button" onClick={apply} disabled={saving || selectedRows.length === 0 || overLimit}>
            {saving ? 'Applying…' : `Apply to ${selectedRows.length} item${selectedRows.length === 1 ? '' : 's'}`}
          </button>
        </div>
        {field.kind !== 'status' && newValue.trim() === '' ? (
          <p className="muted">Blank clears {field.label.toLowerCase()} on every ticked item.</p>
        ) : null}
        {error ? <Notice kind="error" title="Nothing was changed">{error}</Notice> : null}
        {result ? <Notice kind="success">{result}</Notice> : null}
      </section>

      <section className="card">
        {list.error ? <Notice kind="error" title="Could not load items">{errorMessage(list.error)}</Notice> : null}
        {list.loading ? <p className="muted">Loading…</p> : null}
        {!list.loading && rows.length === 0 ? <p className="muted">No items match those filters.</p> : null}
        {rows.length > 0 ? (
          <table className="table">
            <thead>
              <tr>
                <th scope="col">
                  <input
                    type="checkbox"
                    checked={rows.every((r) => selected.has(r.item_id))}
                    onChange={toggleAll}
                    aria-label="Select all shown"
                  />
                </th>
                <th scope="col">Item</th>
                <th scope="col">SKU</th>
                <th scope="col">{field.label} now</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.item_id} className={selected.has(r.item_id) ? 'is-selected' : undefined}>
                  <td>
                    <input
                      type="checkbox"
                      checked={selected.has(r.item_id)}
                      onChange={() => toggle(r.item_id)}
                      aria-label={`Select ${r.item_name}`}
                    />
                  </td>
                  <td>
                    <strong>{r.item_name}</strong>
                    {r.item_alias ? <span className="muted"> · {r.item_alias}</span> : null}
                  </td>
                  <td className="mono">{r.item_sku ?? '—'}</td>
                  <td>{currentValue(r, field, options)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </section>
    </>
  )
}
