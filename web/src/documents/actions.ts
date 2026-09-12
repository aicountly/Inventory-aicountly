/**
 * Which lifecycle actions a document offers, mirroring the server exactly:
 *   - status gates from DocumentService (submit / approve / reject / cancelDraft / update)
 *     and DocumentPostingService (post / reverse)
 *   - permission gates from DocumentsController (authorize / authorizeAny)
 */

import type { DocumentStatus } from './types'
import { slugForCode } from './registry'

export type DocumentAction = 'edit' | 'submit' | 'approve' | 'reject' | 'post' | 'cancel' | 'reverse'

export const EDITABLE_STATUSES: DocumentStatus[] = ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'FAILED']
export const POSTED_STATUSES: DocumentStatus[] = ['POSTED', 'PARTIALLY_FULFILLED', 'COMPLETED']

const STATUS_GATES: Record<DocumentAction, DocumentStatus[]> = {
  edit: EDITABLE_STATUSES,
  submit: ['DRAFT', 'FAILED'],
  approve: ['DRAFT', 'PENDING_APPROVAL'],
  reject: ['PENDING_APPROVAL', 'APPROVED'],
  post: ['DRAFT', 'APPROVED', 'PENDING_APPROVAL', 'FAILED'],
  cancel: EDITABLE_STATUSES,
  reverse: POSTED_STATUSES,
}

export type Can = (keys: string | string[]) => boolean

/** Permission keys the server accepts for an action on a document type (any one suffices). */
export function permissionKeysFor(action: DocumentAction | 'create', documentType: string): string[] {
  const slug = slugForCode(documentType)
  switch (action) {
    case 'create':
      return [`documents.${slug}.create`, 'documents.create']
    case 'edit':
    case 'cancel':
      return ['documents.edit', 'documents.create']
    case 'submit':
      return ['documents.create', 'documents.edit']
    case 'approve':
    case 'reject':
      return ['documents.approve']
    case 'post':
      return [`documents.${slug}.post`, 'documents.post']
    case 'reverse':
      return [`documents.${slug}.reverse`, 'documents.reverse']
  }
}

export function statusAllows(action: DocumentAction, status: DocumentStatus | string): boolean {
  return STATUS_GATES[action].includes(status as DocumentStatus)
}

export function isEditable(status: DocumentStatus | string): boolean {
  return statusAllows('edit', status)
}

export function isPosted(status: DocumentStatus | string): boolean {
  return POSTED_STATUSES.includes(status as DocumentStatus)
}

export interface ActionAvailability {
  action: DocumentAction
  /** Status permits it. */
  possible: boolean
  /** Status permits it AND the user holds a permission for it. */
  allowed: boolean
}

const ORDER: DocumentAction[] = ['edit', 'submit', 'approve', 'reject', 'post', 'cancel', 'reverse']

/**
 * Every action with its availability, in display order. `possible` is the status gate;
 * `allowed` additionally applies the permission gate. Callers hide actions that are not
 * possible and disable (or hide) those not allowed.
 */
export function availableActions(status: DocumentStatus | string, documentType: string, can: Can): ActionAvailability[] {
  return ORDER.map((action) => {
    const possible = statusAllows(action, status)
    return { action, possible, allowed: possible && can(permissionKeysFor(action, documentType)) }
  })
}

/** Actions the user can take right now, in display order. */
export function allowedActions(status: DocumentStatus | string, documentType: string, can: Can): DocumentAction[] {
  return availableActions(status, documentType, can)
    .filter((a) => a.allowed)
    .map((a) => a.action)
}

export function canCreate(documentType: string, can: Can): boolean {
  return can(permissionKeysFor('create', documentType))
}

/** Packing-list state actions (PackingController). Only meaningful on a posted PACKING document. */
export type PackingAction = 'unpack' | 'lock' | 'unlock'

export function packingActions(packingStatus: string | null | undefined, can: Can): PackingAction[] {
  if (!packingStatus) return []
  const out: PackingAction[] = []
  if (packingStatus === 'open' && can(['documents.packing.reverse', 'documents.packing.edit', 'documents.reverse'])) out.push('unpack')
  const canLock = can(['documents.packing.edit', 'documents.packing.post', 'documents.edit'])
  if (packingStatus === 'open' && canLock) out.push('lock')
  if (packingStatus === 'locked' && canLock) out.push('unlock')
  return out
}

export const STATUS_LABELS: Record<DocumentStatus, string> = {
  DRAFT: 'Draft',
  PENDING_APPROVAL: 'Pending approval',
  APPROVED: 'Approved',
  POSTING: 'Posting…',
  POSTED: 'Posted',
  PARTIALLY_FULFILLED: 'Partially fulfilled',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
  REVERSED: 'Reversed',
  FAILED: 'Failed',
}

export type StatusTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger'

export function statusTone(status: DocumentStatus | string): StatusTone {
  switch (status) {
    case 'POSTED':
    case 'COMPLETED':
      return 'success'
    case 'APPROVED':
    case 'PARTIALLY_FULFILLED':
    case 'POSTING':
      return 'info'
    case 'PENDING_APPROVAL':
      return 'warning'
    case 'FAILED':
    case 'REVERSED':
    case 'CANCELLED':
      return 'danger'
    default:
      return 'neutral'
  }
}
