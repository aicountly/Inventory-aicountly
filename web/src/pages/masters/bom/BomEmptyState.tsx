import { Boxes, Plus, SearchX, Sparkles, Upload } from 'lucide-react'
import { Button } from '../../../ui/Button'
import { AIC, cx } from '../../../ui/cx'
import { BOM_TEMPLATES } from '../../../services/bomAiService'
import type { BomTemplate } from '../../../services/bomAiService'

/**
 * Nothing in the table — and the two reasons for that are not the same state.
 *
 * A company with no bills of materials needs to be told how to make one. A
 * reader whose filters happen to match nothing needs their filters cleared, and
 * showing them "Create your first BOM" over a company that has 200 of them is
 * simply wrong. `filtered` picks between the two.
 */

export interface BomEmptyStateProps {
  /** True when filters or a search term are narrowing a non-empty company. */
  filtered: boolean
  onCreate: () => void
  onImport: () => void
  onCreateWithAi: () => void
  onClearFilters: () => void
  onTemplate: (template: BomTemplate) => void
  canWrite: boolean
  canImport: boolean
}

export function BomEmptyState({
  filtered,
  onCreate,
  onImport,
  onCreateWithAi,
  onClearFilters,
  onTemplate,
  canWrite,
  canImport,
}: BomEmptyStateProps) {
  if (filtered) {
    return (
      <div className={cx(AIC, 'flex flex-col items-center justify-center px-6 py-16 text-center')}>
        <span className="mb-3 grid h-14 w-14 place-items-center rounded-2xl bg-gray-100 text-gray-400" aria-hidden>
          <SearchX className="h-7 w-7" />
        </span>
        <h2 className="text-base font-bold text-gray-900">No bills of materials match these filters</h2>
        <p className="mx-auto mt-1.5 max-w-md text-[13px] leading-relaxed text-gray-500">
          Nothing in this company matches what you are narrowing by. Widen the search or clear the
          filters to see the full list again.
        </p>
        <div className="mt-4">
          <Button variant="secondary" onClick={onClearFilters}>
            Clear filters
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className={cx(AIC, 'flex flex-col items-center justify-center px-6 py-14 text-center')}>
      <span className="mb-3.5 grid h-16 w-16 place-items-center rounded-2xl bg-primary-light text-primary" aria-hidden>
        <Boxes className="h-8 w-8" />
      </span>
      <h2 className="text-lg font-bold text-gray-900">No bills of materials yet</h2>
      <p className="mx-auto mt-1.5 max-w-lg text-[13px] leading-relaxed text-gray-500">
        Build your first product recipe by defining the finished item and the components it
        consumes. Production documents then explode the bill for you.
      </p>

      <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
        {canWrite ? (
          <Button size="md" icon={Plus} onClick={onCreate}>
            Create your first BOM
          </Button>
        ) : null}
        {canImport ? (
          <Button size="md" variant="secondary" icon={Upload} onClick={onImport}>
            Import BOM
          </Button>
        ) : null}
        <Button size="md" variant="secondary" icon={Sparkles} onClick={onCreateWithAi}>
          Create with AI
        </Button>
      </div>

      {canWrite ? (
        <div className="mt-8 w-full max-w-3xl">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">
            Or start from a structure
          </p>
          <ul className="mt-2.5 grid list-none gap-2 p-0 sm:grid-cols-2 lg:grid-cols-4">
            {BOM_TEMPLATES.map((template) => (
              <li key={template.key}>
                <button
                  type="button"
                  onClick={() => onTemplate(template)}
                  className="h-full w-full rounded-xl border border-gray-200 bg-white p-3 text-left transition-colors hover:border-primary/40 hover:bg-primary-light/30 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                >
                  <span className="block text-[12px] font-semibold text-gray-900">{template.title}</span>
                  <span className="mt-0.5 block text-[10.5px] leading-relaxed text-gray-500">
                    {template.description}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {/* Templates open an empty editor with the right number of rows — they
              do not carry items, because an item this company has never defined
              would be a fabricated master the moment it was saved. */}
          <p className="mt-2 text-[10.5px] text-gray-400">
            A template opens the editor with the right shape. You choose the items.
          </p>
        </div>
      ) : null}
    </div>
  )
}

export default BomEmptyState
