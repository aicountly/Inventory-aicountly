<?php

namespace App\Controllers\Api\V1;

use App\Controllers\Api\BaseController;

/**
 * /api/v1/audit-log — append-only audit trail (inv_audit_log), read-only.
 *
 *   GET audit-log?entity_type=&action=&actor_uuid=&from=&to=&entity_id=&source_app=&q=
 *   GET audit-log/entity/{type}/{id}
 */
class AuditController extends BaseController
{
    private const JSON_COLUMNS = ['before_json', 'after_json', 'meta_json'];
    private const SORTABLE = ['audit_id', 'created_at', 'entity_type', 'action', 'actor_uuid'];

    public function index()
    {
        $a = $this->authorize('audit.read', true, false);
        if (isset($a['response'])) {
            return $a['response'];
        }
        $cmpId = (int) $a['ctx']['cmp_id'];
        $b = \Config\Database::connect()->table('inv_audit_log')->where('cmp_id', $cmpId);
        foreach (['entity_type', 'action', 'actor_uuid', 'source_app', 'source_document_type', 'request_id'] as $filter) {
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
        if ($q = trim((string) ($this->request->getGet('q') ?? ''))) {
            $b->groupStart()->like('reason', $q, 'both', null, true)->orLike('action', $q, 'both', null, true)->orLike('entity_type', $q, 'both', null, true)->groupEnd();
        }

        return $this->list($b);
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

    private function list($b)
    {
        $p = $this->listParams(50, 500, 'created_at');
        if (!$this->request->getGet('order')) {
            $p['order'] = 'DESC';
        }
        $from = $this->dateTimeParam('from', false);
        $to = $this->dateTimeParam('to', true);
        if ($from !== null && $to !== null && $from > $to) {
            return $this->failStructured(422, 'validation_failed', 'from must not be after to');
        }
        if ($from !== null) {
            $b->where('created_at >=', $from);
        }
        if ($to !== null) {
            $b->where('created_at <=', $to);
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
