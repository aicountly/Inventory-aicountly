<?php

namespace App\Services;

/**
 * Stock quantities: materialised balances (inv_stock_balances) for fast availability, and
 * the authoritative walk (opening + movements) for reports and rebuilds.
 */
class StockBalanceService
{
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
            ->select('COALESCE(SUM(on_hand_qty),0) on_hand, COALESCE(SUM(reserved_qty),0) reserved, COALESCE(SUM(committed_qty),0) committed, COALESCE(SUM(packed_qty),0) packed, COALESCE(SUM(in_transit_qty),0) in_transit, COALESCE(SUM(job_worker_qty),0) job_worker, COALESCE(SUM(quality_hold_qty),0) quality_hold, COALESCE(SUM(damaged_qty),0) damaged, COALESCE(SUM(blocked_qty),0) blocked, COALESCE(SUM(expected_qty),0) expected', false)
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
                ->select($group . ', SUM(on_hand_qty) on_hand, SUM(reserved_qty) reserved, SUM(committed_qty) committed, SUM(packed_qty) packed, SUM(in_transit_qty) in_transit, SUM(job_worker_qty) job_worker, SUM(quality_hold_qty) quality_hold, SUM(damaged_qty) damaged, SUM(blocked_qty) blocked, SUM(expected_qty) expected', false)
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
        $opening = $this->openings->openingQtyMap($cmpId, $fyId, $warehouseId, $itemId);
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
