import { useMemo } from 'react'
import { useCompany } from '../company/CompanyContext'
import { useQuery } from '../hooks/useQuery'
import { NATIVE_DOCUMENT_TYPES } from '../documents/registry'
import { settingsApi } from '../services/settingsApi'
import type { FilterOption } from '../reports/types'

/**
 * Every document type the company has, for the `document_type` register filter.
 *
 * `GET /v1/document-types` returns the Books-sourced types as well as the
 * native ones, which matters here: the whole point of a movement register is to
 * see what arrived from Sales, Purchases and POS alongside what Inventory
 * entered itself. The static `NATIVE_DOCUMENT_TYPES` is the fallback so the
 * filter is never an empty dropdown while the request is in flight or if it
 * fails.
 */
export function useDocumentTypeOptions(): { options: FilterOption[]; loading: boolean } {
  const { scope } = useCompany()
  const { data, loading } = useQuery((signal) => settingsApi.documentTypes(signal), [scope?.cmp_id], {
    enabled: scope !== null,
  })

  const options = useMemo<FilterOption[]>(() => {
    const source = data?.length
      ? data.map((t) => ({ value: t.code, label: t.label }))
      : NATIVE_DOCUMENT_TYPES.map((t) => ({ value: t.code, label: t.label }))
    return [...source].sort((a, b) => a.label.localeCompare(b.label))
  }, [data])

  return { options, loading }
}
