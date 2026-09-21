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
    private const SORT = ['batch_no' => 'b.batch_no', 'batch_id' => 'b.batch_id', 'lot_no' => 'b.lot_no', 'expiry_date' => 'b.expiry_date', 'mfg_date' => 'b.mfg_date', 'status' => 'b.status', 'item_name' => 'i.item_name', 'on_hand' => 'COALESCE(sb.on_hand, 0)', 'created_at' => 'b.created_at', 'updated_at' => 'b.updated_at'];
    private const SELECT = 'b.batch_id, b.batch_uuid, b.item_id, b.batch_no, b.lot_no, b.mfg_date, b.expiry_date, b.warranty_months, b.status, b.attributes_json, b.created_at, b.created_by, b.updated_at, b.updated_by, i.item_name, i.item_sku, i.unit_id, i.track_expiry, u.unit_symbol, g.grp_name AS item_grp_name, sc.cat_name AS stock_cat_name';

    /**
     * How many days ahead counts as "expiring soon".
     *
     * The screen's amber band and the summary's `expiring_soon` figure are the
     * same question asked twice, so the window is declared once here and echoed
     * in the response (`expiry_window_days`) rather than hardcoded again in the
     * client. Callers may narrow or widen it per request with `?window=`.
     */
    private const EXPIRY_WINDOW_DAYS = 30;
    private const EXPIRY_WINDOW_MAX = 365;

    public function index()
    {
        $a = $this->authorize(self::PERM . '.read', true, false);
        if (isset($a['response'])) {
            return $a['response'];
        }
        $cmpId = (int) $a['ctx']['cmp_id'];
        $p = $this->listParams(100, 1000, 'batch_no');
        $sortKey = self::SORT[$p['sort']] ?? 'b.batch_no';
        $filtered = $this->filtered($cmpId, $sortKey === self::SORT['on_hand']);
        if (isset($filtered['response'])) {
            return $filtered['response'];
        }
        $b = $filtered['builder'];

        $total = (clone $b)->countAllResults(false);
        $rows = $b->select(self::SELECT)
            ->orderBy($sortKey, $p['order'], false)
            // A second, stable key: batch numbers repeat across items and two
            // pages ordered only by a repeated value can show the same row
            // twice and drop another.
            ->orderBy('b.batch_id', $p['order'], false)
            ->limit($p['limit'], $p['offset'])->get()->getResultArray();
        $rows = array_map([$this, 'present'], $rows);
        if ((int) ($this->request->getGet('with_stock') ?? 0) === 1 && $rows !== []) {
            $this->attachStock($cmpId, $rows, $filtered['warehouse_id'], $filtered['warehouse_group_id']);
        }

        return $this->respondList($rows, $total, $p['limit'], $p['offset']);
    }

    /**
     * `GET /v1/batches/summary` — the figures the Batches screen puts above the
     * table, over the WHOLE filtered set.
     *
     * Every card, the donut and the expiry timeline read from here rather than
     * from the page of rows the table happens to hold: a "248 batches" headline
     * derived from the 50 rows on screen would be wrong on page two and wrong
     * about the question it was asked. It takes exactly the same filter
     * parameters as `index`, so the figures always describe the rows below them.
     *
     * The four states are the screen's vocabulary, not the table's: the stored
     * status wins whenever it is not `active`, and an active batch is graded by
     * its expiry date. The client derives a row's badge the same way
     * (web/src/pages/masters/batches/batchExpiry.ts) and the two must agree.
     */
    public function summary()
    {
        $a = $this->authorize(self::PERM . '.read', true, false);
        if (isset($a['response'])) {
            return $a['response'];
        }
        $cmpId = (int) $a['ctx']['cmp_id'];
        $filtered = $this->filtered($cmpId, true);
        if (isset($filtered['response'])) {
            return $filtered['response'];
        }
        $b = $filtered['builder'];

        $window = $this->expiryWindow();
        $db = \Config\Database::connect();
        $today = date('Y-m-d');
        $d = static fn (int $days): string => $db->escape(date('Y-m-d', strtotime($today . ' +' . $days . ' days')));
        $t = $db->escape($today);

        // The same four predicates the `state` filter narrows the list by, so
        // a card's figure and the rows that card links to cannot disagree.
        $states   = $this->statePredicates($window);
        $expired  = $states['expired'];
        $soon     = $states['expiring_soon'];
        $healthy  = $states['active'];
        $inactive = $states['inactive'];
        $onHand   = 'COALESCE(sb.on_hand, 0)';

        $select = 'COUNT(*) AS total'
            . ", COUNT(*) FILTER (WHERE {$healthy}) AS state_active"
            . ", COUNT(*) FILTER (WHERE {$soon}) AS state_expiring_soon"
            . ", COUNT(*) FILTER (WHERE {$expired}) AS state_expired"
            . ", COUNT(*) FILTER (WHERE {$inactive}) AS state_inactive"
            . ", COALESCE(SUM({$onHand}), 0) AS total_on_hand"
            . ", COUNT(*) FILTER (WHERE {$onHand} > 0) AS with_stock"
            . ', COUNT(DISTINCT b.item_id) AS items'
            . ', COUNT(*) FILTER (WHERE b.expiry_date IS NULL) AS expiry_none'
            . ", COUNT(*) FILTER (WHERE b.expiry_date IS NOT NULL AND b.expiry_date < {$t}) AS expiry_past"
            . ", COUNT(*) FILTER (WHERE b.expiry_date >= {$t} AND b.expiry_date <= {$d(30)}) AS expiry_within_30"
            . ", COUNT(*) FILTER (WHERE b.expiry_date > {$d(30)} AND b.expiry_date <= {$d(90)}) AS expiry_31_90"
            . ", COUNT(*) FILTER (WHERE b.expiry_date > {$d(90)} AND b.expiry_date <= {$d(180)}) AS expiry_91_180"
            . ", COUNT(*) FILTER (WHERE b.expiry_date > {$d(180)}) AS expiry_beyond_180";
        foreach (self::STATUSES as $st) {
            $select .= ', COUNT(*) FILTER (WHERE b.status = ' . $db->escape($st) . ') AS status_' . $st;
        }

        /*
         * The one genuine comparison this table can make.
         *
         * A batch has a creation date and nothing else that moves with time —
         * on-hand is a current-state figure with no history on this table — so
         * the only honest delta is how many batches were opened in the last
         * `window` days against the `window` days before that. It is labelled
         * as such on the card; there is deliberately no comparative for the
         * quantity figures, and no card invents one.
         *
         * Counted in the same pass as everything else: a second aggregate over
         * the same filtered set would double the work a page load costs on a
         * table this screen is expected to grow to.
         */
        $recentFrom   = $db->escape(date('Y-m-d 00:00:00', strtotime($today . ' -' . $window . ' days')));
        $previousFrom = $db->escape(date('Y-m-d 00:00:00', strtotime($today . ' -' . (2 * $window) . ' days')));
        $select .= ", COUNT(*) FILTER (WHERE b.created_at >= {$recentFrom}) AS created_recent"
            . ", COUNT(*) FILTER (WHERE b.created_at >= {$previousFrom} AND b.created_at < {$recentFrom}) AS created_previous";

        $agg = (clone $b)->select($select, false)->get()->getRowArray() ?: [];

        $statusCounts = [];
        foreach (self::STATUSES as $st) {
            $statusCounts[$st] = (int) ($agg['status_' . $st] ?? 0);
        }

        return $this->respond(['data' => [
            'total'              => (int) ($agg['total'] ?? 0),
            'items'              => (int) ($agg['items'] ?? 0),
            'with_stock'         => (int) ($agg['with_stock'] ?? 0),
            'total_on_hand'      => round((float) ($agg['total_on_hand'] ?? 0), 4),
            'expiry_window_days' => $window,
            'as_of'              => $today,
            'states'             => [
                'active'        => (int) ($agg['state_active'] ?? 0),
                'expiring_soon' => (int) ($agg['state_expiring_soon'] ?? 0),
                'expired'       => (int) ($agg['state_expired'] ?? 0),
                'inactive'      => (int) ($agg['state_inactive'] ?? 0),
            ],
            'status_counts'  => $statusCounts,
            'expiry_buckets' => [
                'expired'      => (int) ($agg['expiry_past'] ?? 0),
                'within_30'    => (int) ($agg['expiry_within_30'] ?? 0),
                'days_31_90'   => (int) ($agg['expiry_31_90'] ?? 0),
                'days_91_180'  => (int) ($agg['expiry_91_180'] ?? 0),
                'beyond_180'   => (int) ($agg['expiry_beyond_180'] ?? 0),
                'no_expiry'    => (int) ($agg['expiry_none'] ?? 0),
            ],
            'created_recent'   => (int) ($agg['created_recent'] ?? 0),
            'created_previous' => (int) ($agg['created_previous'] ?? 0),
        ]]);
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
            ->join('inv_item_groups g', 'g.item_grp_id = i.item_grp_id', 'left')
            ->join('inv_stock_categories sc', 'sc.stock_cat_id = i.stock_cat_id', 'left')
            ->where('b.cmp_id', $cmpId);
    }

    /**
     * The list query with every filter the Batches screen can send applied, so
     * `index` and `summary` cannot drift apart: the cards above the table are
     * only trustworthy while they count exactly the rows the table would show.
     *
     * Returns `['response' => ...]` instead when a parameter is malformed.
     *
     * @return array{builder?: \CodeIgniter\Database\BaseBuilder, warehouse_id?: ?int, warehouse_group_id?: ?int, response?: mixed}
     */
    private function filtered(int $cmpId, bool $forceStockJoin = false): array
    {
        $g          = fn (string $k): string => trim((string) ($this->request->getGet($k) ?? ''));
        $warehouseId = (int) $this->request->getGet('warehouse_id') ?: null;
        $warehouseGroupId = (int) $this->request->getGet('warehouse_group_id') ?: null;
        $stock      = strtolower($g('stock'));

        // The join is not free — one grouped pass over the balances — so it is
        // added only when something actually reads it.
        $needsStock = $forceStockJoin || $warehouseId !== null || $warehouseGroupId !== null || in_array($stock, ['positive', 'zero'], true);
        $b = $this->baseQuery($cmpId);
        if ($needsStock) {
            $b->join($this->stockJoin($cmpId, $warehouseId, $warehouseGroupId), 'sb.batch_id = b.batch_id', 'left', false);
        }

        if ($itemId = (int) $this->request->getGet('item_id')) {
            $b->where('b.item_id', $itemId);
        }
        foreach (['item_grp_id' => 'i.item_grp_id', 'stock_cat_id' => 'i.stock_cat_id', 'brand_id' => 'i.brand_id'] as $param => $column) {
            if ($id = (int) $this->request->getGet($param)) {
                $b->where($column, $id);
            }
        }
        $status = strtolower($g('status'));
        if ($status !== '') {
            $b->whereIn('b.status', array_values(array_filter(array_map('trim', explode(',', $status)))));
        }

        /*
         * `state` is the screen's four-way grading, not the stored status, and
         * it is resolved HERE rather than in the client for one reason: the
         * cards above the table count it with the same predicate
         * (see `summary`). Ask the list for "expiring soon" in one vocabulary
         * and the summary in another and the two disagree by a row or two,
         * which is exactly the kind of drift nobody can debug from a screenshot.
         */
        $state = strtolower($g('state'));
        if ($state !== '') {
            $predicates = $this->statePredicates($this->expiryWindow());
            if (!isset($predicates[$state])) {
                return ['response' => $this->failStructured(422, 'validation_failed', 'state must be one of ' . implode(', ', array_keys($predicates)), ['field' => 'state'])];
            }
            $b->where($predicates[$state], null, false);
        }

        // `expiring_before` is the original contract and stays; the range pair
        // is what the screen's expiry presets and custom range send.
        foreach ([
            'expiring_before' => ['b.expiry_date <=', true],
            'expiry_from'     => ['b.expiry_date >=', true],
            'expiry_to'       => ['b.expiry_date <=', true],
            'mfg_from'        => ['b.mfg_date >=', false],
            'mfg_to'          => ['b.mfg_date <=', false],
        ] as $param => [$clause, $requiresExpiry]) {
            $value = $g($param);
            if ($value === '') {
                continue;
            }
            if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $value)) {
                return ['response' => $this->failStructured(422, 'validation_failed', $param . ' must be YYYY-MM-DD', ['field' => $param])];
            }
            if ($requiresExpiry) {
                $b->where('b.expiry_date IS NOT NULL', null, false);
            } else {
                $b->where('b.mfg_date IS NOT NULL', null, false);
            }
            $b->where($clause, $value);
        }
        if ($g('has_expiry') === '0') {
            $b->where('b.expiry_date IS NULL', null, false);
        }

        if ($lot = $g('lot_no')) {
            $b->like('LOWER(b.lot_no)', mb_strtolower($lot), 'both', null, true);
        }
        if ($stock === 'positive') {
            $b->where('COALESCE(sb.on_hand, 0) > 0', null, false);
        } elseif ($stock === 'zero') {
            $b->where('COALESCE(sb.on_hand, 0) = 0', null, false);
        }
        // "Held in this warehouse" means the batch has a balance row there —
        // including a row that has run down to zero, because a batch with no
        // stock left is still part of that warehouse's traceability.
        if ($warehouseId !== null || $warehouseGroupId !== null) {
            $b->where('sb.batch_id IS NOT NULL', null, false);
        }

        $q = $g('q');
        if ($q !== '') {
            $needle = mb_strtolower($q);
            $b->groupStart()
                ->like('LOWER(b.batch_no)', $needle, 'both', null, true)
                ->orLike('LOWER(b.lot_no)', $needle, 'both', null, true)
                ->orLike('LOWER(i.item_name)', $needle, 'both', null, true)
                ->orLike('LOWER(i.item_sku)', $needle, 'both', null, true)
                ->groupEnd();
        }

        return ['builder' => $b, 'warehouse_id' => $warehouseId, 'warehouse_group_id' => $warehouseGroupId];
    }

    /** The `expiring soon` window for this request, clamped to something sane. */
    private function expiryWindow(): int
    {
        $window = (int) ($this->request->getGet('window') ?? self::EXPIRY_WINDOW_DAYS);

        return max(1, min(self::EXPIRY_WINDOW_MAX, $window));
    }

    /**
     * The four states the Batches screen grades a batch by, as SQL.
     *
     * The stored status wins whenever it is not `active`; an active batch is
     * then graded by its expiry date. `web/src/pages/masters/batches/batchExpiry.ts`
     * computes the same four states for a single row's badge — the two are one
     * rule written twice and have to be changed together.
     *
     * @return array<string, string>
     */
    private function statePredicates(int $windowDays): array
    {
        $db = \Config\Database::connect();
        $today = date('Y-m-d');
        $t = $db->escape($today);
        $edge = $db->escape(date('Y-m-d', strtotime($today . ' +' . $windowDays . ' days')));

        return [
            'active'        => "(b.status = 'active' AND (b.expiry_date IS NULL OR b.expiry_date > {$edge}))",
            'expiring_soon' => "(b.status = 'active' AND b.expiry_date IS NOT NULL AND b.expiry_date >= {$t} AND b.expiry_date <= {$edge})",
            'expired'       => "(b.status = 'expired' OR (b.status = 'active' AND b.expiry_date IS NOT NULL AND b.expiry_date < {$t}))",
            'inactive'      => "(b.status IN ('quarantine', 'recalled', 'closed'))",
        ];
    }

    /**
     * On-hand per batch as a derived table, optionally narrowed to one
     * warehouse or warehouse group.
     *
     * A join rather than a correlated subquery so that filtering, counting and
     * ordering by quantity are one pass. Every value interpolated here is cast
     * to int first — nothing reaches the string from the request unchecked.
     */
    private function stockJoin(int $cmpId, ?int $warehouseId, ?int $warehouseGroupId): string
    {
        $sql = 'SELECT s.batch_id, SUM(s.on_hand_qty) AS on_hand FROM inv_stock_balances s';
        if ($warehouseGroupId !== null) {
            $sql .= ' JOIN inv_warehouses wg ON wg.warehouse_id = s.warehouse_id AND wg.warehouse_group_id = ' . (int) $warehouseGroupId;
        }
        $sql .= ' WHERE s.cmp_id = ' . $cmpId . ' AND s.batch_id IS NOT NULL';
        if ($warehouseId !== null) {
            $sql .= ' AND s.warehouse_id = ' . (int) $warehouseId;
        }
        $sql .= ' GROUP BY s.batch_id';

        return '(' . $sql . ') sb';
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
        if (isset($row['track_expiry'])) {
            $row['track_expiry'] = (int) $row['track_expiry'];
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

    /**
     * One grouped query for the page: on-hand / available per batch, and where
     * that stock actually sits.
     *
     * Grouped by warehouse rather than by batch alone so the table can name the
     * warehouse beside the quantity without asking a second question per row —
     * a column filled by one request per row is how a 100-row page becomes 100
     * requests.
     */
    private function attachStock(int $cmpId, array &$rows, ?int $warehouseId, ?int $warehouseGroupId = null): void
    {
        $ids = array_map(static fn ($r) => (int) $r['batch_id'], $rows);
        $by = [];
        $places = [];
        foreach (array_chunk($ids, 500) as $chunk) {
            $b = \Config\Database::connect()->table('inv_stock_balances s')
                ->select('s.batch_id, s.warehouse_id, w.warehouse_name, w.warehouse_code, SUM(s.on_hand_qty) on_hand, SUM(s.reserved_qty) reserved, SUM(s.packed_qty) packed, SUM(s.quality_hold_qty) quality_hold, SUM(s.damaged_qty) damaged, SUM(s.blocked_qty) blocked', false)
                ->join('inv_warehouses w', 'w.warehouse_id = s.warehouse_id', 'left')
                ->where('s.cmp_id', $cmpId)->whereIn('s.batch_id', $chunk)
                ->groupBy('s.batch_id, s.warehouse_id, w.warehouse_name, w.warehouse_code', false);
            if ($warehouseId !== null && $warehouseId > 0) {
                $b->where('s.warehouse_id', $warehouseId);
            }
            if ($warehouseGroupId !== null && $warehouseGroupId > 0) {
                $b->where('w.warehouse_group_id', $warehouseGroupId);
            }
            foreach ($b->get()->getResultArray() as $r) {
                $id = (int) $r['batch_id'];
                $s = [];
                foreach (['on_hand', 'reserved', 'packed', 'quality_hold', 'damaged', 'blocked'] as $k) {
                    $s[$k] = round((float) ($r[$k] ?? 0), 4);
                }
                $available = StockBalanceService::availableFrom($s);
                $total = $by[$id] ?? ['on_hand' => 0.0, 'reserved' => 0.0, 'available' => 0.0];
                $by[$id] = [
                    'on_hand'   => round($total['on_hand'] + $s['on_hand'], 4),
                    'reserved'  => round($total['reserved'] + $s['reserved'], 4),
                    'available' => round($total['available'] + $available, 4),
                ];
                $places[$id][] = [
                    'warehouse_id'   => $r['warehouse_id'] !== null ? (int) $r['warehouse_id'] : null,
                    'warehouse_name' => $r['warehouse_name'] ?? null,
                    'warehouse_code' => $r['warehouse_code'] ?? null,
                    'on_hand'        => $s['on_hand'],
                ];
            }
        }
        foreach ($rows as &$r) {
            $id = (int) $r['batch_id'];
            $r['stock'] = $by[$id] ?? ['on_hand' => 0.0, 'reserved' => 0.0, 'available' => 0.0];
            $where = $places[$id] ?? [];
            // Biggest holding first: the one name the table has room for should
            // be the warehouse most of the batch is in.
            usort($where, static fn ($x, $y) => $y['on_hand'] <=> $x['on_hand']);
            $r['warehouses'] = $where;
        }
    }
}
