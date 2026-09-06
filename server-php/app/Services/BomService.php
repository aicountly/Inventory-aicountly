<?php

namespace App\Services;

use App\Exceptions\InventoryException;

/**
 * Bill of materials: read a BOM and explode it into PRODUCTION document lines.
 *
 * Semantics mirror Books' ProductionService::preparePayload:
 *   scale         = production_qty / max(0.0001, yield_qty)
 *   component OUT = round(bom_line.qty * scale, 4)          (skipped when <= 0)
 *   finished IN   = round(production_qty, 4) at finished_rate (amount = round(qty * rate, 4))
 *
 * Inventory additions on top of Books:
 *   - component lines carry scrap_percent: consumption is uplifted by (1 + scrap_percent / 100)
 *   - by_product lines become IN lines (zero cost; posting falls back to the item's last cost)
 *   - scrap lines are informational and produce no movement
 *   - valuation_rate on the finished line is expressed per BASE unit (finished_rate / factor)
 *
 * The returned lines are accepted verbatim by DocumentService for document_type PRODUCTION
 * (line_mode by_line, each line carries direction in|out).
 */
class BomService
{
    public const LINE_KINDS = ['component', 'by_product', 'scrap'];

    public function __construct(protected ?UnitConversionService $units = null)
    {
        $this->units ??= new UnitConversionService();
    }

    /**
     * Header + lines, tenant scoped. Soft-deleted headers are never returned.
     *
     * @return array<string, mixed>|null
     */
    public function find(int $cmpId, int $bomId, bool $withLines = true): ?array
    {
        $db = \Config\Database::connect();
        $bom = $db->table('inv_bom_headers')->where('cmp_id', $cmpId)->where('bom_id', $bomId)->where('deleted_at', null)->get()->getRowArray();
        if (!$bom) {
            return null;
        }
        $bom['yield_qty'] = (float) $bom['yield_qty'];
        if ($withLines) {
            $bom['lines'] = $this->lines($cmpId, [$bomId])[$bomId] ?? [];
        }

        return $bom;
    }

    /**
     * Lines for many BOMs in one query, keyed by bom_id.
     *
     * @param list<int> $bomIds
     * @return array<int, list<array<string, mixed>>>
     */
    public function lines(int $cmpId, array $bomIds): array
    {
        $bomIds = array_values(array_unique(array_filter(array_map('intval', $bomIds), static fn ($i) => $i > 0)));
        if ($bomIds === []) {
            return [];
        }
        $db = \Config\Database::connect();
        $out = [];
        foreach (array_chunk($bomIds, 500) as $chunk) {
            $rows = $db->table('inv_bom_lines l')
                ->select('l.bom_line_id, l.bom_id, l.item_id, l.qty, l.unit_id, l.line_kind, l.scrap_percent, l.sort_order, i.item_name, i.item_sku, i.is_active AS item_is_active, u.unit_symbol')
                ->join('inv_items i', 'i.item_id = l.item_id', 'left')
                ->join('inv_uom u', 'u.unit_id = l.unit_id', 'left')
                ->where('l.cmp_id', $cmpId)->whereIn('l.bom_id', $chunk)
                ->orderBy('l.sort_order', 'ASC')->orderBy('l.bom_line_id', 'ASC')
                ->get()->getResultArray();
            foreach ($rows as $r) {
                $r['qty'] = (float) $r['qty'];
                $r['scrap_percent'] = (float) $r['scrap_percent'];
                $out[(int) $r['bom_id']][] = $r;
            }
        }

        return $out;
    }

    /**
     * Explode a BOM for a production run into PRODUCTION document lines.
     *
     * @return list<array<string, mixed>> component OUT lines followed by the finished IN line
     */
    public function explode(int $cmpId, int $bomId, float $productionQty, ?int $warehouseId, float $finishedRate): array
    {
        if ($bomId <= 0) {
            throw InventoryException::validation('Bill of materials is required', ['field' => 'bom_id']);
        }
        if ($productionQty <= 0) {
            throw InventoryException::validation('Production quantity must be greater than zero', ['field' => 'production_qty']);
        }
        $bom = $this->find($cmpId, $bomId);
        if ($bom === null) {
            throw InventoryException::notFound('Bill of materials not found');
        }
        if ((int) $bom['is_active'] !== 1) {
            throw InventoryException::validation('Bill of materials #' . $bomId . ' is inactive', ['bom_id' => $bomId]);
        }
        $components = array_filter($bom['lines'], static fn ($l) => ($l['line_kind'] ?? 'component') === 'component' && (float) $l['qty'] > 0);
        if ($components === []) {
            throw InventoryException::validation('Bill of materials has no component lines', ['bom_id' => $bomId]);
        }
        $finishedItemId = (int) $bom['finished_item_id'];
        if ($finishedItemId <= 0) {
            throw InventoryException::validation('Bill of materials finished item is missing', ['bom_id' => $bomId]);
        }
        $this->units->warmCompany($cmpId);
        $yieldUnitId = !empty($bom['yield_unit_id']) ? (int) $bom['yield_unit_id'] : ($this->units->defaultUnitId($cmpId, $finishedItemId) ?: null);
        $finishedFactor = $this->units->factorFor($cmpId, $finishedItemId, $yieldUnitId);
        $bom['yield_unit_id'] = $yieldUnitId;

        return self::scaleLines($bom, $productionQty, $warehouseId, $finishedRate, $finishedFactor);
    }

    /**
     * Full PRODUCTION payload for DocumentService::create (header metadata + exploded lines).
     *
     * @param array<string, mixed> $header extra header fields (document_date, narration, document_no ...)
     * @return array<string, mixed>
     */
    public function productionPayload(int $cmpId, int $bomId, float $productionQty, ?int $warehouseId, float $finishedRate, array $header = []): array
    {
        $lines = $this->explode($cmpId, $bomId, $productionQty, $warehouseId, $finishedRate);
        $meta = is_array($header['metadata'] ?? null) ? $header['metadata'] : [];
        $meta += ['bom_id' => $bomId, 'production_qty' => round($productionQty, 4), 'finished_rate' => round($finishedRate, 4), 'warehouse_id' => $warehouseId];

        return array_merge($header, ['document_type' => 'PRODUCTION', 'lines' => $lines, 'metadata' => $meta]);
    }

    // ---- pure arithmetic (no DB) -------------------------------------------------------------

    /** Books: scale = production_qty / max(0.0001, yield_qty). */
    public static function scaleFactor(float $productionQty, float $yieldQty): float
    {
        return $productionQty / max(0.0001, $yieldQty);
    }

    /**
     * Scale a BOM's lines to a production run. Pure function: $bom needs finished_item_id,
     * yield_qty, optional yield_unit_id and lines[{item_id, qty, unit_id?, line_kind?, scrap_percent?, bom_line_id?}].
     *
     * @param array<string, mixed> $bom
     * @param float $finishedFactor conversion factor of the finished line's unit to the item's base unit
     * @return list<array<string, mixed>>
     */
    public static function scaleLines(array $bom, float $productionQty, ?int $warehouseId, float $finishedRate, float $finishedFactor = 1.0): array
    {
        $scale = self::scaleFactor($productionQty, (float) ($bom['yield_qty'] ?? 1));
        $warehouseId = $warehouseId !== null && $warehouseId > 0 ? $warehouseId : null;
        $out = [];
        foreach ((array) ($bom['lines'] ?? []) as $line) {
            if (!is_array($line)) {
                continue;
            }
            $itemId = (int) ($line['item_id'] ?? 0);
            $kind = (string) ($line['line_kind'] ?? 'component');
            if ($itemId <= 0 || $kind === 'scrap') {
                continue;
            }
            $qty = self::componentQty((float) ($line['qty'] ?? 0), $scale, $kind === 'component' ? (float) ($line['scrap_percent'] ?? 0) : 0.0);
            if ($qty <= 0) {
                continue;
            }
            $out[] = [
                'item_id'      => $itemId,
                'unit_id'      => !empty($line['unit_id']) ? (int) $line['unit_id'] : null,
                'warehouse_id' => $warehouseId,
                'qty'          => $qty,
                'rate'         => 0,
                'amount'       => 0,
                'direction'    => $kind === 'by_product' ? 'in' : 'out',
                'metadata'     => ['bom_line_id' => isset($line['bom_line_id']) ? (int) $line['bom_line_id'] : null, 'line_kind' => $kind, 'bom_qty' => (float) ($line['qty'] ?? 0), 'scale' => round($scale, 6)],
            ];
        }
        $finishedQty = round($productionQty, 4);
        $finishedRate = round(max(0.0, $finishedRate), 4);
        $out[] = [
            'item_id'        => (int) ($bom['finished_item_id'] ?? 0),
            'unit_id'        => !empty($bom['yield_unit_id']) ? (int) $bom['yield_unit_id'] : null,
            'warehouse_id'   => $warehouseId,
            'qty'            => $finishedQty,
            'rate'           => $finishedRate,
            'amount'         => round($finishedQty * $finishedRate, 4),
            'valuation_rate' => $finishedRate > 0 ? self::baseUnitRate($finishedRate, $finishedFactor) : null,
            'direction'      => 'in',
            'metadata'       => ['line_kind' => 'finished', 'bom_id' => isset($bom['bom_id']) ? (int) $bom['bom_id'] : null, 'scale' => round($scale, 6)],
        ];

        return $out;
    }

    /** round(qty * scale * (1 + scrap% / 100), 4) */
    public static function componentQty(float $bomQty, float $scale, float $scrapPercent = 0.0): float
    {
        $uplift = 1 + max(0.0, $scrapPercent) / 100;

        return round($bomQty * $scale * $uplift, 4);
    }

    /** Rate per entered unit -> rate per base unit. */
    public static function baseUnitRate(float $rate, float $factor): float
    {
        return round($rate / ($factor > 0 ? $factor : 1.0), 4);
    }
}
