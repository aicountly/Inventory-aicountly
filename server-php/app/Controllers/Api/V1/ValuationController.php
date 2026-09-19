<?php

namespace App\Controllers\Api\V1;

use App\Controllers\Api\BaseController;
use App\Services\FyCarryForwardService;
use App\Services\FyCarryForwardStatus;
use App\Services\InventorySettingsService;
use App\Services\ManageContextService;
use App\Services\RecalculationService;
use App\Services\ValuationReplayService;

/**
 * /api/v1/valuation — stock valuation snapshot, unit costs, cost layers, the backdated
 * recalculation queue (jobs + the COGS revisions they publish to Books) and the year-end
 * carry-forward of the Items module.
 */
class ValuationController extends BaseController
{
    public const REPORT_METHODS = ['FIFO', 'LIFO', 'WAC', 'AS_PER_MASTER'];

    /**
     * Columns the valuation register can order by, and how each compares. The
     * register renders a sort header for exactly these; `item_name` is in the
     * list because it is the register's own default sort and used to be ignored.
     */
    public const SNAPSHOT_SORTABLE = [
        'item_name'   => 'text',
        'closing_qty' => 'numeric',
        'unit_cost'   => 'numeric',
        'stock_value' => 'numeric',
        'item_id'     => 'numeric',
    ];

    private const JOB_STATUSES = ['QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED'];

    /**
     * The aggregates behind `GET /valuation/revisions/summary`.
     *
     * Constants rather than strings inlined in the method, so the integration suite can run the
     * REAL SQL against PostgreSQL. `COUNT(DISTINCT CASE … END)`, a `::date` bucket and a ratio
     * guarded by `NULLIF` are precisely what a rewritten copy in a test gets subtly wrong, and a
     * summary that disagrees with the table under it is worse than no summary.
     *
     * Every one of them is selected over `revisionQuery()`, which is also what the list runs, so
     * a card can never describe a different set of rows than the rows beneath it.
     */
    public const REVISION_TOTALS_SELECT = 'COUNT(*) AS revisions'
        . ', COALESCE(SUM(r.delta_amount),0) AS net_delta'
        . ', COALESCE(SUM(ABS(r.delta_amount)),0) AS abs_delta'
        . ', SUM(CASE WHEN r.delta_amount > 0 THEN 1 ELSE 0 END) AS increased'
        . ', SUM(CASE WHEN r.delta_amount < 0 THEN 1 ELSE 0 END) AS decreased'
        . ', SUM(CASE WHEN r.delta_amount = 0 THEN 1 ELSE 0 END) AS unchanged'
        . ', COUNT(DISTINCT l.item_id) AS items_affected'
        . ', COUNT(DISTINCT CASE WHEN r.delta_amount > 0 THEN l.item_id END) AS items_increased'
        . ', COUNT(DISTINCT CASE WHEN r.delta_amount < 0 THEN l.item_id END) AS items_decreased'
        . ', COUNT(DISTINCT r.job_id) AS jobs'
        . ', SUM(CASE WHEN r.acknowledged_at IS NOT NULL THEN 1 ELSE 0 END) AS acknowledged'
        . ', SUM(CASE WHEN r.acknowledged_at IS NULL AND r.published_at IS NOT NULL THEN 1 ELSE 0 END) AS published_unacknowledged'
        . ', SUM(CASE WHEN r.acknowledged_at IS NULL AND r.published_at IS NULL THEN 1 ELSE 0 END) AS awaiting_publish';

    public const REVISION_TIMELINE_SELECT = 'r.created_at::date AS revision_day, COUNT(*) AS revisions'
        . ', SUM(CASE WHEN r.delta_amount > 0 THEN 1 ELSE 0 END) AS increased'
        . ', SUM(CASE WHEN r.delta_amount < 0 THEN 1 ELSE 0 END) AS decreased'
        . ', COALESCE(SUM(r.delta_amount),0) AS net_delta';

    public const REVISION_SOURCE_SELECT = 'd.document_type, COUNT(*) AS revisions'
        . ', COALESCE(SUM(r.delta_amount),0) AS net_delta, COALESCE(SUM(ABS(r.delta_amount)),0) AS abs_delta';

    /**
     * The rate move is a percentage OF THE OLD VALUATION RATE. A zero old rate yields NULL
     * through the NULLIF rather than an infinity dressed up as a number — there is no
     * meaningful "percent change" from nothing, and the insight panel says nothing at all
     * about an item whose baseline is null.
     */
    public const REVISION_TOP_ITEM_SELECT = 'l.item_id, i.item_name, i.item_sku, COUNT(*) AS revisions'
        . ', COALESCE(SUM(r.delta_amount),0) AS net_delta, COALESCE(SUM(ABS(r.delta_amount)),0) AS abs_delta'
        . ', MAX(ABS(r.new_valuation_rate - r.old_valuation_rate) / NULLIF(ABS(r.old_valuation_rate),0)) * 100 AS peak_change_pct';

    public const REVISION_TRIGGER_SELECT = 'jb.trigger_kind, COUNT(DISTINCT r.job_id) AS jobs, COUNT(*) AS revisions'
        . ', COALESCE(SUM(r.delta_amount),0) AS net_delta, COALESCE(SUM(ABS(r.delta_amount)),0) AS abs_delta';

    /**
     * GET /valuation?as_of=&method=FIFO|LIFO|WAC|AS_PER_MASTER&item_id=&warehouse_id=
     * Closing quantity per item as at `as_of`, valued at the cost the method resolves.
     */
    public function snapshot()
    {
        $a = $this->authorize('reports.valuation.read');
        if (isset($a['response'])) {
            return $a['response'];
        }
        $ctx = $a['ctx'];
        $asOf = $this->dateParam('as_of') ?? date('Y-m-d');
        $method = $this->methodParam();
        if ($method === null) {
            return $this->failStructured(422, 'validation_failed', 'method must be one of ' . implode(', ', self::REPORT_METHODS), ['allowed' => self::REPORT_METHODS]);
        }
        $itemId = (int) ($this->request->getGet('item_id') ?? 0) ?: null;
        $warehouseId = (int) ($this->request->getGet('warehouse_id') ?? 0) ?: null;
        $p = $this->listParams(500, 5000, 'item_name');
        try {
            $snap = (new ValuationReplayService())->snapshot((int) $ctx['cmp_id'], (int) $ctx['fy_id'], (int) $ctx['bo_id'], $asOf, $method, $itemId, $warehouseId);
        } catch (\Throwable $e) {
            return $this->failFromException($e);
        }
        $rows = self::sortSnapshotRows($snap['rows'], $p['sort'], $p['order']);
        $total = count($rows);
        $page = array_slice($rows, $p['offset'], $p['limit']);

        return $this->respondList(array_values($page), $total, $p['limit'], $p['offset'], ['summary' => [
            'as_of'       => $asOf,
            'method'      => $snap['method'],
            'total_qty'   => $snap['total_qty'],
            'total_value' => $snap['total_value'],
            'item_count'  => $total,
        ]]);
    }

    /**
     * Order a valuation snapshot by one of SNAPSHOT_SORTABLE.
     *
     * The snapshot is replayed in item-name order, so an unknown sort key keeps
     * that order and only the direction applies — never a silent reordering by
     * something the caller did not ask for.
     *
     * @param list<array<string, mixed>> $rows
     * @return list<array<string, mixed>>
     */
    public static function sortSnapshotRows(array $rows, string $sort, string $order): array
    {
        $desc = strtoupper($order) === 'DESC';
        $kind = self::SNAPSHOT_SORTABLE[$sort] ?? null;
        if ($kind !== null) {
            usort($rows, static fn ($x, $y) => $kind === 'text'
                ? strcasecmp((string) ($x[$sort] ?? ''), (string) ($y[$sort] ?? ''))
                : (float) ($x[$sort] ?? 0) <=> (float) ($y[$sort] ?? 0));
        }

        return $desc ? array_reverse($rows) : array_values($rows);
    }

    /**
     * GET /valuation/unit-costs?item_ids=1,2,3&as_of=&method=&warehouse_id=
     */
    public function unitCosts()
    {
        $a = $this->authorize('reports.valuation.read');
        if (isset($a['response'])) {
            return $a['response'];
        }
        $ctx = $a['ctx'];
        $ids = array_values(array_unique(array_filter(array_map('intval', explode(',', (string) ($this->request->getGet('item_ids') ?? $this->request->getGet('item_id') ?? ''))), static fn ($i) => $i > 0)));
        if ($ids === []) {
            return $this->failStructured(422, 'validation_failed', 'item_ids (comma separated) is required');
        }
        if (count($ids) > 1000) {
            return $this->failStructured(422, 'validation_failed', 'At most 1000 item_ids per request', ['count' => count($ids)]);
        }
        $asOf = $this->dateParam('as_of') ?? date('Y-m-d');
        $method = $this->methodParam();
        if ($method === null) {
            return $this->failStructured(422, 'validation_failed', 'method must be one of ' . implode(', ', self::REPORT_METHODS), ['allowed' => self::REPORT_METHODS]);
        }
        $warehouseId = (int) ($this->request->getGet('warehouse_id') ?? 0) ?: null;
        try {
            $costs = (new ValuationReplayService())->unitCostsForItems((int) $ctx['cmp_id'], (int) $ctx['fy_id'], $ids, $asOf, $method, (int) $ctx['bo_id'], $warehouseId);
        } catch (\Throwable $e) {
            return $this->failFromException($e);
        }
        $rows = [];
        foreach ($ids as $id) {
            $rows[] = ['item_id' => $id, 'unit_cost' => $costs[$id]['unit_cost'] ?? 0.0, 'valuation_method_applied' => $costs[$id]['method'] ?? null];
        }

        return $this->respond(['data' => $rows, 'meta' => ['as_of' => $asOf, 'method' => $method, 'warehouse_id' => $warehouseId, 'count' => count($rows)]]);
    }

    /**
     * GET /valuation/cost-layers?item_id=&warehouse_id=&open_only=1&layer_kind=
     * FIFO/LIFO layers of one item with the consumption trail of each layer.
     */
    public function costLayers()
    {
        $a = $this->authorize('reports.valuation.read');
        if (isset($a['response'])) {
            return $a['response'];
        }
        $cmpId = (int) $a['ctx']['cmp_id'];
        $itemId = (int) ($this->request->getGet('item_id') ?? 0);
        if ($itemId <= 0) {
            return $this->failStructured(422, 'validation_failed', 'item_id is required');
        }
        $db = \Config\Database::connect();
        $item = $db->table('inv_items')->select('item_id, item_name, item_alias, item_sku, unit_id, valuation_method')->where('cmp_id', $cmpId)->where('item_id', $itemId)->get()->getRowArray();
        if (!$item) {
            return $this->failStructured(404, 'not_found', 'Item not found');
        }
        $p = $this->listParams(200, 2000, 'received_at');
        $b = $db->table('inv_cost_layers cl')->where('cl.cmp_id', $cmpId)->where('cl.item_id', $itemId);
        if ((int) ($this->request->getGet('all_fy') ?? 0) !== 1) {
            $b->where('cl.fy_id', (int) $a['ctx']['fy_id']);
        }
        $warehouseId = (int) ($this->request->getGet('warehouse_id') ?? 0);
        if ($warehouseId > 0) {
            $b->where('cl.warehouse_id', $warehouseId);
        }
        if ((int) ($this->request->getGet('open_only') ?? 0) === 1) {
            $b->where('cl.qty_remaining >', 0);
        }
        $kind = strtolower(trim((string) ($this->request->getGet('layer_kind') ?? '')));
        if (in_array($kind, ['opening', 'receipt', 'backorder', 'revaluation'], true)) {
            $b->where('cl.layer_kind', $kind);
        }
        $total = (clone $b)->countAllResults(false);
        $summary = (clone $b)->select('COALESCE(SUM(CASE WHEN cl.qty_remaining > 0 THEN cl.qty_remaining ELSE 0 END),0) AS open_qty, COALESCE(SUM(CASE WHEN cl.qty_remaining > 0 THEN cl.qty_remaining * cl.unit_cost ELSE 0 END),0) AS open_value, COALESCE(SUM(CASE WHEN cl.qty_remaining < 0 THEN cl.qty_remaining ELSE 0 END),0) AS backorder_qty', false)->get()->getRowArray() ?: [];
        $sort = in_array($p['sort'], ['received_at', 'layer_id', 'qty_remaining', 'unit_cost', 'layer_kind'], true) ? 'cl.' . $p['sort'] : 'cl.received_at';
        $layers = $b->select('cl.layer_id, cl.fy_id, cl.item_id, cl.warehouse_id, cl.batch_id, cl.layer_kind, cl.qty_received, cl.qty_remaining, cl.unit_cost, cl.received_at, cl.source_document_id, cl.source_line_id, cl.created_at, w.warehouse_name, d.document_no AS source_document_no, d.document_type AS source_document_type, d.document_date AS source_document_date')
            ->join('inv_warehouses w', 'w.warehouse_id = cl.warehouse_id', 'left')
            ->join('inv_documents d', 'd.document_id = cl.source_document_id', 'left')
            ->orderBy($sort, $p['order'])->orderBy('cl.layer_id', $p['order'])
            ->limit($p['limit'], $p['offset'])->get()->getResultArray();

        $position = [];
        foreach ($layers as $idx => $l) {
            foreach (['layer_id', 'fy_id', 'item_id', 'warehouse_id', 'batch_id', 'source_document_id', 'source_line_id'] as $k) {
                $l[$k] = $l[$k] === null ? null : (int) $l[$k];
            }
            foreach (['qty_received', 'qty_remaining', 'unit_cost'] as $k) {
                $l[$k] = $l[$k] === null ? null : round((float) $l[$k], 4);
            }
            $l['qty_consumed'] = $l['qty_received'] !== null ? round($l['qty_received'] - $l['qty_remaining'], 4) : null;
            $l['remaining_value'] = round($l['qty_remaining'] * $l['unit_cost'], 4);
            $l['consumptions'] = [];
            $layers[$idx] = $l;
            $position[$l['layer_id']] = $idx;
        }
        if ($position !== []) {
            foreach (array_chunk(array_keys($position), 500) as $chunk) {
                $cons = $db->table('inv_cost_layer_consumptions c')
                    ->select('c.consumption_id, c.layer_id, c.document_id, c.line_id, c.movement_id, c.qty, c.unit_cost, c.created_at, d.document_no, d.document_type, d.document_date, d.status AS document_status')
                    ->join('inv_documents d', 'd.document_id = c.document_id', 'left')
                    ->where('c.cmp_id', $cmpId)->whereIn('c.layer_id', $chunk)
                    ->orderBy('c.consumption_id', 'ASC')->get()->getResultArray();
                foreach ($cons as $c) {
                    $lid = (int) $c['layer_id'];
                    if (!isset($position[$lid])) {
                        continue;
                    }
                    foreach (['consumption_id', 'layer_id', 'document_id', 'line_id', 'movement_id'] as $k) {
                        $c[$k] = $c[$k] === null ? null : (int) $c[$k];
                    }
                    $c['qty'] = round((float) $c['qty'], 4);
                    $c['unit_cost'] = round((float) $c['unit_cost'], 4);
                    $c['amount'] = round($c['qty'] * $c['unit_cost'], 4);
                    $layers[$position[$lid]]['consumptions'][] = $c;
                }
            }
        }

        return $this->respondList($layers, $total, $p['limit'], $p['offset'], ['item' => $item, 'summary' => [
            'open_qty'      => round((float) ($summary['open_qty'] ?? 0), 4),
            'open_value'    => round((float) ($summary['open_value'] ?? 0), 4),
            'backorder_qty' => round((float) ($summary['backorder_qty'] ?? 0), 4),
        ]]);
    }

    /**
     * GET /valuation/recalculations?status=&item_id=&trigger_kind=&from=&to=
     */
    public function recalcJobs()
    {
        $a = $this->authorizeAny(['valuation.recalculate', 'reports.valuation.read']);
        if (isset($a['response'])) {
            return $a['response'];
        }
        $ctx = $a['ctx'];
        $cmpId = (int) $ctx['cmp_id'];
        $p = $this->listParams(50, 500, 'created_at');
        if (!$this->request->getGet('order')) {
            $p['order'] = 'DESC';
        }
        $b = $this->jobQuery($cmpId);
        if ((int) ($this->request->getGet('all_fy') ?? 0) !== 1) {
            $b->groupStart()->where('j.fy_id', (int) $ctx['fy_id'])->orWhere('j.fy_id', null)->groupEnd();
        }
        $status = trim((string) ($this->request->getGet('status') ?? ''));
        if ($status !== '') {
            $b->whereIn('j.status', array_map('strtoupper', array_filter(array_map('trim', explode(',', $status)))));
        }
        if ($itemId = (int) ($this->request->getGet('item_id') ?? 0)) {
            $b->where('j.item_id', $itemId);
        }
        if ($trigger = trim((string) ($this->request->getGet('trigger_kind') ?? ''))) {
            $b->where('j.trigger_kind', $trigger);
        }
        if ($docId = (int) ($this->request->getGet('trigger_document_id') ?? 0)) {
            $b->where('j.trigger_document_id', $docId);
        }
        if ($from = $this->dateParam('from')) {
            $b->where('j.created_at >=', $from . ' 00:00:00');
        }
        if ($to = $this->dateParam('to')) {
            $b->where('j.created_at <=', $to . ' 23:59:59');
        }
        $total = (clone $b)->countAllResults(false);
        $sort = in_array($p['sort'], ['created_at', 'job_id', 'status', 'from_date', 'finished_at', 'cogs_delta'], true) ? 'j.' . $p['sort'] : 'j.created_at';
        $rows = $b->select($this->jobColumns())->orderBy($sort, $p['order'])->orderBy('j.job_id', $p['order'])->limit($p['limit'], $p['offset'])->get()->getResultArray();
        foreach ($rows as &$r) {
            $r = $this->castJob($r);
        }
        unset($r);

        return $this->respondList($rows, $total, $p['limit'], $p['offset']);
    }

    /**
     * POST /valuation/recalculations  {item_id?, from_date, dry_run?, run_now?}
     */
    public function enqueueRecalc()
    {
        $a = $this->authorize('valuation.recalculate');
        if (isset($a['response'])) {
            return $a['response'];
        }
        $ctx = $a['ctx'];
        $cmpId = (int) $ctx['cmp_id'];
        $body = $this->request->getJSON(true) ?? [];
        $fromRaw = trim((string) ($body['from_date'] ?? $body['from'] ?? ''));
        $ts = $fromRaw !== '' ? strtotime($fromRaw) : false;
        if ($ts === false) {
            return $this->failStructured(422, 'validation_failed', 'from_date (YYYY-MM-DD) is required');
        }
        $fromDate = date('Y-m-d', $ts);
        $itemId = (int) ($body['item_id'] ?? 0) ?: null;
        $db = \Config\Database::connect();
        if ($itemId !== null && $db->table('inv_items')->where('cmp_id', $cmpId)->where('item_id', $itemId)->countAllResults() === 0) {
            return $this->failStructured(404, 'not_found', 'Item not found');
        }
        $dryRun = !empty($body['dry_run']);
        $triggerDocId = (int) ($body['trigger_document_id'] ?? 0) ?: null;
        if ($triggerDocId !== null && $db->table('inv_documents')->where('cmp_id', $cmpId)->where('document_id', $triggerDocId)->countAllResults() === 0) {
            return $this->failStructured(404, 'not_found', 'Trigger document not found');
        }
        try {
            $service = new RecalculationService();
            $jobId = $service->enqueue($cmpId, (int) $ctx['fy_id'], $itemId, $fromDate, 'manual', $triggerDocId, $a['session']['uuid'], $dryRun);
            if (!empty($body['run_now'])) {
                $service->run($jobId);
            }
            $job = $this->jobQuery($cmpId)->select($this->jobColumns())->where('j.job_id', $jobId)->get()->getRowArray();
        } catch (\Throwable $e) {
            return $this->failFromException($e);
        }

        return $this->respond(['data' => $this->castJob($job)], 201);
    }

    /** GET /valuation/recalculations/{id} */
    public function recalcJob($id = null)
    {
        $a = $this->authorizeAny(['valuation.recalculate', 'reports.valuation.read']);
        if (isset($a['response'])) {
            return $a['response'];
        }
        $cmpId = (int) $a['ctx']['cmp_id'];
        $job = $this->jobQuery($cmpId)->select($this->jobColumns())->where('j.job_id', (int) $id)->get()->getRowArray();
        if (!$job) {
            return $this->failStructured(404, 'not_found', 'Recalculation job not found');
        }
        $job = $this->castJob($job);
        $db = \Config\Database::connect();
        $agg = $db->table('inv_valuation_revisions')
            ->select('COUNT(*) AS revisions, COALESCE(SUM(delta_amount),0) AS delta_total, SUM(CASE WHEN acknowledged_at IS NULL THEN 1 ELSE 0 END) AS unacknowledged, SUM(CASE WHEN published_at IS NOT NULL THEN 1 ELSE 0 END) AS published', false)
            ->where('cmp_id', $cmpId)->where('job_id', (int) $id)->get()->getRowArray() ?: [];
        $job['revision_summary'] = [
            'revisions'      => (int) ($agg['revisions'] ?? 0),
            'delta_total'    => round((float) ($agg['delta_total'] ?? 0), 4),
            'unacknowledged' => (int) ($agg['unacknowledged'] ?? 0),
            'published'      => (int) ($agg['published'] ?? 0),
        ];

        return $this->respond(['data' => $job]);
    }

    /** POST /valuation/recalculations/{id}/run — run the job synchronously. */
    public function runRecalc($id = null)
    {
        $a = $this->authorize('valuation.recalculate');
        if (isset($a['response'])) {
            return $a['response'];
        }
        $cmpId = (int) $a['ctx']['cmp_id'];
        $exists = $this->jobQuery($cmpId)->select('j.job_id, j.status')->where('j.job_id', (int) $id)->get()->getRowArray();
        if (!$exists) {
            return $this->failStructured(404, 'not_found', 'Recalculation job not found');
        }
        if ($exists['status'] === 'RUNNING') {
            return $this->failStructured(409, 'conflict', 'Recalculation job is already running', ['status' => 'RUNNING']);
        }
        try {
            (new RecalculationService())->run((int) $id);
        } catch (\Throwable $e) {
            return $this->failFromException($e);
        }
        $job = $this->jobQuery($cmpId)->select($this->jobColumns())->where('j.job_id', (int) $id)->get()->getRowArray();

        return $this->respond(['data' => $this->castJob($job)]);
    }

    /**
     * GET /valuation/revisions
     *
     * Filters: acknowledged=0|1, books=awaiting|published|acknowledged|unacknowledged,
     * job_id, document_id, item_id, warehouse_id, source_app, document_type,
     * delta=increase|decrease|none, min_abs_delta, q (item name / SKU / document no), from, to.
     */
    public function revisions()
    {
        $a = $this->authorizeAny(['reports.valuation.read', 'valuation.recalculate']);
        if (isset($a['response'])) {
            return $a['response'];
        }
        $cmpId = (int) $a['ctx']['cmp_id'];
        $boId = (int) ($a['ctx']['bo_id'] ?? 0);
        $p = $this->listParams(50, 500, 'revision_id');
        if (!$this->request->getGet('order')) {
            $p['order'] = 'DESC';
        }
        $b = $this->revisionQuery($cmpId, $boId);
        $total = (clone $b)->countAllResults(false);
        $sort = in_array($p['sort'], ['revision_id', 'created_at', 'delta_amount', 'document_id', 'acknowledged_at'], true) ? 'r.' . $p['sort'] : 'r.revision_id';
        $rows = $b
            ->join('inv_warehouses w', 'w.warehouse_id = l.warehouse_id', 'left')
            ->join('inv_uom u', 'u.unit_id = l.unit_id', 'left')
            ->join('inv_valuation_recalc_jobs jb', 'jb.job_id = r.job_id', 'left')
            ->select('r.revision_id, r.revision_uuid, r.job_id, r.document_id, r.line_id, r.source_app, r.source_document_type, r.source_document_id, r.source_document_uuid, r.old_valuation_rate, r.new_valuation_rate, r.old_valuation_amount, r.new_valuation_amount, r.delta_amount, r.published_at, r.acknowledged_at, r.acknowledged_by_app, r.created_at, d.document_no, d.document_type, d.document_date, d.status AS document_status, d.source_document_no, l.item_id, l.direction, l.base_qty, l.warehouse_id, l.valuation_method_applied, i.item_name, i.item_sku, w.warehouse_name, u.unit_symbol, jb.trigger_kind, jb.trigger_document_id, jb.dry_run, jb.status AS job_status, jb.requested_by AS job_requested_by')
            ->orderBy($sort, $p['order'])->orderBy('r.revision_id', $p['order'])->limit($p['limit'], $p['offset'])->get()->getResultArray();
        foreach ($rows as &$r) {
            foreach (['revision_id', 'job_id', 'document_id', 'line_id', 'source_document_id', 'item_id', 'warehouse_id', 'trigger_document_id'] as $k) {
                $r[$k] = $r[$k] === null ? null : (int) $r[$k];
            }
            foreach (['old_valuation_rate', 'new_valuation_rate', 'old_valuation_amount', 'new_valuation_amount', 'delta_amount', 'base_qty'] as $k) {
                $r[$k] = $r[$k] === null ? null : round((float) $r[$k], 4);
            }
            $r['dry_run'] = $r['dry_run'] === null ? null : (bool) $r['dry_run'];
            $r['acknowledged'] = $r['acknowledged_at'] !== null;
        }
        unset($r);

        return $this->respondList($rows, $total, $p['limit'], $p['offset']);
    }

    /**
     * The revisions query with every filter applied.
     *
     * Shared by the list and by the summary below, and that sharing is the point: a KPI card
     * or a chart slice that described a different set of rows than the table underneath it
     * would be a figure nobody could reconcile, and on a costing screen that is worse than no
     * figure at all.
     *
     * `$range` overrides the request's own from / to — the summary uses it to measure the
     * period before the one on screen without loosening any of the other filters.
     *
     * @param array{from: ?string, to: ?string}|null $range
     */
    private function revisionQuery(int $cmpId, int $boId, ?array $range = null): \CodeIgniter\Database\BaseBuilder
    {
        $b = \Config\Database::connect()->table('inv_valuation_revisions r')
            ->join('inv_documents d', 'd.document_id = r.document_id', 'left')
            ->join('inv_document_lines l', 'l.line_id = r.line_id', 'left')
            ->join('inv_items i', 'i.item_id = l.item_id', 'left')
            ->where('r.cmp_id', $cmpId);
        // Branch scope, applied the way every register applies it: 0 is consolidated. The
        // revision itself has no branch — the document line it revalued does.
        if ($boId > 0) {
            $b->where('l.bo_id', $boId);
        }
        $ack = $this->request->getGet('acknowledged');
        if ($ack !== null && $ack !== '') {
            (int) $ack === 1 ? $b->where('r.acknowledged_at IS NOT NULL', null, false) : $b->where('r.acknowledged_at', null);
        }
        /*
         * The Books lifecycle, as three states rather than two.
         *
         * A revision is generated by a recalculation (awaiting), then published to Books
         * (published_at), then acknowledged once Books has re-posted the COGS
         * (acknowledged_at). Collapsing the first two into one "pending" would hide exactly
         * the case an operator is looking for: a revision Inventory never managed to hand over.
         */
        switch (strtolower(trim((string) ($this->request->getGet('books') ?? '')))) {
            case 'awaiting':
                $b->where('r.acknowledged_at', null)->where('r.published_at', null);
                break;

            case 'published':
                $b->where('r.acknowledged_at', null)->where('r.published_at IS NOT NULL', null, false);
                break;

            case 'acknowledged':
                $b->where('r.acknowledged_at IS NOT NULL', null, false);
                break;

            case 'unacknowledged':
                $b->where('r.acknowledged_at', null);
                break;
        }
        if ($jobId = (int) ($this->request->getGet('job_id') ?? 0)) {
            $b->where('r.job_id', $jobId);
        }
        if ($docId = (int) ($this->request->getGet('document_id') ?? 0)) {
            $b->where('r.document_id', $docId);
        }
        if ($itemId = (int) ($this->request->getGet('item_id') ?? 0)) {
            $b->where('l.item_id', $itemId);
        }
        if ($warehouseId = (int) ($this->request->getGet('warehouse_id') ?? 0)) {
            $b->where('l.warehouse_id', $warehouseId);
        }
        if ($src = trim((string) ($this->request->getGet('source_app') ?? ''))) {
            $b->where('r.source_app', strtolower($src));
        }
        // The document type is what an operator means by "source": a purchase, a stock
        // journal, an adjustment. `source_app` is a different question — which product the
        // paperwork came from — and both are filterable because both get asked.
        if ($docType = trim((string) ($this->request->getGet('document_type') ?? ''))) {
            $b->where('d.document_type', $docType);
        }
        switch (strtolower(trim((string) ($this->request->getGet('delta') ?? '')))) {
            case 'increase':
                $b->where('r.delta_amount >', 0);
                break;

            case 'decrease':
                $b->where('r.delta_amount <', 0);
                break;

            case 'none':
                $b->where('r.delta_amount', 0);
                break;
        }
        $minAbs = trim((string) ($this->request->getGet('min_abs_delta') ?? ''));
        if ($minAbs !== '' && is_numeric($minAbs)) {
            // Formatted from a float, so the literal cannot carry anything but digits.
            $b->where('ABS(r.delta_amount) >= ' . sprintf('%.4F', abs((float) $minAbs)), null, false);
        }
        if ($q = trim((string) ($this->request->getGet('q') ?? ''))) {
            $b->groupStart()->like('i.item_name', $q)->orLike('i.item_sku', $q)->orLike('d.document_no', $q)->groupEnd();
        }
        $from = $range === null ? $this->dateParam('from') : ($range['from'] ?? null);
        $to = $range === null ? $this->dateParam('to') : ($range['to'] ?? null);
        if ($from !== null) {
            $b->where('r.created_at >=', $from . ' 00:00:00');
        }
        if ($to !== null) {
            $b->where('r.created_at <=', $to . ' 23:59:59');
        }

        return $b;
    }

    /**
     * POST /valuation/revisions/ack  {revision_ids:[...]} — Books (service caller) or a user with
     * valuation.recalculate confirms the COGS revisions were absorbed.
     */
    public function ackRevisions()
    {
        $a = $this->authorize('valuation.recalculate');
        if (isset($a['response'])) {
            return $a['response'];
        }
        $cmpId = (int) $a['ctx']['cmp_id'];
        $body = $this->request->getJSON(true) ?? [];
        $ids = $body['revision_ids'] ?? [];
        if (is_string($ids)) {
            $ids = explode(',', $ids);
        }
        $ids = is_array($ids) ? array_values(array_unique(array_filter(array_map('intval', $ids), static fn ($i) => $i > 0))) : [];
        if ($ids === []) {
            return $this->failStructured(422, 'validation_failed', 'revision_ids (non-empty array) is required');
        }
        if (count($ids) > 5000) {
            return $this->failStructured(422, 'validation_failed', 'At most 5000 revision_ids per request', ['count' => count($ids)]);
        }
        $app = strtolower(trim((string) ($body['acknowledged_by_app'] ?? $a['session']['source_app'] ?? 'inventory'))) ?: 'inventory';
        $db = \Config\Database::connect();
        $now = date('Y-m-d H:i:s');
        $acknowledged = 0;
        $db->transStart();
        foreach (array_chunk($ids, 500) as $chunk) {
            $db->table('inv_valuation_revisions')->where('cmp_id', $cmpId)->whereIn('revision_id', $chunk)->where('acknowledged_at', null)
                ->update(['acknowledged_at' => $now, 'acknowledged_by_app' => substr($app, 0, 24)]);
            $acknowledged += (int) $db->affectedRows();
        }
        $db->transComplete();
        if ($db->transStatus() === false) {
            return $this->failStructured(500, 'internal_error', 'Could not acknowledge revisions');
        }
        $known = [];
        foreach (array_chunk($ids, 500) as $chunk) {
            foreach ($db->table('inv_valuation_revisions')->select('revision_id')->where('cmp_id', $cmpId)->whereIn('revision_id', $chunk)->get()->getResultArray() as $r) {
                $known[] = (int) $r['revision_id'];
            }
        }
        $unknown = array_values(array_diff($ids, $known));
        (new \App\Services\AuditService())->log($cmpId, 'valuation_revision', 0, 'valuation.revisions.acknowledged', $a['session']['uuid'] ?? null, ['source_app' => $app, 'acknowledged' => $acknowledged, 'requested' => count($ids)]);

        return $this->respond(['data' => [
            'acknowledged'         => $acknowledged,
            'already_acknowledged' => max(0, count($known) - $acknowledged),
            'unknown_revision_ids' => $unknown,
            'acknowledged_by_app'  => $app,
            'acknowledged_at'      => $now,
        ]]);
    }

    /**
     * GET /valuation/revisions/summary?days=10 + every filter the list itself takes.
     *
     * The figures the revisions screen puts on its cards, its charts and its insight panel,
     * computed as SQL aggregates over the SAME filtered set as the list.
     *
     * None of it is derived from the page of rows a browser happens to be holding: a KPI that
     * counted the visible 25 revisions would understate a company's exposure by whatever the
     * reader had not scrolled to yet, and a "net impact" that moved when somebody changed the
     * page size is a number no one can reconcile.
     */
    public function revisionsSummary()
    {
        $a = $this->authorizeAny(['reports.valuation.read', 'valuation.recalculate']);
        if (isset($a['response'])) {
            return $a['response'];
        }
        $cmpId = (int) $a['ctx']['cmp_id'];
        $boId = (int) ($a['ctx']['bo_id'] ?? 0);
        $db = \Config\Database::connect();

        // The window the timeline draws and the trend compares against. An explicit date
        // filter owns it; otherwise it is the last `days` days ending today.
        $days = max(1, min(90, (int) ($this->request->getGet('days') ?? 10)));
        $filterFrom = $this->dateParam('from');
        $filterTo = $this->dateParam('to');
        $to = $filterTo ?? date('Y-m-d');
        $from = $filterFrom ?? date('Y-m-d', strtotime($to . ' -' . ($days - 1) . ' days'));
        if (strtotime($from) > strtotime($to)) {
            $from = $to;
        }
        $span = max(1, (int) round((strtotime($to) - strtotime($from)) / 86400) + 1);
        $prevTo = date('Y-m-d', strtotime($from . ' -1 day'));
        $prevFrom = date('Y-m-d', strtotime($prevTo . ' -' . ($span - 1) . ' days'));

        $filtered = $this->revisionQuery($cmpId, $boId)->select(self::REVISION_TOTALS_SELECT, false)->get()->getRowArray() ?: [];
        $previous = $this->revisionQuery($cmpId, $boId, ['from' => $prevFrom, 'to' => $prevTo])
            ->select(self::REVISION_TOTALS_SELECT, false)->get()->getRowArray() ?: [];

        // Company-wide (branch-scoped) state and recent activity: what the acknowledgement
        // progress ring and the "vs yesterday" captions describe. Filters do not apply — a
        // backlog does not shrink because somebody narrowed a date range.
        $today = date('Y-m-d');
        $yesterday = date('Y-m-d', strtotime('-1 day'));
        $week = date('Y-m-d', strtotime('-6 days'));
        $prevWeek = date('Y-m-d', strtotime('-13 days'));
        $company = $this->companyRevisionScope($cmpId, $boId)->select(
            'COUNT(*) AS revisions'
            . ', SUM(CASE WHEN r.acknowledged_at IS NOT NULL THEN 1 ELSE 0 END) AS acknowledged'
            . ', SUM(CASE WHEN r.acknowledged_at IS NULL THEN 1 ELSE 0 END) AS pending'
            . ", COALESCE(SUM(CASE WHEN r.acknowledged_at IS NULL THEN r.delta_amount ELSE 0 END),0) AS pending_delta"
            . ', SUM(CASE WHEN r.acknowledged_at IS NULL AND r.published_at IS NULL THEN 1 ELSE 0 END) AS awaiting_publish'
            . ', SUM(CASE WHEN r.acknowledged_at IS NULL AND r.published_at IS NOT NULL THEN 1 ELSE 0 END) AS published_unacknowledged'
            . ", SUM(CASE WHEN r.created_at >= '{$week} 00:00:00' THEN 1 ELSE 0 END) AS created_last_7d"
            . ", SUM(CASE WHEN r.created_at >= '{$prevWeek} 00:00:00' AND r.created_at < '{$week} 00:00:00' THEN 1 ELSE 0 END) AS created_prev_7d"
            . ", SUM(CASE WHEN r.acknowledged_at >= '{$today} 00:00:00' THEN 1 ELSE 0 END) AS acknowledged_today"
            . ", SUM(CASE WHEN r.acknowledged_at >= '{$yesterday} 00:00:00' AND r.acknowledged_at < '{$today} 00:00:00' THEN 1 ELSE 0 END) AS acknowledged_yesterday",
            false,
        )->get()->getRowArray() ?: [];

        // Per-day counts for the timeline, over the resolved window and the screen's filters.
        $timelineRows = $this->revisionQuery($cmpId, $boId, ['from' => $from, 'to' => $to])
            ->select(self::REVISION_TIMELINE_SELECT, false)
            ->groupBy('r.created_at::date', false)->orderBy('r.created_at::date', 'ASC', false)
            ->get()->getResultArray();

        $bySource = $this->revisionQuery($cmpId, $boId)
            ->select(self::REVISION_SOURCE_SELECT, false)
            ->groupBy('d.document_type')->orderBy('abs_delta', 'DESC', false)->limit(12)->get()->getResultArray();

        // Which items carry the movement, and the biggest rate change each of them saw. The
        // percentage is of the OLD valuation rate, and a zero old rate yields NULL rather
        // than an infinity dressed up as a number.
        $topItems = $this->revisionQuery($cmpId, $boId)
            ->select(self::REVISION_TOP_ITEM_SELECT, false)
            ->where('l.item_id IS NOT NULL', null, false)
            ->groupBy('l.item_id')->groupBy('i.item_name')->groupBy('i.item_sku')
            ->orderBy('abs_delta', 'DESC', false)->limit(8)->get()->getResultArray();

        // What produced the revisions: the recalculation's own trigger. This is the only
        // honest answer to "why did the valuation change" this screen can give, because it is
        // the reason the engine recorded when it queued the job.
        $triggers = $this->revisionQuery($cmpId, $boId)
            ->join('inv_valuation_recalc_jobs jb', 'jb.job_id = r.job_id', 'left')
            ->select(self::REVISION_TRIGGER_SELECT, false)
            ->groupBy('jb.trigger_kind')->orderBy('revisions', 'DESC', false)->limit(6)->get()->getResultArray();

        $jobRows = $db->table('inv_valuation_recalc_jobs')->select('status, COUNT(*) AS jobs', false)
            ->where('cmp_id', $cmpId)->groupBy('status')->get()->getResultArray();
        $jobs = ['queued' => 0, 'running' => 0, 'failed' => 0];
        foreach ($jobRows as $row) {
            $key = strtolower((string) $row['status']);
            if (isset($jobs[$key])) {
                $jobs[$key] = (int) $row['jobs'];
            }
        }

        // The 30-day baseline the anomaly check compares against, for the top items only.
        $itemIds = array_values(array_filter(array_map(static fn ($r) => (int) $r['item_id'], $topItems)));
        $baseline = [];
        $baselineDays = 30;
        $baselineFrom = date('Y-m-d', strtotime($to . ' -' . ($baselineDays - 1) . ' days'));
        if ($itemIds !== []) {
            $rows = $this->companyRevisionScope($cmpId, $boId)
                ->select('l.item_id, AVG(ABS(r.new_valuation_rate - r.old_valuation_rate) / NULLIF(ABS(r.old_valuation_rate),0)) * 100 AS baseline_pct, COUNT(*) AS samples', false)
                ->whereIn('l.item_id', $itemIds)
                ->where('r.created_at >=', $baselineFrom . ' 00:00:00')
                ->where('r.created_at <=', $to . ' 23:59:59')
                ->groupBy('l.item_id')->get()->getResultArray();
            foreach ($rows as $row) {
                $baseline[(int) $row['item_id']] = [
                    'baseline_pct' => $row['baseline_pct'] === null ? null : round((float) $row['baseline_pct'], 2),
                    'samples'      => (int) $row['samples'],
                ];
            }
        }

        $castTotals = static function (array $t): array {
            $out = [];
            foreach (['revisions', 'increased', 'decreased', 'unchanged', 'items_affected', 'items_increased', 'items_decreased', 'jobs', 'acknowledged', 'published_unacknowledged', 'awaiting_publish'] as $k) {
                $out[$k] = (int) ($t[$k] ?? 0);
            }
            foreach (['net_delta', 'abs_delta'] as $k) {
                $out[$k] = round((float) ($t[$k] ?? 0), 4);
            }

            return $out;
        };

        return $this->respond(['data' => [
            'window' => [
                'from'           => $from,
                'to'             => $to,
                'days'           => $span,
                'explicit_range' => $filterFrom !== null || $filterTo !== null,
                'previous_from'  => $prevFrom,
                'previous_to'    => $prevTo,
            ],
            'filtered' => $castTotals($filtered),
            'previous' => $castTotals($previous),
            'company'  => [
                'revisions'               => (int) ($company['revisions'] ?? 0),
                'acknowledged'            => (int) ($company['acknowledged'] ?? 0),
                'pending'                 => (int) ($company['pending'] ?? 0),
                'pending_delta'           => round((float) ($company['pending_delta'] ?? 0), 4),
                'awaiting_publish'        => (int) ($company['awaiting_publish'] ?? 0),
                'published_unacknowledged' => (int) ($company['published_unacknowledged'] ?? 0),
                'created_last_7d'         => (int) ($company['created_last_7d'] ?? 0),
                'created_prev_7d'         => (int) ($company['created_prev_7d'] ?? 0),
                'acknowledged_today'      => (int) ($company['acknowledged_today'] ?? 0),
                'acknowledged_yesterday'  => (int) ($company['acknowledged_yesterday'] ?? 0),
            ],
            'jobs'     => $jobs,
            'timeline' => array_map(static fn ($r) => [
                'day'       => substr((string) $r['revision_day'], 0, 10),
                'revisions' => (int) $r['revisions'],
                'increased' => (int) $r['increased'],
                'decreased' => (int) $r['decreased'],
                'net_delta' => round((float) $r['net_delta'], 4),
            ], $timelineRows),
            'by_source' => array_map(static fn ($r) => [
                'document_type' => $r['document_type'],
                'revisions'     => (int) $r['revisions'],
                'net_delta'     => round((float) $r['net_delta'], 4),
                'abs_delta'     => round((float) $r['abs_delta'], 4),
            ], $bySource),
            'top_items' => array_map(static fn ($r) => [
                'item_id'         => (int) $r['item_id'],
                'item_name'       => $r['item_name'],
                'item_sku'        => $r['item_sku'],
                'revisions'       => (int) $r['revisions'],
                'net_delta'       => round((float) $r['net_delta'], 4),
                'abs_delta'       => round((float) $r['abs_delta'], 4),
                'peak_change_pct' => $r['peak_change_pct'] === null ? null : round((float) $r['peak_change_pct'], 2),
                'baseline_pct'    => $baseline[(int) $r['item_id']]['baseline_pct'] ?? null,
                'baseline_samples' => $baseline[(int) $r['item_id']]['samples'] ?? 0,
            ], $topItems),
            'baseline_days' => $baselineDays,
            'triggers'      => array_map(static fn ($r) => [
                'trigger_kind' => $r['trigger_kind'],
                'jobs'         => (int) $r['jobs'],
                'revisions'    => (int) $r['revisions'],
                'net_delta'    => round((float) $r['net_delta'], 4),
                'abs_delta'    => round((float) $r['abs_delta'], 4),
            ], $triggers),
        ]]);
    }

    /**
     * Company (and branch) scoped revisions, with NO screen filter applied.
     *
     * The backlog and the acknowledgement progress are company facts: they must not move
     * because somebody narrowed a date range on the screen in front of them.
     */
    private function companyRevisionScope(int $cmpId, int $boId): \CodeIgniter\Database\BaseBuilder
    {
        $b = \Config\Database::connect()->table('inv_valuation_revisions r')
            ->join('inv_document_lines l', 'l.line_id = r.line_id', 'left')
            ->where('r.cmp_id', $cmpId);
        if ($boId > 0) {
            $b->where('l.bo_id', $boId);
        }

        return $b;
    }

    /**
     * GET /valuation/carry-forward?source_fy_id=&target_fy_id=&source_fy_end=
     * Preview of the year-end carry-forward (same computation as POST, nothing written) plus the
     * recorded status of that source → target run. source_fy_end defaults to the year's known end.
     */
    public function carryForwardPreview()
    {
        $a = $this->authorizeAny(['valuation.carry_forward', 'valuation.recalculate', 'reports.valuation.read'], true, false);
        if (isset($a['response'])) {
            return $a['response'];
        }
        $cmpId = (int) $a['ctx']['cmp_id'];
        $boId = (int) $a['ctx']['bo_id'];
        $sourceFyId = (int) ($this->request->getGet('source_fy_id') ?? 0);
        $targetFyId = (int) ($this->request->getGet('target_fy_id') ?? 0);
        if ($sourceFyId <= 0 || $targetFyId <= 0) {
            return $this->failStructured(422, 'validation_failed', 'source_fy_id and target_fy_id are required', ['fields' => ['source_fy_id', 'target_fy_id']]);
        }
        if ($sourceFyId === $targetFyId) {
            return $this->failStructured(422, 'validation_failed', 'source_fy_id and target_fy_id must differ');
        }
        $sourceFyEnd = $this->dateParam('source_fy_end');
        if ($sourceFyEnd === null) {
            $range = $this->manageContext()->fyDateRange($cmpId, $sourceFyId);
            $sourceFyEnd = $range['fy_end'] ?? null;
        }
        if ($sourceFyEnd === null) {
            return $this->failStructured(422, 'validation_failed', 'source_fy_end (YYYY-MM-DD) is required: the source year\'s dates are not known', ['fields' => ['source_fy_end']]);
        }
        try {
            $service = new FyCarryForwardService();
            $preview = $service->preview($cmpId, $sourceFyId, $targetFyId, $boId, $sourceFyEnd);
            $preview['status'] = $service->status($cmpId, $sourceFyId, $targetFyId, $boId);
            $preview['existing_target_rows'] = $service->existingTargetRows($cmpId, $targetFyId, $boId);
            $preview['target_carried_forward'] = FyCarryForwardStatus::hasRunInto($cmpId, $targetFyId);
        } catch (\Throwable $e) {
            return $this->failFromException($e);
        }

        return $this->respond(['data' => $preview]);
    }

    /**
     * POST /valuation/carry-forward
     *   {source_fy_id, target_fy_id, source_fy_start, source_fy_end, target_fy_start, target_fy_end, bo_id?, overwrite?}
     * Writes the target year's opening stock from the source year's closing (see FyCarryForwardService).
     * Year dates missing from the body are filled from the known ranges (local cache, then Manage).
     */
    public function carryForward()
    {
        $a = $this->authorizeAny(['valuation.carry_forward', 'valuation.recalculate'], true, false);
        if (isset($a['response'])) {
            return $a['response'];
        }
        $cmpId = (int) $a['ctx']['cmp_id'];
        $body = $this->request->getJSON(true) ?? [];
        foreach (['source' => (int) ($body['source_fy_id'] ?? 0), 'target' => (int) ($body['target_fy_id'] ?? 0)] as $side => $fyId) {
            if ($fyId <= 0 || (!empty($body[$side . '_fy_start']) && !empty($body[$side . '_fy_end']))) {
                continue;
            }
            $range = $this->manageContext()->fyDateRange($cmpId, $fyId);
            if ($range !== null) {
                $body[$side . '_fy_start'] = $body[$side . '_fy_start'] ?? $range['fy_start'];
                $body[$side . '_fy_end'] = $body[$side . '_fy_end'] ?? $range['fy_end'];
            }
        }
        try {
            $req = FyCarryForwardService::normaliseRequest($body, (int) $a['ctx']['bo_id']);
            $result = (new FyCarryForwardService())->run($cmpId, $req, $a['session']['uuid']);
        } catch (\Throwable $e) {
            return $this->failFromException($e);
        }

        return $this->respond(['data' => $result]);
    }

    // ------------------------------------------------------------------ helpers

    private function manageContext(): ManageContextService
    {
        return (new ManageContextService())->withAuth($this->request->getHeaderLine('Authorization') ?: null);
    }

    private function jobQuery(int $cmpId)
    {
        return \Config\Database::connect()->table('inv_valuation_recalc_jobs j')
            ->join('inv_items i', 'i.item_id = j.item_id', 'left')
            ->join('inv_documents d', 'd.document_id = j.trigger_document_id', 'left')
            ->where('j.cmp_id', $cmpId);
    }

    private function jobColumns(): string
    {
        return 'j.job_id, j.job_uuid, j.cmp_id, j.fy_id, j.item_id, j.warehouse_id, j.from_date, j.to_date, j.trigger_kind, j.trigger_document_id, j.status, j.dry_run, j.affected_documents_json, j.affected_line_count, j.revised_line_count, j.cogs_delta, j.failure_reason, j.requested_by, j.created_at, j.started_at, j.finished_at, i.item_name, i.item_sku, d.document_no AS trigger_document_no, d.document_type AS trigger_document_type';
    }

    /** @param array<string, mixed> $r @return array<string, mixed> */
    private function castJob(array $r): array
    {
        foreach (['job_id', 'cmp_id', 'fy_id', 'item_id', 'warehouse_id', 'trigger_document_id', 'affected_line_count', 'revised_line_count'] as $k) {
            if (array_key_exists($k, $r)) {
                $r[$k] = $r[$k] === null ? null : (int) $r[$k];
            }
        }
        $r['dry_run'] = (int) ($r['dry_run'] ?? 0) === 1;
        $r['cogs_delta'] = round((float) ($r['cogs_delta'] ?? 0), 4);
        $r['affected_document_ids'] = array_map('intval', json_decode((string) ($r['affected_documents_json'] ?? ''), true) ?: []);
        unset($r['affected_documents_json']);

        return $r;
    }

    /** Report method from ?method= ; null when invalid. Defaults to AS_PER_MASTER. */
    private function methodParam(): ?string
    {
        $raw = strtoupper(trim((string) ($this->request->getGet('method') ?? '')));
        if ($raw === '') {
            return 'AS_PER_MASTER';
        }
        if ($raw === 'AS_PER_MASTER' || $raw === 'MASTER') {
            return 'AS_PER_MASTER';
        }
        if (isset(InventorySettingsService::METHOD_ALIASES[$raw])) {
            return InventorySettingsService::METHOD_ALIASES[$raw];
        }

        return null;
    }

    private function dateParam(string $name): ?string
    {
        $v = trim((string) ($this->request->getGet($name) ?? ''));
        if ($v === '') {
            return null;
        }
        $ts = strtotime($v);

        return $ts === false ? null : date('Y-m-d', $ts);
    }
}
