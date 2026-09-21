/**
 * How this screen writes a signed figure.
 *
 * Built on `utils/format`, which is where Indian digit grouping lives, and
 * which deliberately prints no currency symbol: Aicountly is multi-currency, a
 * company's base currency is a setting, and a hardcoded ₹ on a screen showing a
 * dollar company's stock would be a wrong number wearing the wrong hat. Every
 * register in Inventory shows money the same way, so this one does too.
 *
 * The sign is always written out, on both directions. It is the only part of a
 * variance that survives greyscale, a colour-blind reader and a printout, so it
 * may never be left to the colour alone.
 */

import { formatMoney } from '../../../utils/format'

/** `+47,720.00`, `-86,620.00`, `0.00` — never a bare magnitude. */
export function signedMoney(value: number): string {
  if (value === 0) return formatMoney(0)
  return `${value > 0 ? '+' : '-'}${formatMoney(Math.abs(value))}`
}

/** `+0.56%`, `-1.02%`, `0.00%`. */
export function signedPercent(value: number): string {
  if (Math.abs(value) < 0.005) return '0.00%'
  return `${value > 0 ? '+' : '-'}${Math.abs(value).toFixed(2)}%`
}

/** `0.56%` — magnitude only, for prose that already says "higher" or "lower". */
export function plainPercent(value: number): string {
  return `${Math.abs(value).toFixed(2)}%`
}

/** The sentence builders in `model.ts` take these two. */
export const WORDS = {
  money: (value: number) => formatMoney(Math.abs(value)),
  percent: plainPercent,
}
