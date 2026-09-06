<?php

namespace App\Services;

use Config\DocumentTypeRegistry;

/**
 * Inventory vs Books reconciliation.
 *
 * A run compares the Inventory closing valuation (ValuationReplayService::snapshot as at a
 * date) with the stock-ledger balance Books reports for the same company / FY / branch, and
 * explains the difference through a fixed set of buckets:
 *
 *   opening_difference                  Inventory opening value for the FY vs Books' opening balance
 *   pending_posting                     Books-sourced documents Inventory has not posted yet (DRAFT / PENDING_APPROVAL / APPROVED)
 *   failed_posting                      documents whose posting FAILED
 *   unacknowledged_valuation_revisions  COGS revisions published to Books but not acknowledged
 *   revaluation                         REVALUATION documents (STOCK_REVALUATION effect) vs the revaluations Books holds
 *   manual_journal                      manual journals Books posted straight to the stock ledger
 *   cancelled_reversed                  documents REVERSED in Inventory vs vouchers Books cancelled / reversed
 *   missing_source                      Books postings with no Inventory document at all
 *   rounding                            residual when |residual| < 1
 *   unexplained                         residual when |residual| >= 1
 *
 * Every bucket amount is expressed as its CONTRIBUTION to `difference = inventory - books`, so
 * `sum(buckets) + rounding + unexplained == difference` (when Books answered).
 *
 * Books is optional: when the call fails the run is persisted with status BOOKS_UNAVAILABLE,
 * books balance / difference NULL, and only the Inventory-side buckets populated.
 */
class ReconciliationService
{
    public const STATUS_COMPLETED = 'COMPLETED';
    public const STATUS_FAILED = 'FAILED';
    public const STATUS_BOOKS_UNAVAILABLE = 'BOOKS_UNAVAILABLE';

    public const PENDING_STATUSES = ['DRAFT', 'PENDING_APPROVAL', 'APPROVED'];
    public const ROUNDING_TOLERANCE = 1.0;
    /** Per-document status entries kept on the run row (the live view is unbounded). */
    public const DOCUMENT_STATUS_LIMIT = 2000;

    /** Composite posting statuses. */
    public const SYNC_IN_SYNC = 'IN_SYNC';
    public const SYNC_PENDING_INVENTORY = 'PENDING_INVENTORY';
    public const SYNC_FAILED_INVENTORY = 'FAILED_INVENTORY';
    public const SYNC_REVERSED_INVENTORY = 'REVERSED_INVENTORY';
    public const SYNC_CANCELLED_BOOKS = 'CANCELLED_IN_BOOKS';
    public const SYNC_MISSING_BOOKS = 'MISSING_IN_BOOKS';
    public const SYNC_MISSING_INVENTORY = 'MISSING_IN_INVENTORY';
    public const SYNC_PENDING_BOOKS = 'PENDING_IN_BOOKS';
    public const SYNC_FAILED_BOOKS = 'FAILED_IN_BOOKS';
    public const SYNC_BOOKS_UNAVAILABLE = 'BOOKS_UNAVAILABLE';
    public const SYNC_CANCELLED_BOTH = 'CANCELLED_BOTH';

    public function __construct(
        protected ?BooksApiClient $books = null,
        protected ?ValuationReplayService $valuation = null,
        protected ?OpeningStockResolver $openings = null,
        protected ?AuditService $audit = null,
    ) {
        $this->books ??= new BooksApiClient();
        $this->valuation ??= new ValuationReplayService();
        $this->openings ??= new OpeningStockResolver();
        $this->audit ??= new AuditService();
    }

    // ------------------------------------------------------------------ runs

    /**
     * Compute and persist a reconciliation run. Returns the stored row (decoded).
     *
     * @return array<string, mixed>
     */
    public function run(int $cmpId, int $fyId, int $boId, ?string $asOf, ?string $requestedBy = null): array
    {
        $asOf = self::normalizeDate($asOf) ?? date('Y-m-d');
        $db = \Config\Database::connect();
        $now = date('Y-m-d H:i:s');
        try {
            $result = $this->compute($cmpId, $fyId, $boId, $asOf);
        } catch (\Throwable $e) {
            $db->table('inv_reconciliation_runs')->insert([
                'cmp_id' => $cmpId, 'fy_id' => $fyId, 'bo_id' => $boId, 'as_of_date' => $asOf,
                'inventory_closing_value' => 0, 'inventory_closing_qty' => 0, 'books_stock_ledger_balance' => null, 'difference' => null,
                'status' => self::STATUS_FAILED, 'breakdown_json' => json_encode(['error' => $e->getMessage()]), 'document_status_json' => null,
                'requested_by' => $requestedBy, 'created_at' => $now,
            ]);
            $runId = (int) $db->insertID();
            $this->audit->log($cmpId, 'reconciliation_run', $runId, 'reconciliation.failed', $requestedBy, ['as_of' => $asOf, 'fy_id' => $fyId, 'bo_id' => $boId, 'reason' => $e->getMessage()]);
            throw $e;
        }
        $docStatus = $result['document_status'];
        $stored = $docStatus;
        if (count($stored['entries']) > self::DOCUMENT_STATUS_LIMIT) {
            $stored['entries'] = array_slice($stored['entries'], 0, self::DOCUMENT_STATUS_LIMIT);
            $stored['truncated'] = true;
        }
        $db->table('inv_reconciliation_runs')->insert([
            'cmp_id'                     => $cmpId,
            'fy_id'                      => $fyId,
            'bo_id'                      => $boId,
            'as_of_date'                 => $asOf,
            'inventory_closing_value'    => $result['inventory_closing_value'],
            'inventory_closing_qty'      => $result['inventory_closing_qty'],
            'books_stock_ledger_balance' => $result['books_stock_ledger_balance'],
            'difference'                 => $result['difference'],
            'status'                     => $result['status'],
            'breakdown_json'             => json_encode($result['breakdown'], JSON_UNESCAPED_UNICODE),
            'document_status_json'       => json_encode($stored, JSON_UNESCAPED_UNICODE),
            'requested_by'               => $requestedBy,
            'created_at'                 => $now,
        ]);
        $runId = (int) $db->insertID();
        $this->audit->log($cmpId, 'reconciliation_run', $runId, 'reconciliation.run', $requestedBy, [
            'as_of' => $asOf, 'fy_id' => $fyId, 'bo_id' => $boId, 'status' => $result['status'],
            'inventory_closing_value' => $result['inventory_closing_value'], 'books_stock_ledger_balance' => $result['books_stock_ledger_balance'], 'difference' => $result['difference'],
        ]);

        $row = $this->get($cmpId, $runId);

        return $row ?? array_merge(['run_id' => $runId], $result);
    }

    /** @return array<string, mixed>|null */
    public function get(int $cmpId, int $runId): ?array
    {
        $row = \Config\Database::connect()->table('inv_reconciliation_runs')->where('cmp_id', $cmpId)->where('run_id', $runId)->get()->getRowArray();

        return $row ? self::castRun($row, true) : null;
    }

    /** @return array<string, mixed> */
    public static function castRun(array $row, bool $withDetail = false): array
    {
        $row['run_id'] = (int) $row['run_id'];
        $row['cmp_id'] = (int) $row['cmp_id'];
        $row['fy_id'] = (int) $row['fy_id'];
        $row['bo_id'] = (int) $row['bo_id'];
        $row['as_of_date'] = substr((string) $row['as_of_date'], 0, 10);
        foreach (['inventory_closing_value', 'inventory_closing_qty', 'books_stock_ledger_balance', 'difference'] as $k) {
            $row[$k] = isset($row[$k]) ? round((float) $row[$k], 4) : null;
        }
        if ($withDetail) {
            $row['breakdown'] = json_decode((string) ($row['breakdown_json'] ?? ''), true) ?: null;
            $row['document_status'] = json_decode((string) ($row['document_status_json'] ?? ''), true) ?: null;
        }
        unset($row['breakdown_json'], $row['document_status_json']);

        return $row;
    }

    // ------------------------------------------------------------------ computation

    /**
     * Compute without persisting.
     *
     * @return array{status:string, as_of:string, inventory_closing_value:float, inventory_closing_qty:float, books_stock_ledger_balance:?float, difference:?float, breakdown:array<string,mixed>, document_status:array<string,mixed>}
     */
    public function compute(int $cmpId, int $fyId, int $boId, string $asOf): array
    {
        $snapshot = $this->valuation->snapshot($cmpId, $fyId, $boId, $asOf);
        $inventoryValue = round((float) $snapshot['total_value'], 4);
        $inventoryQty = round((float) $snapshot['total_qty'], 4);

        $books = $this->fetchBooksBalance($cmpId, $fyId, $boId, $asOf);
        $booksAvailable = $books['available'];
        $booksBalance = $booksAvailable ? $books['balance'] : null;
        $difference = $booksAvailable && $booksBalance !== null ? round($inventoryValue - $booksBalance, 4) : null;

        $postingStatus = $this->postingStatus($cmpId, $fyId, $boId);

        $buckets = [];
        // 1. Opening difference.
        $inventoryOpening = $this->inventoryOpeningValue($cmpId, $fyId);
        $booksOpening = $books['opening_balance'];
        $buckets['opening_difference'] = [
            'amount'                  => $booksOpening !== null ? round($inventoryOpening - $booksOpening, 4) : 0.0,
            'count'                   => $booksOpening !== null && abs($inventoryOpening - $booksOpening) >= 0.0001 ? 1 : 0,
            'inventory_opening_value' => round($inventoryOpening, 4),
            'books_opening_balance'   => $booksOpening,
            'books_reported'          => $booksOpening !== null,
        ];
        // 2/3/7. Inventory documents by status.
        $buckets['pending_posting'] = $this->documentBucket($cmpId, $fyId, $boId, $asOf, self::PENDING_STATUSES, true, -1.0, $books['pending_postings']);
        $buckets['failed_posting'] = $this->documentBucket($cmpId, $fyId, $boId, $asOf, ['FAILED'], false, -1.0, $books['failed_postings']);
        $buckets['cancelled_reversed'] = $this->documentBucket($cmpId, $fyId, $boId, $asOf, ['REVERSED'], false, -1.0, $books['cancelled_reversed']);
        // 4. Unacknowledged valuation revisions.
        $buckets['unacknowledged_valuation_revisions'] = $this->unacknowledgedRevisionsBucket($cmpId, $fyId, $boId);
        // 5. Revaluation.
        $buckets['revaluation'] = $this->revaluationBucket($cmpId, $fyId, $boId, $asOf, $books['revaluations']);
        // 6. Manual journals (Books only).
        $manual = self::sumEntries($books['manual_journals']);
        $buckets['manual_journal'] = ['amount' => round(-$manual['sum'], 4), 'count' => $manual['count'], 'books_reported' => $books['manual_journals']];
        // 8. Missing source (Books posting entries without an inventory document).
        $missing = array_values(array_filter($postingStatus['entries'], static fn ($e) => $e['sync_status'] === self::SYNC_MISSING_INVENTORY));
        $missingSum = 0.0;
        foreach ($missing as $m) {
            $missingSum += (float) ($m['books']['amount'] ?? 0);
        }
        $buckets['missing_source'] = ['amount' => round(-$missingSum, 4), 'count' => count($missing), 'entries' => $missing];

        // 9. Residual -> rounding / unexplained.
        $explained = 0.0;
        foreach ($buckets as $b) {
            $explained += (float) $b['amount'];
        }
        $explained = round($explained, 4);
        $residual = $difference !== null ? round($difference - $explained, 4) : null;
        $isRounding = $residual !== null && abs($residual) < self::ROUNDING_TOLERANCE;
        $buckets['rounding'] = ['amount' => $isRounding ? $residual : 0.0, 'count' => $isRounding && abs($residual) >= 0.0001 ? 1 : 0];
        $buckets['unexplained'] = ['amount' => $residual !== null && !$isRounding ? $residual : 0.0, 'count' => $residual !== null && !$isRounding ? 1 : 0];

        $breakdown = [
            'as_of'          => $asOf,
            'sign_convention'=> 'amount = contribution to (inventory - books)',
            'explained_total'=> $explained,
            'residual'       => $residual,
            'books'          => ['available' => $booksAvailable, 'status' => $books['status'], 'error' => $books['error']],
            'buckets'        => $buckets,
        ];

        return [
            'status'                     => $booksAvailable ? self::STATUS_COMPLETED : self::STATUS_BOOKS_UNAVAILABLE,
            'as_of'                      => $asOf,
            'inventory_closing_value'    => $inventoryValue,
            'inventory_closing_qty'      => $inventoryQty,
            'books_stock_ledger_balance' => $booksBalance,
            'difference'                 => $difference,
            'breakdown'                  => $breakdown,
            'document_status'            => $postingStatus,
        ];
    }

    /** Inventory opening value for the FY: Σ opening layers (base qty × base unit cost). */
    public function inventoryOpeningValue(int $cmpId, int $fyId): float
    {
        $total = 0.0;
        foreach ($this->openings->openingLayersByItem($cmpId, $fyId) as $layers) {
            foreach ($layers as $layer) {
                $total += (float) $layer['qty_remaining'] * (float) $layer['unit_cost'];
            }
        }

        return round($total, 4);
    }

    /**
     * Composite posting status: every Books-sourced inventory document joined with the posting
     * status Books reports, plus Books entries with no inventory document (missing source).
     *
     * @return array{books_available:bool, books_error:?string, summary:array<string,int>, entries:list<array<string,mixed>>}
     */
    public function postingStatus(int $cmpId, int $fyId, int $boId): array
    {
        $db = \Config\Database::connect();
        $b = $db->table('inv_documents d')
            ->select('d.document_id, d.document_uuid, d.document_type, d.document_no, d.document_date, d.status, d.source_app, d.source_document_type, d.source_document_id, d.source_document_uuid, d.source_document_no, d.posted_at, d.cancelled_at, d.failure_reason, d.bo_id, (SELECT COALESCE(SUM(CASE WHEN l.direction = \'out\' THEN -1 ELSE 1 END * COALESCE(l.valuation_amount, l.source_transaction_amount, l.source_transaction_rate * l.qty, 0)), 0) FROM inv_document_lines l WHERE l.document_id = d.document_id) AS stock_effect', false)
            ->where('d.cmp_id', $cmpId)->where('d.fy_id', $fyId)->where('d.source_app', 'books')
            ->orderBy('d.document_date', 'ASC')->orderBy('d.document_id', 'ASC');
        if ($boId > 0) {
            $b->where('d.bo_id', $boId);
        }
        $docs = $b->get()->getResultArray();

        $booksResult = $this->books->postingStatus($cmpId, $fyId);
        $booksAvailable = !empty($booksResult['ok']) && is_array($booksResult['body'] ?? null);
        $booksEntries = $booksAvailable ? self::normalizePostingEntries($booksResult['body']) : [];
        $byId = [];
        $byUuid = [];
        foreach ($booksEntries as $idx => $e) {
            if ($e['source_document_id'] > 0) {
                $byId[$e['source_document_id']] = $idx;
            }
            if ($e['source_document_uuid'] !== null) {
                $byUuid[strtolower($e['source_document_uuid'])] = $idx;
            }
        }
        $matched = [];
        $entries = [];
        $summary = [];
        foreach ($docs as $d) {
            $idx = null;
            $sid = (int) ($d['source_document_id'] ?? 0);
            if ($sid > 0 && isset($byId[$sid])) {
                $idx = $byId[$sid];
            } elseif (!empty($d['source_document_uuid']) && isset($byUuid[strtolower((string) $d['source_document_uuid'])])) {
                $idx = $byUuid[strtolower((string) $d['source_document_uuid'])];
            }
            $books = $idx !== null ? $booksEntries[$idx] : null;
            if ($idx !== null) {
                $matched[$idx] = true;
            }
            $sync = self::compositeStatus((string) $d['status'], $books['status'] ?? null, $booksAvailable);
            $entry = [
                'sync_status' => $sync,
                'inventory'   => [
                    'document_id' => (int) $d['document_id'], 'document_uuid' => $d['document_uuid'], 'document_type' => $d['document_type'], 'document_no' => $d['document_no'],
                    'document_date' => substr((string) $d['document_date'], 0, 10), 'status' => $d['status'], 'posted_at' => $d['posted_at'], 'cancelled_at' => $d['cancelled_at'],
                    'failure_reason' => $d['failure_reason'], 'stock_effect' => round((float) $d['stock_effect'], 4), 'bo_id' => (int) $d['bo_id'],
                ],
                'source'      => ['source_app' => $d['source_app'], 'source_document_type' => $d['source_document_type'], 'source_document_id' => $sid ?: null, 'source_document_uuid' => $d['source_document_uuid'], 'source_document_no' => $d['source_document_no']],
                'books'       => $books,
            ];
            $entries[] = $entry;
            $summary[$sync] = ($summary[$sync] ?? 0) + 1;
        }
        foreach ($booksEntries as $idx => $e) {
            if (isset($matched[$idx])) {
                continue;
            }
            $sync = self::SYNC_MISSING_INVENTORY;
            $entries[] = [
                'sync_status' => $sync,
                'inventory'   => null,
                'source'      => ['source_app' => 'books', 'source_document_type' => $e['source_document_type'], 'source_document_id' => $e['source_document_id'] ?: null, 'source_document_uuid' => $e['source_document_uuid'], 'source_document_no' => $e['document_no']],
                'books'       => $e,
            ];
            $summary[$sync] = ($summary[$sync] ?? 0) + 1;
        }
        ksort($summary);

        return [
            'books_available' => $booksAvailable,
            'books_error'     => $booksAvailable ? null : ($booksResult['error'] ?? 'Books unavailable'),
            'summary'         => $summary,
            'entries'         => $entries,
        ];
    }

    // ------------------------------------------------------------------ buckets

    /**
     * Bucket built from inventory documents in the given statuses (books-sourced only when
     * $booksOnly). Contribution = $sign × signed stock effect (in +, out −).
     *
     * @param list<string> $statuses
     * @param list<array<string,mixed>> $booksReported
     * @return array<string, mixed>
     */
    private function documentBucket(int $cmpId, int $fyId, int $boId, string $asOf, array $statuses, bool $booksOnly, float $sign, array $booksReported): array
    {
        $db = \Config\Database::connect();
        $b = $db->table('inv_documents d')
            ->select('d.document_id, d.document_uuid, d.document_type, d.document_no, d.document_date, d.status, d.source_app, d.source_document_type, d.source_document_id, d.source_document_uuid, d.source_document_no, d.failure_reason, d.cancel_reason, (SELECT COALESCE(SUM(CASE WHEN l.direction = \'out\' THEN -1 ELSE 1 END * COALESCE(l.valuation_amount, l.source_transaction_amount, l.source_transaction_rate * l.qty, 0)), 0) FROM inv_document_lines l WHERE l.document_id = d.document_id) AS stock_effect', false)
            ->where('d.cmp_id', $cmpId)->where('d.fy_id', $fyId)->whereIn('d.status', $statuses)
            ->where('d.document_date <=', $asOf)
            ->orderBy('d.document_date', 'ASC')->orderBy('d.document_id', 'ASC');
        if ($boId > 0) {
            $b->where('d.bo_id', $boId);
        }
        if ($booksOnly) {
            $b->where('d.source_app', 'books');
        }
        $rows = [];
        $sum = 0.0;
        foreach ($b->get()->getResultArray() as $r) {
            $spec = DocumentTypeRegistry::get((string) $r['document_type']);
            // Documents that never carry valuation (packing, reservation, challan ...) explain nothing.
            $effect = !empty($spec['valuation']) ? round((float) $r['stock_effect'], 4) : 0.0;
            $sum += $effect;
            $rows[] = [
                'document_id' => (int) $r['document_id'], 'document_uuid' => $r['document_uuid'], 'document_type' => $r['document_type'], 'document_no' => $r['document_no'],
                'document_date' => substr((string) $r['document_date'], 0, 10), 'status' => $r['status'], 'source_app' => $r['source_app'],
                'source_document_type' => $r['source_document_type'], 'source_document_id' => $r['source_document_id'] !== null ? (int) $r['source_document_id'] : null,
                'source_document_uuid' => $r['source_document_uuid'], 'source_document_no' => $r['source_document_no'],
                'reason' => $r['failure_reason'] ?? $r['cancel_reason'] ?? null, 'stock_effect' => $effect,
            ];
        }
        $reported = self::sumEntries($booksReported);

        return [
            'amount'         => round($sign * $sum, 4),
            'count'          => count($rows),
            'stock_effect'   => round($sum, 4),
            'documents'      => $rows,
            'books_reported' => $booksReported,
            'books_reported_total' => round($reported['sum'], 4),
        ];
    }

    /** @return array<string, mixed> */
    private function unacknowledgedRevisionsBucket(int $cmpId, int $fyId, int $boId): array
    {
        $b = \Config\Database::connect()->table('inv_valuation_revisions r')
            ->select('COUNT(*) AS cnt, COALESCE(SUM(r.delta_amount), 0) AS delta, MIN(r.created_at) AS oldest, MAX(r.created_at) AS newest', false)
            ->join('inv_documents d', 'd.document_id = r.document_id', 'inner')
            ->where('r.cmp_id', $cmpId)->where('d.cmp_id', $cmpId)->where('d.fy_id', $fyId)
            ->where('r.acknowledged_at', null);
        if ($boId > 0) {
            $b->where('d.bo_id', $boId);
        }
        $agg = $b->get()->getRowArray() ?: [];
        $delta = round((float) ($agg['delta'] ?? 0), 4);

        // A positive delta = more cost issued out of stock in Inventory than Books knows about.
        return ['amount' => round(-$delta, 4), 'count' => (int) ($agg['cnt'] ?? 0), 'delta_total' => $delta, 'oldest' => $agg['oldest'] ?? null, 'newest' => $agg['newest'] ?? null];
    }

    /**
     * @param list<array<string,mixed>> $booksReported
     * @return array<string, mixed>
     */
    private function revaluationBucket(int $cmpId, int $fyId, int $boId, string $asOf, array $booksReported): array
    {
        $b = \Config\Database::connect()->table('inv_documents d')
            ->select('d.document_id, d.document_uuid, d.document_no, d.document_date, d.status, d.accounting_effects_json')
            ->where('d.cmp_id', $cmpId)->where('d.fy_id', $fyId)->where('d.document_type', 'REVALUATION')
            ->whereIn('d.status', ['POSTED', 'COMPLETED', 'PARTIALLY_FULFILLED'])
            ->where('d.document_date <=', $asOf)
            ->orderBy('d.document_date', 'ASC')->orderBy('d.document_id', 'ASC');
        if ($boId > 0) {
            $b->where('d.bo_id', $boId);
        }
        $rows = [];
        $sum = 0.0;
        foreach ($b->get()->getResultArray() as $r) {
            $effects = json_decode((string) ($r['accounting_effects_json'] ?? ''), true) ?: [];
            $amount = 0.0;
            foreach ($effects as $e) {
                if (($e['effect'] ?? '') === 'STOCK_REVALUATION') {
                    $amount += (float) ($e['amount'] ?? 0);
                }
            }
            $amount = round($amount, 4);
            $sum += $amount;
            $rows[] = ['document_id' => (int) $r['document_id'], 'document_uuid' => $r['document_uuid'], 'document_no' => $r['document_no'], 'document_date' => substr((string) $r['document_date'], 0, 10), 'status' => $r['status'], 'amount' => $amount];
        }
        $reported = self::sumEntries($booksReported);

        return [
            'amount'               => round($sum - $reported['sum'], 4),
            'count'                => count($rows),
            'inventory_total'      => round($sum, 4),
            'documents'            => $rows,
            'books_reported'       => $booksReported,
            'books_reported_total' => round($reported['sum'], 4),
        ];
    }

    // ------------------------------------------------------------------ Books payloads

    /**
     * @return array{available:bool, status:int, error:?string, balance:?float, opening_balance:?float, pending_postings:list<array>, failed_postings:list<array>, manual_journals:list<array>, revaluations:list<array>, cancelled_reversed:list<array>}
     */
    private function fetchBooksBalance(int $cmpId, int $fyId, int $boId, string $asOf): array
    {
        $out = ['available' => false, 'status' => 0, 'error' => null, 'balance' => null, 'opening_balance' => null, 'pending_postings' => [], 'failed_postings' => [], 'manual_journals' => [], 'revaluations' => [], 'cancelled_reversed' => []];
        try {
            $r = $this->books->stockLedgerBalance($cmpId, $fyId, $boId, $asOf);
        } catch (\Throwable $e) {
            $out['error'] = $e->getMessage();

            return $out;
        }
        $out['status'] = (int) ($r['status'] ?? 0);
        if (empty($r['ok']) || !is_array($r['body'] ?? null)) {
            $out['error'] = (string) ($r['error'] ?? 'Books unreachable');

            return $out;
        }
        $data = is_array($r['body']['data'] ?? null) ? $r['body']['data'] : $r['body'];
        $balance = $data['balance'] ?? $data['stock_ledger_balance'] ?? $data['closing_balance'] ?? null;
        if ($balance === null || !is_numeric($balance)) {
            $out['error'] = 'Books payload has no numeric balance';

            return $out;
        }
        $out['available'] = true;
        $out['balance'] = round((float) $balance, 4);
        $opening = $data['opening_balance'] ?? null;
        $out['opening_balance'] = $opening !== null && is_numeric($opening) ? round((float) $opening, 4) : null;
        foreach (['pending_postings', 'failed_postings', 'manual_journals', 'revaluations', 'cancelled_reversed'] as $k) {
            $out[$k] = is_array($data[$k] ?? null) ? array_values(array_filter($data[$k], 'is_array')) : [];
        }

        return $out;
    }

    /**
     * Books posting-status entries in a normalised shape. Accepts {data:[...]}, {data:{entries|postings:[...]}} or a bare list.
     *
     * @return list<array{source_document_id:int, source_document_uuid:?string, source_document_type:?string, document_no:?string, document_date:?string, status:?string, amount:?float, raw:array}>
     */
    public static function normalizePostingEntries(array $body): array
    {
        $list = $body['data'] ?? $body;
        if (is_array($list) && !array_is_list($list)) {
            $list = $list['entries'] ?? $list['postings'] ?? $list['items'] ?? $list['rows'] ?? [];
        }
        if (!is_array($list)) {
            return [];
        }
        $out = [];
        foreach ($list as $e) {
            if (!is_array($e)) {
                continue;
            }
            $id = (int) ($e['vch_txn_id'] ?? $e['source_document_id'] ?? $e['document_id'] ?? $e['id'] ?? 0);
            $uuid = $e['vch_uuid'] ?? $e['source_document_uuid'] ?? $e['document_uuid'] ?? $e['uuid'] ?? null;
            $type = $e['source_document_type'] ?? $e['document_type'] ?? null;
            if ($type === null && isset($e['vch_type'])) {
                $type = is_numeric($e['vch_type']) ? ('books.' . strtolower((string) (DocumentTypeRegistry::fromLegacyVchType((int) $e['vch_type']) ?? $e['vch_type']))) : (string) $e['vch_type'];
            }
            $status = $e['status'] ?? $e['posting_status'] ?? $e['inventory_status'] ?? null;
            $amount = $e['amount'] ?? $e['stock_value'] ?? $e['valuation_amount'] ?? $e['value'] ?? null;
            if ($id <= 0 && ($uuid === null || $uuid === '')) {
                continue;
            }
            $out[] = [
                'source_document_id'   => $id,
                'source_document_uuid' => $uuid !== null && $uuid !== '' ? (string) $uuid : null,
                'source_document_type' => $type !== null ? (string) $type : null,
                'document_no'          => isset($e['vch_no']) ? (string) $e['vch_no'] : (isset($e['document_no']) ? (string) $e['document_no'] : null),
                'document_date'        => isset($e['vch_date']) ? substr((string) $e['vch_date'], 0, 10) : (isset($e['document_date']) ? substr((string) $e['document_date'], 0, 10) : null),
                'status'               => $status !== null ? strtoupper((string) $status) : null,
                'amount'               => $amount !== null && is_numeric($amount) ? round((float) $amount, 4) : null,
                'raw'                  => $e,
            ];
        }

        return $out;
    }

    public static function compositeStatus(string $inventoryStatus, ?string $booksStatus, bool $booksAvailable): string
    {
        $inv = strtoupper($inventoryStatus);
        $bk = self::normalizeBooksStatus($booksStatus);
        if (in_array($inv, self::PENDING_STATUSES, true) || $inv === 'POSTING') {
            return self::SYNC_PENDING_INVENTORY;
        }
        if ($inv === 'FAILED') {
            return self::SYNC_FAILED_INVENTORY;
        }
        if ($inv === 'REVERSED' || $inv === 'CANCELLED') {
            return $bk === 'CANCELLED' ? self::SYNC_CANCELLED_BOTH : self::SYNC_REVERSED_INVENTORY;
        }
        // POSTED / COMPLETED / PARTIALLY_FULFILLED
        if (!$booksAvailable) {
            return self::SYNC_BOOKS_UNAVAILABLE;
        }
        if ($booksStatus === null) {
            return self::SYNC_MISSING_BOOKS;
        }

        return match ($bk) {
            'POSTED' => self::SYNC_IN_SYNC,
            'CANCELLED' => self::SYNC_CANCELLED_BOOKS,
            'PENDING' => self::SYNC_PENDING_BOOKS,
            'FAILED' => self::SYNC_FAILED_BOOKS,
            default => self::SYNC_IN_SYNC,
        };
    }

    /** POSTED | CANCELLED | PENDING | FAILED | UNKNOWN */
    public static function normalizeBooksStatus(?string $status): string
    {
        $s = strtoupper(trim((string) $status));

        return match (true) {
            $s === '' => 'UNKNOWN',
            in_array($s, ['POSTED', 'ACKED', 'ACKNOWLEDGED', 'SYNCED', 'OK', 'DONE', 'COMPLETED', 'SUCCESS'], true) => 'POSTED',
            in_array($s, ['CANCELLED', 'CANCELED', 'REVERSED', 'DELETED', 'VOID'], true) => 'CANCELLED',
            in_array($s, ['PENDING', 'QUEUED', 'DRAFT', 'IN_PROGRESS', 'PROCESSING', 'SENT'], true) => 'PENDING',
            in_array($s, ['FAILED', 'ERROR', 'DEAD', 'REJECTED'], true) => 'FAILED',
            default => 'UNKNOWN',
        };
    }

    /**
     * @param list<array<string,mixed>> $entries
     * @return array{sum:float, count:int}
     */
    private static function sumEntries(array $entries): array
    {
        $sum = 0.0;
        $count = 0;
        foreach ($entries as $e) {
            if (!is_array($e)) {
                continue;
            }
            $count++;
            $amount = $e['amount'] ?? $e['stock_value'] ?? $e['value'] ?? $e['valuation_amount'] ?? 0;
            $sum += is_numeric($amount) ? (float) $amount : 0.0;
        }

        return ['sum' => round($sum, 4), 'count' => $count];
    }

    public static function normalizeDate(?string $value): ?string
    {
        $v = trim((string) $value);
        if ($v === '') {
            return null;
        }
        $ts = strtotime($v);

        return $ts === false ? null : date('Y-m-d', $ts);
    }
}
