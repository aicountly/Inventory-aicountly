import { createContext, useCallback, useContext, useMemo } from 'react'
import type { ReactNode } from 'react'
import { useCompany } from '../company/CompanyContext'
import { useQuery } from '../hooks/useQuery'
import { fetchAccessMe } from '../services/access'
import type { AccessMember, AccessProfile } from '../services/access'
import { errorMessage } from '../services/api'

/**
 * What the signed-in user may do in the selected company (`GET /v1/access/me`).
 *
 * The server enforces every permission; this context only decides which
 * actions to show. Owners (portal owner or the Owner profile) hold everything.
 */

export type PermissionKey = string | readonly string[]

export interface AccessContextValue {
  loading: boolean
  error: string | null
  permissions: string[]
  profile: AccessProfile | null
  member: AccessMember | null
  /** null = unrestricted. */
  allowedWarehouses: number[] | null
  isOwner: boolean
  /** True when the user has the key (or any of the keys). */
  can: (key: PermissionKey) => boolean
  reload: () => void
}

const AccessContext = createContext<AccessContextValue | null>(null)

export function AccessProvider({ children }: { children: ReactNode }) {
  const { scope } = useCompany()
  const cmpId = scope?.cmp_id ?? null
  const { data, loading, error, reload } = useQuery((signal) => fetchAccessMe(signal), [cmpId], { enabled: cmpId !== null, keepData: false })

  const permissions = useMemo(() => data?.permissions ?? [], [data])
  const isOwner = data?.profile?.template_key === 'owner' || data?.member?.is_portal_owner === true

  const can = useCallback(
    (key: PermissionKey): boolean => {
      if (isOwner) return true
      if (typeof key === 'string') return permissions.includes(key)
      return key.some((k) => permissions.includes(k))
    },
    [isOwner, permissions],
  )

  const value = useMemo<AccessContextValue>(
    () => ({
      loading: cmpId !== null && loading,
      error: error ? errorMessage(error) : null,
      permissions,
      profile: data?.profile ?? null,
      member: data?.member ?? null,
      allowedWarehouses: data?.allowed_warehouses ?? null,
      isOwner,
      can,
      reload,
    }),
    [cmpId, loading, error, permissions, data, isOwner, can, reload],
  )

  return <AccessContext.Provider value={value}>{children}</AccessContext.Provider>
}

export function useAccess(): AccessContextValue {
  const ctx = useContext(AccessContext)
  if (!ctx) throw new Error('useAccess must be used inside <AccessProvider>')
  return ctx
}

export function useCan(key: PermissionKey): boolean {
  return useAccess().can(key)
}
