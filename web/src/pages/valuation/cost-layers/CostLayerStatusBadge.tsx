import { Badge } from '../../../ui/Badge'
import type { BadgeTone } from '../../../ui/Badge'
import { Tooltip } from '../../../ui/Tooltip'
import { LAYER_STATUS_LABEL, LAYER_STATUS_SHORT, layerStatus } from '../costLayerModel'
import type { LayerStatus } from '../costLayerModel'
import type { CostLayerRow } from '../../../services/valuationApi'

/**
 * A layer's state, as a chip.
 *
 * The dot is on for the same reason every register status carries one: a
 * reader scans this column rather than reads it, and colour alone would leave
 * the state invisible to anyone who cannot separate the greens from the ambers.
 * The word is always there — the colour is the shortcut, never the message.
 */
const TONE: Record<LayerStatus, BadgeTone> = {
  open: 'success',
  partial: 'warning',
  closed: 'neutral',
  negative: 'danger',
  revised: 'violet',
}

export function CostLayerStatusBadge({ row, compact = false }: { row: CostLayerRow; compact?: boolean }) {
  const status = layerStatus(row)
  const badge = (
    <Badge tone={TONE[status]} size="xs" dot className="normal-case">
      {compact ? LAYER_STATUS_SHORT[status] : LAYER_STATUS_LABEL[status]}
    </Badge>
  )
  // Only where the word was shortened — a tooltip that repeats the label is
  // noise on every row of the grid.
  return compact && LAYER_STATUS_SHORT[status] !== LAYER_STATUS_LABEL[status] ? (
    <Tooltip label={LAYER_STATUS_LABEL[status]}>{badge}</Tooltip>
  ) : (
    badge
  )
}

export function StatusChip({ status }: { status: LayerStatus }) {
  return (
    <Badge tone={TONE[status]} size="xs" dot className="normal-case">
      {LAYER_STATUS_LABEL[status]}
    </Badge>
  )
}

/** The band and legend swatch colours, kept beside the badge tones they echo. */
export const STATUS_BAR_FILL: Record<LayerStatus, string> = {
  open: 'bg-emerald-500',
  partial: 'bg-amber-400',
  closed: 'bg-slate-400',
  negative: 'bg-red-500',
  revised: 'bg-violet-500',
}

export default CostLayerStatusBadge
