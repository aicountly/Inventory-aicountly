<?php

namespace App\Services;

use App\Exceptions\InventoryException;
use Config\DocumentTypeRegistry;

/**
 * Posts and reverses inventory documents.
 *
 * post():   validate (FY range, period lock, warehouse restriction, negative-stock policy)
 *           -> value every line (FIFO/LIFO/WAC) -> write movements + balances
 *           -> status buckets / pending quantities -> accounting effects -> outbox -> POSTED
 *           -> COMMIT -> the journal is offered to Books and must be accepted before the
 *              caller is told the post worked ({@see BooksJournalHandoff}).
 * reverse(): compensating movements (never deletes), layer restoration from the consumption
 *           trail, bucket/pending undo, status REVERSED, recalculation job from the date.
 *
 * Everything up to the commit runs in one database transaction; a failure leaves the document
 * in FAILED with failure_reason so nothing is silently half-posted.
 *
 * WHY INVENTORY COMMITS FIRST AND BOOKS LAST
 * ------------------------------------------
 * There is always a last commit and it can always fail. Books last and it fails: Inventory
 * holds a document, Books has no journal, and the repair is re-sending an event that is
 * idempotent on its event_uuid, or reversing the document — a routine act here. Inventory last
 * and it fails: Books holds a journal for stock that never moved, and the repair is reversing a
 * general-ledger entry, which is two permanent entries in the statutory books. The side whose
 * failure repairs cleanly is the side allowed to fail, so the order is not an accident and must
 * not be "improved".
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
        protected ?PackingService $packing = null,
        protected ?BooksJournalHandoff $booksHandoff = null,
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
        $this->packing ??= new PackingService($this->documents, $this->status, $this->audit);
        $this->booksHandoff ??= new BooksJournalHandoff($this->outbox);
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
        // A draft of an unimplemented type may still exist from before the type was withdrawn.
        // POSTED would say its allocation ran; nothing here runs one, so it stays where it is.
        if (!DocumentTypeRegistry::isImplemented((string) $doc['document_type'])) {
            throw InventoryException::invalidState($spec['label'] . ' cannot be posted: the type is declared but nothing happens when it posts, so POSTED would record work it never did', ['document_type' => $doc['document_type']]);
        }
        $settings = $this->settings->get($cmpId);
        if (!empty($settings['approval_required']) && $doc['status'] !== 'APPROVED' && empty($options['skip_approval'])) {
            throw InventoryException::invalidState('Document must be approved before posting', ['status' => $doc['status']]);
        }
        $warnings = [];
        $this->assertDateAllowed($cmpId, $doc, $options, $warnings);
        $this->assertWarehousesAllowed($cmpId, $doc, $actor, $options['session'] ?? null);

        $db = \Config\Database::connect();
        // Does this post own the outermost transaction? revise() wraps reverse() + create() +
        // post() in ONE transaction, and a synchronous Books call from inside it could have Books
        // accept a journal for a document Inventory then rolled back — Books holding an entry for
        // stock that never moved, the one ordering this design exists to prevent. A nested post
        // therefore keeps the queued delivery it has always had.
        $ownsTransaction = (int) $db->transDepth === 0;
        $waitForBooks = $this->booksHandoff->enabledFor((string) $doc['document_type'], $ownsTransaction);
        $db->transStart();
        $db->table('inv_documents')->where('document_id', $documentId)->update(['status' => 'POSTING', 'updated_at' => date('Y-m-d H:i:s')]);
        $eventId = 0;
        $handoffId = 0;
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
            $eventId = $this->outbox->enqueue($cmpId, 'inventory.document.posted', 'document', $documentId, (string) $posted['document_uuid'], $this->eventPayload($posted, $effects));
            if ($waitForBooks) {
                // Claimed INSIDE the document's transaction, so it is on disk BEFORE the risky
                // step rather than after it. The orphan bug earlier in this project was a tracker
                // row written on the connection whose rollback it was meant to outlive; this one
                // has to outlive a killed worker between the commit below and Books' answer, and
                // the only way to guarantee that is to commit it with the document.
                $handoffId = $this->booksHandoff->tracker()->claim($cmpId, $documentId, (string) $posted['document_uuid'], $eventId, $actor);
            }
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
        // ------------------------------------------------------------------ BOOKS LAST
        // Inventory has committed. Everything from here is the journal handshake, and its
        // failure mode is the cheap one: Inventory holds a document, Books has no journal, and
        // the repair is either re-sending the event (idempotent on its event_uuid) or reversing
        // the document — never reversing a general-ledger entry.
        if ($waitForBooks) {
            $delivery = $this->booksHandoff->deliver($cmpId, $eventId, $handoffId);
            if (!$delivery['accepted']) {
                $this->undoPostBooksWouldNotTake($cmpId, $documentId, $actor, $eventId, $handoffId, $delivery);
            }
            $posted['books_journal'] = 'accepted';
        } else {
            // Queued, as before. Named in the response so a caller can tell the two apart.
            $posted['books_journal'] = 'queued';
        }
        $posted['warnings'] = $warnings;
        $posted['duplicate'] = false;

        return $posted;
    }

    /**
     * Books refused the journal, or could not be reached: take the stock back off the books and
     * tell the user why.
     *
     * The scar lands in Inventory, where a reversal document is routine, rather than in the
     * general ledger where it is not. Availability is what this costs — while Books is
     * unreachable, a stock document cannot be posted at all — and the error says so, because a
     * user who is refused without a reason retries until something breaks.
     *
     * @param array{accepted:bool, status:int, error:string, books_holds_no_journal:bool} $delivery
     */
    private function undoPostBooksWouldNotTake(int $cmpId, int $documentId, ?string $actor, int $eventId, int $handoffId, array $delivery): void
    {
        $refused = $delivery['books_holds_no_journal'];
        $why = trim($delivery['error']) !== '' ? trim($delivery['error']) : 'no answer from the accounting service';
        $reason = ($refused ? 'The books refused the accounting entry' : 'The books could not be reached')
            . ' for this document: ' . mb_substr($why, 0, 400);

        // Claimed BEFORE the reversal is attempted. The document is committed by now, so this row
        // is the only thing on disk that knows stock has moved with no journal behind it; written
        // afterwards it would be missing in exactly the case it exists for.
        $this->booksHandoff->claimReversal($handoffId, $why, (int) $delivery['status']);

        $reversalError = null;
        try {
            $this->reverse($cmpId, $documentId, $actor, $reason);
            $this->booksHandoff->recordReversed($handoffId, $why);
        } catch (\Throwable $e) {
            $reversalError = $e->getMessage();
            $this->booksHandoff->recordReversalFailed($handoffId, $reversalError);
            log_message('error', 'Document {doc} could not be reversed after Books declined its journal: {msg}', ['doc' => $documentId, 'msg' => $reversalError]);
        }

        if ($reversalError === null && $refused) {
            // Books ANSWERED that it applied nothing, so there is no journal to undo and nothing
            // may be left queued: neither the posting Books refused nor the reversal of a
            // document Books never had.
            try {
                $this->outbox->abandonForDocument($cmpId, $documentId, $eventId, $reason);
            } catch (\Throwable $e) {
                log_message('warning', 'Could not retire the outbox events of refused document {doc}: {msg}', ['doc' => $documentId, 'msg' => $e->getMessage()]);
            }
        }

        $details = [
            'document_id'  => $documentId,
            'books_status' => (int) $delivery['status'],
            'books_error'  => mb_substr($why, 0, 500),
            'reversed'     => $reversalError === null,
            'handoff_id'   => $handoffId,
        ];
        if ($reversalError !== null) {
            $details['reversal_error'] = mb_substr($reversalError, 0, 500);

            throw new InventoryException(
                'books_handoff_unresolved',
                'The accounting entry for this document was not accepted (' . mb_substr($why, 0, 200) . '), and the stock movement could NOT be undone automatically ('
                . mb_substr($reversalError, 0, 200) . '). The document is still posted in Inventory with no entry in the books. It is recorded for repair and will be retried automatically; do not re-enter it.',
                500,
                $details,
            );
        }

        // The document was posted and then reversed, so it stays in the register marked REVERSED
        // and cannot be posted a second time. The message says so: "try again" on its own points
        // the user at a Post button that will refuse them.
        $again = ' This document is now marked Reversed and cannot be posted again — enter it afresh once the books are back.';

        throw new InventoryException(
            $refused ? 'books_refused' : 'books_unavailable',
            $refused
                ? 'The books refused the accounting entry for this document, so nothing has been posted: the stock movement has been reversed and no stock has changed. Reason given by the books: ' . mb_substr($why, 0, 300) . '.' . $again
                : 'The books could not be reached, so this document has not been posted: the stock movement has been reversed and no stock has changed. Stock and the books have to record the same movement in the same moment, so Inventory cannot post while the books are unavailable. (' . mb_substr($why, 0, 200) . ')' . $again,
            $refused ? 409 : 503,
            $details,
        );
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
            // 'superseded' marks the reverse leg of a revise on the outbox event it emits. Without
            // it Books cannot tell this apart from an operator reversing a live document, and files
            // an ordinary edit as a cross-service reversal.
            $old = $this->reverse($cmpId, $documentId, $actor, $reason !== '' ? $reason : 'Revised', $options + ['superseded' => true]);
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
        if ((string) $doc['document_type'] === 'LANDED_COST') {
            // It has no movements to compensate and no valued line of its own to unwind, so the
            // generic reversal would mark it REVERSED, undo nothing, and leave every cost layer it
            // raised exactly where it put them: a document that reports it was undone and was not.
            // A true unwind has to know what has been issued at the raised cost since, which is the
            // same problem as retro-costing and belongs with the effective-date work, not here.
            throw InventoryException::invalidState(
                'A landed cost allocation cannot be reversed: reversing it would say the cost had been taken back off the stock while the cost layers it raised stayed raised. Post a stock revaluation to correct the cost instead.',
                ['document_id' => $documentId, 'document_type' => 'LANDED_COST'],
            );
        }
        $this->packing->assertReversible($cmpId, $doc);
        $this->assertPeriodOpen($cmpId, (int) $doc['bo_id'], (string) $doc['document_date']);
        $spec = DocumentTypeRegistry::get((string) $doc['document_type']);
        $valuesLines = self::valuesLines((string) $doc['document_type'], $spec, (string) ($doc['stock_effect'] ?? ''));
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
            if ($valuesLines) {
                foreach ($doc['lines'] as $line) {
                    $this->reverseLineValuation($db, $cmpId, $doc, $line);
                }
            }
            // 2b. The allocation detail of a landed cost that arrived WITH this document. These
            // rows are DERIVED detail, not audit — no *_audit or append-only table is touched here
            // and the 8-year retention rule is untouched — so they go the same way the lines'
            // valuation just went. Leaving them describes a cost still capitalised onto a document
            // whose valuation has been taken back off, and any report answering "what landed cost
            // sits on this company's receipts" counts an amount that is no longer there.
            // Only the rows this document WROTE (document_id = itself). A LANDED_COST document's
            // own rows are not touched from here and cannot be: reverse() refuses that type above.
            $this->writeLandedCostAllocation($db, $cmpId, $documentId, []);
            // 3. Status buckets and pending quantities.
            $this->status->reverseForDocument($cmpId, $documentId, $documentId);
            $this->packing->releaseConsumedBy($cmpId, $documentId, $actor);
            $this->pending->unsettleForDocument($cmpId, $documentId);
            $this->pending->cancelForDocument($cmpId, $documentId);
            // 4. Serials back to their prior state.
            $this->reverseSerials($db, $cmpId, $doc);
            // 5. Status.
            $db->table('inv_documents')->where('document_id', $documentId)->update([
                'status' => 'REVERSED', 'cancelled_by' => $actor, 'cancelled_at' => $now, 'cancel_reason' => $reason, 'updated_by' => $actor, 'updated_at' => $now,
            ]);
            // 6. Later issues may have consumed different layers — replay from this date.
            if ($valuesLines) {
                (new RecalculationService($this->valuation, $this->units, $this->balances, $this->outbox))
                    ->enqueue($cmpId, (int) $doc['fy_id'], null, (string) $doc['document_date'], 'reversal', $documentId, $actor);
            }
            $reversed = $this->documents->get($cmpId, $documentId);
            $extra = ['reason' => $reason];
            if (!empty($options['superseded'])) {
                $extra['superseded'] = true;
            }
            $this->outbox->enqueue($cmpId, 'inventory.document.reversed', 'document', $documentId, (string) $reversed['document_uuid'], $this->eventPayload($reversed, $reversed['accounting_effects'] ?? [], $extra));
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

        // Which lines physically move stock right now, and does the document value them?
        $movesStock = self::movesStockNow($type, $spec, $stockEffect);
        $valuesLines = self::valuesLines($type, $spec, $stockEffect);
        // Defence in depth for the rule that matters most: a landed cost is never silently
        // dropped. DocumentService refuses one at entry wherever posting would not capitalise it,
        // and this asks the same question of the rows AS STORED — a row written before that gate
        // existed, by a migration, or by hand. Posting stops rather than marking the document
        // POSTED with a cost it quietly threw away, because a dropped cost is a closing stock that
        // is short by exactly that amount and nobody is told.
        self::assertStoredLandedCostsCanBeCapitalised($type, $spec, $stockEffect, $lines);
        // And the same defence for the company's capitalisation policy: the rows AS STORED are
        // asked whether their cost types are ones this company puts into stock. Entry refuses them
        // (DocumentService::normalizeLines), but a draft saved before a type was switched off, or a
        // row written by a migration, reaches posting without ever passing that gate — and posting
        // is where the amount is actually loaded onto the layer and the average.
        if ($type !== 'LANDED_COST' && self::capitalisesLandedCost($type, $spec, $stockEffect)) {
            $this->assertStoredLandedCostPolicy($cmpId, $lines);
        }
        $valuationTotal = 0.0;
        /** @var list<array{cost_type:string, allocation_basis:string, line_id:int, base_qty:float, amount:float}> */
        $landedShares = [];
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
        $revaluation = null;
        if ($type === 'REVALUATION') {
            $revaluation = $this->applyRevaluation($db, $cmpId, $doc, $actor);
        }
        $landedCost = null;
        if ($type === 'LANDED_COST') {
            $landedCost = $this->applyLandedCost($db, $cmpId, $doc, $actor, $warnings);
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
                $landed = 0.0;
                if ($valuesLines) {
                    if ($direction === 'in') {
                        $unitCost = $this->inwardUnitCost($cmpId, $doc, $line, $lines);
                        // The landed cost Books allocated to this line is part of what the goods
                        // cost, so it is loaded onto the unit cost BEFORE anything is recorded:
                        // ValuationEngine::recordReceipt() opens the FIFO/LIFO layer at this figure
                        // and feeds the same figure to the weighted average, so both methods carry
                        // the landed cost rather than only whichever one happens to be read.
                        $landed = self::landedCostOnLine($line, $spec, $direction);
                        $unitCost = self::loadedInwardUnitCost($unitCost, $baseQty, $landed);
                        // Asked of the LOADED cost: a receipt whose goods cost nothing but which
                        // carries real freight does not enter at zero, and saying it did would be
                        // the warning telling the operator to fix something already right.
                        $zeroCost = self::zeroInwardCostWarning($type, $itemId, (int) $line['line_id'], $unitCost);
                        if ($zeroCost !== null) {
                            $warnings[] = $zeroCost;
                        }
                        $val = $this->valuation->recordReceipt($cmpId, $fyId, $itemId, $wh, $baseQty, $unitCost, $date . ' 00:00:00', $documentId, (int) $line['line_id'], $type === 'OPENING_STOCK' ? 'opening' : 'receipt');
                        if ($landed > 0) {
                            $landedShares = array_merge($landedShares, self::receiptBorneShares($line, $landed, $baseQty));
                        }
                    } else {
                        $val = $this->valuation->issueStock($cmpId, $fyId, $itemId, $wh, $baseQty, $date . ' 00:00:00', $documentId, (int) $line['line_id']);
                    }
                    $db->table('inv_document_lines')->where('line_id', (int) $line['line_id'])->update([
                        'valuation_rate'           => $val['valuation_rate'],
                        'valuation_amount'         => $val['valuation_amount'],
                        'valuation_method_applied' => $val['valuation_method_applied'],
                        'landed_cost_amount'       => round($landed, 4),
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

        // The allocation detail of a cost that arrived with the receipt: document and target are
        // the same document. Written even when there is nothing to write, so a draft that was
        // edited to drop its freight and posted again leaves no orphaned detail behind.
        if ($valuesLines && $movesStock && $type !== 'LANDED_COST') {
            // A landed cost that arrived WITH the receipt: the receipt is its own target.
            foreach ($landedShares as $i => $share) {
                $landedShares[$i]['target_document_id'] = $documentId;
            }
            $this->writeLandedCostAllocation($db, $cmpId, $documentId, $landedShares);
        }

        // A sale raised against a packing list closes that list, so the next invoice naming it is
        // refused instead of issuing the same consignment again.
        if ($type === 'SALES_ISSUE') {
            $this->packing->consumeForSale($cmpId, $doc, $actor, $movesStock && $stockEffect === 'from_packing');
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
        if ($revaluation !== null) {
            $effects[] = $revaluation;
        }
        if ($landedCost !== null) {
            $effects[] = $landedCost;
        }
        // A landed cost that arrived WITH the receipt emits no effect of its own: it is already
        // inside $valuationTotal and inside every figure derived from $val['valuation_amount'], and
        // Books booked the freight bill itself as a payable on its own side. Emitting
        // STOCK_REVALUATION here would book the same rupees twice.

        return ['effects' => $effects, 'valuation_total' => round($valuationTotal, 4)];
    }

    /** Does a document of this type and stock_effect move stock at posting time? */
    public static function movesStockNow(string $type, array $spec, string $stockEffect): bool
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
     * Does a document value the lines it posts? A type declared valuation => true always does.
     * A type that values only the stock it actually moves (an inward challan) does exactly when it
     * moves stock: a challan_only challan opens a pending quantity and touches no layer, while a
     * settle_deferred or physical one is a receipt like any other and its goods must not reach
     * on_hand without a cost layer behind them.
     */
    public static function valuesLines(string $type, ?array $spec, string $stockEffect): bool
    {
        if (!empty($spec['valuation'])) {
            return true;
        }

        return DocumentTypeRegistry::valuesMovedStock($type) && self::movesStockNow($type, $spec ?? [], $stockEffect);
    }

    /**
     * Does a document of this type and stock_effect carry valuation on the LINES themselves?
     *
     * Posting writes valuation_rate / valuation_amount only for the lines whose stock it moves, so
     * a type that values its lines but defers the movement — a defer_inward purchase, a
     * from_physical_challan sale — carries none until the document that moves the goods settles
     * it. A revaluation is the one type that records its delta on its lines without moving any
     * stock. Anyone reading a line's valuation as a document's effect on the stock value must ask
     * this, not valuesLines(): valuesLines() answers what posting and reversal should DO.
     */
    public static function valuesLinesNow(string $type, ?array $spec, string $stockEffect): bool
    {
        if (!self::valuesLines($type, $spec, $stockEffect)) {
            return false;
        }

        return $type === 'REVALUATION' || self::movesStockNow($type, $spec ?? [], $stockEffect);
    }

    /**
     * Will posting a document of this type and stock_effect actually CAPITALISE a landed cost
     * carried on one of its inward lines?
     *
     * This is the exact condition the valuation block below runs under — the type carries
     * valuation AND the document moves its stock now — and it is deliberately not
     * `$spec['valuation']` alone. A defer_inward purchase and a from_physical_challan sales return
     * both declare valuation => true and both carry inward lines, but neither moves any stock when
     * it posts, so the whole valuation block is skipped and any landed cost on their lines is
     * dropped without a trace: the goods later enter on the settling challan, which costs them
     * from the purchase's RATE and never reads landed_cost_amount, so closing stock ends up short
     * by exactly the charge with nobody told. Entry asks this question, and posting asks it again
     * of the stored rows, so the two can never disagree about where a cost may be carried.
     *
     * @param array<string, mixed>|null $spec
     */
    public static function capitalisesLandedCost(string $type, ?array $spec, string $stockEffect): bool
    {
        return !empty($spec['valuation']) && self::movesStockNow($type, $spec ?? [], $stockEffect);
    }

    /**
     * Unit cost (base units) of an inward line.
     *  - transfer in-side: cost the out-side was issued at
     *  - explicit valuation_rate on the line (physical adjustment, write-in, production finished goods)
     *  - inward challan settling a deferred purchase: the purchase's rate for the same item
     *  - source rate ÷ factor, but ONLY for a cost-bearing document (purchase, GRN, opening,
     *    production/adjustment): on a sales return or a journal with items the source rate is the
     *    Books COMMERCIAL rate (selling price) and is never a cost
     *  - goods returned on a non-cost-bearing document: the cost the originating issue consumed
     *  - fallback: last known cost of the item
     */
    private function inwardUnitCost(int $cmpId, array $doc, array $line, array $lines): float
    {
        $itemId = (int) $line['item_id'];
        $factor = (float) ($line['conversion_factor'] ?: 1);
        $type = (string) $doc['document_type'];
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
        $db = \Config\Database::connect();
        // A challan settling a deferred purchase carries the goods and nothing else: the price
        // agreed with the supplier was recorded on the purchase, which posted with defer_inward and
        // so moved no stock and was never valued. Cost this receipt from that purchase.
        if ($type === 'INWARD_CHALLAN' && (string) ($doc['stock_effect'] ?? '') === 'settle_deferred') {
            $deferred = $this->deferredPurchaseUnitCost($db, $cmpId, self::settledPurchaseId($doc), $itemId);
            if ($deferred !== null) {
                return $deferred;
            }
        }
        if (in_array($type, DocumentTypeRegistry::COST_BEARING_SOURCE_RATE, true)) {
            $rate = UnitConversionService::effectiveRate((float) $line['qty'], (float) ($line['source_transaction_rate'] ?? 0), (float) ($line['source_transaction_amount'] ?? 0));
            if ($rate > 0) {
                return UnitConversionService::toBaseUnitCost($rate, $factor);
            }
        } else {
            $returned = $this->originatingIssueUnitCost($db, $cmpId, $doc, $line, $itemId);
            if ($returned !== null) {
                return $returned;
            }
        }

        return $this->valuation->resolveFallbackUnitCost($db, $cmpId, $itemId, $this->valuation->scopeWarehouse($cmpId, $line['warehouse_id'] !== null ? (int) $line['warehouse_id'] : null));
    }

    /**
     * The deferred purchase an inward challan settles. The same link the pending settlement uses,
     * so the cost of the goods and the pending row they close can never name different purchases.
     */
    private static function settledPurchaseId(array $doc): int
    {
        $meta = is_array($doc['metadata'] ?? null) ? $doc['metadata'] : [];

        return (int) ($meta['linked_source_document_id'] ?? $doc['source_document_id'] ?? 0);
    }

    /**
     * Base unit cost the deferred purchase recorded for an item, weighted over its inward lines for
     * that item (a purchase may list the same item twice at different rates). An explicit cost on a
     * purchase line wins; otherwise its commercial rate, which the registry declares to be the cost
     * of the goods for a purchase — and only for a purchase, so a link pointing at some other
     * document type never lets that document's commercial rate become an inventory cost.
     * Null when the purchase has no priced inward line for the item.
     *
     * Public because the backfill of challans posted before this gate opened must price them
     * exactly as posting does, from the same recorded facts.
     */
    public function deferredPurchaseUnitCost($db, int $cmpId, int $sourceId, int $itemId): ?float
    {
        if ($sourceId <= 0) {
            return null;
        }
        $res = $db->table('inv_document_lines l')
            ->select('l.qty, l.base_qty, l.conversion_factor, l.valuation_rate, l.source_transaction_rate, l.source_transaction_amount, d.document_type')
            ->join('inv_documents d', 'd.document_id = l.document_id', 'inner')
            ->where('l.cmp_id', $cmpId)->where('l.document_id', $sourceId)->where('l.item_id', $itemId)->where('l.direction', 'in')
            ->get();
        if ($res === false) {
            // DBDebug is off in every deployed environment, so a refused query answers false and
            // ->getResultArray() on false is fatal. A cost that cannot be read must stop the
            // posting rather than fall through and be guessed from the item's history.
            throw new \RuntimeException('Could not read the deferred purchase behind this inward challan', 500);
        }
        $qty = 0.0;
        $value = 0.0;
        foreach ($res->getResultArray() as $l) {
            $baseQty = (float) $l['base_qty'];
            $rate = (float) ($l['valuation_rate'] ?? 0);
            if ($rate <= 0 && in_array(strtoupper((string) $l['document_type']), DocumentTypeRegistry::COST_BEARING_SOURCE_RATE, true)) {
                $rate = UnitConversionService::toBaseUnitCost(
                    UnitConversionService::effectiveRate((float) $l['qty'], (float) ($l['source_transaction_rate'] ?? 0), (float) ($l['source_transaction_amount'] ?? 0)),
                    (float) ($l['conversion_factor'] ?: 1),
                );
            }
            if ($baseQty <= 0 || $rate <= 0) {
                continue;
            }
            $qty += $baseQty;
            $value += $baseQty * $rate;
        }

        return $qty > 0 ? round($value / $qty, 4) : null;
    }

    /**
     * Cost the originating issue actually consumed for this item, weighted over its cost-layer
     * consumptions. Used when goods come back in on a document whose own rate is commercial
     * (a credit note, a journal with items) and the document says which issue it reverses.
     * Null when no originating document is referenced or it consumed nothing for the item.
     */
    private function originatingIssueUnitCost($db, int $cmpId, array $doc, array $line, int $itemId): ?float
    {
        $docMeta = is_array($doc['metadata'] ?? null) ? $doc['metadata'] : [];
        $lineMeta = is_array($line['metadata'] ?? null) ? $line['metadata'] : [];
        $sourceId = (int) ($lineMeta['originating_document_id'] ?? $lineMeta['linked_source_document_id']
            ?? $docMeta['originating_document_id'] ?? $docMeta['linked_source_document_id'] ?? 0);
        if ($sourceId <= 0) {
            return null;
        }
        $result = $db->table('inv_cost_layer_consumptions c')
            ->select('SUM(c.qty) AS qty, SUM(c.qty * c.unit_cost) AS value', false)
            ->join('inv_document_lines l', 'l.line_id = c.line_id', 'inner')
            ->where('c.cmp_id', $cmpId)->where('c.document_id', $sourceId)->where('l.item_id', $itemId)
            ->get();
        $row = $result === false ? null : $result->getRowArray();
        $qty = (float) ($row['qty'] ?? 0);
        $value = (float) ($row['value'] ?? 0);
        if ($qty <= 0 || $value <= 0) {
            return null;
        }

        return round($value / $qty, 4);
    }

    /**
     * Unit cost of an inward line once its landed cost is loaded onto it.
     *
     *     valuation_amount = (base cost of the goods) + landed_cost_amount
     *     valuation_rate   = valuation_amount / base_qty
     *
     * Deriving the line, the movement, the FIFO layer and the weighted average from ONE rounded
     * rate is what makes closing stock tie: the alternative — an exact amount on the line and a
     * rounded rate in the layer — makes them disagree by the rounding, which is worse than the
     * rounding itself. At NUMERIC(18,4) the amount can differ from (base cost + landed cost) by up
     * to 0.00005 x base_qty, a few rupees on a hundred-thousand-unit receipt.
     *
     * Pure, so the arithmetic is tested without a database.
     */
    public static function loadedInwardUnitCost(float $baseUnitCost, float $baseQty, float $landedCost): float
    {
        if ($baseQty <= 0) {
            return round($baseUnitCost, 4);
        }

        return round((($baseUnitCost * $baseQty) + $landedCost) / $baseQty, 4);
    }

    /**
     * The landed cost a stored line may contribute to its own valuation.
     *
     * DocumentService refuses a landed cost anywhere but an inward line of a valuation-bearing
     * type, and this asks the same question again of the row as stored: defence in depth for a row
     * written before that guard existed, or by a migration. A landed cost that reached a place it
     * may not be is ignored for valuation here rather than capitalised into the wrong document —
     * the refusal at entry is the channel that tells anyone about it.
     *
     * @param array<string, mixed> $line
     * @param array<string, mixed> $spec
     */
    public static function landedCostOnLine(array $line, array $spec, string $direction): float
    {
        if ($direction !== 'in' || empty($spec['valuation'])) {
            return 0.0;
        }

        return max(0.0, round((float) ($line['landed_cost_amount'] ?? 0), 4));
    }

    /**
     * Refuse to post a document whose stored lines carry a landed cost this posting cannot
     * capitalise. See capitalisesLandedCost(): the question is the document's, not the type's.
     *
     * @param array<string, mixed>|null $spec
     * @param list<array<string, mixed>> $lines
     */
    public static function assertStoredLandedCostsCanBeCapitalised(string $type, ?array $spec, string $stockEffect, array $lines): void
    {
        if (self::capitalisesLandedCost($type, $spec, $stockEffect)) {
            return;
        }
        foreach ($lines as $line) {
            $amount = round((float) ($line['landed_cost_amount'] ?? 0), 4);
            if ($amount <= 0) {
                continue;
            }
            throw InventoryException::validation(
                'Line #' . (int) ($line['line_id'] ?? 0) . ' carries a landed cost of ' . number_format($amount, 4, '.', '')
                . ' that posting this ' . ($spec['label'] ?? $type) . ' cannot capitalise, so it would be dropped and closing stock would be short by it. '
                . 'Take the amount off this document and post it as a LANDED_COST document against the document that receives the goods.',
                ['document_type' => $type, 'stock_effect' => $stockEffect, 'line_id' => (int) ($line['line_id'] ?? 0), 'landed_cost_amount' => $amount],
            );
        }
    }

    /**
     * Refuse to post stored receipt lines whose landed cost is made of charges this company does
     * not capitalise into stock.
     *
     * Reads the breakdown exactly where posting reads it — the line's metadata — so what is checked
     * is what would be capitalised, not what a payload once claimed. A line carrying an amount and
     * no breakdown is checked as 'other', which is the type receiptBorneShares() records it under.
     *
     * @param list<array<string, mixed>> $lines
     */
    private function assertStoredLandedCostPolicy(int $cmpId, array $lines): void
    {
        $capitalisable = null;
        foreach ($lines as $line) {
            if ((string) ($line['direction'] ?? '') !== 'in') {
                continue;
            }
            $amount = round((float) ($line['landed_cost_amount'] ?? 0), 4);
            if ($amount <= 0) {
                continue;
            }
            // Read lazily: a company whose documents carry no landed cost never asks at all.
            $capitalisable ??= $this->settings->capitalisableLandedCostTypes($cmpId);
            $meta = is_array($line['metadata'] ?? null) ? $line['metadata'] : [];
            $breakdown = is_array($meta['landed_cost_breakdown'] ?? null) ? array_values($meta['landed_cost_breakdown']) : [];
            $parts = [];
            foreach ($breakdown as $entry) {
                if (!is_array($entry)) {
                    continue;
                }
                // Coerced exactly the way receiptBorneShares() coerces it, so the policy is asked
                // about the type the row will actually be RECORDED under. Reading the raw word
                // instead would turn a stored value outside the vocabulary — which posting has
                // always absorbed as 'other' — into a refusal, which is a different change from
                // the one this policy makes.
                $costType = strtolower(trim((string) ($entry['cost_type'] ?? '')));
                $parts[] = ['cost_type' => in_array($costType, DocumentService::LANDED_COST_TYPES, true) ? $costType : 'other', 'amount' => 0.0, 'allocation_basis' => 'value'];
            }
            DocumentService::assertLandedCostPolicy($amount, $parts, $capitalisable, 'Line #' . (int) ($line['line_id'] ?? 0));
        }
    }

    /**
     * Spread a charge over weighted lines so the shares sum EXACTLY to the charge.
     *
     * A rupee lost to rounding is a closing stock that does not tie, so the residual left by
     * rounding every share to four places is put on the largest-weight line rather than dropped.
     * All weights zero is refused, not spread arbitrarily: a charge nobody can attribute is a
     * decision for the person entering it, not for the allocator.
     *
     * @param array<int, float> $weights line_id => weight
     * @return array<int, float> line_id => share
     */
    public static function allocateCharge(float $amount, array $weights, string $what = 'charge'): array
    {
        $total = 0.0;
        foreach ($weights as $w) {
            $total += max(0.0, (float) $w);
        }
        if ($total <= 0.0) {
            throw InventoryException::validation('The ' . $what . ' cannot be allocated: every line it would be spread over weighs nothing on this basis. Pick another basis or enter the shares by hand.');
        }
        $shares = [];
        foreach ($weights as $lineId => $w) {
            $shares[$lineId] = round($amount * max(0.0, (float) $w) / $total, 4);
        }

        return self::settleResidual($shares, $amount);
    }

    /**
     * Put whatever rounding left over onto the largest share, so the shares sum exactly to $amount.
     *
     * @param array<int, float> $shares
     * @return array<int, float>
     */
    public static function settleResidual(array $shares, float $amount): array
    {
        if ($shares === []) {
            return $shares;
        }
        $sum = 0.0;
        foreach ($shares as $k => $v) {
            $shares[$k] = round((float) $v, 4);
            $sum = round($sum + $shares[$k], 4);
        }
        $residual = round($amount - $sum, 4);
        if (abs($residual) < 0.00005) {
            return $shares;
        }
        $biggestKey = null;
        $biggest = -1.0;
        foreach ($shares as $k => $v) {
            if (abs($v) > $biggest) {
                $biggest = abs($v);
                $biggestKey = $k;
            }
        }
        $shares[$biggestKey] = round($shares[$biggestKey] + $residual, 4);

        return $shares;
    }

    /**
     * Stock that enters at zero understates closing stock now and COGS when that layer is issued,
     * and nothing refuses the zero: a job-work receipt whose cost column was left blank has no
     * typed cost, no cost-bearing source rate and, for a first-ever receipt, no cost history to
     * fall back on. Posting says so rather than booking the zero in silence.
     *
     * @return array<string, mixed>|null
     */
    public static function zeroInwardCostWarning(string $type, int $itemId, int $lineId, float $unitCost): ?array
    {
        if ($unitCost > 0) {
            return null;
        }

        return [
            'code'    => 'zero_valuation_inward',
            'message' => sprintf('Item #%d enters stock at zero cost: no unit cost on the line and none known for the item', $itemId),
            'details' => ['item_id' => $itemId, 'line_id' => $lineId, 'document_type' => $type],
        ];
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
                    $sourceId = self::settledPurchaseId($doc);
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
     *
     * The effect is RETURNED, not written here. post() persists accounting_effects_json and
     * publishes the outbox event from the array applyPosting() returns, in this same transaction,
     * so anything written straight to the column is overwritten before Books can ever read it.
     *
     * @return array<string, mixed>|null
     */
    private function applyRevaluation($db, int $cmpId, array $doc, ?string $actor): ?array
    {
        $total = 0.0;
        foreach ($doc['lines'] as $line) {
            $itemId = (int) $line['item_id'];
            $newCost = (float) ($line['valuation_rate'] ?? 0);
            if ($newCost <= 0) {
                throw InventoryException::validation('Revaluation line for item #' . $itemId . ' needs valuation_rate');
            }
            // Each line reports the delta IT caused: a line stamped with the running total of the
            // lines before it makes the document's own lines add up to more than it revalued.
            $delta = 0.0;
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
            $total += $delta;
        }

        return abs($total) > 0.00001 ? ['effect' => 'STOCK_REVALUATION', 'amount' => round($total, 4)] : null;
    }

    /**
     * The allocation detail of a landed cost that arrived WITH the receipt line.
     *
     * The line already carries the total; the breakdown says what it is made of. Breakdown amounts
     * are validated to sum to the total within one paisa at entry, so the residual is settled onto
     * the largest charge here — the stored detail must add up to the stored total exactly.
     * A line that carries an amount and no breakdown is recorded as one 'other' charge belonging
     * directly to that line: it arrived already attributed, which is what 'direct' means.
     *
     * @param array<string, mixed> $line
     * @return list<array{cost_type: string, allocation_basis: string, line_id: int, base_qty: float, amount: float}>
     */
    private static function receiptBorneShares(array $line, float $landedCost, float $baseQty): array
    {
        $lineId = (int) $line['line_id'];
        $meta = is_array($line['metadata'] ?? null) ? $line['metadata'] : [];
        $breakdown = is_array($meta['landed_cost_breakdown'] ?? null) ? array_values($meta['landed_cost_breakdown']) : [];
        $parts = [];
        $amounts = [];
        foreach ($breakdown as $i => $entry) {
            if (!is_array($entry)) {
                continue;
            }
            $costType = strtolower(trim((string) ($entry['cost_type'] ?? '')));
            $basis = strtolower(trim((string) ($entry['allocation_basis'] ?? '')));
            $parts[$i] = [
                'cost_type'        => in_array($costType, DocumentService::LANDED_COST_TYPES, true) ? $costType : 'other',
                'allocation_basis' => in_array($basis, DocumentService::LANDED_COST_BASES, true) ? $basis : 'value',
            ];
            $amounts[$i] = round((float) ($entry['amount'] ?? 0), 4);
        }
        if ($parts === []) {
            return [['cost_type' => 'other', 'allocation_basis' => 'direct', 'line_id' => $lineId, 'base_qty' => $baseQty, 'amount' => round($landedCost, 4)]];
        }
        $amounts = self::settleResidual($amounts, $landedCost);
        $out = [];
        foreach ($parts as $i => $part) {
            if (abs($amounts[$i]) < 0.00005) {
                continue;
            }
            $out[] = $part + ['line_id' => $lineId, 'base_qty' => $baseQty, 'amount' => $amounts[$i]];
        }

        return $out;
    }

    /**
     * Write the allocation detail of $documentId: one inv_landed_costs row per cost type and one
     * inv_landed_cost_lines row per (cost type, target line).
     *
     * Delete then insert. These rows are DERIVED allocation detail, not audit — no *_audit or
     * append-only table is touched here and the retention rule is untouched — so a document that is
     * edited and posted again replaces its detail exactly the way its lines are replaced. Leaving
     * the old rows would describe an allocation that no longer happened.
     *
     * The delete uses a closure subquery rather than reading the parent ids first, so this path
     * performs no ->get() at all: DBDebug is false in every deployed environment, a refused query
     * answers FALSE there, and PostgreSQL aborts the whole transaction on the first failed
     * statement — there is nothing to be gained by reading what can be deleted in place.
     *
     * What these rows record is the ALLOCATION — what was spread onto which line — and not what
     * was capitalised. For a charge that arrives with the receipt the two are the same figure. For
     * a LANDED_COST document loading a partly-issued receipt they are not: the parent row has to
     * tie to the charge on the Books side, so it holds the whole charge, while the receipt line is
     * credited only with what its cost state absorbed and the difference is reported as
     * landed_cost_not_absorbed for the caller to expense. Anyone totalling these rows is reading
     * what was allocated; the capitalised figure is inv_document_lines.landed_cost_amount.
     *
     * A share names the receipt its line belongs to, and the parent rows are grouped by
     * (cost type, receipt): inv_landed_costs.target_document_id is one column, so a freight charge
     * spread over two receipts is two parent rows that sum to the charge, not one row filed against
     * whichever receipt happened to be first. That keeps idx_inv_landed_costs_target answering
     * "what has been loaded onto this receipt?" with the amount that actually reached it.
     *
     * @param list<array{cost_type: string, allocation_basis: string, line_id: int, target_document_id: int, base_qty: float, amount: float, books_acc_ref?: ?int}> $shares
     */
    private function writeLandedCostAllocation($db, int $cmpId, int $documentId, array $shares): void
    {
        $db->table('inv_landed_cost_lines')->where('cmp_id', $cmpId)
            ->whereIn('landed_cost_id', static fn ($sub) => $sub->select('landed_cost_id')->from('inv_landed_costs')->where('cmp_id', $cmpId)->where('document_id', $documentId))
            ->delete();
        $db->table('inv_landed_costs')->where('cmp_id', $cmpId)->where('document_id', $documentId)->delete();
        if ($shares === []) {
            return;
        }
        // One row per (cost type, target line): a charge named twice for the same line is one share
        // of that charge on that line, not two rows that each look like the whole thing.
        $byType = [];
        $groupTarget = [];
        $groupCostType = [];
        foreach ($shares as $share) {
            $costType = (string) $share['cost_type'];
            $targetId = (int) ($share['target_document_id'] ?? 0);
            $group = $costType . '#' . $targetId;
            $groupTarget[$group] = $targetId;
            $groupCostType[$group] = $costType;
            $lineId = (int) $share['line_id'];
            if (isset($byType[$group][$lineId])) {
                $byType[$group][$lineId]['amount'] = round($byType[$group][$lineId]['amount'] + (float) $share['amount'], 4);
                continue;
            }
            $byType[$group][$lineId] = [
                'allocation_basis' => (string) $share['allocation_basis'],
                'base_qty'         => (float) $share['base_qty'],
                'amount'           => round((float) $share['amount'], 4),
                'books_acc_ref'    => isset($share['books_acc_ref']) && $share['books_acc_ref'] ? (int) $share['books_acc_ref'] : null,
            ];
        }
        $now = date('Y-m-d H:i:s');
        foreach ($byType as $group => $rows) {
            $costType = $groupCostType[$group];
            $total = 0.0;
            $bases = [];
            $accRef = null;
            foreach ($rows as $row) {
                $total = round($total + $row['amount'], 4);
                $bases[$row['allocation_basis']] = true;
                $accRef ??= $row['books_acc_ref'];
            }
            // The parent carries ONE basis. When the lines disagree the user overrode at least one
            // share by hand, and 'manual' is the honest answer for the charge as a whole; the basis
            // each line was actually derived on stays on the line row.
            DatabaseInsertHelper::insert($db, 'inv_landed_costs', [
                'cmp_id'             => $cmpId,
                'document_id'        => $documentId,
                'target_document_id' => $groupTarget[$group],
                'cost_type'          => $costType,
                'amount'             => $total,
                'allocation_basis'   => count($bases) === 1 ? (string) array_key_first($bases) : 'manual',
                'books_acc_ref'      => $accRef,
                'created_at'         => $now,
            ]);
            $landedCostId = DatabaseInsertHelper::lastInsertId($db);
            foreach ($rows as $lineId => $row) {
                DatabaseInsertHelper::insert($db, 'inv_landed_cost_lines', [
                    'landed_cost_id'   => $landedCostId,
                    'cmp_id'           => $cmpId,
                    'target_line_id'   => (int) $lineId,
                    'allocated_amount' => $row['amount'],
                    'per_unit_amount'  => $row['base_qty'] > 0 ? round($row['amount'] / $row['base_qty'], 4) : 0,
                    'allocation_basis' => $row['allocation_basis'],
                    'created_at'       => $now,
                ]);
            }
        }
    }

    /**
     * LANDED_COST: charges that arrived AFTER the receipt, allocated onto its inward lines.
     *
     * metadata.target_document_id names the receipt; metadata.charges[] are the charges, each with
     * a cost_type, an amount, an allocation_basis and — for manual / direct — the per-line shares.
     * The document carries no lines of its own: a freight bill has no item and no quantity.
     *
     * Posting raises each affected line's valuation, raises the cost layer still holding that
     * receipt (or re-averages the weighted average), writes the allocation detail, and RETURNS a
     * STOCK_REVALUATION effect. It returns it rather than writing accounting_effects_json, because
     * post() persists and publishes the array applyPosting() hands back, in this same transaction —
     * anything written straight to the column is overwritten before Books can read it.
     *
     * WHAT THIS DELIBERATELY DOES NOT DO, v1: stock already ISSUED out of the target receipt is not
     * retro-costed. The charge is absorbed only by what is still on hand, so a receipt that is half
     * sold absorbs half the freight and the rest comes back as a `landed_cost_not_absorbed` warning
     * naming the remainder, for the caller to expense. It is stated here, in the API contract and in
     * the warning itself, because a COGS difference nobody is told about is the exact failure this
     * architecture exists to prevent. Retro-costing what was already sold means re-opening a period
     * that may already be filed, and that needs the landed cost to carry its own effective date —
     * a v2 design, not a v1 patch. The same reasoning is why the TARGET's date is checked against
     * the period lock in landedCostTargetDocument(): a receipt in a filed period may not be loaded
     * at all, rather than loaded quietly from outside the lock.
     *
     * Because only the absorbed part is capitalised, the unabsorbed remainder exists in exactly one
     * place — the warning — and never on the receipt line as well. That matters beyond tidiness: a
     * later BACKDATED recalculation covering the target's date re-prices from the stored line rate
     * (RecalculationService::decidedInwardUnitCost prefers it), so a line carrying the WHOLE charge
     * would push the expensed remainder into COGS a second time. Carrying only the absorbed part
     * means a replay can shift that amount between COGS and closing stock but can never grow the
     * total: the line's valuation_amount always equals what has gone to COGS plus what the layers
     * still hold. That redistribution is still a change nobody asked for, which is why this method
     * enqueues no recalculation job of its own.
     *
     * @param array<string, mixed> $doc
     * @param list<array<string, mixed>> $warnings
     * @return array<string, mixed>|null
     */
    private function applyLandedCost($db, int $cmpId, array $doc, ?string $actor, array &$warnings): ?array
    {
        $documentId = (int) $doc['document_id'];
        $meta = is_array($doc['metadata'] ?? null) ? $doc['metadata'] : [];
        $targetIds = DocumentService::landedCostTargets($meta);
        $charges = DocumentService::landedCostCharges($meta);
        // Intake point two for the company's capitalisation policy: the charges a LANDED_COST
        // document carries. Entry refused an excluded type when the draft was saved; this asks the
        // stored metadata again, because posting is the moment the rupees reach stock value and a
        // draft can outlive the policy it was written under. The whole allocation is refused rather
        // than the offending charge skipped: skipping would raise some lines and quietly leave the
        // rest of the bill nowhere, which is the dropped cost this refusal exists to prevent.
        $capitalisable = $this->settings->capitalisableLandedCostTypes($cmpId);
        foreach ($charges as $i => $charge) {
            DocumentService::assertCostTypeCapitalisable((string) $charge['cost_type'], $capitalisable, 'Charge ' . ($i + 1));
        }
        if (in_array($documentId, $targetIds, true)) {
            throw InventoryException::validation('A landed cost allocation cannot load itself');
        }
        // Every receipt is cleared BEFORE any of them is written to. A consignment that arrived
        // over two GRNs is one bill, and a run that raised the first receipt's cost and then found
        // the second one locked would leave half a bill capitalised — the transaction rolls that
        // back, but only because nothing between here and the commit is allowed to be partial.
        $targets = [];
        $targetLines = [];
        $lineTarget = [];
        foreach ($targetIds as $targetId) {
            $targets[$targetId] = $this->landedCostTargetDocument($db, $cmpId, $targetId);
            foreach ($this->landedCostTargetLines($db, $cmpId, $targetId) as $lineId => $line) {
                $targetLines[$lineId] = $line;
                $lineTarget[$lineId] = $targetId;
            }
        }

        // Per target line: how much of each charge it takes.
        $shares = [];
        $perLineTotal = [];
        $chargeTotal = 0.0;
        foreach ($charges as $i => $charge) {
            $chargeTotal = round($chargeTotal + $charge['amount'], 4);
            $allocated = $this->allocateChargeOverLines($charge, $targetLines, 'Charge ' . ($i + 1));
            foreach ($allocated as $lineId => $amount) {
                if (abs($amount) < 0.00005) {
                    continue;
                }
                $perLineTotal[$lineId] = round(($perLineTotal[$lineId] ?? 0) + $amount, 4);
                $shares[] = [
                    'cost_type'          => $charge['cost_type'],
                    'allocation_basis'   => $charge['allocation_basis'],
                    'line_id'            => $lineId,
                    'target_document_id' => $lineTarget[$lineId],
                    'base_qty'           => (float) $targetLines[$lineId]['base_qty'],
                    'amount'             => $amount,
                    'books_acc_ref'      => $charge['books_acc_ref'],
                ];
            }
        }

        $absorbedTotal = 0.0;
        $now = date('Y-m-d H:i:s');
        foreach ($perLineTotal as $lineId => $amount) {
            $line = $targetLines[$lineId];
            $baseQty = (float) $line['base_qty'];
            $perUnit = round($amount / $baseQty, 4);
            // The cost state is raised FIRST and the line is credited with what it ABSORBED, never
            // with the whole allocation. The two figures differ exactly when part of the receipt has
            // already been issued, and stamping the whole allocation on the line then is not a
            // rounding difference, it is a double count: the document tells the operator to expense
            // the unabsorbed remainder (that is the landed_cost_not_absorbed warning) while leaving
            // the line carrying a rate that includes it, and RecalculationService::
            // decidedInwardUnitCost() prefers the stored line rate — so the next replay covering
            // this date re-prices the units that were already sold at the raised rate and pushes the
            // same rupees into COGS a second time. It also makes /v1/reconciliation report a stock
            // value no layer backs, because ReconciliationService::lineValuationEffectSql() sums
            // l.valuation_amount per document while the effect published to Books carries only the
            // absorbed part.
            //
            // Crediting the absorbed part instead keeps every reader in agreement:
            //     line valuation_amount == (what already went to COGS) + (what the layers still hold)
            // and a replay can only redistribute that total between the two, never grow it.
            $absorbed = $this->raiseCostState($db, $cmpId, $line, $perUnit, $now);
            $absorbedTotal = round($absorbedTotal + $absorbed, 4);
            if (abs($absorbed) < 0.00005) {
                continue;
            }
            $newAmount = round((float) $line['valuation_amount'] + $absorbed, 4);
            $db->table('inv_document_lines')->where('line_id', $lineId)->where('cmp_id', $cmpId)->update([
                'valuation_rate'     => round($newAmount / $baseQty, 4),
                'valuation_amount'   => $newAmount,
                'landed_cost_amount' => round((float) $line['landed_cost_amount'] + $absorbed, 4),
            ]);
        }

        $this->writeLandedCostAllocation($db, $cmpId, $documentId, $shares);

        $targetNos = [];
        foreach ($targets as $id => $row) {
            $targetNos[$id] = $row['document_no'] ?? ('#' . $id);
        }
        $unabsorbed = round($chargeTotal - $absorbedTotal, 4);
        if ($unabsorbed > 0.01) {
            $warnings[] = [
                'code'    => 'landed_cost_not_absorbed',
                'message' => sprintf(
                    '%s of the %s allocated was not absorbed by stock still on hand: that much of %s has already been issued, and this allocation does not retro-cost what was already sold. Expense the remainder.',
                    number_format($unabsorbed, 2, '.', ''),
                    number_format($chargeTotal, 2, '.', ''),
                    count($targetNos) === 1 ? 'the receipt' : 'the receipts loaded',
                ),
                'details' => [
                    'target_document_id'  => $targetIds[0],
                    'target_document_ids' => $targetIds,
                    'charge_total'        => $chargeTotal,
                    'absorbed'            => $absorbedTotal,
                    'unabsorbed'          => $unabsorbed,
                ],
            ];
        }
        $this->audit->log($cmpId, 'document', $documentId, 'document.landed_cost', $actor, [
            // Both shapes: the singular keys are what every reader written against the
            // one-receipt allocation looks for, and dropping them would blank the audit trail of
            // an allocation that is still, in the overwhelming majority, against one receipt.
            'target_document_id'   => $targetIds[0],
            'target_document_no'   => $targetNos[$targetIds[0]] ?? null,
            'target_document_ids'  => $targetIds,
            'target_document_nos'  => array_values($targetNos),
            'charge_total' => $chargeTotal, 'absorbed' => $absorbedTotal, 'unabsorbed' => max(0.0, $unabsorbed),
        ]);

        return abs($absorbedTotal) > 0.00001 ? ['effect' => 'STOCK_REVALUATION', 'amount' => round($absorbedTotal, 4)] : null;
    }

    /**
     * The receipt a landed cost names, or a refusal saying why it cannot be loaded.
     *
     * @return array<string, mixed>
     */
    private function landedCostTargetDocument($db, int $cmpId, int $targetId): array
    {
        $res = $db->table('inv_documents')->select('document_id, cmp_id, bo_id, document_type, document_no, document_date, status, stock_effect')->where('document_id', $targetId)->get();
        if ($res === false) {
            // DBDebug is off in every deployed environment: a refused query answers FALSE and
            // ->getRowArray() on false is fatal. A target that cannot be read stops the posting.
            throw new \RuntimeException('Could not read the receipt this landed cost allocation names', 500);
        }
        $target = $res->getRowArray();
        if (!$target) {
            throw InventoryException::validation('Receipt #' . $targetId . ' was not found, so there is nothing to load this cost onto', ['target_document_id' => $targetId]);
        }
        if ((int) $target['cmp_id'] !== $cmpId) {
            throw InventoryException::validation('Receipt #' . $targetId . ' belongs to another company', ['target_document_id' => $targetId]);
        }
        if (!in_array((string) $target['status'], ['POSTED', 'COMPLETED', 'PARTIALLY_FULFILLED'], true)) {
            throw InventoryException::validation(
                'Receipt #' . $targetId . ' is ' . $target['status'] . '. A cost can only be loaded onto stock that has actually been received, so the receipt must be posted first.',
                ['target_document_id' => $targetId, 'status' => $target['status']],
            );
        }
        $targetType = (string) $target['document_type'];
        $targetSpec = DocumentTypeRegistry::get($targetType);
        $stockEffect = (string) ($target['stock_effect'] ?? '');
        if ($targetSpec === null || !self::valuesLinesNow($targetType, $targetSpec, $stockEffect)) {
            throw InventoryException::validation(
                'Receipt #' . $targetId . ' is a ' . ($targetSpec['label'] ?? $targetType) . ', which carries no valuation on its lines, so there is no cost of goods on it to add to.',
                ['target_document_id' => $targetId, 'document_type' => $targetType],
            );
        }
        // The lock is checked on the TARGET's date, not only on this document's own.
        //
        // assertDateAllowed() has already cleared the landed cost's own date, but this method does
        // not write anything on its own date: it rewrites the RECEIPT's stored valuation and the
        // cost layer the receipt opened, both of which sit in the receipt's period. A freight bill
        // dated in May that loads an April receipt would otherwise walk straight through a lock
        // that exists precisely because April has been reported and its GST filed — and a
        // REVALUATION attempting the same change inside April is refused, so the type would be the
        // one way round the lock. Reaching back into a filed period needs the landed cost to carry
        // its own effective date, which is the v2 design named in this class's docblock; until then
        // the honest answer is a refusal that says so.
        try {
            $this->assertPeriodOpen($cmpId, (int) $target['bo_id'], (string) $target['document_date']);
        } catch (InventoryException $e) {
            throw InventoryException::periodLocked(
                'Receipt #' . $targetId . ' is dated ' . $target['document_date'] . ', which is inside a locked period (' . $e->getMessage()
                . '). Loading a cost onto it would change a closing stock that has already been reported for that period, so it is refused rather than done quietly.',
                ['target_document_id' => $targetId, 'target_document_date' => $target['document_date'], 'document_date' => $target['document_date']],
            );
        }

        return $target;
    }

    /**
     * The target's valued inward lines, keyed by line id.
     *
     * valuation_rate IS NULL means the line was never valued (the same fact reverseLineValuation()
     * reads), and a line that was never valued has no cost of goods for a landed cost to join.
     *
     * @return array<int, array<string, mixed>>
     */
    private function landedCostTargetLines($db, int $cmpId, int $targetId): array
    {
        $res = $db->table('inv_document_lines')
            ->select('line_id, item_id, warehouse_id, base_qty, valuation_rate, valuation_amount, landed_cost_amount')
            ->where('cmp_id', $cmpId)->where('document_id', $targetId)->where('direction', 'in')
            ->where('base_qty >', 0)->where('valuation_rate IS NOT NULL', null, false)
            ->orderBy('line_id', 'ASC')->get();
        if ($res === false) {
            throw new \RuntimeException('Could not read the lines of the receipt this landed cost allocation names', 500);
        }
        $lines = [];
        foreach ($res->getResultArray() as $row) {
            $lines[(int) $row['line_id']] = [
                'line_id'            => (int) $row['line_id'],
                'item_id'            => (int) $row['item_id'],
                'warehouse_id'       => $row['warehouse_id'] !== null ? (int) $row['warehouse_id'] : null,
                'base_qty'           => (float) $row['base_qty'],
                'valuation_rate'     => (float) $row['valuation_rate'],
                'valuation_amount'   => (float) $row['valuation_amount'],
                'landed_cost_amount' => (float) $row['landed_cost_amount'],
            ];
        }
        if ($lines === []) {
            throw InventoryException::validation(
                'Receipt #' . $targetId . ' has no valued inward line to load a cost onto',
                ['target_document_id' => $targetId],
            );
        }

        return $lines;
    }

    /**
     * One charge spread over the target's valued inward lines.
     *
     * value -> the line's own valuation_amount. Books allocates by TAXABLE value, which Inventory
     *          does not hold; on an ordinary purchase the two are the same number, and where they
     *          differ the cost of the goods is the only basis this side can compute honestly.
     * qty   -> base quantity.
     * equal -> the same share to every line, whatever it is worth or how much of it there is.
     * manual / direct -> the amounts the user gave, with the residual settled so they tie exactly.
     *
     * @param array{cost_type: string, amount: float, allocation_basis: string, lines: array<int, float>} $charge
     * @param array<int, array<string, mixed>> $targetLines
     * @return array<int, float>
     */
    private function allocateChargeOverLines(array $charge, array $targetLines, string $where): array
    {
        if (in_array($charge['allocation_basis'], ['manual', 'direct'], true)) {
            $given = [];
            foreach ($charge['lines'] as $lineId => $amount) {
                if (!isset($targetLines[$lineId])) {
                    throw InventoryException::validation(
                        $where . ': line #' . $lineId . ' is not a valued inward line of any receipt being loaded',
                        ['line_id' => $lineId],
                    );
                }
                if ($amount < 0) {
                    throw InventoryException::validation($where . ': line #' . $lineId . ' cannot take a negative share');
                }
                $given[$lineId] = round((float) $amount, 4);
            }

            return self::settleResidual($given, $charge['amount']);
        }
        $weights = [];
        foreach ($targetLines as $lineId => $line) {
            $weights[$lineId] = match ($charge['allocation_basis']) {
                'qty' => (float) $line['base_qty'],
                // Every line weighs the same, so the split is even and the residual rule still puts
                // the last paisa somewhere rather than dropping it. A weight of 1 rather than a
                // division here keeps one allocator, one rounding rule and one residual placement
                // for every basis.
                'equal' => 1.0,
                default => (float) $line['valuation_amount'],
            };
        }

        return self::allocateCharge($charge['amount'], $weights, $charge['cost_type'] . ' charge');
    }

    /**
     * How much of an inward line's quantity is STILL ON HAND, for an item whose valuation method
     * keeps no cost layers.
     *
     * FIFO and LIFO answer this exactly: the layer the line opened carries qty_remaining. The
     * weighted average keeps no layer at all (ValuationEngine::recordReceipt inserts one only for
     * the layered methods), so the same question is answered from the movement ledger under the
     * oldest-goods-leave-first reading: everything received AFTER this receipt is still on hand
     * before any of this receipt's units are, so what is left of this line is
     * (quantity on hand) − (quantity received since), bounded by what the line brought in.
     *
     * Without it the WAC branch capped the uplift at min(quantity on hand, this line's quantity) —
     * but quantity on hand is the ITEM's, across every receipt. A charge on a receipt that is nine
     * tenths sold was therefore capitalised in full onto whatever else happened to be in the pool,
     * including another supplier's goods; closing stock was overstated by the difference, the
     * accounting effect published to Books was up to ten times the FIFO one on identical business
     * facts, and landed_cost_not_absorbed — the warning this v1 rests on — never fired under WAC.
     *
     * The ordering assumption is stated rather than hidden: it is the only reading under which
     * "the receipt cannot load cost onto stock it never supplied" has an answer for a method that
     * tracks no receipts, and it makes WAC and FIFO capitalise the same rupees on the same facts.
     *
     * @param array<string, mixed> $line
     */
    private function receiptQtyStillOnHand($db, int $cmpId, array $line, float $onHand): float
    {
        $baseQty = (float) $line['base_qty'];
        $wh = $this->valuation->scopeWarehouse($cmpId, $line['warehouse_id']);
        $ownRes = $db->table('inv_stock_movements')->select('movement_id, movement_date')
            ->where('cmp_id', $cmpId)->where('line_id', (int) $line['line_id'])->where('movement_kind', 'physical')->where('direction', 'in')
            ->orderBy('movement_id', 'ASC')->get();
        if ($ownRes === false) {
            // DBDebug is off in every deployed environment: a refused query answers FALSE and
            // ->getRowArray() on false is fatal. Absorbing a charge onto a quantity that could not
            // be read would be a guess written into closing stock, so the posting stops instead.
            throw new \RuntimeException('Could not read the stock movement of receipt line #' . (int) $line['line_id'], 500);
        }
        $own = $ownRes->getRowArray();
        if (!$own) {
            // No movement row for a line the document valued: nothing says anything was received
            // after it either, so this degrades to the quantity the line brought in or the pool,
            // whichever is smaller.
            return max(0.0, min($onHand, $baseQty));
        }
        $b = $db->table('inv_stock_movements')->select('COALESCE(SUM(qty), 0) AS q', false)
            ->where('cmp_id', $cmpId)->where('item_id', (int) $line['item_id'])->where('qty >', 0)
            ->groupStart()
                ->where('movement_date >', $own['movement_date'])
                ->orGroupStart()->where('movement_date', $own['movement_date'])->where('movement_id >', (int) $own['movement_id'])->groupEnd()
            ->groupEnd();
        if ($wh !== null) {
            $b->where('warehouse_id', $wh);
        }
        $res = $b->get();
        if ($res === false) {
            throw new \RuntimeException('Could not read what has been received since receipt line #' . (int) $line['line_id'], 500);
        }
        $receivedAfter = (float) ($res->getRowArray()['q'] ?? 0);

        return max(0.0, min($baseQty, round($onHand - $receivedAfter, 4)));
    }

    /**
     * Raise the cost state of ONE target line by $perUnit and answer how much of the charge that
     * absorbed — which is only what is still on hand.
     *
     * FIFO/LIFO: the layer this receipt line opened is re-priced, and it absorbs the uplift on the
     * quantity it still holds. WAC: the average takes the uplift on the quantity THIS LINE still
     * has on hand (receiptQtyStillOnHand), because the receipt cannot load cost onto stock it never
     * supplied.
     */
    private function raiseCostState($db, int $cmpId, array $line, float $perUnit, string $now): float
    {
        $itemId = (int) $line['item_id'];
        $lineId = (int) $line['line_id'];
        $wh = $this->valuation->scopeWarehouse($cmpId, $line['warehouse_id']);
        if ($this->valuation->resolveMethod($cmpId, $itemId) === 'WAC') {
            $b = $db->table('inv_wac_state')->where('cmp_id', $cmpId)->where('item_id', $itemId)->where('warehouse_id', $wh ?? 0)->get();
            if ($b === false) {
                throw new \RuntimeException('Could not read the weighted-average state for item #' . $itemId, 500);
            }
            $state = $b->getRowArray();
            $onHand = (float) ($state['qty_on_hand'] ?? 0);
            if (!$state || $onHand <= 0) {
                return 0.0;
            }
            $absorbable = $this->receiptQtyStillOnHand($db, $cmpId, $line, $onHand);
            if ($absorbable <= 0) {
                return 0.0;
            }
            $absorbed = round($absorbable * $perUnit, 4);
            $db->table('inv_wac_state')->where('cmp_id', $cmpId)->where('item_id', $itemId)->where('warehouse_id', $wh ?? 0)->update([
                'average_cost' => round(($onHand * (float) $state['average_cost'] + $absorbed) / $onHand, 4),
                'updated_at'   => $now,
            ]);

            return $absorbed;
        }
        $b = $db->table('inv_cost_layers')->where('cmp_id', $cmpId)->where('source_line_id', $lineId)->whereIn('layer_kind', ['receipt', 'opening'])->get();
        if ($b === false) {
            throw new \RuntimeException('Could not read the cost layer of receipt line #' . $lineId, 500);
        }
        $layer = $b->getRowArray();
        if (!$layer) {
            return 0.0;
        }
        $db->table('inv_cost_layers')->where('layer_id', (int) $layer['layer_id'])->update(['unit_cost' => round((float) $layer['unit_cost'] + $perUnit, 4)]);

        return round(max(0.0, (float) $layer['qty_remaining']) * $perUnit, 4);
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
        if ($line['valuation_rate'] === null) {
            // This line was never valued, so there is nothing of it to unwind. The decision has to
            // be made from what the line RECORDED, not from what its document type would record
            // today: an inward challan posted before this type became valued carries a null rate
            // and contributed to no layer and no WAC state, but reversing it on today's rule
            // subtracts its quantity from qty_on_hand and re-averages at zero — taking out units
            // that were never put in and inflating the unit cost of everything left. FIFO survives
            // that by accident (there is no layer to find), WAC does not, and WAC is where it is
            // invisible. Posting writes 0.0 rather than null for a receipt it genuinely costed at
            // nothing, so null means "untouched" exactly, and it stays right for a document whose
            // lines were only partly repaired.
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
                // How much of the valuation is landed cost, so Books can reconcile the gap between
                // what it invoiced and what the stock is carried at without asking a second time.
                'landed_cost_amount' => $l['landed_cost_amount'] ?? null,
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
