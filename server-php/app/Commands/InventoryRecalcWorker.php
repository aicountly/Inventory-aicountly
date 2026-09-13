<?php

namespace App\Commands;

use App\Services\RecalculationService;
use CodeIgniter\CLI\BaseCommand;
use CodeIgniter\CLI\CLI;

/**
 * php spark inventory:recalc-worker [--limit=N] [--cmp=ID]
 *
 * Runs QUEUED backdated-valuation recalculation jobs (inv_valuation_recalc_jobs), oldest first,
 * through RecalculationService::run() and prints one line per job. Meant for cron / supervisor.
 */
class InventoryRecalcWorker extends BaseCommand
{
    use EqualsOptionSyntax;

    protected $group       = 'Inventory';
    protected $name        = 'inventory:recalc-worker';
    protected $description = 'Run queued backdated valuation recalculation jobs (oldest first).';
    protected $usage       = 'inventory:recalc-worker [--limit=N] [--cmp=ID]';
    protected $options     = [
        '--limit' => 'Maximum number of jobs to run in this invocation (default 20).',
        '--cmp'   => 'Only run jobs of this company id.',
    ];

    public function run(array $params)
    {
        $this->normaliseEqualsOptions();
        $limit = (int) (CLI::getOption('limit') ?? $params['limit'] ?? 20);
        $limit = $limit > 0 ? min($limit, 1000) : 20;
        $cmpId = (int) (CLI::getOption('cmp') ?? $params['cmp'] ?? 0);

        try {
            $db = \Config\Database::connect();
            $b = $db->table('inv_valuation_recalc_jobs')->select('job_id, cmp_id, fy_id, item_id, from_date, trigger_kind, dry_run, created_at')
                ->where('status', 'QUEUED')->orderBy('created_at', 'ASC')->orderBy('job_id', 'ASC')->limit($limit);
            if ($cmpId > 0) {
                $b->where('cmp_id', $cmpId);
            }
            $jobs = $b->get()->getResultArray();
        } catch (\Throwable $e) {
            CLI::error('Could not read the recalculation queue: ' . $e->getMessage());

            return EXIT_ERROR;
        }
        if ($jobs === []) {
            CLI::write('No queued recalculation jobs.', 'yellow');

            return EXIT_SUCCESS;
        }

        $service = new RecalculationService();
        $ok = 0;
        $failed = 0;
        foreach ($jobs as $job) {
            $jobId = (int) $job['job_id'];
            $label = sprintf('job #%d cmp=%d fy=%s item=%s from=%s trigger=%s%s', $jobId, (int) $job['cmp_id'], $job['fy_id'] ?? '-', $job['item_id'] ?? 'all', $job['from_date'], $job['trigger_kind'], (int) $job['dry_run'] === 1 ? ' (dry-run)' : '');
            CLI::write('Running ' . $label . ' ...');
            $started = microtime(true);
            try {
                $result = $service->run($jobId);
                $secs = round(microtime(true) - $started, 2);
                $status = (string) ($result['status'] ?? '?');
                $line = sprintf('  %s %s: lines=%d revised=%d cogs_delta=%s (%ss)', $status === 'COMPLETED' ? 'OK' : $status, $label, (int) ($result['affected_line_count'] ?? 0), (int) ($result['revised_line_count'] ?? 0), number_format((float) ($result['cogs_delta'] ?? 0), 4, '.', ''), $secs);
                if ($status === 'COMPLETED') {
                    $ok++;
                    CLI::write($line, 'green');
                } else {
                    $failed++;
                    CLI::write($line . ' ' . (string) ($result['failure_reason'] ?? ''), 'red');
                }
            } catch (\Throwable $e) {
                $failed++;
                CLI::error(sprintf('  FAILED %s: %s', $label, $e->getMessage()));
            }
        }
        CLI::write(sprintf('Done. %d completed, %d failed, %d picked up.', $ok, $failed, count($jobs)), $failed > 0 ? 'yellow' : 'green');

        return $failed > 0 ? EXIT_ERROR : EXIT_SUCCESS;
    }
}
