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
            $outcome = self::deliveryOutcome($result);
            if ($outcome['ack']) {
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
                'last_error'      => substr($outcome['error'], 0, 2000),
                'next_attempt_at' => date('Y-m-d H:i:s', time() + $delay),
            ]);
            $dead ? $out['dead']++ : $out['failed']++;
        }

        return $out;
    }

    /**
     * What one delivery attempt did to the outbox row.
     *
     * An event Books could not apply must never be ACKed: the row would be closed with
     * last_error null while the COGS revision (or posting acknowledgement) it carried never
     * reached the ledger, and nothing would ever redeliver it. Books now answers non-2xx when
     * it failed to apply anything in the batch, but the per-event status in the body is checked
     * too, so a Books build that still answers 200 (or a deploy where Inventory is ahead)
     * cannot silently drop an event either.
     *
     * @param array{ok:bool, status:int, body:?array, error:?string} $result
     * @return array{ack:bool, error:string}
     */
    public static function deliveryOutcome(array $result): array
    {
        $applyError = self::applyFailure($result);
        if (($result['ok'] ?? false) && $applyError === null) {
            return ['ack' => true, 'error' => ''];
        }

        return ['ack' => false, 'error' => (string) ($result['error'] ?: $applyError ?: 'Books did not acknowledge the event')];
    }

    /**
     * The reason Books gave for not applying a delivery, or null when it applied everything it
     * was sent. Books returns {data:[{event_id, status, error}, ...]} — one entry per event in
     * the POST — and status='failed' there means the event must be redelivered.
     *
     * @param array{ok:bool, status:int, body:?array, error:?string} $result
     */
    private static function applyFailure(array $result): ?string
    {
        $events = $result['body']['data'] ?? null;
        if (!is_array($events)) {
            return null;
        }
        $messages = [];
        foreach ($events as $event) {
            if (!is_array($event) || ($event['status'] ?? '') !== 'failed') {
                continue;
            }
            $messages[] = trim((string) ($event['event_type'] ?? $event['event_id'] ?? 'event')) . ': '
                . (string) ($event['error'] ?? 'not applied');
        }

        return $messages === [] ? null : 'Books did not apply the event — ' . implode('; ', $messages);
    }

    public function replay(int $cmpId, int $eventId): bool
    {
        $db = \Config\Database::connect();
        $db->table('inv_integration_events')->where('cmp_id', $cmpId)->where('event_id', $eventId)
            ->update(['status' => 'PENDING', 'next_attempt_at' => date('Y-m-d H:i:s')]);

        return $db->affectedRows() > 0;
    }
}
