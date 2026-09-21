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
Item fields: `item_name, item_alias, print_name, item_sku, item_upc, hsn_sac, mrp, unit_id (base), item_grp_id, stock_cat_id, brand_id, valuation_method (FIFO|LIFO|WAC|null=company default), track_batch, track_serial, track_expiry, shelf_life_days, reorder_point, min_stock, max_stock, lead_time_days, books_sales_acc_id, books_purchase_acc_id, books_tax_cat_id, itc_eligibility, is_active, uoms:[{unit_id, is_default, conversion_factor (base units per 1 of this unit), mc_qty_wise}]`.

#### `itc_eligibility` — an attribute of the goods
`inherit | claim | block`, default `inherit`. Returned by `GET /v1/items`, `GET /v1/items/{id}`, `GET /v1/items/search`, `POST /v1/items/bulk-lookup` and the `inventory.item.upserted` outbox event; settable on `POST`/`PUT /v1/items`, and offered as `itc_eligibility_options` on `GET /v1/items/form-options`. A value outside the three is `422` — it is **not** coerced, because a near-miss silently becoming `inherit` would leave a caller believing the item blocks a credit that is still being claimed.

**What it is.** A fact about the goods — this thing is a motor vehicle, this thing is a food and beverage — which is why it lives on the item master and travels with the item rather than being retyped on every voucher. `claim` marks an item whose input tax is ordinarily recoverable; `block` marks one whose input tax ordinarily is not; `inherit` means the item says nothing.

**What it is not.** Inventory makes **no tax determination** from it. It computes no tax consequence, applies no precedence against a tax category / purchase ledger / voucher line, and has no "default claimable" fallback. It stores the attribute and reports it. The reading product — Books — resolves it against its own tax category (where the same attribute exists at category level), the purchase ledger and the voucher line, and books the result. One implementation of that precedence, in the product that files the return: two would be two answers to the same question. Nothing in Inventory reads this column to decide anything, and no valuation, movement or landed cost depends on it.
Same CRUD shape for `/v1/item-groups`, `/v1/stock-categories`, `/v1/brands`, `/v1/uom`, `/v1/warehouse-groups`, `/v1/warehouses`, `/v1/locations`, `/v1/bill-of-materials` (header + `lines[{item_id, qty, unit_id, line_kind component|by_product|scrap, scrap_percent}]`), `/v1/batches`, `/v1/serials` (+ `POST /v1/serials/bulk`). Deletes are soft and refused (409 `delete_blocked`) while documents reference the row.
Warehouse group fields: `grp_name` (required, unique per company), `grp_code` (optional, ≤32 chars, upper-cased and unique per company case-insensitively — `409 conflict` with `details.field = grp_code`), `description` (≤500 chars), `parent_grp_id` (self-referencing; a cycle or self-parent is `422`), `is_active`. `GET /v1/warehouse-groups` decorates each row with `warehouse_count` (warehouses naming the group), `child_count` (sub-groups) and `created_by_name` / `updated_by_name` (the company member's display name for the actor uuid, `null` for a service key or a CLI job). `q` searches name, code and description; `has_warehouses=1|0` keeps groups that hold warehouses, or the empty ones. The delete is refused (409 `delete_blocked`) while either count is non-zero, so a warehouse is never orphaned.

#### Brands — two extra reads
`GET /v1/brands` additionally accepts `created_from` / `created_to` (`YYYY-MM-DD`, inclusive at both ends), `has_items` (`1` only brands something is filed under, `0` only brands with none) and `sort=item_count`; `q` searches name, alias, code and description. Every row carries `item_count`, counted for the whole page in one grouped query. Brand fields: `brand_name, brand_alias, brand_code (unique per company, case-insensitive, where given), description, is_active`.

`GET /v1/brands/metrics` → `{total, active, inactive, new_this_month, new_prev_month, without_items, with_items, top_by_items{brand_id, brand_name, item_count}|null, as_of}`. Counted over the whole company, NOT over the caller's filters: these are the figures above the list, and a reader who searches or turns a page must not watch them move.

`GET /v1/brands/sales` → `{available, reason, currency, rows[{brand_id, sales, trend[]|null}]}`. A **relay**, not a store: Inventory holds no turnover for a brand and this endpoint creates none — it asks Books (`integration/inventory/brand-sales`) for the company / FY / branch on screen and hands the answer back. It answers `200` whether or not Books could be reached, with `available:false` and a `reason` of `not_configured` (the relay is switched off), `not_implemented` (Books does not serve the path yet) or `unavailable`. Nothing is written and nothing is cached across requests.

#### Batches — filters, figures and a bulk status
`GET /v1/batches` adds, on top of the shared list parameters (`q` sweeps batch no / lot no / item name / SKU):
`item_id`, `item_grp_id`, `stock_cat_id`, `brand_id`, `lot_no`, `status` (comma-separated, from `active|quarantine|recalled|expired|closed`), `expiring_before`, `expiry_from`, `expiry_to`, `mfg_from`, `mfg_to`, `has_expiry=1|0`, `in_warehouse_id` (batches with a balance row in that warehouse), `stock=with|zero`, `warehouse_id` (scopes the stock figures, never the rows), `with_stock=1` (adds `stock{on_hand, reserved, available}`, `warehouses[{warehouse_id, warehouse_name, warehouse_code, on_hand}]` and `warehouse_count`), and `health` (comma-separated, from `active|expiring|expired|inactive`). Sortable on `batch_no, lot_no, item_name, mfg_date, expiry_date, status, on_hand, created_at, updated_at`.

`health` is **derived, never stored**: `expired` is an expiry date in the past or the `expired` status; then `inactive` for `quarantine|recalled|closed`; then `expiring` inside the `near_expiry_days` window (default 30); everything else is `active`. The four are mutually exclusive and exhaust the set.

`GET /v1/batches/summary` takes the same filters (paging is ignored) and returns `{total, active, expiring_soon, expired, inactive, total_on_hand, with_stock, zero_stock, previous_total, comparison_days, near_expiry_days, by_status{}, expiry_buckets{expired, within_30, days_31_90, days_91_180, beyond_180, no_expiry}}`. `previous_total` is how many of the matching batches already existed `comparison_days` ago.

`POST /v1/batches/bulk-update {batch_ids:[…], status}` sets one status across a selection (max 500) in a single transaction, writing one `batch.bulk_update` audit entry per batch that actually changed → `{updated, unchanged, status, batch_ids}`.

`POST /v1/bill-of-materials/{id}/explode {production_qty, warehouse_id?, finished_rate?, document_date?, narration?}` → the ready-to-create PRODUCTION payload (component OUT lines scaled by `production_qty / yield_qty` plus scrap %, by-product IN lines, finished IN line at `finished_rate`, `metadata{bom_id, production_qty, finished_rate, warehouse_id}`). Nothing is saved.

## Availability
`GET /v1/availability?item_id&warehouse_id&batch_id` → `{on_hand, reserved, packed, job_worker, committed, available}`.
`POST /v1/availability/check {lines:[{item_id, warehouse_id, batch_id, qty, unit_id}]}` → per line `{available, shortfall, ok}`.
`GET /v1/stock-balances` → item × warehouse × batch grid.

## Inventory documents
Types (`GET /v1/document-types`): `OPENING_STOCK, STOCK_TRANSFER, STOCK_JOURNAL, PHYSICAL_ADJUSTMENT, WRITE_OFF, WRITE_IN, CONSUMPTION, MATERIAL_ISSUE, MATERIAL_RECEIPT, PRODUCTION, ASSEMBLY, DISASSEMBLY, JOB_WORK_OUT, JOB_WORK_IN, BATCH_ADJUSTMENT, SERIAL_ADJUSTMENT, DELIVERY_CHALLAN, INWARD_CHALLAN, PACKING, REVALUATION, LANDED_COST, RESERVATION, RESERVATION_RELEASE, SALES_ISSUE, PURCHASE_RECEIPT, SALES_RETURN, PURCHASE_RETURN, JOURNAL_ADJUSTMENT`.
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
Create payload: `document_type, document_date, document_no?, series_id?, party_ref?, party_name?, from_warehouse_id?, to_warehouse_id?, stock_effect? (on_invoice|from_challan|defer_inward|challan_only|settle_deferred|from_packing), source_app, source_document_type, source_document_id, source_document_uuid, source_document_no, source_document_date, narration, currency_code, exchange_rate, negative_override?, fy_range?, metadata{challan_settlements:[{source_document_id, item_id, qty, warehouse_id}], linked_source_document_id, job_work_settlements:[{pending_id, qty, settlement_type consumed|returned}], bom_id, production_qty, finished_rate, …}, lines:[{source_line_ref, item_id, warehouse_id, unit_id, qty, rate, amount, direction in|out (or dr_cr 1|2 for by-line types), batch_id, serials[], book_qty, physical_qty, tax_cat_id, hsn_sac, description, fc_rate, fc_amount, exchange_rate, valuation_rate?, landed_cost_amount?, landed_cost_breakdown?}]` (see **Landed cost** below).
Response line fields added by posting: `base_qty, conversion_factor, valuation_rate (per base unit), valuation_amount, valuation_method_applied, landed_cost_amount`. `accounting_effects`: `[{effect: COGS_ISSUE, line_id, item_id, amount, base_qty, valuation_rate}, {effect: STOCK_ADJUSTMENT|STOCK_WRITE_OFF|STOCK_WRITE_IN|OPENING_STOCK|STOCK_REVALUATION, amount}]` — Inventory never posts to a ledger; the caller maps effects to accounts. The `inventory.document.posted` outbox payload carries the same line fields, `landed_cost_amount` included.

### Landed cost
Charges that are part of what received stock cost — freight, duty, insurance, handling, a non-creditable tax. **Books captures and allocates them** (a freight bill is a payable it books on its own side); **Inventory consumes the per-line amount** as part of the cost of the goods. A landed cost is a COST: it never touches `source_transaction_rate` / `source_transaction_amount` and never changes an invoice value, a taxable value or any GST figure.

*Arriving WITH the receipt* — two optional fields on any create-payload line:
```
"landed_cost_amount": 1234.5600,
"landed_cost_breakdown": [
  {"cost_type": "freight",            "amount": 800.0000, "allocation_basis": "value"},
  {"cost_type": "duty",               "amount": 200.0000, "allocation_basis": "qty"},
  {"cost_type": "insurance",          "amount": 100.0000, "allocation_basis": "value"},
  {"cost_type": "non_creditable_tax", "amount": 134.5600, "allocation_basis": "direct"}
]
```
`cost_type`: `freight | duty | insurance | handling | other | non_creditable_tax`.
`allocation_basis`: `value` (pro-rata by line value, the default) `| qty` (pro-rata by base quantity) `| manual` (amounts typed per line) `| direct` (the charge belongs to exactly one line by nature — a non-creditable tax). **Weight is not offered**: there is no item weight master to allocate by, so the basis would be a control that silently fell back to another one.

#### The company's capitalisation policy
Which of these charges is part of the cost of inventory — freight, insurance, customs, a tax that cannot be claimed — is an **accounting policy of the company that holds the stock**, not a per-voucher decision and not the billing product's to make. Some companies capitalise inward freight; some expense it. The policy lives here, in Inventory settings, as one setting per company.

```
GET  /v1/settings/landed-cost-policy      → what this company capitalises (permission inventory.enter)
PUT  /v1/settings  {"landed_cost_excluded_types": ["freight", "other"]}   (permission settings.write)
```
`GET /v1/settings/landed-cost-policy` returns
```
{"data": {
  "capitalisable_cost_types":      ["duty", "insurance", "handling", "non_creditable_tax"],
  "excluded_cost_types":           ["freight", "other"],
  "switchable_cost_types":         ["freight", "duty", "insurance", "handling", "other"],
  "always_capitalised_cost_types": ["non_creditable_tax"],
  "all_cost_types":                ["freight", "duty", "insurance", "handling", "other", "non_creditable_tax"]}}
```
The same resolved block is returned as `landed_cost_policy` on `GET|PUT /v1/settings`, beside the raw `landed_cost_excluded_types` column it is derived from.

**Default: every type is capitalisable.** The EXCLUDED set is what is stored, so `null` and `''` both mean "nothing excluded". No company changes behaviour when the setting ships, nothing already posted restates, and a cost type added to the vocabulary later arrives switched **on** rather than silently off for every existing company. `PUT` normalises what it stores (lower-cased, de-duplicated, in vocabulary order) and refuses a word outside the vocabulary with a `422`.

**`non_creditable_tax` is not switchable** and `PUT` refuses it with a `422` naming the reason. Under AS-2 the cost of purchase includes taxes that are *not* recoverable from the taxing authority, so a tax that cannot be claimed is part of what the goods cost — not an expense a company may elect to keep out of stock. A switch would create a third state in which those rupees are neither a recoverable input credit nor a cost of the goods, and they would disappear from both. The real choice about that money is made **upstream, in Books**, when the input tax credit is declared claimable or not: money that is claimable never arrives here as a landed cost at all.

**A caller should OFFER only the capitalisable types** (Books' purchase screen and Inventory's own landed-cost panel both do). That offer is a courtesy, **not** the control — a screen can be cached, stale, or skipped entirely by a direct API call — so Inventory enforces the policy itself, at both intake points:

* the **breakdown on a receipt line**, at `POST`/`PUT /v1/inventory-documents` and again at posting from the stored rows;
* the **charges of a `LANDED_COST` document**, at create and again at posting from the stored `metadata.charges`.

Each is a `422` naming the type and the policy: `{"error": {"code": "validation_failed", "message": "Line 2: this company does not capitalise freight into the cost of stock …", "details": {"cost_type": "freight", "capitalisable_cost_types": [...], "setting": "landed_cost_excluded_types"}}}`. **The line is refused; the amount is never accepted and dropped.** A cost quietly left out of stock value is a closing stock short by exactly that amount with nobody told, which is the failure this whole split of ownership exists to prevent. One excluded charge refuses the WHOLE allocation rather than allocating the others — allocating part of a bill and leaving the rest nowhere is the same silent drop.

A `landed_cost_amount` with **no** `landed_cost_breakdown` is checked against `other`, because that is the type posting records it under. A company that has switched `other` off is told to send the breakdown rather than have an unnamed charge booked under the very type it excluded.

Because a draft can outlive the policy it was saved under, a document created while a type was capitalisable is refused when it is next edited **or posted** — not posted quietly under the old policy. Documents already POSTED are untouched: the policy applies to what is entered from the moment it is set, and switching a type off never restates stock that has already been valued.

Rules, all 422 with a message naming the reason — a landed cost is **never silently dropped**, because a dropped cost is a closing stock that is short by exactly that amount with nobody told:
* accepted only on a line whose `direction` is `in`, on a document type whose registry entry has `valuation: true` (so an `INWARD_CHALLAN`, which values only the stock it moves, is refused — send those charges as a `LANDED_COST` document against the receipt that valued the goods);
* accepted only on a document that actually **moves its stock when it posts**, which the `stock_effect` decides. A `defer_inward` `PURCHASE_RECEIPT` and a `from_physical_challan` `SALES_ISSUE` / `SALES_RETURN` / `PURCHASE_RETURN` all declare `valuation: true` and carry inward lines, but post without valuing anything — the goods arrive on a later challan, which costs them from the purchase's **rate** and never reads `landed_cost_amount`. The charge would be dropped and closing stock short by exactly it, so entry refuses it and posting refuses it again from the stored rows. Send those charges as a `LANDED_COST` document against the document that receives the goods, once it is posted;
* `landed_cost_amount` must be `>= 0`;
* when `landed_cost_breakdown` is present its amounts must sum to `landed_cost_amount` within `0.01`.

Posting then values the line as `valuation_amount = (base cost of the goods) + landed_cost_amount`, `valuation_rate = valuation_amount / base_qty`, and the FIFO/LIFO layer and the weighted average are both opened at that rate. The allocation detail is stored in `inv_landed_costs` / `inv_landed_cost_lines` with `document_id = target_document_id =` the receipt. These rows are derived detail, not audit: reversing the receipt deletes them along with the valuation they describe, the same way re-posting an edited draft replaces them.

*Arriving LATER* — a `LANDED_COST` document, which carries no item lines (a freight bill names no item and no quantity):
```
{"document_type": "LANDED_COST", "document_date": "2026-04-18", "metadata": {
  "target_document_id": 41,
  "charges": [
    {"cost_type": "freight", "description": "Road freight", "amount": 400, "allocation_basis": "value"},
    {"cost_type": "non_creditable_tax", "amount": 134.56, "allocation_basis": "direct",
     "lines": [{"line_id": 918, "amount": 134.56}]}
  ]}}
```
Posting spreads each charge over the target's valued inward lines, raises those lines and the cost state behind them, writes the allocation rows with `document_id =` the allocation and `target_document_id =` the receipt, and emits **`STOCK_REVALUATION`** for the amount actually absorbed. It refuses a target that is not posted, is in another company, carries no valuation on its lines, has no valued inward line, **or is dated inside a locked period** — the allocation rewrites the receipt's stored valuation and the layer the receipt opened, both of which sit in the *receipt's* period, so a charge dated after the lock may not reach back through it (a `REVALUATION` attempting the same change inside the lock is refused, and this type is not an exception to that). It also refuses `manual` / `direct` shares that do not sum to their charge within `0.01`, or a `direct` charge naming more than one line. `value` allocates by the line's current `valuation_amount`, which is the only basis Inventory can compute (Books allocates by taxable value; on an ordinary purchase they are the same number). Allocation shares are settled so they sum EXACTLY to the charge, with the residual on the largest line.

**v1 limit, stated here and not only in a docblock: stock already ISSUED out of the target receipt is NOT retro-costed.** Only what is still on hand absorbs the charge; whatever is left comes back in the posting response's `warnings` as `landed_cost_not_absorbed` with `details.unabsorbed`, for the caller to expense.

The receipt line is credited with **what was absorbed, never with what was allocated.** The unabsorbed remainder exists in the warning and nowhere else: it is not written onto `valuation_rate` / `valuation_amount` / `landed_cost_amount` as well, because the caller has been told to expense it and a replay would otherwise push the same rupees into COGS a second time, while `/v1/reconciliation` would report stock value that no cost layer backs. The invariant a reader may rely on is `line valuation_amount = (what has gone to COGS out of that line) + (what its cost layers still hold)`. The `inv_landed_costs` / `inv_landed_cost_lines` rows record what was **allocated** (they tie to the charge on the Books side); `inv_document_lines.landed_cost_amount` records what was **capitalised**. "Still on hand" means **of that receipt line**, not of the item: under FIFO/LIFO it is the line's own layer, and under WAC — which keeps no layers — it is `(quantity on hand) − (quantity received since)` bounded by the line's quantity, so the two methods capitalise the same rupees on the same facts.

Two further consequences: a `LANDED_COST` document cannot be reversed (reversing it would report the cost taken back off stock while every layer it raised stayed raised — post a `REVALUATION` to correct a cost instead); and a later backdated recalculation covering the target's date re-prices from the stored line rate, which redistributes the absorbed amount between COGS and closing stock without changing their total. Stamping a landed cost with its own effective date is a v2 design. Rounding: the rate is `NUMERIC(18,4)`, so `valuation_amount` can differ from `(base cost + landed cost)` by up to `0.00005 x base_qty` — deriving the line, the movement, the layer and the average from one rounded rate is what makes closing stock tie.

## Pending quantities, packing, reservations
`GET /v1/pending-quantities?kind=challan|deferred_purchase|job_work&direction&party_ref&status` (open/partial rows with `document_id`, `item_id`, `qty_original`, `qty_settled`).
`GET /v1/packing-lists`, `GET /{id}`, `POST /{id}/unpack | lock | unlock`.
`GET/POST /v1/reservations`, `POST /{id}/release`, `POST /{id}/fulfil`.

## Stock, valuation, reports
`GET /v1/stock-movements` (filters: `item_id, warehouse_id, document_id, batch_id, line_id, document_type` (csv), `direction in|out`, `movement_kind physical|reversal|revaluation`, `stock_cat_id, item_grp_id, brand_id, source_app, q, from, to, all_fy`). `q` matches item name or code, document number, batch number, source reference and party name.
`summary=1` adds an aggregate over the **whole filtered set**, not the served page: `{movements, items, documents, in_qty, out_qty, net_qty, in_value, out_value, net_value, from, to, previous}`. `previous` is the same aggregate over the immediately preceding window of equal length under every other filter unchanged, and is `null` unless both `from` and `to` are given — the same contract as `/v1/audit-log/summary`'s `previous_total`. Inward and outward are decided by the **sign of the quantity**, exactly as `/v1/stock-ledger` decides them: a reversal of a receipt carries `direction: 'in'` with a negative quantity and counts as outward.
`trend=1` adds `{bucket: day|week|month, from, to, truncated, points[{bucket, movements, in_qty, out_qty, in_value, out_value}]}` over the same filters. The bucket widens with the span asked for (day to 62 days, week to 400, month beyond) so a financial year is ~52 points rather than 365; `truncated` is true when the series hit the 400-point cap. Both flags are opt-in because each is an extra aggregate — a caller paging the endpoint for an export wants neither.
`GET /v1/stock-ledger?item_id`.
`GET /v1/valuation?as_of&method` (snapshot), `GET /v1/valuation/unit-costs?item_ids&as_of&method`, `GET /v1/valuation/cost-layers?item_id`, `GET|POST /v1/valuation/recalculations`, `POST /{id}/run`, `GET /v1/valuation/revisions` (filters: `acknowledged=0|1`, `books=awaiting|published|acknowledged|unacknowledged`, `job_id`, `document_id`, `item_id`, `warehouse_id`, `source_app`, `document_type`, `delta=increase|decrease|none`, `min_abs_delta`, `q` over item name / SKU / document no, `from`, `to`; branch-scoped through the revised document line, `bo_id` 0 = consolidated), `POST /v1/valuation/revisions/ack {revision_ids}`, `GET /v1/valuation/carry-forward?source_fy_id&target_fy_id&source_fy_end` (preview + recorded status, no writes), `POST /v1/valuation/carry-forward {source_fy_id, target_fy_id, source_fy_start, source_fy_end, target_fy_start, target_fy_end, bo_id?, overwrite?}` → `{stock_item_count, rows[{item_id, warehouse_id, unit_id, closing_qty, unit_cost, value}], total_value, status, recalc_job_id}` (permission `valuation.carry_forward` or `valuation.recalculate`; 409 `conflict` when the target year already has an opening set and `overwrite` is not true).
`GET /v1/valuation/revisions/summary?days=10` — the same filters, aggregated over the whole filtered set rather than the page, for the revisions screen's cards, charts and insights: `{window:{from,to,days,explicit_range,previous_from,previous_to}, filtered:<totals>, previous:<totals>, company:{revisions,acknowledged,pending,pending_delta,awaiting_publish,published_unacknowledged,created_last_7d,created_prev_7d,acknowledged_today,acknowledged_yesterday}, jobs:{queued,running,failed}, timeline:[{day,revisions,increased,decreased,net_delta}], by_source:[{document_type,revisions,net_delta,abs_delta}], top_items:[{item_id,item_name,item_sku,revisions,net_delta,abs_delta,peak_change_pct,baseline_pct,baseline_samples}], baseline_days, triggers:[{trigger_kind,jobs,revisions,net_delta,abs_delta}]}`. `<totals>` is `{revisions,net_delta,abs_delta,increased,decreased,unchanged,items_affected,items_increased,items_decreased,jobs,acknowledged,published_unacknowledged,awaiting_publish}`. `previous` measures the window immediately before `window` under the same filters; `company` ignores the screen's filters, because a backlog does not shrink when a date range is narrowed. `peak_change_pct` is the largest rate move on the item as a percentage of the old valuation rate, and `baseline_pct` the same measure averaged over the trailing `baseline_days`; both are `null` where the old rate was zero. Read-only.
`GET /v1/reports/stock-summary | stock-ledger | warehouse-stock | batch-stock | serial-stock | stock-ageing | movement-analysis | near-expiry | replenishment` (filters: `from, to, as_of, item_id, item_grp_id, stock_cat_id, warehouse_id, nonzero, method`).

## Reconciliation, integration, audit, settings, access
`GET /v1/reconciliation`, `POST /v1/reconciliation/run {as_of}`, `GET /{id}`, `GET /v1/reconciliation/posting-status`.
`POST /v1/integration/events` (inbound from Books: `event_uuid, event_type, payload`), `GET /v1/integration/outbox`, `POST /v1/integration/outbox/{id}/replay`, `POST /v1/integration/outbox/dispatch`.
Outbox events emitted: `inventory.document.posted`, `inventory.document.reversed`, `inventory.valuation.revised`, `inventory.item.upserted`, `inventory.uom.upserted`, `inventory.warehouse.upserted`, `inventory.fy.carried_forward`.
`GET /v1/audit-log`, `GET /v1/audit-log/entity/{type}/{id}` (filters: `entity_type, entity_id, action, action_prefix, actor_uuid, source_app, source_document_type, source_document_id, request_id, ip_address, has_reason, q, from, to`; `action`, `actor_uuid`, `source_app`, `entity_type`, `source_document_type`, `request_id` and `ip_address` accept a comma-separated list).
`GET /v1/audit-log/summary` — the same filters, aggregated over the whole filtered set rather than the page: `{total, previous_total, actors, source_apps, event_types, entity_types, first_at, last_at, retention_years, may_purge, facets:{actions, actors, source_apps, entity_types}}`. `previous_total` is the count over the immediately preceding window of equal length and is `null` unless both `from` and `to` are given. Each facet is `{value, count}[]`, commonest first, capped at 150 values. Read-only; the audit trail is append-only (migration 007 refuses UPDATE and DELETE at the database).
`GET|PUT /v1/settings` (`default_valuation_method, valuation_scope company|warehouse, negative_stock_policy allow|block|warn, approval_required, cogs_revision_mode, landed_cost_excluded_types`), `GET|POST|DELETE /v1/settings/period-locks`.
`GET /v1/settings/landed-cost-policy` (permission `inventory.enter`, the same one a caller creating a document already holds) → `{capitalisable_cost_types[], excluded_cost_types[], switchable_cost_types[], always_capitalised_cost_types[], all_cost_types[]}`, all lists of cost-type codes. See **Landed cost → capitalisation policy**.
`GET /v1/access/me | check | permissions | profiles | members`, `POST /v1/access/profiles | members | members/provision`, `PUT …`, `DELETE …`.

## Compatibility rules for new products
1. Send `source_app`, `source_document_type` (`<app>.<doc>`), `source_document_id` and `source_document_uuid` on every document you create; that is your idempotency and your reconciliation key.
2. Keep commercial values in your own or Books' tables; send them as `rate`/`amount` so Inventory can store the source value — but treat `valuation_*` as the only cost.
3. Never write `inv_*` tables; never cache stock balances longer than a request — call availability.
4. Map `accounting_effects` to ledgers through Books' API; Inventory will not.
5. Breaking changes ship as `/v2`; `/v1` stays.
