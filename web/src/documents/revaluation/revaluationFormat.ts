/**
 * One money formatter for the whole screen.
 *
 * It is built from the company's base currency (`GET /v1/settings`, `base_currency_code`) rather
 * than from a hardcoded rupee sign: Aicountly is multi-currency, and `utils/format` already refuses
 * to assume otherwise. Grouping comes from `formatMoney`, which is the Indian digit grouping every
 * other figure in the product is printed with.
 */

import { currencySymbol, formatMoney, toNumber } from '../../utils/format'

export interface MoneyFormat {
  symbol: string
  /** `₹45,000.00`. */
  amount: (value: unknown, empty?: string) => string
  /** `+₹18,000.00` / `−₹6,250.00` / `₹0.00`, with the sign outside the symbol. */
  signed: (value: unknown, empty?: string) => string
}

export function createMoneyFormat(currencyCode: string | null | undefined): MoneyFormat {
  const symbol = currencySymbol(currencyCode)
  const plain = (n: number): string => `${symbol}${formatMoney(Math.abs(n))}`
  return {
    symbol,
    amount: (value, empty = '—') => {
      const n = toNumber(value)
      if (n === null) return empty
      return n < 0 ? `-${plain(n)}` : plain(n)
    },
    signed: (value, empty = '—') => {
      const n = toNumber(value)
      if (n === null) return empty
      if (n === 0) return plain(0)
      // A minus sign, not a hyphen: it reads as arithmetic beside a positive figure.
      return `${n > 0 ? '+' : '−'}${plain(n)}`
    },
  }
}

/** The decimals a cost input accepts — the 4 the server rounds valuation rates to. */
export const COST_DECIMALS = 4

/** True for the empty string or anything that parses as a number with at most 4 decimals. */
export function isEnterableCost(value: string): boolean {
  if (value.trim() === '') return true
  return new RegExp(`^\\d*(\\.\\d{0,${COST_DECIMALS}})?$`).test(value.trim())
}
