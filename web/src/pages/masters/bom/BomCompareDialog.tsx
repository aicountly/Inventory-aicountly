import { useEffect, useMemo, useState } from 'react'
import { ArrowRight, Equal, Minus, PencilLine, Plus } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useCompany } from '../../../company/CompanyContext'
import { useDebounce } from '../../../hooks/useDebounce'
import { useQuery } from '../../../hooks/useQuery'
import { Modal } from '../../../components/Modal'
import { Notice } from '../../../components/Notice'
import { Button } from '../../../ui/Button'
import { ErrorState } from '../../../ui/ErrorState'
import { LoadingState } from '../../../ui/LoadingState'
import { SearchBox } from '../../../ui/SearchBox'
import { cx } from '../../../ui/cx'
import { bomApi } from '../../../services/masters'
import type { Bom } from '../../../services/masters'
import { formatInt, formatQty, humanize } from '../../../utils/format'
import { diffBoms } from './bomCompare'
import type { BomDiffKind } from './bomCompare'
import { bomCode } from './bomPresentation'

/**
 * Two bills of materials, side by side.
 *
 * Inventory stores one version per bill — there is no revision history to walk
 * — so this compares two RECORDS. That is the shape the question actually takes
 * here: somebody duplicates a bill, edits the copy, and wants to know exactly
 * what moved before activating it.
 *
 * Added, removed and changed are marked by an icon and a word as well as a
 * tint, because a reader who cannot distinguish the green row from the red one
 * still has to be able to read the answer.
 */

const KIND_STYLE: Record<BomDiffKind, { row: string; chip: string; label: string; icon: LucideIcon }> = {
  added: { row: 'bg-emerald-50/50', chip: 'bg-emerald-50 text-emerald-800', label: 'Added', icon: Plus },
  removed: { row: 'bg-red-50/60', chip: 'bg-red-50 text-red-700', label: 'Removed', icon: Minus },
  changed: { row: 'bg-amber-50/60', chip: 'bg-amber-50 text-amber-900', label: 'Changed', icon: PencilLine },
  unchanged: { row: '', chip: 'bg-gray-100 text-gray-600', label: 'Unchanged', icon: Equal },
}

function BomPicker({
  label,
  value,
  onPick,
  exclude,
}: {
  label: string
  value: Bom | null
  onPick: (bom: Bom | null) => void
  exclude: number | null
}) {
  const { scope } = useCompany()
  const [term, setTerm] = useState('')
  const debounced = useDebounce(term, 300)
  const search = useQuery(
    (signal) => bomApi.list({ q: debounced || undefined, limit: 10, sort: 'bom_name' }, signal),
    [debounced, scope?.cmp_id],
    { enabled: !!scope && value === null, resetKey: scope?.cmp_id ?? null },
  )

  if (value) {
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-2.5">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">{label}</p>
        <div className="mt-1 flex items-start justify-between gap-2">
          <span className="min-w-0">
            <span className="block truncate text-[12.5px] font-bold text-gray-900">{value.bom_name}</span>
            <span className="block truncate text-[10.5px] text-gray-500">
              {bomCode(value)} · {value.finished_item_name ?? `#${value.finished_item_id}`}
            </span>
          </span>
          <Button variant="ghost" size="xs" onClick={() => onPick(null)}>
            Change
          </Button>
        </div>
      </div>
    )
  }

  const rows = (search.data?.data ?? []).filter((b) => b.bom_id !== exclude)

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-2.5">
      <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-gray-400">{label}</p>
      <SearchBox value={term} onChange={setTerm} placeholder="Search bills…" aria-label={`Search a bill for ${label}`} />
      <ul className="scrollbar-thin mt-1.5 max-h-40 list-none space-y-0.5 overflow-y-auto p-0">
        {search.loading && rows.length === 0 ? (
          <li className="px-2 py-2 text-[11px] text-gray-400">Searching…</li>
        ) : rows.length === 0 ? (
          <li className="px-2 py-2 text-[11px] text-gray-400">No bills match.</li>
        ) : (
          rows.map((row) => (
            <li key={row.bom_id}>
              <button
                type="button"
                onClick={() => onPick(row)}
                className="w-full rounded-md px-2 py-1.5 text-left transition-colors hover:bg-primary-light/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
              >
                <span className="block truncate text-[11.5px] font-semibold text-gray-900">{row.bom_name}</span>
                <span className="block truncate text-[10px] text-gray-400">
                  {bomCode(row)} · {row.finished_item_name ?? `#${row.finished_item_id}`}
                </span>
              </button>
            </li>
          ))
        )}
      </ul>
    </div>
  )
}

export interface BomCompareDialogProps {
  open: boolean
  onClose: () => void
  /** Preselected left-hand bill — the row the menu was opened from. */
  initial: Bom | null
}

export function BomCompareDialog({ open, onClose, initial }: BomCompareDialogProps) {
  const { scope } = useCompany()
  const [left, setLeft] = useState<Bom | null>(initial)
  const [right, setRight] = useState<Bom | null>(null)

  useEffect(() => {
    if (open) {
      setLeft(initial)
      setRight(null)
    }
  }, [open, initial])

  // The list rows carry only a component preview, so both sides are fetched in
  // full before anything is compared — diffing a preview against a preview
  // would report components as "removed" that were merely never sent.
  const details = useQuery<{ left: Bom; right: Bom } | null>(
    async (signal) => {
      if (!left || !right) return null
      const [a, b] = await Promise.all([bomApi.get(left.bom_id, signal), bomApi.get(right.bom_id, signal)])
      return { left: a, right: b }
    },
    [left?.bom_id, right?.bom_id, scope?.cmp_id],
    { enabled: open && !!left && !!right && !!scope, keepData: false, resetKey: scope?.cmp_id ?? null },
  )

  const diff = useMemo(() => (details.data ? diffBoms(details.data.left, details.data.right) : null), [details.data])

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="xl"
      title="Compare bills of materials"
      description="Pick two bills to see exactly which components, quantities and scrap differ."
      footer={<Button onClick={onClose}>Close</Button>}
    >
      <div className="space-y-4">
        <div className="grid items-start gap-3 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
          <BomPicker label="Bill A" value={left} onPick={setLeft} exclude={right?.bom_id ?? null} />
          <span className="hidden self-center text-gray-300 sm:block" aria-hidden>
            <ArrowRight className="h-4 w-4" />
          </span>
          <BomPicker label="Bill B" value={right} onPick={setRight} exclude={left?.bom_id ?? null} />
        </div>

        {!left || !right ? (
          <Notice kind="info">Choose a bill on each side to see the comparison.</Notice>
        ) : details.error ? (
          <ErrorState
            title="Could not load both bills"
            description={details.error.message}
            onRetry={details.reload}
          />
        ) : details.loading || !diff ? (
          <LoadingState variant="skeleton" rows={6} />
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              {(['added', 'removed', 'changed', 'unchanged'] as const).map((kind) => {
                const style = KIND_STYLE[kind]
                const Icon = style.icon
                return (
                  <span
                    key={kind}
                    className={cx('inline-flex items-center gap-1 rounded-full px-2 py-1 text-[10.5px] font-semibold', style.chip)}
                  >
                    <Icon className="h-3 w-3" aria-hidden />
                    {formatInt(diff[kind])} {style.label.toLowerCase()}
                  </span>
                )
              })}
            </div>

            {diff.header.length > 0 ? (
              <div className="rounded-lg border border-amber-200 bg-amber-50/60 p-3">
                <h3 className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-amber-800">
                  Header differences
                </h3>
                <ul className="space-y-1 text-[11.5px] text-amber-900">
                  {diff.header.map((field) => (
                    <li key={field.label}>
                      <strong className="font-semibold">{field.label}:</strong> {field.left} → {field.right}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            <div className="overflow-x-auto rounded-lg border border-gray-200">
              <table className="w-full border-collapse text-[11.5px]">
                <caption className="sr-only">
                  Component differences between {left.bom_name} and {right.bom_name}
                </caption>
                <thead>
                  <tr className="bg-gray-50 text-[9.5px] uppercase tracking-wide text-gray-500">
                    <th scope="col" className="px-2.5 py-2 text-left font-bold">Change</th>
                    <th scope="col" className="px-2.5 py-2 text-left font-bold">Item</th>
                    <th scope="col" className="px-2.5 py-2 text-left font-bold">Kind</th>
                    <th scope="col" className="px-2.5 py-2 text-right font-bold">{left.bom_name}</th>
                    <th scope="col" className="px-2.5 py-2 text-right font-bold">{right.bom_name}</th>
                  </tr>
                </thead>
                <tbody>
                  {diff.rows.map((row) => {
                    const style = KIND_STYLE[row.kind]
                    const Icon = style.icon
                    const cell = (line: typeof row.left) =>
                      line === null ? (
                        <span className="text-gray-300">—</span>
                      ) : (
                        <span className="whitespace-nowrap tabular-nums">
                          {formatQty(line.qty)}
                          {line.unit_symbol ? ` ${line.unit_symbol}` : ''}
                          {Number(line.scrap_percent) > 0 ? ` · ${formatQty(line.scrap_percent)}% scrap` : ''}
                        </span>
                      )
                    return (
                      <tr key={row.key} className={cx('border-t border-gray-100', style.row)}>
                        <td className="px-2.5 py-2">
                          <span className={cx('inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold', style.chip)}>
                            <Icon className="h-3 w-3" aria-hidden />
                            {style.label}
                          </span>
                        </td>
                        <td className="px-2.5 py-2">
                          <span className="block truncate font-semibold text-gray-900">{row.itemName}</span>
                          {row.itemSku ? <span className="block text-[10px] text-gray-400">{row.itemSku}</span> : null}
                        </td>
                        <td className="px-2.5 py-2 text-gray-600">{humanize(row.lineKind)}</td>
                        <td className="px-2.5 py-2 text-right">{cell(row.left)}</td>
                        <td className="px-2.5 py-2 text-right">{cell(row.right)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </Modal>
  )
}

export default BomCompareDialog
