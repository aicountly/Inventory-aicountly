<?php

namespace App\Services;

/**
 * Converts document quantities and rates into the item's base unit.
 *
 * Convention (identical to Books): inv_item_uoms.conversion_factor = how many BASE units
 * equal 1 of this unit (1 Box = 12 Pcs -> factor 12 on the Box row). The base row has
 * factor 1. Amount is preserved: qty x rate = base_qty x base_unit_cost.
 */
class UnitConversionService
{
    /** @var array<string, float> */
    private array $factorByItemUnit = [];
    /** @var array<string, int> */
    private array $defaultUnitByItem = [];
    /** @var array<int, true> */
    private array $warmedCompanies = [];

    public static function normaliseFactor(float $factor): float
    {
        return $factor > 0.0000001 ? $factor : 1.0;
    }

    public static function toBaseQty(float $qty, float $factor): float
    {
        return round($qty * self::normaliseFactor($factor), 4);
    }

    public static function toBaseUnitCost(float $rate, float $factor): float
    {
        return round($rate / self::normaliseFactor($factor), 4);
    }

    public static function effectiveRate(float $qty, float $rate, float $amount = 0.0): float
    {
        if ($rate > 0.0000001) {
            return round($rate, 4);
        }
        if ($qty > 0.0000001 && $amount > 0.0000001) {
            return round($amount / $qty, 4);
        }

        return 0.0;
    }

    /** @return array{base_qty: float, base_unit_cost: float, value: float} */
    public static function openingToBase(float $openingQty, float $openingRate, float $factor): array
    {
        $value = round($openingQty * $openingRate, 4);
        $baseQty = self::toBaseQty($openingQty, $factor);
        $baseCost = $baseQty > 0.0001 ? round($value / $baseQty, 4) : 0.0;

        return ['base_qty' => $baseQty, 'base_unit_cost' => $baseCost, 'value' => $value];
    }

    public function factorFor(int $cmpId, int $itemId, ?int $unitId): float
    {
        if ($cmpId <= 0 || $itemId <= 0) {
            return 1.0;
        }
        $this->warmItem($cmpId, $itemId);
        $resolved = $unitId !== null && $unitId > 0 ? $unitId : ($this->defaultUnitByItem[$cmpId . ':' . $itemId] ?? 0);
        if ($resolved <= 0) {
            return 1.0;
        }

        return $this->factorByItemUnit[$cmpId . ':' . $itemId . ':' . $resolved] ?? 1.0;
    }

    public function defaultUnitId(int $cmpId, int $itemId): int
    {
        $this->warmItem($cmpId, $itemId);

        return $this->defaultUnitByItem[$cmpId . ':' . $itemId] ?? 0;
    }

    /** @return array{base_qty: float, base_unit_cost: float, factor: float, effective_rate: float} */
    public function lineToBase(int $cmpId, int $itemId, ?int $unitId, float $qty, float $rate, float $amount = 0.0): array
    {
        $factor = $this->factorFor($cmpId, $itemId, $unitId);
        $effectiveRate = self::effectiveRate($qty, $rate, $amount);

        return [
            'base_qty'       => self::toBaseQty($qty, $factor),
            'base_unit_cost' => self::toBaseUnitCost($effectiveRate, $factor),
            'factor'         => $factor,
            'effective_rate' => $effectiveRate,
        ];
    }

    public function warmCompany(int $cmpId): void
    {
        if (isset($this->warmedCompanies[$cmpId])) {
            return;
        }
        $this->warmedCompanies[$cmpId] = true;
        $db = \Config\Database::connect();
        if (!SchemaCache::tableExists($db, 'inv_item_uoms')) {
            return;
        }
        $rows = $db->table('inv_item_uoms')
            ->select('item_id, unit_id, is_default, conversion_factor')
            ->where('cmp_id', $cmpId)
            ->orderBy('item_id', 'ASC')->orderBy('is_default', 'DESC')->orderBy('item_unit_line_id', 'ASC')
            ->get()->getResultArray();
        $this->absorb($cmpId, $rows);
        // Items whose base unit is only on the item row (no uom lines).
        $items = $db->table('inv_items')->select('item_id, unit_id')->where('cmp_id', $cmpId)->get()->getResultArray();
        foreach ($items as $it) {
            $key = $cmpId . ':' . (int) $it['item_id'];
            if (!isset($this->defaultUnitByItem[$key]) && (int) ($it['unit_id'] ?? 0) > 0) {
                $this->defaultUnitByItem[$key] = (int) $it['unit_id'];
                $this->factorByItemUnit[$key . ':' . (int) $it['unit_id']] = 1.0;
            }
        }
    }

    private function warmItem(int $cmpId, int $itemId): void
    {
        if (isset($this->warmedCompanies[$cmpId])) {
            return;
        }
        $key = $cmpId . ':' . $itemId;
        if (isset($this->defaultUnitByItem[$key])) {
            return;
        }
        $db = \Config\Database::connect();
        if (!SchemaCache::tableExists($db, 'inv_item_uoms')) {
            return;
        }
        $rows = $db->table('inv_item_uoms')
            ->select('item_id, unit_id, is_default, conversion_factor')
            ->where('cmp_id', $cmpId)->where('item_id', $itemId)
            ->orderBy('is_default', 'DESC')->orderBy('item_unit_line_id', 'ASC')
            ->get()->getResultArray();
        $this->absorb($cmpId, $rows);
        if (!isset($this->defaultUnitByItem[$key])) {
            $item = $db->table('inv_items')->select('unit_id')->where('cmp_id', $cmpId)->where('item_id', $itemId)->get()->getRowArray();
            $unitId = (int) ($item['unit_id'] ?? 0);
            $this->defaultUnitByItem[$key] = $unitId;
            if ($unitId > 0) {
                $this->factorByItemUnit[$key . ':' . $unitId] = 1.0;
            }
        }
    }

    /** @param list<array<string, mixed>> $rows */
    private function absorb(int $cmpId, array $rows): void
    {
        foreach ($rows as $row) {
            $itemId = (int) $row['item_id'];
            $unitId = (int) $row['unit_id'];
            $isDefault = !empty($row['is_default']);
            $factor = $isDefault ? 1.0 : self::normaliseFactor((float) ($row['conversion_factor'] ?? 1));
            $this->factorByItemUnit[$cmpId . ':' . $itemId . ':' . $unitId] = $factor;
            $key = $cmpId . ':' . $itemId;
            if ($isDefault || !isset($this->defaultUnitByItem[$key])) {
                $this->defaultUnitByItem[$key] = $unitId;
            }
        }
    }
}
