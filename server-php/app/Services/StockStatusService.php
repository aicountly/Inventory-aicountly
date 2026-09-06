<?php

namespace App\Services;

use App\Exceptions\InventoryException;

/**
 * Status buckets that split on-hand stock without moving it: packed, with job worker,
 * reserved, quality hold, damaged, blocked, in transit. Every change is journaled in
 * inv_stock_status_movements and mirrored into inv_stock_balances.
 */
class StockStatusService
{
    public const MOV_PACK = 'pack';
    public const MOV_UNPACK = 'unpack';
    public const MOV_SALE_ISSUE = 'sale_issue';
    public const MOV_JOB_WORK_SEND = 'job_work_send';
    public const MOV_JOB_WORK_RETURN = 'job_work_return';
    public const MOV_JOB_WORK_CONSUME = 'job_work_consume';
    public const MOV_JOB_WORK_RECEIVE = 'job_work_receive';
    public const MOV_RESERVE = 'reserve';
    public const MOV_RELEASE = 'release';
    public const MOV_HOLD = 'hold';
    public const MOV_UNHOLD = 'unhold';
    public const MOV_DAMAGE = 'damage';
    public const MOV_UNDAMAGE = 'undamage';
    public const MOV_BLOCK = 'block';
    public const MOV_UNBLOCK = 'unblock';

    /** movement_type => [bucket, sign] */
    private const EFFECTS = [
        self::MOV_PACK             => ['packed', +1],
        self::MOV_UNPACK           => ['packed', -1],
        self::MOV_SALE_ISSUE       => ['packed', -1],
        self::MOV_JOB_WORK_SEND    => ['job_worker', +1],
        self::MOV_JOB_WORK_RETURN  => ['job_worker', -1],
        self::MOV_JOB_WORK_CONSUME => ['job_worker', -1],
        self::MOV_JOB_WORK_RECEIVE => ['job_worker', 0],
        self::MOV_RESERVE          => ['reserved', +1],
        self::MOV_RELEASE          => ['reserved', -1],
        self::MOV_HOLD             => ['quality_hold', +1],
        self::MOV_UNHOLD           => ['quality_hold', -1],
        self::MOV_DAMAGE           => ['damaged', +1],
        self::MOV_UNDAMAGE         => ['damaged', -1],
        self::MOV_BLOCK            => ['blocked', +1],
        self::MOV_UNBLOCK          => ['blocked', -1],
    ];

    public function __construct(
        protected ?StockBalanceService $balances = null,
        protected ?UnitConversionService $units = null,
    ) {
        $this->balances ??= new StockBalanceService();
        $this->units ??= new UnitConversionService();
    }

    /**
     * @param list<array{item_id:int, unit_id?:int|null, warehouse_id?:int|null, batch_id?:int|null, qty:float}> $lines entered units
     */
    public function assertAvailable(int $cmpId, array $lines): void
    {
        foreach ($lines as $line) {
            $itemId = (int) ($line['item_id'] ?? 0);
            $qty = (float) ($line['qty'] ?? 0);
            if ($itemId <= 0 || $qty <= 0) {
                continue;
            }
            $baseQty = UnitConversionService::toBaseQty($qty, $this->units->factorFor($cmpId, $itemId, isset($line['unit_id']) ? (int) $line['unit_id'] : null));
            $bal = $this->balances->balance($cmpId, $itemId, isset($line['warehouse_id']) ? (int) $line['warehouse_id'] : null, isset($line['batch_id']) ? (int) $line['batch_id'] : null);
            if ($bal['available'] + 0.0001 < $baseQty) {
                throw InventoryException::validation(
                    sprintf('Insufficient available stock for item #%d (need %.4f, available %.4f)', $itemId, $baseQty, $bal['available']),
                    ['item_id' => $itemId, 'need' => $baseQty, 'available' => $bal['available'], 'warehouse_id' => $line['warehouse_id'] ?? null],
                );
            }
        }
    }

    /**
     * Apply one status movement for a set of lines. Quantities are in the line unit.
     *
     * @param list<array{item_id:int, unit_id?:int|null, warehouse_id?:int|null, batch_id?:int|null, qty:float}> $lines
     */
    public function apply(int $cmpId, int $documentId, string $movementType, array $lines, bool $checkAvailable = false): void
    {
        if (!isset(self::EFFECTS[$movementType])) {
            throw new \InvalidArgumentException('Unknown status movement ' . $movementType);
        }
        if ($checkAvailable) {
            $this->assertAvailable($cmpId, $lines);
        }
        [$bucket, $sign] = self::EFFECTS[$movementType];
        $db = \Config\Database::connect();
        $now = date('Y-m-d H:i:s');
        foreach ($lines as $line) {
            $itemId = (int) ($line['item_id'] ?? 0);
            $qty = (float) ($line['qty'] ?? 0);
            if ($itemId <= 0 || $qty <= 0) {
                continue;
            }
            $unitId = isset($line['unit_id']) && $line['unit_id'] ? (int) $line['unit_id'] : null;
            $baseQty = UnitConversionService::toBaseQty($qty, $this->units->factorFor($cmpId, $itemId, $unitId));
            $wh = isset($line['warehouse_id']) && $line['warehouse_id'] ? (int) $line['warehouse_id'] : null;
            $batch = isset($line['batch_id']) && $line['batch_id'] ? (int) $line['batch_id'] : null;
            if ($sign !== 0) {
                $current = $this->balances->balance($cmpId, $itemId, $wh, $batch);
                if ($sign < 0 && $current[$bucket] + 0.0001 < $baseQty) {
                    throw InventoryException::validation(sprintf('Insufficient %s stock for item #%d (need %.4f, have %.4f)', str_replace('_', ' ', $bucket), $itemId, $baseQty, $current[$bucket]), ['item_id' => $itemId, 'bucket' => $bucket]);
                }
                $this->balances->applyDelta($cmpId, $itemId, $wh, $batch, $bucket, $sign * $baseQty);
            }
            $db->table('inv_stock_status_movements')->insert([
                'cmp_id'        => $cmpId,
                'item_id'       => $itemId,
                'unit_id'       => $unitId,
                'warehouse_id'  => $wh,
                'batch_id'      => $batch,
                'document_id'   => $documentId,
                'movement_type' => $movementType,
                'qty'           => round($qty, 4),
                'base_qty'      => $baseQty,
                'created_at'    => $now,
            ]);
        }
    }

    /** Reverse every status movement a document made (opposite bucket effect). */
    public function reverseForDocument(int $cmpId, int $documentId, int $reversalDocumentId): int
    {
        $db = \Config\Database::connect();
        $rows = $db->table('inv_stock_status_movements')->where('cmp_id', $cmpId)->where('document_id', $documentId)->get()->getResultArray();
        $n = 0;
        foreach ($rows as $r) {
            [$bucket, $sign] = self::EFFECTS[$r['movement_type']] ?? [null, 0];
            if ($bucket === null) {
                continue;
            }
            if ($sign !== 0) {
                $this->balances->applyDelta($cmpId, (int) $r['item_id'], $r['warehouse_id'] !== null ? (int) $r['warehouse_id'] : null, $r['batch_id'] !== null ? (int) $r['batch_id'] : null, $bucket, -$sign * (float) $r['base_qty']);
            }
            $db->table('inv_stock_status_movements')->insert([
                'cmp_id' => $cmpId, 'item_id' => (int) $r['item_id'], 'unit_id' => $r['unit_id'], 'warehouse_id' => $r['warehouse_id'], 'batch_id' => $r['batch_id'],
                'document_id' => $reversalDocumentId, 'movement_type' => $r['movement_type'] . '_reversed', 'qty' => -(float) $r['qty'], 'base_qty' => -(float) $r['base_qty'], 'created_at' => date('Y-m-d H:i:s'),
            ]);
            $n++;
        }

        return $n;
    }
}
