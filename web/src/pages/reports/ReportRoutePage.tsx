import { useParams } from 'react-router-dom'
import { ReportPage } from '../../reports/ReportPage'
import { reportByPath } from '../../reports/configs'
import NotFound from '../NotFound'

/** `/reports/:path` → the matching ReportConfig on the shared ReportPage. */
export function ReportRoutePage() {
  const { path = '' } = useParams()
  const config = reportByPath(path)
  if (!config) return <NotFound />
  return <ReportPage key={config.path} config={config} />
}
