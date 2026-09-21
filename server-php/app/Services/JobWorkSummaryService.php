<?php

namespace App\Services;

/**
 * The figures above the job-work entry screens.
 *
 * Job work is the one inventory workflow whose state lives in two places at
 * once: what is still out with a job worker (inv_pending_quantities, opened by
 * a JOB_WORK_OUT and closed by a JOB_WORK_IN) and what has moved this period
 * (inv_document_lines of the posted documents). An operator keying a receipt
 * needs both — how much is outstanding, how much is already back, how long the
 * round trip is running — and neither is answerable from the form itself.
 *
 * Every figure here is one aggregate over an indexed set:
 *
 *   inv_pending_quantities   idx_inv_pending_cmp_open, idx_inv_pending_party
 *   inv_document_lines       idx_inv_document_lines_doc
 *   inv_pending_settlements  idx_inv_pending_settlements_pending
 *
 * Nothing walks the stock ledger and nothing is valued here: the amounts are
 * the ones already written onto the lines when the documents posted
 * (valuation_amount for a receipt, the challan value for a dispatch), so the
 * strip can never disagree with the document behind it.
 *
 * The open position is deliberately NOT scoped by financial year, for the same
 * reason PendingQuantityService::listOpen is not: goods sent to a job worker in
 * February are still out in April, and dropping them at the year boundary would
 * understate every open challan and ITC-04 alike. The period figures ARE scoped
 * — they are "this month", and the month is clipped to the selected year so the
 * caption cannot contradict the year the user is browsing.
 */
class JobWorkSummaryService
{
    /** Statuses whose lines have actually moved stock. */
    private const POSTED = ['POSTED', 'PARTIALLY_FULFILLED', 'COMPLETED'];

    private \CodeIgniter\Database\BaseConnection $db;

    public function __construct(?\CodeIgniter\Database\BaseConnection $db = null)
    {
        $this->db = $db ?? \Config\Database::connect();
    }

    /**
     * The calendar month `$asOn` falls in, up to `$asOn` itself, clipped to the
     * financial year. Identical in intent to RegisterSummaryService::movementWindow
     * — a month that reaches outside the selected year would count documents the
     * screen's own year filter excludes.
     *
     * @return array{from: string, to: string}
     */
    public static function monthWindow(string $asOn, ?string $fyStart, ?string $fyEnd): array
    {
        $from = date('Y-m-01', strtotime($asOn));
        $to = $asOn;
        if ($fyStart !== null && $fyStart !== '' && $from < $fyStart) {
            $from = $fyStart;
        }
        if ($fyEnd !== null && $fyEnd !== '' && $to > $fyEnd) {
            $to = $fyEnd;
        }
        if ($from > $to) {
            $from = $to;
        }

        return ['from' => $from, 'to' => $to];
    }

    /**
     * The same window one month earlier — the comparative behind every delta
     * chip. It runs to the same day of the month, so a strip read on the 8th
     * compares eight days with eight days rather than eight with thirty-one.
     *
     * @return array{from: string, to: string}
     */
    public static function previousWindow(string $asOn, ?string $fyStart, ?string $fyEnd): array
    {
        $firstOfMonth = date('Y-m-01', strtotime($asOn));
        $from = date('Y-m-01', strtotime($firstOfMonth . ' -1 month'));
        $daysIn = (int) date('t', strtotime($from));
        $day = min((int) date('j', strtotime($asOn)), $daysIn);
        $to = date('Y-m-', strtotime($from)) . str_pad((string) $day, 2, '0', STR_PAD_LEFT);
        if ($fyStart !== null && $fyStart !== '' && $from < $fyStart) {
            $from = $fyStart;
        }
        if ($fyEnd !== null && $fyEnd !== '' && $to > $fyEnd) {
            $to = $fyEnd;
        }
        if ($from > $to) {
            return ['from' => $from, 'to' => $from];
        }

        return ['from' => $from, 'to' => $to];
    }

    /**
     * Everything the strip shows, for both directions at once — the mode switch
     * flips between inward and outward without a second round trip.
     *
     * @return array<string, mixed>
     */
    public function summary(int $cmpId, int $fyId, int $boId, string $today): array
    {
        $fy = (new RegisterSummaryService($this->db))->fyRange($cmpId, $fyId);
        $asOn = RegisterSummaryService::asOnDate($today, $fy['start'], $fy['end']);
        $window = self::monthWindow($asOn, $fy['start'], $fy['end']);
        $previous = self::previousWindow($asOn, $fy['start'], $fy['end']);

        return [
            'as_on'           => $asOn,
            'window'          => $window,
            'previous_window' => $previous,
            'open'            => $this->openPosition($cmpId, $boId, null),
            'due'             => $this->openPosition($cmpId, $boId, ['due', $asOn]),
            'overdue'         => $this->openPosition($cmpId, $boId, ['overdue', $asOn]),
            'received'        => $this->movement($cmpId, $boId, 'JOB_WORK_IN', $window),
            'received_previous' => $this->movement($cmpId, $boId, 'JOB_WORK_IN', $previous),
            'sent'            => $this->movement($cmpId, $boId, 'JOB_WORK_OUT', $window),
            'sent_previous'   => $this->movement($cmpId, $boId, 'JOB_WORK_OUT', $previous),
            'turnaround'      => $this->turnaround($cmpId, $boId, $window),
            'turnaround_previous' => $this->turnaround($cmpId, $boId, $previous),
        ];
    }

    /**
     * The job workers this company has actually sent material to, most recently
     * active first, with what each of them is still holding.
     *
     * Read entirely from Inventory's own documents. A job worker IS a Books
     * ledger and Books owns that master — nothing here copies, mirrors or
     * caches it. What these rows carry is the snapshot Inventory already wrote
     * onto its own dispatch when it posted (party_ref, party_name), which is
     * the same thing the document register and every pending row already show.
     * Picking one fills the ledger id on the form; the ledger itself is opened
     * in Books, live, through the link beside the field.
     *
     * The selector therefore never downloads a master and never re-enters Books
     * on a keystroke — see docs/CROSS_SERVICE_CALL_RULES.md, where a
     * synchronous read that leaves the app is what took production down.
     *
     * @return list<array<string, mixed>>
     */
    public function workers(int $cmpId, int $boId, string $q, int $limit = 20): array
    {
        $b = $this->db->table('inv_documents d')
            ->select("d.party_ref, MAX(NULLIF(d.party_name, '')) AS party_name, COUNT(*) AS documents, MAX(CASE WHEN d.document_type = 'JOB_WORK_OUT' THEN d.document_date END) AS last_sent_on, MAX(CASE WHEN d.document_type = 'JOB_WORK_IN' THEN d.document_date END) AS last_received_on, MAX(d.document_date) AS last_document_date", false)
            ->whereIn('d.document_type', ['JOB_WORK_OUT', 'JOB_WORK_IN'])
            ->where('d.cmp_id', $cmpId)
            ->where('d.party_ref IS NOT NULL', null, false)
            ->groupBy('d.party_ref')
            ->orderBy('MAX(d.document_date)', 'DESC', false)
            ->limit(max(1, min($limit, 50)));
        if ($boId > 0) {
            $b->where('d.bo_id', $boId);
        }
        $q = trim($q);
        if ($q !== '') {
            $b->groupStart()->like('d.party_name', $q);
            if (ctype_digit($q)) {
                $b->orWhere('d.party_ref', (int) $q);
            }
            $b->groupEnd();
        }
        $rows = $b->get()->getResultArray();
        if ($rows === []) {
            return [];
        }

        $refs = array_map(static fn ($r) => (int) $r['party_ref'], $rows);
        $openBuilder = $this->db->table('inv_pending_quantities p')
            ->select('p.party_ref, COALESCE(SUM(p.qty_original - p.qty_settled), 0) AS open_qty, COUNT(DISTINCT p.document_id) AS open_orders', false)
            ->join('inv_documents d', 'd.document_id = p.document_id', 'inner')
            ->where('p.cmp_id', $cmpId)
            ->where('p.pending_kind', 'job_work')
            ->where('p.direction', 'out')
            ->whereIn('p.status', ['open', 'partial'])
            ->whereIn('p.party_ref', $refs)
            ->groupBy('p.party_ref');
        if ($boId > 0) {
            $openBuilder->where('d.bo_id', $boId);
        }
        $open = [];
        foreach ($openBuilder->get()->getResultArray() as $o) {
            $open[(int) $o['party_ref']] = [
                'open_qty'    => round((float) $o['open_qty'], 4),
                'open_orders' => (int) $o['open_orders'],
            ];
        }

        $out = [];
        foreach ($rows as $r) {
            $ref = (int) $r['party_ref'];
            $out[] = [
                'party_ref'          => $ref,
                'party_name'         => $r['party_name'] !== null ? (string) $r['party_name'] : null,
                'documents'          => (int) $r['documents'],
                'last_sent_on'       => $r['last_sent_on'] ? substr((string) $r['last_sent_on'], 0, 10) : null,
                'last_received_on'   => $r['last_received_on'] ? substr((string) $r['last_received_on'], 0, 10) : null,
                'last_document_date' => $r['last_document_date'] ? substr((string) $r['last_document_date'], 0, 10) : null,
                'open_qty'           => $open[$ref]['open_qty'] ?? 0.0,
                'open_orders'        => $open[$ref]['open_orders'] ?? 0,
            ];
        }

        // Someone still holding material comes first: that is who a receipt is
        // almost always for. Within each half, most recently dealt with wins.
        usort($out, static function ($x, $y) {
            $holding = ($y['open_qty'] > 0 ? 1 : 0) <=> ($x['open_qty'] > 0 ? 1 : 0);

            return $holding !== 0 ? $holding : strcmp((string) $y['last_document_date'], (string) $x['last_document_date']);
        });

        return $out;
    }

    /**
     * What is still with job workers: quantity, how many outward documents it
     * sits on, how many distinct items and how many workers hold it.
     *
     * `$filter` narrows by the promised return date — ['due', $asOn] is what
     * should already be back, ['overdue', $asOn] what is late. A dispatch with
     * no expected return date is in neither: nothing promised it, so nothing
     * can call it late.
     *
     * @param array{0: string, 1: string}|null $filter
     * @return array{qty: float, orders: int, items: int, workers: int}
     */
    private function openPosition(int $cmpId, int $boId, ?array $filter): array
    {
        $b = $this->db->table('inv_pending_quantities p')
            ->select('COALESCE(SUM(p.qty_original - p.qty_settled), 0) AS qty, COUNT(DISTINCT p.document_id) AS orders, COUNT(DISTINCT p.item_id) AS items, COUNT(DISTINCT p.party_ref) AS workers', false)
            ->join('inv_documents d', 'd.document_id = p.document_id', 'inner')
            ->where('p.cmp_id', $cmpId)
            ->where('p.pending_kind', 'job_work')
            ->where('p.direction', 'out')
            ->whereIn('p.status', ['open', 'partial']);
        if ($boId > 0) {
            $b->where('d.bo_id', $boId);
        }
        if ($filter !== null) {
            $b->where('d.expected_return_date IS NOT NULL', null, false);
            $b->where($filter[0] === 'overdue' ? 'd.expected_return_date <' : 'd.expected_return_date <=', $filter[1]);
        }
        $row = $b->get()->getRowArray() ?: [];

        return [
            'qty'     => round((float) ($row['qty'] ?? 0), 4),
            'orders'  => (int) ($row['orders'] ?? 0),
            'items'   => (int) ($row['items'] ?? 0),
            'workers' => (int) ($row['workers'] ?? 0),
        ];
    }

    /**
     * What moved in the window on posted documents of one job-work type.
     *
     * A receipt's value is its valuation_amount — what the goods coming back
     * cost, which is the figure closing stock carries. A dispatch has no
     * valuation at all (the stock never leaves the principal's ownership), so
     * its value is the commercial one written on the challan, which is also
     * what Table 4 of FORM GST ITC-04 declares. They are different numbers and
     * the caller labels them differently; neither is ever computed here.
     *
     * @param array{from: string, to: string} $window
     * @return array{qty: float, value: float, documents: int, lines: int}
     */
    private function movement(int $cmpId, int $boId, string $type, array $window): array
    {
        $inward = $type === 'JOB_WORK_IN';
        $value = $inward ? 'COALESCE(SUM(l.valuation_amount), 0)' : 'COALESCE(SUM(l.source_transaction_amount), 0)';
        $b = $this->db->table('inv_document_lines l')
            ->select('COALESCE(SUM(l.base_qty), 0) AS qty, ' . $value . ' AS value, COUNT(DISTINCT l.document_id) AS documents, COUNT(*) AS lines', false)
            ->join('inv_documents d', 'd.document_id = l.document_id', 'inner')
            ->where('d.cmp_id', $cmpId)
            ->where('d.document_type', $type)
            ->whereIn('d.status', self::POSTED)
            ->where('d.document_date >=', $window['from'])
            ->where('d.document_date <=', $window['to'])
            // Inward: only the goods coming back. The out lines on the same
            // document are the material the job worker consumed, and counting
            // those as "received" would report the same job twice.
            ->where('l.direction', $inward ? 'in' : 'out');
        if ($boId > 0) {
            $b->where('d.bo_id', $boId);
        }
        $row = $b->get()->getRowArray() ?: [];

        return [
            'qty'       => round((float) ($row['qty'] ?? 0), 4),
            'value'     => round((float) ($row['value'] ?? 0), 2),
            'documents' => (int) ($row['documents'] ?? 0),
            'lines'     => (int) ($row['lines'] ?? 0),
        ];
    }

    /**
     * Average days from dispatch to settlement, over the settlements recorded
     * in the window.
     *
     * Measured between the two DOCUMENT dates, not between timestamps: a
     * receipt keyed a week late for goods that came back on the 3rd took as
     * long as the challan says it took, and `created_at` would report the
     * data-entry delay instead. `samples` is published so a caller can decline
     * to draw a conclusion from two round trips.
     *
     * @param array{from: string, to: string} $window
     * @return array{days: float|null, samples: int}
     */
    private function turnaround(int $cmpId, int $boId, array $window): array
    {
        $b = $this->db->table('inv_pending_settlements s')
            ->select('AVG(sd.document_date - d.document_date) AS days, COUNT(*) AS samples', false)
            ->join('inv_pending_quantities p', 'p.pending_id = s.pending_id', 'inner')
            ->join('inv_documents d', 'd.document_id = p.document_id', 'inner')
            ->join('inv_documents sd', 'sd.document_id = s.settle_document_id', 'inner')
            ->where('s.cmp_id', $cmpId)
            ->where('p.pending_kind', 'job_work')
            ->where('p.direction', 'out')
            ->whereIn('sd.status', self::POSTED)
            ->where('sd.document_date >=', $window['from'])
            ->where('sd.document_date <=', $window['to']);
        if ($boId > 0) {
            $b->where('d.bo_id', $boId);
        }
        $row = $b->get()->getRowArray() ?: [];
        $samples = (int) ($row['samples'] ?? 0);

        return [
            'days'    => $samples > 0 && $row['days'] !== null ? round((float) $row['days'], 1) : null,
            'samples' => $samples,
        ];
    }
}
