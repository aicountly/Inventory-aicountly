<?php

namespace App\Services;

use App\Exceptions\InventoryException;
use Config\DocumentTypeRegistry;

/**
 * Inventory document lifecycle: create / update drafts, submit / approve / reject, read.
 * Posting and reversal live in DocumentPostingService.
 */
class DocumentService
{
    public const EDITABLE_STATUSES = ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'FAILED'];

    public function __construct(
        protected ?UnitConversionService $units = null,
        protected ?AuditService $audit = null,
        protected ?InventorySettingsService $settings = null,
    ) {
        $this->units ??= new UnitConversionService();
        $this->audit ??= new AuditService();
        $this->settings ??= new InventorySettingsService();
    }

    /**
     * Create a document (status DRAFT) from an API payload.
     *
     * @param array<string, mixed> $ctx  cmp_id, fy_id, bo_id
     * @param array<string, mixed> $payload
     * @return array<string, mixed> document with lines
     */
    public function create(array $ctx, array $payload, ?string $actor, string $sourceApp = 'inventory'): array
    {
        $type = strtoupper(trim((string) ($payload['document_type'] ?? '')));
        $spec = DocumentTypeRegistry::get($type);
        if ($spec === null) {
            throw InventoryException::validation('Unknown document_type ' . $type, ['allowed' => DocumentTypeRegistry::all()]);
        }
        $cmpId = (int) $ctx['cmp_id'];
        $db = \Config\Database::connect();
        $now = date('Y-m-d H:i:s');
        $header = $this->headerFromPayload($cmpId, (int) $ctx['fy_id'], (int) $ctx['bo_id'], $type, $payload, $sourceApp);
        $lines = $this->normalizeLines($cmpId, $type, $spec, $payload, $header);
        if ($lines === [] && !in_array($spec['line_mode'], ['status_only'], true)) {
            throw InventoryException::validation('At least one item line is required');
        }

        $db->transStart();
        try {
            $header['created_by'] = $actor;
            $header['created_at'] = $now;
            $header['updated_by'] = $actor;
            $header['updated_at'] = $now;
            $header['status'] = 'DRAFT';
            DatabaseInsertHelper::insert($db, 'inv_documents', $header);
            $documentId = (int) $db->insertID();
            $this->writeLines($db, $documentId, $cmpId, (int) $ctx['fy_id'], (int) $ctx['bo_id'], $lines);
            $db->transComplete();
            if ($db->transStatus() === false) {
                throw new \RuntimeException('Could not create document', 500);
            }
        } catch (\Throwable $e) {
            $db->transRollback();
            $db->resetTransStatus();
            if (str_contains($e->getMessage(), 'uq_inv_documents_source')) {
                throw InventoryException::conflict('An inventory document already exists for this source document', ['source_document_type' => $header['source_document_type'], 'source_document_id' => $header['source_document_id']]);
            }
            throw $e;
        }
        $this->audit->log($cmpId, 'document', $documentId, 'document.create', $actor, ['source_app' => $sourceApp], null, ['document_type' => $type, 'lines' => count($lines)]);

        return $this->get($cmpId, $documentId);
    }

    /** @param array<string, mixed> $payload */
    public function update(int $cmpId, int $documentId, array $payload, ?string $actor): array
    {
        $doc = $this->get($cmpId, $documentId);
        if (!in_array($doc['status'], self::EDITABLE_STATUSES, true)) {
            throw InventoryException::invalidState('Only draft / approved documents can be edited (status ' . $doc['status'] . ')');
        }
        $type = (string) $doc['document_type'];
        $spec = DocumentTypeRegistry::get($type);
        $db = \Config\Database::connect();
        $header = $this->headerFromPayload($cmpId, (int) $doc['fy_id'], (int) $doc['bo_id'], $type, array_merge($doc, $payload), (string) $doc['source_app']);
        unset($header['document_uuid'], $header['status'], $header['source_app']);
        $lines = $this->normalizeLines($cmpId, $type, $spec, array_merge($doc, $payload), $header);
        $db->transStart();
        try {
            $header['updated_by'] = $actor;
            $header['updated_at'] = date('Y-m-d H:i:s');
            $header['version'] = (int) $doc['version'] + 1;
            if ($doc['status'] === 'APPROVED' || $doc['status'] === 'PENDING_APPROVAL') {
                $header['status'] = 'DRAFT'; // an edit invalidates the approval
                $header['approved_by'] = null;
                $header['approved_at'] = null;
            }
            $db->table('inv_documents')->where('document_id', $documentId)->where('cmp_id', $cmpId)->update($header);
            $db->table('inv_document_line_serials')->where('document_id', $documentId)->delete();
            $db->table('inv_document_lines')->where('document_id', $documentId)->delete();
            $this->writeLines($db, $documentId, $cmpId, (int) $doc['fy_id'], (int) $doc['bo_id'], $lines);
            $db->transComplete();
        } catch (\Throwable $e) {
            $db->transRollback();
            $db->resetTransStatus();
            throw $e;
        }
        $this->audit->log($cmpId, 'document', $documentId, 'document.update', $actor, [], ['version' => $doc['version']], ['version' => $header['version']]);

        return $this->get($cmpId, $documentId);
    }

    public function submit(int $cmpId, int $documentId, ?string $actor, ?string $notes = null): array
    {
        return $this->transition($cmpId, $documentId, ['DRAFT', 'FAILED'], 'PENDING_APPROVAL', 'submitted', $actor, $notes);
    }

    public function approve(int $cmpId, int $documentId, ?string $actor, ?string $notes = null): array
    {
        $doc = $this->transition($cmpId, $documentId, ['DRAFT', 'PENDING_APPROVAL'], 'APPROVED', 'approved', $actor, $notes);
        \Config\Database::connect()->table('inv_documents')->where('document_id', $documentId)->update(['approved_by' => $actor, 'approved_at' => date('Y-m-d H:i:s')]);

        return $this->get($cmpId, $documentId);
    }

    public function reject(int $cmpId, int $documentId, ?string $actor, ?string $notes = null): array
    {
        return $this->transition($cmpId, $documentId, ['PENDING_APPROVAL', 'APPROVED'], 'DRAFT', 'rejected', $actor, $notes);
    }

    public function cancelDraft(int $cmpId, int $documentId, ?string $actor, ?string $reason = null): array
    {
        $doc = $this->get($cmpId, $documentId);
        if (!in_array($doc['status'], self::EDITABLE_STATUSES, true)) {
            throw InventoryException::invalidState('Posted documents must be reversed, not cancelled');
        }
        \Config\Database::connect()->table('inv_documents')->where('document_id', $documentId)->update([
            'status' => 'CANCELLED', 'cancelled_by' => $actor, 'cancelled_at' => date('Y-m-d H:i:s'), 'cancel_reason' => $reason, 'updated_at' => date('Y-m-d H:i:s'),
        ]);
        $this->audit->log($cmpId, 'document', $documentId, 'document.cancel', $actor, ['reason' => $reason]);

        return $this->get($cmpId, $documentId);
    }

    /** @return array<string, mixed> */
    public function get(int $cmpId, int $documentId): array
    {
        $db = \Config\Database::connect();
        $doc = $db->table('inv_documents')->where('cmp_id', $cmpId)->where('document_id', $documentId)->get()->getRowArray();
        if (!$doc) {
            throw InventoryException::notFound('Document not found');
        }

        return $this->hydrate($doc);
    }

    /** @return array<string, mixed>|null */
    public function findBySource(int $cmpId, string $sourceApp, string $sourceDocumentType, int $sourceDocumentId): ?array
    {
        $db = \Config\Database::connect();
        $doc = $db->table('inv_documents')->where('cmp_id', $cmpId)->where('source_app', $sourceApp)
            ->where('source_document_type', $sourceDocumentType)->where('source_document_id', $sourceDocumentId)
            ->whereNotIn('status', ['CANCELLED', 'REVERSED', 'FAILED'])
            ->orderBy('document_id', 'DESC')->get()->getRowArray();

        return $doc ? $this->hydrate($doc) : null;
    }

    /** @return array<string, mixed>|null */
    public function findByUuid(int $cmpId, string $uuid): ?array
    {
        $doc = \Config\Database::connect()->table('inv_documents')->where('cmp_id', $cmpId)->where('document_uuid', $uuid)->get()->getRowArray();

        return $doc ? $this->hydrate($doc) : null;
    }

    /** @return array<string, mixed> */
    public function hydrate(array $doc): array
    {
        $db = \Config\Database::connect();
        $lines = $db->table('inv_document_lines l')
            ->select('l.*, i.item_name, i.print_name AS item_print_name, i.item_sku, u.unit_symbol, u.unit_name, w.warehouse_name, dw.warehouse_name AS dest_warehouse_name, b.batch_no, b.expiry_date')
            ->join('inv_items i', 'i.item_id = l.item_id', 'left')
            ->join('inv_uom u', 'u.unit_id = l.unit_id', 'left')
            ->join('inv_warehouses w', 'w.warehouse_id = l.warehouse_id', 'left')
            ->join('inv_warehouses dw', 'dw.warehouse_id = l.dest_warehouse_id', 'left')
            ->join('inv_batches b', 'b.batch_id = l.batch_id', 'left')
            ->where('l.document_id', (int) $doc['document_id'])
            ->orderBy('l.sort_order', 'ASC')->orderBy('l.line_id', 'ASC')
            ->get()->getResultArray();
        foreach ($lines as &$line) {
            $line['metadata'] = json_decode((string) ($line['metadata_json'] ?? ''), true) ?: null;
            unset($line['metadata_json']);
            foreach (['qty', 'base_qty', 'conversion_factor', 'source_transaction_rate', 'source_transaction_amount', 'valuation_rate', 'valuation_amount', 'landed_cost_amount', 'book_qty', 'physical_qty'] as $k) {
                if (array_key_exists($k, $line) && $line[$k] !== null) {
                    $line[$k] = (float) $line[$k];
                }
            }
            $line['item_label'] = $line['item_print_name'] ?: $line['item_name'];
        }
        unset($line);
        $serials = $db->table('inv_document_line_serials ls')->select('ls.line_id, s.serial_id, s.serial_no')->join('inv_serials s', 's.serial_id = ls.serial_id', 'left')
            ->where('ls.document_id', (int) $doc['document_id'])->get()->getResultArray();
        $byLine = [];
        foreach ($serials as $s) {
            $byLine[(int) $s['line_id']][] = ['serial_id' => (int) $s['serial_id'], 'serial_no' => $s['serial_no']];
        }
        foreach ($lines as &$line) {
            $line['serials'] = $byLine[(int) $line['line_id']] ?? [];
        }
        unset($line);
        $doc['metadata'] = json_decode((string) ($doc['metadata_json'] ?? ''), true) ?: null;
        $doc['accounting_effects'] = json_decode((string) ($doc['accounting_effects_json'] ?? ''), true) ?: [];
        unset($doc['metadata_json'], $doc['accounting_effects_json']);
        $doc['lines'] = $lines;
        $spec = DocumentTypeRegistry::get((string) $doc['document_type']);
        $doc['document_type_label'] = $spec['label'] ?? $doc['document_type'];

        return $doc;
    }

    // ------------------------------------------------------------------ helpers

    /** @return array<string, mixed> */
    private function headerFromPayload(int $cmpId, int $fyId, int $boId, string $type, array $p, string $sourceApp): array
    {
        $date = trim((string) ($p['document_date'] ?? $p['date'] ?? ''));
        if ($date === '' || !preg_match('/^\d{4}-\d{2}-\d{2}$/', $date)) {
            throw InventoryException::validation('document_date (YYYY-MM-DD) is required');
        }
        $h = [
            'cmp_id'               => $cmpId,
            'bo_id'                => $boId,
            'fy_id'                => $fyId,
            'document_type'        => $type,
            'document_no'          => isset($p['document_no']) ? substr(trim((string) $p['document_no']), 0, 64) : null,
            'series_id'            => isset($p['series_id']) && $p['series_id'] ? (int) $p['series_id'] : null,
            'document_date'        => $date,
            'source_app'           => $sourceApp,
            'source_document_type' => isset($p['source_document_type']) ? substr((string) $p['source_document_type'], 0, 48) : null,
            'source_document_id'   => isset($p['source_document_id']) && $p['source_document_id'] !== '' && $p['source_document_id'] !== null ? (int) $p['source_document_id'] : null,
            'source_document_uuid' => isset($p['source_document_uuid']) && $p['source_document_uuid'] ? (string) $p['source_document_uuid'] : null,
            'source_document_no'   => isset($p['source_document_no']) ? substr((string) $p['source_document_no'], 0, 64) : null,
            'source_document_date' => isset($p['source_document_date']) && preg_match('/^\d{4}-\d{2}-\d{2}/', (string) $p['source_document_date']) ? substr((string) $p['source_document_date'], 0, 10) : null,
            'party_ref'            => isset($p['party_ref']) && $p['party_ref'] ? (int) $p['party_ref'] : (isset($p['party']['acc_id']) && $p['party']['acc_id'] ? (int) $p['party']['acc_id'] : null),
            'party_name'           => isset($p['party_name']) ? substr((string) $p['party_name'], 0, 255) : (isset($p['party']['acc_name']) ? substr((string) $p['party']['acc_name'], 0, 255) : null),
            'dest_party_ref'       => isset($p['dest_party_ref']) && $p['dest_party_ref'] ? (int) $p['dest_party_ref'] : null,
            'from_warehouse_id'    => isset($p['from_warehouse_id']) && $p['from_warehouse_id'] ? (int) $p['from_warehouse_id'] : null,
            'to_warehouse_id'      => isset($p['to_warehouse_id']) && $p['to_warehouse_id'] ? (int) $p['to_warehouse_id'] : null,
            'dest_bo_id'           => isset($p['dest_bo_id']) && $p['dest_bo_id'] ? (int) $p['dest_bo_id'] : null,
            'stock_effect'         => isset($p['stock_effect']) && $p['stock_effect'] !== '' ? substr((string) $p['stock_effect'], 0, 32) : null,
            'returnable'           => isset($p['returnable']) ? (bool) $p['returnable'] : null,
            'expected_return_date' => isset($p['expected_return_date']) && preg_match('/^\d{4}-\d{2}-\d{2}/', (string) $p['expected_return_date']) ? substr((string) $p['expected_return_date'], 0, 10) : null,
            'movement_reason'      => isset($p['movement_reason']) ? substr((string) $p['movement_reason'], 0, 64) : null,
            'reason_code'          => isset($p['reason_code']) ? substr((string) $p['reason_code'], 0, 32) : null,
            'narration'            => isset($p['narration']) ? (string) $p['narration'] : null,
            'currency_code'        => isset($p['currency_code']) && $p['currency_code'] ? substr((string) $p['currency_code'], 0, 8) : 'INR',
            'exchange_rate'        => isset($p['exchange_rate']) && (float) $p['exchange_rate'] > 0 ? (float) $p['exchange_rate'] : 1,
            'metadata_json'        => isset($p['metadata']) && is_array($p['metadata']) ? json_encode($p['metadata'], JSON_UNESCAPED_UNICODE) : null,
            'idempotency_key'      => isset($p['idempotency_key']) ? substr((string) $p['idempotency_key'], 0, 128) : null,
        ];
        if ($type === 'STOCK_TRANSFER') {
            if (!$h['from_warehouse_id'] || !$h['to_warehouse_id']) {
                throw InventoryException::validation('Source and destination warehouses are required for a stock transfer');
            }
            if ($h['from_warehouse_id'] === $h['to_warehouse_id']) {
                throw InventoryException::validation('Source and destination warehouses must be different');
            }
        }
        if (in_array($type, ['DELIVERY_CHALLAN', 'INWARD_CHALLAN'], true) && $h['stock_effect'] === null) {
            $h['stock_effect'] = 'challan_only';
        }
        if (in_array($type, ['SALES_ISSUE', 'PURCHASE_RECEIPT', 'SALES_RETURN', 'PURCHASE_RETURN'], true) && $h['stock_effect'] === null) {
            $h['stock_effect'] = 'on_invoice';
        }

        return $h;
    }

    /**
     * Normalise the lines of a payload into storable rows (entered unit + base unit + direction).
     *
     * @return list<array<string, mixed>>
     */
    private function normalizeLines(int $cmpId, string $type, array $spec, array $p, array $header): array
    {
        $raw = $p['lines'] ?? $p['inventory_lines'] ?? $p['packing_lines'] ?? $p['job_work_lines'] ?? [];
        if (!is_array($raw)) {
            $raw = [];
        }
        $this->units->warmCompany($cmpId);
        $db = \Config\Database::connect();
        $out = [];
        $sort = 0;
        foreach ($raw as $idx => $line) {
            if (!is_array($line)) {
                continue;
            }
            $itemId = (int) ($line['item_id'] ?? 0);
            $qty = (float) ($line['qty'] ?? 0);
            if ($itemId <= 0) {
                throw InventoryException::validation('Line ' . ($idx + 1) . ': item_id is required');
            }
            $countDirection = null;
            if ($type === 'PHYSICAL_ADJUSTMENT' && $qty <= 0 && isset($line['book_qty'], $line['physical_qty']) && $line['book_qty'] !== '' && $line['physical_qty'] !== '') {
                $diff = round((float) $line['physical_qty'] - (float) $line['book_qty'], 4);
                if (abs($diff) < 0.0001) {
                    continue; // counted equal to book: nothing to adjust
                }
                $qty = abs($diff);
                $countDirection = $diff > 0 ? 'in' : 'out';
            }
            if ($qty <= 0) {
                throw InventoryException::validation('Line ' . ($idx + 1) . ': qty must be greater than zero');
            }
            $item = $db->table('inv_items')->select('item_id, unit_id, item_type, is_active, deleted_at')->where('cmp_id', $cmpId)->where('item_id', $itemId)->get()->getRowArray();
            if (!$item) {
                throw InventoryException::validation('Line ' . ($idx + 1) . ': item #' . $itemId . ' not found in this company', ['item_id' => $itemId]);
            }
            if ($item['deleted_at'] !== null) {
                throw InventoryException::validation('Line ' . ($idx + 1) . ': item #' . $itemId . ' is deleted', ['item_id' => $itemId]);
            }
            $unitId = isset($line['unit_id']) && (int) $line['unit_id'] > 0 ? (int) $line['unit_id'] : ($this->units->defaultUnitId($cmpId, $itemId) ?: (int) ($item['unit_id'] ?? 0));
            $factor = $this->units->factorFor($cmpId, $itemId, $unitId > 0 ? $unitId : null);
            $rate = (float) ($line['rate'] ?? $line['source_transaction_rate'] ?? 0);
            $amount = (float) ($line['amount'] ?? $line['source_transaction_amount'] ?? 0);
            if ($amount <= 0 && $rate > 0) {
                $amount = round($qty * $rate, 4);
            }
            $wh = isset($line['warehouse_id']) && $line['warehouse_id'] ? (int) $line['warehouse_id'] : (isset($line['mc_id']) && $line['mc_id'] ? (int) $line['mc_id'] : null);
            $base = [
                'item_id'                   => $itemId,
                'warehouse_id'              => $wh,
                'location_id'               => isset($line['location_id']) && $line['location_id'] ? (int) $line['location_id'] : null,
                'batch_id'                  => isset($line['batch_id']) && $line['batch_id'] ? (int) $line['batch_id'] : null,
                'unit_id'                   => $unitId > 0 ? $unitId : null,
                'qty'                       => round($qty, 4),
                'conversion_factor'         => $factor,
                'base_qty'                  => UnitConversionService::toBaseQty($qty, $factor),
                'source_transaction_rate'   => $rate > 0 ? round($rate, 4) : null,
                'source_transaction_amount' => $amount > 0 ? round($amount, 4) : null,
                'source_fc_rate'            => isset($line['fc_rate']) ? (float) $line['fc_rate'] : null,
                'source_fc_amount'          => isset($line['fc_amount']) ? (float) $line['fc_amount'] : null,
                'source_exchange_rate'      => isset($line['exchange_rate']) ? (float) $line['exchange_rate'] : null,
                'valuation_rate'            => isset($line['valuation_rate']) && $line['valuation_rate'] !== '' && $line['valuation_rate'] !== null ? (float) $line['valuation_rate'] : null,
                'book_qty'                  => isset($line['book_qty']) && $line['book_qty'] !== '' ? (float) $line['book_qty'] : null,
                'physical_qty'              => isset($line['physical_qty']) && $line['physical_qty'] !== '' ? (float) $line['physical_qty'] : null,
                'books_tax_cat_id'          => isset($line['tax_cat_id']) && $line['tax_cat_id'] ? (int) $line['tax_cat_id'] : (isset($line['books_tax_cat_id']) && $line['books_tax_cat_id'] ? (int) $line['books_tax_cat_id'] : null),
                'hsn_sac'                   => isset($line['hsn_sac']) ? substr((string) $line['hsn_sac'], 0, 16) : null,
                'source_line_ref'           => isset($line['source_line_ref']) && $line['source_line_ref'] ? (int) $line['source_line_ref'] : null,
                'description'               => isset($line['description']) ? substr((string) $line['description'], 0, 512) : null,
                'metadata_json'             => isset($line['metadata']) && is_array($line['metadata']) ? json_encode($line['metadata'], JSON_UNESCAPED_UNICODE) : null,
                'serials'                   => isset($line['serials']) && is_array($line['serials']) ? $line['serials'] : [],
            ];

            switch ($spec['line_mode']) {
                case 'fixed_in':
                    $base['direction'] = 'in';
                    $out[] = $base + ['sort_order' => $sort++];
                    break;
                case 'fixed_out':
                    $base['direction'] = 'out';
                    $out[] = $base + ['sort_order' => $sort++];
                    break;
                case 'transfer':
                    $from = isset($line['from_warehouse_id']) && $line['from_warehouse_id'] ? (int) $line['from_warehouse_id'] : (int) $header['from_warehouse_id'];
                    $to = $wh ?: (int) $header['to_warehouse_id'];
                    if ($from === $to) {
                        throw InventoryException::validation('Line ' . ($idx + 1) . ': source and destination warehouses must differ');
                    }
                    $pairKey = 'tp-' . $idx;
                    $out[] = array_merge($base, ['direction' => 'out', 'warehouse_id' => $from, 'dest_warehouse_id' => $to, 'sort_order' => $sort++, 'metadata_json' => json_encode(['transfer_pair' => $pairKey, 'side' => 'out'])]);
                    $out[] = array_merge($base, ['direction' => 'in', 'warehouse_id' => $to, 'dest_warehouse_id' => null, 'sort_order' => $sort++, 'metadata_json' => json_encode(['transfer_pair' => $pairKey, 'side' => 'in'])]);
                    break;
                case 'by_line':
                    $dir = strtolower(trim((string) ($line['direction'] ?? '')));
                    if ($dir === '' && isset($line['dr_cr'])) {
                        $dir = (int) $line['dr_cr'] === 1 ? 'in' : 'out';
                    }
                    if ($dir === '' && $countDirection !== null) {
                        $dir = $countDirection;
                    }
                    if (!in_array($dir, ['in', 'out'], true)) {
                        throw InventoryException::validation('Line ' . ($idx + 1) . ': direction (in|out) is required for ' . $type);
                    }
                    $base['direction'] = $dir;
                    $out[] = $base + ['sort_order' => $sort++];
                    break;
                case 'status_only':
                case 'pending_only':
                default:
                    $base['direction'] = in_array($type, ['DELIVERY_CHALLAN', 'JOB_WORK_OUT', 'PACKING', 'RESERVATION'], true) ? 'out' : (in_array($type, ['INWARD_CHALLAN', 'RESERVATION_RELEASE'], true) ? 'in' : 'none');
                    $out[] = $base + ['sort_order' => $sort++];
                    break;
            }
        }

        return $out;
    }

    /** @param list<array<string, mixed>> $lines */
    private function writeLines($db, int $documentId, int $cmpId, int $fyId, int $boId, array $lines): void
    {
        foreach ($lines as $line) {
            $serials = $line['serials'] ?? [];
            unset($line['serials']);
            $row = array_merge($line, ['document_id' => $documentId, 'cmp_id' => $cmpId, 'fy_id' => $fyId, 'bo_id' => $boId]);
            DatabaseInsertHelper::insert($db, 'inv_document_lines', $row);
            $lineId = (int) $db->insertID();
            foreach ($serials as $s) {
                $serialId = is_array($s) ? (int) ($s['serial_id'] ?? 0) : (int) $s;
                if ($serialId > 0) {
                    $db->table('inv_document_line_serials')->insert(['line_id' => $lineId, 'document_id' => $documentId, 'cmp_id' => $cmpId, 'serial_id' => $serialId]);
                }
            }
        }
    }

    private function transition(int $cmpId, int $documentId, array $from, string $to, string $action, ?string $actor, ?string $notes): array
    {
        $doc = $this->get($cmpId, $documentId);
        if (!in_array($doc['status'], $from, true)) {
            throw InventoryException::invalidState('Cannot ' . $action . ' a document in status ' . $doc['status']);
        }
        $db = \Config\Database::connect();
        $db->table('inv_documents')->where('document_id', $documentId)->update(['status' => $to, 'updated_by' => $actor, 'updated_at' => date('Y-m-d H:i:s')]);
        $db->table('inv_document_approvals')->insert(['cmp_id' => $cmpId, 'document_id' => $documentId, 'action' => $action, 'actor_uuid' => $actor, 'notes' => $notes, 'created_at' => date('Y-m-d H:i:s')]);
        $this->audit->log($cmpId, 'document', $documentId, 'document.' . $action, $actor, ['reason' => $notes], ['status' => $doc['status']], ['status' => $to]);

        return $this->get($cmpId, $documentId);
    }
}
