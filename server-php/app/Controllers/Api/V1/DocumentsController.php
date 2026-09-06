<?php

namespace App\Controllers\Api\V1;

use App\Controllers\Api\BaseController;
use App\Exceptions\InventoryException;
use App\Services\DocumentPostingService;
use App\Services\DocumentService;
use App\Services\IdempotencyService;
use Config\DocumentTypeRegistry;
use Config\PermissionRegistry;

/**
 * /api/v1/inventory-documents — every stock document, native or sourced from Books/Sales/POS.
 */
class DocumentsController extends BaseController
{
    protected DocumentService $documents;
    protected DocumentPostingService $posting;
    protected IdempotencyService $idempotency;

    public function __construct()
    {
        parent::__construct();
        $this->documents = new DocumentService();
        $this->posting = new DocumentPostingService($this->documents);
        $this->idempotency = new IdempotencyService();
    }

    public function index()
    {
        $a = $this->authorize('documents.read');
        if (isset($a['response'])) {
            return $a['response'];
        }
        $ctx = $a['ctx'];
        $p = $this->listParams(50, 500, 'document_date');
        $db = \Config\Database::connect();
        $b = $db->table('inv_documents d')->where('d.cmp_id', $ctx['cmp_id']);
        if ((int) ($this->request->getGet('all_fy') ?? 0) !== 1) {
            $b->where('d.fy_id', $ctx['fy_id']);
        }
        if ($ctx['bo_id'] > 0) {
            $b->where('d.bo_id', $ctx['bo_id']);
        }
        foreach (['document_type' => 'd.document_type', 'status' => 'd.status', 'source_app' => 'd.source_app', 'party_ref' => 'd.party_ref', 'from_warehouse_id' => 'd.from_warehouse_id'] as $q => $col) {
            $v = $this->request->getGet($q);
            if ($v !== null && $v !== '') {
                if ($q === 'document_type' || $q === 'status') {
                    $b->whereIn($col, array_map('strtoupper', explode(',', (string) $v)));
                } else {
                    $b->where($col, $v);
                }
            }
        }
        if ($from = $this->request->getGet('from')) {
            $b->where('d.document_date >=', $from);
        }
        if ($to = $this->request->getGet('to')) {
            $b->where('d.document_date <=', $to);
        }
        if ($q = trim((string) $this->request->getGet('q'))) {
            $b->groupStart()->like('d.document_no', $q)->orLike('d.party_name', $q)->orLike('d.source_document_no', $q)->groupEnd();
        }
        if ($itemId = (int) $this->request->getGet('item_id')) {
            $b->whereIn('d.document_id', static fn ($s) => $s->select('document_id')->from('inv_document_lines')->where('item_id', $itemId));
        }
        $total = (clone $b)->countAllResults(false);
        $sort = in_array($p['sort'], ['document_date', 'document_no', 'document_type', 'status', 'created_at', 'document_id'], true) ? $p['sort'] : 'document_date';
        $rows = $b->select('d.document_id, d.document_uuid, d.document_type, d.document_no, d.document_date, d.status, d.source_app, d.source_document_type, d.source_document_id, d.source_document_uuid, d.source_document_no, d.party_ref, d.party_name, d.from_warehouse_id, d.to_warehouse_id, d.narration, d.posted_at, d.created_at, d.fy_id, d.bo_id, (SELECT COUNT(*) FROM inv_document_lines l WHERE l.document_id = d.document_id) AS line_count, (SELECT COALESCE(SUM(l.valuation_amount),0) FROM inv_document_lines l WHERE l.document_id = d.document_id) AS valuation_total', false)
            ->orderBy('d.' . $sort, $p['order'])->orderBy('d.document_id', 'DESC')
            ->limit($p['limit'], $p['offset'])->get()->getResultArray();
        foreach ($rows as &$r) {
            $r['document_type_label'] = DocumentTypeRegistry::get($r['document_type'])['label'] ?? $r['document_type'];
        }

        return $this->respondList($rows, $total, $p['limit'], $p['offset']);
    }

    public function show($id = null)
    {
        $a = $this->authorize('documents.read');
        if (isset($a['response'])) {
            return $a['response'];
        }
        try {
            return $this->respond(['data' => $this->documents->get((int) $a['ctx']['cmp_id'], (int) $id)]);
        } catch (\Throwable $e) {
            return $this->failFromException($e);
        }
    }

    public function bySource()
    {
        $a = $this->authorize('documents.read');
        if (isset($a['response'])) {
            return $a['response'];
        }
        $app = (string) $this->request->getGet('source_app');
        $type = (string) $this->request->getGet('source_document_type');
        $id = (int) $this->request->getGet('source_document_id');
        if ($app === '' || $type === '' || $id <= 0) {
            return $this->failStructured(400, 'validation_failed', 'source_app, source_document_type and source_document_id are required');
        }
        $doc = $this->documents->findBySource((int) $a['ctx']['cmp_id'], $app, $type, $id);

        return $doc ? $this->respond(['data' => $doc]) : $this->failStructured(404, 'not_found', 'No inventory document for that source');
    }

    public function byUuid($uuid = null)
    {
        $a = $this->authorize('documents.read');
        if (isset($a['response'])) {
            return $a['response'];
        }
        $doc = $this->documents->findByUuid((int) $a['ctx']['cmp_id'], (string) $uuid);

        return $doc ? $this->respond(['data' => $doc]) : $this->failStructured(404, 'not_found', 'Document not found');
    }

    public function create()
    {
        return $this->createInternal(false);
    }

    /** Create and post in one call — the shape Books / POS use for the stock half of a commercial voucher. */
    public function createAndPost()
    {
        return $this->createInternal(true);
    }

    private function createInternal(bool $andPost)
    {
        $body = $this->request->getJSON(true) ?? [];
        $type = strtoupper((string) ($body['document_type'] ?? ''));
        if (!DocumentTypeRegistry::isValid($type)) {
            return $this->failStructured(422, 'validation_failed', 'Unknown or missing document_type', ['allowed' => DocumentTypeRegistry::all()]);
        }
        $a = $this->authorizeAny([PermissionRegistry::documentPermission($type, $andPost ? 'post' : 'create'), 'documents.' . ($andPost ? 'post' : 'create')]);
        if (isset($a['response'])) {
            return $a['response'];
        }
        $ctx = $a['ctx'];
        $session = $a['session'];
        $cmpId = (int) $ctx['cmp_id'];
        $key = $this->idempotencyKey();
        $hash = IdempotencyService::hashRequest($body);
        if ($replay = $this->idempotency->replay($cmpId, $key, 'inventory_document', $hash)) {
            return $this->respond($replay['body'], $replay['status']);
        }
        // Duplicate-posting guard on the source document (retried invoices must never issue stock twice).
        if (!empty($body['source_document_id']) && !empty($body['source_document_type'])) {
            $existing = $this->documents->findBySource($cmpId, (string) ($body['source_app'] ?? $session['source_app']), (string) $body['source_document_type'], (int) $body['source_document_id']);
            if ($existing) {
                $existing['duplicate'] = true;
                $resp = ['data' => $existing, 'duplicate' => true];
                $this->idempotency->remember($cmpId, $key, 'inventory_document', (int) $existing['document_id'], (string) $existing['document_uuid'], 200, $resp, $hash);

                return $this->respond($resp, 200);
            }
        }
        try {
            $sourceApp = strtolower((string) ($body['source_app'] ?? $session['source_app'] ?? 'inventory'));
            $body['idempotency_key'] = $key;
            $doc = $this->documents->create($ctx, $body, $session['uuid'], $sourceApp);
            if ($andPost) {
                $doc = $this->posting->post($cmpId, (int) $doc['document_id'], $session['uuid'], [
                    'session' => $session, 'actor' => $session['uuid'],
                    'negative_override' => !empty($body['negative_override']),
                    'skip_approval' => ($session['kind'] ?? '') === 'service',
                    'fy_range' => $body['fy_range'] ?? null,
                ]);
            }
            $resp = ['data' => $doc, 'duplicate' => false];
            $this->idempotency->remember($cmpId, $key, 'inventory_document', (int) $doc['document_id'], (string) $doc['document_uuid'], 201, $resp, $hash);

            return $this->respond($resp, 201);
        } catch (\Throwable $e) {
            return $this->failFromException($e);
        }
    }

    public function update($id = null)
    {
        $a = $this->authorizeAny(['documents.edit', 'documents.create']);
        if (isset($a['response'])) {
            return $a['response'];
        }
        try {
            $body = $this->request->getJSON(true) ?? [];

            return $this->respond(['data' => $this->documents->update((int) $a['ctx']['cmp_id'], (int) $id, $body, $a['session']['uuid'])]);
        } catch (\Throwable $e) {
            return $this->failFromException($e);
        }
    }

    public function submit($id = null)
    {
        return $this->lifecycle($id, 'submit', ['documents.create', 'documents.edit']);
    }

    public function approve($id = null)
    {
        return $this->lifecycle($id, 'approve', ['documents.approve']);
    }

    public function reject($id = null)
    {
        return $this->lifecycle($id, 'reject', ['documents.approve']);
    }

    public function cancel($id = null)
    {
        return $this->lifecycle($id, 'cancelDraft', ['documents.edit', 'documents.create']);
    }

    private function lifecycle($id, string $method, array $perms)
    {
        $a = $this->authorizeAny($perms);
        if (isset($a['response'])) {
            return $a['response'];
        }
        try {
            $body = $this->request->getJSON(true) ?? [];
            $notes = $body['notes'] ?? $body['reason'] ?? null;

            return $this->respond(['data' => $this->documents->{$method}((int) $a['ctx']['cmp_id'], (int) $id, $a['session']['uuid'], $notes)]);
        } catch (\Throwable $e) {
            return $this->failFromException($e);
        }
    }

    public function post($id = null)
    {
        $a = $this->authorize(null);
        if (isset($a['response'])) {
            return $a['response'];
        }
        $cmpId = (int) $a['ctx']['cmp_id'];
        try {
            $doc = $this->documents->get($cmpId, (int) $id);
        } catch (\Throwable $e) {
            return $this->failFromException($e);
        }
        $perm = $this->authorizeAny([PermissionRegistry::documentPermission((string) $doc['document_type'], 'post'), 'documents.post']);
        if (isset($perm['response'])) {
            return $perm['response'];
        }
        $key = $this->idempotencyKey();
        if ($replay = $this->idempotency->replay($cmpId, $key, 'inventory_document_post')) {
            return $this->respond($replay['body'], $replay['status']);
        }
        try {
            $body = $this->request->getJSON(true) ?? [];
            $posted = $this->posting->post($cmpId, (int) $id, $a['session']['uuid'], ['session' => $a['session'], 'actor' => $a['session']['uuid'], 'negative_override' => !empty($body['negative_override']), 'fy_range' => $body['fy_range'] ?? null]);
            $resp = ['data' => $posted, 'duplicate' => !empty($posted['duplicate'])];
            $this->idempotency->remember($cmpId, $key, 'inventory_document_post', (int) $id, (string) $posted['document_uuid'], 200, $resp);

            return $this->respond($resp);
        } catch (\Throwable $e) {
            return $this->failFromException($e);
        }
    }

    public function reverse($id = null)
    {
        $a = $this->authorize(null);
        if (isset($a['response'])) {
            return $a['response'];
        }
        $cmpId = (int) $a['ctx']['cmp_id'];
        try {
            $doc = $this->documents->get($cmpId, (int) $id);
        } catch (\Throwable $e) {
            return $this->failFromException($e);
        }
        $perm = $this->authorizeAny([PermissionRegistry::documentPermission((string) $doc['document_type'], 'reverse'), 'documents.reverse']);
        if (isset($perm['response'])) {
            return $perm['response'];
        }
        $key = $this->idempotencyKey();
        if ($replay = $this->idempotency->replay($cmpId, $key, 'inventory_document_reverse')) {
            return $this->respond($replay['body'], $replay['status']);
        }
        try {
            $body = $this->request->getJSON(true) ?? [];
            $reversed = $this->posting->reverse($cmpId, (int) $id, $a['session']['uuid'], (string) ($body['reason'] ?? ''), ['session' => $a['session']]);
            $resp = ['data' => $reversed, 'duplicate' => !empty($reversed['duplicate'])];
            $this->idempotency->remember($cmpId, $key, 'inventory_document_reverse', (int) $id, (string) $reversed['document_uuid'], 200, $resp);

            return $this->respond($resp);
        } catch (\Throwable $e) {
            return $this->failFromException($e);
        }
    }

    public function printSnapshot($id = null)
    {
        $a = $this->authorize('documents.read');
        if (isset($a['response'])) {
            return $a['response'];
        }
        $row = \Config\Database::connect()->table('inv_document_snapshots')->where('cmp_id', (int) $a['ctx']['cmp_id'])->where('document_id', (int) $id)->get()->getRowArray();
        if (!$row) {
            return $this->failStructured(404, 'not_found', 'No print snapshot for this document');
        }
        foreach (['header_snapshot_json', 'source_dest_snapshot_json', 'item_lines_snapshot_json', 'transport_snapshot_json', 'variant_extras_snapshot_json', 'footer_snapshot_json'] as $k) {
            $row[str_replace('_json', '', $k)] = json_decode((string) ($row[$k] ?? ''), true);
            unset($row[$k]);
        }

        return $this->respond(['data' => $row]);
    }
}
