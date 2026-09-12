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
 *   consumed  a posted sale issued the packed goods (SALES_ISSUE stock_effect from_packing)
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
        return \Config\Database::connect()->table('inv_packing_meta')->where('cmp_id', $cmpId)->where('document_id', $documentId)->get()->getRowArray() ?: null;
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
     * The packed goods were issued by $consumingDocumentId (a posted SALES_ISSUE from packing).
     * Allowed from open or locked; idempotent for the same consumer; 409 otherwise.
     *
     * @return array<string, mixed>
     */
    public function markConsumed(int $cmpId, int $documentId, int $consumingDocumentId, ?string $actor): array
    {
        [$doc, $meta] = $this->postedWithMeta($cmpId, $documentId);
        if ($meta['packing_status'] === self::STATUS_CONSUMED) {
            if ((int) ($meta['locked_by_document_id'] ?? 0) === $consumingDocumentId) {
                return $this->get($cmpId, $documentId);
            }
            throw InventoryException::invalidState('Packing list was already consumed by document #' . $meta['locked_by_document_id'], $this->stateDetails($meta));
        }
        if ($meta['packing_status'] === self::STATUS_UNPACKED) {
            throw InventoryException::invalidState('Packing list was unpacked and cannot be consumed', $this->stateDetails($meta));
        }
        $now = date('Y-m-d H:i:s');
        \Config\Database::connect()->table('inv_packing_meta')->where('cmp_id', $cmpId)->where('document_id', $documentId)->update([
            'packing_status' => self::STATUS_CONSUMED, 'locked_by_document_id' => $consumingDocumentId, 'locked_by_external_ref' => null, 'locked_at' => $now, 'updated_at' => $now,
        ]);
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
