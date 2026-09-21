import { AlertTriangle, Check, Info, Lock, X } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { Badge } from '../../../ui/Badge'
import { Card } from '../../../ui/Card'
import { formatInt } from '../../../utils/format'
import type { ItemFormOptions } from '../../../services/items'
import type { BulkFieldSpec, ValueCheck } from './bulkEditFields'
import { formatFieldValue, isReadOnlyField } from './bulkEditFields'
import type { BulkEditPlan } from './bulkEditModel'

/**
 * What would happen if Apply were pressed now — before it is.
 *
 * Every line is derived from the same plan the table and the button read, so
 * the rail cannot disagree with the count inside the button. The tone
 * vocabulary is deliberate and narrow:
 *
 *   ✓ something is fine        ⓘ a statement of fact about the write
 *   ⚠ something to know about  ✕ something that blocks the write
 *
 * An item that already holds the value is a ⚠ at most, never a ✕. It is not an
 * error to tick forty items when thirty of them are already right, and a screen
 * that called that a failure would teach the reader to ignore the real ones.
 */

type CheckTone = 'ok' | 'info' | 'warn' | 'error'

const TONE: Record<CheckTone, { icon: LucideIcon; wrap: string }> = {
  ok: { icon: Check, wrap: 'bg-emerald-500 text-white' },
  info: { icon: Info, wrap: 'bg-sky-500 text-white' },
  warn: { icon: AlertTriangle, wrap: 'bg-amber-500 text-white' },
  error: { icon: X, wrap: 'bg-red-500 text-white' },
}

interface CheckLine {
  key: string
  tone: CheckTone
  content: ReactNode
}

export interface BulkEditValidationCardProps {
  plan: BulkEditPlan
  field: BulkFieldSpec
  check: ValueCheck
  nextKey: string | null
  options: ItemFormOptions | null
  canApply: boolean
  selectedCount: number
}

export function BulkEditValidationCard({
  plan,
  field,
  check,
  nextKey,
  options,
  canApply,
  selectedCount,
}: BulkEditValidationCardProps) {
  const { counts } = plan
  const lines: CheckLine[] = []

  lines.push({
    key: 'will-update',
    tone: counts.willUpdate > 0 ? 'ok' : 'warn',
    content: (
      <>
        <strong className="font-semibold tabular-nums">{formatInt(counts.willUpdate)}</strong> item
        {counts.willUpdate === 1 ? '' : 's'} will be updated
      </>
    ),
  })

  const errors = counts.invalid + (check.blocking && !isReadOnlyField(field) ? 1 : 0)
  lines.push({
    key: 'errors',
    tone: errors > 0 ? 'error' : 'ok',
    content:
      errors > 0 ? (
        <>{check.blocking ? check.message : `${formatInt(counts.invalid)} rows cannot take this value`}</>
      ) : (
        <>
          <strong className="font-semibold tabular-nums">0</strong> validation errors
        </>
      ),
  })

  if (isReadOnlyField(field)) {
    lines.push({
      key: 'locked',
      tone: 'error',
      content: <>{field.label} is maintained in Smart Books and cannot be written from here</>,
    })
  } else if (nextKey !== null) {
    lines.push({
      key: 'value',
      tone: 'info',
      content:
        nextKey === '' ? (
          <>
            {field.label} will be <strong className="font-semibold">cleared</strong>
          </>
        ) : (
          <>
            {field.label} will be set to{' '}
            <strong className="font-semibold tabular-nums">{formatFieldValue(field, nextKey, options)}</strong>
          </>
        ),
    })
  }

  if (counts.unchanged > 0) {
    lines.push({
      key: 'unchanged',
      tone: 'warn',
      content: (
        <>
          <strong className="font-semibold tabular-nums">{formatInt(counts.unchanged)}</strong> item
          {counts.unchanged === 1 ? '' : 's'} already {counts.unchanged === 1 ? 'has' : 'have'} this value and will not
          be written again
        </>
      ),
    })
  }

  if (selectedCount === 0) {
    lines.push({ key: 'none', tone: 'warn', content: <>No items are selected yet</> })
  }

  return (
    <Card padding="md" className="min-w-0">
      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
        {/* `whitespace-nowrap`: in a 19rem rail the badge was pushing
            "validation" onto a second line under "Preview &". */}
        <h3 className="whitespace-nowrap text-sm font-semibold text-gray-900">Preview &amp; validation</h3>
        {canApply ? (
          <Badge tone="success" size="xs">
            Ready to apply
          </Badge>
        ) : (
          <Badge tone={errors > 0 || isReadOnlyField(field) ? 'danger' : 'neutral'} size="xs">
            {isReadOnlyField(field) ? (
              <>
                <Lock className="mr-1 h-2.5 w-2.5" aria-hidden />
                Read only
              </>
            ) : (
              'Needs attention'
            )}
          </Badge>
        )}
      </div>

      <ul className="mt-3 space-y-2.5">
        {lines.map((line) => {
          const tone = TONE[line.tone]
          const Icon = tone.icon
          return (
            <li key={line.key} className="flex items-start gap-2 text-[11px] leading-relaxed text-gray-700">
              <span
                className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full ${tone.wrap}`}
                aria-hidden
              >
                <Icon className="h-2.5 w-2.5" strokeWidth={3} />
              </span>
              <span className="min-w-0">{line.content}</span>
            </li>
          )
        })}
      </ul>
    </Card>
  )
}
