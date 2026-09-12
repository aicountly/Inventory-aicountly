# Inventory API contract (v1)

Base URL: `https://inventory.aicountly.com/api` (sandbox `https://inventory.gh.aicountly.com/api`). Every product — Books today, POS / Sales / Purchases / Billing tomorrow — talks to stock only through this contract. Paths below are relative to the base; the Books-side client appends `/v1/...`.

## Authentication and context

| Caller | Headers |
|---|---|
| A signed-in user (web, mobile) | `Authorization: Bearer <portal ses_key>` (validated at `my.aicountly.com`), `X-Source-App: books|inventory|pos|…` |
| A trusted backend | `X-Service-Key: <key>` where Inventory's `INVENTORY_SERVICE_KEYS = books:<key>,pos:<key>,…`; `X-Actor-Uuid: <user uuid>` for audit; service callers skip document approval. |

Company context on **every** v1 call, as query (GET) or body (others): `cmp_id`, `fy_id`, `bo_id` (0 = consolidated). The session's access to the company is validated against Manage (owner `acs_type=1` bypasses profiles); a wrong or missing context is `400 context_required`. Never trust `cmp_id` from a browser without the session.

Idempotency: `Idempotency-Key` header on `POST …/post`, `/{id}/reverse`, `/{id}/revise`. The same key with the same body replays the stored answer (`duplicate: true`); the same key with a different body is `409 idempotency_conflict`.

## Envelopes

* Single: `{ "data": { … } }` — creates return `201`.
* List: `{ "data": [ … ], "meta": { "total", "limit", "offset", …extra } }`; `limit`, `offset`, `sort`, `order`, `q` are accepted where documented.
* Error: `{ "error": { "code", "message", "details": {…} }, "message" }` with codes `validation_failed` (422), `not_found` (404), `conflict` (409), `forbidden` (403), `negative_stock_blocked` (422), `period_locked` (422), `invalid_state` (409), `context_required` (400), `idempotency_conflict` (409).

## Masters
`GET/POST /v1/items`, `GET/PUT/DELETE /v1/items/{id}`, `GET /v1/items/form-options`, `GET /v1/items/search?q=`, `GET /v1/items/by-barcode/{code}`, `POST /v1/items/bulk-lookup {ids|barcodes}`, `POST /v1/items/bulk-delete`, `GET /v1/items/{id}/stock`, `GET|PUT /v1/items/{id}/openings` (rows `{fy_id, warehouse_id, unit_id, opening_qty, opening_valuation_rate}`; `fy_id 0` = inception).
Item fields: `item_name, item_alias, print_name, item_sku, item_upc, hsn_sac, mrp, unit_id (base), item_grp_id, stock_cat_id, brand_id, valuation_method (FIFO|LIFO|WAC|null=company default), track_batch, track_serial, track_expiry, shelf_life_days, reorder_point, min_stock, max_stock, lead_time_days, books_sales_acc_id, books_purchase_acc_id, books_tax_cat_id, is_active, uoms:[{unit_id, is_default, conversion_factor (base units per 1 of this unit), mc_qty_wise}]`.
Same CRUD shape for `/v1/item-groups`, `/v1/stock-categories`, `/v1/brands`, `/v1/uom`, `/v1/warehouse-groups`, `/v1/warehouses`, `/v1/locations`, `/v1/bill-of-materials` (header + `lines[{item_id, qty, unit_id, line_kind component|by_product|scrap, scrap_percent}]`), `/v1/batches`, `/v1/serials` (+ `POST /v1/serials/bulk`). Deletes are soft and refused (409 `delete_blocked`) while documents reference the row.
`POST /v1/bill-of-materials/{id}/explode {production_qty, warehouse_id?, finished_rate?, document_date?, narration?}` → the ready-to-create PRODUCTION payload (component OUT lines scaled by `production_qty / yield_qty` plus scrap %, by-product IN lines, finished IN line at `finished_rate`, `metadata{bom_id, production_qty, finished_rate, warehouse_id}`). Nothing is saved.

## Availability
`GET /v1/availability?item_id&warehouse_id&batch_id` → `{on_hand, reserved, packed, job_worker, committed, available}`.
`POST /v1/availability/check {lines:[{item_id, warehouse_id, batch_id, qty, unit_id}]}` → per line `{available, shortfall, ok}`.
`GET /v1/stock-balances` → item × warehouse × batch grid.

## Inventory documents
Types (`GET /v1/document-types`): `OPENING_STOCK, STOCK_TRANSFER, STOCK_JOURNAL, PHYSICAL_ADJUSTMENT, WRITE_OFF, WRITE_IN, CONSUMPTION, MATERIAL_ISSUE, MATERIAL_RECEIPT, PRODUCTION, ASSEMBLY, DISASSEMBLY, JOB_WORK_OUT, JOB_WORK_IN, DELIVERY_CHALLAN, INWARD_CHALLAN, PACKING, REVALUATION, LANDED_COST, RESERVATION, RESERVATION_RELEASE, SALES_ISSUE, PURCHASE_RECEIPT, SALES_RETURN, PURCHASE_RETURN, JOURNAL_ADJUSTMENT`.
Statuses: `DRAFT → PENDING_APPROVAL → APPROVED → POSTING → POSTED → PARTIALLY_FULFILLED → COMPLETED`, plus `CANCELLED`, `REVERSED`, `FAILED`. Posted movements are never deleted: a reversal writes compensating movements.

```
POST /v1/inventory-documents            create draft
POST /v1/inventory-documents/post       create + post (service callers; Books)
GET  /v1/inventory-documents            list (type, status, from, to, warehouse_id, item_id, source_app, q)
GET  /v1/inventory-documents/{id}       header + lines (+ valuation, accounting_effects, approvals)
GET  /v1/inventory-documents/by-source?source_app&source_document_type&source_document_id
GET  /v1/inventory-documents/by-uuid/{uuid}
PUT  /v1/inventory-documents/{id}       edit a draft
POST /v1/inventory-documents/{id}/submit | approve | reject | post | cancel
POST /v1/inventory-documents/{id}/reverse   {reason, reversal_date?}
POST /v1/inventory-documents/{id}/revise    reverse + re-create + post in one transaction (body = create payload)
GET  /v1/inventory-documents/{id}/print-snapshot
```
Create payload: `document_type, document_date, document_no?, series_id?, party_ref?, party_name?, from_warehouse_id?, to_warehouse_id?, stock_effect? (on_invoice|from_challan|defer_inward|challan_only|settle_deferred|from_packing), source_app, source_document_type, source_document_id, source_document_uuid, source_document_no, source_document_date, narration, currency_code, exchange_rate, negative_override?, fy_range?, metadata{challan_settlements:[{source_document_id, item_id, qty, warehouse_id}], linked_source_document_id, job_work_settlements:[{pending_id, qty, settlement_type consumed|returned}], bom_id, production_qty, finished_rate, …}, lines:[{source_line_ref, item_id, warehouse_id, unit_id, qty, rate, amount, direction in|out (or dr_cr 1|2 for by-line types), batch_id, serials[], book_qty, physical_qty, tax_cat_id, hsn_sac, description, fc_rate, fc_amount, exchange_rate, valuation_rate?}]`.
Response line fields added by posting: `base_qty, conversion_factor, valuation_rate (per base unit), valuation_amount, valuation_method_applied`. `accounting_effects`: `[{effect: COGS_ISSUE, line_id, item_id, amount, base_qty, valuation_rate}, {effect: STOCK_ADJUSTMENT|STOCK_WRITE_OFF|STOCK_WRITE_IN|OPENING_STOCK|STOCK_REVALUATION|LANDED_COST, amount}]` — Inventory never posts to a ledger; the caller maps effects to accounts.

## Pending quantities, packing, reservations
`GET /v1/pending-quantities?kind=challan|deferred_purchase|job_work&direction&party_ref&status` (open/partial rows with `document_id`, `item_id`, `qty_original`, `qty_settled`).
`GET /v1/packing-lists`, `GET /{id}`, `POST /{id}/unpack | lock | unlock`.
`GET/POST /v1/reservations`, `POST /{id}/release`, `POST /{id}/fulfil`.

## Stock, valuation, reports
`GET /v1/stock-movements`, `GET /v1/stock-ledger?item_id`.
`GET /v1/valuation?as_of&method` (snapshot), `GET /v1/valuation/unit-costs?item_ids&as_of&method`, `GET /v1/valuation/cost-layers?item_id`, `GET|POST /v1/valuation/recalculations`, `POST /{id}/run`, `GET /v1/valuation/revisions`, `POST /v1/valuation/revisions/ack {revision_ids}`, `GET /v1/valuation/carry-forward?source_fy_id&target_fy_id&source_fy_end` (preview + recorded status, no writes), `POST /v1/valuation/carry-forward {source_fy_id, target_fy_id, source_fy_start, source_fy_end, target_fy_start, target_fy_end, bo_id?, overwrite?}` → `{stock_item_count, rows[{item_id, warehouse_id, unit_id, closing_qty, unit_cost, value}], total_value, status, recalc_job_id}` (permission `valuation.carry_forward` or `valuation.recalculate`; 409 `conflict` when the target year already has an opening set and `overwrite` is not true).
`GET /v1/reports/stock-summary | stock-ledger | warehouse-stock | batch-stock | serial-stock | stock-ageing | movement-analysis | near-expiry | replenishment` (filters: `from, to, as_of, item_id, item_grp_id, stock_cat_id, warehouse_id, nonzero, method`).

## Reconciliation, integration, audit, settings, access
`GET /v1/reconciliation`, `POST /v1/reconciliation/run {as_of}`, `GET /{id}`, `GET /v1/reconciliation/posting-status`.
`POST /v1/integration/events` (inbound from Books: `event_uuid, event_type, payload`), `GET /v1/integration/outbox`, `POST /v1/integration/outbox/{id}/replay`, `POST /v1/integration/outbox/dispatch`.
Outbox events emitted: `inventory.document.posted`, `inventory.document.reversed`, `inventory.valuation.revised`, `inventory.item.upserted`, `inventory.uom.upserted`, `inventory.warehouse.upserted`, `inventory.fy.carried_forward`.
`GET /v1/audit-log`, `GET /v1/audit-log/entity/{type}/{id}`.
`GET|PUT /v1/settings` (`default_valuation_method, valuation_scope company|warehouse, negative_stock_policy allow|block|warn, approval_required, cogs_revision_mode`), `GET|POST|DELETE /v1/settings/period-locks`.
`GET /v1/access/me | check | permissions | profiles | members`, `POST /v1/access/profiles | members | members/provision`, `PUT …`, `DELETE …`.

## Compatibility rules for new products
1. Send `source_app`, `source_document_type` (`<app>.<doc>`), `source_document_id` and `source_document_uuid` on every document you create; that is your idempotency and your reconciliation key.
2. Keep commercial values in your own or Books' tables; send them as `rate`/`amount` so Inventory can store the source value — but treat `valuation_*` as the only cost.
3. Never write `inv_*` tables; never cache stock balances longer than a request — call availability.
4. Map `accounting_effects` to ledgers through Books' API; Inventory will not.
5. Breaking changes ship as `/v2`; `/v1` stays.
