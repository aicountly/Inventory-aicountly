# Migration validation — what is proven, how, and what fails the run

`php spark inventory:migrate-books --stage=validate --run-id=<id> [--books-snapshot=DIR] [--tolerance=0.01] [--company=…]`

Every section below is written to `validate.summary.json`; a difference outside tolerance (quantities 0.0001, money 0.01) adds a `failures[]` entry and the stage exits non-zero. Warnings never block but must be read.

| Section | Source (Books, read-only) | Destination (Inventory) | Pass condition |
|---|---|---|---|
| `row_counts` | masters: rows, rows per company, max PK | same | equal rows and per-company split; destination max PK ≥ source |
| `voucher_counts` | item-bearing headers by `type:status`, by `cmp:fy`; inventory lines by company | documents / lines with `legacy_source_table` | equal |
| `movement_totals` | per cmp/fy: in/out qty, in/out source amount, in/out valuation, line count, direction by Books' classifier rule, excluding cancelled and non-moving lines | `inv_stock_movements` | equal |
| `opening_totals`, `fy_opening_totals` | unit-line inception openings; `books_item_fy_openings` | `inv_item_openings` fy 0 / fy > 0 | equal qty, value, (fy) line count |
| `cost_layers`, `wac_state` | rows, qty remaining, value remaining; WAC qty/value | same | equal |
| `pending` | rows, qty original/settled by kind/direction/status | same | equal |
| `buckets` | packed / job-worker qty per item+unit+mc in base units | `inv_stock_balances` packed/job_worker | equal per key |
| `financial_unchanged` | ledger debit/credit per cmp/fy, COGS journal totals, bills, CC/sub-ledger allocations | — | recorded; compare with `precheck.summary.json` of the same run: must be byte-identical |
| `destination_integrity` | — | lines without document/item/unit/warehouse, documents with unknown type or zero company, movements without line, items with unknown base unit, cross-company references, duplicate source documents, duplicate legacy map rows, lines unaccounted | all zero |
| `sequences` | — | every `inv_*` sequence ≥ max id; probe; duplicate PKs | ok |
| `stock_rebuild` | Books closing per item for the latest FY (openings + movements, Books' direction rule, base units) | (a) `inv_stock_balances.on_hand` vs a fresh walk of openings + movements; (b) Inventory walk vs Books walk | no differing item/warehouse |
| `valuation_vs_books` | — | Inventory's AS_PER_MASTER closing value/qty per company | recorded |
| `books_snapshot` | `books:export-inventory-snapshot` JSON (Books' StockBalanceService closing quantities and StockValuationService values, per company/FY, as-of FY end) | `ValuationReplayService::snapshot` (same date, AS_PER_MASTER) | per item: qty equal and value equal, **or** the qty difference equals the sum of challan_only / deferred-inward lines Books counted twice (listed with voucher numbers) → warning "explained" |

## Rehearsal evidence (local PostgreSQL 16, 4 companies × 2 FYs, FIFO / WAC / LIFO)
* 272 vouchers, 597 lines, 284 cost layers, 501 movements migrated; dry run and real run identical.
* All sections equal; `stock_rebuild` 0 differences for 68 item/warehouse keys; an independent SQL walk written outside the tool agreed for all 68 items.
* `books_snapshot`: the year after a carry-forward (only invoices) matched Books **exactly** in quantity and value for every item and every method; the first year differed only on items with challan/deferred flows, each difference fully attributed (residual 0.0000).
* Re-running `migrate` inserts nothing new; `rollback --yes` removed every row (0 left) and a fresh migration validated again.

## Sequence / orphan / duplicate checks
* Orphans (precheck, blocking): inventory lines without header, without item, items with `cmp_id 0`. Non-blocking: lines without unit, headers without lines for line-bearing types.
* Duplicates (precheck): live items/units/warehouses with the same name per company, duplicate item+unit lines, multiple default units, duplicate WAC rows.
* Sequences: names from `pg_get_serial_sequence`; after reset a `nextval` probe is reserved and read back for every table.

## Stock rebuild test
`inv_stock_balances.on_hand_qty` is materialised from `inv_item_openings` (FY rule) + `inv_stock_movements`. The validator rebuilds it independently (StockBalanceService::closingQuantities) and compares, then compares the same figures with a walk over Books' tables using Books' rules. Both must agree to 0.0001.
