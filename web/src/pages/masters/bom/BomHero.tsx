import { ArrowRight, Boxes, Package, Sparkles } from 'lucide-react'
import type { Bom } from '../../../services/masters'
import { Button } from '../../../ui/Button'
import { AIC, cx } from '../../../ui/cx'
import { formatQty } from '../../../utils/format'

/**
 * The page's opening statement, and a small picture of what a bill of materials
 * IS: one finished product on the left, the components it consumes on the
 * right.
 *
 * The diagram is drawn from the FIRST ROW OF THE LIST when there is one, so a
 * company looking at its own bills sees its own product in it. With no rows —
 * an empty company, a filtered-out list, the first paint — it falls back to
 * unlabelled placeholder shapes rather than inventing an "Office Chair" this
 * company has never heard of. It is `aria-hidden` either way: everything it
 * says is said again in the table below.
 *
 * Plain elements and CSS, no charting dependency: three cards, a connector and
 * a stack.
 */

const CARD = 'rounded-2xl border border-gray-200 bg-white shadow-card'

function ComponentRow({ name, qty }: { name: string | null; qty: string | null }) {
  return (
    <div className="flex min-h-[2.5rem] items-center gap-2 rounded-lg border border-gray-200 bg-white px-2 py-1.5 shadow-card">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-gray-100 text-gray-400">
        <Package className="h-3.5 w-3.5" />
      </span>
      <span className="min-w-0 flex-1">
        {name ? (
          <>
            <span className="block truncate text-[11px] font-semibold leading-tight text-gray-900">{name}</span>
            <span className="block truncate text-[10px] text-gray-400">{qty ?? '—'}</span>
          </>
        ) : (
          <>
            <span className="skeleton mb-1 block h-2 w-16 rounded" />
            <span className="skeleton block h-2 w-8 rounded" />
          </>
        )}
      </span>
    </div>
  )
}

/** Up to three components of `sample`, padded out so the stack keeps its shape. */
function diagramRows(sample: Bom | null): { name: string | null; qty: string | null }[] {
  const preview = sample?.components_preview ?? []
  const rows: { name: string | null; qty: string | null }[] = preview.slice(0, 3).map((c) => ({
    name: c.item_name ?? `#${c.item_id}`,
    qty: `${formatQty(c.qty)}${c.unit_symbol ? ` ${c.unit_symbol}` : ''}`,
  }))
  while (rows.length < 3) rows.push({ name: null, qty: null })
  return rows
}

export interface BomHeroProps {
  /** The row the diagram illustrates — the first on screen, or null. */
  sample: Bom | null
  onCreateWithAi: () => void
  className?: string
}

export function BomHero({ sample, onCreateWithAi, className }: BomHeroProps) {
  const rows = diagramRows(sample)
  const productName = sample?.finished_item_name ?? null

  return (
    <section
      className={cx(
        AIC,
        CARD,
        'grid gap-4 p-4 sm:p-5',
        // One column on a phone, intro + AI card side by side from `md`, and
        // the diagram only from `wide` (1400px) — below that the third column
        // squeezes the sentence beside it, and the diagram is the decoration,
        // not the content.
        'md:grid-cols-[minmax(0,1fr)_minmax(17rem,20rem)] wide:grid-cols-[minmax(0,1fr)_minmax(19rem,22rem)_minmax(17rem,20rem)]',
        'print:hidden',
        className,
      )}
    >
      <div className="flex min-w-0 items-start gap-3.5">
        <span
          className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-primary-light text-primary"
          aria-hidden
        >
          <Boxes className="h-6 w-6" />
        </span>
        <div className="min-w-0">
          <h1 className="text-xl font-bold leading-tight tracking-tight text-gray-900 sm:text-2xl">
            Bill of Materials
          </h1>
          <p className="mt-1.5 max-w-xl text-[13px] leading-relaxed text-gray-500">
            Define and manage product structures, components and manufacturing recipes.
          </p>
        </div>
      </div>

      {/* Decorative: the finished item and its components are both in the table. */}
      <div className="relative hidden items-center justify-center gap-6 wide:flex" aria-hidden>
        <div
          className="absolute left-[38%] right-[42%] top-1/2 h-px bg-gray-200"
          aria-hidden
        />
        <div className="relative z-[1] w-[6.5rem] shrink-0 text-center">
          <div className="mx-auto grid h-[5.25rem] w-[5.25rem] place-items-center rounded-2xl border border-gray-200 bg-white text-gray-300 shadow-card">
            <Package className="h-8 w-8" />
          </div>
          <span className="mt-1.5 inline-flex max-w-full truncate rounded-full bg-primary-light px-2 py-1 text-[10px] font-bold text-primary">
            {productName ?? 'Finished product'}
          </span>
        </div>
        <div className="relative z-[1] grid w-[10.5rem] shrink-0 gap-1.5">
          {rows.map((row, i) => (
            <ComponentRow key={i} name={row.name} qty={row.qty} />
          ))}
        </div>
      </div>

      <aside className="flex flex-col gap-3 overflow-hidden rounded-xl border border-emerald-200 bg-emerald-50 p-4">
        <div className="flex items-start gap-2.5">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-white text-primary shadow-card" aria-hidden>
            <Sparkles className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <h2 className="text-sm font-bold text-gray-900">AI Assistant</h2>
            <p className="mt-1 text-[11.5px] leading-relaxed text-gray-600">
              Create a bill of materials from an item, drawing or document. Let AI suggest
              components, quantities and a cost estimate.
            </p>
          </div>
        </div>
        <Button
          size="md"
          block
          iconRight={ArrowRight}
          onClick={onCreateWithAi}
          className="mt-auto"
        >
          Create with AI
        </Button>
      </aside>
    </section>
  )
}

export default BomHero
