import { describe, expect, it } from 'vitest'
import { categoryAppearance } from './categoryAppearance'
import type { IconTone } from '../../../ui/IconTile'

/**
 * Two properties, and both are about the reader rather than the palette.
 *
 * A row's colour has to be the same colour every time the list renders, or the
 * board reshuffles under somebody scanning it. And it has to come off
 * IconTile's tone ramp, because that ramp is the one the dark-mode retrofit
 * remaps — a tone from anywhere else is a bright block on a dark card.
 */

const TONES: IconTone[] = ['primary', 'success', 'warning', 'danger', 'info', 'violet', 'slate', 'rose', 'teal']

describe('categoryAppearance', () => {
  it('gives the same category the same look every time', () => {
    const row = { stock_cat_id: 42, cat_name: 'Unclassified bits', cat_alias: null }
    const first = categoryAppearance(row)
    for (let i = 0; i < 5; i += 1) {
      expect(categoryAppearance(row)).toEqual(first)
    }
  })

  it('keys the fallback on the id, so a rename does not repaint the row', () => {
    const before = categoryAppearance({ stock_cat_id: 42, cat_name: 'Widgts' })
    const after = categoryAppearance({ stock_cat_id: 42, cat_name: 'Widgets' })
    expect(after).toEqual(before)
  })

  it('recognises the categories every Aicountly company has', () => {
    expect(categoryAppearance({ stock_cat_id: 1, cat_name: 'Raw Material' }).tone).toBe('rose')
    expect(categoryAppearance({ stock_cat_id: 2, cat_name: 'Finished Goods' }).tone).toBe('success')
    expect(categoryAppearance({ stock_cat_id: 3, cat_name: 'Services' }).tone).toBe('teal')
    expect(categoryAppearance({ stock_cat_id: 4, cat_name: 'Capital Goods' }).tone).toBe('violet')
  })

  it('does not read "Semi-Finished Goods" as finished goods', () => {
    const semi = categoryAppearance({ stock_cat_id: 5, cat_name: 'Semi-Finished Goods' })
    const finished = categoryAppearance({ stock_cat_id: 6, cat_name: 'Finished Goods' })
    expect(semi.tone).not.toBe(finished.tone)
    expect(semi.icon).not.toBe(finished.icon)
  })

  it('only ever returns a tone the dark theme can remap', () => {
    for (let id = 1; id <= 60; id += 1) {
      expect(TONES).toContain(categoryAppearance({ stock_cat_id: id, cat_name: `Category ${id}` }).tone)
    }
  })

  it('still answers for a row with no id yet — the form preview has none', () => {
    const preview = categoryAppearance({ cat_name: 'Something new' })
    expect(TONES).toContain(preview.tone)
    expect(preview.icon).toBeTruthy()
  })
})
