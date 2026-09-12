<?php

namespace App\Services;

use App\Exceptions\InventoryException;

/**
 * Read-only inventory reports. Every method is company scoped (cmp_id from the validated
 * context), financial-year scoped where the underlying data is (movements, openings), and
 * branch scoped when bo_id > 0. Quantities are base units; values reconcile to the same
 * replay arithmetic Books uses (ValuationReplayService).
 *
 * Long lists are paginated: SQL LIMIT/OFFSET where the report is a plain query, in memory
 * where the rows come out of the opening + movement walk (StockBalanceService). Either way
 * the method returns {rows, total, summary}.
 *
 * The bucketing / classification helpers at the bottom are pure static functions so the
 * arithmetic can be unit tested without a database.
 */
class InventoryReportService
{
    public const AGE_BUCKETS = ['0_30', '31_60', '61_90', '91_180', '180_plus'];
    public const AGE_BUCKET_LABELS = ['0_30' => '0-30 days', '31_60' => '31-60 days', '61_90' => '61-90 days', '91_180' => '91-180 days', '180_plus' => '180+ days'];
    public const MOVEMENT_CLASSES = ['fast', 'slow', 'non_moving', 'dead'];
    public const SERIAL_STOCK_STATUSES = ['in_stock', 'reserved', 'in_transit', 'damaged'];

    private const EPS = 0.00005;

    public function __construct(
        protected ?StockBalanceService $balances = null,
        protected ?ValuationReplayService $valuation = null,
        protected ?ValuationEngine $engine = null,
        protected ?InventorySettingsService $settings = null,
        protected ?OpeningStockResolver $openings = null,
        protected ?UnitConversionService $units = null,
    ) {
        $this->units ??= new UnitConversionService();
        $this->openings ??= new OpeningStockResolver($this->units);
        $this->settings ??= new InventorySettingsService();
        $this->balances ??= new StockBalanceService($this->units, $this->openings);
        $this->engine ??= new ValuationEngine($this->settings, $this->units, $this->openings);
        $this->valuation ??= new ValuationReplayService($this->units, $this->openings, $this->balances, $this->engine, $this->settings);
    }

    // ------------------------------------------------------------------ stock summary

    /**
     * Per item: opening, in, out, closing quantity for [from, to] plus unit cost and closing value.
     *
     * @param array{item_grp_id?:int, stock_cat_id?:int, warehouse_id?:int, item_id?:int, from?:?string, to?:?string, nonzero?:bool, sort?:string, order?:string} $f
     * @return array{rows: list<array<string, mixed>>, total: int, summary: array<string, mixed>}
     */
    public function stockSummary(int $cmpId, int $fyId, int $boId, array $f, int $limit, int $offset): array
    {
        $to = $f['to'] ?? null ?: date('Y-m-d');
        $from = $f['from'] ?? null ?: null;
        $itemId = (int) ($f['item_id'] ?? 0) ?: null;
        $wh = (int) ($f['warehouse_id'] ?? 0) ?: null;
        if ($from !== null && $from > $to) {
            throw InventoryException::validation('from must not be after to', ['from' => $from, 'to' => $to]);
        }

        $perItem = $this->periodQuantitiesByItem($cmpId, $fyId, $boId, $from, $to, $itemId, $wh);
        $items = $this->itemMeta($cmpId, array_keys($perItem));
        $perItem = $this->applyItemFilters($perItem, $items, $f);
        if (!empty($f['nonzero'])) {
            $perItem = array_filter($perItem, static fn ($r) => abs($r['closing_qty']) > self::EPS);
        }
        $ids = array_keys($perItem);
        $costs = $this->valuation->unitCostsForItems($cmpId, $fyId, $ids, $to, 'AS_PER_MASTER', $boId, $wh);

        $rows = [];
        $summary = ['items' => 0, 'opening_qty' => 0.0, 'in_qty' => 0.0, 'out_qty' => 0.0, 'closing_qty' => 0.0, 'closing_value' => 0.0];
        foreach ($perItem as $id => $q) {
            $cost = round((float) ($costs[$id]['unit_cost'] ?? 0), 4);
            $row = $this->itemColumns($items[$id] ?? null, $id) + [
                'opening_qty'   => $q['opening_qty'],
                'in_qty'        => $q['in_qty'],
                'out_qty'       => $q['out_qty'],
                'closing_qty'   => $q['closing_qty'],
                'unit_cost'     => $cost,
                'closing_value' => round($q['closing_qty'] * $cost, 4),
                'valuation_method_applied' => $costs[$id]['method'] ?? null,
            ];
            $rows[] = $row;
            $summary['items']++;
            foreach (['opening_qty', 'in_qty', 'out_qty', 'closing_qty', 'closing_value'] as $k) {
                $summary[$k] += $row[$k];
            }
        }
        foreach (['opening_qty', 'in_qty', 'out_qty', 'closing_qty', 'closing_value'] as $k) {
            $summary[$k] = round($summary[$k], 4);
        }
        $summary['from'] = $from;
        $summary['to'] = $to;
        self::sortRows($rows, $f['sort'] ?? 'item_name', $f['order'] ?? 'ASC', ['item_name', 'item_sku', 'closing_qty', 'closing_value', 'out_qty', 'in_qty', 'item_id']);

        return ['rows' => array_slice($rows, $offset, $limit), 'total' => count($rows), 'summary' => $summary];
    }

    /**
     * Opening / in / out / closing per item for [from, to], built on StockBalanceService::closingQuantities:
     * the walk as at `to` gives cumulative figures; the walk as at the day before `from` gives the opening.
     *
     * @return array<int, array{opening_qty: float, in_qty: float, out_qty: float, closing_qty: float}>
     */
    private function periodQuantitiesByItem(int $cmpId, int $fyId, int $boId, ?string $from, string $to, ?int $itemId, ?int $wh): array
    {
        $end = $this->sumByItem($this->balances->closingQuantities($cmpId, $fyId, $boId, null, $to, $itemId, $wh));
        $before = $from !== null ? $this->sumByItem($this->balances->closingQuantities($cmpId, $fyId, $boId, null, self::dayBefore($from), $itemId, $wh)) : [];
        $out = [];
        foreach ($end as $id => $e) {
            $b = $before[$id] ?? null;
            $opening = $from === null ? $e['opening_qty'] : ($b['closing_qty'] ?? 0.0);
            $in = $from === null ? $e['in_qty'] : $e['in_qty'] - ($b['in_qty'] ?? 0.0);
            $outQ = $from === null ? $e['out_qty'] : $e['out_qty'] - ($b['out_qty'] ?? 0.0);
            $out[$id] = [
                'opening_qty' => round($opening, 4),
                'in_qty'      => round($in, 4),
                'out_qty'     => round($outQ, 4),
                'closing_qty' => round($opening + $in - $outQ, 4),
            ];
        }

        return $out;
    }

    /**
     * @param array<string, array{item_id:int, opening_qty:float, in_qty:float, out_qty:float, closing_qty:float}> $rows
     * @return array<int, array{opening_qty: float, in_qty: float, out_qty: float, closing_qty: float}>
     */
    private function sumByItem(array $rows): array
    {
        $out = [];
        foreach ($rows as $r) {
            $id = (int) $r['item_id'];
            $out[$id] ??= ['opening_qty' => 0.0, 'in_qty' => 0.0, 'out_qty' => 0.0, 'closing_qty' => 0.0];
            foreach (['opening_qty', 'in_qty', 'out_qty', 'closing_qty'] as $k) {
                $out[$id][$k] += (float) $r[$k];
            }
        }

        return $out;
    }

    // ------------------------------------------------------------------ item ledger

    /**
     * Item ledger: opening balance as at `from`, every posted movement in [from, to] with a running
     * balance, and period totals. Running balances are computed with a window function over the
     * whole filtered range, so a page deep into the ledger still carries the right balance.
     *
     * @return array{rows: list<array<string, mixed>>, total: int, summary: array<string, mixed>, item: array<string, mixed>}
     */
    public function itemLedger(int $cmpId, int $fyId, int $boId, int $itemId, ?int $warehouseId, ?string $from, ?string $to, int $limit, int $offset, string $order = 'ASC'): array
    {
        if ($itemId <= 0) {
            throw InventoryException::validation('item_id is required');
        }
        if ($from !== null && $to !== null && $from > $to) {
            throw InventoryException::validation('from must not be after to', ['from' => $from, 'to' => $to]);
        }
        $item = $this->itemMeta($cmpId, [$itemId])[$itemId] ?? null;
        if ($item === null) {
            throw InventoryException::notFound('Item not found');
        }
        $db = \Config\Database::connect();
        $wh = $warehouseId !== null && $warehouseId > 0 ? $warehouseId : null;

        // Opening as at `from`: FY opening (base units) + movements dated before `from`.
        $openingQty = array_sum($this->openings->openingQtyMap($cmpId, $fyId, $wh, $itemId));
        $openingValue = 0.0;
        foreach ($this->openings->openingLayersByItem($cmpId, $fyId, [$itemId])[$itemId] ?? [] as $layer) {
            $openingValue += (float) $layer['qty_remaining'] * (float) $layer['unit_cost'];
        }
        if ($wh !== null) {
            $openingValue = 0.0; // inception openings carry no warehouse split; value only meaningful company-wide
            foreach ($this->openings->openingLines($cmpId, $fyId, [$itemId]) as $line) {
                if ((int) ($line['warehouse_id'] ?? 0) !== $wh) {
                    continue;
                }
                $layer = OpeningStockResolver::layerFromOpeningLine($line);
                if ($layer !== null) {
                    $openingValue += $layer['qty_remaining'] * $layer['unit_cost'];
                }
            }
        }
        [$scopeSql, $scopeBinds] = $this->movementScope($cmpId, $fyId, $boId, $itemId, $wh);
        if ($from !== null) {
            $pre = $db->query('SELECT COALESCE(SUM(m.qty),0) AS q, COALESCE(SUM(m.value),0) AS v FROM inv_stock_movements m WHERE ' . $scopeSql . ' AND m.movement_date < ?', array_merge($scopeBinds, [$from]))->getRowArray();
            $openingQty += (float) ($pre['q'] ?? 0);
            $openingValue += (float) ($pre['v'] ?? 0);
        }
        $openingQty = round($openingQty, 4);
        $openingValue = round($openingValue, 4);

        $rangeSql = $scopeSql;
        $rangeBinds = $scopeBinds;
        if ($from !== null) {
            $rangeSql .= ' AND m.movement_date >= ?';
            $rangeBinds[] = $from;
        }
        if ($to !== null) {
            $rangeSql .= ' AND m.movement_date <= ?';
            $rangeBinds[] = $to;
        }
        $tot = $db->query('SELECT COUNT(*) AS n, COALESCE(SUM(CASE WHEN m.qty > 0 THEN m.qty ELSE 0 END),0) AS in_qty, COALESCE(SUM(CASE WHEN m.qty < 0 THEN -m.qty ELSE 0 END),0) AS out_qty, COALESCE(SUM(CASE WHEN m.value > 0 THEN m.value ELSE 0 END),0) AS in_value, COALESCE(SUM(CASE WHEN m.value < 0 THEN -m.value ELSE 0 END),0) AS out_value FROM inv_stock_movements m WHERE ' . $rangeSql, $rangeBinds)->getRowArray();
        $total = (int) ($tot['n'] ?? 0);

        $seq = 'm.movement_date ASC, m.sequence_no ASC, m.document_id ASC, m.line_id ASC, m.movement_id ASC';
        $dir = strtoupper($order) === 'DESC' ? 'DESC' : 'ASC';
        $sql = 'SELECT m.movement_id, m.movement_uuid, m.movement_date, m.sequence_no, m.document_id, m.line_id, m.document_type, m.warehouse_id, m.location_id, m.batch_id, m.direction, m.qty, m.unit_cost, m.value, m.movement_kind, m.reversal_of_movement_id, m.created_at,'
            . ' d.document_no, d.status AS document_status, d.party_ref, d.party_name, d.source_app, d.source_document_type, d.source_document_id, d.source_document_no, d.narration,'
            . ' w.warehouse_name, bt.batch_no, l.qty AS line_qty, l.unit_id AS line_unit_id, u.unit_symbol AS line_unit_symbol, l.description AS line_description,'
            . ' SUM(m.qty) OVER (ORDER BY ' . $seq . ' ROWS UNBOUNDED PRECEDING) AS running_qty,'
            . ' SUM(COALESCE(m.value,0)) OVER (ORDER BY ' . $seq . ' ROWS UNBOUNDED PRECEDING) AS running_value'
            . ' FROM inv_stock_movements m'
            . ' LEFT JOIN inv_documents d ON d.document_id = m.document_id'
            . ' LEFT JOIN inv_document_lines l ON l.line_id = m.line_id'
            . ' LEFT JOIN inv_uom u ON u.unit_id = l.unit_id'
            . ' LEFT JOIN inv_warehouses w ON w.warehouse_id = m.warehouse_id'
            . ' LEFT JOIN inv_batches bt ON bt.batch_id = m.batch_id'
            . ' WHERE ' . $rangeSql
            . ' ORDER BY m.movement_date ' . $dir . ', m.sequence_no ' . $dir . ', m.document_id ' . $dir . ', m.line_id ' . $dir . ', m.movement_id ' . $dir
            . ' LIMIT ? OFFSET ?';
        $rows = [];
        foreach ($db->query($sql, array_merge($rangeBinds, [$limit, $offset]))->getResultArray() as $r) {
            $qty = round((float) $r['qty'], 4);
            $rows[] = [
                'movement_id'        => (int) $r['movement_id'],
                'movement_uuid'      => $r['movement_uuid'],
                'movement_date'      => $r['movement_date'],
                'document_id'        => (int) $r['document_id'],
                'line_id'            => (int) $r['line_id'],
                'document_type'      => $r['document_type'],
                'document_type_label'=> \Config\DocumentTypeRegistry::get((string) $r['document_type'])['label'] ?? $r['document_type'],
                'document_no'        => $r['document_no'],
                'document_status'    => $r['document_status'],
                'source_app'         => $r['source_app'],
                'source_document_type' => $r['source_document_type'],
                'source_document_id' => isset($r['source_document_id']) ? (int) $r['source_document_id'] : null, 'source_document_no' => $r['source_document_no'],
                'party_ref'          => isset($r['party_ref']) ? (int) $r['party_ref'] : null,
                'party_name'         => $r['party_name'],
                'narration'          => $r['narration'],
                'warehouse_id'       => isset($r['warehouse_id']) ? (int) $r['warehouse_id'] : null,
                'warehouse_name'     => $r['warehouse_name'],
                'location_id'        => isset($r['location_id']) ? (int) $r['location_id'] : null,
                'batch_id'           => isset($r['batch_id']) ? (int) $r['batch_id'] : null,
                'batch_no'           => $r['batch_no'],
                'direction'          => $r['direction'],
                'movement_kind'      => $r['movement_kind'],
                'reversal_of_movement_id' => isset($r['reversal_of_movement_id']) ? (int) $r['reversal_of_movement_id'] : null,
                'in_qty'             => $qty > 0 ? $qty : 0.0,
                'out_qty'            => $qty < 0 ? round(-$qty, 4) : 0.0,
                'qty'                => $qty,
                'line_qty'           => isset($r['line_qty']) ? round((float) $r['line_qty'], 4) : null,
                'line_unit_id'       => isset($r['line_unit_id']) ? (int) $r['line_unit_id'] : null,
                'line_unit_symbol'   => $r['line_unit_symbol'],
                'line_description'   => $r['line_description'],
                'unit_cost'          => isset($r['unit_cost']) ? round((float) $r['unit_cost'], 4) : null,
                'value'              => isset($r['value']) ? round((float) $r['value'], 4) : null,
                'balance_qty'        => round($openingQty + (float) $r['running_qty'], 4),
                'balance_value'      => round($openingValue + (float) $r['running_value'], 4),
                'created_at'         => $r['created_at'],
            ];
        }
        $inQty = round((float) $tot['in_qty'], 4);
        $outQty = round((float) $tot['out_qty'], 4);
        $summary = [
            'opening_qty'   => $openingQty,
            'opening_value' => $openingValue,
            'in_qty'        => $inQty,
            'out_qty'       => $outQty,
            'in_value'      => round((float) $tot['in_value'], 4),
            'out_value'     => round((float) $tot['out_value'], 4),
            'closing_qty'   => round($openingQty + $inQty - $outQty, 4),
            'closing_value' => round($openingValue + (float) $tot['in_value'] - (float) $tot['out_value'], 4),
            'from'          => $from,
            'to'            => $to,
            'warehouse_id'  => $wh,
        ];

        return ['rows' => $rows, 'total' => $total, 'summary' => $summary, 'item' => $this->itemColumns($item, $itemId)];
    }

    /** @return array{0: string, 1: list<mixed>} */
    private function movementScope(int $cmpId, int $fyId, int $boId, int $itemId, ?int $wh): array
    {
        $sql = 'm.cmp_id = ? AND m.fy_id = ? AND m.item_id = ?';
        $binds = [$cmpId, $fyId, $itemId];
        if ($boId > 0) {
            $sql .= ' AND m.bo_id = ?';
            $binds[] = $boId;
        }
        if ($wh !== null) {
            $sql .= ' AND m.warehouse_id = ?';
            $binds[] = $wh;
        }

        return [$sql, $binds];
    }

    // ------------------------------------------------------------------ warehouse stock

    /**
     * Closing quantity and value per item per warehouse as at `to`.
     *
     * @param array{item_grp_id?:int, stock_cat_id?:int, warehouse_id?:int, item_id?:int, to?:?string, nonzero?:bool, sort?:string, order?:string} $f
     * @return array{rows: list<array<string, mixed>>, total: int, summary: array<string, mixed>}
     */
    public function warehouseStock(int $cmpId, int $fyId, int $boId, array $f, int $limit, int $offset): array
    {
        $to = $f['to'] ?? null ?: date('Y-m-d');
        $itemId = (int) ($f['item_id'] ?? 0) ?: null;
        $wh = (int) ($f['warehouse_id'] ?? 0) ?: null;
        $qtyRows = $this->balances->closingQuantities($cmpId, $fyId, $boId, null, $to, $itemId, $wh);
        if (!empty($f['nonzero'])) {
            $qtyRows = array_filter($qtyRows, static fn ($r) => abs($r['closing_qty']) > self::EPS);
        }
        $ids = array_values(array_unique(array_map(static fn ($r) => (int) $r['item_id'], $qtyRows)));
        $items = $this->itemMeta($cmpId, $ids);
        $keep = $this->applyItemFilters(array_fill_keys($ids, true), $items, $f);
        $qtyRows = array_filter($qtyRows, static fn ($r) => isset($keep[(int) $r['item_id']]));
        $ids = array_keys($keep);
        $warehouses = $this->warehouseMeta($cmpId);

        // Unit cost: company-scope valuation -> one cost per item; warehouse-scope -> one replay per warehouse.
        $costs = [];
        if ($this->settings->valuationScope($cmpId) === 'warehouse') {
            $byWh = [];
            foreach ($qtyRows as $r) {
                $byWh[(int) ($r['warehouse_id'] ?? 0)][] = (int) $r['item_id'];
            }
            foreach ($byWh as $w => $whItems) {
                $costs[$w] = $this->valuation->unitCostsForItems($cmpId, $fyId, $whItems, $to, 'AS_PER_MASTER', $boId, $w > 0 ? $w : null);
            }
        } else {
            $company = $this->valuation->unitCostsForItems($cmpId, $fyId, $ids, $to, 'AS_PER_MASTER', $boId, $wh);
            $costs = ['*' => $company];
        }

        $rows = [];
        $summary = ['rows' => 0, 'closing_qty' => 0.0, 'closing_value' => 0.0, 'by_warehouse' => [], 'to' => $to];
        foreach ($qtyRows as $r) {
            $id = (int) $r['item_id'];
            $w = (int) ($r['warehouse_id'] ?? 0);
            $c = $costs['*'][$id] ?? $costs[$w][$id] ?? ['unit_cost' => 0.0, 'method' => null];
            $cost = round((float) $c['unit_cost'], 4);
            $value = round($r['closing_qty'] * $cost, 4);
            $rows[] = $this->itemColumns($items[$id] ?? null, $id) + [
                'warehouse_id'   => $w > 0 ? $w : null,
                'warehouse_name' => $warehouses[$w]['warehouse_name'] ?? ($w > 0 ? null : '(no warehouse)'),
                'warehouse_code' => $warehouses[$w]['warehouse_code'] ?? null,
                'opening_qty'    => $r['opening_qty'],
                'in_qty'         => $r['in_qty'],
                'out_qty'        => $r['out_qty'],
                'closing_qty'    => $r['closing_qty'],
                'unit_cost'      => $cost,
                'closing_value'  => $value,
                'valuation_method_applied' => $c['method'] ?? null,
            ];
            $summary['rows']++;
            $summary['closing_qty'] += $r['closing_qty'];
            $summary['closing_value'] += $value;
            $summary['by_warehouse'][$w] ??= ['warehouse_id' => $w > 0 ? $w : null, 'warehouse_name' => $warehouses[$w]['warehouse_name'] ?? null, 'closing_qty' => 0.0, 'closing_value' => 0.0];
            $summary['by_warehouse'][$w]['closing_qty'] = round($summary['by_warehouse'][$w]['closing_qty'] + $r['closing_qty'], 4);
            $summary['by_warehouse'][$w]['closing_value'] = round($summary['by_warehouse'][$w]['closing_value'] + $value, 4);
        }
        $summary['closing_qty'] = round($summary['closing_qty'], 4);
        $summary['closing_value'] = round($summary['closing_value'], 4);
        $summary['by_warehouse'] = array_values($summary['by_warehouse']);
        self::sortRows($rows, $f['sort'] ?? 'item_name', $f['order'] ?? 'ASC', ['item_name', 'warehouse_name', 'closing_qty', 'closing_value', 'item_id'], 'warehouse_name');

        return ['rows' => array_slice($rows, $offset, $limit), 'total' => count($rows), 'summary' => $summary];
    }

    // ------------------------------------------------------------------ batch stock

    /**
     * Materialised balances by batch (inv_stock_balances rows with a batch) with the batch's expiry.
     *
     * @param array{item_id?:int, warehouse_id?:int, batch_id?:int, item_grp_id?:int, stock_cat_id?:int, status?:list<string>, expiring_before?:?string, nonzero?:bool, by_warehouse?:bool, sort?:string, order?:string} $f
     * @return array{rows: list<array<string, mixed>>, total: int, summary: array<string, mixed>}
     */
    public function batchStock(int $cmpId, int $fyId, int $boId, array $f, int $limit, int $offset): array
    {
        $db = \Config\Database::connect();
        $byWh = !array_key_exists('by_warehouse', $f) || !empty($f['by_warehouse']);
        $where = 'b.cmp_id = ? AND b.batch_id IS NOT NULL AND bt.cmp_id = b.cmp_id';
        $binds = [$cmpId];
        $this->appendIntFilter($where, $binds, 'b.item_id', $f['item_id'] ?? null);
        $this->appendIntFilter($where, $binds, 'b.warehouse_id', $f['warehouse_id'] ?? null);
        $this->appendIntFilter($where, $binds, 'b.batch_id', $f['batch_id'] ?? null);
        $this->appendIntFilter($where, $binds, 'i.item_grp_id', $f['item_grp_id'] ?? null);
        $this->appendIntFilter($where, $binds, 'i.stock_cat_id', $f['stock_cat_id'] ?? null);
        $this->appendBranchFilter($where, $binds, $boId);
        if (!empty($f['status'])) {
            $where .= ' AND bt.status IN (' . implode(',', array_fill(0, count($f['status']), '?')) . ')';
            $binds = array_merge($binds, array_values($f['status']));
        }
        if (!empty($f['expiring_before'])) {
            $where .= ' AND bt.expiry_date IS NOT NULL AND bt.expiry_date <= ?';
            $binds[] = $f['expiring_before'];
        }
        $groupCols = 'b.item_id, i.item_name, i.item_alias, i.item_sku, i.unit_id, u.unit_symbol, i.item_grp_id, i.stock_cat_id, i.track_expiry, b.batch_id, bt.batch_no, bt.lot_no, bt.mfg_date, bt.expiry_date, bt.status'
            . ($byWh ? ', b.warehouse_id, w.warehouse_name, w.warehouse_code' : '');
        $select = $groupCols . ', bt.status AS batch_status, ' . ($byWh ? '' : 'NULL::bigint AS warehouse_id, NULL::varchar AS warehouse_name, NULL::varchar AS warehouse_code, ')
            . 'SUM(b.on_hand_qty) AS on_hand, SUM(b.reserved_qty) AS reserved, SUM(b.committed_qty) AS committed, SUM(b.packed_qty) AS packed, SUM(b.in_transit_qty) AS in_transit, SUM(b.job_worker_qty) AS job_worker, SUM(b.quality_hold_qty) AS quality_hold, SUM(b.damaged_qty) AS damaged, SUM(b.blocked_qty) AS blocked, SUM(b.expected_qty) AS expected, MAX(b.last_movement_at) AS last_movement_at';
        $fromSql = ' FROM inv_stock_balances b JOIN inv_batches bt ON bt.batch_id = b.batch_id JOIN inv_items i ON i.item_id = b.item_id AND i.cmp_id = b.cmp_id LEFT JOIN inv_uom u ON u.unit_id = i.unit_id'
            . ($byWh || $boId > 0 ? ' LEFT JOIN inv_warehouses w ON w.warehouse_id = b.warehouse_id' : '')
            . ' WHERE ' . $where . ' GROUP BY ' . $groupCols;
        $having = !array_key_exists('nonzero', $f) || !empty($f['nonzero']) ? ' HAVING SUM(b.on_hand_qty) <> 0 OR SUM(b.reserved_qty) <> 0 OR SUM(b.packed_qty) <> 0 OR SUM(b.quality_hold_qty) <> 0' : '';
        $total = (int) ($db->query('SELECT COUNT(*) AS n FROM (SELECT b.batch_id' . $fromSql . $having . ') x', $binds)->getRowArray()['n'] ?? 0);
        $sortMap = ['item_name' => 'i.item_name', 'batch_no' => 'bt.batch_no', 'expiry_date' => 'bt.expiry_date', 'on_hand' => 'on_hand', 'warehouse_name' => $byWh ? 'w.warehouse_name' : 'i.item_name', 'last_movement_at' => 'last_movement_at'];
        $orderBy = ($sortMap[$f['sort'] ?? ''] ?? 'i.item_name') . ' ' . (strtoupper($f['order'] ?? 'ASC') === 'DESC' ? 'DESC NULLS LAST' : 'ASC NULLS LAST') . ', i.item_name ASC, bt.expiry_date ASC NULLS LAST, bt.batch_no ASC' . ($byWh ? ', w.warehouse_name ASC' : '');
        $raw = $db->query('SELECT ' . $select . $fromSql . $having . ' ORDER BY ' . $orderBy . ' LIMIT ? OFFSET ?', array_merge($binds, [$limit, $offset]))->getResultArray();

        $today = date('Y-m-d');
        $ids = array_values(array_unique(array_map(static fn ($r) => (int) $r['item_id'], $raw)));
        $costs = $this->valuation->unitCostsForItems($cmpId, $fyId, $ids, $today, 'AS_PER_MASTER', $boId, (int) ($f['warehouse_id'] ?? 0) ?: null);
        $rows = [];
        foreach ($raw as $r) {
            $id = (int) $r['item_id'];
            $row = [
                'item_id'        => $id,
                'item_name'      => $r['item_name'],
                'item_alias'     => $r['item_alias'],
                'item_sku'       => $r['item_sku'],
                'unit_id'        => isset($r['unit_id']) ? (int) $r['unit_id'] : null,
                'unit_symbol'    => $r['unit_symbol'],
                'item_grp_id'    => isset($r['item_grp_id']) ? (int) $r['item_grp_id'] : null,
                'stock_cat_id'   => isset($r['stock_cat_id']) ? (int) $r['stock_cat_id'] : null,
                'warehouse_id'   => isset($r['warehouse_id']) ? (int) $r['warehouse_id'] : null,
                'warehouse_name' => $r['warehouse_name'] ?? null,
                'warehouse_code' => $r['warehouse_code'] ?? null,
                'batch_id'       => (int) $r['batch_id'],
                'batch_no'       => $r['batch_no'],
                'lot_no'         => $r['lot_no'],
                'mfg_date'       => $r['mfg_date'],
                'expiry_date'    => $r['expiry_date'],
                'batch_status'   => $r['batch_status'],
                'days_to_expiry' => $r['expiry_date'] ? self::daysBetween($today, (string) $r['expiry_date']) : null,
                'is_expired'     => $r['expiry_date'] ? ((string) $r['expiry_date'] < $today) : false,
                'last_movement_at' => $r['last_movement_at'],
            ];
            foreach (['on_hand', 'reserved', 'committed', 'packed', 'in_transit', 'job_worker', 'quality_hold', 'damaged', 'blocked', 'expected'] as $k) {
                $row[$k] = round((float) ($r[$k] ?? 0), 4);
            }
            $row['available'] = StockBalanceService::availableFrom($row);
            $row['unit_cost'] = round((float) ($costs[$id]['unit_cost'] ?? 0), 4);
            $row['stock_value'] = round($row['on_hand'] * $row['unit_cost'], 4);
            $rows[] = $row;
        }
        $summary = $db->query('SELECT COUNT(DISTINCT x.batch_id) AS batches, COUNT(DISTINCT x.item_id) AS items, COALESCE(SUM(x.on_hand),0) AS on_hand, COALESCE(SUM(x.reserved),0) AS reserved'
            . ' FROM (SELECT b.batch_id, b.item_id, SUM(b.on_hand_qty) AS on_hand, SUM(b.reserved_qty) AS reserved' . $fromSql . $having . ') x', $binds)->getRowArray() ?: [];

        return ['rows' => $rows, 'total' => $total, 'summary' => [
            'batches'  => (int) ($summary['batches'] ?? 0),
            'items'    => (int) ($summary['items'] ?? 0),
            'on_hand'  => round((float) ($summary['on_hand'] ?? 0), 4),
            'reserved' => round((float) ($summary['reserved'] ?? 0), 4),
        ]];
    }

    // ------------------------------------------------------------------ serial stock

    /**
     * Serial numbers by status and warehouse. Default status filter = the on-hand statuses; pass
     * status = all for everything.
     *
     * @param array{item_id?:int, warehouse_id?:int, batch_id?:int, location_id?:int, item_grp_id?:int, stock_cat_id?:int, status?:list<string>|null, q?:string, sort?:string, order?:string} $f
     * @return array{rows: list<array<string, mixed>>, total: int, summary: array<string, mixed>}
     */
    public function serialStock(int $cmpId, int $fyId, int $boId, array $f, int $limit, int $offset): array
    {
        $db = \Config\Database::connect();
        $where = 's.cmp_id = ? AND i.cmp_id = s.cmp_id';
        $binds = [$cmpId];
        $this->appendIntFilter($where, $binds, 's.item_id', $f['item_id'] ?? null);
        $this->appendIntFilter($where, $binds, 's.warehouse_id', $f['warehouse_id'] ?? null);
        $this->appendIntFilter($where, $binds, 's.batch_id', $f['batch_id'] ?? null);
        $this->appendIntFilter($where, $binds, 's.location_id', $f['location_id'] ?? null);
        $this->appendIntFilter($where, $binds, 'i.item_grp_id', $f['item_grp_id'] ?? null);
        $this->appendIntFilter($where, $binds, 'i.stock_cat_id', $f['stock_cat_id'] ?? null);
        $this->appendBranchFilter($where, $binds, $boId);
        $q = trim((string) ($f['q'] ?? ''));
        if ($q !== '') {
            $where .= ' AND (LOWER(s.serial_no) LIKE ? OR LOWER(i.item_name) LIKE ?)';
            $like = '%' . mb_strtolower($q) . '%';
            $binds[] = $like;
            $binds[] = $like;
        }
        $joins = ' FROM inv_serials s JOIN inv_items i ON i.item_id = s.item_id LEFT JOIN inv_uom u ON u.unit_id = i.unit_id LEFT JOIN inv_warehouses w ON w.warehouse_id = s.warehouse_id LEFT JOIN inv_locations lo ON lo.location_id = s.location_id LEFT JOIN inv_batches bt ON bt.batch_id = s.batch_id'
            . ' LEFT JOIN inv_documents rd ON rd.document_id = s.received_document_id LEFT JOIN inv_documents idoc ON idoc.document_id = s.issued_document_id';
        $fromSql = $joins . ' WHERE ' . $where;

        // Status breakdown honours every filter but the status one.
        $byStatus = [];
        foreach ($db->query('SELECT s.status, COUNT(*) AS n' . $fromSql . ' GROUP BY s.status ORDER BY s.status', $binds)->getResultArray() as $r) {
            $byStatus[(string) $r['status']] = (int) $r['n'];
        }

        $statuses = array_key_exists('status', $f) ? $f['status'] : self::SERIAL_STOCK_STATUSES;
        if ($statuses !== null && $statuses !== []) {
            $where .= ' AND s.status IN (' . implode(',', array_fill(0, count($statuses), '?')) . ')';
            $binds = array_merge($binds, array_values($statuses));
            $fromSql = $joins . ' WHERE ' . $where;
        }
        $total = (int) ($db->query('SELECT COUNT(*) AS n' . $fromSql, $binds)->getRowArray()['n'] ?? 0);
        $sortMap = ['serial_no' => 's.serial_no', 'item_name' => 'i.item_name', 'status' => 's.status', 'warehouse_name' => 'w.warehouse_name', 'received_at' => 'rd.document_date', 'created_at' => 's.created_at', 'expiry_date' => 'bt.expiry_date'];
        $orderBy = ($sortMap[$f['sort'] ?? ''] ?? 'i.item_name') . ' ' . (strtoupper($f['order'] ?? 'ASC') === 'DESC' ? 'DESC NULLS LAST' : 'ASC NULLS LAST') . ', s.serial_no ASC';
        $raw = $db->query('SELECT s.serial_id, s.serial_uuid, s.serial_no, s.status, s.unit_cost, s.warranty_until, s.created_at, s.updated_at, s.item_id, i.item_name, i.item_alias, i.item_sku, i.unit_id, u.unit_symbol, i.item_grp_id, i.stock_cat_id,'
            . ' s.batch_id, bt.batch_no, bt.expiry_date, s.warehouse_id, w.warehouse_name, w.warehouse_code, s.location_id, lo.location_code, lo.location_name,'
            . ' s.received_document_id, rd.document_no AS received_document_no, rd.document_date AS received_date, rd.document_type AS received_document_type,'
            . ' s.issued_document_id, idoc.document_no AS issued_document_no, idoc.document_date AS issued_date, idoc.document_type AS issued_document_type, idoc.party_name AS issued_to'
            . $fromSql . ' ORDER BY ' . $orderBy . ' LIMIT ? OFFSET ?', array_merge($binds, [$limit, $offset]))->getResultArray();
        $rows = [];
        foreach ($raw as $r) {
            foreach (['serial_id', 'item_id', 'unit_id', 'item_grp_id', 'stock_cat_id', 'batch_id', 'warehouse_id', 'location_id', 'received_document_id', 'issued_document_id'] as $k) {
                $r[$k] = isset($r[$k]) ? (int) $r[$k] : null;
            }
            $r['unit_cost'] = isset($r['unit_cost']) ? round((float) $r['unit_cost'], 4) : null;
            $rows[] = $r;
        }

        return ['rows' => $rows, 'total' => $total, 'summary' => ['by_status' => $byStatus, 'statuses_applied' => $statuses ?: null, 'total_all_statuses' => array_sum($byStatus)]];
    }

    // ------------------------------------------------------------------ stock ageing

    /**
     * Age buckets of the remaining cost layers per item (FIFO / LIFO: each open layer aged from its
     * received_at; WAC: the whole on-hand aged from the last receipt). Value = qty x layer cost.
     *
     * @param array{item_grp_id?:int, stock_cat_id?:int, warehouse_id?:int, item_id?:int, as_of?:?string, by_warehouse?:bool, sort?:string, order?:string} $f
     * @return array{rows: list<array<string, mixed>>, total: int, summary: array<string, mixed>}
     */
    public function stockAgeing(int $cmpId, int $fyId, int $boId, array $f, int $limit, int $offset): array
    {
        $db = \Config\Database::connect();
        $asOf = $f['as_of'] ?? null ?: date('Y-m-d');
        $itemId = (int) ($f['item_id'] ?? 0) ?: null;
        $wh = (int) ($f['warehouse_id'] ?? 0) ?: null;
        $byWh = !empty($f['by_warehouse']);

        $where = 'l.cmp_id = ? AND l.qty_remaining > 0';
        $binds = [$cmpId];
        $this->appendIntFilter($where, $binds, 'l.item_id', $itemId);
        $this->appendIntFilter($where, $binds, 'l.warehouse_id', $wh);
        $layers = $db->query('SELECT l.item_id, l.warehouse_id, l.layer_kind, l.qty_remaining, l.unit_cost, l.received_at FROM inv_cost_layers l WHERE ' . $where, $binds)->getResultArray();

        $wacWhere = 's.cmp_id = ? AND s.qty_on_hand > 0';
        $wacBinds = [$cmpId];
        $this->appendIntFilter($wacWhere, $wacBinds, 's.item_id', $itemId);
        if ($wh !== null) {
            $wacWhere .= ' AND s.warehouse_id = ?';
            $wacBinds[] = $wh;
        }
        $wac = $db->query('SELECT s.item_id, s.warehouse_id, s.qty_on_hand, s.average_cost FROM inv_wac_state s WHERE ' . $wacWhere, $wacBinds)->getResultArray();

        $ids = [];
        foreach ($layers as $l) {
            $ids[(int) $l['item_id']] = true;
        }
        foreach ($wac as $w) {
            $ids[(int) $w['item_id']] = true;
        }
        $ids = array_keys($ids);
        $items = $this->itemMeta($cmpId, $ids);
        $keep = $this->applyItemFilters(array_fill_keys($ids, true), $items, $f);
        $methods = $ids !== [] ? $this->engine->methodsForItems($cmpId, array_keys($keep)) : [];

        // WAC items: last receipt date (movement qty > 0) per item[/warehouse]; fallback = FY start.
        $wacItems = array_keys(array_filter($methods, static fn ($m) => $m === 'WAC'));
        $lastReceipt = [];
        foreach (array_chunk($wacItems, 500) as $chunk) {
            $sql = 'SELECT m.item_id, ' . ($byWh ? 'COALESCE(m.warehouse_id,0)' : '0') . ' AS wh, MAX(m.movement_date) AS d FROM inv_stock_movements m WHERE m.cmp_id = ? AND m.qty > 0 AND m.movement_date <= ? AND m.item_id IN (' . implode(',', array_fill(0, count($chunk), '?')) . ')';
            $b = array_merge([$cmpId, $asOf], $chunk);
            if ($boId > 0) {
                $sql .= ' AND m.bo_id = ?';
                $b[] = $boId;
            }
            if ($wh !== null) {
                $sql .= ' AND m.warehouse_id = ?';
                $b[] = $wh;
            }
            foreach ($db->query($sql . ' GROUP BY m.item_id' . ($byWh ? ', COALESCE(m.warehouse_id,0)' : ''), $b)->getResultArray() as $r) {
                $lastReceipt[(int) $r['item_id'] . ':' . (int) $r['wh']] = (string) $r['d'];
            }
        }
        $fyStart = $this->fyStart($cmpId, $fyId);

        $warehouses = $byWh ? $this->warehouseMeta($cmpId) : [];
        $groups = [];
        $touch = static function (array &$groups, int $id, int $w, string $method) use ($warehouses, $byWh): string {
            $key = $id . ':' . ($byWh ? $w : 0);
            if (!isset($groups[$key])) {
                $groups[$key] = ['item_id' => $id, 'warehouse_id' => $byWh && $w > 0 ? $w : null, 'warehouse_name' => $byWh ? ($warehouses[$w]['warehouse_name'] ?? null) : null, 'valuation_method' => $method, 'buckets' => self::emptyAgeBuckets(), 'total_qty' => 0.0, 'total_value' => 0.0, 'age_qty_days' => 0.0, 'oldest_days' => null, 'newest_days' => null, 'layers' => 0, 'aged_from' => null];
            }

            return $key;
        };
        foreach ($layers as $l) {
            $id = (int) $l['item_id'];
            if (!isset($keep[$id]) || ($methods[$id] ?? 'FIFO') === 'WAC') {
                continue;
            }
            $key = $touch($groups, $id, (int) ($l['warehouse_id'] ?? 0), $methods[$id] ?? 'FIFO');
            $days = self::ageDays((string) $l['received_at'], $asOf);
            self::addToBucket($groups[$key], $days, (float) $l['qty_remaining'], (float) $l['unit_cost']);
        }
        foreach ($wac as $s) {
            $id = (int) $s['item_id'];
            if (!isset($keep[$id]) || ($methods[$id] ?? '') !== 'WAC') {
                continue;
            }
            $w = (int) $s['warehouse_id'];
            $key = $touch($groups, $id, $w, 'WAC');
            $agedFrom = $lastReceipt[$id . ':' . ($byWh ? $w : 0)] ?? $fyStart;
            $days = $agedFrom !== null ? self::ageDays($agedFrom, $asOf) : 181;
            self::addToBucket($groups[$key], $days, (float) $s['qty_on_hand'], (float) $s['average_cost']);
            $groups[$key]['aged_from'] = $agedFrom;
        }

        $rows = [];
        $summary = ['items' => 0, 'total_qty' => 0.0, 'total_value' => 0.0, 'buckets' => self::emptyAgeBuckets(), 'bucket_labels' => self::AGE_BUCKET_LABELS, 'as_of' => $asOf];
        foreach ($groups as $g) {
            $id = $g['item_id'];
            $row = $this->itemColumns($items[$id] ?? null, $id) + $g;
            $row['total_qty'] = round($g['total_qty'], 4);
            $row['total_value'] = round($g['total_value'], 4);
            $row['weighted_age_days'] = $g['total_qty'] > 0 ? (int) round($g['age_qty_days'] / $g['total_qty']) : null;
            unset($row['age_qty_days']);
            foreach ($row['buckets'] as $k => $b) {
                $row['buckets'][$k] = ['qty' => round($b['qty'], 4), 'value' => round($b['value'], 4)];
                $summary['buckets'][$k]['qty'] = round($summary['buckets'][$k]['qty'] + $b['qty'], 4);
                $summary['buckets'][$k]['value'] = round($summary['buckets'][$k]['value'] + $b['value'], 4);
            }
            $summary['items']++;
            $summary['total_qty'] = round($summary['total_qty'] + $row['total_qty'], 4);
            $summary['total_value'] = round($summary['total_value'] + $row['total_value'], 4);
            $rows[] = $row;
        }
        self::sortRows($rows, $f['sort'] ?? 'item_name', $f['order'] ?? 'ASC', ['item_name', 'total_qty', 'total_value', 'oldest_days', 'weighted_age_days', 'item_id'], $byWh ? 'warehouse_name' : null);

        return ['rows' => array_slice($rows, $offset, $limit), 'total' => count($rows), 'summary' => $summary];
    }

    /** @param array<string, mixed> $group */
    private static function addToBucket(array &$group, int $days, float $qty, float $unitCost): void
    {
        if ($qty <= 0) {
            return;
        }
        $bucket = self::ageBucket($days);
        $value = $qty * $unitCost;
        $group['buckets'][$bucket]['qty'] += $qty;
        $group['buckets'][$bucket]['value'] += $value;
        $group['total_qty'] += $qty;
        $group['total_value'] += $value;
        $group['age_qty_days'] += $qty * $days;
        $group['oldest_days'] = $group['oldest_days'] === null ? $days : max($group['oldest_days'], $days);
        $group['newest_days'] = $group['newest_days'] === null ? $days : min($group['newest_days'], $days);
        $group['layers']++;
    }

    // ------------------------------------------------------------------ movement analysis

    /**
     * Fast / slow / non-moving / dead classification per stock item from the days since the last
     * outward movement and the outward quantity over [from, to].
     *
     * @param array{item_grp_id?:int, stock_cat_id?:int, warehouse_id?:int, item_id?:int, from?:?string, to?:?string, fast_days?:int, slow_days?:int, dead_days?:int, class?:?string, include_inactive?:bool, sort?:string, order?:string} $f
     * @return array{rows: list<array<string, mixed>>, total: int, summary: array<string, mixed>}
     */
    public function movementAnalysis(int $cmpId, int $fyId, int $boId, array $f, int $limit, int $offset): array
    {
        $db = \Config\Database::connect();
        [$fast, $slow, $dead] = self::normaliseThresholds((int) ($f['fast_days'] ?? 30), (int) ($f['slow_days'] ?? 90), (int) ($f['dead_days'] ?? 180));
        $to = $f['to'] ?? null ?: date('Y-m-d');
        $from = $f['from'] ?? null ?: date('Y-m-d', strtotime($to . ' -' . $dead . ' days'));
        if ($from > $to) {
            throw InventoryException::validation('from must not be after to', ['from' => $from, 'to' => $to]);
        }
        $wh = (int) ($f['warehouse_id'] ?? 0) ?: null;
        $class = $f['class'] ?? null;
        if ($class !== null && $class !== '' && !in_array($class, self::MOVEMENT_CLASSES, true)) {
            throw InventoryException::validation('class must be one of ' . implode(', ', self::MOVEMENT_CLASSES), ['allowed' => self::MOVEMENT_CLASSES]);
        }

        $mvWhere = 'm.cmp_id = ? AND m.movement_date <= ?';
        $mvBinds = [$from, $to, $from, $to, $from, $to, $from, $to, $cmpId, $to];
        if ($boId > 0) {
            $mvWhere .= ' AND m.bo_id = ?';
            $mvBinds[] = $boId;
        }
        if ($wh !== null) {
            $mvWhere .= ' AND m.warehouse_id = ?';
            $mvBinds[] = $wh;
        }
        $balWhere = 'b.cmp_id = ?';
        $balBinds = [$cmpId];
        if ($wh !== null) {
            $balWhere .= ' AND b.warehouse_id = ?';
            $balBinds[] = $wh;
        }
        $where = 'i.cmp_id = ? AND i.deleted_at IS NULL AND i.item_type = ?';
        $binds = [$cmpId, 'stock'];
        if (empty($f['include_inactive'])) {
            $where .= ' AND i.is_active = 1';
        }
        $this->appendIntFilter($where, $binds, 'i.item_id', $f['item_id'] ?? null);
        $this->appendIntFilter($where, $binds, 'i.item_grp_id', $f['item_grp_id'] ?? null);
        $this->appendIntFilter($where, $binds, 'i.stock_cat_id', $f['stock_cat_id'] ?? null);

        $sql = 'SELECT i.item_id, i.item_name, i.item_alias, i.item_sku, i.unit_id, u.unit_symbol, i.item_grp_id, g.grp_name, i.stock_cat_id, c.cat_name, i.valuation_method, i.is_active,'
            . ' mv.last_movement_date, mv.last_out_date, mv.last_in_date, COALESCE(mv.period_out_qty,0) AS period_out_qty, COALESCE(mv.period_in_qty,0) AS period_in_qty, COALESCE(mv.period_out_value,0) AS period_out_value, COALESCE(mv.period_out_docs,0) AS period_out_docs,'
            . ' COALESCE(bal.on_hand,0) AS on_hand'
            . ' FROM inv_items i'
            . ' LEFT JOIN inv_uom u ON u.unit_id = i.unit_id LEFT JOIN inv_item_groups g ON g.item_grp_id = i.item_grp_id LEFT JOIN inv_stock_categories c ON c.stock_cat_id = i.stock_cat_id'
            . ' LEFT JOIN (SELECT m.item_id, MAX(m.movement_date) AS last_movement_date, MAX(CASE WHEN m.qty < 0 THEN m.movement_date END) AS last_out_date, MAX(CASE WHEN m.qty > 0 THEN m.movement_date END) AS last_in_date,'
            . ' SUM(CASE WHEN m.qty < 0 AND m.movement_date BETWEEN ? AND ? THEN -m.qty ELSE 0 END) AS period_out_qty,'
            . ' SUM(CASE WHEN m.qty > 0 AND m.movement_date BETWEEN ? AND ? THEN m.qty ELSE 0 END) AS period_in_qty,'
            . ' SUM(CASE WHEN m.qty < 0 AND m.movement_date BETWEEN ? AND ? THEN -COALESCE(m.value,0) ELSE 0 END) AS period_out_value,'
            . ' COUNT(DISTINCT CASE WHEN m.qty < 0 AND m.movement_date BETWEEN ? AND ? THEN m.document_id END) AS period_out_docs'
            . ' FROM inv_stock_movements m WHERE ' . $mvWhere . ' GROUP BY m.item_id) mv ON mv.item_id = i.item_id'
            . ' LEFT JOIN (SELECT b.item_id, SUM(b.on_hand_qty) AS on_hand FROM inv_stock_balances b WHERE ' . $balWhere . ' GROUP BY b.item_id) bal ON bal.item_id = i.item_id'
            . ' WHERE ' . $where . ' ORDER BY i.item_name ASC, i.item_id ASC';
        $rows = [];
        $summary = ['from' => $from, 'to' => $to, 'thresholds' => ['fast_days' => $fast, 'slow_days' => $slow, 'dead_days' => $dead], 'by_class' => []];
        foreach (self::MOVEMENT_CLASSES as $c) {
            $summary['by_class'][$c] = ['items' => 0, 'on_hand' => 0.0, 'period_out_qty' => 0.0];
        }
        foreach ($db->query($sql, array_merge($mvBinds, $balBinds, $binds))->getResultArray() as $r) {
            $daysOut = $r['last_out_date'] ? self::daysBetween((string) $r['last_out_date'], $to) : null;
            $daysAny = $r['last_movement_date'] ? self::daysBetween((string) $r['last_movement_date'], $to) : null;
            $outQty = round((float) $r['period_out_qty'], 4);
            $onHand = round((float) $r['on_hand'], 4);
            $cls = self::classifyMovement($daysOut, $outQty, $fast, $slow, $dead, $daysAny);
            $summary['by_class'][$cls]['items']++;
            $summary['by_class'][$cls]['on_hand'] = round($summary['by_class'][$cls]['on_hand'] + $onHand, 4);
            $summary['by_class'][$cls]['period_out_qty'] = round($summary['by_class'][$cls]['period_out_qty'] + $outQty, 4);
            if ($class !== null && $class !== '' && $cls !== $class) {
                continue;
            }
            $rows[] = [
                'item_id'          => (int) $r['item_id'],
                'item_name'        => $r['item_name'],
                'item_alias'       => $r['item_alias'],
                'item_sku'         => $r['item_sku'],
                'unit_id'          => isset($r['unit_id']) ? (int) $r['unit_id'] : null,
                'unit_symbol'      => $r['unit_symbol'],
                'item_grp_id'      => isset($r['item_grp_id']) ? (int) $r['item_grp_id'] : null,
                'grp_name'         => $r['grp_name'],
                'stock_cat_id'     => isset($r['stock_cat_id']) ? (int) $r['stock_cat_id'] : null,
                'cat_name'         => $r['cat_name'],
                'valuation_method' => $r['valuation_method'],
                'is_active'        => (int) $r['is_active'],
                'on_hand'          => $onHand,
                'period_in_qty'    => round((float) $r['period_in_qty'], 4),
                'period_out_qty'   => $outQty,
                'period_out_value' => round((float) $r['period_out_value'], 4),
                'period_out_docs'  => (int) $r['period_out_docs'],
                'last_movement_date' => $r['last_movement_date'],
                'last_in_date'     => $r['last_in_date'],
                'last_out_date'    => $r['last_out_date'],
                'days_since_last_out' => $daysOut,
                'days_since_last_movement' => $daysAny,
                'classification'   => $cls,
                'days_of_cover'    => $outQty > 0 ? round($onHand / ($outQty / max(1, self::daysBetween($from, $to) + 1)), 1) : null,
            ];
        }
        self::sortRows($rows, $f['sort'] ?? 'item_name', $f['order'] ?? 'ASC', ['item_name', 'on_hand', 'period_out_qty', 'period_out_value', 'days_since_last_out', 'days_since_last_movement', 'last_out_date', 'classification', 'item_id']);

        return ['rows' => array_slice($rows, $offset, $limit), 'total' => count($rows), 'summary' => $summary];
    }

    // ------------------------------------------------------------------ near expiry

    /**
     * Batches expiring within `days` of `as_of` (expired ones included unless include_expired = false) that
     * still have on-hand stock.
     *
     * @param array{days?:int, as_of?:?string, include_expired?:bool, item_id?:int, warehouse_id?:int, item_grp_id?:int, stock_cat_id?:int, by_warehouse?:bool, sort?:string, order?:string} $f
     * @return array{rows: list<array<string, mixed>>, total: int, summary: array<string, mixed>}
     */
    public function nearExpiry(int $cmpId, int $fyId, int $boId, array $f, int $limit, int $offset): array
    {
        $db = \Config\Database::connect();
        $asOf = $f['as_of'] ?? null ?: date('Y-m-d');
        $days = max(0, (int) ($f['days'] ?? 30));
        $until = date('Y-m-d', strtotime($asOf . ' +' . $days . ' days'));
        $includeExpired = !array_key_exists('include_expired', $f) || !empty($f['include_expired']);
        $byWh = !empty($f['by_warehouse']) || !empty($f['warehouse_id']);

        $where = 'bt.cmp_id = ? AND b.cmp_id = bt.cmp_id AND bt.expiry_date IS NOT NULL AND bt.expiry_date <= ?';
        $binds = [$cmpId, $until];
        if (!$includeExpired) {
            $where .= ' AND bt.expiry_date >= ?';
            $binds[] = $asOf;
        }
        $this->appendIntFilter($where, $binds, 'bt.item_id', $f['item_id'] ?? null);
        $this->appendIntFilter($where, $binds, 'b.warehouse_id', $f['warehouse_id'] ?? null);
        $this->appendIntFilter($where, $binds, 'i.item_grp_id', $f['item_grp_id'] ?? null);
        $this->appendIntFilter($where, $binds, 'i.stock_cat_id', $f['stock_cat_id'] ?? null);
        $this->appendBranchFilter($where, $binds, $boId);
        $groupCols = 'bt.batch_id, bt.batch_no, bt.lot_no, bt.mfg_date, bt.expiry_date, bt.status, bt.item_id, i.item_name, i.item_alias, i.item_sku, i.unit_id, u.unit_symbol, i.item_grp_id, i.stock_cat_id, i.shelf_life_days'
            . ($byWh ? ', b.warehouse_id, w.warehouse_name, w.warehouse_code' : '');
        $fromSql = ' FROM inv_batches bt JOIN inv_stock_balances b ON b.batch_id = bt.batch_id JOIN inv_items i ON i.item_id = bt.item_id AND i.cmp_id = bt.cmp_id LEFT JOIN inv_uom u ON u.unit_id = i.unit_id'
            . ($byWh || $boId > 0 ? ' LEFT JOIN inv_warehouses w ON w.warehouse_id = b.warehouse_id' : '')
            . ' WHERE ' . $where . ' GROUP BY ' . $groupCols . ' HAVING SUM(b.on_hand_qty) > 0';
        $total = (int) ($db->query('SELECT COUNT(*) AS n FROM (SELECT bt.batch_id' . $fromSql . ') x', $binds)->getRowArray()['n'] ?? 0);
        $sortMap = ['expiry_date' => 'bt.expiry_date', 'item_name' => 'i.item_name', 'batch_no' => 'bt.batch_no', 'on_hand' => 'on_hand', 'warehouse_name' => $byWh ? 'w.warehouse_name' : 'bt.expiry_date'];
        $orderBy = ($sortMap[$f['sort'] ?? ''] ?? 'bt.expiry_date') . ' ' . (strtoupper($f['order'] ?? 'ASC') === 'DESC' ? 'DESC' : 'ASC') . ', i.item_name ASC, bt.batch_no ASC';
        $raw = $db->query('SELECT ' . $groupCols . ', bt.status AS batch_status, ' . ($byWh ? '' : 'NULL::bigint AS warehouse_id, NULL::varchar AS warehouse_name, NULL::varchar AS warehouse_code, ')
            . 'SUM(b.on_hand_qty) AS on_hand, SUM(b.reserved_qty) AS reserved, SUM(b.packed_qty) AS packed, SUM(b.quality_hold_qty) AS quality_hold, SUM(b.damaged_qty) AS damaged, SUM(b.blocked_qty) AS blocked'
            . $fromSql . ' ORDER BY ' . $orderBy . ' LIMIT ? OFFSET ?', array_merge($binds, [$limit, $offset]))->getResultArray();

        $ids = array_values(array_unique(array_map(static fn ($r) => (int) $r['item_id'], $raw)));
        $costs = $this->valuation->unitCostsForItems($cmpId, $fyId, $ids, $asOf, 'AS_PER_MASTER', $boId, (int) ($f['warehouse_id'] ?? 0) ?: null);
        $rows = [];
        foreach ($raw as $r) {
            $id = (int) $r['item_id'];
            $dte = self::daysBetween($asOf, (string) $r['expiry_date']);
            $row = [
                'batch_id'        => (int) $r['batch_id'],
                'batch_no'        => $r['batch_no'],
                'lot_no'          => $r['lot_no'],
                'mfg_date'        => $r['mfg_date'],
                'expiry_date'     => $r['expiry_date'],
                'batch_status'    => $r['batch_status'],
                'days_to_expiry'  => $dte,
                'is_expired'      => $dte < 0,
                'item_id'         => $id,
                'item_name'       => $r['item_name'],
                'item_alias'      => $r['item_alias'],
                'item_sku'        => $r['item_sku'],
                'unit_id'         => isset($r['unit_id']) ? (int) $r['unit_id'] : null,
                'unit_symbol'     => $r['unit_symbol'],
                'item_grp_id'     => isset($r['item_grp_id']) ? (int) $r['item_grp_id'] : null,
                'stock_cat_id'    => isset($r['stock_cat_id']) ? (int) $r['stock_cat_id'] : null,
                'shelf_life_days' => isset($r['shelf_life_days']) ? (int) $r['shelf_life_days'] : null,
                'warehouse_id'    => isset($r['warehouse_id']) ? (int) $r['warehouse_id'] : null,
                'warehouse_name'  => $r['warehouse_name'] ?? null,
                'warehouse_code'  => $r['warehouse_code'] ?? null,
            ];
            foreach (['on_hand', 'reserved', 'packed', 'quality_hold', 'damaged', 'blocked'] as $k) {
                $row[$k] = round((float) ($r[$k] ?? 0), 4);
            }
            $row['unit_cost'] = round((float) ($costs[$id]['unit_cost'] ?? 0), 4);
            $row['stock_value'] = round($row['on_hand'] * $row['unit_cost'], 4);
            $rows[] = $row;
        }
        $agg = $db->query('SELECT COUNT(*) AS batches, COUNT(DISTINCT x.item_id) AS items, COALESCE(SUM(x.on_hand),0) AS on_hand, COALESCE(SUM(CASE WHEN x.expiry_date < ? THEN x.on_hand ELSE 0 END),0) AS expired_qty, COALESCE(SUM(CASE WHEN x.expiry_date < ? THEN 1 ELSE 0 END),0) AS expired_batches'
            . ' FROM (SELECT bt.batch_id, bt.item_id, bt.expiry_date, SUM(b.on_hand_qty) AS on_hand' . $fromSql . ') x', array_merge([$asOf, $asOf], $binds))->getRowArray() ?: [];

        return ['rows' => $rows, 'total' => $total, 'summary' => [
            'as_of'           => $asOf,
            'days'            => $days,
            'until'           => $until,
            'include_expired' => $includeExpired,
            'batches'         => (int) ($agg['batches'] ?? 0),
            'items'           => (int) ($agg['items'] ?? 0),
            'on_hand'         => round((float) ($agg['on_hand'] ?? 0), 4),
            'expired_batches' => (int) ($agg['expired_batches'] ?? 0),
            'expired_qty'     => round((float) ($agg['expired_qty'] ?? 0), 4),
        ]];
    }

    // ------------------------------------------------------------------ replenishment

    /**
     * Reorder advice per stock item: on hand, reserved, available, expected (open inward pending
     * quantities in base units), projected, the item's thresholds and a suggested order quantity.
     *
     * @param array{item_id?:int, warehouse_id?:int, item_grp_id?:int, stock_cat_id?:int, only_triggered?:bool, with_thresholds_only?:bool, sort?:string, order?:string} $f
     * @return array{rows: list<array<string, mixed>>, total: int, summary: array<string, mixed>}
     */
    public function replenishment(int $cmpId, int $fyId, int $boId, array $f, int $limit, int $offset): array
    {
        $db = \Config\Database::connect();
        $wh = (int) ($f['warehouse_id'] ?? 0) ?: null;
        $onlyTriggered = !array_key_exists('only_triggered', $f) || !empty($f['only_triggered']);
        $thresholdsOnly = !array_key_exists('with_thresholds_only', $f) ? $onlyTriggered : !empty($f['with_thresholds_only']);

        $balWhere = 'b.cmp_id = ?';
        $balBinds = [$cmpId];
        if ($wh !== null) {
            $balWhere .= ' AND b.warehouse_id = ?';
            $balBinds[] = $wh;
        }
        $pendSql = static function (string $direction) use ($wh): string {
            return '(SELECT p.item_id, SUM((p.qty_original - p.qty_settled) * COALESCE((SELECT MAX(iu.conversion_factor) FROM inv_item_uoms iu WHERE iu.cmp_id = p.cmp_id AND iu.item_id = p.item_id AND iu.unit_id = p.unit_id), 1)) AS qty'
                . " FROM inv_pending_quantities p WHERE p.cmp_id = ? AND p.direction = '" . $direction . "' AND p.status IN ('open','partial')" . ($wh !== null ? ' AND p.warehouse_id = ?' : '') . ' GROUP BY p.item_id)';
        };
        $pendBinds = $wh !== null ? [$cmpId, $wh] : [$cmpId];

        $projected = '(COALESCE(bal.on_hand,0) + COALESCE(pin.qty,0) - COALESCE(bal.reserved,0) - COALESCE(bal.committed,0))';
        $where = 'i.cmp_id = ? AND i.deleted_at IS NULL AND i.is_active = 1 AND i.item_type = ?';
        $binds = [$cmpId, 'stock'];
        $this->appendIntFilter($where, $binds, 'i.item_id', $f['item_id'] ?? null);
        $this->appendIntFilter($where, $binds, 'i.item_grp_id', $f['item_grp_id'] ?? null);
        $this->appendIntFilter($where, $binds, 'i.stock_cat_id', $f['stock_cat_id'] ?? null);
        if ($thresholdsOnly) {
            $where .= ' AND (COALESCE(i.reorder_point_qty,0) > 0 OR COALESCE(i.safety_stock_qty,0) > 0 OR COALESCE(i.min_stock_qty,0) > 0)';
        }
        if ($onlyTriggered) {
            $where .= ' AND ((COALESCE(i.reorder_point_qty,0) > 0 AND ' . $projected . ' <= i.reorder_point_qty) OR (COALESCE(i.safety_stock_qty,0) > 0 AND ' . $projected . ' < i.safety_stock_qty) OR (COALESCE(i.min_stock_qty,0) > 0 AND ' . $projected . ' < i.min_stock_qty))';
        }
        $fromBase = ' FROM inv_items i'
            . ' LEFT JOIN inv_uom u ON u.unit_id = i.unit_id LEFT JOIN inv_item_groups g ON g.item_grp_id = i.item_grp_id LEFT JOIN inv_stock_categories c ON c.stock_cat_id = i.stock_cat_id LEFT JOIN inv_warehouses dw ON dw.warehouse_id = i.default_warehouse_id'
            . ' LEFT JOIN (SELECT b.item_id, SUM(b.on_hand_qty) AS on_hand, SUM(b.reserved_qty) AS reserved, SUM(b.committed_qty) AS committed, SUM(b.packed_qty) AS packed, SUM(b.in_transit_qty) AS in_transit, SUM(b.job_worker_qty) AS job_worker, SUM(b.quality_hold_qty) AS quality_hold, SUM(b.damaged_qty) AS damaged, SUM(b.blocked_qty) AS blocked, SUM(b.expected_qty) AS expected_qty FROM inv_stock_balances b WHERE ' . $balWhere . ' GROUP BY b.item_id) bal ON bal.item_id = i.item_id'
            . ' LEFT JOIN ' . $pendSql('in') . ' pin ON pin.item_id = i.item_id'
            . ' LEFT JOIN ' . $pendSql('out') . ' pout ON pout.item_id = i.item_id';
        $fromSql = $fromBase . ' WHERE ' . $where;
        $allBinds = array_merge($balBinds, $pendBinds, $pendBinds, $binds);
        $total = (int) ($db->query('SELECT COUNT(*) AS n' . $fromSql, $allBinds)->getRowArray()['n'] ?? 0);
        $sortMap = ['item_name' => 'i.item_name', 'projected' => 'projected', 'on_hand' => 'on_hand', 'available' => 'available', 'reorder_point_qty' => 'i.reorder_point_qty', 'lead_time_days' => 'i.lead_time_days', 'item_id' => 'i.item_id'];
        $orderBy = ($sortMap[$f['sort'] ?? ''] ?? 'i.item_name') . ' ' . (strtoupper($f['order'] ?? 'ASC') === 'DESC' ? 'DESC NULLS LAST' : 'ASC NULLS LAST') . ', i.item_name ASC, i.item_id ASC';
        $raw = $db->query('SELECT i.item_id, i.item_name, i.item_alias, i.item_sku, i.unit_id, u.unit_symbol, i.item_grp_id, g.grp_name, i.stock_cat_id, c.cat_name, i.valuation_method, i.standard_cost,'
            . ' i.min_stock_qty, i.max_stock_qty, i.reorder_point_qty, i.reorder_qty, i.safety_stock_qty, i.lead_time_days, i.default_warehouse_id, dw.warehouse_name AS default_warehouse_name,'
            . ' COALESCE(bal.on_hand,0) AS on_hand, COALESCE(bal.reserved,0) AS reserved, COALESCE(bal.committed,0) AS committed, COALESCE(bal.packed,0) AS packed, COALESCE(bal.in_transit,0) AS in_transit, COALESCE(bal.job_worker,0) AS job_worker, COALESCE(bal.quality_hold,0) AS quality_hold, COALESCE(bal.damaged,0) AS damaged, COALESCE(bal.blocked,0) AS blocked, COALESCE(bal.expected_qty,0) AS expected_balance,'
            . ' (COALESCE(bal.on_hand,0) - COALESCE(bal.reserved,0) - COALESCE(bal.packed,0) - COALESCE(bal.quality_hold,0) - COALESCE(bal.damaged,0) - COALESCE(bal.blocked,0)) AS available,'
            . ' COALESCE(pin.qty,0) AS expected, COALESCE(pout.qty,0) AS pending_out, ' . $projected . ' AS projected'
            . $fromSql . ' ORDER BY ' . $orderBy . ' LIMIT ? OFFSET ?', array_merge($allBinds, [$limit, $offset]))->getResultArray();

        $rows = [];
        $summary = ['triggered_total' => 0, 'page_suggested_qty' => 0.0, 'page_suggested_value' => 0.0, 'warehouse_id' => $wh];
        foreach ($raw as $r) {
            $num = static fn ($v) => $v === null ? null : round((float) $v, 4);
            $row = [
                'item_id'           => (int) $r['item_id'],
                'item_name'         => $r['item_name'],
                'item_alias'        => $r['item_alias'],
                'item_sku'          => $r['item_sku'],
                'unit_id'           => isset($r['unit_id']) ? (int) $r['unit_id'] : null,
                'unit_symbol'       => $r['unit_symbol'],
                'item_grp_id'       => isset($r['item_grp_id']) ? (int) $r['item_grp_id'] : null,
                'grp_name'          => $r['grp_name'],
                'stock_cat_id'      => isset($r['stock_cat_id']) ? (int) $r['stock_cat_id'] : null,
                'cat_name'          => $r['cat_name'],
                'valuation_method'  => $r['valuation_method'],
                'standard_cost'     => $num($r['standard_cost']),
                'min_stock_qty'     => $num($r['min_stock_qty']),
                'max_stock_qty'     => $num($r['max_stock_qty']),
                'reorder_point_qty' => $num($r['reorder_point_qty']),
                'reorder_qty'       => $num($r['reorder_qty']),
                'safety_stock_qty'  => $num($r['safety_stock_qty']),
                'lead_time_days'    => isset($r['lead_time_days']) ? (int) $r['lead_time_days'] : null,
                'default_warehouse_id' => isset($r['default_warehouse_id']) ? (int) $r['default_warehouse_id'] : null,
                'default_warehouse_name' => $r['default_warehouse_name'],
            ];
            foreach (['on_hand', 'reserved', 'committed', 'packed', 'in_transit', 'job_worker', 'quality_hold', 'damaged', 'blocked', 'expected_balance', 'available', 'expected', 'pending_out', 'projected'] as $k) {
                $row[$k] = round((float) ($r[$k] ?? 0), 4);
            }
            $advice = self::suggestReplenishment($row['projected'], $row['reorder_point_qty'], $row['safety_stock_qty'], $row['min_stock_qty'], $row['max_stock_qty'], $row['reorder_qty']);
            $row += $advice;
            $row['suggested_value'] = $row['standard_cost'] !== null ? round($advice['suggested_qty'] * $row['standard_cost'], 4) : null;
            $row['needed_by'] = $advice['triggered'] && $row['lead_time_days'] !== null ? date('Y-m-d', strtotime('+' . $row['lead_time_days'] . ' days')) : null;
            $summary['page_suggested_qty'] = round($summary['page_suggested_qty'] + $advice['suggested_qty'], 4);
            $summary['page_suggested_value'] = round($summary['page_suggested_value'] + (float) ($row['suggested_value'] ?? 0), 4);
            $rows[] = $row;
        }
        if ($onlyTriggered) {
            $summary['triggered_total'] = $total;
        } else {
            $trigWhere = $where . ' AND ((COALESCE(i.reorder_point_qty,0) > 0 AND ' . $projected . ' <= i.reorder_point_qty) OR (COALESCE(i.safety_stock_qty,0) > 0 AND ' . $projected . ' < i.safety_stock_qty) OR (COALESCE(i.min_stock_qty,0) > 0 AND ' . $projected . ' < i.min_stock_qty))';
            $summary['triggered_total'] = (int) ($db->query('SELECT COUNT(*) AS n' . $fromBase . ' WHERE ' . $trigWhere, $allBinds)->getRowArray()['n'] ?? 0);
        }

        return ['rows' => $rows, 'total' => $total, 'summary' => $summary];
    }

    // ------------------------------------------------------------------ pure helpers (unit tested)

    /** Whole days from $from to $to (negative when $to is earlier); date-only, DST safe. */
    public static function daysBetween(string $from, string $to): int
    {
        try {
            $a = new \DateTimeImmutable(substr($from, 0, 10));
            $b = new \DateTimeImmutable(substr($to, 0, 10));
        } catch (\Throwable) {
            return 0;
        }
        $diff = $a->diff($b);

        return (int) $diff->days * ($diff->invert ? -1 : 1);
    }

    /** Age in days of a layer received at $receivedAt as at $asOf (never negative). */
    public static function ageDays(string $receivedAt, string $asOf): int
    {
        return max(0, self::daysBetween($receivedAt, $asOf));
    }

    /** 0-30 / 31-60 / 61-90 / 91-180 / 180+ */
    public static function ageBucket(int $days): string
    {
        if ($days <= 30) {
            return '0_30';
        }
        if ($days <= 60) {
            return '31_60';
        }
        if ($days <= 90) {
            return '61_90';
        }
        if ($days <= 180) {
            return '91_180';
        }

        return '180_plus';
    }

    /** @return array<string, array{qty: float, value: float}> */
    public static function emptyAgeBuckets(): array
    {
        $out = [];
        foreach (self::AGE_BUCKETS as $b) {
            $out[$b] = ['qty' => 0.0, 'value' => 0.0];
        }

        return $out;
    }

    /**
     * Ensure fast <= slow <= dead (each at least 1 day).
     *
     * @return array{0:int, 1:int, 2:int}
     */
    public static function normaliseThresholds(int $fastDays, int $slowDays, int $deadDays): array
    {
        $fast = max(1, $fastDays);
        $slow = max($fast, $slowDays);
        $dead = max($slow, $deadDays);

        return [$fast, $slow, $dead];
    }

    /**
     * fast: issued within fast_days and had outward movement in the period
     * slow: last issue within slow_days
     * non_moving: last issue within dead_days (or never issued but received within dead_days)
     * dead: no issue for more than dead_days (or no movement at all)
     */
    public static function classifyMovement(?int $daysSinceLastOut, float $periodOutQty, int $fastDays = 30, int $slowDays = 90, int $deadDays = 180, ?int $daysSinceLastMovement = null): string
    {
        [$fastDays, $slowDays, $deadDays] = self::normaliseThresholds($fastDays, $slowDays, $deadDays);
        if ($daysSinceLastOut === null) {
            return $daysSinceLastMovement !== null && $daysSinceLastMovement <= $deadDays ? 'non_moving' : 'dead';
        }
        if ($daysSinceLastOut > $deadDays) {
            return 'dead';
        }
        if ($daysSinceLastOut <= $fastDays && $periodOutQty > 0) {
            return 'fast';
        }
        if ($daysSinceLastOut <= $slowDays) {
            return 'slow';
        }

        return 'non_moving';
    }

    /**
     * Reorder advice. Thresholds <= 0 or NULL are "not set". Triggered when projected <= reorder point,
     * or projected < safety stock / min stock. Target = max stock when set, else the highest trigger
     * threshold + reorder qty (fixed lot) when set, else the threshold itself. suggested = max(0, target - projected).
     *
     * @return array{triggered: bool, reasons: list<string>, target_basis: ?string, target_qty: ?float, suggested_qty: float}
     */
    public static function suggestReplenishment(float $projected, ?float $reorderPoint, ?float $safetyStock, ?float $minStock, ?float $maxStock, ?float $reorderQty): array
    {
        $set = static fn (?float $v): bool => $v !== null && $v > 0;
        $reasons = [];
        if ($set($reorderPoint) && $projected <= $reorderPoint) {
            $reasons[] = 'reorder_point';
        }
        if ($set($safetyStock) && $projected < $safetyStock) {
            $reasons[] = 'safety_stock';
        }
        if ($set($minStock) && $projected < $minStock) {
            $reasons[] = 'min_stock';
        }
        if ($reasons === []) {
            return ['triggered' => false, 'reasons' => [], 'target_basis' => null, 'target_qty' => null, 'suggested_qty' => 0.0];
        }
        $threshold = max($set($reorderPoint) ? $reorderPoint : 0.0, $set($safetyStock) ? $safetyStock : 0.0, $set($minStock) ? $minStock : 0.0);
        if ($set($maxStock)) {
            $target = max($maxStock, $threshold);
            $basis = 'max_stock';
        } elseif ($set($reorderQty)) {
            $target = $threshold + $reorderQty;
            $basis = 'reorder_qty';
        } else {
            $target = $threshold;
            $basis = 'threshold';
        }

        return ['triggered' => true, 'reasons' => $reasons, 'target_basis' => $basis, 'target_qty' => round($target, 4), 'suggested_qty' => max(0.0, round($target - $projected, 4))];
    }

    // ------------------------------------------------------------------ internals

    /**
     * @param list<int> $ids
     * @return array<int, array<string, mixed>>
     */
    private function itemMeta(int $cmpId, array $ids): array
    {
        $ids = array_values(array_unique(array_filter(array_map('intval', $ids), static fn ($i) => $i > 0)));
        $out = [];
        $db = \Config\Database::connect();
        foreach (array_chunk($ids, 500) as $chunk) {
            $rows = $db->table('inv_items i')
                ->select('i.item_id, i.item_name, i.item_alias, i.item_sku, i.item_upc, i.unit_id, u.unit_symbol, i.item_grp_id, g.grp_name, i.stock_cat_id, c.cat_name, i.brand_id, i.valuation_method, i.track_batch, i.track_serial, i.track_expiry, i.is_active, i.deleted_at')
                ->join('inv_uom u', 'u.unit_id = i.unit_id', 'left')
                ->join('inv_item_groups g', 'g.item_grp_id = i.item_grp_id', 'left')
                ->join('inv_stock_categories c', 'c.stock_cat_id = i.stock_cat_id', 'left')
                ->where('i.cmp_id', $cmpId)->whereIn('i.item_id', $chunk)->get()->getResultArray();
            foreach ($rows as $r) {
                $out[(int) $r['item_id']] = $r;
            }
        }

        return $out;
    }

    /** @return array<int, array<string, mixed>> keyed by warehouse_id */
    private function warehouseMeta(int $cmpId): array
    {
        $out = [];
        foreach (\Config\Database::connect()->table('inv_warehouses')->select('warehouse_id, warehouse_name, warehouse_code, warehouse_type, bo_id, is_active')->where('cmp_id', $cmpId)->get()->getResultArray() as $r) {
            $out[(int) $r['warehouse_id']] = $r;
        }

        return $out;
    }

    /** @return array<string, mixed> */
    private function itemColumns(?array $meta, int $itemId): array
    {
        return [
            'item_id'          => $itemId,
            'item_name'        => $meta['item_name'] ?? null,
            'item_alias'       => $meta['item_alias'] ?? null,
            'item_sku'         => $meta['item_sku'] ?? null,
            'unit_id'          => isset($meta['unit_id']) ? (int) $meta['unit_id'] : null,
            'unit_symbol'      => $meta['unit_symbol'] ?? null,
            'item_grp_id'      => isset($meta['item_grp_id']) ? (int) $meta['item_grp_id'] : null,
            'grp_name'         => $meta['grp_name'] ?? null,
            'stock_cat_id'     => isset($meta['stock_cat_id']) ? (int) $meta['stock_cat_id'] : null,
            'cat_name'         => $meta['cat_name'] ?? null,
            'valuation_method' => $meta['valuation_method'] ?? null,
            'is_active'        => isset($meta['is_active']) ? (int) $meta['is_active'] : null,
        ];
    }

    /**
     * Keep only items matching item_grp_id / stock_cat_id (items without a master row are kept unless a filter is set).
     *
     * @template T
     * @param array<int, T> $byItem
     * @param array<int, array<string, mixed>> $meta
     * @return array<int, T>
     */
    private function applyItemFilters(array $byItem, array $meta, array $f): array
    {
        $grp = (int) ($f['item_grp_id'] ?? 0);
        $cat = (int) ($f['stock_cat_id'] ?? 0);
        if ($grp <= 0 && $cat <= 0) {
            return $byItem;
        }

        return array_filter($byItem, static function ($v, $id) use ($meta, $grp, $cat) {
            $m = $meta[$id] ?? null;
            if ($m === null) {
                return false;
            }
            if ($grp > 0 && (int) ($m['item_grp_id'] ?? 0) !== $grp) {
                return false;
            }

            return !($cat > 0 && (int) ($m['stock_cat_id'] ?? 0) !== $cat);
        }, ARRAY_FILTER_USE_BOTH);
    }

    private function appendIntFilter(string &$where, array &$binds, string $column, mixed $value): void
    {
        $v = (int) ($value ?? 0);
        if ($v > 0) {
            $where .= ' AND ' . $column . ' = ?';
            $binds[] = $v;
        }
    }

    /** Branch scoping on warehouse-backed rows: the branch's warehouses plus company-wide ones (bo_id 0). */
    private function appendBranchFilter(string &$where, array &$binds, int $boId): void
    {
        if ($boId > 0) {
            $where .= ' AND (w.warehouse_id IS NULL OR w.bo_id = 0 OR w.bo_id = ?)';
            $binds[] = $boId;
        }
    }

    private function fyStart(int $cmpId, int $fyId): ?string
    {
        if ($fyId <= 0) {
            return null;
        }
        $row = \Config\Database::connect()->table('inv_fy_ranges')->select('fy_start')->where('cmp_id', $cmpId)->where('fy_id', $fyId)->get()->getRowArray();

        return $row && !empty($row['fy_start']) ? substr((string) $row['fy_start'], 0, 10) : null;
    }

    private static function dayBefore(string $date): string
    {
        return date('Y-m-d', strtotime($date . ' -1 day'));
    }

    /**
     * @param list<array<string, mixed>> $rows
     * @param list<string> $allowed
     */
    private static function sortRows(array &$rows, string $sort, string $order, array $allowed, ?string $secondary = null): void
    {
        $key = in_array($sort, $allowed, true) ? $sort : $allowed[0];
        $dir = strtoupper($order) === 'DESC' ? -1 : 1;
        usort($rows, static function ($a, $b) use ($key, $dir, $secondary) {
            $x = $a[$key] ?? null;
            $y = $b[$key] ?? null;
            $c = is_numeric($x) && is_numeric($y) ? ($x <=> $y) : strcasecmp((string) $x, (string) $y);
            if ($c === 0 && $secondary !== null) {
                $c = strcasecmp((string) ($a[$secondary] ?? ''), (string) ($b[$secondary] ?? ''));
            }
            if ($c === 0) {
                $c = ((int) ($a['item_id'] ?? 0)) <=> ((int) ($b['item_id'] ?? 0));
            }

            return $c * $dir;
        });
    }
}
