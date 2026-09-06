<?php

namespace App\Services;

/**
 * Append-only audit trail (inv_audit_log). Every sensitive change records who, what,
 * from which product and source document, with before/after snapshots.
 */
class AuditService
{
    /**
     * @param array<string, mixed>|null $before
     * @param array<string, mixed>|null $after
     * @param array<string, mixed> $meta  keys: source_app, source_document_type, source_document_id,
     *                                     source_document_uuid, reason, approval_ref, reversal_ref, entity_uuid
     */
    public function log(
        int $cmpId,
        string $entityType,
        int $entityId,
        string $action,
        ?string $actorUuid,
        array $meta = [],
        ?array $before = null,
        ?array $after = null,
    ): void {
        try {
            $db = \Config\Database::connect();
            if (!SchemaCache::tableExists($db, 'inv_audit_log')) {
                return;
            }
            $known = ['source_app', 'source_document_type', 'source_document_id', 'source_document_uuid', 'reason', 'approval_ref', 'reversal_ref', 'entity_uuid'];
            $row = [
                'cmp_id'      => $cmpId,
                'entity_type' => substr($entityType, 0, 64),
                'entity_id'   => $entityId,
                'action'      => substr($action, 0, 48),
                'actor_uuid'  => $actorUuid !== null ? substr($actorUuid, 0, 64) : null,
                'request_id'  => ClientRequestContext::requestId(),
                'ip_address'  => ClientRequestContext::ipAddress(),
                'created_at'  => date('Y-m-d H:i:s'),
            ];
            foreach ($known as $k) {
                if (array_key_exists($k, $meta) && $meta[$k] !== null && $meta[$k] !== '') {
                    $row[$k] = $meta[$k];
                    unset($meta[$k]);
                }
            }
            if ($meta !== []) {
                $row['meta_json'] = json_encode($meta, JSON_UNESCAPED_UNICODE);
            }
            if ($before !== null) {
                $row['before_json'] = json_encode($before, JSON_UNESCAPED_UNICODE);
            }
            if ($after !== null) {
                $row['after_json'] = json_encode($after, JSON_UNESCAPED_UNICODE);
            }
            $db->table('inv_audit_log')->insert($row);
        } catch (\Throwable $e) {
            log_message('error', 'inv_audit_log write failed: {msg}', ['msg' => $e->getMessage()]);
        }
    }
}
