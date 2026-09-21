import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { History, PackageCheck, ScanLine, Send, Sparkles } from 'lucide-react'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { Notice } from '../../components/Notice'
import { useUnsavedChanges } from '../../hooks/useUnsavedChanges'
import { useKeyboardScope } from '../../keyboard/useKeyboardScope'
import type { FormOptionWarehouse } from '../../services/items'
import type { AvailabilityCheckResult } from '../../services/stockApi'
import { Button } from '../../ui/Button'
import { Tooltip } from '../../ui/Tooltip'
import { cx } from '../../ui/cx'
import { BreadcrumbHeader } from '../../ui/shell/BreadcrumbHeader'
import { ActionBarTotal, StickyActionBar } from '../../ui/shell/StickyActionBar'
import { formatQty } from '../../utils/format'
import { isBlankLine, newLine } from '../formModel'
import type { DraftTotals, HeaderDraft, LineDraft } from '../formModel'
import type { NegativeStockDetail } from '../negativeStock'
import type { DocumentTypeSpec } from '../registry'
import type { PostingWarning } from '../types'
import { AdditionalDetailsSection } from './AdditionalDetailsSection'
import { PackingAIInsightsPanel } from './PackingAIInsightsPanel'
import { PackingDetailsCard } from './PackingDetailsCard'
import { PackingItemsCard } from './PackingItemsCard'
import { PackingPreviewPanel } from './PackingPreviewPanel'
import { PackingSummaryPanel } from './PackingSummaryPanel'

export interface PackingFormViewProps {
  spec: DocumentTypeSpec
  /** Present only when editing an existing draft. */
  documentId?: number
  header: HeaderDraft
  patchHeader: (patch: Partial<HeaderDraft>) => void
  lines: LineDraft[]
  setLines: (lines: LineDraft[]) => void
  warehouses: FormOptionWarehouse[]
  warehouseName: (id: number | null | undefined) => string
  unitSymbol: (id: number | null | undefined) => string
  refError: string | null
  availability: Record<string, AvailabilityCheckResult>
  checking: boolean
  offendingKeys: ReadonlySet<string>
  totals: DraftTotals
  errors: string[]
  apiError: string | null
  negative: NegativeStockDetail[] | null
  override: boolean
  setOverride: (v: boolean) => void
  canOverride: boolean
  warnings: PostingWarning[]
  savedId: number | null
  busy: 'save' | 'post' | null
  canSave: boolean
  canPost: boolean
  submit: (post: boolean) => void
}

/**
 * The premium Packing List layout: header, document-details + items on the left, a sticky
 * summary/preview/AI-insights rail on the right, sticky save bar. Every hook above this in
 * `DocumentForm` (state, validation, submit, availability) is unchanged — this component only
 * decides how it is drawn, for `formKind === 'packing'` alone.
 */
export function PackingFormView({
  spec,
  documentId,
  header,
  patchHeader,
  lines,
  setLines,
  warehouses,
  warehouseName,
  unitSymbol,
  refError,
  availability,
  checking,
  offendingKeys,
  totals,
  errors,
  apiError,
  negative,
  override,
  setOverride,
  canOverride,
  warnings,
  savedId,
  busy,
  canSave,
  canPost,
  submit,
}: PackingFormViewProps) {
  const disabled = busy !== null
  const editing = documentId != null
  const scanFieldRef = useRef<HTMLInputElement>(null)
  const aiPanelRef = useRef<HTMLDivElement>(null)
  const [aiPulse, setAiPulse] = useState(false)
  const [addMultipleOpen, setAddMultipleOpen] = useState(false)

  // ---- dirty tracking -------------------------------------------------------------------
  // Compared against a snapshot taken once on mount, and reset the moment a save/post
  // completes without error — from then on "dirty" means edited since that save, not since
  // the page opened.
  const baselineRef = useRef<string | undefined>(undefined)
  if (baselineRef.current === undefined) baselineRef.current = JSON.stringify({ header, lines })
  const prevBusy = useRef(busy)
  useEffect(() => {
    if (prevBusy.current !== null && busy === null && !apiError && errors.length === 0) {
      baselineRef.current = JSON.stringify({ header, lines })
    }
    prevBusy.current = busy
  }, [busy, apiError, errors, header, lines])
  const dirty = !disabled && JSON.stringify({ header, lines }) !== baselineRef.current

  const [pendingNav, setPendingNav] = useState<(() => void) | null>(null)
  useUnsavedChanges({
    when: dirty,
    onBlocked: (_to, proceed) => setPendingNav(() => proceed),
  })

  const addBlankLine = () => setLines([...lines, newLine(spec, { warehouse_id: header.default_warehouse_id })])

  // ---- keyboard shortcuts ---------------------------------------------------------------
  // alt+s is already the app-wide "go to Stock" mnemonic (keyboard/shortcutRegistry.ts), so it is
  // deliberately not reused for Save here. `escape` is deliberately absent from this scope's
  // bindings so the page-level Esc-to-back (BreadcrumbHeader, below) keeps handling it.
  useKeyboardScope(
    'form',
    {
      'ctrl+s': (e) => {
        if (disabled || !canSave) return
        e.preventDefault()
        submit(false)
      },
      'alt+a': (e) => {
        if (disabled) return
        e.preventDefault()
        addBlankLine()
      },
      'alt+m': (e) => {
        if (disabled) return
        e.preventDefault()
        setAddMultipleOpen(true)
      },
      'alt+p': (e) => {
        if (disabled || !canPost || (!canSave && !savedId)) return
        e.preventDefault()
        submit(true)
      },
    },
    { allowInInput: true },
  )

  const runAiSuggest = () => {
    aiPanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    setAiPulse(true)
    window.setTimeout(() => setAiPulse(false), 900)
  }

  const activeLines = lines.filter((l) => !isBlankLine(l))
  const totalQty = activeLines.reduce((sum, l) => sum + (Number(l.qty) || 0), 0)

  return (
    <div className="aic mx-auto flex w-full max-w-screen-2xl flex-col gap-4 pb-24">
      <BreadcrumbHeader
        breadcrumbs={[{ label: 'Documents', to: '/documents' }, { label: 'Packing List', to: '/packing-lists' }, { label: editing ? header.document_no || `#${documentId}` : 'New' }]}
        icon={PackageCheck}
        title={editing ? `Edit packing list${header.document_no ? ` ${header.document_no}` : ''}` : 'New Packing List'}
        description="Pack goods for a consignment, track what's packed and ready for dispatch."
        escDirty={dirty}
        backTo={savedId ? `/documents/${savedId}` : '/documents'}
        actions={
          <>
            <Button variant="secondary" icon={ScanLine} onClick={() => scanFieldRef.current?.focus()} disabled={disabled}>
              Scan &amp; add
            </Button>
            <Button variant="ai" icon={Sparkles} onClick={runAiSuggest} disabled={disabled}>
              AI Suggest
            </Button>
            {savedId ? (
              <Link className="btn" to={`/documents/${savedId}`}>
                <History className="h-4 w-4" aria-hidden />
                View history
              </Link>
            ) : (
              <Tooltip label="Save this packing list first">
                <Button variant="secondary" icon={History} disabled>
                  View history
                </Button>
              </Tooltip>
            )}
          </>
        }
      />

      {refError ? <Notice kind="warning">{refError}</Notice> : null}

      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex min-w-0 flex-col gap-4">
          <PackingDetailsCard header={header} patchHeader={patchHeader} warehouses={warehouses} disabled={disabled} />

          <PackingItemsCard
            spec={spec}
            header={header}
            lines={lines}
            onChange={setLines}
            warehouses={warehouses}
            availability={availability}
            checking={checking}
            offendingKeys={offendingKeys}
            disabled={disabled}
            scanFieldRef={scanFieldRef}
            onAddBlankLine={addBlankLine}
            addMultipleOpen={addMultipleOpen}
            onOpenAddMultiple={() => setAddMultipleOpen(true)}
            onCloseAddMultiple={() => setAddMultipleOpen(false)}
          />

          <AdditionalDetailsSection header={header} patchHeader={patchHeader} disabled={disabled} />

          {errors.length > 0 ? (
            <Notice kind="error" title="Please fix before saving">
              <ul className="warning-list">
                {errors.map((e) => (
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
                    {d.warehouse_id ? ` · warehouse #${d.warehouse_id}` : ''}: on hand {formatQty(d.on_hand)}, required {formatQty(d.required)}, short by <strong>{formatQty(d.short_by)}</strong>
                  </li>
                ))}
              </ul>
              {canOverride ? (
                <label className="checkbox" style={{ marginTop: '0.5rem' }}>
                  <input type="checkbox" checked={override} onChange={(e) => setOverride(e.target.checked)} />
                  Post anyway and let stock go negative (override)
                </label>
              ) : (
                <div className="hint">Reduce the quantities or receive stock first. Posting into negative stock needs the &quot;override negative-stock block&quot; permission.</div>
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
        </div>

        <aside className="flex flex-col gap-4 xl:sticky xl:top-4">
          <PackingSummaryPanel header={header} lines={lines} />
          <PackingPreviewPanel header={header} lines={lines} warehouseName={warehouseName} unitSymbol={unitSymbol} savedId={savedId} />
          <div ref={aiPanelRef} className={cx('rounded-xl transition-shadow', aiPulse && 'ring-2 ring-violet-300')}>
            <PackingAIInsightsPanel header={header} lines={lines} spec={spec} availability={availability} checking={checking} />
          </div>
        </aside>
      </div>

      <StickyActionBar
        totals={
          <>
            <ActionBarTotal label="Total items" value={totals.lines} />
            <ActionBarTotal label="Total qty" value={formatQty(totalQty)} />
            {savedId ? <ActionBarTotal label="Draft" value={`#${savedId}`} /> : null}
          </>
        }
      >
        <Link className="btn" to={savedId ? `/documents/${savedId}` : '/documents'}>
          Cancel
        </Link>
        <Button variant="secondary" onClick={() => submit(false)} loading={busy === 'save'} disabled={disabled || !canSave} kbd="Ctrl S">
          Save as draft
        </Button>
        {canPost ? (
          <Button icon={Send} onClick={() => submit(true)} loading={busy === 'post'} disabled={disabled || (!canSave && !savedId)} kbd="Alt P">
            {negative && override ? 'Post with override' : 'Save & post'}
          </Button>
        ) : null}
      </StickyActionBar>

      <ConfirmDialog
        open={pendingNav !== null}
        title="Leave this packing list?"
        message="You have unsaved changes in this packing list. Leaving now discards them."
        confirmLabel="Discard & leave"
        danger
        onConfirm={() => {
          const proceed = pendingNav
          setPendingNav(null)
          baselineRef.current = JSON.stringify({ header, lines })
          proceed?.()
        }}
        onCancel={() => setPendingNav(null)}
      />
    </div>
  )
}

export default PackingFormView
