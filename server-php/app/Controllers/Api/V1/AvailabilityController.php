<?php

namespace App\Controllers\Api\V1;

use App\Controllers\Api\BaseController;
use App\Services\StockBalanceService;

/**
 * /api/v1/availability — POS-speed stock availability from the materialised balances.
 */
class AvailabilityController extends BaseController
{
    public function index()
    {
        $a = $this->authorizeAny(['reports.stock_summary.read', 'documents.read']);
        if (isset($a['response'])) {
            return $a['response'];
        }
        $cmpId = (int) $a['ctx']['cmp_id'];
        $ids = array_filter(array_map('intval', explode(',', (string) $this->request->getGet('item_ids'))));
        $wh = (int) $this->request->getGet('warehouse_id') ?: null;
        if ($ids === []) {
            return $this->failStructured(400, 'validation_failed', 'item_ids is required (comma separated)');
        }
        $rows = (new StockBalanceService())->availability($cmpId, $ids, $wh, (int) $this->request->getGet('by_batch') === 1);

        return $this->respond(['data' => $rows]);
    }

    /** POST {lines:[{item_id, warehouse_id?, batch_id?, qty(base)}]} -> per line ok/short_by. */
    public function check()
    {
        $a = $this->authorizeAny(['reports.stock_summary.read', 'documents.read']);
        if (isset($a['response'])) {
            return $a['response'];
        }
        $cmpId = (int) $a['ctx']['cmp_id'];
        $body = $this->request->getJSON(true) ?? [];
        $svc = new StockBalanceService();
        $out = [];
        $allOk = true;
        foreach ((array) ($body['lines'] ?? []) as $i => $line) {
            $itemId = (int) ($line['item_id'] ?? 0);
            $qty = (float) ($line['qty'] ?? 0);
            $bal = $svc->balance($cmpId, $itemId, isset($line['warehouse_id']) ? (int) $line['warehouse_id'] : null, isset($line['batch_id']) ? (int) $line['batch_id'] : null);
            $ok = $bal['available'] + 0.0001 >= $qty;
            $allOk = $allOk && $ok;
            $out[] = ['index' => $i, 'item_id' => $itemId, 'requested' => $qty, 'available' => $bal['available'], 'on_hand' => $bal['on_hand'], 'ok' => $ok, 'short_by' => $ok ? 0 : round($qty - $bal['available'], 4)];
        }

        return $this->respond(['data' => ['ok' => $allOk, 'lines' => $out]]);
    }

    public function balances()
    {
        $a = $this->authorizeAny(['reports.stock_summary.read', 'reports.warehouse_stock.read', 'documents.read']);
        if (isset($a['response'])) {
            return $a['response'];
        }
        $cmpId = (int) $a['ctx']['cmp_id'];
        $p = $this->listParams(100, 1000);
        $db = \Config\Database::connect();
        $b = $db->table('inv_stock_balances b')
            ->select('b.*, i.item_name, i.item_sku, w.warehouse_name, bt.batch_no, (b.on_hand_qty - b.reserved_qty - b.packed_qty - b.quality_hold_qty - b.damaged_qty - b.blocked_qty) AS available_qty', false)
            ->join('inv_items i', 'i.item_id = b.item_id', 'left')
            ->join('inv_warehouses w', 'w.warehouse_id = b.warehouse_id', 'left')
            ->join('inv_batches bt', 'bt.batch_id = b.batch_id', 'left')
            ->where('b.cmp_id', $cmpId);
        if ($wh = (int) $this->request->getGet('warehouse_id')) {
            $b->where('b.warehouse_id', $wh);
        }
        if ($item = (int) $this->request->getGet('item_id')) {
            $b->where('b.item_id', $item);
        }
        if ((int) $this->request->getGet('nonzero') === 1) {
            $b->groupStart()->where('b.on_hand_qty !=', 0)->orWhere('b.reserved_qty !=', 0)->orWhere('b.packed_qty !=', 0)->orWhere('b.job_worker_qty !=', 0)->groupEnd();
        }
        $total = (clone $b)->countAllResults(false);
        $rows = $b->orderBy('i.item_name', 'ASC')->orderBy('w.warehouse_name', 'ASC')->limit($p['limit'], $p['offset'])->get()->getResultArray();

        return $this->respondList($rows, $total, $p['limit'], $p['offset']);
    }
}
