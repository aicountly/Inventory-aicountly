-- Migration 010: a warehouse's physical capacity and its point on the map.
--
-- InventorySqlMigrationRunner records every file it applies by FILENAME in inv_sql_migrations and
-- skips anything already recorded, so an earlier file cannot be edited to change the schema of a
-- database that already has it. Every real DDL change lives in a new file.
--
-- Everything below is ADD COLUMN IF NOT EXISTS: additive, idempotent, nothing dropped, renamed or
-- backfilled. Every column is NULL, and NULL is the honest answer — "not configured" — not a zero
-- that would make an unconfigured warehouse read as a full one. A database that applies this
-- migration behaves exactly as it did the minute before.
--
-- ---------------------------------------------------------------- why these live on the warehouse
--
-- inv_warehouses already owns what a warehouse IS (name, code, type, group, branch, negative-stock
-- policy) and inv_stock_balances owns what is IN it. How much it can hold is the first of those,
-- not the second: it is a property of the building, it does not change when stock moves, and no
-- document posts against it. Storing it anywhere else would mean a second table keyed 1:1 on
-- warehouse_id, joined on every read, for five scalars.
--
-- Nothing here is derived from another Aicountly service. Companies, branches and financial years
-- stay Manage's, read live through /api/manage/...; these columns are Inventory's own master data,
-- entered by the user on the warehouse form. No copy, no sync, no cron.
--
-- ---------------------------------------------------------------- capacity
--
-- capacity_units is a quantity in the warehouse's own stock units, deliberately unit-less at the
-- schema level: Inventory already carries per-item units and conversions (inv_units), and a
-- warehouse that holds three different items holds them in three different units. The figure is
-- therefore an operational ceiling the user sets, and utilisation is read as "how full, by the
-- same count the stock screens show" — qty against qty, which is the only comparison that does not
-- silently mix units. NULL means the user has not set one, and every screen says "Not configured"
-- rather than computing a utilisation against an invented denominator.
--
-- NUMERIC(20,4) matches the qty precision used by inv_stock_balances and inv_document_lines, so a
-- capacity can never be a precision the stock beside it cannot express.
--
-- area / area_unit are floor area, which is what a warehouse manager actually quotes and what the
-- capacity card shows underneath the unit ceiling. The unit is stored beside the number rather
-- than normalised to one canonical unit: sq ft and sq m are both in daily use in India, and
-- converting on write would show the user back a figure they did not type.
--
-- ---------------------------------------------------------------- coordinates
--
-- latitude / longitude let the map plot a warehouse without a geocoding round trip, and without a
-- paid map provider: the app reads the pair it was given. address_json already holds the postal
-- address (city, state, country, pincode) and stays the source of truth for it; these two columns
-- are the point, not the address, and one can exist without the other. NULL in either means the
-- warehouse is simply not plotted, and the map says so.
--
-- NUMERIC(10,7) / NUMERIC(11,7): seven decimal places is ~1.1 cm at the equator, far finer than a
-- building needs, and the differing precision is only the extra integer digit longitude's ±180
-- range requires over latitude's ±90. The ranges themselves are enforced in PHP
-- (WarehousesController), a 422 naming the offending field, for the same reason the vocabularies
-- in 008 and 009 are: the API must reject it with a message the form can attach to an input, and a
-- CHECK constraint surfaces as a driver error nobody can render.

ALTER TABLE inv_warehouses
    ADD COLUMN IF NOT EXISTS capacity_units NUMERIC(20,4) NULL,
    ADD COLUMN IF NOT EXISTS area           NUMERIC(20,4) NULL,
    ADD COLUMN IF NOT EXISTS area_unit      VARCHAR(16)   NULL,
    ADD COLUMN IF NOT EXISTS latitude       NUMERIC(10,7) NULL,
    ADD COLUMN IF NOT EXISTS longitude      NUMERIC(11,7) NULL;

-- The map view asks one question — "which of this company's warehouses have a point?" — and the
-- summary endpoint counts the answer. Partial, so it indexes only the rows that have coordinates
-- rather than carrying an entry for every warehouse that never will.
CREATE INDEX IF NOT EXISTS idx_inv_warehouses_cmp_geo
    ON inv_warehouses (cmp_id)
    WHERE latitude IS NOT NULL AND longitude IS NOT NULL AND deleted_at IS NULL;
