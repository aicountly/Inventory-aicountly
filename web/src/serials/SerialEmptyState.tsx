import { BookOpen, FilterX, Plus, ScanBarcode, Upload } from 'lucide-react'
import { Button } from '../ui/Button'
import { EmptyState } from '../ui/EmptyState'

/**
 * Two different nothings.
 *
 * "No serial numbers in this company" is a first-run screen and should explain
 * what serial tracking is for and offer the three ways to start. "No serial
 * numbers match these filters" is a dead end the reader created and should
 * offer the way out of it. Showing the first when the second is true is how a
 * filtered list convinces somebody their data is gone.
 */
export interface SerialEmptyStateProps {
  filtered: boolean
  canWrite: boolean
  onAdd: () => void
  onBulkAdd: () => void
  onScan: () => void
  onClearFilters: () => void
  onGuide: () => void
}

export function SerialEmptyState({
  filtered,
  canWrite,
  onAdd,
  onBulkAdd,
  onScan,
  onClearFilters,
  onGuide,
}: SerialEmptyStateProps) {
  if (filtered) {
    return (
      <EmptyState
        icon={FilterX}
        title="No serial numbers match these filters"
        description="Nothing here is missing — the filters above are simply narrower than the data. Clear them to see everything again."
        action={
          <Button variant="secondary" size="sm" icon={FilterX} onClick={onClearFilters}>
            Clear filters
          </Button>
        }
      />
    )
  }

  return (
    <EmptyState
      icon={ScanBarcode}
      title="No serial numbers yet"
      description="Serial tracking follows one physical unit through its whole life — received, put away, allocated, sold, returned, scrapped — and keeps its warranty and its cost with it. Register the first one, or bring a list in."
      action={
        <div className="flex flex-wrap items-center justify-center gap-2">
          {canWrite ? (
            <>
              <Button size="sm" icon={Plus} onClick={onAdd}>
                Add a serial number
              </Button>
              <Button variant="secondary" size="sm" icon={Upload} onClick={onBulkAdd}>
                Bulk import
              </Button>
              <Button variant="ghost" size="sm" icon={ScanBarcode} onClick={onScan}>
                Scan one in
              </Button>
            </>
          ) : null}
          <Button variant="ghost" size="sm" icon={BookOpen} onClick={onGuide}>
            About serial tracking
          </Button>
        </div>
      }
    />
  )
}

export default SerialEmptyState
