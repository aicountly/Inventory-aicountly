import { Link } from 'react-router-dom'
import { PageHeader } from '../components/PageHeader'

export default function NotFound() {
  return (
    <div className="page">
      <PageHeader title="Page not found" subtitle="There is nothing at this address." />
      <p>
        <Link to="/dashboard">Back to the dashboard</Link>
      </p>
    </div>
  )
}
