<?php

namespace App\Controllers\Api\V1;

use App\Controllers\Api\BaseController;
use App\Services\OpeningStockResolver;
use App\Services\StockBalanceService;
use App\Services\UnitConversionService;
use Config\DocumentTypeRegistry;

/**
 * /api/v1/stock-movements — the append-only stock ledger (inv_stock_movements), and
 * /api/v1/stock-ledger  — one item's ledger with opening, running balance and closing.
 */
class StockMovementsController extends BaseController
{
    private const MOVEMENT_COLUMNS = 'm.movement_id, m.movement_uuid, m.cmp_id, m.fy_id, m.bo_id, m.document_id, m.line_id, m.document_type, m.movement_date, m.sequence_no, m.item_id, m.warehouse_id, m.location_id, m.batch_id, m.direction, m.qty, m.unit_cost, m.value, m.movement_kind, m.reversal_of_movement_id, m.created_at, m.created_by, '
        . 'i.item_name, i.item_alias, i.item_sku, i.unit_id, i.stock_cat_id, i.item_grp_id, c.cat_name, u.unit_symbol, w.warehouse_name, w.warehouse_code, bt.batch_no, '
        . 'd.document_no, d.status AS document_status, d.source_app, d.source_document_type, d.source_document_id, d.source_document_no, d.party_ref, d.party_name, '
        // A movement row stands in ONE warehouse, because that is what it did to
        // stock. A transfer is two of them, so the counterparty is carried from the
        // document: the register can then read "WH-A -> WH-B" on the line without
        // inventing a second warehouse for a row that only ever had one.
        . 'd.from_warehouse_id, d.to_warehouse_id, fw.warehouse_name AS from_warehouse_name, tw.warehouse_name AS to_warehouse_name';

    public const SORTABLE = ['movement_date' => 'm.movement_date', 'movement_id' => 'm.movement_id', 'item_id' => 'm.item_id', 'item_name' => 'i.item_name', 'qty' => 'm.qty', 'value' => 'm.value', 'unit_cost' => 'm.unit_cost', 'direction' => 'm.direction', 'document_type' => 'm.document_type', 'document_no' => 'd.document_no', 'warehouse_id' => 'm.warehouse_id', 'warehouse_name' => 'w.warehouse_name', 'batch_no' => 'bt.batch_no', 'source_app' => 'd.source_app', 'created_at' => 'm.created_at'];

    /**
     * Longest trend the endpoint will draw, in buckets.
     *
     * The bucket width is chosen from the span asked for (day / week / month), so
     * this is a backstop against an unbounded `all_fy=1` register on a company with
     * a decade of history, not the normal path.
     */
    private const TREND_MAX_POINTS = 400;

    /**
     * GET /stock-movements
     *
     * Filters: item_id, warehouse_id, document_id, batch_id, line_id, document_type (csv),
     * from, to, direction (in|out), movement_kind (physical|reversal|revaluation),
     * stock_cat_id, item_grp_id, brand_id, source_app, q, all_fy=1 to span financial years.
     *
     * `summary=1` adds an aggregate over the WHOLE filtered set — not the served page —
     * plus the same aggregate over the window immediately before it, so the register can
     * show a comparison it did not invent. `trend=1` adds the inward / outward series over
     * the same filters, bucketed by day, week or month according to the span asked for.
     * Both are opt-in because they are extra aggregates: the export pager walks every page
     * of the same query and wants neither.
     */
    public function index()
    {
        $a = $this->authorizeAny(['reports.stock_ledger.read', 'documents.read']);
        if (isset($a['response'])) {
            return $a['response'];
        }
        $ctx = $a['ctx'];
        $cmpId = (int) $ctx['cmp_id'];
        $p = $this->listParams(50, 500, 'movement_date');
        $from = $this->dateParam('from');
        $to = $this->dateParam('to');
        if ($from !== null && $to !== null && $from > $to) {
            return $this->failStructured(422, 'validation_failed', 'from must not be after to', ['from' => $from, 'to' => $to]);
        }

        $b = $this->filteredMovements($cmpId, $ctx, $from, $to);
        $total = (clone $b)->countAllResults(false);
        $sort = self::SORTABLE[$p['sort']] ?? 'm.movement_date';
        $rows = (clone $b)->select(self::MOVEMENT_COLUMNS)
            ->orderBy($sort, $p['order'])->orderBy('m.document_id', $p['order'])->orderBy('m.sequence_no', $p['order'])->orderBy('m.movement_id', $p['order'])
            ->limit($p['limit'], $p['offset'])->get()->getResultArray();
        foreach ($rows as &$r) {
            $r = $this->castMovement($r);
        }
        unset($r);

        $extra = [];
        if ((int) ($this->request->getGet('summary') ?? 0) === 1) {
            $summary = self::summarise(clone $b);
            $summary['from'] = $from;
            $summary['to'] = $to;
            // The comparison is the same question over the preceding window of the same
            // length, under every other filter unchanged — including the financial year,
            // which is why a window that falls outside it comes back empty rather than
            // quietly widening the scope. An empty one is reported as it is; the client
            // draws no percentage against zero.
            $summary['previous'] = null;
            $window = self::previousWindow($from, $to);
            if ($window !== null) {
                $summary['previous'] = array_merge(
                    self::summarise($this->filteredMovements($cmpId, $ctx, $window['from'], $window['to'])),
                    ['from' => $window['from'], 'to' => $window['to']]
                );
            }
            $extra['summary'] = $summary;
        }
        if ((int) ($this->request->getGet('trend') ?? 0) === 1) {
            $extra['trend'] = self::trendOver(clone $b, $from, $to);
        }

        return $this->respondList($rows, $total, $p['limit'], $p['offset'], $extra);
    }

    /**
     * GET /stock-ledger?item_id=&warehouse_id=&from=&to=
     * Opening as at `from` (FY opening + every movement before `from`), then each movement in the
     * range with running quantity and value, then closing. All quantities are base units.
     */
    public function ledger()
    {
        $a = $this->authorize('reports.stock_ledger.read');
        if (isset($a['response'])) {
            return $a['response'];
        }
        $ctx = $a['ctx'];
        $cmpId = (int) $ctx['cmp_id'];
        $fyId = (int) $ctx['fy_id'];
        $boId = (int) $ctx['bo_id'];
        $itemId = (int) ($this->request->getGet('item_id') ?? 0);
        if ($itemId <= 0) {
            return $this->failStructured(422, 'validation_failed', 'item_id is required');
        }
        $warehouseId = (int) ($this->request->getGet('warehouse_id') ?? 0) ?: null;
        $from = $this->dateParam('from');
        $to = $this->dateParam('to') ?: date('Y-m-d');
        if ($from !== null && $from > $to) {
            return $this->failStructured(422, 'validation_failed', 'from must not be after to', ['from' => $from, 'to' => $to]);
        }
        $db = \Config\Database::connect();
        $item = $db->table('inv_items i')->select('i.item_id, i.item_name, i.item_alias, i.item_sku, i.unit_id, i.valuation_method, u.unit_symbol, u.unit_name')
            ->join('inv_uom u', 'u.unit_id = i.unit_id', 'left')
            ->where('i.cmp_id', $cmpId)->where('i.item_id', $itemId)->get()->getRowArray();
        if (!$item) {
            return $this->failStructured(404, 'not_found', 'Item not found');
        }
        $warehouse = null;
        if ($warehouseId !== null) {
            $warehouse = $db->table('inv_warehouses')->select('warehouse_id, warehouse_name, warehouse_code')->where('cmp_id', $cmpId)->where('warehouse_id', $warehouseId)->get()->getRowArray();
            if (!$warehouse) {
                return $this->failStructured(404, 'not_found', 'Warehouse not found');
            }
        }

        try {
            $units = new UnitConversionService();
            $openings = new OpeningStockResolver($units);
            $balances = new StockBalanceService($units, $openings);

            // --- Opening as at `from`: FY opening rows + every movement dated before `from`.
            $fyOpeningQty = 0.0;
            $fyOpeningValue = 0.0;
            foreach ($openings->openingLines($cmpId, $fyId, [$itemId]) as $line) {
                if ($warehouseId !== null && (int) ($line['warehouse_id'] ?? 0) !== $warehouseId) {
                    continue;
                }
                $layer = OpeningStockResolver::layerFromOpeningLine($line);
                if ($layer === null) {
                    continue;
                }
                $fyOpeningQty += $layer['qty_remaining'];
                $fyOpeningValue += $layer['qty_remaining'] * $layer['unit_cost'];
            }
            $openingQty = round($fyOpeningQty, 4);
            $openingValue = round($fyOpeningValue, 4);
            if ($from !== null) {
                $dayBefore = date('Y-m-d', strtotime($from . ' -1 day'));
                $openingQty = 0.0;
                foreach ($balances->closingQuantities($cmpId, $fyId, $boId, null, $dayBefore, $itemId, $warehouseId) as $r) {
                    $openingQty += (float) $r['closing_qty'];
                }
                $openingQty = round($openingQty, 4);
                $before = $this->movementQuery($cmpId)->select('COALESCE(SUM(m.value), 0) AS v', false)
                    ->where('m.fy_id', $fyId)->where('m.item_id', $itemId)->where('m.movement_date <', $from);
                if ($boId > 0) {
                    $before->where('m.bo_id', $boId);
                }
                if ($warehouseId !== null) {
                    $before->where('m.warehouse_id', $warehouseId);
                }
                $openingValue = round($fyOpeningValue + (float) ($before->get()->getRowArray()['v'] ?? 0), 4);
            }

            // --- Movements in range, chronological, with running balances.
            $b = $this->movementQuery($cmpId)->select(self::MOVEMENT_COLUMNS)
                ->where('m.fy_id', $fyId)->where('m.item_id', $itemId)->where('m.movement_date <=', $to);
            if ($from !== null) {
                $b->where('m.movement_date >=', $from);
            }
            if ($boId > 0) {
                $b->where('m.bo_id', $boId);
            }
            if ($warehouseId !== null) {
                $b->where('m.warehouse_id', $warehouseId);
            }
            $rows = $b->orderBy('m.movement_date', 'ASC')->orderBy('m.document_id', 'ASC')->orderBy('m.sequence_no', 'ASC')->orderBy('m.line_id', 'ASC')->orderBy('m.movement_id', 'ASC')
                ->get()->getResultArray();

            $runQty = $openingQty;
            $runValue = $openingValue;
            $inQty = $inValue = $outQty = $outValue = 0.0;
            foreach ($rows as &$r) {
                $r = $this->castMovement($r);
                $qty = (float) $r['qty'];
                $value = (float) ($r['value'] ?? 0);
                if ($qty >= 0) {
                    $r['in_qty'] = round($qty, 4);
                    $r['out_qty'] = 0.0;
                    $r['in_value'] = round($value, 4);
                    $r['out_value'] = 0.0;
                    $inQty += $qty;
                    $inValue += $value;
                } else {
                    $r['in_qty'] = 0.0;
                    $r['out_qty'] = round(-$qty, 4);
                    $r['in_value'] = 0.0;
                    $r['out_value'] = round(-$value, 4);
                    $outQty += -$qty;
                    $outValue += -$value;
                }
                $runQty = round($runQty + $qty, 4);
                $runValue = round($runValue + $value, 4);
                $r['running_qty'] = $runQty;
                $r['running_value'] = $runValue;
                $r['running_unit_cost'] = abs($runQty) > 0.00001 ? round($runValue / $runQty, 4) : null;
            }
            unset($r);
        } catch (\Throwable $e) {
            return $this->failFromException($e);
        }

        return $this->respond(['data' => [
            'item'         => $item,
            'warehouse'    => $warehouse,
            'warehouse_id' => $warehouseId,
            'fy_id'        => $fyId,
            'from'         => $from,
            'to'           => $to,
            'opening'      => ['qty' => $openingQty, 'value' => $openingValue, 'unit_cost' => abs($openingQty) > 0.00001 ? round($openingValue / $openingQty, 4) : null],
            'rows'         => $rows,
            'totals'       => ['in_qty' => round($inQty, 4), 'in_value' => round($inValue, 4), 'out_qty' => round($outQty, 4), 'out_value' => round($outValue, 4)],
            'closing'      => ['qty' => $runQty, 'value' => $runValue, 'unit_cost' => abs($runQty) > 0.00001 ? round($runValue / $runQty, 4) : null],
        ], 'meta' => ['count' => count($rows)]]);
    }

    // ------------------------------------------------------------------ helpers

    private function movementQuery(int $cmpId)
    {
        return \Config\Database::connect()->table('inv_stock_movements m')
            ->join('inv_items i', 'i.item_id = m.item_id AND i.cmp_id = m.cmp_id', 'left')
            ->join('inv_uom u', 'u.unit_id = i.unit_id', 'left')
            ->join('inv_stock_categories c', 'c.stock_cat_id = i.stock_cat_id', 'left')
            ->join('inv_warehouses w', 'w.warehouse_id = m.warehouse_id', 'left')
            ->join('inv_batches bt', 'bt.batch_id = m.batch_id', 'left')
            ->join('inv_documents d', 'd.document_id = m.document_id', 'left')
            ->join('inv_warehouses fw', 'fw.warehouse_id = d.from_warehouse_id', 'left')
            ->join('inv_warehouses tw', 'tw.warehouse_id = d.to_warehouse_id', 'left')
            ->where('m.cmp_id', $cmpId);
    }

    /**
     * The movement query with every read filter applied, and nothing selected yet.
     *
     * One place, because the page, the row count, the aggregate, the comparison window and
     * the trend must all be the same question. A filter applied to the rows but forgotten
     * on the aggregate is a KPI card that contradicts the table beneath it, and the reader
     * has no way to tell which of the two is wrong.
     *
     * `$from` / `$to` are passed rather than read here so the comparison window can reuse
     * the whole filter set with only the period swapped.
     *
     * @param array<string, mixed> $ctx
     */
    private function filteredMovements(int $cmpId, array $ctx, ?string $from, ?string $to)
    {
        $b = $this->movementQuery($cmpId);
        if ((int) ($this->request->getGet('all_fy') ?? 0) !== 1) {
            $b->where('m.fy_id', (int) $ctx['fy_id']);
        }
        if ((int) $ctx['bo_id'] > 0) {
            $b->where('m.bo_id', (int) $ctx['bo_id']);
        }
        foreach (['item_id', 'warehouse_id', 'document_id', 'batch_id', 'line_id'] as $f) {
            $v = (int) ($this->request->getGet($f) ?? 0);
            if ($v > 0) {
                $b->where('m.' . $f, $v);
            }
        }
        // Item-master filters. The register offers them because "what moved in this
        // category this month" is an inventory question, and the items table is already
        // joined for the name — so they cost a WHERE, not a second query.
        foreach (['stock_cat_id', 'item_grp_id', 'brand_id'] as $f) {
            $v = (int) ($this->request->getGet($f) ?? 0);
            if ($v > 0) {
                $b->where('i.' . $f, $v);
            }
        }
        $types = trim((string) ($this->request->getGet('document_type') ?? ''));
        if ($types !== '') {
            $b->whereIn('m.document_type', array_map('strtoupper', array_filter(array_map('trim', explode(',', $types)))));
        }
        $direction = strtolower(trim((string) ($this->request->getGet('direction') ?? '')));
        if (in_array($direction, ['in', 'out'], true)) {
            $b->where('m.direction', $direction);
        }
        $kind = strtolower(trim((string) ($this->request->getGet('movement_kind') ?? '')));
        if (in_array($kind, ['physical', 'reversal', 'revaluation'], true)) {
            $b->where('m.movement_kind', $kind);
        }
        $source = trim((string) ($this->request->getGet('source_app') ?? ''));
        if ($source !== '') {
            $b->where('d.source_app', $source);
        }
        if ($from !== null) {
            $b->where('m.movement_date >=', $from);
        }
        if ($to !== null) {
            $b->where('m.movement_date <=', $to);
        }
        if ($q = trim((string) ($this->request->getGet('q') ?? ''))) {
            // Everything the register's own search box says it looks in: the item (name or
            // code), the document, the batch and the reference the source product gave it.
            $b->groupStart()
                ->like('i.item_name', $q, 'both', null, true)
                ->orLike('i.item_sku', $q, 'both', null, true)
                ->orLike('d.document_no', $q, 'both', null, true)
                ->orLike('bt.batch_no', $q, 'both', null, true)
                ->orLike('d.source_document_no', $q, 'both', null, true)
                ->orLike('d.party_name', $q, 'both', null, true)
                ->groupEnd();
        }

        return $b;
    }

    /**
     * Inward, outward and net over whatever the builder matches.
     *
     * Public and static for the same reason `DocumentsController::summarise` is: it is
     * hand-written aggregate SQL, and the only test worth having is one that runs it
     * against a real PostgreSQL and checks the figures. A mocked builder would prove the
     * method returns an array and nothing about whether the query is valid or correct.
     *
     * In / out is decided by the SIGN of the quantity, exactly as `ledger()` decides it a
     * few lines up — a reversal of a receipt carries direction 'in' and a negative
     * quantity, and classifying it as inward would report goods arriving that left.
     *
     * Quantities are base units of each item, so a total across items is a count of units
     * and not of anything physical. That is what the register has always summed and what
     * the footer says; the screen says so too, beside the chart.
     */
    public static function summarise($b): array
    {
        $row = $b->select(
            'COUNT(*) AS movements, '
            . 'COUNT(DISTINCT m.item_id) AS items, '
            . 'COUNT(DISTINCT m.document_id) AS documents, '
            . 'COALESCE(SUM(CASE WHEN m.qty >= 0 THEN m.qty ELSE 0 END), 0) AS in_qty, '
            . 'COALESCE(SUM(CASE WHEN m.qty < 0 THEN -m.qty ELSE 0 END), 0) AS out_qty, '
            . 'COALESCE(SUM(m.qty), 0) AS net_qty, '
            . 'COALESCE(SUM(CASE WHEN m.qty >= 0 THEN COALESCE(m.value, 0) ELSE 0 END), 0) AS in_value, '
            . 'COALESCE(SUM(CASE WHEN m.qty < 0 THEN -COALESCE(m.value, 0) ELSE 0 END), 0) AS out_value, '
            . 'COALESCE(SUM(COALESCE(m.value, 0)), 0) AS net_value',
            false
        )->get()->getRowArray() ?: [];

        return [
            'movements' => (int) ($row['movements'] ?? 0),
            'items'     => (int) ($row['items'] ?? 0),
            'documents' => (int) ($row['documents'] ?? 0),
            'in_qty'    => round((float) ($row['in_qty'] ?? 0), 4),
            'out_qty'   => round((float) ($row['out_qty'] ?? 0), 4),
            'net_qty'   => round((float) ($row['net_qty'] ?? 0), 4),
            'in_value'  => round((float) ($row['in_value'] ?? 0), 4),
            'out_value' => round((float) ($row['out_value'] ?? 0), 4),
            'net_value' => round((float) ($row['net_value'] ?? 0), 4),
        ];
    }

    /**
     * The window immediately before `[$from, $to]`, of the same length.
     *
     * Null when the register is not bounded at both ends: "the period before all of time"
     * is not a window, and a comparison drawn against a half-open range would be a
     * percentage computed from two different lengths of time.
     *
     * @return array{from:string, to:string}|null
     */
    public static function previousWindow(?string $from, ?string $to): ?array
    {
        if ($from === null || $to === null || $from > $to) {
            return null;
        }
        $days = (int) floor((strtotime($to) - strtotime($from)) / 86400) + 1;
        $prevTo = date('Y-m-d', strtotime($from . ' -1 day'));
        $prevFrom = date('Y-m-d', strtotime($prevTo . ' -' . ($days - 1) . ' day'));

        return ['from' => $prevFrom, 'to' => $prevTo];
    }

    /**
     * Inward / outward per bucket over the filtered set.
     *
     * Public and static so the bucketing can be tested against a real database — see
     * `summarise` above.
     *
     * The bucket widens with the span asked for, so a day register draws days and a
     * financial year draws weeks rather than 365 columns two pixels wide. The width is
     * reported with the series: a chart that does not say what a bar covers is a chart
     * whose reader will assume days.
     */
    public static function trendOver($b, ?string $from, ?string $to): array
    {
        $days = ($from !== null && $to !== null)
            ? (int) floor((strtotime($to) - strtotime($from)) / 86400) + 1
            : null;
        $bucket = ($days === null || $days > 400) ? 'month' : ($days > 62 ? 'week' : 'day');
        $expr = $bucket === 'day'
            ? 'm.movement_date'
            : "date_trunc('" . $bucket . "', m.movement_date)::date";

        $rows = $b->select(
            $expr . ' AS bucket, '
            . 'COUNT(*) AS movements, '
            . 'COALESCE(SUM(CASE WHEN m.qty >= 0 THEN m.qty ELSE 0 END), 0) AS in_qty, '
            . 'COALESCE(SUM(CASE WHEN m.qty < 0 THEN -m.qty ELSE 0 END), 0) AS out_qty, '
            . 'COALESCE(SUM(CASE WHEN m.qty >= 0 THEN COALESCE(m.value, 0) ELSE 0 END), 0) AS in_value, '
            . 'COALESCE(SUM(CASE WHEN m.qty < 0 THEN -COALESCE(m.value, 0) ELSE 0 END), 0) AS out_value',
            false
        )->groupBy($expr, false)->orderBy($expr, 'ASC', false)
            ->limit(self::TREND_MAX_POINTS)->get()->getResultArray();

        $points = [];
        foreach ($rows as $r) {
            $points[] = [
                'bucket'    => substr((string) $r['bucket'], 0, 10),
                'movements' => (int) $r['movements'],
                'in_qty'    => round((float) $r['in_qty'], 4),
                'out_qty'   => round((float) $r['out_qty'], 4),
                'in_value'  => round((float) $r['in_value'], 4),
                'out_value' => round((float) $r['out_value'], 4),
            ];
        }

        return [
            'bucket'    => $bucket,
            'from'      => $from,
            'to'        => $to,
            // Says outright that the series was cut, rather than leaving the chart to end
            // early and read as "nothing happened after this".
            'truncated' => count($points) >= self::TREND_MAX_POINTS,
            'points'    => $points,
        ];
    }

    /** @param array<string, mixed> $r @return array<string, mixed> */
    private function castMovement(array $r): array
    {
        foreach (['movement_id', 'cmp_id', 'fy_id', 'bo_id', 'document_id', 'line_id', 'sequence_no', 'item_id', 'warehouse_id', 'location_id', 'batch_id', 'unit_id', 'stock_cat_id', 'item_grp_id', 'from_warehouse_id', 'to_warehouse_id', 'reversal_of_movement_id', 'source_document_id', 'party_ref'] as $k) {
            if (array_key_exists($k, $r)) {
                $r[$k] = $r[$k] === null ? null : (int) $r[$k];
            }
        }
        foreach (['qty', 'unit_cost', 'value'] as $k) {
            if (array_key_exists($k, $r)) {
                $r[$k] = $r[$k] === null ? null : round((float) $r[$k], 4);
            }
        }
        $r['document_type_label'] = DocumentTypeRegistry::get((string) ($r['document_type'] ?? ''))['label'] ?? ($r['document_type'] ?? null);

        return $r;
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
