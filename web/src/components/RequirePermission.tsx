import type { ReactNode } from 'react'
import { useAccess } from '../access/AccessContext'
import type { PermissionKey } from '../access/AccessContext'
import { Notice } from './Notice'

interface RequirePermissionProps {
  permission: PermissionKey
  /** Named in the message: "You do not have permission to open <what>". */
  what: string
  children: ReactNode
}

/**
 * Renders its children only when the user holds the permission (any of them).
 * The server still enforces every call; this keeps a forbidden screen from
 * firing requests that would only come back 403.
 */
export function RequirePermission({ permission, what, children }: RequirePermissionProps) {
  const { can, loading } = useAccess()
  if (loading) return <p className="muted">Checking access…</p>
  if (!can(permission)) return <Notice kind="warning">You do not have permission to open {what} in this company.</Notice>
  return <>{children}</>
}
