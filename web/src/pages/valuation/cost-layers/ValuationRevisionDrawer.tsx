import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { FilePenLine, Play } from 'lucide-react'
import { Button } from '../../../ui/Button'
import { Drawer } from '../../../ui/Drawer'
import { Input } from '../../../ui/Input'
import { Notice } from '../../../components/Notice'
import { useToast } from '../../../ui/ToastContext'
import { ApiError } from '../../../services/api'
import { valuationApi } from '../../../services/valuationApi'
import type { CostLayerRow, CostLayersResponse, RecalcJob } from '../../../services/valuationApi'
import { formatDate, formatMoney, formatQty, humanize, todayIso } from '../../../utils/format'
import { RecalcResult } from './RecalculateValuationModal'
import { consumedQty } from '../costLayerModel'

export interface ValuationRevisionDrawerProps {
  open: boolean
  onClose: () => void
  layer: CostLayerRow | null
  item: CostLayersResponse['item'] | null
  itemId: string
  onDone: () => void
}

/**
 * Create a valuation revision.
 *
 * The important thing this screen does is refuse to let a cost be typed over.
 * Inventory does not rewrite a historical layer: a cost change is produced by
 * re-costing the movements from an effective date, and every line whose value
 * moves is written to `inv_valuation_revisions` with its old rate, its new
 * rate, the job that produced it and whether Books has applied it. That is what
 * makes the change auditable, and typing a number into a box would bypass all
 * of it.
 *
 * So the drawer shows the layer as it stands, takes the date the change should
 * take effect from, previews the impact, and then creates the revision by
 * running the re-costing. The original cost is displayed and is not editable —
 * there is no endpoint that overrides a layer's unit cost, and a field that
 * looked as though there were would be worse than its absence.
 */
export function ValuationRevisionDrawer({
  open,
  onClose,
  layer,
  item,
  itemId,
  onDone,
}: ValuationRevisionDrawerProps) {
  const toast = useToast()
  const [effectiveDate, setEffectiveDate] = useState(todayIso())
  const [busy, setBusy] = useState<'preview' | 'create' | null>(null)
  const [preview, setPreview] = useState<RecalcJob | null>(null)
  const [created, setCreated] = useState<RecalcJob | null>(null)

  useEffect(() => {
    if (!open) return
    setEffectiveDate(layer?.received_at?.slice(0, 10) || todayIso())
    setPreview(null)
    setCreated(null)
  }, [open, layer])

  const run = async (dryRun: boolean) => {
    setBusy(dryRun ? 'preview' : 'create')
    try {
      const job = await valuationApi.enqueueRecalc({
        from_date: effectiveDate,
        item_id: itemId ? Number(itemId) : null,
        dry_run: dryRun,
        run_now: true,
      })
      if (dryRun) {
        setPreview(job)
        toast.info(
          `Preview #${job.job_id}: ${job.revised_line_count ?? 0} line(s) would be revised.`,
        )
      } else {
        setCreated(job)
        toast.success(
          `Revision job #${job.job_id} ${job.status.toLowerCase()} — ${job.revised_line_count ?? 0} line(s) revised.`,
        )
        onDone()
      }
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Could not run the revision.')
    } finally {
      setBusy(null)
    }
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      width="md"
      title="Create valuation revision"
      description={item ? `${item.item_name}${item.item_sku ? ` · ${item.item_sku}` : ''}` : undefined}
      footer={
        created ? (
          <div className="flex justify-end">
            <Button onClick={onClose}>Close</Button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button variant="ghost" onClick={onClose} disabled={busy !== null}>
              Cancel
            </Button>
            <Button
              variant="secondary"
              icon={Play}
              loading={busy === 'preview'}
              disabled={busy !== null || !effectiveDate || !itemId}
              onClick={() => run(true)}
            >
              Preview impact
            </Button>
            <Button
              icon={FilePenLine}
              loading={busy === 'create'}
              disabled={busy !== null || !effectiveDate || !itemId || preview === null}
              onClick={() => run(false)}
            >
              Create revision
            </Button>
          </div>
        )
      }
    >
      {created ? (
        <div className="space-y-3">
          <RecalcResult job={created} />
          <p className="text-[11.5px] text-gray-600">
            The revision is now part of the item&rsquo;s audit trail. It records the old and new
            valuation rate, the amount, the job that produced it and the timestamp.
          </p>
        </div>
      ) : (
        <div className="space-y-3.5">
          <section>
            <h3 className="text-[12px] font-semibold text-gray-900">Layer being revised</h3>
            {layer ? (
              <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2.5">
                <Field label="Layer">
                  {layer.source_document_no ?? `${humanize(layer.layer_kind)} #${layer.layer_id}`}
                </Field>
                <Field label="Received">{formatDate(layer.received_at)}</Field>
                <Field label="Warehouse">{layer.warehouse_name ?? '—'}</Field>
                <Field label="Qty received">{formatQty(layer.qty_received)}</Field>
                <Field label="Qty consumed">{formatQty(consumedQty(layer))}</Field>
                <Field label="Qty remaining">{formatQty(layer.qty_remaining)}</Field>
                <Field label="Original unit cost">
                  <span className="font-semibold">{formatMoney(layer.unit_cost)}</span>
                </Field>
                <Field label="Layer value">
                  <span className="font-semibold">{formatMoney(layer.remaining_value)}</span>
                </Field>
              </dl>
            ) : (
              <p className="mt-1.5 text-[11.5px] text-gray-500">
                No layer selected — the revision will re-cost every movement of this item from the
                effective date.
              </p>
            )}
          </section>

          <section className="border-t border-gray-100 pt-3.5">
            <label
              htmlFor="revision-effective"
              className="text-[11px] font-semibold uppercase tracking-wide text-gray-500"
            >
              Effective from
            </label>
            <Input
              id="revision-effective"
              type="date"
              value={effectiveDate}
              onChange={(e) => {
                setEffectiveDate(e.target.value)
                setPreview(null)
              }}
              className="mt-1 w-[11rem]"
            />
            <p className="mt-1 text-[11px] leading-relaxed text-gray-500">
              Movements of this item on or after {formatDate(effectiveDate)} are re-costed in
              order, and every line whose value changes becomes a revision.
            </p>
          </section>

          <Notice kind="info" title="Costs are revised, never overwritten.">
            There is no field here for a new cost on purpose. A layer&rsquo;s unit cost comes from
            the receipt that opened it — correct the receipt, then revise from its date, and the
            change is carried through every issue that drew on the layer with a full before-and-after
            record.{' '}
            <Link to="/valuation/revisions" className="font-semibold text-primary hover:underline">
              See existing revisions
            </Link>
            .
          </Notice>

          {preview ? (
            <section className="border-t border-gray-100 pt-3.5">
              <h3 className="mb-2 text-[12px] font-semibold text-gray-900">Previewed impact</h3>
              <RecalcResult job={preview} />
              <p className="mt-2 text-[11px] text-gray-500">
                Nothing has been published. &ldquo;Create revision&rdquo; runs the same
                recalculation for real.
              </p>
            </section>
          ) : (
            <p className="text-[11px] text-gray-500">
              Preview the impact before creating the revision — the button below stays disabled
              until you have seen what would change.
            </p>
          )}

          <p className="text-[10.5px] leading-relaxed text-gray-400">
            The job records the requester and the timestamp. A free-text reason and a supporting
            reference are not yet stored against a revision; put them in the source
            document&rsquo;s narration so they stay with the audit trail.
          </p>
        </div>
      )}
    </Drawer>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] font-medium uppercase tracking-wide text-gray-400">{label}</dt>
      <dd className="mt-0.5 truncate text-[12.5px] tabular-nums text-gray-900">{children}</dd>
    </div>
  )
}

export default ValuationRevisionDrawer
