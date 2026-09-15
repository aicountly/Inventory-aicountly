import { useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ReportPage } from '../reports/ReportPage'
import { documentsRegister } from './documentsRegister'
import './documents.css'

/**
 * `/documents` — the inventory documents register.
 *
 * Rendered by the shared register engine (`reports/ReportPage`), which is what
 * brings the filter bar, server-side paging and sorting, per-user column
 * configuration, the KPI strip, the pinned totals row, drill-through, Ctrl+P on
 * the letterheaded sheet, and CSV / Excel / PDF / print exports that walk the
 * WHOLE filtered result through `fetchAll` rather than the page on screen.
 *
 * `?document_type=<CODE>` is the URL Books links to when it hands a historical
 * register over (books-react-app .../registers/inventoryHistoricalRegisters.js
 * lists the eight codes). It is a declared filter, so the engine narrows the
 * rows; reading it here as well is what names the type in the heading and the
 * breadcrumb, so the reader can see they landed on the Stock Transfer register
 * and not on a generic list that happens to be filtered.
 */
export function DocumentsListPage() {
  const [params] = useSearchParams()
  // Comma-separated codes are accepted by the API. A heading can only name one
  // type, so a multi-code filter keeps the general heading rather than naming
  // the first and implying the rest are not there.
  const raw = params.get('document_type')?.trim() ?? ''
  const documentType = raw && !raw.includes(',') ? raw.toUpperCase() : null

  const config = useMemo(() => documentsRegister(documentType), [documentType])

  return <ReportPage config={config} />
}

export default DocumentsListPage
