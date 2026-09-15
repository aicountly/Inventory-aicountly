export interface BackCrumb {
  label: string
  to?: string
}

/**
 * Resolve the navigation target for Esc-to-back.
 * Priority: explicit backTo → last breadcrumb carrying a `to` → null (no-op).
 */
export function resolveBackTarget({
  backTo,
  breadcrumbs,
}: {
  backTo?: string | null
  breadcrumbs?: readonly BackCrumb[] | null
} = {}): string | null {
  if (backTo) return backTo
  if (!Array.isArray(breadcrumbs) || breadcrumbs.length === 0) return null
  for (let i = breadcrumbs.length - 1; i >= 0; i -= 1) {
    const to = breadcrumbs[i]?.to
    if (to) return to
  }
  return null
}
