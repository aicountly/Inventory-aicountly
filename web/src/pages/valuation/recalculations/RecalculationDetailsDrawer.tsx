import { useState } from 'react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Ban, Check, Copy, Play, RotateCcw, ScrollText } from 'lucide-react'
import { Badge } from '../../../ui/Badge'
import { Button } from '../../../ui/Button'
import { Drawer } from '../../../ui/Drawer'
import { Spinner } from '../../../ui/Spinner'
import { cx } from '../../../ui/cx'
import { ErrorState } from '../../../ui/ErrorState'
import { Notice } from '../../../components/Notice'
import type { RecalcJob } from '../../../services/valuationApi'
import { formatDate, formatDateTime, formatInt } from '../../../utils/format'
import { RecalculationStatusBadge } from './RecalculationStatusBadge'
import {
  booksPublication,
  formatCogsDelta,
  formatElapsed,
  hasSettledCounts,
  recalcFailure,
  recalcMode,
  recalcReference,
  recalcScope,
  rowAbilities,
  triggerLabel,
} from './recalculationModel'

const SECTION = 'rounded-xl border border-gray-200 p-3.5'
const SECTION_TITLE = 'text-xs font-semibold uppercase tracking-wide text-gray-500'

export interface RecalculationDetailsDrawerProps {
  open: boolean
  onClose: () => void
  /** The row that was clicked — shown immediately while the detail loads. */
  job: RecalcJob | null
  loading: boolean
  error: Error | null
  onReload: () => void
  currencyCode: string
  canRecalculate: boolean
  busy: boolean
  onRun: (job: RecalcJob) => void
  onRetry: (job: RecalcJob) => void
  onCancel: (job: RecalcJob) => void
}

/**
 * One recalculation, in full.
 *
 * A drawer rather than a dialog because it is read AGAINST the register: a
 * reader comparing a failed job with the one before it should not have to close
 * one to see where the other sat.
 *
 * It reports only what the job row and its revision aggregate actually hold. In
 * particular there is no line-by-line progress and no per-stage breakdown,
 * because the engine records neither — inventing either would put figures in an
 * audit view that reconcile against nothing.
 */
export function RecalculationDetailsDrawer({
  open,
  onClose,
  job,
  loading,
  error,
  onReload,
  currencyCode,
  canRecalculate,
  busy,
  onRun,
  onRetry,
  onCancel,
}: RecalculationDetailsDrawerProps) {
  const [copied, setCopied] = useState(false)

  const copyDiagnostics = async () => {
    if (!job) return
    /*
     * A reference an operator can paste into a support thread — the ids that
     * identify the job, not its failure text. The server's message is already
     * on screen; what a support engineer cannot see is WHICH job it was.
     */
    const text = [
      `Reference: ${recalcReference(job.job_id)}`,
      `Job UUID: ${job.job_uuid}`,
      `Status: ${job.status}`,
      `Effective from: ${job.from_date}`,
      `Queued: ${job.created_at}`,
      job.finished_at ? `Finished: ${job.finished_at}` : '',
    ]
      .filter(Boolean)
      .join('\n')
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard access can be refused (permissions, insecure origin). The ids
      // are all visible above, so there is nothing to recover — just no toast.
      setCopied(false)
    }
  }

  const failure = recalcFailure(job?.failure_reason)
  const able = job ? rowAbilities(job, canRecalculate) : null
  const publication = job ? booksPublication(job) : null
  const mode = job ? recalcMode(job) : null
  const scope = job ? recalcScope(job) : null

  return (
    <Drawer
      open={open}
      onClose={onClose}
      width="xl"
      title={job ? recalcReference(job.job_id) : 'Recalculation'}
      badge={job ? <RecalculationStatusBadge status={job.status} /> : null}
      description={
        job
          ? `${mode?.label} replaying costing from ${formatDate(job.from_date)} over ${scope?.type === 'all' ? 'all items' : scope?.label}.`
          : undefined
      }
      footer={
        job && able ? (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              {able.canRun ? (
                <Button size="sm" icon={Play} loading={busy} onClick={() => onRun(job)}>
                  Run now
                </Button>
              ) : null}
              {able.canRetry ? (
                <Button size="sm" icon={RotateCcw} loading={busy} onClick={() => onRetry(job)}>
                  Retry recalculation
                </Button>
              ) : null}
              {able.canCancel ? (
                <Button variant="danger" size="sm" icon={Ban} loading={busy} onClick={() => onCancel(job)}>
                  Cancel job
                </Button>
              ) : null}
            </div>
            <Button variant="secondary" size="sm" onClick={onClose}>
              Close
            </Button>
          </div>
        ) : (
          <div className="flex justify-end">
            <Button variant="secondary" size="sm" onClick={onClose}>
              Close
            </Button>
          </div>
        )
      }
    >
      {error && !job ? (
        <ErrorState title="Unable to load this recalculation." description={error.message} onRetry={onReload} />
      ) : null}

      {job ? (
        <div className="space-y-3.5">
          {loading ? (
            <p className="flex items-center gap-2 text-[11px] text-gray-500">
              <Spinner size="sm" /> Refreshing…
            </p>
          ) : null}

          <section className={SECTION}>
            <h3 className={SECTION_TITLE}>Overview</h3>
            <dl className="mt-2.5 grid grid-cols-1 gap-x-5 gap-y-2 sm:grid-cols-2">
              <Row label="Reference">{recalcReference(job.job_id)}</Row>
              <Row label="Mode">{mode?.label}</Row>
              <Row label="Effective from">{formatDate(job.from_date)}</Row>
              <Row label="Scope">
                {scope?.to ? (
                  <Link to={scope.to} className="text-primary hover:underline">
                    {scope.label}
                  </Link>
                ) : (
                  scope?.label
                )}
              </Row>
              <Row label="Trigger">
                {triggerLabel(job.trigger_kind)}
                {job.trigger_document_id ? (
                  <>
                    {' · '}
                    <Link to={`/documents/${job.trigger_document_id}`} className="text-primary hover:underline">
                      {job.trigger_document_no ?? `#${job.trigger_document_id}`}
                    </Link>
                  </>
                ) : null}
              </Row>
              <Row label="Requested by">{job.requested_by ?? <Muted>system</Muted>}</Row>
              <Row label="Queued at">{formatDateTime(job.created_at)}</Row>
              <Row label="Started at">{job.started_at ? formatDateTime(job.started_at) : <Muted>not started</Muted>}</Row>
              <Row label="Finished at">{job.finished_at ? formatDateTime(job.finished_at) : <Muted>—</Muted>}</Row>
              <Row label="Duration">
                {formatElapsed(job.started_at, job.finished_at) ?? <Muted>—</Muted>}
              </Row>
              <Row label="What this mode does" wide>
                {mode?.hint}
              </Row>
            </dl>
            {job.remarks ? (
              <div className="mt-3 rounded-lg border border-gray-100 bg-gray-50/70 p-2.5">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Reason given</p>
                {/* Plain text node — never dangerouslySetInnerHTML. This string
                    was typed by a user and is echoed back by the API. */}
                <p className="mt-0.5 whitespace-pre-wrap text-xs text-gray-700">{job.remarks}</p>
              </div>
            ) : null}
          </section>

          <section className={SECTION}>
            <h3 className={SECTION_TITLE}>Result</h3>
            {hasSettledCounts(job) ? (
              <div className="mt-2.5 grid grid-cols-2 gap-3 sm:grid-cols-3">
                <Figure label="Lines examined" value={formatInt(job.affected_line_count ?? 0)} />
                <Figure label="Lines revised" value={formatInt(job.revised_line_count ?? 0)} />
                <Figure
                  label="COGS delta"
                  value={formatCogsDelta(job.cogs_delta, currencyCode)}
                  hint="Movement in cost, not a score."
                />
                <Figure
                  label="Documents touched"
                  value={formatInt(job.affected_document_ids?.length ?? 0)}
                />
                {job.revision_summary ? (
                  <>
                    <Figure label="Revisions raised" value={formatInt(job.revision_summary.revisions)} />
                    <Figure label="Awaiting Books" value={formatInt(job.revision_summary.unacknowledged)} />
                  </>
                ) : null}
              </div>
            ) : (
              <p className="mt-2 text-xs text-gray-500">
                {/* No percentage and no zeros: the engine writes counts only on a
                    successful replay, so there is nothing here to put a number on.
                    A failed job's stored counts are the row's defaults, and
                    printing them would read as "it looked and found nothing". */}
                {String(job.status).toUpperCase() === 'FAILED'
                  ? 'This job stopped before it costed anything, so it measured no lines and moved no cost. The stored valuation is unchanged.'
                  : String(job.status).toUpperCase() === 'CANCELLED'
                    ? 'This job was dropped before it started. Nothing was examined and nothing was re-costed.'
                    : 'Counts and the COGS delta are measured by the job and appear once it finishes.'}
              </p>
            )}
          </section>

          <section className={SECTION}>
            <h3 className={SECTION_TITLE}>Books publication</h3>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Badge tone={publication?.tone ?? 'neutral'}>{publication?.label}</Badge>
              <p className="text-xs text-gray-600">{publication?.detail}</p>
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-gray-500">
              Inventory owns the costing and publishes the revision; Books applies the accounting
              consequence and acknowledges it. This screen reports what Inventory recorded — it does
              not hold a copy of the Books ledger.
            </p>
            {able?.canOpenRevisions ? (
              <Link
                to={`/valuation/revisions?job_id=${job.job_id}`}
                className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline"
              >
                <ScrollText className="h-3.5 w-3.5" aria-hidden />
                Open the revisions of this job
              </Link>
            ) : null}
          </section>

          {failure ? (
            <section className={cx(SECTION, 'border-red-200 bg-red-50/40')}>
              <h3 className={SECTION_TITLE}>Failure</h3>
              <p className="mt-2 text-xs font-semibold text-red-700">{failure.short}</p>
              {/* The server's own sentence, rendered as text. It explains what the
                  replay refused to do and why, which is exactly what the operator
                  needs; it is not a stack trace and no internals are exposed. */}
              <p className="mt-1 whitespace-pre-wrap text-xs leading-relaxed text-gray-700">{failure.full}</p>
              <Notice kind="info" className="mt-3">
                A failed job wrote nothing. The stored valuation is exactly as it was before it
                started, so retrying after fixing the cause is safe.
              </Notice>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Button variant="secondary" size="xs" icon={copied ? Check : Copy} onClick={copyDiagnostics}>
                  {copied ? 'Reference copied' : 'Copy diagnostic reference'}
                </Button>
                {able?.canRetry ? (
                  <Button size="xs" icon={RotateCcw} loading={busy} onClick={() => onRetry(job)}>
                    Retry
                  </Button>
                ) : null}
              </div>
            </section>
          ) : null}

          {job.affected_document_ids?.length ? (
            <section className={SECTION}>
              <h3 className={SECTION_TITLE}>Affected documents</h3>
              <p className="mt-2 flex flex-wrap gap-1.5">
                {job.affected_document_ids.slice(0, 40).map((id) => (
                  <Link
                    key={id}
                    to={`/documents/${id}`}
                    className="rounded-md border border-gray-200 px-1.5 py-0.5 text-[11px] font-medium text-gray-700 transition-colors hover:border-primary/40 hover:text-primary"
                  >
                    #{id}
                  </Link>
                ))}
              </p>
              {job.affected_document_ids.length > 40 ? (
                <p className="mt-1.5 text-[11px] text-gray-500">
                  … and {formatInt(job.affected_document_ids.length - 40)} more.
                </p>
              ) : null}
            </section>
          ) : null}

          <section className={SECTION}>
            <h3 className={SECTION_TITLE}>Audit trail</h3>
            <dl className="mt-2.5 grid grid-cols-1 gap-x-5 gap-y-2 sm:grid-cols-2">
              <Row label="Job UUID">
                <span className="font-mono text-[11px]">{job.job_uuid}</span>
              </Row>
              <Row label="Financial year id">{job.fy_id ?? <Muted>all years</Muted>}</Row>
              <Row label="Requested by">{job.requested_by ?? <Muted>system</Muted>}</Row>
              <Row label="Cancelled by">{job.cancelled_by ?? <Muted>—</Muted>}</Row>
            </dl>
            <p className="mt-2 text-[11px] leading-relaxed text-gray-500">
              Recalculation jobs are never deleted. Every run, retry and cancellation is recorded
              against the company&rsquo;s audit log.
            </p>
            <Link
              to={`/audit?q=${encodeURIComponent(String(job.job_id))}`}
              className="mt-1.5 inline-block text-xs font-semibold text-primary hover:underline"
            >
              Open the audit log
            </Link>
          </section>
        </div>
      ) : null}
    </Drawer>
  )
}

/** `wide` spans both columns and wraps — for a value that is a sentence. */
function Row({ label, children, wide = false }: { label: string; children: ReactNode; wide?: boolean }) {
  return (
    <div className={cx('min-w-0', wide && 'sm:col-span-2')}>
      <dt className="text-[11px] uppercase tracking-wide text-gray-400">{label}</dt>
      <dd className={cx('text-xs font-medium text-gray-900', wide ? 'font-normal leading-relaxed text-gray-600' : 'truncate')}>
        {children}
      </dd>
    </div>
  )
}

function Muted({ children }: { children: ReactNode }) {
  return <span className="font-normal text-gray-400">{children}</span>
}

function Figure({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-gray-100 bg-gray-50/60 p-2.5">
      <p className="text-[11px] text-gray-500">{label}</p>
      <p className="mt-0.5 text-base font-semibold tabular-nums text-gray-900">{value}</p>
      {hint ? <p className="mt-0.5 text-[10.5px] text-gray-400">{hint}</p> : null}
    </div>
  )
}
