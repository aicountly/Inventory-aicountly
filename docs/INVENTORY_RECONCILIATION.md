# Inventory ↔ Books reconciliation

Runs in Inventory (`POST /v1/reconciliation/run {as_of}`, screen *Reconciliation*), persisted in `inv_reconciliation_runs`. It answers one question per company/FY/branch: **does the stock value Inventory holds equal the Stock-in-Hand balance Books' ledger holds, and if not, why?**

## Inputs
* Inventory closing stock value and quantity as of the date (`ValuationReplayService::snapshot`, AS_PER_MASTER).
* Books: `GET integration/inventory/stock-ledger-balance?cmp_id&fy_id&bo_id&as_of` → `{balance, opening_balance, pending_postings[], failed_postings[], manual_journals[], revaluations[], cancelled_reversed[]}` (Stock-in-Hand ledger and the `books_inventory_postings` tracker).
* Books: `GET integration/inventory/posting-status` → every voucher with item lines and its composite state.

## Buckets (sign = contribution to *inventory − books*)
| Bucket | Meaning |
|---|---|
| `opening_difference` | Inventory opening value − Books opening balance |
| `pending_posting` | Books vouchers whose stock side is still `INVENTORY_PENDING` (deferred mode) |
| `failed_posting` | documents `FAILED` |
| `cancelled_reversed` | documents reversed in Inventory while the Books voucher is still posted, or vice versa |
| `unacknowledged_valuation_revisions` | COGS revisions Books has not applied yet |
| `revaluation` | Inventory revaluation documents vs Books revaluation journals |
| `manual_journal` | manual journals on Stock-in-Hand in Books |
| `valuation_method_variance` | closing valuation (cost-layer replay, FIFO/LIFO/WAC, negative stock priced at last cost) − (opening + Σ movement values); a costing effect, not a missing posting |
| `transfer_valuation_gap` | stock transfers whose receiving side is not valued at the issuing cost — only history migrated from Books, which valued the receiving side at 0 |
| `missing_source` | Books vouchers with item lines and no inventory document |
| `rounding` / `unexplained` | residual below 1.00 / above |

`difference = Σ buckets + rounding + unexplained`. A run is clean when `unexplained = 0`. A reversed document whose Books voucher is also cancelled contributes nothing (both sides dropped it).

Rehearsal result (company 9001, FY 7102, after live postings, a cancel and an edit): difference 1 402 151.09 = opening_difference 1 406 898.29 (the rehearsal never posted an opening-stock journal in Books) + valuation_method_variance −2 930.70 + transfer_valuation_gap −1 816.50 (two migrated transfers Books valued at 0 on the receiving side), unexplained 0.00.

## Composite posting status
`IN_SYNC`, `PENDING_INVENTORY`, `FAILED_INVENTORY`, `REVERSED_INVENTORY`, `CANCELLED_BOTH`, `CANCELLED_IN_BOOKS`, `MISSING_IN_BOOKS`, `PENDING_IN_BOOKS`, `FAILED_IN_BOOKS`, `MISSING_IN_INVENTORY`, `BOOKS_UNAVAILABLE`. Anything but `IN_SYNC` / `CANCELLED_BOTH` has a fix:

| Status | Fix |
|---|---|
| `PENDING_INVENTORY` | `php spark books:inventory-retry` (cron) |
| `FAILED_INVENTORY` | read `last_error` in `books_inventory_postings`; fix the cause (stock, locked period), then `books:inventory-retry --vch <id> --cmp <cmp> --resync` |
| `REVERSED_INVENTORY` | someone reversed the document in Inventory; cancel the Books voucher or `--resync` to re-post |
| `MISSING_IN_INVENTORY` | voucher posted while Books was in legacy mode → `--resync` |
| `MISSING_IN_BOOKS` | an Inventory document claims a Books source that does not exist → reverse it in Inventory |
| ledger differs although statuses are `IN_SYNC` | `php spark books:inventory-retry --refresh-costs --cmp <cmp> [--fy <fy>]` copies the current Inventory valuation onto the item lines and rewrites the COGS pairs (idempotent; the authoritative repair). `--repair-cogs` only re-derives the pairs from the item-line costs Books already holds. |

## Schedule
Nightly per active company (Inventory cron: `php spark inventory:reconcile --all` if scheduled, otherwise the *Run now* button) and after every cutover / restore. Results are kept; the dashboard shows the last run's `unexplained`.
