/**
 * Optional parts of a screen, switchable at build time.
 *
 * Vite inlines every `VITE_*` value when the app is compiled, so these are
 * build flags rather than runtime settings — see src/config.ts. Each one
 * defaults ON: the flag exists so a deployment can take a capability OUT (a
 * customer whose scanners are not configured, a rollout that wants the
 * assistant rail dark for a week), never so a half-built feature can ship
 * behind it.
 *
 * Every screen must render correctly with all of them off, and every action a
 * flag hides must be reachable some other way.
 */

function flag(value: string | undefined, fallback = true): boolean {
  const v = (value ?? '').trim().toLowerCase()
  if (v === '') return fallback
  return !['0', 'false', 'off', 'no'].includes(v)
}

export interface FeatureFlags {
  /** The right-hand rail on the job-work screens (deterministic API actions). */
  jobWorkAssistant: boolean
  /** Contextual, non-blocking notes beside the job-work form. */
  jobWorkSmartWarnings: boolean
  /** The settlement trail behind one pending job-work quantity. */
  jobWorkTimeline: boolean
  /** Paste / template import of job-work lines from a spreadsheet. */
  jobWorkImport: boolean
  /** Barcode entry on the job-work grid (`GET /v1/items/by-barcode/{code}`). */
  jobWorkBarcodeScan: boolean
}

export const FEATURES: FeatureFlags = {
  jobWorkAssistant: flag(import.meta.env.VITE_FEATURE_JOB_WORK_ASSISTANT),
  jobWorkSmartWarnings: flag(import.meta.env.VITE_FEATURE_JOB_WORK_SMART_WARNINGS),
  jobWorkTimeline: flag(import.meta.env.VITE_FEATURE_JOB_WORK_TIMELINE),
  jobWorkImport: flag(import.meta.env.VITE_FEATURE_JOB_WORK_IMPORT),
  jobWorkBarcodeScan: flag(import.meta.env.VITE_FEATURE_JOB_WORK_BARCODE_SCAN),
}
