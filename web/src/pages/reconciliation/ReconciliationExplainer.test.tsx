import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ReconciliationExplainer } from './ReconciliationExplainer'

/**
 * The product owner asked what reconciliation is even for now that both apps
 * use one live API. The answer has to be on the screen, in words, not in a
 * code comment — so these assert the rendered text, and they fail if the
 * explanation is dropped or reduced to a status vocabulary.
 */
describe('ReconciliationExplainer', () => {
  it('says what a run compares and what its difference means', () => {
    render(<ReconciliationExplainer screen="runs" />)
    const text = document.body.textContent ?? ''
    expect(text).toContain('closing value of the stock Inventory holds')
    expect(text).toContain('Stock-in-Hand balance in the Books ledger')
    expect(text).toContain('difference is Inventory minus Books')
    expect(text).toContain('Zero means')
  })

  it('says posting status is the document-by-document view, and what to clear first', () => {
    render(<ReconciliationExplainer screen="posting-status" />)
    const text = document.body.textContent ?? ''
    expect(text).toContain('document by document')
    expect(text).toMatch(/Clear the failed and the missing rows first/)
  })

  it('says what the outbox holds and what a dead event costs', () => {
    render(<ReconciliationExplainer screen="outbox" />)
    const text = document.body.textContent ?? ''
    expect(text).toContain('queue Inventory uses to tell Books')
    expect(text).toContain('used up its retries')
  })

  it('explains, on every screen, why one live API still leaves room to disagree', () => {
    for (const screen of ['runs', 'posting-status', 'outbox'] as const) {
      const view = render(<ReconciliationExplainer screen={screen} />)
      const text = document.body.textContent ?? ''
      // The mechanism: not atomic, and nothing runs on a schedule.
      expect(text, screen).toContain('posting is not one transaction')
      expect(text, screen).toContain('no background job')
      expect(text, screen).toContain('waits for the next person')
      view.unmount()
    }
  })

  it('offers the explanation as a disclosure the reader can open on the screen', () => {
    render(<ReconciliationExplainer screen="runs" />)
    expect(
      screen.getByText(/Both apps use the same live API — so why can they disagree\?/),
    ).toBeTruthy()
  })
})
