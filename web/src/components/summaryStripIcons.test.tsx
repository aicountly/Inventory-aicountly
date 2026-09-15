import { Boxes } from 'lucide-react'
import { render } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { SummaryStrip } from './SummaryStrip'
import { IconTile } from '../ui/IconTile'

/**
 * A KPI tile has a glyph in it, or it is not a tile.
 *
 * StatCard always draws IconTile, and IconTile draws a toned 32px square. Pass
 * no icon and both still render — the card gets a blank coloured block where the
 * glyph should be, on every report and register header that uses this strip.
 */

function markup(node: React.ReactNode): string {
  const { container } = render(<MemoryRouter>{node}</MemoryRouter>)
  return container.innerHTML
}

const items = [
  { label: 'Rows', value: 12 },
  { label: 'Available (page)', value: '40', tone: 'good' as const },
  { label: 'Negative', value: '2', tone: 'critical' as const },
]

describe('SummaryStrip', () => {
  it('gives every card a glyph, whatever its tone', () => {
    const html = markup(<SummaryStrip items={items} />)
    const tiles = html.match(/rounded-lg/g) ?? []
    const glyphs = html.match(/lucide-/g) ?? []
    expect(tiles.length).toBe(items.length)
    expect(glyphs.length).toBe(items.length)
  })

  it('lets a caller name a better glyph than the tone default', () => {
    const html = markup(<SummaryStrip items={[{ label: 'Rows', value: 12, icon: Boxes }]} />)
    expect(html).toContain('lucide-boxes')
  })
})

describe('IconTile', () => {
  it('draws nothing at all when there is no icon', () => {
    expect(markup(<IconTile tone="danger" size="sm" />)).toBe('')
  })
})
