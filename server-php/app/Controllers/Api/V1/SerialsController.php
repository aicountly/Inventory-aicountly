<?php

namespace App\Controllers\Api\V1;

use App\Controllers\Api\BaseController;
use App\Exceptions\InventoryException;
use App\Services\AuditService;

/**
 * /api/v1/serials — inv_serials. Unique per (cmp, item, serial_no).
 * Serials created through the master are 'expected' until a receipt document moves them
 * to in_stock; bulkCreate registers many expected serials in one call.
 * No soft delete: delete is physical and guarded by document references / stock-bearing status.
 * Permission base: masters.serials.
 */
class SerialsController extends BaseController
{
    private const PERM = 'masters.serials';
    public const STATUSES = ['expected', 'in_stock', 'reserved', 'issued', 'in_transit', 'damaged', 'returned', 'scrapped'];
    /** Statuses that mean the serial is physically held by the company (deletion via a serial adjustment instead). */
    private const STOCK_BEARING = ['in_stock', 'reserved', 'in_transit'];
    private const BULK_MAX = 5000;
    private const COLUMNS = ['serial_no', 'batch_id', 'warehouse_id', 'location_id', 'status', 'unit_cost', 'warranty_until'];
    private const SORT = ['serial_no' => 's.serial_no', 'serial_id' => 's.serial_id', 'status' => 's.status', 'item_name' => 'i.item_name', 'warehouse_name' => 'w.warehouse_name', 'batch_no' => 'b.batch_no', 'warranty_until' => 's.warranty_until', 'created_at' => 's.created_at', 'updated_at' => 's.updated_at'];
    private const SELECT = 's.serial_id, s.serial_uuid, s.item_id, s.serial_no, s.batch_id, s.warehouse_id, s.location_id, s.status, s.unit_cost, s.received_document_id, s.issued_document_id, s.warranty_until, s.attributes_json, s.created_at, s.updated_at, i.item_name, i.item_sku, w.warehouse_name, w.warehouse_code, b.batch_no, b.expiry_date, l.location_code';

    public function index()
    {
        $a = $this->authorize(self::PERM . '.read', true, false);
        if (isset($a['response'])) {
            return $a['response'];
        }
        $cmpId = (int) $a['ctx']['cmp_id'];
        $p = $this->listParams(100, 1000, 'serial_no');
        $b = $this->baseQuery($cmpId);
        foreach (['item_id', 'warehouse_id', 'batch_id', 'location_id'] as $f) {
            if ($v = (int) $this->request->getGet($f)) {
                $b->where('s.' . $f, $v);
            }
        }
        $status = strtolower(trim((string) ($this->request->getGet('status') ?? '')));
        if ($status !== '') {
            $b->whereIn('s.status', array_values(array_filter(array_map('trim', explode(',', $status)))));
        }
        $q = trim((string) ($this->request->getGet('q') ?? ''));
        if ($q !== '') {
            $side = (string) ($this->request->getGet('q_mode') ?? 'contains') === 'prefix' ? 'after' : 'both';
            $b->groupStart()->like('LOWER(s.serial_no)', mb_strtolower($q), $side, null, true)->orLike('LOWER(i.item_name)', mb_strtolower($q), $side, null, true)->groupEnd();
        }
        $total = (clone $b)->countAllResults(false);
        $rows = $b->select(self::SELECT)->orderBy(self::SORT[$p['sort']] ?? 's.serial_no', $p['order'])->limit($p['limit'], $p['offset'])->get()->getResultArray();

        return $this->respondList(array_map([$this, 'present'], $rows), $total, $p['limit'], $p['offset']);
    }

    public function show($id = null)
    {
        $a = $this->authorize(self::PERM . '.read', true, false);
        if (isset($a['response'])) {
            return $a['response'];
        }
        $row = $this->fetch((int) $a['ctx']['cmp_id'], (int) $id);

        return $row ? $this->respond(['data' => $row]) : $this->failStructured(404, 'not_found', 'Serial not found');
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
            $db->table('inv_serials')->insert($row);
            $id = (int) $db->insertID();
            (new AuditService())->log($cmpId, 'serial', $id, 'serial.create', $a['session']['uuid'], [], null, $row);

            return $this->respondCreated(['data' => $this->fetch($cmpId, $id)]);
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
        $existing = $db->table('inv_serials')->where('cmp_id', $cmpId)->where('serial_id', (int) $id)->get()->getRowArray();
        if (!$existing) {
            return $this->failStructured(404, 'not_found', 'Serial not found');
        }
        $body = $this->request->getJSON(true) ?? [];
        try {
            $row = $this->buildRow($cmpId, array_merge($existing, $body), $existing);
            $row['updated_by'] = $a['session']['uuid'];
            $row['updated_at'] = date('Y-m-d H:i:s');
            $db->table('inv_serials')->where('serial_id', (int) $id)->where('cmp_id', $cmpId)->update($row);
            (new AuditService())->log($cmpId, 'serial', (int) $id, 'serial.update', $a['session']['uuid'], [], $existing, $row);

            return $this->respond(['data' => $this->fetch($cmpId, (int) $id)]);
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
        $existing = $db->table('inv_serials')->where('cmp_id', $cmpId)->where('serial_id', (int) $id)->get()->getRowArray();
        if (!$existing) {
            return $this->failStructured(404, 'not_found', 'Serial not found');
        }
        $n = $db->table('inv_document_line_serials')->where('cmp_id', $cmpId)->where('serial_id', (int) $id)->countAllResults();
        if ($n > 0) {
            return $this->failStructured(409, 'delete_blocked', 'Serial is referenced by ' . $n . ' document line(s) and cannot be deleted', ['guard' => 'document line(s)', 'count' => $n]);
        }
        if (in_array((string) $existing['status'], self::STOCK_BEARING, true)) {
            return $this->failStructured(409, 'delete_blocked', 'Serial is ' . $existing['status'] . '; remove it with a serial adjustment document instead', ['guard' => 'status', 'status' => $existing['status']]);
        }
        $db->table('inv_serials')->where('cmp_id', $cmpId)->where('serial_id', (int) $id)->delete();
        (new AuditService())->log($cmpId, 'serial', (int) $id, 'serial.delete', $a['session']['uuid'], [], $existing, null);

        return $this->respondDeleted(['data' => ['serial_id' => (int) $id]]);
    }

    /**
     * POST /serials/bulk {item_id, serial_nos:[...], warehouse_id?, batch_id?, location_id?}
     * Registers 'expected' serials. Duplicates (in the request or already registered) are skipped, not errors.
     */
    public function bulkCreate()
    {
        $a = $this->authorize(self::PERM . '.write', true, false);
        if (isset($a['response'])) {
            return $a['response'];
        }
        $cmpId = (int) $a['ctx']['cmp_id'];
        $body = $this->request->getJSON(true) ?? [];
        $db = \Config\Database::connect();
        try {
            $itemId = (int) ($body['item_id'] ?? 0);
            $item = $this->requireSerialItem($cmpId, $itemId);
            $warehouseId = isset($body['warehouse_id']) && (int) $body['warehouse_id'] > 0 ? (int) $body['warehouse_id'] : null;
            $batchId = isset($body['batch_id']) && (int) $body['batch_id'] > 0 ? (int) $body['batch_id'] : null;
            $locationId = isset($body['location_id']) && (int) $body['location_id'] > 0 ? (int) $body['location_id'] : null;
            $this->validateRefs($cmpId, $itemId, $warehouseId, $batchId, $locationId);
            $raw = $body['serial_nos'] ?? [];
            if (!is_array($raw) || $raw === []) {
                throw InventoryException::validation('serial_nos must be a non-empty list', ['field' => 'serial_nos']);
            }
            if (count($raw) > self::BULK_MAX) {
                throw InventoryException::validation('At most ' . self::BULK_MAX . ' serial numbers per request', ['field' => 'serial_nos', 'max' => self::BULK_MAX]);
            }
            $skipped = [];
            $wanted = [];
            foreach ($raw as $s) {
                $no = is_array($s) ? trim((string) ($s['serial_no'] ?? '')) : trim((string) $s);
                if ($no === '') {
                    $skipped[] = ['serial_no' => $no, 'reason' => 'empty'];
                    continue;
                }
                if (strlen($no) > 128) {
                    $skipped[] = ['serial_no' => $no, 'reason' => 'too_long'];
                    continue;
                }
                if (isset($wanted[$no])) {
                    $skipped[] = ['serial_no' => $no, 'reason' => 'duplicate_in_request'];
                    continue;
                }
                $wanted[$no] = true;
            }
            $existing = [];
            foreach (array_chunk(array_keys($wanted), 500) as $chunk) {
                foreach ($db->table('inv_serials')->select('serial_no, status')->where('cmp_id', $cmpId)->where('item_id', $itemId)->whereIn('serial_no', $chunk)->get()->getResultArray() as $r) {
                    $existing[$r['serial_no']] = $r['status'];
                }
            }
            $now = date('Y-m-d H:i:s');
            $rows = [];
            foreach (array_keys($wanted) as $no) {
                if (isset($existing[$no])) {
                    $skipped[] = ['serial_no' => $no, 'reason' => 'already_registered', 'status' => $existing[$no]];
                    continue;
                }
                $rows[] = ['cmp_id' => $cmpId, 'item_id' => $itemId, 'serial_no' => $no, 'batch_id' => $batchId, 'warehouse_id' => $warehouseId, 'location_id' => $locationId, 'status' => 'expected', 'created_by' => $a['session']['uuid'], 'created_at' => $now, 'updated_by' => $a['session']['uuid'], 'updated_at' => $now];
            }
            $created = [];
            if ($rows !== []) {
                $db->transStart();
                foreach (array_chunk($rows, 500) as $chunk) {
                    $db->table('inv_serials')->insertBatch($chunk);
                    $nos = array_column($chunk, 'serial_no');
                    foreach ($db->table('inv_serials')->select('serial_id, serial_no')->where('cmp_id', $cmpId)->where('item_id', $itemId)->whereIn('serial_no', $nos)->get()->getResultArray() as $r) {
                        $created[] = ['serial_id' => (int) $r['serial_id'], 'serial_no' => $r['serial_no']];
                    }
                }
                $db->transComplete();
                if ($db->transStatus() === false) {
                    throw new \RuntimeException('Could not register serial numbers', 500);
                }
                (new AuditService())->log($cmpId, 'serial', $itemId, 'serial.bulk_create', $a['session']['uuid'], [], null, ['item_id' => $itemId, 'warehouse_id' => $warehouseId, 'batch_id' => $batchId, 'created' => count($created), 'skipped' => count($skipped)]);
            }

            return $this->respondCreated(['data' => ['item_id' => $itemId, 'item_name' => $item['item_name'], 'created' => $created, 'skipped' => $skipped, 'created_count' => count($created), 'skipped_count' => count($skipped)]]);
        } catch (\Throwable $e) {
            $db->transRollback();

            return $this->failFromException($e);
        }
    }

    // ------------------------------------------------------------------ helpers

    private function baseQuery(int $cmpId)
    {
        return \Config\Database::connect()->table('inv_serials s')
            ->join('inv_items i', 'i.item_id = s.item_id', 'left')
            ->join('inv_warehouses w', 'w.warehouse_id = s.warehouse_id', 'left')
            ->join('inv_batches b', 'b.batch_id = s.batch_id', 'left')
            ->join('inv_locations l', 'l.location_id = s.location_id', 'left')
            ->where('s.cmp_id', $cmpId);
    }

    /** @return array<string, mixed>|null */
    private function fetch(int $cmpId, int $id): ?array
    {
        $row = $this->baseQuery($cmpId)->where('s.serial_id', $id)->select(self::SELECT)->get()->getRowArray();

        return $row ? $this->present($row) : null;
    }

    /** @return array<string, mixed> */
    private function present(array $row): array
    {
        $row['attributes'] = isset($row['attributes_json']) ? json_decode((string) $row['attributes_json'], true) : null;
        unset($row['attributes_json']);
        if (isset($row['unit_cost'])) {
            $row['unit_cost'] = (float) $row['unit_cost'];
        }

        return $row;
    }

    /** @return array<string, mixed> the item row (must be live, active and serial-tracked) */
    private function requireSerialItem(int $cmpId, int $itemId): array
    {
        if ($itemId <= 0) {
            throw InventoryException::validation('item_id is required', ['field' => 'item_id']);
        }
        $item = \Config\Database::connect()->table('inv_items')->select('item_id, item_name, track_serial')->where('cmp_id', $cmpId)->where('item_id', $itemId)->where('deleted_at', null)->where('is_active', 1)->get()->getRowArray();
        if (!$item) {
            throw InventoryException::validation('Item #' . $itemId . ' not found or inactive in this company', ['field' => 'item_id', 'item_id' => $itemId]);
        }
        if ((int) $item['track_serial'] !== 1) {
            throw InventoryException::validation('Item "' . $item['item_name'] . '" does not track serial numbers (track_serial)', ['field' => 'item_id', 'item_id' => $itemId]);
        }

        return $item;
    }

    private function validateRefs(int $cmpId, int $itemId, ?int $warehouseId, ?int $batchId, ?int $locationId): void
    {
        $db = \Config\Database::connect();
        if ($warehouseId !== null && $db->table('inv_warehouses')->where('cmp_id', $cmpId)->where('warehouse_id', $warehouseId)->where('deleted_at', null)->countAllResults() === 0) {
            throw InventoryException::validation('Warehouse #' . $warehouseId . ' not found in this company', ['field' => 'warehouse_id']);
        }
        if ($batchId !== null && $db->table('inv_batches')->where('cmp_id', $cmpId)->where('batch_id', $batchId)->where('item_id', $itemId)->countAllResults() === 0) {
            throw InventoryException::validation('Batch #' . $batchId . ' not found for this item', ['field' => 'batch_id']);
        }
        if ($locationId !== null) {
            $loc = $db->table('inv_locations')->select('warehouse_id')->where('cmp_id', $cmpId)->where('location_id', $locationId)->where('deleted_at', null)->get()->getRowArray();
            if (!$loc) {
                throw InventoryException::validation('Location #' . $locationId . ' not found in this company', ['field' => 'location_id']);
            }
            if ($warehouseId !== null && (int) $loc['warehouse_id'] !== $warehouseId) {
                throw InventoryException::validation('Location #' . $locationId . ' does not belong to warehouse #' . $warehouseId, ['field' => 'location_id']);
            }
        }
    }

    /** @return array<string, mixed> */
    private function buildRow(int $cmpId, array $body, ?array $existing): array
    {
        $itemId = (int) ($body['item_id'] ?? 0);
        if ($existing && $itemId !== (int) $existing['item_id']) {
            throw InventoryException::validation('item_id cannot be changed on an existing serial', ['field' => 'item_id']);
        }
        $this->requireSerialItem($cmpId, $itemId);
        $row = ['item_id' => $itemId];
        foreach (self::COLUMNS as $col) {
            if (array_key_exists($col, $body)) {
                $v = $body[$col];
                $row[$col] = is_string($v) ? trim($v) : $v;
                if ($row[$col] === '') {
                    $row[$col] = null;
                }
            }
        }
        if (empty($row['serial_no'])) {
            throw InventoryException::validation('serial_no is required', ['field' => 'serial_no']);
        }
        $row['serial_no'] = substr((string) $row['serial_no'], 0, 128);
        foreach (['batch_id', 'warehouse_id', 'location_id'] as $ref) {
            $row[$ref] = isset($row[$ref]) && (int) $row[$ref] > 0 ? (int) $row[$ref] : null;
        }
        $this->validateRefs($cmpId, $itemId, $row['warehouse_id'], $row['batch_id'], $row['location_id']);
        $status = strtolower((string) ($row['status'] ?? ($existing['status'] ?? 'expected'))) ?: 'expected';
        if (!in_array($status, self::STATUSES, true)) {
            throw InventoryException::validation('status must be one of ' . implode(', ', self::STATUSES), ['field' => 'status']);
        }
        $row['status'] = $status;
        if (array_key_exists('unit_cost', $row) && $row['unit_cost'] !== null) {
            $row['unit_cost'] = round((float) $row['unit_cost'], 4);
        }
        if (isset($row['warranty_until']) && !preg_match('/^\d{4}-\d{2}-\d{2}$/', (string) $row['warranty_until'])) {
            throw InventoryException::validation('warranty_until must be YYYY-MM-DD', ['field' => 'warranty_until']);
        }
        if (array_key_exists('attributes', $body)) {
            $row['attributes_json'] = is_array($body['attributes']) ? json_encode($body['attributes'], JSON_UNESCAPED_UNICODE) : null;
        }
        $dup = \Config\Database::connect()->table('inv_serials')->where('cmp_id', $cmpId)->where('item_id', $itemId)->where('serial_no', $row['serial_no']);
        if ($existing) {
            $dup->where('serial_id !=', (int) $existing['serial_id']);
        }
        if ($dup->countAllResults() > 0) {
            throw InventoryException::conflict('Serial "' . $row['serial_no'] . '" already exists for this item', ['field' => 'serial_no']);
        }

        return $row;
    }
}
