import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { AlertTriangle, Info, Sparkles } from 'lucide-react'
import type { ReactNode } from 'react'
import { Badge } from '../../../ui/Badge'
import { Button } from '../../../ui/Button'
import { Drawer } from '../../../ui/Drawer'
import { Input } from '../../../ui/Input'
import { Select } from '../../../ui/Select'
import { Notice } from '../../../components/Notice'
import { AIC, cx } from '../../../ui/cx'
import { errorMessage, isApiError } from '../../../services/api'
import { uomApi } from '../../../services/masters'
import type { Uom } from '../../../services/masters'
import type { UqcOption } from '../../../services/uomApi'
import { formatDateTime } from '../../../utils/format'
import {
  changeWarnings,
  findSimilarUnits,
  MAX_DECIMALS,
  suggestUqc,
  validateUnitDraft,
} from './uomPresentation'
import type { DraftErrors, DuplicateMatch } from './uomPresentation'
import { UqcPicker } from './UqcPicker'

/**
 * Create and edit, in one drawer.
 *
 * A drawer rather than the modal this master used before, because the list is
 * the context: someone adding "Kilogram" wants to see that "Kg" is already
 * three rows down, and a modal over the table hides exactly that. The panel is
 * the shared `ui/Drawer`, so Escape, the focus trap and the return of focus are
 * the same here as everywhere else in the app.
 */

interface Draft {
  unit_name: string
  unit_symbol: string
  print_name: string
  uqc_gst: string
  decimal_places: string
  is_active: boolean
}

const EMPTY: Draft = {
  unit_name: '',
  unit_symbol: '',
  print_name: '',
  uqc_gst: '',
  decimal_places: String(MAX_DECIMALS),
  is_active: true,
}

function toDraft(row: Uom | null): Draft {
  if (!row) return { ...EMPTY }
  return {
    unit_name: row.unit_name ?? '',
    unit_symbol: row.unit_symbol ?? '',
    print_name: row.print_name ?? '',
    uqc_gst: (row.uqc_gst ?? '').toUpperCase(),
    decimal_places: String(row.decimal_places ?? MAX_DECIMALS),
    is_active: Number(row.is_active) === 1,
  }
}

function Field({
  label,
  htmlFor,
  hint,
  error,
  required,
  children,
  className,
}: {
  label: string
  htmlFor: string
  hint?: ReactNode
  error?: string
  required?: boolean
  children: ReactNode
  className?: string
}) {
  const hintId = `${htmlFor}-hint`
  const errorId = `${htmlFor}-error`
  return (
    <div className={cx('grid gap-1.5', className)}>
      <label htmlFor={htmlFor} className="text-xs font-semibold text-gray-700">
        {label}
        {required ? (
          <span className="ml-0.5 text-red-600" aria-hidden>
            *
          </span>
        ) : null}
        {required ? <span className="sr-only"> (required)</span> : null}
      </label>
      {children}
      {error ? (
        <p id={errorId} className="text-[11px] font-medium text-red-600">
          {error}
        </p>
      ) : hint ? (
        <p id={hintId} className="text-[11px] text-gray-500">
          {hint}
        </p>
      ) : null}
    </div>
  )
}

export interface UomFormDrawerProps {
  open: boolean
  mode: 'create' | 'edit'
  row: Uom | null
  /** Rows on screen — the first place a duplicate is looked for. */
  visibleRows: readonly Uom[]
  uqcOptions: readonly UqcOption[]
  uqcUnavailable: boolean
  canWrite: boolean
  onClose: () => void
  onSaved: (row: Uom, opts: { again: boolean }) => void
}

export function UomFormDrawer({
  open,
  mode,
  row,
  visibleRows,
  uqcOptions,
  uqcUnavailable,
  canWrite,
  onClose,
  onSaved,
}: UomFormDrawerProps) {
  const uid = useId()
  const [draft, setDraft] = useState<Draft>(() => toDraft(row))
  const [errors, setErrors] = useState<DraftErrors>({})
  const [touched, setTouched] = useState(false)
  const [saving, setSaving] = useState<false | 'save' | 'again'>(false)
  const [serverError, setServerError] = useState<string | null>(null)
  const [remoteMatches, setRemoteMatches] = useState<Uom[]>([])
  const [dismissedDuplicates, setDismissedDuplicates] = useState(false)
  const firstFieldRef = useRef<HTMLInputElement>(null)

  const readOnly = !canWrite
  const codes = useMemo(() => uqcOptions.map((o) => o.code), [uqcOptions])

  // Reset whenever the drawer opens on a different record.
  useEffect(() => {
    if (!open) return
    setDraft(toDraft(row))
    setErrors({})
    setTouched(false)
    setServerError(null)
    setRemoteMatches([])
    setDismissedDuplicates(false)
  }, [open, row])

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    setDraft((d) => {
      const next = { ...d, [key]: value }
      if (touched) setErrors(validateUnitDraft(next, { knownUqcCodes: codes }))
      return next
    })
  }

  /*
   * Look for a duplicate on the server, not only in the rows on screen.
   *
   * This page holds one page of units. A company with two hundred of them can
   * be typing "Kilogram" with the existing Kilogram four pages away, and a
   * warning that only searched what was rendered would stay silent in exactly
   * the case it exists for. The list endpoint's `q` already covers name, symbol
   * and print name, so one debounced call over each answers it.
   */
  useEffect(() => {
    if (!open || readOnly) return undefined
    const name = draft.unit_name.trim()
    const symbol = draft.unit_symbol.trim()
    if (name.length < 2 && symbol.length < 1) {
      setRemoteMatches([])
      return undefined
    }
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      const queries = [name, symbol].filter((q) => q !== '')
      Promise.all(queries.map((q) => uomApi.list({ q, limit: 10 }, controller.signal)))
        .then((responses) => {
          const byId = new Map<number, Uom>()
          for (const res of responses) for (const r of res.data) byId.set(r.unit_id, r)
          setRemoteMatches([...byId.values()])
        })
        .catch(() => {
          // A failed lookup must not block typing; the server's own uniqueness
          // check still refuses a real duplicate on save.
        })
    }, 320)
    return () => {
      controller.abort()
      window.clearTimeout(timer)
    }
  }, [open, readOnly, draft.unit_name, draft.unit_symbol])

  const duplicates: DuplicateMatch[] = useMemo(() => {
    if (dismissedDuplicates) return []
    const pool = new Map<number, Uom>()
    for (const r of visibleRows) pool.set(r.unit_id, r)
    for (const r of remoteMatches) pool.set(r.unit_id, r)
    return findSimilarUnits(
      { unit_name: draft.unit_name, unit_symbol: draft.unit_symbol, uqc_gst: draft.uqc_gst },
      [...pool.values()],
      row?.unit_id ?? null,
    )
  }, [dismissedDuplicates, visibleRows, remoteMatches, draft.unit_name, draft.unit_symbol, draft.uqc_gst, row])

  const warnings = useMemo(
    () => (mode === 'edit' && row ? changeWarnings(row, { ...draft }) : []),
    [mode, row, draft],
  )

  const suggestion = useMemo(
    () =>
      draft.uqc_gst.trim() === ''
        ? suggestUqc({ unit_name: draft.unit_name, unit_symbol: draft.unit_symbol, print_name: draft.print_name })
        : null,
    [draft.uqc_gst, draft.unit_name, draft.unit_symbol, draft.print_name],
  )

  const submit = useCallback(
    async (again: boolean) => {
      if (readOnly || saving) return
      setTouched(true)
      const found = validateUnitDraft(draft, { knownUqcCodes: codes })
      setErrors(found)
      if (Object.keys(found).length > 0) {
        // Land on the problem rather than leaving the reader to hunt for the
        // red text in a scrolled panel.
        document.getElementById(`${uid}-${Object.keys(found)[0]}`)?.focus()
        return
      }
      setSaving(again ? 'again' : 'save')
      setServerError(null)
      const payload = {
        unit_name: draft.unit_name.trim(),
        unit_symbol: draft.unit_symbol.trim(),
        print_name: draft.print_name.trim() || null,
        uqc_gst: draft.uqc_gst.trim().toUpperCase() || null,
        decimal_places: Number(draft.decimal_places || MAX_DECIMALS),
        is_active: draft.is_active ? 1 : 0,
      }
      try {
        const saved = mode === 'create' ? await uomApi.create(payload) : await uomApi.update(row!.unit_id, payload)
        onSaved(saved, { again })
        if (again) {
          setDraft({ ...EMPTY })
          setErrors({})
          setTouched(false)
          setRemoteMatches([])
          setDismissedDuplicates(false)
          firstFieldRef.current?.focus()
        }
      } catch (err) {
        // A field the server named is shown against that field; anything else
        // is a panel above the footer, never only a toast that scrolls away.
        const field = isApiError(err) ? err.field : null
        if (field) setErrors((e) => ({ ...e, [field]: errorMessage(err) }))
        else setServerError(errorMessage(err))
      } finally {
        setSaving(false)
      }
    },
    [readOnly, saving, draft, codes, uid, mode, row, onSaved],
  )

  const title = mode === 'create' ? 'New unit of measure' : canWrite ? 'Edit unit' : 'Unit of measure'
  const description =
    mode === 'create'
      ? 'Create a unit for inventory quantities, documents and reporting.'
      : 'Changes apply everywhere this unit is already used.'

  return (
    <Drawer
      open={open}
      title={title}
      description={description}
      badge={mode === 'edit' && row ? <Badge tone={Number(row.is_active) === 1 ? 'success' : 'neutral'} size="xs">{Number(row.is_active) === 1 ? 'Active' : 'Inactive'}</Badge> : null}
      onClose={() => {
        if (!saving) onClose()
      }}
      width="md"
      footer={
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={Boolean(saving)}>
            {canWrite ? 'Cancel' : 'Close'}
          </Button>
          {canWrite && mode === 'create' ? (
            <Button variant="outline" onClick={() => void submit(true)} loading={saving === 'again'} disabled={saving === 'save'}>
              Save &amp; add another
            </Button>
          ) : null}
          {canWrite ? (
            <Button onClick={() => void submit(false)} loading={saving === 'save'} disabled={saving === 'again'} kbd="Ctrl+S">
              {mode === 'create' ? 'Save unit' : 'Save changes'}
            </Button>
          ) : null}
        </div>
      }
    >
      <form
        className={cx(AIC, 'space-y-4')}
        onSubmit={(e) => {
          e.preventDefault()
          void submit(false)
        }}
        onKeyDown={(e) => {
          // Ctrl/Cmd+Enter saves from anywhere in the form, as §38 asks and as
          // the rest of the app's entry forms already behave with Ctrl+S.
          if ((e.ctrlKey || e.metaKey) && (e.key === 'Enter' || e.key.toLowerCase() === 's')) {
            e.preventDefault()
            void submit(false)
          }
        }}
      >
        {serverError ? <Notice kind="error">{serverError}</Notice> : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Unit name"
            htmlFor={`${uid}-unit_name`}
            required
            error={errors.unit_name}
            hint="What this unit is called in lists and dropdowns."
          >
            <Input
              id={`${uid}-unit_name`}
              ref={firstFieldRef}
              value={draft.unit_name}
              onChange={(e) => set('unit_name', e.target.value)}
              onBlur={() => {
                setTouched(true)
                setErrors(validateUnitDraft(draft, { knownUqcCodes: codes }))
              }}
              placeholder="Kilogram"
              maxLength={128}
              invalid={Boolean(errors.unit_name)}
              aria-describedby={errors.unit_name ? `${uid}-unit_name-error` : `${uid}-unit_name-hint`}
              disabled={readOnly}
              autoComplete="off"
            />
          </Field>

          <Field
            label="Symbol"
            htmlFor={`${uid}-unit_symbol`}
            required
            error={errors.unit_symbol}
            hint="Printed on documents beside quantities."
          >
            <Input
              id={`${uid}-unit_symbol`}
              value={draft.unit_symbol}
              onChange={(e) => set('unit_symbol', e.target.value)}
              onBlur={() => {
                setTouched(true)
                setErrors(validateUnitDraft(draft, { knownUqcCodes: codes }))
              }}
              placeholder="KG"
              maxLength={16}
              invalid={Boolean(errors.unit_symbol)}
              aria-describedby={errors.unit_symbol ? `${uid}-unit_symbol-error` : `${uid}-unit_symbol-hint`}
              disabled={readOnly}
              autoComplete="off"
            />
          </Field>

          <Field
            label="Print name"
            htmlFor={`${uid}-print_name`}
            error={errors.print_name}
            hint="Defaults to the symbol when left blank."
          >
            <Input
              id={`${uid}-print_name`}
              value={draft.print_name}
              onChange={(e) => set('print_name', e.target.value)}
              placeholder={draft.unit_symbol || 'Kilogram'}
              maxLength={128}
              invalid={Boolean(errors.print_name)}
              aria-describedby={errors.print_name ? `${uid}-print_name-error` : `${uid}-print_name-hint`}
              disabled={readOnly}
              autoComplete="off"
            />
          </Field>

          <Field
            label="Decimal places"
            htmlFor={`${uid}-decimal_places`}
            error={errors.decimal_places}
            hint={`How finely quantities are held. 0 to ${MAX_DECIMALS}.`}
          >
            <Select
              id={`${uid}-decimal_places`}
              value={draft.decimal_places}
              onChange={(e) => set('decimal_places', e.target.value)}
              invalid={Boolean(errors.decimal_places)}
              aria-describedby={errors.decimal_places ? `${uid}-decimal_places-error` : `${uid}-decimal_places-hint`}
              disabled={readOnly}
            >
              {Array.from({ length: MAX_DECIMALS + 1 }, (_, n) => (
                <option key={n} value={String(n)}>
                  {n === 0 ? '0 — whole numbers only' : String(n)}
                </option>
              ))}
            </Select>
          </Field>

          <Field
            label="GST UQC"
            htmlFor={`${uid}-uqc_gst`}
            className="sm:col-span-2"
            error={errors.uqc_gst}
            hint="The unit quantity code this unit is reported under on GST returns. Optional."
          >
            <UqcPicker
              id={`${uid}-uqc_gst`}
              value={draft.uqc_gst}
              onChange={(code) => set('uqc_gst', code)}
              options={uqcOptions}
              fallback={uqcUnavailable}
              invalid={Boolean(errors.uqc_gst)}
              describedBy={errors.uqc_gst ? `${uid}-uqc_gst-error` : `${uid}-uqc_gst-hint`}
              disabled={readOnly}
            />
            {suggestion && !readOnly ? (
              <div className="flex flex-wrap items-center gap-2 rounded-lg border border-violet-200 bg-violet-50 px-2.5 py-1.5">
                <Sparkles className="h-3.5 w-3.5 shrink-0 text-violet-600" aria-hidden />
                <span className="text-[11px] text-violet-700">
                  <strong className="font-semibold">{suggestion.code}</strong> matches this unit’s {suggestion.from}.
                </span>
                <Button
                  size="xs"
                  variant="ghost"
                  className="ml-auto text-violet-700 hover:bg-gray-100"
                  onClick={() => set('uqc_gst', suggestion.code)}
                >
                  Use {suggestion.code}
                </Button>
              </div>
            ) : null}
          </Field>

          <Field
            label="Status"
            htmlFor={`${uid}-is_active`}
            className="sm:col-span-2"
            hint="An inactive unit stays on the records that use it but is no longer offered on new ones."
          >
            <Select
              id={`${uid}-is_active`}
              value={draft.is_active ? 'active' : 'inactive'}
              onChange={(e) => set('is_active', e.target.value === 'active')}
              aria-describedby={`${uid}-is_active-hint`}
              disabled={readOnly}
            >
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </Select>
          </Field>
        </div>

        {duplicates.length > 0 ? (
          <section
            className="rounded-xl border border-amber-200 bg-amber-50/60 p-3"
            aria-live="polite"
          >
            <header className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden />
              <div className="min-w-0 flex-1">
                <strong className="block text-xs font-semibold text-amber-800">Possible duplicate found</strong>
                <p className="mt-0.5 text-[11px] leading-relaxed text-amber-800">
                  These units are already on record. Using one of them keeps your reports on a single unit.
                </p>
              </div>
            </header>
            <ul className="mt-2 space-y-1">
              {duplicates.slice(0, 4).map((match) => (
                <li
                  key={match.row.unit_id}
                  className="flex flex-wrap items-center gap-2 rounded-lg bg-white/80 px-2.5 py-1.5 text-xs"
                >
                  <strong className="font-semibold text-gray-900">{match.row.unit_name}</strong>
                  <span className="text-gray-500">({match.row.unit_symbol ?? '—'})</span>
                  <Badge tone={match.confidence === 'high' ? 'warning' : 'neutral'} size="xs">
                    {match.reason === 'name' ? 'Same name' : match.reason === 'symbol' ? 'Same symbol' : 'Same measure'}
                  </Badge>
                  {typeof match.row.usage_count === 'number' ? (
                    <span className="ml-auto text-[11px] text-gray-500">
                      {match.row.usage_count} {match.row.usage_count === 1 ? 'item' : 'items'}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
            <div className="mt-2 flex justify-end">
              <Button size="xs" variant="ghost" onClick={() => setDismissedDuplicates(true)}>
                Continue anyway
              </Button>
            </div>
          </section>
        ) : null}

        {warnings.length > 0 ? (
          <section className="rounded-xl border border-sky-200 bg-sky-50/60 p-3" aria-live="polite">
            <div className="flex items-start gap-2">
              <Info className="mt-0.5 h-4 w-4 shrink-0 text-sky-600" aria-hidden />
              <ul className="min-w-0 flex-1 space-y-1 text-[11px] leading-relaxed text-sky-700">
                {warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            </div>
          </section>
        ) : null}

        {mode === 'edit' && row ? (
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 border-t border-gray-200 pt-3 text-[11px]">
            <div>
              <dt className="text-gray-500">Created</dt>
              <dd className="mt-0.5 font-medium text-gray-700">{formatDateTime(row.created_at)}</dd>
            </div>
            <div>
              <dt className="text-gray-500">Last updated</dt>
              <dd className="mt-0.5 font-medium text-gray-700">{formatDateTime(row.updated_at)}</dd>
            </div>
            {typeof row.usage_count === 'number' ? (
              <div className="col-span-2">
                <dt className="text-gray-500">Used in</dt>
                <dd className="mt-0.5 font-medium text-gray-700">
                  {row.usage_count} {row.usage_count === 1 ? 'item' : 'items'}
                </dd>
              </div>
            ) : null}
          </dl>
        ) : null}
      </form>
    </Drawer>
  )
}

export default UomFormDrawer
