import { describe, expect, it } from 'vitest'
import { SYNC_STATUSES } from '../../services/reconciliationApi'
import { SYNC_MEANING, postingStatusCards, postingStatusLink } from './postingStatusCards'

describe('postingStatusCards', () => {
  it('turns the server summary into clickable cards in the vocabulary order', () => {
    const cards = postingStatusCards({ FAILED_INVENTORY: 3, IN_SYNC: 118 })
    expect(cards.map((c) => c.label)).toEqual(['In sync', 'Failed inventory'])
    expect(cards.map((c) => c.value)).toEqual(['118', '3'])
  })

  /**
   * The drill-down rule. The endpoint computes `summary` over every voucher and
   * applies the filters only to the rows it returns, so a link that carried the
   * screen's other filters would show fewer rows than the card counted.
   */
  it('links each card to exactly the rows it counted, and to no other filter', () => {
    const cards = postingStatusCards({ MISSING_IN_BOOKS: 4 })
    expect(cards[0].to).toBe('/reconciliation/posting-status?sync_status=MISSING_IN_BOOKS')
    expect(postingStatusLink('BOOKS_STATUS_UNKNOWN')).toBe(
      '/reconciliation/posting-status?sync_status=BOOKS_STATUS_UNKNOWN',
    )
  })

  it('says what every status the server can emit means', () => {
    for (const status of SYNC_STATUSES) {
      expect(SYNC_MEANING[status], status).toBeTruthy()
      expect(SYNC_MEANING[status].length, status).toBeGreaterThan(20)
    }
  })

  it('carries the meaning onto the card as its hint', () => {
    const [card] = postingStatusCards({ FAILED_INVENTORY: 3 })
    expect(card.hint).toBe(SYNC_MEANING.FAILED_INVENTORY)
    expect(card.tone).toBe('critical')
  })

  it('shows a status the vocabulary does not know rather than dropping the count', () => {
    const cards = postingStatusCards({ IN_SYNC: 1, SOMETHING_NEW: 2 })
    expect(cards.map((c) => c.label)).toEqual(['In sync', 'Something new'])
    expect(cards[1].to).toBe('/reconciliation/posting-status?sync_status=SOMETHING_NEW')
  })

  it('invents no zero for a status the server did not report', () => {
    expect(postingStatusCards({ IN_SYNC: 1 })).toHaveLength(1)
    expect(postingStatusCards(null)).toEqual([])
  })
})
