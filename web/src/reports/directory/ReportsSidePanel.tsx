import { ArrowRight, Check, FileCog, Lightbulb } from 'lucide-react'
import { getAppById, launchApp } from '../../services/appLauncher'
import { Button } from '../../ui/Button'
import { AIC, cx } from '../../ui/cx'

/**
 * "Need something we do not ship?"
 *
 * The button opens Aicountly Helpdesk through the launcher every other
 * cross-product jump uses, carrying the signed-in session with it. It is
 * deliberately not a form: Inventory has no endpoint that would receive a
 * report request, and a dialog that thanked someone for a message nothing
 * stored would be worse than no button at all. If Helpdesk is not in the app
 * catalogue the card does not render.
 */
export function CustomReportCard() {
  const helpdesk = getAppById('helpdesk')
  if (!helpdesk) return null

  return (
    <div
      className={cx(
        AIC,
        'rounded-xl border border-primary/15 p-4',
      )}
      style={{
        background:
          'linear-gradient(135deg, rgb(var(--color-primary) / 0.05) 0%, rgb(var(--color-primary) / 0.12) 100%)',
      }}
    >
      <div className="flex items-start gap-3">
        <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/70 text-primary">
          <FileCog className="h-4 w-4" aria-hidden />
        </span>
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-gray-900">Need a customised report?</h3>
          <p className="mt-1 text-xs leading-relaxed text-gray-600">
            Raise it with us on Helpdesk and we can build a report shaped around how your business
            reads its stock.
          </p>
        </div>
      </div>
      <Button
        variant="secondary"
        size="sm"
        iconRight={ArrowRight}
        className="mt-3"
        onClick={() => launchApp(helpdesk, { newTab: true })}
      >
        Request a report
      </Button>
    </div>
  )
}

/**
 * Three things every report on this page can actually do.
 *
 * Each line was checked against the engine before it was written: the export
 * menu really does offer CSV, Excel, PDF and a letterheaded print
 * (`export/exportActions.ts`), filters really are held in the query string
 * (`reports/ReportPage.tsx`), and Configure columns really does drive the
 * export as well as the table (`registers/columnPrefs.ts`). A tip promising
 * anything else would be the page advertising a feature a reader then goes
 * looking for.
 */
const TIPS: readonly string[] = [
  'Export any report to CSV, Excel or PDF, or print it on the company letterhead.',
  'Filters are kept in the address bar, so a report you have tuned can be bookmarked or shared.',
  'Use Configure columns to keep the columns you care about — exports and prints follow them.',
]

export function ReportsTips() {
  return (
    // `bg-sky-50` / `border-sky-200` rather than a hand-picked tint: those two
    // are the accents the dark-mode retrofit layer already remaps, and
    // theme/darkAccents.test.tsx fails the build for any wash it does not.
    <div className={cx(AIC, 'rounded-xl border border-sky-200 bg-sky-50 p-4')}>
      <h3 className="flex items-center gap-2 text-sm font-semibold text-gray-900">
        <Lightbulb className="h-4 w-4 text-sky-500" aria-hidden />
        Useful tips
      </h3>
      <ul className="mt-2.5 grid list-none gap-2 p-0">
        {TIPS.map((tip) => (
          <li key={tip} className="flex gap-2 text-xs leading-relaxed text-gray-600">
            <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />
            <span>{tip}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
