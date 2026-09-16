import { useMemo, useState } from 'react'
import { FileText } from 'lucide-react'
import { useCompany } from '../../company/CompanyContext'
import { DataTable } from '../../components/DataTable'
import type { Column } from '../../components/DataTable'
import { RequirePermission } from '../../components/RequirePermission'
import { StatusBadge } from '../../components/StatusBadge'
import { useQuery } from '../../hooks/useQuery'
import { P } from '../../services/access'
import { settingsApi } from '../../services/settingsApi'
import type { DocumentTypeInfo } from '../../services/settingsApi'
import { SearchBox } from '../../ui/SearchBox'
import { FormSectionCard } from '../../ui/shell/FormSectionCard'

const COLUMNS: Column<DocumentTypeInfo>[] = [
  { key: 'code', header: 'Code', render: (r) => <code>{r.code}</code> },
  { key: 'label', header: 'Label', render: (r) => <strong>{r.label}</strong> },
  {
    key: 'native',
    header: 'Created in',
    render: (r) => (r.native ? <StatusBadge value="Inventory" tone="good" /> : <StatusBadge value="Books (item lines)" tone="info" />),
  },
  { key: 'line_mode', header: 'Lines', render: (r) => r.line_mode.replace(/_/g, ' ') },
  { key: 'valuation', header: 'Valued', render: (r) => (r.valuation ? 'yes' : <span className="muted">no</span>) },
  { key: 'cogs', header: 'COGS to Books', render: (r) => (r.cogs ? 'yes' : <span className="muted">no</span>) },
  {
    key: 'legacy_vch_type',
    header: 'Legacy Books type',
    render: (r) => (r.legacy_vch_type ? `vch_type ${r.legacy_vch_type}` : <span className="muted">—</span>),
  },
]

/**
 * The registry is the server's, not this screen's: `GET /v1/document-types` reports what
 * Config\DocumentTypeRegistry implements. There is nothing here to configure — no numbering series,
 * no per-type approval flag, no enable switch — so the screen lists and filters rather than
 * pretending to edit. A field appears the day the API carries one.
 */
export function DocumentTypesPage() {
  const { scope } = useCompany()
  const types = useQuery((signal) => settingsApi.documentTypes(signal), [scope?.cmp_id], {
    enabled: scope !== null,
    resetKey: scope?.cmp_id ?? null,
  })
  const [search, setSearch] = useState('')

  const rows = useMemo(() => {
    const all = types.data ?? []
    const q = search.trim().toLowerCase()
    if (!q) return all
    return all.filter((t) => `${t.code} ${t.label} ${t.line_mode}`.toLowerCase().includes(q))
  }, [types.data, search])

  return (
    <RequirePermission permission={P.settingsRead} what="document types">
      <FormSectionCard
        icon={FileText}
        title="Document types"
        description="Every stock document Inventory understands, whether it is recorded here or arrives from Books, and how it affects valuation and cost of goods sold."
        action={
          <div className="flex items-center gap-3">
            <span className="hidden whitespace-nowrap text-xs font-medium text-gray-500 sm:inline">
              {rows.length} of {(types.data ?? []).length}
            </span>
            <SearchBox
              value={search}
              onChange={setSearch}
              placeholder="Search document types…"
              aria-label="Search document types"
              className="w-44 sm:w-56"
            />
          </div>
        }
      >
        <DataTable
          columns={COLUMNS}
          rows={rows}
          rowKey={(r) => r.code}
          loading={types.loading}
          error={types.error}
          emptyMessage={search ? `No document type matches “${search}”.` : 'No document types.'}
        />
      </FormSectionCard>
    </RequirePermission>
  )
}
