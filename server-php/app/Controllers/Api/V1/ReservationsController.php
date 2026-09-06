<?php

namespace App\Controllers\Api\V1;

use App\Controllers\Api\BaseController;
use App\Services\IdempotencyService;
use App\Services\ReservationService;
use App\Services\StockBalanceService;

/**
 * /api/v1/reservations — soft allocation of available stock to an order / invoice draft.
 *
 * Quantities are in the item's BASE unit. Create is idempotent through Idempotency-Key and
 * through the (source_app, source_document_type, source_document_id, item, warehouse, batch)
 * guard: a retried order line never reserves twice.
 */
class ReservationsController extends BaseController
{
    protected ReservationService $reservations;
    protected IdempotencyService $idempotency;

    public function __construct()
    {
        parent::__construct();
        $this->reservations = new ReservationService();
        $this->idempotency = new IdempotencyService();
    }

    public function index()
    {
        $a = $this->authorizeAny(['documents.reservation.read', 'documents.read']);
        if (isset($a['response'])) {
            return $a['response'];
        }
        $ctx = $a['ctx'];
        $p = $this->listParams(50, 500, 'created_at');
        $b = $this->reservations->baseQuery((int) $ctx['cmp_id']);
        if ((int) ($this->request->getGet('all_fy') ?? 0) !== 1) {
            $b->where('r.fy_id', $ctx['fy_id']);
        }
        if ($ctx['bo_id'] > 0) {
            $b->where('r.bo_id', $ctx['bo_id']);
        }
        $status = trim((string) $this->request->getGet('status'));
        if ($status !== '') {
            $b->whereIn('r.status', array_map(static fn ($s) => strtolower(trim($s)), explode(',', $status)));
        } elseif ((int) ($this->request->getGet('open') ?? 0) === 1) {
            $b->whereIn('r.status', ReservationService::OPEN_STATUSES);
        }
        foreach (['item_id' => 'r.item_id', 'warehouse_id' => 'r.warehouse_id', 'batch_id' => 'r.batch_id', 'document_id' => 'r.document_id', 'source_document_id' => 'r.source_document_id'] as $q => $col) {
            if ($v = (int) $this->request->getGet($q)) {
                $b->where($col, $v);
            }
        }
        foreach (['source_app' => 'r.source_app', 'source_document_type' => 'r.source_document_type', 'source_document_uuid' => 'r.source_document_uuid'] as $q => $col) {
            $v = trim((string) $this->request->getGet($q));
            if ($v !== '') {
                $b->where($col, $q === 'source_app' ? strtolower($v) : $v);
            }
        }
        if ((int) ($this->request->getGet('expired') ?? 0) === 1) {
            $b->whereIn('r.status', ReservationService::OPEN_STATUSES)->where('r.expires_at <', date('Y-m-d H:i:s'));
        }
        $total = (clone $b)->countAllResults(false);
        $sortMap = ['created_at' => 'r.created_at', 'updated_at' => 'r.updated_at', 'expires_at' => 'r.expires_at', 'reservation_id' => 'r.reservation_id', 'qty' => 'r.qty', 'status' => 'r.status', 'item_name' => 'i.item_name', 'warehouse_name' => 'w.warehouse_name'];
        $rows = $b->orderBy($sortMap[$p['sort']] ?? 'r.created_at', $p['sort'] === '' ? 'DESC' : $p['order'])->orderBy('r.reservation_id', 'DESC')
            ->limit($p['limit'], $p['offset'])->get()->getResultArray();

        return $this->respondList(array_map([$this->reservations, 'present'], $rows), $total, $p['limit'], $p['offset']);
    }

    /**
     * POST {item_id, qty(base), warehouse_id?, batch_id?, document_id?, source_app?, source_document_type?,
     *       source_document_id?, source_document_uuid?, expires_at?}
     */
    public function create()
    {
        $a = $this->authorizeAny(['documents.reservation.create', 'documents.create']);
        if (isset($a['response'])) {
            return $a['response'];
        }
        $ctx = $a['ctx'];
        $session = $a['session'];
        $cmpId = (int) $ctx['cmp_id'];
        $body = $this->request->getJSON(true) ?? [];
        $key = $this->idempotencyKey();
        $hash = IdempotencyService::hashRequest($body);
        if ($replay = $this->idempotency->replay($cmpId, $key, 'inventory_reservation', $hash)) {
            return $this->respond($replay['body'], $replay['status']);
        }
        $sourceApp = strtolower((string) ($body['source_app'] ?? $session['source_app'] ?? 'inventory'));
        // Duplicate guard on the source line: a retried order never reserves the same stock twice.
        if (!empty($body['source_document_id']) && !empty($body['source_document_type']) && (int) ($body['item_id'] ?? 0) > 0) {
            $existing = $this->reservations->findOpenBySource(
                $cmpId, $sourceApp, (string) $body['source_document_type'], (int) $body['source_document_id'], (int) $body['item_id'],
                isset($body['warehouse_id']) ? (int) $body['warehouse_id'] : null, isset($body['batch_id']) ? (int) $body['batch_id'] : null,
            );
            if ($existing) {
                $resp = ['data' => $this->withBalance($cmpId, $existing), 'duplicate' => true];
                $this->idempotency->remember($cmpId, $key, 'inventory_reservation', (int) $existing['reservation_id'], (string) $existing['reservation_uuid'], 200, $resp, $hash);

                return $this->respond($resp, 200);
            }
        }
        try {
            $res = $this->reservations->reserve($ctx, $body, $session['uuid'], $sourceApp);
            $resp = ['data' => $this->withBalance($cmpId, $res), 'duplicate' => false];
            $this->idempotency->remember($cmpId, $key, 'inventory_reservation', (int) $res['reservation_id'], (string) $res['reservation_uuid'], 201, $resp, $hash);

            return $this->respond($resp, 201);
        } catch (\Throwable $e) {
            return $this->failFromException($e);
        }
    }

    /** POST {qty?(base, default: whole open remainder), reason?} */
    public function release($id = null)
    {
        $a = $this->authorizeAny(['documents.reservation_release.create', 'documents.reservation.edit', 'documents.create']);
        if (isset($a['response'])) {
            return $a['response'];
        }
        $cmpId = (int) $a['ctx']['cmp_id'];
        $key = $this->idempotencyKey();
        if ($replay = $this->idempotency->replay($cmpId, $key, 'inventory_reservation_release')) {
            return $this->respond($replay['body'], $replay['status']);
        }
        try {
            $body = $this->request->getJSON(true) ?? [];
            $qty = isset($body['qty']) && $body['qty'] !== '' && $body['qty'] !== null ? (float) $body['qty'] : null;
            $res = $this->reservations->release($cmpId, (int) $id, $a['session']['uuid'], $qty, isset($body['reason']) ? (string) $body['reason'] : null);
            $resp = ['data' => $this->withBalance($cmpId, $res), 'duplicate' => false];
            $this->idempotency->remember($cmpId, $key, 'inventory_reservation_release', (int) $res['reservation_id'], (string) $res['reservation_uuid'], 200, $resp);

            return $this->respond($resp);
        } catch (\Throwable $e) {
            return $this->failFromException($e);
        }
    }

    /** POST {qty?(base, default: whole open remainder), document_id?, release_remainder?(default true), reason?} */
    public function fulfil($id = null)
    {
        $a = $this->authorizeAny(['documents.reservation.post', 'documents.reservation.edit', 'documents.create']);
        if (isset($a['response'])) {
            return $a['response'];
        }
        $cmpId = (int) $a['ctx']['cmp_id'];
        $key = $this->idempotencyKey();
        if ($replay = $this->idempotency->replay($cmpId, $key, 'inventory_reservation_fulfil')) {
            return $this->respond($replay['body'], $replay['status']);
        }
        try {
            $body = $this->request->getJSON(true) ?? [];
            $qty = isset($body['qty']) && $body['qty'] !== '' && $body['qty'] !== null ? (float) $body['qty'] : null;
            $options = [
                'document_id'       => isset($body['document_id']) ? (int) $body['document_id'] : null,
                'release_remainder' => array_key_exists('release_remainder', $body) ? !empty($body['release_remainder']) : true,
                'reason'            => isset($body['reason']) ? (string) $body['reason'] : null,
            ];
            $res = $this->reservations->fulfil($cmpId, (int) $id, $a['session']['uuid'], $qty, $options);
            $resp = ['data' => $this->withBalance($cmpId, $res), 'duplicate' => false];
            $this->idempotency->remember($cmpId, $key, 'inventory_reservation_fulfil', (int) $res['reservation_id'], (string) $res['reservation_uuid'], 200, $resp);

            return $this->respond($resp);
        } catch (\Throwable $e) {
            return $this->failFromException($e);
        }
    }

    /** Attach the live balance for the reservation's (item, warehouse, batch) so callers see the effect. */
    private function withBalance(int $cmpId, array $res): array
    {
        $res['balance'] = (new StockBalanceService())->balance($cmpId, (int) $res['item_id'], $res['warehouse_id'] !== null ? (int) $res['warehouse_id'] : null, $res['batch_id'] !== null ? (int) $res['batch_id'] : null);

        return $res;
    }
}
