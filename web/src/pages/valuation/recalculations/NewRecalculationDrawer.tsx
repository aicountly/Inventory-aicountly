import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Boxes, Package, ShieldAlert } from 'lucide-react'
import { Button } from '../../../ui/Button'
import { Drawer } from '../../../ui/Drawer'
import { Input } from '../../../ui/Input'
import { SegmentedControl } from '../../../ui/SegmentedControl'
import { Textarea } from '../../../ui/Textarea'
import { cx } from '../../../ui/cx'
import { Notice } from '../../../components/Notice'
import { ItemPicker } from '../../../components/ItemPicker'
import type { PickedItem } from '../../../components/ItemPicker'
import { METHOD_LABELS } from '../../../services/valuationApi'
import type { EnqueueRecalcPayload } from '../../../services/valuationApi'
import type { CompanySettings } from '../../../services/settingsApi'
import { formatDate, todayIso } from '../../../utils/format'

type ScopeChoice = 'all' | 'item'
type ModeChoice = 'dry' | 'live'

const LABEL = 'block text-xs font-semibold text-gray-700'
const HELP = 'mt-1 text-[11px] leading-relaxed text-gray-500'
const REMARKS_MAX = 1000

export interface NewRecalculationDrawerProps {
  open: boolean
  onClose: () => void
  onSubmit: (payload: EnqueueRecalcPayload, idempotencyKey: string) => Promise<void>
  /** Company settings, for the method and COGS mode this run will follow. */
  settings: CompanySettings | null
  /** Pre-select the dry run, e.g. when opened from the Pro tip panel. */
  preferDryRun?: boolean
  submitting: boolean
}

/**
 * Starting a recalculation.
 *
 * This form queues a job that REWRITES historical inventory valuation and
 * publishes COGS revisions to Books, so it is built to be hard to fire by
 * accident and easy to rehearse:
 *
 *  - the default is a DRY RUN, which replays identically and writes nothing;
 *  - a live run over every item asks for an explicit acknowledgement;
 *  - a live run asks for the reason, which is stored on the job and is what an
 *    audit six months later actually reads;
 *  - submitting mints one idempotency key per attempt, so a double-click, a
 *    flaky connection or a retried request comes back with the FIRST job rather
 *    than queueing a second restatement of the same period.
 *
 * What it deliberately does NOT offer: a category or warehouse scope, and a
 * "publish to Books" toggle. RecalculationService replays by item and would
 * silently ignore a warehouse; and publication is not a user decision — a live
 * run that changes a valuation publishes the revision, because Inventory owning
 * the costing and Books owning the accounting only works if the two cannot drift.
 */
export function NewRecalculationDrawer({
  open,
  onClose,
  onSubmit,
  settings,
  preferDryRun = true,
  submitting,
}: NewRecalculationDrawerProps) {
  const today = todayIso()
  const [fromDate, setFromDate] = useState(today)
  const [mode, setMode] = useState<ModeChoice>(preferDryRun ? 'dry' : 'live')
  const [scope, setScope] = useState<ScopeChoice>('all')
  const [item, setItem] = useState<PickedItem | null>(null)
  const [remarks, setRemarks] = useState('')
  const [runNow, setRunNow] = useState(true)
  const [acknowledged, setAcknowledged] = useState(false)
  const [touched, setTouched] = useState(false)
  /*
   * One key per ATTEMPT, minted when the form opens and again after a failure.
   * Not per keystroke: the whole point is that the second press of a
   * double-click carries the key the first press already used.
   */
  const idempotencyKey = useRef(newKey())

  useEffect(() => {
    if (!open) return
    setFromDate(today)
    setMode(preferDryRun ? 'dry' : 'live')
    setScope('all')
    setItem(null)
    setRemarks('')
    setRunNow(true)
    setAcknowledged(false)
    setTouched(false)
    idempotencyKey.current = newKey()
  }, [open, today, preferDryRun])

  const live = mode === 'live'
  const wholeCompany = scope === 'all'
  const needsAck = live && wholeCompany

  const errors = useMemo(() => {
    const out: Record<string, string> = {}
    if (!fromDate) out.fromDate = 'Choose the date the costing should be replayed from.'
    else if (fromDate > today) out.fromDate = 'The effective date cannot be in the future.'
    if (scope === 'item' && !item) out.item = 'Choose the item to recalculate.'
    // A dry run writes nothing, so it needs no justification; a live one restates
    // history and the reason is the only part of that a person can read later.
    if (live && remarks.trim().length < 5) out.remarks = 'Give the reason for this restatement (at least a few words).'
    if (remarks.length > REMARKS_MAX) out.remarks = `Keep the reason under ${REMARKS_MAX} characters.`
    if (needsAck && !acknowledged) out.acknowledged = 'Confirm you understand what a company-wide live run does.'
    return out
  }, [fromDate, today, scope, item, live, remarks, needsAck, acknowledged])

  const valid = Object.keys(errors).length === 0

  const submit = async () => {
    setTouched(true)
    if (!valid || submitting) return
    await onSubmit(
      {
        from_date: fromDate,
        item_id: scope === 'item' ? (item?.item_id ?? null) : null,
        dry_run: !live,
        run_now: runNow,
        remarks: remarks.trim() || null,
      },
      idempotencyKey.current,
    )
    // A new attempt after a failure is a new job, so it gets a new key. On
    // success the drawer closes and the effect above mints one anyway.
    idempotencyKey.current = newKey()
  }

  const show = (key: string) => (touched ? errors[key] : undefined)

  return (
    <Drawer
      open={open}
      onClose={submitting ? () => undefined : onClose}
      title="New valuation recalculation"
      description="Replay inventory costing forward from an effective date."
      width="lg"
      footer={
        <div className="flex items-center justify-between gap-3">
          <p className="text-[11px] text-gray-500">
            {live ? 'Writes revisions and publishes to Books.' : 'Dry run — nothing is written.'}
          </p>
          <div className="flex items-center gap-2">
            <Button variant="secondary" onClick={onClose} disabled={submitting}>
              Cancel
            </Button>
            <Button onClick={submit} loading={submitting} disabled={touched && !valid}>
              {live ? 'Start recalculation' : 'Start dry run'}
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-5">
        <div>
          <label className={LABEL} htmlFor="recalc-from-date">
            Effective from <span className="text-red-600">*</span>
          </label>
          <Input
            id="recalc-from-date"
            type="date"
            size="md"
            className="mt-1 max-w-[14rem]"
            value={fromDate}
            max={today}
            invalid={Boolean(show('fromDate'))}
            aria-describedby="recalc-from-help"
            onChange={(e) => setFromDate(e.target.value)}
          />
          <p className={HELP} id="recalc-from-help">
            Every stock movement on or after {fromDate ? formatDate(fromDate) : 'this date'} is re-costed in
            order. Earlier movements are left exactly as they are.
          </p>
          <FieldError message={show('fromDate')} />
        </div>

        <div>
          <span className={LABEL}>Mode</span>
          <SegmentedControl<ModeChoice>
            className="mt-1.5"
            size="md"
            value={mode}
            onChange={setMode}
            options={[
              { value: 'dry', label: 'Dry run', title: 'Replay and report, writing nothing' },
              { value: 'live', label: 'Live run', title: 'Write the revised valuation and publish to Books' },
            ]}
          />
          <p className={HELP}>
            {live
              ? 'The revised valuation is written, cost layers are rebuilt and the applicable COGS revisions are published to Books.'
              : 'The replay runs exactly as a live one would and reports what it would change. No revision is written and nothing reaches Books.'}
          </p>
        </div>

        <fieldset>
          <legend className={LABEL}>Scope</legend>
          <div className="mt-1.5 grid grid-cols-1 gap-2 sm:grid-cols-2">
            <ScopeCard
              checked={scope === 'all'}
              onSelect={() => setScope('all')}
              icon={<Boxes className="h-4 w-4" aria-hidden />}
              title="All items"
              hint="Every item with movements in the financial year."
            />
            <ScopeCard
              checked={scope === 'item'}
              onSelect={() => setScope('item')}
              icon={<Package className="h-4 w-4" aria-hidden />}
              title="One item"
              hint="The safest way to see the impact before widening."
            />
          </div>
          {scope === 'item' ? (
            <div className="mt-2.5">
              <ItemPicker
                id="recalc-item"
                value={item}
                onChange={setItem}
                placeholder="Search for an item…"
                invalid={Boolean(show('item'))}
              />
              <FieldError message={show('item')} />
            </div>
          ) : null}
          {/*
            Category and warehouse are not offered. The replay engine scopes by
            item; a warehouse chosen here would be recorded and then ignored,
            which is the worst of both — a job that claims a narrow scope and
            restates the whole company.
          */}
        </fieldset>

        <div>
          <label className={LABEL} htmlFor="recalc-remarks">
            Reason {live ? <span className="text-red-600">*</span> : <span className="font-normal text-gray-400">(optional for a dry run)</span>}
          </label>
          <Textarea
            id="recalc-remarks"
            className="mt-1"
            rows={3}
            maxLength={REMARKS_MAX}
            value={remarks}
            invalid={Boolean(show('remarks'))}
            placeholder="e.g. Supplier's revised invoice received for the July receipts."
            onChange={(e) => setRemarks(e.target.value)}
          />
          <p className={HELP}>Stored on the job. This is what an audit of the restatement reads.</p>
          <FieldError message={show('remarks')} />
        </div>

        <label className="flex items-start gap-2 text-xs text-gray-600">
          <input
            type="checkbox"
            className="mt-0.5 h-4 w-4 accent-[rgb(var(--color-primary))]"
            checked={runNow}
            onChange={(e) => setRunNow(e.target.checked)}
          />
          <span>
            Run it now
            <span className="block text-[11px] text-gray-500">
              Leave this off to queue the job for the background worker instead.
            </span>
          </span>
        </label>

        <section className="rounded-xl border border-gray-200 bg-gray-50/60 p-3">
          <h3 className="text-xs font-semibold text-gray-800">Before it starts</h3>
          <dl className="mt-2 grid grid-cols-1 gap-x-4 gap-y-1.5 text-[11.5px] sm:grid-cols-2">
            <Fact label="Period affected" value={fromDate ? `${formatDate(fromDate)} onwards` : '—'} />
            <Fact
              label="Scope"
              value={scope === 'all' ? 'All items' : (item ? item.item_name : 'One item — not chosen yet')}
            />
            <Fact
              label="Valuation method"
              value={
                settings
                  ? (METHOD_LABELS[settings.default_valuation_method as keyof typeof METHOD_LABELS] ??
                    String(settings.default_valuation_method))
                  : '—'
              }
            />
            <Fact
              label="COGS revisions"
              value={
                !live
                  ? 'None — dry run'
                  : settings?.cogs_revision_mode === 'adjustment'
                    ? 'Published to Books as adjustments'
                    : 'Published to Books inline'
              }
            />
          </dl>
          {/*
            No estimated line or item count: there is no preview endpoint, and a
            guessed "≈ 2,143 transactions" on the screen that authorises a
            restatement would be the worst possible number to be wrong about.
          */}
          <p className={cx(HELP, 'mt-2')}>
            The number of lines affected and the COGS delta are measured by the job itself and appear
            on the register when it finishes.
          </p>
        </section>

        {live ? (
          <Notice kind="warning" title="This changes stored history.">
            A live run rewrites the valuation already recorded against posted documents from the
            effective date onwards, and publishes the resulting COGS revisions to Books. It cannot be
            undone by cancelling — only by recalculating again.
          </Notice>
        ) : null}

        {needsAck ? (
          <label
            className={cx(
              'flex items-start gap-2.5 rounded-xl border p-3 text-xs',
              show('acknowledged') ? 'border-red-300 bg-red-50/60' : 'border-amber-200 bg-amber-50/60',
            )}
          >
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 accent-[rgb(var(--color-primary))]"
              checked={acknowledged}
              onChange={(e) => setAcknowledged(e.target.checked)}
            />
            <span className="text-gray-700">
              <ShieldAlert className="mr-1 inline h-3.5 w-3.5 text-amber-600" aria-hidden />
              I understand this live run covers <strong>every item</strong>, may update historical
              inventory valuation and will generate COGS revisions in Books.
            </span>
          </label>
        ) : null}
        <FieldError message={show('acknowledged')} />
      </div>
    </Drawer>
  )
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-gray-500">{label}</dt>
      <dd className="truncate font-medium text-gray-900">{value}</dd>
    </div>
  )
}

function FieldError({ message }: { message?: string }) {
  if (!message) return null
  return (
    <p role="alert" className="mt-1 text-[11px] font-medium text-red-600">
      {message}
    </p>
  )
}

function ScopeCard({
  checked,
  onSelect,
  icon,
  title,
  hint,
}: {
  checked: boolean
  onSelect: () => void
  icon: ReactNode
  title: string
  hint: string
}) {
  return (
    <label
      className={cx(
        'flex cursor-pointer items-start gap-2.5 rounded-xl border p-3 transition-colors',
        checked ? 'border-primary/50 bg-primary-light/50' : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50',
      )}
    >
      <input
        type="radio"
        name="recalc-scope"
        className="mt-0.5 h-4 w-4 accent-[rgb(var(--color-primary))]"
        checked={checked}
        onChange={onSelect}
      />
      <span className="min-w-0">
        <span className={cx('flex items-center gap-1.5 text-xs font-semibold', checked ? 'text-primary' : 'text-gray-800')}>
          {icon}
          {title}
        </span>
        <span className="mt-0.5 block text-[11px] leading-relaxed text-gray-500">{hint}</span>
      </span>
    </label>
  )
}

/** A per-attempt idempotency token. `randomUUID` where the browser has it. */
function newKey(): string {
  const c = globalThis.crypto
  if (c && typeof c.randomUUID === 'function') return c.randomUUID()
  return `recalc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}
