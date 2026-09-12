<?php

namespace App\Services;

use App\Exceptions\InventoryException;

/**
 * Year-end carry-forward of the Items module (the counterpart of Books' StockBalanceService::writeFyOpenings).
 *
 * Closing quantities per (item, warehouse) as at the source year's last day — opening + posted
 * movements, base units — are valued at the cost each item's own method resolves (AS_PER_MASTER)
 * and written as the target year's opening rows (inv_item_openings, fy_id = target,
 * source_kind = carry_forward). Delete-then-write: the target set is replaced as a whole, and an
 * existing set is only replaced when the caller says overwrite.
 *
 * Side effects of a completed run, all in one transaction:
 *   - inv_fy_carryforward_status row for (company, source, target, branch) → status completed,
 *     which flips OpeningStockResolver to the carried rows for the target year (Books' rule);
 *   - inv_fy_ranges remembers both years' dates so layer timestamps and date checks never
 *     depend on Manage being up;
 *   - the opening cost layer / WAC state of every carried item is re-seeded for the target year
 *     (items that already have movements in the target year are replayed by a queued
 *     recalculation job instead, so no receipt goes missing in between);
 *   - materialised on-hand is rebuilt for the target year;
 *   - outbox event inventory.fy.carried_forward for Books.
 */
class FyCarryForwardService
{
    public const SOURCE_KIND = 'carry_forward';
    public const EVENT = 'inventory.fy.carried_forward';
    private const EPSILON = 0.0001;

    public function __construct(
        protected ?UnitConversionService $units = null,
        protected ?StockBalanceService $balances = null,
        protected ?ValuationReplayService $valuation = null,
        protected ?ValuationEngine $engine = null,
        protected ?ManageContextService $manage = null,
        protected ?OutboxService $outbox = null,
        protected ?AuditService $audit = null,
        protected ?RecalculationService $recalc = null,
    ) {
        $this->units ??= new UnitConversionService();
        $openings = new OpeningStockResolver($this->units);
        $this->balances ??= new StockBalanceService($this->units, $openings);
        $this->valuation ??= new ValuationReplayService($this->units, $openings, $this->balances);
        $this->engine ??= new ValuationEngine(null, $this->units, $openings);
        $this->manage ??= new ManageContextService();
        $this->outbox ??= new OutboxService();
        $this->audit ??= new AuditService();
        $this->recalc ??= new RecalculationService($this->engine, $this->units, $this->balances, $this->outbox, $this->audit);
    }

    /**
     * Validate and normalise a carry-forward request body. Pure (no database).
     *
     * @param array<string, mixed> $input
     * @return array{source_fy_id:int, target_fy_id:int, source_fy_start:string, source_fy_end:string, target_fy_start:string, target_fy_end:string, bo_id:int, overwrite:bool}
     */
    public static function normaliseRequest(array $input, int $defaultBoId = 0): array
    {
        $sourceFyId = (int) ($input['source_fy_id'] ?? 0);
        $targetFyId = (int) ($input['target_fy_id'] ?? 0);
        if ($sourceFyId <= 0 || $targetFyId <= 0) {
            throw InventoryException::validation('source_fy_id and target_fy_id are required', ['fields' => ['source_fy_id', 'target_fy_id']]);
        }
        if ($sourceFyId === $targetFyId) {
            throw InventoryException::validation('source_fy_id and target_fy_id must differ', ['source_fy_id' => $sourceFyId, 'target_fy_id' => $targetFyId]);
        }
        $dates = [];
        $missing = [];
        foreach (['source_fy_start', 'source_fy_end', 'target_fy_start', 'target_fy_end'] as $field) {
            $d = self::date($input[$field] ?? null);
            if ($d === null) {
                $missing[] = $field;
            }
            $dates[$field] = $d;
        }
        if ($missing !== []) {
            throw InventoryException::validation('Financial year dates (YYYY-MM-DD) are required: ' . implode(', ', $missing), ['fields' => $missing]);
        }
        if ($dates['source_fy_start'] > $dates['source_fy_end']) {
            throw InventoryException::validation('source_fy_start must not be after source_fy_end', ['source_fy_start' => $dates['source_fy_start'], 'source_fy_end' => $dates['source_fy_end']]);
        }
        if ($dates['target_fy_start'] > $dates['target_fy_end']) {
            throw InventoryException::validation('target_fy_start must not be after target_fy_end', ['target_fy_start' => $dates['target_fy_start'], 'target_fy_end' => $dates['target_fy_end']]);
        }
        if ($dates['target_fy_start'] <= $dates['source_fy_end']) {
            throw InventoryException::validation('The target year must start after the source year ends', ['source_fy_end' => $dates['source_fy_end'], 'target_fy_start' => $dates['target_fy_start']]);
        }
        $boId = array_key_exists('bo_id', $input) && $input['bo_id'] !== null && $input['bo_id'] !== '' ? (int) $input['bo_id'] : $defaultBoId;
        if ($boId < 0) {
            throw InventoryException::validation('bo_id must be 0 (consolidated) or a branch id', ['bo_id' => $boId]);
        }

        return [
            'source_fy_id'    => $sourceFyId,
            'target_fy_id'    => $targetFyId,
            'source_fy_start' => $dates['source_fy_start'],
            'source_fy_end'   => $dates['source_fy_end'],
            'target_fy_start' => $dates['target_fy_start'],
            'target_fy_end'   => $dates['target_fy_end'],
            'bo_id'           => $boId,
            'overwrite'       => self::flag($input['overwrite'] ?? false),
        ];
    }

    /** YYYY-MM-DD from a date / datetime string; null when empty or unparseable. */
    public static function date(mixed $value): ?string
    {
        $v = trim((string) ($value ?? ''));
        if ($v === '') {
            return null;
        }
        $ts = strtotime($v);

        return $ts === false ? null : date('Y-m-d', $ts);
    }

    public static function flag(mixed $value): bool
    {
        if (is_bool($value)) {
            return $value;
        }
        if (is_numeric($value)) {
            return (int) $value === 1;
        }

        return in_array(strtolower(trim((string) $value)), ['true', 'yes', 'on', '1'], true);
    }

    /**
     * Closing rows of the source year as they would be carried. No writes.
     *
     * @return array{source_fy_id:int, target_fy_id:int, bo_id:int, as_of:string, stock_item_count:int, row_count:int, rows:list<array<string,mixed>>, total_qty:float, total_value:float}
     */
    public function preview(int $cmpId, int $sourceFyId, int $targetFyId, int $boId, string $sourceFyEnd): array
    {
        $rows = $this->closingRows($cmpId, $sourceFyId, $boId, $sourceFyEnd);
        $items = [];
        $totalQty = 0.0;
        $totalValue = 0.0;
        foreach ($rows as $r) {
            $items[$r['item_id']] = true;
            $totalQty += $r['closing_qty'];
            $totalValue += $r['value'];
        }

        return [
            'source_fy_id'     => $sourceFyId,
            'target_fy_id'     => $targetFyId,
            'bo_id'            => $boId,
            'as_of'            => $sourceFyEnd,
            'stock_item_count' => count($items),
            'row_count'        => count($rows),
            'rows'             => $rows,
            'total_qty'        => round($totalQty, 4),
            'total_value'      => round($totalValue, 4),
        ];
    }

    /** The recorded status of a (source → target, branch) run, or null. @return array<string, mixed>|null */
    public function status(int $cmpId, int $sourceFyId, int $targetFyId, int $boId): ?array
    {
        $db = \Config\Database::connect();
        $row = $db->table('inv_fy_carryforward_status')->where('cmp_id', $cmpId)->where('source_fy_id', $sourceFyId)->where('target_fy_id', $targetFyId)->where('bo_id', $boId)
            ->orderBy('id', 'DESC')->get()->getRowArray();

        return $row ? self::castStatus($row) : null;
    }

    /** Number of opening rows the target year already holds in the run's scope. */
    public function existingTargetRows(int $cmpId, int $targetFyId, int $boId): int
    {
        return $this->targetOpenings(\Config\Database::connect(), $cmpId, $targetFyId, $boId)->countAllResults();
    }

    /**
     * Compute and write. Throws InventoryException (409 conflict) when the target year already has an
     * opening set and overwrite is false.
     *
     * @param array{source_fy_id:int, target_fy_id:int, source_fy_start:string, source_fy_end:string, target_fy_start:string, target_fy_end:string, bo_id:int, overwrite:bool} $req  see normaliseRequest()
     * @return array<string, mixed> preview fields + status, recalc_job_id, replaced_rows
     */
    public function run(int $cmpId, array $req, ?string $actor): array
    {
        $sourceFyId = (int) $req['source_fy_id'];
        $targetFyId = (int) $req['target_fy_id'];
        $boId = (int) $req['bo_id'];
        $db = \Config\Database::connect();

        $existingRows = $this->existingTargetRows($cmpId, $targetFyId, $boId);
        $existingStatus = $this->status($cmpId, $sourceFyId, $targetFyId, $boId);
        if (($existingRows > 0 || $existingStatus !== null) && empty($req['overwrite'])) {
            throw InventoryException::conflict('Financial year ' . $targetFyId . ' already opens on a carried-forward stock set; pass overwrite=true to replace it', [
                'target_fy_id'      => $targetFyId,
                'existing_rows'     => $existingRows,
                'carried_forward_at' => $existingStatus['carried_forward_at'] ?? null,
            ]);
        }

        $preview = $this->preview($cmpId, $sourceFyId, $targetFyId, $boId, $req['source_fy_end']);
        $now = date('Y-m-d H:i:s');

        $db->transStart();
        try {
            // Dates first: layer timestamps and later posting-date checks read them locally.
            $this->manage->rememberFyRange($cmpId, $sourceFyId, $req['source_fy_start'], $req['source_fy_end']);
            $this->manage->rememberFyRange($cmpId, $targetFyId, $req['target_fy_start'], $req['target_fy_end']);

            // Items whose opening state changes: previously carried ∪ carried now.
            $touched = [];
            foreach ($this->targetOpenings($db, $cmpId, $targetFyId, $boId)->select('item_id')->distinct()->get()->getResultArray() as $r) {
                $touched[(int) $r['item_id']] = true;
            }
            $this->targetOpenings($db, $cmpId, $targetFyId, $boId)->delete();
            $batch = [];
            foreach ($preview['rows'] as $r) {
                $touched[$r['item_id']] = true;
                $batch[] = [
                    'cmp_id' => $cmpId, 'fy_id' => $targetFyId, 'bo_id' => $boId, 'item_id' => $r['item_id'], 'warehouse_id' => $r['warehouse_id'], 'unit_id' => $r['unit_id'], 'batch_id' => null,
                    'opening_qty' => $r['closing_qty'], 'opening_valuation_rate' => $r['unit_cost'], 'opening_value' => $r['value'], 'valuation_method' => $r['valuation_method'],
                    'source_kind' => self::SOURCE_KIND, 'source_document_id' => null, 'created_by' => $actor, 'created_at' => $now, 'updated_by' => $actor, 'updated_at' => $now,
                ];
            }
            foreach (array_chunk($batch, 500) as $chunk) {
                $db->table('inv_item_openings')->insertBatch($chunk);
            }

            $db->table('inv_fy_carryforward_status')->where('cmp_id', $cmpId)->where('source_fy_id', $sourceFyId)->where('target_fy_id', $targetFyId)->where('bo_id', $boId)->delete();
            $db->table('inv_fy_carryforward_status')->insert([
                'cmp_id' => $cmpId, 'source_fy_id' => $sourceFyId, 'target_fy_id' => $targetFyId, 'bo_id' => $boId, 'status' => 'completed',
                'stock_item_count' => $preview['stock_item_count'], 'carried_forward_at' => $now, 'carried_forward_by' => $actor, 'created_at' => $now,
            ]);
            $statusId = (int) $db->insertID();
            FyCarryForwardStatus::flush();

            // Valuation state for the new year. An item that already has target-year movements is
            // replayed (clear → seed → re-apply) by the recalculation worker so its receipts never
            // vanish in between; every other touched item is re-seeded right here.
            $withMovements = [];
            foreach ($db->table('inv_stock_movements')->distinct()->select('item_id')->where('cmp_id', $cmpId)->where('fy_id', $targetFyId)->get()->getResultArray() as $r) {
                $withMovements[(int) $r['item_id']] = true;
            }
            foreach (array_keys($touched) as $itemId) {
                if (isset($withMovements[$itemId])) {
                    continue;
                }
                $this->engine->clearValuationState($cmpId, $itemId);
                $this->engine->seedOpeningStock($cmpId, $targetFyId, $itemId);
            }
            $recalcJobId = null;
            if ($withMovements !== []) {
                $recalcJobId = $this->recalc->enqueue($cmpId, $targetFyId, null, $req['target_fy_start'], self::SOURCE_KIND, null, $actor);
            }
            $this->balances->rebuildOnHand($cmpId, $targetFyId);

            $payload = [
                'cmp_id' => $cmpId, 'carryforward_id' => $statusId, 'source_fy_id' => $sourceFyId, 'target_fy_id' => $targetFyId, 'bo_id' => $boId,
                'source_fy_start' => $req['source_fy_start'], 'source_fy_end' => $req['source_fy_end'], 'target_fy_start' => $req['target_fy_start'], 'target_fy_end' => $req['target_fy_end'],
                'status' => 'completed', 'stock_item_count' => $preview['stock_item_count'], 'row_count' => $preview['row_count'], 'total_qty' => $preview['total_qty'], 'total_value' => $preview['total_value'],
                'overwrite' => !empty($req['overwrite']), 'replaced_rows' => $existingRows, 'recalc_job_id' => $recalcJobId, 'carried_forward_at' => $now, 'carried_forward_by' => $actor,
            ];
            $this->outbox->enqueue($cmpId, self::EVENT, 'fy_carryforward', $statusId, null, $payload);
            $this->audit->log($cmpId, 'fy_carryforward', $statusId, 'valuation.carried_forward', $actor, [
                'source_fy_id' => $sourceFyId, 'target_fy_id' => $targetFyId, 'bo_id' => $boId, 'overwrite' => !empty($req['overwrite']), 'replaced_rows' => $existingRows,
                'stock_item_count' => $preview['stock_item_count'], 'total_value' => $preview['total_value'], 'recalc_job_id' => $recalcJobId,
            ], $existingStatus, ['status' => 'completed', 'stock_item_count' => $preview['stock_item_count'], 'carried_forward_at' => $now]);
            $db->transComplete();
            if ($db->transStatus() === false) {
                throw new \RuntimeException('Carry-forward transaction failed', 500);
            }
        } catch (\Throwable $e) {
            $db->transRollback();
            $db->resetTransStatus();
            FyCarryForwardStatus::flush();
            throw $e;
        }
        FyCarryForwardStatus::flush();

        return $preview + [
            'status'        => $this->status($cmpId, $sourceFyId, $targetFyId, $boId),
            'recalc_job_id' => $recalcJobId,
            'replaced_rows' => $existingRows,
        ];
    }

    // ------------------------------------------------------------------ internals

    /**
     * One row per (item, warehouse) with a non-zero closing quantity, in the item's base unit.
     *
     * @return list<array{item_id:int, warehouse_id:?int, unit_id:int, closing_qty:float, unit_cost:float, value:float, valuation_method:?string}>
     */
    private function closingRows(int $cmpId, int $sourceFyId, int $boId, string $asOf): array
    {
        $qtyRows = $this->balances->closingQuantities($cmpId, $sourceFyId, $boId, null, $asOf);
        $itemIds = [];
        foreach ($qtyRows as $r) {
            if (abs($r['closing_qty']) >= self::EPSILON) {
                $itemIds[$r['item_id']] = true;
            }
        }
        $itemIds = array_keys($itemIds);
        if ($itemIds === []) {
            return [];
        }
        $costs = $this->valuation->unitCostsForItems($cmpId, $sourceFyId, $itemIds, $asOf, 'AS_PER_MASTER', $boId, null);
        $units = $this->baseUnits($cmpId, $itemIds);
        $rows = [];
        foreach ($qtyRows as $r) {
            $qty = round((float) $r['closing_qty'], 4);
            if (abs($qty) < self::EPSILON) {
                continue;
            }
            $itemId = (int) $r['item_id'];
            $cost = round((float) ($costs[$itemId]['unit_cost'] ?? 0.0), 4);
            $rows[] = [
                'item_id'          => $itemId,
                'warehouse_id'     => $r['warehouse_id'] !== null && (int) $r['warehouse_id'] > 0 ? (int) $r['warehouse_id'] : null,
                'unit_id'          => $units[$itemId] ?? 0,
                'closing_qty'      => $qty,
                'unit_cost'        => $cost,
                'value'            => round($qty * $cost, 4),
                'valuation_method' => $costs[$itemId]['method'] ?? null,
            ];
        }
        usort($rows, static fn ($a, $b) => [$a['item_id'], (int) $a['warehouse_id']] <=> [$b['item_id'], (int) $b['warehouse_id']]);

        return $rows;
    }

    /**
     * Base (default) unit per item: the default inv_item_uoms line, else the item master's unit.
     *
     * @param list<int> $itemIds
     * @return array<int, int>
     */
    private function baseUnits(int $cmpId, array $itemIds): array
    {
        $out = [];
        $missing = [];
        foreach ($itemIds as $id) {
            $u = $this->units->defaultUnitId($cmpId, $id);
            if ($u > 0) {
                $out[$id] = $u;
            } else {
                $missing[] = $id;
            }
        }
        foreach (array_chunk($missing, 500) as $chunk) {
            foreach (\Config\Database::connect()->table('inv_items')->select('item_id, unit_id')->where('cmp_id', $cmpId)->whereIn('item_id', $chunk)->get()->getResultArray() as $r) {
                $out[(int) $r['item_id']] = (int) $r['unit_id'];
            }
        }

        return $out;
    }

    /** Builder over the target year's opening rows in the run's branch scope (0 = every branch). */
    private function targetOpenings($db, int $cmpId, int $targetFyId, int $boId)
    {
        $b = $db->table('inv_item_openings')->where('cmp_id', $cmpId)->where('fy_id', $targetFyId);
        if ($boId > 0) {
            $b->where('bo_id', $boId);
        }

        return $b;
    }

    /** @param array<string, mixed> $row @return array<string, mixed> */
    private static function castStatus(array $row): array
    {
        foreach (['id', 'cmp_id', 'source_fy_id', 'target_fy_id', 'bo_id', 'stock_item_count'] as $k) {
            if (array_key_exists($k, $row)) {
                $row[$k] = $row[$k] === null ? null : (int) $row[$k];
            }
        }
        unset($row['legacy_source_table'], $row['legacy_source_id']);

        return $row;
    }
}
