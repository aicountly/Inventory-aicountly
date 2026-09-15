<?php

namespace App\Services;

use Config\DocumentTypeRegistry;

/**
 * The server-side aggregates behind the five Inventory dashboards.
 *
 * Everything here answers a question no existing report answers, and every
 * figure is computed **in PostgreSQL over the whole scoped set** — no method
 * returns rows for the browser to add up. The rule the whole file is built to
 * keep: a dashboard number is either a real aggregate or it is absent, with a
 * state saying why. There is no third option, and in particular no zero
 * standing in for "we could not work it out".
 *
 * Each metric travels as `['value' => …, 'state' => …, 'definition' => …]`:
 *
 *   ready           the figure is a real count/sum over the scope
 *   empty           the query succeeded and there is genuinely nothing
 *   not_configured  the product does not model this at all (see `transfers_in_transit`)
 *   unavailable     the source could not be read
 *
 * `definition` is not documentation for developers — it is shipped to the
 * screen and shown in the card's tooltip, because "Receipts today: 24" is not
 * a number anyone can reconcile until they know it counts documents, not lines,
 * by posting time, in the application timezone.
 *
 * Scope is always (cmp_id, fy_id, bo_id) taken from the authorised session
 * context, never from a query parameter — see DashboardController.
 */
class DashboardMetricsService
{
    /** Statuses that mean the document really moved stock. */
    public const POSTED_STATUSES = ['POSTED', 'COMPLETED', 'PARTIALLY_FULFILLED'];

    /** Statuses of a document still being worked on — it has NOT moved stock. */
    public const OPEN_STATUSES = ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'POSTING'];

    /** How many rows a dashboard list panel shows. Panels link to the full register. */
    public const PANEL_ROWS = 8;

    private \CodeIgniter\Database\BaseConnection $db;

    public function __construct(?\CodeIgniter\Database\BaseConnection $db = null)
    {
        $this->db = $db ?? \Config\Database::connect();
    }

    // -----------------------------------------------------------------------
    // Metric envelope helpers
    // -----------------------------------------------------------------------

    /**
     * A figure that was really counted.
     *
     * Zero is `ready`, not `empty`: "no issues posted today" is an answer, and
     * a card that greys itself out on a quiet morning teaches people the screen
     * is broken. `empty` is for a LIST with no rows, never for a count of none.
     */
    private static function metric(int|float|string|null $value, string $definition, array $extra = []): array
    {
        return array_merge([
            'value'      => $value,
            'state'      => $value === null ? 'unavailable' : 'ready',
            'definition' => $definition,
        ], $extra);
    }

    /** A figure this product does not model. Says so, and says what to do instead. */
    private static function notConfigured(string $definition, string $reason, ?string $insteadPath = null): array
    {
        return [
            'value'       => null,
            'state'       => 'not_configured',
            'definition'  => $definition,
            'reason'      => $reason,
            'instead'     => $insteadPath,
        ];
    }

    // -----------------------------------------------------------------------
    // Operations
    // -----------------------------------------------------------------------

    /**
     * Dashboard 2 — a day on the warehouse floor.
     *
     * `$date` is a calendar date in the APPLICATION timezone (Config\App::$appTimezone),
     * which is the timezone `posted_at` was written in, so `posted_at::date = $date`
     * is a true "posted today" and not an off-by-one for anyone west of it. The
     * resolved date and the timezone both travel back in the envelope so the
     * screen can say which day it is showing.
     *
     * @return array<string, mixed>
     */
    public function operations(int $cmpId, int $fyId, int $boId, string $date): array
    {
        $flowCounts = $this->postedFlowCounts($cmpId, $fyId, $boId, $date);
        $statusCounts = $this->openDocumentStatusCounts($cmpId, $fyId, $boId);
        $variances = $this->countVariances($cmpId, $fyId, $boId);
        $inFlight = $this->pendingQuantitySummary($cmpId, $fyId, $boId, $date);

        return [
            'date'     => $date,
            'timezone' => app_timezone(),
            'metrics'  => [
                'receipts_today' => self::metric(
                    $flowCounts[DocumentTypeRegistry::FLOW_RECEIPT],
                    'Documents of inward types (purchase receipt, material receipt, opening stock, write-in, sales return) posted on this date. Counts documents, not lines, by posting time in ' . app_timezone() . '.',
                ),
                'issues_today' => self::metric(
                    $flowCounts[DocumentTypeRegistry::FLOW_ISSUE],
                    'Documents of outward types (sales issue, material issue, consumption, write-off, purchase return) posted on this date. Counts documents, not lines.',
                ),
                'transfers_today' => self::metric(
                    $flowCounts[DocumentTypeRegistry::FLOW_TRANSFER],
                    'Stock transfers posted on this date. A transfer moves stock out of one warehouse and into another in a single posting, so it is counted once here and never as both a receipt and an issue.',
                ),
                'adjustments_today' => self::metric(
                    $flowCounts[DocumentTypeRegistry::FLOW_ADJUSTMENT],
                    'Balance-changing documents posted on this date — physical counts, stock journals, production, assembly, job work inward, revaluation and landed cost.',
                ),
                // Stated plainly rather than filled with a plausible number: this
                // product posts a transfer as one operation, so no stock is ever
                // in a transit bucket between two warehouses. The goods that ARE
                // genuinely out and awaited are challans and job work, which have
                // a real expected-return date — that is what the tracker shows.
                'transfers_in_transit' => self::notConfigured(
                    'Stock sitting between two warehouses after dispatch and before receipt.',
                    'Stock transfers post out and in as one operation in this product, so no balance is ever held in transit. Goods that are genuinely out and awaited are delivery challans and job work, tracked below with their own expected-return dates.',
                    '/registers/pending-quantities',
                ),
                'goods_awaited' => self::metric(
                    $inFlight['open_documents'],
                    'Documents with quantity still outstanding — delivery challans, inward challans, deferred purchases and job work whose goods have not been settled. Counts documents, not lines.',
                    ['overdue' => $inFlight['overdue_documents']],
                ),
                'counts_in_progress' => self::metric(
                    $variances['open_count_documents'],
                    'Physical stock adjustment documents not yet posted. These are the counts being worked on right now.',
                ),
                'count_variances' => self::metric(
                    $variances['variance_lines'],
                    'Counted lines on unposted physical adjustments where the counted quantity differs from the system quantity. Counts lines, because one document can hold many variances.',
                    ['documents' => $variances['variance_documents']],
                ),
                'awaiting_approval' => self::metric(
                    $statusCounts['PENDING_APPROVAL'],
                    'Documents submitted and waiting for an approver, across every type in this financial year.',
                ),
                'ready_to_post' => self::metric(
                    $statusCounts['APPROVED'],
                    'Documents approved but not yet posted — stock has not moved for these.',
                ),
                'failed_posting' => self::metric(
                    $statusCounts['FAILED'],
                    'Documents whose posting failed. Stock did not move; the failure reason is on the document.',
                ),
                'drafts' => self::metric(
                    $statusCounts['DRAFT'],
                    'Documents started and not submitted.',
                ),
            ],
            'hourly'          => $this->hourlyMovement($cmpId, $fyId, $boId, $date),
            'in_flight'       => $inFlight,
            'count_progress'  => $variances['progress'],
            'count_documents' => $variances['documents'],
        ];
    }

    /**
     * Posted documents on one date, folded into flow classes.
     *
     * Grouped by type in SQL and classed in PHP so the class table lives in one
     * place (DocumentTypeRegistry) rather than being half-expressed as a list of
     * type strings inside a WHERE clause that would silently miss the next type
     * anyone adds.
     *
     * @return array<string, int>
     */
    private function postedFlowCounts(int $cmpId, int $fyId, int $boId, string $date): array
    {
        $counts = [
            DocumentTypeRegistry::FLOW_RECEIPT    => 0,
            DocumentTypeRegistry::FLOW_ISSUE      => 0,
            DocumentTypeRegistry::FLOW_TRANSFER   => 0,
            DocumentTypeRegistry::FLOW_ADJUSTMENT => 0,
            DocumentTypeRegistry::FLOW_NONE       => 0,
        ];
        $b = $this->scopedDocuments($cmpId, $fyId, $boId)
            ->select('document_type, COUNT(*) AS cnt', false)
            ->whereIn('status', self::POSTED_STATUSES)
            ->where('posted_at IS NOT NULL', null, false)
            ->where('CAST(posted_at AS DATE) =', $date);
        $rows = $b->groupBy('document_type')->get();
        if ($rows === false) {
            return $counts;
        }
        foreach ($rows->getResultArray() as $r) {
            $counts[DocumentTypeRegistry::flowClass((string) $r['document_type'])] += (int) $r['cnt'];
        }

        return $counts;
    }

    /**
     * Documents posted through the day, by hour and flow class.
     *
     * Only hours up to and including the current one are returned when `$date`
     * is today: an empty 17:00 bar drawn at 11:00 reads as "nothing was done
     * this afternoon" rather than "the afternoon has not happened", and a chart
     * that says the first thing about the future is a chart that lies.
     *
     * @return array{buckets: list<array<string, mixed>>, truncated_at_hour: int|null}
     */
    private function hourlyMovement(int $cmpId, int $fyId, int $boId, string $date): array
    {
        $isToday = $date === date('Y-m-d');
        $lastHour = $isToday ? (int) date('G') : 23;

        $byHour = [];
        $rows = $this->scopedDocuments($cmpId, $fyId, $boId)
            ->select('EXTRACT(HOUR FROM posted_at) AS hr, document_type, COUNT(*) AS cnt', false)
            ->whereIn('status', self::POSTED_STATUSES)
            ->where('posted_at IS NOT NULL', null, false)
            ->where('CAST(posted_at AS DATE) =', $date)
            ->groupBy('hr, document_type')
            ->get();
        if ($rows !== false) {
            foreach ($rows->getResultArray() as $r) {
                $hour = (int) $r['hr'];
                $flow = DocumentTypeRegistry::flowClass((string) $r['document_type']);
                $byHour[$hour][$flow] = ($byHour[$hour][$flow] ?? 0) + (int) $r['cnt'];
            }
        }

        $buckets = [];
        for ($h = 0; $h <= $lastHour; $h++) {
            $buckets[] = [
                'hour'       => $h,
                'receipt'    => (int) ($byHour[$h][DocumentTypeRegistry::FLOW_RECEIPT] ?? 0),
                'issue'      => (int) ($byHour[$h][DocumentTypeRegistry::FLOW_ISSUE] ?? 0),
                'transfer'   => (int) ($byHour[$h][DocumentTypeRegistry::FLOW_TRANSFER] ?? 0),
                'adjustment' => (int) ($byHour[$h][DocumentTypeRegistry::FLOW_ADJUSTMENT] ?? 0),
            ];
        }

        return [
            'buckets'           => $buckets,
            'truncated_at_hour' => $isToday ? $lastHour : null,
        ];
    }

    /**
     * Open documents by status, for the work queue.
     *
     * @return array<string, int>
     */
    private function openDocumentStatusCounts(int $cmpId, int $fyId, int $boId): array
    {
        $counts = array_fill_keys(array_merge(self::OPEN_STATUSES, ['FAILED']), 0);
        $rows = $this->scopedDocuments($cmpId, $fyId, $boId)
            ->select('status, COUNT(*) AS cnt', false)
            ->whereIn('status', array_keys($counts))
            ->groupBy('status')
            ->get();
        if ($rows === false) {
            return $counts;
        }
        foreach ($rows->getResultArray() as $r) {
            $counts[(string) $r['status']] = (int) $r['cnt'];
        }

        return $counts;
    }

    /**
     * Physical counts in progress, their completion and their variances.
     *
     * Completion is counted lines over total lines on the document — the real
     * numerator and denominator, both returned, never a percentage on its own.
     * A line is "counted" when `physical_qty` has been filled in; the variance
     * is against `book_qty`, the system quantity captured at count time, which
     * is the comparison the document itself was built on.
     *
     * @return array<string, mixed>
     */
    private function countVariances(int $cmpId, int $fyId, int $boId): array
    {
        $docs = $this->scopedDocuments($cmpId, $fyId, $boId, 'd')
            ->select(
                'd.document_id, d.document_no, d.document_date, d.status, d.from_warehouse_id,'
                . ' COUNT(l.line_id) AS total_lines,'
                . ' COUNT(l.physical_qty) AS counted_lines,'
                . ' SUM(CASE WHEN l.physical_qty IS NOT NULL AND l.book_qty IS NOT NULL'
                . '      AND l.physical_qty <> l.book_qty THEN 1 ELSE 0 END) AS variance_lines',
                false,
            )
            ->where('d.document_type', 'PHYSICAL_ADJUSTMENT')
            ->whereIn('d.status', self::OPEN_STATUSES)
            ->join('inv_document_lines l', 'l.document_id = d.document_id', 'left')
            ->groupBy('d.document_id, d.document_no, d.document_date, d.status, d.from_warehouse_id')
            ->orderBy('d.document_date', 'DESC')
            ->orderBy('d.document_id', 'DESC')
            ->get();

        $rows = $docs === false ? [] : $docs->getResultArray();

        $warehouseNames = $this->warehouseNames($cmpId);
        $documents = [];
        $progress = [];
        $varianceLines = 0;
        $varianceDocs = 0;
        foreach ($rows as $r) {
            $total = (int) $r['total_lines'];
            $counted = (int) $r['counted_lines'];
            $variance = (int) $r['variance_lines'];
            $varianceLines += $variance;
            if ($variance > 0) {
                $varianceDocs++;
            }
            $whId = $r['from_warehouse_id'] !== null ? (int) $r['from_warehouse_id'] : null;
            $documents[] = [
                'document_id'    => (int) $r['document_id'],
                'document_no'    => $r['document_no'],
                'document_date'  => $r['document_date'],
                'status'         => $r['status'],
                'warehouse_id'   => $whId,
                'warehouse_name' => $whId !== null ? ($warehouseNames[$whId] ?? null) : null,
                'total_lines'    => $total,
                'counted_lines'  => $counted,
                'variance_lines' => $variance,
            ];

            $key = $whId ?? 0;
            if (!isset($progress[$key])) {
                $progress[$key] = [
                    'warehouse_id'   => $whId,
                    'warehouse_name' => $whId !== null ? ($warehouseNames[$whId] ?? null) : null,
                    'counted_lines'  => 0,
                    'total_lines'    => 0,
                    'documents'      => 0,
                ];
            }
            $progress[$key]['counted_lines'] += $counted;
            $progress[$key]['total_lines'] += $total;
            $progress[$key]['documents']++;
        }

        return [
            'open_count_documents' => count($rows),
            'variance_lines'       => $varianceLines,
            'variance_documents'   => $varianceDocs,
            'documents'            => array_slice($documents, 0, self::PANEL_ROWS),
            'progress'             => array_values($progress),
        ];
    }

    /**
     * Goods out and awaited: challans, deferred purchases and job work.
     *
     * "Overdue" is only ever said of a document that carries a real
     * `expected_return_date`. A challan with no agreed return date is not late —
     * it is undated, and it is reported as such rather than counted as overdue
     * because it happens to be old.
     *
     * @return array<string, mixed>
     */
    private function pendingQuantitySummary(int $cmpId, int $fyId, int $boId, string $date): array
    {
        $b = $this->db->table('inv_pending_quantities p')
            ->join('inv_documents d', 'd.document_id = p.document_id', 'inner')
            ->where('p.cmp_id', $cmpId)
            ->where('p.fy_id', $fyId)
            ->whereIn('p.status', ['open', 'partial']);
        if ($boId > 0) {
            $b->where('d.bo_id', $boId);
        }

        $agg = (clone $b)
            ->select(
                'p.pending_kind, p.direction, COUNT(DISTINCT p.document_id) AS docs, COUNT(*) AS lines,'
                . ' COALESCE(SUM(p.qty_original - p.qty_settled), 0) AS outstanding_qty,'
                . ' COUNT(DISTINCT CASE WHEN d.expected_return_date IS NOT NULL'
                . '      AND d.expected_return_date < ' . $this->db->escape($date) . ' THEN p.document_id END) AS overdue_docs,'
                . ' COUNT(DISTINCT CASE WHEN d.expected_return_date IS NULL THEN p.document_id END) AS undated_docs',
                false,
            )
            ->groupBy('p.pending_kind, p.direction')
            ->get();

        $byKind = [];
        foreach ($agg === false ? [] : $agg->getResultArray() as $r) {
            $byKind[] = [
                'kind'            => (string) $r['pending_kind'],
                'direction'       => (string) $r['direction'],
                'documents'       => (int) $r['docs'],
                'lines'           => (int) $r['lines'],
                'outstanding_qty' => round((float) $r['outstanding_qty'], 4),
                'overdue'         => (int) $r['overdue_docs'],
                'undated'         => (int) $r['undated_docs'],
            ];
        }

        // Totals over DISTINCT documents, because one document can hold several
        // kinds of pending line and adding the per-kind document counts would
        // count it twice.
        $totals = (clone $b)
            ->select(
                'COUNT(DISTINCT p.document_id) AS docs,'
                . ' COUNT(DISTINCT CASE WHEN d.expected_return_date IS NOT NULL'
                . '      AND d.expected_return_date < ' . $this->db->escape($date) . ' THEN p.document_id END) AS overdue_docs',
                false,
            )
            ->get();
        $totalRow = $totals === false ? [] : ($totals->getRowArray() ?: []);

        $rowsQuery = (clone $b)
            ->select(
                'p.document_id, d.document_no, d.document_type, d.document_date, d.posted_at, d.status,'
                . ' d.party_name, d.party_ref, d.from_warehouse_id, d.to_warehouse_id, d.expected_return_date,'
                . ' MIN(p.pending_kind) AS pending_kind, MIN(p.direction) AS direction,'
                . ' COUNT(*) AS lines, COALESCE(SUM(p.qty_original - p.qty_settled), 0) AS outstanding_qty',
                false,
            )
            ->groupBy('p.document_id, d.document_no, d.document_type, d.document_date, d.posted_at, d.status, d.party_name, d.party_ref, d.from_warehouse_id, d.to_warehouse_id, d.expected_return_date')
            // Undated documents sort last rather than first: NULL is not urgent.
            ->orderBy('d.expected_return_date', 'ASC', false)
            ->limit(self::PANEL_ROWS)
            ->get();

        $warehouseNames = $this->warehouseNames($cmpId);
        $rows = [];
        foreach ($rowsQuery === false ? [] : $rowsQuery->getResultArray() as $r) {
            $expected = $r['expected_return_date'];
            $fromId = $r['from_warehouse_id'] !== null ? (int) $r['from_warehouse_id'] : null;
            $toId = $r['to_warehouse_id'] !== null ? (int) $r['to_warehouse_id'] : null;
            $rows[] = [
                'document_id'          => (int) $r['document_id'],
                'document_no'          => $r['document_no'],
                'document_type'        => $r['document_type'],
                'document_type_label'  => DocumentTypeRegistry::get((string) $r['document_type'])['label'] ?? $r['document_type'],
                'document_date'        => $r['document_date'],
                'posted_at'            => $r['posted_at'],
                'status'               => $r['status'],
                'party_name'           => $r['party_name'],
                'pending_kind'         => $r['pending_kind'],
                'direction'            => $r['direction'],
                'from_warehouse_id'    => $fromId,
                'from_warehouse_name'  => $fromId !== null ? ($warehouseNames[$fromId] ?? null) : null,
                'to_warehouse_id'      => $toId,
                'to_warehouse_name'    => $toId !== null ? ($warehouseNames[$toId] ?? null) : null,
                'expected_return_date' => $expected,
                'lines'                => (int) $r['lines'],
                'outstanding_qty'      => round((float) $r['outstanding_qty'], 4),
                // Three distinct states, because "not overdue" and "no deadline
                // to be overdue against" are different things on a tracker.
                'timeliness'           => $expected === null ? 'undated' : ($expected < $date ? 'overdue' : 'on_time'),
            ];
        }

        return [
            'open_documents'    => (int) ($totalRow['docs'] ?? 0),
            'overdue_documents' => (int) ($totalRow['overdue_docs'] ?? 0),
            'by_kind'           => $byKind,
            'rows'              => $rows,
        ];
    }

    // -----------------------------------------------------------------------
    // Valuation
    // -----------------------------------------------------------------------

    /**
     * Dashboard 4 — the inventory value bridge.
     *
     *   opening + valued inward − valued outward ± adjustments = closing
     *
     * Every component is summed from `inv_stock_movements.value`, the signed
     * value the posting engine wrote when the stock actually moved, so the
     * bridge is the ledger's own arithmetic rather than a second opinion about
     * it. Because all four components come from ONE table in ONE pass, the
     * bridge closes by construction: `closing` is computed as
     * `opening + Σ movements`, never fetched from somewhere else and hoped to
     * agree.
     *
     * Two things are reported rather than buried:
     *
     *  - **Transfers.** At company scope a transfer's out and in cancel to zero,
     *    which is correct and also invisible; the gross figure is returned
     *    separately so a reader can see the internal movement they netted to
     *    nothing. Where a warehouse filter is applied the two legs do NOT
     *    cancel, and the residual is real.
     *  - **Unvalued movements.** Stock that moved with no value on it (migrated
     *    history, a receipt whose cost never landed) is counted, because it is
     *    the single most common reason a bridge looks wrong, and a bridge that
     *    hides it sends the reader hunting through the ledger.
     *
     * @return array<string, mixed>
     */
    public function valuationBridge(int $cmpId, int $fyId, int $boId, string $from, string $to, ?int $warehouseId = null): array
    {
        $opening = $this->movementValueTotals($cmpId, $fyId, $boId, null, $this->dayBefore($from), $warehouseId);
        $period = $this->movementValueTotals($cmpId, $fyId, $boId, $from, $to, $warehouseId);

        $openingValue = round($opening['net'], 4);

        $components = [];
        foreach ([
            DocumentTypeRegistry::FLOW_RECEIPT    => 'inward',
            DocumentTypeRegistry::FLOW_ISSUE      => 'outward',
            DocumentTypeRegistry::FLOW_TRANSFER   => 'transfer',
            DocumentTypeRegistry::FLOW_ADJUSTMENT => 'adjustment',
            DocumentTypeRegistry::FLOW_NONE       => 'other',
        ] as $flow => $key) {
            $components[$key] = [
                'net'        => round($period['by_flow'][$flow]['net'] ?? 0.0, 4),
                'gross_in'   => round($period['by_flow'][$flow]['in'] ?? 0.0, 4),
                'gross_out'  => round($period['by_flow'][$flow]['out'] ?? 0.0, 4),
                'movements'  => (int) ($period['by_flow'][$flow]['movements'] ?? 0),
            ];
        }

        $closingValue = round($openingValue + $period['net'], 4);

        return [
            'from'     => $from,
            'to'       => $to,
            'warehouse_id' => $warehouseId,
            'opening'  => self::metric($openingValue, 'Value of every posted stock movement up to the day before ' . $from . ', summed from the movement ledger.'),
            'closing'  => self::metric($closingValue, 'Opening value plus every valued movement in the period. Computed as the sum of the same ledger, so the bridge closes by construction.'),
            'components' => $components,
            'reversals'  => [
                'net'       => round($period['reversal_net'], 4),
                'movements' => $period['reversal_movements'],
            ],
            'revaluations' => [
                'net'       => round($period['revaluation_net'], 4),
                'movements' => $period['revaluation_movements'],
            ],
            'unvalued_movements' => $period['unvalued'],
            'definition' => 'opening + valued inward − valued outward ± adjustments = closing. Transfers net to zero at company scope; filtered to one warehouse they do not, and the residual is that warehouse\'s net internal movement.',
        ];
    }

    /**
     * Signed movement value over a date range, split by the document's flow class.
     *
     * `value` is signed by the posting engine (outward movements carry a negative
     * value), so the net is a plain SUM and needs no CASE on direction — which
     * also means a movement whose sign the engine chose is never re-signed here
     * on a second guess about what it meant.
     *
     * @return array<string, mixed>
     */
    private function movementValueTotals(int $cmpId, int $fyId, int $boId, ?string $from, string $to, ?int $warehouseId): array
    {
        $b = $this->db->table('inv_stock_movements m')
            ->where('m.cmp_id', $cmpId)
            ->where('m.movement_date <=', $to);
        // Opening reaches back through every financial year; the period itself is
        // bounded by the dates the caller asked for, not by the FY, so a range
        // that crosses a year end is summed correctly rather than truncated.
        if ($from !== null) {
            $b->where('m.movement_date >=', $from);
        }
        if ($boId > 0) {
            $b->where('m.bo_id', $boId);
        }
        if ($warehouseId !== null && $warehouseId > 0) {
            $b->where('m.warehouse_id', $warehouseId);
        }

        $rows = (clone $b)
            ->select(
                'm.document_type, m.movement_kind,'
                . ' COALESCE(SUM(m.value), 0) AS net,'
                . ' COALESCE(SUM(CASE WHEN m.value > 0 THEN m.value ELSE 0 END), 0) AS gross_in,'
                . ' COALESCE(SUM(CASE WHEN m.value < 0 THEN -m.value ELSE 0 END), 0) AS gross_out,'
                . ' COUNT(*) AS movements,'
                . ' SUM(CASE WHEN m.value IS NULL THEN 1 ELSE 0 END) AS unvalued',
                false,
            )
            ->groupBy('m.document_type, m.movement_kind')
            ->get();

        $out = [
            'net'                  => 0.0,
            'by_flow'              => [],
            'unvalued'             => 0,
            'reversal_net'         => 0.0,
            'reversal_movements'   => 0,
            'revaluation_net'      => 0.0,
            'revaluation_movements'=> 0,
        ];
        foreach ($rows === false ? [] : $rows->getResultArray() as $r) {
            $net = (float) $r['net'];
            $flow = DocumentTypeRegistry::flowClass((string) $r['document_type']);
            $kind = (string) $r['movement_kind'];
            $out['net'] += $net;
            $out['unvalued'] += (int) $r['unvalued'];
            $bucket = $out['by_flow'][$flow] ?? ['net' => 0.0, 'in' => 0.0, 'out' => 0.0, 'movements' => 0];
            $bucket['net'] += $net;
            $bucket['in'] += (float) $r['gross_in'];
            $bucket['out'] += (float) $r['gross_out'];
            $bucket['movements'] += (int) $r['movements'];
            $out['by_flow'][$flow] = $bucket;

            if ($kind === 'reversal') {
                $out['reversal_net'] += $net;
                $out['reversal_movements'] += (int) $r['movements'];
            } elseif ($kind === 'revaluation') {
                $out['revaluation_net'] += $net;
                $out['revaluation_movements'] += (int) $r['movements'];
            }
        }

        return $out;
    }

    // -----------------------------------------------------------------------
    // Replenishment demand
    // -----------------------------------------------------------------------

    /**
     * Dashboard 3 — observed demand for one item, and a deterministic projection.
     *
     * **Demand means consumption, not movement.** Only outward movements on
     * document types that take stock out of the company are counted: sales
     * issues, material issues, consumption, write-offs, purchase returns. Inter-
     * warehouse transfers are excluded, because moving stock from Delhi to Main
     * is not a customer buying it and counting it as demand double-counts the
     * same goods when they are finally sold. Adjustments are excluded for the
     * same reason: a count correction is not something anyone ordered.
     *
     * The projection is a trailing mean, and it is labelled as one. There is no
     * seasonality model here and no confidence percentage invented to look like
     * there is: `method` says `trailing_mean`, `history_days` says how much data
     * it is based on, and `sufficient_history` says whether that is enough to
     * mean anything. A screen that wants to say "Medium confidence" must derive
     * it from these, not from a number this method made up.
     *
     * @return array<string, mixed>
     */
    public function demand(int $cmpId, int $fyId, int $boId, int $itemId, ?int $warehouseId, string $asOf, int $historyDays, int $horizonDays): array
    {
        $issueTypes = DocumentTypeRegistry::typesInFlowClass(DocumentTypeRegistry::FLOW_ISSUE);
        $start = date('Y-m-d', strtotime($asOf . ' -' . ($historyDays - 1) . ' days'));

        $b = $this->db->table('inv_stock_movements m')
            ->where('m.cmp_id', $cmpId)
            ->where('m.item_id', $itemId)
            ->where('m.direction', 'out')
            ->where('m.movement_kind', 'physical')
            ->whereIn('m.document_type', $issueTypes)
            ->where('m.movement_date >=', $start)
            ->where('m.movement_date <=', $asOf);
        if ($boId > 0) {
            $b->where('m.bo_id', $boId);
        }
        if ($warehouseId !== null && $warehouseId > 0) {
            $b->where('m.warehouse_id', $warehouseId);
        }

        $rows = $b->select('m.movement_date AS d, COALESCE(SUM(ABS(m.qty)), 0) AS qty, COUNT(*) AS movements', false)
            ->groupBy('m.movement_date')
            ->orderBy('m.movement_date', 'ASC')
            ->get();

        $byDate = [];
        $movements = 0;
        foreach ($rows === false ? [] : $rows->getResultArray() as $r) {
            $byDate[(string) $r['d']] = round((float) $r['qty'], 4);
            $movements += (int) $r['movements'];
        }

        // Every day in the window, including the ones with no demand — a mean
        // taken only over days something moved is not a daily demand rate, it is
        // an average order size, and using one where the other belongs is how a
        // reorder quantity ends up several times too large.
        $series = [];
        $total = 0.0;
        $daysWithDemand = 0;
        for ($i = 0; $i < $historyDays; $i++) {
            $d = date('Y-m-d', strtotime($start . ' +' . $i . ' days'));
            $qty = $byDate[$d] ?? 0.0;
            $series[] = ['date' => $d, 'qty' => $qty];
            $total += $qty;
            if ($qty > 0) {
                $daysWithDemand++;
            }
        }

        $firstMovement = $this->firstMovementDate($cmpId, $itemId, $warehouseId, $boId, $issueTypes);
        $coveredDays = $firstMovement === null
            ? 0
            : min($historyDays, (int) floor((strtotime($asOf) - strtotime(max($firstMovement, $start))) / 86400) + 1);

        $dailyMean = $historyDays > 0 ? $total / $historyDays : 0.0;

        return [
            'item_id'            => $itemId,
            'warehouse_id'       => $warehouseId,
            'as_of'              => $asOf,
            'history_days'       => $historyDays,
            'horizon_days'       => $horizonDays,
            'series'             => $series,
            'total_qty'          => round($total, 4),
            'days_with_demand'   => $daysWithDemand,
            'movements'          => $movements,
            'daily_mean'         => round($dailyMean, 4),
            'method'             => 'trailing_mean',
            'first_demand_date'  => $firstMovement,
            'covered_days'       => $coveredDays,
            // "Enough history" is a judgement, so it is stated as one with its
            // rule attached rather than smuggled out as a confidence score.
            'sufficient_history' => $coveredDays >= 30 && $daysWithDemand >= 3,
            'sufficiency_rule'   => 'At least 30 days of movement history and demand on at least 3 separate days.',
            'demand_basis'       => 'Outward movements on issue-type documents (' . implode(', ', $issueTypes) . '). Inter-warehouse transfers and adjustments are excluded.',
        ];
    }

    /** When this item first moved out — how much history there really is. */
    private function firstMovementDate(int $cmpId, int $itemId, ?int $warehouseId, int $boId, array $issueTypes): ?string
    {
        $b = $this->db->table('inv_stock_movements')
            ->where('cmp_id', $cmpId)
            ->where('item_id', $itemId)
            ->where('direction', 'out')
            ->where('movement_kind', 'physical')
            ->whereIn('document_type', $issueTypes);
        if ($boId > 0) {
            $b->where('bo_id', $boId);
        }
        if ($warehouseId !== null && $warehouseId > 0) {
            $b->where('warehouse_id', $warehouseId);
        }
        $row = $b->select('MIN(movement_date) AS d', false)->get();
        if ($row === false) {
            return null;
        }
        $d = ($row->getRowArray() ?: [])['d'] ?? null;

        return $d === null ? null : (string) $d;
    }

    // -----------------------------------------------------------------------
    // Controls
    // -----------------------------------------------------------------------

    /**
     * Dashboard 5 — the exception register and delivery health.
     *
     * The exception register is deliberately a LIST OF ISSUE KINDS with counts,
     * not a count of items. One item can be negative, uncosted and expired at
     * once; calling that "3 unique items" is wrong and calling it "3 issues" is
     * right, so the payload says `issues` everywhere and the screen has no
     * chance to mislabel it.
     *
     * @return array<string, mixed>
     */
    public function controls(int $cmpId, int $fyId, int $boId): array
    {
        $balances = new StockBalanceService();
        $negative = $balances->negativeStockCounts($cmpId, $boId);
        $missingCost = $this->missingCostRows($cmpId, $boId);
        $variances = $this->countVariances($cmpId, $fyId, $boId);
        $statusCounts = $this->openDocumentStatusCounts($cmpId, $fyId, $boId);
        $delivery = $this->deliveryHealth($cmpId);

        $exceptions = [
            [
                'key'      => 'negative_stock',
                'label'    => 'Negative stock',
                'severity' => 'high',
                'issues'   => $negative['rows'],
                'scope'    => 'balance rows',
                'detail'   => $negative['items'] . ' items are net below zero once a branch\'s warehouses offset each other',
                'path'     => '/registers/stock-balances?negative=1&sort=on_hand_qty&order=asc',
            ],
            [
                'key'      => 'missing_cost',
                'label'    => 'Missing cost',
                'severity' => 'high',
                'issues'   => $missingCost,
                'scope'    => 'balance rows',
                'detail'   => 'Stock on hand with no unit cost — every issue out of it falls back to a guessed cost',
                'path'     => '/registers/valuation',
            ],
            [
                'key'      => 'failed_posting',
                'label'    => 'Failed postings',
                'severity' => 'high',
                'issues'   => $statusCounts['FAILED'],
                'scope'    => 'documents',
                'detail'   => 'Documents whose posting failed — stock did not move',
                'path'     => '/documents?status=FAILED',
            ],
            [
                'key'      => 'count_variance',
                'label'    => 'Count variances',
                'severity' => 'medium',
                'issues'   => $variances['variance_lines'],
                'scope'    => 'lines',
                'detail'   => $variances['variance_documents'] . ' unposted physical counts hold a line that disagrees with the system quantity',
                'path'     => '/documents?document_type=PHYSICAL_ADJUSTMENT&status=DRAFT,PENDING_APPROVAL,APPROVED',
            ],
            [
                'key'      => 'books_delivery',
                'label'    => 'Books delivery',
                'severity' => 'medium',
                'issues'   => $delivery['pending'] + $delivery['failed'],
                'scope'    => 'events',
                'detail'   => 'Inventory events queued or failed on their way to Books',
                'path'     => '/integration/outbox',
            ],
            [
                'key'      => 'unacknowledged_revisions',
                'label'    => 'Unacknowledged valuation revisions',
                'severity' => 'medium',
                'issues'   => $delivery['unacknowledged_revisions'],
                'scope'    => 'revisions',
                'detail'   => 'Cost revisions Books has not confirmed it journalled',
                'path'     => '/valuation/revisions?acknowledged=0',
            ],
        ];

        $open = array_values(array_filter($exceptions, static fn ($e) => $e['issues'] > 0));

        return [
            'exceptions' => $exceptions,
            'open_exception_kinds' => count($open),
            'open_exception_issues' => array_sum(array_column($open, 'issues')),
            'exception_counting_rule' => 'An exception KIND is open when it has at least one issue. Issues are counted in the unit named by each row (rows, documents, lines, events) and are never added across kinds into a single "items" figure, because one item can raise several.',
            'delivery' => $delivery,
            'approvals' => [
                'pending' => $statusCounts['PENDING_APPROVAL'],
                'approved_not_posted' => $statusCounts['APPROVED'],
            ],
        ];
    }

    /** Balance rows carrying stock that has no cost against it. */
    private function missingCostRows(int $cmpId, int $boId): int
    {
        // Warehouse-scoped rather than branch-scoped: inv_stock_balances carries
        // no bo_id, so a branch filter has to reach the branch through the
        // warehouse master, which is where the branch actually lives.
        $b = $this->db->table('inv_stock_balances b')
            ->where('b.cmp_id', $cmpId)
            ->where('b.on_hand_qty >', 0)
            ->where(
                'NOT EXISTS (SELECT 1 FROM inv_cost_layers cl WHERE cl.cmp_id = b.cmp_id'
                . ' AND cl.item_id = b.item_id AND cl.qty_remaining > 0 AND cl.unit_cost <> 0)',
                null,
                false,
            );
        if ($boId > 0) {
            // Same rule the negative-stock scan uses: a warehouse at bo_id 0 is
            // company-wide and belongs to every branch, and a balance row with no
            // warehouse at all is company-scoped. Narrowing to `bo_id = $boId`
            // alone would drop both and under-report the exception.
            $b->where(
                '(b.warehouse_id IS NULL OR b.warehouse_id IN ('
                . 'SELECT warehouse_id FROM inv_warehouses WHERE cmp_id = ' . (int) $cmpId
                . ' AND (bo_id = 0 OR bo_id = ' . (int) $boId . ')))',
                null,
                false,
            );
        }

        return $b->countAllResults();
    }

    /**
     * Books delivery health.
     *
     * `last_delivered_at` is the last time an event was actually ACKED by Books,
     * not the last time one was attempted — a queue that has been retrying and
     * failing for six hours must not read as healthy because it was busy.
     *
     * @return array<string, mixed>
     */
    private function deliveryHealth(int $cmpId): array
    {
        $counts = ['PENDING' => 0, 'SENT' => 0, 'ACKED' => 0, 'FAILED' => 0, 'DEAD' => 0];
        $rows = $this->db->table('inv_integration_events')
            ->select('status, COUNT(*) AS cnt', false)
            ->where('cmp_id', $cmpId)
            ->groupBy('status')
            ->get();
        foreach ($rows === false ? [] : $rows->getResultArray() as $r) {
            $counts[(string) $r['status']] = (int) $r['cnt'];
        }

        $last = $this->db->table('inv_integration_events')
            ->select('MAX(acked_at) AS t', false)
            ->where('cmp_id', $cmpId)
            ->where('status', 'ACKED')
            ->get();
        $lastDelivered = $last === false ? null : (($last->getRowArray() ?: [])['t'] ?? null);

        $rev = $this->db->table('inv_valuation_revisions')
            ->select('COUNT(*) AS cnt', false)
            ->where('cmp_id', $cmpId)
            ->where('acknowledged_at', null)
            ->get();
        $revisions = $rev === false ? 0 : (int) (($rev->getRowArray() ?: [])['cnt'] ?? 0);

        return [
            'by_status'                => $counts,
            'pending'                  => $counts['PENDING'] + $counts['SENT'],
            'failed'                   => $counts['FAILED'] + $counts['DEAD'],
            'delivered'                => $counts['ACKED'],
            'last_delivered_at'        => $lastDelivered,
            'unacknowledged_revisions' => $revisions,
        ];
    }

    // -----------------------------------------------------------------------
    // Shared
    // -----------------------------------------------------------------------

    /** A documents query already narrowed to the caller's company, FY and branch. */
    private function scopedDocuments(int $cmpId, int $fyId, int $boId, string $alias = ''): \CodeIgniter\Database\BaseBuilder
    {
        $table = $alias === '' ? 'inv_documents' : 'inv_documents ' . $alias;
        $prefix = $alias === '' ? '' : $alias . '.';
        $b = $this->db->table($table)
            ->where($prefix . 'cmp_id', $cmpId)
            ->where($prefix . 'fy_id', $fyId);
        if ($boId > 0) {
            $b->where($prefix . 'bo_id', $boId);
        }

        return $b;
    }

    /** @return array<int, string> warehouse_id => name */
    private function warehouseNames(int $cmpId): array
    {
        $rows = $this->db->table('inv_warehouses')
            ->select('warehouse_id, warehouse_name', false)
            ->where('cmp_id', $cmpId)
            ->where('deleted_at', null)
            ->get();
        $out = [];
        foreach ($rows === false ? [] : $rows->getResultArray() as $r) {
            $out[(int) $r['warehouse_id']] = (string) $r['warehouse_name'];
        }

        return $out;
    }

    /** The day before an ISO date — where an opening balance is measured. */
    public static function dayBefore(string $date): string
    {
        return date('Y-m-d', strtotime($date . ' -1 day'));
    }
}
