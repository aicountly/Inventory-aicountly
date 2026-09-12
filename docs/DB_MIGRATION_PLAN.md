# Books → Inventory data migration plan

**Production data. Integrity over speed.** Nothing in this plan writes to the Books database: the migration reads Books (read-only connection, `SET default_transaction_read_only = on`) and writes the new Inventory database. Books' inventory tables are frozen at cutover, never deleted.

## Scope

| Books source | Inventory target | Rule |
|---|---|---|
| `books_item_groups`, `books_stock_categories`, `books_item_units`, `books_material_centre_groups`, `books_material_centres`, `books_items`, `books_item_unit_lines` (unit/conversion columns), `books_bom_headers`, `books_bom_lines` | `inv_item_groups`, `inv_stock_categories`, `inv_uom`, `inv_warehouse_groups`, `inv_warehouses`, `inv_items`, `inv_item_uoms`, `inv_bom_headers`, `inv_bom_lines` | Numeric PK preserved; `legacy_source_table/id` + `inv_legacy_id_map`; `sales_acc_id/purchase_acc_id/tax_cat_id → books_*` reference columns; `valuation_method` normalised (AVG→WAC, default from `books_company_settings.default_stock`). |
| `books_item_unit_lines.opening_qty/opening_rate` | `inv_item_openings` (`fy_id 0`, `source_kind master_inception`, `opening_id = 1e9 + item_unit_line_id`) | Duplicate item+unit rows merged with a warning. |
| `books_item_fy_openings` | `inv_item_openings` (`fy_id = year`, `source_kind carry_forward`, id preserved) | Books' rule kept: a year that was closed into uses its carried openings even when empty (`inv_fy_carryforward_status`). |
| `books_fy_carryforward` | `inv_fy_carryforward_status` | Only runs that carried the Items module count. |
| `books_voucher_headers` (item-bearing types 2,3,4,5,6,7,10,11,14,15,18,20,23,24) | `inv_documents` (`document_id = vch_txn_id`, deterministic `document_uuid` and `source_document_uuid`, `source_app books`, `source_document_type books.<code>`, status posted→POSTED / cancelled→CANCELLED, header inventory columns, production/transport metadata) | Commercial vouchers stay in Books too — the document is the stock side of the same voucher. |
| `books_voucher_inventory_lines` | `inv_document_lines` (`line_id = inv_line_id`; `source_transaction_rate/amount` = rate/amount; `valuation_rate/amount/method` = cost_*; direction by Books' rule: types 15,20,10,14,6 from `dr_cr`, 11/2/24 in, 18/3/23/7 out; `base_qty` from the unit's conversion factor) | Lines stay in Books as commercial lines. |
| `books_voucher_packing_lines`, `books_voucher_job_work_lines`, `books_voucher_packing_meta` | `inv_document_lines` (ids offset 1e9 / 2e9), `inv_packing_meta` | |
| `books_inventory_cost_layers`, `books_inventory_wac_state` | `inv_cost_layers` (`layer_kind opening|receipt|backorder`), `inv_wac_state` (`warehouse_id 0`) | Copied 1:1 — the valuation position at cutover is Books' position. |
| `books_stock_bucket_balances`, `books_stock_bucket_ledger` | `inv_stock_balances` (packed / job-worker buckets, base units), `inv_stock_status_movements` | `balance_id` re-issued; Books id in `legacy_source_id`. |
| `books_inventory_pending`, `books_inventory_settlement` | `inv_pending_quantities`, `inv_pending_settlements` | ids preserved. |
| `books_movement_document_snapshots` | `inv_document_snapshots` | for historical prints. |
| Derived: none in Books | `inv_stock_movements` (one per posted line that physically moved stock — challan_only challans, deferred purchases, job-work out and packing excluded), `inv_stock_balances.on_hand_qty` (rebuilt from openings + movements of the latest FY) | Rebuilt, then proven equal to Books' walk. |

Retained in Books, untouched: everything financial (`books_voucher_lines`, tax lines, bills, allocations, GST, TDS, BRS, snapshots for invoices/notes).

## Stages (`php spark inventory:migrate-books --stage=<stage> --run-id=<id>`)

| Stage | What it does | Writes |
|---|---|---|
| `precheck` | Required/optional Books tables and columns, sequences vs max ids, row counts per company, control totals baseline, orphan checks (blocking: lines without header/item, items without company), duplicate checks, consistency findings (`dr_cr` contradicting the voucher type, lines without unit). Fails on blocking findings. | logs only |
| `migrate [--dry-run] [--company=…] [--replace]` | One transaction per company; every failure throws (`transException`), the company is rolled back and reported. `--dry-run` rolls back at the end. `--replace` deletes a company's earlier migrated rows first (rehearsal only). Refuses a company that already has live (non-migrated) Inventory documents. Resets sequences afterwards. | Inventory DB |
| `validate` (`postcheck` is the same after cutover) | See `DB_MIGRATION_VALIDATION.md`. Fails on any unexplained difference. `--books-snapshot=DIR` compares with Books' own reports. | logs only |
| `sequences [--dry-run]` | `setval` for every `inv_*` sequence to `max(id)` via `pg_get_serial_sequence`, then probes each by reserving and reading back `nextval`. | sequences |
| `cutover` | `validate` + `sequences` + a row in `inv_migration_runs`. | marker row |
| `rollback --yes` | Deletes everything the run wrote (by `inv_legacy_id_map.migration_run_id` and company), resets sequences. Books is untouched. | Inventory DB |

Every stage writes `writable/migration/<run-id>/<stage>.jsonl` (one JSON event per line) and `<stage>.summary.json`.

## Id and sequence policy
* Preserved PKs mean the Inventory sequences start below existing ids after the copy; the `sequences` stage (and `migrate` itself) advances every sequence to `max(id)` and proves `nextval` works. Sequence names are derived (`pg_get_serial_sequence`), never hard-coded.
* Deterministic UUIDs (`aicountly:<table>:<id>`, v5) make a re-run produce identical ids, and `books:backfill-vch-uuid` writes the same value into Books.

## Volumes and timing
The rehearsal (4 companies, 272 vouchers, 597 lines) migrates in under a second per company; the copy is batched (500 rows per insert, 200 documents per flush). For ~100 companies and 5–10 lakh rows plan for minutes, not hours; run `migrate --dry-run` on a restored production backup to get the real number before the cutover window.

## Known, documented differences
Books' stock-quantity reports count every stored item line, so a delivery challan (`challan_only`) **and** the invoice raised from it both reduce reported stock, and a deferred-inward purchase **and** its inward challan both add it. Books' valuation engine and Inventory count each physical movement once. The validator attributes every such difference line by line (`explained_qty_diffs`, residual 0) and warns instead of failing. Carried-forward FY openings are copied exactly as Books computed them (they are what the accounts used); a later restatement is an explicit, approved job, not part of the migration.
