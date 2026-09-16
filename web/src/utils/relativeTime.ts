/**
 * "Last updated just now" — how long ago a fetch landed, in words.
 *
 * The register header carries a live-data badge, and the only honest source for
 * it is the clock reading of the last *successful* response (useQuery's
 * `fetchedAt`). A badge that always reads "just now" is decoration; this one
 * goes stale on screen exactly as the data does.
 *
 * Kept pure and separate from the component so the wording is unit-testable
 * without mounting anything and without faking timers.
 */

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/** Below this, "just now" is truer than any number of seconds. */
export const JUST_NOW_MS = 45_000

function plural(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? '' : 's'} ago`
}

/**
 * `at` is when the data arrived, `now` the moment being described.
 *
 * A null `at` means nothing has landed yet, which is not the same as "a long
 * time ago" — the caller renders no badge at all rather than a fabricated age.
 */
export function formatRelativeTime(at: number | null | undefined, now: number = Date.now()): string | null {
  if (at == null || !Number.isFinite(at)) return null
  const elapsed = now - at
  // A clock that jumped backwards (NTP, a laptop waking) must not print
  // "-3 minutes ago"; the data is still the freshest thing we have.
  if (elapsed < JUST_NOW_MS) return 'just now'
  if (elapsed < HOUR) return plural(Math.floor(elapsed / MINUTE), 'minute')
  if (elapsed < DAY) return plural(Math.floor(elapsed / HOUR), 'hour')
  return plural(Math.floor(elapsed / DAY), 'day')
}

/**
 * How long until the phrase above would change, in ms.
 *
 * The badge re-renders on a timer, and ticking every second to move a figure
 * that changes once a minute is wasted work on a page that is meant to feel
 * fast. Returns the coarsest interval that still keeps the wording truthful.
 */
export function relativeTimeTickMs(at: number | null | undefined, now: number = Date.now()): number {
  if (at == null || !Number.isFinite(at)) return MINUTE
  const elapsed = now - at
  if (elapsed < HOUR) return 15_000
  if (elapsed < DAY) return MINUTE
  return HOUR
}
