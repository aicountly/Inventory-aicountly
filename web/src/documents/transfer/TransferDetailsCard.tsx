import { useId } from 'react'
import { ArrowLeftRight, Calendar, Hash, Tag } from 'lucide-react'
import { Card } from '../../ui/Card'
import { IconTile } from '../../ui/IconTile'
import { Input } from '../../ui/Input'
import { Select } from '../../ui/Select'
import { Textarea } from '../../ui/Textarea'
import { Tooltip } from '../../ui/Tooltip'
import { cx } from '../../ui/cx'
import type { FormOptionWarehouse } from '../../services/items'
import type { HeaderDraft } from '../formModel'
import { ReferenceNoField } from './ReferenceNoField'
import { WarehousePicker } from './WarehousePicker'
import { NARRATION_MAX, REASON_REQUIRED_TO_POST } from './transferModel'
import type { TransferIssue, TransferRefs } from './transferModel'
import { OTHER_REASON_CODE, OTHER_REFERENCE_TYPE, QUICK_TAGS, TRANSFER_REASONS, reasonForCode } from './transferReasons'

export type TransferMode = 'single' | 'bulk'

export interface TransferDetailsCardProps {
  header: HeaderDraft
  refs: TransferRefs
  warehouses: FormOptionWarehouse[]
  warehousesLoading: boolean
  /** Live document-type catalogue for the Reference Type list. */
  referenceTypes: readonly { code: string; label: string }[]
  mode: TransferMode
  onModeChange: (mode: TransferMode) => void
  issues: readonly TransferIssue[]
  disabled: boolean
  onPatchHeader: (patch: Partial<HeaderDraft>) => void
  onPatchRefs: (patch: Partial<TransferRefs>) => void
  onSwap: () => void
  branchFor?: (warehouse: FormOptionWarehouse) => string | null
}

const LABEL = 'block text-[11px] font-semibold uppercase tracking-wide text-gray-500'

function fieldError(issues: readonly TransferIssue[], field: TransferIssue['field']): string | null {
  const hit = issues.find((i) => i.field === field && i.level === 'error')
  return hit ? hit.message : null
}

/** The header of the transfer: when, where from, where to and why. */
export function TransferDetailsCard({
  header,
  refs,
  warehouses,
  warehousesLoading,
  referenceTypes,
  mode,
  onModeChange,
  issues,
  disabled,
  onPatchHeader,
  onPatchRefs,
  onSwap,
  branchFor,
}: TransferDetailsCardProps) {
  const uid = useId()
  const fid = (name: string) => `${uid}-${name}`
  const dateError = fieldError(issues, 'document_date')
  const fromError = fieldError(issues, 'from_warehouse_id')
  const toError = fieldError(issues, 'to_warehouse_id')
  const reasonError = fieldError(issues, 'reason')
  const isOther = header.reason_code.trim().toUpperCase() === OTHER_REASON_CODE
  const canSwap = Boolean(header.from_warehouse_id || header.to_warehouse_id)

  return (
    <Card padding="md">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3 border-b border-gray-100 pb-3">
        <div className="flex min-w-0 items-start gap-3">
          <IconTile icon={ArrowLeftRight} tone="primary" size="md" />
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-gray-900">Transfer Details</h2>
            <p className="mt-0.5 text-xs text-gray-500">Capture the movement and choose its source and destination.</p>
          </div>
        </div>

        <div className="inline-flex items-center rounded-lg border border-gray-200 bg-gray-50 p-0.5" role="group" aria-label="Transfer mode">
          <button
            type="button"
            aria-pressed={mode === 'single'}
            onClick={() => onModeChange('single')}
            className={cx(
              'h-8 rounded-md px-4 text-xs font-semibold transition-colors',
              mode === 'single' ? 'bg-primary text-white shadow-sm' : 'text-gray-600 hover:text-gray-900',
            )}
          >
            Single Transfer
          </button>
          {/*
            Bulk stays visible and disabled rather than hidden. Inventory has no
            bulk-transfer endpoint — a document carries one source and one
            destination header — so a Bulk tab that did anything would be doing
            it only in the browser.
          */}
          <Tooltip label="A bulk transfer workflow is not configured on this server. Each document moves stock between one source and one destination; use a row override to send part of a line elsewhere.">
            <button
              type="button"
              disabled
              aria-disabled="true"
              className="h-8 cursor-not-allowed rounded-md px-4 text-xs font-semibold text-gray-400"
            >
              Bulk Transfer
            </button>
          </Tooltip>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.1fr)_2.75rem_minmax(0,1.1fr)] xl:items-start">
        <div>
          <label className={LABEL} htmlFor={fid('date')}>
            Document Date <span className="text-red-500">*</span>
          </label>
          <Input
            id={fid('date')}
            type="date"
            size="md"
            className="mt-1.5"
            leadingIcon={Calendar}
            value={header.document_date}
            disabled={disabled}
            invalid={Boolean(dateError)}
            aria-describedby={dateError ? fid('date-err') : undefined}
            onChange={(e) => onPatchHeader({ document_date: e.target.value })}
          />
          {dateError ? (
            <p id={fid('date-err')} className="mt-1 text-[11px] text-red-600">
              {dateError}
            </p>
          ) : null}
        </div>

        <div>
          <label className={LABEL} htmlFor={fid('no')}>
            Document No.
          </label>
          <Input
            id={fid('no')}
            size="md"
            className="mt-1.5"
            leadingIcon={Hash}
            value={header.document_no}
            disabled={disabled}
            maxLength={64}
            placeholder="Auto"
            aria-describedby={fid('no-help')}
            onChange={(e) => onPatchHeader({ document_no: e.target.value })}
          />
          <p id={fid('no-help')} className="mt-1 text-[11px] text-gray-500">
            Leave empty to number automatically.
          </p>
        </div>

        <div>
          <label className={LABEL} htmlFor={fid('from')}>
            From Warehouse <span className="text-red-500">*</span>
          </label>
          <div className="mt-1.5">
            <WarehousePicker
              id={fid('from')}
              value={header.from_warehouse_id}
              onChange={(id) => onPatchHeader({ from_warehouse_id: id })}
              warehouses={warehouses}
              blockedId={header.to_warehouse_id}
              blockedReason="Already the destination of this transfer"
              disabled={disabled}
              loading={warehousesLoading && warehouses.length === 0}
              invalid={Boolean(fromError)}
              describedBy={fromError ? fid('from-err') : undefined}
              contextFor={branchFor}
            />
          </div>
          {fromError ? (
            <p id={fid('from-err')} className="mt-1 text-[11px] text-red-600">
              {fromError}
            </p>
          ) : null}
        </div>

        <div className="flex items-center justify-center md:mt-[1.6rem]">
          <Tooltip label="Swap source and destination">
            <button
              type="button"
              onClick={onSwap}
              disabled={disabled || !canSwap}
              aria-label="Swap source and destination warehouses"
              className="aic flex h-9 w-9 items-center justify-center rounded-lg border border-primary/20 bg-primary-light text-primary transition-transform duration-200 hover:bg-primary-light hover:rotate-180 focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none motion-reduce:hover:rotate-0"
            >
              <ArrowLeftRight className="h-4 w-4" aria-hidden />
            </button>
          </Tooltip>
        </div>

        <div>
          <label className={LABEL} htmlFor={fid('to')}>
            To Warehouse <span className="text-red-500">*</span>
          </label>
          <div className="mt-1.5">
            <WarehousePicker
              id={fid('to')}
              value={header.to_warehouse_id}
              onChange={(id) => onPatchHeader({ to_warehouse_id: id })}
              warehouses={warehouses}
              blockedId={header.from_warehouse_id}
              blockedReason="Already the source of this transfer"
              disabled={disabled}
              loading={warehousesLoading && warehouses.length === 0}
              invalid={Boolean(toError)}
              describedBy={toError ? fid('to-err') : undefined}
              contextFor={branchFor}
            />
          </div>
          {toError ? (
            <p id={fid('to-err')} className="mt-1 text-[11px] text-red-600">
              {toError}
            </p>
          ) : null}
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <div>
          <label className={LABEL} htmlFor={fid('ref-type')}>
            Reference Type
          </label>
          <Select
            id={fid('ref-type')}
            size="md"
            className="mt-1.5"
            value={refs.referenceType}
            disabled={disabled}
            onChange={(e) => onPatchRefs({ referenceType: e.target.value })}
          >
            <option value="">Select reference…</option>
            {referenceTypes.map((t) => (
              <option key={t.code} value={t.code}>
                {t.label}
              </option>
            ))}
            <option value={OTHER_REFERENCE_TYPE}>Other</option>
          </Select>
        </div>

        <div>
          <label className={LABEL} htmlFor={fid('ref-no')}>
            Reference No.
          </label>
          <div className="mt-1.5">
            <ReferenceNoField
              id={fid('ref-no')}
              value={refs.referenceNo}
              onChange={(value) => onPatchRefs({ referenceNo: value })}
              documentType={
                refs.referenceType && refs.referenceType !== OTHER_REFERENCE_TYPE ? refs.referenceType : null
              }
              disabled={disabled}
            />
          </div>
        </div>

        <div>
          <label className={LABEL} htmlFor={fid('reason')}>
            Transfer Reason {REASON_REQUIRED_TO_POST ? <span className="text-red-500">*</span> : null}
          </label>
          <Select
            id={fid('reason')}
            size="md"
            className="mt-1.5"
            value={header.reason_code}
            disabled={disabled}
            invalid={Boolean(reasonError)}
            aria-describedby={reasonError ? fid('reason-err') : fid('reason-help')}
            onChange={(e) => {
              const code = e.target.value
              const reason = reasonForCode(code)
              onPatchHeader({
                reason_code: code,
                // The label travels with the code so every register and print
                // sheet reads "Branch Transfer", not "BRANCH_TRANSFER".
                movement_reason: !code || code === OTHER_REASON_CODE ? '' : (reason?.label ?? ''),
              })
            }}
          >
            <option value="">Select a reason…</option>
            {TRANSFER_REASONS.map((r) => (
              <option key={r.code} value={r.code}>
                {r.label}
              </option>
            ))}
          </Select>
          {reasonError ? (
            <p id={fid('reason-err')} className="mt-1 text-[11px] text-red-600">
              {reasonError}
            </p>
          ) : (
            <p id={fid('reason-help')} className="mt-1 truncate text-[11px] text-gray-500">
              {reasonForCode(header.reason_code)?.hint ?? 'Why this stock is moving.'}
            </p>
          )}
        </div>

        <div>
          <label className={LABEL} htmlFor={fid('arrival')}>
            Expected Arrival Date
          </label>
          <Input
            id={fid('arrival')}
            type="date"
            size="md"
            className="mt-1.5"
            leadingIcon={Calendar}
            value={refs.expectedArrivalDate}
            min={header.document_date || undefined}
            disabled={disabled}
            aria-describedby={fid('arrival-help')}
            onChange={(e) => onPatchRefs({ expectedArrivalDate: e.target.value })}
          />
          <p id={fid('arrival-help')} className="mt-1 text-[11px] text-gray-500">
            Recorded on the document only.
          </p>
        </div>
      </div>

      {isOther ? (
        <div className="mt-4">
          <label className={LABEL} htmlFor={fid('reason-note')}>
            Describe the reason <span className="text-red-500">*</span>
          </label>
          <Input
            id={fid('reason-note')}
            size="md"
            className="mt-1.5"
            value={header.movement_reason}
            disabled={disabled}
            maxLength={64}
            placeholder="e.g. Rebalancing after the annual count"
            invalid={Boolean(reasonError)}
            onChange={(e) => onPatchHeader({ movement_reason: e.target.value })}
          />
        </div>
      ) : null}

      <div className="mt-4">
        <div className="flex items-baseline justify-between gap-3">
          <label className={LABEL} htmlFor={fid('narration')}>
            Narration / Remarks
          </label>
          <span
            className={cx('text-[11px] tabular-nums', header.narration.length > NARRATION_MAX ? 'font-semibold text-red-600' : 'text-gray-400')}
          >
            {header.narration.length}/{NARRATION_MAX}
          </span>
        </div>
        <Textarea
          id={fid('narration')}
          className="mt-1.5 min-h-[4.5rem]"
          value={header.narration}
          disabled={disabled}
          maxLength={NARRATION_MAX}
          placeholder="Add any additional notes, reason for transfer, authorisation details etc…"
          onChange={(e) => onPatchHeader({ narration: e.target.value })}
        />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-gray-600">
          <Tag className="h-3 w-3 text-gray-400" aria-hidden />
          Quick tags
        </span>
        {QUICK_TAGS.map((tag) => {
          const activeTag = header.reason_code.trim().toUpperCase() === tag.reasonCode
          return (
            <button
              key={tag.label}
              type="button"
              aria-pressed={activeTag}
              disabled={disabled}
              onClick={() => {
                const reason = reasonForCode(tag.reasonCode)
                onPatchHeader({
                  reason_code: tag.reasonCode,
                  movement_reason: tag.reasonCode === OTHER_REASON_CODE ? header.movement_reason : (reason?.label ?? tag.label),
                })
              }}
              className={cx(
                'aic h-7 rounded-full border px-3 text-[11px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60',
                activeTag
                  ? 'border-primary/40 bg-primary-light text-primary'
                  : 'border-gray-200 bg-gray-50 text-gray-600 hover:border-primary/30 hover:bg-primary-light hover:text-primary',
              )}
            >
              {tag.label}
            </button>
          )
        })}
      </div>
    </Card>
  )
}
