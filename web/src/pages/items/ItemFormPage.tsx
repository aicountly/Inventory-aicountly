import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useAccess } from '../../access/AccessContext'
import { useCompany } from '../../company/CompanyContext'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { FormField } from '../../components/FormField'
import { Notice } from '../../components/Notice'
import { PageHeader } from '../../components/PageHeader'
import { invalidateFormOptions, useFormOptions } from '../../hooks/useFormOptions'
import { useQuery } from '../../hooks/useQuery'
import { P } from '../../services/access'
import { errorMessage, isApiError } from '../../services/api'
import { itemsApi, ITEM_TYPES, UOM_ROLES } from '../../services/items'
import type { Item, ItemOpeningsResponse } from '../../services/items'
import { useToast } from '../../ui/ToastContext'
import { formatQty, humanize } from '../../utils/format'
import { emptyItemForm, itemPayload, itemToForm, newOpening, newUnitLine, openingValue, openingsPayload, validateItemForm } from './itemForm'
import type { ItemFormState, OpeningDraft, UnitLineDraft } from './itemForm'

const LIST = '/items'

interface Loaded {
  item: Item
  openings: ItemOpeningsResponse
}

/** Create / edit one item: identity, classification, units, tracking, stock levels and opening stock. */
export function ItemFormPage() {
  const { id } = useParams()
  const itemId = id && /^\d+$/.test(id) ? Number(id) : null
  const navigate = useNavigate()
  const toast = useToast()
  const { scope, fy } = useCompany()
  const { can, loading: accessLoading } = useAccess()
  const canWrite = can(P.masters('items', 'write'))
  const canDelete = can(P.masters('items', 'delete'))
  const { options, loading: optionsLoading, error: optionsError } = useFormOptions()

  const loaded = useQuery(
    async (signal): Promise<Loaded | null> => {
      if (!itemId) return null
      const [item, openings] = await Promise.all([itemsApi.get(itemId, signal), itemsApi.openings(itemId, signal)])
      return { item, openings }
    },
    [itemId, scope?.cmp_id, scope?.fy_id],
    { enabled: !!scope && itemId !== null, keepData: false },
  )

  const [form, setForm] = useState<ItemFormState>(() => emptyItemForm())
  const [initialised, setInitialised] = useState(false)
  const [openingsDirty, setOpeningsDirty] = useState(false)
  const [touched, setTouched] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [serverField, setServerField] = useState<string | null>(null)
  const [recostPrompt, setRecostPrompt] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  // Effective FY for openings: carried-forward year when the close has run into it, else 0 (inception).
  const effectiveFyId = loaded.data?.openings.effective_fy_id ?? 0

  useEffect(() => {
    if (itemId === null) {
      if (!initialised && options) {
        setForm(emptyItemForm(options.default_valuation_method))
        setInitialised(true)
      }
      return
    }
    if (loaded.data && !initialised) {
      setForm(itemToForm(loaded.data.item, loaded.data.openings.rows, loaded.data.openings.effective_fy_id))
      setInitialised(true)
    }
  }, [itemId, loaded.data, options, initialised])

  const errors = useMemo(() => (touched ? validateItemForm(form) : {}), [form, touched])
  const readOnly = !canWrite
  const isStock = form.item_type === 'stock'
  const set = <K extends keyof ItemFormState>(key: K, value: ItemFormState[K]) => setForm((f) => ({ ...f, [key]: value }))
  const setOpenings = (rows: OpeningDraft[]) => {
    setOpeningsDirty(true)
    set('openings', rows)
  }

  const units = options?.units ?? []
  const baseUnit = units.find((u) => String(u.unit_id) === form.unit_id) ?? null
  const itemUnits = useMemo(() => {
    const ids = new Set<string>([form.unit_id, ...form.unitLines.map((l) => l.unit_id)].filter(Boolean))
    return units.filter((u) => ids.has(String(u.unit_id)))
  }, [units, form.unit_id, form.unitLines])

  const doSave = async (recost: boolean) => {
    setTouched(true)
    const found = validateItemForm(form)
    if (Object.keys(found).length > 0) {
      setSaveError('Fix the highlighted fields.')
      return
    }
    setSaving(true)
    setSaveError(null)
    setServerField(null)
    try {
      const body = itemPayload(form)
      if (recost) body.valuation_method_recost = true
      let savedId = itemId
      if (itemId) {
        await itemsApi.update(itemId, body)
      } else {
        const created = await itemsApi.create(body)
        savedId = created.item_id
      }
      if (savedId && isStock && (openingsDirty || itemId === null) && (form.openings.length > 0 || openingsDirty)) {
        const fyForOpenings = itemId ? effectiveFyId : (await itemsApi.openings(savedId)).effective_fy_id
        await itemsApi.saveOpenings(savedId, fyForOpenings, openingsPayload(form.openings))
      }
      invalidateFormOptions()
      toast.success(itemId ? 'Item saved' : 'Item created')
      navigate(LIST)
    } catch (err) {
      if (isApiError(err) && err.details?.requires === 'valuation_method_recost') {
        setRecostPrompt(true)
      } else {
        setSaveError(errorMessage(err))
        setServerField(isApiError(err) ? err.field : null)
      }
    } finally {
      setSaving(false)
    }
  }

  const remove = async () => {
    if (!itemId) return
    setDeleteBusy(true)
    setDeleteError(null)
    try {
      await itemsApi.remove(itemId)
      invalidateFormOptions()
      toast.success('Item deleted')
      navigate(LIST)
    } catch (err) {
      setDeleteError(errorMessage(err))
    } finally {
      setDeleteBusy(false)
    }
  }

  if (!accessLoading && !can(P.masters('items', 'read'))) {
    return (
      <div className="page">
        <PageHeader title="Item" breadcrumbs={[{ label: 'Items', to: LIST }]} />
        <Notice kind="warning">You do not have permission to view items in this company.</Notice>
      </div>
    )
  }

  const err = (key: string): string | undefined => errors[key] ?? (serverField === key ? (saveError ?? undefined) : undefined)
  const stock = loaded.data?.item.stock
  const onHand = stock ? Number(stock.on_hand ?? 0) : null

  const numberField = (key: keyof ItemFormState, label: string, help?: string, step: string | number = 'any'): ReactNode => (
    <FormField label={label} help={help} error={err(key)}>
      <input className="input" type="number" min={0} step={step} value={String(form[key] ?? '')} disabled={readOnly} aria-invalid={err(key) ? true : undefined} onChange={(e) => set(key, e.target.value as ItemFormState[typeof key])} />
    </FormField>
  )

  const selectField = (key: keyof ItemFormState, label: string, opts: { value: string | number; label: string }[], emptyLabel = '— None —', help?: string): ReactNode => (
    <FormField label={label} help={help} error={err(key)}>
      <select className="select" value={String(form[key] ?? '')} disabled={readOnly} aria-invalid={err(key) ? true : undefined} onChange={(e) => set(key, e.target.value as ItemFormState[typeof key])}>
        <option value="">{emptyLabel}</option>
        {opts.map((o) => (
          <option key={String(o.value)} value={String(o.value)}>
            {o.label}
          </option>
        ))}
      </select>
    </FormField>
  )

  const unitOpts = units.map((u) => ({ value: u.unit_id, label: `${u.unit_name}${u.unit_symbol ? ` (${u.unit_symbol})` : ''}` }))
  const warehouseOpts = (options?.warehouses ?? []).map((w) => ({ value: w.warehouse_id, label: w.warehouse_name }))
  const title = itemId ? (loaded.data?.item.item_name ?? 'Item') : 'New item'

  return (
    <div className="page">
      <PageHeader
        title={title}
        breadcrumbs={[{ label: 'Items', to: LIST }]}
        subtitle={
          itemId && loaded.data ? (
            <>
              #{loaded.data.item.item_id}
              {loaded.data.item.item_sku ? ` · ${loaded.data.item.item_sku}` : ''}
              {onHand !== null ? ` · on hand ${formatQty(onHand)}${baseUnit?.unit_symbol ? ` ${baseUnit.unit_symbol}` : ''}` : ''}
            </>
          ) : (
            'Items are shared by every branch of the company.'
          )
        }
        actions={
          <>
            {itemId && canDelete ? (
              <button type="button" className="btn btn-danger" onClick={() => setConfirmDelete(true)} disabled={saving}>
                Delete
              </button>
            ) : null}
            <button type="button" className="btn" onClick={() => navigate(LIST)} disabled={saving}>
              {readOnly ? 'Back' : 'Cancel'}
            </button>
            {!readOnly ? (
              <button type="button" className="btn btn-primary" onClick={() => doSave(false)} disabled={saving || !initialised}>
                {saving ? 'Saving…' : itemId ? 'Save' : 'Create'}
              </button>
            ) : null}
          </>
        }
      />

      {optionsError ? <Notice kind="warning">{optionsError}</Notice> : null}
      {loaded.error ? <Notice kind="error">{errorMessage(loaded.error)}</Notice> : null}
      {saveError && !serverField ? <Notice kind="error">{saveError}</Notice> : null}
      {(itemId && loaded.loading) || (!initialised && optionsLoading) ? <p className="muted">Loading…</p> : null}

      <section className="form-section">
        <h2 className="form-section-title">Identity</h2>
        <div className="form-grid">
          <FormField label="Item name" required error={err('item_name')} className="span-2">
            <input className="input" value={form.item_name} maxLength={255} disabled={readOnly} aria-invalid={err('item_name') ? true : undefined} onChange={(e) => set('item_name', e.target.value)} />
          </FormField>
          <FormField label="Alias" error={err('item_alias')}>
            <input className="input" value={form.item_alias} maxLength={255} disabled={readOnly} onChange={(e) => set('item_alias', e.target.value)} />
          </FormField>
          <FormField label="Print name" help="Defaults to the item name." error={err('print_name')}>
            <input className="input" value={form.print_name} maxLength={255} disabled={readOnly} onChange={(e) => set('print_name', e.target.value)} />
          </FormField>
          <FormField label="Type" required error={err('item_type')}>
            <select className="select" value={form.item_type} disabled={readOnly} onChange={(e) => set('item_type', e.target.value)}>
              {ITEM_TYPES.map((t) => (
                <option key={t} value={t}>
                  {humanize(t)}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="SKU" help="Unique within the company." error={err('item_sku')}>
            <input className="input" value={form.item_sku} maxLength={64} disabled={readOnly} aria-invalid={err('item_sku') ? true : undefined} onChange={(e) => set('item_sku', e.target.value)} />
          </FormField>
          <FormField label="Barcode / EAN / UPC" error={err('item_upc')}>
            <input className="input" value={form.item_upc} maxLength={64} disabled={readOnly} onChange={(e) => set('item_upc', e.target.value)} />
          </FormField>
          <FormField label="HSN / SAC" help="4 to 8 characters." error={err('hsn_sac')}>
            <input className="input" value={form.hsn_sac} maxLength={8} disabled={readOnly} aria-invalid={err('hsn_sac') ? true : undefined} onChange={(e) => set('hsn_sac', e.target.value)} />
          </FormField>
          {numberField('mrp', 'MRP')}
          <div className="field" style={{ justifyContent: 'flex-end' }}>
            <label className="checkbox">
              <input type="checkbox" checked={form.is_active} disabled={readOnly} onChange={(e) => set('is_active', e.target.checked)} />
              Active
            </label>
          </div>
        </div>
      </section>

      <section className="form-section">
        <h2 className="form-section-title">Classification</h2>
        <div className="form-grid">
          {selectField('item_grp_id', 'Item group', (options?.item_groups ?? []).map((g) => ({ value: g.item_grp_id, label: g.grp_name })))}
          {selectField('stock_cat_id', 'Stock category', (options?.stock_categories ?? []).map((c) => ({ value: c.stock_cat_id, label: c.cat_name })))}
          {selectField('brand_id', 'Brand', (options?.brands ?? []).map((b) => ({ value: b.brand_id, label: b.brand_name })))}
        </div>
      </section>

      <section className="form-section">
        <h2 className="form-section-title">Units</h2>
        <p className="form-section-subtitle">Stock is kept in the base unit. Alternate units convert to it: enter how many base units make one of the alternate (Box = 12 Pcs → 12).</p>
        <div className="form-grid">
          <FormField label="Base unit" required error={err('unit_id')}>
            <select className="select" value={form.unit_id} disabled={readOnly} aria-invalid={err('unit_id') ? true : undefined} onChange={(e) => set('unit_id', e.target.value)}>
              <option value="">Select…</option>
              {unitOpts.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </FormField>
          {selectField('purchase_unit_id', 'Purchase unit', unitOpts, 'Base unit')}
          {selectField('sales_unit_id', 'Sales unit', unitOpts, 'Base unit')}
        </div>
        <div className="table-wrap">
          <table className="table lines-table">
            <thead>
              <tr>
                <th>Alternate unit</th>
                <th className="align-right">1 unit =</th>
                <th>Base unit</th>
                <th>Role</th>
                {!readOnly ? <th aria-label="Actions" /> : null}
              </tr>
            </thead>
            <tbody>
              {form.unitLines.length === 0 ? (
                <tr>
                  <td colSpan={5} className="table-state">
                    No alternate units.
                  </td>
                </tr>
              ) : null}
              {form.unitLines.map((l) => (
                <UnitLineRow
                  key={l.key}
                  line={l}
                  error={err(`unitLines.${l.key}`)}
                  baseSymbol={baseUnit?.unit_symbol ?? baseUnit?.unit_name ?? 'base'}
                  units={unitOpts.filter((o) => String(o.value) !== form.unit_id)}
                  readOnly={readOnly}
                  onChange={(patch) => set('unitLines', form.unitLines.map((x) => (x.key === l.key ? { ...x, ...patch } : x)))}
                  onRemove={() => set('unitLines', form.unitLines.filter((x) => x.key !== l.key))}
                />
              ))}
            </tbody>
          </table>
        </div>
        {!readOnly ? (
          <div className="form-actions" style={{ justifyContent: 'flex-start' }}>
            <button type="button" className="btn btn-sm" onClick={() => set('unitLines', [...form.unitLines, newUnitLine()])} disabled={!form.unit_id}>
              Add alternate unit
            </button>
          </div>
        ) : null}
      </section>

      <section className="form-section">
        <h2 className="form-section-title">Valuation and tracking</h2>
        <div className="form-grid">
          <FormField label="Valuation method" help={itemId ? 'Changing it on an item with movements re-costs its history.' : undefined} error={err('valuation_method')}>
            <select className="select" value={form.valuation_method} disabled={readOnly} onChange={(e) => set('valuation_method', e.target.value)}>
              {(options?.valuation_methods ?? ['FIFO', 'LIFO', 'WAC']).map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </FormField>
          {numberField('standard_cost', 'Standard cost')}
          {selectField('negative_stock_policy', 'Negative stock', (options?.negative_stock_policies ?? ['allow', 'warn', 'block']).map((p) => ({ value: p, label: humanize(p) })), 'Company policy')}
          <div className="field" style={{ justifyContent: 'flex-end', gap: '0.5rem' }}>
            <label className="checkbox">
              <input type="checkbox" checked={form.track_batch} disabled={readOnly} onChange={(e) => set('track_batch', e.target.checked)} />
              Track batches
            </label>
            <label className="checkbox">
              <input type="checkbox" checked={form.track_serial} disabled={readOnly} onChange={(e) => set('track_serial', e.target.checked)} />
              Track serial numbers
            </label>
            <label className="checkbox">
              <input type="checkbox" checked={form.track_expiry} disabled={readOnly} onChange={(e) => set('track_expiry', e.target.checked)} />
              Track expiry
            </label>
          </div>
          {numberField('shelf_life_days', 'Shelf life (days)', 'Fills a batch expiry from its manufacturing date.', 1)}
        </div>
      </section>

      {isStock ? (
        <section className="form-section">
          <h2 className="form-section-title">Stock levels</h2>
          <div className="form-grid">
            {numberField('min_stock_qty', 'Minimum')}
            {numberField('max_stock_qty', 'Maximum')}
            {numberField('reorder_point_qty', 'Reorder point')}
            {numberField('reorder_qty', 'Reorder quantity')}
            {numberField('safety_stock_qty', 'Safety stock')}
            {numberField('lead_time_days', 'Lead time (days)', undefined, 1)}
            {selectField('default_warehouse_id', 'Default warehouse', warehouseOpts)}
          </div>
        </section>
      ) : null}

      {isStock ? (
        <section className="form-section">
          <h2 className="form-section-title">Opening stock</h2>
          <p className="form-section-subtitle">
            {effectiveFyId > 0
              ? `Carried-forward opening for ${fy?.label ?? `FY #${effectiveFyId}`}: the year-end close has run into this year, so it opens only on these rows.`
              : 'Inception opening: applies to every financial year the year-end close has not run into.'}
            {' '}One row per warehouse; leave the warehouse empty for a company-level opening.
          </p>
          <div className="table-wrap">
            <table className="table lines-table">
              <thead>
                <tr>
                  <th>Warehouse</th>
                  <th>Unit</th>
                  <th className="align-right">Quantity</th>
                  <th className="align-right">Rate</th>
                  <th className="align-right">Value</th>
                  {!readOnly ? <th aria-label="Actions" /> : null}
                </tr>
              </thead>
              <tbody>
                {form.openings.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="table-state">
                      No opening stock.
                    </td>
                  </tr>
                ) : null}
                {form.openings.map((o) => (
                  <tr key={o.key} style={err(`openings.${o.key}`) ? { background: 'var(--danger-bg)' } : undefined} title={err(`openings.${o.key}`)}>
                    <td>
                      <select className="select" value={o.warehouse_id} disabled={readOnly} aria-label="Warehouse" onChange={(e) => setOpenings(form.openings.map((x) => (x.key === o.key ? { ...x, warehouse_id: e.target.value } : x)))}>
                        <option value="">Company level</option>
                        {warehouseOpts.map((w) => (
                          <option key={w.value} value={w.value}>
                            {w.label}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <select className="select" value={o.unit_id} disabled={readOnly} aria-label="Unit" onChange={(e) => setOpenings(form.openings.map((x) => (x.key === o.key ? { ...x, unit_id: e.target.value } : x)))}>
                        <option value="">Select…</option>
                        {itemUnits.map((u) => (
                          <option key={u.unit_id} value={u.unit_id}>
                            {u.unit_symbol ?? u.unit_name}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="narrow">
                      <input className="input text-right" type="number" step="any" value={o.opening_qty} disabled={readOnly} aria-label="Opening quantity" onChange={(e) => setOpenings(form.openings.map((x) => (x.key === o.key ? { ...x, opening_qty: e.target.value } : x)))} />
                    </td>
                    <td className="narrow">
                      <input className="input text-right" type="number" min={0} step="any" value={o.opening_valuation_rate} disabled={readOnly} aria-label="Opening rate" onChange={(e) => setOpenings(form.openings.map((x) => (x.key === o.key ? { ...x, opening_valuation_rate: e.target.value } : x)))} />
                    </td>
                    <td className="align-right nowrap">{formatQty(openingValue(o.opening_qty, o.opening_valuation_rate), '0')}</td>
                    {!readOnly ? (
                      <td className="action">
                        <button type="button" className="btn btn-ghost btn-sm" style={{ color: 'var(--danger)' }} onClick={() => setOpenings(form.openings.filter((x) => x.key !== o.key))} aria-label="Remove opening row">
                          Remove
                        </button>
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!readOnly ? (
            <div className="form-actions" style={{ justifyContent: 'flex-start' }}>
              <button type="button" className="btn btn-sm" onClick={() => setOpenings([...form.openings, newOpening(form.unit_id)])} disabled={!form.unit_id}>
                Add opening row
              </button>
              {form.openings.length > 0 ? (
                <span className="muted" style={{ fontSize: '0.8125rem' }}>
                  Total value {formatQty(form.openings.reduce((sum, o) => sum + openingValue(o.opening_qty, o.opening_valuation_rate), 0), '0')}
                </span>
              ) : null}
            </div>
          ) : null}
        </section>
      ) : null}

      {!readOnly ? (
        <div className="form-actions">
          <button type="button" className="btn" onClick={() => navigate(LIST)} disabled={saving}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" onClick={() => doSave(false)} disabled={saving || !initialised}>
            {saving ? 'Saving…' : itemId ? 'Save' : 'Create'}
          </button>
        </div>
      ) : null}

      <ConfirmDialog
        open={recostPrompt}
        title="Re-cost this item's history?"
        message="This item already has posted movements. Changing its valuation method re-costs every movement and queues a recalculation. Continue?"
        confirmLabel="Change method and re-cost"
        busy={saving}
        onConfirm={() => {
          setRecostPrompt(false)
          void doSave(true)
        }}
        onCancel={() => setRecostPrompt(false)}
      />

      <ConfirmDialog
        open={confirmDelete}
        title="Delete item?"
        message={
          <>
            <strong>{form.item_name}</strong> will be removed from every list and dropdown. Items used on documents or bills of materials cannot be deleted — deactivate them instead.
          </>
        }
        confirmLabel="Delete"
        danger
        busy={deleteBusy}
        error={deleteError}
        onConfirm={remove}
        onCancel={() => !deleteBusy && setConfirmDelete(false)}
      />
    </div>
  )
}

interface UnitLineRowProps {
  line: UnitLineDraft
  error?: string
  baseSymbol: string
  units: { value: string | number; label: string }[]
  readOnly: boolean
  onChange: (patch: Partial<UnitLineDraft>) => void
  onRemove: () => void
}

function UnitLineRow({ line, error, baseSymbol, units, readOnly, onChange, onRemove }: UnitLineRowProps) {
  return (
    <tr style={error ? { background: 'var(--danger-bg)' } : undefined} title={error}>
      <td>
        <select className="select" value={line.unit_id} disabled={readOnly} aria-label="Alternate unit" aria-invalid={error ? true : undefined} onChange={(e) => onChange({ unit_id: e.target.value })}>
          <option value="">Select…</option>
          {units.map((u) => (
            <option key={String(u.value)} value={String(u.value)}>
              {u.label}
            </option>
          ))}
        </select>
      </td>
      <td className="narrow">
        <input className="input text-right" type="number" min={0} step="any" value={line.conversion_factor} disabled={readOnly} aria-label="Conversion factor" onChange={(e) => onChange({ conversion_factor: e.target.value })} />
      </td>
      <td>{baseSymbol}</td>
      <td>
        <select className="select" value={line.uom_role} disabled={readOnly} aria-label="Unit role" onChange={(e) => onChange({ uom_role: e.target.value })}>
          <option value="">— None —</option>
          {UOM_ROLES.filter((r) => r !== 'base').map((r) => (
            <option key={r} value={r}>
              {humanize(r)}
            </option>
          ))}
        </select>
      </td>
      {!readOnly ? (
        <td className="action">
          <button type="button" className="btn btn-ghost btn-sm" style={{ color: 'var(--danger)' }} onClick={onRemove} aria-label="Remove unit line">
            Remove
          </button>
        </td>
      ) : null}
    </tr>
  )
}
