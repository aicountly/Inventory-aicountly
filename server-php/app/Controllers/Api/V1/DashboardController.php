<?php

namespace App\Controllers\Api\V1;

use App\Controllers\Api\BaseController;
use App\Services\ReconciliationService;

/**
 * GET /api/v1/dashboard?near_expiry_days=30 — company / FY overview counters.
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

            // Negative stock: items whose company-wide on-hand (all warehouses) is below zero, plus per-warehouse rows.
            $negItems = $db->query('SELECT COUNT(*) AS cnt FROM (SELECT item_id FROM inv_stock_balances WHERE cmp_id = ? GROUP BY item_id HAVING SUM(on_hand_qty) < -0.00005) t', [$cmpId])->getRowArray() ?: [];
            $negRows = $db->query('SELECT COUNT(*) AS cnt FROM (SELECT item_id, COALESCE(warehouse_id, 0) wh FROM inv_stock_balances WHERE cmp_id = ? GROUP BY item_id, COALESCE(warehouse_id, 0) HAVING SUM(on_hand_qty) < -0.00005) t', [$cmpId])->getRowArray() ?: [];

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
                'negative_stock_items'      => (int) ($negItems['cnt'] ?? 0),
                'negative_stock_warehouse_rows' => (int) ($negRows['cnt'] ?? 0),
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
}
