/**
 * Class-name joiner. Keeps the ported components readable: template literals
 * of conditional class strings leave double spaces and stray `undefined`s,
 * which makes the rendered markup hard to read in devtools and diffs noisy.
 */
export type ClassValue = string | false | null | undefined

export function cx(...parts: ClassValue[]): string {
  let out = ''
  for (const part of parts) {
    if (!part) continue
    out = out ? `${out} ${part}` : part
  }
  return out
}

/**
 * Opt a subtree into the scoped preflight declared in theme/tokens.css.
 *
 * Tailwind's global preflight is off (see tailwind.config.js) so the legacy
 * hand-styled screens keep the browser defaults they were written against;
 * a Books-language subtree opts back in with this class. Every primitive in
 * `src/ui` carries it on its root, so composing them is enough — a page only
 * needs it directly when it hand-rolls markup that uses Tailwind utilities.
 *
 * It matters more than it looks: without it, `border` sets a width with no
 * style and renders nothing, and a `<button>` keeps its UA border.
 */
export const AIC = 'aic'
