import { BarChart3, Boxes, Radar, Scale } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { cx } from '../../ui/cx'

interface Insight {
  icon: LucideIcon
  title: string
  body: string
  wrap: string
  tile: string
  iconCls: string
}

/**
 * What posting this document actually does. Four statements of fact about the type, not
 * figures — anything numeric on this screen is read from an endpoint instead.
 */
const INSIGHTS: Insight[] = [
  {
    icon: Boxes,
    title: 'Stock impact',
    body: 'Material leaves the warehouse but stays yours, held against the job worker.',
    wrap: 'bg-emerald-50 border-emerald-200',
    tile: 'bg-emerald-100',
    iconCls: 'text-emerald-700',
  },
  {
    icon: Radar,
    title: 'Live tracking',
    body: 'Each line opens a pending quantity you can watch until it comes back.',
    wrap: 'bg-sky-50 border-sky-200',
    tile: 'bg-sky-100',
    iconCls: 'text-sky-700',
  },
  {
    icon: Scale,
    title: 'Easy reconciliation',
    body: 'A job work inward settles these quantities against what is consumed and returned.',
    wrap: 'bg-violet-50 border-violet-200',
    tile: 'bg-violet-100',
    iconCls: 'text-violet-700',
  },
  {
    icon: BarChart3,
    title: 'Reports',
    body: 'The job-work register and pending quantities report on this dispatch.',
    wrap: 'bg-amber-50 border-amber-200',
    tile: 'bg-amber-100',
    iconCls: 'text-amber-700',
  },
]

export function JobWorkInsightsStrip() {
  return (
    <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 xl:grid-cols-4">
      {INSIGHTS.map((insight) => {
        const Icon = insight.icon
        return (
          <div key={insight.title} className={cx('rounded-xl border p-3', insight.wrap)}>
            <div className="flex items-center gap-2">
              <span className={cx('flex h-6 w-6 shrink-0 items-center justify-center rounded-md', insight.tile)}>
                <Icon className={cx('h-3.5 w-3.5', insight.iconCls)} aria-hidden />
              </span>
              <strong className="text-xs font-semibold text-gray-900">{insight.title}</strong>
            </div>
            <p className="mt-1.5 text-[10px] leading-relaxed text-gray-600">{insight.body}</p>
          </div>
        )
      })}
    </div>
  )
}

export default JobWorkInsightsStrip
