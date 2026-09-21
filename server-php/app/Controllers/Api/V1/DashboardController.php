<?php

namespace App\Controllers\Api\V1;

use App\Controllers\Api\BaseController;
use App\Services\DashboardMetricsService;
use App\Services\ReconciliationService;
use App\Services\StockBalanceService;

/**
 * The dashboard aggregates.
 *
 *   GET /api/v1/dashboard?near_expiry_days=30   overview counters
 *   GET /api/v1/dashboard/operations            a day on the warehouse floor
 *   GET /api/v1/dashboard/valuation-bridge      opening -> closing value walk
 *   GET /api/v1/dashboard/demand                observed demand for one item
 *   GET /api/v1/dashboard/controls              exceptions and Books delivery health
 *
 * Every action authorises first and takes its company, financial year and branch
 * from the session context the authorisation returned — NEVER from a query
 * parameter. A caller can ask for a date, an item or a warehouse; it cannot ask
 * for another tenant's books by editing a URL.
 */
class DashboardController extends BaseController
{
    private const DOCUMENT_STATUSES = ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'POSTING', 'POSTED', 'PARTIALLY_FULFILLED', 'COMPLETED', 'CANCELLED', 'REVERSED', 'FAILED'];

    public function index()
    {
        $a = $this->authorize('dashboard.read');
        if (isset($a['response'])) {
            return $a['response'];
        }
        $ctx = $a['ctx'];
        $cmpId = (int) $ctx['cmp_id'];
        $fyId = (int) $ctx['fy_id'];
        $boId = (int) $ctx['bo_id'];
        $days = (int) ($this->request->getGet('near_expiry_days') ?? 30);
        $days = max(1, min(365, $days));
        $today = date('Y-m-d');
        $db = \Config\Database::connect();
        try {
            // Masters
            $items = $db->table('inv_items')->select('COUNT(*) AS total, SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END) AS active', false)
                ->where('cmp_id', $cmpId)->where('deleted_at', null)->get()->getRowArray() ?: [];
            $warehouses = $db->table('inv_warehouses')->select('COUNT(*) AS total, SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END) AS active', false)
                ->where('cmp_id', $cmpId)->where('deleted_at', null)->get()->getRowArray() ?: [];

            // Documents by status for the FY (branch-scoped when a branch is given)
            $b = $db->table('inv_documents')->select('status, COUNT(*) AS cnt', false)->where('cmp_id', $cmpId)->where('fy_id', $fyId);
            if ($boId > 0) {
                $b->where('bo_id', $boId);
            }
            $byStatus = array_fill_keys(self::DOCUMENT_STATUSES, 0);
            foreach ($b->groupBy('status')->get()->getResultArray() as $r) {
                $byStatus[(string) $r['status']] = (int) $r['cnt'];
            }
            $docTotal = array_sum($byStatus);
            $b = $db->table('inv_documents')->select('document_type, COUNT(*) AS cnt', false)->where('cmp_id', $cmpId)->where('fy_id', $fyId)
                ->whereIn('status', ['POSTED', 'COMPLETED', 'PARTIALLY_FULFILLED']);
            if ($boId > 0) {
                $b->where('bo_id', $boId);
            }
            $postedByType = [];
            foreach ($b->groupBy('document_type')->orderBy('cnt', 'DESC')->get()->getResultArray() as $r) {
                $postedByType[(string) $r['document_type']] = (int) $r['cnt'];
            }

            // Negative stock: the balance rows below zero — item x warehouse x batch, which is
            // what the register the card drills to lists with ?negative=1 — plus the items those
            // rows belong to once a branch's warehouses are netted against each other.
            $negative = (new StockBalanceService())->negativeStockCounts($cmpId, $boId);

            // Near-expiry / expired batches (active batches with an expiry date)
            $until = date('Y-m-d', strtotime($today . ' +' . $days . ' days'));
            $batches = $db->table('inv_batches')
                ->select('SUM(CASE WHEN expiry_date >= ' . $db->escape($today) . ' AND expiry_date <= ' . $db->escape($until) . ' THEN 1 ELSE 0 END) AS near_expiry, SUM(CASE WHEN expiry_date < ' . $db->escape($today) . ' THEN 1 ELSE 0 END) AS expired', false)
                ->where('cmp_id', $cmpId)->where('expiry_date IS NOT NULL', null, false)->whereNotIn('status', ['closed', 'expired'])
                ->get()->getRowArray() ?: [];

            // Integration health
            $outbox = ['PENDING' => 0, 'SENT' => 0, 'ACKED' => 0, 'FAILED' => 0, 'DEAD' => 0];
            foreach ($db->table('inv_integration_events')->select('status, COUNT(*) AS cnt', false)->where('cmp_id', $cmpId)->groupBy('status')->get()->getResultArray() as $r) {
                $outbox[(string) $r['status']] = (int) $r['cnt'];
            }
            $inbound = ['RECEIVED' => 0, 'PROCESSED' => 0, 'FAILED' => 0, 'IGNORED' => 0];
            foreach ($db->table('inv_inbound_events')->select('status, COUNT(*) AS cnt', false)->where('cmp_id', $cmpId)->groupBy('status')->get()->getResultArray() as $r) {
                $inbound[(string) $r['status']] = (int) $r['cnt'];
            }
            $revisions = $db->table('inv_valuation_revisions')->select('COUNT(*) AS cnt, COALESCE(SUM(delta_amount),0) AS delta', false)->where('cmp_id', $cmpId)->where('acknowledged_at', null)->get()->getRowArray() ?: [];
            $recalcQueued = $db->table('inv_valuation_recalc_jobs')->where('cmp_id', $cmpId)->whereIn('status', ['QUEUED', 'RUNNING'])->countAllResults();

            // Pending quantities (open challans / deferred purchases / job work)
            $pendingB = $db->table('inv_pending_quantities')->select('pending_kind, COUNT(*) AS cnt', false)->where('cmp_id', $cmpId)->where('fy_id', $fyId)->whereIn('status', ['open', 'partial']);
            $pending = [];
            foreach ($pendingB->groupBy('pending_kind')->get()->getResultArray() as $r) {
                $pending[(string) $r['pending_kind']] = (int) $r['cnt'];
            }

            // Last reconciliation run
            $b = $db->table('inv_reconciliation_runs')->where('cmp_id', $cmpId)->where('fy_id', $fyId);
            if ($boId > 0) {
                $b->where('bo_id', $boId);
            }
            $lastRun = $b->select('run_id, run_uuid, cmp_id, fy_id, bo_id, as_of_date, inventory_closing_value, inventory_closing_qty, books_stock_ledger_balance, difference, status, requested_by, created_at')
                ->orderBy('created_at', 'DESC')->orderBy('run_id', 'DESC')->limit(1)->get()->getRowArray();
        } catch (\Throwable $e) {
            return $this->failFromException($e);
        }

        return $this->respond(['data' => [
            'as_of'  => $today,
            'fy_id'  => $fyId,
            'bo_id'  => $boId,
            'masters' => [
                'items'      => ['total' => (int) ($items['total'] ?? 0), 'active' => (int) ($items['active'] ?? 0)],
                'warehouses' => ['total' => (int) ($warehouses['total'] ?? 0), 'active' => (int) ($warehouses['active'] ?? 0)],
            ],
            'documents' => [
                'total'             => $docTotal,
                'by_status'         => $byStatus,
                'pending_approval'  => $byStatus['PENDING_APPROVAL'],
                'failed'            => $byStatus['FAILED'],
                'posted_by_type'    => $postedByType,
            ],
            'stock' => [
                'negative_stock_rows'       => $negative['rows'],
                'negative_stock_items'      => $negative['items'],
                'near_expiry_batches'       => (int) ($batches['near_expiry'] ?? 0),
                'expired_batches'           => (int) ($batches['expired'] ?? 0),
                'near_expiry_days'          => $days,
                'pending_quantities'        => $pending,
            ],
            'integration' => [
                'outbox'                    => $outbox,
                'outbox_pending'            => $outbox['PENDING'] + $outbox['FAILED'],
                'outbox_failed'             => $outbox['FAILED'] + $outbox['DEAD'],
                'inbound'                   => $inbound,
                'unacknowledged_revisions'  => ['count' => (int) ($revisions['cnt'] ?? 0), 'delta_total' => round((float) ($revisions['delta'] ?? 0), 4)],
                'recalculations_in_progress'=> $recalcQueued,
            ],
            'last_reconciliation' => $lastRun ? ReconciliationService::castRun($lastRun) : null,
        ]]);
    }

    /**
     * GET /v1/dashboard/operations?date=YYYY-MM-DD
     *
     * `date` is a calendar date in the application timezone; it defaults to
     * today there. Anything unparseable is rejected rather than quietly swapped
     * for today, because a dashboard that silently ignores the date it was asked
     * for is a dashboard that shows the wrong day without saying so.
     */
    public function operations()
    {
        $a = $this->authorize('dashboard.read');
        if (isset($a['response'])) {
            return $a['response'];
        }
        $ctx = $a['ctx'];
        $date = $this->isoDateParam('date', date('Y-m-d'));
        if ($date === null) {
            return $this->failStructured(422, 'invalid_date', 'date must be an ISO calendar date (YYYY-MM-DD)');
        }

        try {
            $data = (new DashboardMetricsService())->operations((int) $ctx['cmp_id'], (int) $ctx['fy_id'], (int) $ctx['bo_id'], $date);
        } catch (\Throwable $e) {
            return $this->failFromException($e);
        }

        return $this->respond(['data' => $this->envelope($ctx, $data, ['as_of' => $date])]);
    }

    /**
     * GET /v1/dashboard/valuation-bridge?from=&to=&warehouse_id=
     *
     * `from`/`to` default to the financial year so far. The warehouse filter is
     * validated against this company's own warehouses: an id from another
     * tenant resolves to nothing rather than to their stock.
     */
    public function valuationBridge()
    {
        $a = $this->authorize('dashboard.read');
        if (isset($a['response'])) {
            return $a['response'];
        }
        $ctx = $a['ctx'];
        $to = $this->isoDateParam('to', date('Y-m-d'));
        if ($to === null) {
            return $this->failStructured(422, 'invalid_date', 'to must be an ISO calendar date (YYYY-MM-DD)');
        }
        // A year back from the cutoff when the caller sends no start. The real
        // default the screen sends is the financial year, which Manage owns and
        // the client knows; the API cannot invent it, so it takes a full year
        // rather than guessing at a year end.
        $from = $this->isoDateParam('from', date('Y-m-d', strtotime($to . ' -1 year')));
        if ($from === null) {
            return $this->failStructured(422, 'invalid_date', 'from must be an ISO calendar date (YYYY-MM-DD)');
        }
        if ($from > $to) {
            return $this->failStructured(422, 'invalid_range', 'from must not be after to');
        }
        $warehouseId = $this->companyWarehouseId((int) $ctx['cmp_id']);
        if ($warehouseId === false) {
            return $this->failStructured(404, 'warehouse_not_found', 'That warehouse does not belong to this company');
        }

        try {
            $data = (new DashboardMetricsService())->valuationBridge(
                (int) $ctx['cmp_id'],
                (int) $ctx['fy_id'],
                (int) $ctx['bo_id'],
                $from,
                $to,
                $warehouseId,
            );
        } catch (\Throwable $e) {
            return $this->failFromException($e);
        }

        return $this->respond(['data' => $this->envelope($ctx, $data, ['as_of' => $to, 'period_start' => $from, 'period_end' => $to])]);
    }

    /**
     * GET /v1/dashboard/demand?item_id=&warehouse_id=&as_of=&history_days=&horizon_days=
     *
     * One item's observed outward demand. `item_id` is required and is checked
     * against this company's item master before anything is read, so the route
     * cannot be used to probe whether an id exists elsewhere.
     */
    public function demand()
    {
        $a = $this->authorize('dashboard.read');
        if (isset($a['response'])) {
            return $a['response'];
        }
        $ctx = $a['ctx'];
        $itemId = (int) ($this->request->getGet('item_id') ?? 0);
        if ($itemId <= 0) {
            return $this->failStructured(422, 'item_required', 'item_id is required');
        }
        if (!$this->itemBelongsToCompany($itemId, (int) $ctx['cmp_id'])) {
            return $this->failStructured(404, 'item_not_found', 'That item does not belong to this company');
        }
        $warehouseId = $this->companyWarehouseId((int) $ctx['cmp_id']);
        if ($warehouseId === false) {
            return $this->failStructured(404, 'warehouse_not_found', 'That warehouse does not belong to this company');
        }
        $asOf = $this->isoDateParam('as_of', date('Y-m-d'));
        if ($asOf === null) {
            return $this->failStructured(422, 'invalid_date', 'as_of must be an ISO calendar date (YYYY-MM-DD)');
        }
        $historyDays = max(7, min(365, (int) ($this->request->getGet('history_days') ?? 60)));
        $horizonDays = max(1, min(180, (int) ($this->request->getGet('horizon_days') ?? 14)));

        try {
            $data = (new DashboardMetricsService())->demand(
                (int) $ctx['cmp_id'],
                (int) $ctx['fy_id'],
                (int) $ctx['bo_id'],
                $itemId,
                $warehouseId,
                $asOf,
                $historyDays,
                $horizonDays,
            );
        } catch (\Throwable $e) {
            return $this->failFromException($e);
        }

        return $this->respond(['data' => $this->envelope($ctx, $data, ['as_of' => $asOf])]);
    }

    /** GET /v1/dashboard/controls — the exception register and Books delivery health. */
    public function controls()
    {
        $a = $this->authorize('dashboard.read');
        if (isset($a['response'])) {
            return $a['response'];
        }
        $ctx = $a['ctx'];

        try {
            $data = (new DashboardMetricsService())->controls((int) $ctx['cmp_id'], (int) $ctx['fy_id'], (int) $ctx['bo_id']);
        } catch (\Throwable $e) {
            return $this->failFromException($e);
        }

        return $this->respond(['data' => $this->envelope($ctx, $data, ['as_of' => date('Y-m-d')])]);
    }

    // -----------------------------------------------------------------------
    // Shared
    // -----------------------------------------------------------------------

    /**
     * The scope + freshness envelope every dashboard aggregate travels in.
     *
     * The client needs the scope echoed back to know the response it is about to
     * render answers the filters currently on screen — a company switch in
     * flight otherwise lands the old company's figures under the new company's
     * name, which is the one mistake a multi-tenant dashboard may not make.
     *
     * @param array<string, mixed> $ctx
     * @param array<string, mixed> $data
     * @param array<string, mixed> $scopeExtra
     *
     * @return array<string, mixed>
     */
    private function envelope(array $ctx, array $data, array $scopeExtra = []): array
    {
        return [
            'scope' => array_merge([
                'cmp_id'   => (int) $ctx['cmp_id'],
                'fy_id'    => (int) $ctx['fy_id'],
                'bo_id'    => (int) $ctx['bo_id'],
                'timezone' => app_timezone(),
            ], $scopeExtra),
            'meta' => [
                'generated_at' => date('c'),
                'status'       => 'ready',
            ],
            'data' => $data,
        ];
    }

    /** An ISO date from the query string, `$fallback` when absent, null when malformed. */
    private function isoDateParam(string $key, string $fallback): ?string
    {
        $raw = trim((string) ($this->request->getGet($key) ?? ''));
        if ($raw === '') {
            return $fallback;
        }
        if (preg_match('/^\d{4}-\d{2}-\d{2}$/', $raw) !== 1) {
            return null;
        }
        [$y, $m, $d] = array_map('intval', explode('-', $raw));

        return checkdate($m, $d, $y) ? $raw : null;
    }

    /**
     * `warehouse_id` from the query string, checked against this company.
     *
     * null when absent (no filter), false when it names a warehouse this company
     * does not own — which the caller turns into a 404 rather than silently
     * dropping the filter and answering with the whole company's stock.
     */
    private function companyWarehouseId(int $cmpId): int|null|false
    {
        $raw = trim((string) ($this->request->getGet('warehouse_id') ?? ''));
        if ($raw === '' || $raw === '0') {
            return null;
        }
        $id = (int) $raw;
        if ($id <= 0) {
            return false;
        }
        $exists = \Config\Database::connect()->table('inv_warehouses')
            ->where('warehouse_id', $id)->where('cmp_id', $cmpId)->where('deleted_at', null)
            ->countAllResults() > 0;

        return $exists ? $id : false;
    }

    private function itemBelongsToCompany(int $itemId, int $cmpId): bool
    {
        return \Config\Database::connect()->table('inv_items')
            ->where('item_id', $itemId)->where('cmp_id', $cmpId)->where('deleted_at', null)
            ->countAllResults() > 0;
    }
}
