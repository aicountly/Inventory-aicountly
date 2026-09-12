<?php

namespace App\Services;

/**
 * Posting-time valuation: FIFO / LIFO cost layers and weighted average, per company-item
 * (or per warehouse when inv_company_settings.valuation_scope = 'warehouse').
 *
 * Algorithms are a faithful port of Books' StockValuationService so every historical
 * COGS figure is reproducible:
 *   - layers are read chronologically; consumeLayers() applies the FIFO/LIFO direction
 *   - a shortfall is priced at the newest known cost and recorded as a negative
 *     "backorder" layer (negative stock is allowed unless policy blocks it)
 *   - a WAC issue with average 0 falls back to the last known cost
 *   - the opening layer is stamped at the FY start so it is always consumed first
 */
class ValuationEngine
{
    public const LAYER_EPOCH = '1970-01-01 00:00:00';

    /** @var array<string, float> */
    private array $historicCostCache = [];
    /** @var array<int, string> */
    private array $fyStartCache = [];

    public function __construct(
        protected ?InventorySettingsService $settings = null,
        protected ?UnitConversionService $units = null,
        protected ?OpeningStockResolver $openings = null,
        protected ?ManageContextService $manage = null,
    ) {
        $this->settings ??= new InventorySettingsService();
        $this->units ??= new UnitConversionService();
        $this->openings ??= new OpeningStockResolver($this->units);
        $this->manage ??= new ManageContextService();
    }

    public function resolveMethod(int $cmpId, int $itemId, ?string $override = null): string
    {
        if ($override !== null && $override !== '') {
            return InventorySettingsService::normalizeMethod($override);
        }
        $row = \Config\Database::connect()->table('inv_items')->select('valuation_method')
            ->where('cmp_id', $cmpId)->where('item_id', $itemId)->get()->getRowArray();
        if ($row && !empty($row['valuation_method'])) {
            return InventorySettingsService::normalizeMethod($row['valuation_method']);
        }

        return $this->settings->defaultValuationMethod($cmpId);
    }

    /** @param list<int> $itemIds @return array<int, string> */
    public function methodsForItems(int $cmpId, array $itemIds): array
    {
        $default = $this->settings->defaultValuationMethod($cmpId);
        $out = [];
        foreach (array_chunk(array_values(array_unique($itemIds)), 500) as $chunk) {
            $rows = \Config\Database::connect()->table('inv_items')->select('item_id, valuation_method')
                ->where('cmp_id', $cmpId)->whereIn('item_id', $chunk)->get()->getResultArray();
            foreach ($rows as $r) {
                $out[(int) $r['item_id']] = InventorySettingsService::normalizeMethod($r['valuation_method'] ?? '', $default);
            }
        }
        foreach ($itemIds as $id) {
            $out[$id] ??= $default;
        }

        return $out;
    }

    /** Layer scope key: NULL warehouse under company scope. */
    public function scopeWarehouse(int $cmpId, ?int $warehouseId): ?int
    {
        return $this->settings->valuationScope($cmpId) === 'warehouse' && $warehouseId !== null && $warehouseId > 0 ? $warehouseId : null;
    }

    /**
     * @return array{valuation_rate: float, valuation_amount: float, valuation_method_applied: string}
     */
    public function recordReceipt(
        int $cmpId,
        int $fyId,
        int $itemId,
        ?int $warehouseId,
        float $baseQty,
        float $baseUnitCost,
        string $receivedAt,
        ?int $documentId = null,
        ?int $lineId = null,
        string $layerKind = 'receipt',
        ?string $methodOverride = null,
    ): array {
        if ($baseQty <= 0) {
            throw new \RuntimeException('Receipt quantity must be positive', 422);
        }
        $unitCost = max(0.0, round($baseUnitCost, 4));
        $method = $this->resolveMethod($cmpId, $itemId, $methodOverride);
        $db = \Config\Database::connect();
        $wh = $this->scopeWarehouse($cmpId, $warehouseId);
        if ($layerKind !== 'opening') {
            $this->ensureOpeningSeeded($cmpId, $fyId, $itemId, $wh);
        }

        if ($method === 'WAC') {
            $state = $this->loadWacState($db, $cmpId, $itemId, $wh);
            $updated = self::computeWacAfterReceipt($state['qty_on_hand'], $state['average_cost'], $baseQty, $unitCost);
            $this->saveWacState($db, $cmpId, $itemId, $wh, $updated['qty_on_hand'], $updated['average_cost']);
        } else {
            $this->insertLayer($db, $cmpId, $fyId, $itemId, $wh, $baseQty, $unitCost, $receivedAt, $documentId, $lineId, $layerKind);
        }

        return [
            'valuation_rate'           => $unitCost,
            'valuation_amount'         => round($baseQty * $unitCost, 4),
            'valuation_method_applied' => $method,
        ];
    }

    /**
     * @return array{valuation_rate: float, valuation_amount: float, valuation_method_applied: string, consumptions: list<array{layer_id:int, qty:float, unit_cost:float}>, backorder_layer_id: ?int}
     */
    public function issueStock(
        int $cmpId,
        int $fyId,
        int $itemId,
        ?int $warehouseId,
        float $baseQty,
        string $issuedAt,
        ?int $documentId = null,
        ?int $lineId = null,
        ?string $methodOverride = null,
    ): array {
        if ($baseQty <= 0) {
            throw new \RuntimeException('Issue quantity must be positive', 422);
        }
        $method = $this->resolveMethod($cmpId, $itemId, $methodOverride);
        $db = \Config\Database::connect();
        $wh = $this->scopeWarehouse($cmpId, $warehouseId);
        $this->ensureOpeningSeeded($cmpId, $fyId, $itemId, $wh);

        if ($method === 'WAC') {
            $r = $this->issueWac($db, $cmpId, $itemId, $wh, $baseQty);
            $r['consumptions'] = [];
            $r['backorder_layer_id'] = null;
        } else {
            $r = $this->issueFromLayers($db, $cmpId, $fyId, $itemId, $wh, $baseQty, $method === 'LIFO' ? 'DESC' : 'ASC', $issuedAt, $documentId, $lineId);
        }
        $r['valuation_method_applied'] = $method;

        return $r;
    }

    /**
     * Quantity the layers / WAC state currently hold (base units) — a fast "how much can I issue" probe.
     */
    public function onHandPerValuation(int $cmpId, int $itemId, ?int $warehouseId): float
    {
        $db = \Config\Database::connect();
        $wh = $this->scopeWarehouse($cmpId, $warehouseId);
        if ($this->resolveMethod($cmpId, $itemId) === 'WAC') {
            return $this->loadWacState($db, $cmpId, $itemId, $wh)['qty_on_hand'];
        }
        $b = $db->table('inv_cost_layers')->selectSum('qty_remaining', 'q')->where('cmp_id', $cmpId)->where('item_id', $itemId);
        $wh === null ? $b->where('warehouse_id', null) : $b->where('warehouse_id', $wh);
        $row = $b->get()->getRowArray();

        return round((float) ($row['q'] ?? 0), 4);
    }

    /** @var array<string, true> */
    private array $openingChecked = [];

    /**
     * Books seeded the opening layer when the item master was saved. Inventory seeds it the first
     * time valuation touches an item in a year that has opening rows but no opening layer yet, so a
     * receipt/issue never silently ignores the opening stock.
     */
    public function ensureOpeningSeeded(int $cmpId, int $fyId, int $itemId, ?int $wh): void
    {
        $key = $cmpId . ':' . $itemId . ':' . ($wh ?? 0);
        if (isset($this->openingChecked[$key])) {
            return;
        }
        $this->openingChecked[$key] = true;
        $db = \Config\Database::connect();
        $b = $db->table('inv_cost_layers')->where('cmp_id', $cmpId)->where('item_id', $itemId)->where('layer_kind', 'opening');
        $wh === null ? $b->where('warehouse_id', null) : $b->where('warehouse_id', $wh);
        if ($b->countAllResults() > 0) {
            return;
        }
        if ($this->resolveMethod($cmpId, $itemId) === 'WAC') {
            $state = $this->loadWacState($db, $cmpId, $itemId, $wh);
            if ($state['qty_on_hand'] != 0.0 || $state['average_cost'] > 0) {
                return;
            }
        }
        $layers = $this->openings->openingLayersByItem($cmpId, $fyId, [$itemId])[$itemId] ?? [];
        if ($layers === []) {
            return;
        }
        $this->seedOpeningStock($cmpId, $fyId, $itemId, $wh);
    }

    /**
     * Re-seed the opening layer / WAC state for an item from its opening rows for the year.
     * Existing opening layers (layer_kind = 'opening') are replaced; transaction layers are kept.
     */
    public function seedOpeningStock(int $cmpId, int $fyId, int $itemId, ?int $warehouseId = null): void
    {
        $db = \Config\Database::connect();
        $lines = $this->openings->openingLines($cmpId, $fyId, [$itemId]);
        $totalQty = 0.0;
        $totalValue = 0.0;
        foreach ($lines as $line) {
            if ($warehouseId !== null && $warehouseId > 0 && (int) ($line['warehouse_id'] ?? 0) !== $warehouseId) {
                continue;
            }
            $layer = OpeningStockResolver::layerFromOpeningLine($line);
            if ($layer === null) {
                continue;
            }
            $totalQty += $layer['qty_remaining'];
            $totalValue += $layer['qty_remaining'] * $layer['unit_cost'];
        }
        $wh = $this->scopeWarehouse($cmpId, $warehouseId);
        $delete = $db->table('inv_cost_layers')->where('cmp_id', $cmpId)->where('item_id', $itemId)->where('layer_kind', 'opening');
        $wh === null ? $delete->where('warehouse_id', null) : $delete->where('warehouse_id', $wh);
        $delete->delete();

        if ($totalQty <= 0) {
            if ($this->resolveMethod($cmpId, $itemId) === 'WAC') {
                // Keep transaction-derived state; nothing to seed.
            }

            return;
        }
        $avgRate = round($totalValue / $totalQty, 4);
        $method = $this->resolveMethod($cmpId, $itemId);
        if ($method === 'WAC') {
            $this->saveWacState($db, $cmpId, $itemId, $wh, round($totalQty, 4), $avgRate);

            return;
        }
        $this->insertLayer($db, $cmpId, $fyId, $itemId, $wh, round($totalQty, 4), $avgRate, $this->fyStartTimestamp($cmpId, $fyId), null, null, 'opening');
    }

    /**
     * Drop every layer and WAC row of an item (used by the replay/rebuild worker before re-seeding).
     */
    public function clearValuationState(int $cmpId, int $itemId, ?int $warehouseId = null): void
    {
        unset($this->openingChecked[$cmpId . ':' . $itemId . ':' . ($this->scopeWarehouse($cmpId, $warehouseId) ?? 0)]);
        $db = \Config\Database::connect();
        $wh = $this->scopeWarehouse($cmpId, $warehouseId);
        $b = $db->table('inv_cost_layers')->where('cmp_id', $cmpId)->where('item_id', $itemId);
        $wh === null ? $b->where('warehouse_id', null) : $b->where('warehouse_id', $wh);
        $b->delete();
        $db->table('inv_cost_layer_consumptions')->where('cmp_id', $cmpId)
            ->whereIn('layer_id', static fn ($sub) => $sub->select('layer_id')->from('inv_cost_layers')->where('cmp_id', $cmpId)->where('item_id', $itemId))
            ->delete();
        $db->table('inv_wac_state')->where('cmp_id', $cmpId)->where('item_id', $itemId)->where('warehouse_id', $wh ?? 0)->delete();
    }

    public function fyStartTimestamp(int $cmpId, int $fyId): string
    {
        if ($fyId <= 0) {
            return self::LAYER_EPOCH;
        }
        if (isset($this->fyStartCache[$fyId])) {
            return $this->fyStartCache[$fyId];
        }
        $range = $this->manage->fyDateRange($cmpId, $fyId);
        $start = $range !== null && !empty($range['fy_start']) ? substr($range['fy_start'], 0, 10) . ' 00:00:00' : self::LAYER_EPOCH;

        return $this->fyStartCache[$fyId] = $start;
    }

    // ------------------------------------------------------------------ pure helpers

    /**
     * @param list<array{qty_remaining: float, unit_cost: float}> $layers
     * @return array{cost_amount: float, cost_rate: float, layers: list<array{qty_remaining: float, unit_cost: float}>, backorder: ?array{qty: float, unit_cost: float}, takes: list<array{index:int, qty:float, unit_cost:float}>}
     */
    public static function consumeLayers(array $layers, float $qty, string $order = 'ASC', float $fallbackUnitCost = 0.0): array
    {
        $layers = array_values($layers);
        $sequence = array_keys($layers);
        if (strtoupper($order) === 'DESC') {
            $sequence = array_reverse($sequence);
        }
        $remaining = round($qty, 4);
        $totalCost = 0.0;
        $takes = [];
        foreach ($sequence as $idx) {
            if ($remaining <= 0.0001) {
                break;
            }
            $available = (float) ($layers[$idx]['qty_remaining'] ?? 0);
            if ($available <= 0) {
                continue;
            }
            $take = min($available, $remaining);
            $unit = (float) ($layers[$idx]['unit_cost'] ?? 0);
            $totalCost += $take * $unit;
            $layers[$idx]['qty_remaining'] = round($available - $take, 4);
            $remaining = round($remaining - $take, 4);
            $takes[] = ['index' => $idx, 'qty' => round($take, 4), 'unit_cost' => $unit];
        }
        $backorder = null;
        if ($remaining > 0.0001) {
            $unitCost = self::lastKnownUnitCost($layers);
            if ($unitCost <= 0) {
                $unitCost = max(0.0, round($fallbackUnitCost, 4));
            }
            $totalCost += $remaining * $unitCost;
            $backorder = ['qty' => round(-$remaining, 4), 'unit_cost' => $unitCost];
            $layers[] = ['qty_remaining' => $backorder['qty'], 'unit_cost' => $unitCost];
        }
        $costAmount = round($totalCost, 4);

        return [
            'cost_amount' => $costAmount,
            'cost_rate'   => $qty > 0 ? round($costAmount / $qty, 4) : 0.0,
            'layers'      => $layers,
            'backorder'   => $backorder,
            'takes'       => $takes,
        ];
    }

    /** @param list<array{qty_remaining: float, unit_cost: float}> $layers */
    public static function lastKnownUnitCost(array $layers): float
    {
        $layers = array_values($layers);
        for ($i = count($layers) - 1; $i >= 0; $i--) {
            $cost = (float) ($layers[$i]['unit_cost'] ?? 0);
            if ($cost > 0) {
                return $cost;
            }
        }

        return 0.0;
    }

    /** @return array{qty_on_hand: float, average_cost: float} */
    public static function computeWacAfterReceipt(float $oldQty, float $oldAvg, float $inQty, float $inCost): array
    {
        $newQty = round($oldQty + $inQty, 4);
        $inCost = round($inCost, 4);
        if ($oldQty < -0.0001) {
            return ['qty_on_hand' => $newQty, 'average_cost' => $inCost];
        }
        if ($newQty <= 0) {
            return ['qty_on_hand' => $newQty, 'average_cost' => $oldAvg > 0 ? $oldAvg : $inCost];
        }
        if ($oldQty <= 0.0001) {
            return ['qty_on_hand' => $newQty, 'average_cost' => $inCost];
        }

        return ['qty_on_hand' => $newQty, 'average_cost' => round(($oldQty * $oldAvg + $inQty * $inCost) / $newQty, 4)];
    }

    // ------------------------------------------------------------------ internals

    /** @return array{valuation_rate: float, valuation_amount: float, consumptions: list<array{layer_id:int, qty:float, unit_cost:float}>, backorder_layer_id: ?int} */
    private function issueFromLayers($db, int $cmpId, int $fyId, int $itemId, ?int $wh, float $qty, string $order, string $issuedAt, ?int $documentId, ?int $lineId): array
    {
        $b = $db->table('inv_cost_layers')
            ->where('cmp_id', $cmpId)->where('item_id', $itemId)->where('qty_remaining >', 0)
            ->orderBy('received_at', 'ASC')->orderBy('layer_id', 'ASC');
        $wh === null ? $b->where('warehouse_id', null) : $b->where('warehouse_id', $wh);
        $rows = $b->get()->getResultArray();

        $layers = array_map(static fn ($r) => ['layer_id' => (int) $r['layer_id'], 'qty_remaining' => (float) $r['qty_remaining'], 'unit_cost' => (float) $r['unit_cost']], $rows);
        $sim = array_map(static fn ($l) => ['qty_remaining' => $l['qty_remaining'], 'unit_cost' => $l['unit_cost']], $layers);

        $available = 0.0;
        foreach ($sim as $l) {
            $available += $l['qty_remaining'];
        }
        $fallback = $available + 0.0001 < $qty ? $this->resolveFallbackUnitCost($db, $cmpId, $itemId, $wh) : 0.0;

        $result = self::consumeLayers($sim, $qty, $order, $fallback);
        $consumptions = [];
        foreach ($layers as $i => $layer) {
            if (!isset($result['layers'][$i]['qty_remaining'])) {
                continue;
            }
            $updatedQty = (float) $result['layers'][$i]['qty_remaining'];
            if (abs($updatedQty - $layer['qty_remaining']) < 0.00001) {
                continue;
            }
            $db->table('inv_cost_layers')->where('layer_id', $layer['layer_id'])->update(['qty_remaining' => $updatedQty]);
        }
        foreach ($result['takes'] as $take) {
            $consumptions[] = ['layer_id' => $layers[$take['index']]['layer_id'], 'qty' => $take['qty'], 'unit_cost' => $take['unit_cost']];
        }
        $backorderId = null;
        if (is_array($result['backorder'])) {
            $backorderId = $this->insertLayer($db, $cmpId, $fyId, $itemId, $wh, (float) $result['backorder']['qty'], (float) $result['backorder']['unit_cost'], $issuedAt, $documentId, $lineId, 'backorder');
        }
        if ($documentId !== null && $lineId !== null && $consumptions !== []) {
            $rows = [];
            foreach ($consumptions as $c) {
                $rows[] = ['cmp_id' => $cmpId, 'layer_id' => $c['layer_id'], 'document_id' => $documentId, 'line_id' => $lineId, 'qty' => $c['qty'], 'unit_cost' => $c['unit_cost'], 'created_at' => date('Y-m-d H:i:s')];
            }
            $db->table('inv_cost_layer_consumptions')->insertBatch($rows);
        }

        return [
            'valuation_rate'     => $result['cost_rate'],
            'valuation_amount'   => $result['cost_amount'],
            'consumptions'       => $consumptions,
            'backorder_layer_id' => $backorderId,
        ];
    }

    /** @return array{valuation_rate: float, valuation_amount: float} */
    private function issueWac($db, int $cmpId, int $itemId, ?int $wh, float $qty): array
    {
        $state = $this->loadWacState($db, $cmpId, $itemId, $wh);
        $avg = $state['average_cost'];
        if ($avg <= 0) {
            $avg = $this->resolveFallbackUnitCost($db, $cmpId, $itemId, $wh);
        }
        $this->saveWacState($db, $cmpId, $itemId, $wh, round($state['qty_on_hand'] - $qty, 4), $avg);

        return ['valuation_rate' => $avg, 'valuation_amount' => round($qty * $avg, 4)];
    }

    public function resolveFallbackUnitCost($db, int $cmpId, int $itemId, ?int $wh): float
    {
        if ($cmpId <= 0 || $itemId <= 0) {
            return 0.0;
        }
        $b = $db->table('inv_cost_layers')->select('unit_cost')->where('cmp_id', $cmpId)->where('item_id', $itemId)->where('unit_cost >', 0)
            ->orderBy('received_at', 'DESC')->orderBy('layer_id', 'DESC')->limit(1);
        $wh === null ? $b->where('warehouse_id', null) : $b->where('warehouse_id', $wh);
        $cost = (float) ($b->get()->getRowArray()['unit_cost'] ?? 0);
        if ($cost <= 0) {
            $cost = $this->loadWacState($db, $cmpId, $itemId, $wh)['average_cost'];
        }
        if ($cost <= 0) {
            $cost = $this->historicUnitCost($db, $cmpId, $itemId);
        }

        return $cost > 0 ? round($cost, 4) : 0.0;
    }

    private function historicUnitCost($db, int $cmpId, int $itemId): float
    {
        $key = $cmpId . ':' . $itemId;
        if (array_key_exists($key, $this->historicCostCache)) {
            return $this->historicCostCache[$key];
        }
        // Last inward line with a valuation rate, else last inward with a source rate, else the opening.
        $row = $db->table('inv_document_lines l')
            ->select('l.valuation_rate, l.source_transaction_rate, l.source_transaction_amount, l.base_qty, l.qty, l.unit_id')
            ->join('inv_documents d', 'd.document_id = l.document_id', 'inner')
            ->where('l.cmp_id', $cmpId)->where('l.item_id', $itemId)->where('l.direction', 'in')
            ->whereIn('d.status', ['POSTED', 'COMPLETED', 'PARTIALLY_FULFILLED'])
            ->orderBy('d.document_date', 'DESC')->orderBy('l.line_id', 'DESC')->limit(1)
            ->get()->getRowArray();
        $cost = 0.0;
        if ($row) {
            $cost = (float) ($row['valuation_rate'] ?? 0);
            if ($cost <= 0) {
                $factor = $this->units->factorFor($cmpId, $itemId, (int) ($row['unit_id'] ?? 0) ?: null);
                $rate = UnitConversionService::effectiveRate((float) $row['qty'], (float) ($row['source_transaction_rate'] ?? 0), (float) ($row['source_transaction_amount'] ?? 0));
                $cost = UnitConversionService::toBaseUnitCost($rate, $factor);
            }
        }
        if ($cost <= 0) {
            foreach ($this->openings->openingLayersByItem($cmpId, 0, [$itemId])[$itemId] ?? [] as $layer) {
                $cost = (float) $layer['unit_cost'];
            }
        }

        return $this->historicCostCache[$key] = max(0.0, round($cost, 4));
    }

    private function insertLayer($db, int $cmpId, int $fyId, int $itemId, ?int $wh, float $qty, float $unitCost, string $receivedAt, ?int $documentId, ?int $lineId, string $kind): int
    {
        $db->table('inv_cost_layers')->insert([
            'cmp_id'             => $cmpId,
            'fy_id'              => $fyId,
            'item_id'            => $itemId,
            'warehouse_id'       => $wh,
            'layer_kind'         => $kind,
            'qty_received'       => round($qty, 4),
            'qty_remaining'      => round($qty, 4),
            'unit_cost'          => round($unitCost, 4),
            'received_at'        => $receivedAt,
            'source_document_id' => $documentId,
            'source_line_id'     => $lineId,
            'created_at'         => date('Y-m-d H:i:s'),
        ]);

        return (int) $db->insertID();
    }

    /** @return array{qty_on_hand: float, average_cost: float} */
    private function loadWacState($db, int $cmpId, int $itemId, ?int $wh): array
    {
        $row = $db->table('inv_wac_state')->where('cmp_id', $cmpId)->where('item_id', $itemId)->where('warehouse_id', $wh ?? 0)->get()->getRowArray();

        return ['qty_on_hand' => (float) ($row['qty_on_hand'] ?? 0), 'average_cost' => (float) ($row['average_cost'] ?? 0)];
    }

    private function saveWacState($db, int $cmpId, int $itemId, ?int $wh, float $qty, float $avg): void
    {
        $now = date('Y-m-d H:i:s');
        $exists = $db->table('inv_wac_state')->where('cmp_id', $cmpId)->where('item_id', $itemId)->where('warehouse_id', $wh ?? 0)->countAllResults() > 0;
        $payload = ['qty_on_hand' => round($qty, 4), 'average_cost' => round($avg, 4), 'updated_at' => $now];
        if ($exists) {
            $db->table('inv_wac_state')->where('cmp_id', $cmpId)->where('item_id', $itemId)->where('warehouse_id', $wh ?? 0)->update($payload);
        } else {
            $db->table('inv_wac_state')->insert(array_merge(['cmp_id' => $cmpId, 'item_id' => $itemId, 'warehouse_id' => $wh ?? 0], $payload));
        }
    }
}
