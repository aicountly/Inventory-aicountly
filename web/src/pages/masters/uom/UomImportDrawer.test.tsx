import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { Uom } from '../../../services/masters'

/**
 * The import's two promises: nothing is written until the person confirms, and
 * a row that cannot be created is skipped and named rather than attempted.
 */

let GRID: unknown[][] = []

vi.mock('xlsx-js-style', () => ({
  read: () => ({ SheetNames: ['Sheet1'], Sheets: { Sheet1: {} } }),
  utils: { sheet_to_json: () => GRID },
}))

const createUnit = vi.fn()
vi.mock('../../../services/masters', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../services/masters')>()
  return { ...actual, uomApi: { ...actual.uomApi, create: (...args: unknown[]) => createUnit(...args) } }
})

const downloadCsv = vi.fn()
vi.mock('../../../utils/csv', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../utils/csv')>()
  return { ...actual, downloadCsv: (...args: unknown[]) => downloadCsv(...args) }
})

const { UomImportDrawer } = await import('./UomImportDrawer')

const EXISTING: Uom[] = [
  {
    unit_id: 1,
    unit_name: 'Kilogram',
    unit_symbol: 'KG',
    print_name: 'Kilogram',
    uqc_gst: 'KGS',
    decimal_places: 4,
    is_active: 1,
  },
]

const onImported = vi.fn()

function mount() {
  return render(
    <UomImportDrawer
      open
      onClose={() => {}}
      loadExisting={async () => EXISTING}
      knownUqcCodes={['KGS', 'LTR', 'DOZ']}
      onImported={onImported}
    />,
  )
}

/** Drops a file on the hidden input the "Choose file" button drives. */
async function choose() {
  const input = document.getElementById('uom-import-file') as HTMLInputElement
  const file = new File(['x'], 'units.csv', { type: 'text/csv' })
  // happy-dom's File has no arrayBuffer(); the drawer only passes it to the
  // mocked reader, so a stub is enough.
  Object.defineProperty(file, 'arrayBuffer', { value: async () => new ArrayBuffer(8) })
  Object.defineProperty(input, 'files', { value: [file], configurable: true })
  fireEvent.change(input)
  await screen.findByText('units.csv')
}

beforeEach(() => {
  vi.clearAllMocks()
  createUnit.mockResolvedValue({})
  GRID = [
    ['Unit Name', 'Symbol', 'Print Name', 'GST UQC', 'Decimals', 'Status'],
    ['Litre', 'L', 'Litre', 'LTR', '4', 'Active'],
    ['Kilogram', 'KGM', '', 'KGS', '4', 'Active'],
    ['Dozen', 'DOZ', '', '', '0', 'Active'],
  ]
})

describe('importing units from a sheet', () => {
  it('previews the file without writing anything', async () => {
    mount()
    await choose()
    expect(createUnit).not.toHaveBeenCalled()
    expect(screen.getByText('Litre')).toBeTruthy()
    expect(screen.getByRole('button', { name: /Import 2 units/ })).toBeTruthy()
  })

  it('marks the row that collides with an existing unit as skipped', async () => {
    mount()
    await choose()
    const rows = within(screen.getByLabelText('Rows read from the sheet'))
    expect(rows.getByText(/A unit named “Kilogram” already exists/)).toBeTruthy()
    expect(rows.getAllByText('Skipped')).toHaveLength(1)
  })

  it('flags a unit with no GST code as worth checking, but still imports it', async () => {
    mount()
    await choose()
    const rows = within(screen.getByLabelText('Rows read from the sheet'))
    expect(rows.getByText(/cannot be reported on a return/)).toBeTruthy()
    expect(rows.getAllByText('Check')).toHaveLength(1)
  })

  it('creates only the importable rows when confirmed', async () => {
    mount()
    await choose()
    fireEvent.click(screen.getByRole('button', { name: /Import 2 units/ }))
    await waitFor(() => expect(createUnit).toHaveBeenCalledTimes(2))
    expect(createUnit.mock.calls.map((c) => (c[0] as { unit_name: string }).unit_name)).toEqual(['Litre', 'Dozen'])
    expect(await screen.findByText('2 units created')).toBeTruthy()
    expect(onImported).toHaveBeenCalled()
  })

  it('reports the rows the server refused and offers them as a sheet', async () => {
    createUnit.mockRejectedValueOnce(new Error('Unit "Litre" already exists'))
    mount()
    await choose()
    fireEvent.click(screen.getByRole('button', { name: /Import 2 units/ }))
    expect(await screen.findByText('1 unit created')).toBeTruthy()
    expect(screen.getByText(/Line 2 · Litre/)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /Download the error report/ }))
    expect(downloadCsv).toHaveBeenCalledWith('units-of-measure-import-errors.csv', expect.stringContaining('Litre'))
  })

  it('refuses a sheet whose headings it cannot read', async () => {
    GRID = [['Colour', 'Size'], ['Red', 'L']]
    mount()
    const input = document.getElementById('uom-import-file') as HTMLInputElement
    const file = new File(['x'], 'wrong.csv', { type: 'text/csv' })
    Object.defineProperty(file, 'arrayBuffer', { value: async () => new ArrayBuffer(8) })
    Object.defineProperty(input, 'files', { value: [file], configurable: true })
    fireEvent.change(input)
    expect(await screen.findByText(/No heading row was found/)).toBeTruthy()
    expect(createUnit).not.toHaveBeenCalled()
  })

  it('hands out a template the parser accepts', async () => {
    mount()
    fireEvent.click(screen.getByRole('button', { name: /Download template/ }))
    expect(downloadCsv).toHaveBeenCalledWith('units-of-measure-template.csv', expect.stringContaining('Unit Name'))
  })
})
