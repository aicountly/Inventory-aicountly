import type { LucideIcon } from 'lucide-react'
import type { PermissionKey } from '../../access/AccessContext'
import type { IconTone } from '../../ui/IconTile'
import {
  REGISTER_GROUP_DESCRIPTIONS,
  REGISTER_GROUP_LABELS,
  REGISTER_GROUP_ORDER,
  registersInGroup,
} from '../configs'
import { registerPermission, registerRoute } from '../RegisterConfig'
import type { RegisterGroup } from '../RegisterConfig'

/**
 * The hub's view of the register catalogue.
 *
 * `src/registers/configs` stays the single source of truth for what a register
 * is, where it lives and who may read it; this module only decides how the hub
 * *dresses* that list — which accent a section wears, how many columns it gets,
 * and which two or three cards earn a decorative visual. Keeping that here, as
 * data, means the page component renders a list instead of carrying fifteen
 * hand-written cards that can drift from the routes behind them.
 *
 * A register added to the catalogue appears on the hub with no edit here.
 */

export type RegisterVisual = 'sparkline' | 'bars' | 'none'

export interface RegisterHubTile {
  key: string
  title: string
  description: string
  icon?: LucideIcon
  /** The register's existing route — never invented here. */
  to: string
  tone: IconTone
  visual: RegisterVisual
}

export interface RegisterHubSection {
  key: RegisterGroup
  title: string
  description: string
  /** Widest column count; the grid steps down from it on smaller viewports. */
  columns: 2 | 3
  /**
   * Whether the insight panel rides beside this section's only card.
   *
   * It exists to stop a lone register leaving two-thirds of a row empty, so it
   * is a property of the row's shape, not of valuation: give the group a second
   * register tomorrow and the row becomes an ordinary grid on its own.
   */
  insight: boolean
  tiles: RegisterHubTile[]
}

/**
 * Section accents.
 *
 * Movement carries the Aicountly accent itself (`primary`, whatever the palette
 * picker has it set to); stock position takes the informational blue; valuation
 * the mint. Analysis and commitments keep the violet and amber they already had
 * on this screen — the hub has five sections, not the three in the design, and
 * inventing two more hues for them would turn a controlled palette into a
 * rainbow.
 */
const GROUP_TONE: Record<RegisterGroup, IconTone> = {
  movement: 'primary',
  stock: 'info',
  valuation: 'teal',
  analysis: 'violet',
  compliance: 'warning',
}

const GROUP_COLUMNS: Record<RegisterGroup, 2 | 3> = {
  movement: 2,
  stock: 3,
  valuation: 3,
  analysis: 3,
  compliance: 3,
}

/**
 * The three cards that carry a visual, keyed by the register's own path.
 *
 * Deliberately a short allow-list rather than a rule: a sparkline on every card
 * is wallpaper, and wallpaper is what the eye learns to skip. These three are
 * the registers a reader opens most, and the shape of the mark says something
 * about each — a running line for a running balance, bars for a count of
 * movements, a line again for a value over time.
 */
const VISUALS: Record<string, RegisterVisual> = {
  'stock-ledger': 'sparkline',
  'movement-register': 'bars',
  valuation: 'sparkline',
}

/**
 * Every register the signed-in user may read, grouped and dressed.
 *
 * Permission filtering is a `filter`, exactly as it was before: a register the
 * user may not open does not appear, rather than appearing as a dead tile that
 * teases. A section left with nothing disappears with it.
 */
export function buildRegisterHubSections(
  can: (key: PermissionKey) => boolean,
): RegisterHubSection[] {
  return REGISTER_GROUP_ORDER.map((group) => {
    const tiles = registersInGroup(group)
      .filter((config) => can(registerPermission(config)))
      .map<RegisterHubTile>((config) => ({
        key: config.routePath ?? config.path,
        title: config.title,
        description: config.shortDescription ?? config.description ?? '',
        icon: config.icon,
        to: registerRoute(config),
        tone: config.tone ?? GROUP_TONE[group],
        visual: VISUALS[config.routePath ?? config.path] ?? 'none',
      }))
    return {
      key: group,
      title: REGISTER_GROUP_LABELS[group],
      description: REGISTER_GROUP_DESCRIPTIONS[group],
      columns: GROUP_COLUMNS[group],
      insight: group === 'valuation' && tiles.length === 1,
      tiles,
    }
  }).filter((section) => section.tiles.length > 0)
}
