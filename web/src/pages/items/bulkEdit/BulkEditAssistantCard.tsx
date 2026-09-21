import { FileText, Search, Sparkles, WandSparkles } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Badge } from '../../../ui/Badge'
import { Card } from '../../../ui/Card'
import type { BulkFieldSpec } from './bulkEditFields'
import { isReadOnlyField } from './bulkEditFields'

/**
 * Practical help with a bulk edit, and nothing it cannot stand behind.
 *
 * There is no AI endpoint in Inventory — `services/inventoryAiService.ts` says
 * so in as many words and explains why inventing one would be worse than
 * having none. So every action here is a deterministic thing the browser can do
 * with what is already on screen: tidy a string, tick the rows that are empty,
 * remember a configuration.
 *
 * In particular, "find missing values" FINDS them. It does not propose one.
 * Suggesting an HSN code from an item's name would be Inventory answering a tax
 * question that belongs to Books and, ultimately, to the filer — the same rule
 * the item workspace's insights already follow.
 */

export interface AssistantAction {
  key: string
  icon: LucideIcon
  title: string
  description: string
  onSelect: () => void
  disabled?: boolean
  /** Shown instead of the description when the action cannot run. */
  disabledReason?: string
}

export interface BulkEditAssistantCardProps {
  field: BulkFieldSpec
  suggestion: string | null
  /** Rows on this page with no value for the field. */
  missingTotal: number
  /** …of which this many are not ticked yet — what the action would add. */
  missingUnselected: number
  onTidy: () => void
  onSelectMissing: () => void
  onSaveTemplate: () => void
  templatesAvailable: boolean
  canWrite: boolean
}

function ActionButton({ action }: { action: AssistantAction }) {
  return (
    <button
      type="button"
      onClick={action.onSelect}
      disabled={action.disabled}
      className="flex w-full items-start gap-2.5 rounded-lg border border-gray-200 bg-white p-2.5 text-left transition-colors hover:border-gray-300 hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-white"
    >
      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-50" aria-hidden>
        <action.icon className="h-4 w-4 text-emerald-600" />
      </span>
      <span className="min-w-0">
        <span className="block text-[11px] font-semibold text-gray-800">{action.title}</span>
        <span className="mt-0.5 block text-[10px] leading-relaxed text-gray-500">
          {action.disabled && action.disabledReason ? action.disabledReason : action.description}
        </span>
      </span>
    </button>
  )
}

export function BulkEditAssistantCard({
  field,
  suggestion,
  missingTotal,
  missingUnselected,
  onTidy,
  onSelectMissing,
  onSaveTemplate,
  templatesAvailable,
  canWrite,
}: BulkEditAssistantCardProps) {
  const readOnly = isReadOnlyField(field)
  const label = field.label.toLowerCase()
  /** A picker has no typing to tidy: the value comes from a list. */
  const typed = field.kind === 'code' || field.kind === 'money' || field.kind === 'quantity'

  const actions: AssistantAction[] = [
    {
      key: 'tidy',
      icon: WandSparkles,
      title: `Auto-normalise ${field.label}`,
      description: suggestion
        ? `Use ${suggestion} — spaces and separators removed.`
        : 'Clean and format the value you typed (e.g. 1234 5678 → 12345678).',
      onSelect: onTidy,
      disabled: !suggestion || readOnly || !canWrite,
      disabledReason: readOnly
        ? `${field.label} is maintained in Smart Books.`
        : !typed
          ? `${field.label} is chosen from a list — there is nothing to tidy.`
          : 'The value you typed is already clean.',
    },
    {
      key: 'missing',
      icon: Search,
      title: `Find items missing ${field.label}`,
      description:
        missingUnselected > 0
          ? `Tick the ${missingUnselected} item${missingUnselected === 1 ? '' : 's'} on this page with no ${label}.`
          : missingTotal === 0
            ? `Every item on this page already has a ${label}.`
            : `All ${missingTotal} item${missingTotal === 1 ? '' : 's'} with no ${label} are already ticked.`,
      onSelect: onSelectMissing,
      disabled: missingUnselected === 0,
      disabledReason:
        missingTotal === 0
          ? `Every item on this page already has a ${label}.`
          : `All ${missingTotal} item${missingTotal === 1 ? '' : 's'} with no ${label} are already ticked.`,
    },
    {
      key: 'template',
      icon: FileText,
      title: 'Create from this configuration',
      description: 'Save the field and filters as a reusable template.',
      onSelect: onSaveTemplate,
      disabled: !templatesAvailable,
      disabledReason: 'This browser cannot store templates.',
    },
  ]

  return (
    <Card padding="md" className="min-w-0">
      <div className="mb-3">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-gray-900">
          <Sparkles className="h-4 w-4 text-violet-600" aria-hidden />
          AI Assistant
          <Badge tone="beta" size="xs">
            Beta
          </Badge>
        </h3>
        <p className="mt-1.5 text-[11px] leading-relaxed text-gray-500">
          Help with bulk updates and finding gaps in your data. These are deterministic checks that run in your browser
          — they tidy what you typed and point at what is missing, and never propose a value or a tax classification.
        </p>
      </div>
      <div className="space-y-2">
        {actions.map((action) => (
          <ActionButton key={action.key} action={action} />
        ))}
      </div>
    </Card>
  )
}
