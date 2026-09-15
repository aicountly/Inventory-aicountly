import { describe, expect, it } from 'vitest'
import { matchRoutes } from 'react-router-dom'
import { documentRoutes } from './routes'
import { DocumentEntryHubPage } from './DocumentEntryHubPage'
import { DocumentFormPage } from './DocumentFormPage'
import { DocumentDetailPage } from './DocumentDetailPage'

/**
 * `/documents/new` has to out-rank `/documents/:id`, or the nav's "New
 * document" lands on the detail screen trying to load document "new".
 * react-router ranks static segments above dynamic ones; this asserts the
 * result rather than trusting it, because the whole entry-point fix hangs on it.
 */

function elementOf(pathname: string) {
  const matched = matchRoutes(documentRoutes, pathname)
  expect(matched, pathname).toBeTruthy()
  return (matched![matched!.length - 1].route as { element?: { type?: unknown } }).element?.type
}

describe('document routes', () => {
  it('resolves /documents/new to the entry hub, not to the detail screen', () => {
    expect(elementOf('/documents/new')).toBe(DocumentEntryHubPage)
  })

  it('still resolves the per-type form and the detail screen', () => {
    expect(elementOf('/documents/new/stock_journal')).toBe(DocumentFormPage)
    expect(elementOf('/documents/412')).toBe(DocumentDetailPage)
    expect(elementOf('/documents/412/edit')).toBe(DocumentFormPage)
  })
})
