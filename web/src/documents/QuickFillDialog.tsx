import { useState } from 'react'
import { AlertTriangle, CheckCircle2, Zap } from 'lucide-react'
import { Modal } from '../components/Modal'
import { Button } from '../ui/Button'
import { cx } from '../ui/cx'
import { formatQty } from '../utils/format'
import { parseLinesInput, resolveImportRows } from './lineImport'
import type { ResolvedImportRow } from './lineImport'

export interface QuickFillDialogProps {
  open: boolean
  onClose: () => void
  warehouseId: number | null
  onImport: (rows: ResolvedImportRow[]) => void
  disabled?: boolean
}

/**
 * The fast path: paste "item, qty[, rate]" pairs (or just item names/SKUs, one per line) and add
 * them all at once. Stays local until "Add lines" — nothing is appended while the user is still
 * typing.
 */
export function QuickFillDialog({ open, onClose, warehouseId, onImport, disabled }: QuickFillDialogProps) {
  const [text, setText] = useState('')
  const [rows, setRows] = useState<ResolvedImportRow[] | null>(null)
  const [resolving, setResolving] = useState(false)

  const close = () => {
    setText('')
    setRows(null)
    onClose()
  }

  const resolve = async () => {
    const parsed = parseLinesInput(text)
    if (parsed.length === 0) return
    setResolving(true)
    try {
      setRows(await resolveImportRows(parsed, warehouseId))
    } finally {
      setResolving(false)
    }
  }

  const okRows = rows?.filter((r) => r.status === 'ok') ?? []

  const confirm = () => {
    onImport(okRows)
    close()
  }

  return (
    <Modal
      open={open}
      title="Quick fill"
      description="Paste item + quantity pairs, one per line, to add several lines at once."
      onClose={close}
      size="md"
      busy={resolving}
      footer={
        rows === null ? (
          <>
            <Button variant="secondary" onClick={close}>
              Cancel
            </Button>
            <Button icon={Zap} onClick={() => void resolve()} loading={resolving} disabled={disabled || !text.trim()}>
              Resolve items
            </Button>
          </>
        ) : (
          <>
            <Button variant="ghost" onClick={() => setRows(null)}>
              Back
            </Button>
            <Button onClick={confirm} disabled={disabled || okRows.length === 0}>
              Add {okRows.length} line{okRows.length === 1 ? '' : 's'}
            </Button>
          </>
        )
      }
    >
      {rows === null ? (
        <div className="space-y-2">
          <textarea
            className="textarea font-mono text-xs"
            style={{ minHeight: '9rem' }}
            autoFocus
            placeholder={'Blue Widget, 5\nSKU-0042, 2, 99.50\nRed Widget'}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <p className="hint">One item per line. A quantity with no rate is fine — rate can still be entered on the table.</p>
        </div>
      ) : (
        <div className="space-y-1.5 max-h-72 overflow-y-auto">
          {rows.map((r, i) => (
            <div key={i} className={cx('flex items-center gap-2 rounded-lg border px-2.5 py-2 text-xs', r.status === 'ok' ? 'border-emerald-200 bg-emerald-50/50' : 'border-amber-200 bg-amber-50')}>
              {r.status === 'ok' ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" aria-hidden /> : <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0" aria-hidden />}
              <span className="min-w-0 flex-1 truncate">
                {r.status === 'ok' ? (
                  <>
                    <strong className="text-gray-900">{r.item?.print_name || r.item?.item_name}</strong>
                    <span className="text-gray-500"> · qty {formatQty(r.qty)}{r.rate !== null ? ` · ₹ ${formatQty(r.rate)}` : ''}</span>
                  </>
                ) : (
                  <span className="text-amber-800">
                    "{r.identifier}" — {r.status === 'invalid_qty' ? 'invalid quantity' : r.status === 'ambiguous' ? 'matches more than one item' : 'no matching item'}
                  </span>
                )}
              </span>
            </div>
          ))}
        </div>
      )}
    </Modal>
  )
}

export default QuickFillDialog
