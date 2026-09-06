<?php

namespace App\Services;

/**
 * Durable request idempotency (inv_idempotency_keys). A replayed request with the same
 * (cmp_id, key) returns the stored response instead of acting twice.
 */
class IdempotencyService
{
    /** @return array{status:int, body:array<string,mixed>}|null */
    public function replay(int $cmpId, ?string $key, string $resourceType, ?string $requestHash = null): ?array
    {
        if ($key === null || $key === '') {
            return null;
        }
        $row = \Config\Database::connect()->table('inv_idempotency_keys')
            ->where('cmp_id', $cmpId)->where('idempotency_key', $key)->get()->getRowArray();
        if (!$row) {
            return null;
        }
        if ($requestHash !== null && !empty($row['request_hash']) && $row['request_hash'] !== $requestHash) {
            return ['status' => 409, 'body' => ['error' => ['code' => 'idempotency_conflict', 'message' => 'Idempotency-Key was already used with a different request body'], 'message' => 'Idempotency-Key reused with different payload']];
        }
        $body = json_decode((string) ($row['response_json'] ?? ''), true);
        if (!is_array($body)) {
            $body = ['data' => ['resource_type' => $row['resource_type'], 'resource_id' => (int) $row['resource_id']], 'duplicate' => true];
        }
        $body['duplicate'] = true;

        return ['status' => (int) ($row['response_status'] ?? 200), 'body' => $body];
    }

    /** @param array<string, mixed> $responseBody */
    public function remember(int $cmpId, ?string $key, string $resourceType, ?int $resourceId, ?string $resourceUuid, int $status, array $responseBody, ?string $requestHash = null): void
    {
        if ($key === null || $key === '') {
            return;
        }
        $db = \Config\Database::connect();
        try {
            $db->table('inv_idempotency_keys')->insert([
                'cmp_id'          => $cmpId,
                'idempotency_key' => $key,
                'request_hash'    => $requestHash,
                'resource_type'   => $resourceType,
                'resource_id'     => $resourceId,
                'resource_uuid'   => $resourceUuid,
                'response_status' => $status,
                'response_json'   => json_encode($responseBody, JSON_UNESCAPED_UNICODE),
                'created_at'      => date('Y-m-d H:i:s'),
            ]);
        } catch (\Throwable $e) {
            // A concurrent request stored the same key first — the unique index guarantees one winner.
            log_message('info', 'idempotency remember skipped: {msg}', ['msg' => $e->getMessage()]);
        }
    }

    public static function hashRequest(array $body): string
    {
        $normalized = self::normalize($body);

        return hash('sha256', json_encode($normalized));
    }

    private static function normalize(mixed $v): mixed
    {
        if (is_array($v)) {
            $isList = array_is_list($v);
            $out = [];
            foreach ($v as $k => $item) {
                if (in_array($k, ['idempotency_key', 'cmp_id', 'fy_id', 'bo_id'], true)) {
                    continue;
                }
                $out[$k] = self::normalize($item);
            }
            if (!$isList) {
                ksort($out);
            }

            return $out;
        }
        if (is_float($v)) {
            return round($v, 6);
        }

        return $v;
    }
}
