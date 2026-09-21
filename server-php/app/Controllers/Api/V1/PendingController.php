<?php

namespace App\Controllers\Api\V1;

use App\Controllers\Api\BaseController;
use App\Services\PendingRegisterPolicy;
use App\Services\PendingRegisterQuery;

/**
 * /api/v1/pending-quantities — the pending-quantity register: goods out on delivery
 * challan, in on inward challan, with a job worker, or invoiced-but-not-received
 * (deferred purchase).
 *
 * Every filter, every sort and every total is resolved in SQL by
 * PendingRegisterQuery — the endpoint reads one page of rows and a handful of
 * aggregates, never the whole table. Rows carry qty_open = qty_original -
 * qty_settled plus the derived fields the register is read by: ageing, due date,
 * pending value at cost, display status and priority (see PendingRegisterPolicy
 * for the rules and where a company changes them).
 *
 * `summary` is over the WHOLE filtered set, not the page. `previous` is the same
 * figures reconstructed at a past date so the KPI cards can show a real delta; it
 * is null when it cannot be computed, and the cards then show no delta at all
 * rather than a manufactured one.
 */
class PendingController extends BaseController
{
    /** Blocks that cost an extra aggregate, asked for by name. */
    private const INCLUDES = ['summary', 'previous', 'trend', 'breakdowns'];

    public function index()
    {
        $a = $this->authorize('documents.read');
        if (isset($a['response'])) {
            return $a['response'];
        }
        $cmpId = (int) $a['ctx']['cmp_id'];
        $boId = (int) $a['ctx']['bo_id'];

        $get = $this->request->getGet();

        // Validate the two enumerated filters loudly. Everything else normalises
        // silently: a stray ageing bucket is a typo in a bookmark, but a kind the
        // table does not store is a caller asking the wrong question.
        $kind = strtolower(trim((string) ($get['kind'] ?? '')));
        if ($kind !== '' && !in_array($kind, PendingRegisterQuery::KINDS, true)) {
            return $this->failStructured(400, 'validation_failed', 'kind must be one of ' . implode(', ', PendingRegisterQuery::KINDS), ['allowed' => PendingRegisterQuery::KINDS]);
        }
        $direction = strtolower(trim((string) ($get['direction'] ?? '')));
        if ($direction !== '' && !in_array($direction, ['in', 'out'], true)) {
            return $this->failStructured(400, 'validation_failed', 'direction must be in or out');
        }

        $p = $this->listParams(100, 1000, 'document_date');
        $filters = PendingRegisterQuery::normaliseFilters(is_array($get) ? $get : []);
        $query = new PendingRegisterQuery($cmpId, $boId);

        $page = $query->page($filters, $p['sort'], $p['order'], $p['limit'], $p['offset']);

        $include = $this->includes($get);
        $extra = [];

        if (in_array('summary', $include, true)) {
            $summary = $query->summary($filters);
            $today = date('Y-m-d');
            $settledToday = $query->settledOn($filters, $today);
            $summary['settled_today'] = $settledToday['lines'];
            $summary['settled_today_qty'] = $settledToday['quantity'];
            // Kept for the callers that read the old envelope — the previous shape
            // was {qty_open, rows} and both still mean what they meant.
            $summary['qty_open'] = $summary['open_quantity'];
            $summary['rows'] = $summary['open_lines'];
            $extra['summary'] = $summary;

            if (in_array('previous', $include, true)) {
                $extra['previous'] = $this->previous($query, $filters, $today);
            }
        }

        if (in_array('trend', $include, true)) {
            $extra['trend'] = $query->trend($filters);
        }
        if (in_array('breakdowns', $include, true)) {
            $extra['breakdowns'] = $query->breakdowns($filters);
        }

        // Only worth asking when the answer changes what the reader is told: an
        // empty register because nothing is pending is a different screen from an
        // empty register because a filter is too tight.
        if ($page['total'] === 0) {
            $extra['unfiltered_empty'] = !$query->hasAnyRows();
        }

        $extra['policy'] = (new PendingRegisterPolicy())->forCompany($cmpId);

        return $this->respondList($page['rows'], $page['total'], $p['limit'], $p['offset'], $extra);
    }

    /**
     * Which optional blocks to compute.
     *
     * Default (no `include` at all) is everything but the breakdowns, so an older
     * caller keeps the envelope it already reads.
     *
     * Any value not in INCLUDES is ignored, so `include=none` asks for NOTHING. That
     * is what the export pager sends while it walks page after page: re-running five
     * aggregates per page, for figures the caller computed once and already holds, is
     * the one thing a paged export must not do. A literal empty `include=` would say
     * the same, but the web client drops empty parameters before they reach the wire,
     * so the sentinel has to be a word.
     *
     * @param array<string, mixed>|null $get
     * @return list<string>
     */
    private function includes(?array $get): array
    {
        if (!is_array($get) || !array_key_exists('include', $get)) {
            return ['summary', 'previous', 'trend'];
        }
        $raw = $get['include'];
        $parts = is_array($raw) ? $raw : explode(',', (string) $raw);
        $out = [];
        foreach ($parts as $one) {
            $one = strtolower(trim((string) $one));
            if ($one !== '' && in_array($one, self::INCLUDES, true) && !in_array($one, $out, true)) {
                $out[] = $one;
            }
        }

        return $out;
    }

    /**
     * The comparison figures the KPI deltas are drawn from.
     *
     * "Settled today" is compared with yesterday because a daily count has no
     * meaningful monthly counterpart; everything else is compared with the same
     * register one month back. Both are measured, not modelled — see
     * PendingRegisterQuery::summaryAsOf. A null here means the cards show their
     * hint line and no percentage.
     *
     * @param array<string, mixed> $filters
     * @return array<string, float|int>|null
     */
    private function previous(PendingRegisterQuery $query, array $filters, string $today): ?array
    {
        $monthAgo = date('Y-m-d', strtotime($today . ' -1 month'));
        $asOf = $query->summaryAsOf($filters, $monthAgo);
        if ($asOf === null) {
            return null;
        }
        $yesterday = date('Y-m-d', strtotime($today . ' -1 day'));
        $asOf['settled_today'] = $query->settledOn($filters, $yesterday)['lines'];
        $asOf['as_of'] = $monthAgo;
        $asOf['settled_as_of'] = $yesterday;

        return $asOf;
    }

    /**
     * GET /pending-quantities/{id} — one pending row (any status) with its settlement
     * trail: every inv_pending_settlements row joined with the document that settled
     * it, plus the derived fields the register shows, so the detail drawer and the
     * table row cannot disagree about a line's ageing or its priority.
     */
    public function show($id = null)
    {
        $a = $this->authorize('documents.read');
        if (isset($a['response'])) {
            return $a['response'];
        }
        $cmpId = (int) $a['ctx']['cmp_id'];
        $pendingId = (int) $id;
        if ($pendingId <= 0) {
            return $this->failStructured(400, 'validation_failed', 'pending id is required');
        }

        // Read through the register's own query so every derived field is computed by
        // the one piece of SQL that computes it for the table. `status: []` lifts the
        // open-only restriction: a settled or cancelled line still has a history, and
        // a drawer that 404'd on it would break the link it was opened from.
        $query = new PendingRegisterQuery($cmpId, 0);
        $page = $query->page(
            PendingRegisterQuery::normaliseFilters([
                'pending_id' => $pendingId,
                'status'     => PendingRegisterQuery::STATUSES,
            ]),
            'document_date',
            'asc',
            1,
            0,
        );

        $row = $page['rows'][0] ?? $this->legacyRow($cmpId, $pendingId);
        if ($row === null) {
            return $this->failStructured(404, 'not_found', 'Pending quantity not found');
        }

        $row['settlements'] = $this->settlements($cmpId, $pendingId);
        $row['policy'] = (new PendingRegisterPolicy())->forCompany($cmpId);

        return $this->respond(['data' => $row]);
    }

    /**
     * The plain row, for the one case the register query cannot answer: a pending
     * line whose document was deleted outright rather than reversed. The register
     * inner-joins the document because a line without one has no date, no branch and
     * no party; the drawer still shows what there is.
     *
     * @return array<string, mixed>|null
     */
    private function legacyRow(int $cmpId, int $pendingId): ?array
    {
        $db = \Config\Database::connect();
        $row = $db->table('inv_pending_quantities p')
            ->select('p.*, i.item_name, i.item_sku, u.unit_symbol, w.warehouse_name, (p.qty_original - p.qty_settled) AS qty_open', false)
            ->join('inv_items i', 'i.item_id = p.item_id', 'left')
            ->join('inv_uom u', 'u.unit_id = p.unit_id', 'left')
            ->join('inv_warehouses w', 'w.warehouse_id = p.warehouse_id', 'left')
            ->where('p.cmp_id', $cmpId)->where('p.pending_id', $pendingId)
            ->get()->getRowArray();
        if (!$row) {
            return null;
        }
        foreach (['qty_original', 'qty_settled', 'qty_open'] as $k) {
            $row[$k] = round((float) ($row[$k] ?? 0), 4);
        }
        foreach (['pending_id', 'cmp_id', 'fy_id', 'document_id', 'line_id', 'item_id', 'unit_id', 'warehouse_id', 'party_ref'] as $k) {
            if (array_key_exists($k, $row) && $row[$k] !== null) {
                $row[$k] = (int) $row[$k];
            }
        }
        $row['settlement_status'] = $row['status'];
        $row['document_type_label'] = null;

        return $row;
    }

    /** @return list<array<string, mixed>> */
    private function settlements(int $cmpId, int $pendingId): array
    {
        $settlements = \Config\Database::connect()->table('inv_pending_settlements s')
            ->select('s.settlement_id, s.settle_document_id, s.settle_line_id, s.settlement_type, s.qty_settled, s.created_at, d.document_no, d.document_type, d.document_date, d.status AS document_status, d.source_app, d.source_document_no')
            ->join('inv_documents d', 'd.document_id = s.settle_document_id', 'left')
            ->where('s.cmp_id', $cmpId)->where('s.pending_id', $pendingId)
            ->orderBy('s.created_at', 'ASC')->orderBy('s.settlement_id', 'ASC')
            ->get()->getResultArray();
        foreach ($settlements as &$s) {
            foreach (['settlement_id', 'settle_document_id', 'settle_line_id'] as $k) {
                $s[$k] = $s[$k] === null ? null : (int) $s[$k];
            }
            $s['qty_settled'] = round((float) $s['qty_settled'], 4);
            $s['document_type_label'] = $s['document_type'] !== null ? (\Config\DocumentTypeRegistry::get((string) $s['document_type'])['label'] ?? $s['document_type']) : null;
        }
        unset($s);

        return $settlements;
    }
}
