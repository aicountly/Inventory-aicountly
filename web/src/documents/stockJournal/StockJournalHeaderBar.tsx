import { ClipboardList, Keyboard, PlayCircle } from 'lucide-react'
import { BreadcrumbHeader } from '../../ui/shell/BreadcrumbHeader'
import { Button } from '../../ui/Button'
import { SegmentedControl } from '../../ui/SegmentedControl'
import { Badge } from '../../ui/Badge'

export type JournalTab = 'create' | 'preview' | 'history' | 'templates'

interface StockJournalHeaderBarProps {
  tab: JournalTab
  onTabChange: (tab: JournalTab) => void
  onShortcuts: () => void
  title: string
  /** Shown beside the title once the draft has an id. */
  statusBadge?: { label: string; tone: 'neutral' | 'warning' | 'success' | 'danger' } | null
  dirty: boolean
}

/** Breadcrumb, title and the four views of one document. */
export function StockJournalHeaderBar({ tab, onTabChange, onShortcuts, title, statusBadge, dirty }: StockJournalHeaderBarProps) {
  return (
    <BreadcrumbHeader
      breadcrumbs={[{ label: 'Documents', to: '/documents' }, { label: 'Stock Journal' }]}
      icon={ClipboardList}
      title={title}
      description="Adjust, transfer or reclassify stock with complete traceability."
      badge={statusBadge ? <Badge tone={statusBadge.tone}>{statusBadge.label}</Badge> : null}
      // Esc leaves the page; while there are unsaved edits it asks first.
      escBack
      escDirty={dirty}
      actions={
        <>
          <SegmentedControl
            value={tab}
            onChange={onTabChange}
            size="md"
            options={[
              { value: 'create', label: 'Create' },
              { value: 'preview', label: 'Preview' },
              { value: 'history', label: 'History' },
              { value: 'templates', label: 'Templates' },
            ]}
          />
          <Button variant="secondary" icon={Keyboard} onClick={onShortcuts}>
            Shortcuts
          </Button>
          <Button
            variant="secondary"
            icon={PlayCircle}
            onClick={() => window.open('https://aicountly.com/help/inventory/stock-journal', '_blank', 'noopener,noreferrer')}
          >
            Video Guide
          </Button>
        </>
      }
    />
  )
}
