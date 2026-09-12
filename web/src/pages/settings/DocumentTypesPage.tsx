import { useCompany } from '../../company/CompanyContext'
import { DataTable } from '../../components/DataTable'
import type { Column } from '../../components/DataTable'
import { PageHeader } from '../../components/PageHeader'
import { RequirePermission } from '../../components/RequirePermission'
import { StatusBadge } from '../../components/StatusBadge'
import { useQuery } from '../../hooks/useQuery'
import { P } from '../../services/access'
import { settingsApi } from '../../services/settingsApi'
import type { DocumentTypeInfo } from '../../services/settingsApi'
import '../views.css'

const COLUMNS: Column<DocumentTypeInfo>[] = [
  { key: 'code', header: 'Code', render: (r) => <code>{r.code}</code> },
  { key: 'label', header: 'Label', render: (r) => <strong>{r.label}</strong> },
  { key: 'native', header: 'Created in', render: (r) => (r.native ? <StatusBadge value="Inventory" tone="good" /> : <StatusBadge value="Books (item lines)" tone="info" />) },
  { key: 'line_mode', header: 'Lines', render: (r) => r.line_mode.replace(/_/g, ' ') },
  { key: 'valuation', header: 'Valued', render: (r) => (r.valuation ? 'yes' : <span className="muted">no</span>) },
  { key: 'cogs', header: 'COGS to Books', render: (r) => (r.cogs ? 'yes' : <span className="muted">no</span>) },
  { key: 'legacy_vch_type', header: 'Legacy Books type', render: (r) => (r.legacy_vch_type ? `vch_type ${r.legacy_vch_type}` : <span className="muted">—</span>) },
]

export function DocumentTypesPage() {
  const { scope } = useCompany()
  const types = useQuery((signal) => settingsApi.documentTypes(signal), [scope?.cmp_id], { enabled: scope !== null })
  return (
    <>
      <PageHeader title="Document types" subtitle="Every stock document Inventory understands, whether it is recorded here or arrives from Books, and how it affects valuation and cost of goods sold." />
      <RequirePermission permission={P.settingsRead} what="document types">
        <DataTable columns={COLUMNS} rows={types.data ?? []} rowKey={(r) => r.code} loading={types.loading} error={types.error} />
      </RequirePermission>
    </>
  )
}
