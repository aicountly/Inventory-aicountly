import { memo } from 'react'
import type { KeyboardEvent } from 'react'
import { AlertTriangle, Hash, Layers, X } from 'lucide-react'
import { Badge } from '../ui/Badge'
import { Tooltip } from '../ui/Tooltip'
import { cx } from '../ui/cx'
import { FIELD_BASE, FIELD_INVALID, FIELD_OK } from '../ui/Input'
import type { LineDraft } from './formModel'

/**
 * The cells shared by both line tables. Small, memoised and free of data fetching, because these
 * are the components that re-render while somebody types into a hundred-row document.
 */

/**
 * Item avatar.
 *
 * The item master carries no image today (`GET /v1/items/search` returns name, SKU, units and
 * tracking flags), so this is the item's initials on a tinted tile rather than a broken image
 * frame or a placeholder photograph of something that is not the product. When images land on
 * the master, swap the letters for the `img` and nothing else on the row changes.
 */
export const ItemThumb = memo(function ItemThumb({ name, tone = 'slate' }: { name: string; tone?: 'slate' | 'primary' | 'sky' }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('') || '—'
  const tones = {
    slate: 'bg-gray-100 text-gray-500',
    primary: 'bg-primary-light text-primary',
    sky: 'bg-sky-50 text-sky-600',
  }
  return (
    <span className={cx('flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-[11px] font-bold', tones[tone])} aria-hidden>
      {initials}
    </span>
  )
})

export interface ItemCellProps {
  line: LineDraft
  tone?: 'slate' | 'primary' | 'sky'
  onChangeItem: () => void
  disabled?: boolean
}

/** A picked item: thumbnail, name, SKU and the tracking it carries. */
export const PickedItemCell = memo(function PickedItemCell({ line, tone = 'slate', onChangeItem, disabled }: ItemCellProps) {
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <ItemThumb name={line.item_name || '?'} tone={tone} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] font-semibold text-gray-900" title={line.item_name}>
          {line.item_name || `Item #${line.item_id}`}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-1 text-[11px] text-gray-500">
          {line.item_sku ? <span className="truncate font-mono">{line.item_sku}</span> : null}
          {line.track_batch ? (
            <Badge tone="info" size="xs">
              <Layers className="mr-0.5 inline h-2.5 w-2.5" aria-hidden />
              Batch
            </Badge>
          ) : null}
          {line.track_serial ? (
            <Badge tone="violet" size="xs">
              <Hash className="mr-0.5 inline h-2.5 w-2.5" aria-hidden />
              Serial
            </Badge>
          ) : null}
        </div>
      </div>
      {!disabled ? (
        <button
          type="button"
          onClick={onChangeItem}
          className="shrink-0 rounded-md p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700 focus:outline-none focus:ring-2 focus:ring-primary/30"
          aria-label={`Change item on ${line.item_name || 'this row'}`}
          title="Change item"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      ) : null}
    </div>
  )
})

export interface CellInputProps {
  value: string
  onChange: (value: string) => void
  ariaLabel: string
  invalid?: boolean
  disabled?: boolean
  placeholder?: string
  align?: 'left' | 'right'
  className?: string
  onKeyDown?: (e: KeyboardEvent<HTMLInputElement>) => void
  id?: string
  describedBy?: string
}

/** Numeric cell input — the same field styling as the rest of the app, sized for a grid row. */
export const NumberCell = memo(function NumberCell({
  value,
  onChange,
  ariaLabel,
  invalid,
  disabled,
  placeholder,
  align = 'right',
  className,
  onKeyDown,
  id,
  describedBy,
}: CellInputProps) {
  return (
    <input
      id={id}
      className={cx(
        FIELD_BASE,
        invalid ? FIELD_INVALID : FIELD_OK,
        'h-8 px-2 text-sm tabular-nums',
        align === 'right' && 'text-right',
        className,
      )}
      inputMode="decimal"
      autoComplete="off"
      value={value}
      placeholder={placeholder}
      disabled={disabled}
      aria-label={ariaLabel}
      aria-invalid={invalid || undefined}
      aria-describedby={describedBy}
      onKeyDown={onKeyDown}
      onChange={(e) => onChange(e.target.value)}
    />
  )
})

/**
 * The message under a control.
 *
 * Never colour alone: a warning triangle rides with the text, so the distinction survives a
 * monochrome screen and a reader who cannot separate the two tints.
 */
export function CellMessage({ message, severity, id }: { message: string; severity: 'error' | 'warning'; id?: string }) {
  return (
    <p id={id} className={cx('mt-1 flex items-start gap-1 text-[11px] leading-tight', severity === 'error' ? 'text-red-600' : 'text-amber-700')}>
      <AlertTriangle className="mt-px h-3 w-3 shrink-0" aria-hidden />
      <span>{message}</span>
    </p>
  )
}

/** A quantity that is short, stated in words as well as in red. */
export function AvailabilityCell({
  state,
  value,
  short,
  title,
}: {
  state: 'ok' | 'short' | 'checking' | 'idle'
  value: string
  short?: string
  title?: string
}) {
  if (state === 'idle') return <span className="text-xs text-gray-400">—</span>
  if (state === 'checking') {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-gray-500">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-gray-400" aria-hidden />
        Checking…
      </span>
    )
  }
  const body = (
    <span className={cx('text-sm font-semibold tabular-nums', state === 'ok' ? 'text-gray-900' : 'text-red-600')}>
      {value}
      {state === 'short' && short ? <span className="ml-1 block text-[11px] font-medium">short by {short}</span> : null}
    </span>
  )
  return title ? <Tooltip label={title}>{body}</Tooltip> : body
}
