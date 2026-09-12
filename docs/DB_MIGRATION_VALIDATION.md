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
| `books_snapshot` | `books:export-inventory-snapshot` JSON (Books' StockBalanceService closing quantities and StockValuationService values, per company/FY, as-of FY end) | `ValuationReplayService::snapshot` (same date, AS_PER_MASTER) | per item: qty equal and value equal, **or** the qty difference equals the sum of challan_only / deferred-inward lines Books counted twice (listed with voucher numbers) → warning "explained", **or** (matching qty, differing unit cost only) every mismatched line is a stock-transfer receiving layer Books valued at zero cost (listed with voucher numbers) → warning "explained" |

## Rehearsal evidence (local PostgreSQL 16, 4 companies × 2 FYs, FIFO / WAC / LIFO)
* 272 vouchers, 597 lines, 284 cost layers, 501 movements migrated; dry run and real run identical.
* All sections equal; `stock_rebuild` 0 differences for 68 item/warehouse keys; an independent SQL walk written outside the tool agreed for all 68 items.
* `books_snapshot`: the year after a carry-forward (only invoices) matched Books **exactly** in quantity and value for every item and every method; the first year differed only on items with challan/deferred flows, each difference fully attributed (residual 0.0000).
* Re-running `migrate` inserts nothing new; `rollback --yes` removed every row (0 left) and a fresh migration validated again.

## Sequence / orphan / duplicate checks
* Orphans (precheck, blocking): inventory lines without header, without item, items with `cmp_id 0`. Non-blocking: lines without unit, headers without lines for line-bearing types.
* Duplicates (precheck): live items/units/warehouses with the same name per company, duplicate item+unit lines, multiple default units, duplicate WAC rows.
* Sequences: names from `pg_get_serial_sequence`; after reset a `nextval` probe is reserved and read back for every table. Two columns are not a plain `MAX(column)`: `inv_document_lines.line_id` and `inv_item_openings.opening_id` also hold ids from the permanently reserved synthetic offset ranges (`TableMap::LINE_ID_OFFSET_PACKING`/`_JOB_WORK`, `OPENING_ID_OFFSET_INCEPTION`, all 1,000,000,000+) that place migrated packing/job-work lines and inception openings without colliding with organic ids. The reset computes the ceiling **below** the lowest reserved offset for those two columns specifically, so a company migrated into that range never poisons the sequence for rows created afterwards, or for a later batch's own reserved range for a different company.

## Stock rebuild test
`inv_stock_balances.on_hand_qty` is materialised from `inv_item_openings` (FY rule) + `inv_stock_movements`. The validator rebuilds it independently (StockBalanceService::closingQuantities) and compares, then compares the same figures with a walk over Books' tables using Books' rules. Both must agree to 0.0001.

## Live-mode rehearsal (after cutover, same databases)
With `INVENTORY_MODE=live` and both APIs running locally, Books posted purchases, sales, a credit note and a debit note through Inventory (composite states `COMPLETED`), cancelled a sales invoice (stock document `REVERSED`), edited a posted invoice in place (Inventory `revise`: old document `REVERSED`, replacement `POSTED`, Books COGS pair rewritten), posted with Inventory stopped in `deferred` mode (`INVENTORY_PENDING`, completed by `books:inventory-retry` with cost and COGS applied) and in `strict` mode (no voucher written, drafts left for retry), delivered outbox events (document posted / reversed, 54 valuation revisions from a back-dated recalculation) and ran `inventory:reconcile`, which explained the whole Books ↔ Inventory difference (unexplained 0.00).

Defects the rehearsal caught before any production data was touched, all fixed on this branch:
* the revision event used `old_/new_valuation_amount` while the Books handler read `previous_/revised_amount` (it would have zeroed COGS pairs) — handler normalises both and refuses to apply a revision without an amount; `books:inventory-retry --refresh-costs` repairs from Inventory's current valuation;
* a recalculation revised lines but not the document's stored accounting effects;
* reconciliation double-counted reversed documents whose Books voucher was cancelled or replaced, and inline COGS revisions reported as revaluations;
* the migrator would have replaced a company that already had live documents — it now refuses.

## Second rehearsal round (batch-to-batch and post-cutover), 2026-09-12
Re-run fresh, specifically to catch what a single-shot rehearsal cannot: two more companies (9101, 9102) seeded and migrated in a second batch on top of the already-migrated, already-cutover 9001–9004, then the full precheck → dry-run migrate → migrate → validate → cutover → postcheck → rollback drill → re-migrate → re-validate cycle repeated end to end.

Defects the second batch caught, both fixed on this branch (see `SequenceResetter.php`, `Validator.php`):
* dry-run migrate of company 9101 failed with `duplicate key value violates unique constraint "inv_document_lines_pkey" ... Key (line_id)=(2000000019) already exists` — the sequence reset had used a plain `MAX(line_id)` with no ceiling, so once any row occupied the reserved job-work offset range the sequence was reset into that range instead of the true organic high-water mark, and every row created afterwards (including this second batch's own migrated lines) allocated ids inside space reserved for a different company's packing/job-work lines. Fixed by excluding each reserved range from the ceiling computation; regression-covered by `tests/integration/SequenceResetterOffsetTest.php`.
* a fresh `validate` on the new companies reported 3 items with matching quantity but mismatched unit cost — traced to a pre-existing, already-documented Books gap (stock-transfer receiving-side cost layers stored at `unit_cost=0` despite a real, non-zero line `cost_rate`; see `ReconciliationService::transferValuationGap()`). Validator now recognises the pattern and moves these into `explained_value_diffs` with a `value_explanation`, rather than failing validate on an already-known, non-migration gap.

An operational lesson from the same drill, not a code defect: rollback was first run with the wrong `--run-id` — the id `validate`/`cutover` had themselves auto-generated by omitting `--run-id` (the command silently defaults to `date('Ymd-His')` when it is not passed), not the id `migrate` actually used. The command printed `ROLLBACK complete` and exited 0, but 0 rows were affected because no row in `inv_legacy_id_map` matched that run-id. Caught by checking row counts immediately after rollback rather than trusting the success message, then re-run with the correct id (queried from `inv_legacy_id_map`'s own `migration_run_id` grouping), which then correctly zeroed every row. **Capture the run-id `migrate` prints (or that you passed it) once, in a file, and pass that exact value with `--run-id=` on every subsequent `validate`/`cutover`/`postcheck`/`rollback` for that batch — never omit it and never reuse a different stage's own auto-generated id.** See `DB_MIGRATION_RUNBOOK.md` and `ROLLBACK_PLAN.md` for the same warning at the point of use.

With both fixes in place the full cycle ran clean across all 6 companies (9001–9004, 9101–9102): zero unexplained differences in any section, rollback drill removed exactly the rows it should and re-migrating/re-validating reproduced the same clean result.
