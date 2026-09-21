import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronRight, ClipboardPaste, CopyPlus, FileUp, LayoutTemplate, ListPlus, Plus, ScanBarcode, Settings, Sparkles, Trash2 } from 'lucide-react'
import { Modal } from '../../components/Modal'
import { Notice } from '../../components/Notice'
import { Button } from '../../ui/Button'
import { Input } from '../../ui/Input'
import { MenuButton } from '../../ui/MenuButton'
import type { MenuAction } from '../../ui/MenuButton'
import { cx } from '../../ui/cx'
import { formatDate } from '../../utils/format'
import type { ChallanTemplate } from './templates'

interface ChallanHeaderActionsProps {
  disabled?: boolean
  scan: boolean
  onToggleScan: () => void
  onImport: () => void
  onPaste: () => void
  onMultiItem: () => void
  onCopyPrevious: () => void
  onAddBlankLine: () => void
  templates: ChallanTemplate[]
  onApplyTemplate: (template: ChallanTemplate) => void
  onSaveTemplate: (name: string) => void
  onDeleteTemplate: (id: string) => void
  canSaveTemplate: boolean
  /** Null hides the settings link for a profile that cannot read settings. */
  settingsTo: string | null
}

/**
 * The header's utility row. Every button does something real: there is no
 * placeholder here and nothing that opens a "coming soon".
 */
export function ChallanHeaderActions({
  disabled,
  scan,
  onToggleScan,
  onImport,
  onPaste,
  onMultiItem,
  onCopyPrevious,
  onAddBlankLine,
  templates,
  onApplyTemplate,
  onSaveTemplate,
  onDeleteTemplate,
  canSaveTemplate,
  settingsTo,
}: ChallanHeaderActionsProps) {
  const [saveOpen, setSaveOpen] = useState(false)
  const [name, setName] = useState('')

  const quickAdd: MenuAction[] = [
    { key: 'multi', label: 'Add multiple items…', icon: ListPlus, onSelect: onMultiItem },
    { key: 'paste', label: 'Paste a SKU / quantity list…', icon: ClipboardPaste, onSelect: onPaste },
    { key: 'copy', label: 'Copy lines from an earlier challan…', icon: CopyPlus, onSelect: onCopyPrevious },
    { key: 'blank', label: 'Add a blank line', icon: Plus, onSelect: onAddBlankLine, separated: true },
  ]

  const templateActions: MenuAction[] = [
    ...templates.map<MenuAction>((t) => ({
      key: t.id,
      label: (
        <span className="flex min-w-0 flex-col">
          <span className="truncate">{t.name}</span>
          <span className="text-[10px] text-gray-400">
            {t.lines.length} line{t.lines.length === 1 ? '' : 's'} · saved {formatDate(t.saved_at)}
          </span>
        </span>
      ),
      icon: LayoutTemplate,
      onSelect: () => onApplyTemplate(t),
    })),
    {
      key: 'save',
      label: 'Save this challan as a template',
      icon: Plus,
      separated: templates.length > 0,
      disabled: !canSaveTemplate,
      onSelect: () => {
        setName('')
        setSaveOpen(true)
      },
    },
    ...(templates.length
      ? [
          {
            key: 'manage',
            label: 'Delete the oldest template',
            icon: Trash2,
            danger: true,
            onSelect: () => onDeleteTemplate(templates[templates.length - 1].id),
          } satisfies MenuAction,
        ]
      : []),
  ]

  return (
    <>
      <div className="flex flex-wrap items-center gap-1.5">
        <Button variant="secondary" size="sm" icon={FileUp} onClick={onImport} disabled={disabled}>
          Import
        </Button>
        <Button variant={scan ? 'primary' : 'secondary'} size="sm" icon={ScanBarcode} onClick={onToggleScan} disabled={disabled} aria-pressed={scan}>
          Scan &amp; add
        </Button>
        <MenuButton
          label="Quick add"
          variant="secondary"
          size="sm"
          icon={Plus}
          actions={quickAdd}
          width={264}
          buttonProps={{ disabled }}
        >
          Quick add
        </MenuButton>
        <MenuButton
          label="Templates"
          variant="secondary"
          size="sm"
          icon={LayoutTemplate}
          actions={templateActions}
          width={280}
          buttonProps={{ disabled }}
        >
          Templates
        </MenuButton>
        {settingsTo ? (
          <Link
            to={settingsTo}
            className="aic inline-flex h-8 items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 text-sm font-medium text-gray-700 no-underline transition-colors hover:border-primary/40 hover:bg-primary-light hover:text-primary"
            title="Document type and numbering settings"
          >
            <Settings className="h-4 w-4" aria-hidden />
            Settings
          </Link>
        ) : null}
      </div>

      <Modal
        open={saveOpen}
        title="Save as a template"
        onClose={() => setSaveOpen(false)}
        size="sm"
        description="Templates are kept in this browser, for this company. They hold items, quantities and header choices — never batches or serial numbers."
        footer={
          <>
            <Button variant="secondary" onClick={() => setSaveOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={!name.trim()}
              onClick={() => {
                onSaveTemplate(name)
                setSaveOpen(false)
              }}
            >
              Save template
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Input autoFocus value={name} maxLength={60} placeholder="e.g. Weekly spares to Acme" aria-label="Template name" onChange={(e) => setName(e.target.value)} />
          <Notice kind="info">Stored on this device only. Clearing the browser's site data removes it.</Notice>
        </div>
      </Modal>
    </>
  )
}

interface AssistCardButtonProps {
  onOpen: () => void
  blockingCount: number
}

/** The gradient card at the right of the header that opens Smart assist. */
export function AssistCardButton({ onOpen, blockingCount }: AssistCardButtonProps) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cx(
        'group flex w-full min-w-[15rem] max-w-sm items-center gap-2.5 rounded-xl border px-3 py-2 text-left transition-colors',
        blockingCount > 0
          ? 'border-amber-200 bg-amber-50 hover:bg-amber-100'
          : 'border-violet-200 bg-violet-50 hover:bg-violet-100',
      )}
      aria-label="Open smart assist"
    >
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-white text-violet-600 shadow-card">
        <Sparkles className="h-4 w-4" aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-xs font-semibold text-violet-700">Smart assist</span>
        <span className="block truncate text-[10px] text-gray-600">
          {blockingCount > 0 ? `${blockingCount} thing${blockingCount === 1 ? '' : 's'} to fix before posting` : 'Checks, stock and faster ways to fill this challan'}
        </span>
      </span>
      <ChevronRight className="h-4 w-4 shrink-0 text-gray-400 transition-transform group-hover:translate-x-0.5" aria-hidden />
    </button>
  )
}
