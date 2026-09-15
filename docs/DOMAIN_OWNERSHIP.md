# Domain ownership — Manage, Books, Inventory

This is the contract every Aicountly product (Books, Inventory, and the coming POS, Sales, Purchases and Billing apps) builds on. A table has exactly one owner. Other products hold at most a **reference** (an id, a UUID, a frozen snapshot for printing) — never a second writable copy.

## Owners at a glance

| Domain | Owner | Everyone else holds |
|---|---|---|
| Company, branch, financial year, users, access (portal session) | **Manage** (`manage.aicountly.com`) | `cmp_id`, `bo_id`, `fy_id`, `uuid` only. FY dates are read from Manage, never recreated. The default valuation method is chosen in Manage (`ghm_fy.def_val_method`) and **applied by Inventory** — see below. |
| Ledgers, account groups, vouchers, journal lines, commercial item lines (rate, amount, tax, HSN), GST, TDS, bills, cost centres, projects, sub-ledgers, BRS, financial statements | **Books** (`books.aicountly.com`) | Inventory stores `source_document_type / id / uuid / no / date` and `books_*` ledger references it is handed. |
| Items, item groups, stock categories, brands, UOM and conversions, warehouses (material centres), warehouse groups, locations, BOM, batches, serials, opening stock (quantity + valuation rate), inventory documents, stock movements, balances, valuation layers (FIFO/LIFO/WAC), COGS computation, adjustments, reservations, GRN/dispatch (challans), landed cost, back-dated recalculation, stock reports, reconciliation | **Inventory** (`inventory.aicountly.com`) | Books keeps ids only. It reads every name, group and unit from Inventory's API at the point of use — prints and registers included. The mirror it used to keep has been retired (see below). |

## Commercial value versus inventory valuation

These are two different numbers and are never confused:

| | Where it lives | Meaning |
|---|---|---|
| `source_transaction_rate` / `source_transaction_amount` (Inventory) = `rate` / `amount` on `books_voucher_inventory_lines` (Books) | Books is the truth; Inventory keeps a copy on the line | The price agreed with the party — drives GST, receivables, turnover. |
| `valuation_rate` / `valuation_amount` (Inventory) = `cost_rate` / `cost_amount` on `books_voucher_inventory_lines` (Books, copied back after posting) | Inventory is the truth | What the stock cost — drives COGS, closing stock and the Stock-in-Hand ledger. |

## The default stock valuation method

One choice, made in one place, applied in one place — it had ended up in three:

| | Column | Role |
|---|---|---|
| Manage | `ghm_fy.def_val_method` | where the user makes the choice, on the Create Company screen |
| Books | `books_company_settings.default_stock` | pre-cutover value, and the fallback when Inventory cannot be reached |
| Inventory | `inv_company_settings.default_valuation_method` | **what `ValuationEngine` reads**, for every item carrying no method of its own |

Manage pushed its answer to Books and to nobody else, so a company created as AVG had Books showing WAC while Inventory was still on its schema default of FIFO. Books no longer keeps a writable copy: it forwards every write to Inventory and reads the answer back from there, and Inventory is written first so that Books can only ever be *behind* the master, never ahead of it.

The vocabularies agree — `AVG`, `AVERAGE` and `AVG COST` all mean `WAC` on both sides. An item that carries its own `valuation_method` ignores all three.

## Tables

### Books — retained, still written by Books
`books_voucher_headers` (now with `vch_uuid`), `books_voucher_lines`, `books_voucher_inventory_lines` (commercial fields; `cost_rate`, `cost_amount`, `valuation_method_applied` are written from Inventory's answer; `mc_id`, `unit_id`, `book_qty`, `physical_qty` are frozen for history), `books_voucher_tax_lines`, `books_voucher_service_lines`, `books_voucher_bill_sundry_lines`, `books_credit_note_line_details`, `books_debit_note_line_details`, `books_bills*`, `books_voucher_line_cc_allocations`, `books_voucher_line_subledger_allocations`, GST/TDS/BRS tables, print snapshot tables, `books_inventory_postings`, `books_inventory_events`, `books_inventory_cogs_revisions`.

### Books — the mirror, and why it is gone
The mirror was a transition device, not the end state: a second copy of a master is a second answer, and the contract above says there is only one. It has been retired.

`books_items`, `books_item_units`, `books_item_unit_lines`, `books_item_groups`, `books_stock_categories` and `books_material_centres` were moved into an archive schema (`php spark books:archive-mirror-tables`) once every reader was converted. `books_material_centre_groups`, `books_bom_headers` and `books_bom_lines` are queued behind the same command; run `php spark books:verify-bom-parity` before the BOM pair, since a BOM that exists only in Books never reached Inventory and archiving would be the moment it stopped existing.

Books now reads these masters from Inventory's own endpoints — `InventoryMasterReader` for bulk lookups and decoration, `InventoryBomGateway` for BOM, `InventoryGenericMasterGateway` for `GET /masters/g/{slug}`, which is the only master API the mobile app has. In `INVENTORY_MODE=live` Books' master endpoints answer writes with HTTP 410 and point to Inventory.

The outbox events `inventory.item.upserted`, `inventory.uom.upserted` and `inventory.warehouse.upserted` (and `php spark inventory:resync-masters`) still exist for a database that has not archived yet. Absence of the table is the switch: once archived, Books records them as `ignored / mirror archived` rather than applying them, so archiving disables mirroring by itself and no deploy has to be sequenced against it in either direction.

### Books — frozen after cutover (kept for audit, not deleted, never written)
`books_inventory_cost_layers`, `books_inventory_wac_state`, `books_stock_bucket_balances`, `books_stock_bucket_ledger`, `books_inventory_pending`, `books_inventory_settlement`, `books_voucher_packing_meta`, `books_voucher_packing_lines`, `books_voucher_job_work_lines`, `books_item_fy_openings`, `books_movement_document_snapshots`. Their content was migrated (see `DB_MIGRATION_PLAN.md`). They stay so historical prints, audits and a rollback remain possible.

**Two tables this list used to name are not frozen, and archiving them broke things.** They are Books' own and are still written:

- `books_fy_carryforward` is Books' record of a year-end close — `net_profit`, `ledger_account_count`, `cc_count`, `bill_count`, `opening_vch_txn_id` — of which exactly one column, `stock_item_count`, was ever Inventory's. `YearEndCarryForwardService` inserts the run row unconditionally, so archiving it failed the whole close and took ledgers, cost centres, projects and bills down with the stock. `FyCarryForwardStatus` and `ReportService` read it back.
- `books_item_gst_profile_history` holds the GST profile effective on a given date. GST is Books' domain; the table is merely keyed by `item_id`. `StatutoryProfileResolver` reads it for the rate in force when a voucher was raised and falls back, silently, to the item's rate today when it is absent — which would file a prior-period GSTR-1 at the wrong rate.

`books_voucher_inventory_lines` is not frozen either: it is the commercial line, and voucher-level commercials stay in Books by design.

### Inventory — owned tables (`inv_*`)
Masters: `inv_items`, `inv_item_uoms`, `inv_item_groups`, `inv_stock_categories`, `inv_brands`, `inv_uom`, `inv_warehouses`, `inv_warehouse_groups`, `inv_locations`, `inv_bom_headers`, `inv_bom_lines`, `inv_batches`, `inv_serials`, `inv_item_openings`, `inv_fy_carryforward_status`, `inv_fy_ranges`, `inv_company_settings`, `inv_period_locks`.
Documents and stock: `inv_documents`, `inv_document_lines`, `inv_document_line_serials`, `inv_document_approvals`, `inv_document_snapshots`, `inv_packing_meta`, `inv_stock_movements`, `inv_stock_status_movements`, `inv_stock_balances`, `inv_cost_layers`, `inv_cost_layer_consumptions`, `inv_wac_state`, `inv_pending_quantities`, `inv_pending_settlements`, `inv_reservations`, `inv_valuation_recalc_jobs`, `inv_valuation_revisions`.
Integration and control: `inv_integration_events` (outbox), `inv_inbound_events`, `inv_idempotency_keys`, `inv_reconciliation_runs`, `inv_audit_log`, `inv_access_*`, `inv_legacy_id_map`, `inv_migration_runs`, `inv_sql_migrations`.

## Identifiers

* Books numeric ids are preserved by the migration: `vch_txn_id → inv_documents.document_id`, `inv_line_id → inv_document_lines.line_id`, `item_id`, `unit_id`, `mc_id → warehouse_id`, `item_grp_id`, `stock_cat_id`, `bom_id`, `layer_id`, `item_fy_opening_id → opening_id`. Packing lines are offset by 1 000 000 000 and job-work lines by 2 000 000 000; inception openings by 1 000 000 000. Every migrated row carries `legacy_source_table` + `legacy_source_id`, and `inv_legacy_id_map` records the mapping per migration run.
* Every document and voucher has a UUID, and Books owns it. New vouchers get a random v4 in Books and pass it as `source_document_uuid`; the migration adopts `books_voucher_headers.vch_uuid` wherever the header already carries one, and mints the deterministic v5 (`aicountly:books_voucher_headers:<vch_txn_id>`) only for a header that has none — the same value `php spark books:backfill-vch-uuid` then writes into Books. The two sides must hold the same id; re-running the migration for a company realigns `inv_documents.source_document_uuid` onto `vch_uuid` for documents an earlier run named differently.
* Documents created by Books carry `source_app = books`, `source_document_type = books.sales | books.purchase | books.credit_note | books.debit_note | books.journal`, `source_document_id = vch_txn_id`. A partial unique index guarantees one live inventory document per source document.

## Who may write what

| Actor | Allowed writes |
|---|---|
| Books (service key `books`) | `POST /v1/inventory-documents/post`, `/{id}/reverse`, `/{id}/revise`, `POST /v1/valuation/carry-forward`, reads. |
| Inventory UI users | All masters and native documents, subject to `inv_access_*` permissions. |
| Future apps (POS, Sales, Purchases, Billing) | Same as Books: their own service key, their own `source_app`, documents of the types they own; masters through the Inventory API; accounting through the Books API. Their own tables hold only what neither Books nor Inventory owns. |

Books never writes `inv_*` tables directly and Inventory never writes `books_*` tables directly; the only cross-writes are the COGS/cost copy-back and — for a database that has not archived the mirror yet — the mirror events, both performed by the owning side's API.

## Audit tables

`inv_audit_log` and `inv_access_audit_log`, and Books' audit tables, are **append-only and retained for eight years** — the statutory period. `BEFORE UPDATE` and `BEFORE DELETE` triggers refuse both on every one of them (Inventory migration `007_inventory_audit_append_only.sql`), and `AuditRetentionRegistry::mayPurge()` answers `false` on both sides. The company purge commands name them as retained, so when everything else about a company is archived and removed, its audit rows stay.

The triggers are deliberately row-level and there is no `BEFORE TRUNCATE` trigger: row-level triggers do not fire on `TRUNCATE`, and that is what lets an integration suite reset its schema. Nothing in production truncates them.

Books, which holds millions of rows, splits hot from warm (`books_audit_log` → `books_audit_log_archive`) and lifts its trigger for that one transaction through the `books.allow_audit_archive` GUC. It exists to **move** rows, never to destroy them. Inventory has no such split yet, and therefore no such escape hatch.
