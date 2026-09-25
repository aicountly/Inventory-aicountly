<?php

namespace App\Services;

/**
 * Stock quantities: materialised balances (inv_stock_balances) for fast availability, and
 * the authoritative walk (opening + movements) for reports and rebuilds.
 */
class StockBalanceService
{
    /**
     * How far below zero an on-hand quantity has to be before it is negative
     * stock rather than rounding dust from a 4-decimal NUMERIC column.
     *
     * One constant because two screens depend on agreeing: the dashboard's
     * negative-stock card counts with it, and the register that card drills to
     * filters with it. A card whose register shows a different set of rows is
     * the failure this is here to prevent.
     */
    public const NEGATIVE_ON_HAND_EPSILON = -0.00005;

    /**
     * Columns the balance register can be ordered by. The register renders a
     * sort header for exactly these (web/src/registers/configs/stockRegisters.tsx).
     */
    public const SORTABLE = [
        'item_name'        => 'i.item_name',
        'item_sku'         => 'i.item_sku',
        'warehouse_id'     => 'w.warehouse_name',
        'warehouse_name'   => 'w.warehouse_name',
        'batch_no'         => 'bt.batch_no',
        'on_hand_qty'      => 'b.on_hand_qty',
        'reserved_qty'     => 'b.reserved_qty',
        'committed_qty'    => 'b.committed_qty',
        'packed_qty'       => 'b.packed_qty',
        'in_transit_qty'   => 'b.in_transit_qty',
        'job_worker_qty'   => 'b.job_worker_qty',
        'quality_hold_qty' => 'b.quality_hold_qty',
        'damaged_qty'      => 'b.damaged_qty',
        'blocked_qty'      => 'b.blocked_qty',
        'expected_qty'     => 'b.expected_qty',
        'available_qty'    => 'available_qty',
        'last_movement_at' => 'b.last_movement_at',
    ];

    /** Is this on-hand quantity below zero, by the tolerance both screens use? */
    public static function isNegativeOnHand(float $onHandQty): bool
    {
        return $onHandQty < self::NEGATIVE_ON_HAND_EPSILON;
    }

    public function __construct(
        protected ?UnitConversionService $units = null,
        protected ?OpeningStockResolver $openings = null,
    ) {
        $this->units ??= new UnitConversionService();
        $this->openings ??= new OpeningStockResolver($this->units);
    }

    /**
     * Apply a signed base-quantity delta to the materialised balance row (insert on first use).
     * $bucket: on_hand | reserved | committed | packed | in_transit | job_worker | quality_hold | damaged | blocked | expected
     */
    public function applyDelta(int $cmpId, int $itemId, ?int $warehouseId, ?int $batchId, string $bucket, float $delta, ?string $movedAt = null): void
    {
        $allowed = ['on_hand', 'reserved', 'committed', 'packed', 'in_transit', 'job_worker', 'quality_hold', 'damaged', 'blocked', 'expected'];
        if (!in_array($bucket, $allowed, true)) {
            throw new \InvalidArgumentException('Unknown balance bucket ' . $bucket);
        }
        if (abs($delta) < 0.00001) {
            return;
        }
        $db = \Config\Database::connect();
        $col = $bucket . '_qty';
        $wh = $warehouseId !== null && $warehouseId > 0 ? $warehouseId : null;
        $batch = $batchId !== null && $batchId > 0 ? $batchId : null;
        $now = date('Y-m-d H:i:s');

        $sql = 'INSERT INTO inv_stock_balances (cmp_id, item_id, warehouse_id, batch_id, ' . $col . ', last_movement_at, updated_at)'
            . ' VALUES (?, ?, ?, ?, ?, ?, ?)'
            . ' ON CONFLICT (cmp_id, item_id, COALESCE(warehouse_id, 0), COALESCE(batch_id, 0))'
            . ' DO UPDATE SET ' . $col . ' = inv_stock_balances.' . $col . ' + EXCLUDED.' . $col
            . ', last_movement_at = COALESCE(EXCLUDED.last_movement_at, inv_stock_balances.last_movement_at), updated_at = EXCLUDED.updated_at';
        $db->query($sql, [$cmpId, $itemId, $wh, $batch, round($delta, 4), $bucket === 'on_hand' ? ($movedAt ?? $now) : null, $now]);
    }

    /**
     * @return array{on_hand: float, available: float, reserved: float, committed: float, packed: float, in_transit: float, job_worker: float, quality_hold: float, damaged: float, blocked: float, expected: float}
     */
    public function balance(int $cmpId, int $itemId, ?int $warehouseId = null, ?int $batchId = null): array
    {
        $db = \Config\Database::connect();
        $b = $db->table('inv_stock_balances')
            ->select('COALESCE(SUM(on_hand_qty),0) on_hand, COALESCE(SUM(reserved_qty),0) reserved, COALESCE(SUM(committed_qty),0) AS committed, COALESCE(SUM(packed_qty),0) packed, COALESCE(SUM(in_transit_qty),0) in_transit, COALESCE(SUM(job_worker_qty),0) job_worker, COALESCE(SUM(quality_hold_qty),0) quality_hold, COALESCE(SUM(damaged_qty),0) damaged, COALESCE(SUM(blocked_qty),0) blocked, COALESCE(SUM(expected_qty),0) expected', false)
            ->where('cmp_id', $cmpId)->where('item_id', $itemId);
        if ($warehouseId !== null && $warehouseId > 0) {
            $b->where('warehouse_id', $warehouseId);
        }
        if ($batchId !== null && $batchId > 0) {
            $b->where('batch_id', $batchId);
        }
        $row = $b->get()->getRowArray() ?: [];
        $out = [];
        foreach (['on_hand', 'reserved', 'committed', 'packed', 'in_transit', 'job_worker', 'quality_hold', 'damaged', 'blocked', 'expected'] as $k) {
            $out[$k] = round((float) ($row[$k] ?? 0), 4);
        }
        $out['available'] = self::availableFrom($out);

        return $out;
    }

    /** @param array<string, float> $b */
    public static function availableFrom(array $b): float
    {
        return round((float) $b['on_hand'] - (float) $b['reserved'] - (float) $b['packed'] - (float) $b['quality_hold'] - (float) $b['damaged'] - (float) $b['blocked'], 4);
    }

    /**
     * Bulk availability for POS / order entry: rows per (item, warehouse[, batch]).
     *
     * @param list<int> $itemIds
     * @return list<array<string, mixed>>
     */
    public function availability(int $cmpId, array $itemIds, ?int $warehouseId = null, bool $byBatch = false): array
    {
        $db = \Config\Database::connect();
        $itemIds = array_values(array_unique(array_filter(array_map('intval', $itemIds), static fn ($i) => $i > 0)));
        if ($itemIds === []) {
            return [];
        }
        $out = [];
        foreach (array_chunk($itemIds, 500) as $chunk) {
            $group = $byBatch ? 'item_id, warehouse_id, batch_id' : 'item_id, warehouse_id';
            $b = $db->table('inv_stock_balances')
                ->select($group . ', SUM(on_hand_qty) on_hand, SUM(reserved_qty) reserved, SUM(committed_qty) AS committed, SUM(packed_qty) packed, SUM(in_transit_qty) in_transit, SUM(job_worker_qty) job_worker, SUM(quality_hold_qty) quality_hold, SUM(damaged_qty) damaged, SUM(blocked_qty) blocked, SUM(expected_qty) expected', false)
                ->where('cmp_id', $cmpId)->whereIn('item_id', $chunk)
                ->groupBy($group, false);
            if ($warehouseId !== null && $warehouseId > 0) {
                $b->where('warehouse_id', $warehouseId);
            }
            foreach ($b->get()->getResultArray() as $r) {
                $row = ['item_id' => (int) $r['item_id'], 'warehouse_id' => isset($r['warehouse_id']) ? (int) $r['warehouse_id'] : null];
                if ($byBatch) {
                    $row['batch_id'] = isset($r['batch_id']) ? (int) $r['batch_id'] : null;
                }
                foreach (['on_hand', 'reserved', 'committed', 'packed', 'in_transit', 'job_worker', 'quality_hold', 'damaged', 'blocked', 'expected'] as $k) {
                    $row[$k] = round((float) ($r[$k] ?? 0), 4);
                }
                $row['available'] = self::availableFrom($row);
                $row['projected'] = round($row['on_hand'] + $row['expected'] - $row['reserved'] - $row['committed'], 4);
                $out[] = $row;
            }
        }

        return $out;
    }

    /**
     * Authoritative closing quantities as at a date from opening + posted movements, base units,
     * keyed by (item, warehouse). Used by valuation reports, reconciliation and the balance rebuild.
     *
     * @return array<string, array{item_id:int, warehouse_id:?int, opening_qty:float, in_qty:float, out_qty:float, closing_qty:float}>
     */
    public function closingQuantities(int $cmpId, int $fyId, int $boId, ?string $from, ?string $to, ?int $itemId = null, ?int $warehouseId = null): array
    {
        $this->units->warmCompany($cmpId);
        // Same branch on both sides: movements below are filtered by bo_id, so the opening they
        // build on must be this branch's too.
        $opening = $this->openings->openingQtyMap($cmpId, $fyId, $warehouseId, $itemId, $boId > 0 ? $boId : null);
        $out = [];
        foreach ($opening as $key => $qty) {
            [$i, $w] = array_map('intval', explode(':', $key));
            $out[$key] = ['item_id' => $i, 'warehouse_id' => $w > 0 ? $w : null, 'opening_qty' => $qty, 'in_qty' => 0.0, 'out_qty' => 0.0, 'closing_qty' => $qty];
        }
        // Movement before $from rolls into opening; movement within [from,to] is in/out.
        foreach ($this->aggregateMovements($cmpId, $fyId, $boId, null, $to, $itemId, $warehouseId) as $key => $agg) {
            if (!isset($out[$key])) {
                [$i, $w] = array_map('intval', explode(':', $key));
                $out[$key] = ['item_id' => $i, 'warehouse_id' => $w > 0 ? $w : null, 'opening_qty' => 0.0, 'in_qty' => 0.0, 'out_qty' => 0.0, 'closing_qty' => 0.0];
            }
            $out[$key]['opening_qty'] = round($out[$key]['opening_qty'] + $agg['before_in'] - $agg['before_out'], 4);
            $out[$key]['in_qty'] = round($agg['in'], 4);
            $out[$key]['out_qty'] = round($agg['out'], 4);
            $out[$key]['closing_qty'] = round($out[$key]['opening_qty'] + $agg['in'] - $agg['out'], 4);
        }
        foreach ($out as $key => $row) {
            $row['closing_qty'] = round($row['opening_qty'] + $row['in_qty'] - $row['out_qty'], 4);
            $out[$key] = $row;
        }

        return array_filter($out, static fn ($r) => abs($r['opening_qty']) > 0.00001 || abs($r['in_qty']) > 0.00001 || abs($r['out_qty']) > 0.00001);
    }

    /**
     * @return array<string, array{before_in: float, before_out: float, in: float, out: float}>
     */
    private function aggregateMovements(int $cmpId, int $fyId, int $boId, ?string $from, ?string $to, ?int $itemId, ?int $warehouseId): array
    {
        $db = \Config\Database::connect();
        $b = $db->table('inv_stock_movements m')
            ->select("m.item_id, COALESCE(m.warehouse_id,0) wh, CASE WHEN m.movement_date < " . $db->escape($from ?? '0001-01-01') . " THEN 'before' ELSE 'period' END AS bucket, SUM(CASE WHEN m.qty > 0 THEN m.qty ELSE 0 END) in_qty, SUM(CASE WHEN m.qty < 0 THEN -m.qty ELSE 0 END) out_qty", false)
            ->where('m.cmp_id', $cmpId)->where('m.fy_id', $fyId)
            ->groupBy('m.item_id, COALESCE(m.warehouse_id,0), bucket', false);
        if ($boId > 0) {
            $b->where('m.bo_id', $boId);
        }
        if ($to !== null && $to !== '') {
            $b->where('m.movement_date <=', $to);
        }
        if ($itemId) {
            $b->where('m.item_id', $itemId);
        }
        if ($warehouseId) {
            $b->where('m.warehouse_id', $warehouseId);
        }
        $out = [];
        foreach ($b->get()->getResultArray() as $r) {
            $key = (int) $r['item_id'] . ':' . (int) $r['wh'];
            $out[$key] ??= ['before_in' => 0.0, 'before_out' => 0.0, 'in' => 0.0, 'out' => 0.0];
            if (($r['bucket'] ?? 'period') === 'before') {
                $out[$key]['before_in'] += (float) $r['in_qty'];
                $out[$key]['before_out'] += (float) $r['out_qty'];
            } else {
                $out[$key]['in'] += (float) $r['in_qty'];
                $out[$key]['out'] += (float) $r['out_qty'];
            }
        }

        return $out;
    }

    /**
     * The stock balance register: item x warehouse x batch with every bucket behind "on hand".
     *
     * Branch scope travels through the warehouse, because inv_stock_balances has no bo_id of its
     * own and a warehouse belongs to exactly one branch. A balance with no warehouse, or one in a
     * warehouse that belongs to no branch, is company-wide and stays in view — the same predicate
     * the batch, serial and near-expiry registers already apply.
     *
     * @param array{warehouse_id?: ?int, item_id?: ?int, batch_id?: ?int, nonzero?: bool, negative?: bool, sort?: string, order?: string} $filters
     *
     * @return array{rows: list<array<string, mixed>>, total: int}
     */
    public function listBalances(int $cmpId, int $boId, array $filters, int $limit, int $offset): array
    {
        $db = \Config\Database::connect();
        $b = $db->table('inv_stock_balances b')
            ->select('b.*, i.item_name, i.item_sku, w.warehouse_name, bt.batch_no, (b.on_hand_qty - b.reserved_qty - b.packed_qty - b.quality_hold_qty - b.damaged_qty - b.blocked_qty) AS available_qty', false)
            ->join('inv_items i', 'i.item_id = b.item_id', 'left')
            ->join('inv_warehouses w', 'w.warehouse_id = b.warehouse_id', 'left')
            ->join('inv_batches bt', 'bt.batch_id = b.batch_id', 'left')
            ->where('b.cmp_id', $cmpId);
        if ($boId > 0) {
            $b->groupStart()->where('b.warehouse_id', null)->orWhere('w.bo_id', 0)->orWhere('w.bo_id', $boId)->groupEnd();
        }
        if (!empty($filters['warehouse_id'])) {
            $b->where('b.warehouse_id', (int) $filters['warehouse_id']);
        }
        if (!empty($filters['item_id'])) {
            $b->where('b.item_id', (int) $filters['item_id']);
        }
        // The grid has a batch column; "which of these rows is batch B-102" was
        // a question it could show and not answer.
        if (!empty($filters['batch_id'])) {
            $b->where('b.batch_id', (int) $filters['batch_id']);
        }
        if (!empty($filters['nonzero'])) {
            $b->groupStart()->where('b.on_hand_qty !=', 0)->orWhere('b.reserved_qty !=', 0)->orWhere('b.packed_qty !=', 0)->orWhere('b.job_worker_qty !=', 0)->groupEnd();
        }
        if (!empty($filters['negative'])) {
            $b->where('b.on_hand_qty <', self::NEGATIVE_ON_HAND_EPSILON);
        }
        $total = (clone $b)->countAllResults(false);
        $order = strtoupper((string) ($filters['order'] ?? 'ASC')) === 'DESC' ? 'DESC' : 'ASC';
        $rows = $b->orderBy(self::SORTABLE[(string) ($filters['sort'] ?? '')] ?? 'i.item_name', $order)
            // A stable tail, so paging through 4,000 rows never repeats or skips one.
            ->orderBy('i.item_name', 'ASC')->orderBy('w.warehouse_name', 'ASC')->orderBy('b.balance_id', 'ASC')
            ->limit($limit, $offset)->get()->getResultArray();

        return ['rows' => $rows, 'total' => $total];
    }

    /**
     * The dashboard's negative-stock figures: items whose on-hand across the branch is below
     * zero, and the individual balance rows behind them.
     *
     * Same table, same tolerance and same branch predicate as listBalances(), because the card
     * drills straight into that register with ?negative=1: the row count is what the reader
     * sees listed there, down to the batch, so it is counted the same way and not grouped.
     *
     * @return array{items: int, rows: int}
     */
    public function negativeStockCounts(int $cmpId, int $boId): array
    {
        $db = \Config\Database::connect();
        $scope = 'b.cmp_id = ?';
        $binds = [$cmpId];
        if ($boId > 0) {
            $scope .= ' AND (b.warehouse_id IS NULL OR w.bo_id = 0 OR w.bo_id = ?)';
            $binds[] = $boId;
        }
        $from = ' FROM inv_stock_balances b LEFT JOIN inv_warehouses w ON w.warehouse_id = b.warehouse_id WHERE ' . $scope;
        $binds[] = self::NEGATIVE_ON_HAND_EPSILON;
        $items = $db->query('SELECT COUNT(*) AS cnt FROM (SELECT b.item_id' . $from . ' GROUP BY b.item_id HAVING SUM(b.on_hand_qty) < ?) t', $binds)->getRowArray() ?: [];
        $rows = $db->query('SELECT COUNT(*) AS cnt' . $from . ' AND b.on_hand_qty < ?', $binds)->getRowArray() ?: [];

        return ['items' => (int) ($items['cnt'] ?? 0), 'rows' => (int) ($rows['cnt'] ?? 0)];
    }

    /**
     * Rebuild inv_stock_balances.on_hand for a company from openings (all years' inception + carried,
     * resolved per FY) and movements. Status buckets are preserved. Returns the number of rows written.
     *
     * Opening handling: on_hand as of now = Σ over financial years is NOT how Books works (each FY
     * re-opens on carry-forward). The materialised on_hand therefore equals the CURRENT FY's opening
     * + its posted movements; the current FY is the latest fy_id with movements or openings, unless
     * $fyId is given.
     */
    public function rebuildOnHand(int $cmpId, ?int $fyId = null): int
    {
        $db = \Config\Database::connect();
        if ($fyId === null) {
            $fyId = $this->latestFyId($cmpId);
        }
        $rows = $this->closingQuantities($cmpId, $fyId, 0, null, null);
        $db->transStart();
        $db->table('inv_stock_balances')->where('cmp_id', $cmpId)->where('batch_id', null)->update(['on_hand_qty' => 0, 'updated_at' => date('Y-m-d H:i:s')]);
        $n = 0;
        foreach ($rows as $r) {
            $this->applyDelta($cmpId, $r['item_id'], $r['warehouse_id'], null, 'on_hand', $r['closing_qty']);
            $n++;
        }
        $db->transComplete();

        return $n;
    }

    public function latestFyId(int $cmpId): int
    {
        $db = \Config\Database::connect();
        $m = $db->table('inv_stock_movements')->selectMax('fy_id', 'f')->where('cmp_id', $cmpId)->get()->getRowArray();
        $o = $db->table('inv_item_openings')->selectMax('fy_id', 'f')->where('cmp_id', $cmpId)->get()->getRowArray();

        return max((int) ($m['f'] ?? 0), (int) ($o['f'] ?? 0));
    }
}
