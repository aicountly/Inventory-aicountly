# The five Inventory dashboards

`/dashboard?view=overview|operations|replenishment|valuation|controls`

One route, five screens. A bare `/dashboard` — which is what the sidebar, the
`alt+d` chord and the post-sign-in redirect all point at — resolves to the
dashboard the user opened last, or Overview. An unknown or forbidden `view`
falls back to an authorised one rather than erroring, so a link pasted from a
colleague with different permissions still lands somewhere useful.

Filters that survive a tab change and a reload live in the URL: `as_of` and
`warehouse_id` (plus `item_id` on Replenishment). Company, financial year and
branch stay where they belong — Manage owns them, `CompanyProvider` holds them,
and no dashboard tries to own them.

## Dashboard → source

Every figure on a dashboard is a server aggregate over the whole scoped set. The
browser adds nothing up. This table is the map for review: which screen reads
which endpoint, and which register reproduces the number when you click it.

| Dashboard | Panel | Source | Drills to |
| --- | --- | --- | --- |
| Overview | Stock value, on hand, items | `GET /v1/reports/stock-summary` | `/reports/stock-summary` |
| Overview | Reorder alerts | `GET /v1/reports/replenishment` | `/reports/replenishment` |
| Overview | Negative stock, approvals, documents, Books outbox, last reconciliation | `GET /v1/dashboard` | `/registers/stock-balances`, `/documents`, `/integration/outbox`, `/reconciliation` |
| Overview | Value by warehouse | `GET /v1/reports/warehouse-stock` | `/reports/warehouse-stock` |
| Overview | Stock ageing | `GET /v1/reports/stock-ageing` | `/reports/stock-ageing` |
| Overview | Movement mix | `GET /v1/reports/movement-analysis` | `/reports/movement-analysis` |
| Overview | Expiring / expired | `GET /v1/reports/near-expiry` | `/reports/near-expiry` |
| Overview | Latest movements | `GET /v1/stock-movements` | `/registers/movement-register` |
| Operations | Everything | `GET /v1/dashboard/operations` | `/documents`, `/registers/pending-quantities` |
| Replenishment | Recommendations, KPIs | `GET /v1/reports/replenishment` | `/reports/replenishment` |
| Replenishment | Demand and cover | `GET /v1/dashboard/demand` | — (the chart is the detail) |
| Valuation | Closing value | `GET /v1/reports/stock-summary` | `/reports/stock-summary` |
| Valuation | Value bridge | `GET /v1/dashboard/valuation-bridge` | `/registers/movement-register` |
| Valuation | Ageing | `GET /v1/reports/stock-ageing` | `/reports/stock-ageing` |
| Valuation | Warehouse concentration | `GET /v1/reports/warehouse-stock` | `/reports/warehouse-stock` |
| Valuation | Movement classification | `GET /v1/reports/movement-analysis` | `/reports/movement-analysis` |
| Valuation | Batch and expiry watch | `GET /v1/reports/near-expiry` | `/reports/near-expiry` |
| Controls | Exceptions, delivery health, approval counts | `GET /v1/dashboard/controls` | per-row, see the payload's `path` |
| Controls | Reconciliation | `GET /v1/reconciliation` | `/reconciliation/{id}` |
| Controls | Approval inbox | `GET /v1/inventory-documents?status=PENDING_APPROVAL` | `/documents/{id}` |
| Controls | Audit activity | `GET /v1/audit-log` | `/audit` |

The four `/v1/dashboard/*` aggregates are new
(`app/Services/DashboardMetricsService.php`). Everything else was already there.

## What these screens will not do

These are the rules the code is built to keep, written down because each one is
a thing a dashboard normally gets wrong.

**A number is either real or absent.** Every metric travels as
`{value, state, definition}` with four states — `ready`, `empty`,
`not_configured`, `unavailable`. A figure that could not be read renders as
"Unavailable" with a Retry, never as a zero. Zero renders as `0`, because a
quiet morning is an answer.

**Two figures say "not tracked" rather than inventing a number.**

- *Transfers in transit* (Operations). This product posts a transfer out of one
  warehouse and into another in a single operation, so no balance is ever held
  between them. The card says so and points at the pending-quantity register,
  where the goods that genuinely are out — challans and job work, with real
  agreed return dates — are tracked.
- *Open replenishment requests* (Replenishment). There is no purchase-request
  workflow inside Inventory; Purchases lives outside it. A reviewed suggestion
  is raised as an inventory document.

**Counts state their unit.** Receipts and issues count DOCUMENTS, not lines, and
a document falls in exactly one flow class
(`Config\DocumentTypeRegistry::flowClass`), so a transfer is never counted as
both. Exceptions are counted in rows, documents, lines or events and are never
added across kinds into one "items" figure — one item can raise several.

**A reconciliation that could not reach Books is not a reconciliation that found
nothing.** `BOOKS_UNAVAILABLE` renders as "Unavailable", never as a zero
difference and never as a green tick. A completed run that found a difference
says "Completed — difference found", never "aligned".

**Charts do not draw the future.** The hourly chart stops at the current hour.
The demand chart's actual series stops at the as-at date and the projection
begins after it, in a different colour *and* a different dash pattern *and* with
a different label — three signals, so the distinction survives a monochrome
print. There is no confidence band: a trailing mean over daily issues does not
support one.

**The value bridge closes, or says it does not.** Opening plus the steps shown
must reach the closing value; any residual is drawn as its own "Unexplained" bar
rather than folded into a step.

**A composition composes.** Ageing shares are taken over the non-negative
buckets only; a negative bucket is listed as an exception rather than forced
into a chart that adds to 100% by ignoring it. Stock with no receipt date is
reported, not aged into the oldest bucket.

**Nothing on a dashboard mutates.** Rendering never writes. "Run reconciliation"
is a button, behind `reconciliation.resolve`, guarded against a double press.
The replenishment drawer opens a draft document for the user to check and save;
it does not order anything.

**The briefing is arithmetic, and says so.** There is no forecasting engine and
no application-owned AI configured for Inventory, so the Pulse strip is a set of
rules over the figures already on the page (`src/dashboard/pulse.ts`), labelled
"Rule-based summary". A `null` figure produces no finding, so the briefing never
reports all-clear because a request failed.

## Keyboard

Chords live in `src/keyboard/shortcutRegistry.ts` and are shared with Books.
Sequences — two presses, not a chord — live in `src/keyboard/sequences.ts`:

| Action | Keys |
| --- | --- |
| Command palette | `Ctrl`/`Cmd` + `K` |
| Overview … Controls | `G` then `1` … `5` |
| Items | `G` then `I` |
| Stock ledger | `G` then `L` |
| New receipt / issue / transfer / count | `N` then `R` / `I` / `T` / `C` |
| Shortcut help | `?` |

These sequences are **Inventory's own**, not a verified Books mapping:
`books-react-app` has no sequence registry to copy from — its `web/src/keyboard`
handles chords only — so parity was not verified and is not claimed. Ctrl+K and
the `alt+*` chords are the ones the two products genuinely share.

A sequence never fires while focus is in a field, a select, a contenteditable or
an overlay; never with Ctrl, Alt or Meta held (so AltGr and non-US layouts pass
through); never on auto-repeat or during IME composition. The pending prefix
expires after a second and is dropped on navigation and on blur. `preventDefault`
is called only for a registered, permitted command that actually ran. Every
command opens a screen or a form — none saves, approves, posts or orders.

Single-letter shortcuts can be turned off from the `?` dialog, for anyone using
speech or switch input where a stray letter is easy to emit. When they are off
every key badge hides too, so the help never promises a key that does nothing.

## Export

`Export PDF` builds a purpose-made document from the same figures the screen is
showing (`src/dashboard/dashboardExport.ts`) and hands it to the browser's print
pipeline. It is not a screenshot: table headers repeat across pages, rows never
split, charts are replaced by their own data tables, each figure is printed with
its definition, and a table showing a subset says so in its own words rather
than implying it is the whole set. The scope line — company, financial year,
branch, warehouse, as-at date — and both timestamps are on every sheet.

## Performance

Only the active dashboard is mounted; the other four are lazy chunks and are not
fetched. Switching tabs unmounts the previous section and aborts its in-flight
requests. Every query carries the tenant scope as a `resetKey`, so a company
switch drops the previous company's data in render rather than in an effect —
there is no frame in which one tenant's figures sit under another's name. The
`/v1/dashboard/*` responses echo their scope and `assertScope` rejects a late
answer computed for a different one.
