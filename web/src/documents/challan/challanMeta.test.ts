import { describe, expect, it } from 'vitest'
import {
  EMPTY_DISPATCH,
  EMPTY_TRANSPORT,
  dispatchFrom,
  filledCount,
  transportFrom,
  transportIsEmpty,
  withHeaderDetails,
} from './challanMeta'

describe('transportFrom / dispatchFrom', () => {
  it('reads every field as a string and defaults the missing ones', () => {
    const transport = transportFrom({ transport: { vehicle_no: 'MH12AB1234', lr_no: 4417 } })
    expect(transport.vehicle_no).toBe('MH12AB1234')
    // A number in stored JSON still reaches a text input as text.
    expect(transport.lr_no).toBe('4417')
    expect(transport.transporter_name).toBe('')
  })

  it('survives metadata that is missing, null or the wrong shape', () => {
    expect(transportFrom(null)).toEqual(EMPTY_TRANSPORT)
    expect(transportFrom(undefined)).toEqual(EMPTY_TRANSPORT)
    expect(transportFrom({})).toEqual(EMPTY_TRANSPORT)
    expect(transportFrom({ transport: 'not an object' })).toEqual(EMPTY_TRANSPORT)
    expect(dispatchFrom({ dispatch: { reference_no: 'REF-1' } }).reference_no).toBe('REF-1')
  })
})

describe('withHeaderDetails', () => {
  it('writes only the non-blank fields and trims them', () => {
    const meta = withHeaderDetails({}, {
      transport: { ...EMPTY_TRANSPORT, vehicle_no: '  MH12AB1234  ', driver_name: '' },
      dispatch: EMPTY_DISPATCH,
    })
    expect(meta.transport).toEqual({ vehicle_no: 'MH12AB1234' })
    expect(meta.dispatch).toBeUndefined()
  })

  it('removes a block that has been emptied rather than storing {}', () => {
    const meta = withHeaderDetails({ transport: { vehicle_no: 'OLD' } }, { transport: EMPTY_TRANSPORT })
    expect('transport' in meta).toBe(false)
  })

  it('leaves metadata it does not own untouched', () => {
    const meta = withHeaderDetails({ linked_source_document_id: 7 }, { transport: { ...EMPTY_TRANSPORT, lr_no: 'LR-9' } })
    expect(meta.linked_source_document_id).toBe(7)
    expect(meta.transport).toEqual({ lr_no: 'LR-9' })
  })

  it('round-trips through read and write', () => {
    const written = withHeaderDetails({}, {
      transport: { ...EMPTY_TRANSPORT, transporter_name: 'Blue Dart', transport_mode: 'Road' },
      dispatch: { ...EMPTY_DISPATCH, customer_ref: 'PO-42' },
    })
    expect(transportFrom(written).transporter_name).toBe('Blue Dart')
    expect(transportFrom(written).transport_mode).toBe('Road')
    expect(dispatchFrom(written).customer_ref).toBe('PO-42')
  })
})

describe('filledCount / transportIsEmpty', () => {
  it('counts only fields with content', () => {
    expect(filledCount(EMPTY_TRANSPORT)).toBe(0)
    expect(filledCount({ ...EMPTY_TRANSPORT, vehicle_no: 'X', driver_name: '   ' })).toBe(1)
    expect(transportIsEmpty(EMPTY_TRANSPORT)).toBe(true)
    expect(transportIsEmpty({ ...EMPTY_TRANSPORT, lr_no: 'LR-1' })).toBe(false)
  })
})
