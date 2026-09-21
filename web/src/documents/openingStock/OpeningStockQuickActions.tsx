import { CircleCheck, FileSpreadsheet, History, PackageSearch, Sparkles, Zap } from 'lucide-react'
import { aiAssistantApi } from '../../services/aiAssistantApi'
import { Badge } from '../../ui/Badge'
import { Button } from '../../ui/Button'
import { notify } from '../../ui/notify'
import type { CopySource } from './openingStockHelpers'

interface OpeningStockQuickActionsProps {
  onOpenImport: () => void
  onOpenCopy: (source: CopySource) => void
  onValidate: () => void
  /** Errors + warnings from the live validation report — recomputed as the draft changes. */
  issueCount: number
}

/** The full-width "popular actions" strip, with a live issue count next to Validate stock. */
export function OpeningStockQuickActions({ onOpenImport, onOpenCopy, onValidate, issueCount }: OpeningStockQuickActionsProps) {
  return (
    <div className="register-insight-wash rounded-2xl border border-primary/10 p-4">
      <div className="mb-3 flex items-center gap-2.5">
        <Zap className="h-5 w-5 text-primary" aria-hidden />
        <div>
          <h3 className="text-sm font-semibold text-gray-900">Quick actions</h3>
          <p className="text-xs text-gray-500">Popular actions to save time.</p>
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="secondary" size="sm" icon={FileSpreadsheet} onClick={onOpenImport}>
            Import from Excel/CSV
          </Button>
          <Button type="button" variant="secondary" size="sm" icon={History} onClick={() => onOpenCopy('previous_document')}>
            Copy from previous year
          </Button>
          <Button type="button" variant="secondary" size="sm" icon={PackageSearch} onClick={() => onOpenCopy('closing_stock')}>
            Fetch from closing stock
          </Button>
          <button
            type="button"
            onClick={() => notify.info(aiAssistantApi.status().message)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-violet-200 bg-white px-3 py-1.5 text-xs font-semibold text-violet-700 shadow-card transition-shadow hover:shadow-md focus:outline-none focus:ring-2 focus:ring-violet-200"
          >
            <Sparkles className="h-3.5 w-3.5" aria-hidden />
            Auto-fill rates (AI)
          </button>
        </div>
        <div className="flex items-center gap-2">
          <Button type="button" variant="secondary" size="sm" icon={CircleCheck} onClick={onValidate}>
            Validate stock
          </Button>
          <Badge tone={issueCount > 0 ? 'warning' : 'success'} dot>
            {issueCount} issue{issueCount === 1 ? '' : 's'}
          </Badge>
        </div>
      </div>
    </div>
  )
}

export default OpeningStockQuickActions
