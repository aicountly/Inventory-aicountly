<?php

namespace App\Services;

use App\Exceptions\InventoryException;
use Config\DocumentTypeRegistry;

/**
 * Posts and reverses inventory documents.
 *
 * post():   validate (FY range, period lock, warehouse restriction, negative-stock policy)
 *           -> value every line (FIFO/LIFO/WAC) -> write movements + balances
 *           -> status buckets / pending quantities -> accounting effects -> outbox -> POSTED.
 * reverse(): compensating movements (never deletes), layer restoration from the consumption
 *           trail, bucket/pending undo, status REVERSED, recalculation job from the date.
 *
 * Everything runs in one database transaction; a failure leaves the document in FAILED with
 * failure_reason so nothing is silently half-posted.
 */
class DocumentPostingService
{
    public function __construct(
        protected ?DocumentService $documents = null,
        protected ?ValuationEngine $valuation = null,
        protected ?StockBalanceService $balances = null,
        protected ?StockStatusService $status = null,
        protected ?PendingQuantityService $pending = null,
        protected ?UnitConversionService $units = null,
        protected ?InventorySettingsService $settings = null,
        protected ?ManageContextService $manage = null,
        protected ?OutboxService $outbox = null,
        protected ?AuditService $audit = null,
        protected ?AccessService $access = null,
    ) {
        $this->units ??= new UnitConversionService();
        $this->documents ??= new DocumentService($this->units);
        $this->settings ??= new InventorySettingsService();
        $this->manage ??= new ManageContextService();
        $this->valuation ??= new ValuationEngine($this->settings, $this->units, null, $this->manage);
        $this->balances ??= new StockBalanceService($this->units);
        $this->status ??= new StockStatusService($this->balances, $this->units);
        $this->pending ??= new PendingQuantityService();
        $this->outbox ??= new OutboxService();
        $this->audit ??= new AuditService();
        $this->access ??= new AccessService();
    }

    /**
     * @param array<string, mixed> $options  negative_override(bool), session(array), allow_backdate(bool), skip_approval(bool)
     * @return array<string, mixed> posted document (+ warnings)
     */
    public function post(int $cmpId, int $documentId, ?string $actor, array $options = []): array
    {
        $doc = $this->documents->get($cmpId, $documentId);
        if (in_array($doc['status'], ['POSTED', 'COMPLETED', 'PARTIALLY_FULFILLED'], true)) {
            $doc['duplicate'] = true;

            return $doc;
        }
        if (!in_array($doc['status'], ['DRAFT', 'APPROVED', 'PENDING_APPROVAL', 'FAILED'], true)) {
            throw InventoryException::invalidState('Document in status ' . $doc['status'] . ' cannot be posted');
        }
        $spec = DocumentTypeRegistry::get((string) $doc['document_type']);
        if ($spec === null) {
            throw InventoryException::validation('Unknown document type ' . $doc['document_type']);
        }
        $settings = $this->settings->get($cmpId);
        if (!empty($settings['approval_required']) && $doc['status'] !== 'APPROVED' && empty($options['skip_approval'])) {
            throw InventoryException::invalidState('Document must be approved before posting', ['status' => $doc['status']]);
        }
        $warnings = [];
        $this->assertDateAllowed($cmpId, $doc, $options, $warnings);
        $this->assertWarehousesAllowed($cmpId, $doc, $actor, $options['session'] ?? null);

        $db = \Config\Database::connect();
        $db->transStart();
        $db->table('inv_documents')->where('document_id', $documentId)->update(['status' => 'POSTING', 'updated_at' => date('Y-m-d H:i:s')]);
        try {
            $result = $this->applyPosting($db, $cmpId, $doc, $spec, $actor, $options, $warnings);
            $effects = $result['effects'];
            $now = date('Y-m-d H:i:s');
            $finalStatus = $spec['line_mode'] === 'pending_only' ? 'POSTED' : 'POSTED';
            $db->table('inv_documents')->where('document_id', $documentId)->update([
                'status'                  => $finalStatus,
                'posted_by'               => $actor,
                'posted_at'               => $now,
                'updated_by'              => $actor,
                'updated_at'              => $now,
                'failure_reason'          => null,
                'accounting_effects_json' => json_encode($effects, JSON_UNESCAPED_UNICODE),
            ]);
            $posted = $this->documents->get($cmpId, $documentId);
            $this->outbox->enqueue($cmpId, 'inventory.document.posted', 'document', $documentId, (string) $posted['document_uuid'], $this->eventPayload($posted, $effects));
            $this->audit->log($cmpId, 'document', $documentId, 'document.post', $actor, [
                'source_app' => $doc['source_app'], 'source_document_type' => $doc['source_document_type'], 'source_document_id' => $doc['source_document_id'], 'source_document_uuid' => $doc['source_document_uuid'],
                'warnings' => $warnings,
            ], ['status' => $doc['status']], ['status' => $finalStatus, 'valuation_total' => $result['valuation_total']]);
            $db->transComplete();
            if ($db->transStatus() === false) {
                throw new \RuntimeException('Posting transaction failed', 500);
            }
        } catch (\Throwable $e) {
            $db->transRollback();
            $db->resetTransStatus();
            $db->table('inv_documents')->where('document_id', $documentId)->update([
                'status' => 'FAILED', 'failure_reason' => substr($e->getMessage(), 0, 2000), 'updated_at' => date('Y-m-d H:i:s'),
            ]);
            $this->audit->log($cmpId, 'document', $documentId, 'document.post_failed', $actor, ['reason' => $e->getMessage()]);
            throw $e;
        }
        $posted['warnings'] = $warnings;
        $posted['duplicate'] = false;

        return $posted;
    }

    /**
     * Reverse a posted document. Creates compensating movements and restores valuation state.
     *
     * @return array<string, mixed> the reversed document
     */
    /**
     * Replace a posted document with a new version in ONE database transaction: reverse the
     * current document, create the replacement from $payload and post it. Either both happen
     * or neither — an edit in Books can never leave stock reversed without its replacement.
     *
     * @param array{cmp_id:int, fy_id:int, bo_id:int} $ctx
     * @param array<string, mixed> $payload same shape as DocumentService::create()
     * @param array<string, mixed> $options post() options (skip_approval, negative_override, fy_range)
     * @return array<string, mixed> the new posted document (+ 'replaced_document_id')
     */
    public function revise(array $ctx, int $documentId, array $payload, ?string $actor, string $reason, string $sourceApp = 'inventory', array $options = []): array
    {
        $cmpId = (int) $ctx['cmp_id'];
        $db = \Config\Database::connect();
        $db->transStart();
        try {
            $old = $this->reverse($cmpId, $documentId, $actor, $reason !== '' ? $reason : 'Revised', $options);
            $payload['metadata'] = array_merge(is_array($payload['metadata'] ?? null) ? $payload['metadata'] : [], ['revises_document_id' => $documentId, 'revision_reason' => $reason]);
            $created = $this->documents->create($ctx, $payload, $actor, $sourceApp);
            $posted = $this->post($cmpId, (int) $created['document_id'], $actor, $options);
            $db->transComplete();
            if ($db->transStatus() === false) {
                throw new \RuntimeException('Could not revise document', 500);
            }
        } catch (\Throwable $e) {
            $db->transRollback();
            $db->resetTransStatus();
            throw $e;
        }
        $posted['replaced_document_id'] = $documentId;
        $posted['replaced_status'] = $old['status'] ?? 'REVERSED';
        $this->audit->log($cmpId, 'document', (int) $posted['document_id'], 'document.revise', $actor, ['reason' => $reason, 'replaced_document_id' => $documentId], null, ['status' => $posted['status']]);

        return $posted;
    }

    public function reverse(int $cmpId, int $documentId, ?string $actor, string $reason, array $options = []): array
    {
        $doc = $this->documents->get($cmpId, $documentId);
        if ($doc['status'] === 'REVERSED') {
            $doc['duplicate'] = true;

            return $doc;
        }
        if (!in_array($doc['status'], ['POSTED', 'COMPLETED', 'PARTIALLY_FULFILLED'], true)) {
            throw InventoryException::invalidState('Only posted documents can be reversed (status ' . $doc['status'] . ')');
        }
        if (trim($reason) === '') {
            throw InventoryException::validation('A reason is required to reverse a posted document');
        }
        $this->assertPeriodOpen($cmpId, (int) $doc['bo_id'], (string) $doc['document_date']);
        $spec = DocumentTypeRegistry::get((string) $doc['document_type']);
        $db = \Config\Database::connect();
        $now = date('Y-m-d H:i:s');
        $db->transStart();
        try {
            // 1. Compensating stock movements.
            $movements = $db->table('inv_stock_movements')->where('document_id', $documentId)->where('movement_kind', 'physical')->get()->getResultArray();
            foreach ($movements as $m) {
                $db->table('inv_stock_movements')->insert([
                    'cmp_id' => $cmpId, 'fy_id' => (int) $m['fy_id'], 'bo_id' => (int) $m['bo_id'], 'document_id' => $documentId, 'line_id' => (int) $m['line_id'],
                    'document_type' => $m['document_type'], 'movement_date' => $m['movement_date'], 'sequence_no' => (int) $m['sequence_no'] + 1,
                    'item_id' => (int) $m['item_id'], 'warehouse_id' => $m['warehouse_id'], 'location_id' => $m['location_id'], 'batch_id' => $m['batch_id'],
                    'direction' => $m['direction'] === 'in' ? 'out' : 'in', 'qty' => -(float) $m['qty'], 'unit_cost' => $m['unit_cost'], 'value' => $m['value'] !== null ? -(float) $m['value'] : null,
                    'movement_kind' => 'reversal', 'reversal_of_movement_id' => (int) $m['movement_id'], 'created_at' => $now, 'created_by' => $actor,
                ]);
                $this->balances->applyDelta($cmpId, (int) $m['item_id'], $m['warehouse_id'] !== null ? (int) $m['warehouse_id'] : null, $m['batch_id'] !== null ? (int) $m['batch_id'] : null, 'on_hand', -(float) $m['qty'], $now);
            }
            // 2. Valuation: restore layers consumed by out lines; withdraw layers created by in lines.
            foreach ($doc['lines'] as $line) {
                if (empty($spec['valuation'])) {
                    break;
                }
                $this->reverseLineValuation($db, $cmpId, $doc, $line);
            }
            // 3. Status buckets and pending quantities.
            $this->status->reverseForDocument($cmpId, $documentId, $documentId);
            $this->pending->unsettleForDocument($cmpId, $documentId);
            $this->pending->cancelForDocument($cmpId, $documentId);
            // 4. Serials back to their prior state.
            $this->reverseSerials($db, $cmpId, $doc);
            // 5. Status.
            $db->table('inv_documents')->where('document_id', $documentId)->update([
                'status' => 'REVERSED', 'cancelled_by' => $actor, 'cancelled_at' => $now, 'cancel_reason' => $reason, 'updated_by' => $actor, 'updated_at' => $now,
            ]);
            // 6. Later issues may have consumed different layers — replay from this date.
            if (!empty($spec['valuation'])) {
                (new RecalculationService($this->valuation, $this->units, $this->balances, $this->outbox))
                    ->enqueue($cmpId, (int) $doc['fy_id'], null, (string) $doc['document_date'], 'reversal', $documentId, $actor);
            }
            $reversed = $this->documents->get($cmpId, $documentId);
            $this->outbox->enqueue($cmpId, 'inventory.document.reversed', 'document', $documentId, (string) $reversed['document_uuid'], $this->eventPayload($reversed, $reversed['accounting_effects'] ?? [], ['reason' => $reason]));
            $this->audit->log($cmpId, 'document', $documentId, 'document.reverse', $actor, ['reason' => $reason, 'reversal_ref' => $documentId, 'source_document_uuid' => $doc['source_document_uuid']], ['status' => $doc['status']], ['status' => 'REVERSED']);
            $db->transComplete();
            if ($db->transStatus() === false) {
                throw new \RuntimeException('Reversal transaction failed', 500);
            }
        } catch (\Throwable $e) {
            $db->transRollback();
            $db->resetTransStatus();
            throw $e;
        }

        return $reversed;
    }

    // ------------------------------------------------------------------ posting internals

    /** @return array{effects: list<array<string,mixed>>, valuation_total: float} */
    private function applyPosting($db, int $cmpId, array $doc, array $spec, ?string $actor, array $options, array &$warnings): array
    {
        $documentId = (int) $doc['document_id'];
        $fyId = (int) $doc['fy_id'];
        $boId = (int) $doc['bo_id'];
        $type = (string) $doc['document_type'];
        $date = (string) $doc['document_date'];
        $now = date('Y-m-d H:i:s');
        $this->units->warmCompany($cmpId);
        $stockEffect = (string) ($doc['stock_effect'] ?? '');
        $lines = $doc['lines'];

        // Which lines physically move stock right now?
        $movesStock = $this->movesStockNow($type, $spec, $stockEffect);
        $valuationTotal = 0.0;
        $cogsEffects = [];
        $adjustmentValue = 0.0;
        $seq = 0;

        // Job work inward: settle pending against the job worker before valuing consumed lines.
        if ($type === 'JOB_WORK_IN') {
            $this->applyJobWorkIn($db, $cmpId, $doc);
        }
        if ($type === 'JOB_WORK_OUT') {
            $this->applyJobWorkOut($cmpId, $doc);
        }
        if ($type === 'PACKING') {
            $this->applyPacking($db, $cmpId, $doc);
        }
        if ($type === 'RESERVATION' || $type === 'RESERVATION_RELEASE') {
            $this->applyReservationDocument($cmpId, $doc, $type === 'RESERVATION' ? StockStatusService::MOV_RESERVE : StockStatusService::MOV_RELEASE);
        }
        if ($type === 'REVALUATION') {
            $this->applyRevaluation($db, $cmpId, $doc, $actor);
        }

        if ($movesStock) {
            $policy = $this->settings->negativeStockPolicy($cmpId);
            $override = !empty($options['negative_override']);
            foreach ($lines as $line) {
                $direction = (string) $line['direction'];
                if (!in_array($direction, ['in', 'out'], true)) {
                    continue;
                }
                $itemId = (int) $line['item_id'];
                $wh = $line['warehouse_id'] !== null ? (int) $line['warehouse_id'] : null;
                $batchId = $line['batch_id'] !== null ? (int) $line['batch_id'] : null;
                $baseQty = (float) $line['base_qty'];
                if ($baseQty <= 0) {
                    continue;
                }
                if ($direction === 'out') {
                    $this->enforceNegativeStock($cmpId, $itemId, $wh, $batchId, $baseQty, $policy, $override, $line, $warnings, $options);
                }

                $val = ['valuation_rate' => null, 'valuation_amount' => null, 'valuation_method_applied' => null];
                if (!empty($spec['valuation'])) {
                    if ($direction === 'in') {
                        $unitCost = $this->inwardUnitCost($cmpId, $doc, $line, $lines);
                        $val = $this->valuation->recordReceipt($cmpId, $fyId, $itemId, $wh, $baseQty, $unitCost, $date . ' 00:00:00', $documentId, (int) $line['line_id'], $type === 'OPENING_STOCK' ? 'opening' : 'receipt');
                    } else {
                        $val = $this->valuation->issueStock($cmpId, $fyId, $itemId, $wh, $baseQty, $date . ' 00:00:00', $documentId, (int) $line['line_id']);
                    }
                    $db->table('inv_document_lines')->where('line_id', (int) $line['line_id'])->update([
                        'valuation_rate'           => $val['valuation_rate'],
                        'valuation_amount'         => $val['valuation_amount'],
                        'valuation_method_applied' => $val['valuation_method_applied'],
                    ]);
                    $valuationTotal += $direction === 'in' ? (float) $val['valuation_amount'] : -(float) $val['valuation_amount'];
                    if ($direction === 'out' && !empty($spec['cogs']) && (float) $val['valuation_amount'] > 0) {
                        $cogsEffects[] = ['effect' => 'COGS_ISSUE', 'line_id' => (int) $line['line_id'], 'item_id' => $itemId, 'amount' => round((float) $val['valuation_amount'], 4), 'base_qty' => $baseQty, 'valuation_rate' => (float) $val['valuation_rate']];
                    }
                    if (in_array($type, ['PHYSICAL_ADJUSTMENT', 'STOCK_JOURNAL', 'WRITE_OFF', 'WRITE_IN', 'MATERIAL_RECEIPT'], true)) {
                        $adjustmentValue += $direction === 'in' ? (float) $val['valuation_amount'] : -(float) $val['valuation_amount'];
                    }
                }
                $signedQty = $direction === 'in' ? $baseQty : -$baseQty;
                $db->table('inv_stock_movements')->insert([
                    'cmp_id' => $cmpId, 'fy_id' => $fyId, 'bo_id' => $boId, 'document_id' => $documentId, 'line_id' => (int) $line['line_id'], 'document_type' => $type,
                    'movement_date' => $date, 'sequence_no' => $seq++, 'item_id' => $itemId, 'warehouse_id' => $wh, 'location_id' => $line['location_id'], 'batch_id' => $batchId,
                    'direction' => $direction, 'qty' => round($signedQty, 4), 'unit_cost' => $val['valuation_rate'], 'value' => $val['valuation_amount'] !== null ? round(($direction === 'in' ? 1 : -1) * (float) $val['valuation_amount'], 4) : null,
                    'movement_kind' => 'physical', 'created_at' => $now, 'created_by' => $actor,
                ]);
                $this->balances->applyDelta($cmpId, $itemId, $wh, $batchId, 'on_hand', $signedQty, $date . ' 00:00:00');
                $this->applySerials($db, $cmpId, $doc, $line, $direction, $wh);
                if ($type === 'SALES_ISSUE' && $stockEffect === 'from_packing') {
                    $this->status->apply($cmpId, $documentId, StockStatusService::MOV_SALE_ISSUE, [['item_id' => $itemId, 'unit_id' => $line['unit_id'], 'warehouse_id' => $wh, 'batch_id' => $batchId, 'qty' => (float) $line['qty']]]);
                }
            }
        }

        // Pending quantities: open / settle.
        $this->applyPendingEffects($cmpId, $doc, $type, $stockEffect, $movesStock);

        // Accounting effects handed to Books (Books decides the ledgers; Inventory never posts to a ledger).
        $effects = [];
        foreach ($cogsEffects as $e) {
            $effects[] = $e;
        }
        if (abs($adjustmentValue) > 0.00001 && in_array('STOCK_ADJUSTMENT', $spec['effects'] ?? [], true)) {
            $effects[] = ['effect' => 'STOCK_ADJUSTMENT', 'amount' => round($adjustmentValue, 4)];
        }
        if ($type === 'WRITE_OFF' && abs($adjustmentValue) > 0.00001) {
            $effects[] = ['effect' => 'STOCK_WRITE_OFF', 'amount' => round(abs($adjustmentValue), 4)];
        }
        if (($type === 'WRITE_IN' || $type === 'MATERIAL_RECEIPT') && abs($adjustmentValue) > 0.00001) {
            $effects[] = ['effect' => 'STOCK_WRITE_IN', 'amount' => round(abs($adjustmentValue), 4)];
        }
        if ($type === 'OPENING_STOCK' && $valuationTotal > 0) {
            $effects[] = ['effect' => 'OPENING_STOCK', 'amount' => round($valuationTotal, 4)];
        }

        return ['effects' => $effects, 'valuation_total' => round($valuationTotal, 4)];
    }

    private function movesStockNow(string $type, array $spec, string $stockEffect): bool
    {
        return match ($type) {
            'DELIVERY_CHALLAN' => $stockEffect === 'physical',
            'INWARD_CHALLAN' => in_array($stockEffect, ['settle_deferred', 'physical'], true),
            'PURCHASE_RECEIPT' => $stockEffect !== 'defer_inward',
            'SALES_ISSUE', 'SALES_RETURN', 'PURCHASE_RETURN' => $stockEffect !== 'from_physical_challan',
            'JOB_WORK_OUT', 'PACKING', 'RESERVATION', 'RESERVATION_RELEASE', 'REVALUATION', 'LANDED_COST', 'BATCH_ADJUSTMENT', 'SERIAL_ADJUSTMENT' => false,
            default => in_array($spec['line_mode'], ['fixed_in', 'fixed_out', 'by_line', 'transfer'], true),
        };
    }

    /**
     * Unit cost (base units) of an inward line.
     *  - transfer in-side: cost the out-side was issued at
     *  - explicit valuation_rate on the line (physical adjustment, write-in, production finished goods)
     *  - source rate ÷ factor (purchase, sales return, opening)
     *  - fallback: last known cost of the item
     */
    private function inwardUnitCost(int $cmpId, array $doc, array $line, array $lines): float
    {
        $itemId = (int) $line['item_id'];
        $factor = (float) ($line['conversion_factor'] ?: 1);
        $meta = $line['metadata'] ?? [];
        if (is_array($meta) && ($meta['side'] ?? '') === 'in' && !empty($meta['transfer_pair'])) {
            foreach ($lines as $other) {
                $om = $other['metadata'] ?? [];
                if (is_array($om) && ($om['transfer_pair'] ?? null) === $meta['transfer_pair'] && ($om['side'] ?? '') === 'out') {
                    $rate = (float) (\Config\Database::connect()->table('inv_document_lines')->select('valuation_rate')->where('line_id', (int) $other['line_id'])->get()->getRowArray()['valuation_rate'] ?? 0);
                    if ($rate > 0) {
                        return $rate;
                    }
                }
            }
        }
        if ($line['valuation_rate'] !== null && (float) $line['valuation_rate'] > 0) {
            return round((float) $line['valuation_rate'], 4);
        }
        $rate = UnitConversionService::effectiveRate((float) $line['qty'], (float) ($line['source_transaction_rate'] ?? 0), (float) ($line['source_transaction_amount'] ?? 0));
        if ($rate > 0) {
            return UnitConversionService::toBaseUnitCost($rate, $factor);
        }
        $db = \Config\Database::connect();

        return $this->valuation->resolveFallbackUnitCost($db, $cmpId, $itemId, $this->valuation->scopeWarehouse($cmpId, $line['warehouse_id'] !== null ? (int) $line['warehouse_id'] : null));
    }

    private function enforceNegativeStock(int $cmpId, int $itemId, ?int $wh, ?int $batchId, float $baseQty, string $policy, bool $override, array $line, array &$warnings, array $options): void
    {
        $itemPolicy = \Config\Database::connect()->table('inv_items')->select('negative_stock_policy, item_name')->where('item_id', $itemId)->get()->getRowArray();
        $effective = !empty($itemPolicy['negative_stock_policy']) ? strtolower((string) $itemPolicy['negative_stock_policy']) : $policy;
        if ($effective === 'allow') {
            return;
        }
        $bal = $this->balances->balance($cmpId, $itemId, $wh, $batchId);
        $onHand = $this->settings->valuationScope($cmpId) === 'company' && $wh === null ? $bal['on_hand'] : $bal['on_hand'];
        if ($onHand + 0.0001 >= $baseQty) {
            return;
        }
        $details = ['item_id' => $itemId, 'item_name' => $itemPolicy['item_name'] ?? null, 'warehouse_id' => $wh, 'on_hand' => $onHand, 'required' => $baseQty, 'short_by' => round($baseQty - $onHand, 4)];
        if ($effective === 'warn') {
            $warnings[] = ['code' => 'negative_stock', 'message' => sprintf('Item #%d goes negative by %.4f', $itemId, $details['short_by']), 'details' => $details];

            return;
        }
        if ($override) {
            $session = $options['session'] ?? null;
            $actor = $options['actor'] ?? null;
            if ($session !== null && ($session['kind'] ?? '') !== 'service' && $actor && !$this->access->hasPermission($actor, $cmpId, 'stock.negative_override', $session)) {
                throw InventoryException::forbidden('Negative stock override requires stock.negative_override');
            }
            $warnings[] = ['code' => 'negative_stock_overridden', 'message' => sprintf('Item #%d posted into negative stock under override', $itemId), 'details' => $details];

            return;
        }
        throw InventoryException::negativeStock(sprintf('Insufficient stock for item #%d: on hand %.4f, required %.4f', $itemId, $onHand, $baseQty), $details);
    }

    private function applyPendingEffects(int $cmpId, array $doc, string $type, string $stockEffect, bool $movesStock): void
    {
        $documentId = (int) $doc['document_id'];
        $fyId = (int) $doc['fy_id'];
        $party = $doc['party_ref'] !== null ? (int) $doc['party_ref'] : null;
        $meta = is_array($doc['metadata'] ?? null) ? $doc['metadata'] : [];
        $settlements = $meta['challan_settlements'] ?? [];
        $lines = array_map(static fn ($l) => ['line_id' => (int) $l['line_id'], 'item_id' => (int) $l['item_id'], 'unit_id' => $l['unit_id'], 'warehouse_id' => $l['warehouse_id'], 'qty' => (float) $l['qty']], $doc['lines']);

        switch ($type) {
            case 'DELIVERY_CHALLAN':
                if ($stockEffect === 'challan_only' || $stockEffect === 'physical') {
                    $this->pending->open($cmpId, $fyId, $documentId, 'challan', 'out', $party, $lines);
                }
                break;
            case 'INWARD_CHALLAN':
                if ($stockEffect === 'settle_deferred') {
                    $sourceId = (int) ($meta['linked_source_document_id'] ?? $doc['source_document_id'] ?? 0);
                    if ($sourceId <= 0) {
                        throw InventoryException::validation('An inward challan settling a deferred purchase must reference the purchase (metadata.linked_source_document_id)');
                    }
                    $this->pending->settleBySource($cmpId, $documentId, 'in', $party, array_map(static fn ($l) => ['source_document_id' => $sourceId, 'item_id' => $l['item_id'], 'qty' => $l['qty'], 'warehouse_id' => $l['warehouse_id'], 'line_id' => $l['line_id']], $lines), 'deferred_purchase');
                } else {
                    $this->pending->open($cmpId, $fyId, $documentId, 'challan', 'in', $party, $lines);
                }
                break;
            case 'PURCHASE_RECEIPT':
                if ($stockEffect === 'defer_inward') {
                    $this->pending->open($cmpId, $fyId, $documentId, 'deferred_purchase', 'in', $party, $lines);
                } elseif ($stockEffect === 'from_challan' && is_array($settlements) && $settlements !== []) {
                    $this->pending->settleBySource($cmpId, $documentId, 'in', $party, $settlements, 'challan');
                }
                break;
            case 'SALES_ISSUE':
            case 'PURCHASE_RETURN':
                if ($stockEffect === 'from_challan' && is_array($settlements) && $settlements !== []) {
                    $this->pending->settleBySource($cmpId, $documentId, 'out', $party, $settlements, 'challan');
                }
                break;
            case 'SALES_RETURN':
                if ($stockEffect === 'from_challan' && is_array($settlements) && $settlements !== []) {
                    $this->pending->settleBySource($cmpId, $documentId, 'in', $party, $settlements, 'challan');
                }
                break;
        }
    }

    private function applyJobWorkOut(int $cmpId, array $doc): void
    {
        $lines = array_map(static fn ($l) => ['line_id' => (int) $l['line_id'], 'item_id' => (int) $l['item_id'], 'unit_id' => $l['unit_id'], 'warehouse_id' => $l['warehouse_id'], 'batch_id' => $l['batch_id'], 'qty' => (float) $l['qty']], $doc['lines']);
        $this->status->apply($cmpId, (int) $doc['document_id'], StockStatusService::MOV_JOB_WORK_SEND, $lines, true);
        $this->pending->open($cmpId, (int) $doc['fy_id'], (int) $doc['document_id'], 'job_work', 'out', $doc['party_ref'] !== null ? (int) $doc['party_ref'] : null, $lines);
    }

    /**
     * Job work inward: metadata.job_work_settlements = [{pending_id, qty, settlement_type: consumed|returned}]
     * consumed -> pending settled, job_worker bucket released, and an OUT line must exist for the material
     *             (created by the caller / DocumentService from the settlement) so it is valued and COGS'd.
     * returned -> pending settled, job_worker bucket released, no physical movement.
     */
    private function applyJobWorkIn($db, int $cmpId, array $doc): void
    {
        $meta = is_array($doc['metadata'] ?? null) ? $doc['metadata'] : [];
        $settlements = $meta['job_work_settlements'] ?? [];
        if (!is_array($settlements) || $settlements === []) {
            return;
        }
        $party = $doc['party_ref'] !== null ? (int) $doc['party_ref'] : null;
        $consumed = [];
        $returned = [];
        $rows = [];
        foreach ($settlements as $s) {
            $pendingId = (int) ($s['pending_id'] ?? 0);
            $qty = (float) ($s['qty'] ?? 0);
            $stype = (string) ($s['settlement_type'] ?? '');
            if ($pendingId <= 0 || $qty <= 0) {
                continue;
            }
            $pending = $this->pending->getOpen($cmpId, $pendingId, $party, 'job_work');
            if (!$pending) {
                throw InventoryException::validation('Open job work pending #' . $pendingId . ' not found');
            }
            $line = ['item_id' => (int) $pending['item_id'], 'unit_id' => $pending['unit_id'], 'warehouse_id' => $pending['warehouse_id'], 'qty' => $qty];
            if ($stype === 'consumed') {
                $consumed[] = $line;
            } elseif ($stype === 'returned') {
                $returned[] = $line;
            } else {
                throw InventoryException::validation('settlement_type must be consumed or returned for pending #' . $pendingId);
            }
            $rows[] = ['pending_id' => $pendingId, 'qty' => $qty, 'settlement_type' => $stype];
        }
        $this->pending->settle($cmpId, (int) $doc['document_id'], $party, $rows, 'job_work');
        if ($consumed !== []) {
            $this->status->apply($cmpId, (int) $doc['document_id'], StockStatusService::MOV_JOB_WORK_CONSUME, $consumed);
        }
        if ($returned !== []) {
            $this->status->apply($cmpId, (int) $doc['document_id'], StockStatusService::MOV_JOB_WORK_RETURN, $returned);
        }
    }

    private function applyPacking($db, int $cmpId, array $doc): void
    {
        $lines = array_map(static fn ($l) => ['item_id' => (int) $l['item_id'], 'unit_id' => $l['unit_id'], 'warehouse_id' => $l['warehouse_id'], 'batch_id' => $l['batch_id'], 'qty' => (float) $l['qty']], $doc['lines']);
        $this->status->apply($cmpId, (int) $doc['document_id'], StockStatusService::MOV_PACK, $lines, true);
        $consignee = $doc['party_ref'] !== null ? (int) $doc['party_ref'] : 0;
        $exists = $db->table('inv_packing_meta')->where('document_id', (int) $doc['document_id'])->countAllResults() > 0;
        $meta = is_array($doc['metadata'] ?? null) ? $doc['metadata'] : [];
        $row = ['cmp_id' => $cmpId, 'consignee_ref' => $consignee, 'packing_status' => 'open', 'box_marks_json' => isset($meta['box_marks']) ? json_encode($meta['box_marks']) : null, 'updated_at' => date('Y-m-d H:i:s')];
        if ($exists) {
            $db->table('inv_packing_meta')->where('document_id', (int) $doc['document_id'])->update($row);
        } else {
            $db->table('inv_packing_meta')->insert(array_merge(['document_id' => (int) $doc['document_id'], 'created_at' => date('Y-m-d H:i:s')], $row));
        }
    }

    private function applyReservationDocument(int $cmpId, array $doc, string $movement): void
    {
        $lines = array_map(static fn ($l) => ['item_id' => (int) $l['item_id'], 'unit_id' => $l['unit_id'], 'warehouse_id' => $l['warehouse_id'], 'batch_id' => $l['batch_id'], 'qty' => (float) $l['qty']], $doc['lines']);
        $this->status->apply($cmpId, (int) $doc['document_id'], $movement, $lines, $movement === StockStatusService::MOV_RESERVE);
    }

    /**
     * Revaluation: each line carries valuation_rate = new unit cost; layers still holding stock are
     * re-priced, WAC average replaced. The value delta is reported as STOCK_REVALUATION effect.
     */
    private function applyRevaluation($db, int $cmpId, array $doc, ?string $actor): void
    {
        $delta = 0.0;
        foreach ($doc['lines'] as $line) {
            $itemId = (int) $line['item_id'];
            $newCost = (float) ($line['valuation_rate'] ?? 0);
            if ($newCost <= 0) {
                throw InventoryException::validation('Revaluation line for item #' . $itemId . ' needs valuation_rate');
            }
            $wh = $this->valuation->scopeWarehouse($cmpId, $line['warehouse_id'] !== null ? (int) $line['warehouse_id'] : null);
            $b = $db->table('inv_cost_layers')->where('cmp_id', $cmpId)->where('item_id', $itemId)->where('qty_remaining >', 0);
            $wh === null ? $b->where('warehouse_id', null) : $b->where('warehouse_id', $wh);
            foreach ($b->get()->getResultArray() as $layer) {
                $delta += (float) $layer['qty_remaining'] * ($newCost - (float) $layer['unit_cost']);
                $db->table('inv_cost_layers')->where('layer_id', (int) $layer['layer_id'])->update(['unit_cost' => $newCost]);
            }
            $wac = $db->table('inv_wac_state')->where('cmp_id', $cmpId)->where('item_id', $itemId)->where('warehouse_id', $wh ?? 0)->get()->getRowArray();
            if ($wac) {
                $delta += (float) $wac['qty_on_hand'] * ($newCost - (float) $wac['average_cost']);
                $db->table('inv_wac_state')->where('cmp_id', $cmpId)->where('item_id', $itemId)->where('warehouse_id', $wh ?? 0)->update(['average_cost' => $newCost, 'updated_at' => date('Y-m-d H:i:s')]);
            }
            $db->table('inv_document_lines')->where('line_id', (int) $line['line_id'])->update(['valuation_amount' => round($delta, 4)]);
        }
        $effects = json_decode((string) ($doc['accounting_effects_json'] ?? '[]'), true) ?: [];
        $effects[] = ['effect' => 'STOCK_REVALUATION', 'amount' => round($delta, 4)];
        $db->table('inv_documents')->where('document_id', (int) $doc['document_id'])->update(['accounting_effects_json' => json_encode($effects)]);
    }

    private function applySerials($db, int $cmpId, array $doc, array $line, string $direction, ?int $wh): void
    {
        if (empty($line['serials'])) {
            return;
        }
        $ids = array_map(static fn ($s) => (int) $s['serial_id'], $line['serials']);
        $update = $direction === 'in'
            ? ['status' => 'in_stock', 'warehouse_id' => $wh, 'received_document_id' => (int) $doc['document_id'], 'updated_at' => date('Y-m-d H:i:s')]
            : ['status' => 'issued', 'issued_document_id' => (int) $doc['document_id'], 'updated_at' => date('Y-m-d H:i:s')];
        if ($direction === 'out') {
            $bad = $db->table('inv_serials')->where('cmp_id', $cmpId)->whereIn('serial_id', $ids)->where('status !=', 'in_stock')->countAllResults();
            if ($bad > 0) {
                throw InventoryException::validation('One or more serial numbers on line #' . $line['line_id'] . ' are not in stock');
            }
        }
        $db->table('inv_serials')->where('cmp_id', $cmpId)->whereIn('serial_id', $ids)->update($update);
    }

    private function reverseSerials($db, int $cmpId, array $doc): void
    {
        foreach ($doc['lines'] as $line) {
            if (empty($line['serials'])) {
                continue;
            }
            $ids = array_map(static fn ($s) => (int) $s['serial_id'], $line['serials']);
            $update = $line['direction'] === 'in'
                ? ['status' => 'returned', 'received_document_id' => null, 'updated_at' => date('Y-m-d H:i:s')]
                : ['status' => 'in_stock', 'issued_document_id' => null, 'updated_at' => date('Y-m-d H:i:s')];
            $db->table('inv_serials')->where('cmp_id', $cmpId)->whereIn('serial_id', $ids)->update($update);
        }
    }

    private function reverseLineValuation($db, int $cmpId, array $doc, array $line): void
    {
        $itemId = (int) $line['item_id'];
        $lineId = (int) $line['line_id'];
        $wh = $this->valuation->scopeWarehouse($cmpId, $line['warehouse_id'] !== null ? (int) $line['warehouse_id'] : null);
        $method = $this->valuation->resolveMethod($cmpId, $itemId);
        $baseQty = (float) $line['base_qty'];
        $rate = (float) ($line['valuation_rate'] ?? 0);
        if ($baseQty <= 0 || !in_array($line['direction'], ['in', 'out'], true)) {
            return;
        }
        if ($method === 'WAC') {
            $state = $db->table('inv_wac_state')->where('cmp_id', $cmpId)->where('item_id', $itemId)->where('warehouse_id', $wh ?? 0)->get()->getRowArray();
            $q = (float) ($state['qty_on_hand'] ?? 0);
            $avg = (float) ($state['average_cost'] ?? 0);
            if ($line['direction'] === 'in') {
                $newQ = round($q - $baseQty, 4);
                $newAvg = $newQ > 0.0001 ? round(($q * $avg - $baseQty * $rate) / $newQ, 4) : $avg;
            } else {
                $newQ = round($q + $baseQty, 4);
                $newAvg = $newQ > 0.0001 ? round(($q * $avg + $baseQty * $rate) / $newQ, 4) : $avg;
            }
            $payload = ['qty_on_hand' => $newQ, 'average_cost' => max(0.0, $newAvg), 'updated_at' => date('Y-m-d H:i:s')];
            if ($state) {
                $db->table('inv_wac_state')->where('cmp_id', $cmpId)->where('item_id', $itemId)->where('warehouse_id', $wh ?? 0)->update($payload);
            } else {
                $db->table('inv_wac_state')->insert(array_merge(['cmp_id' => $cmpId, 'item_id' => $itemId, 'warehouse_id' => $wh ?? 0], $payload));
            }

            return;
        }
        if ($line['direction'] === 'out') {
            // Give consumed quantities back to the layers they came from; drop the backorder layer this line created.
            foreach ($db->table('inv_cost_layer_consumptions')->where('line_id', $lineId)->get()->getResultArray() as $c) {
                $db->query('UPDATE inv_cost_layers SET qty_remaining = qty_remaining + ? WHERE layer_id = ?', [(float) $c['qty'], (int) $c['layer_id']]);
            }
            $db->table('inv_cost_layer_consumptions')->where('line_id', $lineId)->delete();
            $db->table('inv_cost_layers')->where('cmp_id', $cmpId)->where('source_line_id', $lineId)->where('layer_kind', 'backorder')->delete();

            return;
        }
        // Reversing a receipt: withdraw what remains of its layer; anything already consumed becomes a negative layer at that cost.
        $layer = $db->table('inv_cost_layers')->where('cmp_id', $cmpId)->where('source_line_id', $lineId)->whereIn('layer_kind', ['receipt', 'opening'])->get()->getRowArray();
        if ($layer) {
            $remaining = (float) $layer['qty_remaining'];
            $consumed = round($baseQty - $remaining, 4);
            $db->table('inv_cost_layers')->where('layer_id', (int) $layer['layer_id'])->update(['qty_remaining' => 0]);
            if ($consumed > 0.0001) {
                $db->table('inv_cost_layers')->insert([
                    'cmp_id' => $cmpId, 'fy_id' => (int) $doc['fy_id'], 'item_id' => $itemId, 'warehouse_id' => $wh, 'layer_kind' => 'backorder',
                    'qty_received' => -$consumed, 'qty_remaining' => -$consumed, 'unit_cost' => (float) $layer['unit_cost'], 'received_at' => $doc['document_date'] . ' 00:00:00',
                    'source_document_id' => (int) $doc['document_id'], 'source_line_id' => $lineId, 'created_at' => date('Y-m-d H:i:s'),
                ]);
            }
        }
    }

    // ------------------------------------------------------------------ guards

    private function assertDateAllowed(int $cmpId, array $doc, array $options, array &$warnings): void
    {
        $date = (string) $doc['document_date'];
        $this->assertPeriodOpen($cmpId, (int) $doc['bo_id'], $date);
        $range = $this->manage->fyDateRange($cmpId, (int) $doc['fy_id']);
        if ($range === null) {
            if (($options['session']['kind'] ?? '') === 'service' || !empty($options['fy_range'])) {
                $r = $options['fy_range'] ?? null;
                if (is_array($r) && !empty($r['fy_start']) && !empty($r['fy_end'])) {
                    $this->manage->rememberFyRange($cmpId, (int) $doc['fy_id'], $r['fy_start'], $r['fy_end']);
                    $range = ['fy_start' => $r['fy_start'], 'fy_end' => $r['fy_end']];
                }
            }
        }
        if ($range === null) {
            if (!empty($options['require_fy_range'])) {
                throw InventoryException::validation('Financial year dates could not be resolved from Manage; retry when Manage is reachable', ['fy_id' => $doc['fy_id']]);
            }
            $warnings[] = ['code' => 'fy_range_unverified', 'message' => 'Financial year dates could not be verified with Manage'];

            return;
        }
        if ($date < $range['fy_start'] || $date > $range['fy_end']) {
            throw InventoryException::validation('Document date ' . $date . ' is outside financial year ' . $range['fy_start'] . ' to ' . $range['fy_end'], ['fy_id' => $doc['fy_id'], 'fy_start' => $range['fy_start'], 'fy_end' => $range['fy_end']]);
        }
    }

    public function assertPeriodOpen(int $cmpId, int $boId, string $date): void
    {
        $db = \Config\Database::connect();
        $row = $db->table('inv_period_locks')->select('locked_upto_date')
            ->where('cmp_id', $cmpId)->where('released_at', null)
            ->groupStart()->where('bo_id', 0)->orWhere('bo_id', $boId)->groupEnd()
            ->orderBy('locked_upto_date', 'DESC')->get()->getRowArray();
        if ($row && $date <= (string) $row['locked_upto_date']) {
            throw InventoryException::periodLocked('Inventory period is locked up to ' . $row['locked_upto_date'], ['locked_upto_date' => $row['locked_upto_date'], 'date' => $date]);
        }
    }

    private function assertWarehousesAllowed(int $cmpId, array $doc, ?string $actor, ?array $session): void
    {
        if ($actor === null || $session === null || ($session['kind'] ?? '') === 'service') {
            return;
        }
        $allowed = $this->access->allowedWarehouses($actor, $cmpId, $session);
        if ($allowed === null) {
            return;
        }
        foreach ($doc['lines'] as $line) {
            foreach ([$line['warehouse_id'], $line['dest_warehouse_id']] as $wh) {
                if ($wh !== null && (int) $wh > 0 && !in_array((int) $wh, $allowed, true)) {
                    throw InventoryException::forbidden('You are not allowed to post to warehouse #' . $wh);
                }
            }
        }
    }

    /** @return array<string, mixed> */
    private function eventPayload(array $doc, array $effects, array $extra = []): array
    {
        $lines = [];
        foreach ($doc['lines'] as $l) {
            $lines[] = [
                'line_id' => (int) $l['line_id'], 'line_uuid' => $l['line_uuid'], 'item_id' => (int) $l['item_id'], 'warehouse_id' => $l['warehouse_id'], 'batch_id' => $l['batch_id'],
                'unit_id' => $l['unit_id'], 'direction' => $l['direction'], 'qty' => $l['qty'], 'base_qty' => $l['base_qty'],
                'valuation_rate' => $l['valuation_rate'], 'valuation_amount' => $l['valuation_amount'], 'valuation_method_applied' => $l['valuation_method_applied'],
                'source_line_ref' => $l['source_line_ref'], 'legacy_source_id' => $l['legacy_source_id'],
            ];
        }

        return array_merge([
            'document_id' => (int) $doc['document_id'], 'document_uuid' => $doc['document_uuid'], 'document_type' => $doc['document_type'], 'document_no' => $doc['document_no'],
            'document_date' => $doc['document_date'], 'status' => $doc['status'], 'fy_id' => (int) $doc['fy_id'], 'bo_id' => (int) $doc['bo_id'],
            'source_app' => $doc['source_app'], 'source_document_type' => $doc['source_document_type'], 'source_document_id' => $doc['source_document_id'], 'source_document_uuid' => $doc['source_document_uuid'],
            'accounting_effects' => $effects, 'lines' => $lines,
        ], $extra);
    }
}
