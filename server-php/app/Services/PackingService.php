<?php

namespace App\Services;

use App\Exceptions\InventoryException;

/**
 * Packing-list state (inv_packing_meta) on top of PACKING documents.
 *
 * Posting a PACKING document (DocumentPostingService::applyPacking) moves the lines into the
 * `packed` bucket and opens the meta row. From there a list is:
 *   open      packed, waiting for a sale
 *   locked    a Books sale draft is being keyed against it (locked_by_external_ref) or an
 *             inventory document holds it (locked_by_document_id)
 *   consumed  a posted sale issued the packed goods; the sale names the list in
 *             metadata.linked_source_document_id and no second sale may name it again
 *   unpacked  goods went back to available stock (unpack); the document stays POSTED so the
 *             pack/unpack trail is complete and a later reversal nets to zero
 */
class PackingService
{
    public const STATUS_OPEN = 'open';
    public const STATUS_LOCKED = 'locked';
    public const STATUS_CONSUMED = 'consumed';
    public const STATUS_UNPACKED = 'unpacked';
    public const STATUSES = [self::STATUS_OPEN, self::STATUS_LOCKED, self::STATUS_CONSUMED, self::STATUS_UNPACKED];

    public function __construct(
        protected ?DocumentService $documents = null,
        protected ?StockStatusService $status = null,
        protected ?AuditService $audit = null,
    ) {
        $this->documents ??= new DocumentService();
        $this->status ??= new StockStatusService();
        $this->audit ??= new AuditService();
    }

    /** @return array<string, mixed>|null raw inv_packing_meta row */
    public function meta(int $cmpId, int $documentId): ?array
    {
        // DBDebug is off outside the test suite, so a failed statement returns false here.
        $res = \Config\Database::connect()->table('inv_packing_meta')->where('cmp_id', $cmpId)->where('document_id', $documentId)->get();

        return ($res ? $res->getRowArray() : null) ?: null;
    }

    /**
     * The PACKING document with its lines plus `packing` (meta, null until posted).
     *
     * @return array<string, mixed>
     */
    public function get(int $cmpId, int $documentId): array
    {
        $doc = $this->documents->get($cmpId, $documentId);
        if ($doc['document_type'] !== 'PACKING') {
            throw InventoryException::notFound('Document #' . $documentId . ' is not a packing list');
        }
        $doc['packing'] = self::presentMeta($this->meta($cmpId, $documentId));

        return $doc;
    }

    /**
     * Return packed goods to available stock: `unpack` status movement for every line and
     * packing_status = unpacked. 409 when the list is locked, consumed or already unpacked.
     *
     * @return array<string, mixed>
     */
    public function unpack(int $cmpId, int $documentId, ?string $actor, ?string $reason = null): array
    {
        [$doc, $meta] = $this->postedWithMeta($cmpId, $documentId);
        if ($meta['packing_status'] !== self::STATUS_OPEN) {
            throw InventoryException::invalidState('Packing list is ' . $meta['packing_status'] . ' and cannot be unpacked', $this->stateDetails($meta));
        }
        $lines = array_map(static fn ($l) => ['item_id' => (int) $l['item_id'], 'unit_id' => $l['unit_id'], 'warehouse_id' => $l['warehouse_id'], 'batch_id' => $l['batch_id'], 'qty' => (float) $l['qty']], $doc['lines']);
        $db = \Config\Database::connect();
        $db->transStart();
        try {
            $this->status->apply($cmpId, $documentId, StockStatusService::MOV_UNPACK, $lines);
            $db->table('inv_packing_meta')->where('cmp_id', $cmpId)->where('document_id', $documentId)->update([
                'packing_status' => self::STATUS_UNPACKED, 'locked_by_document_id' => null, 'locked_by_external_ref' => null, 'locked_at' => null, 'updated_at' => date('Y-m-d H:i:s'),
            ]);
            $db->transComplete();
            if ($db->transStatus() === false) {
                throw new \RuntimeException('Unpack transaction failed', 500);
            }
        } catch (\Throwable $e) {
            $db->transRollback();
            $db->resetTransStatus();
            throw $e;
        }
        $this->audit->log($cmpId, 'document', $documentId, 'packing.unpack', $actor, ['reason' => $reason, 'entity_uuid' => $doc['document_uuid']], ['packing_status' => $meta['packing_status']], ['packing_status' => self::STATUS_UNPACKED]);

        return $this->get($cmpId, $documentId);
    }

    /**
     * Hold the list for a sale being keyed (Books draft id in $externalRef) or for an inventory
     * document ($lockedByDocumentId). Re-locking with the same holder is a no-op; another holder is 409.
     *
     * @return array<string, mixed>
     */
    public function lock(int $cmpId, int $documentId, ?string $actor, ?string $externalRef = null, ?int $lockedByDocumentId = null): array
    {
        [$doc, $meta] = $this->postedWithMeta($cmpId, $documentId);
        $externalRef = $externalRef !== null && trim($externalRef) !== '' ? substr(trim($externalRef), 0, 128) : null;
        $lockedByDocumentId = $lockedByDocumentId !== null && $lockedByDocumentId > 0 ? $lockedByDocumentId : null;
        if ($meta['packing_status'] === self::STATUS_LOCKED) {
            if ($this->sameHolder($meta, $externalRef, $lockedByDocumentId)) {
                return $this->get($cmpId, $documentId);
            }
            throw InventoryException::invalidState('Packing list is already locked by another sale', $this->stateDetails($meta));
        }
        if ($meta['packing_status'] !== self::STATUS_OPEN) {
            throw InventoryException::invalidState('Packing list is ' . $meta['packing_status'] . ' and cannot be locked', $this->stateDetails($meta));
        }
        $now = date('Y-m-d H:i:s');
        \Config\Database::connect()->table('inv_packing_meta')->where('cmp_id', $cmpId)->where('document_id', $documentId)->update([
            'packing_status' => self::STATUS_LOCKED, 'locked_by_external_ref' => $externalRef, 'locked_by_document_id' => $lockedByDocumentId, 'locked_at' => $now, 'updated_at' => $now,
        ]);
        $this->audit->log($cmpId, 'document', $documentId, 'packing.lock', $actor, ['entity_uuid' => $doc['document_uuid'], 'locked_by_external_ref' => $externalRef, 'locked_by_document_id' => $lockedByDocumentId], ['packing_status' => $meta['packing_status']], ['packing_status' => self::STATUS_LOCKED]);

        return $this->get($cmpId, $documentId);
    }

    /**
     * Release a lock. When $externalRef is given it must match the holder unless $force.
     * An open list is a no-op; consumed / unpacked lists are 409.
     *
     * @return array<string, mixed>
     */
    public function unlock(int $cmpId, int $documentId, ?string $actor, ?string $externalRef = null, bool $force = false): array
    {
        [$doc, $meta] = $this->postedWithMeta($cmpId, $documentId);
        if ($meta['packing_status'] === self::STATUS_OPEN) {
            return $this->get($cmpId, $documentId);
        }
        if ($meta['packing_status'] !== self::STATUS_LOCKED) {
            throw InventoryException::invalidState('Packing list is ' . $meta['packing_status'] . ' and cannot be unlocked', $this->stateDetails($meta));
        }
        $externalRef = $externalRef !== null && trim($externalRef) !== '' ? substr(trim($externalRef), 0, 128) : null;
        if (!$force && $externalRef !== null && ($meta['locked_by_external_ref'] ?? null) !== null && $meta['locked_by_external_ref'] !== $externalRef) {
            throw InventoryException::invalidState('Packing list is locked by a different sale', $this->stateDetails($meta));
        }
        \Config\Database::connect()->table('inv_packing_meta')->where('cmp_id', $cmpId)->where('document_id', $documentId)->update([
            'packing_status' => self::STATUS_OPEN, 'locked_by_external_ref' => null, 'locked_by_document_id' => null, 'locked_at' => null, 'updated_at' => date('Y-m-d H:i:s'),
        ]);
        $this->audit->log($cmpId, 'document', $documentId, 'packing.unlock', $actor, ['entity_uuid' => $doc['document_uuid'], 'force' => $force, 'previous_external_ref' => $meta['locked_by_external_ref'], 'previous_document_id' => $meta['locked_by_document_id']], ['packing_status' => $meta['packing_status']], ['packing_status' => self::STATUS_OPEN]);

        return $this->get($cmpId, $documentId);
    }

    /**
     * The packing list a sales document issues, named as metadata.linked_source_document_id.
     * Only a sales issue takes goods out of the packed bucket; a return links its own invoice
     * through the same key, so nothing else may be read as a consignment.
     *
     * @param array<string, mixed>|null $metadata
     */
    public static function consumedListId(string $documentType, ?array $metadata): int
    {
        if ($documentType !== 'SALES_ISSUE' || !is_array($metadata)) {
            return 0;
        }

        return max(0, (int) ($metadata['linked_source_document_id'] ?? 0));
    }

    /**
     * Why $meta cannot be consumed by document #$consumingDocumentId, or null when it can.
     * Re-posting the same sale is idempotent; every other document is refused, which is what
     * stops a second invoice from issuing a consignment the first one already took.
     *
     * @param array<string, mixed> $meta
     */
    public static function consumptionRefusal(array $meta, int $consumingDocumentId): ?string
    {
        $status = (string) ($meta['packing_status'] ?? '');
        if ($status === self::STATUS_CONSUMED) {
            return (int) ($meta['locked_by_document_id'] ?? 0) === $consumingDocumentId
                ? null
                : 'Packing list was already consumed by document #' . (int) ($meta['locked_by_document_id'] ?? 0);
        }
        if ($status === self::STATUS_UNPACKED) {
            return 'Packing list was unpacked and cannot be consumed';
        }

        return null;
    }

    /**
     * Close the packing list a posting sale names: release the packed goods and mark the list
     * consumed, so the next invoice against it is refused instead of issuing the consignment a
     * second time. No-op when the sale names no list, or names a document that is not one.
     *
     * @param array<string, mixed> $saleDoc       the posting document, hydrated
     * @param bool                 $alreadyIssued the sale already drained the packed bucket line
     *                                            by line (stock_effect from_packing)
     * @return array<string, mixed>|null the consumed list
     */
    public function consumeForSale(int $cmpId, array $saleDoc, ?string $actor, bool $alreadyIssued = false): ?array
    {
        $listId = self::consumedListId((string) ($saleDoc['document_type'] ?? ''), $saleDoc['metadata'] ?? null);
        $consumingId = (int) ($saleDoc['document_id'] ?? 0);
        if ($listId <= 0 || $listId === $consumingId || $this->documentType($cmpId, $listId) !== 'PACKING') {
            return null;
        }
        [, $meta] = $this->postedWithMeta($cmpId, $listId);
        if ($meta['packing_status'] === self::STATUS_UNPACKED) {
            // The consignment went back to available stock before this invoice posted, so there is
            // nothing set aside left for it to take and it bills the goods out of general stock
            // like any other sale. Only markConsumed(), where the caller named this list, refuses:
            // here the link is a stale reference on the draft and failing the invoice over it
            // would leave a customer unbillable.
            return null;
        }
        $refusal = self::consumptionRefusal($meta, $consumingId);
        if ($refusal !== null) {
            throw InventoryException::invalidState($refusal, $this->stateDetails($meta));
        }
        if (!$alreadyIssued && $meta['packing_status'] !== self::STATUS_CONSUMED) {
            // Books clamps a sale to on_invoice, so nothing above drained the packed bucket: the
            // consignment leaves here. Booked against the sale, so reversing it puts the goods
            // back where reverseForDocument expects to find them.
            $split = self::splitConsumption($this->documents->get($cmpId, $listId)['lines'], $saleDoc['lines'] ?? []);
            foreach ([StockStatusService::MOV_SALE_ISSUE => $split['issued'], StockStatusService::MOV_UNPACK => $split['released']] as $movementType => $lines) {
                if ($lines !== []) {
                    $this->status->apply($cmpId, $consumingId, $movementType, $lines);
                }
            }
        }

        return $this->markConsumed($cmpId, $listId, $consumingId, $actor);
    }

    /**
     * Split the list between what the sale actually ships and what closing the list hands back.
     *
     * The invoice that names a list closes it whether or not it bills all of it, so the residual
     * has to leave the packed bucket too — but as an `unpack`, because the sale never issued it.
     * Booking the whole list as `sale_issue` states in the status journal, which is the audit
     * trail for the packed bucket, that the invoice issued goods it did not.
     *
     * Sale quantities are matched in base units on (item, warehouse, batch) first and on the item
     * alone for whatever is left over. Either way the bucket moves at the LIST line's own key, so
     * the match decides only which of the two movements a quantity is journalled under.
     *
     * @param list<array<string, mixed>> $listLines lines of the PACKING document
     * @param list<array<string, mixed>> $saleLines lines of the sale closing it
     * @return array{issued: list<array<string, mixed>>, released: list<array<string, mixed>>}
     */
    public static function splitConsumption(array $listLines, array $saleLines): array
    {
        $byKey = [];
        $byItem = [];
        foreach ($saleLines as $l) {
            $itemId = (int) ($l['item_id'] ?? 0);
            $base = (float) ($l['base_qty'] ?? 0);
            if ($itemId <= 0 || $base <= 0) {
                continue;
            }
            $byKey[self::bucketKey($l)] = ($byKey[self::bucketKey($l)] ?? 0.0) + $base;
            $byItem[$itemId] = ($byItem[$itemId] ?? 0.0) + $base;
        }
        $taken = array_fill_keys(array_keys($listLines), 0.0);
        foreach ([true, false] as $exactKey) {
            foreach ($listLines as $i => $l) {
                $itemId = (int) ($l['item_id'] ?? 0);
                $key = self::bucketKey($l);
                $pool = $exactKey ? ($byKey[$key] ?? 0.0) : ($byItem[$itemId] ?? 0.0);
                $take = min((float) ($l['base_qty'] ?? 0) - $taken[$i], $pool);
                if ($take <= 0) {
                    continue;
                }
                $taken[$i] += $take;
                $byItem[$itemId] -= $take;
                if ($exactKey) {
                    $byKey[$key] -= $take;
                }
            }
        }
        $split = ['issued' => [], 'released' => []];
        foreach ($listLines as $i => $l) {
            $qty = (float) ($l['qty'] ?? 0);
            $base = (float) ($l['base_qty'] ?? 0);
            $line = ['item_id' => (int) $l['item_id'], 'unit_id' => $l['unit_id'] ?? null, 'warehouse_id' => $l['warehouse_id'] ?? null, 'batch_id' => $l['batch_id'] ?? null];
            // Entered units, not base, so the journal reads in the unit the list was packed in.
            $issued = $base > 0 ? round($qty * ($taken[$i] / $base), 4) : 0.0;
            if ($issued > 0.0000001) {
                $split['issued'][] = $line + ['qty' => $issued];
            }
            if ($qty - $issued > 0.0000001) {
                $split['released'][] = $line + ['qty' => $qty - $issued];
            }
        }

        return $split;
    }

    /** The (item, warehouse, batch) a status movement lands on. */
    private static function bucketKey(array $line): string
    {
        return (int) ($line['item_id'] ?? 0) . '|' . (int) ($line['warehouse_id'] ?? 0) . '|' . (int) ($line['batch_id'] ?? 0);
    }

    /**
     * Refuse to reverse a PACKING document whose consignment an invoice has already issued.
     *
     * The sale emptied the packed bucket when it consumed the list, so unwinding the `pack`
     * movement here credits back goods that are no longer in it: packed goes negative and
     * availableFrom() subtracts packed, so `available` ends up above on_hand and the negative
     * stock guard will let those units be sold a second time. The invoice has to be reversed
     * first — that hands the consignment back through releaseConsumedBy(), and the list is then
     * open and reversible. A no-op for every document that is not a consumed packing list.
     *
     * @param array<string, mixed> $doc the document being reversed
     */
    public function assertReversible(int $cmpId, array $doc): void
    {
        if (($doc['document_type'] ?? '') !== 'PACKING') {
            return;
        }
        $meta = $this->meta($cmpId, (int) ($doc['document_id'] ?? 0));
        if ($meta === null || $meta['packing_status'] !== self::STATUS_CONSUMED) {
            return;
        }

        throw InventoryException::invalidState(
            'Packing list was issued by document #' . (int) ($meta['locked_by_document_id'] ?? 0) . ' and cannot be reversed; reverse that document first',
            $this->stateDetails($meta),
        );
    }

    /**
     * A reversed sale hands the consignment back: every list it consumed reopens, so the goods
     * can be invoiced again or unpacked instead of being stranded in the packed bucket.
     */
    public function releaseConsumedBy(int $cmpId, int $consumingDocumentId, ?string $actor): int
    {
        $db = \Config\Database::connect();
        $res = $db->table('inv_packing_meta')->select('document_id')->where('cmp_id', $cmpId)
            ->where('locked_by_document_id', $consumingDocumentId)->where('packing_status', self::STATUS_CONSUMED)->get();
        $rows = $res ? $res->getResultArray() : [];
        foreach ($rows as $row) {
            $db->table('inv_packing_meta')->where('cmp_id', $cmpId)->where('document_id', (int) $row['document_id'])->update([
                'packing_status' => self::STATUS_OPEN, 'locked_by_document_id' => null, 'locked_by_external_ref' => null, 'locked_at' => null, 'updated_at' => date('Y-m-d H:i:s'),
            ]);
            $this->audit->log($cmpId, 'document', (int) $row['document_id'], 'packing.release', $actor, ['released_by_document_id' => $consumingDocumentId], ['packing_status' => self::STATUS_CONSUMED], ['packing_status' => self::STATUS_OPEN]);
        }

        return count($rows);
    }

    /**
     * The packed goods were issued by $consumingDocumentId (a posted SALES_ISSUE from packing).
     * Allowed from open or locked; idempotent for the same consumer; 409 otherwise.
     *
     * @return array<string, mixed>
     */
    public function markConsumed(int $cmpId, int $documentId, int $consumingDocumentId, ?string $actor): array
    {
        [$doc, $meta] = $this->postedWithMeta($cmpId, $documentId);
        $refusal = self::consumptionRefusal($meta, $consumingDocumentId);
        if ($refusal !== null) {
            throw InventoryException::invalidState($refusal, $this->stateDetails($meta));
        }
        if ($meta['packing_status'] === self::STATUS_CONSUMED) {
            return $this->get($cmpId, $documentId);
        }
        $now = date('Y-m-d H:i:s');
        $db = \Config\Database::connect();
        // Compare-and-swap on the status rather than a blind write: two invoices posting against
        // the same list at once both read it open, and the loser must find nothing left to claim.
        $db->table('inv_packing_meta')->where('cmp_id', $cmpId)->where('document_id', $documentId)
            ->whereIn('packing_status', [self::STATUS_OPEN, self::STATUS_LOCKED])->update([
                'packing_status' => self::STATUS_CONSUMED, 'locked_by_document_id' => $consumingDocumentId, 'locked_by_external_ref' => null, 'locked_at' => $now, 'updated_at' => $now,
            ]);
        if ($db->affectedRows() < 1) {
            $current = $this->meta($cmpId, $documentId) ?? $meta;
            throw InventoryException::invalidState(self::consumptionRefusal($current, $consumingDocumentId) ?? 'Packing list is no longer open for consumption', $this->stateDetails($current));
        }
        $this->audit->log($cmpId, 'document', $documentId, 'packing.consume', $actor, ['entity_uuid' => $doc['document_uuid'], 'consumed_by_document_id' => $consumingDocumentId], ['packing_status' => $meta['packing_status']], ['packing_status' => self::STATUS_CONSUMED]);

        return $this->get($cmpId, $documentId);
    }

    /** @return array<string, mixed>|null */
    public static function presentMeta(?array $meta): ?array
    {
        if ($meta === null) {
            return null;
        }
        $meta['box_marks'] = json_decode((string) ($meta['box_marks_json'] ?? ''), true);
        unset($meta['box_marks_json']);
        foreach (['document_id', 'cmp_id', 'consignee_ref', 'locked_by_document_id'] as $k) {
            if (array_key_exists($k, $meta) && $meta[$k] !== null) {
                $meta[$k] = (int) $meta[$k];
            }
        }
        $meta['is_locked'] = $meta['packing_status'] === self::STATUS_LOCKED;
        $meta['is_open'] = $meta['packing_status'] === self::STATUS_OPEN;

        return $meta;
    }

    // ------------------------------------------------------------------ internals

    /**
     * The type of one document, read without hydrating it: a sale links its order or its challan
     * through the same metadata key, and only a PACKING document is a consignment.
     */
    private function documentType(int $cmpId, int $documentId): ?string
    {
        // DBDebug is off outside the test suite, so a failed statement returns false here.
        $res = \Config\Database::connect()->table('inv_documents')->select('document_type')
            ->where('cmp_id', $cmpId)->where('document_id', $documentId)->get();
        $row = $res ? $res->getRowArray() : null;

        return $row['document_type'] ?? null;
    }

    /** @return array{0: array<string, mixed>, 1: array<string, mixed>} [document, meta] */
    private function postedWithMeta(int $cmpId, int $documentId): array
    {
        $doc = $this->documents->get($cmpId, $documentId);
        if ($doc['document_type'] !== 'PACKING') {
            throw InventoryException::notFound('Document #' . $documentId . ' is not a packing list');
        }
        if (!in_array($doc['status'], ['POSTED', 'COMPLETED', 'PARTIALLY_FULFILLED'], true)) {
            throw InventoryException::invalidState('Packing list is not posted (status ' . $doc['status'] . ')', ['document_id' => $documentId, 'status' => $doc['status']]);
        }
        $meta = $this->meta($cmpId, $documentId);
        if ($meta === null) {
            throw InventoryException::invalidState('Packing list has no packing state; post it first', ['document_id' => $documentId]);
        }

        return [$doc, $meta];
    }

    private function sameHolder(array $meta, ?string $externalRef, ?int $lockedByDocumentId): bool
    {
        $refMatches = $externalRef === null ? ($meta['locked_by_external_ref'] ?? null) === null : ($meta['locked_by_external_ref'] ?? null) === $externalRef;
        $docMatches = $lockedByDocumentId === null ? (int) ($meta['locked_by_document_id'] ?? 0) === 0 : (int) ($meta['locked_by_document_id'] ?? 0) === $lockedByDocumentId;

        return $refMatches && $docMatches;
    }

    /** @return array<string, mixed> */
    private function stateDetails(array $meta): array
    {
        return [
            'document_id'            => (int) $meta['document_id'],
            'packing_status'         => $meta['packing_status'],
            'locked_by_document_id'  => $meta['locked_by_document_id'] !== null ? (int) $meta['locked_by_document_id'] : null,
            'locked_by_external_ref' => $meta['locked_by_external_ref'],
            'locked_at'              => $meta['locked_at'],
        ];
    }
}
