import { useEffect, useState } from 'react'
import { useCan } from '../../access/AccessContext'
import { useCompany } from '../../company/CompanyContext'
import { FormField } from '../../components/FormField'
import { Notice } from '../../components/Notice'
import { PageHeader } from '../../components/PageHeader'
import { RequirePermission } from '../../components/RequirePermission'
import { useQuery } from '../../hooks/useQuery'
import { P } from '../../services/access'
import { ApiError } from '../../services/api'
import { NEGATIVE_STOCK_POLICIES, VALUATION_METHODS, settingsApi } from '../../services/settingsApi'
import type { CogsRevisionMode, NegativeStockPolicy, SettingsPatch, ValuationScope } from '../../services/settingsApi'
import { useToast } from '../../ui/ToastContext'
import { formatDateTime, isOn } from '../../utils/format'
import '../views.css'

const POLICY_HELP: Record<NegativeStockPolicy, string> = {
  allow: 'Issues may take stock below zero; the shortfall is costed at the last known rate and corrected when the receipt arrives.',
  warn: 'Issues below zero are posted but flagged on the document and in reports.',
  block: 'Issues below available stock are refused (negative_stock_blocked) unless the user overrides with a reason.',
}

export function CompanySettingsPage() {
  const { scope, companyName } = useCompany()
  const toast = useToast()
  const canWrite = useCan(P.settingsWrite)
  const settings = useQuery((signal) => settingsApi.get(signal), [scope?.cmp_id], { enabled: scope !== null })
  const [form, setForm] = useState<SettingsPatch>({})
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    const s = settings.data
    if (!s) return
    setForm({
      default_valuation_method: s.default_valuation_method,
      valuation_scope: s.valuation_scope as ValuationScope,
      negative_stock_policy: s.negative_stock_policy as NegativeStockPolicy,
      approval_required: isOn(s.approval_required),
      fefo_enabled: isOn(s.fefo_enabled),
      cogs_revision_mode: s.cogs_revision_mode as CogsRevisionMode,
      base_currency_code: s.base_currency_code,
    })
  }, [settings.data])

  const save = async () => {
    setSaving(true)
    try {
      await settingsApi.update(form)
      toast.success('Settings saved.')
      settings.reload()
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Could not save the settings.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <PageHeader title={`Inventory settings — ${companyName ?? ''}`} subtitle="Company-wide costing and control defaults. Item masters can override the valuation method per item." actions={canWrite ? <button type="button" className="btn btn-primary" disabled={saving || !settings.data} onClick={save}>{saving ? 'Saving…' : 'Save'}</button> : null} />
      <RequirePermission permission={P.settingsRead} what="inventory settings">
        {settings.error ? <Notice kind="error">{settings.error.message}</Notice> : null}
        <section className="card">
          <div className="card-body form-grid">
            <FormField label="Default valuation method" htmlFor="s-method" help="Used for every item whose master does not name a method.">
              <select id="s-method" className="select" disabled={!canWrite} value={form.default_valuation_method ?? ''} onChange={(e) => setForm({ ...form, default_valuation_method: e.target.value })}>
                {VALUATION_METHODS.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </FormField>
            <FormField label="Valuation scope" htmlFor="s-scope" help="Company: one cost pool per item. Warehouse: cost layers and averages are kept per warehouse.">
              <select id="s-scope" className="select" disabled={!canWrite} value={form.valuation_scope ?? 'company'} onChange={(e) => setForm({ ...form, valuation_scope: e.target.value as ValuationScope })}>
                <option value="company">Company</option>
                <option value="warehouse">Warehouse</option>
              </select>
            </FormField>
            <FormField label="Negative stock" htmlFor="s-neg" help={POLICY_HELP[(form.negative_stock_policy ?? 'allow') as NegativeStockPolicy]}>
              <select id="s-neg" className="select" disabled={!canWrite} value={form.negative_stock_policy ?? 'allow'} onChange={(e) => setForm({ ...form, negative_stock_policy: e.target.value as NegativeStockPolicy })}>
                {NEGATIVE_STOCK_POLICIES.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </FormField>
            <FormField label="COGS revision mode" htmlFor="s-cogs" help="Inline: Books rewrites the original COGS entry when a back-dated recalculation changes it. Adjustment: Books posts a dated adjustment journal instead and the original stays as printed.">
              <select id="s-cogs" className="select" disabled={!canWrite} value={form.cogs_revision_mode ?? 'inline'} onChange={(e) => setForm({ ...form, cogs_revision_mode: e.target.value as CogsRevisionMode })}>
                <option value="inline">Inline</option>
                <option value="adjustment">Adjustment journal</option>
              </select>
            </FormField>
            <FormField label="Base currency" htmlFor="s-ccy">
              <input id="s-ccy" className="input short" maxLength={3} disabled={!canWrite} value={form.base_currency_code ?? ''} onChange={(e) => setForm({ ...form, base_currency_code: e.target.value.toUpperCase() })} />
            </FormField>
            <label className="checkbox span-2">
              <input type="checkbox" disabled={!canWrite} checked={!!form.approval_required} onChange={(e) => setForm({ ...form, approval_required: e.target.checked })} /> Documents need approval before they can be posted
            </label>
            <label className="checkbox span-2">
              <input type="checkbox" disabled={!canWrite} checked={!!form.fefo_enabled} onChange={(e) => setForm({ ...form, fefo_enabled: e.target.checked })} /> First-expiry-first-out when picking batches automatically
            </label>
            {settings.data ? <p className="muted span-all">Last changed {formatDateTime(settings.data.updated_at)}{settings.data.updated_by ? ` by ${settings.data.updated_by}` : ''}.</p> : null}
          </div>
        </section>
      </RequirePermission>
    </>
  )
}
