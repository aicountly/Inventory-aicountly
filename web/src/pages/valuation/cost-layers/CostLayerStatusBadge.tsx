import { Badge } from '../../../ui/Badge'
import type { BadgeTone } from '../../../ui/Badge'
import { Tooltip } from '../../../ui/Tooltip'
import type { CostLayerStatus } from '../../../services/valuationApi'
import { LAYER_STATUS_CHIP, LAYER_STATUS_HINT, LAYER_STATUS_LABEL } from './costLayersModel'

const TONE: Record<CostLayerStatus, BadgeTone> = {
  open: 'success',
  partial: 'warning',
  closed: 'neutral',
  negative: 'danger',
}

/**
 * A layer's state, as a word with a dot in front of it.
 *
 * The dot is what the eye finds scanning a column of forty rows; the word is
 * what a colour-blind reader, a printed sheet and a screen reader get. Neither
 * is optional — "the red ones are the problem" is not a thing a valuation
 * screen may rely on.
 */
export function CostLayerStatusBadge({ status }: { status: CostLayerStatus }) {
  return (
    <Tooltip label={`${LAYER_STATUS_LABEL[status]} — ${LAYER_STATUS_HINT[status]}`}>
      <Badge tone={TONE[status]} size="xs" dot>
        <span className="sr-only">{LAYER_STATUS_LABEL[status]}</span>
        <span aria-hidden>{LAYER_STATUS_CHIP[status]}</span>
      </Badge>
    </Tooltip>
  )
}

export default CostLayerStatusBadge
