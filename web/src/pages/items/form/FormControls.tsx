import { useId } from 'react'
import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { Card } from '../../../ui/Card'
import { Switch } from '../../../ui/Switch'
import { AIC, cx } from '../../../ui/cx'

/**
 * The item form's own field furniture.
 *
 * It is not a second design system: the type scale, the colours and the radii
 * are the ones `ui/shell/FormSectionCard` already uses, and the controls
 * underneath are the shared `Input` / `Select`. What is new here is the two
 * things those primitives have no slot for — an action button in the label row
 * (Suggest, Generate, Scan) and the "just suggested" highlight — plus the
 * tracking tile, which is a switch inside a card rather than beside a label.
 */

export interface FieldProps {
  id: string
  label: ReactNode
  required?: boolean
  hint?: ReactNode
  error?: ReactNode
  /** Rendered at the right of the label row. */
  action?: ReactNode
  /** Draws the "applied a suggestion" wash for a moment. */
  highlighted?: boolean
  className?: string
  children: ReactNode
}

export function Field({ id, label, required = false, hint, error, action, highlighted = false, className, children }: FieldProps) {
  const messageId = `${id}-msg`
  return (
    <div
      className={cx(
        AIC,
        'flex min-w-0 flex-col gap-1 rounded-lg transition-colors duration-200',
        highlighted && '-m-1.5 bg-primary-light/60 p-1.5 ring-1 ring-primary/30',
        className,
      )}
    >
      <div className="flex min-h-[1.25rem] items-center justify-between gap-2">
        <label htmlFor={id} className="truncate text-[11px] font-semibold uppercase tracking-wide text-gray-500">
          {label}
          {required ? (
            <span className="ml-0.5 text-red-500" aria-hidden>
              *
            </span>
          ) : null}
        </label>
        {action ? <span className="shrink-0">{action}</span> : null}
      </div>
      {children}
      {error ? (
        <p id={messageId} className="text-[11px] leading-relaxed text-red-600">
          {error}
        </p>
      ) : hint ? (
        <p id={messageId} className="text-[11px] leading-relaxed text-gray-500">
          {hint}
        </p>
      ) : null}
    </div>
  )
}

/** `aria-describedby` for a Field's control — the same id Field gives its message line. */
export function fieldDescribedBy(id: string, hasMessage: boolean): string | undefined {
  return hasMessage ? `${id}-msg` : undefined
}

export interface InlineActionProps {
  onClick: () => void
  icon?: LucideIcon
  disabled?: boolean
  title?: string
  children: ReactNode
}

/** The small tinted button that sits in a label row. */
export function InlineAction({ onClick, icon: Icon, disabled = false, title, children }: InlineActionProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={cx(
        AIC,
        'inline-flex items-center gap-1 rounded-md border border-primary/20 bg-primary-light px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-primary transition-colors',
        'hover:bg-primary/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 disabled:cursor-not-allowed disabled:opacity-50',
      )}
    >
      {Icon ? <Icon className="h-3 w-3" aria-hidden /> : null}
      {children}
    </button>
  )
}

export interface IconButtonProps {
  onClick: () => void
  icon: LucideIcon
  label: string
  disabled?: boolean
  tone?: 'default' | 'danger'
}

/** A square control button that lines up with a 2rem-tall input. */
export function FieldIconButton({ onClick, icon: Icon, label, disabled = false, tone = 'default' }: IconButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className={cx(
        AIC,
        'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border bg-white transition-colors focus:outline-none focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-50',
        tone === 'danger'
          ? 'border-red-200 text-red-600 hover:bg-red-50 focus-visible:ring-red-300/40'
          : 'border-gray-200 text-primary hover:border-primary/40 hover:bg-primary-light focus-visible:ring-primary/30',
      )}
    >
      <Icon className="h-4 w-4" aria-hidden />
    </button>
  )
}

export interface SectionCardProps {
  /** Anchor the stepper scrolls to. */
  id: string
  icon: LucideIcon
  title: string
  description: ReactNode
  action?: ReactNode
  children: ReactNode
  className?: string
}

export function SectionCard({ id, icon: Icon, title, description, action, children, className }: SectionCardProps) {
  return (
    <Card
      as="section"
      id={id}
      padding="none"
      // The shell scrolls `main`, so an anchored jump has to clear the sticky
      // page header on its own; `scroll-mt` is what does it.
      className={cx('scroll-mt-24 overflow-hidden', className)}
      aria-labelledby={`${id}-title`}
    >
      <div className="flex items-start gap-3 border-b border-gray-100 p-4">
        <span className="mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary-light text-primary" aria-hidden>
          <Icon className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 id={`${id}-title`} className="text-[0.9375rem] font-semibold leading-snug text-gray-900">
            {title}
          </h2>
          <p className="mt-0.5 text-xs leading-relaxed text-gray-500">{description}</p>
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      <div className="p-4">{children}</div>
    </Card>
  )
}

export interface TrackingTileProps {
  icon: LucideIcon
  title: string
  description: ReactNode
  /** Omit for a tile whose control is an input rather than a switch. */
  checked?: boolean
  onChange?: (checked: boolean) => void
  disabled?: boolean
  /** An input or select rendered under the description. */
  children?: ReactNode
  tone?: 'default' | 'warning'
}

/**
 * One tracking or stock-control preference, as a card.
 *
 * The tile is active when its switch is on, and the wash says so — but never
 * alone: the switch itself is the accessible state, and the tile is a `<label>`
 * for it, so clicking anywhere in the card toggles it exactly as a checkbox
 * label does.
 */
export function TrackingTile({ icon: Icon, title, description, checked, onChange, disabled = false, children, tone = 'default' }: TrackingTileProps) {
  const id = useId()
  const titleId = `${id}-title`
  const descId = `${id}-desc`
  const switchable = typeof checked === 'boolean' && typeof onChange === 'function'
  const active = switchable && checked

  return (
    <div
      className={cx(
        AIC,
        'flex flex-col rounded-xl border p-3 transition-colors',
        active
          ? 'border-primary/30 bg-primary-light/40'
          : tone === 'warning'
            ? 'border-amber-200 bg-amber-50/60'
            : 'border-gray-200 bg-white hover:border-primary/25',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <span
          className={cx(
            'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg',
            active ? 'bg-primary text-white' : 'bg-primary-light text-primary',
          )}
          aria-hidden
        >
          <Icon className="h-4 w-4" />
        </span>
        {switchable ? (
          <Switch checked={checked} onChange={onChange} disabled={disabled} aria-labelledby={titleId} aria-describedby={descId} />
        ) : null}
      </div>
      <span id={titleId} className="mt-2.5 text-[0.8125rem] font-semibold leading-snug text-gray-900">
        {title}
      </span>
      <p id={descId} className="mt-1 text-[11px] leading-relaxed text-gray-500">
        {description}
      </p>
      {children ? <div className="mt-2.5">{children}</div> : null}
    </div>
  )
}

export interface MasterOption {
  value: string
  label: string
}

export interface MasterSelectProps {
  id: string
  value: string
  onChange: (value: string) => void
  options: readonly MasterOption[]
  /** Shown as the first option — "— None —", "Base unit", "Select…". */
  placeholder: string
  disabled?: boolean
  invalid?: boolean
  describedBy?: string
  loading?: boolean
  error?: string | null
  onRetry?: () => void
  /** What the list is called, for the empty message: "No brands yet." */
  emptyLabel?: string
}

/**
 * A select backed by a master list, with the three states a master list has
 * besides "here are the rows": still loading, failed to load, and empty.
 *
 * A dropdown that is simply blank is the bug this exists to prevent — the
 * reader cannot tell an empty brand list from a brand list that failed, and
 * neither can they tell either from a select that is still loading.
 */
export function MasterSelect({
  id,
  value,
  onChange,
  options,
  placeholder,
  disabled = false,
  invalid = false,
  describedBy,
  loading = false,
  error = null,
  onRetry,
  emptyLabel,
}: MasterSelectProps) {
  if (loading && options.length === 0) {
    return <div className={cx(AIC, 'skeleton h-9 w-full rounded-lg')} aria-hidden />
  }
  if (error && options.length === 0) {
    return (
      <div className={cx(AIC, 'flex h-9 items-center justify-between gap-2 rounded-lg border border-red-200 bg-red-50 px-2.5')}>
        <span className="truncate text-[11px] text-red-700">{error}</span>
        {onRetry ? (
          <button
            type="button"
            onClick={onRetry}
            className="shrink-0 rounded-md text-[11px] font-semibold text-red-700 underline underline-offset-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-300"
          >
            Retry
          </button>
        ) : null}
      </div>
    )
  }
  return (
    <select
      id={id}
      value={value}
      disabled={disabled}
      aria-invalid={invalid || undefined}
      aria-describedby={describedBy}
      onChange={(e) => onChange(e.target.value)}
      className={cx(
        AIC,
        'block h-9 w-full rounded-lg border bg-white px-2.5 text-sm text-gray-900 transition-colors focus:outline-none disabled:bg-gray-50 disabled:text-gray-500',
        invalid ? 'border-red-300 focus:border-red-500 focus:ring-2 focus:ring-red-300/40' : 'border-gray-200 focus:border-primary focus:ring-2 focus:ring-primary/30',
      )}
    >
      <option value="">{placeholder}</option>
      {options.length === 0 && emptyLabel ? (
        <option value="" disabled>
          {emptyLabel}
        </option>
      ) : null}
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  )
}

export interface SidePanelProps {
  title: ReactNode
  icon?: LucideIcon
  badge?: ReactNode
  subtitle?: ReactNode
  accent?: boolean
  children: ReactNode
  className?: string
}

/** A card in the intelligence rail. */
export function SidePanel({ title, icon: Icon, badge, subtitle, accent = false, children, className }: SidePanelProps) {
  return (
    <Card
      as="section"
      padding="none"
      className={cx(accent && 'border-primary/20 bg-primary-light/25', className)}
    >
      <div className="p-3.5">
        <div className="flex items-center justify-between gap-2">
          <h3 className="flex min-w-0 items-center gap-1.5 text-[0.8125rem] font-semibold text-gray-900">
            {Icon ? <Icon className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden /> : null}
            <span className="truncate">{title}</span>
          </h3>
          {badge ? <span className="shrink-0">{badge}</span> : null}
        </div>
        {subtitle ? <p className="mt-1 text-[11px] leading-relaxed text-gray-500">{subtitle}</p> : null}
        {children}
      </div>
    </Card>
  )
}
