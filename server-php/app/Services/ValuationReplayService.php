<?php

namespace App\Services;

/**
 * Report-time valuation: replay opening layers + posted movements in memory per item and
 * value the closing quantity at the cost the item's method resolves. Identical arithmetic to
 * Books' StockValuationService::snapshotValuation() / unitCostsForItems(), so the Trading
 * Account closing stock Books shows reconciles to Inventory to the paisa.
 */
class ValuationReplayService
{
    public function __construct(
        protected ?UnitConversionService $units = null,
        protected ?OpeningStockResolver $openings = null,
        protected ?StockBalanceService $balances = null,
        protected ?ValuationEngine $engine = null,
        protected ?InventorySettingsService $settings = null,
    ) {
        $this->units ??= new UnitConversionService();
        $this->openings ??= new OpeningStockResolver($this->units);
        $this->balances ??= new StockBalanceService($this->units, $this->openings);
        $this->settings ??= new InventorySettingsService();
        $this->engine ??= new ValuationEngine($this->settings, $this->units, $this->openings);
    }

    /**
     * @return array{rows: list<array<string,mixed>>, total_value: float, total_qty: float, method: string}
     */
    public function snapshot(int $cmpId, int $fyId, int $boId, ?string $asOf, string $reportMethod = 'AS_PER_MASTER', ?int $itemId = null, ?int $warehouseId = null): array
    {
        $to = $asOf ?: date('Y-m-d');
        $qtyRows = $this->balances->closingQuantities($cmpId, $fyId, $boId, null, $to, $itemId, $warehouseId);
        $qtyByItem = [];
        foreach ($qtyRows as $r) {
            $qtyByItem[$r['item_id']] = ($qtyByItem[$r['item_id']] ?? 0.0) + $r['closing_qty'];
        }
        $itemIds = array_keys(array_filter($qtyByItem, static fn ($q) => abs($q) >= 0.0001));
        $costs = $this->unitCostsForItems($cmpId, $fyId, $itemIds, $to, $reportMethod, $boId, $warehouseId);
        $db = \Config\Database::connect();
        $names = [];
        foreach (array_chunk($itemIds, 500) as $chunk) {
            foreach ($db->table('inv_items')->select('item_id, item_name, item_alias, unit_id, valuation_method, item_grp_id, stock_cat_id')->where('cmp_id', $cmpId)->whereIn('item_id', $chunk)->get()->getResultArray() as $it) {
                $names[(int) $it['item_id']] = $it;
            }
        }
        $rows = [];
        $total = 0.0;
        $totalQty = 0.0;
        foreach ($itemIds as $id) {
            $qty = round($qtyByItem[$id], 4);
            $cost = $costs[$id]['unit_cost'] ?? 0.0;
            $value = round($qty * $cost, 4);
            $rows[] = [
                'item_id' => $id, 'item_name' => $names[$id]['item_name'] ?? null, 'item_alias' => $names[$id]['item_alias'] ?? null,
                'unit_id' => $names[$id]['unit_id'] ?? null, 'item_grp_id' => $names[$id]['item_grp_id'] ?? null, 'stock_cat_id' => $names[$id]['stock_cat_id'] ?? null,
                'closing_qty' => $qty, 'unit_cost' => $cost, 'stock_value' => $value, 'valuation_method_applied' => $costs[$id]['method'] ?? null,
            ];
            $total += $value;
            $totalQty += $qty;
        }
        usort($rows, static fn ($a, $b) => strcmp((string) ($a['item_name'] ?? ''), (string) ($b['item_name'] ?? '')));

        return ['rows' => $rows, 'total_value' => round($total, 4), 'total_qty' => round($totalQty, 4), 'method' => $reportMethod];
    }

    /**
     * @param list<int> $itemIds
     * @return array<int, array{unit_cost: float, method: string}>
     */
    public function unitCostsForItems(int $cmpId, int $fyId, array $itemIds, string $asOf, string $reportMethod = 'AS_PER_MASTER', int $boId = 0, ?int $warehouseId = null): array
    {
        $itemIds = array_values(array_unique(array_filter(array_map('intval', $itemIds), static fn ($i) => $i > 0)));
        if ($itemIds === []) {
            return [];
        }
        $this->units->warmCompany($cmpId);
        $methods = $reportMethod === 'AS_PER_MASTER' ? $this->engine->methodsForItems($cmpId, $itemIds) : [];
        $openingLayers = $this->openings->openingLayersByItem($cmpId, $fyId, $itemIds);
        $events = $this->loadEvents($cmpId, $fyId, $itemIds, $asOf, $boId, $warehouseId);
        $wac = $this->loadWac($cmpId, $itemIds);
        $out = [];
        foreach ($itemIds as $id) {
            $method = $reportMethod === 'AS_PER_MASTER' ? ($methods[$id] ?? $this->settings->defaultValuationMethod($cmpId)) : InventorySettingsService::normalizeMethod($reportMethod);
            $out[$id] = ['unit_cost' => $this->unitCost($method, $openingLayers[$id] ?? [], $events[$id] ?? [], $wac[$id] ?? ['qty_on_hand' => 0.0, 'average_cost' => 0.0]), 'method' => $method];
        }

        return $out;
    }

    private function unitCost(string $method, array $openingLayers, array $events, array $wac): float
    {
        if ($method === 'WAC') {
            // Books valued WAC at the persisted running average; the replayed average is used when no state exists.
            if ((float) ($wac['average_cost'] ?? 0) > 0) {
                return (float) $wac['average_cost'];
            }

            return $this->replayWac($openingLayers, $events);
        }
        $unitCost = (float) $this->replayLayers($openingLayers, $events, $method)['unit_cost'];
        if ($unitCost > 0) {
            return $unitCost;
        }

        return self::newestKnownUnitCost($openingLayers, $events);
    }

    /** @return array{unit_cost: float, stock_value: float} */
    public function replayLayers(array $layers, array $events, string $method): array
    {
        $lifo = $method === 'LIFO';
        $live = [];
        $lastCost = 0.0;
        foreach ($layers as $idx => $layer) {
            if ((float) $layer['qty_remaining'] > 0) {
                $live[] = $idx;
            }
            if ((float) $layer['unit_cost'] > 0) {
                $lastCost = (float) $layer['unit_cost'];
            }
        }
        $lo = 0;
        foreach ($events as $event) {
            if ($event['direction'] === 'in') {
                $qty = (float) $event['qty'];
                $unitCost = (float) $event['unit_cost'];
                $layers[] = ['qty_remaining' => $qty, 'unit_cost' => $unitCost];
                if ($qty > 0) {
                    $live[] = array_key_last($layers);
                }
                if ($unitCost > 0) {
                    $lastCost = $unitCost;
                }
                continue;
            }
            $remaining = round((float) $event['qty'], 4);
            while ($remaining > 0.0001) {
                $slot = $lifo ? array_key_last($live) : ($lo < count($live) ? $lo : null);
                if ($slot === null) {
                    break;
                }
                $idx = $live[$slot];
                $available = (float) $layers[$idx]['qty_remaining'];
                $take = min($available, $remaining);
                $layers[$idx]['qty_remaining'] = round($available - $take, 4);
                $remaining = round($remaining - $take, 4);
                if ($layers[$idx]['qty_remaining'] > 0) {
                    break;
                }
                if ($lifo) {
                    array_pop($live);
                } else {
                    $lo++;
                }
            }
            if ($remaining > 0.0001) {
                $layers[] = ['qty_remaining' => round(-$remaining, 4), 'unit_cost' => $lastCost];
            }
        }
        $totalValue = 0.0;
        $totalQty = 0.0;
        foreach ($layers as $layer) {
            $q = (float) $layer['qty_remaining'];
            if ($q <= 0) {
                continue;
            }
            $totalQty += $q;
            $totalValue += $q * (float) $layer['unit_cost'];
        }

        return ['unit_cost' => $totalQty > 0 ? round($totalValue / $totalQty, 4) : 0.0, 'stock_value' => round($totalValue, 4)];
    }

    private function replayWac(array $openingLayers, array $events): float
    {
        $qty = 0.0;
        $avg = 0.0;
        foreach ($openingLayers as $l) {
            $r = ValuationEngine::computeWacAfterReceipt($qty, $avg, (float) $l['qty_remaining'], (float) $l['unit_cost']);
            $qty = $r['qty_on_hand'];
            $avg = $r['average_cost'];
        }
        foreach ($events as $e) {
            if ($e['direction'] === 'in') {
                $r = ValuationEngine::computeWacAfterReceipt($qty, $avg, (float) $e['qty'], (float) $e['unit_cost']);
                $qty = $r['qty_on_hand'];
                $avg = $r['average_cost'];
            } else {
                $qty = round($qty - (float) $e['qty'], 4);
            }
        }

        return $avg;
    }

    private static function newestKnownUnitCost(array $openingLayers, array $events): float
    {
        $events = array_values($events);
        for ($i = count($events) - 1; $i >= 0; $i--) {
            $cost = (float) ($events[$i]['unit_cost'] ?? 0);
            if (($events[$i]['direction'] ?? '') === 'in' && $cost > 0) {
                return $cost;
            }
        }

        return ValuationEngine::lastKnownUnitCost($openingLayers);
    }

    /**
     * Movement events per item in replay order. Inward cost = source rate ÷ factor when the line has a
     * commercial rate (Books rule), else the valuation rate stored on the line (transfers, production, adjustments).
     *
     * @param list<int> $itemIds
     * @return array<int, list<array{direction:string, qty:float, unit_cost:float, date:string}>>
     */
    public function loadEvents(int $cmpId, int $fyId, array $itemIds, string $asOf, int $boId = 0, ?int $warehouseId = null): array
    {
        $db = \Config\Database::connect();
        $out = [];
        foreach (array_chunk($itemIds, 500) as $chunk) {
            $b = $db->table('inv_stock_movements m')
                ->select('m.item_id, m.direction, m.qty, m.unit_cost, m.movement_date, m.document_id, m.line_id, l.qty AS line_qty, l.unit_id, l.source_transaction_rate, l.source_transaction_amount, l.valuation_rate, l.conversion_factor, m.document_type, m.movement_kind')
                ->join('inv_document_lines l', 'l.line_id = m.line_id', 'left')
                ->where('m.cmp_id', $cmpId)->where('m.fy_id', $fyId)->whereIn('m.item_id', $chunk)
                ->where('m.movement_date <=', $asOf)
                ->orderBy('m.movement_date', 'ASC')->orderBy('m.document_id', 'ASC')->orderBy('m.line_id', 'ASC')->orderBy('m.movement_id', 'ASC');
            if ($boId > 0) {
                $b->where('m.bo_id', $boId);
            }
            if ($warehouseId) {
                $b->where('m.warehouse_id', $warehouseId);
            }
            foreach ($b->get()->getResultArray() as $r) {
                $itemId = (int) $r['item_id'];
                $qty = abs((float) $r['qty']);
                if ($qty <= 0) {
                    continue;
                }
                $direction = (float) $r['qty'] > 0 ? 'in' : 'out';
                $unitCost = 0.0;
                if ($direction === 'in') {
                    $srcRate = UnitConversionService::effectiveRate((float) ($r['line_qty'] ?? 0), (float) ($r['source_transaction_rate'] ?? 0), (float) ($r['source_transaction_amount'] ?? 0));
                    if ($srcRate > 0 && in_array($r['document_type'], ['PURCHASE_RECEIPT', 'SALES_RETURN', 'JOURNAL_ADJUSTMENT', 'OPENING_STOCK', 'MATERIAL_RECEIPT', 'WRITE_IN', 'JOB_WORK_IN', 'PRODUCTION', 'PHYSICAL_ADJUSTMENT', 'STOCK_JOURNAL'], true) && $r['movement_kind'] === 'physical') {
                        $unitCost = UnitConversionService::toBaseUnitCost($srcRate, (float) ($r['conversion_factor'] ?: 1));
                    } else {
                        $unitCost = (float) ($r['unit_cost'] ?? $r['valuation_rate'] ?? 0);
                    }
                }
                $out[$itemId][] = ['direction' => $direction, 'qty' => round($qty, 4), 'unit_cost' => round($unitCost, 4), 'date' => (string) $r['movement_date']];
            }
        }

        return $out;
    }

    /** @return array<int, array{qty_on_hand: float, average_cost: float}> */
    private function loadWac(int $cmpId, array $itemIds): array
    {
        $out = [];
        foreach (array_chunk($itemIds, 500) as $chunk) {
            foreach (\Config\Database::connect()->table('inv_wac_state')->select('item_id, SUM(qty_on_hand) q, MAX(average_cost) a', false)->where('cmp_id', $cmpId)->whereIn('item_id', $chunk)->groupBy('item_id')->get()->getResultArray() as $r) {
                $out[(int) $r['item_id']] = ['qty_on_hand' => (float) $r['q'], 'average_cost' => (float) $r['a']];
            }
        }

        return $out;
    }
}
