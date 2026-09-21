import { ClipboardPaste, CopyPlus, Keyboard, ListPlus, RefreshCw, ScanBarcode, Search, Sparkles } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Badge } from '../../ui/Badge'
import { Button } from '../../ui/Button'
import { Drawer } from '../../ui/Drawer'
import { KeyboardShortcutHint } from '../../ui/Kbd'
import { cx } from '../../ui/cx'
import type { Insight } from './insights'
import { SmartInsights } from './SmartInsights'

export interface AssistAction {
  key: string
  label: string
  description: string
  icon: LucideIcon
  onRun: () => void
  disabled?: boolean
}

interface SmartAssistDrawerProps {
  open: boolean
  onClose: () => void
  insights: Insight[]
  checking: boolean
  onFocusLines: (keys: string[]) => void
  actions: AssistAction[]
}

const SHORTCUTS: { keys: string; what: string }[] = [
  { keys: 'alt+i', what: 'Focus the item search' },
  { keys: 'alt+c', what: 'Focus the customer field' },
  { keys: 'alt+n', what: 'Focus the narration' },
  { keys: 'alt+b', what: 'Toggle scanner mode' },
  { keys: 'enter', what: 'From the quantity box, add the line' },
  { keys: 'ctrl+s', what: 'Save the draft' },
  { keys: 'ctrl+enter', what: 'Save and post' },
  { keys: 'escape', what: 'Close a drawer or dialog' },
]

export const ASSIST_ICONS = { Search, ScanBarcode, ListPlus, ClipboardPaste, CopyPlus, RefreshCw }

/**
 * The assistant panel behind the header card.
 *
 * It is called Smart assist rather than AI assistant on purpose: Inventory has
 * no AI service wired to it, so there is nothing here that generates text or
 * predicts anything. What it does is put the deterministic checks and the
 * fastest ways through the form in one place — which is the part of an
 * assistant a dispatch clerk actually uses.
 */
export function SmartAssistDrawer({ open, onClose, insights, checking, onFocusLines, actions }: SmartAssistDrawerProps) {
  const blocking = insights.filter((i) => i.blocking).length
  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Smart assist"
      description="Checks and shortcuts for this challan"
      width="md"
      badge={
        <Badge tone={blocking ? 'warning' : 'success'} size="xs">
          {blocking ? `${blocking} to fix` : 'Nothing blocking'}
        </Badge>
      }
      footer={
        <div className="flex items-center justify-between gap-3">
          <span className="text-[11px] text-gray-500">No AI service is connected — every check is a rule over this document.</span>
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <SmartInsights
          insights={insights}
          checking={checking}
          onFocusLines={(keys) => {
            onFocusLines(keys)
            onClose()
          }}
        />

        <div>
          <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-gray-900">
            <Sparkles className="h-3.5 w-3.5 text-violet-500" aria-hidden />
            Fill the challan faster
          </h3>
          <ul className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
            {actions.map((action) => (
              <li key={action.key}>
                <button
                  type="button"
                  disabled={action.disabled}
                  className={cx(
                    'flex w-full items-start gap-2 rounded-lg border border-gray-200 bg-white p-2 text-left transition-colors',
                    action.disabled ? 'opacity-50' : 'hover:border-primary/40 hover:bg-primary-light/40',
                  )}
                  onClick={() => {
                    action.onRun()
                    onClose()
                  }}
                >
                  <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-primary-light text-primary">
                    <action.icon className="h-3.5 w-3.5" aria-hidden />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-xs font-medium text-gray-900">{action.label}</span>
                    <span className="block text-[10px] leading-snug text-gray-500">{action.description}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>

        <div>
          <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-gray-900">
            <Keyboard className="h-3.5 w-3.5 text-gray-400" aria-hidden />
            Keyboard
          </h3>
          <ul className="space-y-1">
            {SHORTCUTS.map((s) => (
              <li key={s.keys} className="flex items-center justify-between gap-3 text-[11px] text-gray-600">
                <span>{s.what}</span>
                <KeyboardShortcutHint keys={s.keys} />
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Drawer>
  )
}
