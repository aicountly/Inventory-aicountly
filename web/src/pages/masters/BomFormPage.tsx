import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useAccess } from '../../access/AccessContext'
import { useCompany } from '../../company/CompanyContext'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { FormField } from '../../components/FormField'
import { ItemPicker } from '../../components/ItemPicker'
import { Notice } from '../../components/Notice'
import { PageHeader } from '../../components/PageHeader'
import { useFormOptions } from '../../hooks/useFormOptions'
import { useQuery } from '../../hooks/useQuery'
import { P } from '../../services/access'
import { errorMessage, isApiError } from '../../services/api'
import { bomApi, BOM_LINE_KINDS } from '../../services/masters'
import type { BomLineKind } from '../../services/masters'
import { useToast } from '../../ui/ToastContext'
import { humanize } from '../../utils/format'
import { bomPayload, emptyHeader, headerFromBom, isBomValid, linesFromBom, newLine, validateBom } from './bomForm'
import type { BomHeaderDraft, BomLineDraft, BomValidation } from './bomForm'

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

  const [header, setHeader] = useState<BomHeaderDraft>(emptyHeader)
  const [lines, setLines] = useState<BomLineDraft[]>(() => [newLine()])
  const [touched, setTouched] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  useEffect(() => {
    if (existing.data) {
      setHeader(headerFromBom(existing.data))
      setLines(existing.data.lines && existing.data.lines.length > 0 ? linesFromBom(existing.data.lines) : [newLine()])
    }
  }, [existing.data])

  const validation = useMemo<BomValidation>(() => validateBom(header, lines), [header, lines])
  const unitOptions = options?.units ?? []
  const readOnly = !canWrite

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
                {!readOnly ? <th aria-label="Actions" style={{ width: '9rem' }} /> : null}
              </tr>
            </thead>
            <tbody>
              {lines.length === 0 ? (
                <tr>
                  <td colSpan={6} className="table-state">
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
