import { useState } from 'react'
import { LayoutTemplate, ScanBarcode, Upload, Zap } from 'lucide-react'
import type { ItemSearchRow } from '../services/lookupApi'
import { Button } from '../ui/Button'
import { BarcodeScanDialog } from './BarcodeScanDialog'
import type { LineDraft } from './formModel'
import { ImportLinesDialog } from './ImportLinesDialog'
import { buildLineFromItem } from './lineImport'
import type { ResolvedImportRow } from './lineImport'
import { QuickFillDialog } from './QuickFillDialog'
import type { DocumentTypeSpec } from './registry'

export interface LineToolbarProps {
  spec: DocumentTypeSpec
  warehouseId: number | null
  onAppend: (lines: LineDraft[]) => void
  disabled?: boolean
}

type DialogKind = 'scan' | 'import' | 'quickfill' | null

/**
 * Fast line-entry actions above the table. Scan / Import / Quick Fill all go through the live
 * item search API and only ever append plain draft lines — the same shape a manual pick produces
 * — so everything downstream (validation, totals, save/post) treats them identically.
 */
export function LineToolbar({ spec, warehouseId, onAppend, disabled }: LineToolbarProps) {
  const [dialog, setDialog] = useState<DialogKind>(null)

  const appendResolved = (rows: ResolvedImportRow[]) => {
    const lines = rows.filter((r): r is ResolvedImportRow & { item: ItemSearchRow } => r.item !== null).map((r) => buildLineFromItem(spec, r.item, { warehouseId, qty: r.qty, rate: r.rate }))
    if (lines.length) onAppend(lines)
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Button size="sm" variant="secondary" icon={ScanBarcode} onClick={() => setDialog('scan')} disabled={disabled}>
        Scan Barcode
      </Button>
      <Button size="sm" variant="secondary" icon={Upload} onClick={() => setDialog('import')} disabled={disabled}>
        Import Lines
      </Button>
      <Button size="sm" variant="secondary" icon={Zap} onClick={() => setDialog('quickfill')} disabled={disabled}>
        Quick Fill
      </Button>
      <Button size="sm" variant="ghost" icon={LayoutTemplate} disabled title="Line templates aren't set up yet">
        Apply Template
      </Button>

      <BarcodeScanDialog
        open={dialog === 'scan'}
        onClose={() => setDialog(null)}
        warehouseId={warehouseId}
        disabled={disabled}
        onResolved={(row: ItemSearchRow) => onAppend([buildLineFromItem(spec, row, { warehouseId, qty: 1 })])}
      />
      <ImportLinesDialog open={dialog === 'import'} onClose={() => setDialog(null)} warehouseId={warehouseId} disabled={disabled} onImport={appendResolved} />
      <QuickFillDialog open={dialog === 'quickfill'} onClose={() => setDialog(null)} warehouseId={warehouseId} disabled={disabled} onImport={appendResolved} />
    </div>
  )
}

export default LineToolbar
