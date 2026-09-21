import { useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowRight,
  BookOpen,
  Check,
  Download,
  GitMerge,
  Info,
  Lightbulb,
  SearchCheck,
  Sparkles,
  ToggleLeft,
  TriangleAlert,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { Button } from '../../../ui/Button'
import { Spinner } from '../../../ui/Spinner'
import { Tooltip } from '../../../ui/Tooltip'
import { AIC, cx } from '../../../ui/cx'
import { formatInt } from '../../../utils/format'
import type { AiAnalysis } from '../../../services/stockCategoryAi'
import type { CategoryReview, ReviewFinding } from './categoryReview'

/**
 * The intelligence rail beside the list.
 *
 * Two different things sit here and the panel never lets them blur:
 *
 *  - **Aicountly AI** is a model's opinion. No AI endpoint is connected to
 *    Inventory yet, so pressing Analyse says exactly that. It does not show
 *    example findings, a "demo" result, or a spinner that resolves into
 *    plausible text. A suggestion to merge two categories is a proposal to
 *    change master data that every valuation report reads; a fabricated one
 *    would be indistinguishable from a real one at the moment somebody acts.
 *
 *  - **The review** underneath is arithmetic over this company's own
 *    categories — names that normalise to the same string, an alias used
 *    twice, a category no item points at. It works today, it is labelled as a
 *    check rather than as AI, and every line of it can be verified against the
 *    list three inches to the left.
 *
 * Merge is offered as neither. Reassigning every item off one category and on
 * to another, atomically and reversibly, is a backend operation Inventory does
 * not have; the row says so rather than pretending, because a half-finished
 * merge is a company's stock split across two names.
 */

function SectionTitle({ children }: { children: ReactNode }) {
  return <h2 className="mb-2 text-xs font-bold text-gray-900">{children}</h2>
}

function QuickAction({
  icon: Icon,
  label,
  hint,
  disabled,
  onClick,
  to,
}: {
  icon: LucideIcon
  label: string
  hint?: string
  disabled?: boolean
  onClick?: () => void
  to?: string
}) {
  const className = cx(
    'flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs no-underline transition-colors',
    disabled
      ? 'cursor-not-allowed text-gray-400'
      : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
  )
  const body = (
    <>
      <Icon className="h-3.5 w-3.5 shrink-0 text-gray-400" aria-hidden />
      <span className="flex-1 truncate">{label}</span>
      {disabled ? <Info className="h-3.5 w-3.5 shrink-0 text-gray-300" aria-hidden /> : null}
    </>
  )

  const control = to ? (
    <Link to={to} className={className}>
      {body}
    </Link>
  ) : (
    <button type="button" className={className} onClick={onClick} disabled={disabled} aria-describedby={undefined}>
      {body}
    </button>
  )

  return hint ? (
    <Tooltip label={hint} className="block w-full">
      {control}
    </Tooltip>
  ) : (
    control
  )
}

function FindingRow({ finding, onShow }: { finding: ReviewFinding; onShow?: (finding: ReviewFinding) => void }) {
  const warning = finding.severity === 'warning'
  return (
    <li
      className={cx(
        'rounded-lg border px-2.5 py-2',
        warning ? 'border-amber-200 bg-amber-50' : 'border-gray-200 bg-gray-50',
      )}
    >
      <div className="flex items-start gap-2">
        <TriangleAlert
          className={cx('mt-0.5 h-3.5 w-3.5 shrink-0', warning ? 'text-amber-600' : 'text-gray-400')}
          aria-hidden
        />
        <div className="min-w-0">
          <p className="text-xs font-semibold text-gray-900">{finding.title}</p>
          <p className="mt-0.5 text-[11px] leading-relaxed text-gray-600">{finding.detail}</p>
          {onShow && finding.categoryIds.length > 0 && finding.categoryIds.length <= 3 ? (
            <button
              type="button"
              onClick={() => onShow(finding)}
              className="mt-1 inline-flex items-center gap-1 rounded text-[11px] font-semibold text-primary transition-colors hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            >
              Show in the list
              <ArrowRight className="h-3 w-3" aria-hidden />
            </button>
          ) : null}
        </div>
      </div>
    </li>
  )
}

const PRO_TIPS = [
  'Keep categories simple and focused',
  'Use clear and short names',
  'Align with reporting requirements',
  'Review unused categories periodically',
] as const

export interface StockCategoryAiPanelProps {
  /** null until Analyse has been pressed. */
  analysis: AiAnalysis | null
  analysing: boolean
  analysisError: string | null
  onAnalyse: () => void

  review: CategoryReview | null
  reviewing: boolean
  reviewError: string | null
  onReview: () => void
  onShowFinding: (finding: ReviewFinding) => void

  canWrite: boolean
  /** Ticks every row on the page so the bulk bar appears. */
  onSelectPage: () => void
  onDownloadTemplate: () => void
  /** Items with no category at all — a fact from the summary endpoint. */
  uncategorisedItems: number | null
  uncategorisedItemsTo?: string
  className?: string
}

export function StockCategoryAiPanel({
  analysis,
  analysing,
  analysisError,
  onAnalyse,
  review,
  reviewing,
  reviewError,
  onReview,
  onShowFinding,
  canWrite,
  onSelectPage,
  onDownloadTemplate,
  uncategorisedItems,
  uncategorisedItemsTo,
  className,
}: StockCategoryAiPanelProps) {
  const [explainerOpen, setExplainerOpen] = useState(false)

  return (
    <aside className={cx(AIC, 'grid content-start gap-3', className)} aria-label="Aicountly AI and quick actions">
      {/* ---- Aicountly AI ---------------------------------------------- */}
      <section className="overflow-hidden rounded-xl border border-gray-200 bg-white">
        <div className="bg-violet-50 p-4">
          <div className="flex items-center gap-2">
            <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-sky-500 to-violet-600 text-[13px] font-extrabold text-white">
              A
            </span>
            <strong className="text-sm font-semibold text-violet-700">Aicountly AI</strong>
          </div>
          <p className="mt-2 text-xs leading-relaxed text-gray-500">
            Get insights, find duplicates, and keep your categories organised.
          </p>
          <Button
            variant="outline"
            size="md"
            block
            icon={Sparkles}
            className="mt-3 border-violet-200 text-violet-700 hover:bg-violet-50"
            loading={analysing}
            onClick={onAnalyse}
          >
            Analyse categories
          </Button>

          {analysisError ? (
            <p className="mt-2 rounded-lg bg-red-50 px-2.5 py-2 text-[11px] leading-relaxed text-red-700">
              {analysisError}
            </p>
          ) : analysis && analysis.connected === false ? (
            <p className="mt-2 rounded-lg bg-white/70 px-2.5 py-2 text-[11px] leading-relaxed text-gray-600">
              <strong className="font-semibold text-gray-800">
                The AI analysis service is not connected yet.
              </strong>{' '}
              Nothing was analysed, so nothing is shown. The checks below run on this company&rsquo;s own categories
              and work today.
            </p>
          ) : analysis && analysis.connected ? (
            <div className="mt-2 space-y-2">
              {analysis.summary ? (
                <p className="rounded-lg bg-white/70 px-2.5 py-2 text-[11px] leading-relaxed text-gray-600">
                  {analysis.summary}
                </p>
              ) : null}
              {analysis.findings.length === 0 ? (
                <p className="rounded-lg bg-white/70 px-2.5 py-2 text-[11px] leading-relaxed text-gray-600">
                  Nothing to flag.
                </p>
              ) : (
                <ul className="m-0 list-none space-y-1.5 p-0">
                  {analysis.findings.map((f) => (
                    <li key={f.id} className="rounded-lg border border-violet-200 bg-white px-2.5 py-2">
                      <p className="text-xs font-semibold text-gray-900">{f.title}</p>
                      {f.detail ? <p className="mt-0.5 text-[11px] leading-relaxed text-gray-600">{f.detail}</p> : null}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : null}
        </div>

        {/* ---- The deterministic review --------------------------------- */}
        <div className="border-t border-gray-200 p-4">
          <div className="mb-2 flex items-center justify-between gap-2">
            <SectionTitle>Category review</SectionTitle>
            <Button variant="ghost" size="xs" icon={SearchCheck} onClick={onReview} disabled={reviewing}>
              {review ? 'Re-run' : 'Run'}
            </Button>
          </div>

          {reviewing ? (
            <p className="flex items-center gap-2 text-[11px] text-gray-500">
              <Spinner size="sm" /> Checking every category…
            </p>
          ) : reviewError ? (
            <p className="text-[11px] leading-relaxed text-red-600">{reviewError}</p>
          ) : !review ? (
            <p className="text-[11px] leading-relaxed text-gray-500">
              Checks this company&rsquo;s categories for duplicate names, clashing aliases and categories nothing
              uses. Computed here from the category list — no AI, and no guesses.
            </p>
          ) : review.findings.length === 0 ? (
            <p className="flex items-start gap-2 text-[11px] leading-relaxed text-primary">
              <Check className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
              Nothing to fix across {formatInt(review.examined)}{' '}
              {review.examined === 1 ? 'category' : 'categories'}.
            </p>
          ) : (
            <>
              <ul className="m-0 list-none space-y-1.5 p-0">
                {review.findings.map((f) => (
                  <FindingRow key={f.id} finding={f} onShow={onShowFinding} />
                ))}
              </ul>
              <p className="mt-2 text-[11px] text-gray-400">
                {formatInt(review.examined)} {review.examined === 1 ? 'category' : 'categories'} checked.
              </p>
            </>
          )}

          {uncategorisedItems !== null && uncategorisedItems > 0 ? (
            <p className="mt-2 rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-2 text-[11px] leading-relaxed text-gray-600">
              {formatInt(uncategorisedItems)} {uncategorisedItems === 1 ? 'item has' : 'items have'} no stock category.{' '}
              {uncategorisedItemsTo ? (
                <Link to={uncategorisedItemsTo} className="font-semibold text-primary">
                  Open items
                </Link>
              ) : null}
            </p>
          ) : null}
        </div>
      </section>

      {/* ---- Quick actions ---------------------------------------------- */}
      <section className="rounded-xl border border-gray-200 bg-white p-4">
        <SectionTitle>Quick actions</SectionTitle>
        <div className="-mx-2 space-y-0.5">
          <QuickAction
            icon={GitMerge}
            label="Merge categories"
            disabled
            hint="Merging has to reassign every item off one category and on to another in one transaction, with an audit entry and a way back. The Inventory API has no such operation yet, so this stays switched off rather than doing half of it."
          />
          <QuickAction icon={SearchCheck} label="Find duplicate names" onClick={onReview} />
          <QuickAction
            icon={ToggleLeft}
            label="Bulk update status"
            onClick={onSelectPage}
            disabled={!canWrite}
            hint={canWrite ? 'Selects every category on this page so you can activate or deactivate them together.' : 'Your profile cannot change stock categories.'}
          />
          <QuickAction icon={Download} label="Download template" onClick={onDownloadTemplate} />
          <QuickAction
            icon={BookOpen}
            label="Learn about stock categories"
            onClick={() => setExplainerOpen((v) => !v)}
          />
        </div>

        {explainerOpen ? (
          <div className="mt-2 rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-2 text-[11px] leading-relaxed text-gray-600">
            <p className="m-0">
              A stock category is one of the three ways an item is classified, beside its item group and its brand.
              It does not affect valuation or stock movement — it is how stock is grouped in reports, filtered on the
              Items screen, and read by Books when it asks Inventory what an item is.
            </p>
            <p className="mb-0 mt-1.5">
              A category stays deletable only while no item points at it; deactivate one instead to retire it without
              disturbing the items that already carry it.
            </p>
          </div>
        ) : null}
      </section>

      {/* ---- Pro tips ---------------------------------------------------- */}
      <section className="rounded-xl border border-primary/20 bg-primary-light/40 p-4">
        <div className="mb-2 flex items-center gap-2">
          <Lightbulb className="h-3.5 w-3.5 text-primary" aria-hidden />
          <h2 className="text-xs font-bold text-gray-900">Pro tips</h2>
        </div>
        <ul className="m-0 list-none space-y-1.5 p-0">
          {PRO_TIPS.map((tip) => (
            <li key={tip} className="flex items-start gap-2 text-[11px] leading-relaxed text-gray-600">
              <Check className="mt-0.5 h-3 w-3 shrink-0 text-primary" aria-hidden />
              {tip}
            </li>
          ))}
        </ul>
      </section>
    </aside>
  )
}

export default StockCategoryAiPanel
