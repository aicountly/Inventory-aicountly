import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useAccess } from '../../access/AccessContext'
import { useCompany } from '../../company/CompanyContext'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { FormField } from '../../components/FormField'
import { ItemPicker } from '../../components/ItemPicker'
import { ListSheetActions } from '../../components/ListSheetActions'
import { Notice } from '../../components/Notice'
import { PageHeader } from '../../components/PageHeader'
import { useDebounce } from '../../hooks/useDebounce'
import { useFormOptions } from '../../hooks/useFormOptions'
import { useQuery } from '../../hooks/useQuery'
import { useUnsavedChanges } from '../../hooks/useUnsavedChanges'
import { useFormKeyboard } from '../../keyboard/usePageKeyboard'
import { P } from '../../services/access'
import { errorMessage, isApiError } from '../../services/api'
import { itemsApi } from '../../services/items'
import { bomApi, BOM_LINE_KINDS } from '../../services/masters'
import type { BomLineKind } from '../../services/masters'
import { useToast } from '../../ui/ToastContext'
import { formatQty, humanize } from '../../utils/format'
import { COST_UNAVAILABLE, exactCost } from './bom/bomPresentation'
import {
  bomPayload,
  costPreviewLines,
  emptyHeader,
  grossQty,
  headerFromBom,
  isBomValid,
  linesForTemplate,
  linesFromBom,
  newLine,
  validateBom,
} from './bomForm'
import type { BomHeaderDraft, BomLineDraft, BomValidation } from './bomForm'
import { BOM_SHEET_COLUMNS, buildBomSheet } from './bomSheet'
import type { BomSheetRow } from './bomSheet'

const LIST = '/masters/bill-of-materials'
const crumbs = [
  { label: 'Masters', to: '/masters' },
  { label: 'Bills of materials', to: LIST },
]

/** Create / edit one bill of materials: header + component, by-product and scrap lines. */
export function BomFormPage() {
  const { id } = useParams()
  const bomId = id && /^\d+$/.test(id) ? Number(id) : null
  const navigate = useNavigate()
  const toast = useToast()
  const { scope } = useCompany()
  const { can, loading: accessLoading } = useAccess()
  const canWrite = can(P.masters('bill_of_materials', 'write'))
  const canDelete = can(P.masters('bill_of_materials', 'delete'))
  const { options } = useFormOptions()

  const existing = useQuery((signal) => (bomId ? bomApi.get(bomId, signal) : Promise.resolve(null)), [bomId, scope?.cmp_id], { enabled: !!scope && bomId !== null, keepData: false })

  /*
   * `?template=` and `?finished_item_id=` — how the workspace hands a starting
   * point to a blank editor.
   *
   * A template sets the SHAPE (how many empty rows), never the items; the
   * finished item is resolved through the ordinary item lookup rather than
   * trusted from the address bar, so a hand-edited id that names nothing simply
   * leaves the field empty instead of writing a nonsense reference.
   */
  const [searchParams] = useSearchParams()
  const templateKey = bomId === null ? (searchParams.get('template') ?? '') : ''
  const prefillItemId = bomId === null ? Number(searchParams.get('finished_item_id') ?? 0) : 0

  /*
   * One source for what a blank editor opens with, so the draft and the
   * unsaved-changes baseline below cannot disagree: a baseline that differed by
   * one field would warn about unsaved work on a form nobody had touched.
   */
  const initialLines = useMemo(
    () => (templateKey ? linesForTemplate(templateKey) : [newLine()]),
    [templateKey],
  )
  const [header, setHeader] = useState<BomHeaderDraft>(emptyHeader)
  const [lines, setLines] = useState<BomLineDraft[]>(initialLines)
  const linesRef = useRef(lines)
  linesRef.current = lines
  const [touched, setTouched] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [leavingTo, setLeavingTo] = useState<{ to: string; proceed: () => void } | null>(null)

  useEffect(() => {
    if (!existing.data) return
    const loadedHeader = headerFromBom(existing.data)
    const loadedLines =
      existing.data.lines && existing.data.lines.length > 0 ? linesFromBom(existing.data.lines) : [newLine()]
    setHeader(loadedHeader)
    setLines(loadedLines)
    setBaseline(JSON.stringify(bomPayload(loadedHeader, loadedLines)))
  }, [existing.data])

  useEffect(() => {
    if (!(prefillItemId > 0)) return
    let active = true
    itemsApi
      .bulkLookup({ item_ids: [prefillItemId] })
      .then((found) => {
        const item = found[0]
        if (!active || !item) return
        setHeader((h) => {
          if (h.finished) return h
          const next: BomHeaderDraft = {
            ...h,
            finished: { item_id: item.item_id, item_name: item.item_name, item_sku: item.item_sku, unit_id: item.unit_id, units: item.units },
            yield_unit_id: item.unit_id ? String(item.unit_id) : h.yield_unit_id,
          }
          setBaseline((current) => (current === null ? current : JSON.stringify(bomPayload(next, linesRef.current))))
          return next
        })
      })
      .catch(() => {
        // The editor opens empty; the user picks the item themselves.
      })
    return () => {
      active = false
    }
  }, [prefillItemId])

  const validation = useMemo<BomValidation>(() => validateBom(header, lines), [header, lines])
  const unitOptions = options?.units ?? []
  const readOnly = !canWrite

  /*
   * The printable sheet is built from `existing.data` — the bill as the server
   * returned it — and never from the draft above. A sheet assembled from
   * unsaved edits would carry this company's letterhead over quantities the
   * database does not hold; the footer says which one the reader is holding.
   * A bill that has not been saved yet has nothing to print, hence the null.
   */
  const sheet = useMemo(() => (existing.data ? buildBomSheet(existing.data) : null), [existing.data])

  /* ---- live costing ----------------------------------------------------- */
  /*
   * The same valuation the costing drawer reads, against the draft on screen.
   *
   * Debounced, because it moves with every keystroke in a quantity cell, and
   * keyed on the component lines alone — renaming the bill is not a costing
   * question. A rate that cannot be read stays absent all the way to the cell:
   * a zero against a component reads as "this one is free".
   */
  const previewLines = useMemo(() => costPreviewLines(lines), [lines])
  const previewKey = useDebounce(JSON.stringify(previewLines), 400)
  const cost = useQuery(
    (signal) =>
      previewLines.length === 0
        ? Promise.resolve(null)
        : bomApi.costPreview({ yield_qty: Number(header.yield_qty) || 1, lines: JSON.parse(previewKey) }, signal),
    [previewKey, header.yield_qty, scope?.cmp_id],
    { enabled: !!scope && previewLines.length > 0, resetKey: scope?.cmp_id ?? null },
  )
  const costByItem = useMemo(() => {
    const map = new Map<number, { perUnit: number | null; estimated: number | null }>()
    for (const line of cost.data?.lines ?? []) {
      map.set(line.item_id, { perUnit: line.cost_per_unit ?? null, estimated: line.estimated_cost ?? null })
    }
    return map
  }, [cost.data])
  const currency = cost.data?.currency ?? 'INR'

  /* ---- unsaved changes -------------------------------------------------- */
  /*
   * A snapshot taken the moment the draft is seeded — an empty form for a new
   * bill, the record for an existing one — and compared with the draft on every
   * render. Comparing against the SAVED shape rather than counting keystrokes
   * means typing a character and deleting it again leaves the form clean, and a
   * reader is not warned about work they did not do.
   */
  const [baseline, setBaseline] = useState<string | null>(() =>
    bomId === null ? JSON.stringify(bomPayload(emptyHeader(), initialLines)) : null,
  )
  const currentSnapshot = JSON.stringify(bomPayload(header, lines))
  const dirty = !saving && baseline !== null && currentSnapshot !== baseline
  useUnsavedChanges({
    when: dirty,
    onBlocked: (to, proceed) => setLeavingTo({ to, proceed }),
  })

  const canViewCost = can(P.masters('bill_of_materials', 'read'))
  const columnCount = 5 + 1 + (canViewCost ? 2 : 0) + (readOnly ? 0 : 1)

  /**
   * The cost cell for one line.
   *
   * A component the valuation engine cannot price shows an em dash and the
   * reason on hover — NOT a zero. A zero in this column reads as "this part is
   * free", and somebody would quote a job from it. By-products and scrap are
   * outputs, so they have no material cost to show at all.
   */
  const lineCost = (line: BomLineDraft, field: 'perUnit' | 'estimated') => {
    if (line.line_kind !== 'component' || !line.item) return <span className="muted">—</span>
    if (cost.loading && !cost.data) return <span className="muted">…</span>
    const entry = costByItem.get(line.item.item_id)
    const value = entry?.[field] ?? null
    if (value === null) {
      return (
        <span className="muted" title={`${COST_UNAVAILABLE}: this item has no weighted-average or standard cost on record.`}>
          —
        </span>
      )
    }
    return exactCost(value, currency)
  }

  const updateLine = (key: string, patch: Partial<BomLineDraft>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)))
  const removeLine = (key: string) => setLines((ls) => ls.filter((l) => l.key !== key))
  const moveLine = (key: string, dir: -1 | 1) =>
    setLines((ls) => {
      const i = ls.findIndex((l) => l.key === key)
      const j = i + dir
      if (i < 0 || j < 0 || j >= ls.length) return ls
      const next = [...ls]
      ;[next[i], next[j]] = [next[j], next[i]]
      return next
    })

  const save = async () => {
    setTouched(true)
    if (!isBomValid(validation)) return
    setSaving(true)
    setSaveError(null)
    try {
      const payload = bomPayload(header, lines)
      if (bomId) {
        await bomApi.update(bomId, payload)
        toast.success('Bill of materials saved')
      } else {
        await bomApi.create(payload)
        toast.success('Bill of materials created')
      }
      navigate(LIST)
    } catch (err) {
      setSaveError(isApiError(err) && err.details?.line ? `${err.message}` : errorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  useFormKeyboard({
    onSave: readOnly ? undefined : save,
    onDelete: bomId && canDelete ? () => setConfirmDelete(true) : undefined,
    saving,
  })

  const remove = async () => {
    if (!bomId) return
    setDeleteBusy(true)
    setDeleteError(null)
    try {
      await bomApi.remove(bomId)
      toast.success('Bill of materials deleted')
      navigate(LIST)
    } catch (err) {
      setDeleteError(errorMessage(err))
    } finally {
      setDeleteBusy(false)
    }
  }

  if (!accessLoading && !can(P.masters('bill_of_materials', 'read'))) {
    return (
      <>
        <PageHeader title="Bill of materials" breadcrumbs={crumbs} />
        <Notice kind="warning">You do not have permission to view bills of materials in this company.</Notice>
      </>
    )
  }

  const title = bomId ? (existing.data?.bom_name ?? 'Bill of materials') : 'New bill of materials'
  const show = (key: string) => touched && validation.lines[key]

  return (
    <>
      <PageHeader
        title={title}
        breadcrumbs={crumbs}
        subtitle={bomId && existing.data ? `#${existing.data.bom_id} · ${existing.data.line_count} line${existing.data.line_count === 1 ? '' : 's'}` : 'Components consumed and by-products produced per yield of the finished item.'}
        actions={
          <>
            {sheet ? (
              <ListSheetActions<BomSheetRow>
                columns={BOM_SHEET_COLUMNS}
                rows={sheet.rows}
                filenameBase={sheet.filenameBase}
                title={sheet.title}
                description={sheet.description}
                metaLines={sheet.metaLines}
                summaryCards={sheet.summaryCards}
                footerNotes={sheet.footerNotes}
                orientation="portrait"
                disabled={existing.loading}
              />
            ) : null}
            {bomId && canDelete ? (
              <button type="button" className="btn btn-danger" onClick={() => setConfirmDelete(true)} disabled={saving}>
                Delete
              </button>
            ) : null}
            <button type="button" className="btn" onClick={() => navigate(LIST)} disabled={saving}>
              {readOnly ? 'Back' : 'Cancel'}
            </button>
            {!readOnly ? (
              <button type="button" className="btn btn-primary" onClick={save} disabled={saving || (bomId !== null && existing.loading)}>
                {saving ? 'Saving…' : bomId ? 'Save' : 'Create'}
              </button>
            ) : null}
          </>
        }
      />

      {existing.error ? <Notice kind="error">{errorMessage(existing.error)}</Notice> : null}
      {saveError ? <Notice kind="error">{saveError}</Notice> : null}
      {touched && validation.general ? <Notice kind="warning">{validation.general}</Notice> : null}
      {bomId && existing.loading ? <p className="muted">Loading…</p> : null}

      <section className="form-section">
        <h2 className="form-section-title">Finished item</h2>
        <div className="form-grid">
          <FormField label="Name" required error={touched ? validation.header.bom_name : undefined} className="span-2">
            <input className="input" value={header.bom_name} maxLength={255} disabled={readOnly} onChange={(e) => setHeader({ ...header, bom_name: e.target.value })} />
          </FormField>
          <FormField label="Active">
            <label className="checkbox" style={{ minHeight: '2.25rem' }}>
              <input type="checkbox" checked={header.is_active} disabled={readOnly} onChange={(e) => setHeader({ ...header, is_active: e.target.checked })} />
              Available for production
            </label>
          </FormField>
          <FormField label="Finished item" required error={touched ? validation.header.finished : undefined} className="span-2">
            <ItemPicker
              value={header.finished}
              disabled={readOnly}
              onChange={(item) => setHeader({ ...header, finished: item, yield_unit_id: item?.unit_id ? String(item.unit_id) : header.yield_unit_id })}
            />
          </FormField>
          <FormField label="Yield quantity" required error={touched ? validation.header.yield_qty : undefined} help="How much of the finished item one run of these lines produces.">
            <input className="input" type="number" min={0} step="any" value={header.yield_qty} disabled={readOnly} onChange={(e) => setHeader({ ...header, yield_qty: e.target.value })} />
          </FormField>
          <FormField label="Yield unit" help="Defaults to the finished item's base unit.">
            <select className="select" value={header.yield_unit_id} disabled={readOnly} onChange={(e) => setHeader({ ...header, yield_unit_id: e.target.value })}>
              <option value="">Item's base unit</option>
              {unitOptions.map((u) => (
                <option key={u.unit_id} value={u.unit_id}>
                  {u.unit_name}
                  {u.unit_symbol ? ` (${u.unit_symbol})` : ''}
                </option>
              ))}
            </select>
          </FormField>
        </div>
      </section>

      <section className="form-section">
        <h2 className="form-section-title">Lines</h2>
        <p className="form-section-subtitle">Components are consumed, by-products and scrap are produced alongside the finished item. Quantities are per yield.</p>
        <div className="table-wrap">
          <table className="table lines-table">
            <thead>
              <tr>
                <th style={{ width: '9rem' }}>Kind</th>
                <th>Item</th>
                <th className="align-right" style={{ width: '8rem' }}>
                  Quantity
                </th>
                <th style={{ width: '10rem' }}>Unit</th>
                <th className="align-right" style={{ width: '7rem' }}>
                  Scrap %
                </th>
                <th className="align-right" style={{ width: '7rem' }}>
                  Gross qty
                </th>
                {canViewCost ? (
                  <>
                    <th className="align-right" style={{ width: '8rem' }}>
                      Cost / unit
                    </th>
                    <th className="align-right" style={{ width: '8rem' }}>
                      Est. cost
                    </th>
                  </>
                ) : null}
                {!readOnly ? <th aria-label="Actions" style={{ width: '9rem' }} /> : null}
              </tr>
            </thead>
            <tbody>
              {lines.length === 0 ? (
                <tr>
                  <td colSpan={columnCount} className="table-state">
                    No lines yet.
                  </td>
                </tr>
              ) : null}
              {lines.map((l, i) => (
                <tr key={l.key} style={show(l.key) ? { background: 'var(--danger-bg)' } : undefined} title={show(l.key) || undefined}>
                  <td>
                    <select className="select" value={l.line_kind} disabled={readOnly} aria-label={`Line ${i + 1} kind`} onChange={(e) => updateLine(l.key, { line_kind: e.target.value as BomLineKind })}>
                      {BOM_LINE_KINDS.map((k) => (
                        <option key={k} value={k}>
                          {humanize(k)}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <ItemPicker value={l.item} disabled={readOnly} onChange={(item) => updateLine(l.key, { item, unit_id: item?.unit_id ? String(item.unit_id) : '' })} placeholder="Search item…" />
                  </td>
                  <td>
                    <input className="input text-right" type="number" min={0} step="any" value={l.qty} disabled={readOnly} aria-label={`Line ${i + 1} quantity`} onChange={(e) => updateLine(l.key, { qty: e.target.value })} />
                  </td>
                  <td>
                    <select className="select" value={l.unit_id} disabled={readOnly} aria-label={`Line ${i + 1} unit`} onChange={(e) => updateLine(l.key, { unit_id: e.target.value })}>
                      <option value="">Item's base unit</option>
                      {(l.item?.units && l.item.units.length > 0 ? l.item.units.map((u) => ({ unit_id: u.unit_id, label: `${u.unit_name ?? u.unit_symbol ?? `#${u.unit_id}`}${u.is_default ? ' (base)' : ''}` })) : unitOptions.map((u) => ({ unit_id: u.unit_id, label: `${u.unit_name}${u.unit_symbol ? ` (${u.unit_symbol})` : ''}` }))).map((u) => (
                        <option key={u.unit_id} value={u.unit_id}>
                          {u.label}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <input className="input text-right" type="number" min={0} max={100} step="any" value={l.scrap_percent} disabled={readOnly} aria-label={`Line ${i + 1} scrap percent`} onChange={(e) => updateLine(l.key, { scrap_percent: e.target.value })} />
                  </td>
                  {/*
                    Derived, never typed: gross = quantity x (1 + scrap / 100),
                    the same arithmetic the API applies when it explodes the
                    bill into a production document.
                  */}
                  <td className="align-right nowrap">{formatQty(grossQty(l.qty, l.scrap_percent))}</td>
                  {canViewCost ? (
                    <>
                      <td className="align-right nowrap muted">{lineCost(l, 'perUnit')}</td>
                      <td className="align-right nowrap">{lineCost(l, 'estimated')}</td>
                    </>
                  ) : null}
                  {!readOnly ? (
                    <td className="action">
                      <div className="row-actions">
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => moveLine(l.key, -1)} disabled={i === 0} aria-label="Move up">
                          ↑
                        </button>
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => moveLine(l.key, 1)} disabled={i === lines.length - 1} aria-label="Move down">
                          ↓
                        </button>
                        <button type="button" className="btn btn-ghost btn-sm" style={{ color: 'var(--danger)' }} onClick={() => removeLine(l.key)} aria-label="Remove line">
                          Remove
                        </button>
                      </div>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {touched && Object.keys(validation.lines).length > 0 ? (
          <ul style={{ margin: 0, paddingLeft: '1.25rem', color: 'var(--danger)', fontSize: '0.8125rem' }}>
            {Object.values(validation.lines).map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        ) : null}
        {!readOnly ? (
          <div className="form-actions" style={{ justifyContent: 'flex-start' }}>
            <button type="button" className="btn btn-sm" onClick={() => setLines((ls) => [...ls, newLine('component')])}>
              Add component
            </button>
            <button type="button" className="btn btn-sm" onClick={() => setLines((ls) => [...ls, newLine('by_product')])}>
              Add by-product
            </button>
            <button type="button" className="btn btn-sm" onClick={() => setLines((ls) => [...ls, newLine('scrap')])}>
              Add scrap
            </button>
          </div>
        ) : null}
      </section>

      {canViewCost ? (
        <section className="form-section">
          <h2 className="form-section-title">Estimated cost</h2>
          <p className="form-section-subtitle">
            Material only, per yield, valued from Inventory's own cost data — the item's
            weighted-average cost where stock has moved, and its standard cost otherwise. Labour and
            overhead are not included.
          </p>
          {cost.error ? (
            <Notice kind="warning">
              Cost data could not be read just now, so the figures below are not shown. The bill can
              still be saved.
            </Notice>
          ) : null}
          {cost.data && !cost.data.cost_available ? (
            <Notice kind="info">
              {COST_UNAVAILABLE} — none of these components has a cost on record yet.
            </Notice>
          ) : cost.data && !cost.data.cost_complete ? (
            <Notice kind="warning">
              {cost.data.unpriced_components} component
              {cost.data.unpriced_components === 1 ? '' : 's'} could not be priced, so the total is a
              floor rather than the full cost.
            </Notice>
          ) : null}
          <div className="cost-summary-grid">
            {[
              { label: 'Raw material', value: cost.data?.component_cost ?? null },
              { label: 'Scrap cost', value: cost.data?.wastage_cost ?? null },
              { label: 'Total estimated cost', value: cost.data?.cost_available ? cost.data.total_cost : null },
              {
                label: `Cost per ${header.finished?.unit_symbol ?? 'unit'}`,
                value: cost.data?.cost_available ? cost.data.cost_per_unit : null,
              },
            ].map((box) => (
              <div key={box.label} className="cost-summary-box">
                <small>{box.label}</small>
                <strong>{box.value === null ? COST_UNAVAILABLE : exactCost(box.value, currency)}</strong>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <ConfirmDialog
        open={leavingTo !== null}
        title="Leave without saving?"
        message={
          <>
            <p style={{ margin: '0 0 0.5rem' }}>
              This bill of materials has changes that have not been saved.
            </p>
            <p className="muted" style={{ margin: 0, fontSize: '0.8125rem' }}>
              Leaving now discards them.
            </p>
          </>
        }
        confirmLabel="Discard changes"
        danger
        onConfirm={() => {
          const target = leavingTo
          setLeavingTo(null)
          target?.proceed()
        }}
        onCancel={() => setLeavingTo(null)}
      />

      <ConfirmDialog
        open={confirmDelete}
        title="Delete bill of materials?"
        message={
          <>
            <strong>{header.bom_name}</strong> will be removed from every list. Production documents that already used it are unaffected; the API refuses the delete while any still reference it.
          </>
        }
        confirmLabel="Delete"
        danger
        busy={deleteBusy}
        error={deleteError}
        onConfirm={remove}
        onCancel={() => !deleteBusy && setConfirmDelete(false)}
      />
    </>
  )
}
