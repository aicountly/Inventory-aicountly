import { useEffect, useMemo, useState } from 'react'
import { FileDown } from 'lucide-react'
import { Modal } from '../../components/Modal'
import { Notice } from '../../components/Notice'
import { Button } from '../../ui/Button'
import { Input } from '../../ui/Input'
import { Select } from '../../ui/Select'
import { FormField } from '../../ui/shell/FormSectionCard'
import { useDebounce } from '../../hooks/useDebounce'
import { errorMessage, isAbortError, isApiError } from '../../services/api'
import { lookupApi } from '../../services/lookupApi'
import type { BomListRow } from '../../services/lookupApi'
import { formatQty, toNumber } from '../../utils/format'
import { scaleBomLines } from '../bom'
import type { BomHeader } from '../bom'
import { newLine } from '../formModel'
import type { LineDraft } from '../formModel'
import type { DocumentTypeSpec } from '../registry'
import type { CreateDocumentLine } from '../types'
import type { ImportStrategy } from './assemblyModel'

export interface BomImportResult {
  components: LineDraft[]
  finished: LineDraft | null
  bomId: number
  bomName: string
  outputQty: number
  /** By-product lines the BOM carries that an assembly has nowhere to put. */
  skippedByProducts: number
  strategy: ImportStrategy
}

export interface BomImportDialogProps {
  open: boolean
  spec: DocumentTypeSpec
  warehouseId: number | null
  /** Pre-select the BOM of the item already on the form, when there is one. */
  preselectBomId?: number | null
  /** Whether the form already has components — decides if the strategy question is asked. */
  hasComponents: boolean
  onClose: () => void
  onImport: (result: BomImportResult) => void
}

function isFinishedLine(line: CreateDocumentLine, bom: BomHeader): boolean {
  const kind = (line.metadata as { line_kind?: string } | null | undefined)?.line_kind
  return kind === 'finished' || (line.direction === 'in' && line.item_id === bom.finished_item_id)
}

function toDraft(line: CreateDocumentLine, bom: BomHeader, spec: DocumentTypeSpec, index: number): LineDraft {
  const finished = isFinishedLine(line, bom)
  const bomLine = bom.lines.find((b) => b.item_id === line.item_id)
  const name = finished ? (bom.finished_item_name ?? `Item #${line.item_id}`) : (bomLine?.item_name ?? `Item #${line.item_id}`)
  const symbol = finished ? (bom.yield_unit_symbol ?? null) : (bomLine?.unit_symbol ?? null)
  return newLine(spec, {
    key: `bom-${bom.bom_id}-${index}-${Math.random().toString(36).slice(2, 7)}`,
    item_id: line.item_id,
    item_name: name,
    item_sku: finished ? (bom.finished_item_sku ?? null) : (bomLine?.item_sku ?? null),
    units: line.unit_id ? [{ unit_id: line.unit_id, unit_symbol: symbol, conversion_factor: 1, is_default: true }] : [],
    unit_id: line.unit_id ?? null,
    warehouse_id: line.warehouse_id ?? null,
    direction: finished ? 'in' : 'out',
    qty: String(line.qty),
    origin: 'bom',
    metadata: line.metadata ?? null,
  })
}

interface BomPreview {
  components: LineDraft[]
  finished: LineDraft | null
  /**
   * By-product lines the BOM carries.
   *
   * A by-product is a SECOND thing the run creates, and an assembly creates one finished item.
   * Importing them would either invent a second output slot or silently drop the quantity, so they
   * are counted and reported, with the document type that does handle them named on screen.
   */
  skippedByProducts: number
}

function draftsFrom(lines: readonly CreateDocumentLine[], bom: BomHeader, spec: DocumentTypeSpec): BomPreview {
  const indexed = lines.map((line, i) => ({ line, i }))
  const finishedEntry = indexed.find(({ line }) => isFinishedLine(line, bom))
  const components = indexed.filter(({ line }) => line.direction !== 'in' && !isFinishedLine(line, bom))
  const byProducts = indexed.filter(({ line }) => line.direction === 'in' && !isFinishedLine(line, bom))
  return {
    components: components.map(({ line, i }) => toDraft(line, bom, spec, i)),
    finished: finishedEntry ? toDraft(finishedEntry.line, bom, spec, finishedEntry.i) : null,
    skippedByProducts: byProducts.length,
  }
}

/**
 * Load a bill of materials, scale it to the output quantity, and preview what would be imported.
 *
 * `POST /v1/bill-of-materials/{id}/explode` does the arithmetic server-side with the item's real
 * unit conversion; an API without that route falls back to the client mirror in `bom.ts`, which
 * is the same arithmetic and says so on screen. Nothing is written to the form until Import is
 * pressed, and a form that already has components is asked what to do with them first.
 */
export function BomImportDialog({
  open,
  spec,
  warehouseId,
  preselectBomId,
  hasComponents,
  onClose,
  onImport,
}: BomImportDialogProps) {
  const [query, setQuery] = useState('')
  const [bomId, setBomId] = useState<number | null>(null)
  const [outputQty, setOutputQty] = useState('')
  const [options, setOptions] = useState<BomListRow[]>([])
  const [optionsLoading, setOptionsLoading] = useState(false)
  const [bom, setBom] = useState<BomHeader | null>(null)
  const [bomLoading, setBomLoading] = useState(false)
  const [preview, setPreview] = useState<BomPreview | null>(null)
  const [busy, setBusy] = useState(false)
  const [fallback, setFallback] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [askStrategy, setAskStrategy] = useState(false)
  const debouncedQuery = useDebounce(query, 300)

  useEffect(() => {
    if (!open) return
    setBomId(preselectBomId ?? null)
    setPreview(null)
    setError(null)
    setAskStrategy(false)
    setFallback(false)
  }, [open, preselectBomId])

  useEffect(() => {
    if (!open) return undefined
    const controller = new AbortController()
    setOptionsLoading(true)
    lookupApi
      .boms(debouncedQuery.trim(), { signal: controller.signal })
      .then((res) => {
        if (controller.signal.aborted) return
        setOptions(res.data)
        setOptionsLoading(false)
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted || isAbortError(err)) return
        setOptions([])
        setOptionsLoading(false)
        setError('Bills of materials could not be loaded. Try again.')
      })
    return () => controller.abort()
  }, [open, debouncedQuery])

  useEffect(() => {
    if (!open || bomId === null) {
      setBom(null)
      return undefined
    }
    const controller = new AbortController()
    setBomLoading(true)
    lookupApi
      .bom(bomId, controller.signal)
      .then((header) => {
        if (controller.signal.aborted) return
        setBom(header)
        setBomLoading(false)
        setOutputQty((q) => (q.trim() === '' ? String(header.yield_qty || 1) : q))
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted || isAbortError(err)) return
        setBom(null)
        setBomLoading(false)
        setError(errorMessage(err, 'That bill of materials could not be loaded.'))
      })
    return () => controller.abort()
  }, [open, bomId])

  const qty = toNumber(outputQty)
  const canBuild = bom !== null && qty !== null && qty > 0

  const scale = useMemo(() => (bom && qty ? qty / Math.max(0.0001, bom.yield_qty || 1) : 0), [bom, qty])

  const build = async () => {
    if (!bom || qty === null || qty <= 0) {
      setError('Enter an output quantity greater than zero.')
      return
    }
    setBusy(true)
    setError(null)
    setFallback(false)
    try {
      let lines: CreateDocumentLine[]
      try {
        const payload = await lookupApi.explodeBom(bom.bom_id, { production_qty: qty, warehouse_id: warehouseId })
        lines = payload.lines
      } catch (err) {
        if (isApiError(err) && err.status === 404) {
          lines = scaleBomLines(bom, qty, warehouseId, 0)
          setFallback(true)
        } else {
          throw err
        }
      }
      setPreview(draftsFrom(lines, bom, spec))
    } catch (err) {
      setError(errorMessage(err, 'The bill of materials could not be scaled.'))
    } finally {
      setBusy(false)
    }
  }

  const apply = (strategy: ImportStrategy) => {
    if (!preview || !bom || qty === null) return
    onImport({
      components: preview.components,
      finished: preview.finished,
      bomId: bom.bom_id,
      bomName: bom.bom_name,
      outputQty: qty,
      skippedByProducts: preview.skippedByProducts,
      strategy,
    })
  }

  const confirmImport = () => {
    if (!preview) return
    if (hasComponents) {
      setAskStrategy(true)
      return
    }
    apply('replace')
  }

  return (
    <Modal
      open={open}
      title="Import from a bill of materials"
      description="Pick the BOM, set the output quantity, and check what will be brought in."
      onClose={onClose}
      size="lg"
      busy={busy}
      footer={
        askStrategy ? (
          <>
            <Button variant="ghost" onClick={() => setAskStrategy(false)}>
              Cancel
            </Button>
            <Button variant="secondary" onClick={() => apply('merge')}>
              Merge quantities
            </Button>
            <Button onClick={() => apply('replace')}>Replace components</Button>
          </>
        ) : (
          <>
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            {preview ? (
              <Button icon={FileDown} onClick={confirmImport}>
                Import {preview.components.length} component{preview.components.length === 1 ? '' : 's'}
              </Button>
            ) : (
              <Button onClick={() => void build()} loading={busy} disabled={!canBuild}>
                Preview components
              </Button>
            )}
          </>
        )
      }
    >
      <div className="space-y-3">
        {askStrategy ? (
          <Notice kind="warning" title="Components already exist.">
            <span className="block">
              Replacing drops the components already on the form. Merging adds these quantities to any row that names
              the same item, warehouse, batch and unit, and appends the rest.
            </span>
          </Notice>
        ) : null}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <FormField label="Find a BOM" htmlFor="bom-query">
            <Input
              id="bom-query"
              value={query}
              placeholder="Search by BOM or finished item…"
              onChange={(e) => setQuery(e.target.value)}
            />
          </FormField>
          <FormField label="Bill of materials" htmlFor="bom-select" required>
            <Select
              id="bom-select"
              value={bomId ?? ''}
              onChange={(e) => {
                setBomId(e.target.value === '' ? null : Number(e.target.value))
                setPreview(null)
                setAskStrategy(false)
              }}
            >
              <option value="">{optionsLoading ? 'Loading…' : 'Select a bill of materials…'}</option>
              {bomId !== null && !options.some((b) => b.bom_id === bomId) ? (
                <option value={bomId}>BOM #{bomId}</option>
              ) : null}
              {options.map((b) => (
                <option key={b.bom_id} value={b.bom_id}>
                  {b.bom_name} → {b.finished_item_name ?? `#${b.finished_item_id}`} (yield {formatQty(b.yield_qty)}{' '}
                  {b.yield_unit_symbol ?? ''})
                </option>
              ))}
            </Select>
          </FormField>
          <FormField
            label="Output quantity"
            htmlFor="bom-qty"
            required
            hint={bom ? `This BOM yields ${formatQty(bom.yield_qty)} ${bom.yield_unit_symbol ?? ''} per run.` : undefined}
          >
            <Input
              id="bom-qty"
              inputMode="decimal"
              className="text-right tabular-nums"
              value={outputQty}
              onChange={(e) => {
                setOutputQty(e.target.value)
                setPreview(null)
                setAskStrategy(false)
              }}
            />
          </FormField>
          {bom && scale > 0 ? (
            <FormField label="Scale">
              <p className="pt-1.5 text-sm tabular-nums text-gray-700">×{formatQty(Math.round(scale * 1e6) / 1e6)}</p>
            </FormField>
          ) : null}
        </div>

        {bomLoading ? <p className="text-xs text-gray-500">Loading the bill of materials…</p> : null}
        {error ? <Notice kind="error">{error}</Notice> : null}
        {fallback ? (
          <Notice kind="info">
            Quantities were scaled in the browser because this API has no explode endpoint. Unit conversion is verified
            again when the document posts.
          </Notice>
        ) : null}
        {preview && preview.skippedByProducts > 0 ? (
          <Notice kind="warning">
            {preview.skippedByProducts} by-product line{preview.skippedByProducts === 1 ? '' : 's'} on this BOM
            {preview.skippedByProducts === 1 ? ' was' : ' were'} not imported: an assembly creates one finished item.
            Use a Production document to receive by-products.
          </Notice>
        ) : null}

        {preview ? (
          <div className="overflow-hidden rounded-lg border border-gray-200">
            <table className="w-full border-collapse text-sm">
              <caption className="sr-only">Components this import would add</caption>
              <thead className="bg-gray-50">
                <tr>
                  <th scope="col" className="px-2.5 py-1.5 text-left text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                    Component
                  </th>
                  <th scope="col" className="px-2.5 py-1.5 text-right text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                    Quantity
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {preview.components.map((line) => (
                  <tr key={line.key}>
                    <td className="px-2.5 py-1.5 text-gray-800">{line.item_name}</td>
                    <td className="px-2.5 py-1.5 text-right tabular-nums text-gray-800">
                      {formatQty(line.qty)} {line.units[0]?.unit_symbol ?? ''}
                    </td>
                  </tr>
                ))}
                {preview.finished ? (
                  <tr className="bg-emerald-50/50">
                    <td className="px-2.5 py-1.5 font-semibold text-emerald-800">
                      {preview.finished.item_name} <span className="font-normal">(assembled item)</span>
                    </td>
                    <td className="px-2.5 py-1.5 text-right font-semibold tabular-nums text-emerald-800">
                      {formatQty(preview.finished.qty)} {preview.finished.units[0]?.unit_symbol ?? ''}
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>
    </Modal>
  )
}

export default BomImportDialog
