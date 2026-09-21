/**
 * What each direction of the job-work workflow is called and what it promises.
 *
 * One file, so the heading, the subtitle, the chips under the form, the
 * assistant's copy and the table's column set can never describe a dispatch on
 * a screen that is actually keying a receipt.
 */

import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Boxes,
  ClipboardCheck,
  Link2,
  PackageSearch,
  ScanLine,
  Timer,
  Warehouse,
  Zap,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { JobWorkMode } from './jobWorkModel'

export interface ContextChip {
  key: string
  label: string
  icon: LucideIcon
  /** The first chip states what the document IS; the rest are what it does. */
  primary?: boolean
}

export interface AssistantAction {
  key: AssistantActionKey
  label: string
  icon: LucideIcon
}

export type AssistantActionKey =
  | 'fetch_pending'
  | 'scan'
  | 'paste'
  | 'valuation'
  | 'availability'
  | 'open_jobs'

export interface JobWorkModeSpec {
  mode: JobWorkMode
  code: string
  slug: string
  title: string
  /** "New job work inward" on the create screen. */
  newTitle: string
  subtitle: string
  icon: LucideIcon
  detailsTitle: string
  linesTitle: string
  linesSubtitle: string
  warehouseLabel: string
  warehouseHelp: string
  qtyLabel: string
  valueLabel: string
  valueHint: string
  chips: ContextChip[]
  assistant: {
    question: string
    answer: string
    cta: string
    tip: string
    actions: AssistantAction[]
  }
}

const INWARD: JobWorkModeSpec = {
  mode: 'in',
  code: 'JOB_WORK_IN',
  slug: 'job_work_in',
  title: 'Job Work Inward',
  newTitle: 'New Job Work Inward',
  subtitle: 'Receive finished goods from a job worker and settle the pending quantities.',
  icon: ArrowDownToLine,
  detailsTitle: 'Job Work Inward Details',
  linesTitle: 'Items / Finished Goods',
  linesSubtitle: 'What is coming back. Material the job worker consumed is added by the settlement panel.',
  warehouseLabel: 'Warehouse',
  warehouseHelp: 'Where the finished goods are received. Pre-fills new lines.',
  qtyLabel: 'Receive qty',
  valueLabel: 'Inventory value',
  valueHint: 'Unit cost × quantity — what the goods coming back cost, not the challan value.',
  chips: [
    { key: 'finished', label: 'Finished goods from job worker', icon: ClipboardCheck, primary: true },
    { key: 'match', label: 'Auto-match with pending outward', icon: Link2 },
    { key: 'pending', label: 'Settles pending quantity', icon: Timer },
    { key: 'trace', label: 'Batch / serial traceability', icon: Boxes },
    { key: 'live', label: 'Real-time stock update', icon: Zap },
  ],
  assistant: {
    question: 'Receiving against a job order?',
    answer: 'Pull the open dispatches for this job worker, fill the lines from what is still pending, and settle the quantities in one pass.',
    cta: 'Show pending outward',
    tip: 'Pick a Job Work Outward document to auto-fill items and the quantities still open on it.',
    actions: [
      { key: 'fetch_pending', label: 'Fetch pending', icon: PackageSearch },
      { key: 'scan', label: 'Scan barcode', icon: ScanLine },
      { key: 'paste', label: 'Paste rows', icon: ClipboardCheck },
      { key: 'valuation', label: 'Stock effect', icon: Boxes },
    ],
  },
}

const OUTWARD: JobWorkModeSpec = {
  mode: 'out',
  code: 'JOB_WORK_OUT',
  slug: 'job_work_out',
  title: 'Job Work Outward',
  newTitle: 'New Job Work Outward',
  subtitle: 'Send material to a job worker and track the quantity until it is settled.',
  icon: ArrowUpFromLine,
  detailsTitle: 'Job Work Outward Details',
  linesTitle: 'Materials sent to job worker',
  linesSubtitle: 'The goods stay yours. Each line opens a pending quantity that a receipt later settles.',
  warehouseLabel: 'Source warehouse',
  warehouseHelp: 'Where the material leaves from. Pre-fills new lines.',
  qtyLabel: 'Send qty',
  valueLabel: 'Challan value',
  valueHint: 'The value declared on the dispatch challan. Nothing is costed here — the stock never leaves your ownership.',
  chips: [
    { key: 'issued', label: 'Material issued to job worker', icon: ClipboardCheck, primary: true },
    { key: 'track', label: 'Tracks pending return', icon: Timer },
    { key: 'bucket', label: 'Moves stock to the job-worker bucket', icon: Warehouse },
    { key: 'trace', label: 'Batch / serial traceability', icon: Boxes },
    { key: 'live', label: 'Real-time inventory posting', icon: Zap },
  ],
  assistant: {
    question: 'Preparing material for job work?',
    answer: 'Check what is available where before the challan is raised, and see what this worker is already holding.',
    cta: 'Check open job orders',
    tip: 'Availability is checked live for every line as you type; a short line is flagged before you post.',
    actions: [
      { key: 'availability', label: 'Availability', icon: Warehouse },
      { key: 'scan', label: 'Scan items', icon: ScanLine },
      { key: 'paste', label: 'Paste rows', icon: ClipboardCheck },
      { key: 'open_jobs', label: 'Open jobs', icon: PackageSearch },
    ],
  },
}

export const JOB_WORK_MODES: Record<JobWorkMode, JobWorkModeSpec> = { in: INWARD, out: OUTWARD }

export function jobWorkModeSpec(mode: JobWorkMode): JobWorkModeSpec {
  return JOB_WORK_MODES[mode]
}
