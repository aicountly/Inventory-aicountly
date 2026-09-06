<?php

namespace App\Controllers\Api\V1;

use App\Controllers\Api\BaseController;
use App\Services\OpeningStockResolver;
use App\Services\StockBalanceService;
use App\Services\UnitConversionService;
use Config\DocumentTypeRegistry;

/**
 * /api/v1/stock-movements — the append-only stock ledger (inv_stock_movements), and
 * /api/v1/stock-ledger  — one item's ledger with opening, running balance and closing.
 */
class StockMovementsController extends BaseController
{
    private const MOVEMENT_COLUMNS = 'm.movement_id, m.movement_uuid, m.cmp_id, m.fy_id, m.bo_id, m.document_id, m.line_id, m.document_type, m.movement_date, m.sequence_no, m.item_id, m.warehouse_id, m.location_id, m.batch_id, m.direction, m.qty, m.unit_cost, m.value, m.movement_kind, m.reversal_of_movement_id, m.created_at, m.created_by, '
        . 'i.item_name, i.item_alias, i.item_sku, i.unit_id, u.unit_symbol, w.warehouse_name, w.warehouse_code, bt.batch_no, '
        . 'd.document_no, d.status AS document_status, d.source_app, d.source_document_type, d.source_document_id, d.source_document_no, d.party_ref, d.party_name';

    private const SORTABLE = ['movement_date' => 'm.movement_date', 'movement_id' => 'm.movement_id', 'item_id' => 'm.item_id', 'item_name' => 'i.item_name', 'qty' => 'm.qty', 'value' => 'm.value', 'document_type' => 'm.document_type', 'document_no' => 'd.document_no', 'warehouse_id' => 'm.warehouse_id', 'created_at' => 'm.created_at'];

    /**
     * GET /stock-movements
     * Filters: item_id, warehouse_id, document_id, document_type (csv), from, to, direction (in|out),
     * batch_id, movement_kind (physical|reversal|revaluation), all_fy=1 to span financial years.
     */
    public function index()
    {
        $a = $this->authorizeAny(['reports.stock_ledger.read', 'documents.read']);
        if (isset($a['response'])) {
            return $a['response'];
        }
        $ctx = $a['ctx'];
        $cmpId = (int) $ctx['cmp_id'];
        $p = $this->listParams(50, 500, 'movement_date');
        $b = $this->movementQuery($cmpId);
        if ((int) ($this->request->getGet('all_fy') ?? 0) !== 1) {
            $b->where('m.fy_id', (int) $ctx['fy_id']);
        }
        if ((int) $ctx['bo_id'] > 0) {
            $b->where('m.bo_id', (int) $ctx['bo_id']);
        }
        foreach (['item_id', 'warehouse_id', 'document_id', 'batch_id', 'line_id'] as $f) {
            $v = (int) ($this->request->getGet($f) ?? 0);
            if ($v > 0) {
                $b->where('m.' . $f, $v);
            }
        }
        $types = trim((string) ($this->request->getGet('document_type') ?? ''));
        if ($types !== '') {
            $b->whereIn('m.document_type', array_map('strtoupper', array_filter(array_map('trim', explode(',', $types)))));
        }
        $direction = strtolower(trim((string) ($this->request->getGet('direction') ?? '')));
        if (in_array($direction, ['in', 'out'], true)) {
            $b->where('m.direction', $direction);
        }
        $kind = strtolower(trim((string) ($this->request->getGet('movement_kind') ?? '')));
        if (in_array($kind, ['physical', 'reversal', 'revaluation'], true)) {
            $b->where('m.movement_kind', $kind);
        }
        if ($from = $this->dateParam('from')) {
            $b->where('m.movement_date >=', $from);
        }
        if ($to = $this->dateParam('to')) {
            $b->where('m.movement_date <=', $to);
        }
        if ($q = trim((string) ($this->request->getGet('q') ?? ''))) {
            $b->groupStart()->like('i.item_name', $q, 'both', null, true)->orLike('d.document_no', $q, 'both', null, true)->orLike('d.party_name', $q, 'both', null, true)->groupEnd();
        }
        $total = (clone $b)->countAllResults(false);
        $sort = self::SORTABLE[$p['sort']] ?? 'm.movement_date';
        $rows = $b->select(self::MOVEMENT_COLUMNS)
            ->orderBy($sort, $p['order'])->orderBy('m.document_id', $p['order'])->orderBy('m.sequence_no', $p['order'])->orderBy('m.movement_id', $p['order'])
            ->limit($p['limit'], $p['offset'])->get()->getResultArray();
        foreach ($rows as &$r) {
            $r = $this->castMovement($r);
        }
        unset($r);

        return $this->respondList($rows, $total, $p['limit'], $p['offset']);
    }

    /**
     * GET /stock-ledger?item_id=&warehouse_id=&from=&to=
     * Opening as at `from` (FY opening + every movement before `from`), then each movement in the
     * range with running quantity and value, then closing. All quantities are base units.
     */
    public function ledger()
    {
        $a = $this->authorize('reports.stock_ledger.read');
        if (isset($a['response'])) {
            return $a['response'];
        }
        $ctx = $a['ctx'];
        $cmpId = (int) $ctx['cmp_id'];
        $fyId = (int) $ctx['fy_id'];
        $boId = (int) $ctx['bo_id'];
        $itemId = (int) ($this->request->getGet('item_id') ?? 0);
        if ($itemId <= 0) {
            return $this->failStructured(422, 'validation_failed', 'item_id is required');
        }
        $warehouseId = (int) ($this->request->getGet('warehouse_id') ?? 0) ?: null;
        $from = $this->dateParam('from');
        $to = $this->dateParam('to') ?: date('Y-m-d');
        if ($from !== null && $from > $to) {
            return $this->failStructured(422, 'validation_failed', 'from must not be after to', ['from' => $from, 'to' => $to]);
        }
        $db = \Config\Database::connect();
        $item = $db->table('inv_items i')->select('i.item_id, i.item_name, i.item_alias, i.item_sku, i.unit_id, i.valuation_method, u.unit_symbol, u.unit_name')
            ->join('inv_uom u', 'u.unit_id = i.unit_id', 'left')
            ->where('i.cmp_id', $cmpId)->where('i.item_id', $itemId)->get()->getRowArray();
        if (!$item) {
            return $this->failStructured(404, 'not_found', 'Item not found');
        }
        $warehouse = null;
        if ($warehouseId !== null) {
            $warehouse = $db->table('inv_warehouses')->select('warehouse_id, warehouse_name, warehouse_code')->where('cmp_id', $cmpId)->where('warehouse_id', $warehouseId)->get()->getRowArray();
            if (!$warehouse) {
                return $this->failStructured(404, 'not_found', 'Warehouse not found');
            }
        }

        try {
            $units = new UnitConversionService();
            $openings = new OpeningStockResolver($units);
            $balances = new StockBalanceService($units, $openings);

            // --- Opening as at `from`: FY opening rows + every movement dated before `from`.
            $fyOpeningQty = 0.0;
            $fyOpeningValue = 0.0;
            foreach ($openings->openingLines($cmpId, $fyId, [$itemId]) as $line) {
                if ($warehouseId !== null && (int) ($line['warehouse_id'] ?? 0) !== $warehouseId) {
                    continue;
                }
                $layer = OpeningStockResolver::layerFromOpeningLine($line);
                if ($layer === null) {
                    continue;
                }
                $fyOpeningQty += $layer['qty_remaining'];
                $fyOpeningValue += $layer['qty_remaining'] * $layer['unit_cost'];
            }
            $openingQty = round($fyOpeningQty, 4);
            $openingValue = round($fyOpeningValue, 4);
            if ($from !== null) {
                $dayBefore = date('Y-m-d', strtotime($from . ' -1 day'));
                $openingQty = 0.0;
                foreach ($balances->closingQuantities($cmpId, $fyId, $boId, null, $dayBefore, $itemId, $warehouseId) as $r) {
                    $openingQty += (float) $r['closing_qty'];
                }
                $openingQty = round($openingQty, 4);
                $before = $this->movementQuery($cmpId)->select('COALESCE(SUM(m.value), 0) AS v', false)
                    ->where('m.fy_id', $fyId)->where('m.item_id', $itemId)->where('m.movement_date <', $from);
                if ($boId > 0) {
                    $before->where('m.bo_id', $boId);
                }
                if ($warehouseId !== null) {
                    $before->where('m.warehouse_id', $warehouseId);
                }
                $openingValue = round($fyOpeningValue + (float) ($before->get()->getRowArray()['v'] ?? 0), 4);
            }

            // --- Movements in range, chronological, with running balances.
            $b = $this->movementQuery($cmpId)->select(self::MOVEMENT_COLUMNS)
                ->where('m.fy_id', $fyId)->where('m.item_id', $itemId)->where('m.movement_date <=', $to);
            if ($from !== null) {
                $b->where('m.movement_date >=', $from);
            }
            if ($boId > 0) {
                $b->where('m.bo_id', $boId);
            }
            if ($warehouseId !== null) {
                $b->where('m.warehouse_id', $warehouseId);
            }
            $rows = $b->orderBy('m.movement_date', 'ASC')->orderBy('m.document_id', 'ASC')->orderBy('m.sequence_no', 'ASC')->orderBy('m.line_id', 'ASC')->orderBy('m.movement_id', 'ASC')
                ->get()->getResultArray();

            $runQty = $openingQty;
            $runValue = $openingValue;
            $inQty = $inValue = $outQty = $outValue = 0.0;
            foreach ($rows as &$r) {
                $r = $this->castMovement($r);
                $qty = (float) $r['qty'];
                $value = (float) ($r['value'] ?? 0);
                if ($qty >= 0) {
                    $r['in_qty'] = round($qty, 4);
                    $r['out_qty'] = 0.0;
                    $r['in_value'] = round($value, 4);
                    $r['out_value'] = 0.0;
                    $inQty += $qty;
                    $inValue += $value;
                } else {
                    $r['in_qty'] = 0.0;
                    $r['out_qty'] = round(-$qty, 4);
                    $r['in_value'] = 0.0;
                    $r['out_value'] = round(-$value, 4);
                    $outQty += -$qty;
                    $outValue += -$value;
                }
                $runQty = round($runQty + $qty, 4);
                $runValue = round($runValue + $value, 4);
                $r['running_qty'] = $runQty;
                $r['running_value'] = $runValue;
                $r['running_unit_cost'] = abs($runQty) > 0.00001 ? round($runValue / $runQty, 4) : null;
            }
            unset($r);
        } catch (\Throwable $e) {
            return $this->failFromException($e);
        }

        return $this->respond(['data' => [
            'item'         => $item,
            'warehouse'    => $warehouse,
            'warehouse_id' => $warehouseId,
            'fy_id'        => $fyId,
            'from'         => $from,
            'to'           => $to,
            'opening'      => ['qty' => $openingQty, 'value' => $openingValue, 'unit_cost' => abs($openingQty) > 0.00001 ? round($openingValue / $openingQty, 4) : null],
            'rows'         => $rows,
            'totals'       => ['in_qty' => round($inQty, 4), 'in_value' => round($inValue, 4), 'out_qty' => round($outQty, 4), 'out_value' => round($outValue, 4)],
            'closing'      => ['qty' => $runQty, 'value' => $runValue, 'unit_cost' => abs($runQty) > 0.00001 ? round($runValue / $runQty, 4) : null],
        ], 'meta' => ['count' => count($rows)]]);
    }

    // ------------------------------------------------------------------ helpers

    private function movementQuery(int $cmpId)
    {
        return \Config\Database::connect()->table('inv_stock_movements m')
            ->join('inv_items i', 'i.item_id = m.item_id AND i.cmp_id = m.cmp_id', 'left')
            ->join('inv_uom u', 'u.unit_id = i.unit_id', 'left')
            ->join('inv_warehouses w', 'w.warehouse_id = m.warehouse_id', 'left')
            ->join('inv_batches bt', 'bt.batch_id = m.batch_id', 'left')
            ->join('inv_documents d', 'd.document_id = m.document_id', 'left')
            ->where('m.cmp_id', $cmpId);
    }

    /** @param array<string, mixed> $r @return array<string, mixed> */
    private function castMovement(array $r): array
    {
        foreach (['movement_id', 'cmp_id', 'fy_id', 'bo_id', 'document_id', 'line_id', 'sequence_no', 'item_id', 'warehouse_id', 'location_id', 'batch_id', 'unit_id', 'reversal_of_movement_id', 'source_document_id', 'party_ref'] as $k) {
            if (array_key_exists($k, $r)) {
                $r[$k] = $r[$k] === null ? null : (int) $r[$k];
            }
        }
        foreach (['qty', 'unit_cost', 'value'] as $k) {
            if (array_key_exists($k, $r)) {
                $r[$k] = $r[$k] === null ? null : round((float) $r[$k], 4);
            }
        }
        $r['document_type_label'] = DocumentTypeRegistry::get((string) ($r['document_type'] ?? ''))['label'] ?? ($r['document_type'] ?? null);

        return $r;
    }

    private function dateParam(string $name): ?string
    {
        $v = trim((string) ($this->request->getGet($name) ?? ''));
        if ($v === '') {
            return null;
        }
        $ts = strtotime($v);

        return $ts === false ? null : date('Y-m-d', $ts);
    }
}
