import { Link } from 'react-router-dom'
import { ChevronRight, FileText } from 'lucide-react'
import { IconTile } from '../../ui/IconTile'
import { AIC, cx } from '../../ui/cx'
import { RegisterCardVisual } from './RegisterCardVisual'
import type { RegisterHubTile } from './registersHubModel'

/**
 * One register, as a door.
 *
 * A `Link`, not a div with a click handler: the whole card is the target, so
 * the whole card has to be the anchor — that is what gives it Enter, the
 * browser's own focus ring, middle-click, "open in new tab" and a status-bar
 * URL for free. The accessible name is the title and the description together,
 * which is also what the hub's test reads it by.
 *
 * `wide` is the single-card row beside the insight panel: same card, more room
 * for the mark on the right.
 */
export interface RegisterCardProps {
  tile: RegisterHubTile
  wide?: boolean
}

export function RegisterCard({ tile, wide = false }: RegisterCardProps) {
  return (
    <Link
      to={tile.to}
      className={cx(
        AIC,
        'group flex min-h-[5.5rem] min-w-0 items-center gap-3.5 rounded-xl border border-gray-200 bg-white p-4',
        'text-inherit no-underline shadow-card',
        // Under 200ms, and nothing that moves more than a pixel: a menu that
        // bounces is a menu people stop trusting.
        'transition-[transform,border-color,box-shadow,background-color] duration-150 ease-out',
        'hover:-translate-y-px hover:border-primary/40 hover:bg-primary-light/30 hover:shadow-overlay',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30',
        'motion-reduce:transition-none motion-reduce:hover:translate-y-0',
      )}
    >
      <IconTile icon={tile.icon ?? FileText} tone={tile.tone} size="lg" />
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold leading-tight text-gray-900 transition-colors group-hover:text-primary">
          {tile.title}
        </span>
        <span className="mt-1 block text-xs leading-relaxed text-gray-500">{tile.description}</span>
      </span>
      {/* The mark is the first thing to go when the row narrows — it is
          decoration, and the title and description are not. The wide card holds
          two thirds of its row, so it has the room a breakpoint earlier than a
          card sharing a two-up grid.

          The wrapper owns visibility and the mark owns its own display, so
          `hidden` and the bars' `flex` never land in one class list and leave
          the winner to stylesheet order.

          Breakpoints stop at `xl` throughout this screen: this build does not
          emit `2xl:` or arbitrary `min-[…]:` variants, so a rule written at one
          would silently do nothing in production. Both branches are also
          written out in full — Tailwind reads this file as text, and a composed
          class name is a class name the stylesheet never gets. */}
      {tile.visual === 'none' ? null : (
        <span className={cx('hidden shrink-0', wide ? 'lg:block' : 'xl:block')}>
          <RegisterCardVisual visual={tile.visual} tone={tile.tone} />
        </span>
      )}
      <ChevronRight
        aria-hidden
        className="h-5 w-5 shrink-0 text-gray-400 transition-transform duration-150 group-hover:translate-x-0.5 group-hover:text-primary motion-reduce:transition-none motion-reduce:group-hover:translate-x-0"
      />
    </Link>
  )
}

export default RegisterCard
