import { Link } from 'react-router-dom'
import { Badge } from '../../../ui/Badge'
import { Button } from '../../../ui/Button'
import { Drawer } from '../../../ui/Drawer'
import { cx } from '../../../ui/cx'
import { formatQty } from '../../../utils/format'
import type { BomHeader, BomLineKind } from '../../bom'

const KIND_TONE: Record<string, 'neutral' | 'info' | 'warning'> = {
  component: 'neutral',
  by_product: 'info',
  scrap: 'warning',
}

const KIND_LABEL: Record<string, string> = {
  component: 'Component',
  by_product: 'By-product',
  scrap: 'Scrap',
}

export interface BomDetailDrawerProps {
  open: boolean
  bom: BomHeader | null
  onClose: () => void
}

const TH = 'border-b border-gray-200 px-2 py-2 text-left text-[11px] font-bold uppercase tracking-wide text-gray-500'
const TD = 'border-b border-gray-100 px-2 py-2 align-middle text-gray-700'

/**
 * The bill of materials as the master holds it — read-only, beside the run rather than instead
 * of it.
 *
 * Only what `GET /v1/bill-of-materials/{id}` actually returns is shown. The master carries no
 * revision number, effective date or routing, so none is printed: a version label this screen
 * invented would be quoted back in a quality audit.
 */
export function BomDetailDrawer({ open, bom, onClose }: BomDetailDrawerProps) {
  const components = (bom?.lines ?? []).filter((l) => (l.line_kind ?? 'component') === 'component')
  const others = (bom?.lines ?? []).filter((l) => (l.line_kind ?? 'component') !== 'component')
  const scrapLines = others.filter((l) => l.line_kind === 'scrap')

  return (
    <Drawer
      open={open}
      onClose={onClose}
      width="lg"
      title={bom ? bom.bom_name : 'Bill of materials'}
      badge={bom ? <Badge tone={Number(bom.is_active) === 1 ? 'success' : 'neutral'} size="xs">{Number(bom.is_active) === 1 ? 'Active' : 'Inactive'}</Badge> : null}
      description={bom ? `Produces ${formatQty(bom.yield_qty)} ${bom.yield_unit_symbol ?? ''} of ${bom.finished_item_name ?? `item #${bom.finished_item_id}`}`.replace(/\s+/g, ' ') : undefined}
      footer={
        bom ? (
          <div className="flex items-center justify-between gap-3">
            <Link to={`/masters/bill-of-materials/${bom.bom_id}`} className="text-xs font-semibold text-primary hover:underline">
              Open in BOM master →
            </Link>
            <Button variant="secondary" size="sm" onClick={onClose}>
              Close
            </Button>
          </div>
        ) : null
      }
    >
      {!bom ? (
        <p className="text-sm text-gray-500">No bill of materials is selected.</p>
      ) : (
        <div className="space-y-5">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
            {[
              ['Finished item', bom.finished_item_name ?? `#${bom.finished_item_id}`],
              ['Finished SKU', bom.finished_item_sku ?? '—'],
              ['Base output', `${formatQty(bom.yield_qty)} ${bom.yield_unit_symbol ?? ''}`.trim()],
              ['Component lines', String(components.length)],
              ['By-product lines', String(others.filter((l) => l.line_kind === 'by_product').length)],
              ['Scrap lines', String(scrapLines.length)],
            ].map(([label, value]) => (
              <div key={label} className="min-w-0">
                <dt className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">{label}</dt>
                <dd className="mt-0.5 truncate text-sm text-gray-900">{value}</dd>
              </div>
            ))}
          </dl>

          <div>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Lines</h3>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-xs">
                <thead>
                  <tr>
                    <th scope="col" className={TH}>Item</th>
                    <th scope="col" className={TH}>Kind</th>
                    <th scope="col" className={cx(TH, 'text-right')}>Qty per output</th>
                    <th scope="col" className={TH}>Unit</th>
                    <th scope="col" className={cx(TH, 'text-right')}>Scrap %</th>
                  </tr>
                </thead>
                <tbody>
                  {bom.lines.map((line, i) => {
                    const kind = (line.line_kind ?? 'component') as BomLineKind
                    return (
                      <tr key={line.bom_line_id ?? `${line.item_id}-${i}`}>
                        <td className={cx(TD, 'font-medium text-gray-900')}>{line.item_name ?? `Item #${line.item_id}`}</td>
                        <td className={TD}>
                          <Badge tone={KIND_TONE[kind] ?? 'neutral'} size="xs">
                            {KIND_LABEL[kind] ?? kind}
                          </Badge>
                        </td>
                        <td className={cx(TD, 'text-right tabular-nums')}>{formatQty(line.qty)}</td>
                        <td className={cx(TD, 'text-gray-500')}>{line.unit_symbol ?? '—'}</td>
                        <td className={cx(TD, 'text-right tabular-nums')}>{formatQty(line.scrap_percent ?? 0)}</td>
                      </tr>
                    )
                  })}
                  <tr className="bg-emerald-50/50">
                    <td className={cx(TD, 'font-bold text-gray-900')}>{bom.finished_item_name ?? `Item #${bom.finished_item_id}`}</td>
                    <td className={TD}>
                      <Badge tone="success" size="xs">Finished</Badge>
                    </td>
                    <td className={cx(TD, 'text-right tabular-nums')}>{formatQty(bom.yield_qty)}</td>
                    <td className={cx(TD, 'text-gray-500')}>{bom.yield_unit_symbol ?? '—'}</td>
                    <td className={TD} />
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <p className="rounded-lg bg-gray-50 px-3 py-2.5 text-[11px] leading-relaxed text-gray-600">
            Consumption is the line quantity scaled by run quantity ÷ base output, uplifted by the scrap percentage.
            Scrap lines are informational and move no stock. The server runs the same arithmetic when the document is
            exploded and again when it posts.
          </p>
        </div>
      )}
    </Drawer>
  )
}

export default BomDetailDrawer
