import { Link } from 'react-router-dom'
import {
  AlertTriangle,
  History,
  Info,
  Lightbulb,
  Printer,
  ScanLine,
  ShieldCheck,
  Sparkles,
  Upload,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { Card } from '../ui/Card'
import { cx } from '../ui/cx'
import type { SerialFinding, SerialFindingSeverity } from './serialInsights'
import { serialAssistant } from './serialsAi'

/**
 * The column beside the table: scan, findings, shortcuts, a tip.
 *
 * Supporting, never dominant — the table is what the page is for. Every control
 * here does something real: a quick link that navigates nowhere is worse than
 * no quick link, because the reader spends a click finding that out.
 */
export interface SerialSidePanelProps {
  findings: readonly SerialFinding[]
  headline: string
  findingsLoading: boolean
  canWrite: boolean
  onScan: () => void
  onBulkAdd: () => void
  onPrintLabels: () => void
  onApplyFilters: (filters: Record<string, string>) => void
  /** URL of this page filtered to warranties expiring inside the quarter. */
  warrantyHref: string
  className?: string
}

const SEVERITY_ICON: Record<SerialFindingSeverity, LucideIcon> = {
  critical: AlertTriangle,
  warning: AlertTriangle,
  info: Info,
}

const SEVERITY_CLASS: Record<SerialFindingSeverity, string> = {
  critical: 'text-red-600',
  warning: 'text-amber-600',
  info: 'text-sky-600',
}

interface QuickLink {
  key: string
  icon: LucideIcon
  title: string
  description: string
  tone: string
  to?: string
  onSelect?: () => void
  hidden?: boolean
}

export function SerialSidePanel({
  findings,
  headline,
  findingsLoading,
  canWrite,
  onScan,
  onBulkAdd,
  onPrintLabels,
  onApplyFilters,
  warrantyHref,
  className,
}: SerialSidePanelProps) {
  const assistant = serialAssistant()
  const top = findings.slice(0, 3)

  const quickLinks: QuickLink[] = [
    {
      key: 'bulk',
      icon: Upload,
      title: 'Bulk add',
      description: 'Import or paste many serials',
      tone: 'bg-primary-light text-primary',
      onSelect: onBulkAdd,
      hidden: !canWrite,
    },
    {
      key: 'labels',
      icon: Printer,
      title: 'Print labels',
      description: 'Barcode labels for the selection',
      tone: 'bg-sky-50 text-sky-600',
      onSelect: onPrintLabels,
    },
    {
      key: 'warranty',
      icon: ShieldCheck,
      title: 'Warranty report',
      description: 'Expiring in the next 90 days',
      tone: 'bg-amber-50 text-amber-600',
      to: warrantyHref,
    },
    {
      key: 'history',
      icon: History,
      title: 'Serial history',
      description: 'Every recorded serial change',
      tone: 'bg-violet-50 text-violet-600',
      to: '/audit?entity_type=serial',
    },
  ]

  return (
    <aside
      // Beside the table it is a column; underneath it, two across, so four
      // cards do not become a metre of scrolling under a 20-row register.
      className={cx('grid grid-cols-1 gap-3 sm:grid-cols-2 wide:flex wide:flex-col', className)}
      aria-label="Serial tools"
    >
      <Card padding="md" className="flex flex-col gap-2">
        <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-sky-50 text-sky-600" aria-hidden>
          <ScanLine className="h-4 w-4" />
        </span>
        <h3 className="text-sm font-semibold text-gray-900">Scan &amp; add</h3>
        <p className="text-xs leading-relaxed text-gray-500">
          Scan a barcode or QR code to find a serial, or to register one without typing it.
        </p>
        <Button variant="secondary" size="sm" icon={ScanLine} block onClick={onScan} className="mt-1">
          Start scanning
        </Button>
      </Card>

      <Card
        padding="md"
        className="flex flex-col gap-2 border-violet-200 bg-violet-50"
      >
        <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-violet-50 text-violet-600" aria-hidden>
          <Sparkles className="h-4 w-4" />
        </span>
        <h3 className="flex items-center gap-2 text-sm font-semibold text-gray-900">
          Serial insights
          {/*
            Labelled for what it is. Everything below is arithmetic over figures
            the server computed (serialInsights.ts) — calling it an AI insight
            would be a claim about a capability this product does not have, and
            a reader told it is a forecast will act on it as one.
          */}
          <Badge tone="neutral" size="xs">
            Rule-based
          </Badge>
        </h3>

        {findingsLoading && findings.length === 0 ? (
          <p className="text-xs text-gray-500">Reading this company’s serial numbers…</p>
        ) : (
          <>
            <p className="text-xs font-medium text-gray-700">{headline}</p>
            {top.length > 0 ? (
              <ul className="m-0 flex list-none flex-col gap-2 p-0">
                {top.map((finding) => {
                  const Icon = SEVERITY_ICON[finding.severity]
                  return (
                    <li key={finding.key} className="flex items-start gap-2">
                      <Icon className={cx('mt-0.5 h-3.5 w-3.5 shrink-0', SEVERITY_CLASS[finding.severity])} aria-hidden />
                      <span className="min-w-0 text-xs leading-relaxed text-gray-600">
                        {finding.text}{' '}
                        <button
                          type="button"
                          className="font-semibold text-primary underline-offset-2 hover:underline focus:outline-none focus-visible:underline"
                          onClick={() => onApplyFilters(finding.filters)}
                        >
                          {finding.actionLabel}
                        </button>
                      </span>
                    </li>
                  )
                })}
              </ul>
            ) : null}
          </>
        )}

        {/*
          The assistant is not wired to Inventory yet. Rather than a button that
          does nothing, the card says so — and the findings above it are real
          either way, which is the point of computing them here.
        */}
        {assistant.available ? null : <p className="text-[11px] leading-relaxed text-gray-400">{assistant.reason}</p>}
      </Card>

      <Card padding="md">
        <h3 className="mb-1 text-sm font-semibold text-gray-900">Quick links</h3>
        <div className="flex flex-col">
          {quickLinks
            .filter((link) => !link.hidden)
            .map((link) => {
              const Icon = link.icon
              const body = (
                <>
                  <span className={cx('inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg', link.tone)} aria-hidden>
                    <Icon className="h-4 w-4" />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-xs font-semibold text-gray-800">{link.title}</span>
                    <span className="block text-[11px] text-gray-400">{link.description}</span>
                  </span>
                </>
              )
              const shell = 'flex w-full items-center gap-2.5 rounded-lg px-1.5 py-2 text-left no-underline transition-colors hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30'
              return link.to ? (
                <Link key={link.key} to={link.to} className={shell}>
                  {body}
                </Link>
              ) : (
                <button key={link.key} type="button" className={shell} onClick={link.onSelect}>
                  {body}
                </button>
              )
            })}
        </div>
      </Card>

      <Card padding="md" className="border-emerald-200 bg-emerald-50/50">
        <h3 className="mb-1 flex items-center gap-2 text-sm font-semibold text-emerald-800">
          <Lightbulb className="h-4 w-4" aria-hidden />
          Pro tip
        </h3>
        <p className="m-0 text-xs leading-relaxed text-emerald-900">
          A hardware scanner types like a keyboard. Press <kbd className="kbd">/</kbd> to focus the search box, scan, and
          the serial opens on Enter — no mouse at all.
        </p>
      </Card>
    </aside>
  )
}

export default SerialSidePanel
