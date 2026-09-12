# Books mobile app — inventory split migration

Smart Books mobile (`books-react-app/mobile`, Expo + expo-router, bundle id
`com.aicountly.books` on both stores) talked only to the Books API. After the
split, stock masters and stock documents live in **Aicountly Inventory**, so the
app now has a second API client and no longer creates pure inventory vouchers.
This document lists what changed in the app, how old builds behave against a
live Books server, the release order relative to the database cutover, and the
publishing actions the store owner has to take. Nothing here contains, and no
commit contains, signing or store credentials — see the "Publishing" section for
what must be supplied out of band.

## 1. What changed in the app

| Area | Before | After |
|------|--------|-------|
| API clients | `src/api/client.ts` → Books only | `src/api/client.ts` (Books) **plus** `src/api/inventoryClient.ts` (Inventory). Both go through the shared `authedRequest` cycle: same secure-store session key, same `cmp_id / fy_id / bo_id` injection, same 401 refresh and error mapping; Inventory calls add `X-Source-App: books`. |
| Environment | `EXPO_PUBLIC_BOOKS_ENV` picks `books.aicountly.com` / `books.gh.aicountly.com` | Same switch also picks the Inventory API (`https://inventory.aicountly.com/api`, sandbox `https://inventory.gh.aicountly.com/api`) and app URL; `EXPO_PUBLIC_INVENTORY_API_BASE` / `EXPO_PUBLIC_INVENTORY_APP_URL` override them (`src/config/env.ts`). |
| Items, item groups, bills of materials, material centres | `src/api/endpoints/inventory.ts` → Books `/api/masters/...` | `itemsApi`, `itemGroupsApi`, `bomApi`, `materialCentresApi` read and write through Inventory `/v1/items`, `/v1/item-groups`, `/v1/bill-of-materials`, `/v1/warehouses`. Rows are mapped back to the Books names the screens use (`books_tax_cat_id → tax_cat_id`, `warehouse_id → mc_id`, `unit_lines` kept); the item form's payload is accepted by Inventory as it is, with the Books account / tax links copied to their `books_*` names. Item form dropdowns merge Inventory (units, groups, categories) with Books (accounts, tax categories). |
| Item pickers on sales / purchase / credit-note / debit-note entry | Books item search | Unchanged: the pickers read Books' read-only mirror (kept in step by Inventory events) and the **posted payload is unchanged** (`item_id, qty, rate, amount, unit_id, mc_id, tax_cat_id, dr_cr`) — the Books server hands the lines to Inventory and writes the COGS pairs. |
| Packing lists | Books `/packing-lists` | Inventory `/v1/packing-lists` (list, unpack, unlock); rows map the Inventory document id onto `vch_txn_id` so the packing screen is unchanged. |
| Pure inventory vouchers (stock transfer 15, stock journal 20, physical stock 10, production 14, job work in/out 6/7, packing 4, delivery / inward challan 23/24) | entry form under `app/(app)/inventory/vouchers/[type]`, reached from the hub, the Movement Vouchers index and the quick actions | **The entry form is gone.** Every existing route now lands on a hand-off screen ("… is now recorded in Aicountly Inventory") with an *Open Aicountly Inventory* button that deep-links the matching document type in the Inventory app through the device browser, and a link to the Books registers. Historical vouchers still open **read-only** in the registers (`app/(app)/vouchers/[id]`) and print through Books, which keeps the voucher headers and a read-only mirror of item / unit / material-centre names. |
| Inventory reports (item ledger, summary, status, valuation) | Books report endpoints | Unchanged on the app: the Books server serves those endpoints **from Inventory** in live mode (`InventoryReportAdapter`), so the screens show live quantities and values with Books' commercial columns kept. Responses carry `source: "inventory"`. |
| Version | `1.1.0`, iOS build 61 / Android versionCode 61 | `1.2.0`, iOS build 62 / Android versionCode 62 (`mobile/app.json`; `package.json` 1.2.0). `eas.json` keeps `autoIncrement` for store profiles. |

`src/api/inventoryClient.test.ts` covers the path / query helpers, the environment
origins and the Inventory → Books row mapping; the hub and index tests still pass
because every voucher route survives as the hand-off screen. `npx tsc --noEmit`,
`npx jest` and `npm run lint` are the gate.

## 2. How an old build behaves after the cutover

Old installs keep working for accounting. The Books server, not the app,
enforces the split, so an out-of-date app degrades predictably once
`INVENTORY_MODE=live`:

* Sales / purchase / note vouchers with item lines still post — the Books
  server hands the lines to Inventory and writes the COGS pairs itself.
* Item, unit and material-centre **reads** still work from Books' read-only
  mirror (names, HSN, units) — lists, pickers and prints are unaffected.
* Creating or editing an **item / unit / material centre / BOM** from an old
  build gets HTTP **410 "Managed in Aicountly Inventory"**; the app shows the
  server message.
* Creating a **pure inventory voucher** from an old build gets HTTP **410**
  with the message "This document is now created in Aicountly Inventory
  (stock transfer, stock journal, physical stock, production, job work,
  packing and challans live there). Open Inventory to record it."
* Inventory reports on an old build call the same Books endpoints the new
  build does, and those are served from Inventory in live mode — so even old
  builds show live quantities. Packing lists and item / group / BOM screens
  on an old build read the frozen Books tables (stale for packing lists,
  read-only mirror for items) until the user updates.

No forced-update mechanism exists in the app today. If a hard block for old
builds is wanted, add a minimum-version check against `GET /api/health` on the
Books server; it is deliberately not part of this migration.

## 3. Release order relative to the database cutover

1. Deploy Books server (still `INVENTORY_MODE=legacy`) and the Inventory API;
   run the data migration and validation (`DB_MIGRATION_RUNBOOK.md`).
2. Build the new mobile version with the **production** profiles and submit
   it for review, but hold the release: its item / group / BOM screens write
   to Inventory, which only becomes the owner at the cutover.
3. Cut over (`INVENTORY_MODE=live`, Inventory "live" flag, Books web deploy).
4. Release the reviewed build to 100 % (or start the phased release) the same
   day. Old builds behave as in section 2 until users update.

## 4. Publishing actions (store owner)

The repository holds no credentials: Apple certificates / provisioning live in
EAS, the App Store Connect API key is `mobile/secrets/AuthKey_ASC.p8`
(git-ignored) and the Google Play service-account JSON is referenced from
`eas.json → submit.production.android.serviceAccountKey`. Follow
`mobile/docs/IOS_PUBLISHING.md` and `mobile/docs/APP_REVIEW_READINESS.md`
(read the latter before every submission — the 1.1.0 (8) rejection is
documented there).

```bash
cd mobile
npm ci --legacy-peer-deps
npx tsc --noEmit && npm test -- --watchAll=false

# iOS — TestFlight first, then App Store
npx eas-cli build  --platform ios --profile testflight --non-interactive
npx eas-cli submit --platform ios --profile testflight --latest
npx eas-cli build  --platform ios --profile production --non-interactive
npx eas-cli submit --platform ios --profile production --latest

# Android — internal/beta track, then production
npx eas-cli build  --platform android --profile production --non-interactive
npx eas-cli submit --platform android --profile open-testing --latest
npx eas-cli submit --platform android --profile production --latest
```

Before submitting:

* **Screenshots.** The inventory voucher entry screens no longer exist.
  Regenerate every store screenshot set (`npm run screenshots`, see
  `mobile/store/app-store-listing.md`) and replace stale sets in App Store
  Connect and the Play Console — App Review guideline 2.3.3 was one of the
  previous rejection reasons.
* **Release notes.** "Stock documents (stock transfer, stock journal,
  physical stock, production, job work, packing and challans) are now
  recorded in the Aicountly Inventory app. Items, units and warehouses are
  managed there too; Smart Books keeps accounting, GST, TDS and reports."
* **Review account.** The review company used in App Review notes must have
  a corresponding Inventory tenant (same company id) so that item pickers and
  availability return data.
* **Sandbox check.** Install the `preview` profile build (points at
  `books.gh.aicountly.com` and `inventory.gh.aicountly.com`) and run the
  checklist in section 5 against the sandbox after the sandbox cutover.

## 5. Manual acceptance checklist (sandbox, then production)

1. Sign in, pick a company / FY / branch; the dashboard loads.
2. Masters → Items: list, search, open an item; the "Managed in Inventory"
   notice is shown; create / edit is either handled in the Inventory app or
   the Inventory-backed form saves and the item appears in Books' lists.
3. Sales invoice with an item line: item search, unit, warehouse and
   availability show; post; the voucher lists as posted and its print shows
   the item name; the Inventory app shows the SALES_ISSUE document for it.
4. Purchase invoice "from challan": open inward challans come from Inventory;
   settle one; both apps show the settlement.
5. Transactions hub: the stock-document tiles open the Inventory app in the
   browser; no create form for them remains inside Books.
6. Vouchers list: open a historical stock transfer (created before the
   cutover) read-only; print works.
7. Reports: item ledger and stock summary load from Inventory and match the
   Inventory app; Trading / P&L closing stock still comes from Books.
8. Sign out / sign in again on a second company; every screen is scoped to
   the new company (no data bleed).
