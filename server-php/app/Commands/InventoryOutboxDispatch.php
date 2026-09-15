<?php

namespace App\Commands;

use App\Services\CronHeartbeat;
use App\Services\OutboxService;
use CodeIgniter\CLI\BaseCommand;
use CodeIgniter\CLI\CLI;

/**
 * php spark inventory:outbox-dispatch [--limit=N]
 *
 * Delivers due integration events (inv_integration_events PENDING / FAILED whose retry time has
 * passed) to Books through OutboxService::dispatch().
 *
 * There is no cron in this deployment, so this is a sweep an operator runs, not the delivery
 * mechanism: ordinary delivery happens on contact, on the next authenticated write for the
 * company ({@see OutboxService::settleOnContact()}). Useful for a company nobody is touching, or
 * to drain every company at once after a Books outage.
 *
 * It reports each run to Console's Cron Job Monitor ({@see CronHeartbeat}) — a start, then an ok
 * or an error carrying the counts. Reporting is silent and inert until CONSOLE_CRON_MONITOR_KEY
 * is set, and can never fail this command: the heartbeat is swallowed, the dispatch result is
 * what decides the exit code.
 */
class InventoryOutboxDispatch extends BaseCommand
{
    use EqualsOptionSyntax;

    /**
     * The monitor code Console pairs these heartbeats with.
     *
     * Console only accepts a code it already holds in cron_monitors; it never creates one on
     * first report, because a monitor that appears when a job first checks in cannot say anything
     * about a job that has never run. This code is registered by Console migration 033 with
     * enabled = FALSE, which is the honest description of this command today: an operator runs it
     * by hand, so there is no schedule for it to be late against. Console records its runs and
     * reads the monitor DISABLED instead of showing a permanently red row for a job nobody
     * scheduled. Give it a crontab entry, set the interval on that row, flip enabled to TRUE, and
     * it is watched like any other.
     */
    public const MONITOR = 'inventory.outbox_dispatch';

    protected $group       = 'Inventory';
    protected $name        = 'inventory:outbox-dispatch';
    protected $description = 'Deliver pending outbox events (inventory -> Books) with retries.';
    protected $usage       = 'inventory:outbox-dispatch [--limit=N]';
    protected $options     = [
        '--limit' => 'Maximum number of events to deliver in this invocation (default 100).',
    ];

    public function run(array $params)
    {
        $this->normaliseEqualsOptions();
        $limit = (int) (CLI::getOption('limit') ?? $params['limit'] ?? 100);
        $limit = $limit > 0 ? min($limit, 5000) : 100;

        // Before the work, so a run that dies half way leaves a start with no finish and Console
        // reads it STUCK rather than healthy.
        $beat = $this->heartbeat()->begin();

        $started = microtime(true);
        try {
            $result = $this->dispatcher()->dispatch($limit);
        } catch (\Throwable $e) {
            CLI::error('Outbox dispatch failed: ' . $e->getMessage());
            $beat->failure('Outbox dispatch failed: ' . $e->getMessage(), ['limit' => $limit]);

            return EXIT_ERROR;
        }
        $secs = round(microtime(true) - $started, 2);
        $processed = $result['sent'] + $result['failed'] + $result['dead'] + $result['skipped'];

        // Reported on every path, including the quiet one. "Nothing was due" is a healthy run and
        // has to be heard: a monitor only fed when there is work to do goes OVERDUE on a quiet
        // night and teaches everyone to ignore it.
        $counts = [
            'sent'      => $result['sent'],
            'failed'    => $result['failed'],
            'dead'      => $result['dead'],
            'skipped'   => $result['skipped'],
            'processed' => $processed,
            'limit'     => $limit,
            'seconds'   => $secs,
        ];
        $summary = sprintf(
            'sent=%d failed=%d dead=%d skipped=%d',
            $result['sent'],
            $result['failed'],
            $result['dead'],
            $result['skipped'],
        );

        if ($result['dead'] > 0) {
            // A DEAD event is an accounting event this deployment has given up on for good: it
            // hit 20 attempts and will never be retried. The sweep did what it was told, but the
            // work did not get done, and that is precisely the FAILING state — "it ran, it
            // completed, and it did not work". Reported as ok it was excluded from the alerting
            // count, so the one person scanning red rows on the daily open saw nothing at all.
            $beat->failure(
                $summary . sprintf(
                    ' — %d event(s) exhausted their retries and were dropped; replay them from '
                    . '/integration/outbox after fixing the cause',
                    $result['dead'],
                ),
                $counts,
            );
        } else {
            $beat->success($counts, $summary);
        }

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

    /** Seam: the test substitutes a heartbeat whose transport explodes. */
    protected function heartbeat(): CronHeartbeat
    {
        return CronHeartbeat::for(self::MONITOR);
    }

    /** Seam: the test substitutes a dispatcher that needs no database. */
    protected function dispatcher(): OutboxService
    {
        return new OutboxService();
    }
}
