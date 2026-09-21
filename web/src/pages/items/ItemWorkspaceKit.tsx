/**
 * The pieces the Edit Item cards are built from.
 *
 * Every control here is the shared `ui/` primitive with the one thing the workspace adds: a real
 * `id` on the input and a `for` on its label. That is not decoration — it is what makes the
 * "scroll to the first error" behaviour possible (the page looks the element up by id), what lets
 * a screen reader announce which box it is in, and what makes a click on a label focus the field.
 *
 * Nothing in this file holds state. Each control is told its value and hands back the next one.
 */

import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { Input } from '../../ui/Input'
import { Select } from '../../ui/Select'
import { Textarea } from '../../ui/Textarea'
import { FormField } from '../../ui/shell/FormSectionCard'
import { AIC, cx } from '../../ui/cx'

/** Stable, unique and derivable from the field name, so the page can find a field to scroll to. */
export function fieldId(name: string): string {
  return `item-field-${name}`
}

export interface SelectOption {
  value: string | number
  label: string
}

interface BaseFieldProps {
  name: string
  label: ReactNode
  required?: boolean
  hint?: ReactNode
  error?: string
  disabled?: boolean
  className?: string
}

export interface TextFieldProps extends BaseFieldProps {
  value: string
  onChange: (value: string) => void
  maxLength?: number
  placeholder?: string
  /** Rendered flush against the input's right edge — the barcode scan button. */
  addon?: ReactNode
}

export function TextField({
  name,
  label,
  required,
  hint,
  error,
  disabled,
  className,
  value,
  onChange,
  maxLength,
  placeholder,
  addon,
}: TextFieldProps) {
  const id = fieldId(name)
  return (
    <FormField label={label} htmlFor={id} required={required} hint={hint} error={error} className={className}>
      {addon ? (
        <div className={cx(AIC, 'flex items-stretch')}>
          <Input
            id={id}
            size="md"
            value={value}
            maxLength={maxLength}
            placeholder={placeholder}
            disabled={disabled}
            invalid={Boolean(error)}
            onChange={(e) => onChange(e.target.value)}
            className="rounded-r-none"
          />
          {addon}
        </div>
      ) : (
        <Input
          id={id}
          size="md"
          value={value}
          maxLength={maxLength}
          placeholder={placeholder}
          disabled={disabled}
          invalid={Boolean(error)}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </FormField>
  )
}

export interface NumberFieldProps extends BaseFieldProps {
  value: string
  onChange: (value: string) => void
  step?: string | number
  min?: number
  /** A unit or currency written inside the right edge of the box — `₹`, `days`, `Kg`. */
  suffix?: string
}

export function NumberField({
  name,
  label,
  required,
  hint,
  error,
  disabled,
  className,
  value,
  onChange,
  step = 'any',
  min = 0,
  suffix,
}: NumberFieldProps) {
  const id = fieldId(name)
  return (
    <FormField label={label} htmlFor={id} required={required} hint={hint} error={error} className={className}>
      <div className={cx(AIC, 'relative')}>
        <Input
          id={id}
          size="md"
          type="number"
          inputMode="decimal"
          step={step}
          min={min}
          value={value}
          disabled={disabled}
          invalid={Boolean(error)}
          onChange={(e) => onChange(e.target.value)}
          className={cx('tabular-nums', suffix && 'pr-12')}
        />
        {suffix ? (
          <span
            className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[11px] font-medium text-gray-400"
            aria-hidden
          >
            {suffix}
          </span>
        ) : null}
      </div>
    </FormField>
  )
}

export interface SelectFieldProps extends BaseFieldProps {
  value: string
  onChange: (value: string) => void
  options: readonly SelectOption[]
  /** The first entry. `null` means the field has no empty choice at all. */
  emptyLabel?: string | null
}

export function SelectField({
  name,
  label,
  required,
  hint,
  error,
  disabled,
  className,
  value,
  onChange,
  options,
  emptyLabel = '— None —',
}: SelectFieldProps) {
  const id = fieldId(name)
  return (
    <FormField label={label} htmlFor={id} required={required} hint={hint} error={error} className={className}>
      <Select
        id={id}
        size="md"
        value={value}
        disabled={disabled}
        invalid={Boolean(error)}
        onChange={(e) => onChange(e.target.value)}
      >
        {emptyLabel === null ? null : <option value="">{emptyLabel}</option>}
        {options.map((o) => (
          <option key={String(o.value)} value={String(o.value)}>
            {o.label}
          </option>
        ))}
      </Select>
    </FormField>
  )
}

export interface TextAreaFieldProps extends BaseFieldProps {
  value: string
  onChange: (value: string) => void
  rows?: number
  placeholder?: string
  maxLength?: number
}

export function TextAreaField({
  name,
  label,
  hint,
  error,
  disabled,
  className,
  value,
  onChange,
  rows = 3,
  placeholder,
  maxLength,
}: TextAreaFieldProps) {
  const id = fieldId(name)
  return (
    <FormField label={label} htmlFor={id} hint={hint} error={error} className={className}>
      <Textarea
        id={id}
        rows={rows}
        value={value}
        placeholder={placeholder}
        maxLength={maxLength}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      />
    </FormField>
  )
}

export interface ToggleFieldProps {
  name: string
  label: ReactNode
  description?: ReactNode
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
  icon?: LucideIcon
  /**
   * Drop the card chrome — for a switch that sits in a card header rather than in a grid of them.
   *
   * A variant rather than a `className` override: the chrome is `p-3` and a background, and
   * cancelling those from outside depends on which of two same-property utilities Tailwind happens
   * to emit last. A boolean decides it in the component, where it cannot silently stop working.
   */
  bare?: boolean
  className?: string
}

/**
 * A switch that is a real checkbox underneath.
 *
 * The track and knob are drawn with `peer-checked:` on a visually-hidden input rather than on a
 * `div` with a click handler, so it is reachable by Tab, toggled by Space, announced as a checkbox
 * with its state, and carries a focus ring without any of that being re-implemented. `sr-only`
 * rather than `hidden`: a hidden input is not focusable.
 */
export function ToggleField({
  name,
  label,
  description,
  checked,
  onChange,
  disabled,
  icon: Icon,
  bare = false,
  className,
}: ToggleFieldProps) {
  const id = fieldId(name)
  return (
    <label
      htmlFor={id}
      className={cx(
        AIC,
        'flex cursor-pointer items-start gap-3 transition-colors',
        bare
          ? 'items-center'
          : cx(
              'rounded-xl border p-3',
              checked ? 'border-primary/40 bg-primary-light/50' : 'border-gray-200 bg-white hover:border-gray-300',
            ),
        disabled && 'cursor-not-allowed opacity-60',
        className,
      )}
    >
      <input
        id={id}
        type="checkbox"
        className="peer sr-only"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span
        className={cx(
          'flex h-5 w-9 shrink-0 items-center rounded-full border p-0.5 transition-colors',
          !bare && 'mt-0.5',
          'peer-focus-visible:ring-2 peer-focus-visible:ring-primary/40 peer-focus-visible:ring-offset-1',
          checked ? 'border-primary bg-primary' : 'border-gray-300 bg-gray-200',
        )}
        aria-hidden
      >
        <span
          className={cx(
            'h-4 w-4 rounded-full bg-white shadow-sm transition-transform motion-reduce:transition-none',
            checked ? 'translate-x-4' : 'translate-x-0',
          )}
        />
      </span>
      <span className="min-w-0">
        <span
          className={cx(
            'flex items-center gap-1.5 font-medium text-gray-900',
            bare ? 'text-xs' : 'text-sm',
          )}
        >
          {Icon ? <Icon className="h-3.5 w-3.5 text-gray-400" aria-hidden /> : null}
          {label}
        </span>
        {description ? <span className="mt-0.5 block text-xs leading-relaxed text-gray-500">{description}</span> : null}
      </span>
    </label>
  )
}

/** The panel a card opens under a heading — the alternate units table, the opening rows. */
export function SubPanel({
  title,
  description,
  action,
  children,
  className,
}: {
  title: ReactNode
  description?: ReactNode
  action?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section className={cx(AIC, 'overflow-hidden rounded-xl border border-gray-200', className)}>
      <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-gray-100 bg-gray-50 px-3 py-2">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <h4 className="text-xs font-semibold text-gray-900">{title}</h4>
          {description ? <p className="text-[11px] text-gray-500">{description}</p> : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </header>
      {children}
    </section>
  )
}

/** A contextual remark inside a card — a risk, a consequence, a piece of guidance. */
export function FieldNote({
  tone = 'info',
  icon: Icon,
  children,
  className,
}: {
  tone?: 'info' | 'warning' | 'danger' | 'success'
  icon?: LucideIcon
  children: ReactNode
  className?: string
}) {
  const TONES = {
    info: 'border-sky-200 bg-sky-50 text-sky-700',
    warning: 'border-amber-200 bg-amber-50 text-amber-700',
    danger: 'border-red-200 bg-red-50 text-red-700',
    success: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  } as const
  return (
    <p
      className={cx(
        AIC,
        'flex items-start gap-2 rounded-lg border px-3 py-2 text-[11px] leading-relaxed',
        TONES[tone],
        className,
      )}
    >
      {Icon ? <Icon className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden /> : null}
      <span className="min-w-0">{children}</span>
    </p>
  )
}

/** The aside column's card. Lighter than the form cards so the two columns read as different work. */
export function AsideCard({
  title,
  action,
  icon: Icon,
  children,
  className,
  bodyClassName,
}: {
  title?: ReactNode
  action?: ReactNode
  icon?: LucideIcon
  children: ReactNode
  className?: string
  bodyClassName?: string
}) {
  return (
    <section className={cx(AIC, 'rounded-2xl border border-gray-200 bg-white p-4 shadow-card', className)}>
      {title ? (
        <header className="mb-3 flex items-center justify-between gap-2">
          <h2 className="flex min-w-0 items-center gap-1.5 text-sm font-semibold text-gray-900">
            {Icon ? <Icon className="h-4 w-4 shrink-0 text-gray-400" aria-hidden /> : null}
            <span className="truncate">{title}</span>
          </h2>
          {action ? <div className="shrink-0">{action}</div> : null}
        </header>
      ) : null}
      <div className={bodyClassName}>{children}</div>
    </section>
  )
}
