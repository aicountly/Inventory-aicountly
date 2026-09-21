import { Button } from '../../ui/Button'
import { Drawer } from '../../ui/Drawer'
import { Kbd } from '../../ui/Kbd'

export interface TransferGuideDrawerProps {
  open: boolean
  onClose: () => void
}

const STEPS: { title: string; body: string }[] = [
  {
    title: 'Choose where the stock is going',
    body: 'Pick the source and the destination warehouse. They cannot be the same, and the list only offers warehouses your profile may post to in the selected branch. The swap button reverses them.',
  },
  {
    title: 'Say why it is moving',
    body: 'The transfer reason is stored on the document and shows in every register and print sheet afterwards. The quick tags under the narration set it in one click.',
  },
  {
    title: 'Add the items',
    body: 'Search by name, SKU or barcode, scan them in, or import a CSV of code and quantity. The Available column shows what the SOURCE warehouse holds free right now; hover it for the on-hand, reserved and committed split.',
  },
  {
    title: 'Batches and serial numbers',
    body: 'A batch-tracked item asks which batch is moving. A serial-tracked item needs exactly as many serial numbers as the quantity in base units, and will not post until it has them.',
  },
  {
    title: 'Split a line to another warehouse',
    body: 'Each row can override the header route. Open the route line under an item to send that one line out of, or into, a different warehouse than the rest of the document.',
  },
  {
    title: 'Save, then post',
    body: 'Saving a draft records the document and moves no stock at all — nothing is held back or reserved. Stock leaves the source and arrives at the destination only when the transfer is posted, and the server checks availability again at that moment.',
  },
]

/**
 * What this screen does, written from what it actually does.
 *
 * The approved design puts a "Watch Guide" button here. There is no video and
 * no help service to open — so rather than a button that 404s, or a link to a
 * page that does not exist, it opens the guide this screen can honestly give.
 */
export function TransferGuideDrawer({ open, onClose }: TransferGuideDrawerProps) {
  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="How a stock transfer works"
      description="Six steps, and what each one does to your stock."
      width="md"
      footer={
        <div className="flex justify-end">
          <Button variant="primary" onClick={onClose}>
            Got it
          </Button>
        </div>
      }
    >
      <ol className="space-y-3">
        {STEPS.map((step, i) => (
          <li key={step.title} className="flex gap-3">
            <span
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary-light text-[11px] font-bold text-primary"
              aria-hidden
            >
              {i + 1}
            </span>
            <div className="min-w-0">
              <strong className="block text-xs font-semibold text-gray-900">{step.title}</strong>
              <p className="mt-0.5 text-xs leading-relaxed text-gray-600">{step.body}</p>
            </div>
          </li>
        ))}
      </ol>

      <div className="mt-5 rounded-xl border border-gray-200 bg-gray-50 p-3">
        <h3 className="text-xs font-semibold text-gray-900">Shortcuts on this screen</h3>
        <ul className="mt-2 space-y-1.5 text-xs text-gray-600">
          <li className="flex items-center gap-2">
            <Kbd>Alt</Kbd>
            <span aria-hidden>+</span>
            <Kbd>S</Kbd>
            <span>Save as draft</span>
          </li>
          <li className="flex items-center gap-2">
            <Kbd>Alt</Kbd>
            <span aria-hidden>+</span>
            <Kbd>P</Kbd>
            <span>Save and post</span>
          </li>
          <li className="flex items-center gap-2">
            <Kbd>Ctrl</Kbd>
            <span aria-hidden>+</span>
            <Kbd>S</Kbd>
            <span>Save as draft, even while typing in a field</span>
          </li>
          <li className="flex items-center gap-2">
            <Kbd>Esc</Kbd>
            <span>Close whatever is open, or leave the screen</span>
          </li>
        </ul>
        <p className="mt-2 text-[11px] text-gray-500">
          Alt shortcuts stay out of the way while you are typing in a field, a note or a dropdown filter.
        </p>
      </div>
    </Drawer>
  )
}
