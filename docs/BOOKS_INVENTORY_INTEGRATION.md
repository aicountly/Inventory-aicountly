# Books ↔ Inventory integration

## Modes

| Setting (Books `.env`) | Values | Meaning |
|---|---|---|
| `INVENTORY_MODE` | `legacy` (default) / `live` | `legacy`: Books values stock itself (pre-cutover behaviour, unchanged). `live`: Books hands item lines to Inventory; pure inventory vouchers are refused with HTTP 410. Flipped once, at cutover. |
| `INVENTORY_POSTING_MODE` | `strict` (default) / `deferred` | What happens when Inventory is unreachable. `strict`: the voucher is not posted (transaction rolled back, user retries). `deferred`: the voucher posts without COGS, the request is queued (`INVENTORY_PENDING`) and `php spark books:inventory-retry` completes it. A 4xx answer (validation, negative stock, locked period) always fails the voucher. |
| `INVENTORY_COGS_REVISION_MODE` | `inline` (default) / `adjustment` | How a back-dated valuation change reaches the ledger: rewrite the voucher's own COGS pair, or post one system journal (`COGS-REV/…`) for the delta. |
| `INVENTORY_API_BASE`, `INVENTORY_SERVICE_KEY`, `INVENTORY_INBOUND_SERVICE_KEY`, `INVENTORY_API_TIMEOUT` | | Transport. The outbound key must appear as `books:<key>` in Inventory's `INVENTORY_SERVICE_KEYS`; the inbound key is Inventory's `BOOKS_SERVICE_KEY`. |

## The composite transaction (posting a voucher with item lines)

```
Books postDraft()                                   Inventory
──────────────────────────────────────────────────  ─────────────────────────────────────────────
BEGIN
  insert books_voucher_headers (vch_uuid)
  tracker: BOOKS_POSTED (request kept)
  POST /v1/inventory-documents/post  ───────────▶   validate, value (FIFO/LIFO/WAC), move stock,
     Idempotency-Key: books:<cmp>:<vch>:post:<hash>   settle pending, COGS effects, outbox event
  ◀──────────────────────────────────────────────   201 {document, lines[valuation], accounting_effects}
  tracker: INVENTORY_POSTED
  journal lines + COGS pairs ("COGS — item", "Stock issue — item #id")
  item lines with cost_rate / cost_amount / method copied from Inventory
COMMIT ─▶ tracker: COMPLETED
```

Failure handling, in order:
1. Inventory rejects (4xx) → Books rolls back, tracker `FAILED`, the user sees Inventory's reason (insufficient stock, locked period, …).
2. Inventory unreachable → `strict`: rolled back, tracker `FAILED`; `deferred`: committed, tracker `INVENTORY_PENDING`, retried with back-off.
3. Books fails after Inventory posted (rare: constraint, disk) → Books rolls back and **compensates**: reverses the inventory document, tracker `FAILED` with the reason. Nothing is silently lost.
4. Retried request with the same idempotency key → Inventory replays the earlier answer; a second live document for the same `source_document_id` is impossible (partial unique index `uq_inv_documents_source`).

Cancellation: `VoucherCancelService` reverses the inventory document inside the cancel transaction (`REVERSAL_PENDING → REVERSED`). A refusal from Inventory keeps the voucher posted.

In-place edit (`updatePostedCommercialVoucher`): Books calls `POST /v1/inventory-documents/{id}/revise`, which reverses the old document and posts the replacement in **one** Inventory transaction; if Books then fails to commit, it revises back to the previous request (kept on the tracker). Repair for anything that still went wrong: `php spark books:inventory-retry --vch <id> --cmp <cmp> --resync`.

## States

`PENDING → BOOKS_POSTED → INVENTORY_PENDING → INVENTORY_POSTED → COMPLETED`, plus `FAILED`, `REVERSAL_PENDING`, `REVERSED`. Table `books_inventory_postings` (one row per voucher, `action` = post | reverse | revise, `attempts`, `next_retry_at`, `last_error`, request/response JSON). `GET integration/inventory/posting-status` exposes these to Inventory's reconciliation.

## Events (Inventory outbox → Books)

`POST integration/inventory/events` (X-Service-Key), idempotent on `event_id` (`books_inventory_events`):

| Event | Books action |
|---|---|
| `inventory.document.posted` | Deferred voucher completed: copy valuation, add COGS pairs, tracker `COMPLETED`. Already complete → no-op. |
| `inventory.document.reversed` | Record `REVERSED`; if the Books voucher is still posted it shows as `REVERSED_INVENTORY` in reconciliation. |
| `inventory.valuation.revised` | Apply COGS deltas per `INVENTORY_COGS_REVISION_MODE`; audit rows in `books_inventory_cogs_revisions`. |
| `inventory.item.upserted` / `inventory.uom.upserted` / `inventory.warehouse.upserted` | Upsert the read-only mirror rows. |

Books → Inventory events (`POST /v1/integration/events`): `books.voucher.cancelled`, `books.valuation_revision.acknowledged`, `books.company.default_stock`.

## What Books no longer does in live mode
* Value stock, keep cost layers or WAC state, maintain buckets/pending/settlements.
* Accept stock transfer, stock journal, physical stock, production, job work, packing, delivery/inward challan vouchers (HTTP 410 → Inventory app).
* Create or edit items, units, warehouses, item groups, stock categories, BOM (HTTP 410 → Inventory app; the mirror stays readable).
* Compute the Items module of the year-end carry-forward (it calls `POST /v1/valuation/carry-forward`).

## Reconciliation
Inventory's `POST /v1/reconciliation/run` compares its closing stock value with Books' Stock-in-Hand ledger balance (`GET integration/inventory/stock-ledger-balance`) and explains the difference by bucket (opening, pending postings, failed postings, reversed documents, unacknowledged revisions, revaluations, manual journals, missing sources). See `INVENTORY_RECONCILIATION.md`.

## Cron
* Inventory: `php spark inventory:outbox-dispatch` (every minute), `php spark inventory:recalc-worker` (every minute), `php spark inventory:rebuild-balances` (nightly, optional).
* Books: `php spark books:inventory-retry` (every minute; a no-op unless something is queued).
