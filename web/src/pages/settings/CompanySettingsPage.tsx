import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  Boxes,
  CheckCircle2,
  Info,
  Landmark,
  MoreHorizontal,
  Percent,
  Save,
  ShieldCheck,
  TriangleAlert,
  Truck,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useCan } from '../../access/AccessContext'
import { useCompany } from '../../company/CompanyContext'
import { RequirePermission } from '../../components/RequirePermission'
import { Notice } from '../../components/Notice'
import { COST_TYPE_HELP, COST_TYPE_LABELS } from '../../documents/landedCost'
import type { LandedCostType } from '../../documents/landedCost'
import { useQuery } from '../../hooks/useQuery'
import { P } from '../../services/access'
import { ApiError } from '../../services/api'
import { NEGATIVE_STOCK_POLICIES, VALUATION_METHODS, settingsApi } from '../../services/settingsApi'
import type { CompanySettings, NegativeStockPolicy } from '../../services/settingsApi'
import { Button } from '../../ui/Button'
import { Card } from '../../ui/Card'
import { ErrorState } from '../../ui/ErrorState'
import { Input } from '../../ui/Input'
import { Select } from '../../ui/Select'
import { Skeleton } from '../../ui/Skeleton'
import { AIC, cx } from '../../ui/cx'
import { FormField } from '../../ui/shell/FormSectionCard'
import { useToast } from '../../ui/ToastContext'
import { formatDateTime } from '../../utils/format'
import { HelpHint } from './components/HelpHint'
import { LandedCostOption } from './components/LandedCostOption'
import { SettingSwitch } from './components/SettingSwitch'
import { SettingsRightRail } from './components/SettingsRightRail'
import { SettingsSectionCard } from './components/SettingsSectionCard'
import { useSettingsChrome } from './SettingsChrome'
import {
  alwaysCapitalisedCostTypes,
  configurationHealth,
  draftPatch,
  isDirty as draftIsDirty,
  switchableCostTypes,
  toDraft,
  validateDraft,
} from './settingsDraft'
import type { SettingsDraft } from './settingsDraft'

const POLICY_HELP: Record<NegativeStockPolicy, string> = {
  allow: 'Issues may take stock below zero; the shortfall is costed at the last known rate and corrected when the receipt arrives.',
  warn: 'Issues below zero are posted but flagged on the document and in reports.',
  block: 'Issues below available stock are refused (negative_stock_blocked) unless the user overrides with a reason.',
}

const POLICY_LABELS: Record<NegativeStockPolicy, string> = {
  allow: 'Allow',
  warn: 'Warn',
  block: 'Block',
}

/** A type the server starts offering that this map has not heard of still gets a tile. */
const COST_TYPE_ICONS: Partial<Record<LandedCostType, LucideIcon>> = {
  freight: Truck,
  duty: Landmark,
  insurance: ShieldCheck,
  handling: Boxes,
  other: MoreHorizontal,
  non_creditable_tax: Percent,
}

function costTypeIcon(type: LandedCostType): LucideIcon {
  return COST_TYPE_ICONS[type] ?? MoreHorizontal
}

function costTypeLabel(type: LandedCostType): string {
  return COST_TYPE_LABELS[type] ?? type.replace(/_/g, ' ')
}

function costTypeHelp(type: LandedCostType): string {
  return COST_TYPE_HELP[type] ?? 'A charge on an inward consignment.'
}

export function CompanySettingsPage() {
  const { scope } = useCompany()
  const cmpId = scope?.cmp_id ?? null
  const toast = useToast()
  const canWrite = useCan(P.settingsWrite)
  const readOnly = !canWrite
  const { headerSlot, setDirty } = useSettingsChrome()

  const query = useQuery((signal) => settingsApi.get(signal), [cmpId], {
    enabled: cmpId !== null,
    keepData: false,
    // Another company's costing policy under this company's name is not stale data, it is the
    // wrong tenant on screen — and one Save away from being written to the wrong company.
    resetKey: cmpId,
  })

  const [server, setServer] = useState<CompanySettings | null>(null)
  const [draft, setDraft] = useState<SettingsDraft | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  // Dropped during render rather than in an effect, for the same reason useQuery drops its data
  // there: an effect runs after paint, which is one frame of the previous company's figures.
  const lastCmpId = useRef(cmpId)
  if (lastCmpId.current !== cmpId) {
    lastCmpId.current = cmpId
    if (server !== null) setServer(null)
    if (draft !== null) setDraft(null)
    if (saveError !== null) setSaveError(null)
  }

  useEffect(() => {
    const loaded = query.data
    // The response carries the company it is for; anything else is an answer to a request made
    // before the switch and must not seed this company's form.
    if (!loaded || cmpId === null || Number(loaded.cmp_id) !== cmpId) return
    setServer(loaded)
    setDraft(toDraft(loaded))
  }, [query.data, cmpId])

  const serverDraft = useMemo(() => (server ? toDraft(server) : null), [server])
  const dirty = draftIsDirty(serverDraft, draft)
  const errors = useMemo(() => (draft ? validateDraft(draft) : {}), [draft])
  const invalid = Object.keys(errors).length > 0
  const health = useMemo(() => configurationHealth(draft), [draft])

  useEffect(() => {
    setDirty(dirty)
  }, [dirty, setDirty])
  useEffect(() => () => setDirty(false), [setDirty])

  const patch = useCallback(
    (change: Partial<SettingsDraft>) => setDraft((d) => (d ? { ...d, ...change } : d)),
    [],
  )

  const save = async () => {
    if (!serverDraft || !draft || saving || invalid) return
    const body = draftPatch(serverDraft, draft)
    if (Object.keys(body).length === 0) return
    setSaving(true)
    setSaveError(null)
    try {
      const updated = await settingsApi.update(body)
      // Straight from the response, so "Last changed" is the server's own timestamp and actor and
      // the screen does not have to re-fetch to tell the truth about what it just wrote.
      setServer(updated)
      setDraft(toDraft(updated))
      toast.success('Inventory settings updated successfully.')
    } catch (e) {
      // The draft is left exactly as it was: a failed save must not cost the user their edits.
      const message = e instanceof ApiError ? e.message : 'Could not save the settings.'
      setSaveError(message)
      toast.error(message)
    } finally {
      setSaving(false)
    }
  }

  const header =
    headerSlot && !query.error ? (
      createPortal(
        <>
          <div
            className={cx(
              AIC,
              'flex items-center gap-2.5 rounded-xl border px-3 py-2.5 sm:min-w-[15rem]',
              health.tone === 'good' ? 'border-primary/25 bg-primary-light/40' : 'border-amber-200 bg-amber-50',
            )}
          >
            <span
              aria-hidden
              className={cx(
                'grid h-7 w-7 shrink-0 place-items-center rounded-full text-white',
                health.tone === 'good' ? 'bg-primary' : 'bg-amber-500',
              )}
            >
              {health.tone === 'good' ? (
                <CheckCircle2 className="h-4 w-4" />
              ) : (
                <TriangleAlert className="h-4 w-4" />
              )}
            </span>
            <div className="min-w-0">
              <p className="text-xs font-semibold text-gray-900">{health.title}</p>
              <p className="mt-0.5 text-[0.6875rem] leading-snug text-gray-600">{health.detail}</p>
            </div>
          </div>

          {canWrite ? (
            <div className="flex flex-col items-stretch gap-1 sm:items-end">
              <Button
                size="lg"
                icon={Save}
                loading={saving}
                disabled={!dirty || invalid || !serverDraft}
                onClick={save}
                className="sm:min-w-[9rem]"
              >
                {saving ? 'Saving…' : 'Save settings'}
              </Button>
              <span className="text-[0.6875rem] text-gray-500">
                {dirty ? (
                  <span className="font-semibold text-amber-600">Unsaved changes</span>
                ) : server ? (
                  `Last changed ${formatDateTime(server.updated_at)}${server.updated_by ? ` by ${server.updated_by}` : ''}`
                ) : (
                  'Loading…'
                )}
              </span>
            </div>
          ) : (
            <span className="self-center text-[0.6875rem] text-gray-500">Read-only access</span>
          )}
        </>,
        headerSlot,
      )
    ) : null

  return (
    <>
      {header}
      <RequirePermission permission={P.settingsRead} what="inventory settings">
        {query.error ? (
          <ErrorState
            title="Unable to load inventory settings"
            description={query.error.message}
            onRetry={query.reload}
          />
        ) : (
          <div className={cx(AIC, 'grid grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,1fr)_17rem]')}>
            <div className="flex min-w-0 flex-col gap-4">
              {saveError ? <Notice kind="error" title="The settings were not saved">{saveError}</Notice> : null}
              {draft ? (
                <>
                  <ValuationCard draft={draft} onChange={patch} readOnly={readOnly} error={errors.base_currency_code} />
                  <OperationalCard draft={draft} onChange={patch} readOnly={readOnly} />
                  <LandedCostCard draft={draft} onChange={patch} readOnly={readOnly} server={server} />
                </>
              ) : (
                <SettingsSkeleton />
              )}
            </div>
            <SettingsRightRail
              cmpId={cmpId}
              updatedAt={server?.updated_at}
              updatedBy={server?.updated_by}
              className="xl:sticky xl:top-3"
            />
          </div>
        )}
      </RequirePermission>
    </>
  )
}

interface CardProps {
  draft: SettingsDraft
  onChange: (change: Partial<SettingsDraft>) => void
  readOnly: boolean
}

function ValuationCard({ draft, onChange, readOnly, error }: CardProps & { error?: string }) {
  return (
    <SettingsSectionCard
      step={1}
      title="Valuation & costing"
      description="These settings define how item cost and stock value are calculated."
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-5">
        <FormField
          label="Default valuation method"
          htmlFor="s-method"
          hint="Used for every item whose master does not name a method."
        >
          <Select
            id="s-method"
            size="md"
            disabled={readOnly}
            value={draft.default_valuation_method}
            onChange={(e) => onChange({ default_valuation_method: e.target.value as SettingsDraft['default_valuation_method'] })}
          >
            {VALUATION_METHODS.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </Select>
        </FormField>

        <FormField
          label={
            <span className="inline-flex items-center gap-1.5">
              Valuation scope
              <HelpHint
                about="valuation scope"
                label="Company keeps one cost pool per item. Warehouse keeps cost layers and averages independently for each warehouse, so the same item can carry a different unit cost in each."
              />
            </span>
          }
          htmlFor="s-scope"
          hint="Company: one cost pool per item."
        >
          <Select
            id="s-scope"
            size="md"
            disabled={readOnly}
            value={draft.valuation_scope}
            onChange={(e) => onChange({ valuation_scope: e.target.value as SettingsDraft['valuation_scope'] })}
          >
            <option value="company">Company</option>
            <option value="warehouse">Warehouse</option>
          </Select>
        </FormField>

        <FormField label="Negative stock" htmlFor="s-neg" hint={POLICY_HELP[draft.negative_stock_policy]}>
          <Select
            id="s-neg"
            size="md"
            disabled={readOnly}
            value={draft.negative_stock_policy}
            onChange={(e) => onChange({ negative_stock_policy: e.target.value as NegativeStockPolicy })}
          >
            {NEGATIVE_STOCK_POLICIES.map((p) => (
              <option key={p} value={p}>
                {POLICY_LABELS[p]}
              </option>
            ))}
          </Select>
        </FormField>

        <FormField
          label={
            <span className="inline-flex items-center gap-1.5">
              COGS revision mode
              <HelpHint
                about="COGS revision mode"
                label="Inventory recalculates the cost; Books owns the entry. Inline: Books rewrites the original COGS entry when a back-dated recalculation changes it. Adjustment journal: Books posts a dated adjustment instead and the original stays as printed."
              />
            </span>
          }
          htmlFor="s-cogs"
          hint="What Books does when a back-dated recalculation changes a posted cost."
        >
          <Select
            id="s-cogs"
            size="md"
            disabled={readOnly}
            value={draft.cogs_revision_mode}
            onChange={(e) => onChange({ cogs_revision_mode: e.target.value as SettingsDraft['cogs_revision_mode'] })}
          >
            <option value="inline">Inline</option>
            <option value="adjustment">Adjustment journal</option>
          </Select>
        </FormField>

        <FormField
          label="Base currency"
          htmlFor="s-ccy"
          hint="Reporting and valuation currency for this company."
          error={error}
        >
          <Input
            id="s-ccy"
            size="md"
            maxLength={3}
            invalid={Boolean(error)}
            disabled={readOnly}
            value={draft.base_currency_code}
            onChange={(e) => onChange({ base_currency_code: e.target.value.toUpperCase() })}
          />
        </FormField>
      </div>
    </SettingsSectionCard>
  )
}

function OperationalCard({ draft, onChange, readOnly }: CardProps) {
  return (
    <SettingsSectionCard
      step={2}
      title="Operational preferences"
      description="Control day-to-day behaviour and workflow preferences."
    >
      <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
        <SettingSwitch
          checked={draft.approval_required}
          disabled={readOnly}
          onChange={(v) => onChange({ approval_required: v })}
          title="Documents need approval before they can be posted"
          description="Enable this when inventory documents must pass through an approval workflow before posting."
        />
        <SettingSwitch
          checked={draft.fefo_enabled}
          disabled={readOnly}
          onChange={(v) => onChange({ fefo_enabled: v })}
          title="First-expiry-first-out (FEFO) when picking batches automatically"
          description="Automatically prioritise batches with the earliest expiry date during automatic picking."
          hint={
            <HelpHint
              about="FEFO"
              label="Applies only where a batch is picked for you. A batch chosen by hand on a document is always respected."
            />
          }
        />
      </div>
    </SettingsSectionCard>
  )
}

function LandedCostCard({
  draft,
  onChange,
  readOnly,
  server,
}: CardProps & { server: CompanySettings | null }) {
  const policy = server?.landed_cost_policy
  const switchable = switchableCostTypes(policy)
  const always = alwaysCapitalisedCostTypes(policy)
  const excluded = draft.landed_cost_excluded_types

  const toggle = (type: LandedCostType, capitalised: boolean) =>
    onChange({
      landed_cost_excluded_types: capitalised
        ? excluded.filter((t) => t !== type)
        : excluded.includes(type)
          ? excluded
          : [...excluded, type],
    })

  return (
    <SettingsSectionCard
      step={3}
      title="Landed cost capitalisation"
      description="Which charges on an inward consignment are part of stock cost? Select the charge types that should be capitalised into inventory."
    >
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
        {switchable.map((type) => (
          <LandedCostOption
            key={type}
            icon={costTypeIcon(type)}
            title={costTypeLabel(type)}
            description={costTypeHelp(type)}
            selected={!excluded.includes(type)}
            readOnly={readOnly}
            onChange={(on) => toggle(type, on)}
          />
        ))}
        {always.map((type) => (
          <LandedCostOption
            key={type}
            icon={costTypeIcon(type)}
            title={costTypeLabel(type)}
            description="Tax on the purchase that cannot be recovered from the authority."
            selected
            locked
            hint={
              <HelpHint
                about="non-creditable tax"
                label="Whether input tax credit is recoverable is decided in Books. Tax already declared unrecoverable is part of the cost of purchase under AS-2, so it is not a landed-cost policy preference and cannot be switched off here."
              />
            }
          />
        ))}
      </div>

      <div
        className={cx(
          AIC,
          'mt-3 flex items-start gap-2.5 rounded-xl border border-primary/25 bg-primary-light/30 p-3',
        )}
      >
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
        <p className="m-0 text-[0.6875rem] leading-relaxed text-gray-600">
          Selected components form part of inventory cost, so they sit in closing stock and reach cost
          of goods sold when the goods are issued. A type switched off is not a cost of inventory
          here: Inventory <strong className="font-semibold">refuses</strong> a purchase line or
          allocation carrying it rather than quietly leaving it out of stock value — expense it in
          Books instead. Nothing already posted changes.
        </p>
      </div>
    </SettingsSectionCard>
  )
}

/**
 * Shaped like the three cards it stands in for.
 *
 * Empty selects would be worse than nothing here: a control that looks usable but holds no value is
 * one click away from a Save that writes a default over a real policy.
 */
function SettingsSkeleton() {
  return (
    <div aria-hidden className="flex flex-col gap-4">
      {[5, 2, 6].map((fields, i) => (
        <Card key={i} padding="md">
          <div className="flex items-start gap-3">
            <Skeleton className="h-8 w-8" rounded="full" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-48" />
              <Skeleton className="h-3 w-72" />
            </div>
          </div>
          <div className="mt-4 grid grid-cols-1 gap-3 border-t border-gray-100 pt-4 sm:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: fields }).map((_, f) => (
              <Skeleton key={f} className="h-[4.25rem]" rounded="lg" />
            ))}
          </div>
        </Card>
      ))}
    </div>
  )
}
