<?php

namespace App\Controllers\Api\V1;

use App\Controllers\Api\BaseController;
use App\Exceptions\InventoryException;
use App\Services\AuditService;
use App\Services\StockBalanceService;

/**
 * /api/v1/batches — inv_batches (lots). Unique per (cmp, item, batch_no).
 * No soft delete on this table: delete is physical and guarded by stock references.
 * Permission base: masters.batches.
 */
class BatchesController extends BaseController
{
    private const PERM = 'masters.batches';
    public const STATUSES = ['active', 'quarantine', 'recalled', 'expired', 'closed'];
    private const COLUMNS = ['batch_no', 'lot_no', 'mfg_date', 'expiry_date', 'warranty_months', 'status'];
    private const SORT = ['batch_no' => 'b.batch_no', 'batch_id' => 'b.batch_id', 'expiry_date' => 'b.expiry_date', 'mfg_date' => 'b.mfg_date', 'status' => 'b.status', 'item_name' => 'i.item_name', 'created_at' => 'b.created_at', 'updated_at' => 'b.updated_at'];
    private const SELECT = 'b.batch_id, b.batch_uuid, b.item_id, b.batch_no, b.lot_no, b.mfg_date, b.expiry_date, b.warranty_months, b.status, b.attributes_json, b.created_at, b.updated_at, i.item_name, i.item_sku, i.unit_id, u.unit_symbol';

    public function index()
    {
        $a = $this->authorize(self::PERM . '.read', true, false);
        if (isset($a['response'])) {
            return $a['response'];
        }
        $cmpId = (int) $a['ctx']['cmp_id'];
        $p = $this->listParams(100, 1000, 'batch_no');
        $b = $this->baseQuery($cmpId);
        if ($itemId = (int) $this->request->getGet('item_id')) {
            $b->where('b.item_id', $itemId);
        }
        $status = strtolower(trim((string) ($this->request->getGet('status') ?? '')));
        if ($status !== '') {
            $b->whereIn('b.status', array_values(array_filter(array_map('trim', explode(',', $status)))));
        }
        $expiring = trim((string) ($this->request->getGet('expiring_before') ?? ''));
        if ($expiring !== '') {
            if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $expiring)) {
                return $this->failStructured(422, 'validation_failed', 'expiring_before must be YYYY-MM-DD', ['field' => 'expiring_before']);
            }
            $b->where('b.expiry_date IS NOT NULL', null, false)->where('b.expiry_date <=', $expiring);
        }
        $q = trim((string) ($this->request->getGet('q') ?? ''));
        if ($q !== '') {
            $b->groupStart()->like('LOWER(b.batch_no)', mb_strtolower($q), 'both', null, true)->orLike('LOWER(b.lot_no)', mb_strtolower($q), 'both', null, true)->orLike('LOWER(i.item_name)', mb_strtolower($q), 'both', null, true)->groupEnd();
        }
        $total = (clone $b)->countAllResults(false);
        $rows = $b->select(self::SELECT)->orderBy(self::SORT[$p['sort']] ?? 'b.batch_no', $p['order'])->limit($p['limit'], $p['offset'])->get()->getResultArray();
        $rows = array_map([$this, 'present'], $rows);
        if ((int) ($this->request->getGet('with_stock') ?? 0) === 1 && $rows !== []) {
            $this->attachStock($cmpId, $rows, (int) $this->request->getGet('warehouse_id') ?: null);
        }

        return $this->respondList($rows, $total, $p['limit'], $p['offset']);
    }

    public function show($id = null)
    {
        $a = $this->authorize(self::PERM . '.read', true, false);
        if (isset($a['response'])) {
            return $a['response'];
        }
        $cmpId = (int) $a['ctx']['cmp_id'];
        $row = $this->baseQuery($cmpId)->where('b.batch_id', (int) $id)->select(self::SELECT)->get()->getRowArray();
        if (!$row) {
            return $this->failStructured(404, 'not_found', 'Batch not found');
        }
        $row = $this->present($row);
        $row['balances'] = $this->balancesByWarehouse($cmpId, (int) $id);
        $row['stock'] = (new StockBalanceService())->balance($cmpId, (int) $row['item_id'], null, (int) $id);

        return $this->respond(['data' => $row]);
    }

    public function create()
    {
        $a = $this->authorize(self::PERM . '.write', true, false);
        if (isset($a['response'])) {
            return $a['response'];
        }
        $cmpId = (int) $a['ctx']['cmp_id'];
        $body = $this->request->getJSON(true) ?? [];
        try {
            $row = $this->buildRow($cmpId, $body, null);
            $now = date('Y-m-d H:i:s');
            $row += ['cmp_id' => $cmpId, 'created_by' => $a['session']['uuid'], 'created_at' => $now, 'updated_by' => $a['session']['uuid'], 'updated_at' => $now];
            $db = \Config\Database::connect();
            $db->table('inv_batches')->insert($row);
            $id = (int) $db->insertID();
            (new AuditService())->log($cmpId, 'batch', $id, 'batch.create', $a['session']['uuid'], [], null, $row);
            $out = $this->present($this->baseQuery($cmpId)->where('b.batch_id', $id)->select(self::SELECT)->get()->getRowArray());

            return $this->respondCreated(['data' => $out]);
        } catch (\Throwable $e) {
            return $this->failFromException($e);
        }
    }

    public function update($id = null)
    {
        $a = $this->authorize(self::PERM . '.write', true, false);
        if (isset($a['response'])) {
            return $a['response'];
        }
        $cmpId = (int) $a['ctx']['cmp_id'];
        $db = \Config\Database::connect();
        $existing = $db->table('inv_batches')->where('cmp_id', $cmpId)->where('batch_id', (int) $id)->get()->getRowArray();
        if (!$existing) {
            return $this->failStructured(404, 'not_found', 'Batch not found');
        }
        $body = $this->request->getJSON(true) ?? [];
        try {
            $row = $this->buildRow($cmpId, array_merge($existing, $body), $existing);
            $row['updated_by'] = $a['session']['uuid'];
            $row['updated_at'] = date('Y-m-d H:i:s');
            $db->table('inv_batches')->where('batch_id', (int) $id)->where('cmp_id', $cmpId)->update($row);
            (new AuditService())->log($cmpId, 'batch', (int) $id, 'batch.update', $a['session']['uuid'], [], $existing, $row);
            $out = $this->present($this->baseQuery($cmpId)->where('b.batch_id', (int) $id)->select(self::SELECT)->get()->getRowArray());

            return $this->respond(['data' => $out]);
        } catch (\Throwable $e) {
            return $this->failFromException($e);
        }
    }

    public function delete($id = null)
    {
        $a = $this->authorize(self::PERM . '.delete', true, false);
        if (isset($a['response'])) {
            return $a['response'];
        }
        $cmpId = (int) $a['ctx']['cmp_id'];
        $db = \Config\Database::connect();
        $existing = $db->table('inv_batches')->where('cmp_id', $cmpId)->where('batch_id', (int) $id)->get()->getRowArray();
        if (!$existing) {
            return $this->failStructured(404, 'not_found', 'Batch not found');
        }
        $guards = [
            ['table' => 'inv_document_lines', 'label' => 'document line(s)'],
            ['table' => 'inv_stock_movements', 'label' => 'stock movement(s)'],
            ['table' => 'inv_item_openings', 'label' => 'opening(s)'],
            ['table' => 'inv_serials', 'label' => 'serial number(s)'],
        ];
        foreach ($guards as $g) {
            $n = $db->table($g['table'])->where('cmp_id', $cmpId)->where('batch_id', (int) $id)->countAllResults();
            if ($n > 0) {
                return $this->failStructured(409, 'delete_blocked', 'Batch is used by ' . $n . ' ' . $g['label'] . ' and cannot be deleted', ['guard' => $g['label'], 'count' => $n]);
            }
        }
        $stock = (new StockBalanceService())->balance($cmpId, (int) $existing['item_id'], null, (int) $id);
        if (array_filter($stock, static fn ($v) => abs((float) $v) > 0.0001) !== []) {
            return $this->failStructured(409, 'delete_blocked', 'Batch still carries stock and cannot be deleted', ['guard' => 'stock balance', 'stock' => $stock]);
        }
        $db->transStart();
        $db->table('inv_stock_balances')->where('cmp_id', $cmpId)->where('batch_id', (int) $id)->delete();
        $db->table('inv_batches')->where('cmp_id', $cmpId)->where('batch_id', (int) $id)->delete();
        $db->transComplete();
        (new AuditService())->log($cmpId, 'batch', (int) $id, 'batch.delete', $a['session']['uuid'], [], $existing, null);

        return $this->respondDeleted(['data' => ['batch_id' => (int) $id]]);
    }

    // ------------------------------------------------------------------ helpers

    private function baseQuery(int $cmpId)
    {
        return \Config\Database::connect()->table('inv_batches b')
            ->join('inv_items i', 'i.item_id = b.item_id', 'left')
            ->join('inv_uom u', 'u.unit_id = i.unit_id', 'left')
            ->where('b.cmp_id', $cmpId);
    }

    /** @return array<string, mixed> */
    private function buildRow(int $cmpId, array $body, ?array $existing): array
    {
        $row = [];
        foreach (self::COLUMNS as $col) {
            if (array_key_exists($col, $body)) {
                $v = $body[$col];
                $row[$col] = is_string($v) ? trim($v) : $v;
                if ($row[$col] === '') {
                    $row[$col] = null;
                }
            }
        }
        $itemId = (int) ($body['item_id'] ?? 0);
        if ($itemId <= 0) {
            throw InventoryException::validation('item_id is required', ['field' => 'item_id']);
        }
        if ($existing && $itemId !== (int) $existing['item_id']) {
            throw InventoryException::validation('item_id cannot be changed on an existing batch', ['field' => 'item_id']);
        }
        $db = \Config\Database::connect();
        $item = $db->table('inv_items')->select('item_id, track_batch, track_expiry, shelf_life_days')->where('cmp_id', $cmpId)->where('item_id', $itemId)->where('deleted_at', null)->where('is_active', 1)->get()->getRowArray();
        if (!$item) {
            throw InventoryException::validation('Item #' . $itemId . ' not found or inactive in this company', ['field' => 'item_id', 'item_id' => $itemId]);
        }
        $row['item_id'] = $itemId;
        if (empty($row['batch_no'])) {
            throw InventoryException::validation('batch_no is required', ['field' => 'batch_no']);
        }
        $row['batch_no'] = substr((string) $row['batch_no'], 0, 64);
        if (isset($row['lot_no'])) {
            $row['lot_no'] = substr((string) $row['lot_no'], 0, 64);
        }
        foreach (['mfg_date', 'expiry_date'] as $d) {
            if (isset($row[$d]) && !preg_match('/^\d{4}-\d{2}-\d{2}$/', (string) $row[$d])) {
                throw InventoryException::validation($d . ' must be YYYY-MM-DD', ['field' => $d]);
            }
        }
        if (!isset($row['expiry_date']) && !empty($row['mfg_date']) && (int) $item['track_expiry'] === 1 && (int) ($item['shelf_life_days'] ?? 0) > 0) {
            $row['expiry_date'] = date('Y-m-d', strtotime($row['mfg_date'] . ' +' . (int) $item['shelf_life_days'] . ' days'));
        }
        if (!empty($row['mfg_date']) && !empty($row['expiry_date']) && $row['expiry_date'] < $row['mfg_date']) {
            throw InventoryException::validation('expiry_date cannot be before mfg_date', ['field' => 'expiry_date']);
        }
        if (array_key_exists('warranty_months', $row) && $row['warranty_months'] !== null) {
            $row['warranty_months'] = max(0, (int) $row['warranty_months']);
        }
        $status = strtolower((string) ($row['status'] ?? ($existing['status'] ?? 'active'))) ?: 'active';
        if (!in_array($status, self::STATUSES, true)) {
            throw InventoryException::validation('status must be one of ' . implode(', ', self::STATUSES), ['field' => 'status']);
        }
        $row['status'] = $status;
        if (array_key_exists('attributes', $body)) {
            $row['attributes_json'] = is_array($body['attributes']) ? json_encode($body['attributes'], JSON_UNESCAPED_UNICODE) : null;
        }
        $dup = $db->table('inv_batches')->where('cmp_id', $cmpId)->where('item_id', $itemId)->where('batch_no', $row['batch_no']);
        if ($existing) {
            $dup->where('batch_id !=', (int) $existing['batch_id']);
        }
        if ($dup->countAllResults() > 0) {
            throw InventoryException::conflict('Batch "' . $row['batch_no'] . '" already exists for this item', ['field' => 'batch_no']);
        }

        return $row;
    }

    /** @return array<string, mixed> */
    private function present(array $row): array
    {
        $row['attributes'] = isset($row['attributes_json']) ? json_decode((string) $row['attributes_json'], true) : null;
        unset($row['attributes_json']);
        if (isset($row['warranty_months'])) {
            $row['warranty_months'] = (int) $row['warranty_months'];
        }

        return $row;
    }

    /** @return list<array<string, mixed>> */
    private function balancesByWarehouse(int $cmpId, int $batchId): array
    {
        $rows = \Config\Database::connect()->table('inv_stock_balances s')
            ->select('s.warehouse_id, w.warehouse_name, w.warehouse_code, SUM(s.on_hand_qty) on_hand, SUM(s.reserved_qty) reserved, SUM(s.committed_qty) AS committed, SUM(s.packed_qty) packed, SUM(s.in_transit_qty) in_transit, SUM(s.job_worker_qty) job_worker, SUM(s.quality_hold_qty) quality_hold, SUM(s.damaged_qty) damaged, SUM(s.blocked_qty) blocked, SUM(s.expected_qty) expected, MAX(s.last_movement_at) last_movement_at', false)
            ->join('inv_warehouses w', 'w.warehouse_id = s.warehouse_id', 'left')
            ->where('s.cmp_id', $cmpId)->where('s.batch_id', $batchId)
            ->groupBy('s.warehouse_id, w.warehouse_name, w.warehouse_code', false)
            ->orderBy('w.warehouse_name', 'ASC')->get()->getResultArray();
        foreach ($rows as &$r) {
            $r['warehouse_id'] = $r['warehouse_id'] !== null ? (int) $r['warehouse_id'] : null;
            foreach (['on_hand', 'reserved', 'committed', 'packed', 'in_transit', 'job_worker', 'quality_hold', 'damaged', 'blocked', 'expected'] as $k) {
                $r[$k] = round((float) ($r[$k] ?? 0), 4);
            }
            $r['available'] = StockBalanceService::availableFrom($r);
        }

        return $rows;
    }

    /** One grouped query for the page: on-hand / available per batch. */
    private function attachStock(int $cmpId, array &$rows, ?int $warehouseId): void
    {
        $ids = array_map(static fn ($r) => (int) $r['batch_id'], $rows);
        $by = [];
        foreach (array_chunk($ids, 500) as $chunk) {
            $b = \Config\Database::connect()->table('inv_stock_balances')
                ->select('batch_id, SUM(on_hand_qty) on_hand, SUM(reserved_qty) reserved, SUM(packed_qty) packed, SUM(quality_hold_qty) quality_hold, SUM(damaged_qty) damaged, SUM(blocked_qty) blocked', false)
                ->where('cmp_id', $cmpId)->whereIn('batch_id', $chunk)->groupBy('batch_id');
            if ($warehouseId !== null && $warehouseId > 0) {
                $b->where('warehouse_id', $warehouseId);
            }
            foreach ($b->get()->getResultArray() as $r) {
                $s = [];
                foreach (['on_hand', 'reserved', 'packed', 'quality_hold', 'damaged', 'blocked'] as $k) {
                    $s[$k] = round((float) ($r[$k] ?? 0), 4);
                }
                $by[(int) $r['batch_id']] = ['on_hand' => $s['on_hand'], 'reserved' => $s['reserved'], 'available' => StockBalanceService::availableFrom($s)];
            }
        }
        foreach ($rows as &$r) {
            $r['stock'] = $by[(int) $r['batch_id']] ?? ['on_hand' => 0.0, 'reserved' => 0.0, 'available' => 0.0];
        }
    }
}
