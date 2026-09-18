<?php

namespace App\Controllers\Api\V1;

/**
 * Brands — Inventory's own master.
 *
 * Everything this controller serves is counted out of Inventory's own tables: the brand row, how
 * many items carry it, when it was created. It deliberately serves NO commercial figure. A brand's
 * sales, its revenue and its ranking by turnover belong to Sales / Books, and the Brands screen
 * reads those from that product's live API at the moment it draws them. Nothing of theirs is
 * copied, mirrored or scheduled into inv_brands — a second copy of another product's ledger is
 * exactly what the platform does not keep.
 */
class BrandsController extends MasterController
{
    protected string $table = 'inv_brands';
    protected string $pk = 'brand_id';
    protected string $nameColumn = 'brand_name';
    protected string $permissionBase = 'masters.brands';
    protected string $label = 'Brand';
    protected string $entityType = 'brand';
    protected array $columns = ['brand_alias', 'brand_code', 'description'];
    protected array $required = ['brand_name'];
    /** The screen promises "name, alias, code or description"; the API has to mean it. */
    protected array $searchColumns = ['brand_alias', 'brand_code', 'description'];
    protected array $deleteGuards = [['table' => 'inv_items', 'column' => 'brand_id', 'label' => 'item(s)']];
    /** Not a column of inv_brands — see applySort(). */
    protected array $extraSortColumns = ['item_count'];

    /** How long the two free-text handles may be, matching the column widths in migration 010. */
    private const MAX_LENGTHS = ['brand_alias' => 64, 'brand_code' => 64];

    /**
     * `GET /v1/brands/metrics` — the figures above the list.
     *
     * Counted by the database over the WHOLE company, not over the page on screen and not over the
     * current filters: the cards say what this company's brand master looks like, and a reader who
     * types a search or turns to page 3 must not watch them change underneath. Clicking a card
     * filters the list; it does not redefine the figure.
     *
     * `top_by_items` is Inventory's own leader board — the brand carrying the most items. It is NOT
     * a sales ranking and is not labelled as one. Revenue ranking needs Sales / Books, which the
     * browser asks for separately over that product's live API.
     */
    public function metrics()
    {
        $a = $this->authorize($this->permissionBase . '.read', true, false);
        if (isset($a['response'])) {
            return $a['response'];
        }

        return $this->respond(['data' => $this->computeMetrics((int) $a['ctx']['cmp_id'])]);
    }

    /**
     * The figures themselves, with no HTTP around them.
     *
     * Split out from the endpoint so the integration suite can drive it against
     * real PostgreSQL: FILTER clauses, a correlated NOT EXISTS and a GROUP BY
     * with a tie-break are exactly the things a stubbed database gets wrong.
     *
     * @return array<string, mixed>
     */
    private function computeMetrics(int $cmpId): array
    {
        $db = \Config\Database::connect();

        $now = new \DateTimeImmutable('now');
        $monthStart = $now->modify('first day of this month')->setTime(0, 0, 0);
        $prevStart = $monthStart->modify('-1 month');

        // One pass for the status split and both month counts: five figures, one index scan.
        $counts = $db->query(
            'SELECT COUNT(*) AS total,'
            . ' COUNT(*) FILTER (WHERE is_active = 1) AS active,'
            . ' COUNT(*) FILTER (WHERE is_active = 0) AS inactive,'
            . ' COUNT(*) FILTER (WHERE created_at >= ?) AS new_this_month,'
            . ' COUNT(*) FILTER (WHERE created_at >= ? AND created_at < ?) AS new_prev_month'
            . ' FROM inv_brands WHERE cmp_id = ? AND deleted_at IS NULL',
            [
                $monthStart->format('Y-m-d H:i:s'),
                $prevStart->format('Y-m-d H:i:s'),
                $monthStart->format('Y-m-d H:i:s'),
                $cmpId,
            ],
        )->getRowArray() ?: [];

        // A brand nothing is filed under is the one operational fact this screen can act on, so it
        // is counted here rather than inferred in the browser from a page of rows.
        $without = $db->query(
            'SELECT COUNT(*) AS n FROM inv_brands b'
            . ' WHERE b.cmp_id = ? AND b.deleted_at IS NULL'
            . ' AND NOT EXISTS (SELECT 1 FROM inv_items i WHERE i.brand_id = b.brand_id AND i.cmp_id = b.cmp_id AND i.deleted_at IS NULL)',
            [$cmpId],
        )->getRowArray() ?: [];

        $top = $db->query(
            'SELECT b.brand_id, b.brand_name, COUNT(i.item_id) AS item_count'
            . ' FROM inv_brands b'
            . ' JOIN inv_items i ON i.brand_id = b.brand_id AND i.cmp_id = b.cmp_id AND i.deleted_at IS NULL'
            . ' WHERE b.cmp_id = ? AND b.deleted_at IS NULL'
            . ' GROUP BY b.brand_id, b.brand_name'
            . ' ORDER BY item_count DESC, b.brand_name ASC'
            . ' LIMIT 1',
            [$cmpId],
        )->getRowArray();

        $total = (int) ($counts['total'] ?? 0);
        $withoutItems = (int) ($without['n'] ?? 0);

        return [
            'total'          => $total,
            'active'         => (int) ($counts['active'] ?? 0),
            'inactive'       => (int) ($counts['inactive'] ?? 0),
            'new_this_month' => (int) ($counts['new_this_month'] ?? 0),
            'new_prev_month' => (int) ($counts['new_prev_month'] ?? 0),
            'without_items'  => $withoutItems,
            'with_items'     => max(0, $total - $withoutItems),
            'top_by_items'   => $top ? [
                'brand_id'   => (int) $top['brand_id'],
                'brand_name' => (string) $top['brand_name'],
                'item_count' => (int) $top['item_count'],
            ] : null,
            'as_of'          => $now->format(DATE_ATOM),
        ];
    }

    /**
     * `GET /v1/brands/sales` — per-brand turnover for the selected FY, read live from Books.
     *
     * A relay, not a store. Inventory holds no sales figure for a brand and this endpoint creates
     * none: it asks Books for the company / FY / branch on screen and hands the answer straight
     * back. Nothing is written, nothing is cached across requests, and there is no table for it to
     * go stale in.
     *
     * It answers 200 whether or not Books could be reached, with `available` saying which. A brand
     * master that will not draw because an accounting service is down is a worse screen than a
     * brand master with no revenue column, and the caller needs the reason to word that difference.
     *
     * FY is required here and not on the master list: a brand exists outside any financial year,
     * its turnover does not.
     */
    public function sales()
    {
        $a = $this->authorize($this->permissionBase . '.read', true, true);
        if (isset($a['response'])) {
            return $a['response'];
        }
        $ctx = $a['ctx'];

        $result = (new \App\Services\BrandSalesService())->fetch(
            (int) $ctx['cmp_id'],
            (int) $ctx['fy_id'],
            (int) $ctx['bo_id'],
        );

        return $this->respond(['data' => $result]);
    }

    /**
     * Created-date range and item linkage.
     *
     * Both are filters the screen exposes, so both are answered where the rows are — a "brands with
     * no items" that paged through the whole master in the browser would be a different answer on
     * every page size.
     */
    protected function applyIndexFilters($builder): void
    {
        $from = trim((string) ($this->request->getGet('created_from') ?? ''));
        if ($from !== '' && preg_match('/^\d{4}-\d{2}-\d{2}$/', $from) === 1) {
            $builder->where('created_at >=', $from . ' 00:00:00');
        }
        $to = trim((string) ($this->request->getGet('created_to') ?? ''));
        if ($to !== '' && preg_match('/^\d{4}-\d{2}-\d{2}$/', $to) === 1) {
            $builder->where('created_at <=', $to . ' 23:59:59');
        }

        $hasItems = trim((string) ($this->request->getGet('has_items') ?? ''));
        if ($hasItems === '1' || $hasItems === '0') {
            $exists = 'EXISTS (SELECT 1 FROM inv_items i WHERE i.brand_id = inv_brands.brand_id'
                . ' AND i.cmp_id = inv_brands.cmp_id AND i.deleted_at IS NULL)';
            $builder->where($hasItems === '1' ? $exists : 'NOT ' . $exists, null, false);
        }
    }

    /**
     * `sort=item_count` — order by a figure the table does not store.
     *
     * The count has to exist in the SELECT before ORDER BY can name it, so the sorted page (and
     * only the sorted page) carries the correlated subquery. The name is the tie-break: without it
     * every brand with no items would come back in whatever order the planner felt like, and a
     * reader paging through them would see rows repeat and rows go missing.
     */
    protected function applySort($builder, string $sort, string $order): void
    {
        if ($sort === 'item_count') {
            $builder
                ->select('inv_brands.*')
                ->select(
                    '(SELECT COUNT(*) FROM inv_items i WHERE i.brand_id = inv_brands.brand_id'
                    . ' AND i.cmp_id = inv_brands.cmp_id AND i.deleted_at IS NULL) AS item_count',
                    false,
                )
                ->orderBy('item_count', $order)
                ->orderBy('brand_name', 'ASC');

            return;
        }
        parent::applySort($builder, $sort, $order);
    }

    /** item_count for the whole page with one grouped query (no per-row COUNT). */
    protected function decorateRows(int $cmpId, array $rows): array
    {
        $ids = array_values(array_unique(array_map(static fn ($r) => (int) $r['brand_id'], $rows)));
        $counts = [];
        foreach (array_chunk($ids, 500) as $chunk) {
            $res = \Config\Database::connect()->table('inv_items')->select('brand_id, COUNT(*) AS n')
                ->where('cmp_id', $cmpId)->where('deleted_at', null)->whereIn('brand_id', $chunk)
                ->groupBy('brand_id')->get()->getResultArray();
            foreach ($res as $r) {
                $counts[(int) $r['brand_id']] = (int) $r['n'];
            }
        }
        foreach ($rows as &$row) {
            $row['item_count'] = $counts[(int) $row['brand_id']] ?? 0;
        }

        return $rows;
    }

    protected function validateRow(int $cmpId, array $row, ?array $existing): void
    {
        parent::validateRow($cmpId, $row, $existing);
        $this->validateLengths($row);
        $this->validateCodeUnique($cmpId, $row, $existing);
    }

    /**
     * A 422 naming the field rather than a driver error naming the column.
     *
     * The columns are VARCHAR(64); PostgreSQL rejects an over-long value with a message about
     * character varying, which is true and useless to the person who pasted a paragraph into Alias.
     *
     * @param array<string, mixed> $row
     */
    private function validateLengths(array $row): void
    {
        foreach (self::MAX_LENGTHS as $col => $max) {
            $value = $row[$col] ?? null;
            if (is_string($value) && mb_strlen($value) > $max) {
                throw \App\Exceptions\InventoryException::validation(
                    ucfirst(str_replace(['brand_', '_'], ['', ' '], $col)) . ' must be ' . $max . ' characters or fewer',
                    ['field' => $col, 'max' => $max],
                );
            }
        }
    }

    /**
     * The code is a handle, so it is unique per company where one was given.
     *
     * Case-insensitive, like brand_name: "APPLE" and "apple" are the same handle to everyone except
     * a byte comparison. Enforced here for the message and by uq_inv_brands_cmp_code for the truth
     * — two requests racing past this check still meet the index.
     *
     * @param array<string, mixed> $row
     * @param array<string, mixed>|null $existing
     */
    private function validateCodeUnique(int $cmpId, array $row, ?array $existing): void
    {
        $code = $row['brand_code'] ?? null;
        if (!is_string($code) || $code === '') {
            return;
        }
        $b = \Config\Database::connect()->table($this->table)
            ->where('cmp_id', $cmpId)
            ->where('LOWER(brand_code)', mb_strtolower($code))
            ->where('deleted_at', null);
        if ($existing) {
            $b->where($this->pk . ' !=', (int) $existing[$this->pk]);
        }
        if ($b->countAllResults() > 0) {
            throw \App\Exceptions\InventoryException::conflict(
                'Brand code "' . $code . '" is already used by another brand',
                ['field' => 'brand_code'],
            );
        }
    }
}
