import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { ReconciliationExplainer } from './ReconciliationExplainer'
import type { ReconciliationScreen } from './ReconciliationExplainer'

/**
 * The product owner asked what reconciliation is even for now that both apps
 * use one live API. The answer has to be on the screen, in words, not in a
 * code comment — so these assert the rendered text, and they fail if the
 * explanation is dropped or reduced to a status vocabulary.
 *
 * The panel is compact now: the sentence that decides what a number MEANS is
 * always visible, and the reasoning behind it is one click away. So each test
 * says which of the two it is checking.
 */
const TITLES: Record<ReconciliationScreen, RegExp> = {
  runs: /How reconciliation works/,
  'posting-status': /How pending adjustments work/,
  outbox: /How the audit trail works/,
}

function open(screenName: ReconciliationScreen) {
  render(<ReconciliationExplainer screen={screenName} />)
  fireEvent.click(screen.getByRole('button', { name: TITLES[screenName] }))
}

describe('ReconciliationExplainer', () => {
  it('states the sign convention without being opened at all', () => {
    render(<ReconciliationExplainer screen="runs" />)
    expect(document.body.textContent).toContain('Difference = Inventory − Books')
    expect(document.body.textContent).toContain('Zero means')
  })

  it('says what a run compares and what its difference means', () => {
    open('runs')
    const text = document.body.textContent ?? ''
    expect(text).toContain('closing value of the stock Inventory holds')
    expect(text).toContain('Stock-in-Hand balance in the Books ledger')
    expect(text).toContain('difference is Inventory minus Books')
    expect(text).toContain('Zero means')
  })

  it('says posting status is the document-by-document view, and what to clear first', () => {
    open('posting-status')
    const text = document.body.textContent ?? ''
    expect(text).toContain('document by document')
    expect(text).toMatch(/Clear the failed and the missing rows first/)
  })

  it('says what the outbox holds and what a dead event costs', () => {
    open('outbox')
    const text = document.body.textContent ?? ''
    expect(text).toContain('queue Inventory uses to tell Books')
    expect(text).toContain('used up its retries')
  })

  it('explains, on every screen, why one live API still leaves room to disagree', () => {
    for (const name of ['runs', 'posting-status', 'outbox'] as const) {
      const view = render(<ReconciliationExplainer screen={name} />)
      fireEvent.click(screen.getByRole('button', { name: TITLES[name] }))
      const text = document.body.textContent ?? ''
      // The mechanism: not atomic, and nothing runs on a schedule.
      expect(text, name).toContain('posting is not one transaction')
      expect(text, name).toContain('no background job')
      expect(text, name).toContain('waits for the next person')
      // And the fix is never to wire the two databases together.
      expect(text, name).toContain("copies the other's tables")
      view.unmount()
    }
  })

  it('offers the explanation as a disclosure the reader can open on the screen', () => {
    render(<ReconciliationExplainer screen="runs" />)
    const toggle = screen.getByRole('button', { name: /How reconciliation works/ })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(document.body.textContent).not.toContain('posting is not one transaction')
    fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(document.body.textContent).toContain('posting is not one transaction')
  })
})
