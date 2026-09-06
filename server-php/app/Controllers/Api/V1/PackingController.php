<?php

namespace App\Controllers\Api\V1;

use App\Controllers\Api\BaseController;
use App\Services\IdempotencyService;
use App\Services\PackingService;

/**
 * /api/v1/packing-lists — PACKING documents with their packing state (inv_packing_meta).
 *
 * Lifecycle after posting: open -> locked (Books draft keyed against it) -> consumed (sale posted
 * from packing), or open -> unpacked (goods back to available stock).
 */
class PackingController extends BaseController
{
    protected PackingService $packing;
    protected IdempotencyService $idempotency;

    public function __construct()
    {
        parent::__construct();
        $this->packing = new PackingService();
        $this->idempotency = new IdempotencyService();
    }

    /**
     * Filters: party_ref (consignee), status (packing status csv: open,locked,consumed,unpacked;
     * `none` = not yet posted), doc_status (document status csv), warehouse_id, item_id, from, to, q, all_fy.
     */
    public function index()
    {
        $a = $this->authorizeAny(['documents.packing.read', 'documents.read']);
        if (isset($a['response'])) {
            return $a['response'];
        }
        $ctx = $a['ctx'];
        $p = $this->listParams(50, 500, 'document_date');
        $db = \Config\Database::connect();
        $b = $db->table('inv_documents d')
            ->join('inv_packing_meta pm', 'pm.document_id = d.document_id AND pm.cmp_id = d.cmp_id', 'left')
            ->where('d.cmp_id', $ctx['cmp_id'])->where('d.document_type', 'PACKING');
        if ((int) ($this->request->getGet('all_fy') ?? 0) !== 1) {
            $b->where('d.fy_id', $ctx['fy_id']);
        }
        if ($ctx['bo_id'] > 0) {
            $b->where('d.bo_id', $ctx['bo_id']);
        }
        if ($party = (int) $this->request->getGet('party_ref')) {
            $b->groupStart()->where('d.party_ref', $party)->orWhere('pm.consignee_ref', $party)->groupEnd();
        }
        $status = trim((string) $this->request->getGet('status'));
        if ($status !== '') {
            $wanted = array_map(static fn ($s) => strtolower(trim($s)), explode(',', $status));
            $known = array_values(array_intersect($wanted, PackingService::STATUSES));
            $b->groupStart();
            if ($known !== []) {
                $b->whereIn('pm.packing_status', $known);
            }
            if (in_array('none', $wanted, true)) {
                $known !== [] ? $b->orWhere('pm.document_id', null) : $b->where('pm.document_id', null);
            }
            $b->groupEnd();
        }
        if ($docStatus = trim((string) $this->request->getGet('doc_status'))) {
            $b->whereIn('d.status', array_map('strtoupper', explode(',', $docStatus)));
        }
        if ($from = $this->request->getGet('from')) {
            $b->where('d.document_date >=', $from);
        }
        if ($to = $this->request->getGet('to')) {
            $b->where('d.document_date <=', $to);
        }
        if ($q = trim((string) $this->request->getGet('q'))) {
            $b->groupStart()->like('d.document_no', $q)->orLike('d.party_name', $q)->orLike('pm.locked_by_external_ref', $q)->groupEnd();
        }
        $itemId = (int) $this->request->getGet('item_id');
        $warehouseId = (int) $this->request->getGet('warehouse_id');
        if ($itemId > 0 || $warehouseId > 0) {
            $cmpId = (int) $ctx['cmp_id'];
            $b->whereIn('d.document_id', static function ($s) use ($cmpId, $itemId, $warehouseId) {
                $s->select('document_id')->from('inv_document_lines')->where('cmp_id', $cmpId);
                if ($itemId > 0) {
                    $s->where('item_id', $itemId);
                }
                if ($warehouseId > 0) {
                    $s->where('warehouse_id', $warehouseId);
                }

                return $s;
            });
        }
        $total = (clone $b)->countAllResults(false);
        $sortMap = ['document_date' => 'd.document_date', 'document_no' => 'd.document_no', 'status' => 'd.status', 'packing_status' => 'pm.packing_status', 'created_at' => 'd.created_at', 'document_id' => 'd.document_id', 'party_name' => 'd.party_name', 'locked_at' => 'pm.locked_at'];
        $rows = $b->select('d.document_id, d.document_uuid, d.document_no, d.document_date, d.status, d.source_app, d.party_ref, d.party_name, d.from_warehouse_id, d.narration, d.posted_at, d.created_at, d.fy_id, d.bo_id, '
                . 'pm.consignee_ref, pm.packing_status, pm.locked_by_document_id, pm.locked_by_external_ref, pm.locked_at, pm.box_marks_json, '
                . '(SELECT COUNT(*) FROM inv_document_lines l WHERE l.document_id = d.document_id) AS line_count, '
                . '(SELECT COALESCE(SUM(l.base_qty),0) FROM inv_document_lines l WHERE l.document_id = d.document_id) AS total_base_qty', false)
            ->orderBy($sortMap[$p['sort']] ?? 'd.document_date', $p['order'])->orderBy('d.document_id', 'DESC')
            ->limit($p['limit'], $p['offset'])->get()->getResultArray();
        foreach ($rows as &$r) {
            $r['box_marks'] = json_decode((string) ($r['box_marks_json'] ?? ''), true);
            unset($r['box_marks_json']);
            $r['line_count'] = (int) $r['line_count'];
            $r['total_base_qty'] = round((float) $r['total_base_qty'], 4);
            $r['is_locked'] = $r['packing_status'] === PackingService::STATUS_LOCKED;
            $r['is_open'] = $r['packing_status'] === PackingService::STATUS_OPEN;
        }
        unset($r);

        return $this->respondList($rows, $total, $p['limit'], $p['offset']);
    }

    public function show($id = null)
    {
        $a = $this->authorizeAny(['documents.packing.read', 'documents.read']);
        if (isset($a['response'])) {
            return $a['response'];
        }
        try {
            return $this->respond(['data' => $this->packing->get((int) $a['ctx']['cmp_id'], (int) $id)]);
        } catch (\Throwable $e) {
            return $this->failFromException($e);
        }
    }

    /** POST {reason?} — packed goods back to available stock; 409 when locked / consumed / unpacked. */
    public function unpack($id = null)
    {
        $a = $this->authorizeAny(['documents.packing.reverse', 'documents.packing.edit', 'documents.reverse']);
        if (isset($a['response'])) {
            return $a['response'];
        }
        $cmpId = (int) $a['ctx']['cmp_id'];
        $key = $this->idempotencyKey();
        if ($replay = $this->idempotency->replay($cmpId, $key, 'inventory_packing_unpack')) {
            return $this->respond($replay['body'], $replay['status']);
        }
        try {
            $body = $this->request->getJSON(true) ?? [];
            $doc = $this->packing->unpack($cmpId, (int) $id, $a['session']['uuid'], isset($body['reason']) ? (string) $body['reason'] : null);
            $resp = ['data' => $doc, 'duplicate' => false];
            $this->idempotency->remember($cmpId, $key, 'inventory_packing_unpack', (int) $doc['document_id'], (string) $doc['document_uuid'], 200, $resp);

            return $this->respond($resp);
        } catch (\Throwable $e) {
            return $this->failFromException($e);
        }
    }

    /** POST {external_ref? (Books draft id), document_id? (inventory document holding the list)} */
    public function lock($id = null)
    {
        $a = $this->authorizeAny(['documents.packing.edit', 'documents.packing.post', 'documents.edit']);
        if (isset($a['response'])) {
            return $a['response'];
        }
        try {
            $body = $this->request->getJSON(true) ?? [];
            $ref = $body['external_ref'] ?? $body['locked_by_external_ref'] ?? $body['books_draft_id'] ?? null;
            $docId = $body['document_id'] ?? $body['locked_by_document_id'] ?? null;
            $doc = $this->packing->lock((int) $a['ctx']['cmp_id'], (int) $id, $a['session']['uuid'], $ref !== null ? (string) $ref : null, $docId !== null ? (int) $docId : null);

            return $this->respond(['data' => $doc]);
        } catch (\Throwable $e) {
            return $this->failFromException($e);
        }
    }

    /** POST {external_ref? (must match the holder unless force), force?} */
    public function unlock($id = null)
    {
        $a = $this->authorizeAny(['documents.packing.edit', 'documents.packing.post', 'documents.edit']);
        if (isset($a['response'])) {
            return $a['response'];
        }
        try {
            $body = $this->request->getJSON(true) ?? [];
            $ref = $body['external_ref'] ?? $body['locked_by_external_ref'] ?? $body['books_draft_id'] ?? null;
            $doc = $this->packing->unlock((int) $a['ctx']['cmp_id'], (int) $id, $a['session']['uuid'], $ref !== null ? (string) $ref : null, !empty($body['force']));

            return $this->respond(['data' => $doc]);
        } catch (\Throwable $e) {
            return $this->failFromException($e);
        }
    }
}
