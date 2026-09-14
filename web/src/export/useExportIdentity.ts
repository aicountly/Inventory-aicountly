/**
 * Who the document says it belongs to.
 *
 * Books loads a full letterhead for its exports — company name, registered
 * address, GSTIN and the uploaded logo — from its own company API
 * (reportDocumentContext.js). Inventory's Manage relay does not carry any of
 * that yet: `CompanyInfo` in `src/company/manageShapes.ts` is
 * `{cmpId, name, fyList, branches, hoId}` and there is no logo endpoint.
 *
 * So the header degrades honestly to company name + scope line, and every
 * other field is optional in the sheet types rather than faked. When the relay
 * grows `address`, `gstin` and `logo`, this hook is the only file that changes
 * and every export picks them up at once — that is why the identity is resolved
 * here and not inline in each caller.
 */

import { useMemo } from 'react'
import { useCompany } from '../company/CompanyContext'
import { useScopeLabel } from '../company/useScopeLabel'
import type { SheetIdentity } from './sheetHtml'

export function useExportIdentity(): SheetIdentity {
  const { companyName } = useCompany()
  const scopeLabel = useScopeLabel()
  return useMemo<SheetIdentity>(
    () => ({
      companyName: companyName || undefined,
      scopeLabel,
      addressLines: [],
      logo: null,
    }),
    [companyName, scopeLabel],
  )
}
