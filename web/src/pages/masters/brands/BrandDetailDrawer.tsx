import { Link } from 'react-router-dom'
import { ArrowRight, History, Package, Pencil } from 'lucide-react'
import { Button } from '../../../ui/Button'
import { Drawer } from '../../../ui/Drawer'
import { StatusBadge } from '../../../ui/StatusBadge'
import { EmptyState } from '../../../ui/EmptyState'
import { SkeletonRows } from '../../../ui/Skeleton'
import { useQuery } from '../../../hooks/useQuery'
import { auditApi } from '../../../services/auditApi'
import { formatDateTime, formatInt, formatMoney, humanize } from '../../../utils/format'
import { actorIdentity, splitAction } from '../../audit/auditPresentation'
import type { Brand } from '../../../services/masters'
import type { BrandSalesRow } from '../../../services/brandAnalyticsApi'
import { BrandAvatar } from './BrandAvatar'
import { brandHealth } from './brandIdentity'

/**
 * A brand read beside the list it came from.
 *
 * Only facts with a source. Every figure in here is either a column of the
 * brand row, a count the API returned with it, or a live answer from Books —
 * there is no derived "brand score", no projection and no ranking invented in
 * the browser, because none of those could be explained to the person reading
 * them.
 *
 * The audit trail is the existing one (`/v1/audit-log/entity/brand/{id}`), not
 * a second history kept for this screen. It is requested only when the drawer
 * is open and only when the profile may read it: asking and hiding a 403 would
 * cost a round trip to learn something `can()` already knew.
 */

const HEALTH_COPY: Record<ReturnType<typeof brandHealth>, { label: string; tone: 'success' | 'warning' | 'neutral'; note: string }> = {
  active: { label: 'In use', tone: 'success', note: 'Active, with items filed under it.' },
  unused: { label: 'No items', tone: 'warning', note: 'Active, but nothing is filed under it yet.' },
  inactive: { label: 'Inactive', tone: 'neutral', note: 'Hidden from pickers; existing records keep it.' },
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">{label}</dt>
      <dd className="mt-0.5 break-words text-sm text-gray-800">{children}</dd>
    </div>
  )
}

export interface BrandDetailDrawerProps {
  open: boolean
  brand: Brand | null
  sale: BrandSalesRow | null
  salesCurrencySymbol: string
  salesConnected: boolean
  canWrite: boolean
  canAudit: boolean
  onClose: () => void
  onEdit: (brand: Brand) => void
}

export function BrandDetailDrawer({
  open,
  brand,
  sale,
  salesCurrencySymbol,
  salesConnected,
  canWrite,
  canAudit,
  onClose,
  onEdit,
}: BrandDetailDrawerProps) {
  const brandId = brand?.brand_id ?? null

  const audit = useQuery(
    (signal) => auditApi.entity('brand', brandId as number, { limit: 8, sort: 'created_at', order: 'desc' }, signal),
    [brandId],
    { enabled: open && canAudit && brandId !== null, keepData: false },
  )

  if (!brand) return null

  const health = HEALTH_COPY[brandHealth(brand)]
  const itemCount = brand.item_count ?? 0
  const createdBy = actorIdentity({ actor_uuid: brand.created_by ?? null })
  const updatedBy = actorIdentity({ actor_uuid: brand.updated_by ?? null })

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={brand.brand_name}
      badge={<StatusBadge value={Number(brand.is_active) === 1 ? 'active' : 'inactive'} dot />}
      description={brand.brand_alias || brand.brand_code || undefined}
      width="md"
      footer={
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
          {itemCount > 0 ? (
            <Link
              to={`/items?brand_id=${brand.brand_id}`}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 text-sm font-medium text-gray-700 no-underline transition-colors hover:border-primary/40 hover:bg-primary-light hover:text-primary"
            >
              <Package className="h-4 w-4" aria-hidden />
              View items
            </Link>
          ) : null}
          {canWrite ? (
            <Button icon={Pencil} onClick={() => onEdit(brand)}>
              Edit brand
            </Button>
          ) : null}
        </div>
      }
    >
      <div className="space-y-5">
        <div className="flex items-start gap-3">
          <BrandAvatar name={brand.brand_name} size="lg" />
          <div className="min-w-0 flex-1">
            <p className="text-base font-semibold text-gray-900">{brand.brand_name}</p>
            <p className="mt-0.5 text-xs text-gray-500">{health.note}</p>
          </div>
          <StatusBadge
            value={health.label}
            tone={health.tone === 'success' ? 'good' : health.tone === 'warning' ? 'warning' : 'neutral'}
            label={health.label}
          />
        </div>

        {brand.description ? (
          <p className="rounded-lg bg-gray-50 px-3 py-2 text-sm leading-relaxed text-gray-700">
            {brand.description}
          </p>
        ) : null}

        <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
          <Fact label="Alias">{brand.brand_alias || <span className="text-gray-400">Not set</span>}</Fact>
          <Fact label="Brand code">
            {brand.brand_code ? (
              <span className="font-mono text-xs uppercase">{brand.brand_code}</span>
            ) : (
              <span className="text-gray-400">Not set</span>
            )}
          </Fact>
          <Fact label="Items">
            {itemCount > 0 ? (
              <Link to={`/items?brand_id=${brand.brand_id}`} className="font-semibold text-primary no-underline hover:underline">
                {formatInt(itemCount)} {itemCount === 1 ? 'item' : 'items'}
              </Link>
            ) : (
              <span className="text-gray-400">None yet</span>
            )}
          </Fact>
          <Fact label="Sales (FY)">
            {sale ? (
              <span className="font-semibold tabular-nums">
                {salesCurrencySymbol} {formatMoney(sale.sales)}
              </span>
            ) : salesConnected ? (
              <span className="text-gray-400">Nothing reported this year</span>
            ) : (
              <span className="text-gray-400" title="Revenue comes from Sales over a live API">
                Not connected
              </span>
            )}
          </Fact>
          <Fact label="Created">
            <span className="block">{formatDateTime(brand.created_at)}</span>
            <span className="block text-[11px] text-gray-500" title={createdBy.title}>
              by {createdBy.label}
            </span>
          </Fact>
          <Fact label="Last updated">
            <span className="block">{formatDateTime(brand.updated_at)}</span>
            <span className="block text-[11px] text-gray-500" title={updatedBy.title}>
              by {updatedBy.label}
            </span>
          </Fact>
        </dl>

        <section aria-labelledby="brand-audit-heading">
          <div className="mb-2 flex items-center justify-between gap-2">
            <h3 id="brand-audit-heading" className="flex items-center gap-1.5 text-sm font-semibold text-gray-900">
              <History className="h-4 w-4 text-gray-400" aria-hidden />
              Audit trail
            </h3>
            {canAudit ? (
              <Link
                to={`/audit?entity_type=brand&entity_id=${brand.brand_id}`}
                className="inline-flex items-center gap-1 text-xs font-semibold text-primary no-underline hover:underline"
              >
                View all
                <ArrowRight className="h-3.5 w-3.5" aria-hidden />
              </Link>
            ) : null}
          </div>

          {!canAudit ? (
            <p className="text-xs leading-relaxed text-gray-500">
              Your profile cannot read the audit trail, so this brand&rsquo;s history is not shown.
            </p>
          ) : audit.loading ? (
            <SkeletonRows rows={3} />
          ) : audit.error ? (
            <p className="text-xs text-gray-500">The audit trail could not be loaded just now.</p>
          ) : (audit.data?.data.length ?? 0) === 0 ? (
            <EmptyState
              compact
              icon={History}
              title="No recorded changes"
              description="Edits to this brand will be listed here."
            />
          ) : (
            <ol className="space-y-2">
              {audit.data?.data.map((entry) => {
                const actor = actorIdentity({ actor_uuid: entry.actor_uuid })
                return (
                  <li key={entry.audit_id} className="flex items-start gap-2.5 border-l-2 border-gray-100 pl-3">
                    <span className="min-w-0 flex-1">
                      <span className="block text-xs font-semibold text-gray-900">
                        {/* `brand.update` reads as "Update" here: the entity is
                            the drawer's own heading, so repeating it in every
                            row would say "Brand" eight times. */}
                        {humanize(splitAction(entry.action).verb || entry.action)}
                      </span>
                      <span className="block text-[11px] text-gray-500" title={actor.title}>
                        {actor.label} · {formatDateTime(entry.created_at)}
                      </span>
                    </span>
                  </li>
                )
              })}
            </ol>
          )}
        </section>
      </div>
    </Drawer>
  )
}

export default BrandDetailDrawer
