import { useState } from 'react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { BookOpen, ExternalLink, SlidersHorizontal } from 'lucide-react'
import { useAccess } from '../../access/AccessContext'
import { useQuery } from '../../hooks/useQuery'
import { P } from '../../services/access'
import { settingsApi } from '../../services/settingsApi'
import { METHOD_LABELS } from '../../services/valuationApi'
import type { ReportMethod } from '../../services/valuationApi'
import { Button } from '../../ui/Button'
import { Drawer } from '../../ui/Drawer'
import { Skeleton } from '../../ui/Skeleton'
import { humanize } from '../../utils/format'

/**
 * Quick Guide and Method Settings, the two header controls that belong to this
 * register rather than to the engine.
 *
 * They are one component because both are drawers and both are state the
 * register owns; the engine renders whatever `headerActions` a config declares
 * and knows nothing about either.
 */
export function ValuationHeaderActions() {
  const { can } = useAccess()
  const [guide, setGuide] = useState(false)
  const [settings, setSettings] = useState(false)
  const canReadSettings = can(P.settingsRead)

  return (
    <>
      <Button variant="ghost" icon={BookOpen} onClick={() => setGuide(true)}>
        Quick guide
      </Button>
      {/* Costing policy is company-wide configuration, so a member who may not
          read settings is not offered a door into them. The API refuses the
          call regardless; this stops the button promising otherwise. */}
      {canReadSettings ? (
        <Button variant="secondary" icon={SlidersHorizontal} onClick={() => setSettings(true)}>
          Method settings
        </Button>
      ) : null}

      <QuickGuideDrawer open={guide} onClose={() => setGuide(false)} />
      {canReadSettings ? (
        <MethodSettingsDrawer open={settings} onClose={() => setSettings(false)} />
      ) : null}
    </>
  )
}

/* -------------------------------------------------------------- quick guide */

function Term({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="border-t border-gray-100 py-2.5 first:border-t-0 first:pt-0">
      <dt className="text-xs font-semibold text-gray-900">{term}</dt>
      <dd className="mt-0.5 text-xs leading-relaxed text-gray-600">{children}</dd>
    </div>
  )
}

/**
 * What the register's words mean, in a reader's terms rather than the schema's.
 *
 * Kept to the nine things on the screen in front of them. It is a reference
 * panel, not documentation: anything that needs a second screen to explain
 * belongs in the docs, not in a drawer over the register.
 */
function QuickGuideDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Quick guide"
      description="What this register reports, and how to read it."
      icon={<BookOpen className="h-5 w-5 text-primary" aria-hidden />}
    >
      <dl className="m-0">
        <Term term="Valuation register">
          What the stock on hand is worth on one date, item by item. It is a position, not a
          period: nothing here is a total of movements between two dates.
        </Term>
        <Term term="As at date">
          The register replays every posted movement up to and including this date. Change it and
          you are asking a different question, not filtering the same answer.
        </Term>
        <Term term="Closing quantity">
          Quantity on hand at that date, in the item&rsquo;s stock unit — receipts less issues,
          including movements posted late but dated on or before it.
        </Term>
        <Term term="Unit cost">
          What one unit is carried at under the chosen method. It is a result of the method, not a
          price anyone typed.
        </Term>
        <Term term="Stock value">
          Closing quantity at unit cost, computed by the valuation engine. Every figure in this
          register comes from there — nothing on this screen re-costs stock.
        </Term>
        <Term term="FIFO and LIFO">
          Stock is held as dated cost layers. FIFO consumes the oldest layer first and leaves the
          newest on hand; LIFO does the opposite. What remains is valued at the layers that were
          not consumed.
        </Term>
        <Term term="Weighted average">
          One running average cost per item, recomputed on each receipt, with no layers to
          consume. An item on this method shows no rows in Cost layers.
        </Term>
        <Term term="As per item master">
          Each item valued by the method set on its own master, falling back to the company
          default. This is the basis the books are kept on; the other three answer &ldquo;what
          would it be worth if&hellip;&rdquo;.
        </Term>
        <Term term="Applied">
          The method actually used for that row. It differs from the item&rsquo;s own method when
          the method asked for cannot be honoured — an item with no cost layers, for instance.
          Worth looking at before a valuation is queried.
        </Term>
        <Term term="Warehouse">
          Filtering to one warehouse values the stock standing in it. Whether a warehouse is costed
          on its own or at the company&rsquo;s average is a company setting, not a filter — see
          Method settings.
        </Term>
      </dl>
    </Drawer>
  )
}

/* ---------------------------------------------------------- method settings */

function Row({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div className="border-t border-gray-100 py-2.5 first:border-t-0 first:pt-0">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-xs text-gray-600">{label}</span>
        <span className="text-xs font-semibold text-gray-900">{value}</span>
      </div>
      {hint ? <p className="mt-0.5 text-[11px] leading-relaxed text-gray-500">{hint}</p> : null}
    </div>
  )
}

/**
 * The costing policy this company's valuation is computed under.
 *
 * Read-only on purpose. These settings decide what every valuation, COGS
 * posting and reconciliation in the product comes to, and changing the default
 * method re-values stock that has already been reported and posted to Books.
 * That belongs on the settings screen, behind its own write permission and its
 * own confirmation — not one click from a register, where it would look like a
 * display option.
 */
function MethodSettingsDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const settings = useQuery((signal) => settingsApi.get(signal), [open], { enabled: open })
  const { can } = useAccess()
  const data = settings.data

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Method settings"
      description="The costing policy this register is computed under."
      icon={<SlidersHorizontal className="h-5 w-5 text-primary" aria-hidden />}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
          {can(P.settingsWrite) ? (
            <Link to="/settings" onClick={onClose}>
              <Button icon={ExternalLink}>Open settings</Button>
            </Link>
          ) : null}
        </>
      }
    >
      {settings.error ? (
        <p className="text-xs text-gray-600">
          The company&rsquo;s costing settings could not be read just now.{' '}
          <button
            type="button"
            className="font-semibold text-primary hover:underline"
            onClick={settings.reload}
          >
            Try again
          </button>
        </p>
      ) : settings.loading && !data ? (
        <div className="space-y-2">
          <Skeleton height="h-8" />
          <Skeleton height="h-8" />
          <Skeleton height="h-8" />
          <Skeleton height="h-8" />
        </div>
      ) : data ? (
        <>
          <dl className="m-0">
            <Row
              label="Default valuation method"
              value={
                METHOD_LABELS[data.default_valuation_method as ReportMethod] ??
                humanize(data.default_valuation_method)
              }
              hint="Used by any item whose master does not name a method of its own."
            />
            <Row
              label="Valuation scope"
              value={humanize(data.valuation_scope)}
              hint={
                String(data.valuation_scope) === 'warehouse'
                  ? 'Cost layers are kept per warehouse, so the same item can carry a different unit cost in each.'
                  : 'One cost per item across every warehouse.'
              }
            />
            <Row
              label="Negative stock"
              value={humanize(data.negative_stock_policy)}
              hint="What happens when an issue would take stock below zero."
            />
            <Row
              label="FEFO"
              value={
                data.fefo_enabled === true ||
                data.fefo_enabled === 1 ||
                data.fefo_enabled === '1'
                  ? 'On'
                  : 'Off'
              }
              hint="Batched items are picked by earliest expiry rather than by receipt order."
            />
            <Row
              label="COGS revisions"
              value={humanize(data.cogs_revision_mode)}
              hint="How a back-dated recalculation reaches Books — corrected in place, or as an adjustment."
            />
            <Row label="Base currency" value={data.base_currency_code} />
          </dl>
          <p className="mt-4 rounded-lg bg-amber-50 px-3 py-2.5 text-[11px] leading-relaxed text-amber-900">
            Changing the default method re-values stock that has already been reported and posted
            to Books, so it is made on the settings screen behind its own permission — not from a
            register.
          </p>
        </>
      ) : null}
    </Drawer>
  )
}

export default ValuationHeaderActions
