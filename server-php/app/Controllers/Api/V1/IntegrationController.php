<?php

namespace App\Controllers\Api\V1;

use App\Controllers\Api\BaseController;
use App\Services\AuditService;
use App\Services\DocumentPostingService;
use App\Services\DocumentService;
use App\Services\InventorySettingsService;
use App\Services\OutboxService;

/**
 * /api/v1/integration — Books -> Inventory inbound events and the Inventory -> Books outbox.
 *
 *   POST integration/events                  inbound (service key only; dedup by event_uuid)
 *   GET  integration/outbox                  outbox events (status / event_type filters)
 *   POST integration/outbox/{id}/replay      re-queue one event
 *   POST integration/outbox/dispatch         deliver due events now
 */
class IntegrationController extends BaseController
{
    public const EVENT_VOUCHER_CANCELLED = 'books.voucher.cancelled';
    public const EVENT_REVISION_ACKNOWLEDGED = 'books.valuation_revision.acknowledged';
    public const EVENT_COMPANY_DEFAULT_STOCK = 'books.company.default_stock';

    public const SUPPORTED_EVENTS = [self::EVENT_VOUCHER_CANCELLED, self::EVENT_REVISION_ACKNOWLEDGED, self::EVENT_COMPANY_DEFAULT_STOCK];
    private const OUTBOX_STATUSES = ['PENDING', 'SENT', 'ACKED', 'FAILED', 'DEAD'];
    private const SERVICE_ACTOR = 'service:books';

    protected OutboxService $outbox;
    protected AuditService $audit;

    public function __construct()
    {
        parent::__construct();
        $this->outbox = new OutboxService();
        $this->audit = new AuditService();
    }

    // ------------------------------------------------------------------ inbound

    /**
     * POST /integration/events  {event_uuid, event_type, cmp_id, payload}
     * Only a trusted product backend (X-Service-Key) may deliver events; user sessions get 403.
     */
    public function inbound()
    {
        // Service key only: a human session must never be able to fake a Books event.
        $probe = $this->auth();
        if ($probe === null) {
            return $this->failUnauthorized('Invalid or expired session');
        }
        if (($probe['kind'] ?? '') !== 'service') {
            return $this->failStructured(403, 'forbidden', 'Inbound integration events require a service key');
        }
        $a = $this->authorize(null, true, false);
        if (isset($a['response'])) {
            return $a['response'];
        }
        $session = $a['session'];
        $cmpId = (int) $a['ctx']['cmp_id'];
        $body = $this->parseOptionalRequestJson();
        $eventUuid = strtolower(trim((string) ($body['event_uuid'] ?? '')));
        $eventType = strtolower(trim((string) ($body['event_type'] ?? '')));
        $payload = is_array($body['payload'] ?? null) ? $body['payload'] : [];
        if ($eventUuid === '' || !preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/', $eventUuid)) {
            return $this->failStructured(422, 'validation_failed', 'event_uuid (UUID) is required');
        }
        if ($eventType === '') {
            return $this->failStructured(422, 'validation_failed', 'event_type is required');
        }
        $sourceApp = strtolower((string) ($session['source_app'] ?? 'books'));
        $db = \Config\Database::connect();

        // Dedupe: the same event delivered twice returns the recorded outcome.
        $existing = $db->table('inv_inbound_events')->where('event_uuid', $eventUuid)->get()->getRowArray();
        if ($existing) {
            return $this->respond(['data' => $this->presentInbound($existing), 'duplicate' => true], 200);
        }
        $now = date('Y-m-d H:i:s');
        try {
            $db->table('inv_inbound_events')->insert([
                'event_uuid' => $eventUuid, 'cmp_id' => $cmpId, 'source_app' => substr($sourceApp, 0, 24), 'event_type' => substr($eventType, 0, 64),
                'payload_json' => json_encode($payload, JSON_UNESCAPED_UNICODE), 'status' => 'RECEIVED', 'received_at' => $now,
            ]);
            $rowId = (int) $db->insertID();
        } catch (\Throwable) {
            // Lost the race on the unique index: another delivery of the same event is in flight or done.
            $existing = $db->table('inv_inbound_events')->where('event_uuid', $eventUuid)->get()->getRowArray();
            if ($existing) {
                return $this->respond(['data' => $this->presentInbound($existing), 'duplicate' => true], 200);
            }

            return $this->failStructured(500, 'internal_error', 'Could not record inbound event');
        }

        $status = 'PROCESSED';
        $result = null;
        $error = null;
        $httpStatus = 200;
        try {
            if (!in_array($eventType, self::SUPPORTED_EVENTS, true)) {
                $status = 'IGNORED';
                $httpStatus = 202;
                $result = ['reason' => 'unsupported_event_type', 'supported' => self::SUPPORTED_EVENTS];
            } else {
                $result = match ($eventType) {
                    self::EVENT_VOUCHER_CANCELLED => $this->handleVoucherCancelled($cmpId, $payload, $session),
                    self::EVENT_REVISION_ACKNOWLEDGED => $this->handleRevisionsAcknowledged($cmpId, $payload, $sourceApp),
                    self::EVENT_COMPANY_DEFAULT_STOCK => $this->handleDefaultStock($cmpId, $payload),
                };
                if (!empty($result['ignored'])) {
                    $status = 'IGNORED';
                    $httpStatus = 202;
                }
            }
        } catch (\Throwable $e) {
            $status = 'FAILED';
            $error = substr($e->getMessage(), 0, 2000);
            $db->table('inv_inbound_events')->where('id', $rowId)->update(['status' => $status, 'error' => $error, 'processed_at' => date('Y-m-d H:i:s')]);
            $this->audit->log($cmpId, 'inbound_event', $rowId, 'integration.inbound.failed', $session['uuid'] ?? self::SERVICE_ACTOR, ['source_app' => $sourceApp, 'event_type' => $eventType, 'event_uuid' => $eventUuid, 'reason' => $error]);

            return $this->failFromException($e);
        }
        $db->table('inv_inbound_events')->where('id', $rowId)->update([
            'status' => $status, 'result_json' => json_encode($result, JSON_UNESCAPED_UNICODE), 'error' => $error, 'processed_at' => date('Y-m-d H:i:s'),
        ]);
        $this->audit->log($cmpId, 'inbound_event', $rowId, 'integration.inbound.' . strtolower($status), $session['uuid'] ?? self::SERVICE_ACTOR, ['source_app' => $sourceApp, 'event_type' => $eventType, 'event_uuid' => $eventUuid, 'result' => $result]);
        $row = $db->table('inv_inbound_events')->where('id', $rowId)->get()->getRowArray();

        return $this->respond(['data' => $this->presentInbound($row ?: []), 'duplicate' => false], $httpStatus);
    }

    /**
     * books.voucher.cancelled {vch_txn_id, vch_uuid, reason, vch_type?}: reverse (posted) or cancel (draft) the
     * inventory document that mirrors the Books voucher.
     *
     * @return array<string, mixed>
     */
    private function handleVoucherCancelled(int $cmpId, array $payload, array $session): array
    {
        $vchTxnId = (int) ($payload['vch_txn_id'] ?? $payload['source_document_id'] ?? 0);
        $vchUuid = trim((string) ($payload['vch_uuid'] ?? $payload['source_document_uuid'] ?? ''));
        $reason = trim((string) ($payload['reason'] ?? ''));
        if ($vchTxnId <= 0 && $vchUuid === '') {
            throw new \RuntimeException('vch_txn_id or vch_uuid is required', 422);
        }
        $reason = $reason !== '' ? $reason : 'Cancelled in Books';
        $db = \Config\Database::connect();
        $b = $db->table('inv_documents')->select('document_id, status')->where('cmp_id', $cmpId)->where('source_app', 'books')
            ->whereNotIn('status', ['CANCELLED', 'FAILED']);
        $b->groupStart();
        $first = true;
        if ($vchTxnId > 0) {
            $b->where('source_document_id', $vchTxnId)->like('source_document_type', 'books.', 'after', null, true);
            $first = false;
        }
        if ($vchUuid !== '' && preg_match('/^[0-9a-fA-F-]{36}$/', $vchUuid)) {
            $first ? $b->where('source_document_uuid', $vchUuid) : $b->orWhere('source_document_uuid', $vchUuid);
        }
        $b->groupEnd();
        $docs = $b->orderBy('document_id', 'DESC')->get()->getResultArray();
        if ($docs === []) {
            return ['ignored' => true, 'reason' => 'no_inventory_document', 'vch_txn_id' => $vchTxnId ?: null, 'vch_uuid' => $vchUuid ?: null];
        }
        $documents = new DocumentService();
        $posting = new DocumentPostingService($documents);
        $out = [];
        foreach ($docs as $d) {
            $id = (int) $d['document_id'];
            $status = (string) $d['status'];
            if ($status === 'REVERSED') {
                $out[] = ['document_id' => $id, 'action' => 'already_reversed'];
                continue;
            }
            if (in_array($status, ['DRAFT', 'PENDING_APPROVAL', 'APPROVED'], true)) {
                $documents->cancelDraft($cmpId, $id, self::SERVICE_ACTOR, $reason);
                $out[] = ['document_id' => $id, 'action' => 'cancelled', 'previous_status' => $status];
                continue;
            }
            $reversed = $posting->reverse($cmpId, $id, self::SERVICE_ACTOR, $reason, ['session' => ['kind' => 'service', 'source_app' => 'books', 'uuid' => $session['uuid'] ?? self::SERVICE_ACTOR]]);
            $out[] = ['document_id' => $id, 'action' => !empty($reversed['duplicate']) ? 'already_reversed' : 'reversed', 'previous_status' => $status, 'document_uuid' => $reversed['document_uuid'] ?? null];
        }

        return ['documents' => $out, 'reason' => $reason];
    }

    /**
     * books.valuation_revision.acknowledged {revision_ids: []}
     *
     * @return array<string, mixed>
     */
    private function handleRevisionsAcknowledged(int $cmpId, array $payload, string $sourceApp): array
    {
        $ids = $payload['revision_ids'] ?? [];
        if (is_string($ids)) {
            $ids = explode(',', $ids);
        }
        $ids = is_array($ids) ? array_values(array_unique(array_filter(array_map('intval', $ids), static fn ($i) => $i > 0))) : [];
        if ($ids === []) {
            throw new \RuntimeException('revision_ids (non-empty array) is required', 422);
        }
        $db = \Config\Database::connect();
        $now = date('Y-m-d H:i:s');
        $acknowledged = 0;
        foreach (array_chunk($ids, 500) as $chunk) {
            $db->table('inv_valuation_revisions')->where('cmp_id', $cmpId)->whereIn('revision_id', $chunk)->where('acknowledged_at', null)
                ->update(['acknowledged_at' => $now, 'acknowledged_by_app' => substr($sourceApp, 0, 24)]);
            $acknowledged += (int) $db->affectedRows();
        }
        $known = [];
        foreach (array_chunk($ids, 500) as $chunk) {
            foreach ($db->table('inv_valuation_revisions')->select('revision_id')->where('cmp_id', $cmpId)->whereIn('revision_id', $chunk)->get()->getResultArray() as $r) {
                $known[] = (int) $r['revision_id'];
            }
        }

        return [
            'acknowledged'         => $acknowledged,
            'already_acknowledged' => max(0, count($known) - $acknowledged),
            'unknown_revision_ids' => array_values(array_diff($ids, $known)),
        ];
    }

    /**
     * books.company.default_stock {default_stock: FIFO|LIFO|WAC|AVG...}
     *
     * @return array<string, mixed>
     */
    private function handleDefaultStock(int $cmpId, array $payload): array
    {
        $raw = trim((string) ($payload['default_stock'] ?? $payload['default_valuation_method'] ?? ''));
        if ($raw === '') {
            throw new \RuntimeException('default_stock is required', 422);
        }
        $svc = new InventorySettingsService();
        $before = $svc->defaultValuationMethod($cmpId);
        $after = $svc->update($cmpId, ['default_valuation_method' => $raw], self::SERVICE_ACTOR);

        return ['default_valuation_method' => $after['default_valuation_method'] ?? InventorySettingsService::normalizeMethod($raw), 'previous' => $before, 'received' => $raw];
    }

    /** @return array<string, mixed> */
    private function presentInbound(array $row): array
    {
        if ($row === []) {
            return [];
        }
        $row['id'] = (int) $row['id'];
        $row['cmp_id'] = (int) $row['cmp_id'];
        $row['payload'] = json_decode((string) ($row['payload_json'] ?? ''), true);
        $row['result'] = json_decode((string) ($row['result_json'] ?? ''), true);
        unset($row['payload_json'], $row['result_json']);

        return $row;
    }

    // ------------------------------------------------------------------ outbox

    /** GET /integration/outbox?status=&event_type=&aggregate_type=&aggregate_id=&from=&to= */
    public function outbox()
    {
        $a = $this->authorize('integration.read', true, false);
        if (isset($a['response'])) {
            return $a['response'];
        }
        $cmpId = (int) $a['ctx']['cmp_id'];
        $p = $this->listParams(50, 500, 'event_id');
        if (!$this->request->getGet('order')) {
            $p['order'] = 'DESC';
        }
        $b = \Config\Database::connect()->table('inv_integration_events')->where('cmp_id', $cmpId);
        $status = strtoupper(trim((string) ($this->request->getGet('status') ?? '')));
        if ($status !== '') {
            $statuses = array_values(array_intersect(explode(',', $status), self::OUTBOX_STATUSES));
            if ($statuses === []) {
                return $this->failStructured(422, 'validation_failed', 'status must be one of ' . implode(', ', self::OUTBOX_STATUSES), ['allowed' => self::OUTBOX_STATUSES]);
            }
            $b->whereIn('status', $statuses);
        }
        $eventType = trim((string) ($this->request->getGet('event_type') ?? ''));
        if ($eventType !== '') {
            $b->whereIn('event_type', array_map('trim', explode(',', $eventType)));
        }
        $aggType = trim((string) ($this->request->getGet('aggregate_type') ?? ''));
        if ($aggType !== '') {
            $b->where('aggregate_type', $aggType);
        }
        if ($aggId = (int) ($this->request->getGet('aggregate_id') ?? 0)) {
            $b->where('aggregate_id', $aggId);
        }
        $target = trim((string) ($this->request->getGet('target_app') ?? ''));
        if ($target !== '') {
            $b->where('target_app', strtolower($target));
        }
        if ($from = $this->dateParam('from')) {
            $b->where('created_at >=', $from . ' 00:00:00');
        }
        if ($to = $this->dateParam('to')) {
            $b->where('created_at <=', $to . ' 23:59:59');
        }
        $total = (clone $b)->countAllResults(false);
        $sort = in_array($p['sort'], ['event_id', 'created_at', 'status', 'event_type', 'attempts', 'next_attempt_at', 'sent_at', 'acked_at'], true) ? $p['sort'] : 'event_id';
        $rows = $b->orderBy($sort, $p['order'])->orderBy('event_id', 'DESC')->limit($p['limit'], $p['offset'])->get()->getResultArray();
        $withPayload = (int) ($this->request->getGet('with_payload') ?? 0) === 1;

        return $this->respondList(array_map(fn ($r) => $this->presentOutbox($r, $withPayload), $rows), $total, $p['limit'], $p['offset']);
    }

    /** POST /integration/outbox/{id}/replay */
    public function replay($id = null)
    {
        $a = $this->authorize('integration.replay', true, false);
        if (isset($a['response'])) {
            return $a['response'];
        }
        $cmpId = (int) $a['ctx']['cmp_id'];
        $db = \Config\Database::connect();
        $row = $db->table('inv_integration_events')->where('cmp_id', $cmpId)->where('event_id', (int) $id)->get()->getRowArray();
        if (!$row) {
            return $this->failStructured(404, 'not_found', 'Outbox event not found');
        }
        if (!$this->outbox->replay($cmpId, (int) $id)) {
            return $this->failStructured(409, 'conflict', 'Outbox event could not be re-queued', ['status' => $row['status']]);
        }
        $this->audit->log($cmpId, 'integration_event', (int) $id, 'integration.outbox.replay', $a['session']['uuid'] ?? null, ['event_type' => $row['event_type'], 'previous_status' => $row['status']]);
        $row = $db->table('inv_integration_events')->where('event_id', (int) $id)->get()->getRowArray();

        return $this->respond(['data' => $this->presentOutbox($row ?: [], true)]);
    }

    /** POST /integration/outbox/dispatch {limit?} — deliver due events now (all companies; the dispatcher is global). */
    public function dispatch()
    {
        $a = $this->authorize('integration.replay', true, false);
        if (isset($a['response'])) {
            return $a['response'];
        }
        $body = $this->parseOptionalRequestJson();
        $limit = (int) ($body['limit'] ?? $this->request->getGet('limit') ?? 100);
        $limit = max(1, min(1000, $limit));
        try {
            $result = $this->outbox->dispatch($limit);
        } catch (\Throwable $e) {
            return $this->failFromException($e);
        }
        $this->audit->log((int) $a['ctx']['cmp_id'], 'integration_event', 0, 'integration.outbox.dispatch', $a['session']['uuid'] ?? null, ['limit' => $limit] + $result);

        return $this->respond(['data' => $result + ['limit' => $limit]]);
    }

    /** @return array<string, mixed> */
    private function presentOutbox(array $row, bool $withPayload): array
    {
        if ($row === []) {
            return [];
        }
        foreach (['event_id', 'cmp_id', 'aggregate_id', 'attempts'] as $k) {
            $row[$k] = (int) ($row[$k] ?? 0);
        }
        if ($withPayload) {
            $row['payload'] = json_decode((string) ($row['payload_json'] ?? ''), true);
        }
        unset($row['payload_json']);

        return $row;
    }

    private function dateParam(string $name): ?string
    {
        $v = trim((string) ($this->request->getGet($name) ?? ''));
        if ($v === '') {
            return null;
        }
        $ts = strtotime($v);

        return $ts === false ? null : date('Y-m-d', $ts);
    }
}
