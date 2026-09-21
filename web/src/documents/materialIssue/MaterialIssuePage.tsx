import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { CircleHelp, Keyboard, PackageMinus, PlayCircle, Send } from 'lucide-react'
import { useAccess } from '../../access/AccessContext'
import { useCompany } from '../../company/CompanyContext'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { Notice } from '../../components/Notice'
import { useQuery } from '../../hooks/useQuery'
import { useKeyboardScope } from '../../keyboard/useKeyboardScope'
import { errorMessage, isApiError } from '../../services/api'
import { documentsApi } from '../../services/documentsApi'
import { lookupApi } from '../../services/lookupApi'
import type { ItemSearchRow } from '../../services/lookupApi'
import { settingsApi } from '../../services/settingsApi'
import type { AvailabilityCheckLine } from '../../services/stockApi'
import { Badge, Button, MenuButton, notify } from '../../ui'
import { BreadcrumbHeader, PageShell, StickyActionBar } from '../../ui/shell'
import { AIC, cx } from '../../ui/cx'
import { formatQty, todayIso } from '../../utils/format'
import { unitOptionsFrom } from '../LineEditor'
import { canCreate, permissionKeysFor, STATUS_LABELS, statusTone } from '../actions'
import { isBlankLine, lineBaseQty, newHeader, newLine, toPayload, validateDraft } from '../formModel'
import type { HeaderDraft, LineDraft } from '../formModel'
import { offendingDraftKeys, parseNegativeStock } from '../negativeStock'
import type { NegativeStockDetail } from '../negativeStock'
import type { DocumentTypeSpec } from '../registry'
import type { DocumentStatus, InventoryDocument, PostingWarning } from '../types'
import { useAvailability } from '../useAvailability'
import type { AvailabilityEntry } from '../useAvailability'
import { useReferenceData } from '../useReferenceData'
import { AddMultipleItemsDialog } from './AddMultipleItemsDialog'
import { BarcodeScanDialog } from './BarcodeScanDialog'
import { ExcelImportDialog } from './ExcelImportDialog'
import type { ResolvedImportLine } from './ExcelImportDialog'
import { MaterialIssueAssistant } from './MaterialIssueAssistant'
import { MaterialIssueDetails } from './MaterialIssueDetails'
import { MaterialIssueInsights } from './MaterialIssueInsights'
import { MaterialIssueLines } from './MaterialIssueLines'
import { MaterialIssueSupport } from './MaterialIssueSupport'
import { ShortcutsDialog } from './ShortcutsDialog'
import { assistantSuggestions } from './assistant'
import { DEFAULT_ISSUE_MODE, issueModeFromMetadata } from './issueMode'
import type { IssueMode } from './issueMode'
import { validateMaterialIssue } from './validation'

export interface MaterialIssuePageProps {
  spec: DocumentTypeSpec
  /** Editing an existing draft. */
  documentId?: number
  initial?: { header: HeaderDraft; lines: LineDraft[] }
  documentNo?: string | null
  status?: DocumentStatus
  /** Rendered under the header — the re-approval warning when editing an approved draft. */
  notice?: ReactNode
  onSaved: (doc: InventoryDocument, posted: boolean) => void
}

type PostFollowUp = 'view' | 'new' | 'print'

function describeError(err: unknown): string {
  if (isApiError(err)) return err.field ? `${err.message} (${err.field})` : err.message
  return errorMessage(err)
}

/** Reads a metadata value that should be a string, whatever the server stored. */
function metaString(value: unknown): string {
  return typeof value === 'string' ? value : value === null || value === undefined ? '' : String(value)
}

/**
 * Material Issue — create and edit.
 *
 * The business core is the shared one: `formModel` builds and validates the
 * draft and the payload, `documentsApi` saves and posts it, `useAvailability`
 * checks stock, and the batch / serial / item pickers are the same components
 * every other document editor uses. What is local to this screen is the
 * arrangement: the issue-mode switch, the line grid, the insight rail and the
 * assistant.
 *
 * Saving always writes the draft first and posts second, so a negative-stock
 * block leaves a saved document that can be posted again with an override
 * instead of losing the entry.
 */
export function MaterialIssuePage({ spec, documentId, initial, documentNo, status, notice, onSaved }: MaterialIssuePageProps) {
  const navigate = useNavigate()
  const { can } = useAccess()
  const { scope, fyRange, warning: companyWarning } = useCompany()
  const { warehouses, defaultWarehouseId, warehouseName, loading: refLoading, error: refError } = useReferenceData()

  const [header, setHeader] = useState<HeaderDraft>(() => initial?.header ?? newHeader(spec, todayIso()))
  const [lines, setLines] = useState<LineDraft[]>(() => initial?.lines ?? [newLine(spec)])
  const [savedId, setSavedId] = useState<number | null>(documentId ?? null)
  const [busy, setBusy] = useState<'save' | 'post' | null>(null)
  /**
   * What the user last tried, which is not the same as `busy`: a submit that
   * fails validation never sets `busy`, and posting asks for a reason code that
   * saving a draft does not. Messages are placed off this, so they keep saying
   * the right thing after the attempt is over.
   */
  const [attempt, setAttempt] = useState<'save' | 'post' | null>(null)
  /** Only what the shared server-mirror validator caught and this screen did not. */
  const [mirrorErrors, setMirrorErrors] = useState<string[]>([])
  const [apiError, setApiError] = useState<string | null>(null)
  const [negative, setNegative] = useState<NegativeStockDetail[] | null>(null)
  const [override, setOverride] = useState(false)
  const [warnings, setWarnings] = useState<PostingWarning[]>([])
  const [pendingWarehouse, setPendingWarehouse] = useState<number | null>(null)
  const [dialog, setDialog] = useState<'add' | 'scan' | 'import' | 'shortcuts' | null>(null)

  const settings = useQuery((signal) => settingsApi.get(signal), [], { resetKey: scope?.cmp_id ?? null })
  const currencyCode = settings.data?.base_currency_code || 'INR'

  const canOverride = can('stock.negative_override')
  const canPost = can(permissionKeysFor('post', spec.code))
  const canSave = savedId ? can(permissionKeysFor('edit', spec.code)) : canCreate(spec.code, can)
  const disabled = busy !== null

  const issueMode = issueModeFromMetadata(header.metadata)

  const patchHeader = useCallback((patch: Partial<HeaderDraft>) => setHeader((h) => ({ ...h, ...patch })), [])
  const patchMetadata = useCallback(
    (patch: Record<string, unknown>) => setHeader((h) => ({ ...h, metadata: { ...h.metadata, ...patch } })),
    [],
  )

  // Pre-fill the default warehouse once reference data lands (new documents only).
  useEffect(() => {
    if (documentId || header.default_warehouse_id !== null || defaultWarehouseId === null) return
    setHeader((h) => ({ ...h, default_warehouse_id: defaultWarehouseId }))
    setLines((ls) => ls.map((l) => (l.warehouse_id === null ? { ...l, warehouse_id: defaultWarehouseId } : l)))
  }, [defaultWarehouseId, documentId, header.default_warehouse_id])

  // Editing: a stored line knows only its own unit, so fetch the items once and
  // the unit dropdown, batch picker and serial picker work as they do on a new
  // document. Same hydration the shared form does.
  const hydrated = useRef(false)
  useEffect(() => {
    if (!initial || hydrated.current) return undefined
    hydrated.current = true
    const ids = [...new Set(initial.lines.map((l) => l.item_id).filter((id): id is number => id !== null))]
    if (ids.length === 0) return undefined
    const controller = new AbortController()
    lookupApi
      .itemsByIds(ids, controller.signal)
      .then((items) => {
        if (controller.signal.aborted) return
        const byId = new Map(items.map((it) => [it.item_id, it]))
        setLines((ls) =>
          ls.map((l) => {
            const it = l.item_id !== null ? byId.get(l.item_id) : undefined
            if (!it) return l
            const units = unitOptionsFrom(it)
            return {
              ...l,
              item_sku: l.item_sku ?? it.item_sku,
              track_batch: l.track_batch || Number(it.track_batch) === 1,
              track_serial: l.track_serial || Number(it.track_serial) === 1,
              units: units.length > l.units.length ? units : l.units,
            }
          }),
        )
      })
      .catch(() => {
        /* the stored unit still works; the pickers just stay minimal */
      })
    return () => controller.abort()
  }, [initial])

  const makeLine = useCallback(
    (partial: Partial<LineDraft> = {}) => newLine(spec, { warehouse_id: header.default_warehouse_id, ...partial }),
    [spec, header.default_warehouse_id],
  )

  const applyPick = useCallback(
    (line: LineDraft, row: ItemSearchRow): Partial<LineDraft> => {
      const units = unitOptionsFrom(row)
      const def = units.find((u) => u.is_default) ?? units[0]
      return {
        item_id: row.item_id,
        item_name: row.print_name || row.item_name,
        item_sku: row.item_sku,
        track_batch: Number(row.track_batch) === 1,
        track_serial: Number(row.track_serial) === 1,
        units,
        unit_id: def?.unit_id ?? row.unit_id ?? null,
        warehouse_id: line.warehouse_id ?? row.default_warehouse_id ?? header.default_warehouse_id ?? null,
        batch_id: null,
        batch_no: null,
        serials: [],
      }
    },
    [header.default_warehouse_id],
  )

  const entries = useMemo<AvailabilityEntry[]>(() => {
    const out: AvailabilityEntry[] = []
    for (const l of lines) {
      if (!l.item_id) continue
      const qty = lineBaseQty(l)
      if (qty <= 0) continue
      const line: AvailabilityCheckLine = {
        item_id: l.item_id,
        warehouse_id: l.warehouse_id ?? header.default_warehouse_id ?? null,
        batch_id: l.batch_id,
        qty,
      }
      out.push({ key: l.key, line })
    }
    return out
  }, [lines, header.default_warehouse_id])

  const { results: availability, checking } = useAvailability(entries, true)

  // Recomputed every render once something has been tried, so a message clears
  // the moment the field it belongs to is fixed.
  const shown = useMemo(
    () => (attempt ? validateMaterialIssue(header, lines, { requireReason: attempt === 'post', fyRange }) : null),
    [attempt, header, lines, fyRange],
  )
  const suggestions = useMemo(
    () => assistantSuggestions({ header, lines, availability, warehouseName }),
    [header, lines, availability, warehouseName],
  )
  const offending = useMemo(() => new Set(negative ? offendingDraftKeys(lines, negative) : []), [negative, lines])

  const activeLines = lines.filter((l) => !isBlankLine(l))
  const totalQty = activeLines.reduce((sum, l) => sum + (Number(l.qty) || 0), 0)
  const dirty = activeLines.length > 0 || header.reason_code !== '' || header.narration !== ''

  // ---------------------------------------------------------------- entry helpers

  const addFromSearchRows = (rows: ItemSearchRow[]) => {
    setLines((ls) => {
      const kept = ls.filter((l) => !isBlankLine(l))
      const fresh = rows.map((row) => {
        const base = makeLine()
        return { ...base, ...applyPick(base, row), qty: '1' }
      })
      return [...kept, ...fresh]
    })
  }

  /** A scan bumps the line that already holds that item where it can, else adds one. */
  const applyScan = (row: ItemSearchRow) => {
    setLines((ls) => {
      const at = ls.findIndex(
        (l) =>
          l.item_id === row.item_id &&
          !l.track_serial &&
          !l.track_batch &&
          (l.warehouse_id ?? header.default_warehouse_id) === (header.default_warehouse_id ?? null),
      )
      if (at >= 0) {
        const next = [...ls]
        next[at] = { ...next[at], qty: String((Number(next[at].qty) || 0) + 1) }
        return next
      }
      const base = makeLine()
      return [...ls.filter((l) => !isBlankLine(l)), { ...base, ...applyPick(base, row), qty: '1' }]
    })
  }

  const applyImport = (imported: ResolvedImportLine[]) => {
    setLines((ls) => {
      const kept = ls.filter((l) => !isBlankLine(l))
      const fresh = imported.map(({ source, item, warehouseId }) => {
        const base = makeLine({ warehouse_id: warehouseId ?? header.default_warehouse_id })
        return {
          ...base,
          ...applyPick(base, item),
          warehouse_id: warehouseId ?? header.default_warehouse_id,
          qty: String(source.qty),
          description: source.remarks,
        }
      })
      return [...kept, ...fresh]
    })
    notify.success(`${imported.length} line${imported.length === 1 ? '' : 's'} imported.`)
  }

  const changeDefaultWarehouse = (id: number | null) => {
    const movable = lines.filter((l) => !isBlankLine(l) && l.warehouse_id !== id)
    patchHeader({ default_warehouse_id: id })
    setLines((ls) => ls.map((l) => (isBlankLine(l) ? { ...l, warehouse_id: id } : l)))
    // Lines already entered belong where they were entered; moving them is the
    // user's call, because it changes which stock the issue takes out.
    if (movable.length > 0 && id !== null) setPendingWarehouse(id)
  }

  const moveLinesToDefault = (id: number) => {
    setLines((ls) =>
      ls.map((l) => (isBlankLine(l) ? l : { ...l, warehouse_id: id, batch_id: null, batch_no: null, serials: [] })),
    )
    setPendingWarehouse(null)
  }

  // ---------------------------------------------------------------- submitting

  const submit = async (post: boolean, followUp: PostFollowUp = 'view') => {
    setAttempt(post ? 'post' : 'save')
    setApiError(null)
    setWarnings([])
    if (!post) setNegative(null)

    const local = validateMaterialIssue(header, lines, { requireReason: post, fyRange })
    // The shared validator mirrors what the server refuses; it runs as well as
    // the placed one, never instead of it.
    const mirrored = validateDraft(header, lines, spec)
    const messages = local.messages.length > 0 ? local.messages : mirrored
    if (messages.length > 0) {
      setMirrorErrors(local.ok ? mirrored : [])
      notify.error(`${messages.length} thing${messages.length === 1 ? '' : 's'} to fix before this issue can be ${post ? 'posted' : 'saved'}.`)
      return
    }
    setMirrorErrors([])

    const payload = toPayload(header, lines, spec)
    setBusy(post ? 'post' : 'save')
    let id = savedId
    try {
      let doc: InventoryDocument
      if (id) {
        doc = await documentsApi.update(id, payload)
      } else {
        doc = await documentsApi.create(payload)
        id = doc.document_id
        setSavedId(id)
      }
      if (post) {
        doc = await documentsApi.post(doc.document_id, { negativeOverride: override && canOverride })
        setWarnings(doc.warnings ?? [])
        notify.success(`Material issue ${doc.document_no ?? `#${doc.document_id}`} posted.`)
        if (followUp === 'print') {
          navigate(`/documents/${doc.document_id}/print`)
          return
        }
        if (followUp === 'new') {
          setHeader(newHeader(spec, header.document_date))
          setLines([newLine(spec, { warehouse_id: defaultWarehouseId })])
          setSavedId(null)
          setAttempt(null)
          setOverride(false)
          setNegative(null)
          return
        }
      } else {
        notify.success(`Draft ${doc.document_no ?? `#${doc.document_id}`} saved.`)
      }
      onSaved(doc, post)
    } catch (err) {
      const neg = parseNegativeStock(err)
      if (neg) {
        setNegative(neg)
        setApiError(id ? `Draft #${id} is saved but could not be posted: ${errorMessage(err)}` : errorMessage(err))
      } else {
        setApiError(describeError(err))
      }
      notify.error(post ? 'The material issue could not be posted.' : 'The draft could not be saved.')
    } finally {
      setBusy(null)
    }
  }

  // ---------------------------------------------------------------- shortcuts

  const bindings = useMemo(
    () => ({
      'ctrl+s': (e: KeyboardEvent) => {
        e.preventDefault()
        if (!disabled && canSave) void submit(false)
      },
      'ctrl+enter': (e: KeyboardEvent) => {
        e.preventDefault()
        if (!disabled && canPost) void submit(true)
      },
      'alt+a': (e: KeyboardEvent) => {
        e.preventDefault()
        if (!disabled) setLines((ls) => [...ls, makeLine()])
      },
      f2: (e: KeyboardEvent) => {
        e.preventDefault()
        setDialog('shortcuts')
      },
    }),
    // `submit` closes over the whole draft and is rebuilt every render; binding
    // to it directly would re-register the scope on every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [disabled, canSave, canPost, makeLine, header, lines, savedId, override],
  )
  useKeyboardScope('form', bindings, { allowInInput: true })

  // ---------------------------------------------------------------- render

  const fieldErrors = shown?.fieldErrors ?? {}
  const lineErrors = shown?.lineErrors ?? {}
  const summaryErrors = shown && !shown.ok ? shown.messages : mirrorErrors

  const postActions = [
    { key: 'post-new', label: 'Save & post, then new', icon: PlayCircle, onSelect: () => void submit(true, 'new') },
    { key: 'post-print', label: 'Save & post, then print', icon: PackageMinus, onSelect: () => void submit(true, 'print') },
  ]

  return (
    <PageShell paddingBottom className={cx(AIC, 'material-issue-page')}>
      <BreadcrumbHeader
        breadcrumbs={[{ label: 'Documents', to: '/documents' }, { label: 'Material issue' }]}
        title={savedId ? `Material issue ${documentNo ?? `#${savedId}`}` : 'Material issue'}
        description="Issue material out of stores (COGS). Track, control and maintain accurate stock movement."
        icon={PackageMinus}
        badge={status ? <Badge tone={statusTone(status) === 'neutral' ? 'neutral' : statusTone(status)}>{STATUS_LABELS[status] ?? status}</Badge> : null}
        escDirty={dirty}
        backTo="/documents"
        aside={
          <div className="rounded-xl bg-emerald-50 px-4 py-2.5">
            <p className="text-xs font-semibold leading-snug text-gray-800">
              Issue today. Track tomorrow.
              <br />
              Smarter inventory always.
            </p>
          </div>
        }
        actions={
          <>
            <Button variant="secondary" icon={CircleHelp} onClick={() => setDialog('shortcuts')}>
              Quick help
            </Button>
            <Button variant="secondary" icon={Keyboard} kbd="F2" onClick={() => setDialog('shortcuts')}>
              Shortcuts
            </Button>
          </>
        }
      />

      {notice}
      {refError ? <Notice kind="warning">{refError}</Notice> : null}
      {companyWarning ? <Notice kind="warning">{companyWarning}</Notice> : null}

      <div className="grid min-w-0 grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <main className="min-w-0 space-y-4">
          <MaterialIssueDetails
            header={header}
            issueMode={issueMode}
            onModeChange={(mode: IssueMode) => patchMetadata({ issue_mode: mode === DEFAULT_ISSUE_MODE ? DEFAULT_ISSUE_MODE : mode })}
            onChange={patchHeader}
            onDefaultWarehouseChange={changeDefaultWarehouse}
            warehouses={warehouses}
            warehousesLoading={refLoading}
            fyRange={fyRange}
            errors={fieldErrors}
            disabled={disabled}
          />

          <MaterialIssueLines
            header={header}
            lines={lines}
            warehouses={warehouses}
            availability={availability}
            checking={checking}
            offendingKeys={offending}
            lineErrors={lineErrors}
            disabled={disabled}
            makeLine={makeLine}
            applyPick={applyPick}
            onChange={setLines}
            onAddMultiple={() => setDialog('add')}
            onScan={() => setDialog('scan')}
            onImport={() => setDialog('import')}
          />

          {summaryErrors.length > 0 ? (
            <Notice kind="error" title="Please fix before saving">
              <ul className="warning-list">
                {summaryErrors.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            </Notice>
          ) : null}

          {apiError && !negative ? <Notice kind="error">{apiError}</Notice> : null}

          {negative ? (
            <Notice kind="error" title="Insufficient stock">
              {apiError ? <div>{apiError}</div> : null}
              <ul className="warning-list">
                {negative.map((d, i) => (
                  <li key={`${d.item_id}-${d.warehouse_id}-${i}`}>
                    {d.item_name ?? `Item #${d.item_id}`}
                    {d.warehouse_id ? ` · ${warehouseName(d.warehouse_id) || `warehouse #${d.warehouse_id}`}` : ''}: on hand{' '}
                    {formatQty(d.on_hand)}, required {formatQty(d.required)}, short by <strong>{formatQty(d.short_by)}</strong>
                  </li>
                ))}
              </ul>
              {canOverride ? (
                <label className="checkbox" style={{ marginTop: '0.5rem' }}>
                  <input type="checkbox" checked={override} onChange={(e) => setOverride(e.target.checked)} />
                  Post anyway and let stock go negative (override)
                </label>
              ) : (
                <div className="hint">
                  Reduce the quantities or receive stock first. Posting into negative stock needs the “override
                  negative-stock block” permission.
                </div>
              )}
            </Notice>
          ) : null}

          {warnings.length > 0 ? (
            <Notice kind="warning" title="Posted with warnings">
              <ul className="warning-list">
                {warnings.map((w, i) => (
                  <li key={`${w.code}-${i}`}>{w.message}</li>
                ))}
              </ul>
            </Notice>
          ) : null}

          <MaterialIssueSupport
            issueMode={issueMode}
            referenceNo={metaString(header.metadata.reference_no)}
            referenceDate={metaString(header.metadata.reference_date)}
            productionDocumentId={
              typeof header.metadata.production_document_id === 'number' ? header.metadata.production_document_id : null
            }
            onReferenceChange={(next) =>
              patchMetadata({
                ...(next.referenceNo !== undefined ? { reference_no: next.referenceNo } : {}),
                ...(next.referenceDate !== undefined ? { reference_date: next.referenceDate } : {}),
                ...(next.productionDocumentId !== undefined ? { production_document_id: next.productionDocumentId } : {}),
              })
            }
            savedId={savedId}
            disabled={disabled}
          />
        </main>

        <aside className="min-w-0 space-y-4 md:grid md:grid-cols-2 md:gap-4 md:space-y-0 xl:block xl:space-y-4">
          <MaterialIssueInsights
            warehouseId={header.default_warehouse_id}
            warehouseName={warehouseName(header.default_warehouse_id)}
            asOf={header.document_date || todayIso()}
            currencyCode={currencyCode}
            scopeKey={scope ? `${scope.cmp_id}:${scope.fy_id}:${scope.bo_id}` : null}
          />
          <MaterialIssueAssistant suggestions={suggestions} />
        </aside>
      </div>

      <StickyActionBar
        totals={
          <>
            <span className="text-xs text-gray-600">
              Lines <strong className="tabular-nums text-gray-900">{activeLines.length}</strong>
            </span>
            <span className="text-xs text-gray-600">
              Total qty <strong className="tabular-nums text-gray-900">{formatQty(totalQty, '0')}</strong>
            </span>
            {savedId ? <span className="text-xs text-gray-500">Draft #{savedId}</span> : null}
          </>
        }
      >
        <Link
          to={savedId ? `/documents/${savedId}` : '/documents'}
          data-unsaved-allow
          className="inline-flex h-8 items-center rounded-lg border border-gray-200 bg-white px-3 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
        >
          Cancel
        </Link>
        <Button
          variant="secondary"
          kbd="Ctrl S"
          loading={busy === 'save'}
          disabled={disabled || !canSave}
          onClick={() => void submit(false)}
        >
          {savedId ? 'Save changes' : 'Save as draft'}
        </Button>
        {canPost ? (
          <div className="flex items-center">
            <Button
              variant="primary"
              icon={Send}
              className="rounded-r-none"
              loading={busy === 'post'}
              disabled={disabled || (!canSave && !savedId)}
              onClick={() => void submit(true)}
            >
              {negative && override ? 'Post with override' : 'Save & post'}
            </Button>
            <MenuButton
              actions={postActions}
              label="More posting options"
              variant="primary"
              size="sm"
              className="rounded-l-none border-l border-white/25 px-1.5"
              buttonProps={{ disabled: disabled || (!canSave && !savedId) }}
            />
          </div>
        ) : null}
      </StickyActionBar>

      <AddMultipleItemsDialog
        open={dialog === 'add'}
        onClose={() => setDialog(null)}
        warehouseId={header.default_warehouse_id}
        warehouseName={warehouseName(header.default_warehouse_id)}
        onAdd={addFromSearchRows}
      />
      <BarcodeScanDialog
        open={dialog === 'scan'}
        onClose={() => setDialog(null)}
        warehouseId={header.default_warehouse_id}
        onScanned={applyScan}
      />
      <ExcelImportDialog
        open={dialog === 'import'}
        onClose={() => setDialog(null)}
        warehouses={warehouses}
        defaultWarehouseId={header.default_warehouse_id}
        onImport={applyImport}
      />
      <ShortcutsDialog open={dialog === 'shortcuts'} onClose={() => setDialog(null)} />

      <ConfirmDialog
        open={pendingWarehouse !== null}
        title="Move the existing lines too?"
        message={`New lines will use ${warehouseName(pendingWarehouse)}. Move the lines already entered there as well? Their batch and serial selections will be cleared, because those belong to the warehouse they were picked in.`}
        confirmLabel="Move all lines"
        onCancel={() => setPendingWarehouse(null)}
        onConfirm={() => {
          if (pendingWarehouse !== null) moveLinesToDefault(pendingWarehouse)
        }}
      />
    </PageShell>
  )
}

export default MaterialIssuePage
