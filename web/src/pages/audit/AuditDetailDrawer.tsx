import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Copy, ExternalLink, History } from 'lucide-react'
import { Badge } from '../../ui/Badge'
import { Button } from '../../ui/Button'
import { Drawer } from '../../ui/Drawer'
import { SegmentedControl } from '../../ui/SegmentedControl'
import { Spinner } from '../../ui/Spinner'
import { AIC, cx } from '../../ui/cx'
import { notify } from '../../ui/notify'
import { useQuery } from '../../hooks/useQuery'
import { auditApi } from '../../services/auditApi'
import type { AuditLogRow } from '../../services/auditApi'
import { copyText } from '../../utils/clipboard'
import { formatDateTime } from '../../utils/format'
import {
  actionTone,
  actorIdentity,
  buildChanges,
  changedFields,
  entityIdentity,
  formatChangeValue,
  sourceIdentity,
  splitTimestamp,
} from './auditPresentation'

/**
 * The audit inspector.
 *
 * Read-only, and structurally so: there is no form, no editable field and no
 * mutating call anywhere in this file. An audit entry is evidence. The screen
 * that displays it must not be one refactor away from being able to change it.
 *
 * Two views over the same snapshots. **Changes** is the one an auditor wants —
 * paths with the old value beside the new — and is the default. **Raw JSON**
 * is the snapshot verbatim, for the case where the flattening hid something
 * that mattered. Both render through React, so every value is escaped as text:
 * a snapshot holding `<script>` is shown, never run.
 *
 * Entity history is fetched only when the reader opens it. The list endpoint
 * already carries the snapshots, so the first tab costs nothing; the history is
 * a second request and is not worth making on every row a reader glances at.
 */

const VIEWS = [
  { value: 'changes' as const, label: 'Changes' },
  { value: 'json' as const, label: 'Raw JSON' },
]

const MONO = 'font-mono text-[11px] break-words'

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
      <span className="block text-[10px] font-semibold uppercase tracking-wide text-gray-500">
        {label}
      </span>
      <div className="mt-1 break-words text-xs text-gray-700">{children ?? <Dash />}</div>
    </div>
  )
}

function Dash() {
  return <span className="text-gray-400">—</span>
}

function CopyButton({ value, label }: { value: string; label: string }) {
  return (
    <Button
      variant="ghost"
      size="xs"
      icon={Copy}
      onClick={async () => {
        const ok = await copyText(value)
        ok ? notify.success(`${label} copied`) : notify.error(`Could not copy the ${label.toLowerCase()}`)
      }}
    >
      {`Copy ${label.toLowerCase()}`}
    </Button>
  )
}

function ChangesView({ row }: { row: AuditLogRow }) {
  const [showUnchanged, setShowUnchanged] = useState(false)
  const all = useMemo(() => buildChanges(row.before, row.after), [row.before, row.after])
  const changed = all.filter((c) => c.kind !== 'unchanged')
  const unchanged = all.length - changed.length
  const shown = showUnchanged ? all : changed

  if (row.before === null && row.after === null) {
    return (
      <p className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-6 text-center text-xs text-gray-500">
        This entry carries no before / after snapshot. Some events — a
        reconciliation run, a dispatch — record that they happened rather than
        what they changed.
      </p>
    )
  }

  if (shown.length === 0) {
    return (
      <p className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-6 text-center text-xs text-gray-500">
        The two snapshots are identical.
      </p>
    )
  }

  return (
    <div className="space-y-2">
      {unchanged > 0 ? (
        <div className="flex justify-end">
          <Button variant="ghost" size="xs" onClick={() => setShowUnchanged((v) => !v)}>
            {showUnchanged ? 'Hide unchanged' : `Show ${unchanged} unchanged`}
          </Button>
        </div>
      ) : null}

      <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200">
        {shown.map((change) => {
          const before = formatChangeValue(change.before)
          const after = formatChangeValue(change.after)
          // A side is tinted only when it holds a value. An `added` field has no
          // "before", and painting that em dash red would read as a deletion —
          // the opposite of what the entry records.
          const quiet = change.kind === 'unchanged'
          const beforeTone = quiet || before === null ? 'bg-gray-50 text-gray-500' : 'bg-red-50 text-red-700'
          const afterTone = quiet || after === null ? 'bg-gray-50 text-gray-500' : 'bg-emerald-50 text-emerald-700'
          return (
            <li key={change.path} className="grid gap-2 px-3 py-2.5 sm:grid-cols-[minmax(8rem,0.8fr)_1fr_1fr]">
              <div className="min-w-0">
                <code className={cx(MONO, 'text-gray-700')}>{change.path}</code>
                {change.kind !== 'changed' ? (
                  <Badge
                    tone={change.kind === 'added' ? 'success' : 'danger'}
                    size="xs"
                    className="ml-1.5 align-middle"
                  >
                    {change.kind}
                  </Badge>
                ) : null}
              </div>
              <div className={cx(MONO, 'rounded-md px-2 py-1.5', beforeTone)}>
                <span className="sr-only">Before: </span>
                {before ?? <Dash />}
              </div>
              <div className={cx(MONO, 'rounded-md px-2 py-1.5', afterTone)}>
                <span className="sr-only">After: </span>
                {after ?? <Dash />}
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function JsonPane({ label, value }: { label: string; value: unknown }) {
  const text = useMemo(() => {
    if (value === null || value === undefined) return null
    try {
      return JSON.stringify(value, null, 2)
    } catch {
      return String(value)
    }
  }, [value])

  return (
    <section className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">{label}</h3>
        {text ? <CopyButton value={text} label={`${label} JSON`} /> : null}
      </div>
      {text ? (
        <pre className="scrollbar-thin overflow-x-auto rounded-lg border border-gray-200 bg-gray-900 px-3 py-2.5 font-mono text-[11px] leading-relaxed text-gray-100">
          {text}
        </pre>
      ) : (
        <p className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-3 text-xs text-gray-500">
          No {label.toLowerCase()} snapshot on this entry.
        </p>
      )}
    </section>
  )
}

function EntityHistory({ row, onOpen }: { row: AuditLogRow; onOpen: (r: AuditLogRow) => void }) {
  const [open, setOpen] = useState(false)
  const history = useQuery(
    (signal) => auditApi.entity(row.entity_type, row.entity_id, { limit: 25 }, signal),
    [row.entity_type, row.entity_id, open],
    { enabled: open },
  )

  if (!open) {
    return (
      <Button variant="secondary" size="sm" icon={History} onClick={() => setOpen(true)}>
        Show this record&rsquo;s history
      </Button>
    )
  }

  const rows = history.data?.data ?? []

  return (
    <section className="space-y-1.5">
      <h3 className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
        Entity history
      </h3>
      {history.loading && rows.length === 0 ? (
        <p className="flex items-center gap-2 px-1 py-2 text-xs text-gray-500">
          <Spinner /> Loading…
        </p>
      ) : history.error ? (
        <p className="px-1 py-2 text-xs text-gray-500">This record&rsquo;s history could not be loaded.</p>
      ) : (
        <ol className="divide-y divide-gray-100 rounded-lg border border-gray-200">
          {rows.map((entry) => {
            const when = splitTimestamp(entry.created_at)
            const current = entry.audit_id === row.audit_id
            return (
              <li key={entry.audit_id}>
                <button
                  type="button"
                  onClick={() => onOpen(entry)}
                  aria-current={current || undefined}
                  className={cx(
                    AIC,
                    'flex w-full items-center gap-2 px-3 py-2 text-left text-xs transition-colors hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-primary/30',
                    current && 'bg-primary-light/50',
                  )}
                >
                  <span className="w-28 shrink-0 tabular-nums text-gray-500">
                    {when.date}
                    {when.time ? ` · ${when.time}` : ''}
                  </span>
                  <Badge tone={actionTone(entry.action)} size="xs">
                    {entry.action}
                  </Badge>
                  <span className="truncate text-gray-500">
                    {actorIdentity(entry).label}
                  </span>
                </button>
              </li>
            )
          })}
        </ol>
      )}
    </section>
  )
}

export interface AuditDetailDrawerProps {
  row: AuditLogRow | null
  onClose: () => void
  /** Swap the drawer to another entry — used by the history timeline. */
  onSelect: (row: AuditLogRow) => void
}

export function AuditDetailDrawer({ row, onClose, onSelect }: AuditDetailDrawerProps) {
  const [view, setView] = useState<'changes' | 'json'>('changes')

  if (!row) return <Drawer open={false} title="" onClose={onClose}>{null}</Drawer>

  const actor = actorIdentity(row)
  const entity = entityIdentity(row)
  const source = sourceIdentity(row)
  const fields = changedFields(row)

  return (
    <Drawer
      open
      onClose={onClose}
      width="lg"
      title="Audit event details"
      description={`${entity.label}${entity.subtitle ? ` · ${entity.subtitle}` : ''}`}
      badge={
        <Badge tone={actionTone(row.action)} size="sm" className="normal-case">
          {row.action}
        </Badge>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <Field label="When">
            <span className="tabular-nums">{formatDateTime(row.created_at)}</span>
          </Field>
          <Field label="Actor">
            <span title={actor.title}>{actor.label}</span>
          </Field>
          <Field label="Entity">
            {entity.to ? (
              <Link
                to={entity.to}
                className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
              >
                {entity.label}
                <ExternalLink className="h-3 w-3" aria-hidden />
              </Link>
            ) : (
              entity.label
            )}
            {entity.subtitle ? (
              <span className="block text-[11px] text-gray-500">{entity.subtitle}</span>
            ) : null}
          </Field>
          <Field label="Source app">
            {source.label ? (
              <>
                {source.label}
                {source.reference ? (
                  <span className="block text-[11px] text-gray-500">{source.reference}</span>
                ) : null}
              </>
            ) : null}
          </Field>
          <Field label="Request id">
            {row.request_id ? (
              <span className="flex items-center gap-1">
                <code className={cx(MONO, 'min-w-0 flex-1 truncate')}>{row.request_id}</code>
                <CopyButton value={row.request_id} label="Request id" />
              </span>
            ) : null}
          </Field>
          <Field label="IP address">
            {row.ip_address ? <code className={MONO}>{row.ip_address}</code> : null}
          </Field>
          <Field label="Reason">{row.reason || null}</Field>
          <Field label="Changed fields">
            {fields.length ? (
              <span className="flex flex-wrap gap-1">
                {fields.map((f) => (
                  <code
                    key={f}
                    className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-[10px] text-gray-600"
                  >
                    {f}
                  </code>
                ))}
              </span>
            ) : null}
          </Field>
          {row.approval_ref ? <Field label="Approval ref">{row.approval_ref}</Field> : null}
          {row.reversal_ref ? <Field label="Reversal of">#{row.reversal_ref}</Field> : null}
        </div>

        <div className="flex items-center justify-between gap-2">
          <SegmentedControl value={view} onChange={setView} options={VIEWS} />
          <span className="text-[11px] text-gray-400">Read-only record</span>
        </div>

        {view === 'changes' ? (
          <ChangesView row={row} />
        ) : (
          <div className="space-y-3">
            <JsonPane label="Before" value={row.before} />
            <JsonPane label="After" value={row.after} />
            {row.meta ? <JsonPane label="Meta" value={row.meta} /> : null}
          </div>
        )}

        <EntityHistory row={row} onOpen={onSelect} />
      </div>
    </Drawer>
  )
}

export default AuditDetailDrawer
