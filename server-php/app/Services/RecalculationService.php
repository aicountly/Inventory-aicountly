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
 *
 * A receipt's cost is an input to the replay, never an output of it: the replay carries the cost the
 * line already decided, so nothing re-prices historical closing stock behind the operator. Where a
 * line decided none — a migration that found no cost_rate in Books — there is no input, and the job
 * is refused whole rather than priced from the item's current cost.
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
            $unpriced = $this->unpricedInwardLines($cmpId, $fyId, $itemIds);
            if ($unpriced !== []) {
                throw new \RuntimeException(self::unpricedReason($unpriced), 409);
            }
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
    /**
     * Keep the COGS_ISSUE entry of a document's stored accounting effects in step with a revised
     * line, so every reader of accounting_effects_json (Books refresh, prints, audits) sees the
     * revised cost.
     */
    private function refreshDocumentEffects($db, int $documentId, int $lineId, float $amount, float $rate): void
    {
        $row = $db->table('inv_documents')->select('accounting_effects_json')->where('document_id', $documentId)->get()->getRowArray();
        $effects = json_decode((string) ($row['accounting_effects_json'] ?? '[]'), true);
        if (!is_array($effects)) {
            return;
        }
        $changed = false;
        foreach ($effects as &$e) {
            if (($e['effect'] ?? '') === 'COGS_ISSUE' && (int) ($e['line_id'] ?? 0) === $lineId) {
                $e['amount'] = round($amount, 4);
                $e['valuation_rate'] = round($rate, 4);
                $changed = true;
            }
        }
        unset($e);
        if ($changed) {
            $db->table('inv_documents')->where('document_id', $documentId)->update(['accounting_effects_json' => json_encode($effects, JSON_UNESCAPED_UNICODE)]);
        }
    }

    /**
     * The cost a replayed inward line carries, or null when nothing decided one.
     *
     * The order is the posting engine's — an explicit line cost, then the source rate but only on a
     * cost-bearing document, because on a job-work receipt or a credit note that rate is the
     * commercial value Books owns. What differs is what an empty valuation column means at each
     * end: posting reads the figure an operator typed, where blank and zero both say "none given",
     * while a replay reads what posting then wrote for every line it valued, so a stored zero is a
     * cost that was decided (and warned about at the time), not an invitation to price the goods
     * again years later. Only a line that carries no valuation at all leaves a replay with nothing
     * to go on, and that can only reach Inventory from a migration that found no cost_rate in
     * Books.
     *
     * @param array<string, mixed> $m movement row joined to its document line
     */
    public static function decidedInwardUnitCost(array $m): ?float
    {
        $lineRate = $m['line_valuation_rate'] ?? null;
        if ($lineRate !== null && (float) $lineRate > 0) {
            return (float) $lineRate;
        }
        if (in_array($m['document_type'], \Config\DocumentTypeRegistry::COST_BEARING_SOURCE_RATE, true)) {
            $srcRate = UnitConversionService::effectiveRate((float) $m['line_qty'], (float) ($m['source_transaction_rate'] ?? 0), (float) ($m['source_transaction_amount'] ?? 0));
            if ($srcRate > 0) {
                return UnitConversionService::toBaseUnitCost($srcRate, (float) ($m['conversion_factor'] ?: 1));
            }
        }

        return $lineRate !== null ? 0.0 : null;
    }

    /**
     * The inward movements of a replay set that no decided cost prices. A transfer's in-side is
     * priced from the out-side it is paired with, and a type that carries no valuation was never
     * costed, so neither is one of them.
     *
     * @param list<array<string, mixed>> $movements
     * @param array<int, true> $reversed
     * @return list<array<string, mixed>>
     */
    public static function unpricedInwardMovements(array $movements, array $reversed): array
    {
        $out = [];
        foreach ($movements as $m) {
            if (isset($reversed[(int) $m['movement_id']]) || (float) $m['qty'] <= 0) {
                continue;
            }
            $spec = \Config\DocumentTypeRegistry::get((string) $m['document_type']);
            if (empty($spec['valuation'])) {
                continue;
            }
            $meta = json_decode((string) ($m['metadata_json'] ?? ''), true) ?: [];
            if (($meta['side'] ?? '') === 'in' && !empty($meta['transfer_pair'])) {
                continue;
            }
            if (self::decidedInwardUnitCost($m) === null) {
                $out[] = $m;
            }
        }

        return $out;
    }

    /**
     * The same question asked of every item the job covers, before the first of them is replayed:
     * a job that would have to invent a cost is refused whole rather than re-pricing half a
     * company's stock and stopping, because the revisions Books is told about are only written once
     * every item has been replayed.
     *
     * @param list<int> $itemIds
     * @return list<array<string, mixed>>
     */
    public function unpricedInwardLines(int $cmpId, int $fyId, array $itemIds): array
    {
        $db = \Config\Database::connect();
        $out = [];
        foreach (array_chunk($itemIds, 500) as $chunk) {
            $res = $db->table('inv_stock_movements m')
                ->select('m.movement_id, m.line_id, m.item_id, m.document_id, m.qty, m.document_type, l.conversion_factor, l.qty AS line_qty, l.source_transaction_rate, l.source_transaction_amount, l.valuation_rate AS line_valuation_rate, l.metadata_json')
                ->join('inv_document_lines l', 'l.line_id = m.line_id', 'inner')
                ->join('inv_documents d', 'd.document_id = m.document_id', 'inner')
                ->where('m.cmp_id', $cmpId)->where('m.fy_id', $fyId)->whereIn('m.item_id', $chunk)
                ->where('m.movement_kind', 'physical')->where('m.qty >', 0)
                ->whereIn('d.status', ['POSTED', 'COMPLETED', 'PARTIALLY_FULFILLED'])
                ->orderBy('m.item_id', 'ASC')->orderBy('m.line_id', 'ASC')
                ->get();
            $rev = $db->table('inv_stock_movements')->select('reversal_of_movement_id')->where('cmp_id', $cmpId)->whereIn('item_id', $chunk)->where('movement_kind', 'reversal')->get();
            if ($res === false || $rev === false) {
                // DBDebug is off in every deployed environment, so a refused query answers false
                // instead of throwing. A guard that cannot read is not a guard.
                throw new \RuntimeException('Could not check the replay set for inward lines with no cost', 500);
            }
            $reversed = [];
            foreach ($rev->getResultArray() as $r) {
                $reversed[(int) $r['reversal_of_movement_id']] = true;
            }
            foreach (self::unpricedInwardMovements($res->getResultArray(), $reversed) as $m) {
                $out[] = $m;
            }
        }

        return $out;
    }

    /** @param list<array<string, mixed>> $unpriced */
    private static function unpricedReason(array $unpriced): string
    {
        $ids = array_map(static fn ($m) => (int) $m['line_id'], array_slice($unpriced, 0, 20));

        return sprintf(
            'Refusing to recalculate: %d inward line(s) carry no cost to replay (line_id %s%s). Record a cost on them first — a replay would otherwise price them from the item\'s current cost, rewrite the stored history and publish the difference to Books as a valuation revision.',
            count($unpriced),
            implode(', ', $ids),
            count($unpriced) > 20 ? ', …' : '',
        );
    }

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

        // Before anything is opened or cleared: a receipt the replay cannot price from a decided
        // cost would be priced by invention, and the invention is written back to the line, the
        // movement and the stored effects and published to Books as a valuation revision. PostgreSQL
        // aborts a whole transaction on a failed statement, so the refusal happens out here.
        $unpriced = self::unpricedInwardMovements($movements, $reversed);
        if ($unpriced !== []) {
            throw new \RuntimeException(self::unpricedReason($unpriced), 409);
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
                $unitCost ??= self::decidedInwardUnitCost($m);
                // Null is the guard's own case and it refused this item before the transaction
                // opened; costing it at zero here keeps a throw out of an open transaction.
                $val = $this->engine->recordReceipt($cmpId, $fyId, $itemId, $m['warehouse_id'] !== null ? (int) $m['warehouse_id'] : null, $qty, (float) $unitCost, $date . ' 00:00:00', (int) $m['document_id'], $lineId);
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
                    $this->refreshDocumentEffects($db, (int) $m['document_id'], $lineId, (float) $val['valuation_amount'], (float) $val['valuation_rate']);
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
