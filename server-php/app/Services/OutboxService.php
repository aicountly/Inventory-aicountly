<?php

namespace App\Services;

/**
 * Outbox pattern: integration events are written in the same transaction as the domain
 * change, then delivered by the dispatcher (spark inventory:outbox-dispatch) with retries.
 */
class OutboxService
{
    /** @param array<string, mixed> $payload */
    public function enqueue(int $cmpId, string $eventType, string $aggregateType, int $aggregateId, ?string $aggregateUuid, array $payload, string $targetApp = 'books'): int
    {
        $db = \Config\Database::connect();
        $db->table('inv_integration_events')->insert([
            'cmp_id'          => $cmpId,
            'target_app'      => $targetApp,
            'event_type'      => $eventType,
            'aggregate_type'  => $aggregateType,
            'aggregate_id'    => $aggregateId,
            'aggregate_uuid'  => $aggregateUuid,
            'payload_json'    => json_encode($payload, JSON_UNESCAPED_UNICODE),
            'status'          => 'PENDING',
            'attempts'        => 0,
            'next_attempt_at' => date('Y-m-d H:i:s'),
            'created_at'      => date('Y-m-d H:i:s'),
        ]);

        return (int) $db->insertID();
    }

    /**
     * Deliver due events. Returns counts.
     *
     * @return array{sent:int, failed:int, dead:int, skipped:int}
     */
    public function dispatch(int $limit = 100, ?BooksApiClient $books = null): array
    {
        $db = \Config\Database::connect();
        $books ??= new BooksApiClient();
        $rows = $db->table('inv_integration_events')
            ->whereIn('status', ['PENDING', 'FAILED'])
            ->where('next_attempt_at <=', date('Y-m-d H:i:s'))
            ->orderBy('event_id', 'ASC')->limit($limit)
            ->get()->getResultArray();
        $out = ['sent' => 0, 'failed' => 0, 'dead' => 0, 'skipped' => 0];
        foreach ($rows as $row) {
            if (($row['target_app'] ?? 'books') !== 'books') {
                $out['skipped']++;
                continue;
            }
            $payload = json_decode((string) $row['payload_json'], true) ?: [];
            $envelope = [
                'event_uuid'     => $row['event_uuid'],
                'event_type'     => $row['event_type'],
                'cmp_id'         => (int) $row['cmp_id'],
                'aggregate_type' => $row['aggregate_type'],
                'aggregate_id'   => (int) $row['aggregate_id'],
                'aggregate_uuid' => $row['aggregate_uuid'],
                'occurred_at'    => $row['created_at'],
                'payload'        => $payload,
            ];
            $result = $books->postEvent($envelope);
            $attempts = (int) $row['attempts'] + 1;
            if ($result['ok']) {
                $db->table('inv_integration_events')->where('event_id', (int) $row['event_id'])->update([
                    'status' => 'ACKED', 'attempts' => $attempts, 'sent_at' => date('Y-m-d H:i:s'), 'acked_at' => date('Y-m-d H:i:s'), 'last_error' => null,
                ]);
                $out['sent']++;
                continue;
            }
            $dead = $attempts >= 20;
            $delay = min(3600, 30 * (2 ** min(10, $attempts)));
            $db->table('inv_integration_events')->where('event_id', (int) $row['event_id'])->update([
                'status'          => $dead ? 'DEAD' : 'FAILED',
                'attempts'        => $attempts,
                'last_error'      => substr((string) $result['error'], 0, 2000),
                'next_attempt_at' => date('Y-m-d H:i:s', time() + $delay),
            ]);
            $dead ? $out['dead']++ : $out['failed']++;
        }

        return $out;
    }

    public function replay(int $cmpId, int $eventId): bool
    {
        $db = \Config\Database::connect();
        $db->table('inv_integration_events')->where('cmp_id', $cmpId)->where('event_id', $eventId)
            ->update(['status' => 'PENDING', 'next_attempt_at' => date('Y-m-d H:i:s')]);

        return $db->affectedRows() > 0;
    }
}
