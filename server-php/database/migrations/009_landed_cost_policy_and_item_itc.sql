-- Migration 009: the company's landed-cost capitalisation policy, and the item's ITC attribute.
--
-- InventorySqlMigrationRunner records every file it applies by FILENAME in inv_sql_migrations and
-- skips anything already recorded, so an earlier file cannot be edited to change the schema of a
-- database that already has it. Every real DDL change lives in a new file.
--
-- Everything below is ADD COLUMN IF NOT EXISTS: additive, idempotent, nothing dropped, renamed or
-- backfilled, and no existing row's values change. Both defaults are chosen so that a database
-- that applies this migration behaves exactly as it did the minute before: every cost type stays
-- capitalisable, and every item stays on 'inherit'. Nothing already posted restates.

-- ---------------------------------------------------------------- landed cost capitalisation policy
--
-- Which charges a company treats as part of the cost of stock is a company decision — some
-- companies capitalise freight, some expense it — and until now it was made per voucher in Books
-- and per document in the landed-cost panel, with no company-level truth anywhere.
--
-- The EXCLUDED set is stored, not the included one, and that is deliberate: NULL and '' both mean
-- "nothing is excluded", so every row that already exists is already on the default (all types
-- capitalisable) without a backfill, and a cost type added to the vocabulary later is on by
-- default rather than silently off for every existing company.
--
-- A comma-separated list rather than JSONB or five flags: it is a small closed vocabulary read as
-- a set, the same shape as negative_stock_policy next to it, and InventorySettingsService is the
-- only writer. The vocabulary is enforced in PHP (a 422 naming the offending value), which is why
-- there is no CHECK here — see 008 for the same reasoning about cost_type.
--
-- 'non_creditable_tax' can never appear in this list and InventorySettingsService refuses it:
-- under AS-2, tax that is not recoverable IS part of the cost of purchase. A switch would create a
-- third state in which those rupees are neither a recoverable credit nor a cost, and they would
-- simply vanish. The user's choice about that money is made upstream in Books, by declaring the
-- ITC claimable or not; if it is claimable it never arrives here as a landed cost at all.
ALTER TABLE inv_company_settings ADD COLUMN IF NOT EXISTS landed_cost_excluded_types VARCHAR(255) NULL;

COMMENT ON COLUMN inv_company_settings.landed_cost_excluded_types IS
    'Comma-separated landed-cost types this company does NOT capitalise into stock, from freight, duty, insurance, handling, other. NULL or empty means none are excluded (the default: every type is capitalisable). non_creditable_tax is never listed here - it is always capitalised, because tax that cannot be recovered is part of the cost of purchase under AS-2. A posted line or charge carrying an excluded type is refused with a 422 naming the type and the policy; it is never accepted and quietly dropped, because a dropped cost is a closing stock that is short by exactly that amount with nobody told.';

-- ---------------------------------------------------------------- item-level ITC attribute
--
-- An ATTRIBUTE OF THE GOODS: this thing is a motor vehicle, this thing is food and beverage. That
-- is a fact about the item, which is why it lives on the item master and not on a voucher.
--
-- Inventory STORES it and nothing more. It makes no tax determination, computes no tax
-- consequence, applies no precedence against the tax category or the purchase ledger, and has no
-- "default claimable" fallback. Books reads the attribute through the item API, resolves it
-- against its own tax category, purchase ledger and voucher line, and books the result. Two
-- implementations of one precedence rule would be two answers to the same question.
--
--   inherit  (default) - this item says nothing; whatever Books resolves from the tax category and
--                        the ledger stands. Every existing item is on this, so nothing changes.
--   claim              - the item is one whose input tax is ordinarily recoverable.
--   block              - the item is one whose input tax is ordinarily NOT recoverable.
--
-- NOT NULL DEFAULT 'inherit' rather than a nullable column: 'inherit' is a real, meaningful third
-- state that a reader must be able to tell apart from "nobody has decided", and here there is no
-- difference between the two - an item nobody has touched is an item that defers to Books.
ALTER TABLE inv_items ADD COLUMN IF NOT EXISTS itc_eligibility VARCHAR(8) NOT NULL DEFAULT 'inherit';

COMMENT ON COLUMN inv_items.itc_eligibility IS
    'inherit | claim | block. An attribute of the GOODS (a motor vehicle, a food and beverage), stored by Inventory and resolved by Books. Inventory makes no tax determination, computes no tax consequence and holds no precedence rule: it reports this value on the item API and nothing else. inherit (the default) means the item says nothing and Books decides from the tax category and the ledger.';
