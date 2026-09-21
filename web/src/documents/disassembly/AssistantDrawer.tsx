import { Copy, ScanBarcode, Sparkles, Wand2, Workflow } from 'lucide-react'
import { Notice } from '../../components/Notice'
import { Badge } from '../../ui/Badge'
import { Button } from '../../ui/Button'
import { Drawer } from '../../ui/Drawer'
import { cx } from '../../ui/cx'
import type { Insight } from './insights'

export interface AssistantDrawerProps {
  open: boolean
  onClose: () => void
  available: boolean
  unavailableReason: string
  insights: readonly Insight[]
  summary: string
  onLoadBom: () => void
  onAutoFill: () => void
  onScan: () => void
  onCopyDocument: () => void
  autoFillDisabled: boolean
  autoFillHint: string
}

/**
 * The assistant panel behind the header strip.
 *
 * What it does NOT do is invent an answer. Aicountly has no inventory assistant endpoint yet
 * (see `assistant.ts` for the contract it will speak), so the drawer says so in one sentence and
 * then does the useful part anyway: every check below is computed from this document and the
 * live stock behind it, and every action is one the screen can actually perform.
 */
export function AssistantDrawer({
  open,
  onClose,
  available,
  unavailableReason,
  insights,
  summary,
  onLoadBom,
  onAutoFill,
  onScan,
  onCopyDocument,
  autoFillDisabled,
  autoFillHint,
}: AssistantDrawerProps) {
  const actions = [
    { key: 'bom', icon: Workflow, label: 'Load components from a bill of materials', onSelect: onLoadBom, disabled: false, hint: 'Scales the BOM to the quantity you are tearing down.' },
    { key: 'autofill', icon: Wand2, label: 'Auto-fill components', onSelect: onAutoFill, disabled: autoFillDisabled, hint: autoFillHint },
    { key: 'scan', icon: ScanBarcode, label: 'Scan items with a barcode reader', onSelect: onScan, disabled: false, hint: 'Keyboard-only: scan, Enter, scan again.' },
    { key: 'copy', icon: Copy, label: 'Copy a previous disassembly', onSelect: onCopyDocument, disabled: false, hint: 'Pulls the lines of a document you posted before.' },
  ]

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Aicountly AI"
      badge={<Badge tone="beta" size="xs">Beta</Badge>}
      description="Checks and shortcuts for this disassembly."
      width="md"
    >
      {!available ? <Notice kind="info">{unavailableReason}</Notice> : null}

      <section className="mt-4">
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">This document</h3>
        <p className="mt-1 text-sm text-gray-700">{summary}</p>
      </section>

      <section className="mt-4">
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Checks</h3>
        <ul className="mt-2 space-y-2">
          {insights.map((insight) => (
            <li key={insight.id} className="flex items-start gap-2 text-[13px] leading-snug text-gray-700">
              <Sparkles
                className={cx(
                  'mt-0.5 h-3.5 w-3.5 shrink-0',
                  insight.tone === 'ok' ? 'text-emerald-600' : insight.tone === 'risk' ? 'text-red-600' : insight.tone === 'warn' ? 'text-amber-600' : 'text-gray-400',
                )}
                aria-hidden
              />
              <span>{insight.text}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-5">
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Do it for me</h3>
        <ul className="mt-2 space-y-2">
          {actions.map((action) => (
            <li key={action.key}>
              <Button
                variant="secondary"
                size="md"
                icon={action.icon}
                block
                className="justify-start"
                disabled={action.disabled}
                onClick={() => {
                  onClose()
                  action.onSelect()
                }}
              >
                {action.label}
              </Button>
              <p className="mt-0.5 pl-1 text-[11px] text-gray-500">{action.hint}</p>
            </li>
          ))}
        </ul>
      </section>
    </Drawer>
  )
}
