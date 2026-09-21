<?php

namespace App\Controllers\Api\V1;

use App\Services\GstUqcCatalog;

class UomController extends MasterController
{
    protected string $table = 'inv_uom';
    protected string $pk = 'unit_id';
    protected string $nameColumn = 'unit_name';
    protected string $permissionBase = 'masters.uom';
    protected string $label = 'Unit';
    protected string $entityType = 'uom';
    protected ?string $mirrorKind = 'uom';
    protected array $columns = ['unit_symbol', 'print_name', 'uqc_gst', 'decimal_places'];
    protected array $required = ['unit_name', 'unit_symbol'];
    protected array $searchColumns = ['unit_symbol', 'print_name', 'uqc_gst'];
    protected array $extraSortColumns = ['is_active', 'usage_count'];

    /**
     * Every way an item can name a unit.
     *
     * The first two were the whole guard until the list grew a "Used in" column.
     * A figure on screen saying twelve items use this unit, beside a Delete that
     * goes through because those twelve name it as their PURCHASE unit rather
     * than their base one, is not a cosmetic mismatch: the delete leaves twelve
     * items pointing at a row that is gone. The guard now covers what the column
     * counts, and the document lines that would be orphaned with it.
     */
    protected array $deleteGuards = [
        ['table' => 'inv_items', 'column' => 'unit_id', 'label' => 'item(s)'],
        ['table' => 'inv_item_uoms', 'column' => 'unit_id', 'label' => 'item unit line(s)'],
        ['table' => 'inv_items', 'column' => 'purchase_unit_id', 'label' => 'item(s) as their purchase unit'],
        ['table' => 'inv_items', 'column' => 'sales_unit_id', 'label' => 'item(s) as their sales unit'],
        ['table' => 'inv_document_lines', 'column' => 'unit_id', 'label' => 'document line(s)'],
    ];

    protected function buildRow(int $cmpId, array $body, ?array $existing): array
    {
        $row = parent::buildRow($cmpId, $body, $existing);
        $row['print_name'] = $row['print_name'] ?? $row['unit_symbol'] ?? null;
        $row['decimal_places'] = isset($row['decimal_places']) ? max(0, min(4, (int) $row['decimal_places'])) : 4;
        if (isset($row['uqc_gst']) && $row['uqc_gst'] !== null) {
            // Stored the way a return spells it, so "kgs" and "KGS" are one code
            // and the standard / custom split below cannot be defeated by case.
            $row['uqc_gst'] = strtoupper(trim((string) $row['uqc_gst'])) ?: null;
        }

        return $row;
    }

    /**
     * A symbol has to be unique too.
     *
     * Two units both printing "KG" on a document are indistinguishable to the
     * reader of that document, and the list's duplicate warning is only worth
     * showing if the server actually holds the line behind it.
     */
    protected function validateRow(int $cmpId, array $row, ?array $existing): void
    {
        parent::validateRow($cmpId, $row, $existing);
        if (!isset($row['unit_symbol']) || $row['unit_symbol'] === null || $row['unit_symbol'] === '') {
            return;
        }
        $b = \Config\Database::connect()->table($this->table)
            ->where('cmp_id', $cmpId)
            ->where('deleted_at', null)
            ->where('LOWER(unit_symbol)', mb_strtolower((string) $row['unit_symbol']));
        if ($existing) {
            $b->where($this->pk . ' !=', (int) $existing[$this->pk]);
        }
        if ($b->countAllResults() > 0) {
            throw \App\Exceptions\InventoryException::conflict('A unit with the symbol "' . $row['unit_symbol'] . '" already exists', ['field' => 'unit_symbol']);
        }
    }

    // ---- list filters ---------------------------------------------------------------------

    protected function applyIndexFilters($builder): void
    {
        $cmpId = $this->indexCmpId;

        $type = strtolower(trim((string) ($this->request->getGet('type') ?? '')));
        if ($type === 'standard') {
            $builder->where('UPPER(TRIM(COALESCE(uqc_gst, \'\'))) IN ' . $this->uqcCodeList(), null, false);
        } elseif ($type === 'custom') {
            $builder->where('UPPER(TRIM(COALESCE(uqc_gst, \'\'))) NOT IN ' . $this->uqcCodeList(), null, false);
        }

        $used = strtolower(trim((string) ($this->request->getGet('used') ?? '')));
        if ($cmpId > 0 && $used === 'used') {
            $builder->where('unit_id IN ' . $this->usedUnitIdsSql($cmpId), null, false);
        } elseif ($cmpId > 0 && $used === 'unused') {
            $builder->where('unit_id NOT IN ' . $this->usedUnitIdsSql($cmpId), null, false);
        }
    }

    protected function sortExpression(string $sort, int $cmpId): ?string
    {
        if ($sort !== 'usage_count') {
            return null;
        }

        return '(SELECT COUNT(DISTINCT t.item_id) FROM ' . $this->usageRowsSql($cmpId, 'inv_uom.unit_id') . ' t)';
    }

    // ---- derived columns ------------------------------------------------------------------

    /**
     * usage_count and uom_type for the whole page, in one grouped query.
     *
     * Read live from the item tables every time. Nothing is copied onto the unit
     * row: a cached count is a number that is right when it is written and wrong
     * by the next item someone saves, and this one is what the delete guard will
     * act on.
     */
    protected function decorateRows(int $cmpId, array $rows): array
    {
        if ($rows === []) {
            return $rows;
        }
        $ids = array_values(array_unique(array_map(static fn ($r) => (int) $r['unit_id'], $rows)));
        $counts = [];
        foreach (array_chunk($ids, 500) as $chunk) {
            $list = '(' . implode(',', array_map('intval', $chunk)) . ')';
            $sql = 'SELECT t.unit_id, COUNT(DISTINCT t.item_id) AS n FROM '
                . $this->usageRowsSql($cmpId, null, $list) . ' t GROUP BY t.unit_id';
            foreach (\Config\Database::connect()->query($sql)->getResultArray() as $r) {
                $counts[(int) $r['unit_id']] = (int) $r['n'];
            }
        }
        foreach ($rows as &$row) {
            $row['usage_count'] = $counts[(int) $row['unit_id']] ?? 0;
            $row['uom_type'] = GstUqcCatalog::isValid($row['uqc_gst'] ?? null) ? 'standard' : 'custom';
        }
        unset($row);

        return $rows;
    }

    // ---- extra endpoints ------------------------------------------------------------------

    /** GET /v1/uom/summary — the figures above the list, counted over the whole master. */
    public function summary()
    {
        $a = $this->authorize($this->permissionBase . '.read', true, false);
        if (isset($a['response'])) {
            return $a['response'];
        }
        $cmpId = (int) $a['ctx']['cmp_id'];
        $codes = $this->uqcCodeList();
        $db = \Config\Database::connect();

        $agg = $db->query(
            'SELECT COUNT(*) AS total,'
            . ' COUNT(*) FILTER (WHERE is_active = 1) AS active,'
            . ' COUNT(*) FILTER (WHERE is_active = 0) AS inactive,'
            . ' COUNT(*) FILTER (WHERE UPPER(TRIM(COALESCE(uqc_gst, \'\'))) IN ' . $codes . ') AS standard,'
            . ' COUNT(*) FILTER (WHERE COALESCE(TRIM(uqc_gst), \'\') = \'\') AS missing_uqc,'
            . ' COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL \'30 days\') AS created_last_30d,'
            . ' COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL \'60 days\' AND created_at < NOW() - INTERVAL \'30 days\') AS created_prev_30d'
            . ' FROM inv_uom WHERE cmp_id = ' . $cmpId . ' AND deleted_at IS NULL',
        )->getRowArray() ?: [];

        $used = (int) ($db->query(
            'SELECT COUNT(*) AS n FROM inv_uom WHERE cmp_id = ' . $cmpId . ' AND deleted_at IS NULL'
            . ' AND unit_id IN ' . $this->usedUnitIdsSql($cmpId),
        )->getRowArray()['n'] ?? 0);

        $total = (int) ($agg['total'] ?? 0);
        $standard = (int) ($agg['standard'] ?? 0);
        $active = (int) ($agg['active'] ?? 0);
        $inactive = (int) ($agg['inactive'] ?? 0);

        return $this->respond(['data' => [
            'total'             => $total,
            'active'            => $active,
            'inactive'          => $inactive,
            'standard'          => $standard,
            'custom'            => $total - $standard,
            'used_in_items'     => $used,
            'unused'            => $total - $used,
            'missing_uqc'       => (int) ($agg['missing_uqc'] ?? 0),
            'created_last_30d'  => (int) ($agg['created_last_30d'] ?? 0),
            'created_prev_30d'  => (int) ($agg['created_prev_30d'] ?? 0),
            // Percentages are served rather than divided on the client, so the
            // card and any later export of it round the same way.
            'active_rate'       => $total > 0 ? round($active * 100 / $total) : 0,
            'inactive_rate'     => $total > 0 ? round($inactive * 100 / $total) : 0,
            'usage_rate'        => $total > 0 ? round($used * 100 / $total) : 0,
        ]]);
    }

    /**
     * GET /v1/uom/{id}/usage — the items that name this unit, and how.
     *
     * Authorised on the ITEM permission, because item rows are what it returns.
     * A profile that may read units but not items still sees the count in the
     * list; it just cannot open the list of names behind it.
     */
    public function usage($id = null)
    {
        $a = $this->authorize('masters.items.read', true, false);
        if (isset($a['response'])) {
            return $a['response'];
        }
        $cmpId = (int) $a['ctx']['cmp_id'];
        $unitId = (int) $id;
        if (!$this->find($cmpId, $unitId)) {
            return $this->failStructured(404, 'not_found', 'Unit not found');
        }
        $p = $this->listParams(25, 200, 'item_name');
        $db = \Config\Database::connect();

        $rows = $db->query(
            'SELECT i.item_id, i.item_uuid, i.item_name, i.item_sku, i.is_active,'
            . ' g.grp_name, c.cat_name, u.unit_symbol AS base_unit_symbol,'
            . ' (i.unit_id = ' . $unitId . ') AS is_base,'
            . ' (i.purchase_unit_id = ' . $unitId . ') AS is_purchase,'
            . ' (i.sales_unit_id = ' . $unitId . ') AS is_sales,'
            . ' EXISTS (SELECT 1 FROM inv_item_uoms l WHERE l.cmp_id = i.cmp_id AND l.item_id = i.item_id AND l.unit_id = ' . $unitId . ' AND l.is_default = 0) AS is_alternate'
            . ' FROM inv_items i'
            . ' LEFT JOIN inv_item_groups g ON g.item_grp_id = i.item_grp_id'
            . ' LEFT JOIN inv_stock_categories c ON c.stock_cat_id = i.stock_cat_id'
            . ' LEFT JOIN inv_uom u ON u.unit_id = i.unit_id'
            . ' WHERE i.cmp_id = ' . $cmpId . ' AND i.deleted_at IS NULL'
            . ' AND i.item_id IN (SELECT t.item_id FROM ' . $this->usageRowsSql($cmpId, null, '(' . $unitId . ')') . ' t)'
            . ' ORDER BY i.item_name ASC'
            . ' LIMIT ' . (int) $p['limit'] . ' OFFSET ' . (int) $p['offset'],
        )->getResultArray();

        $total = (int) ($db->query(
            'SELECT COUNT(DISTINCT t.item_id) AS n FROM ' . $this->usageRowsSql($cmpId, null, '(' . $unitId . ')') . ' t',
        )->getRowArray()['n'] ?? 0);

        $out = array_map(static function (array $r): array {
            $roles = [];
            foreach (['is_base' => 'base', 'is_purchase' => 'purchase', 'is_sales' => 'sales', 'is_alternate' => 'alternate'] as $flag => $role) {
                if (!empty($r[$flag]) && $r[$flag] !== 'f') {
                    $roles[] = $role;
                }
            }

            return [
                'item_id'   => (int) $r['item_id'],
                'item_uuid' => $r['item_uuid'],
                'item_name' => $r['item_name'],
                'item_sku'  => $r['item_sku'],
                'grp_name'  => $r['grp_name'],
                'cat_name'  => $r['cat_name'],
                'is_active' => (int) $r['is_active'],
                'roles'     => $roles,
            ];
        }, $rows);

        return $this->respondList($out, $total, $p['limit'], $p['offset']);
    }

    /** GET /v1/uom/uqc-codes — the GST unit quantity codes the unit form offers. */
    public function uqcCodes()
    {
        $a = $this->authorize($this->permissionBase . '.read', true, false);
        if (isset($a['response'])) {
            return $a['response'];
        }

        return $this->respond(['data' => GstUqcCatalog::options()]);
    }

    // ---- SQL fragments --------------------------------------------------------------------

    /** `('BAG','BAL',…)` — literals from the catalogue, never from request input. */
    private function uqcCodeList(): string
    {
        return '(' . implode(',', array_map(static fn (string $c): string => "'" . $c . "'", GstUqcCatalog::codes())) . ')';
    }

    /**
     * Every (unit_id, item_id) pair that makes a unit "in use", as a derived table.
     *
     * `$unitColumn` correlates it to an outer row (the sort expression);
     * `$idList` restricts it to a page of unit ids. Both are built here from
     * integers, so neither reaches SQL from the request.
     */
    private function usageRowsSql(int $cmpId, ?string $unitColumn = null, ?string $idList = null): string
    {
        $where = static function (string $col) use ($cmpId, $unitColumn, $idList): string {
            $clauses = ['cmp_id = ' . $cmpId, $col . ' IS NOT NULL'];
            if ($unitColumn !== null) {
                $clauses[] = $col . ' = ' . $unitColumn;
            }
            if ($idList !== null) {
                $clauses[] = $col . ' IN ' . $idList;
            }

            return implode(' AND ', $clauses);
        };

        return '('
            . 'SELECT unit_id AS unit_id, item_id FROM inv_items WHERE deleted_at IS NULL AND ' . $where('unit_id')
            . ' UNION SELECT purchase_unit_id AS unit_id, item_id FROM inv_items WHERE deleted_at IS NULL AND ' . $where('purchase_unit_id')
            . ' UNION SELECT sales_unit_id AS unit_id, item_id FROM inv_items WHERE deleted_at IS NULL AND ' . $where('sales_unit_id')
            . ' UNION SELECT unit_id AS unit_id, item_id FROM inv_item_uoms WHERE ' . $where('unit_id')
            . ')';
    }

    /** The unit ids any item names, for the used / unused filter and the summary. */
    private function usedUnitIdsSql(int $cmpId): string
    {
        return '(SELECT t.unit_id FROM ' . $this->usageRowsSql($cmpId) . ' t)';
    }
}
