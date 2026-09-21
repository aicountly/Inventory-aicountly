import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { ItemSectionNav } from './ItemSectionNav'
import { ITEM_SECTIONS, sectionDomId } from './itemSections'

/**
 * The nav and the section spy have to speak the same language.
 *
 * The spy reports the DOM id of the section being read (`item-section-units`), because that is
 * what it observes and what every jump link — an insight, a quick link, a validation error —
 * hands back. The nav's own list is keyed by the short section id (`units`). Comparing the two
 * directly is a bug that typechecks perfectly and leaves the strip permanently unhighlighted with
 * every tab click a no-op, which is exactly why it is pinned here.
 */
function nav(active = sectionDomId('basic'), onSelect = vi.fn()) {
  render(<ItemSectionNav sections={ITEM_SECTIONS} active={active} onSelect={onSelect} />)
  return onSelect
}

describe('ItemSectionNav', () => {
  it('marks the section the spy reports, by its DOM id', () => {
    nav(sectionDomId('units'))
    expect(screen.getByRole('button', { name: /Units & Packaging/ }).getAttribute('aria-current')).toBe('location')
    expect(screen.getByRole('button', { name: /Basic Details/ }).getAttribute('aria-current')).toBeNull()
  })

  it('selects with the DOM id the spy can resolve', () => {
    const onSelect = nav()
    fireEvent.click(screen.getByRole('button', { name: /Stock & Locations/ }))
    expect(onSelect).toHaveBeenCalledWith('item-section-stock')
  })

  it('points each tab at the section it controls', () => {
    nav()
    const tabs = screen.getAllByRole('button')
    expect(tabs).toHaveLength(ITEM_SECTIONS.length)
    ITEM_SECTIONS.forEach((section, i) => {
      expect(tabs[i].textContent).toBe(section.label)
      expect(tabs[i].getAttribute('aria-controls')).toBe(sectionDomId(section.id))
    })
  })

  /** One tab stop for eight anchors: the toolbar pattern, so Tab still reaches the form quickly. */
  it('keeps a single tab stop and moves between tabs with the arrow keys', () => {
    nav(sectionDomId('basic'))
    const tabs = screen.getAllByRole('button')
    expect(tabs.filter((t) => t.getAttribute('tabindex') === '0')).toHaveLength(1)
    expect(tabs[0].getAttribute('tabindex')).toBe('0')

    tabs[0].focus()
    fireEvent.keyDown(tabs[0], { key: 'ArrowRight' })
    expect(document.activeElement).toBe(tabs[1])

    fireEvent.keyDown(tabs[1], { key: 'End' })
    expect(document.activeElement).toBe(tabs[tabs.length - 1])

    fireEvent.keyDown(tabs[tabs.length - 1], { key: 'Home' })
    expect(document.activeElement).toBe(tabs[0])

    // Left from the first wraps to the last rather than trapping at the edge.
    fireEvent.keyDown(tabs[0], { key: 'ArrowLeft' })
    expect(document.activeElement).toBe(tabs[tabs.length - 1])
  })
})
