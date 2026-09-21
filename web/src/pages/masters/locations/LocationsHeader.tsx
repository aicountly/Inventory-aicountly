import { ArrowRight, MapPin, Sparkles, Warehouse } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Link } from 'react-router-dom'
import { AIC, cx } from '../../../ui/cx'

/**
 * The screen's masthead: where you are, what these rows are, and the two
 * things you can do with the set as a whole.
 *
 * The feature cards are the page's own entry points rather than navigation —
 * both open a panel over this screen — so they are buttons, not links, and
 * they say what they will show rather than naming a destination.
 */

interface FeatureCardProps {
  icon: LucideIcon
  title: string
  description: string
  tone: 'info' | 'violet'
  onClick: () => void
  disabled?: boolean
}

const TONE: Record<FeatureCardProps['tone'], { card: string; tile: string }> = {
  info: {
    card: 'border-sky-100 bg-sky-50/60',
    tile: 'bg-white text-sky-600',
  },
  violet: {
    card: 'border-violet-200 bg-violet-50',
    tile: 'bg-white text-violet-600',
  },
}

function FeatureCard({ icon: Icon, title, description, tone, onClick, disabled }: FeatureCardProps) {
  const styles = TONE[tone]
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cx(
        AIC,
        'group flex min-h-[66px] w-full items-center gap-3 rounded-xl border px-3.5 py-3 text-left',
        'transition-[transform,box-shadow,border-color] duration-200 hover:-translate-y-px hover:shadow-card',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
        'disabled:pointer-events-none disabled:opacity-60',
        styles.card,
      )}
    >
      <span className={cx('grid h-10 w-10 shrink-0 place-items-center rounded-xl', styles.tile)} aria-hidden>
        <Icon className="h-5 w-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-semibold text-gray-900">{title}</span>
        <span className="mt-0.5 block truncate text-[11px] text-gray-500">{description}</span>
      </span>
      <ArrowRight
        className="h-4 w-4 shrink-0 text-gray-300 transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-gray-400"
        aria-hidden
      />
    </button>
  )
}

export interface LocationsHeaderProps {
  onOpenCoverage: () => void
  onOpenInsights: () => void
  /** Both panels read the loaded set; they stay inert until it is there. */
  disabled?: boolean
}

export function LocationsHeader({ onOpenCoverage, onOpenInsights, disabled }: LocationsHeaderProps) {
  return (
    <header className={cx(AIC, 'mb-5 flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between')}>
      <div className="flex items-center gap-3.5">
        <span
          className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-primary/20 to-primary/5 text-primary"
          aria-hidden
        >
          <MapPin className="h-7 w-7" />
        </span>
        <div className="min-w-0">
          <nav aria-label="Breadcrumb" className="mb-0.5 flex items-center gap-1.5 text-xs text-gray-500">
            <Link to="/masters" className="no-underline hover:text-primary">
              Masters
            </Link>
            <span aria-hidden>›</span>
            <span className="font-semibold text-gray-700" aria-current="page">
              Locations
            </span>
          </nav>
          <h1 className="m-0 text-[26px] font-bold leading-tight tracking-[-0.025em] text-gray-900">Locations</h1>
          <p className="mt-1 max-w-xl text-[13px] leading-relaxed text-gray-500">
            Zones, racks, shelves and bins inside your warehouses — the addresses stock is counted and picked from.
          </p>
        </div>
      </div>

      <div className="grid shrink-0 grid-cols-1 gap-3 sm:grid-cols-2 lg:w-[min(34rem,48vw)]">
        <FeatureCard
          icon={Warehouse}
          title="Coverage"
          description="Locations per warehouse"
          tone="info"
          onClick={onOpenCoverage}
          disabled={disabled}
        />
        <FeatureCard
          icon={Sparkles}
          title="Smart insights"
          description="Tidy up your setup"
          tone="violet"
          onClick={onOpenInsights}
          disabled={disabled}
        />
      </div>
    </header>
  )
}

export default LocationsHeader
