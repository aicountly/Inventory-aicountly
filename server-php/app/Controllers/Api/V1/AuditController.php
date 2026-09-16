<?php

namespace App\Controllers\Api\V1;

use App\Controllers\Api\BaseController;

/**
 * /api/v1/audit-log — append-only audit trail (inv_audit_log), read-only.
 *
 *   GET audit-log?entity_type=&action=&actor_uuid=&from=&to=&entity_id=&source_app=&q=
 *   GET audit-log/entity/{type}/{id}
 *   GET audit-log/summary?<the same filters>
 */
class AuditController extends BaseController
{
    private const JSON_COLUMNS = ['before_json', 'after_json', 'meta_json'];
    private const SORTABLE = ['audit_id', 'created_at', 'entity_type', 'action', 'actor_uuid'];
    /** Distinct values offered per filter dropdown. Past this the box still takes a typed value. */
    private const FACET_LIMIT = 150;

    public function index()
    {
        $a = $this->authorize('audit.read', true, false);
        if (isset($a['response'])) {
            return $a['response'];
        }

        return $this->list($this->filtered((int) $a['ctx']['cmp_id']));
    }

    /**
     * The filtered query the list, the export and the summary all read.
     *
     * One builder, not three: a summary computed over a different WHERE than
     * the rows beneath it is a figure that contradicts the table it labels,
     * and nobody reading an audit screen can tell which of the two is wrong.
     */
    private function filtered(int $cmpId)
    {
        $b = \Config\Database::connect()->table('inv_audit_log')->where('cmp_id', $cmpId);
        foreach (['entity_type', 'action', 'actor_uuid', 'source_app', 'source_document_type', 'request_id', 'ip_address'] as $filter) {
            $v = trim((string) ($this->request->getGet($filter) ?? ''));
            if ($v === '') {
                continue;
            }
            $values = array_values(array_filter(array_map('trim', explode(',', $v)), static fn ($s) => $s !== ''));
            count($values) > 1 ? $b->whereIn($filter, $values) : $b->where($filter, $values[0]);
        }
        if ($entityId = (int) ($this->request->getGet('entity_id') ?? 0)) {
            $b->where('entity_id', $entityId);
        }
        if ($srcId = (int) ($this->request->getGet('source_document_id') ?? 0)) {
            $b->where('source_document_id', $srcId);
        }
        $actionPrefix = trim((string) ($this->request->getGet('action_prefix') ?? ''));
        if ($actionPrefix !== '') {
            $b->like('action', $actionPrefix, 'after', null, true);
        }
        // has_reason=1 / 0 — the "All reasons" filter. A reason is the note an
        // approver typed, so "only entries that carry one" is the question an
        // investigation actually asks.
        $hasReason = trim((string) ($this->request->getGet('has_reason') ?? ''));
        if ($hasReason === '1') {
            $b->where('reason IS NOT NULL')->where("reason <>", '');
        } elseif ($hasReason === '0') {
            $b->groupStart()->where('reason IS NULL')->orWhere('reason', '')->groupEnd();
        }
        if ($q = trim((string) ($this->request->getGet('q') ?? ''))) {
            $b->groupStart()->like('reason', $q, 'both', null, true)->orLike('action', $q, 'both', null, true)->orLike('entity_type', $q, 'both', null, true)->groupEnd();
        }

        return $b;
    }

    public function entity($type = null, $id = null)
    {
        $a = $this->authorize('audit.read', true, false);
        if (isset($a['response'])) {
            return $a['response'];
        }
        $type = trim((string) $type);
        $id = (int) $id;
        if ($type === '' || $id <= 0) {
            return $this->failStructured(400, 'validation_failed', 'entity type and id are required');
        }
        $b = \Config\Database::connect()->table('inv_audit_log')->where('cmp_id', (int) $a['ctx']['cmp_id'])->where('entity_type', $type)->where('entity_id', $id);

        return $this->list($b);
    }

    /**
     * GET /v1/audit-log/summary — the figures above the table.
     *
     * A separate call from the list on purpose. The cards answer a question
     * about the whole filtered set, so they must not be recomputed for every
     * page turn: the browser asks for them when the FILTERS change and reuses
     * them while the reader pages through the result.
     *
     * Every figure here is counted, never assumed. `previous_total` is only
     * returned when the caller gave both ends of a period — without one there
     * is no previous period to compare against, and a delta chip drawn from a
     * guess is worse on an audit screen than no chip at all.
     */
    public function summary()
    {
        $a = $this->authorize('audit.read', true, false);
        if (isset($a['response'])) {
            return $a['response'];
        }
        $cmpId = (int) $a['ctx']['cmp_id'];
        $b = $this->filtered($cmpId);
        $range = $this->applyDateRange($b);
        if (isset($range['response'])) {
            return $range['response'];
        }

        $agg = (clone $b)
            ->select(
                'COUNT(*) AS total'
                . ', COUNT(DISTINCT actor_uuid) AS actors'
                . ', COUNT(DISTINCT source_app) AS source_apps'
                . ', COUNT(DISTINCT action) AS event_types'
                . ', COUNT(DISTINCT entity_type) AS entity_types'
                . ', MIN(created_at) AS first_at'
                . ', MAX(created_at) AS last_at',
                false,
            )
            ->get()
            ->getRowArray() ?: [];

        $retention = new \App\Services\AuditRetentionRegistry();

        return $this->respond(['data' => [
            'total'          => (int) ($agg['total'] ?? 0),
            'previous_total' => $this->previousWindowTotal($cmpId, $range['from'] ?? null, $range['to'] ?? null),
            'actors'         => (int) ($agg['actors'] ?? 0),
            'source_apps'    => (int) ($agg['source_apps'] ?? 0),
            'event_types'    => (int) ($agg['event_types'] ?? 0),
            'entity_types'   => (int) ($agg['entity_types'] ?? 0),
            'first_at'       => $agg['first_at'] ?? null,
            'last_at'        => $agg['last_at'] ?? null,
            // The compliance figure, read from the policy rather than written
            // on the screen: retention is 8 years and purging is refused by a
            // database trigger, so the card states a fact the server can prove.
            'retention_years' => \App\Services\AuditRetentionRegistry::RETENTION_YEARS,
            'may_purge'       => $retention->mayPurge(),
            'facets'          => [
                'actions'      => $this->facet($b, 'action'),
                'actors'       => $this->facet($b, 'actor_uuid'),
                'source_apps'  => $this->facet($b, 'source_app'),
                'entity_types' => $this->facet($b, 'entity_type'),
            ],
        ]]);
    }

    /**
     * The same period, immediately before itself.
     *
     * Returns null unless the caller bounded both ends: "+12% vs last month"
     * is only true when the screen knows what last month was.
     */
    private function previousWindowTotal(int $cmpId, ?string $from, ?string $to): ?int
    {
        if ($from === null || $to === null) {
            return null;
        }
        $fromTs = strtotime($from);
        $toTs = strtotime($to);
        if ($fromTs === false || $toTs === false || $toTs <= $fromTs) {
            return null;
        }
        $span = $toTs - $fromTs;

        return (int) $this->filtered($cmpId)
            ->where('created_at >=', date('Y-m-d H:i:s', $fromTs - $span - 1))
            ->where('created_at <', $from)
            ->countAllResults(false);
    }

    /**
     * The distinct values of one column over the filtered set, commonest first.
     *
     * This is what turns the free-text filter boxes into real pickers. Capped,
     * because a column such as `actor_uuid` is unbounded in principle and a
     * dropdown is not: past the cap the box still accepts a typed value, so
     * nothing becomes unreachable, it just stops being offered.
     *
     * @return list<array{value: string, count: int}>
     */
    private function facet($b, string $column, int $limit = self::FACET_LIMIT): array
    {
        $rows = (clone $b)
            ->select($column . ' AS value, COUNT(*) AS n', false)
            ->where($column . ' IS NOT NULL')
            ->where($column . ' <>', '')
            ->groupBy($column)
            ->orderBy('n', 'DESC')
            ->orderBy($column, 'ASC')
            ->limit($limit)
            ->get()
            ->getResultArray();

        return array_map(static fn (array $r): array => [
            'value' => (string) $r['value'],
            'count' => (int) $r['n'],
        ], $rows);
    }

    /**
     * `from` / `to` applied to a builder, or the 422 that says they crossed.
     *
     * @return array{from?: ?string, to?: ?string, response?: mixed}
     */
    private function applyDateRange($b): array
    {
        $from = $this->dateTimeParam('from', false);
        $to = $this->dateTimeParam('to', true);
        if ($from !== null && $to !== null && $from > $to) {
            return ['response' => $this->failStructured(422, 'validation_failed', 'from must not be after to')];
        }
        if ($from !== null) {
            $b->where('created_at >=', $from);
        }
        if ($to !== null) {
            $b->where('created_at <=', $to);
        }

        return ['from' => $from, 'to' => $to];
    }

    private function list($b)
    {
        $p = $this->listParams(50, 500, 'created_at');
        if (!$this->request->getGet('order')) {
            $p['order'] = 'DESC';
        }
        $range = $this->applyDateRange($b);
        if (isset($range['response'])) {
            return $range['response'];
        }
        $total = (clone $b)->countAllResults(false);
        $sort = in_array($p['sort'], self::SORTABLE, true) ? $p['sort'] : 'created_at';
        $rows = $b->orderBy($sort, $p['order'])->orderBy('audit_id', $p['order'])->limit($p['limit'], $p['offset'])->get()->getResultArray();

        return $this->respondList(array_map([self::class, 'present'], $rows), $total, $p['limit'], $p['offset']);
    }

    /** @return array<string, mixed> */
    private static function present(array $row): array
    {
        $row['audit_id'] = (int) $row['audit_id'];
        $row['cmp_id'] = (int) $row['cmp_id'];
        $row['entity_id'] = (int) $row['entity_id'];
        foreach (['source_document_id', 'reversal_ref'] as $k) {
            $row[$k] = isset($row[$k]) ? (int) $row[$k] : null;
        }
        foreach (self::JSON_COLUMNS as $k) {
            $row[str_replace('_json', '', $k)] = isset($row[$k]) && $row[$k] !== '' ? json_decode((string) $row[$k], true) : null;
            unset($row[$k]);
        }

        return $row;
    }

    /** Date (YYYY-MM-DD -> start/end of day) or full timestamp. */
    private function dateTimeParam(string $name, bool $endOfDay): ?string
    {
        $v = trim((string) ($this->request->getGet($name) ?? ''));
        if ($v === '') {
            return null;
        }
        $ts = strtotime($v);
        if ($ts === false) {
            return null;
        }
        if (preg_match('/^\d{4}-\d{2}-\d{2}$/', $v)) {
            return $v . ($endOfDay ? ' 23:59:59' : ' 00:00:00');
        }

        return date('Y-m-d H:i:s', $ts);
    }
}
