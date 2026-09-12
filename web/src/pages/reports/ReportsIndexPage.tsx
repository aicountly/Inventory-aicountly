import { Link } from 'react-router-dom'
import { useCan } from '../../access/AccessContext'
import { PageHeader } from '../../components/PageHeader'
import { REPORT_CONFIGS } from '../../reports/configs'
import { P } from '../../services/access'
import '../views.css'

export function ReportsIndexPage() {
  return (
    <div className="page">
      <PageHeader title="Reports" subtitle="Stock, ageing, movement, expiry and replenishment — every report exports to CSV and remembers its filters in the address bar." />
      <div className="tile-grid">
        {REPORT_CONFIGS.map((c) => (
          <ReportTile key={c.path} path={c.path} slug={c.slug} title={c.title} description={c.description} />
        ))}
        <ReportTile path="../stock/ledger" slug="stock_ledger" title="Stock ledger" description="Every movement of one item with running quantity and value" />
        <ReportTile path="../valuation" slug="valuation" title="Stock valuation" description="Closing quantity, unit cost and value per item at FIFO, LIFO, weighted average or as per the item master" />
      </div>
    </div>
  )
}

function ReportTile({ path, slug, title, description }: { path: string; slug: string; title: string; description: string }) {
  const allowed = useCan(P.report(slug))
  if (!allowed) return null
  return (
    <Link to={path} className="tile">
      <strong>{title}</strong>
      <span className="muted">{description}</span>
    </Link>
  )
}
