import { FilterX, Plus, Search, Tag, Upload } from 'lucide-react'
import { Button } from '../../../ui/Button'
import { AIC, cx } from '../../../ui/cx'

/**
 * The two empty screens, which are not the same screen.
 *
 * "This company has no brands" is an onboarding moment: the reader has arrived
 * somewhere new and needs to be told what brands are for and offered the two
 * ways to get some. "Your filters matched nothing" is a dead end: the reader
 * knows perfectly well what brands are, has 400 of them, and needs the way back
 * out. Showing the onboarding copy to the second reader — which is what one
 * shared empty state always ends up doing — reads as though the app has lost
 * their data.
 */

export interface BrandsEmptyStateProps {
  canWrite: boolean
  onCreate: () => void
  onImport: () => void
}

export function BrandsEmptyState({ canWrite, onCreate, onImport }: BrandsEmptyStateProps) {
  return (
    <div className={cx(AIC, 'flex flex-col items-center justify-center px-6 py-14 text-center')}>
      <span className="mb-4 inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-primary-light to-primary-light/40 text-primary">
        <Tag className="h-6 w-6" aria-hidden />
      </span>
      <h3 className="text-base font-semibold text-gray-900">No brands yet</h3>
      <p className="mx-auto mt-1.5 max-w-md text-sm leading-relaxed text-gray-500">
        Create your first brand to organise items, sharpen product search, and unlock brand-level
        stock and sales reporting.
      </p>
      {canWrite ? (
        <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
          <Button size="md" icon={Plus} onClick={onCreate}>
            Create brand
          </Button>
          <Button size="md" variant="secondary" icon={Upload} onClick={onImport}>
            Import brands
          </Button>
        </div>
      ) : (
        <p className="mt-4 text-xs text-gray-500">
          Your profile can view brands but not create them.
        </p>
      )}
    </div>
  )
}

export interface BrandsNoResultsProps {
  /** The search text, so the message can quote what was looked for. */
  query: string
  onClearFilters: () => void
}

export function BrandsNoResults({ query, onClearFilters }: BrandsNoResultsProps) {
  return (
    <div className={cx(AIC, 'flex flex-col items-center justify-center px-6 py-12 text-center')}>
      <span className="mb-3 inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-gray-100 text-gray-500">
        <Search className="h-5 w-5" aria-hidden />
      </span>
      <h3 className="text-sm font-semibold text-gray-900">No brands match your filters</h3>
      <p className="mx-auto mt-1 max-w-sm text-xs leading-relaxed text-gray-500">
        {query.trim()
          ? `Nothing here is called “${query.trim()}”. Try a shorter search, or clear a filter.`
          : 'Try widening the period, the status, or the item filter.'}
      </p>
      <div className="mt-4">
        <Button variant="secondary" icon={FilterX} onClick={onClearFilters}>
          Clear filters
        </Button>
      </div>
    </div>
  )
}

export default BrandsEmptyState
