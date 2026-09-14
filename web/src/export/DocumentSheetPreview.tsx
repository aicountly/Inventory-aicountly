import { Card } from '../ui/Card'
import type { DocumentSheetBody } from './documentSheet'
import type { SheetIdentity } from './sheetHtml'

/**
 * What the paper will say, on screen.
 *
 * Driven by the same `DocumentSheetBody` the print and PDF builders consume,
 * so the preview cannot show a column, a figure or a total that the printed
 * page will not — the three surfaces read one object. Only the styling differs:
 * this is the app's design language at screen density, that is A4.
 */
export function DocumentSheetPreview({
  sheet,
  identity,
}: {
  sheet: DocumentSheetBody
  identity: SheetIdentity
}) {
  return (
    <Card padding="none" className="overflow-hidden">
      <div className="border-l-[3px] border-primary p-5 md:p-7">
        {/* Letterhead */}
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-gray-200 pb-4">
          <div className="min-w-0">
            {identity.companyName ? (
              <div className="text-base font-extrabold tracking-tight text-gray-900">
                {identity.companyName}
              </div>
            ) : null}
            {(identity.addressLines ?? []).map((line) => (
              <div key={line} className="text-label-md text-gray-600">
                {line}
              </div>
            ))}
            {identity.gstin ? (
              <div className="text-label-md font-semibold tabular-nums text-gray-700">
                GSTIN: {identity.gstin}
              </div>
            ) : null}
            <h2 className="mt-3 text-xl font-extrabold text-gray-900">{sheet.title}</h2>
            {identity.scopeLabel ? (
              <div className="text-label-md font-semibold text-gray-600">{identity.scopeLabel}</div>
            ) : null}
          </div>
          <dl className="shrink-0 text-right text-label-md text-gray-600">
            {sheet.documentNo ? (
              <div>
                <dt className="inline text-gray-500">No. </dt>
                <dd className="inline font-bold text-gray-900">{sheet.documentNo}</dd>
              </div>
            ) : null}
            {sheet.documentDate ? (
              <div>
                <dt className="inline text-gray-500">Date </dt>
                <dd className="inline font-semibold text-gray-800">{sheet.documentDate}</dd>
              </div>
            ) : null}
            {sheet.headerPairs.map((pair) => (
              <div key={pair.label}>
                <dt className="inline text-gray-500">{pair.label}: </dt>
                <dd className="inline font-semibold text-gray-800">{pair.value}</dd>
              </div>
            ))}
          </dl>
        </div>

        {/* Party / warehouse / transport */}
        {sheet.blocks.length ? (
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {sheet.blocks.map((block) => (
              <div
                key={`${block.label}-${block.value ?? ''}`}
                className="rounded-lg border border-gray-200 border-l-[3px] border-l-primary bg-gray-50/60 px-3 py-2"
              >
                <div className="text-label-xs font-extrabold uppercase tracking-wider text-gray-500">
                  {block.label}
                </div>
                {block.value ? (
                  <div className="text-sm font-bold text-gray-900">{block.value}</div>
                ) : null}
                {(block.lines ?? []).map((line) => (
                  <div key={line} className="text-label-md text-gray-600">
                    {line}
                  </div>
                ))}
              </div>
            ))}
          </div>
        ) : null}

        {/* Lines */}
        <div className="mt-4 overflow-x-auto rounded-lg border border-gray-200">
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr>
                {sheet.columns.map((col) => (
                  <th
                    key={col.key}
                    className={`whitespace-nowrap border-b border-gray-200 bg-gray-50 px-2.5 py-2 text-label-xs font-extrabold uppercase tracking-wider text-gray-500 ${
                      col.align === 'right' ? 'text-right' : col.align === 'center' ? 'text-center' : 'text-left'
                    }`}
                  >
                    {col.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sheet.rows.length ? (
                sheet.rows.map((row, index) => (
                  <tr key={index} className="even:bg-gray-50/60">
                    {sheet.columns.map((col) => (
                      <td
                        key={col.key}
                        className={`border-b border-gray-100 px-2.5 py-1.5 align-top text-gray-700 ${
                          col.align === 'right'
                            ? 'text-right tabular-nums whitespace-nowrap'
                            : col.align === 'center'
                              ? 'text-center'
                              : 'text-left'
                        } ${col.tone === 'credit' ? 'text-red-600' : ''}`}
                      >
                        {row[col.key]?.text ?? ''}
                      </td>
                    ))}
                  </tr>
                ))
              ) : (
                <tr>
                  <td
                    colSpan={sheet.columns.length}
                    className="px-3 py-8 text-center text-gray-500"
                  >
                    This document has no lines.
                  </td>
                </tr>
              )}
            </tbody>
            {sheet.totalsRow ? (
              <tfoot>
                <tr className="bg-primary-light/60">
                  {sheet.columns.map((col, index) => {
                    const own = sheet.totalsRow?.[col.key]?.text ?? ''
                    const blank = sheet.columns.every((c) => !sheet.totalsRow?.[c.key]?.text)
                    const text = own || (blank && index === 0 ? sheet.totalsLabel : '')
                    return (
                      <td
                        key={col.key}
                        className={`border-t-2 border-gray-400 px-2.5 py-2 font-extrabold text-gray-900 ${
                          col.align === 'right' ? 'text-right tabular-nums' : 'text-left'
                        }`}
                      >
                        {text}
                      </td>
                    )
                  })}
                </tr>
              </tfoot>
            ) : null}
          </table>
        </div>

        {/* Narration, terms, captured extras */}
        {sheet.footerPairs.length ? (
          <dl className="mt-4 grid gap-x-8 gap-y-1 rounded-lg border border-gray-200 px-3 py-2.5 sm:grid-cols-2 lg:grid-cols-3">
            {sheet.footerPairs.map((pair) => (
              <div key={`${pair.label}-${pair.value}`} className="text-label-md">
                <dt className="inline font-semibold text-gray-500">{pair.label}: </dt>
                <dd className="inline text-gray-700">{pair.value}</dd>
              </div>
            ))}
          </dl>
        ) : null}

        <div className="mt-10 grid grid-cols-3 gap-6">
          {['Prepared by', 'Checked by', 'Authorised signatory'].map((label) => (
            <div key={label} className="border-t border-gray-400 pt-1 text-center text-label-md text-gray-600">
              {label}
            </div>
          ))}
        </div>
      </div>
    </Card>
  )
}

export default DocumentSheetPreview
