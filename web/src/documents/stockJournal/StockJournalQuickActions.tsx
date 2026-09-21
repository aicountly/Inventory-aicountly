import { ScanBarcode, Search, Upload } from 'lucide-react'
import { Card } from '../../ui/Card'
import { AIC, cx } from '../../ui/cx'

interface StockJournalQuickActionsProps {
  onScanBarcode: () => void
  onUploadExcel: () => void
  onOpenItemFinder: () => void
  disabled?: boolean
}

const TILE =
  'flex min-h-[4.5rem] flex-col items-center justify-center gap-1.5 rounded-xl border border-gray-200 bg-white px-1.5 py-2 text-[11px] font-medium text-gray-700 transition-colors hover:border-primary/40 hover:bg-primary-light hover:text-primary focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:cursor-not-allowed disabled:opacity-60'

/** The three ways into the grid that are not typing: scan, paste, browse. */
export function StockJournalQuickActions({ onScanBarcode, onUploadExcel, onOpenItemFinder, disabled }: StockJournalQuickActionsProps) {
  const actions = [
    { key: 'scan', label: 'Scan Barcode', icon: ScanBarcode, onClick: onScanBarcode },
    { key: 'excel', label: 'Upload Excel', icon: Upload, onClick: onUploadExcel },
    { key: 'finder', label: 'Open Item Finder', icon: Search, onClick: onOpenItemFinder },
  ]
  return (
    <Card padding="sm">
      <h3 className="mb-2 text-[13px] font-semibold text-gray-900">Quick Actions</h3>
      <div className={cx(AIC, 'grid grid-cols-3 gap-1.5')}>
        {actions.map(({ key, label, icon: Icon, onClick }) => (
          <button key={key} type="button" className={cx(AIC, TILE)} disabled={disabled} onClick={onClick}>
            <Icon className="h-5 w-5 text-primary" aria-hidden />
            <span className="text-center leading-tight">{label}</span>
          </button>
        ))}
      </div>
    </Card>
  )
}
