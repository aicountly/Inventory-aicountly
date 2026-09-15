/**
 * Re-exported from the shared primitive so the ~20 screens importing
 * `components/StatusBadge` keep compiling while they are converted.
 * The merged status map and the `Tone` alias live in ui/StatusBadge.tsx.
 */
export { StatusBadge, ActiveBadge, statusBadgeLabel } from '../ui/StatusBadge'
export type { Tone } from '../ui/StatusBadge'
