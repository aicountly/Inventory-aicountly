import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Filter, X } from 'lucide-react'
import { Button } from '../../ui/Button'
import { Card } from '../../ui/Card'
import { Select } from '../../ui/Select'
import { Input } from '../../ui/Input'
import { Tooltip } from '../../ui/Tooltip'
import { humanize } from '../../utils/format'
import { RECONCILIATION_STATUSES } from '../../services/reconciliationApi'
import type { BranchOption } from '../../company/manageShapes'

export interface ReconciliationFilterValues {
  status: string
  from: string
  to: string
  allFy: boolean
}

export interface ReconciliationFiltersProps {
  value: ReconciliationFilterValues
  onApply: (next: ReconciliationFilterValues) => void
  onClear: () => void
  /** App-wide branch scope — the only branch the API knows about. */
  branches: readonly BranchOption[]
  boId: number
  onBranch: (boId: number) => void
  busy?: boolean
}

/**
 * The run filter bar.
 *
 * Edits are held locally and sent on **Apply**, so typing a date does not fire
 * a request per keystroke — and a half-typed `2026-0` never reaches the API as
 * a filter. Enter applies too: the whole bar is a form, which is also what
 * makes it work from the keyboard alone.
 *
 * Branch is deliberately not a local filter. `/v1/reconciliation` scopes every
 * read to the company, financial year and branch the app is set to, and a run
 * is STORED against the branch it was computed for; filtering the fetched page
 * client-side would silently show "3 of 50" while the pager still said 50. So
 * this control moves the app-wide branch scope — the same selector the topbar
 * carries — and the tooltip says so before it is touched.
 */
export function ReconciliationFilters({
  value,
  onApply,
  onClear,
  branches,
  boId,
  onBranch,
  busy = false,
}: ReconciliationFiltersProps) {
  const [draft, setDraft] = useState<ReconciliationFilterValues>(value)

  // The URL is the source of truth: a back button, a KPI drill-down or a Clear
  // all change `value` from outside, and the bar has to follow.
  useEffect(() => {
    setDraft(value)
  }, [value.status, value.from, value.to, value.allFy]) // eslint-disable-line react-hooks/exhaustive-deps

  const dirty =
    draft.status !== value.status ||
    draft.from !== value.from ||
    draft.to !== value.to ||
    draft.allFy !== value.allFy
  const filtered = Boolean(value.status || value.from || value.to || value.allFy)

  const submit = (e: FormEvent) => {
    e.preventDefault()
    onApply(draft)
  }

  return (
    <Card padding="none" className="print:hidden">
      <form className="flex flex-wrap items-end gap-2 px-3 py-2.5" onSubmit={submit} role="search" aria-label="Filter reconciliation runs">
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Status</span>
          <Select
            size="md"
            className="min-w-[10rem]"
            value={draft.status}
            onChange={(e) => setDraft((d) => ({ ...d, status: e.target.value }))}
          >
            <option value="">All statuses</option>
            {RECONCILIATION_STATUSES.map((s) => (
              <option key={s} value={s}>
                {humanize(s)}
              </option>
            ))}
          </Select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">As at from</span>
          <Input
            type="date"
            size="md"
            className="w-[9.5rem]"
            value={draft.from}
            max={draft.to || undefined}
            onChange={(e) => setDraft((d) => ({ ...d, from: e.target.value }))}
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">As at to</span>
          <Input
            type="date"
            size="md"
            className="w-[9.5rem]"
            value={draft.to}
            min={draft.from || undefined}
            onChange={(e) => setDraft((d) => ({ ...d, to: e.target.value }))}
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Branch</span>
          <Tooltip label="Branch is the app-wide scope. Changing it here re-scopes every screen, the same as the selector in the header.">
            <Select
              size="md"
              className="min-w-[11rem]"
              value={String(boId)}
              onChange={(e) => onBranch(Number(e.target.value))}
            >
              <option value="0">All branches</option>
              {branches.map((b) => (
                <option key={b.boId} value={b.boId}>
                  {b.name}
                </option>
              ))}
            </Select>
          </Tooltip>
        </label>

        <label className="flex h-9 items-center gap-2 text-sm text-gray-700">
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary/30"
            checked={draft.allFy}
            onChange={(e) => setDraft((d) => ({ ...d, allFy: e.target.checked }))}
          />
          All years
        </label>

        <div className="ml-auto flex items-center gap-2">
          {filtered ? (
            <Button type="button" variant="ghost" size="md" icon={X} onClick={onClear}>
              Clear
            </Button>
          ) : null}
          <Button type="submit" variant="primary" size="md" icon={Filter} disabled={busy || !dirty}>
            Apply
          </Button>
        </div>
      </form>
    </Card>
  )
}

export default ReconciliationFilters
