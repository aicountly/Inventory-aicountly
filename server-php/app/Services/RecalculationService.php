<?php

namespace App\Services;

/**
 * Backdated valuation recalculation.
 *
 * enqueue(): records a job for (company, fy, item?, from_date).
 * run():     replays each affected item from its opening — clears layers / WAC state, re-seeds the
 *            opening, re-applies every posted movement in date order — and rewrites the
 *            valuation_rate / valuation_amount of every line whose cost changed. Each change is an
 *            inv_valuation_revisions row and is published to Books as inventory.valuation.revised so
 *            Books can adjust COGS through its controlled mechanism (inline rewrite or adjustment journal).
 */
class RecalculationService
{
    public function __construct(
        protected ?ValuationEngine $engine = null,
        protected ?UnitConversionService $units = null,
        protected ?StockBalanceService $balances = null,
        protected ?OutboxService $outbox = null,
        protected ?AuditService $audit = null,
    ) {
        $this->units ??= new UnitConversionService();
        $this->engine ??= new ValuationEngine(null, $this->units);
        $this->balances ??= new StockBalanceService($this->units);
        $this->outbox ??= new OutboxService();
        $this->audit ??= new AuditService();
    }

    public function enqueue(int $cmpId, ?int $fyId, ?int $itemId, string $fromDate, string $trigger, ?int $triggerDocumentId, ?string $actor, bool $dryRun = false): int
    {
        $db = \Config\Database::connect();
        $db->table('inv_valuation_recalc_jobs')->insert([
            'cmp_id' => $cmpId, 'fy_id' => $fyId, 'item_id' => $itemId, 'from_date' => $fromDate, 'trigger_kind' => $trigger,
            'trigger_document_id' => $triggerDocumentId, 'status' => 'QUEUED', 'dry_run' => $dryRun ? 1 : 0, 'requested_by' => $actor, 'created_at' => date('Y-m-d H:i:s'),
        ]);

        return (int) $db->insertID();
    }

    /** Is a backdated document one that requires recalculation? True when any later posted movement exists for the item. */
    public function needsRecalc(int $cmpId, int $itemId, string $date): bool
    {
        return \Config\Database::connect()->table('inv_stock_movements')->where('cmp_id', $cmpId)->where('item_id', $itemId)->where('movement_date >', $date)->countAllResults() > 0;
    }

    /** @return array<string, mixed> job row after run */
    public function run(int $jobId): array
    {
        $db = \Config\Database::connect();
        $job = $db->table('inv_valuation_recalc_jobs')->where('job_id', $jobId)->get()->getRowArray();
        if (!$job) {
            throw new \RuntimeException('Job not found', 404);
        }
        if (!in_array($job['status'], ['QUEUED', 'FAILED'], true)) {
            return $job;
        }
        $db->table('inv_valuation_recalc_jobs')->where('job_id', $jobId)->update(['status' => 'RUNNING', 'started_at' => date('Y-m-d H:i:s')]);
        $cmpId = (int) $job['cmp_id'];
        $fyId = (int) ($job['fy_id'] ?? 0) ?: $this->balances->latestFyId($cmpId);
        $dryRun = (int) $job['dry_run'] === 1;
        try {
            $itemIds = $job['item_id'] ? [(int) $job['item_id']] : $this->itemsWithMovements($cmpId, $fyId);
            $revisions = [];
            $affectedDocs = [];
            $affectedLines = 0;
            $cogsDelta = 0.0;
            foreach ($itemIds as $itemId) {
                $r = $this->replayItem($cmpId, $fyId, $itemId, $dryRun);
                $affectedLines += $r['lines'];
                foreach ($r['revisions'] as $rev) {
                    $revisions[] = $rev;
                    $affectedDocs[$rev['document_id']] = true;
                    $cogsDelta += $rev['delta_amount'];
                }
            }
            if (!$dryRun) {
                foreach ($revisions as $rev) {
                    $db->table('inv_valuation_revisions')->insert(array_merge($rev, ['cmp_id' => $cmpId, 'job_id' => $jobId, 'created_at' => date('Y-m-d H:i:s')]));
                    $revId = (int) $db->insertID();
                    $rev['revision_id'] = $revId;
                    if (!empty($rev['source_document_id'])) {
                        $this->outbox->enqueue($cmpId, 'inventory.valuation.revised', 'document_line', (int) $rev['line_id'], null, array_merge($rev, ['job_id' => $jobId]));
                        $db->table('inv_valuation_revisions')->where('revision_id', $revId)->update(['published_at' => date('Y-m-d H:i:s')]);
                    }
                }
                $this->balances->rebuildOnHand($cmpId, $fyId);
            }
            $db->table('inv_valuation_recalc_jobs')->where('job_id', $jobId)->update([
                'status' => 'COMPLETED', 'affected_documents_json' => json_encode(array_keys($affectedDocs)), 'affected_line_count' => $affectedLines,
                'revised_line_count' => count($revisions), 'cogs_delta' => round($cogsDelta, 4), 'finished_at' => date('Y-m-d H:i:s'),
            ]);
            $this->audit->log($cmpId, 'valuation_recalc_job', $jobId, 'valuation.recalculated', $job['requested_by'] ?? null, ['dry_run' => $dryRun, 'revisions' => count($revisions), 'cogs_delta' => round($cogsDelta, 4)]);
        } catch (\Throwable $e) {
            $db->table('inv_valuation_recalc_jobs')->where('job_id', $jobId)->update(['status' => 'FAILED', 'failure_reason' => substr($e->getMessage(), 0, 2000), 'finished_at' => date('Y-m-d H:i:s')]);
            throw $e;
        }

        return $db->table('inv_valuation_recalc_jobs')->where('job_id', $jobId)->get()->getRowArray();
    }

    /** @return list<int> */
    public function itemsWithMovements(int $cmpId, int $fyId): array
    {
        $rows = \Config\Database::connect()->table('inv_stock_movements')->distinct()->select('item_id')->where('cmp_id', $cmpId)->where('fy_id', $fyId)->get()->getResultArray();

        return array_map(static fn ($r) => (int) $r['item_id'], $rows);
    }

    /**
     * Replay a single item for a year. Returns revisions (lines whose valuation changed).
     *
     * @return array{lines:int, revisions: list<array<string,mixed>>}
     */
    public function replayItem(int $cmpId, int $fyId, int $itemId, bool $dryRun): array
    {
        $db = \Config\Database::connect();
        $this->units->warmCompany($cmpId);
        $movements = $db->table('inv_stock_movements m')
            ->select('m.movement_id, m.line_id, m.document_id, m.movement_date, m.qty, m.warehouse_id, m.document_type, l.conversion_factor, l.qty AS line_qty, l.source_transaction_rate, l.source_transaction_amount, l.valuation_rate AS line_valuation_rate, l.valuation_amount AS line_valuation_amount, l.metadata_json, d.source_app, d.source_document_type, d.source_document_id, d.source_document_uuid, d.status AS doc_status')
            ->join('inv_document_lines l', 'l.line_id = m.line_id', 'inner')
            ->join('inv_documents d', 'd.document_id = m.document_id', 'inner')
            ->where('m.cmp_id', $cmpId)->where('m.fy_id', $fyId)->where('m.item_id', $itemId)->where('m.movement_kind', 'physical')
            ->whereIn('d.status', ['POSTED', 'COMPLETED', 'PARTIALLY_FULFILLED'])
            ->orderBy('m.movement_date', 'ASC')->orderBy('m.document_id', 'ASC')->orderBy('m.line_id', 'ASC')->orderBy('m.movement_id', 'ASC')
            ->get()->getResultArray();

        // Net out reversed movements (a physical movement with a reversal row is void).
        $reversed = [];
        foreach ($db->table('inv_stock_movements')->select('reversal_of_movement_id')->where('cmp_id', $cmpId)->where('item_id', $itemId)->where('movement_kind', 'reversal')->get()->getResultArray() as $r) {
            $reversed[(int) $r['reversal_of_movement_id']] = true;
        }

        if ($dryRun) {
            $db->transStart();
        } else {
            $db->transStart();
        }
        $this->engine->clearValuationState($cmpId, $itemId);
        $this->engine->seedOpeningStock($cmpId, $fyId, $itemId);
        $revisions = [];
        $lines = 0;
        $transferCost = [];
        foreach ($movements as $m) {
            if (isset($reversed[(int) $m['movement_id']])) {
                continue;
            }
            $lines++;
            $qty = abs((float) $m['qty']);
            $lineId = (int) $m['line_id'];
            $date = (string) $m['movement_date'];
            if ((float) $m['qty'] > 0) {
                $meta = json_decode((string) ($m['metadata_json'] ?? ''), true) ?: [];
                $unitCost = null;
                if (($meta['side'] ?? '') === 'in' && !empty($meta['transfer_pair'])) {
                    $unitCost = $transferCost[(int) $m['document_id'] . ':' . $meta['transfer_pair']] ?? null;
                }
                if ($unitCost === null) {
                    $srcRate = UnitConversionService::effectiveRate((float) $m['line_qty'], (float) ($m['source_transaction_rate'] ?? 0), (float) ($m['source_transaction_amount'] ?? 0));
                    if ($srcRate > 0) {
                        $unitCost = UnitConversionService::toBaseUnitCost($srcRate, (float) ($m['conversion_factor'] ?: 1));
                    } elseif ((float) ($m['line_valuation_rate'] ?? 0) > 0 && in_array($m['document_type'], ['PRODUCTION', 'PHYSICAL_ADJUSTMENT', 'STOCK_JOURNAL', 'WRITE_IN', 'MATERIAL_RECEIPT', 'JOB_WORK_IN', 'ASSEMBLY', 'DISASSEMBLY'], true)) {
                        $unitCost = (float) $m['line_valuation_rate'];
                    } else {
                        $unitCost = $this->engine->resolveFallbackUnitCost($db, $cmpId, $itemId, $this->engine->scopeWarehouse($cmpId, $m['warehouse_id'] !== null ? (int) $m['warehouse_id'] : null));
                    }
                }
                $val = $this->engine->recordReceipt($cmpId, $fyId, $itemId, $m['warehouse_id'] !== null ? (int) $m['warehouse_id'] : null, $qty, $unitCost, $date . ' 00:00:00', (int) $m['document_id'], $lineId);
            } else {
                $val = $this->engine->issueStock($cmpId, $fyId, $itemId, $m['warehouse_id'] !== null ? (int) $m['warehouse_id'] : null, $qty, $date . ' 00:00:00', (int) $m['document_id'], $lineId);
                $meta = json_decode((string) ($m['metadata_json'] ?? ''), true) ?: [];
                if (($meta['side'] ?? '') === 'out' && !empty($meta['transfer_pair'])) {
                    $transferCost[(int) $m['document_id'] . ':' . $meta['transfer_pair']] = (float) $val['valuation_rate'];
                }
            }
            $old = (float) ($m['line_valuation_amount'] ?? 0);
            $new = (float) $val['valuation_amount'];
            if (abs($old - $new) > 0.005 || abs((float) ($m['line_valuation_rate'] ?? 0) - (float) $val['valuation_rate']) > 0.00005) {
                $revisions[] = [
                    'document_id' => (int) $m['document_id'], 'line_id' => $lineId, 'source_app' => $m['source_app'], 'source_document_type' => $m['source_document_type'],
                    'source_document_id' => $m['source_document_id'], 'source_document_uuid' => $m['source_document_uuid'],
                    'old_valuation_rate' => (float) ($m['line_valuation_rate'] ?? 0), 'new_valuation_rate' => (float) $val['valuation_rate'],
                    'old_valuation_amount' => $old, 'new_valuation_amount' => $new, 'delta_amount' => round($new - $old, 4),
                ];
                if (!$dryRun) {
                    $db->table('inv_document_lines')->where('line_id', $lineId)->update(['valuation_rate' => $val['valuation_rate'], 'valuation_amount' => $val['valuation_amount'], 'valuation_method_applied' => $val['valuation_method_applied']]);
                    $db->table('inv_stock_movements')->where('movement_id', (int) $m['movement_id'])->update(['unit_cost' => $val['valuation_rate'], 'value' => round(((float) $m['qty'] > 0 ? 1 : -1) * $new, 4)]);
                }
            }
        }
        if ($dryRun) {
            $db->transRollback();
            $db->resetTransStatus();
        } else {
            $db->transComplete();
        }

        return ['lines' => $lines, 'revisions' => $revisions];
    }
}
