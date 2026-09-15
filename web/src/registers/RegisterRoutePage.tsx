import { useParams } from 'react-router-dom'
import { ReportPage } from '../reports/ReportPage'
import NotFound from '../pages/NotFound'
import { registerByPath } from './configs'

/** `/registers/:path` → the matching register on the shared engine. */
export function RegisterRoutePage() {
  const { path = '' } = useParams()
  const config = registerByPath(path)
  if (!config) return <NotFound />
  // Keyed so switching register resets the engine's filter and column state
  // rather than carrying one register's URL parameters into the next.
  return <ReportPage key={config.path} config={config} />
}

export default RegisterRoutePage
