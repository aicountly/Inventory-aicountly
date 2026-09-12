import { useCompany } from '../company/CompanyContext'
import { formatDate } from '../utils/format'

/** Company / financial year / branch pickers in the header. */
export function ContextSelectors() {
  const { companies, cmpId, fyList, fyId, fy, branches, boId, status, selectCompany, selectFy, selectBranch } = useCompany()
  const switching = status === 'loading'

  return (
    <div className="context-selectors">
      <label className="context-select">
        <span>Company</span>
        <select className="select" value={cmpId ?? ''} onChange={(e) => selectCompany(Number(e.target.value))} aria-label="Company" disabled={companies.length === 0}>
          {companies.map((c) => (
            <option key={c.cmpId} value={c.cmpId}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
      <label className="context-select">
        <span>FY</span>
        <select className="select" value={fyId ?? ''} onChange={(e) => selectFy(Number(e.target.value))} aria-label="Financial year" disabled={switching || fyList.length === 0}>
          {fyList.length === 0 && fyId ? <option value={fyId}>FY #{fyId}</option> : null}
          {fyList.map((f) => (
            <option key={f.fyId} value={f.fyId}>
              {f.label}
            </option>
          ))}
        </select>
      </label>
      {fy?.start && fy.end ? (
        <span className="context-fy-range">
          {formatDate(fy.start)} – {formatDate(fy.end)}
        </span>
      ) : null}
      <label className="context-select">
        <span>Branch</span>
        <select className="select" value={boId} onChange={(e) => selectBranch(Number(e.target.value))} aria-label="Branch" disabled={switching}>
          <option value={0}>All branches</option>
          {branches.map((b) => (
            <option key={b.boId} value={b.boId}>
              {b.name}
              {b.isHeadOffice ? ' (HO)' : ''}
            </option>
          ))}
        </select>
      </label>
    </div>
  )
}
