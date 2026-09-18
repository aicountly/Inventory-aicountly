import { TriangleAlert } from 'lucide-react'
import { Badge } from '../../../ui/Badge'
import type { BadgeTone } from '../../../ui/Badge'
import { Tooltip } from '../../../ui/Tooltip'
import { BOM_STATUS_LABEL } from './bomPresentation'
import type { BomHealth, BomStatus } from './bomPresentation'

/**
 * The status of a bill of materials, and — separately — whether it needs a
 * second look.
 *
 * Two chips rather than one, because they answer different questions. The
 * status is a stored fact: this bill is available for production, or it is not.
 * "Needs review" is the result of the deterministic checks in `bomHealth` —
 * an inactive component, a zero quantity, wastage past the sanity threshold —
 * and folding it into the status would invent a state the record does not have.
 *
 * `draft` is in the map and never produced today (see `bomStatus`): the record
 * has no draft state, so nothing here can render one until the API grows one.
 */

const TONES: Record<BomStatus, BadgeTone> = {
  active: 'success',
  draft: 'info',
  inactive: 'danger',
}

export function BomStatusBadge({ status }: { status: BomStatus }) {
  return (
    <Badge tone={TONES[status] ?? 'neutral'} size="sm" dot className="normal-case">
      {BOM_STATUS_LABEL[status] ?? BOM_STATUS_LABEL.inactive}
    </Badge>
  )
}

/**
 * The amber marker beside a status.
 *
 * Renders nothing when there is nothing to say — an always-present "healthy"
 * chip trains the eye to skip the column, which is exactly where a real warning
 * would then go unread. The reasons are the tooltip AND the accessible name, so
 * this is never colour on its own.
 */
export function BomHealthChip({ health }: { health: BomHealth }) {
  if (health.level === 'ok') return null
  const detail = health.reasons.join(' ')
  return (
    <Tooltip label={detail}>
      <span
        className="inline-flex items-center gap-1 rounded-md bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700"
        role="note"
        aria-label={`Needs review. ${detail}`}
      >
        <TriangleAlert className="h-3 w-3 shrink-0" aria-hidden />
        Needs review
      </span>
    </Tooltip>
  )
}

export default BomStatusBadge
