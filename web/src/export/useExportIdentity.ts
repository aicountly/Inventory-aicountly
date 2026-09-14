/**
 * Who the document says it belongs to.
 *
 * A printed register or delivery challan carries the company's name, its
 * registered office, its GSTIN and its logo — in India the GSTIN in particular
 * is what an auditor looks for first, and a challan without it is a weaker
 * document than the Books one it replaces.
 *
 * All four come from Manage through the relay the API already allowlists
 * (`manage/companyinfo` and `manage/company/logo`), are parsed in
 * `company/manageShapes.ts` and held by `CompanyProvider`, so every export
 * picks them up at once and no caller assembles its own letterhead. A company
 * Manage has no address, GSTIN or logo for degrades to name + scope rather than
 * faking anything.
 */

import { useMemo } from 'react'
import { useCompany } from '../company/CompanyContext'
import { useScopeLabel } from '../company/useScopeLabel'
import type { SheetIdentity } from './sheetHtml'

export function useExportIdentity(): SheetIdentity {
  const { companyName, addressLines, gstin, logo } = useCompany()
  const scopeLabel = useScopeLabel()
  return useMemo<SheetIdentity>(
    () => ({
      companyName: companyName || undefined,
      scopeLabel,
      addressLines: addressLines ?? [],
      gstin: gstin || undefined,
      logo: logo ?? null,
    }),
    [companyName, scopeLabel, addressLines, gstin, logo],
  )
}
