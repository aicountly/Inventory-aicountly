import { useRef } from 'react'
import type { ItemSection } from './itemSections'
import { sectionDomId } from './itemSections'
import { AIC, cx } from '../../ui/cx'

/**
 * The sticky strip under the page header: eight anchors into one long workspace.
 *
 * It is navigation, not tabs. Nothing is hidden behind these — every section is on the page at
 * once and scrolling past one is a perfectly good way to reach the next. So the markup is a `nav`
 * of buttons with `aria-current="location"` on the one being read, rather than a `tablist` whose
 * `aria-selected` would promise a reader that the other seven panels are not rendered.
 *
 * Keyboard: one tab stop for the whole strip (roving `tabindex`), then Left/Right to move between
 * anchors and Home/End to reach the ends — the pattern a toolbar uses, so eight buttons do not
 * cost eight presses of Tab on the way to the form.
 */
export function ItemSectionNav({
  sections,
  active,
  onSelect,
  className,
}: {
  sections: readonly ItemSection[]
  /** The DOM id of the section being read — what the spy reports, not the short section id. */
  active: string
  /** Called with the section's DOM id, the same currency the spy and every jump link use. */
  onSelect: (domId: string) => void
  className?: string
}) {
  const listRef = useRef<HTMLDivElement>(null)

  const move = (delta: number | 'first' | 'last') => {
    const buttons = [...(listRef.current?.querySelectorAll<HTMLButtonElement>('button[data-section]') ?? [])]
    if (buttons.length === 0) return
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement)
    const next =
      delta === 'first'
        ? 0
        : delta === 'last'
          ? buttons.length - 1
          : (Math.max(at, 0) + delta + buttons.length) % buttons.length
    const target = buttons[next]
    target?.focus()
    target?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }

  return (
    <nav
      aria-label="Item sections"
      className={cx(
        AIC,
        // `top-0`, not an offset: the app's scrollport is `main`, and the topbar sits outside it.
        'sticky top-0 z-20 print:hidden',
        className,
      )}
    >
      <div
        ref={listRef}
        className={cx(
          'flex items-center gap-1 overflow-x-auto rounded-xl border border-gray-200 bg-white/95 px-1.5 py-1',
          'shadow-card backdrop-blur supports-[backdrop-filter]:bg-white/85',
          '[scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
        )}
        onKeyDown={(e) => {
          if (e.key === 'ArrowRight') {
            e.preventDefault()
            move(1)
          } else if (e.key === 'ArrowLeft') {
            e.preventDefault()
            move(-1)
          } else if (e.key === 'Home') {
            e.preventDefault()
            move('first')
          } else if (e.key === 'End') {
            e.preventDefault()
            move('last')
          }
        }}
      >
        {sections.map((section) => {
          const domId = sectionDomId(section.id)
          const isActive = domId === active
          return (
            <button
              key={section.id}
              type="button"
              data-section={section.id}
              tabIndex={isActive ? 0 : -1}
              aria-current={isActive ? 'location' : undefined}
              aria-controls={domId}
              onClick={() => onSelect(domId)}
              className={cx(
                'inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-2.5 py-1.5 text-xs font-semibold',
                'transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
                isActive
                  ? 'bg-primary-light text-primary'
                  : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900',
              )}
            >
              <section.icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
              {section.label}
            </button>
          )
        })}
      </div>
    </nav>
  )
}

export default ItemSectionNav
