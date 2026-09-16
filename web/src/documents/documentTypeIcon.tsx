import {
  ArrowDownToLine,
  ArrowLeftRight,
  ArrowUpFromLine,
  Clock,
  FileText,
  Scale,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { cx } from '../ui/cx'
import { specForCode } from './registry'
import type { LineMode } from './registry'

/**
 * A glyph for a document type, in the Type column.
 *
 * What it encodes is the direction the type moves stock — `lineMode` on the
 * client registry, which mirrors `Config\DocumentTypeRegistry` — and nothing
 * else. It is deliberately NOT a judgement: green here does not mean good, and
 * an arrow up does not mean a loss. Stock in, stock out, stock moved between
 * your own warehouses and stock adjusted line by line are four facts a stores
 * clerk already thinks in, and a column of forty type names reads far faster
 * with them than without.
 *
 * `specForCode` only knows the native types, so the seven Books-sourced codes
 * carry their direction explicitly. A code neither list knows falls back to a
 * plain document glyph rather than guessing.
 */

interface Glyph {
  icon: LucideIcon
  className: string
}

const BY_LINE_MODE: Record<LineMode, Glyph> = {
  fixed_in: { icon: ArrowDownToLine, className: 'text-emerald-600' },
  fixed_out: { icon: ArrowUpFromLine, className: 'text-sky-600' },
  transfer: { icon: ArrowLeftRight, className: 'text-violet-600' },
  by_line: { icon: Scale, className: 'text-amber-600' },
  status_only: { icon: FileText, className: 'text-slate-500' },
  pending_only: { icon: Clock, className: 'text-slate-500' },
}

const NEUTRAL: Glyph = { icon: FileText, className: 'text-slate-400' }

/** Books-sourced codes (registry.SOURCED_DOCUMENT_TYPES) by the way they move stock. */
const SOURCED: Record<string, LineMode> = {
  SALES_ISSUE: 'fixed_out',
  PURCHASE_RECEIPT: 'fixed_in',
  SALES_RETURN: 'fixed_in',
  PURCHASE_RETURN: 'fixed_out',
  JOURNAL_ADJUSTMENT: 'by_line',
  RESERVATION: 'pending_only',
  RESERVATION_RELEASE: 'pending_only',
}

export function documentTypeGlyph(code: string | null | undefined): Glyph {
  if (!code) return NEUTRAL
  const mode = specForCode(code)?.lineMode ?? SOURCED[code.toUpperCase()]
  return mode ? BY_LINE_MODE[mode] : NEUTRAL
}

export function DocumentTypeIcon({ code, className }: { code: string | null | undefined; className?: string }) {
  const { icon: Icon, className: tone } = documentTypeGlyph(code)
  return <Icon className={cx('h-4 w-4 shrink-0', tone, className)} aria-hidden />
}

/** Icon + label, as the Type cell renders it. */
export function DocumentTypeCell({ code, label }: { code: string; label: string }) {
  return (
    <span className="flex items-center gap-2 min-w-0" title={label}>
      <DocumentTypeIcon code={code} />
      <span className="truncate">{label}</span>
    </span>
  )
}
