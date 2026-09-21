import { useState } from 'react'
import { ChevronDown, HelpCircle, IndianRupee, Layers, Package, Sparkles } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { Modal } from '../../components/Modal'
import { aiAssistantApi } from '../../services/aiAssistantApi'
import { Card } from '../../ui/Card'
import { IconTile } from '../../ui/IconTile'
import type { IconTone } from '../../ui/IconTile'
import { KeyboardShortcutHint } from '../../ui/Kbd'
import { MenuButton } from '../../ui/MenuButton'
import { formatMoney, formatQty } from '../../utils/format'
import type { DraftTotals } from '../formModel'
import type { CopySource } from './openingStockHelpers'

interface OpeningStockHeaderExtrasProps {
  totals: DraftTotals
  onOpenImport: () => void
  onOpenCopy: (source: CopySource) => void
}

function SummaryCell({ icon, tone, label, value, hint }: { icon: LucideIcon; tone: IconTone; label: string; value: ReactNode; hint: string }) {
  return (
    <div className="flex items-center gap-3 p-4">
      <IconTile icon={icon} tone={tone} size="md" />
      <div className="min-w-0">
        <p className="text-xs text-gray-500">{label}</p>
        <p className="truncate text-lg font-semibold tabular-nums text-gray-900">{value}</p>
        <p className="text-[11px] text-gray-400">{hint}</p>
      </div>
    </div>
  )
}

/** The AI assistant + help cards, and the summary strip beneath them — the "workspace" chrome above Document Details. */
export function OpeningStockHeaderExtras({ totals, onOpenImport, onOpenCopy }: OpeningStockHeaderExtrasProps) {
  const [aiOpen, setAiOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const ai = aiAssistantApi.status()

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-stretch justify-end gap-3">
        <div className="flex min-w-[280px] flex-1 items-center gap-3 rounded-2xl border border-violet-200 bg-violet-50 px-4 py-3 shadow-card sm:max-w-sm sm:flex-none">
          <Sparkles className="h-6 w-6 shrink-0 text-violet-600" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-violet-700">Aicountly AI Assistant</p>
            <p className="text-xs leading-relaxed text-violet-700">Auto-fill from CSV, suggest rates, check duplicates and validate stock.</p>
          </div>
          <button
            type="button"
            onClick={() => setAiOpen(true)}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-violet-600 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-violet-700 focus:outline-none focus:ring-2 focus:ring-violet-300"
          >
            Use AI
          </button>
        </div>

        <button
          type="button"
          onClick={() => setHelpOpen(true)}
          className="flex min-w-[220px] items-center gap-3 rounded-2xl border border-sky-100 bg-sky-50/60 px-4 py-3 text-left shadow-card transition-shadow hover:shadow-md"
        >
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-sky-50 text-sky-600">
            <HelpCircle className="h-4 w-4" aria-hidden />
          </span>
          <span className="min-w-0">
            <span className="block text-sm font-semibold text-gray-900">Need help?</span>
            <span className="block text-xs text-sky-700">Shortcuts &amp; tips for this screen</span>
          </span>
        </button>
      </div>

      <Card padding="none" className="overflow-hidden">
        <div className="grid grid-cols-1 divide-y divide-gray-100 sm:grid-cols-2 sm:divide-x sm:divide-y-0 lg:grid-cols-4">
          <SummaryCell icon={Package} tone="info" label="Items in this document" value={totals.lines} hint="Items added" />
          <SummaryCell icon={Layers} tone="teal" label="Total quantity" value={formatQty(totals.qtyIn)} hint="Across all items" />
          <SummaryCell icon={IndianRupee} tone="success" label="Total value (INR)" value={formatMoney(totals.amount)} hint="Based on item rate" />
          <div className="flex items-center justify-between gap-3 p-4">
            <div className="min-w-0">
              <p className="text-xs font-semibold text-primary">Get started faster</p>
              <p className="mt-0.5 text-[11px] leading-relaxed text-gray-500">Import items from Excel/CSV or copy from last year&rsquo;s closing stock.</p>
            </div>
            <MenuButton
              label="Get started faster"
              variant="outline"
              size="sm"
              buttonProps={{ iconRight: ChevronDown }}
              width={240}
              actions={[
                { key: 'import', label: 'Import from Excel/CSV', onSelect: onOpenImport },
                { key: 'previous', label: 'Copy from previous year', onSelect: () => onOpenCopy('previous_document') },
                { key: 'closing', label: 'Fetch from closing stock', onSelect: () => onOpenCopy('closing_stock') },
              ]}
            >
              Import
            </MenuButton>
          </div>
        </div>
      </Card>

      <Modal open={aiOpen} onClose={() => setAiOpen(false)} title="Aicountly AI Assistant" size="sm">
        <p className="text-sm text-gray-600">{ai.message}</p>
        <ul className="mt-3 space-y-1.5 text-xs text-gray-500">
          <li>• Auto-fill items and quantities from an imported CSV</li>
          <li>• Suggest rates from permitted historical inventory data</li>
          <li>• Flag duplicate lines and unusual rate variance</li>
          <li>• Summarise validation issues before you post</li>
        </ul>
        <p className="mt-3 text-[11px] text-gray-400">AI only ever suggests — posting an opening stock document always needs your explicit action.</p>
      </Modal>

      <Modal open={helpOpen} onClose={() => setHelpOpen(false)} title="Opening Stock — shortcuts & tips" size="sm">
        <div className="space-y-2 text-sm text-gray-600">
          <p>Bring your existing stock into the system with its opening quantity and value. Add lines by hand, scan barcodes, add several items at once, or import a CSV — nothing posts until you choose Save &amp; Post.</p>
        </div>
        <div className="mt-4 space-y-2">
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs text-gray-500">Add a line</span>
            <KeyboardShortcutHint keys="ctrl+enter" />
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs text-gray-500">Save draft</span>
            <KeyboardShortcutHint keys="ctrl+s" />
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs text-gray-500">Save &amp; post</span>
            <KeyboardShortcutHint keys="alt+p" />
          </div>
        </div>
      </Modal>
    </div>
  )
}

export default OpeningStockHeaderExtras
