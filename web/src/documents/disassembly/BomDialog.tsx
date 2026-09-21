import { useEffect, useMemo, useState } from 'react'
import { Workflow } from 'lucide-react'
import { Modal } from '../../components/Modal'
import { Notice } from '../../components/Notice'
import { useQuery } from '../../hooks/useQuery'
import { errorMessage } from '../../services/api'
import { lookupApi } from '../../services/lookupApi'
import type { BomListRow } from '../../services/lookupApi'
import { Button } from '../../ui/Button'
import { Input } from '../../ui/Input'
import { LoadingState } from '../../ui/LoadingState'
import { Select } from '../../ui/Select'
import { cx } from '../../ui/cx'
import { formatQty, toNumber } from '../../utils/format'
import { planFromBom, skippedNotice } from './bomPlan'
import type { BomDisassemblyPlan } from './bomPlan'

export interface BomDialogProps {
  open: boolean
  onClose: () => void
  /** Restrict the list to the picked finished product; null offers every active BOM. */
  finishedItemId: number | null
  finishedItemName: string | null
  /** Quantity currently on the finished line, used as the default teardown quantity. */
  defaultQty: number
  onApply: (plan: BomDisassemblyPlan, options: { setFinished: boolean }) => Promise<void> | void
  busy?: boolean
}

/**
 * Pick a bill of materials and scale it into recovered components.
 *
 * The BOM is fetched live (`GET /v1/bill-of-materials`, then `/{id}` for its lines) — nothing
 * about a BOM is cached or assumed here, so a BOM revised in Masters while this document was
 * open is the one that loads. The arithmetic is previewed in the browser for responsiveness and
 * re-validated by the server on posting, exactly as the production screen does it.
 */
export function BomDialog({ open, onClose, finishedItemId, finishedItemName, defaultQty, onApply, busy }: BomDialogProps) {
  const [query, setQuery] = useState('')
  const [bomId, setBomId] = useState<number | null>(null)
  const [qty, setQty] = useState('')
  const [setFinished, setSetFinished] = useState(false)
  const [applying, setApplying] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const boms = useQuery((signal) => lookupApi.boms(query, signal), [query, open], { enabled: open })
  const bom = useQuery((signal) => (bomId ? lookupApi.bom(bomId, signal) : Promise.resolve(null)), [bomId], { enabled: open && bomId !== null })

  // Offer the BOMs of the item on the form first; everything else stays reachable through search.
  const rows = useMemo<BomListRow[]>(() => {
    const all = boms.data?.data ?? []
    if (finishedItemId === null) return all
    const mine = all.filter((b) => b.finished_item_id === finishedItemId)
    return mine.length > 0 && !query.trim() ? mine : all
  }, [boms.data, finishedItemId, query])

  useEffect(() => {
    if (!open) return
    setError(null)
    setQty(defaultQty > 0 ? String(defaultQty) : '')
    setSetFinished(finishedItemId === null)
  }, [open, defaultQty, finishedItemId])

  // Pre-select the only sensible BOM rather than making the user choose from a list of one.
  useEffect(() => {
    if (!open || bomId !== null) return
    const mine = rows.filter((b) => finishedItemId === null || b.finished_item_id === finishedItemId)
    if (mine.length === 1) setBomId(mine[0].bom_id)
  }, [open, rows, bomId, finishedItemId])

  useEffect(() => {
    if (bom.data && !qty) setQty(String(bom.data.yield_qty || 1))
  }, [bom.data, qty])

  const parentQty = toNumber(qty) ?? 0
  const plan = useMemo(() => (bom.data ? planFromBom(bom.data, parentQty) : null), [bom.data, parentQty])
  const notice = plan ? skippedNotice(plan) : null
  const mismatch = plan !== null && finishedItemId !== null && plan.finished_item_id !== finishedItemId

  const apply = async () => {
    if (!plan) return
    if (parentQty <= 0) {
      setError('Enter the quantity you are disassembling.')
      return
    }
    if (plan.components.length === 0) {
      setError('This bill of materials has no component lines to recover.')
      return
    }
    setApplying(true)
    setError(null)
    try {
      await onApply(plan, { setFinished: setFinished || finishedItemId === null })
      onClose()
    } catch (err) {
      setError(errorMessage(err, 'Could not load the components.'))
    } finally {
      setApplying(false)
    }
  }

  return (
    <Modal
      open={open}
      title="Load components from a bill of materials"
      description={finishedItemName ? `Recovering the components of ${finishedItemName}.` : 'Pick the bill of materials this teardown follows.'}
      onClose={onClose}
      size="lg"
      busy={applying || busy}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={applying}>
            Cancel
          </Button>
          <Button onClick={() => void apply()} loading={applying} disabled={!plan || plan.components.length === 0}>
            Load {plan ? `${plan.components.length} component${plan.components.length === 1 ? '' : 's'}` : 'components'}
          </Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Search</span>
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="BOM or finished item…" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Bill of materials</span>
          <Select value={bomId ?? ''} onChange={(e) => setBomId(e.target.value === '' ? null : Number(e.target.value))}>
            <option value="">{boms.loading ? 'Loading…' : rows.length === 0 ? 'No active bills of materials' : 'Select…'}</option>
            {rows.map((b) => (
              <option key={b.bom_id} value={b.bom_id}>
                {b.bom_name} → {b.finished_item_name ?? `#${b.finished_item_id}`} (yield {formatQty(b.yield_qty)} {b.yield_unit_symbol ?? ''})
              </option>
            ))}
          </Select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Quantity to disassemble</span>
          <Input value={qty} inputMode="decimal" onChange={(e) => setQty(e.target.value)} />
          {plan ? (
            <span className="text-[11px] text-gray-500">
              BOM yield {formatQty(plan.yield_qty)} {plan.yield_unit_symbol ?? ''} · scale ×{formatQty(plan.scale)}
            </span>
          ) : null}
        </label>
        <label className="flex items-end gap-2 pb-1">
          <input
            type="checkbox"
            className="h-4 w-4"
            checked={setFinished || finishedItemId === null}
            disabled={finishedItemId === null}
            onChange={(e) => setSetFinished(e.target.checked)}
          />
          <span className="text-[12px] text-gray-600">Also set the finished product and quantity from this BOM</span>
        </label>
      </div>

      {bom.error ? <Notice kind="error">{errorMessage(bom.error)}</Notice> : null}
      {mismatch ? (
        <Notice kind="warning">
          This bill of materials builds {plan?.finished_item_name ?? `item #${plan?.finished_item_id}`}, which is not the finished product on the
          document. Loading it will still add its components.
        </Notice>
      ) : null}
      {notice ? <Notice kind="info">{notice}</Notice> : null}
      {error ? <Notice kind="error">{error}</Notice> : null}

      {bom.loading && !bom.data ? <LoadingState label="Loading the bill of materials…" /> : null}

      {plan ? (
        <div className="mt-3 overflow-hidden rounded-lg border border-gray-200">
          <table className="w-full text-[12px]">
            <caption className="sr-only">Components recovered from {plan.bom_name}</caption>
            <thead>
              <tr className="bg-gray-50 text-left text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                <th className="px-3 py-1.5">Component</th>
                <th className="px-3 py-1.5 text-right">Per yield</th>
                <th className="px-3 py-1.5 text-right">Recovered</th>
                <th className="px-3 py-1.5">Unit</th>
              </tr>
            </thead>
            <tbody>
              {plan.components.map((c) => (
                <tr key={`${c.item_id}-${c.bom_line_id ?? 0}`} className="border-t border-gray-100">
                  <td className="px-3 py-1.5">
                    <span className="font-medium text-gray-900">{c.item_name ?? `Item #${c.item_id}`}</span>
                    {c.item_sku ? <span className="ml-1.5 font-mono text-[11px] text-gray-500">{c.item_sku}</span> : null}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-gray-500">{formatQty(c.bom_qty)}</td>
                  <td className={cx('px-3 py-1.5 text-right font-semibold tabular-nums', 'text-gray-900')}>{formatQty(c.qty)}</td>
                  <td className="px-3 py-1.5 text-gray-500">{c.unit_symbol ?? '—'}</td>
                </tr>
              ))}
              {plan.components.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-3 py-4 text-center text-gray-500">
                    <Workflow className="mx-auto mb-1 h-4 w-4 text-gray-400" aria-hidden />
                    This bill of materials has no component lines a disassembly can recover.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      ) : null}
    </Modal>
  )
}
