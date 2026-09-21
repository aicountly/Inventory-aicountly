import { AlertCircle, AlertTriangle, CircleCheck, Lightbulb } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Drawer } from '../../ui/Drawer'
import { EmptyState } from '../../ui/EmptyState'
import type { ValidationReport } from './openingStockHelpers'

interface ValidationDrawerProps {
  open: boolean
  onClose: () => void
  report: ValidationReport
}

type Tone = 'danger' | 'warning' | 'info'

const TONE: Record<Tone, { text: string; bg: string; border: string; icon: string }> = {
  danger: { text: 'text-red-700', bg: 'bg-red-50', border: 'border-red-200', icon: 'text-red-500' },
  warning: { text: 'text-amber-700', bg: 'bg-amber-50', border: 'border-amber-200', icon: 'text-amber-500' },
  info: { text: 'text-sky-700', bg: 'bg-sky-50', border: 'border-sky-200', icon: 'text-sky-500' },
}

function Group({ title, icon: Icon, tone, items }: { title: string; icon: LucideIcon; tone: Tone; items: readonly string[] }) {
  if (items.length === 0) return null
  const t = TONE[tone]
  return (
    <div className="mb-5 last:mb-0">
      <div className="mb-2 flex items-center gap-2">
        <Icon className={`h-4 w-4 ${t.icon}`} aria-hidden />
        <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
          {title} ({items.length})
        </h3>
      </div>
      <ul className="space-y-1.5">
        {items.map((message, i) => (
          <li key={i} className={`rounded-lg border px-3 py-2 text-sm leading-snug ${t.border} ${t.bg} ${t.text}`}>
            {message}
          </li>
        ))}
      </ul>
    </div>
  )
}

/** Grouped Errors / Warnings / Suggestions for "Validate stock" — the same report the issue-count pill summarises. */
export function ValidationDrawer({ open, onClose, report }: ValidationDrawerProps) {
  const total = report.errors.length + report.warnings.length
  const empty = total === 0 && report.suggestions.length === 0

  return (
    <Drawer open={open} onClose={onClose} title="Validate stock" description={total === 0 ? 'No blocking issues found.' : `${total} issue${total === 1 ? '' : 's'} found.`} width="md">
      {empty ? (
        <EmptyState icon={CircleCheck} title="Looks good" description="No validation issues on this draft right now." size="sm" />
      ) : (
        <>
          <Group title="Errors" icon={AlertCircle} tone="danger" items={report.errors} />
          <Group title="Warnings" icon={AlertTriangle} tone="warning" items={report.warnings} />
          <Group title="Suggestions" icon={Lightbulb} tone="info" items={report.suggestions} />
        </>
      )}
    </Drawer>
  )
}

export default ValidationDrawer
