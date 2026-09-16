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
    /** Documents one bulk line read may ask about — the list endpoint's own page ceiling. */
    private const MAX_LINE_DOCUMENTS = 500;

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
        // warehouse_id: any line posting to / from the warehouse, or a transfer header naming it.
        if ($warehouseId = (int) $this->request->getGet('warehouse_id')) {
            $b->groupStart()
                ->where('d.from_warehouse_id', $warehouseId)
                ->orWhere('d.to_warehouse_id', $warehouseId)
                ->orWhereIn('d.document_id', static fn ($s) => $s->select('document_id')->from('inv_document_lines')->groupStart()->where('warehouse_id', $warehouseId)->orWhere('dest_warehouse_id', $warehouseId)->groupEnd())
                ->groupEnd();
        }
        $total = (clone $b)->countAllResults(false);
        // Aggregate over the WHOLE filtered set, not the page. Opt-in, because a
        // caller walking every page for an export would otherwise re-run it once
        // per page for figures it already has.
        $summary = ((int) ($this->request->getGet('summary') ?? 0) === 1)
            ? self::summarise($b, $total)
            : null;
        $sort = in_array($p['sort'], ['document_date', 'document_no', 'document_type', 'status', 'created_at', 'document_id'], true) ? $p['sort'] : 'document_date';
        $rows = $b->select('d.document_id, d.document_uuid, d.document_type, d.document_no, d.document_date, d.status, d.source_app, d.source_document_type, d.source_document_id, d.source_document_uuid, d.source_document_no, d.party_ref, d.party_name, d.from_warehouse_id, d.to_warehouse_id, d.narration, d.posted_at, d.created_at, d.fy_id, d.bo_id, (SELECT COUNT(*) FROM inv_document_lines l WHERE l.document_id = d.document_id) AS line_count, (SELECT COALESCE(SUM(l.valuation_amount),0) FROM inv_document_lines l WHERE l.document_id = d.document_id) AS valuation_total', false)
            ->orderBy('d.' . $sort, $p['order'])->orderBy('d.document_id', 'DESC')
            ->limit($p['limit'], $p['offset'])->get();
        // DBDebug is FALSE in production: ->get() returns FALSE on error and getResultArray() on
        // false is fatal. This is the documents register's own read, so a failure here is a blank
        // 500 on the screen the whole app now enters documents through.
        if ($rows === false) {
            return $this->failStructured(500, 'query_failed', 'Could not read the documents for this company');
        }
        $rows = $rows->getResultArray();
        foreach ($rows as &$r) {
            $r['document_type_label'] = DocumentTypeRegistry::get($r['document_type'])['label'] ?? $r['document_type'];
        }

        return $this->respondList($rows, $total, $p['limit'], $p['offset'], $summary === null ? [] : ['summary' => $summary]);
    }

    /**
     * The register's figures for every matching document, not the page on screen.
     *
     * `index()` already answers rows and a count, and the screen used to total
     * the fifty rows it was served and label every figure "this page only" —
     * honest, but useless on a register of four thousand documents, and no
     * answer at all for "how many warehouses did this touch".
     *
     * Two reads, both over the same filtered builder, neither of them per-row:
     *
     *  1. documents joined to their lines once — the line count and the
     *     valuation (SUM of inv_document_lines.valuation_amount: what the stock
     *     COST, never the commercial amount agreed with the party, which is the
     *     Books voucher's and is deliberately not here).
     *  2. the distinct (warehouse, destination warehouse) pairs those lines
     *     name, folded into a set here. Distinct pairs are bounded by the
     *     company's warehouse count squared — tens of rows, not millions — so
     *     the exact answer costs one small result set rather than a
     *     COUNT(DISTINCT) that cannot union two columns.
     *
     * Stock moves at the LINE, so the line warehouses are the whole truth: a
     * transfer header's from / to are copied down into its lines. A document
     * with no lines impacts no warehouse and contributes nothing, which is
     * correct rather than a gap.
     *
     * DBDebug is FALSE in production, so a failed ->get() returns FALSE rather
     * than throwing. The summary is an enrichment: if either read fails the
     * register still gets its rows and falls back to totalling the page it was
     * served, which it already labels as such. Losing the list over a KPI would
     * be the worse trade.
     *
     * Public and static for the same reason ValuationController::sortSnapshotRows
     * is: the SQL IS the behaviour here, and the only way to hold it is to run it
     * against a real PostgreSQL (DocumentsSummaryTest).
     *
     * @param \CodeIgniter\Database\BaseBuilder $b filtered documents, unpaged
     * @return array<string, float|int>|null
     */
    public static function summarise($b, int $total): ?array
    {
        $agg = (clone $b)
            ->join('inv_document_lines l', 'l.document_id = d.document_id', 'left')
            ->select('COUNT(l.line_id) AS line_count, COALESCE(SUM(l.valuation_amount),0) AS valuation_total', false)
            ->get();
        if ($agg === false) {
            return null;
        }
        $agg = $agg->getRowArray() ?: [];

        $pairs = (clone $b)
            ->join('inv_document_lines l', 'l.document_id = d.document_id', 'inner')
            ->select('l.warehouse_id, l.dest_warehouse_id')
            ->distinct()
            ->get();
        if ($pairs === false) {
            return null;
        }
        $warehouses = [];
        foreach ($pairs->getResultArray() as $pair) {
            foreach (['warehouse_id', 'dest_warehouse_id'] as $k) {
                if ($pair[$k] !== null && $pair[$k] !== '') {
                    $warehouses[(int) $pair[$k]] = true;
                }
            }
        }

        return [
            'documents'           => $total,
            'line_count'          => (int) ($agg['line_count'] ?? 0),
            'valuation_total'     => round((float) ($agg['valuation_total'] ?? 0), 4),
            'warehouses_impacted' => count($warehouses),
        ];
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

    /**
     * Lines for several documents in one call.
     *
     * The bulk form of show(): a reader that needs the lines of every document in a set — Books
     * building ITC-04 out of a quarter of job-work challans — otherwise spends one request and one
     * API timeout per document, inside the report request that is waiting for them.
     */
    public function lines()
    {
        $a = $this->authorize('documents.read');
        if (isset($a['response'])) {
            return $a['response'];
        }
        $ids = self::documentIdsParam($this->request->getGet('document_ids'));
        if ($ids === []) {
            return $this->failStructured(400, 'validation_failed', 'document_ids is required');
        }
        if (count($ids) > self::MAX_LINE_DOCUMENTS) {
            return $this->failStructured(422, 'validation_failed', 'document_ids takes at most ' . self::MAX_LINE_DOCUMENTS . ' documents per call', ['limit' => self::MAX_LINE_DOCUMENTS]);
        }
        $byDoc = $this->documents->linesForDocuments((int) $a['ctx']['cmp_id'], $ids);
        // Answer for every id asked about, so the caller reads "this document has no lines" and
        // "this document is not yours" the same way: as nothing, never as a gap in the response.
        $data = [];
        foreach ($ids as $id) {
            $data[$id] = $byDoc[$id] ?? [];
        }

        return $this->respond(['data' => $data, 'meta' => ['documents' => count($data)]]);
    }

    /**
     * @param mixed $raw comma-separated list or array of document ids
     * @return list<int> distinct, in the order asked for
     */
    private static function documentIdsParam($raw): array
    {
        $ids = [];
        foreach (is_array($raw) ? $raw : explode(',', (string) $raw) as $part) {
            $id = (int) trim((string) $part);
            if ($id > 0) {
                $ids[$id] = $id;
            }
        }

        return array_values($ids);
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
        // The stock half of another product's voucher may only be minted by that product's
        // service key. Otherwise any Inventory operator could hand Books an "invoice #123 was
        // issued at this cost" event and rewrite that voucher's COGS and inventory lines.
        if (($session['kind'] ?? '') !== 'service' && (DocumentTypeRegistry::get($type)['native'] ?? true) === false) {
            return $this->failStructured(403, 'forbidden', $type . ' documents are created by the owning product, not from an Inventory session');
        }
        $s = $this->resolveSourceApp($session, $body);
        if (isset($s['response'])) {
            return $s['response'];
        }
        $sourceApp = $s['app'];
        $cmpId = (int) $ctx['cmp_id'];
        $key = $this->idempotencyKey();
        $hash = IdempotencyService::hashRequest($body);
        if ($replay = $this->idempotency->replay($cmpId, $key, 'inventory_document', $hash)) {
            return $this->respond($replay['body'], $replay['status']);
        }
        // Duplicate-posting guard on the source document (retried invoices must never issue stock twice).
        if (!empty($body['source_document_id']) && !empty($body['source_document_type'])) {
            $existing = $this->documents->findBySource($cmpId, $sourceApp, (string) $body['source_document_type'], (int) $body['source_document_id']);
            if ($existing) {
                $existing['duplicate'] = true;
                $resp = ['data' => $existing, 'duplicate' => true];
                $this->idempotency->remember($cmpId, $key, 'inventory_document', (int) $existing['document_id'], (string) $existing['document_uuid'], 200, $resp, $hash);

                return $this->respond($resp, 200);
            }
        }
        try {
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

    /**
     * POST inventory-documents/{id}/challan-value — record the commercial value of a job-work
     * dispatch that is already posted, and nothing else.
     *
     * Body: {lines: [{line_id, rate?, amount?}, ...]}.
     *
     * Unlike revise(), a document whose source_app is 'books' is not held back here. The value is
     * not a Books-owned field being second-guessed: Books never had one to push — Job Work Out
     * migrated out of books_voucher_job_work_lines, which holds no rate or amount — and Books
     * refuses vch_type 6/7 at draft time, so the challan and its value live here or nowhere.
     */
    public function challanValue($id = null)
    {
        $a = $this->authorizeAny(['documents.edit', 'documents.create']);
        if (isset($a['response'])) {
            return $a['response'];
        }
        try {
            $body = $this->request->getJSON(true) ?? [];

            return $this->respond(['data' => $this->documents->amendChallanValue((int) $a['ctx']['cmp_id'], (int) $id, $body, $a['session']['uuid'])]);
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

    /**
     * POST inventory-documents/{id}/revise — reverse + re-create + post in one transaction.
     * Body: the create payload (lines, metadata, …) plus optional reason. Idempotent on the
     * Idempotency-Key and request hash like createAndPost.
     */
    public function revise($id = null)
    {
        $a = $this->authorize(null);
        if (isset($a['response'])) {
            return $a['response'];
        }
        $ctx = $a['ctx'];
        $session = $a['session'];
        $cmpId = (int) $ctx['cmp_id'];
        try {
            $current = $this->documents->get($cmpId, (int) $id);
        } catch (\Throwable $e) {
            return $this->failFromException($e);
        }
        $perm = $this->authorizeAny([PermissionRegistry::documentPermission((string) $current['document_type'], 'reverse'), 'documents.reverse']);
        if (isset($perm['response'])) {
            return $perm['response'];
        }
        $body = $this->request->getJSON(true) ?? [];
        // A revision keeps the document's identity, so its owner is the stored source_app —
        // never a body field. A human Inventory session may not revise another product's
        // document at all; that belongs to the product that created it.
        $currentApp = strtolower((string) ($current['source_app'] ?? 'inventory'));
        if (($session['kind'] ?? '') !== 'service' && $currentApp !== 'inventory') {
            return $this->failStructured(403, 'forbidden', 'This document belongs to ' . $currentApp . ' and is revised from there, not from an Inventory session');
        }
        $s = $this->resolveSourceApp($session, $body, $currentApp);
        if (isset($s['response'])) {
            return $s['response'];
        }
        $sourceApp = $s['app'];
        $key = $this->idempotencyKey();
        $hash = IdempotencyService::hashRequest($body);
        if ($replay = $this->idempotency->replay($cmpId, $key, 'inventory_document_revise', $hash)) {
            return $this->respond($replay['body'], $replay['status']);
        }
        try {
            $body['document_type'] = $body['document_type'] ?? $current['document_type'];
            $body['idempotency_key'] = $key;
            $doc = $this->posting->revise($ctx, (int) $id, $body, $session['uuid'], (string) ($body['reason'] ?? ''), $sourceApp, [
                'session' => $session, 'actor' => $session['uuid'],
                'negative_override' => !empty($body['negative_override']),
                'skip_approval' => ($session['kind'] ?? '') === 'service',
                'fy_range' => $body['fy_range'] ?? null,
            ]);
            $resp = ['data' => $doc, 'duplicate' => false];
            $this->idempotency->remember($cmpId, $key, 'inventory_document_revise', (int) $doc['document_id'], (string) $doc['document_uuid'], 201, $resp, $hash);

            return $this->respond($resp, 201);
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
