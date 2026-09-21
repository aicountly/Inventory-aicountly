import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { ItemAiSuggestDrawer } from './ItemAiSuggestDrawer'
import type { ItemSuggestion } from '../../services/inventoryAiService'

const SUGGESTIONS: ItemSuggestion[] = [
  { id: 'print-name', field: 'print_name', label: 'Print name', current: '', suggested: 'Ballpoint Pens', reason: 'Documents print this.' },
  { id: 'alias', field: 'item_alias', label: 'Alias', current: '', suggested: 'Pens', reason: 'The head word.' },
]

function open(props: Partial<React.ComponentProps<typeof ItemAiSuggestDrawer>> = {}) {
  const onApply = vi.fn()
  const view = render(
    <ItemAiSuggestDrawer open onClose={vi.fn()} loading={false} suggestions={SUGGESTIONS} onApply={onApply} {...props} />,
  )
  return { onApply, view }
}

describe('ItemAiSuggestDrawer', () => {
  it('starts with nothing selected and applies only what was ticked', () => {
    const { onApply } = open()
    expect((screen.getByRole('button', { name: /Apply selected/ }) as HTMLButtonElement).disabled).toBe(true)

    fireEvent.click(screen.getAllByRole('checkbox')[0])
    fireEvent.click(screen.getByRole('button', { name: /Apply 1 suggestion/ }))
    expect(onApply).toHaveBeenCalledWith([SUGGESTIONS[0]])
  })

  /**
   * The bug this pins: the reset that clears last visit's ticks used to key on `suggestions` as
   * well as `open`. The list is fetched AFTER the drawer opens, so its arrival fired the reset a
   * second time and silently unticked whatever had been chosen in between — leaving somebody one
   * click away from applying a selection they had not made.
   */
  it('keeps the ticks when the suggestions list is handed back a second time', () => {
    const { view } = open()
    fireEvent.click(screen.getAllByRole('checkbox')[0])
    expect(screen.getByRole('button', { name: /Apply 1 suggestion/ })).toBeTruthy()

    // The same list, a new array — exactly what a resolved fetch hands down.
    view.rerender(
      <ItemAiSuggestDrawer open onClose={vi.fn()} loading={false} suggestions={[...SUGGESTIONS]} onApply={vi.fn()} />,
    )
    expect(screen.getByRole('button', { name: /Apply 1 suggestion/ })).toBeTruthy()
  })

  it('clears the ticks when the drawer is closed and opened again', () => {
    const { view } = open()
    fireEvent.click(screen.getAllByRole('checkbox')[0])
    expect(screen.getByRole('button', { name: /Apply 1 suggestion/ })).toBeTruthy()

    const props = { onClose: vi.fn(), loading: false, suggestions: SUGGESTIONS, onApply: vi.fn() }
    view.rerender(<ItemAiSuggestDrawer open={false} {...props} />)
    view.rerender(<ItemAiSuggestDrawer open {...props} />)
    expect((screen.getByRole('button', { name: /Apply selected/ }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('says why no HSN is offered rather than guessing one', () => {
    open()
    expect(screen.getByText(/Tax classification is resolved in Books/)).toBeTruthy()
  })

  it('has nothing to say when every field is already filled', () => {
    open({ suggestions: [] })
    expect(screen.getByText('Nothing to suggest')).toBeTruthy()
  })
})
