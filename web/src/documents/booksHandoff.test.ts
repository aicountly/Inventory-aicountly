import { describe, expect, it } from 'vitest'
import { ApiError } from '../services/api'
import { BOOKS_REFUSED, BOOKS_UNAVAILABLE, BOOKS_UNRESOLVED, parseBooksHandoff } from './booksHandoff'

const details = { document_id: 77, books_status: 0, books_error: 'Connection timed out after 8000 ms', reversed: true, handoff_id: 12 }

describe('parseBooksHandoff', () => {
  it('ignores anything that is not a books-handoff failure', () => {
    expect(parseBooksHandoff(new Error('x'))).toBeNull()
    expect(parseBooksHandoff(new ApiError(422, 'negative_stock_blocked', 'short', {}))).toBeNull()
    expect(parseBooksHandoff(new ApiError(500, 'internal_error', 'boom', {}))).toBeNull()
  })

  /**
   * The whole point of (d): the user is refused, and must be told WHY — that stock and the books
   * move together and Inventory will not post while the books are unreachable — or they will
   * retry, then re-enter the document, then work around it.
   */
  it('states the availability cost when the books are unreachable', () => {
    const b = parseBooksHandoff(new ApiError(503, BOOKS_UNAVAILABLE, 'server message', details))!
    expect(b.kind).toBe(BOOKS_UNAVAILABLE)
    expect(b.reversed).toBe(true)
    expect(b.message).toContain('no stock has changed')
    expect(b.advice).toContain('same movement in the same moment')
    expect(b.advice).toContain('no stock document can be posted until they answer')
    // The document really was posted and then reversed: it cannot be posted a second time, and
    // sending the user back to the Post button would only get them refused again.
    expect(b.advice).toMatch(/marked Reversed/i)
    expect(b.advice).toMatch(/enter it afresh/i)
    expect(b.booksError).toBe('Connection timed out after 8000 ms')
  })

  it('names the reason the books gave when they refused', () => {
    const b = parseBooksHandoff(new ApiError(409, BOOKS_REFUSED, 'server message', { ...details, books_status: 422, books_error: 'no stock-in-hand ledger is mapped' }))!
    expect(b.kind).toBe(BOOKS_REFUSED)
    expect(b.booksError).toBe('no stock-in-hand ledger is mapped')
    expect(b.message).toContain('refused')
    expect(b.message).toContain('no stock has changed')
    expect(b.advice).toMatch(/marked Reversed/i)
  })

  /**
   * The one case where something IS left behind. Telling this user "nothing changed" would send
   * them off to re-enter a document whose stock did move.
   */
  it('tells the user not to re-enter a document whose stock moved and was not undone', () => {
    const b = parseBooksHandoff(new ApiError(500, BOOKS_UNRESOLVED, 'server message', { ...details, reversed: false, reversal_error: 'period is locked' }))!
    expect(b.kind).toBe(BOOKS_UNRESOLVED)
    expect(b.reversed).toBe(false)
    expect(b.message).not.toContain('no stock has changed')
    expect(b.message).toMatch(/stock has moved/i)
    expect(b.advice).toMatch(/do not re-enter/i)
    expect(b.handoffId).toBe(12)
  })

  /** A build of the server that does not send the flag must not be read as "nothing changed". */
  it('never claims a reversal it was not told about', () => {
    const b = parseBooksHandoff(new ApiError(503, BOOKS_UNAVAILABLE, 'm', { document_id: 77 }))!
    expect(b.reversed).toBe(false)
    expect(b.message).not.toContain('was reversed')
    expect(b.advice).not.toMatch(/marked Reversed/i)
    expect(b.booksError).toBeNull()
    expect(b.handoffId).toBeNull()
  })
})
