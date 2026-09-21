/**
 * `/v1/job-work/*` — the aggregate above the job-work entry screens and the
 * job workers this company has dealt with.
 *
 * There is nothing here that creates or posts a job-work document: a dispatch
 * and a receipt are ordinary inventory documents and go through
 * `documentsApi`, so every rule they carry (numbering, valuation, settlement,
 * negative stock, period locks) stays in one place. The open position is the
 * pending register (`pendingApi.list({ kind: 'job_work' })`).
 */

import { api } from './api'
import type { ItemResponse, ListResponse } from './api'

export interface JobWorkWindow {
  from: string
  to: string
}

/** What is still out with job workers, or the part of it that is due / late. */
export interface JobWorkOpenPosition {
  qty: number
  orders: number
  items: number
  workers: number
}

/**
 * What moved in the window. `value` is the receipt's inventory value on an
 * inward and the challan value on an outward — different figures, labelled
 * differently by the caller, never mixed.
 */
export interface JobWorkMovement {
  qty: number
  value: number
  documents: number
  lines: number
}

export interface JobWorkTurnaround {
  /** Average days from dispatch to settlement; null when nothing settled. */
  days: number | null
  samples: number
}

export interface JobWorkSummary {
  as_on: string
  window: JobWorkWindow
  previous_window: JobWorkWindow
  open: JobWorkOpenPosition
  due: JobWorkOpenPosition
  overdue: JobWorkOpenPosition
  received: JobWorkMovement
  received_previous: JobWorkMovement
  sent: JobWorkMovement
  sent_previous: JobWorkMovement
  turnaround: JobWorkTurnaround
  turnaround_previous: JobWorkTurnaround
}

/** One job worker, as Inventory's own job-work documents know them. */
export interface JobWorkerRow {
  /** Books ledger id (acc_id). Books owns the ledger; this is the reference. */
  party_ref: number
  party_name: string | null
  documents: number
  last_sent_on: string | null
  last_received_on: string | null
  last_document_date: string | null
  open_qty: number
  open_orders: number
}

export const jobWorkApi = {
  async summary(signal?: AbortSignal): Promise<JobWorkSummary> {
    const res = await api.get<ItemResponse<JobWorkSummary>>('v1/job-work/summary', { signal })
    return res.data
  },

  workers(q = '', limit = 20, signal?: AbortSignal): Promise<ListResponse<JobWorkerRow>> {
    return api.list<JobWorkerRow>('v1/job-work/workers', { q, limit }, { signal })
  },
}
