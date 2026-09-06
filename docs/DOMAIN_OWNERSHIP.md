# Domain ownership — Manage, Books, Inventory

This is the contract every Aicountly product (Books, Inventory, and the coming POS, Sales, Purchases and Billing apps) builds on. A table has exactly one owner. Other products hold at most a **reference** (an id, a UUID, a frozen snapshot for printing) — never a second writable copy.

## Owners at a glance

| Domain | Owner | Everyone else holds |
|---|---|---|
| Company, branch, financial year, users, access (portal session) | **Manage** (`manage.aicountly.com`) | `cmp_id`, `bo_id`, `fy_id`, `uuid` only. FY dates and the default valuation method (`def_val_method`) are read from Manage; never recreated. |
| Ledgers, account groups, vouchers, journal lines, commercial item lines (rate, amount, tax, HSN), GST, TDS, bills, cost centres, projects, sub-ledgers, BRS, financial statements | **Books** (`books.aicountly.com`) | Inventory stores `source_document_type / id / uuid / no / date` and `books_*` ledger references it is handed. |
| Items, item groups, stock categories, brands, UOM and conversions, warehouses (material centres), warehouse groups, locations, BOM, batches, serials, opening stock (quantity + valuation rate), inventory documents, stock movements, balances, valuation layers (FIFO/LIFO/WAC), COGS computation, adjustments, reservations, GRN/dispatch (challans), landed cost, back-dated recalculation, stock reports, reconciliation | **Inventory** (`inventory.aicountly.com`) | Books keeps a **read-only mirror** of item / unit / warehouse names for prints and registers (see below). |

## Commercial value versus inventory valuation

These are two different numbers and are never confused:

| | Where it lives | Meaning |
|---|---|---|
| `source_transaction_rate` / `source_transaction_amount` (Inventory) = `rate` / `amount` on `books_voucher_inventory_lines` (Books) | Books is the truth; Inventory keeps a copy on the line | The price agreed with the party — drives GST, receivables, turnover. |
| `valuation_rate` / `valuation_amount` (Inventory) = `cost_rate` / `cost_amount` on `books_voucher_inventory_lines` (Books, copied back after posting) | Inventory is the truth | What the stock cost — drives COGS, closing stock and the Stock-in-Hand ledger. |

## Tables

### Books — retained, still written by Books
`books_voucher_headers` (now with `vch_uuid`), `books_voucher_lines`, `books_voucher_inventory_lines` (commercial fields; `cost_rate`, `cost_amount`, `valuation_method_applied` are written from Inventory's answer; `mc_id`, `unit_id`, `book_qty`, `physical_qty` are frozen for history), `books_voucher_tax_lines`, `books_voucher_service_lines`, `books_voucher_bill_sundry_lines`, `books_credit_note_line_details`, `books_debit_note_line_details`, `books_bills*`, `books_voucher_line_cc_allocations`, `books_voucher_line_subledger_allocations`, GST/TDS/BRS tables, print snapshot tables, `books_inventory_postings`, `books_inventory_events`, `books_inventory_cogs_revisions`.

### Books — read-only mirror (Inventory is the writer)
`books_items`, `books_item_units`, `books_item_unit_lines` (unit and conversion columns only), `books_material_centres`, `books_material_centre_groups`, `books_item_groups`, `books_stock_categories`, `books_bom_headers`, `books_bom_lines`.
Kept in step by Inventory outbox events `inventory.item.upserted`, `inventory.uom.upserted`, `inventory.warehouse.upserted` (and `php spark inventory:resync-masters` for a full sync). In `INVENTORY_MODE=live` Books' master endpoints answer writes with HTTP 410 and point to Inventory.

### Books — frozen after cutover (kept for audit, not deleted, never written)
`books_inventory_cost_layers`, `books_inventory_wac_state`, `books_stock_bucket_balances`, `books_stock_bucket_ledger`, `books_inventory_pending`, `books_inventory_settlement`, `books_voucher_packing_meta`, `books_voucher_packing_lines`, `books_voucher_job_work_lines`, `books_item_fy_openings`, `books_fy_carryforward` (Items counts now come from Inventory), `books_movement_document_snapshots`, `books_item_gst_profile_history`. Their content was migrated (see `DB_MIGRATION_PLAN.md`). They stay so historical prints, audits and a rollback remain possible.

### Inventory — owned tables (`inv_*`)
Masters: `inv_items`, `inv_item_uoms`, `inv_item_groups`, `inv_stock_categories`, `inv_brands`, `inv_uom`, `inv_warehouses`, `inv_warehouse_groups`, `inv_locations`, `inv_bom_headers`, `inv_bom_lines`, `inv_batches`, `inv_serials`, `inv_item_openings`, `inv_fy_carryforward_status`, `inv_fy_ranges`, `inv_company_settings`, `inv_period_locks`.
Documents and stock: `inv_documents`, `inv_document_lines`, `inv_document_line_serials`, `inv_document_approvals`, `inv_document_snapshots`, `inv_packing_meta`, `inv_stock_movements`, `inv_stock_status_movements`, `inv_stock_balances`, `inv_cost_layers`, `inv_cost_layer_consumptions`, `inv_wac_state`, `inv_pending_quantities`, `inv_pending_settlements`, `inv_reservations`, `inv_valuation_recalc_jobs`, `inv_valuation_revisions`.
Integration and control: `inv_integration_events` (outbox), `inv_inbound_events`, `inv_idempotency_keys`, `inv_reconciliation_runs`, `inv_audit_log`, `inv_access_*`, `inv_legacy_id_map`, `inv_migration_runs`, `inv_sql_migrations`.

## Identifiers

* Books numeric ids are preserved by the migration: `vch_txn_id → inv_documents.document_id`, `inv_line_id → inv_document_lines.line_id`, `item_id`, `unit_id`, `mc_id → warehouse_id`, `item_grp_id`, `stock_cat_id`, `bom_id`, `layer_id`, `item_fy_opening_id → opening_id`. Packing lines are offset by 1 000 000 000 and job-work lines by 2 000 000 000; inception openings by 1 000 000 000. Every migrated row carries `legacy_source_table` + `legacy_source_id`, and `inv_legacy_id_map` records the mapping per migration run.
* Every document and voucher has a UUID. Historical vouchers received a deterministic v5 UUID (`aicountly:books_voucher_headers:<vch_txn_id>`) written to both `books_voucher_headers.vch_uuid` and `inv_documents.source_document_uuid`; new vouchers get a random v4 in Books and pass it as `source_document_uuid`.
* Documents created by Books carry `source_app = books`, `source_document_type = books.sales | books.purchase | books.credit_note | books.debit_note | books.journal`, `source_document_id = vch_txn_id`. A partial unique index guarantees one live inventory document per source document.

## Who may write what

| Actor | Allowed writes |
|---|---|
| Books (service key `books`) | `POST /v1/inventory-documents/post`, `/{id}/reverse`, `/{id}/revise`, `POST /v1/valuation/carry-forward`, reads. |
| Inventory UI users | All masters and native documents, subject to `inv_access_*` permissions. |
| Future apps (POS, Sales, Purchases, Billing) | Same as Books: their own service key, their own `source_app`, documents of the types they own; masters through the Inventory API; accounting through the Books API. Their own tables hold only what neither Books nor Inventory owns. |

Books never writes `inv_*` tables directly and Inventory never writes `books_*` tables directly; the only cross-writes are the mirror events and the COGS/cost copy-back, both performed by the owning side's API.
