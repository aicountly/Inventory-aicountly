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
 *
 * Beyond CRUD this controller answers two questions the Batches workspace asks
 * on every load:
 *
 *  - `GET /v1/batches/summary` — the figures above the table, counted by the
 *    database over the WHOLE filtered set. The screen never adds up the page it
 *    happens to be showing and calls the result a company total.
 *  - `POST /v1/batches/bulk-update` — one status change over a selection, in a
 *    single transaction with one audit entry per batch, rather than a browser
 *    loop firing one PUT per row.
 *
 * Expiry health (active / expiring / expired / inactive) is derived here from
 * the stored expiry date and status, never stored: it changes with the calendar,
 * so a persisted copy is wrong the next morning. The four states are mutually
 * exclusive and exhaust the set, so the summary's four counts always sum to the
 * total.
 */
class BatchesController extends BaseController
{
    private const PERM = 'masters.batches';
    public const STATUSES = ['active', 'quarantine', 'recalled', 'expired', 'closed'];
    /** Statuses that take a batch out of circulation without the calendar's help. */
    private const DORMANT_STATUSES = ['quarantine', 'recalled', 'closed'];
    public const HEALTH_STATES = ['active', 'expiring', 'expired', 'inactive'];
    private const COLUMNS = ['batch_no', 'lot_no', 'mfg_date', 'expiry_date', 'warranty_months', 'status'];
    private const SORT = ['batch_no' => 'b.batch_no', 'batch_id' => 'b.batch_id', 'expiry_date' => 'b.expiry_date', 'mfg_date' => 'b.mfg_date', 'status' => 'b.status', 'item_name' => 'i.item_name', 'lot_no' => 'b.lot_no', 'created_at' => 'b.created_at', 'updated_at' => 'b.updated_at'];
    /** Sorts that need the on-hand aggregate joined in. */
    private const STOCK_SORT = ['on_hand' => 'sb_on_hand'];
    private const SELECT = 'b.batch_id, b.batch_uuid, b.item_id, b.batch_no, b.lot_no, b.mfg_date, b.expiry_date, b.warranty_months, b.status, b.attributes_json, b.created_by, b.created_at, b.updated_by, b.updated_at, i.item_name, i.item_sku, i.unit_id, i.item_grp_id, i.stock_cat_id, i.brand_id, u.unit_symbol, u.decimal_places, g.grp_name AS item_group_name, c.cat_name AS stock_category_name';
    /** Same ceiling as the items bulk edit: a page of the table, not the whole master. */
    private const BULK_MAX_ROWS = 500;
    /** Default warning window. `near_expiry_days` is the dashboard's name for it. */
    private const DEFAULT_NEAR_EXPIRY_DAYS = 30;
    /** The baseline the "Total batches" delta compares against. */
    private const COMPARISON_DAYS = 30;

    /** Set by filteredQuery() when the on-hand aggregate was joined in. */
    private bool $stockJoined = false;

    public function index()
    {
        $a = $this->authorize(self::PERM . '.read', true, false);
        if (isset($a['response'])) {
            return $a['response'];
        }
        $cmpId = (int) $a['ctx']['cmp_id'];
        $p = $this->listParams(100, 1000, 'batch_no');
        $sortKey = $p['sort'];
        $needsStock = isset(self::STOCK_SORT[$sortKey]);

        try {
            $b = $this->filteredQuery($cmpId, $needsStock);
        } catch (\Throwable $e) {
            return $this->failFromException($e);
        }

        $total = (clone $b)->countAllResults(false);
        $orderBy = self::STOCK_SORT[$sortKey] ?? (self::SORT[$sortKey] ?? 'b.batch_no');
        $select = self::SELECT . ($this->stockJoined ? ', COALESCE(sb.on_hand, 0) AS sb_on_hand' : '');
        $rows = $b->select($select, false)->orderBy($orderBy, $p['order'], false)->limit($p['limit'], $p['offset'])->get()->getResultArray();
        $rows = array_map([$this, 'present'], $rows);
        if ((int) ($this->request->getGet('with_stock') ?? 0) === 1 && $rows !== []) {
            $warehouseId = $this->stockWarehouseId();
            $this->attachStock($cmpId, $rows, $warehouseId);
            $this->attachWarehouses($cmpId, $rows, $warehouseId);
        }

        return $this->respondList($rows, $total, $p['limit'], $p['offset']);
    }

    /**
     * The figures above the table, for the filters the table is showing.
     *
     * Paging parameters are ignored on purpose: these speak for the whole
     * filtered set, and a reader turning to page four must not watch them move.
     */
    public function summary()
    {
        $a = $this->authorize(self::PERM . '.read', true, false);
        if (isset($a['response'])) {
            return $a['response'];
        }
        $cmpId = (int) $a['ctx']['cmp_id'];

        try {
            $b = $this->filteredQuery($cmpId, true);
        } catch (\Throwable $e) {
            return $this->failFromException($e);
        }

        $today = date('Y-m-d');
        $days  = $this->nearExpiryDays();
        $warn  = date('Y-m-d', strtotime($today . ' +' . $days . ' days'));
        $cut   = date('Y-m-d H:i:s', strtotime($today . ' -' . self::COMPARISON_DAYS . ' days'));
        $bucket = static fn (int $from, int $to): string => "b.expiry_date >= (DATE '" . date('Y-m-d', strtotime($today . ' +' . $from . ' days')) . "') AND b.expiry_date <= (DATE '" . date('Y-m-d', strtotime($today . ' +' . $to . ' days')) . "')";

        $expired  = $this->healthCondition('expired', $today, $warn);
        $inactive = $this->healthCondition('inactive', $today, $warn);
        $expiring = $this->healthCondition('expiring', $today, $warn);
        $active   = $this->healthCondition('active', $today, $warn);
        $count    = static fn (string $cond, string $alias): string => 'SUM(CASE WHEN ' . $cond . ' THEN 1 ELSE 0 END) AS ' . $alias;

        $agg = (clone $b)->select(implode(', ', [
            'COUNT(*) AS total',
            $count($active, 'active'),
            $count($expiring, 'expiring_soon'),
            $count($expired, 'expired'),
            $count($inactive, 'inactive'),
            'COALESCE(SUM(COALESCE(sb.on_hand, 0)), 0) AS total_on_hand',
            $count('COALESCE(sb.on_hand, 0) > 0', 'with_stock'),
            $count('COALESCE(sb.on_hand, 0) = 0', 'zero_stock'),
            $count("b.created_at IS NULL OR b.created_at < (TIMESTAMP '" . $cut . "')", 'previous_total'),
            $count('b.expiry_date IS NULL', 'no_expiry'),
            $count("b.expiry_date IS NOT NULL AND b.expiry_date < (DATE '" . $today . "')", 'bucket_expired'),
            $count($bucket(0, 30), 'bucket_within_30'),
            $count($bucket(31, 90), 'bucket_31_90'),
            $count($bucket(91, 180), 'bucket_91_180'),
            $count("b.expiry_date > (DATE '" . date('Y-m-d', strtotime($today . ' +180 days')) . "')", 'bucket_beyond_180'),
        ]), false)->get()->getRowArray() ?: [];

        $byStatus = [];
        foreach (self::STATUSES as $s) {
            $byStatus[$s] = 0;
        }
        foreach ((clone $b)->select('b.status, COUNT(*) AS n', false)->groupBy('b.status')->get()->getResultArray() as $r) {
            $byStatus[(string) $r['status']] = (int) $r['n'];
        }

        $int = static fn (string $k): int => (int) ($agg[$k] ?? 0);

        return $this->respond(['data' => [
            'total'            => $int('total'),
            'active'           => $int('active'),
            'expiring_soon'    => $int('expiring_soon'),
            'expired'          => $int('expired'),
            'inactive'         => $int('inactive'),
            'total_on_hand'    => round((float) ($agg['total_on_hand'] ?? 0), 4),
            'with_stock'       => $int('with_stock'),
            'zero_stock'       => $int('zero_stock'),
            // How many of these batches already existed a month ago. The master
            // only grows, so the difference is what was registered since — an
            // honest delta, unlike a "vs last period" the table cannot measure.
            'previous_total'   => $int('previous_total'),
            'comparison_days'  => self::COMPARISON_DAYS,
            'near_expiry_days' => $days,
            'by_status'        => $byStatus,
            'expiry_buckets'   => [
                'expired'     => $int('bucket_expired'),
                'within_30'   => $int('bucket_within_30'),
                'days_31_90'  => $int('bucket_31_90'),
                'days_91_180' => $int('bucket_91_180'),
                'beyond_180'  => $int('bucket_beyond_180'),
                'no_expiry'   => $int('no_expiry'),
            ],
        ]]);
    }

    public function show($id = null)
    {
        $a = $this->authorize(self::PERM . '.read', true, false);
        if (isset($a['response'])) {
            return $a['response'];
        }
        $cmpId = (int) $a['ctx']['cmp_id'];
        $row = $this->baseQuery($cmpId)->where('b.batch_id', (int) $id)->select(self::SELECT, false)->get()->getRowArray();
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
            $out = $this->present($this->baseQuery($cmpId)->where('b.batch_id', $id)->select(self::SELECT, false)->get()->getRowArray());

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
            $out = $this->present($this->baseQuery($cmpId)->where('b.batch_id', (int) $id)->select(self::SELECT, false)->get()->getRowArray());

            return $this->respond(['data' => $out]);
        } catch (\Throwable $e) {
            return $this->failFromException($e);
        }
    }

    /**
     * One status across a selection — the table's bulk action.
     *
     * A single transaction so a half-applied change cannot survive a failure,
     * and one audit entry per batch after the commit so the trail names every
     * row that moved rather than "a bulk operation happened".
     */
    public function bulkUpdate()
    {
        $a = $this->authorize(self::PERM . '.write', true, false);
        if (isset($a['response'])) {
            return $a['response'];
        }
        $cmpId = (int) $a['ctx']['cmp_id'];
        $body = $this->request->getJSON(true) ?? [];

        $ids = [];
        foreach ((array) ($body['batch_ids'] ?? []) as $raw) {
            $n = (int) $raw;
            if ($n > 0) {
                $ids[$n] = $n;
            }
        }
        $ids = array_values($ids);
        if ($ids === []) {
            return $this->failStructured(400, 'validation_failed', 'Select at least one batch', ['field' => 'batch_ids']);
        }
        if (count($ids) > self::BULK_MAX_ROWS) {
            return $this->failStructured(400, 'validation_failed', sprintf('Bulk update is limited to %d batches per request; send the selection in pages.', self::BULK_MAX_ROWS), ['limit' => self::BULK_MAX_ROWS, 'received' => count($ids)]);
        }

        $status = strtolower(trim((string) ($body['status'] ?? '')));
        if (!in_array($status, self::STATUSES, true)) {
            return $this->failStructured(422, 'validation_failed', 'status must be one of ' . implode(', ', self::STATUSES), ['field' => 'status']);
        }

        $db = \Config\Database::connect();
        $existingRows = [];
        foreach (array_chunk($ids, 500) as $chunk) {
            foreach ($db->table('inv_batches')->where('cmp_id', $cmpId)->whereIn('batch_id', $chunk)->get()->getResultArray() as $r) {
                $existingRows[(int) $r['batch_id']] = $r;
            }
        }
        $missing = array_values(array_diff($ids, array_keys($existingRows)));
        if ($missing !== []) {
            return $this->failStructured(404, 'not_found', 'Some batches no longer exist', ['batch_ids' => $missing]);
        }

        // A row already on the target status is not an error and not a write:
        // re-stamping it would put a no-op in the audit trail for every reader
        // who selected the whole page.
        $changing = array_values(array_filter($ids, static fn (int $id): bool => (string) $existingRows[$id]['status'] !== $status));
        if ($changing === []) {
            return $this->respond(['data' => ['updated' => 0, 'unchanged' => count($ids), 'status' => $status, 'batch_ids' => []]]);
        }

        $now = date('Y-m-d H:i:s');
        $actor = $a['session']['uuid'];
        try {
            $db->transBegin();
            foreach (array_chunk($changing, 500) as $chunk) {
                $db->table('inv_batches')->where('cmp_id', $cmpId)->whereIn('batch_id', $chunk)
                    ->update(['status' => $status, 'updated_by' => $actor, 'updated_at' => $now]);
            }
            if ($db->transStatus() === false) {
                throw InventoryException::validation('Bulk update could not be written');
            }
            $db->transCommit();
        } catch (\Throwable $e) {
            $db->transRollback();

            return $this->failFromException($e);
        }

        $audit = new AuditService();
        foreach ($changing as $id) {
            $audit->log($cmpId, 'batch', $id, 'batch.bulk_update', $actor, ['fields' => ['status']], $existingRows[$id], ['status' => $status]);
        }

        return $this->respond(['data' => [
            'updated'   => count($changing),
            'unchanged' => count($ids) - count($changing),
            'status'    => $status,
            'batch_ids' => $changing,
        ]]);
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
            ->join('inv_item_groups g', 'g.item_grp_id = i.item_grp_id', 'left')
            ->join('inv_stock_categories c', 'c.stock_cat_id = i.stock_cat_id', 'left')
            ->where('b.cmp_id', $cmpId);
    }

    /**
     * The list query with every read filter applied.
     *
     * `$joinStock` brings in a grouped on-hand aggregate, one row per batch, so
     * the table can sort and filter on quantity without a correlated subquery
     * per row. It is opt-in because the batch pickers inside the document
     * editors ask this endpoint for a dropdown and should not pay for the scan.
     */
    private function filteredQuery(int $cmpId, bool $joinStock = false)
    {
        $get = fn (string $k): string => trim((string) ($this->request->getGet($k) ?? ''));
        $b = $this->baseQuery($cmpId);

        $stockWarehouse = $this->stockWarehouseId();
        $inWarehouse = (int) $this->request->getGet('in_warehouse_id') ?: null;
        $stockFilter = strtolower($get('stock'));
        $needsStock = $joinStock || $inWarehouse !== null || in_array($stockFilter, ['with', 'zero'], true);

        $this->stockJoined = $needsStock;
        if ($needsStock) {
            // The aggregate is scoped to the warehouse being looked at, so
            // "on hand" on a warehouse-filtered screen is the quantity in that
            // warehouse rather than the company-wide figure.
            $scope = $inWarehouse ?? $stockWarehouse;
            $where = 'cmp_id = ' . $cmpId . ($scope !== null ? ' AND warehouse_id = ' . $scope : '');
            $b->join(
                '(SELECT batch_id, SUM(on_hand_qty) AS on_hand, COUNT(*) AS rows_present FROM inv_stock_balances WHERE ' . $where . ' AND batch_id IS NOT NULL GROUP BY batch_id) sb',
                'sb.batch_id = b.batch_id',
                'left',
                false,
            );
        }

        if ($itemId = (int) $this->request->getGet('item_id')) {
            $b->where('b.item_id', $itemId);
        }
        foreach (['item_grp_id' => 'i.item_grp_id', 'stock_cat_id' => 'i.stock_cat_id', 'brand_id' => 'i.brand_id'] as $param => $column) {
            if ($v = (int) $this->request->getGet($param)) {
                $b->where($column, $v);
            }
        }
        if ($inWarehouse !== null) {
            // "Stock recorded in this warehouse" — a balance row exists, even at
            // zero. A batch that emptied out of a warehouse is still part of
            // that warehouse's history and must stay findable there.
            $b->where('sb.rows_present IS NOT NULL', null, false);
        }
        if ($stockFilter === 'with') {
            $b->where('COALESCE(sb.on_hand, 0) > 0', null, false);
        } elseif ($stockFilter === 'zero') {
            $b->where('COALESCE(sb.on_hand, 0) = 0', null, false);
        }

        $status = strtolower($get('status'));
        if ($status !== '') {
            $wanted = array_values(array_intersect(array_filter(array_map('trim', explode(',', $status))), self::STATUSES));
            if ($wanted === []) {
                throw InventoryException::validation('status must be one of ' . implode(', ', self::STATUSES), ['field' => 'status']);
            }
            $b->whereIn('b.status', $wanted);
        }

        $health = strtolower($get('health'));
        if ($health !== '') {
            $today = date('Y-m-d');
            $warn = date('Y-m-d', strtotime($today . ' +' . $this->nearExpiryDays() . ' days'));
            $wanted = array_values(array_intersect(array_filter(array_map('trim', explode(',', $health))), self::HEALTH_STATES));
            if ($wanted === []) {
                throw InventoryException::validation('health must be one of ' . implode(', ', self::HEALTH_STATES), ['field' => 'health']);
            }
            $parts = array_map(fn (string $h): string => $this->healthCondition($h, $today, $warn), $wanted);
            $b->where('(' . implode(' OR ', $parts) . ')', null, false);
        }

        // `expiring_before` predates the range filters and stays: the document
        // editors and saved links still send it.
        foreach ([
            ['expiring_before', 'b.expiry_date <='],
            ['expiry_from', 'b.expiry_date >='],
            ['expiry_to', 'b.expiry_date <='],
            ['mfg_from', 'b.mfg_date >='],
            ['mfg_to', 'b.mfg_date <='],
        ] as [$param, $op]) {
            $v = $get($param);
            if ($v === '') {
                continue;
            }
            if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $v)) {
                throw InventoryException::validation($param . ' must be YYYY-MM-DD', ['field' => $param]);
            }
            $column = str_starts_with($param, 'mfg') ? 'b.mfg_date' : 'b.expiry_date';
            $b->where($column . ' IS NOT NULL', null, false)->where($op, $v);
        }

        $hasExpiry = $get('has_expiry');
        if ($hasExpiry === '1') {
            $b->where('b.expiry_date IS NOT NULL', null, false);
        } elseif ($hasExpiry === '0') {
            $b->where('b.expiry_date IS NULL', null, false);
        }

        if ($lot = $get('lot_no')) {
            $b->like('LOWER(b.lot_no)', mb_strtolower($lot), 'both', null, true);
        }

        $q = $get('q');
        if ($q !== '') {
            $needle = mb_strtolower($q);
            $b->groupStart()
                ->like('LOWER(b.batch_no)', $needle, 'both', null, true)
                ->orLike('LOWER(b.lot_no)', $needle, 'both', null, true)
                ->orLike('LOWER(i.item_name)', $needle, 'both', null, true)
                ->orLike('LOWER(i.item_sku)', $needle, 'both', null, true)
                ->groupEnd();
        }

        return $b;
    }

    /** `warehouse_id` scopes the stock figures; it has never filtered the rows. */
    private function stockWarehouseId(): ?int
    {
        $id = (int) ($this->request->getGet('warehouse_id') ?? 0);

        return $id > 0 ? $id : null;
    }

    private function nearExpiryDays(): int
    {
        $days = (int) ($this->request->getGet('near_expiry_days') ?? self::DEFAULT_NEAR_EXPIRY_DAYS);

        return max(1, min(3650, $days ?: self::DEFAULT_NEAR_EXPIRY_DAYS));
    }

    /**
     * One derived health state as a SQL condition.
     *
     * The four are written so that they cannot overlap: expired wins over
     * everything, then a dormant status, then the warning window, then health.
     * Both dates are produced here from the server clock (the window is clamped
     * to an integer first), so neither reaches SQL from the request.
     */
    private function healthCondition(string $health, string $today, string $warn): string
    {
        $dormant = "b.status IN ('" . implode("','", self::DORMANT_STATUSES) . "')";
        $expired = "((b.expiry_date IS NOT NULL AND b.expiry_date < (DATE '" . $today . "')) OR b.status = 'expired')";

        return match ($health) {
            'expired'  => $expired,
            'inactive' => 'NOT ' . $expired . ' AND ' . $dormant,
            'expiring' => 'NOT ' . $expired . ' AND NOT ' . $dormant . " AND b.expiry_date IS NOT NULL AND b.expiry_date <= (DATE '" . $warn . "')",
            default    => 'NOT ' . $expired . ' AND NOT ' . $dormant . " AND (b.expiry_date IS NULL OR b.expiry_date > (DATE '" . $warn . "'))",
        };
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
        unset($row['attributes_json'], $row['sb_on_hand']);
        if (isset($row['warranty_months'])) {
            $row['warranty_months'] = (int) $row['warranty_months'];
        }
        if (isset($row['decimal_places'])) {
            $row['decimal_places'] = (int) $row['decimal_places'];
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

    /**
     * Where each batch on the page is sitting — one grouped query for the page,
     * not one per row.
     *
     * The table shows the warehouse holding most of the batch and says how many
     * others there are. A warehouse with a balance row but nothing in it is kept
     * (it is where the batch was), but ordered after the ones that still hold
     * stock, so the label names the place a picker should go.
     */
    private function attachWarehouses(int $cmpId, array &$rows, ?int $warehouseId): void
    {
        $ids = array_map(static fn ($r) => (int) $r['batch_id'], $rows);
        $by = [];
        foreach (array_chunk($ids, 500) as $chunk) {
            $b = \Config\Database::connect()->table('inv_stock_balances s')
                ->select('s.batch_id, s.warehouse_id, w.warehouse_name, w.warehouse_code, SUM(s.on_hand_qty) AS on_hand', false)
                ->join('inv_warehouses w', 'w.warehouse_id = s.warehouse_id', 'left')
                ->where('s.cmp_id', $cmpId)->whereIn('s.batch_id', $chunk)
                ->groupBy('s.batch_id, s.warehouse_id, w.warehouse_name, w.warehouse_code', false);
            if ($warehouseId !== null && $warehouseId > 0) {
                $b->where('s.warehouse_id', $warehouseId);
            }
            foreach ($b->get()->getResultArray() as $r) {
                $by[(int) $r['batch_id']][] = [
                    'warehouse_id'   => $r['warehouse_id'] !== null ? (int) $r['warehouse_id'] : null,
                    'warehouse_name' => $r['warehouse_name'] ?? null,
                    'warehouse_code' => $r['warehouse_code'] ?? null,
                    'on_hand'        => round((float) ($r['on_hand'] ?? 0), 4),
                ];
            }
        }
        foreach ($rows as &$r) {
            $list = $by[(int) $r['batch_id']] ?? [];
            usort($list, static fn ($x, $y) => $y['on_hand'] <=> $x['on_hand'] ?: strcmp((string) $x['warehouse_name'], (string) $y['warehouse_name']));
            $r['warehouse_count'] = count($list);
            $r['warehouses'] = array_slice($list, 0, 5);
        }
    }
}
