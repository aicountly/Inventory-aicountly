import { Link } from 'react-router-dom'
import { Drawer } from '../../../ui/Drawer'
import { METHOD_LABELS } from '../../../services/valuationApi'

/**
 * "Learn about valuation methods", answered in the app.
 *
 * Contextual help, not a link out: Inventory ships no documentation site, and a
 * header link that opened a 404 would be worse than no link. Four short
 * paragraphs are enough to read this screen, and the last note is the one that
 * matters most — nothing here changes anything.
 */

const METHODS: { key: keyof typeof METHOD_LABELS; body: string }[] = [
  {
    key: 'AS_PER_MASTER',
    body:
      'The basis your books are kept on. Each item is valued by the method set on its own master, falling back to the company default where an item names none. This is the only row on this screen that matches your ledgers.',
  },
  {
    key: 'FIFO',
    body:
      'First in, first out. Stock is assumed to leave in the order it arrived, so what remains is valued at your most recent purchase costs. When costs are rising this holds the highest closing value, and reports the lowest cost of goods sold.',
  },
  {
    key: 'LIFO',
    body:
      'Last in, first out. The newest stock is assumed to leave first, so what remains carries your oldest costs. When costs are rising this holds the lowest closing value. Note that LIFO is not permitted under Ind AS or IFRS for statutory reporting.',
  },
  {
    key: 'WAC',
    body:
      'Every unit carries the running average cost of everything held, recalculated as stock arrives. It smooths cost swings, which is why it usually lands between FIFO and LIFO — and often closest to the basis.',
  },
]

export function MethodsExplainer({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Valuation methods"
      description="What each method assumes, and what this screen does with it."
      width="md"
    >
      <div className="space-y-4">
        <p className="text-xs leading-relaxed text-gray-600">
          A valuation method is an assumption about <em>which</em> units left your stock, not about
          what is physically on the shelf. The quantity is the same under all four; only the cost
          attached to it changes.
        </p>

        <dl className="space-y-3.5">
          {METHODS.map((m) => (
            <div key={m.key} className="rounded-xl border border-gray-200 bg-white p-3">
              <dt className="text-sm font-semibold text-gray-900">{METHOD_LABELS[m.key]}</dt>
              <dd className="mt-1 text-xs leading-relaxed text-gray-600">{m.body}</dd>
            </div>
          ))}
        </dl>

        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
          <p className="text-xs font-semibold text-amber-800">This screen changes nothing</p>
          <p className="mt-1 text-xs leading-relaxed text-amber-700">
            The three rows below the basis are simulations: what the same physical stock would be
            worth if that one method were applied throughout. Nothing here posts an entry, revalues
            stock, or alters any item&rsquo;s configured method.{' '}
            <Link to="/settings" className="font-semibold underline">
              The default method is a company setting
            </Link>
            , and an item can override it on its own master.
          </p>
        </div>
      </div>
    </Drawer>
  )
}

export default MethodsExplainer
