<?php

namespace App\Controllers\Api\V1;

use App\Controllers\Api\BaseController;
use App\Exceptions\InventoryException;
use App\Services\AuditService;
use App\Services\MasterMirrorService;

/**
 * Shared CRUD for simple inventory masters. Subclasses declare the table, pk, name column,
 * writable columns, required columns, permission base and delete guards.
 */
abstract class MasterController extends BaseController
{
    protected string $table;
    protected string $pk;
    protected string $nameColumn;
    protected string $permissionBase;
    protected string $label = 'Master';
    /** @var list<string> */
    protected array $columns = [];
    /** @var list<string> */
    protected array $required = [];
    /** @var list<array{table:string, column:string, label:string}> */
    protected array $deleteGuards = [];
    /** @var list<string> */
    protected array $searchColumns = [];
    protected ?string $parentColumn = null;
    protected bool $hasSoftDelete = true;
    protected string $entityType = 'master';
    /** Master kind Books mirrors (uom | warehouse): every write enqueues an upsert event in the same transaction. null = not mirrored. */
    protected ?string $mirrorKind = null;

    public function index()
    {
        $a = $this->authorize($this->permissionBase . '.read', true, false);
        if (isset($a['response'])) {
            return $a['response'];
        }
        $cmpId = (int) $a['ctx']['cmp_id'];
        $p = $this->listParams(100, 1000, $this->nameColumn);
        $b = \Config\Database::connect()->table($this->table)->where('cmp_id', $cmpId);
        if ($this->hasSoftDelete) {
            $b->where('deleted_at', null);
        }
        $status = strtolower((string) ($this->request->getGet('status') ?? ''));
        if ($status === 'active' || (int) ($this->request->getGet('active_only') ?? 0) === 1) {
            $b->where('is_active', 1);
        } elseif ($status === 'inactive') {
            $b->where('is_active', 0);
        }
        $q = trim((string) ($this->request->getGet('q') ?? ''));
        if ($q !== '') {
            $b->groupStart();
            foreach (array_merge([$this->nameColumn], $this->searchColumns) as $i => $col) {
                $i === 0 ? $b->like($col, $q, 'both', null, true) : $b->orLike($col, $q, 'both', null, true);
            }
            $b->groupEnd();
        }
        $this->applyIndexFilters($b);
        $total = (clone $b)->countAllResults(false);
        $sort = in_array($p['sort'], array_merge([$this->nameColumn, $this->pk, 'created_at', 'updated_at'], $this->columns), true) ? $p['sort'] : $this->nameColumn;
        $rows = $b->orderBy($sort, $p['order'])->limit($p['limit'], $p['offset'])->get()->getResultArray();

        return $this->respondList($this->decorateRows($cmpId, array_map([$this, 'present'], $rows)), $total, $p['limit'], $p['offset']);
    }

    public function show($id = null)
    {
        $a = $this->authorize($this->permissionBase . '.read', true, false);
        if (isset($a['response'])) {
            return $a['response'];
        }
        $row = $this->find((int) $a['ctx']['cmp_id'], (int) $id);

        return $row ? $this->respond(['data' => $this->presentOne((int) $a['ctx']['cmp_id'], $row)]) : $this->failStructured(404, 'not_found', $this->label . ' not found');
    }

    public function create()
    {
        $a = $this->authorize($this->permissionBase . '.write', true, false);
        if (isset($a['response'])) {
            return $a['response'];
        }
        $cmpId = (int) $a['ctx']['cmp_id'];
        $body = $this->request->getJSON(true) ?? [];
        try {
            $row = $this->buildRow($cmpId, $body, null);
            $this->validateRow($cmpId, $row, null);
            $now = date('Y-m-d H:i:s');
            $row += ['cmp_id' => $cmpId, 'is_active' => isset($body['is_active']) ? (!empty($body['is_active']) ? 1 : 0) : 1, 'created_by' => $a['session']['uuid'], 'created_at' => $now, 'updated_by' => $a['session']['uuid'], 'updated_at' => $now];
            $db = \Config\Database::connect();
            $db->transStart();
            if (!$db->table($this->table)->insert($row)) {
                throw new \RuntimeException('Could not create ' . $this->label . ': ' . (string) ($db->error()['message'] ?? 'database error'), 500);
            }
            $id = (int) $db->insertID();
            $this->afterSave($cmpId, $id, $body, $a['session']['uuid'], true);
            $this->publishMirror($cmpId, $id);
            $db->transComplete();
            if ($db->transStatus() === false) {
                throw new \RuntimeException('Could not create ' . $this->label . ': transaction failed', 500);
            }
            (new AuditService())->log($cmpId, $this->entityType, $id, $this->entityType . '.create', $a['session']['uuid'], [], null, $row);

            return $this->respondCreated(['data' => $this->presentOne($cmpId, $this->find($cmpId, $id))]);
        } catch (\Throwable $e) {
            \Config\Database::connect()->transRollback();

            return $this->failFromException($e);
        }
    }

    public function update($id = null)
    {
        $a = $this->authorize($this->permissionBase . '.write', true, false);
        if (isset($a['response'])) {
            return $a['response'];
        }
        $cmpId = (int) $a['ctx']['cmp_id'];
        $existing = $this->find($cmpId, (int) $id);
        if (!$existing) {
            return $this->failStructured(404, 'not_found', $this->label . ' not found');
        }
        $body = $this->request->getJSON(true) ?? [];
        try {
            $row = $this->buildRow($cmpId, array_merge($existing, $body), $existing);
            $this->validateRow($cmpId, $row, $existing);
            if (array_key_exists('is_active', $body)) {
                $row['is_active'] = !empty($body['is_active']) ? 1 : 0;
            }
            $row['updated_by'] = $a['session']['uuid'];
            $row['updated_at'] = date('Y-m-d H:i:s');
            $db = \Config\Database::connect();
            $db->transStart();
            if (!$db->table($this->table)->where($this->pk, (int) $id)->where('cmp_id', $cmpId)->update($row)) {
                throw new \RuntimeException('Could not update ' . $this->label . ': ' . (string) ($db->error()['message'] ?? 'database error'), 500);
            }
            $this->afterSave($cmpId, (int) $id, $body, $a['session']['uuid'], false);
            $this->publishMirror($cmpId, (int) $id);
            $db->transComplete();
            if ($db->transStatus() === false) {
                throw new \RuntimeException('Could not update ' . $this->label . ': transaction failed', 500);
            }
            (new AuditService())->log($cmpId, $this->entityType, (int) $id, $this->entityType . '.update', $a['session']['uuid'], [], $existing, $row);

            return $this->respond(['data' => $this->presentOne($cmpId, $this->find($cmpId, (int) $id))]);
        } catch (\Throwable $e) {
            \Config\Database::connect()->transRollback();

            return $this->failFromException($e);
        }
    }

    public function delete($id = null)
    {
        $a = $this->authorize($this->permissionBase . '.delete', true, false);
        if (isset($a['response'])) {
            return $a['response'];
        }
        $cmpId = (int) $a['ctx']['cmp_id'];
        $existing = $this->find($cmpId, (int) $id);
        if (!$existing) {
            return $this->failStructured(404, 'not_found', $this->label . ' not found');
        }
        $db = \Config\Database::connect();
        foreach ($this->deleteGuards as $g) {
            $b = $db->table($g['table'])->where($g['column'], (int) $id)->where('cmp_id', $cmpId);
            if ($db->fieldExists('deleted_at', $g['table'])) {
                $b->where('deleted_at', null);
            }
            $n = $b->countAllResults();
            if ($n > 0) {
                return $this->failStructured(409, 'delete_blocked', $this->label . ' is used by ' . $n . ' ' . $g['label'] . ' and cannot be deleted', ['guard' => $g['label'], 'count' => $n]);
            }
        }
        if ($this->parentColumn) {
            $children = $db->table($this->table)->where($this->parentColumn, (int) $id)->where('cmp_id', $cmpId)->where('deleted_at', null)->countAllResults();
            if ($children > 0) {
                return $this->failStructured(409, 'delete_blocked', $this->label . ' has ' . $children . ' child record(s)', ['count' => $children]);
            }
        }
        $now = date('Y-m-d H:i:s');
        $patch = ['deleted_at' => $now, 'is_active' => 0, 'updated_at' => $now];
        if ($db->fieldExists('deleted_by', $this->table)) {
            $patch['deleted_by'] = $a['session']['uuid'];
        }
        if ($db->fieldExists('updated_by', $this->table)) {
            $patch['updated_by'] = $a['session']['uuid'];
        }
        $db->transStart();
        if (!$db->table($this->table)->where($this->pk, (int) $id)->where('cmp_id', $cmpId)->update($patch)) {
            $db->transRollback();

            return $this->failStructured(500, 'internal_error', 'Could not delete ' . $this->label . ': ' . (string) ($db->error()['message'] ?? 'database error'));
        }
        try {
            $this->publishMirror($cmpId, (int) $id);
        } catch (\Throwable $e) {
            $db->transRollback();

            return $this->failFromException($e);
        }
        $db->transComplete();
        if ($db->transStatus() === false) {
            return $this->failStructured(500, 'internal_error', 'Could not delete ' . $this->label . ': transaction failed');
        }
        (new AuditService())->log($cmpId, $this->entityType, (int) $id, $this->entityType . '.delete', $a['session']['uuid'], [], $existing, null);

        return $this->respondDeleted(['data' => [$this->pk => (int) $id]]);
    }

    // ---- hooks ---------------------------------------------------------------------------

    protected function applyIndexFilters($builder): void
    {
    }

    /** @return array<string, mixed>|null */
    protected function find(int $cmpId, int $id): ?array
    {
        $b = \Config\Database::connect()->table($this->table)->where('cmp_id', $cmpId)->where($this->pk, $id);
        if ($this->hasSoftDelete) {
            $b->where('deleted_at', null);
        }

        return $b->get()->getRowArray() ?: null;
    }

    /** @return array<string, mixed> */
    protected function buildRow(int $cmpId, array $body, ?array $existing): array
    {
        $row = [];
        foreach (array_merge([$this->nameColumn], $this->columns) as $col) {
            if (array_key_exists($col, $body)) {
                $v = $body[$col];
                $row[$col] = is_string($v) ? trim($v) : $v;
                if ($row[$col] === '') {
                    $row[$col] = null;
                }
            }
        }
        foreach ($this->required as $col) {
            if (!isset($row[$col]) || $row[$col] === null || $row[$col] === '') {
                throw InventoryException::validation($col . ' is required', ['field' => $col]);
            }
        }
        if ($this->parentColumn && array_key_exists($this->parentColumn, $row)) {
            // 0 / '' / null all mean "no parent"; never persist a literal 0 parent id.
            $row[$this->parentColumn] = empty($row[$this->parentColumn]) ? null : (int) $row[$this->parentColumn];
        }

        return $row;
    }

    protected function validateRow(int $cmpId, array $row, ?array $existing): void
    {
        $this->validateUnique($cmpId, $row, $existing);
        $this->validateParent($cmpId, $row, $existing);
    }

    /** Name uniqueness (case-insensitive) per company. Override when uniqueness has a narrower scope. */
    protected function validateUnique(int $cmpId, array $row, ?array $existing): void
    {
        if (isset($row[$this->nameColumn])) {
            $b = \Config\Database::connect()->table($this->table)->where('cmp_id', $cmpId)->where('LOWER(' . $this->nameColumn . ')', mb_strtolower((string) $row[$this->nameColumn]));
            if ($this->hasSoftDelete) {
                $b->where('deleted_at', null);
            }
            if ($existing) {
                $b->where($this->pk . ' !=', (int) $existing[$this->pk]);
            }
            if ($b->countAllResults() > 0) {
                throw InventoryException::conflict($this->label . ' "' . $row[$this->nameColumn] . '" already exists', ['field' => $this->nameColumn]);
            }
        }
    }

    /** Parent must exist in the company, must not be the row itself and must not create a cycle. */
    protected function validateParent(int $cmpId, array $row, ?array $existing): void
    {
        if ($this->parentColumn && !empty($row[$this->parentColumn])) {
            $parentId = (int) $row[$this->parentColumn];
            if ($existing && $parentId === (int) $existing[$this->pk]) {
                throw InventoryException::validation('A record cannot be its own parent');
            }
            $parent = $this->find($cmpId, $parentId);
            if (!$parent) {
                throw InventoryException::validation('Parent not found', ['field' => $this->parentColumn]);
            }
            if ($existing) {
                // cycle guard
                $cursor = $parent;
                $hops = 0;
                while ($cursor && !empty($cursor[$this->parentColumn]) && $hops++ < 100) {
                    if ((int) $cursor[$this->parentColumn] === (int) $existing[$this->pk]) {
                        throw InventoryException::validation('Parent assignment would create a cycle');
                    }
                    $cursor = $this->find($cmpId, (int) $cursor[$this->parentColumn]);
                }
            }
        }
    }

    protected function afterSave(int $cmpId, int $id, array $body, ?string $actor, bool $isNew): void
    {
    }

    /** Enqueue the Books mirror upsert for a mirrored master (soft-deleted rows publish with deleted_at set). */
    protected function publishMirror(int $cmpId, int $id): void
    {
        if ($this->mirrorKind !== null) {
            (new MasterMirrorService())->publish($this->mirrorKind, $cmpId, $id);
        }
    }

    /**
     * Attach derived data to a page of presented rows in ONE pass (grouped queries keyed by pk),
     * never one query per row. Default: no decoration.
     *
     * @param list<array<string, mixed>> $rows
     * @return list<array<string, mixed>>
     */
    protected function decorateRows(int $cmpId, array $rows): array
    {
        return $rows;
    }

    /** present() + decorateRows() for a single row. */
    protected function presentOne(int $cmpId, array $row): array
    {
        return $this->decorateRows($cmpId, [$this->present($row)])[0];
    }

    /** @return array<string, mixed> */
    protected function present(array $row): array
    {
        foreach ($row as $k => $v) {
            if (str_ends_with($k, '_json') && is_string($v)) {
                $row[substr($k, 0, -5)] = json_decode($v, true);
                unset($row[$k]);
            }
        }

        return $row;
    }
}
