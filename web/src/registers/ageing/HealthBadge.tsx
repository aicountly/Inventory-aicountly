import { Badge } from '../../ui/Badge'
import { Tooltip } from '../../ui/Tooltip'
import { HEALTH_STATUS_META } from './ageingModel'
import type { StockHealthStatus } from '../../services/reportsApi'

/**
 * A row's health, as the server classified it.
 *
 * The word is the status — the colour and the dot only repeat it, so the column is
 * readable in greyscale, on a printed sheet and by a reader who cannot tell amber from
 * orange. The tooltip carries the rule behind the word; it is an explanation, never
 * the only place the status appears.
 */
export function HealthBadge({ status }: { status: StockHealthStatus | null }) {
  if (!status) return <span className="text-gray-300">—</span>
  const meta = HEALTH_STATUS_META[status]
  return (
    <Tooltip label={meta.rule}>
      <Badge tone={meta.badge} size="xs" dot>
        {meta.label}
      </Badge>
    </Tooltip>
  )
}

export default HealthBadge
