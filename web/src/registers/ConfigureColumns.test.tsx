import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { ConfigureColumns } from './ConfigureColumns'
import type { ConfigurableColumn } from './ConfigureColumns'
import { defaultColumnVisibility } from './columnPrefs'

const columns: ConfigurableColumn[] = [
  { key: 'item_name', header: 'Item', alwaysVisible: true },
  { key: 'qty', header: 'Qty' },
  { key: 'value', header: 'Value' },
  { key: 'unit_cost', header: 'Unit cost', defaultVisible: false, configureHint: 'Discloses cost.' },
]

function open(visibility = defaultColumnVisibility(columns), onChange = vi.fn()) {
  render(<ConfigureColumns columns={columns} visibility={visibility} onChange={onChange} />)
  fireEvent.click(screen.getByRole('button', { name: /Columns/ }))
  return onChange
}

describe('ConfigureColumns', () => {
  it('counts the columns that are showing when some are off', () => {
    render(
      <ConfigureColumns
        columns={columns}
        visibility={defaultColumnVisibility(columns)}
        onChange={vi.fn()}
      />,
    )
    // 2 of the 3 configurable columns are on (unit_cost ships hidden).
    expect(screen.getByRole('button', { name: /Columns \(2\/3\)/ })).toBeTruthy()
  })

  it('drops the count when every configurable column is showing', () => {
    render(
      <ConfigureColumns
        columns={columns}
        visibility={{ item_name: true, qty: true, value: true, unit_cost: true }}
        onChange={vi.fn()}
      />,
    )
    const button = screen.getByRole('button', { name: /Columns/ })
    expect(button.textContent).toBe('Columns')
  })

  it('offers a checkbox per configurable column and none for the row identifier', () => {
    open()
    expect(screen.getByRole('checkbox', { name: 'Qty' })).toBeTruthy()
    expect(screen.getByRole('checkbox', { name: 'Value' })).toBeTruthy()
    expect(screen.getByRole('checkbox', { name: 'Unit cost' })).toBeTruthy()
    expect(screen.queryByRole('checkbox', { name: 'Item' })).toBeNull()
  })

  it('says which columns are always shown rather than offering a checkbox that does nothing', () => {
    open()
    expect(screen.getByText(/Always shown: Item\./)).toBeTruthy()
  })

  it('shows the hint under the column it belongs to', () => {
    open()
    expect(screen.getByText('Discloses cost.')).toBeTruthy()
    // The hint must not become part of the checkbox's accessible name, or two
    // columns whose names differ only by trailing words become indistinguishable.
    expect(screen.getByRole('checkbox', { name: 'Unit cost' })).toBeTruthy()
  })

  it('reflects what is on right now', () => {
    open()
    expect((screen.getByRole('checkbox', { name: 'Qty' }) as HTMLInputElement).checked).toBe(true)
    expect((screen.getByRole('checkbox', { name: 'Unit cost' }) as HTMLInputElement).checked).toBe(false)
  })

  it('reports the full map when one column is toggled', () => {
    const onChange = open()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Qty' }))
    expect(onChange).toHaveBeenCalledWith({
      item_name: true,
      qty: false,
      value: true,
      unit_cost: false,
    })
  })

  it('resets to the shipped columns, and cannot be reset when it already is', () => {
    const onChange = vi.fn()
    render(
      <ConfigureColumns columns={columns} visibility={{ qty: false }} onChange={onChange} />,
    )
    fireEvent.click(screen.getByRole('button', { name: /Columns/ }))
    const reset = screen.getByRole('button', { name: 'Reset to default' })
    expect((reset as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(reset)
    expect(onChange).toHaveBeenCalledWith(defaultColumnVisibility(columns))
  })

  it('disables reset when nothing has been changed', () => {
    open()
    expect((screen.getByRole('button', { name: 'Reset to default' }) as HTMLButtonElement).disabled).toBe(
      true,
    )
  })

  it('is disabled when every column is fixed — there is nothing to configure', () => {
    render(
      <ConfigureColumns
        columns={[{ key: 'a', header: 'A', alwaysVisible: true }]}
        visibility={{ a: true }}
        onChange={vi.fn()}
      />,
    )
    expect((screen.getByRole('button', { name: /Columns/ }) as HTMLButtonElement).disabled).toBe(true)
  })
})
