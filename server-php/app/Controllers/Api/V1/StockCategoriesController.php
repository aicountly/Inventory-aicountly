<?php

namespace App\Controllers\Api\V1;

use App\Services\AuditService;

class StockCategoriesController extends MasterController
{
    protected string $table = 'inv_stock_categories';
    protected string $pk = 'stock_cat_id';
    protected string $nameColumn = 'cat_name';
    protected string $permissionBase = 'masters.stock_categories';
    protected string $label = 'Stock Category';
    protected string $entityType = 'stock_category';
    protected array $columns = ['cat_alias'];
    protected array $required = ['cat_name'];
    protected array $searchColumns = ['cat_alias'];
    protected array $deleteGuards = [['table' => 'inv_items', 'column' => 'stock_cat_id', 'label' => 'item(s)']];
    /** Not a column of inv_stock_categories — see applySort(). */
    protected array $extraSortColumns = ['item_count'];

    /**
     * How many items each category on this page carries, in ONE grouped query.
     *
     * The screen shows the figure in every row and the delete guard refuses on
     * the same number, so it is read from the same place both times — a count
     * per row would be fifty queries for a page of fifty, and a cached one
     * would eventually disagree with the guard that blocks the delete.
     */
    protected function decorateRows(int $cmpId, array $rows): array
    {
        $ids = array_values(array_unique(array_map(static fn ($r) => (int) $r['stock_cat_id'], $rows)));
        $counts = [];
        foreach (array_chunk($ids, 500) as $chunk) {
            $res = \Config\Database::connect()->table('inv_items')->select('stock_cat_id, COUNT(*) AS n')
                ->where('cmp_id', $cmpId)->where('deleted_at', null)->whereIn('stock_cat_id', $chunk)->groupBy('stock_cat_id')->get()->getResultArray();
            foreach ($res as $r) {
                $counts[(int) $r['stock_cat_id']] = (int) $r['n'];
            }
        }
        foreach ($rows as &$row) {
            $row['item_count'] = $counts[(int) $row['stock_cat_id']] ?? 0;
        }

        return $rows;
    }

    /**
     * `?sort=item_count` — "Most items" / "Least items" on the list toolbar.
     *
     * It orders by the same count `decorateRows()` prints, so the ranking is
     * over every category in the company rather than over the page that
     * happened to be fetched — "most items" that only ranks the fifty rows
     * already fetched is a lie the footer contradicts. Same shape as
     * BrandsController: the subquery is selected under the name the sort uses,
     * and the tenant comes from the row rather than from interpolated input.
     */
    protected function applySort($builder, string $sort, string $order): void
    {
        if ($sort === 'item_count') {
            $builder
                ->select('inv_stock_categories.*')
                ->select(
                    '(SELECT COUNT(*) FROM inv_items i WHERE i.stock_cat_id = inv_stock_categories.stock_cat_id'
                    . ' AND i.cmp_id = inv_stock_categories.cmp_id AND i.deleted_at IS NULL) AS item_count',
                    false,
                )
                ->orderBy('item_count', $order)
                ->orderBy('cat_name', 'ASC');

            return;
        }
        parent::applySort($builder, $sort, $order);
    }

    /**
     * GET /v1/stock-categories/summary — the figures above the list.
     *
     * Aggregates, not a page: the cards count every category in the company,
     * which is exactly what a client cannot derive from a paged list without
     * fetching all of it. Four cheap queries, no per-row work.
     */
    public function summary()
    {
        $a = $this->authorize($this->permissionBase . '.read', true, false);
        if (isset($a['response'])) {
            return $a['response'];
        }

        return $this->respond(['data' => self::summarise(\Config\Database::connect(), (int) $a['ctx']['cmp_id'])]);
    }

    /**
     * The four figures, as SQL.
     *
     * Public and static for the same reason `DocumentsController::summarise` is:
     * the SQL IS the behaviour here — a join that counts soft-deleted items, a
     * SUM over an empty table returning NULL, a `most_used` that ties — and the
     * only way to hold that is to run it against a real PostgreSQL
     * (StockCategoryUsageTest), not through an authorised HTTP round trip.
     *
     * @return array<string, mixed>
     */
    public static function summarise(\CodeIgniter\Database\BaseConnection $db, int $cmpId, ?string $monthStart = null): array
    {
        $table = 'inv_stock_categories';
        $monthStart ??= date('Y-m-01 00:00:00');

        $counts = $db->table($table)
            ->select('COUNT(*) AS total, COALESCE(SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END), 0) AS active', false)
            ->where('cmp_id', $cmpId)->where('deleted_at', null)
            ->get()->getRowArray() ?: [];
        $total = (int) ($counts['total'] ?? 0);
        $active = (int) ($counts['active'] ?? 0);

        $createdThisMonth = $db->table($table)
            ->where('cmp_id', $cmpId)->where('deleted_at', null)
            ->where('created_at >=', $monthStart)
            ->countAllResults();

        // The category most items point at. Null when nothing is categorised yet
        // — the card says so rather than naming an arbitrary category. An INNER
        // join, so a category with no items can never win the tie-break and be
        // announced as the most used one.
        $mostUsed = $db->table($table . ' c')
            ->select('c.stock_cat_id, c.cat_name, COUNT(i.item_id) AS item_count', false)
            ->join('inv_items i', 'i.stock_cat_id = c.stock_cat_id AND i.cmp_id = c.cmp_id AND i.deleted_at IS NULL', 'inner')
            ->where('c.cmp_id', $cmpId)->where('c.deleted_at', null)
            ->groupBy('c.stock_cat_id, c.cat_name')
            ->orderBy('item_count', 'DESC')->orderBy('c.cat_name', 'ASC')
            ->limit(1)->get()->getRowArray();

        $uncategorised = $db->table('inv_items')
            ->where('cmp_id', $cmpId)->where('deleted_at', null)
            ->groupStart()->where('stock_cat_id', null)->orWhere('stock_cat_id', 0)->groupEnd()
            ->countAllResults();

        return [
            'total'              => $total,
            'active'             => $active,
            'inactive'           => max(0, $total - $active),
            'created_this_month' => $createdThisMonth,
            'most_used'          => $mostUsed ? [
                'stock_cat_id' => (int) $mostUsed['stock_cat_id'],
                'cat_name'     => (string) $mostUsed['cat_name'],
                'item_count'   => (int) $mostUsed['item_count'],
            ] : null,
            'uncategorised_items' => $uncategorised,
        ];
    }

    /**
     * POST /v1/stock-categories/bulk-status — activate or deactivate a selection.
     *
     * One statement for the whole selection, inside the transaction, and one
     * audit entry per category with its own before / after: a bulk action that
     * left a single "20 categories changed" line would be unusable as an audit
     * trail for the one that mattered.
     */
    public function bulkStatus()
    {
        $a = $this->authorize($this->permissionBase . '.write', true, false);
        if (isset($a['response'])) {
            return $a['response'];
        }
        $cmpId = (int) $a['ctx']['cmp_id'];
        $body = $this->request->getJSON(true) ?? [];

        $ids = array_values(array_unique(array_filter(array_map('intval', (array) ($body['ids'] ?? [])), static fn ($id) => $id > 0)));
        if ($ids === []) {
            return $this->failStructured(422, 'validation_failed', 'Select at least one stock category', ['field' => 'ids']);
        }
        if (count($ids) > 500) {
            return $this->failStructured(422, 'validation_failed', 'At most 500 stock categories can be changed at once', ['field' => 'ids']);
        }
        if (!array_key_exists('is_active', $body)) {
            return $this->failStructured(422, 'validation_failed', 'is_active is required', ['field' => 'is_active']);
        }
        $isActive = !empty($body['is_active']) ? 1 : 0;

        $db = \Config\Database::connect();
        $existing = $db->table($this->table)->where('cmp_id', $cmpId)->where('deleted_at', null)
            ->whereIn($this->pk, $ids)->get()->getResultArray();
        if ($existing === []) {
            return $this->failStructured(404, 'not_found', 'No matching ' . strtolower($this->label) . ' found');
        }

        try {
            $changed = $this->applyBulkStatus($db, $cmpId, $existing, $isActive, $a['session']['uuid']);
        } catch (\Throwable $e) {
            $db->transRollback();

            return $this->failFromException($e);
        }

        return $this->respond(['data' => ['updated' => count($changed), 'is_active' => $isActive]]);
    }

    /**
     * Flip the status of the rows that are actually moving, and audit each one.
     *
     * Protected rather than inlined above so a test can drive the write without
     * an authorised HTTP round trip (StockCategoryBulkStatusTest). Two
     * properties live here and both are easy to lose in a refactor: a row that
     * is ALREADY in the requested state is not touched — otherwise every list
     * would report it as edited today — and each row that does move writes its
     * own audit entry with its own before / after, because a single
     * "20 categories changed" line is useless for the one that mattered.
     *
     * @param  list<array<string, mixed>> $existing rows already read for this company
     * @return list<array<string, mixed>> the rows that changed
     */
    protected function applyBulkStatus(\CodeIgniter\Database\BaseConnection $db, int $cmpId, array $existing, int $isActive, ?string $actor): array
    {
        $changing = array_values(array_filter($existing, static fn ($r) => (int) $r['is_active'] !== $isActive));
        if ($changing === []) {
            return [];
        }

        $pk = $this->pk;
        $patch = ['is_active' => $isActive, 'updated_at' => date('Y-m-d H:i:s'), 'updated_by' => $actor];
        $changingIds = array_map(static fn ($r) => (int) $r[$pk], $changing);

        $db->transStart();
        $db->table($this->table)->where('cmp_id', $cmpId)->whereIn($pk, $changingIds)->update($patch);
        foreach ($changingIds as $id) {
            $this->publishMirror($cmpId, $id);
        }
        $db->transComplete();
        if ($db->transStatus() === false) {
            throw new \RuntimeException('Could not update ' . $this->label . ': transaction failed', 500);
        }

        $audit = new AuditService();
        $action = $this->entityType . ($isActive === 1 ? '.activate' : '.deactivate');
        foreach ($changing as $row) {
            $audit->log($cmpId, $this->entityType, (int) $row[$pk], $action, $actor, [], $row, array_merge($row, $patch));
        }

        return $changing;
    }
}
