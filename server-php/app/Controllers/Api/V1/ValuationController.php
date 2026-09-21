<?php

namespace App\Controllers\Api\V1;

use App\Controllers\Api\BaseController;
use App\Services\AuditService;
use App\Services\FyCarryForwardService;
use App\Services\FyCarryForwardStatus;
use App\Services\IdempotencyService;
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
     * Columns the recalculation register may order by.
     *
     * A closed list because the value is interpolated into ORDER BY: anything not
     * named here falls back to created_at rather than reaching the database.
     * `affected_line_count` and `revised_line_count` are here so the two count
     * columns the screen right-aligns can actually be sorted — a register that
     * draws a sort arrow the server ignores is worse than one that draws none.
     */
    private const JOB_SORTABLE = [
        'created_at', 'job_id', 'status', 'from_date', 'finished_at', 'cogs_delta',
        'affected_line_count', 'revised_line_count', 'started_at', 'trigger_kind',
    ];

    /**
     * How much of a typed reason is stored.
     *
     * Generous rather than tight — the field exists to be read by a person in an
     * audit, and truncating their explanation at 200 characters would defeat it —
     * but bounded, so a pasted stack trace cannot become an unbounded row.
     */
    private const REMARKS_MAX = 1000;

    /** Which timestamp `from` / `to` filter on. `queued` is the historical default. */
    private const JOB_DATE_FIELDS = ['created_at' => 'created_at', 'queued' => 'created_at', 'finished' => 'finished_at', 'finished_at' => 'finished_at', 'effective' => 'from_date', 'from_date' => 'from_date'];

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
     * GET /valuation/cost-layers
     *   ?item_id=&warehouse_id=&batch_id=&open_only=1&layer_kind=&status=&from=&to=&all_fy=
     *
     * FIFO/LIFO layers of one item with the consumption trail of each layer.
     *
     * Two aggregates come back, and the difference between them is the whole
     * point. `summary` describes the layers the filters actually selected — it
     * is what the screen's counts and totals may quote. `distribution`
     * deliberately ignores `open_only` and `status`, because it is the split of
     * the item's layers BY state: computed over a set already narrowed to one
     * state it would report that state as 100% of the item's value, which is
     * the most confidently wrong figure a valuation screen could print.
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

        // Every filter EXCEPT the two that select a layer state, so the
        // distribution below can still see the states those would remove.
        $scoped = $db->table('inv_cost_layers cl')->where('cl.cmp_id', $cmpId)->where('cl.item_id', $itemId);
        if ((int) ($this->request->getGet('all_fy') ?? 0) !== 1) {
            $scoped->where('cl.fy_id', (int) $a['ctx']['fy_id']);
        }
        $warehouseId = (int) ($this->request->getGet('warehouse_id') ?? 0);
        if ($warehouseId > 0) {
            $scoped->where('cl.warehouse_id', $warehouseId);
        }
        $kind = strtolower(trim((string) ($this->request->getGet('layer_kind') ?? '')));
        if (in_array($kind, ['opening', 'receipt', 'backorder', 'revaluation'], true)) {
            $scoped->where('cl.layer_kind', $kind);
        }
        if ($batchId = (int) ($this->request->getGet('batch_id') ?? 0)) {
            $scoped->where('cl.batch_id', $batchId);
        }
        if ($from = $this->dateParam('from')) {
            $scoped->where('cl.received_at >=', $from . ' 00:00:00');
        }
        if ($to = $this->dateParam('to')) {
            $scoped->where('cl.received_at <=', $to . ' 23:59:59');
        }

        $b = clone $scoped;
        if ((int) ($this->request->getGet('open_only') ?? 0) === 1) {
            $b->where('cl.qty_remaining >', 0);
        }
        $status = strtolower(trim((string) ($this->request->getGet('status') ?? '')));
        if (isset(self::LAYER_STATE_SQL[$status])) {
            $b->where('(' . self::LAYER_STATE_SQL[$status] . ')', null, false);
        }

        $total = (clone $b)->countAllResults(false);
        $summary = (clone $b)->select(self::LAYER_SUMMARY_SELECT, false)->get()->getRowArray() ?: [];
        $buckets = (clone $scoped)->select(self::LAYER_BUCKET_SELECT, false)->get()->getRowArray() ?: [];
        // `remaining_value` is not a column — it is what the screen's "highest
        // value first" view orders by, so it is spelled out here rather than
        // sorted client-side over one page of a thousand-layer item.
        $sort = in_array($p['sort'], ['received_at', 'layer_id', 'qty_remaining', 'qty_received', 'unit_cost', 'layer_kind'], true)
            ? 'cl.' . $p['sort']
            : ($p['sort'] === 'remaining_value' ? '(cl.qty_remaining * cl.unit_cost)' : 'cl.received_at');
        $layers = $b->select('cl.layer_id, cl.fy_id, cl.item_id, cl.warehouse_id, cl.batch_id, cl.layer_kind, cl.qty_received, cl.qty_remaining, cl.unit_cost, cl.received_at, cl.source_document_id, cl.source_line_id, cl.created_at, w.warehouse_name, d.document_no AS source_document_no, d.document_type AS source_document_type, d.document_date AS source_document_date, bt.batch_no, bt.lot_no, bt.expiry_date, bt.status AS batch_status')
            ->join('inv_warehouses w', 'w.warehouse_id = cl.warehouse_id', 'left')
            ->join('inv_documents d', 'd.document_id = cl.source_document_id', 'left')
            ->join('inv_batches bt', 'bt.batch_id = cl.batch_id', 'left')
            ->orderBy($sort, $p['order'], false)->orderBy('cl.layer_id', $p['order'])
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
            // What the layer was worth when it opened, which is what a split by
            // state has to add up: a closed layer's remaining value is zero, so
            // a distribution over remaining value would price every exhausted
            // layer at nothing and claim the item's cost never moved.
            $l['layer_value'] = round(($l['qty_received'] ?? $l['qty_remaining']) * $l['unit_cost'], 4);
            $l['layer_status'] = self::layerStatus($l['qty_received'], $l['qty_remaining']);
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

        $receivedQty = round((float) ($summary['received_qty'] ?? 0), 4);
        $receivedValue = round((float) ($summary['received_value'] ?? 0), 4);

        return $this->respondList($layers, $total, $p['limit'], $p['offset'], ['item' => $item, 'summary' => [
            'open_qty'       => round((float) ($summary['open_qty'] ?? 0), 4),
            'open_value'     => round((float) ($summary['open_value'] ?? 0), 4),
            'backorder_qty'  => round((float) ($summary['backorder_qty'] ?? 0), 4),
            'layer_count'    => (int) ($summary['layer_count'] ?? 0),
            'received_qty'   => $receivedQty,
            'received_value' => $receivedValue,
            'unit_cost_min'  => $summary['unit_cost_min'] === null ? null : round((float) $summary['unit_cost_min'], 4),
            'unit_cost_max'  => $summary['unit_cost_max'] === null ? null : round((float) $summary['unit_cost_max'], 4),
            // Weighted by the quantity each layer opened with — the average a
            // rupee of this item actually cost, not the average of the rates.
            'unit_cost_avg'  => $receivedQty > 0 ? round($receivedValue / $receivedQty, 4) : null,
            'first_received_at' => $summary['first_received_at'] ?? null,
            'last_received_at'  => $summary['last_received_at'] ?? null,
        ], 'distribution' => self::distribution($buckets)]);
    }

    /**
     * The four states a cost layer can be in, as SQL predicates.
     *
     * `qty_received IS NULL` is a layer migrated from Books, which recorded no
     * opening quantity. It is untouched stock, not an exhausted layer, so it
     * reads as open rather than falling through to partially consumed.
     */
    private const LAYER_STATE_SQL = [
        'open'     => 'cl.qty_remaining > 0 AND (cl.qty_received IS NULL OR cl.qty_remaining >= cl.qty_received)',
        'partial'  => 'cl.qty_remaining > 0 AND cl.qty_received IS NOT NULL AND cl.qty_remaining < cl.qty_received',
        'closed'   => 'cl.qty_remaining = 0',
        'negative' => 'cl.qty_remaining < 0',
    ];

    private const LAYER_SUMMARY_SELECT = 'COALESCE(SUM(CASE WHEN cl.qty_remaining > 0 THEN cl.qty_remaining ELSE 0 END),0) AS open_qty, COALESCE(SUM(CASE WHEN cl.qty_remaining > 0 THEN cl.qty_remaining * cl.unit_cost ELSE 0 END),0) AS open_value, COALESCE(SUM(CASE WHEN cl.qty_remaining < 0 THEN cl.qty_remaining ELSE 0 END),0) AS backorder_qty, COUNT(*) AS layer_count, COALESCE(SUM(COALESCE(cl.qty_received, cl.qty_remaining)),0) AS received_qty, COALESCE(SUM(COALESCE(cl.qty_received, cl.qty_remaining) * cl.unit_cost),0) AS received_value, MIN(cl.unit_cost) AS unit_cost_min, MAX(cl.unit_cost) AS unit_cost_max, MIN(cl.received_at) AS first_received_at, MAX(cl.received_at) AS last_received_at';

    private const LAYER_BUCKET_SELECT = 'COUNT(*) AS layer_count, COALESCE(SUM(COALESCE(cl.qty_received, cl.qty_remaining)),0) AS total_qty, COALESCE(SUM(COALESCE(cl.qty_received, cl.qty_remaining) * cl.unit_cost),0) AS total_value, COALESCE(SUM(CASE WHEN ' . self::LAYER_STATE_SQL['open'] . ' THEN 1 ELSE 0 END),0) AS open_count, COALESCE(SUM(CASE WHEN ' . self::LAYER_STATE_SQL['open'] . ' THEN COALESCE(cl.qty_received, cl.qty_remaining) ELSE 0 END),0) AS open_qty, COALESCE(SUM(CASE WHEN ' . self::LAYER_STATE_SQL['open'] . ' THEN COALESCE(cl.qty_received, cl.qty_remaining) * cl.unit_cost ELSE 0 END),0) AS open_value, COALESCE(SUM(CASE WHEN ' . self::LAYER_STATE_SQL['partial'] . ' THEN 1 ELSE 0 END),0) AS partial_count, COALESCE(SUM(CASE WHEN ' . self::LAYER_STATE_SQL['partial'] . ' THEN COALESCE(cl.qty_received, cl.qty_remaining) ELSE 0 END),0) AS partial_qty, COALESCE(SUM(CASE WHEN ' . self::LAYER_STATE_SQL['partial'] . ' THEN COALESCE(cl.qty_received, cl.qty_remaining) * cl.unit_cost ELSE 0 END),0) AS partial_value, COALESCE(SUM(CASE WHEN ' . self::LAYER_STATE_SQL['closed'] . ' THEN 1 ELSE 0 END),0) AS closed_count, COALESCE(SUM(CASE WHEN ' . self::LAYER_STATE_SQL['closed'] . ' THEN COALESCE(cl.qty_received, cl.qty_remaining) ELSE 0 END),0) AS closed_qty, COALESCE(SUM(CASE WHEN ' . self::LAYER_STATE_SQL['closed'] . ' THEN COALESCE(cl.qty_received, cl.qty_remaining) * cl.unit_cost ELSE 0 END),0) AS closed_value, COALESCE(SUM(CASE WHEN ' . self::LAYER_STATE_SQL['negative'] . ' THEN 1 ELSE 0 END),0) AS negative_count, COALESCE(SUM(CASE WHEN ' . self::LAYER_STATE_SQL['negative'] . ' THEN COALESCE(cl.qty_received, cl.qty_remaining) ELSE 0 END),0) AS negative_qty, COALESCE(SUM(CASE WHEN ' . self::LAYER_STATE_SQL['negative'] . ' THEN COALESCE(cl.qty_received, cl.qty_remaining) * cl.unit_cost ELSE 0 END),0) AS negative_value';

    /** The state one layer is in — the PHP twin of LAYER_STATE_SQL. */
    private static function layerStatus(?float $qtyReceived, float $qtyRemaining): string
    {
        if ($qtyRemaining < 0) {
            return 'negative';
        }
        if ($qtyRemaining == 0.0) {
            return 'closed';
        }

        return $qtyReceived === null || $qtyRemaining >= $qtyReceived ? 'open' : 'partial';
    }

    /** @param array<string, mixed> $row */
    private static function distribution(array $row): array
    {
        $buckets = [];
        foreach (['open', 'partial', 'closed', 'negative'] as $state) {
            $buckets[] = [
                'status'      => $state,
                'layer_count' => (int) ($row[$state . '_count'] ?? 0),
                'qty'         => round((float) ($row[$state . '_qty'] ?? 0), 4),
                'value'       => round((float) ($row[$state . '_value'] ?? 0), 4),
            ];
        }

        return [
            'layer_count' => (int) ($row['layer_count'] ?? 0),
            'total_qty'   => round((float) ($row['total_qty'] ?? 0), 4),
            'total_value' => round((float) ($row['total_value'] ?? 0), 4),
            'buckets'     => $buckets,
        ];
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
        $b = $this->recalcJobQuery($cmpId, isset($ctx['fy_id']) ? (int) $ctx['fy_id'] : null, true);
        $total = (clone $b)->countAllResults(false);
        $sort = in_array($p['sort'], self::JOB_SORTABLE, true) ? 'j.' . $p['sort'] : 'j.created_at';
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
        // Costing is replayed FORWARD from this date over movements that already exist.
        // A future date can only ever select nothing, so a job queued with one is not a
        // small recalculation — it is a no-op that reads on the register as a completed
        // restatement of a period nobody touched.
        if ($fromDate > date('Y-m-d')) {
            return $this->failStructured(422, 'validation_failed', 'from_date cannot be in the future', ['from_date' => $fromDate]);
        }
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
        $remarks = trim((string) ($body['remarks'] ?? $body['reason'] ?? ''));
        if (mb_strlen($remarks) > self::REMARKS_MAX) {
            return $this->failStructured(422, 'validation_failed', 'remarks must be at most ' . self::REMARKS_MAX . ' characters');
        }
        // A recalculation is not a read: a double-clicked button or a retried request
        // must not restate the same period twice and publish two sets of COGS revisions
        // to Books. Same guard, same table and same replay semantics as documents and
        // reservations — the client sends an Idempotency-Key and gets its first answer
        // back rather than a second job.
        $idem = new IdempotencyService();
        $key = $this->idempotencyKey();
        $hash = IdempotencyService::hashRequest($body);
        if ($replay = $idem->replay($cmpId, $key, 'inventory_valuation_recalc', $hash)) {
            return $this->respond($replay['body'], $replay['status']);
        }
        try {
            $service = new RecalculationService();
            $jobId = $service->enqueue($cmpId, (int) $ctx['fy_id'], $itemId, $fromDate, 'manual', $triggerDocId, $a['session']['uuid'], $dryRun, $remarks !== '' ? $remarks : null);
            if (!empty($body['run_now'])) {
                $service->run($jobId);
            }
            $job = $this->jobQuery($cmpId)->select($this->jobColumns())->where('j.job_id', $jobId)->get()->getRowArray();
        } catch (\Throwable $e) {
            return $this->failFromException($e);
        }
        $cast = $this->castJob($job);
        $resp = ['data' => $cast];
        $idem->remember($cmpId, $key, 'inventory_valuation_recalc', (int) $cast['job_id'], (string) ($cast['job_uuid'] ?? ''), 201, $resp, $hash);

        return $this->respond($resp, 201);
    }

    /**
     * POST /valuation/recalculations/{id}/cancel — drop a job that has not started.
     *
     * Only QUEUED. RUNNING is refused rather than "cancelled": run() replays costing
     * and writes revisions inside one transaction with no cooperative checkpoint to
     * stop at, so flipping the row to CANCELLED under a live replay would leave the
     * register claiming a job was stopped while it went on to publish to Books. The
     * terminal states are refused because there is nothing left to cancel — and
     * COMPLETED especially is not undone by this endpoint. Reversing a completed
     * restatement means recalculating again, which is a new job with its own trail.
     */
    public function cancelRecalc($id = null)
    {
        $a = $this->authorize('valuation.recalculate');
        if (isset($a['response'])) {
            return $a['response'];
        }
        $cmpId = (int) $a['ctx']['cmp_id'];
        $db = \Config\Database::connect();
        $job = $this->jobQuery($cmpId)->select('j.job_id, j.status')->where('j.job_id', (int) $id)->get()->getRowArray();
        if (!$job) {
            return $this->failStructured(404, 'not_found', 'Recalculation job not found');
        }
        if ($job['status'] !== 'QUEUED') {
            return $this->failStructured(409, 'conflict', 'Only a queued recalculation can be cancelled', ['status' => $job['status']]);
        }
        // WHERE status = 'QUEUED' as well as by id: two operators pressing Cancel on
        // the same row, or a worker picking the job up between the read above and this
        // write, must not turn a RUNNING job into a CANCELLED one.
        $db->table('inv_valuation_recalc_jobs')
            ->where('job_id', (int) $id)->where('cmp_id', $cmpId)->where('status', 'QUEUED')
            ->update(['status' => 'CANCELLED', 'cancelled_by' => $a['session']['uuid'] ?? null, 'finished_at' => date('Y-m-d H:i:s')]);
        if ($db->affectedRows() === 0) {
            $now = $this->jobQuery($cmpId)->select('j.status')->where('j.job_id', (int) $id)->get()->getRowArray();

            return $this->failStructured(409, 'conflict', 'Recalculation job is no longer queued', ['status' => $now['status'] ?? null]);
        }
        (new AuditService())->log($cmpId, 'valuation_recalc_job', (int) $id, 'valuation.recalc_cancelled', $a['session']['uuid'] ?? null, []);
        $row = $this->jobQuery($cmpId)->select($this->jobColumns())->where('j.job_id', (int) $id)->get()->getRowArray();

        return $this->respond(['data' => $this->castJob($row)]);
    }

    /**
     * GET /valuation/recalculations/summary — the register's KPI figures.
     *
     * Computed by the server over the WHOLE filtered set, never by the client over the
     * page it was served: a screen showing 50 of 812 jobs cannot count how many failed,
     * and a "success rate" derived from one page is a number no one can reconcile.
     *
     * Every filter the list accepts is applied here EXCEPT `status`, and that is the
     * one deliberate difference: the cards ARE the status breakdown, so narrowing them
     * by status would leave a reader filtered to Failed looking at "Completed 0". The
     * client says so on the cards.
     *
     * The comparatives are real month-over-month figures from the same table — a count
     * of jobs queued this calendar month against last, and the COGS movement finished
     * in each. Nothing here is estimated: where a month has no jobs the value is 0 and
     * the client renders no delta rather than inventing a percentage.
     */
    public function recalcSummary()
    {
        $a = $this->authorizeAny(['valuation.recalculate', 'reports.valuation.read']);
        if (isset($a['response'])) {
            return $a['response'];
        }
        $ctx = $a['ctx'];
        $cmpId = (int) $ctx['cmp_id'];
        $fyId = isset($ctx['fy_id']) ? (int) $ctx['fy_id'] : null;
        // The same builder the rows come from, minus the status filter.
        $scoped = fn () => $this->recalcJobQuery($cmpId, $fyId, false);

        $byStatus = $scoped()->select('j.status, COUNT(*) AS jobs, COALESCE(SUM(j.cogs_delta),0) AS delta', false)->groupBy('j.status')->get()->getResultArray();
        $counts = array_fill_keys(self::JOB_STATUSES, 0);
        $total = 0;
        $cogsDelta = 0.0;
        foreach ($byStatus as $r) {
            $status = (string) $r['status'];
            $counts[$status] = ($counts[$status] ?? 0) + (int) $r['jobs'];
            $total += (int) $r['jobs'];
            $cogsDelta += (float) $r['delta'];
        }

        $monthStart = date('Y-m-01');
        $prevStart = date('Y-m-01', strtotime($monthStart . ' -1 month'));
        $queuedThisMonth = (int) ($scoped()->where('j.created_at >=', $monthStart . ' 00:00:00')->countAllResults());
        $queuedPrevMonth = (int) ($scoped()->where('j.created_at >=', $prevStart . ' 00:00:00')->where('j.created_at <', $monthStart . ' 00:00:00')->countAllResults());
        $deltaThis = $scoped()->select('COALESCE(SUM(j.cogs_delta),0) AS d', false)->where('j.finished_at >=', $monthStart . ' 00:00:00')->get()->getRowArray();
        $deltaPrev = $scoped()->select('COALESCE(SUM(j.cogs_delta),0) AS d', false)->where('j.finished_at >=', $prevStart . ' 00:00:00')->where('j.finished_at <', $monthStart . ' 00:00:00')->get()->getRowArray();

        return $this->respond(['data' => [
            'total'                  => $total,
            'by_status'              => $counts,
            'in_progress'            => ($counts['QUEUED'] ?? 0) + ($counts['RUNNING'] ?? 0),
            'cogs_delta'             => round($cogsDelta, 4),
            'queued_this_month'      => $queuedThisMonth,
            'queued_prev_month'      => $queuedPrevMonth,
            'cogs_delta_this_month'  => round((float) ($deltaThis['d'] ?? 0), 4),
            'cogs_delta_prev_month'  => round((float) ($deltaPrev['d'] ?? 0), 4),
            'month_start'            => $monthStart,
            // What the cards are counted over, so the screen can say it rather than imply it.
            'ignores_status_filter'  => true,
        ]]);
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
            // The scope a job ran under is what the register's SCOPE column reads, and
            // "Warehouse #4" is not a scope anyone recognises. Left-joined like the item
            // because warehouse_id is null on every whole-company job.
            ->join('inv_warehouses w', 'w.warehouse_id = j.warehouse_id', 'left')
            ->join('inv_documents d', 'd.document_id = j.trigger_document_id', 'left')
            ->where('j.cmp_id', $cmpId);
    }

    private function jobColumns(): string
    {
        return 'j.job_id, j.job_uuid, j.cmp_id, j.fy_id, j.item_id, j.warehouse_id, j.from_date, j.to_date, j.trigger_kind, j.trigger_document_id, j.status, j.dry_run, j.affected_documents_json, j.affected_line_count, j.revised_line_count, j.cogs_delta, j.failure_reason, j.remarks, j.requested_by, j.cancelled_by, j.created_at, j.started_at, j.finished_at, i.item_name, i.item_sku, w.warehouse_name, d.document_no AS trigger_document_no, d.document_type AS trigger_document_type';
    }

    /**
     * The recalculation register's filtered set — ONE builder, used by the rows
     * and by the figures above them.
     *
     * Shared deliberately. The list and the summary answer the same question
     * ("which jobs are we looking at") and two copies of that question drift:
     * a filter added to one and forgotten in the other produces a card that
     * disagrees with the table underneath it, which is the single worst failure
     * this screen can have. There is exactly one difference, and it is the
     * parameter: the summary IS the status breakdown, so it is built without
     * the status filter — otherwise a reader narrowed to Failed would be shown
     * "Completed 0".
     *
     * @return \CodeIgniter\Database\BaseBuilder
     */
    private function recalcJobQuery(int $cmpId, ?int $fyId, bool $withStatus)
    {
        $b = $this->jobQuery($cmpId);
        if ((int) ($this->request->getGet('all_fy') ?? 0) !== 1) {
            // `fy_id IS NULL` is a job the engine queued outside any one year; it
            // belongs to whichever year is being looked at rather than to none.
            $b->groupStart()->where('j.fy_id', (int) $fyId)->orWhere('j.fy_id', null)->groupEnd();
        }
        if ($withStatus) {
            $status = trim((string) ($this->request->getGet('status') ?? ''));
            if ($status !== '') {
                $b->whereIn('j.status', array_map('strtoupper', array_filter(array_map('trim', explode(',', $status)))));
            }
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
        if ($warehouseId = (int) ($this->request->getGet('warehouse_id') ?? 0)) {
            $b->where('j.warehouse_id', $warehouseId);
        }
        if (($this->request->getGet('dry_run') ?? '') !== '') {
            $b->where('j.dry_run', (int) $this->request->getGet('dry_run') === 1 ? 1 : 0);
        }
        // Jobs that actually moved money, for a reader reconciling against Books.
        if ((int) ($this->request->getGet('has_cogs_impact') ?? 0) === 1) {
            $b->where('j.cogs_delta <>', 0);
        }
        $field = $this->dateField();
        // `from_date` is a DATE: appending a time to it would make `to` exclude
        // every job whose effective date IS that day.
        $suffixFrom = $field === 'from_date' ? '' : ' 00:00:00';
        $suffixTo = $field === 'from_date' ? '' : ' 23:59:59';
        if ($from = $this->dateParam('from')) {
            $b->where('j.' . $field . ' >=', $from . $suffixFrom);
        }
        if ($to = $this->dateParam('to')) {
            $b->where('j.' . $field . ' <=', $to . $suffixTo);
        }
        $this->applyJobSearch($b, (string) ($this->request->getGet('q') ?? ''));

        return $b;
    }

    /** Which job timestamp `?from=` / `?to=` narrow. Unknown values fall back to queued. */
    private function dateField(): string
    {
        $raw = strtolower(trim((string) ($this->request->getGet('date_field') ?? '')));

        return self::JOB_DATE_FIELDS[$raw] ?? 'created_at';
    }

    /**
     * The register's free-text box, over the words the register actually shows.
     *
     * Deliberately not a full-text index: the job table is small (one row per
     * recalculation, not per line) and the columns searched are the ones a reader
     * can see on screen — the reference, the item, the trigger, the failure, the
     * reason typed at the time. Searching anything they cannot see would return
     * rows they cannot explain.
     *
     * Case-insensitive through the builder's own flag, the way AuditController and
     * MasterController already search — so `Invalid cost layer` is found by typing
     * `invalid`, and the escaping of a `%` or `_` in the box stays the builder's job
     * rather than this method's.
     *
     * @param \CodeIgniter\Database\BaseBuilder $b
     */
    private function applyJobSearch($b, string $raw): void
    {
        $q = trim($raw);
        if ($q === '') {
            return;
        }
        $b->groupStart();
        foreach (['j.trigger_kind', 'j.failure_reason', 'j.remarks', 'j.requested_by', 'i.item_name', 'i.item_sku', 'w.warehouse_name', 'd.document_no'] as $i => $col) {
            $i === 0 ? $b->like($col, $q, 'both', null, true) : $b->orLike($col, $q, 'both', null, true);
        }
        // "RC-00012" and "12" both find job 12: the reference on screen is the id,
        // zero-padded and prefixed by the client, and a reader pastes what they see.
        if (($digits = ltrim(preg_replace('/\D+/', '', $q) ?: '', '0')) !== '') {
            $b->orWhere('j.job_id', (int) $digits);
        }
        $b->groupEnd();
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
