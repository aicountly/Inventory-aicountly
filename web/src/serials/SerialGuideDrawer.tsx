import { Drawer } from '../ui/Drawer'
import { StatusBadge } from '../ui/StatusBadge'
import { SERIAL_STATUSES } from '../services/masters'

/**
 * What serial tracking actually does in this product.
 *
 * Written here rather than linked out, for two reasons: an external link is a
 * thing that can rot, and everything on this page is explained by the rules the
 * API enforces — so the guide can be true by construction instead of being a
 * document somebody has to remember to update.
 */
const STATUS_NOTES: Record<string, string> = {
  expected: 'Registered but not yet received. It is not stock and it is not counted as available.',
  in_stock: 'Physically held and available. Only a posted receipt puts a serial here.',
  reserved: 'Held for a specific commitment. Still yours, not available to anybody else.',
  in_transit: 'Left one warehouse and has not arrived at the next.',
  issued: 'Delivered or consumed. It has left the business.',
  returned: 'Came back from a customer and is waiting to be put away or written off.',
  damaged: 'Physically unusable. Kept on record so its cost and its history do not vanish.',
  scrapped: 'Written off. The end of the unit’s life.',
}

export function SerialGuideDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Drawer
      open={open}
      onClose={onClose}
      width="md"
      title="Serial tracking"
      description="How a serial number behaves in Aicountly Inventory."
    >
      <div className="flex flex-col gap-4 text-xs leading-relaxed text-gray-600">
        <section>
          <h3 className="m-0 mb-1 text-sm font-semibold text-gray-900">What a serial number is here</h3>
          <p className="m-0">
            One physical unit, followed for its whole life. A serial belongs to exactly one item and is unique within it,
            so the same number may be used again for a different item without a clash. Registering a serial does not
            create stock — a posted receipt document does.
          </p>
        </section>

        <section>
          <h3 className="m-0 mb-1 text-sm font-semibold text-gray-900">The statuses</h3>
          <p className="m-0 mb-2">
            Documents set these, not this screen. Editing a serial by hand changes the record of where it is; it never
            moves stock or writes to the ledger.
          </p>
          <dl className="m-0 grid grid-cols-[auto,1fr] gap-x-3 gap-y-1.5">
            {SERIAL_STATUSES.map((status) => (
              <div key={status} className="contents">
                <dt className="whitespace-nowrap">
                  <StatusBadge value={status} size="xs" />
                </dt>
                <dd className="m-0">{STATUS_NOTES[status]}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section>
          <h3 className="m-0 mb-1 text-sm font-semibold text-gray-900">Warranty</h3>
          <p className="m-0">
            A warranty date is resolved into a state — covered, expiring soon, expired, or not recorded — against
            windows the API sends with the counters, so the figure on a card and the phrase in a row always measure the
            same period. The quick filters above narrow the list to any one of them.
          </p>
        </section>

        <section>
          <h3 className="m-0 mb-1 text-sm font-semibold text-gray-900">Getting numbers in</h3>
          <p className="m-0">
            Bulk add takes a pasted list, a CSV with a column mapping, a generated range, or a scanner typing straight
            into the list. Numbers already registered for the item are reported back and skipped — never duplicated,
            never silently dropped.
          </p>
        </section>

        <section>
          <h3 className="m-0 mb-1 text-sm font-semibold text-gray-900">Scanning</h3>
          <p className="m-0">
            A handheld scanner is a keyboard: press <kbd className="kbd">/</kbd>, scan, and the search runs on the
            scanner’s Enter. Where the browser can decode from a camera, the scan dialog offers that too — and typing
            the number always works.
          </p>
        </section>

        <section>
          <h3 className="m-0 mb-1 text-sm font-semibold text-gray-900">Who sees what</h3>
          <p className="m-0">
            Unit cost is stock valuation, so it is shown only to a profile allowed to see what stock is worth. When it
            is withheld the API does not send it at all — the column is absent rather than hidden.
          </p>
        </section>
      </div>
    </Drawer>
  )
}

export default SerialGuideDrawer
