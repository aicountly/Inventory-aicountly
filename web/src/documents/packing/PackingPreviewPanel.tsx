import { Eye, QrCode } from 'lucide-react'
import { Button } from '../../ui/Button'
import { Card } from '../../ui/Card'
import { Tooltip } from '../../ui/Tooltip'
import { formatDate } from '../../utils/format'
import { isBlankLine } from '../formModel'
import type { HeaderDraft, LineDraft } from '../formModel'

export interface PackingPreviewPanelProps {
  header: HeaderDraft
  lines: LineDraft[]
  warehouseName: (id: number | null | undefined) => string
  unitSymbol: (id: number | null | undefined) => string
  /** Set once the draft has been saved — the real PDF reuses the existing print pipeline at /documents/:id/print. */
  savedId: number | null
}

const PREVIEW_ROW_LIMIT = 5

/**
 * A live, client-rendered mini preview built straight from the current draft — not a stand-in for
 * the real document. The real, print-quality PDF reuses the app's existing print pipeline
 * (`/documents/:id/print`, `export/documentSheet.ts`) once the draft has a document id to snapshot.
 */
export function PackingPreviewPanel({ header, lines, warehouseName, unitSymbol, savedId }: PackingPreviewPanelProps) {
  const active = lines.filter((l) => !isBlankLine(l))
  const previewRows = active.slice(0, PREVIEW_ROW_LIMIT)
  const overflow = active.length - previewRows.length

  return (
    <Card padding="md">
      <div className="mb-3 flex items-start justify-between gap-2 border-b border-gray-100 pb-3">
        <div>
          <h3 className="text-sm font-semibold text-gray-900">Preview</h3>
          <p className="mt-0.5 text-xs text-gray-500">See how it will look on print</p>
        </div>
        {savedId ? (
          <Button variant="secondary" size="xs" icon={Eye} onClick={() => window.open(`/documents/${savedId}/print`, '_blank', 'noopener')}>
            Preview PDF
          </Button>
        ) : (
          <Tooltip label="Save this packing list first">
            <Button variant="secondary" size="xs" icon={Eye} disabled>
              Preview PDF
            </Button>
          </Tooltip>
        )}
      </div>

      <div className="rounded-lg border border-gray-200 bg-white p-3 shadow-card">
        <div className="flex items-center justify-between border-b border-gray-100 pb-2">
          <span className="text-sm font-bold text-primary">Aicountly</span>
          <span className="text-[10px] font-bold uppercase tracking-wide text-gray-500">Packing list</span>
        </div>
        <dl className="mt-2 space-y-1">
          <PreviewRow label="Packing list no." value={header.document_no || 'Auto-generated'} />
          <PreviewRow label="Date" value={formatDate(header.document_date)} />
          <PreviewRow label="Consignee" value={header.party_name || '—'} />
          <PreviewRow label="Warehouse" value={warehouseName(header.default_warehouse_id) || '—'} />
        </dl>
        <table className="mt-3 w-full border-collapse text-[10px]">
          <thead>
            <tr className="border-b border-gray-100 text-gray-500">
              <th className="py-1 text-left font-semibold">#</th>
              <th className="py-1 text-left font-semibold">Item</th>
              <th className="py-1 text-right font-semibold">Qty</th>
              <th className="py-1 pl-2 text-left font-semibold">Unit</th>
            </tr>
          </thead>
          <tbody>
            {previewRows.length === 0 ? (
              <tr>
                <td colSpan={4} className="py-3 text-center text-gray-400">
                  No items yet
                </td>
              </tr>
            ) : (
              previewRows.map((l, i) => (
                <tr key={l.key} className="border-b border-gray-50">
                  <td className="py-1 text-gray-500">{i + 1}</td>
                  <td className="max-w-[7.5rem] truncate py-1 text-gray-900">{l.item_name || '—'}</td>
                  <td className="py-1 text-right text-gray-900">{l.qty || '—'}</td>
                  <td className="py-1 pl-2 text-gray-500">{l.unit_id ? unitSymbol(l.unit_id) : '—'}</td>
                </tr>
              ))
            )}
            {overflow > 0 ? (
              <tr>
                <td colSpan={4} className="py-1 text-center text-gray-400">
                  +{overflow} more
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
        <div className="mt-3 flex items-end justify-between gap-2 border-t border-gray-100 pt-2">
          <span className="flex h-9 w-9 items-center justify-center rounded border border-dashed border-gray-300 text-gray-300" title="QR code — coming soon" aria-hidden>
            <QrCode className="h-5 w-5" />
          </span>
          <div className="text-right text-[8px] leading-tight text-gray-400">
            <p>Packed with ♥ by Aicountly</p>
            <p>Smart Inventory. Smarter Business.</p>
          </div>
        </div>
      </div>
    </Card>
  )
}

function PreviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2 text-[10px]">
      <dt className="text-gray-500">{label}</dt>
      <dd className="max-w-[9rem] truncate font-semibold text-gray-900">{value}</dd>
    </div>
  )
}

export default PackingPreviewPanel
