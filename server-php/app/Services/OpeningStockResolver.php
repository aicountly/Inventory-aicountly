<?php

namespace App\Services;

/**
 * Opening stock for a financial year, in base units.
 *
 * Rule (identical to Books' ItemOpeningQtyResolver / ItemOpeningLayerLoader):
 *   once the close has run into FY -> inv_item_openings rows with fy_id = FY are authoritative
 *   (even when there are none); otherwise the inception opening (fy_id = 0) applies.
 * Inception rows carry no warehouse split (Books item-master openings had no material centre).
 */
class OpeningStockResolver
{
    public function __construct(protected ?UnitConversionService $units = null)
    {
        $this->units ??= new UnitConversionService();
    }

    /**
     * Opening rows for a year, shaped like unit lines (item_id, warehouse_id, unit_id, opening_qty,
     * opening_valuation_rate, is_default, conversion_factor, batch_id).
     *
     * $boId: branch scope, default null = every branch (the long-standing behaviour every caller
     * except ReconciliationService relies on — a costing rate under company-scope valuation is
     * legitimately pooled across all branches, so narrowing this default would silently change
     * WAC/FIFO costs everywhere it's used for that). Pass a real branch id only when the caller
     * itself is answering a single-branch question, e.g. one branch's opening value.
     * A row with no warehouse_id, or a warehouse belonging to no branch, is company-wide and
     * always stays in scope, same predicate as StockBalanceService::listBalances().
     *
     * @param list<int> $itemIds empty = all
     * @return list<array<string, mixed>>
     */
    public function openingLines(int $cmpId, int $fyId, array $itemIds = [], ?int $boId = null): array
    {
        $db = \Config\Database::connect();
        $this->units->warmCompany($cmpId);
        $useCarried = $fyId > 0 && FyCarryForwardStatus::hasRunInto($cmpId, $fyId);
        $b = $db->table('inv_item_openings o')
            ->select('o.opening_id, o.item_id, o.warehouse_id, o.unit_id, o.batch_id, o.opening_qty, o.opening_valuation_rate, o.opening_value, o.source_kind')
            ->where('o.cmp_id', $cmpId)
            ->where('o.fy_id', $useCarried ? $fyId : 0)
            ->orderBy('o.item_id', 'ASC')->orderBy('o.opening_id', 'ASC');
        if ($itemIds !== []) {
            $b->whereIn('o.item_id', $itemIds);
        }
        if ($boId !== null && $boId > 0) {
            $b->join('inv_warehouses w', 'w.warehouse_id = o.warehouse_id', 'left')
                ->groupStart()->where('o.warehouse_id', null)->orWhere('w.bo_id', 0)->orWhere('w.bo_id', $boId)->groupEnd();
        }
        $out = [];
        foreach ($b->get()->getResultArray() as $row) {
            $itemId = (int) $row['item_id'];
            $unitId = (int) $row['unit_id'];
            $factor = $this->units->factorFor($cmpId, $itemId, $unitId > 0 ? $unitId : null);
            $defaultUnit = $this->units->defaultUnitId($cmpId, $itemId);
            $row['is_default'] = $defaultUnit === $unitId || $unitId === 0 ? 1 : 0;
            $row['conversion_factor'] = $factor;
            $out[] = $row;
        }

        return $out;
    }

    /**
     * Opening quantity map keyed "item:warehouse" (warehouse 0 when none), base units.
     *
     * $boId scopes the openings to one branch, through the warehouse, exactly as openingLines()
     * does. Unlike the cost side -- where a company-scope WAC/FIFO queue is deliberately shared
     * across branches (see OpeningValueBranchScopeTest) -- a QUANTITY belongs to the branch that
     * holds it. A caller that filters its movements by branch and pools everyone's opening here
     * reports a closing balance that never existed.
     *
     * @return array<string, float>
     */
    public function openingQtyMap(int $cmpId, int $fyId, ?int $warehouseId = null, ?int $itemId = null, ?int $boId = null): array
    {
        $out = [];
        foreach ($this->openingLines($cmpId, $fyId, $itemId ? [$itemId] : [], $boId) as $row) {
            $wh = (int) ($row['warehouse_id'] ?? 0);
            if ($warehouseId !== null && $warehouseId > 0 && $wh !== $warehouseId) {
                continue;
            }
            $qty = (float) $row['opening_qty'];
            if (abs($qty) < 0.0001) {
                continue;
            }
            $key = (int) $row['item_id'] . ':' . $wh;
            $out[$key] = ($out[$key] ?? 0.0) + UnitConversionService::toBaseQty($qty, (float) $row['conversion_factor']);
        }

        return array_map(static fn ($q) => round($q, 4), $out);
    }

    /**
     * One blended opening layer per item (qty_remaining, unit_cost) in base units.
     *
     * $boId: see openingLines() -- default null (every branch) is what every existing caller
     * needs; pass a real branch id only for a genuinely single-branch value question.
     *
     * @param list<int> $itemIds
     * @return array<int, list<array{qty_remaining: float, unit_cost: float}>>
     */
    public function openingLayersByItem(int $cmpId, int $fyId, array $itemIds = [], ?int $boId = null): array
    {
        $byItem = [];
        foreach ($this->openingLines($cmpId, $fyId, $itemIds, $boId) as $row) {
            $layer = self::layerFromOpeningLine($row);
            if ($layer !== null) {
                $byItem[(int) $row['item_id']][] = $layer;
            }
        }
        foreach ($byItem as $itemId => $layers) {
            $byItem[$itemId] = self::collapse($layers);
        }

        return $byItem;
    }

    /** @return array{qty_remaining: float, unit_cost: float}|null */
    public static function layerFromOpeningLine(array $line): ?array
    {
        $qty = (float) ($line['opening_qty'] ?? 0);
        if ($qty <= 0) {
            return null;
        }
        $rate = (float) ($line['opening_valuation_rate'] ?? $line['opening_rate'] ?? 0);
        $factor = !empty($line['is_default']) ? 1.0 : UnitConversionService::normaliseFactor((float) ($line['conversion_factor'] ?? 1));
        $base = UnitConversionService::openingToBase($qty, $rate, $factor);
        if ($base['base_qty'] <= 0) {
            return null;
        }

        return ['qty_remaining' => $base['base_qty'], 'unit_cost' => $base['base_unit_cost']];
    }

    /**
     * @param list<array{qty_remaining: float, unit_cost: float}> $layers
     * @return list<array{qty_remaining: float, unit_cost: float}>
     */
    public static function collapse(array $layers): array
    {
        $qty = 0.0;
        $value = 0.0;
        foreach ($layers as $layer) {
            $q = (float) ($layer['qty_remaining'] ?? 0);
            if ($q <= 0) {
                continue;
            }
            $qty += $q;
            $value += $q * (float) ($layer['unit_cost'] ?? 0);
        }
        if ($qty <= 0) {
            return [];
        }

        return [['qty_remaining' => round($qty, 4), 'unit_cost' => round($value / $qty, 4)]];
    }
}
