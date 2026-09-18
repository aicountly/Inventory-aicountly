/**
 * The Disassembly form's state: one header, two line lists, the costing basis and a dirty flag.
 *
 * Plain `useState` + `useCallback`, because that is what every other entry form in this app uses
 * (`DocumentForm`, the settings pages) and a second state library for one screen would be a new
 * thing to learn for no gain. Every mutator is stable across renders, so the memoised row
 * components below only re-render the row that actually changed — which is what keeps a hundred
 * component rows typable.
 */

import { useCallback, useMemo, useRef, useState } from 'react'
import type { ItemSearchRow } from '../../services/lookupApi'
import { unitOptionsFrom } from '../LineEditor'
import type { HeaderDraft, LineDraft } from '../formModel'
import type { DocumentTypeSpec } from '../registry'
import { newComponentLine, newFinishedLine } from './model'
import type { CostBasis, DisassemblyDraft, DisassemblyRole } from './model'

export interface DisassemblyFormState {
  draft: DisassemblyDraft
  costBasis: CostBasis
  /** BOM the components came from, when they came from one. */
  bomId: number | null
  bomName: string | null
  /** Parent quantity the components were scaled to, so a later change can offer to rescale. */
  bomQty: number | null
  dirty: boolean
  /** Line keys whose unit cost the user typed — never overwritten by the valuation read. */
  costTouched: ReadonlySet<string>
}

export interface DisassemblyFormApi extends DisassemblyFormState {
  patchHeader: (patch: Partial<HeaderDraft>) => void
  updateLine: (role: DisassemblyRole, key: string, patch: Partial<LineDraft>) => void
  pickItem: (role: DisassemblyRole, key: string, row: ItemSearchRow, defaultWarehouseId: number | null) => void
  clearItem: (role: DisassemblyRole, key: string) => void
  addLine: (role: DisassemblyRole, partial?: Partial<LineDraft>) => string
  removeLine: (role: DisassemblyRole, key: string) => void
  setLines: (role: DisassemblyRole, lines: LineDraft[]) => void
  markCostTouched: (key: string) => void
  /** Replace costs the user has not typed; used by the valuation read and the allocation bases. */
  applyCosts: (next: LineDraft[]) => void
  setCostBasis: (basis: CostBasis) => void
  setBom: (bom: { id: number; name: string; qty: number } | null) => void
  markClean: () => void
  markDirty: () => void
  /** Prefill from reference data. Deliberately does NOT arm the unsaved-changes guard. */
  setDefaultWarehouse: (id: number) => void
  /** Fill units and tracking flags on stored lines, from `POST /v1/items/bulk-lookup`. */
  hydrateItems: (byId: Map<number, ItemSearchRow>) => void
}

export interface DisassemblyFormOptions {
  spec: DocumentTypeSpec
  initialHeader: HeaderDraft
  initialFinished: LineDraft[]
  initialComponents: LineDraft[]
  initialCostBasis?: CostBasis
  initialBomId?: number | null
}

export function useDisassemblyForm(options: DisassemblyFormOptions): DisassemblyFormApi {
  const { spec } = options
  const [header, setHeader] = useState<HeaderDraft>(options.initialHeader)
  const [finished, setFinished] = useState<LineDraft[]>(options.initialFinished)
  const [components, setComponents] = useState<LineDraft[]>(options.initialComponents)
  const [costBasis, setCostBasisState] = useState<CostBasis>(options.initialCostBasis ?? 'component_cost')
  const [bom, setBomState] = useState<{ id: number; name: string; qty: number } | null>(
    options.initialBomId ? { id: options.initialBomId, name: `Bill of materials #${options.initialBomId}`, qty: 0 } : null,
  )
  const [dirty, setDirty] = useState(false)
  const costTouched = useRef<Set<string>>(new Set())
  const [, forceCostTick] = useState(0)

  const touch = useCallback(() => setDirty(true), [])

  const patchHeader = useCallback(
    (patch: Partial<HeaderDraft>) => {
      touch()
      setHeader((h) => ({ ...h, ...patch }))
    },
    [touch],
  )

  const setterFor = useCallback(
    (role: DisassemblyRole) => (role === 'finished' ? setFinished : setComponents),
    [],
  )

  const updateLine = useCallback(
    (role: DisassemblyRole, key: string, patch: Partial<LineDraft>) => {
      touch()
      setterFor(role)((lines) => lines.map((l) => (l.key === key ? { ...l, ...patch } : l)))
    },
    [setterFor, touch],
  )

  /**
   * Adopting a searched item: units, tracking flags and the default warehouse come with it, and
   * anything that belonged to the previous item (batch, serials) is dropped rather than carried
   * onto a different product.
   */
  const pickItem = useCallback(
    (role: DisassemblyRole, key: string, row: ItemSearchRow, defaultWarehouseId: number | null) => {
      touch()
      const units = unitOptionsFrom(row)
      const def = units.find((u) => u.is_default) ?? units[0]
      setterFor(role)((lines) =>
        lines.map((l) =>
          l.key === key
            ? {
                ...l,
                item_id: row.item_id,
                item_name: row.print_name || row.item_name,
                item_sku: row.item_sku,
                track_batch: Number(row.track_batch) === 1,
                track_serial: Number(row.track_serial) === 1,
                units,
                unit_id: def?.unit_id ?? row.unit_id ?? null,
                warehouse_id: l.warehouse_id ?? row.default_warehouse_id ?? defaultWarehouseId ?? null,
                batch_id: null,
                batch_no: null,
                serials: [],
                valuation_rate: '',
              }
            : l,
        ),
      )
      costTouched.current.delete(key)
    },
    [setterFor, touch],
  )

  const clearItem = useCallback(
    (role: DisassemblyRole, key: string) => {
      touch()
      setterFor(role)((lines) =>
        lines.map((l) =>
          l.key === key
            ? { ...l, item_id: null, item_name: '', item_sku: null, track_batch: false, track_serial: false, units: [], unit_id: null, batch_id: null, batch_no: null, serials: [], valuation_rate: '' }
            : l,
        ),
      )
      costTouched.current.delete(key)
    },
    [setterFor, touch],
  )

  const addLine = useCallback(
    (role: DisassemblyRole, partial: Partial<LineDraft> = {}) => {
      touch()
      const line = role === 'finished' ? newFinishedLine(spec, partial) : newComponentLine(spec, partial)
      setterFor(role)((lines) => [...lines, line])
      return line.key
    },
    [setterFor, spec, touch],
  )

  const removeLine = useCallback(
    (role: DisassemblyRole, key: string) => {
      touch()
      costTouched.current.delete(key)
      setterFor(role)((lines) => {
        const next = lines.filter((l) => l.key !== key)
        // A section with no rows at all has nowhere to type; keep one blank row to land in.
        return next.length > 0 ? next : [role === 'finished' ? newFinishedLine(spec) : newComponentLine(spec)]
      })
    },
    [setterFor, spec, touch],
  )

  const setLines = useCallback(
    (role: DisassemblyRole, lines: LineDraft[]) => {
      touch()
      setterFor(role)(lines.length > 0 ? lines : [role === 'finished' ? newFinishedLine(spec) : newComponentLine(spec)])
    },
    [setterFor, spec, touch],
  )

  const markCostTouched = useCallback((key: string) => {
    if (costTouched.current.has(key)) return
    costTouched.current.add(key)
    forceCostTick((t) => t + 1)
  }, [])

  // Not a user edit: prefilling a cost that was never typed must not arm the unsaved-changes
  // guard, or opening the screen and leaving would ask whether to discard a document nobody
  // touched.
  const applyCosts = useCallback((next: LineDraft[]) => setComponents(next), [])

  // Reference data arriving is not the user editing: prefilling the warehouse a company has only
  // one of must not make "leave this page?" appear on a document nobody typed into.
  const setDefaultWarehouse = useCallback((id: number) => {
    setHeader((h) => (h.default_warehouse_id === null ? { ...h, default_warehouse_id: id } : h))
    // Same array back when nothing needs filling: a new array every render would be a new state
    // value every render, and the effect that calls this would never settle.
    const fill = (lines: LineDraft[]) =>
      lines.some((l) => l.warehouse_id === null) ? lines.map((l) => (l.warehouse_id === null ? { ...l, warehouse_id: id } : l)) : lines
    setFinished(fill)
    setComponents(fill)
  }, [])

  /**
   * A stored line knows its own unit and nothing else; the pickers need the item's unit list and
   * its batch / serial flags, which only the item master has. Same reason, and same shape, as the
   * hydration DocumentForm does when it opens a saved draft.
   */
  const hydrateItems = useCallback((byId: Map<number, ItemSearchRow>) => {
    const fill = (lines: LineDraft[]) => {
      let changed = false
      const next = lines.map((l) => {
        const item = l.item_id === null ? undefined : byId.get(l.item_id)
        if (!item) return l
        const units = unitOptionsFrom(item)
        changed = true
        return {
          ...l,
          item_sku: l.item_sku ?? item.item_sku,
          track_batch: l.track_batch || Number(item.track_batch) === 1,
          track_serial: l.track_serial || Number(item.track_serial) === 1,
          units: units.length > l.units.length ? units : l.units,
        }
      })
      return changed ? next : lines
    }
    setFinished(fill)
    setComponents(fill)
  }, [])

  const setCostBasis = useCallback(
    (basis: CostBasis) => {
      touch()
      setCostBasisState(basis)
      if (basis !== 'manual') costTouched.current = new Set()
    },
    [touch],
  )

  const setBom = useCallback(
    (next: { id: number; name: string; qty: number } | null) => {
      touch()
      setBomState(next)
    },
    [touch],
  )

  const draft = useMemo<DisassemblyDraft>(() => ({ header, finished, components }), [header, finished, components])

  return {
    draft,
    costBasis,
    bomId: bom?.id ?? null,
    bomName: bom?.name ?? null,
    bomQty: bom?.qty ?? null,
    dirty,
    costTouched: costTouched.current,
    patchHeader,
    updateLine,
    pickItem,
    clearItem,
    addLine,
    removeLine,
    setLines,
    markCostTouched,
    applyCosts,
    setCostBasis,
    setBom,
    markClean: useCallback(() => setDirty(false), []),
    markDirty: touch,
    setDefaultWarehouse,
    hydrateItems,
  }
}

/** A fresh pair of line lists — one empty finished row, one empty component row. */
export function initialLines(spec: DocumentTypeSpec, warehouseId: number | null): { finished: LineDraft[]; components: LineDraft[] } {
  return {
    finished: [newFinishedLine(spec, { warehouse_id: warehouseId })],
    components: [newComponentLine(spec, { warehouse_id: warehouseId })],
  }
}
