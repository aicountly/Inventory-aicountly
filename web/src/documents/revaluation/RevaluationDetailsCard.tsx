import { useId } from 'react'
import type { ReactNode } from 'react'
import { ClipboardList, Info, Lock } from 'lucide-react'
import { Link } from 'react-router-dom'
import { FormField, FormSectionCard } from '../../ui/shell'
import { Badge, Input, SegmentedControl, Select, Textarea, Tooltip } from '../../ui'
import { METHOD_LABELS } from '../../services/valuationApi'
import type { FormOptionWarehouse } from '../../services/items'
import { NARRATION_LIMIT, REVALUATION_REASON_CODES } from './revaluationModel'
import type { RevaluationDraft, RevaluationIssue, RevaluationMode, ValuationScope } from './revaluationModel'
import { headerIssue } from './revaluationModel'

export interface RevaluationDetailsCardProps {
  draft: RevaluationDraft
  onPatch: (patch: Partial<RevaluationDraft>) => void
  mode: RevaluationMode
  onModeChange: (mode: RevaluationMode) => void
  warehouses: readonly FormOptionWarehouse[]
  warehousesLoading: boolean
  issues: readonly RevaluationIssue[]
  showIssues: boolean
  disabled?: boolean
  scope: ValuationScope
  scopeKnown: boolean
  defaultMethod: string | null
  lockedUptoDate: string | null
  fyRange: { from: string; to: string }
  /** Set while editing a stored document. */
  documentNoLocked?: boolean
  canManageSettings: boolean
}

const OTHER_REASON = '__other__'

/**
 * The header of the document: when it happened, where it applies and why.
 *
 * Simple shows the five fields a revaluation cannot be entered without. Advanced adds the context
 * the posting engine will actually use — the valuation scope and method, the financial year and any
 * period lock. It adds no field the API does not carry: a revaluation has no posting date, no
 * effective date and no approval workflow of its own, so none is drawn.
 */
export function RevaluationDetailsCard({
  draft,
  onPatch,
  mode,
  onModeChange,
  warehouses,
  warehousesLoading,
  issues,
  showIssues,
  disabled,
  scope,
  scopeKnown,
  defaultMethod,
  lockedUptoDate,
  fyRange,
  documentNoLocked,
  canManageSettings,
}: RevaluationDetailsCardProps) {
  const ids = useId()
  const field = (name: string) => `${ids}-${name}`
  const issue = (name: Parameters<typeof headerIssue>[1]) => (showIssues ? headerIssue(issues, name) : null)

  const knownReason = REVALUATION_REASON_CODES.some((r) => r.code === draft.reasonCode)
  const reasonSelectValue = draft.reasonCode === '' ? '' : knownReason ? draft.reasonCode : OTHER_REASON
  const reasonHint = REVALUATION_REASON_CODES.find((r) => r.code === draft.reasonCode)?.hint

  return (
    <FormSectionCard
      icon={ClipboardList}
      title="Revaluation details"
      description="Enter the basic details for this stock revaluation."
      action={
        <SegmentedControl
          value={mode}
          onChange={onModeChange}
          options={[
            { value: 'simple', label: 'Simple' },
            { value: 'advanced', label: 'Advanced', title: 'Show the valuation scope, method and period this document will post under.' },
          ]}
        />
      }
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        <FormField label="Document date" htmlFor={field('date')} required error={issue('documentDate')} hint={fyRange.from && fyRange.to ? `Within ${fyRange.from} – ${fyRange.to}.` : undefined}>
          <Input
            id={field('date')}
            type="date"
            size="md"
            value={draft.documentDate}
            min={fyRange.from || undefined}
            max={fyRange.to || undefined}
            disabled={disabled}
            invalid={Boolean(issue('documentDate'))}
            onChange={(e) => onPatch({ documentDate: e.target.value })}
          />
        </FormField>

        <FormField label="Document no." htmlFor={field('no')} hint={documentNoLocked ? 'Numbered when the draft was created.' : 'Leave empty to number automatically.'}>
          <Input
            id={field('no')}
            size="md"
            value={draft.documentNo}
            placeholder="Auto-generate"
            disabled={disabled}
            maxLength={64}
            onChange={(e) => onPatch({ documentNo: e.target.value })}
          />
        </FormField>

        <FormField label="Default warehouse" htmlFor={field('warehouse')} required error={issue('defaultWarehouseId')} hint="Applied to newly added lines.">
          <Select
            id={field('warehouse')}
            size="md"
            value={draft.defaultWarehouseId ?? ''}
            disabled={disabled || warehousesLoading}
            invalid={Boolean(issue('defaultWarehouseId'))}
            onChange={(e) => onPatch({ defaultWarehouseId: e.target.value === '' ? null : Number(e.target.value) })}
          >
            <option value="">{warehousesLoading ? 'Loading warehouses…' : 'Select warehouse…'}</option>
            {warehouses.map((w) => (
              <option key={w.warehouse_id} value={w.warehouse_id}>
                {w.warehouse_name}
                {w.warehouse_code ? ` (${w.warehouse_code})` : ''}
              </option>
            ))}
          </Select>
        </FormField>

        <FormField
          label="Reason code"
          htmlFor={field('reason')}
          required
          error={issue('reasonCode')}
          hint={reasonHint}
        >
          <Select
            id={field('reason')}
            size="md"
            value={reasonSelectValue}
            disabled={disabled}
            invalid={Boolean(issue('reasonCode'))}
            onChange={(e) => onPatch({ reasonCode: e.target.value === OTHER_REASON ? '' : e.target.value })}
          >
            <option value="">Select reason…</option>
            {REVALUATION_REASON_CODES.map((r) => (
              <option key={r.code} value={r.code}>
                {r.label}
              </option>
            ))}
            <option value={OTHER_REASON}>Something else…</option>
          </Select>
          {reasonSelectValue === OTHER_REASON || (draft.reasonCode !== '' && !knownReason) ? (
            <Input
              aria-label="Reason code"
              className="mt-1.5"
              size="md"
              value={draft.reasonCode}
              placeholder="e.g. NRV_REVIEW"
              maxLength={32}
              disabled={disabled}
              onChange={(e) => onPatch({ reasonCode: e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '_') })}
            />
          ) : null}
        </FormField>

        <FormField label="Movement reason" htmlFor={field('movement')} hint="A line of plain English beside the code.">
          <Input
            id={field('movement')}
            size="md"
            value={draft.movementReason}
            placeholder="e.g. Market price change"
            maxLength={64}
            disabled={disabled}
            onChange={(e) => onPatch({ movementReason: e.target.value })}
          />
        </FormField>
      </div>

      <div className="mt-3">
        <FormField label="Narration" htmlFor={field('narration')}>
          <div className="relative">
            <Textarea
              id={field('narration')}
              rows={2}
              value={draft.narration}
              maxLength={NARRATION_LIMIT}
              placeholder="Enter narration / remarks for this revaluation…"
              disabled={disabled}
              className="pb-6"
              onChange={(e) => onPatch({ narration: e.target.value })}
            />
            <span className="pointer-events-none absolute bottom-2 right-2.5 text-[10px] tabular-nums text-gray-400">
              {draft.narration.length}/{NARRATION_LIMIT}
            </span>
          </div>
        </FormField>
      </div>

      {mode === 'advanced' ? (
        <div className="mt-3 rounded-xl border border-gray-200 bg-gray-50/60 p-3">
          <div className="flex items-center gap-1.5">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">How this document will post</p>
            <Tooltip label="Read from company settings and the selected financial year. These are not editable here — they are the rules the posting engine applies.">
              <Info className="h-3.5 w-3.5 text-gray-400" aria-hidden />
            </Tooltip>
          </div>
          <dl className="mt-2 grid grid-cols-1 gap-x-4 gap-y-2 sm:grid-cols-2 lg:grid-cols-4">
            <Fact
              label="Valuation scope"
              value={scope === 'warehouse' ? 'Per warehouse' : 'Company-wide'}
              note={
                scopeKnown
                  ? scope === 'warehouse'
                    ? 'A line re-prices the item’s layers in its own warehouse.'
                    : 'A line re-prices the item’s layers in every warehouse.'
                  : 'Company settings could not be read; showing the product default.'
              }
              warn={!scopeKnown}
            />
            <Fact label="Default valuation method" value={defaultMethod ? (METHOD_LABELS[defaultMethod as keyof typeof METHOD_LABELS] ?? defaultMethod) : '—'} note="Items with their own method use that instead." />
            <Fact label="Financial year" value={fyRange.from && fyRange.to ? `${fyRange.from} – ${fyRange.to}` : '—'} note="From the financial year selected in the header." />
            <Fact
              label="Period lock"
              value={lockedUptoDate ? `Locked to ${lockedUptoDate}` : 'None in force'}
              note={
                lockedUptoDate ? (
                  canManageSettings ? (
                    <>
                      Release it in <Link className="font-semibold text-primary hover:underline" to="/settings/period-locks">period locks</Link> to post earlier.
                    </>
                  ) : (
                    'Ask an administrator to release it to post earlier.'
                  )
                ) : (
                  'Nothing is blocking an earlier date.'
                )
              }
              icon={lockedUptoDate ? Lock : undefined}
              warn={Boolean(lockedUptoDate)}
            />
          </dl>
          <p className="mt-2.5 border-t border-gray-200 pt-2 text-[10px] leading-relaxed text-gray-500">
            A revaluation carries no posting date, effective date or approval route of its own — it takes effect on the document date, which is why none of
            those fields is drawn here.
          </p>
        </div>
      ) : null}
    </FormSectionCard>
  )
}

function Fact({ label, value, note, warn, icon: Icon }: { label: string; value: string; note?: ReactNode; warn?: boolean; icon?: typeof Lock }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">{label}</dt>
      <dd className="mt-0.5 flex items-center gap-1.5 text-xs font-semibold text-gray-900">
        {Icon ? <Icon className="h-3.5 w-3.5 text-amber-600" aria-hidden /> : null}
        <span className="truncate">{value}</span>
        {warn ? (
          <Badge tone="warning" size="xs">
            Note
          </Badge>
        ) : null}
      </dd>
      {note ? <p className="mt-0.5 text-[10px] leading-relaxed text-gray-500">{note}</p> : null}
    </div>
  )
}

export default RevaluationDetailsCard
