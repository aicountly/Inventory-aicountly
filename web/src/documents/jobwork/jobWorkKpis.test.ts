import { describe, expect, it } from 'vitest'
import type { JobWorkSummary } from '../../services/jobWorkApi'
import { jobWorkKpis } from './JobWorkKpiStrip'

function summary(partial: Partial<JobWorkSummary> = {}): JobWorkSummary {
  return {
    as_on: '2026-09-18',
    window: { from: '2026-09-01', to: '2026-09-18' },
    previous_window: { from: '2026-08-01', to: '2026-08-18' },
    open: { qty: 120, orders: 8, items: 5, workers: 3 },
    due: { qty: 75, orders: 4, items: 3, workers: 2 },
    overdue: { qty: 20, orders: 2, items: 1, workers: 1 },
    received: { qty: 350, value: 248500, documents: 12, lines: 30 },
    received_previous: { qty: 312, value: 210000, documents: 10, lines: 26 },
    sent: { qty: 400, value: 310000, documents: 9, lines: 22 },
    sent_previous: { qty: 380, value: 300000, documents: 8, lines: 20 },
    turnaround: { days: 6.2, samples: 14 },
    turnaround_previous: { days: 7.6, samples: 11 },
    ...partial,
  }
}

describe('the job-work KPI strip', () => {
  it('answers the receipt screen with the receipt figures', () => {
    const keys = jobWorkKpis(summary(), 'in').map((k) => k.key)
    expect(keys).toEqual(['open', 'received', 'value', 'due', 'turnaround'])
  })

  it('answers the dispatch screen with the dispatch figures', () => {
    const keys = jobWorkKpis(summary(), 'out').map((k) => k.key)
    expect(keys).toEqual(['sent', 'challan_value', 'open', 'overdue', 'turnaround'])
  })

  it('counts the job orders behind the open position', () => {
    const open = jobWorkKpis(summary(), 'in').find((k) => k.key === 'open')!
    expect(open.value).toBe('120')
    expect(open.hint).toBe('8 job orders')
  })

  it('compares like with like, and only where a comparative was sent', () => {
    const cards = jobWorkKpis(summary(), 'in')
    const received = cards.find((k) => k.key === 'received')!
    expect(received.current).toBe(350)
    expect(received.previous).toBe(312)
    // The open position is a position, not a period: nothing to compare it to.
    expect(cards.find((k) => k.key === 'open')!.previous).toBeUndefined()
  })

  it('reads a shorter turnaround as the good direction', () => {
    const turnaround = jobWorkKpis(summary(), 'in').find((k) => k.key === 'turnaround')!
    expect(turnaround.invertDelta).toBe(true)
    expect(turnaround.value).toBe('6.2 days')
  })

  it('says nothing settled rather than showing a zero turnaround', () => {
    const turnaround = jobWorkKpis(summary({ turnaround: { days: null, samples: 0 } }), 'in').find((k) => k.key === 'turnaround')!
    expect(turnaround.value).toBe('—')
    expect(turnaround.hint).toBe('Nothing settled this month')
  })

  it('drops the alarm colour when nothing is late', () => {
    const quiet = summary({ overdue: { qty: 0, orders: 0, items: 0, workers: 0 } })
    const overdue = jobWorkKpis(quiet, 'out').find((k) => k.key === 'overdue')!
    expect(overdue.tone).toBe('slate')
    expect(overdue.hint).toBe('Nothing past its return date')
  })

  it('prints a zero position as 0 rather than an em dash', () => {
    const empty = summary({ open: { qty: 0, orders: 0, items: 0, workers: 0 } })
    expect(jobWorkKpis(empty, 'in').find((k) => k.key === 'open')!.value).toBe('0')
  })
})
