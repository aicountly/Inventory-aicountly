import { describe, expect, it } from 'vitest'
import { allowedActions, availableActions, canCreate, packingActions, permissionKeysFor, statusAllows, statusTone } from './actions'

const canWith = (keys: string[]) => (k: string | string[]) => (Array.isArray(k) ? k : [k]).some((x) => keys.includes(x))

describe('permissionKeysFor', () => {
  it('uses the type-specific key with the generic fallback for create / post / reverse', () => {
    expect(permissionKeysFor('create', 'STOCK_TRANSFER')).toEqual(['documents.stock_transfer.create', 'documents.create'])
    expect(permissionKeysFor('post', 'WRITE_OFF')).toEqual(['documents.write_off.post', 'documents.post'])
    expect(permissionKeysFor('reverse', 'PACKING')).toEqual(['documents.packing.reverse', 'documents.reverse'])
  })

  it('mirrors the controller for edit, submit, approve and cancel', () => {
    expect(permissionKeysFor('edit', 'PRODUCTION')).toEqual(['documents.edit', 'documents.create'])
    expect(permissionKeysFor('submit', 'PRODUCTION')).toEqual(['documents.create', 'documents.edit'])
    expect(permissionKeysFor('approve', 'PRODUCTION')).toEqual(['documents.approve'])
    expect(permissionKeysFor('reject', 'PRODUCTION')).toEqual(['documents.approve'])
    expect(permissionKeysFor('cancel', 'PRODUCTION')).toEqual(['documents.edit', 'documents.create'])
  })
})

describe('statusAllows', () => {
  it('gates by status like DocumentService / DocumentPostingService', () => {
    expect(statusAllows('post', 'DRAFT')).toBe(true)
    expect(statusAllows('post', 'PENDING_APPROVAL')).toBe(true)
    expect(statusAllows('post', 'POSTED')).toBe(false)
    expect(statusAllows('reverse', 'POSTED')).toBe(true)
    expect(statusAllows('reverse', 'PARTIALLY_FULFILLED')).toBe(true)
    expect(statusAllows('reverse', 'DRAFT')).toBe(false)
    expect(statusAllows('submit', 'FAILED')).toBe(true)
    expect(statusAllows('submit', 'APPROVED')).toBe(false)
    expect(statusAllows('reject', 'APPROVED')).toBe(true)
    expect(statusAllows('cancel', 'POSTED')).toBe(false)
    expect(statusAllows('edit', 'REVERSED')).toBe(false)
  })
})

describe('allowedActions', () => {
  it('offers a store keeper only what the store-keeper template grants', () => {
    const can = canWith(['documents.create', 'documents.edit', 'documents.post', 'documents.stock_transfer.post'])
    expect(allowedActions('DRAFT', 'STOCK_TRANSFER', can)).toEqual(['edit', 'submit', 'post', 'cancel'])
    expect(allowedActions('POSTED', 'STOCK_TRANSFER', can)).toEqual([])
  })

  it('lets a type-specific post permission through without the generic one', () => {
    const can = canWith(['documents.write_off.post'])
    expect(allowedActions('APPROVED', 'WRITE_OFF', can)).toEqual(['post'])
    expect(allowedActions('APPROVED', 'WRITE_IN', can)).toEqual([])
  })

  it('reports possible-but-forbidden actions separately', () => {
    const rows = availableActions('PENDING_APPROVAL', 'PRODUCTION', canWith([]))
    const approve = rows.find((r) => r.action === 'approve')
    expect(approve).toEqual({ action: 'approve', possible: true, allowed: false })
    const reverse = rows.find((r) => r.action === 'reverse')
    expect(reverse?.possible).toBe(false)
  })

  it('canCreate accepts either key', () => {
    expect(canCreate('PACKING', canWith(['documents.packing.create']))).toBe(true)
    expect(canCreate('PACKING', canWith(['documents.create']))).toBe(true)
    expect(canCreate('PACKING', canWith(['documents.read']))).toBe(false)
  })
})

describe('packingActions', () => {
  it('depends on the packing state and the packing permissions', () => {
    const editor = canWith(['documents.packing.edit'])
    expect(packingActions('open', editor)).toEqual(['unpack', 'lock'])
    expect(packingActions('locked', editor)).toEqual(['unlock'])
    expect(packingActions('consumed', editor)).toEqual([])
    expect(packingActions(null, editor)).toEqual([])
    expect(packingActions('open', canWith(['documents.reverse']))).toEqual(['unpack'])
  })
})

describe('statusTone', () => {
  it('maps every status to a tone', () => {
    expect(statusTone('POSTED')).toBe('success')
    expect(statusTone('PENDING_APPROVAL')).toBe('warning')
    expect(statusTone('FAILED')).toBe('danger')
    expect(statusTone('DRAFT')).toBe('neutral')
  })
})
