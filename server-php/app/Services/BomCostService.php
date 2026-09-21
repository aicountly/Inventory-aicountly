<?php

namespace App\Services;

/**
 * What a bill of materials costs to build, from Inventory's own valuation data.
 *
 * The rate is never invented. It is read, in order, from
 *
 *   1. inv_wac_state — the weighted-average cost the valuation engine maintains
 *      per item. Warehouse rows are folded into one company rate by value, not
 *      by taking a maximum: a component held at two costs has one blended cost
 *      to a production run that may draw from either.
 *   2. inv_items.standard_cost — what the company says the item costs when it
 *      has never moved. Marked as such, because a standard is a policy figure
 *      and a reader comparing two BOMs deserves to know which is which.
 *
 * An item with neither is UNPRICED, and stays unpriced all the way to the
 * screen: its line cost is null, the BOM is flagged incomplete and the caller
 * prints "Cost unavailable". Substituting a zero would report a free component,
 * which is a costing error a production manager would act on.
 *
 * Quantities are converted to the item's base unit before they meet the rate,
 * because the rate is per base unit: 2 Box of a component costed at ₹10/Pc with
 * 12 Pc to the Box is ₹240, not ₹20.
 */
class BomCostService
{
    public const SOURCE_AVERAGE = 'weighted_average';
    public const SOURCE_STANDARD = 'standard_cost';

    public function __construct(protected ?UnitConversionService $units = null)
    {
        $this->units ??= new UnitConversionService();
    }

    /** Consumption after wastage: the quantity actually drawn from stock. */
    public static function grossQty(float $qty, float $scrapPercent): float
    {
        $scrap = $scrapPercent > 0 ? $scrapPercent : 0.0;

        return round($qty * (1 + $scrap / 100), 4);
    }

    /**
     * Base-unit cost per item, for the items that have one.
     *
     * Items with no readable cost are ABSENT from the result rather than
     * present with a zero — callers distinguish the two.
     *
     * @param list<int> $itemIds
     * @return array<int, array{cost: float, source: string}>
     */
    public function baseUnitCosts(int $cmpId, array $itemIds): array
    {
        $itemIds = array_values(array_unique(array_filter(array_map('intval', $itemIds), static fn ($i) => $i > 0)));
        if ($itemIds === []) {
            return [];
        }
        $db = \Config\Database::connect();
        $out = [];

        if (SchemaCache::tableExists($db, 'inv_wac_state')) {
            foreach (array_chunk($itemIds, 500) as $chunk) {
                $rows = $db->table('inv_wac_state')
                    ->select('item_id, qty_on_hand, average_cost')
                    ->where('cmp_id', $cmpId)->whereIn('item_id', $chunk)
                    ->get()->getResultArray();
                // Value-weighted across warehouses. Rows with no quantity still
                // carry the last cost the engine settled on, so they are used as
                // a fallback when nothing is on hand anywhere.
                $weighted = [];
                $lastKnown = [];
                foreach ($rows as $r) {
                    $itemId = (int) $r['item_id'];
                    $qty = (float) $r['qty_on_hand'];
                    $cost = (float) $r['average_cost'];
                    if ($cost <= 0) {
                        continue;
                    }
                    if ($qty > 0) {
                        $weighted[$itemId] ??= ['qty' => 0.0, 'value' => 0.0];
                        $weighted[$itemId]['qty'] += $qty;
                        $weighted[$itemId]['value'] += $qty * $cost;
                    } else {
                        $lastKnown[$itemId] = max($lastKnown[$itemId] ?? 0.0, $cost);
                    }
                }
                foreach ($weighted as $itemId => $agg) {
                    if ($agg['qty'] > 0.0001) {
                        $out[$itemId] = ['cost' => round($agg['value'] / $agg['qty'], 4), 'source' => self::SOURCE_AVERAGE];
                    }
                }
                foreach ($lastKnown as $itemId => $cost) {
                    $out[$itemId] ??= ['cost' => round($cost, 4), 'source' => self::SOURCE_AVERAGE];
                }
            }
        }

        $missing = array_values(array_diff($itemIds, array_keys($out)));
        if ($missing !== [] && SchemaCache::fieldExists($db, 'standard_cost', 'inv_items')) {
            foreach (array_chunk($missing, 500) as $chunk) {
                $rows = $db->table('inv_items')->select('item_id, standard_cost')
                    ->where('cmp_id', $cmpId)->whereIn('item_id', $chunk)
                    ->get()->getResultArray();
                foreach ($rows as $r) {
                    $cost = (float) ($r['standard_cost'] ?? 0);
                    if ($cost > 0) {
                        $out[(int) $r['item_id']] = ['cost' => round($cost, 4), 'source' => self::SOURCE_STANDARD];
                    }
                }
            }
        }

        return $out;
    }

    /**
     * Cost one BOM's lines against a cost table from `baseUnitCosts`.
     *
     * Only `component` lines consume material. By-products and scrap are
     * outputs; costing them here would credit a run twice.
     *
     * @param list<array<string, mixed>> $lines
     * @param array<int, array{cost: float, source: string}> $costs
     * @return array{
     *     lines: list<array<string, mixed>>,
     *     component_cost: float,
     *     wastage_cost: float,
     *     total_cost: float,
     *     priced_components: int,
     *     unpriced_components: int,
     *     complete: bool
     * }
     */
    public function costLines(int $cmpId, array $lines, array $costs): array
    {
        $out = [];
        $net = 0.0;
        $gross = 0.0;
        $priced = 0;
        $unpriced = 0;

        foreach ($lines as $line) {
            $itemId = (int) ($line['item_id'] ?? 0);
            $qty = (float) ($line['qty'] ?? 0);
            $scrap = (float) ($line['scrap_percent'] ?? 0);
            $unitId = isset($line['unit_id']) && (int) $line['unit_id'] > 0 ? (int) $line['unit_id'] : null;
            $kind = (string) ($line['line_kind'] ?? 'component');
            $grossQty = self::grossQty($qty, $scrap);

            $row = $line;
            $row['gross_qty'] = $grossQty;
            $row['cost_per_unit'] = null;
            $row['cost_source'] = null;
            $row['estimated_cost'] = null;

            if ($kind !== 'component') {
                $out[] = $row;
                continue;
            }

            $priceInfo = $costs[$itemId] ?? null;
            if ($priceInfo === null) {
                $unpriced++;
                $out[] = $row;
                continue;
            }

            // The stored rate is per base unit, so the line's own quantities go
            // to base before they are multiplied by it.
            $factor = $this->units->factorFor($cmpId, $itemId, $unitId);
            $perLineUnit = round($priceInfo['cost'] * UnitConversionService::normaliseFactor($factor), 4);
            $netCost = round(UnitConversionService::toBaseQty($qty, $factor) * $priceInfo['cost'], 4);
            $grossCost = round(UnitConversionService::toBaseQty($grossQty, $factor) * $priceInfo['cost'], 4);

            $row['cost_per_unit'] = $perLineUnit;
            $row['cost_source'] = $priceInfo['source'];
            $row['estimated_cost'] = $grossCost;
            $net += $netCost;
            $gross += $grossCost;
            $priced++;
            $out[] = $row;
        }

        return [
            'lines'               => $out,
            'component_cost'      => round($net, 4),
            'wastage_cost'        => round($gross - $net, 4),
            'total_cost'          => round($gross, 4),
            'priced_components'   => $priced,
            'unpriced_components' => $unpriced,
            // A BOM with no component at all is not "complete"; it has nothing
            // to cost, and saying ₹0 of it would be the same lie as pricing an
            // unknown component at zero.
            'complete'            => $unpriced === 0 && $priced > 0,
        ];
    }

    /** The company's base currency, read-only (a GET must not create the settings row). */
    public function baseCurrency(int $cmpId): string
    {
        $db = \Config\Database::connect();
        if (!SchemaCache::tableExists($db, 'inv_company_settings')) {
            return 'INR';
        }
        $res = $db->table('inv_company_settings')->select('base_currency_code')->where('cmp_id', $cmpId)->get();
        $row = $res === false ? null : $res->getRowArray();
        $code = strtoupper(trim((string) ($row['base_currency_code'] ?? '')));

        return $code !== '' ? $code : 'INR';
    }
}
