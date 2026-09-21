<?php

namespace App\Controllers\Api\V1;

use App\Exceptions\InventoryException;

class WarehouseGroupsController extends MasterController
{
    protected string $table = 'inv_warehouse_groups';
    protected string $pk = 'warehouse_group_id';
    protected string $nameColumn = 'grp_name';
    protected string $permissionBase = 'masters.warehouse_groups';
    protected string $label = 'Warehouse Group';
    protected string $entityType = 'warehouse_group';
    protected array $columns = ['grp_code', 'description', 'parent_grp_id'];
    protected array $required = ['grp_name'];
    protected array $searchColumns = ['grp_code', 'description'];
    protected ?string $parentColumn = 'parent_grp_id';
    protected array $deleteGuards = [['table' => 'inv_warehouses', 'column' => 'warehouse_group_id', 'label' => 'warehouse(s)']];

    /**
     * A group code as it is stored: trimmed, upper-cased, or null when there is nothing left.
     *
     * Static and pure so the rule can be unit-tested without a database, and so the one place that
     * decides what "the same code" means is the one place the unique index agrees with. Upper case
     * is the storage form rather than a display flourish: the index compares LOWER(grp_code), so
     * "ret" and "RET" already collide, and normalising on the way in means the register, the export
     * and the API all read back the same letters the reader typed into a code column.
     */
    public static function normaliseCode(?string $raw): ?string
    {
        $code = mb_strtoupper(trim((string) $raw));

        return $code === '' ? null : $code;
    }

    /**
     * `has_warehouses=1|0` — groups that hold warehouses, or the empty ones.
     *
     * Server-side because it is a fact about a group's warehouses, not about its own row: a client
     * that filtered it would have to hold every warehouse in the company to answer it, and would
     * get a different answer from the one the count column shows the moment a page boundary fell
     * between them.
     */
    protected function applyIndexFilters($builder): void
    {
        $has = $this->request->getGet('has_warehouses');
        if ($has === null || $has === '') {
            return;
        }
        $sub = 'SELECT 1 FROM inv_warehouses w WHERE w.warehouse_group_id = inv_warehouse_groups.warehouse_group_id'
            . ' AND w.cmp_id = inv_warehouse_groups.cmp_id AND w.deleted_at IS NULL';
        $builder->where(((int) $has === 1 ? 'EXISTS (' : 'NOT EXISTS (') . $sub . ')', null, false);
    }

    protected function buildRow(int $cmpId, array $body, ?array $existing): array
    {
        $row = parent::buildRow($cmpId, $body, $existing);
        if (array_key_exists('grp_code', $row)) {
            $row['grp_code'] = self::normaliseCode(is_string($row['grp_code']) ? $row['grp_code'] : null);
        }

        return $row;
    }

    protected function validateRow(int $cmpId, array $row, ?array $existing): void
    {
        parent::validateRow($cmpId, $row, $existing);
        $this->validateCodeUnique($cmpId, $row, $existing);
    }

    /**
     * One code, one group, per company.
     *
     * Checked here as well as by uq_inv_warehouse_groups_cmp_code so the caller gets a 409 naming
     * the field instead of a 500 carrying a Postgres constraint name. The index remains the
     * authority: it is what stops two concurrent creates that both passed this check.
     */
    private function validateCodeUnique(int $cmpId, array $row, ?array $existing): void
    {
        if (empty($row['grp_code'])) {
            return;
        }
        $b = \Config\Database::connect()->table($this->table)
            ->where('cmp_id', $cmpId)
            ->where('LOWER(grp_code)', mb_strtolower((string) $row['grp_code']))
            ->where('deleted_at', null);
        if ($existing) {
            $b->where($this->pk . ' !=', (int) $existing[$this->pk]);
        }
        if ($b->countAllResults() > 0) {
            throw InventoryException::conflict('Warehouse group code "' . $row['grp_code'] . '" is already in use', ['field' => 'grp_code']);
        }
    }

    /**
     * What a page of groups needs beside its own columns, in three grouped queries — never one per
     * row:
     *
     *  - `warehouse_count`: how many warehouses name this group. It is the figure the delete guard
     *    acts on, so the screen can say why a delete is refused BEFORE the reader presses it.
     *  - `child_count`: how many groups name this one as their parent. Same reason — a group with
     *    children cannot be deleted either.
     *  - `created_by_name` / `updated_by_name`: the member's display name for the uuid in
     *    created_by / updated_by. Resolved from inv_company_members, which is this company's own
     *    membership table; it is NOT a copy of a Manage master and nothing is synchronised. Null
     *    when the actor is not a member (a service key, a CLI job), and the caller shows the raw
     *    identifier rather than inventing a person.
     */
    protected function decorateRows(int $cmpId, array $rows): array
    {
        if ($rows === []) {
            return $rows;
        }
        $ids = array_values(array_unique(array_map(static fn ($r) => (int) $r['warehouse_group_id'], $rows)));
        $db = \Config\Database::connect();

        $warehouses = [];
        $children = [];
        foreach (array_chunk($ids, 500) as $chunk) {
            foreach ($db->table('inv_warehouses')->select('warehouse_group_id, COUNT(*) AS n')
                ->where('cmp_id', $cmpId)->where('deleted_at', null)->whereIn('warehouse_group_id', $chunk)
                ->groupBy('warehouse_group_id')->get()->getResultArray() as $r) {
                $warehouses[(int) $r['warehouse_group_id']] = (int) $r['n'];
            }
            foreach ($db->table($this->table)->select('parent_grp_id, COUNT(*) AS n')
                ->where('cmp_id', $cmpId)->where('deleted_at', null)->whereIn('parent_grp_id', $chunk)
                ->groupBy('parent_grp_id')->get()->getResultArray() as $r) {
                $children[(int) $r['parent_grp_id']] = (int) $r['n'];
            }
        }

        $actors = [];
        foreach ($rows as $r) {
            foreach (['created_by', 'updated_by'] as $col) {
                $v = trim((string) ($r[$col] ?? ''));
                if ($v !== '') {
                    $actors[$v] = null;
                }
            }
        }
        if ($actors !== []) {
            foreach (array_chunk(array_keys($actors), 500) as $chunk) {
                foreach ($db->table('inv_company_members')->select('uuid, display_name')
                    ->where('cmp_id', $cmpId)->whereIn('uuid', $chunk)->get()->getResultArray() as $m) {
                    $name = trim((string) ($m['display_name'] ?? ''));
                    if ($name !== '') {
                        $actors[(string) $m['uuid']] = $name;
                    }
                }
            }
        }

        foreach ($rows as &$row) {
            $id = (int) $row['warehouse_group_id'];
            $row['warehouse_count'] = $warehouses[$id] ?? 0;
            $row['child_count'] = $children[$id] ?? 0;
            $row['created_by_name'] = $actors[trim((string) ($row['created_by'] ?? ''))] ?? null;
            $row['updated_by_name'] = $actors[trim((string) ($row['updated_by'] ?? ''))] ?? null;
        }

        return $rows;
    }
}
