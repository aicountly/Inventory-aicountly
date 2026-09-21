import { Sparkles } from 'lucide-react'
import { Badge } from '../../ui/Badge'
import { Button } from '../../ui/Button'
import { Card } from '../../ui/Card'
import { cx } from '../../ui/cx'

export interface TransferAssistantCardProps {
  onOpen: () => void
  /** Number of things the checks would raise right now, for the button caption. */
  findings: number
  disabled?: boolean
  className?: string
}

/**
 * The assistant panel.
 *
 * What it opens is REAL: every check behind the button runs over live stock
 * through `GET /v1/availability` and the draft on screen. There is no language
 * model behind it and none is pretended — Inventory has no AI service to call,
 * and inventing one (or scripting an answer that looks like one) would put
 * made-up stock advice in front of a storekeeper. When an Aicountly assistant
 * service does arrive, it answers into this same drawer beside the checks.
 */
export function TransferAssistantCard({ onOpen, findings, disabled = false, className }: TransferAssistantCardProps) {
  return (
    <Card
      padding="md"
      className={cx('border-violet-100 bg-violet-50', className)}
    >
      <div className="flex items-center gap-2.5">
        <span
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-violet-100 text-violet-600"
          aria-hidden
        >
          <Sparkles className="h-4 w-4" />
        </span>
        <div className="flex w-full items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-gray-900">Assistant</h2>
          <Badge tone="beta" size="sm">
            Beta
          </Badge>
        </div>
      </div>

      <p className="mt-3.5 text-xs font-semibold text-gray-800">Need help?</p>
      <p className="mt-0.5 text-[11px] leading-relaxed text-gray-500">
        Check stock availability, find warehouses that can cover a shortage, and review the transfer before you post it.
      </p>

      <Button
        variant="secondary"
        size="md"
        block
        icon={Sparkles}
        onClick={onOpen}
        disabled={disabled}
        className="mt-3 border-violet-200 bg-white text-violet-700 hover:border-violet-300 hover:bg-violet-50 hover:text-violet-800"
      >
        {findings > 0 ? `Review ${findings} finding${findings === 1 ? '' : 's'}` : 'Run assistant checks'}
      </Button>
    </Card>
  )
}
