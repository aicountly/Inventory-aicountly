import { useEffect, useMemo, useState } from 'react'
import { useCompany } from '../../company/CompanyContext'
import { errorMessage, isAbortError } from '../../services/api'
import { documentsApi } from '../../services/documentsApi'
import { toNumber } from '../../utils/format'
import type { DocumentLine, DocumentListRow, DocumentStatus } from '../types'

export interface RecentAssemblyRow {
  raw: DocumentListRow
  document_id: number
  document_no: string | null
  document_date: string
  status: DocumentStatus
  /** From the document's `in` line — what the assembly built. */
  finishedItem: string | null
  finishedQty: number | null
  unitSymbol: string | null
  warehouse: string | null
  componentCount: number
  valuationTotal: number
}

export interface RecentAssembliesState {
  rows: RecentAssemblyRow[]
  loading: boolean
  error: string | null
  reload: () => void
}

/** Summarise one document's lines into the two halves the register column set names. */
export function summariseAssemblyLines(row: DocumentListRow, lines: readonly DocumentLine[]): RecentAssemblyRow {
  const finished = lines.find((l) => l.direction === 'in') ?? null
  const components = lines.filter((l) => l.direction === 'out')
  return {
    raw: row,
    document_id: row.document_id,
    document_no: row.document_no,
    document_date: row.document_date,
    status: row.status,
    finishedItem: finished ? (finished.item_label ?? finished.item_name ?? `Item #${finished.item_id}`) : null,
    finishedQty: finished ? (toNumber(finished.qty) ?? null) : null,
    unitSymbol: finished?.unit_symbol ?? null,
    warehouse: finished?.warehouse_name ?? components[0]?.warehouse_name ?? null,
    componentCount: components.length,
    valuationTotal: toNumber(row.valuation_total) ?? 0,
  }
}

/**
 * The last few assemblies in the selected scope, with enough of each one to be worth a row.
 *
 * Two requests, not `limit + 1`: the list endpoint carries a line COUNT and no line detail, so
 * the lines of all five documents are fetched in ONE batched call (`documentsApi.lines`) rather
 * than five.
 *
 * A failure to load the lines is NOT a failure of the panel — the dates, numbers and statuses are
 * already true, and a register that blanks itself because a secondary read timed out is less
 * useful than one that shows what it has.
 */
export function useRecentAssemblies(limit = 5): RecentAssembliesState {
  const { scope } = useCompany()
  const scopeKey = scope ? `${scope.cmp_id}:${scope.fy_id}:${scope.bo_id}` : null
  const [rows, setRows] = useState<RecentAssemblyRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    if (scopeKey === null) return undefined
    const controller = new AbortController()
    let active = true
    setLoading(true)
    setError(null)
    setRows([])

    documentsApi
      .list({ document_type: 'ASSEMBLY', limit, sort: 'document_date', order: 'desc' }, controller.signal)
      .then(async (res) => {
        if (!active || controller.signal.aborted) return
        const list = res.data ?? []
        let byDocument: Record<number, DocumentLine[]> = {}
        try {
          byDocument = await documentsApi.lines(
            list.map((r) => r.document_id),
            controller.signal,
          )
        } catch (err) {
          if (isAbortError(err)) return
          byDocument = {}
        }
        if (!active || controller.signal.aborted) return
        setRows(list.map((r) => summariseAssemblyLines(r, byDocument[r.document_id] ?? [])))
        setLoading(false)
      })
      .catch((err: unknown) => {
        if (!active || controller.signal.aborted || isAbortError(err)) return
        setError(errorMessage(err, 'Recent assemblies could not be loaded.'))
        setLoading(false)
      })

    return () => {
      active = false
      controller.abort()
    }
  }, [scopeKey, limit, tick])

  return useMemo(
    () => ({ rows, loading, error, reload: () => setTick((t) => t + 1) }),
    [rows, loading, error],
  )
}
