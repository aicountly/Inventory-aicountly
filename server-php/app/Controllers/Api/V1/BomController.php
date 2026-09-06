<?php

namespace App\Controllers\Api\V1;

use App\Controllers\Api\BaseController;
use App\Exceptions\InventoryException;
use App\Services\AuditService;
use App\Services\BomService;

/**
 * /api/v1/bill-of-materials — inv_bom_headers + inv_bom_lines.
 *
 * Lines ride along on the header resource and are replaced wholesale on update.
 * Permission base: masters.bill_of_materials.
 */
class BomController extends BaseController
{
    private const PERM = 'masters.bill_of_materials';
    private const SORT = ['bom_name' => 'h.bom_name', 'bom_id' => 'h.bom_id', 'finished_item_name' => 'fi.item_name', 'yield_qty' => 'h.yield_qty', 'created_at' => 'h.created_at', 'updated_at' => 'h.updated_at'];

    public function index()
    {
        $a = $this->authorize(self::PERM . '.read', true, false);
        if (isset($a['response'])) {
            return $a['response'];
        }
        $cmpId = (int) $a['ctx']['cmp_id'];
        $p = $this->listParams(100, 1000, 'bom_name');
        $b = $this->baseQuery($cmpId);
        $status = strtolower((string) ($this->request->getGet('status') ?? ''));
        if ($status === 'active' || (int) ($this->request->getGet('active_only') ?? 0) === 1) {
            $b->where('h.is_active', 1);
        } elseif ($status === 'inactive') {
            $b->where('h.is_active', 0);
        }
        if ($fi = (int) $this->request->getGet('finished_item_id')) {
            $b->where('h.finished_item_id', $fi);
        }
        if ($ci = (int) $this->request->getGet('component_item_id')) {
            $b->where('EXISTS (SELECT 1 FROM inv_bom_lines cl WHERE cl.bom_id = h.bom_id AND cl.cmp_id = ' . $cmpId . ' AND cl.item_id = ' . $ci . ')', null, false);
        }
        $q = trim((string) ($this->request->getGet('q') ?? ''));
        if ($q !== '') {
            $b->groupStart()->like('LOWER(h.bom_name)', mb_strtolower($q), 'both', null, true)->orLike('LOWER(fi.item_name)', mb_strtolower($q), 'both', null, true)->groupEnd();
        }
        $total = (clone $b)->countAllResults(false);
        $rows = $b->select('h.bom_id, h.bom_uuid, h.bom_name, h.finished_item_id, h.yield_qty, h.yield_unit_id, h.is_active, h.created_at, h.updated_at, fi.item_name AS finished_item_name, fi.item_sku AS finished_item_sku, yu.unit_symbol AS yield_unit_symbol')
            ->orderBy(self::SORT[$p['sort']] ?? 'h.bom_name', $p['order'])->limit($p['limit'], $p['offset'])->get()->getResultArray();
        $counts = $this->lineCounts($cmpId, array_map(static fn ($r) => (int) $r['bom_id'], $rows));
        foreach ($rows as &$r) {
            $r['yield_qty'] = (float) $r['yield_qty'];
            $r['line_count'] = $counts[(int) $r['bom_id']] ?? 0;
        }

        return $this->respondList($rows, $total, $p['limit'], $p['offset']);
    }

    public function show($id = null)
    {
        $a = $this->authorize(self::PERM . '.read', true, false);
        if (isset($a['response'])) {
            return $a['response'];
        }
        $row = $this->present((int) $a['ctx']['cmp_id'], (int) $id);

        return $row ? $this->respond(['data' => $row]) : $this->failStructured(404, 'not_found', 'Bill of materials not found');
    }

    public function create()
    {
        $a = $this->authorize(self::PERM . '.write', true, false);
        if (isset($a['response'])) {
            return $a['response'];
        }
        $cmpId = (int) $a['ctx']['cmp_id'];
        $body = $this->request->getJSON(true) ?? [];
        $db = \Config\Database::connect();
        try {
            $row = $this->buildHeader($cmpId, $body, null);
            $lines = $this->buildLines($cmpId, (array) ($body['lines'] ?? []), (int) $row['finished_item_id']);
            $now = date('Y-m-d H:i:s');
            $row += ['cmp_id' => $cmpId, 'is_active' => isset($body['is_active']) ? (!empty($body['is_active']) ? 1 : 0) : 1, 'created_by' => $a['session']['uuid'], 'created_at' => $now, 'updated_by' => $a['session']['uuid'], 'updated_at' => $now];
            $db->transStart();
            $db->table('inv_bom_headers')->insert($row);
            $bomId = (int) $db->insertID();
            $this->writeLines($db, $cmpId, $bomId, $lines);
            $db->transComplete();
            if ($db->transStatus() === false) {
                throw new \RuntimeException('Could not save bill of materials', 500);
            }
            (new AuditService())->log($cmpId, 'bom', $bomId, 'bom.create', $a['session']['uuid'], [], null, $row + ['lines' => $lines]);

            return $this->respondCreated(['data' => $this->present($cmpId, $bomId)]);
        } catch (\Throwable $e) {
            $db->transRollback();

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
        $existing = $this->find($cmpId, (int) $id);
        if (!$existing) {
            return $this->failStructured(404, 'not_found', 'Bill of materials not found');
        }
        $body = $this->request->getJSON(true) ?? [];
        $db = \Config\Database::connect();
        try {
            $row = $this->buildHeader($cmpId, array_merge($existing, $body), $existing);
            $replaceLines = array_key_exists('lines', $body);
            $lines = $replaceLines
                ? $this->buildLines($cmpId, (array) $body['lines'], (int) $row['finished_item_id'])
                : $this->buildLines($cmpId, (new BomService())->lines($cmpId, [(int) $id])[(int) $id] ?? [], (int) $row['finished_item_id']);
            if (array_key_exists('is_active', $body)) {
                $row['is_active'] = !empty($body['is_active']) ? 1 : 0;
            }
            $row['updated_by'] = $a['session']['uuid'];
            $row['updated_at'] = date('Y-m-d H:i:s');
            $db->transStart();
            $db->table('inv_bom_headers')->where('bom_id', (int) $id)->where('cmp_id', $cmpId)->update($row);
            if ($replaceLines) {
                $db->table('inv_bom_lines')->where('bom_id', (int) $id)->where('cmp_id', $cmpId)->delete();
                $this->writeLines($db, $cmpId, (int) $id, $lines);
            }
            $db->transComplete();
            if ($db->transStatus() === false) {
                throw new \RuntimeException('Could not save bill of materials', 500);
            }
            (new AuditService())->log($cmpId, 'bom', (int) $id, 'bom.update', $a['session']['uuid'], [], $existing, $row + ($replaceLines ? ['lines' => $lines] : []));

            return $this->respond(['data' => $this->present($cmpId, (int) $id)]);
        } catch (\Throwable $e) {
            $db->transRollback();

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
        $existing = $this->find($cmpId, (int) $id);
        if (!$existing) {
            return $this->failStructured(404, 'not_found', 'Bill of materials not found');
        }
        $db = \Config\Database::connect();
        $used = $db->table('inv_documents')->where('cmp_id', $cmpId)->where('document_type', 'PRODUCTION')
            ->where('status !=', 'CANCELLED')
            ->where("(metadata_json->>'bom_id') = '" . (int) $id . "'", null, false)
            ->countAllResults();
        if ($used > 0) {
            return $this->failStructured(409, 'delete_blocked', 'Bill of materials is used by ' . $used . ' production document(s) and cannot be deleted', ['guard' => 'production document(s)', 'count' => $used]);
        }
        $now = date('Y-m-d H:i:s');
        $db->table('inv_bom_headers')->where('bom_id', (int) $id)->where('cmp_id', $cmpId)->update(['deleted_at' => $now, 'deleted_by' => $a['session']['uuid'], 'is_active' => 0, 'updated_at' => $now]);
        (new AuditService())->log($cmpId, 'bom', (int) $id, 'bom.delete', $a['session']['uuid'], [], $existing, null);

        return $this->respondDeleted(['data' => ['bom_id' => (int) $id]]);
    }

    // ------------------------------------------------------------------ helpers

    private function baseQuery(int $cmpId)
    {
        return \Config\Database::connect()->table('inv_bom_headers h')
            ->join('inv_items fi', 'fi.item_id = h.finished_item_id', 'left')
            ->join('inv_uom yu', 'yu.unit_id = h.yield_unit_id', 'left')
            ->where('h.cmp_id', $cmpId)->where('h.deleted_at', null);
    }

    /** @return array<string, mixed>|null */
    private function find(int $cmpId, int $id): ?array
    {
        return \Config\Database::connect()->table('inv_bom_headers')->where('cmp_id', $cmpId)->where('bom_id', $id)->where('deleted_at', null)->get()->getRowArray() ?: null;
    }

    /** @return array<string, mixed>|null */
    private function present(int $cmpId, int $id): ?array
    {
        $row = $this->baseQuery($cmpId)->where('h.bom_id', $id)
            ->select('h.*, fi.item_name AS finished_item_name, fi.item_sku AS finished_item_sku, fi.unit_id AS finished_item_unit_id, fi.is_active AS finished_item_is_active, yu.unit_symbol AS yield_unit_symbol')
            ->get()->getRowArray();
        if (!$row) {
            return null;
        }
        $row['yield_qty'] = (float) $row['yield_qty'];
        $row['lines'] = (new BomService())->lines($cmpId, [$id])[$id] ?? [];
        $row['line_count'] = count($row['lines']);

        return $row;
    }

    /** @return array<int, int> */
    private function lineCounts(int $cmpId, array $bomIds): array
    {
        $bomIds = array_values(array_filter($bomIds));
        if ($bomIds === []) {
            return [];
        }
        $out = [];
        foreach (array_chunk($bomIds, 500) as $chunk) {
            $rows = \Config\Database::connect()->table('inv_bom_lines')->select('bom_id, COUNT(*) AS n')->where('cmp_id', $cmpId)->whereIn('bom_id', $chunk)->groupBy('bom_id')->get()->getResultArray();
            foreach ($rows as $r) {
                $out[(int) $r['bom_id']] = (int) $r['n'];
            }
        }

        return $out;
    }

    /** @return array<string, mixed> */
    private function buildHeader(int $cmpId, array $body, ?array $existing): array
    {
        $name = trim((string) ($body['bom_name'] ?? ''));
        if ($name === '') {
            throw InventoryException::validation('bom_name is required', ['field' => 'bom_name']);
        }
        $finishedItemId = (int) ($body['finished_item_id'] ?? 0);
        if ($finishedItemId <= 0) {
            throw InventoryException::validation('finished_item_id is required', ['field' => 'finished_item_id']);
        }
        $yieldQty = (float) ($body['yield_qty'] ?? 1);
        if ($yieldQty <= 0) {
            throw InventoryException::validation('yield_qty must be greater than zero', ['field' => 'yield_qty']);
        }
        $items = $this->activeItems($cmpId, [$finishedItemId]);
        if (!isset($items[$finishedItemId])) {
            throw InventoryException::validation('Finished item #' . $finishedItemId . ' not found or inactive in this company', ['field' => 'finished_item_id', 'item_id' => $finishedItemId]);
        }
        $yieldUnitId = isset($body['yield_unit_id']) && (int) $body['yield_unit_id'] > 0 ? (int) $body['yield_unit_id'] : null;
        if ($yieldUnitId !== null && $this->validUnits($cmpId, [$yieldUnitId]) === []) {
            throw InventoryException::validation('yield_unit_id #' . $yieldUnitId . ' not found in this company', ['field' => 'yield_unit_id']);
        }
        $db = \Config\Database::connect();
        $dup = $db->table('inv_bom_headers')->where('cmp_id', $cmpId)->where('LOWER(bom_name)', mb_strtolower($name))->where('deleted_at', null);
        if ($existing) {
            $dup->where('bom_id !=', (int) $existing['bom_id']);
        }
        if ($dup->countAllResults() > 0) {
            throw InventoryException::conflict('Bill of materials "' . $name . '" already exists', ['field' => 'bom_name']);
        }

        return ['bom_name' => substr($name, 0, 255), 'finished_item_id' => $finishedItemId, 'yield_qty' => round($yieldQty, 4), 'yield_unit_id' => $yieldUnitId ?? (int) $items[$finishedItemId]['unit_id'] ?: null];
    }

    /**
     * @param list<array<string, mixed>> $raw
     * @return list<array<string, mixed>>
     */
    private function buildLines(int $cmpId, array $raw, int $finishedItemId): array
    {
        $lines = [];
        $sort = 0;
        foreach ($raw as $idx => $l) {
            if (!is_array($l)) {
                continue;
            }
            $itemId = (int) ($l['item_id'] ?? 0);
            if ($itemId <= 0) {
                throw InventoryException::validation('Line ' . ($idx + 1) . ': item_id is required', ['line' => $idx + 1]);
            }
            $qty = (float) ($l['qty'] ?? 0);
            if ($qty < 0) {
                throw InventoryException::validation('Line ' . ($idx + 1) . ': qty cannot be negative', ['line' => $idx + 1]);
            }
            $kind = strtolower(trim((string) ($l['line_kind'] ?? 'component'))) ?: 'component';
            if (!in_array($kind, BomService::LINE_KINDS, true)) {
                throw InventoryException::validation('Line ' . ($idx + 1) . ': line_kind must be one of ' . implode(', ', BomService::LINE_KINDS), ['line' => $idx + 1]);
            }
            if ($kind === 'component' && $itemId === $finishedItemId) {
                throw InventoryException::validation('Line ' . ($idx + 1) . ': the finished item cannot be its own component', ['line' => $idx + 1]);
            }
            $scrap = (float) ($l['scrap_percent'] ?? 0);
            if ($scrap < 0 || $scrap > 100) {
                throw InventoryException::validation('Line ' . ($idx + 1) . ': scrap_percent must be between 0 and 100', ['line' => $idx + 1]);
            }
            $lines[] = [
                'item_id'       => $itemId,
                'qty'           => round($qty, 4),
                'unit_id'       => isset($l['unit_id']) && (int) $l['unit_id'] > 0 ? (int) $l['unit_id'] : null,
                'line_kind'     => $kind,
                'scrap_percent' => round($scrap, 4),
                'sort_order'    => isset($l['sort_order']) && $l['sort_order'] !== '' ? (int) $l['sort_order'] : $sort,
            ];
            $sort++;
        }
        if ($lines === []) {
            throw InventoryException::validation('At least one component line is required', ['field' => 'lines']);
        }
        if (array_filter($lines, static fn ($l) => $l['line_kind'] === 'component' && $l['qty'] > 0) === []) {
            throw InventoryException::validation('At least one component line must have qty greater than zero', ['field' => 'lines']);
        }
        $itemIds = array_values(array_unique(array_column($lines, 'item_id')));
        $items = $this->activeItems($cmpId, $itemIds);
        $missing = array_values(array_diff($itemIds, array_keys($items)));
        if ($missing !== []) {
            throw InventoryException::validation('Component item(s) not found or inactive in this company: #' . implode(', #', $missing), ['field' => 'lines', 'item_ids' => $missing]);
        }
        $unitIds = array_values(array_unique(array_filter(array_column($lines, 'unit_id'))));
        if ($unitIds !== []) {
            $badUnits = array_values(array_diff($unitIds, $this->validUnits($cmpId, $unitIds)));
            if ($badUnits !== []) {
                throw InventoryException::validation('Unit(s) not found in this company: #' . implode(', #', $badUnits), ['field' => 'lines', 'unit_ids' => $badUnits]);
            }
        }
        foreach ($lines as &$l) {
            $l['unit_id'] ??= (int) $items[$l['item_id']]['unit_id'] ?: null;
        }

        return $lines;
    }

    /** @param list<array<string, mixed>> $lines */
    private function writeLines($db, int $cmpId, int $bomId, array $lines): void
    {
        $rows = array_map(static fn ($l) => $l + ['bom_id' => $bomId, 'cmp_id' => $cmpId], $lines);
        foreach (array_chunk($rows, 200) as $chunk) {
            $db->table('inv_bom_lines')->insertBatch($chunk);
        }
    }

    /** @return array<int, array<string, mixed>> live, active items keyed by id */
    private function activeItems(int $cmpId, array $itemIds): array
    {
        $itemIds = array_values(array_unique(array_filter(array_map('intval', $itemIds), static fn ($i) => $i > 0)));
        if ($itemIds === []) {
            return [];
        }
        $out = [];
        foreach (array_chunk($itemIds, 500) as $chunk) {
            $rows = \Config\Database::connect()->table('inv_items')->select('item_id, item_name, unit_id')->where('cmp_id', $cmpId)->where('deleted_at', null)->where('is_active', 1)->whereIn('item_id', $chunk)->get()->getResultArray();
            foreach ($rows as $r) {
                $out[(int) $r['item_id']] = $r;
            }
        }

        return $out;
    }

    /** @return list<int> unit ids that exist (live) in the company */
    private function validUnits(int $cmpId, array $unitIds): array
    {
        $unitIds = array_values(array_unique(array_filter(array_map('intval', $unitIds), static fn ($i) => $i > 0)));
        if ($unitIds === []) {
            return [];
        }
        $rows = \Config\Database::connect()->table('inv_uom')->select('unit_id')->where('cmp_id', $cmpId)->where('deleted_at', null)->whereIn('unit_id', $unitIds)->get()->getResultArray();

        return array_map(static fn ($r) => (int) $r['unit_id'], $rows);
    }
}
