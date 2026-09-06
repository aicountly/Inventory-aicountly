<?php

namespace App\Commands;

use App\Services\OutboxService;
use CodeIgniter\CLI\BaseCommand;
use CodeIgniter\CLI\CLI;

/**
 * php spark inventory:outbox-dispatch [--limit=N]
 *
 * Delivers due integration events (inv_integration_events PENDING / FAILED whose retry time has
 * passed) to Books through OutboxService::dispatch(). Meant to run every minute from cron.
 */
class InventoryOutboxDispatch extends BaseCommand
{
    protected $group       = 'Inventory';
    protected $name        = 'inventory:outbox-dispatch';
    protected $description = 'Deliver pending outbox events (inventory -> Books) with retries.';
    protected $usage       = 'inventory:outbox-dispatch [--limit=N]';
    protected $options     = [
        '--limit' => 'Maximum number of events to deliver in this invocation (default 100).',
    ];

    public function run(array $params)
    {
        $limit = (int) (CLI::getOption('limit') ?? $params['limit'] ?? 100);
        $limit = $limit > 0 ? min($limit, 5000) : 100;
        $started = microtime(true);
        try {
            $result = (new OutboxService())->dispatch($limit);
        } catch (\Throwable $e) {
            CLI::error('Outbox dispatch failed: ' . $e->getMessage());

            return EXIT_ERROR;
        }
        $secs = round(microtime(true) - $started, 2);
        $processed = $result['sent'] + $result['failed'] + $result['dead'] + $result['skipped'];
        if ($processed === 0) {
            CLI::write('No due outbox events.', 'yellow');

            return EXIT_SUCCESS;
        }
        CLI::write(sprintf('sent=%d failed=%d dead=%d skipped=%d (limit %d, %ss)', $result['sent'], $result['failed'], $result['dead'], $result['skipped'], $limit, $secs), $result['failed'] > 0 || $result['dead'] > 0 ? 'yellow' : 'green');
        if ($result['dead'] > 0) {
            CLI::error($result['dead'] . ' event(s) exhausted their retries (DEAD) — replay them from /integration/outbox after fixing the cause.');
        }

        return EXIT_SUCCESS;
    }
}
