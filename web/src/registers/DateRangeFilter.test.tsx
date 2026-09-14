import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { DateRangeFilter } from './DateRangeFilter'

const ctx = { today: '2026-09-14', fyFrom: '2026-04-01', fyTo: '2027-03-31' }

function renderFilter(from: string, to: string, onChange = vi.fn(), props = {}) {
  render(<DateRangeFilter from={from} to={to} ctx={ctx} onChange={onChange} {...props} />)
  return onChange
}

describe('DateRangeFilter', () => {
  it('names the preset the current dates correspond to', () => {
    renderFilter('2026-04-01', '2027-03-31')
    expect((screen.getByLabelText('Period preset') as HTMLSelectElement).value).toBe('fy')
  })

  it('reads as Custom when the dates match no preset', () => {
    renderFilter('2026-05-02', '2026-05-09')
    expect((screen.getByLabelText('Period preset') as HTMLSelectElement).value).toBe('custom')
    expect(screen.getByText('custom')).toBeTruthy()
  })

  it('writes both dates in one change when a preset is picked', () => {
    // One navigation, not two: the dropdown is a view of the two dates, so it
    // can never end up disagreeing with them.
    const onChange = renderFilter('2026-04-01', '2027-03-31')
    fireEvent.change(screen.getByLabelText('Period preset'), { target: { value: 'this_month' } })
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith({ from: '2026-09-01', to: '2026-09-30' })
  })

  it('keeps the typed dates when Custom is chosen', () => {
    const onChange = renderFilter('2026-05-02', '2026-05-09')
    fireEvent.change(screen.getByLabelText('Period preset'), { target: { value: 'custom' } })
    expect(onChange).not.toHaveBeenCalled()
  })

  it('moves to Custom when one end is typed', () => {
    const onChange = renderFilter('2026-04-01', '2027-03-31')
    fireEvent.change(screen.getByLabelText('Period from'), { target: { value: '2026-06-01' } })
    expect(onChange).toHaveBeenCalledWith({ from: '2026-06-01', to: '2027-03-31' })
  })

  it('stops the two boxes crossing over', () => {
    renderFilter('2026-04-01', '2026-06-30')
    expect((screen.getByLabelText('Period from') as HTMLInputElement).max).toBe('2026-06-30')
    expect((screen.getByLabelText('Period to') as HTMLInputElement).min).toBe('2026-04-01')
  })

  it('hides the date boxes when the range is All dates', () => {
    renderFilter('', '')
    expect((screen.getByLabelText('Period preset') as HTMLSelectElement).value).toBe('all')
    expect(screen.queryByLabelText('Period from')).toBeNull()
  })

  it('can refuse to offer All dates for a register that must be bounded', () => {
    renderFilter('2026-04-01', '2027-03-31', vi.fn(), { allowAllDates: false })
    const select = screen.getByLabelText('Period preset') as HTMLSelectElement
    expect(Array.from(select.options).some((o) => o.value === 'all')).toBe(false)
  })

  it('uses the label it is given for both the control and its boxes', () => {
    renderFilter('2026-04-01', '2027-03-31', vi.fn(), { label: 'Run between' })
    expect(screen.getByLabelText('Run between preset')).toBeTruthy()
    expect(screen.getByLabelText('Run between from')).toBeTruthy()
    expect(screen.getByLabelText('Run between to')).toBeTruthy()
  })
})
