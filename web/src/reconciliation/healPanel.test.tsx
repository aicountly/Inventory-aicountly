import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { HealPanel } from './HealPanel'

/*
 * The half of this panel that matters is the half that refuses. A button reporting success while
 * quietly skipping a manual journal, a missing source document or a corrupted cost layer would be
 * worse than no button — so the plan is always shown first, and what is being left alone is shown
 * beside what is being done.
 */

const api = vi.hoisted(() => ({ heal: vi.fn() }))
vi.mock('../services/reconciliationApi', () => ({ reconciliationApi: api }))

const plan = {
  dry_run: true,
  as_of: '2026-09-22',
  difference: -2270000,
  actions: [
    {
      bucket: 'pending_posting',
      action: 'deliver_outbox',
      amount: -12000,
      detail: '3 event(s) waiting to reach Books.',
      performed: false,
      result: null,
    },
  ],
  skipped: [
    { bucket: 'manual_journal', amount: 50000, reason: 'A person deliberately journalled the stock ledger.' },
    { bucket: 'valuation_method_variance', amount: -2200000, reason: 'Cost layers are never rewritten automatically.' },
  ],
}

beforeEach(() => api.heal.mockReset())

describe('fixing what is safe', () => {
  it('shows the plan before doing anything — the first press is always a dry run', async () => {
    api.heal.mockResolvedValue(plan)
    render(<HealPanel />)

    fireEvent.click(screen.getByRole('button', { name: /Fix what/ }))
    await screen.findByText(/3 event\(s\) waiting to reach Books/)

    expect(api.heal).toHaveBeenCalledWith(true)
    expect(api.heal).toHaveBeenCalledTimes(1)
  })

  it('names what it is leaving alone, beside what it will do', async () => {
    api.heal.mockResolvedValue(plan)
    render(<HealPanel />)

    fireEvent.click(screen.getByRole('button', { name: /Fix what/ }))
    await screen.findByText('Left alone, deliberately')
    expect(screen.getByText(/deliberately journalled the stock ledger/)).toBeTruthy()
    expect(screen.getByText(/Cost layers are never rewritten/)).toBeTruthy()
  })

  it('only performs the actions once the reader presses again', async () => {
    api.heal.mockResolvedValueOnce(plan)
    api.heal.mockResolvedValueOnce({ ...plan, dry_run: false, actions: [{ ...plan.actions[0], performed: true, result: 'sent 3, failed 0' }] })
    const onHealed = vi.fn()
    render(<HealPanel onHealed={onHealed} />)

    fireEvent.click(screen.getByRole('button', { name: /Fix what/ }))
    await screen.findByRole('button', { name: 'Do it' })
    fireEvent.click(screen.getByRole('button', { name: 'Do it' }))

    await screen.findByText(/sent 3, failed 0/)
    expect(api.heal).toHaveBeenNthCalledWith(2, false)
    expect(onHealed).toHaveBeenCalledOnce()
  })

  it('offers no "Do it" when nothing outstanding is safe to fix', async () => {
    api.heal.mockResolvedValue({ ...plan, actions: [] })
    render(<HealPanel />)

    fireEvent.click(screen.getByRole('button', { name: /Fix what/ }))
    await screen.findByText(/needs a person/)
    expect(screen.queryByRole('button', { name: 'Do it' })).toBeNull()
  })
})
