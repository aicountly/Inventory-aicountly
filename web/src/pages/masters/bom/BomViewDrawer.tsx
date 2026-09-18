import { IndianRupee, Layers, Package, Pencil, TriangleAlert } from 'lucide-react'
import type { ReactNode } from 'react'
import { useCompany } from '../../../company/CompanyContext'
import { useQuery } from '../../../hooks/useQuery'
import { ListSheetActions } from '../../../components/ListSheetActions'
import { Notice } from '../../../components/Notice'
import { Badge } from '../../../ui/Badge'
import { Button } from '../../../ui/Button'
import { Drawer } from '../../../ui/Drawer'
import { ErrorState } from '../../../ui/ErrorState'
import { LoadingState } from '../../../ui/LoadingState'
import { bomApi } from '../../../services/masters'
import type { Bom, BomLine } from '../../../services/masters'
import { formatDateTime, formatInt, formatQty, humanize } from '../../../utils/format'
import { BomStatusBadge } from './BomStatusBadge'
import { BOM_LINE_EXPORT_COLUMNS, bomSheetMetaLines } from './bomExportColumns'
import { bomCode, bomHealth, bomStatus, yieldLabel } from './bomPresentation'

/**
 * One bill of materials, read beside the list it came from.
 *
 * A drawer rather than a modal because the two answer different questions: a
 * modal interrupts, an inspector is read AGAINST the rows behind it, and
 * somebody comparing two similar bills should not have to close one to see
 * where the other sat.
 *
 * It fetches the full record — the list only carries a preview of the
 * components — and shows by-products and scrap, which the table deliberately
 * does not.
 */

function Metric({ icon, label, value }: { icon: ReactNode; label: string; value: ReactNode }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50/60 p-2.5">
      <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-gray-500">
        {icon}
        {label}
      </span>
      <strong className="mt-1 block truncate text-[13px] font-bold text-gray-900">{value}</strong>
    </div>
  )
}

function LineTable({ title, lines, emptyLabel }: { title: string; lines: BomLine[]; emptyLabel: string }) {
  if (lines.length === 0) {
    return (
      <section>
        <h3 className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-gray-400">{title}</h3>
        <p className="rounded-lg border border-dashed border-gray-200 px-3 py-3 text-[11.5px] text-gray-400">
          {emptyLabel}
        </p>
      </section>
    )
  }
  return (
    <section>
      <h3 className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-gray-400">{title}</h3>
      <div className="overflow-x-auto rounded-lg border border-gray-200">
        <table className="w-full border-collapse text-[11.5px]">
          <thead>
            <tr className="bg-gray-50 text-[9.5px] uppercase tracking-wide text-gray-500">
              <th scope="col" className="px-2.5 py-2 text-left font-bold">Item</th>
              <th scope="col" className="px-2.5 py-2 text-right font-bold">Quantity</th>
              <th scope="col" className="px-2.5 py-2 text-right font-bold">Scrap %</th>
              <th scope="col" className="px-2.5 py-2 text-right font-bold">Gross qty</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line, i) => {
              const scrap = Number(line.scrap_percent) || 0
              const gross = Number(line.qty) * (1 + scrap / 100)
              return (
                <tr key={line.bom_line_id ?? `${line.item_id}-${i}`} className="border-t border-gray-100">
                  <td className="px-2.5 py-2">
                    <span className="flex items-center gap-1.5">
                      <span className="truncate font-semibold text-gray-900">
                        {line.item_name ?? `#${line.item_id}`}
                      </span>
                      {line.item_is_active === 0 ? (
                        <Badge tone="warning" size="xs" className="shrink-0 normal-case">
                          Inactive
                        </Badge>
                      ) : null}
                    </span>
                    {line.item_sku ? <span className="block text-[10px] text-gray-400">{line.item_sku}</span> : null}
                  </td>
                  <td className="px-2.5 py-2 text-right tabular-nums">
                    {formatQty(line.qty)}
                    {line.unit_symbol ? ` ${line.unit_symbol}` : ''}
                  </td>
                  <td className="px-2.5 py-2 text-right tabular-nums text-gray-500">
                    {scrap ? `${formatQty(scrap)}%` : '—'}
                  </td>
                  <td className="px-2.5 py-2 text-right tabular-nums">{formatQty(gross)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </section>
  )
}

export interface BomViewDrawerProps {
  bomId: number | null
  /** The list row, shown while the full record is still loading. */
  fallback: Bom | null
  onClose: () => void
  onEdit: (bom: Bom) => void
  onCost: (bom: Bom) => void
  canWrite: boolean
  canViewCost: boolean
  canExport: boolean
}

export function BomViewDrawer({
  bomId,
  fallback,
  onClose,
  onEdit,
  onCost,
  canWrite,
  canViewCost,
  canExport,
}: BomViewDrawerProps) {
  const { scope } = useCompany()
  const query = useQuery<Bom | null>(
    (signal) => (bomId ? bomApi.get(bomId, signal) : Promise.resolve(null)),
    [bomId, scope?.cmp_id],
    { enabled: bomId !== null && !!scope, keepData: false, resetKey: scope?.cmp_id ?? null },
  )

  const bom = query.data ?? fallback
  const lines = query.data?.lines ?? []
  const components = lines.filter((l) => (l.line_kind ?? 'component') === 'component')
  const byProducts = lines.filter((l) => l.line_kind === 'by_product')
  const scrapLines = lines.filter((l) => l.line_kind === 'scrap')
  const health = bom ? bomHealth({ ...bom, components_preview: components.map((l) => ({
    item_id: l.item_id,
    item_name: l.item_name ?? null,
    item_sku: l.item_sku ?? null,
    qty: l.qty,
    unit_symbol: l.unit_symbol ?? null,
    scrap_percent: l.scrap_percent,
    item_is_active: l.item_is_active ?? null,
  })), component_count: components.length }) : null

  return (
    <Drawer
      open={bomId !== null}
      onClose={onClose}
      width="xl"
      title={bom?.bom_name ?? 'Bill of materials'}
      badge={bom ? <BomStatusBadge status={bomStatus(bom)} /> : null}
      description={bom ? `${bomCode(bom)} · ${formatInt(components.length || bom.component_count || 0)} components` : undefined}
      footer={
        <div className="flex flex-wrap items-center justify-end gap-2">
          {canViewCost && bom ? (
            <Button variant="secondary" icon={IndianRupee} onClick={() => onCost(bom)}>
              Cost breakdown
            </Button>
          ) : null}
          {/*
            The same four outputs every other list offers — CSV, Excel, PDF and
            the letterheaded print sheet — over THIS bill's lines. It is the
            app's own export service, so the printed BOM report carries the
            company letterhead, the registered office and the scope, and no
            second PDF stack is introduced for one screen.
          */}
          {canExport && bom && lines.length > 0 ? (
            <ListSheetActions<BomLine>
              columns={BOM_LINE_EXPORT_COLUMNS}
              rows={lines}
              filenameBase={`bom-${bomCode(bom).toLowerCase()}`}
              title={`Bill of materials — ${bom.bom_name}`}
              description="Components consumed and by-products produced per yield of the finished item."
              metaLines={bomSheetMetaLines(bom)}
              orientation="portrait"
            />
          ) : null}
          {bom ? (
            <Button icon={Pencil} onClick={() => onEdit(bom)}>
              {canWrite ? 'Edit bill' : 'Open bill'}
            </Button>
          ) : null}
        </div>
      }
    >
      {query.error ? (
        <ErrorState
          title="Could not load this bill of materials"
          description={query.error.message}
          onRetry={query.reload}
        />
      ) : !bom ? (
        <LoadingState variant="skeleton" rows={6} />
      ) : (
        <div className="space-y-4">
          {health && health.level === 'review' ? (
            <Notice kind="warning" title="This bill needs a second look">
              <ul className="ml-4 list-disc space-y-0.5">
                {health.reasons.map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
            </Notice>
          ) : null}

          <section className="flex items-start gap-3 rounded-xl border border-gray-200 bg-white p-3">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-primary-light text-primary" aria-hidden>
              <Package className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">Finished item</p>
              <p className="truncate text-sm font-bold text-gray-900">
                {bom.finished_item_name ?? `#${bom.finished_item_id}`}
              </p>
              <p className="truncate text-[11px] text-gray-500">
                {[bom.finished_item_sku, bom.finished_item_group_name].filter(Boolean).join(' · ') || '—'}
              </p>
            </div>
            {Number(bom.finished_item_is_active) === 0 ? (
              <Badge tone="warning" size="xs" className="ml-auto shrink-0 normal-case">
                <TriangleAlert className="h-3 w-3" aria-hidden />
                Item inactive
              </Badge>
            ) : null}
          </section>

          <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
            <Metric icon={<Package className="h-3 w-3" aria-hidden />} label="Yield" value={yieldLabel(bom)} />
            <Metric
              icon={<Layers className="h-3 w-3" aria-hidden />}
              label="Components"
              value={formatInt(components.length || bom.component_count || 0)}
            />
            <Metric icon={<Layers className="h-3 w-3" aria-hidden />} label="By-products" value={formatInt(byProducts.length)} />
            <Metric icon={<Layers className="h-3 w-3" aria-hidden />} label="Scrap lines" value={formatInt(scrapLines.length)} />
          </div>

          {query.loading && !query.data ? (
            <LoadingState variant="skeleton" rows={4} />
          ) : (
            <>
              <LineTable
                title="Components consumed"
                lines={components}
                emptyLabel="No component lines — this bill cannot be used for production."
              />
              {byProducts.length > 0 ? (
                <LineTable title="By-products produced" lines={byProducts} emptyLabel="" />
              ) : null}
              {scrapLines.length > 0 ? <LineTable title="Scrap" lines={scrapLines} emptyLabel="" /> : null}
            </>
          )}

          <section className="rounded-lg border border-gray-200 bg-gray-50/60 p-3">
            <h3 className="mb-2 text-[11px] font-bold uppercase tracking-wide text-gray-400">Record</h3>
            <dl className="grid gap-x-4 gap-y-1.5 text-[11.5px] sm:grid-cols-2">
              <div className="flex justify-between gap-3">
                <dt className="text-gray-500">Reference</dt>
                <dd className="font-medium text-gray-900">{bomCode(bom)}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-gray-500">Status</dt>
                <dd className="font-medium text-gray-900">{humanize(bomStatus(bom))}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-gray-500">Created</dt>
                <dd className="font-medium text-gray-900">
                  {formatDateTime(bom.created_at)}
                  {bom.created_by_name ? ` · ${bom.created_by_name}` : ''}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-gray-500">Last updated</dt>
                <dd className="font-medium text-gray-900">
                  {formatDateTime(bom.updated_at)}
                  {bom.updated_by_name ? ` · ${bom.updated_by_name}` : ''}
                </dd>
              </div>
            </dl>
          </section>
        </div>
      )}
    </Drawer>
  )
}

export default BomViewDrawer
