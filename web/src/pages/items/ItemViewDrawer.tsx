import { Eye } from 'lucide-react'
import type { ReactNode } from 'react'
import type { Item } from '../../services/items'
import { Badge } from '../../ui/Badge'
import { Button } from '../../ui/Button'
import { Drawer } from '../../ui/Drawer'
import { Notice } from '../../components/Notice'
import { AIC, cx } from '../../ui/cx'
import { formatDateTime, formatMoney, formatQty, humanize } from '../../utils/format'

/**
 * The item as it is stored, read-only, beside the form that is editing it.
 *
 * Inventory has no separate read-only item route — `/items/:id` IS the editor — so "View Item"
 * cannot be a link somewhere. Rather than drop the affordance or point it at a screen that is not
 * the item, it opens the saved record next to the draft.
 *
 * That makes it useful in a way a navigation would not be: with unsaved edits on the page, this is
 * what the item still *is*, so a reader can see exactly what they are about to change. It says so
 * when the two differ, and nothing is lost by opening it — which is why it does not go through the
 * unsaved-changes dialog the way leaving the page does.
 */
export interface ItemViewDrawerProps {
  open: boolean
  onClose: () => void
  item: Item | null
  dirty: boolean
  unitLabel: (unitId: number | null) => string
  currencySymbol: string | null
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[9rem_minmax(0,1fr)] gap-3 border-b border-gray-100 py-1.5 last:border-0">
      <dt className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">{label}</dt>
      <dd className="min-w-0 break-words text-xs text-gray-900">{children}</dd>
    </div>
  )
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-gray-200 p-3">
      <h4 className="mb-1.5 text-xs font-bold text-gray-900">{title}</h4>
      <dl>{children}</dl>
    </section>
  )
}

export function ItemViewDrawer({ open, onClose, item, dirty, unitLabel, currencySymbol }: ItemViewDrawerProps) {
  const dash = (v: unknown) => (v === null || v === undefined || v === '' ? '—' : String(v))
  const flags = item
    ? [
        Number(item.track_batch) === 1 ? 'Batches' : null,
        Number(item.track_serial) === 1 ? 'Serials' : null,
        Number(item.track_expiry) === 1 ? 'Expiry' : null,
      ].filter(Boolean)
    : []

  return (
    <Drawer
      open={open}
      onClose={onClose}
      width="lg"
      title={
        <span className="inline-flex items-center gap-2">
          <Eye className="h-4 w-4 text-gray-400" aria-hidden />
          {item?.item_name ?? 'Item'}
        </span>
      }
      badge={item ? <Badge tone={Number(item.is_active) === 1 ? 'success' : 'neutral'}>{Number(item.is_active) === 1 ? 'Active' : 'Inactive'}</Badge> : null}
      description="The item as it is saved right now."
      footer={
        <Button variant="secondary" onClick={onClose}>
          Close
        </Button>
      }
    >
      {!item ? (
        <p className="text-sm text-gray-500">This item has not been saved yet.</p>
      ) : (
        <div className={cx(AIC, 'space-y-3')}>
          {dirty ? (
            <Notice kind="info">
              You have unsaved changes on the form. This panel shows the saved item, not your draft.
            </Notice>
          ) : null}

          <Group title="Identity">
            <Row label="Item">{item.item_name}</Row>
            <Row label="Alias">{dash(item.item_alias)}</Row>
            <Row label="Print name">{dash(item.print_name)}</Row>
            <Row label="Type">{humanize(item.item_type)}</Row>
            <Row label="SKU">{dash(item.item_sku)}</Row>
            <Row label="Barcode">{dash(item.item_upc)}</Row>
            <Row label="HSN / SAC">{dash(item.hsn_sac)}</Row>
            <Row label="MRP">{item.mrp === null ? '—' : `${currencySymbol ? `${currencySymbol} ` : ''}${formatMoney(item.mrp)}`}</Row>
          </Group>

          <Group title="Classification">
            <Row label="Item group">{dash(item.grp_name)}</Row>
            <Row label="Stock category">{dash(item.cat_name)}</Row>
            <Row label="Brand">{dash(item.brand_name)}</Row>
          </Group>

          <Group title="Units">
            <Row label="Base unit">{unitLabel(item.unit_id)}</Row>
            <Row label="Purchase unit">{item.purchase_unit_id ? unitLabel(item.purchase_unit_id) : 'Base unit'}</Row>
            <Row label="Sales unit">{item.sales_unit_id ? unitLabel(item.sales_unit_id) : 'Base unit'}</Row>
            <Row label="Alternate units">
              {(item.unit_lines ?? []).filter((l) => Number(l.is_default) !== 1).length === 0
                ? 'None'
                : (item.unit_lines ?? [])
                    .filter((l) => Number(l.is_default) !== 1)
                    .map((l) => `1 ${unitLabel(l.unit_id)} = ${l.conversion_factor}`)
                    .join(' · ')}
            </Row>
          </Group>

          <Group title="Valuation and stock">
            <Row label="Valuation method">{item.valuation_method}</Row>
            <Row label="Standard cost">
              {item.standard_cost === null ? '—' : `${currencySymbol ? `${currencySymbol} ` : ''}${formatMoney(item.standard_cost)}`}
            </Row>
            <Row label="Tracking">{flags.length ? flags.join(', ') : 'None'}</Row>
            <Row label="Negative stock">{item.negative_stock_policy ? humanize(item.negative_stock_policy) : 'Company policy'}</Row>
            <Row label="On hand">{item.stock ? formatQty(item.stock.on_hand) : '—'}</Row>
            <Row label="Reorder point">{formatQty(item.reorder_point_qty)}</Row>
          </Group>

          <Group title="Accounting">
            <Row label="Input tax credit">{humanize(String(item.itc_eligibility))}</Row>
            <Row label="Sales ledger">{item.books_sales_acc_id ? `Books reference #${item.books_sales_acc_id}` : 'Not mapped'}</Row>
            <Row label="Purchase ledger">
              {item.books_purchase_acc_id ? `Books reference #${item.books_purchase_acc_id}` : 'Not mapped'}
            </Row>
            <Row label="Tax category">{item.books_tax_cat_id ? `Books reference #${item.books_tax_cat_id}` : 'Not mapped'}</Row>
          </Group>

          <Group title="Record">
            <Row label="Item id">#{item.item_id}</Row>
            <Row label="Created">{formatDateTime(item.created_at)}</Row>
            <Row label="Last updated">{formatDateTime(item.updated_at)}</Row>
          </Group>
        </div>
      )}
    </Drawer>
  )
}

export default ItemViewDrawer
