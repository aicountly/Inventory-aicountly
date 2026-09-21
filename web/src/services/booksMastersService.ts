/**
 * Books' accounting masters, as Inventory is allowed to see them.
 *
 * An item carries three references into Books — a sales ledger, a purchase ledger and a tax
 * category (`books_sales_acc_id`, `books_purchase_acc_id`, `books_tax_cat_id`). Books owns those
 * rows: it decides what a ledger is, what a tax category means and what happens to a voucher that
 * uses them. Inventory stores the id and reports it back, and that is the whole of its part.
 *
 * ## Why this file holds no data
 *
 * The only cross-product relay the API exposes is Manage's (`manage/(:any)` in Routes.php), for
 * companies, branches and financial years. There is no Books relay, so there is no live list of
 * ledgers to populate a dropdown with.
 *
 * The forbidden fix would be to copy Books' chart of accounts into an Inventory table and keep it
 * in step with a cron. That is exactly the duplication the domain contract rules out
 * (docs/DOMAIN_OWNERSHIP.md): two databases holding the same master, drifting between runs, with
 * no answer to which one is right. So this module reports the capability as absent, the workspace
 * shows the stored references read-only and says where they are maintained, and the values are
 * left untouched on save — `buildRow` only writes the columns a request actually carries, so a
 * field this app never sends is a field it cannot damage.
 *
 * When a Books relay exists, point `RELAY_PREFIX` at it and implement the lookups against the
 * existing `api` client. Live API, one source of truth, no copy.
 */

export interface BooksAccountRef {
  id: number
  name: string
  code: string | null
}

export interface BooksMastersCapability {
  available: boolean
  reason: string
}

const RELAY_PREFIX: string | null = null

const UNAVAILABLE: BooksMastersCapability = {
  available: false,
  reason:
    'Ledger and tax-category names live in Aicountly Books. Inventory stores the reference and shows it here; open the item in Books to change which ledger it posts to.',
}

export const booksMastersService = {
  capability(): BooksMastersCapability {
    return RELAY_PREFIX === null ? UNAVAILABLE : { available: true, reason: '' }
  },

  /** Selectable sales / purchase ledgers. Empty until a live relay exists — never a cached copy. */
  async ledgers(_kind: 'sales' | 'purchase', _signal?: AbortSignal): Promise<BooksAccountRef[]> {
    return []
  },

  async taxCategories(_signal?: AbortSignal): Promise<BooksAccountRef[]> {
    return []
  },
}

export default booksMastersService
