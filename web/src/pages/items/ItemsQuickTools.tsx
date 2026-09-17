import { Link } from 'react-router-dom'
import type { LucideIcon } from 'lucide-react'
import { ChevronRight, FolderCog, Pencil, Upload } from 'lucide-react'
import { Card } from '../../ui/Card'
import { IconTile } from '../../ui/IconTile'
import { cx } from '../../ui/cx'
import { notify } from '../../ui/notify'

interface QuickTool {
  key: string
  label: string
  hint: string
  icon: LucideIcon
  to?: string
}

const TOOLS: QuickTool[] = [
  { key: 'import', label: 'Import item masters', hint: 'Add items in bulk from a file', icon: Upload },
  { key: 'bulk-edit', label: 'Bulk edit items', hint: 'Update multiple items', icon: Pencil, to: '/items/bulk-edit' },
  { key: 'categories', label: 'Manage categories', hint: 'Organise your items', icon: FolderCog, to: '/masters/stock-categories' },
]

const CARD_BODY = 'flex items-center gap-3 p-3'

function ToolBody({ tool }: { tool: QuickTool }) {
  return (
    <>
      <IconTile icon={tool.icon} tone="primary" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-gray-900">{tool.label}</p>
        <p className="mt-0.5 text-xs text-gray-500">{tool.hint}</p>
      </div>
      <ChevronRight className="h-4 w-4 shrink-0 text-gray-300" aria-hidden />
    </>
  )
}

/** No import pipeline exists yet — the card is honest about that instead of linking nowhere. */
function announceImportComingSoon() {
  notify.info('CSV import is coming soon. Use Bulk edit or New item for now.')
}

function ToolCard({ tool }: { tool: QuickTool }) {
  if (tool.to) {
    return (
      <Card as={Link} to={tool.to} interactive padding="none" className={CARD_BODY}>
        <ToolBody tool={tool} />
      </Card>
    )
  }
  return (
    <Card
      as="div"
      interactive
      padding="none"
      role="button"
      tabIndex={0}
      onClick={announceImportComingSoon}
      onKeyDown={(e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return
        e.preventDefault()
        announceImportComingSoon()
      }}
      className={cx(CARD_BODY, 'cursor-pointer')}
    >
      <ToolBody tool={tool} />
    </Card>
  )
}

export function ItemsQuickTools() {
  return (
    <section className="space-y-2 print:hidden">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-500">Quick tools</h2>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        {TOOLS.map((tool) => (
          <ToolCard key={tool.key} tool={tool} />
        ))}
      </div>
    </section>
  )
}

export default ItemsQuickTools
