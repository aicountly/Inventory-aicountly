<?php

namespace App\Services;

/**
 * The counters above the registers hub.
 *
 * The hub is a menu, not a dashboard: the strip exists to tell a reader how big
 * the books they are about to open are, and it must never cost more than the
 * menu it decorates. So every figure here is a COUNT (or one indexed row) that
 * an existing index already answers —
 *
 *   inv_items / inv_warehouses / inv_locations   cmp_id, small tables
 *   inv_stock_movements                          idx_inv_stock_movements_fy
 *   inv_reconciliation_runs                      idx_inv_reconciliation_runs_cmp
 *
 * — and NOT one figure walks the ledger. In particular the stock value is the
 * one the last reconciliation run already computed and stored, dated, rather
 * than a fresh valuation: `stockSummary()` re-walks every movement and prices
 * every item, which is right for the valuation register a reader asked for and
 * indefensible for a caption on a menu. The response says which date the value
 * belongs to so the screen can label it honestly, and the valuation register is
 * one click away when the live figure is what is wanted.
 *
 * Every figure is also gated on the permission that governs the register it
 * summarises. A null means "not yours to see" (or "nothing recorded yet") and
 * the strip prints an em dash — it never falls back to a figure the caller
 * could not have reached through the UI.
 */
class RegisterSummaryService
{
    private \CodeIgniter\Database\BaseConnection $db;

    public function __construct(?\CodeIgniter\Database\BaseConnection $db = null)
    {
        $this->db = $db ?? \Config\Database::connect();
    }

    /**
     * The date the strip is read at.
     *
     * Today, unless the selected financial year has already closed or has not
     * opened yet — a reader who switches to FY 2024-25 is not asking what the
     * warehouse looks like this morning, and "as on 16 Sep 2026" over rows that
     * stop in March 2025 is a caption that contradicts its own register. The FY
     * window comes from inv_fy_ranges, Manage's dates as this service last
     * learned them; with no cached range, today stands.
     */
    public static function asOnDate(string $today, ?string $fyStart, ?string $fyEnd): string
    {
        if ($fyEnd !== null && $fyEnd !== '' && $today > $fyEnd) {
            return $fyEnd;
        }
        if ($fyStart !== null && $fyStart !== '' && $today < $fyStart) {
            return $fyStart;
        }

        return $today;
    }

    /**
     * The movement window: the calendar month `asOn` falls in, up to `asOn`
     * itself, clipped to the financial year.
     *
     * Clipping matters at both ends of a year. April's window must not reach
     * back into March of the previous FY, and the closing month of a year that
     * ended mid-month must not run past the year's last day — in both cases the
     * fy_id filter on the query would silently drop the out-of-year days and
     * leave the count contradicting the label above it.
     *
     * @return array{from: string, to: string}
     */
    public static function movementWindow(string $asOn, ?string $fyStart, ?string $fyEnd): array
    {
        $from = date('Y-m-01', strtotime($asOn));
        $to = $asOn;
        if ($fyStart !== null && $fyStart !== '' && $from < $fyStart) {
            $from = $fyStart;
        }
        if ($fyEnd !== null && $fyEnd !== '' && $to > $fyEnd) {
            $to = $fyEnd;
        }
        if ($from > $to) {
            $from = $to;
        }

        return ['from' => $from, 'to' => $to];
    }

    /**
     * The financial year's dates as Inventory last learned them from Manage.
     *
     * @return array{start: ?string, end: ?string}
     */
    public function fyRange(int $cmpId, int $fyId): array
    {
        if (!SchemaCache::tableExists($this->db, 'inv_fy_ranges')) {
            return ['start' => null, 'end' => null];
        }
        $row = $this->db->table('inv_fy_ranges')
            ->select('fy_start, fy_end')
            ->where('cmp_id', $cmpId)
            ->where('fy_id', $fyId)
            ->get();
        $row = $row === false ? null : $row->getRowArray();
        if (!$row) {
            return ['start' => null, 'end' => null];
        }

        return [
            'start' => substr((string) $row['fy_start'], 0, 10),
            'end'   => substr((string) $row['fy_end'], 0, 10),
        ];
    }

    /**
     * Rows a master holds, active and total. Null when the caller may not read
     * that master.
     *
     * @return array{total:int, active:int}|null
     */
    private function masterCount(string $table, int $cmpId, bool $allowed, bool $hasActiveFlag = true): ?array
    {
        if (!$allowed) {
            return null;
        }
        $select = $hasActiveFlag
            ? 'COUNT(*) AS total, SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END) AS active'
            : 'COUNT(*) AS total, COUNT(*) AS active';
        $res = $this->db->table($table)
            ->select($select, false)
            ->where('cmp_id', $cmpId)
            ->where('deleted_at', null)
            ->get();
        $row = $res === false ? null : $res->getRowArray();
        if (!$row) {
            return null;
        }

        return ['total' => (int) ($row['total'] ?? 0), 'active' => (int) ($row['active'] ?? 0)];
    }

    /**
     * Posted movements in the window, on the (cmp_id, fy_id, bo_id,
     * movement_date) index.
     *
     * Reversals are counted like anything else: they are movements a reader
     * will find in the movement register, and a count that quietly disagreed
     * with the register it points at would be worse than no count.
     *
     * @return array{count:int, from:string, to:string}|null
     */
    private function movementCount(int $cmpId, int $fyId, int $boId, array $window, bool $allowed): ?array
    {
        if (!$allowed) {
            return null;
        }
        $b = $this->db->table('inv_stock_movements')
            ->where('cmp_id', $cmpId)
            ->where('fy_id', $fyId)
            ->where('movement_date >=', $window['from'])
            ->where('movement_date <=', $window['to']);
        if ($boId > 0) {
            $b->where('bo_id', $boId);
        }

        return ['count' => (int) $b->countAllResults(), 'from' => $window['from'], 'to' => $window['to']];
    }

    /**
     * Closing stock value as at the last completed reconciliation.
     *
     * Deliberately NOT a live valuation — see the class comment. `as_of` is
     * part of the answer, not decoration: the screen prints it beside the
     * figure so nobody reads a Tuesday number as this morning's.
     *
     * @return array{amount:float, as_of:string, source:string}|null
     */
    private function reconciledStockValue(int $cmpId, int $fyId, int $boId, bool $allowed): ?array
    {
        if (!$allowed) {
            return null;
        }
        $b = $this->db->table('inv_reconciliation_runs')
            ->select('inventory_closing_value, as_of_date')
            ->where('cmp_id', $cmpId)
            ->where('fy_id', $fyId)
            ->where('status', 'COMPLETED');
        if ($boId > 0) {
            $b->where('bo_id', $boId);
        }
        $res = $b->orderBy('as_of_date', 'DESC')->orderBy('run_id', 'DESC')->limit(1)->get();
        $row = $res === false ? null : $res->getRowArray();
        if (!$row) {
            return null;
        }

        return [
            'amount' => round((float) $row['inventory_closing_value'], 2),
            'as_of'  => substr((string) $row['as_of_date'], 0, 10),
            'source' => 'reconciliation',
        ];
    }

    /**
     * The company's base currency.
     *
     * Read here rather than left to the client, because the one figure on the
     * strip that carries a symbol is the one this endpoint produced: a screen
     * that formatted it from a separately-fetched setting could print the
     * previous company's symbol for as long as that second request was in
     * flight. Read-only on purpose — InventorySettingsService::get() creates the
     * settings row when it is missing, and a GET must not write.
     */
    private function baseCurrency(int $cmpId): string
    {
        if (!SchemaCache::tableExists($this->db, 'inv_company_settings')) {
            return 'INR';
        }
        $res = $this->db->table('inv_company_settings')
            ->select('base_currency_code')
            ->where('cmp_id', $cmpId)
            ->get();
        $row = $res === false ? null : $res->getRowArray();
        $code = strtoupper(trim((string) ($row['base_currency_code'] ?? '')));

        return $code !== '' ? $code : 'INR';
    }

    /**
     * @param array{items:bool, warehouses:bool, locations:bool, movements:bool, stock_value:bool} $may
     * @return array<string, mixed>
     */
    public function summary(int $cmpId, int $fyId, int $boId, string $today, array $may): array
    {
        $fy = $this->fyRange($cmpId, $fyId);
        $asOn = self::asOnDate($today, $fy['start'], $fy['end']);
        $window = self::movementWindow($asOn, $fy['start'], $fy['end']);

        return [
            'as_on'       => $asOn,
            'fy'          => ['from' => $fy['start'], 'to' => $fy['end']],
            'currency'    => $this->baseCurrency($cmpId),
            'items'       => $this->masterCount('inv_items', $cmpId, $may['items']),
            'warehouses'  => $this->masterCount('inv_warehouses', $cmpId, $may['warehouses']),
            'locations'   => $this->masterCount('inv_locations', $cmpId, $may['locations']),
            'movements'   => $this->movementCount($cmpId, $fyId, $boId, $window, $may['movements']),
            'stock_value' => $this->reconciledStockValue($cmpId, $fyId, $boId, $may['stock_value']),
        ];
    }
}
