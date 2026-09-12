<?php

namespace App\Services;

use App\Exceptions\InventoryException;

/**
 * Soft allocation of available stock (inv_reservations) to an order / invoice draft.
 *
 * A reservation moves base quantity into the `reserved` status bucket (StockStatusService) so
 * availability drops without any physical movement. Releasing gives it back; fulfilling records
 * what the later stock document actually issued and releases whatever is left.
 *
 * Quantities are ALWAYS in the item's base unit. Status movements are journaled against the
 * linked inventory document when there is one, otherwise against document_id 0 (API reservation).
 */
class ReservationService
{
    public const STATUS_ACTIVE = 'active';
    public const STATUS_PARTIAL = 'partial'; // inv_reservations.status is VARCHAR(16): 'partially_fulfilled' does not fit
    public const STATUS_FULFILLED = 'fulfilled';
    public const STATUS_RELEASED = 'released';
    public const STATUS_EXPIRED = 'expired';
    public const OPEN_STATUSES = [self::STATUS_ACTIVE, self::STATUS_PARTIAL];
    public const ALL_STATUSES = [self::STATUS_ACTIVE, self::STATUS_PARTIAL, self::STATUS_FULFILLED, self::STATUS_RELEASED, self::STATUS_EXPIRED];

    public function __construct(
        protected ?StockStatusService $status = null,
        protected ?StockBalanceService $balances = null,
        protected ?AuditService $audit = null,
    ) {
        $this->balances ??= new StockBalanceService();
        $this->status ??= new StockStatusService($this->balances);
        $this->audit ??= new AuditService();
    }

    /**
     * Reserve base quantity of an item. Fails (422) when the available quantity is short.
     *
     * @param array{cmp_id:int, fy_id:int, bo_id:int} $ctx
     * @param array<string, mixed> $payload item_id, qty, warehouse_id?, batch_id?, document_id?,
     *                                      source_document_type?, source_document_id?, source_document_uuid?, expires_at?
     * @return array<string, mixed> the reservation
     */
    public function reserve(array $ctx, array $payload, ?string $actor, string $sourceApp = 'inventory'): array
    {
        $cmpId = (int) $ctx['cmp_id'];
        $itemId = (int) ($payload['item_id'] ?? 0);
        $qty = round((float) ($payload['qty'] ?? 0), 4);
        if ($itemId <= 0) {
            throw InventoryException::validation('item_id is required', ['field' => 'item_id']);
        }
        if ($qty <= 0) {
            throw InventoryException::validation('qty must be greater than zero (base units)', ['field' => 'qty']);
        }
        $db = \Config\Database::connect();
        $item = $db->table('inv_items')->select('item_id, unit_id, is_active, deleted_at')->where('cmp_id', $cmpId)->where('item_id', $itemId)->get()->getRowArray();
        if (!$item || $item['deleted_at'] !== null) {
            throw InventoryException::validation('Item #' . $itemId . ' not found in this company', ['item_id' => $itemId]);
        }
        $wh = isset($payload['warehouse_id']) && (int) $payload['warehouse_id'] > 0 ? (int) $payload['warehouse_id'] : null;
        if ($wh !== null && $db->table('inv_warehouses')->where('cmp_id', $cmpId)->where('warehouse_id', $wh)->where('deleted_at', null)->countAllResults() === 0) {
            throw InventoryException::validation('Warehouse #' . $wh . ' not found in this company', ['warehouse_id' => $wh]);
        }
        $batch = isset($payload['batch_id']) && (int) $payload['batch_id'] > 0 ? (int) $payload['batch_id'] : null;
        if ($batch !== null && $db->table('inv_batches')->where('cmp_id', $cmpId)->where('batch_id', $batch)->where('item_id', $itemId)->countAllResults() === 0) {
            throw InventoryException::validation('Batch #' . $batch . ' not found for item #' . $itemId, ['batch_id' => $batch]);
        }
        $expiresAt = $this->normalizeTimestamp($payload['expires_at'] ?? null);
        if (isset($payload['expires_at']) && $payload['expires_at'] !== '' && $payload['expires_at'] !== null && $expiresAt === null) {
            throw InventoryException::validation('expires_at must be a valid date/time', ['field' => 'expires_at']);
        }
        $documentId = isset($payload['document_id']) && (int) $payload['document_id'] > 0 ? (int) $payload['document_id'] : null;
        $now = date('Y-m-d H:i:s');
        $row = [
            'cmp_id'               => $cmpId,
            'fy_id'                => (int) $ctx['fy_id'],
            'bo_id'                => (int) ($ctx['bo_id'] ?? 0),
            'document_id'          => $documentId,
            'item_id'              => $itemId,
            'warehouse_id'         => $wh,
            'batch_id'             => $batch,
            'qty'                  => $qty,
            'fulfilled_qty'        => 0,
            'status'               => self::STATUS_ACTIVE,
            'source_app'           => substr(strtolower($sourceApp !== '' ? $sourceApp : 'inventory'), 0, 24),
            'source_document_type' => isset($payload['source_document_type']) && $payload['source_document_type'] !== '' ? substr((string) $payload['source_document_type'], 0, 48) : null,
            'source_document_id'   => isset($payload['source_document_id']) && $payload['source_document_id'] !== '' && $payload['source_document_id'] !== null ? (int) $payload['source_document_id'] : null,
            'source_document_uuid' => isset($payload['source_document_uuid']) && $payload['source_document_uuid'] ? (string) $payload['source_document_uuid'] : null,
            'expires_at'           => $expiresAt,
            'created_by'           => $actor,
            'created_at'           => $now,
            'updated_at'           => $now,
        ];

        $db->transStart();
        try {
            // Bucket first: assertAvailable() raises 422 when available < qty, before anything is written.
            $this->status->apply($cmpId, $documentId ?? 0, StockStatusService::MOV_RESERVE, [$this->bucketLine($itemId, (int) $item['unit_id'], $wh, $batch, $qty)], true);
            DatabaseInsertHelper::insert($db, 'inv_reservations', $row);
            $reservationId = (int) $db->insertID();
            $db->transComplete();
            if ($db->transStatus() === false) {
                throw new \RuntimeException('Could not create reservation: ' . (string) ($db->error()['message'] ?? ''), 500);
            }
        } catch (\Throwable $e) {
            $db->transRollback();
            $db->resetTransStatus();
            throw $e;
        }
        $this->audit->log($cmpId, 'reservation', $reservationId, 'reservation.create', $actor, [
            'source_app' => $row['source_app'], 'source_document_type' => $row['source_document_type'], 'source_document_id' => $row['source_document_id'], 'source_document_uuid' => $row['source_document_uuid'],
        ], null, ['item_id' => $itemId, 'warehouse_id' => $wh, 'batch_id' => $batch, 'qty' => $qty, 'expires_at' => $expiresAt]);

        return $this->get($cmpId, $reservationId);
    }

    /**
     * Give reserved quantity back to available. $qty null = the whole open remainder.
     * A partial release lowers the reservation's qty; a full release closes it.
     *
     * @return array<string, mixed>
     */
    public function release(int $cmpId, int $reservationId, ?string $actor, ?float $qty = null, ?string $reason = null): array
    {
        $r = $this->getRow($cmpId, $reservationId);
        $this->assertOpen($r, 'release');
        $open = self::openQty($r);
        $releaseQty = $qty === null ? $open : round($qty, 4);
        if ($releaseQty <= 0) {
            throw InventoryException::validation('Release qty must be greater than zero', ['open_qty' => $open]);
        }
        if ($releaseQty > $open + 0.0001) {
            throw InventoryException::validation('Release qty ' . $releaseQty . ' exceeds open reserved qty ' . $open, ['reservation_id' => $reservationId, 'open_qty' => $open]);
        }
        $full = $releaseQty >= $open - 0.0001;
        $update = ['updated_at' => date('Y-m-d H:i:s')];
        if ($full) {
            $update['status'] = (float) $r['fulfilled_qty'] > 0.0001 ? self::STATUS_FULFILLED : self::STATUS_RELEASED;
        } else {
            $update['qty'] = round((float) $r['qty'] - $releaseQty, 4);
        }
        $this->applyRelease($cmpId, $r, $releaseQty, $update);
        $this->audit->log($cmpId, 'reservation', $reservationId, 'reservation.release', $actor, ['reason' => $reason, 'released_qty' => $releaseQty], ['status' => $r['status'], 'qty' => (float) $r['qty']], ['status' => $update['status'] ?? $r['status'], 'qty' => $update['qty'] ?? (float) $r['qty']]);

        return $this->get($cmpId, $reservationId);
    }

    /**
     * Record that stock was issued against the reservation. $qty null = the whole open remainder.
     * The fulfilled quantity leaves the reserved bucket (the issuing document moved on-hand); with
     * release_remainder (default true) whatever is still open is released too and the reservation closes.
     *
     * @param array{release_remainder?:bool, document_id?:int|null, reason?:string|null} $options
     * @return array<string, mixed>
     */
    public function fulfil(int $cmpId, int $reservationId, ?string $actor, ?float $qty = null, array $options = []): array
    {
        $r = $this->getRow($cmpId, $reservationId);
        $this->assertOpen($r, 'fulfil');
        $open = self::openQty($r);
        $fulfilQty = $qty === null ? $open : round($qty, 4);
        if ($fulfilQty <= 0) {
            throw InventoryException::validation('Fulfil qty must be greater than zero', ['open_qty' => $open]);
        }
        if ($fulfilQty > $open + 0.0001) {
            throw InventoryException::validation('Fulfil qty ' . $fulfilQty . ' exceeds open reserved qty ' . $open, ['reservation_id' => $reservationId, 'open_qty' => $open]);
        }
        $releaseRemainder = array_key_exists('release_remainder', $options) ? (bool) $options['release_remainder'] : true;
        $closes = $releaseRemainder || $fulfilQty >= $open - 0.0001;
        $bucketQty = $closes ? $open : $fulfilQty;
        $update = [
            'fulfilled_qty' => round((float) $r['fulfilled_qty'] + $fulfilQty, 4),
            'status'        => $closes ? self::STATUS_FULFILLED : self::STATUS_PARTIAL,
            'updated_at'    => date('Y-m-d H:i:s'),
        ];
        if (isset($options['document_id']) && (int) $options['document_id'] > 0) {
            $update['document_id'] = (int) $options['document_id'];
        }
        $this->applyRelease($cmpId, $r, $bucketQty, $update);
        $this->audit->log($cmpId, 'reservation', $reservationId, 'reservation.fulfil', $actor, ['reason' => $options['reason'] ?? null, 'fulfilled_qty' => $fulfilQty, 'released_remainder' => $closes ? round($open - $fulfilQty, 4) : 0], ['status' => $r['status'], 'fulfilled_qty' => (float) $r['fulfilled_qty']], ['status' => $update['status'], 'fulfilled_qty' => $update['fulfilled_qty']]);

        return $this->get($cmpId, $reservationId);
    }

    /** Release every open reservation whose expires_at has passed. Returns the number expired. */
    public function expireDue(int $cmpId, ?string $asOf = null): int
    {
        $asOf ??= date('Y-m-d H:i:s');
        $rows = \Config\Database::connect()->table('inv_reservations')->where('cmp_id', $cmpId)->whereIn('status', self::OPEN_STATUSES)
            ->where('expires_at IS NOT NULL', null, false)->where('expires_at <', $asOf)->orderBy('reservation_id', 'ASC')->get()->getResultArray();
        $n = 0;
        foreach ($rows as $r) {
            $open = self::openQty($r);
            $this->applyRelease($cmpId, $r, $open, ['status' => self::STATUS_EXPIRED, 'updated_at' => date('Y-m-d H:i:s')]);
            $this->audit->log($cmpId, 'reservation', (int) $r['reservation_id'], 'reservation.expire', null, ['released_qty' => $open], ['status' => $r['status']], ['status' => self::STATUS_EXPIRED]);
            $n++;
        }

        return $n;
    }

    /** @return array<string, mixed> */
    public function get(int $cmpId, int $reservationId): array
    {
        $row = $this->baseQuery($cmpId)->where('r.reservation_id', $reservationId)->get()->getRowArray();
        if (!$row) {
            throw InventoryException::notFound('Reservation not found');
        }

        return $this->present($row);
    }

    /**
     * Open reservation already raised for the same source document line (duplicate-request guard).
     *
     * @return array<string, mixed>|null
     */
    public function findOpenBySource(int $cmpId, string $sourceApp, string $sourceDocumentType, int $sourceDocumentId, int $itemId, ?int $warehouseId, ?int $batchId): ?array
    {
        $b = $this->baseQuery($cmpId)->where('r.source_app', strtolower($sourceApp))->where('r.source_document_type', $sourceDocumentType)
            ->where('r.source_document_id', $sourceDocumentId)->where('r.item_id', $itemId)->whereIn('r.status', self::OPEN_STATUSES);
        $warehouseId !== null && $warehouseId > 0 ? $b->where('r.warehouse_id', $warehouseId) : $b->where('r.warehouse_id', null);
        $batchId !== null && $batchId > 0 ? $b->where('r.batch_id', $batchId) : $b->where('r.batch_id', null);
        $row = $b->orderBy('r.reservation_id', 'DESC')->get()->getRowArray();

        return $row ? $this->present($row) : null;
    }

    /** Joined query used by get() and the list endpoint (aliases: r, i, w, bt, u). */
    public function baseQuery(int $cmpId)
    {
        return \Config\Database::connect()->table('inv_reservations r')
            ->select('r.*, i.item_name, i.item_sku, u.unit_symbol, w.warehouse_name, bt.batch_no, (r.qty - r.fulfilled_qty) AS open_qty', false)
            ->join('inv_items i', 'i.item_id = r.item_id', 'left')
            ->join('inv_uom u', 'u.unit_id = i.unit_id', 'left')
            ->join('inv_warehouses w', 'w.warehouse_id = r.warehouse_id', 'left')
            ->join('inv_batches bt', 'bt.batch_id = r.batch_id', 'left')
            ->where('r.cmp_id', $cmpId);
    }

    /** @return array<string, mixed> */
    public function present(array $row): array
    {
        foreach (['qty', 'fulfilled_qty', 'open_qty'] as $k) {
            if (array_key_exists($k, $row) && $row[$k] !== null) {
                $row[$k] = round((float) $row[$k], 4);
            }
        }
        foreach (['reservation_id', 'cmp_id', 'fy_id', 'bo_id', 'document_id', 'item_id', 'warehouse_id', 'batch_id', 'source_document_id'] as $k) {
            if (array_key_exists($k, $row) && $row[$k] !== null) {
                $row[$k] = (int) $row[$k];
            }
        }
        $row['is_open'] = in_array($row['status'] ?? '', self::OPEN_STATUSES, true);
        $row['is_expired'] = $row['is_open'] && !empty($row['expires_at']) && strtotime((string) $row['expires_at']) < time();

        return $row;
    }

    public static function openQty(array $row): float
    {
        return round((float) $row['qty'] - (float) $row['fulfilled_qty'], 4);
    }

    // ------------------------------------------------------------------ internals

    /** @return array<string, mixed> */
    private function getRow(int $cmpId, int $reservationId): array
    {
        $row = \Config\Database::connect()->table('inv_reservations')->where('cmp_id', $cmpId)->where('reservation_id', $reservationId)->get()->getRowArray();
        if (!$row) {
            throw InventoryException::notFound('Reservation not found');
        }

        return $row;
    }

    private function assertOpen(array $r, string $action): void
    {
        if (!in_array($r['status'], self::OPEN_STATUSES, true)) {
            throw InventoryException::invalidState('Cannot ' . $action . ' a reservation in status ' . $r['status'], ['reservation_id' => (int) $r['reservation_id'], 'status' => $r['status']]);
        }
    }

    /** Release $qty from the reserved bucket and apply $update to the row, in one transaction. */
    private function applyRelease(int $cmpId, array $r, float $qty, array $update): void
    {
        $db = \Config\Database::connect();
        $unitId = (int) ($db->table('inv_items')->select('unit_id')->where('item_id', (int) $r['item_id'])->get()->getRowArray()['unit_id'] ?? 0);
        $db->transStart();
        try {
            if ($qty > 0.0001) {
                $this->status->apply($cmpId, (int) ($r['document_id'] ?? 0), StockStatusService::MOV_RELEASE, [
                    $this->bucketLine((int) $r['item_id'], $unitId, $r['warehouse_id'] !== null ? (int) $r['warehouse_id'] : null, $r['batch_id'] !== null ? (int) $r['batch_id'] : null, $qty),
                ]);
            }
            $db->table('inv_reservations')->where('cmp_id', $cmpId)->where('reservation_id', (int) $r['reservation_id'])->update($update);
            $db->transComplete();
            if ($db->transStatus() === false) {
                throw new \RuntimeException('Could not update reservation: ' . (string) ($db->error()['message'] ?? ''), 500);
            }
        } catch (\Throwable $e) {
            $db->transRollback();
            $db->resetTransStatus();
            throw $e;
        }
    }

    /** Status-bucket line in the item's BASE unit (factor 1), so qty is never re-converted. */
    private function bucketLine(int $itemId, int $baseUnitId, ?int $wh, ?int $batch, float $baseQty): array
    {
        return ['item_id' => $itemId, 'unit_id' => $baseUnitId > 0 ? $baseUnitId : null, 'warehouse_id' => $wh, 'batch_id' => $batch, 'qty' => $baseQty];
    }

    private function normalizeTimestamp(mixed $value): ?string
    {
        if ($value === null || $value === '' || !is_scalar($value)) {
            return null;
        }
        $ts = strtotime((string) $value);

        return $ts === false ? null : date('Y-m-d H:i:s', $ts);
    }
}
