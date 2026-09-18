import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { RevaluationItemRow } from './RevaluationItemRow'
import { RevaluationImpactSummary } from './RevaluationImpactSummary'
import { createMoneyFormat } from './revaluationFormat'
import { newRevaluationLine, revaluationTotals } from './revaluationModel'
import type { RevaluationDraft, RevaluationLine, StockContext, StockContextMap } from './revaluationModel'

const money = createMoneyFormat('INR')

const warehouses = [
  { warehouse_id: 1, warehouse_name: 'Main', warehouse_code: 'MAIN', warehouse_type: 'store', is_default: 1, bo_id: 0 },
  { warehouse_id: 2, warehouse_name: 'Godown 2', warehouse_code: null, warehouse_type: 'store', is_default: 0, bo_id: 0 },
]

function line(partial: Partial<RevaluationLine> = {}): RevaluationLine {
  return newRevaluationLine({
    key: 'a',
    itemId: 10,
    itemName: 'Laptop Dell Inspiron',
    itemSku: 'LAP001',
    hsnSac: '8471',
    unitId: 7,
    unitSymbol: 'Nos',
    warehouseId: 1,
    newUnitCost: '46500',
    ...partial,
  })
}

function context(partial: Partial<StockContext> = {}): StockContext {
  return { itemId: 10, warehouseId: 1, onHandQty: 12, currentUnitCost: 45000, method: 'FIFO', loading: false, error: null, fetchedAt: 1, ...partial }
}

function renderRow(props: Partial<Parameters<typeof RevaluationItemRow>[0]> = {}) {
  const onPatch = vi.fn()
  const utils = render(
    <table>
      <tbody>
        <RevaluationItemRow
          line={line()}
          position={1}
          context={context()}
          scope="warehouse"
          money={money}
          warehouses={warehouses}
          onPatch={onPatch}
          onDuplicate={vi.fn()}
          onRemove={vi.fn()}
          {...props}
        />
      </tbody>
    </table>,
  )
  return { ...utils, onPatch }
}

describe('a revaluation line', () => {
  it('names the item, its SKU and its HSN', () => {
    renderRow()
    expect(screen.getByText('Laptop Dell Inspiron')).toBeTruthy()
    expect(screen.getByText(/SKU: LAP001/)).toBeTruthy()
    expect(screen.getByText(/HSN: 8471/)).toBeTruthy()
  })

  it('shows the current cost and the quantity as text, never as inputs', () => {
    const { container } = renderRow()
    expect(screen.getByText('₹45,000.00')).toBeTruthy()
    expect(screen.getByText('12')).toBeTruthy()
    // Editable: the new cost and the remark. Nothing else.
    const labels = [...container.querySelectorAll('input')].map((i) => i.getAttribute('aria-label'))
    expect(labels).toEqual(['New unit cost for Laptop Dell Inspiron', 'Remarks for Laptop Dell Inspiron'])
  })

  it('prints a rise in green with a plus and a fall in red with a minus', () => {
    const { unmount } = renderRow()
    const up = screen.getByText('+₹18,000.00')
    expect(up.className).toContain('text-emerald-600')
    unmount()

    renderRow({ line: line({ newUnitCost: '3950' }), context: context({ currentUnitCost: 4200, onHandQty: 25 }) })
    const down = screen.getByText('−₹6,250.00')
    expect(down.className).toContain('text-red-600')
  })

  it('says "no change" rather than drawing a coloured zero', () => {
    renderRow({ line: line({ newUnitCost: '45000' }) })
    expect(screen.getByText('no change')).toBeTruthy()
  })

  it('leaves the impact blank until the cost and the quantity are both known', () => {
    const { container } = renderRow({ line: line({ newUnitCost: '' }) })
    expect(container.textContent).not.toContain('₹18,000.00')
  })

  it('reports batch and serial tracking without offering a picker a revaluation does not use', () => {
    renderRow({ line: line({ trackBatch: true }) })
    expect(screen.getByText('Batch-tracked')).toBeTruthy()
    expect(screen.queryByLabelText(/batch/i)).toBeNull()
  })

  it('marks a line with nothing on hand', () => {
    renderRow({ context: context({ onHandQty: 0 }) })
    expect(screen.getByText('no stock')).toBeTruthy()
  })

  it('refuses a cost with more precision than the server stores', () => {
    const { onPatch } = renderRow()
    const input = screen.getByLabelText('New unit cost for Laptop Dell Inspiron')
    fireEvent.change(input, { target: { value: '46500.1234' } })
    expect(onPatch).toHaveBeenCalledWith('a', { newUnitCost: '46500.1234' })
    onPatch.mockClear()
    fireEvent.change(input, { target: { value: '46500.12345' } })
    expect(onPatch).not.toHaveBeenCalled()
  })

  it('lets the line move warehouse, because that changes which layers it re-prices', () => {
    const { onPatch } = renderRow()
    fireEvent.change(screen.getByLabelText('Warehouse for Laptop Dell Inspiron'), { target: { value: '2' } })
    expect(onPatch).toHaveBeenCalledWith('a', { warehouseId: 2 })
  })

  it('offers duplicate and remove by name, not by glyph alone', () => {
    const onRemove = vi.fn()
    renderRow({ onRemove })
    fireEvent.click(screen.getByLabelText('Remove line 1, Laptop Dell Inspiron'))
    expect(onRemove).toHaveBeenCalledWith('a')
    expect(screen.getByLabelText('Duplicate line 1, Laptop Dell Inspiron')).toBeTruthy()
  })
})

describe('the impact preview', () => {
  const draft: RevaluationDraft = {
    documentDate: '2026-09-18',
    documentNo: '',
    defaultWarehouseId: 1,
    reasonCode: 'MARKET_PRICE',
    movementReason: '',
    narration: '',
    lines: [line(), line({ key: 'b', itemId: 11, itemName: 'Office Chair', newUnitCost: '3950' })],
  }
  const contexts: StockContextMap = {
    '10:1': context(),
    '11:1': context({ itemId: 11, currentUnitCost: 4200, onHandQty: 25 }),
  }

  function renderSummary(map: StockContextMap = contexts) {
    return render(
      <RevaluationImpactSummary totals={revaluationTotals(draft, map, 'warehouse')} money={money} scope="warehouse" loading={false} fetchedAt={null} onRefresh={vi.fn()} />,
    )
  }

  it('adds the increases, the decreases and the net', () => {
    renderSummary()
    expect(screen.getByText('₹18,000.00')).toBeTruthy()
    expect(screen.getByText('₹6,250.00')).toBeTruthy()
    expect(screen.getByText('+₹11,750.00')).toBeTruthy()
    expect(screen.getByText('Increase')).toBeTruthy()
  })

  it('counts the quantity it was calculated over without claiming any of it moves', () => {
    const { container } = renderSummary()
    const tile = within(container).getByText('Total on-hand qty').parentElement as HTMLElement
    expect(tile.textContent).toContain('37')
    expect(tile.textContent).toContain('none of it moves')
  })

  it('calls a fall a decrease and a wash no change', () => {
    const falling: StockContextMap = { '10:1': context({ currentUnitCost: 50000 }), '11:1': context({ itemId: 11, currentUnitCost: 4200, onHandQty: 25 }) }
    const { unmount } = renderSummary(falling)
    expect(screen.getByText('Decrease')).toBeTruthy()
    unmount()

    const flat: StockContextMap = { '10:1': context({ currentUnitCost: 46500 }), '11:1': context({ itemId: 11, currentUnitCost: 3950, onHandQty: 25 }) }
    renderSummary(flat)
    expect(screen.getByText('No change')).toBeTruthy()
  })

  it('says how many lines it could not price yet instead of counting them as zero', () => {
    const pending: StockContextMap = { '10:1': context(), '11:1': context({ itemId: 11, currentUnitCost: null, onHandQty: null, error: 'Forbidden' }) }
    renderSummary(pending)
    expect(screen.getByText(/1 line not counted yet/)).toBeTruthy()
  })
})
