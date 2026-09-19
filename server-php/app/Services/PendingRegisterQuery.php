<?php

namespace App\Services;

/**
 * The read side of the pending-quantity register.
 *
 * PendingQuantityService owns the lifecycle — opening rows, settling them,
 * cancelling them. This owns the question the register asks of them, and it asks
 * it in SQL: filtering, ordering, paging and every aggregate happen in Postgres,
 * over indexes, and only one page of rows ever crosses into PHP.
 *
 * That is the whole reason this class exists. The register used to load every open
 * pending row for the company into an array, sort the array, and slice a page out
 * of it — correct on a thousand rows and fatal on a million, and it made the
 * "totals over the whole filtered set" promise cost a full table read on every
 * keystroke. Nothing here reads more than it reports.
 *
 * Scope: deliberately NOT financial-year scoped. Goods sent to a job worker in
 * February are still out in April, and dropping them at the year boundary would
 * understate ITC-04 and every open challan. The branch comes from the document
 * that raised the row, the way the document register does it — a pending line has
 * no branch of its own.
 */
class PendingRegisterQuery
{
    public const KINDS = ['challan', 'deferred_purchase', 'job_work'];

    /** Display statuses the register filters on. `open` means open + partial. */
    public const STATUSES = ['open', 'partial', 'overdue', 'settling', 'settled', 'cancelled'];

    public const PRIORITIES = ['high', 'medium', 'low'];

    /**
     * Sort keys the register offers, mapped to the SQL they order by.
     *
     * A key absent from here is not honoured — SmartTable only draws a sort control
     * for a column that declares one, and a control the endpoint silently ignores
     * moves the arrow and returns the same rows, which reads as "sorted", wrongly.
     */
    public const SORTABLE = [
        'document_date'    => 'd.document_date',
        'document_no'      => 'd.document_no',
        'document_type'    => 'd.document_type',
        'pending_kind'     => 'p.pending_kind',
        'direction'        => 'p.direction',
        'item_name'        => 'i.item_name',
        'warehouse_name'   => 'w.warehouse_name',
        'party_name'       => 'd.party_name',
        'party_ref'        => 'p.party_ref',
        'qty_original'     => 'p.qty_original',
        'qty_settled'      => 'p.qty_settled',
        'qty_open'         => '(p.qty_original - p.qty_settled)',
        'status'           => 'p.status',
        'last_activity_at' => 'COALESCE(p.updated_at, p.created_at)',
        // Null = the expression depends on the company's policy thresholds and is
        // built in orderBy(). They are listed HERE rather than in a second constant
        // so this stays the single whitelist: the web app's configs test reads it to
        // prove no column offers a sort the endpoint would silently ignore, and a
        // second list is a second thing to forget.
        'ageing_days'      => null,
        'pending_value'    => null,
        'due_date'         => null,
        'priority'         => null,
    ];

    /**
     * Rows the trend series is worth computing over.
     *
     * The sparkline reconstructs the open position at six past dates, which costs a
     * pass over the filtered set per point. Past this many rows the cost stops being
     * worth a 60-pixel picture, so the series is omitted and the cards render with
     * no sparkline — which is what StatCard does when it is handed nothing.
     */
    private const TREND_ROW_LIMIT = 50000;

    /** @var array{grace_days:int, high_overdue_days:int, high_ageing_days:int, high_value:float, settling_window_days:int} */
    private array $policy;

    private \CodeIgniter\Database\BaseConnection $db;

    /** SQL expression for the per-unit inventory cost of a pending line. */
    private string $unitCostSql;

    public function __construct(private int $cmpId, private int $boId = 0)
    {
        $this->db = \Config\Database::connect();
        $this->policy = (new PendingRegisterPolicy())->forCompany($cmpId);

        // Pending value is stated AT COST, on Inventory's own costing basis, never at
        // a selling price: the line's captured valuation rate first (that is what the
        // document actually moved the stock at), falling back to the item's weighted
        // average when a line carries none. The WAC row is picked at the scope the
        // company values stock at — a warehouse-scoped company would otherwise be
        // costed against a company-wide average it does not keep.
        $scope = 'company';
        try {
            $scope = (new InventorySettingsService())->valuationScope($cmpId);
        } catch (\Throwable) {
            $scope = 'company';
        }
        $this->wacJoinOn = $scope === 'warehouse'
            ? 'wc.cmp_id = p.cmp_id AND wc.item_id = p.item_id AND wc.warehouse_id = COALESCE(p.warehouse_id, 0)'
            : 'wc.cmp_id = p.cmp_id AND wc.item_id = p.item_id AND wc.warehouse_id = 0';
        $this->unitCostSql = 'COALESCE(NULLIF(dl.valuation_rate, 0), NULLIF(wc.average_cost, 0), 0)';
    }

    private string $wacJoinOn;

    /* ------------------------------------------------------------ SQL parts */

    /**
     * The policy thresholds, interpolated rather than bound.
     *
     * They are integers and floats this class casts itself, read from a settings row
     * and never from the request, so there is nothing here for a bind to protect
     * against. Interpolating them keeps the bind list positional and readable: these
     * expressions appear in the SELECT, the WHERE and the ORDER BY of the same
     * statement, and threading five repeated binds through all three in the right
     * order is how an off-by-one filter gets written.
     */
    private function graceDays(): int
    {
        return (int) $this->policy['grace_days'];
    }

    /** The date a line is due back or due in. The document's promise where it made one. */
    private function dueSql(): string
    {
        return 'COALESCE(d.expected_return_date, d.document_date + ' . $this->graceDays() . ')';
    }

    private function qtyOpenSql(): string
    {
        return '(p.qty_original - p.qty_settled)';
    }

    private function pendingValueSql(): string
    {
        return '((p.qty_original - p.qty_settled) * ' . $this->unitCostSql . ')';
    }

    private function ageingSql(): string
    {
        return '(CURRENT_DATE - d.document_date)';
    }

    /** The register's display status, which is not the stored one — see the class note. */
    private function statusSql(): string
    {
        $due = $this->dueSql();
        $window = (int) $this->policy['settling_window_days'];

        return "CASE
            WHEN p.status = 'cancelled' THEN 'cancelled'
            WHEN p.status = 'settled' THEN 'settled'
            WHEN {$due} < CURRENT_DATE THEN 'overdue'
            WHEN p.qty_settled > 0 AND COALESCE(p.updated_at, p.created_at) >= (CURRENT_DATE - {$window}) THEN 'settling'
            WHEN p.qty_settled > 0 THEN 'partial'
            ELSE 'open'
        END";
    }

    /**
     * Priority, as a score over four facts the register already knows.
     *
     * Deliberately additive rather than a ladder of special cases: a line that is
     * merely late scores 1 and reads medium, and it takes a second reason — badly
     * late, materially valuable, or very old — to make it high. A single rule that
     * fired on value alone would mark every expensive line urgent on the day it was
     * raised.
     */
    private function prioritySql(): string
    {
        $due = $this->dueSql();
        $value = $this->pendingValueSql();
        $ageing = $this->ageingSql();
        $overdueDays = (int) $this->policy['high_overdue_days'];
        $ageingDays = (int) $this->policy['high_ageing_days'];
        $highValue = (float) $this->policy['high_value'];

        $score = "((CASE WHEN {$due} < CURRENT_DATE THEN 1 ELSE 0 END)
            + (CASE WHEN {$due} < (CURRENT_DATE - {$overdueDays}) THEN 1 ELSE 0 END)
            + (CASE WHEN {$value} >= {$highValue} THEN 1 ELSE 0 END)
            + (CASE WHEN {$ageing} >= {$ageingDays} THEN 1 ELSE 0 END))";

        return "CASE WHEN {$score} >= 2 THEN 'high' WHEN {$score} = 1 THEN 'medium' ELSE 'low' END";
    }

    private function fromSql(): string
    {
        return ' FROM inv_pending_quantities p'
            . ' JOIN inv_documents d ON d.document_id = p.document_id'
            . ' LEFT JOIN inv_items i ON i.item_id = p.item_id'
            . ' LEFT JOIN inv_uom u ON u.unit_id = p.unit_id'
            . ' LEFT JOIN inv_warehouses w ON w.warehouse_id = p.warehouse_id'
            . ' LEFT JOIN inv_document_lines dl ON dl.line_id = p.line_id'
            . ' LEFT JOIN inv_wac_state wc ON ' . $this->wacJoinOn;
    }

    /* ------------------------------------------------------------- filtering */

    /**
     * Normalise the request into the filter set this class understands.
     *
     * Unknown values are dropped rather than passed through: a status the register
     * cannot render or a kind the table does not store would otherwise become a
     * WHERE clause that quietly matches nothing.
     *
     * @param array<string, mixed> $input
     * @return array<string, mixed>
     */
    public static function normaliseFilters(array $input): array
    {
        $str = static fn ($v) => trim((string) ($v ?? ''));
        $num = static function ($v): ?float {
            $s = trim((string) ($v ?? ''));

            return $s === '' || !is_numeric($s) ? null : (float) $s;
        };
        $id = static function ($v): ?int {
            $n = (int) ($v ?? 0);

            return $n > 0 ? $n : null;
        };
        $csv = static function ($v, array $allowed): array {
            $raw = is_array($v) ? $v : explode(',', (string) ($v ?? ''));
            $out = [];
            foreach ($raw as $one) {
                $one = strtolower(trim((string) $one));
                if ($one !== '' && in_array($one, $allowed, true) && !in_array($one, $out, true)) {
                    $out[] = $one;
                }
            }

            return $out;
        };
        $date = static function ($v): ?string {
            $s = trim((string) ($v ?? ''));

            return preg_match('/^\d{4}-\d{2}-\d{2}$/', $s) === 1 ? $s : null;
        };
        $flag = static fn ($v) => in_array(strtolower(trim((string) ($v ?? ''))), ['1', 'true', 'yes', 'on'], true);

        $kind = strtolower($str($input['kind'] ?? null));
        $direction = strtolower($str($input['direction'] ?? null));

        return [
            'pending_id'    => $id($input['pending_id'] ?? null),
            'kind'          => in_array($kind, self::KINDS, true) ? $kind : null,
            'direction'     => in_array($direction, ['in', 'out'], true) ? $direction : null,
            'item_id'       => $id($input['item_id'] ?? null),
            'item_search'   => $str($input['item_search'] ?? ($input['q'] ?? null)),
            'warehouse_id'  => $id($input['warehouse_id'] ?? null),
            'party_ref'     => $id($input['party_ref'] ?? null),
            'document_id'   => $id($input['document_id'] ?? null),
            'document_no'   => $str($input['document_no'] ?? null),
            'document_type' => $str($input['document_type'] ?? null),
            'from_date'     => $date($input['from'] ?? ($input['from_date'] ?? null)),
            'to_date'       => $date($input['to'] ?? ($input['to_date'] ?? null)),
            'status'        => $csv($input['status'] ?? null, self::STATUSES),
            'priority'      => $csv($input['priority'] ?? null, self::PRIORITIES),
            'ageing_bucket' => array_key_exists(strtolower($str($input['ageing_bucket'] ?? null)), PendingRegisterPolicy::AGEING_BUCKETS)
                ? strtolower($str($input['ageing_bucket'] ?? null))
                : null,
            'ageing_from'   => $num($input['ageing_from'] ?? null),
            'ageing_to'     => $num($input['ageing_to'] ?? null),
            'min_open_qty'  => $num($input['min_open_qty'] ?? null),
            'max_open_qty'  => $num($input['max_open_qty'] ?? null),
            // Named exactly as the request names them: a filter whose parsed key
            // differs from its query-string key is a rename waiting to be missed.
            'min_pending_value' => $num($input['min_pending_value'] ?? null),
            'max_pending_value' => $num($input['max_pending_value'] ?? null),
            'overdue_only'  => $flag($input['overdue_only'] ?? null),
        ];
    }

    /**
     * WHERE for the filtered set.
     *
     * `$liveOnly` keeps the open-and-partial restriction that makes this a register
     * of what is outstanding. The settled-today figure and the historical comparison
     * lift it on purpose — a row settled this morning is not open now, and counting
     * it is the entire point of that card.
     *
     * @param array<string, mixed> $f
     * @return array{0:string, 1:list<mixed>}
     */
    private function where(array $f, bool $liveOnly = true): array
    {
        $sql = ' WHERE p.cmp_id = ?';
        $binds = [$this->cmpId];

        if ($this->boId > 0) {
            $sql .= ' AND d.bo_id = ?';
            $binds[] = $this->boId;
        }

        // The status filter, when set, decides what is shown — including settled and
        // cancelled rows, which is how "what did we close" is answered here at all.
        $statuses = $f['status'] ?? [];
        if ($statuses !== []) {
            $sql .= ' AND ' . $this->statusSql() . ' IN (' . implode(',', array_fill(0, count($statuses), '?')) . ')';
            foreach ($statuses as $s) {
                $binds[] = $s;
            }
        } elseif ($liveOnly) {
            $sql .= " AND p.status IN ('open','partial')";
        }

        if (($f['pending_id'] ?? null) !== null) {
            $sql .= ' AND p.pending_id = ?';
            $binds[] = $f['pending_id'];
        }
        if ($f['kind'] !== null) {
            $sql .= ' AND p.pending_kind = ?';
            $binds[] = $f['kind'];
        }
        if ($f['direction'] !== null) {
            $sql .= ' AND p.direction = ?';
            $binds[] = $f['direction'];
        }
        if ($f['item_id'] !== null) {
            $sql .= ' AND p.item_id = ?';
            $binds[] = $f['item_id'];
        }
        if (($f['item_search'] ?? '') !== '') {
            $sql .= ' AND (i.item_name ILIKE ? OR i.item_sku ILIKE ? OR i.item_alias ILIKE ? OR i.hsn_sac ILIKE ?)';
            $like = '%' . $f['item_search'] . '%';
            array_push($binds, $like, $like, $like, $like);
        }
        if ($f['warehouse_id'] !== null) {
            $sql .= ' AND p.warehouse_id = ?';
            $binds[] = $f['warehouse_id'];
        }
        if ($f['party_ref'] !== null) {
            $sql .= ' AND p.party_ref = ?';
            $binds[] = $f['party_ref'];
        }
        if ($f['document_id'] !== null) {
            $sql .= ' AND p.document_id = ?';
            $binds[] = $f['document_id'];
        }
        if (($f['document_no'] ?? '') !== '') {
            $sql .= ' AND d.document_no ILIKE ?';
            $binds[] = '%' . $f['document_no'] . '%';
        }
        if (($f['document_type'] ?? '') !== '') {
            $sql .= ' AND d.document_type = ?';
            $binds[] = $f['document_type'];
        }
        if ($f['from_date'] !== null) {
            $sql .= ' AND d.document_date >= ?';
            $binds[] = $f['from_date'];
        }
        if ($f['to_date'] !== null) {
            $sql .= ' AND d.document_date <= ?';
            $binds[] = $f['to_date'];
        }
        if (!empty($f['priority'])) {
            $sql .= ' AND ' . $this->prioritySql() . ' IN (' . implode(',', array_fill(0, count($f['priority']), '?')) . ')';
            foreach ($f['priority'] as $p) {
                $binds[] = $p;
            }
        }
        if ($f['overdue_only']) {
            $sql .= ' AND ' . $this->dueSql() . ' < CURRENT_DATE';
        }
        if ($f['ageing_bucket'] !== null) {
            [$lo, $hi] = PendingRegisterPolicy::AGEING_BUCKETS[$f['ageing_bucket']];
            $sql .= ' AND ' . $this->ageingSql() . ' >= ?';
            $binds[] = $lo;
            if ($hi !== null) {
                $sql .= ' AND ' . $this->ageingSql() . ' <= ?';
                $binds[] = $hi;
            }
        }
        if ($f['ageing_from'] !== null) {
            $sql .= ' AND ' . $this->ageingSql() . ' >= ?';
            $binds[] = (int) $f['ageing_from'];
        }
        if ($f['ageing_to'] !== null) {
            $sql .= ' AND ' . $this->ageingSql() . ' <= ?';
            $binds[] = (int) $f['ageing_to'];
        }
        if ($f['min_open_qty'] !== null) {
            $sql .= ' AND ' . $this->qtyOpenSql() . ' >= ?';
            $binds[] = $f['min_open_qty'];
        }
        if ($f['max_open_qty'] !== null) {
            $sql .= ' AND ' . $this->qtyOpenSql() . ' <= ?';
            $binds[] = $f['max_open_qty'];
        }
        if ($f['min_pending_value'] !== null) {
            $sql .= ' AND ' . $this->pendingValueSql() . ' >= ?';
            $binds[] = $f['min_pending_value'];
        }
        if ($f['max_pending_value'] !== null) {
            $sql .= ' AND ' . $this->pendingValueSql() . ' <= ?';
            $binds[] = $f['max_pending_value'];
        }

        return [$sql, $binds];
    }

    /* ------------------------------------------------------------------ page */

    /**
     * One page of the register, ordered and sliced in SQL.
     *
     * @param array<string, mixed> $f
     * @return array{rows: list<array<string, mixed>>, total: int}
     */
    public function page(array $f, string $sort, string $order, int $limit, int $offset): array
    {
        [$whereSql, $binds] = $this->where($f);
        $from = $this->fromSql();

        $total = (int) ($this->db->query('SELECT COUNT(*) AS n' . $from . $whereSql, $binds)->getRowArray()['n'] ?? 0);
        if ($total === 0) {
            return ['rows' => [], 'total' => 0];
        }

        $select = 'SELECT p.pending_id, p.cmp_id, p.fy_id, p.document_id, p.line_id, p.pending_kind, p.direction,'
            . ' p.item_id, p.unit_id, p.warehouse_id, p.party_ref, p.qty_original, p.qty_settled,'
            . ' p.status AS settlement_status, p.created_at, p.updated_at,'
            . ' ' . $this->qtyOpenSql() . ' AS qty_open,'
            . ' d.document_no, d.document_date, d.document_type, d.status AS document_status, d.party_name,'
            . ' d.expected_return_date,'
            . ' i.item_name, i.item_sku, i.hsn_sac, u.unit_symbol, w.warehouse_name,'
            . ' ' . $this->unitCostSql . ' AS unit_cost,'
            . ' ' . $this->pendingValueSql() . ' AS pending_value,'
            . ' ' . $this->dueSql() . ' AS due_date,'
            . ' ' . $this->ageingSql() . ' AS ageing_days,'
            . ' GREATEST(CURRENT_DATE - ' . $this->dueSql() . ', 0) AS days_overdue,'
            . ' (' . $this->dueSql() . ' < CURRENT_DATE) AS is_overdue,'
            . ' (d.expected_return_date IS NOT NULL) AS has_expected_date,'
            . ' ' . $this->statusSql() . ' AS status,'
            . ' ' . $this->prioritySql() . ' AS priority,'
            . ' COALESCE(p.updated_at, p.created_at) AS last_activity_at';

        $rows = $this->db
            ->query($select . $from . $whereSql . $this->orderBy($sort, $order) . ' LIMIT ? OFFSET ?', array_merge($binds, [$limit, $offset]))
            ->getResultArray();

        return ['rows' => array_map([$this, 'castRow'], $rows), 'total' => $total];
    }

    /**
     * ORDER BY for a whitelisted key.
     *
     * pending_id breaks every tie. Without it two rows with the same document date
     * can swap places between one page and the next, and a reader paging through a
     * register sees a row twice and another never.
     */
    private function orderBy(string $sort, string $order): string
    {
        $dir = strtoupper($order) === 'DESC' ? 'DESC' : 'ASC';
        $expr = self::SORTABLE[$sort] ?? null;
        if ($expr === null && array_key_exists($sort, self::SORTABLE)) {
            $expr = match ($sort) {
                'ageing_days'   => $this->ageingSql(),
                'pending_value' => $this->pendingValueSql(),
                'due_date'      => $this->dueSql(),
                // High first when descending, which is what a reader asking for
                // "priority" means; the stored strings sort the other way.
                'priority'      => "CASE " . $this->prioritySql() . " WHEN 'high' THEN 3 WHEN 'medium' THEN 2 ELSE 1 END",
                default         => null,
            };
        }
        $expr ??= 'd.document_date';

        return ' ORDER BY ' . $expr . ' ' . $dir . ' NULLS LAST, p.pending_id ASC';
    }

    /** @param array<string, mixed> $r @return array<string, mixed> */
    private function castRow(array $r): array
    {
        foreach (['pending_id', 'cmp_id', 'fy_id', 'document_id', 'line_id', 'item_id', 'unit_id', 'warehouse_id', 'party_ref', 'ageing_days', 'days_overdue'] as $k) {
            if (array_key_exists($k, $r) && $r[$k] !== null) {
                $r[$k] = (int) $r[$k];
            }
        }
        foreach (['qty_original', 'qty_settled', 'qty_open', 'unit_cost'] as $k) {
            $r[$k] = round((float) ($r[$k] ?? 0), 4);
        }
        $r['pending_value'] = round((float) ($r['pending_value'] ?? 0), 2);
        foreach (['is_overdue', 'has_expected_date'] as $k) {
            $r[$k] = in_array($r[$k] ?? null, [true, 't', 'true', 1, '1'], true);
        }
        $r['document_type_label'] = \Config\DocumentTypeRegistry::get((string) ($r['document_type'] ?? ''))['label'] ?? $r['document_type'];

        return $r;
    }

    /* --------------------------------------------------------------- summary */

    /**
     * Every figure the KPI cards, the totals row and the exposure chips state, over
     * the WHOLE filtered set rather than the page on screen.
     *
     * One statement, not six. A card per query would run the same scan six times for
     * six numbers that all come off the same rows.
     *
     * @param array<string, mixed> $f
     * @return array<string, float|int>
     */
    public function summary(array $f): array
    {
        [$whereSql, $binds] = $this->where($f);
        $open = $this->qtyOpenSql();
        $value = $this->pendingValueSql();
        $due = $this->dueSql();
        $ageing = $this->ageingSql();

        $sql = 'SELECT COUNT(*) AS open_lines,'
            . " COALESCE(SUM({$open}), 0) AS open_quantity,"
            . " COALESCE(SUM({$value}), 0) AS pending_value,"
            . " COUNT(*) FILTER (WHERE {$due} < CURRENT_DATE) AS overdue_lines,"
            . " COALESCE(SUM({$value}) FILTER (WHERE {$due} < CURRENT_DATE), 0) AS overdue_value,"
            . " COALESCE(SUM({$open}) FILTER (WHERE {$due} < CURRENT_DATE), 0) AS overdue_quantity,"
            . " COALESCE(AVG({$ageing}), 0) AS average_ageing_days,"
            . " COALESCE(SUM({$open}) FILTER (WHERE p.direction = 'in'), 0) AS inbound_pending,"
            . " COALESCE(SUM({$open}) FILTER (WHERE p.direction = 'out'), 0) AS outbound_pending,"
            . ' COALESCE(SUM(p.qty_original), 0) AS original_qty_total,'
            . ' COALESCE(SUM(p.qty_settled), 0) AS settled_qty_total,'
            . " COUNT(DISTINCT p.item_id) AS item_count,"
            . ' COUNT(DISTINCT p.party_ref) AS party_count,'
            . ' COUNT(DISTINCT p.warehouse_id) AS warehouse_count,'
            . ' COUNT(DISTINCT p.document_id) AS document_count'
            . $this->fromSql() . $whereSql;

        $row = $this->db->query($sql, $binds)->getRowArray() ?: [];

        $inbound = round((float) ($row['inbound_pending'] ?? 0), 4);
        $outbound = round((float) ($row['outbound_pending'] ?? 0), 4);

        return [
            'open_lines'          => (int) ($row['open_lines'] ?? 0),
            'open_quantity'       => round((float) ($row['open_quantity'] ?? 0), 4),
            'overdue_lines'       => (int) ($row['overdue_lines'] ?? 0),
            'overdue_quantity'    => round((float) ($row['overdue_quantity'] ?? 0), 4),
            'overdue_value'       => round((float) ($row['overdue_value'] ?? 0), 2),
            'pending_value'       => round((float) ($row['pending_value'] ?? 0), 2),
            'average_ageing_days' => round((float) ($row['average_ageing_days'] ?? 0), 1),
            'inbound_pending'     => $inbound,
            'outbound_pending'    => $outbound,
            // Outbound is stock that has left or is committed to leave; inbound is
            // stock owed to us. The register's exposure is the net of the two.
            'net_exposure'        => round($outbound - $inbound, 4),
            'original_qty_total'  => round((float) ($row['original_qty_total'] ?? 0), 4),
            'settled_qty_total'   => round((float) ($row['settled_qty_total'] ?? 0), 4),
            'open_qty_total'      => round((float) ($row['open_quantity'] ?? 0), 4),
            'item_count'          => (int) ($row['item_count'] ?? 0),
            'party_count'         => (int) ($row['party_count'] ?? 0),
            'warehouse_count'     => (int) ($row['warehouse_count'] ?? 0),
            'document_count'      => (int) ($row['document_count'] ?? 0),
        ];
    }

    /**
     * Lines settled on a given date, within the same filters.
     *
     * The open-status restriction is lifted here on purpose: a line settled in full
     * this morning is no longer open, and a "settled today" card that could not see
     * it would read zero on the busiest day of the month.
     *
     * @param array<string, mixed> $f
     * @return array{lines:int, quantity:float}
     */
    public function settledOn(array $f, string $date): array
    {
        [$whereSql, $binds] = $this->where($f, false);
        $sql = 'SELECT COUNT(DISTINCT s.pending_id) AS line_count, COALESCE(SUM(s.qty_settled), 0) AS quantity'
            . $this->fromSql()
            . ' JOIN inv_pending_settlements s ON s.pending_id = p.pending_id AND s.created_at::date = ?'
            . $whereSql;
        $row = $this->db->query($sql, array_merge([$date], $binds))->getRowArray() ?: [];

        return [
            'lines'    => (int) ($row['line_count'] ?? 0),
            'quantity' => round((float) ($row['quantity'] ?? 0), 4),
        ];
    }

    /**
     * The same headline figures as they stood at a past date.
     *
     * This is a RECONSTRUCTION, not a stored snapshot: a pending line was open at
     * date D if it had been raised by then and the settlements recorded against it up
     * to then did not close it. Cancelled rows carry no cancellation date, so they
     * are excluded outright rather than guessed back into the past — the one
     * approximation here, and it errs towards understating the old position.
     *
     * The register's deltas are worth nothing if they are not real, and StatCard
     * renders no delta at all when it is handed no previous figure. So this either
     * answers honestly or returns null and the cards show their hint instead.
     *
     * @param array<string, mixed> $f
     * @return array<string, float|int>|null
     */
    public function summaryAsOf(array $f, string $date): ?array
    {
        [$whereSql, $binds] = $this->where($f, false);
        $settledBy = '(SELECT COALESCE(SUM(s.qty_settled), 0) FROM inv_pending_settlements s'
            . ' WHERE s.pending_id = p.pending_id AND s.created_at::date <= ?)';
        $openThen = '(p.qty_original - ' . $settledBy . ')';
        $ageingThen = "(?::date - d.document_date)";
        $dueThen = $this->dueSql();
        $value = '(' . $openThen . ' * ' . $this->unitCostSql . ')';

        $sql = 'SELECT COUNT(*) AS open_lines,'
            . " COALESCE(SUM({$openThen}), 0) AS open_quantity,"
            . " COALESCE(SUM({$value}), 0) AS pending_value,"
            . " COUNT(*) FILTER (WHERE {$dueThen} < ?::date) AS overdue_lines,"
            . " COALESCE(AVG({$ageingThen}), 0) AS average_ageing_days"
            . $this->fromSql() . $whereSql
            . " AND p.status <> 'cancelled'"
            . ' AND p.created_at::date <= ?'
            . " AND {$openThen} > 0.0001";

        // Bind order follows the statement: the two settled-by subqueries in the
        // SELECT, the ageing cast, the overdue cast, then the WHERE's own two.
        $b = array_merge(
            [$date, $date, $date, $date],
            $binds,
            [$date, $date],
        );

        try {
            $row = $this->db->query($sql, $b)->getRowArray() ?: [];
        } catch (\Throwable $e) {
            log_message('error', 'Pending register comparison failed: {msg}', ['msg' => $e->getMessage()]);

            return null;
        }

        return [
            'open_lines'          => (int) ($row['open_lines'] ?? 0),
            'open_quantity'       => round((float) ($row['open_quantity'] ?? 0), 4),
            'overdue_lines'       => (int) ($row['overdue_lines'] ?? 0),
            'pending_value'       => round((float) ($row['pending_value'] ?? 0), 2),
            'average_ageing_days' => round((float) ($row['average_ageing_days'] ?? 0), 1),
        ];
    }

    /**
     * Open lines and open quantity at a handful of past dates, for the sparklines.
     *
     * Same reconstruction as summaryAsOf, evaluated at every point in one statement
     * rather than once per point. Omitted entirely past TREND_ROW_LIMIT rows: a
     * picture this small is not worth a scan that size, and no sparkline is a better
     * answer than a slow one.
     *
     * @param array<string, mixed> $f
     * @return list<array{date:string, open_lines:int, open_quantity:float, pending_value:float}>
     */
    public function trend(array $f, int $points = 6, int $stepDays = 7): array
    {
        [$whereSql, $binds] = $this->where($f, false);

        $count = (int) ($this->db->query('SELECT COUNT(*) AS n' . $this->fromSql() . $whereSql, $binds)->getRowArray()['n'] ?? 0);
        if ($count === 0 || $count > self::TREND_ROW_LIMIT) {
            return [];
        }

        $points = max(2, min(12, $points));
        $stepDays = max(1, min(90, $stepDays));

        // The unit cost is resolved once, inside the CTE, so the per-point join does
        // not re-derive it for every row at every date.
        $sql = 'WITH base AS (SELECT p.pending_id, p.qty_original, p.created_at, p.status,'
            . ' ' . $this->unitCostSql . ' AS unit_cost'
            . $this->fromSql() . $whereSql . "), "
            . 'pts AS (SELECT (CURRENT_DATE - (g * ' . $stepDays . ')) AS d FROM generate_series(0, ' . ($points - 1) . ') AS g) '
            . 'SELECT pts.d AS point_date,'
            . ' COUNT(*) FILTER (WHERE cond.is_live) AS open_lines,'
            . ' COALESCE(SUM(CASE WHEN cond.is_live THEN cond.open_then ELSE 0 END), 0) AS open_quantity,'
            . ' COALESCE(SUM(CASE WHEN cond.is_live THEN cond.open_then * p.unit_cost ELSE 0 END), 0) AS pending_value'
            . ' FROM pts CROSS JOIN base p'
            . ' LEFT JOIN LATERAL (SELECT COALESCE(SUM(s.qty_settled), 0) AS q FROM inv_pending_settlements s'
            . ' WHERE s.pending_id = p.pending_id AND s.created_at::date <= pts.d) sb ON TRUE'
            . ' CROSS JOIN LATERAL (SELECT (p.qty_original - COALESCE(sb.q, 0)) AS open_then,'
            . "  (p.status <> 'cancelled' AND p.created_at::date <= pts.d AND (p.qty_original - COALESCE(sb.q, 0)) > 0.0001) AS is_live) cond"
            . ' GROUP BY pts.d ORDER BY pts.d ASC';

        try {
            $rows = $this->db->query($sql, $binds)->getResultArray();
        } catch (\Throwable $e) {
            log_message('error', 'Pending register trend failed: {msg}', ['msg' => $e->getMessage()]);

            return [];
        }

        return array_map(static fn ($r) => [
            'date'          => substr((string) $r['point_date'], 0, 10),
            'open_lines'    => (int) $r['open_lines'],
            'open_quantity' => round((float) $r['open_quantity'], 4),
            'pending_value' => round((float) $r['pending_value'], 2),
        ], $rows);
    }

    /* ------------------------------------------------------------ breakdowns */

    /**
     * The Summary view: the same filtered set, grouped the six ways it is read.
     *
     * One statement per dimension, each returning at most $limit groups, so the
     * summary tab costs a bounded number of aggregates rather than shipping every
     * row to the browser to be grouped there.
     *
     * @param array<string, mixed> $f
     * @return array<string, list<array<string, mixed>>>
     */
    public function breakdowns(array $f, int $limit = 8): array
    {
        return [
            'kind'      => $this->groupBy($f, 'p.pending_kind', 'p.pending_kind', $limit),
            // The id travels with the label so the summary card can link back
            // into the register filtered to the group the reader clicked.
            'warehouse' => $this->groupBy($f, "COALESCE(w.warehouse_name, 'Unassigned')", 'p.warehouse_id, w.warehouse_name', $limit, 'p.warehouse_id'),
            'item'      => $this->groupBy($f, "COALESCE(i.item_name, 'Item #' || p.item_id)", 'p.item_id, i.item_name', $limit, 'p.item_id'),
            'party'     => $this->groupBy($f, "COALESCE(NULLIF(d.party_name, ''), CASE WHEN p.party_ref IS NULL THEN 'No party' ELSE '#' || p.party_ref END)", 'p.party_ref, d.party_name', $limit, 'p.party_ref'),
            'ageing'    => $this->ageingBuckets($f),
            'direction' => $this->groupBy($f, 'p.direction', 'p.direction', 2),
        ];
    }

    /**
     * @param array<string, mixed> $f
     * @return list<array<string, mixed>>
     */
    private function groupBy(array $f, string $labelSql, string $groupSql, int $limit, ?string $keySql = null): array
    {
        [$whereSql, $binds] = $this->where($f);
        $open = $this->qtyOpenSql();
        $value = $this->pendingValueSql();
        $due = $this->dueSql();

        $sql = 'SELECT ' . ($keySql !== null ? $keySql . ' AS group_key,' : 'NULL AS group_key,')
            . " {$labelSql} AS label, COUNT(*) AS line_count,"
            . " COALESCE(SUM({$open}), 0) AS open_quantity,"
            . " COALESCE(SUM({$value}), 0) AS pending_value,"
            . " COUNT(*) FILTER (WHERE {$due} < CURRENT_DATE) AS overdue_lines,"
            . ' COALESCE(MAX(' . $this->ageingSql() . '), 0) AS max_ageing_days'
            . $this->fromSql() . $whereSql
            . " GROUP BY {$groupSql} ORDER BY open_quantity DESC NULLS LAST LIMIT ?";

        $rows = $this->db->query($sql, array_merge($binds, [$limit]))->getResultArray();

        return array_map(static fn ($r) => [
            'key'             => $r['group_key'] === null ? null : (string) $r['group_key'],
            'label'           => (string) $r['label'],
            'lines'           => (int) $r['line_count'],
            'open_quantity'   => round((float) $r['open_quantity'], 4),
            'pending_value'   => round((float) $r['pending_value'], 2),
            'overdue_lines'   => (int) $r['overdue_lines'],
            'max_ageing_days' => (int) $r['max_ageing_days'],
        ], $rows);
    }

    /**
     * @param array<string, mixed> $f
     * @return list<array<string, mixed>>
     */
    private function ageingBuckets(array $f): array
    {
        [$whereSql, $binds] = $this->where($f);
        $ageing = $this->ageingSql();
        $open = $this->qtyOpenSql();
        $value = $this->pendingValueSql();

        $case = 'CASE';
        foreach (PendingRegisterPolicy::AGEING_BUCKETS as $key => [$lo, $hi]) {
            $case .= $hi === null
                ? " WHEN {$ageing} >= {$lo} THEN '{$key}'"
                : " WHEN {$ageing} BETWEEN {$lo} AND {$hi} THEN '{$key}'";
        }
        $case .= " ELSE '0_7' END";

        $sql = "SELECT {$case} AS label, COUNT(*) AS line_count,"
            . " COALESCE(SUM({$open}), 0) AS open_quantity,"
            . " COALESCE(SUM({$value}), 0) AS pending_value,"
            . ' 0 AS overdue_lines, COALESCE(MAX(' . $ageing . '), 0) AS max_ageing_days'
            . $this->fromSql() . $whereSql
            . " GROUP BY 1";

        $found = [];
        foreach ($this->db->query($sql, $binds)->getResultArray() as $r) {
            $found[(string) $r['label']] = $r;
        }

        // Every bucket is reported, including the empty ones: a distribution with
        // gaps knocked out of it is not a distribution, and "0-7 days: nothing" is
        // exactly the reassurance the reader came for.
        $out = [];
        foreach (array_keys(PendingRegisterPolicy::AGEING_BUCKETS) as $key) {
            $r = $found[$key] ?? null;
            $out[] = [
                'key'             => $key,
                'label'           => $key,
                'lines'           => (int) ($r['line_count'] ?? 0),
                'open_quantity'   => round((float) ($r['open_quantity'] ?? 0), 4),
                'pending_value'   => round((float) ($r['pending_value'] ?? 0), 2),
                'overdue_lines'   => 0,
                'max_ageing_days' => (int) ($r['max_ageing_days'] ?? 0),
            ];
        }

        return $out;
    }

    /**
     * Whether the company has any pending row at all, ignoring every filter.
     *
     * The difference between "nothing matches these filters" and "nothing is
     * pending" is the difference between sending a reader hunting for a filter that
     * is not set and telling them their challans are all closed. Only asked when the
     * page came back empty, and it stops at the first row.
     */
    public function hasAnyRows(): bool
    {
        $sql = 'SELECT 1' . $this->fromSql() . " WHERE p.cmp_id = ? AND p.status IN ('open','partial')"
            . ($this->boId > 0 ? ' AND d.bo_id = ?' : '') . ' LIMIT 1';
        $binds = $this->boId > 0 ? [$this->cmpId, $this->boId] : [$this->cmpId];

        return $this->db->query($sql, $binds)->getRowArray() !== null;
    }
}
