<?php

namespace App\Commands;

use App\Services\ReconciliationService;
use App\Services\StockBalanceService;
use CodeIgniter\CLI\BaseCommand;
use CodeIgniter\CLI\CLI;
use App\Services\CronHeartbeat;

/**
 * php spark inventory:reconcile [--company 1,2 | --all | --due N] [--as-of YYYY-MM-DD] [--bo 0]
 *
 * Runs the Inventory ↔ Books reconciliation for the latest financial year of each company
 * and prints the unexplained difference. Non-zero exit when a company's reconciliation itself
 * could not be completed — Books was unreachable, or it threw.
 *
 * A completed reconciliation that finds a non-zero unexplained amount is NOT a failure and does
 * not affect the exit code. "Unexplained" means genuine — a bad entry, a negative-stock override,
 * whatever the breakdown's unexplained bucket says caused it — not a bug in this command or in
 * the valuation it ran. That is a finding for a human to read in the printed breakdown (still
 * shown, in yellow rather than green) or in the reconciliation report, never a reason for Console's
 * cron monitor to page anyone: this job did exactly what it was asked to do. Making every ordinary,
 * already-understood data discrepancy ring the same alarm as a dead cron is how a monitor gets
 * ignored — see CronHeartbeat's own docblock.
 *
 * --all runs every company with a document, in one invocation — correct at any scale, but the
 * wall-clock cost (one Books HTTP round-trip plus a valuation snapshot per company) grows with
 * the company count. Fine for a company list small enough to finish overnight; at a large company
 * count a single nightly --all sweep can run for hours in one process.
 *
 * --due N is the scale-safe alternative: it reconciles only the N companies (from the same
 * --all universe) least recently reconciled — companies never reconciled sort first — instead of
 * every company in one pass. No company is ever skipped: every company keeps rising to the front
 * of the queue as its neighbours get checked, so full coverage still happens, just spread across
 * many short, cheap invocations (cron every few minutes) instead of one long nightly one. This
 * deliberately does NOT skip a company merely for having no new Inventory activity — Books can
 * post a manual journal straight onto its stock ledger with no Inventory-side signal at all
 * (see ReconciliationService's manual_journal bucket), so "nothing changed here" can only be
 * known by actually asking Books, which is the one thing this can't cut a corner on. --due only
 * changes HOW OFTEN a company's turn comes up, never WHETHER it's checked.
 */
class InventoryReconcile extends BaseCommand
{
    use EqualsOptionSyntax;

    protected $group       = 'Inventory';
    protected $name        = 'inventory:reconcile';
    protected $description = 'Reconcile Inventory closing stock value with the Books Stock-in-Hand ledger per company.';
    protected $usage       = 'inventory:reconcile [--company 1,2 | --all | --due N] [--as-of YYYY-MM-DD] [--bo 0]';
    protected $options     = [
        '--company' => 'Comma separated cmp_ids',
        '--all'     => 'Every company that has documents, in one run',
        '--due'     => 'The N companies (of --all\'s universe) least recently reconciled — for a frequent, bounded cron instead of one nightly --all sweep',
        '--as-of'   => 'Closing date (default today)',
        '--bo'      => 'Branch (default 0 = consolidated)',
    ];

    /** The monitor code Console pairs these heartbeats with (console migration 034). */
    public const MONITOR = 'inventory.reconcile_all';

    /**
     * Reports each run of the nightly reconciliation to Console's Cron Job Monitor.
     *
     * Silent and inert until CONSOLE_CRON_MONITOR_KEY is set, and it can never fail this
     * command: the heartbeat is swallowed and the exit code below still has the last word.
     * Null is coerced to success — a command that falls off the end without returning has
     * not failed, and reporting it as one would make the monitor cry wolf every cycle.
     *
     * $beat is handed into execute() so a failing run can tell Console WHICH company failed and
     * why, instead of reportRun()'s own generic "Exited with code 1" — the two compose (see
     * execute()'s docblock) rather than one replacing the other.
     */
    public function run(array $params)
    {
        return CronHeartbeat::reportRun(
            self::MONITOR,
            fn (CronHeartbeat $beat): int => (int) ($this->execute($params, $beat) ?? EXIT_SUCCESS),
        );
    }

    /**
     * @param CronHeartbeat $beat reports the per-company outcome; reportRun() still decides the
     *                            final outcome from the exit code this returns (see its docblock)
     */
    private function execute(array $params, CronHeartbeat $beat)
    {
        $this->normaliseEqualsOptions();
        foreach ($_SERVER['argv'] ?? [] as $arg) {
            if (is_string($arg) && str_starts_with($arg, '--') && str_contains($arg, '=')) {
                [$k, $v] = explode('=', ltrim($arg, '-'), 2);
                $ref = new \ReflectionProperty(CLI::class, 'options');
                $ref->setAccessible(true);
                $opts = $ref->getValue();
                $opts[$k] = $v;
                $ref->setValue(null, $opts);
            }
        }
        $db = \Config\Database::connect();
        $dueOpt = CLI::getOption('due') ?? $params['due'] ?? null;
        $due = $dueOpt !== null && $dueOpt !== '' ? (int) $dueOpt : null;
        if ($due !== null) {
            if (CLI::getOption('company') !== null) {
                CLI::error('--due cannot be combined with --company.');

                return EXIT_USER_INPUT;
            }
            if (CLI::getOption('all') !== null) {
                CLI::error('--due cannot be combined with --all — --due already scopes to the --all universe.');

                return EXIT_USER_INPUT;
            }
            if ($due <= 0) {
                CLI::error('--due must be a positive number of companies.');

                return EXIT_USER_INPUT;
            }
        }

        $companies = array_values(array_filter(array_map('intval', explode(',', (string) (CLI::getOption('company') ?? '')))));
        if ($companies === [] && CLI::getOption('all') !== null) {
            $companies = array_map(static fn ($r) => (int) $r['cmp_id'], $db->query('SELECT DISTINCT cmp_id FROM inv_documents ORDER BY cmp_id')->getResultArray());
        }
        if ($companies === [] && $due !== null) {
            $companies = $this->dueCompanies($due);
        }
        if ($companies === []) {
            CLI::error('Give --company=1,2, --all, or --due=N');

            return EXIT_USER_INPUT;
        }
        if ($due !== null) {
            CLI::write(sprintf('inventory:reconcile --due=%d: %d compan%s picked up (least recently reconciled first)', $due, count($companies), count($companies) === 1 ? 'y' : 'ies'));
        }
        $asOf = (string) (CLI::getOption('as-of') ?? date('Y-m-d'));
        $boId = (int) (CLI::getOption('bo') ?? 0);
        $svc = new ReconciliationService();
        $balances = new StockBalanceService();
        $bad = 0;
        $clean = 0;
        /** @var list<string> $problems one line per company the run itself could not complete */
        $problems = [];
        foreach ($companies as $cmpId) {
            $fyId = $balances->latestFyId($cmpId);
            if ($fyId <= 0) {
                CLI::write(sprintf('  cmp %d: no financial year with documents, skipped', $cmpId), 'yellow');
                continue;
            }
            try {
                $r = $svc->run($cmpId, $fyId, $boId, $asOf, 'cli:inventory-reconcile');
                $status = (string) ($r['status'] ?? '?');
                $unexplained = (float) ($r['breakdown']['buckets']['unexplained']['amount'] ?? 0);
                // Job health: did the reconciliation itself run to completion? Whether it found a
                // clean match or a genuine unexplained residual is a data finding, not a job
                // failure — see this file's docblock. Only a status other than COMPLETED (Books
                // unreachable, or ReconciliationService::run() catching its own failure) counts
                // against $bad, which is what drives this command's exit code and therefore
                // Console's cron-monitor FAILING state.
                $completed = $status === 'COMPLETED';
                $isClean = $completed && abs($unexplained) < 0.005;
                $clean += $isClean ? 1 : 0;
                if (!$completed) {
                    $bad++;
                    $problems[] = sprintf('cmp %d: %s%s', $cmpId, $status, !empty($r['breakdown']['books']['error']) ? ' (' . $r['breakdown']['books']['error'] . ')' : '');
                }
                CLI::write(sprintf('  cmp %d fy %d: %s inventory=%s books=%s difference=%s unexplained=%s', $cmpId, $fyId, $status, $r['inventory_closing_value'] ?? '?', $r['books_stock_ledger_balance'] ?? 'n/a', $r['difference'] ?? 'n/a', number_format($unexplained, 2, '.', '')), $completed ? ($isClean ? 'green' : 'yellow') : 'red');
                if (!$completed && !empty($r['breakdown']['books']['error'])) {
                    CLI::write('    books: ' . $r['breakdown']['books']['error'], 'yellow');
                }
            } catch (\Throwable $e) {
                $bad++;
                $problems[] = sprintf('cmp %d: %s', $cmpId, $e->getMessage());
                CLI::error(sprintf('  cmp %d: %s', $cmpId, $e->getMessage()));
            }
        }

        $counts = ['companies' => count($companies), 'bad' => $bad, 'clean' => $clean];
        if ($bad > 0) {
            // Console's Detail column used to read a bare "Exited with code 1" for every reconcile
            // failure, whatever company or reason caused it — the CLI output naming the actual
            // company was thrown away by the crontab's own `>/dev/null 2>&1`. This is the only
            // other place that reason can reach whoever is looking at the monitor.
            $beat->failure(sprintf('%d of %d compan%s could not be reconciled: %s', $bad, count($companies), count($companies) === 1 ? 'y' : 'ies', implode('; ', $problems)), $counts);
        } else {
            $beat->success($counts, sprintf('%d compan%s reconciled, %d clean', count($companies), count($companies) === 1 ? 'y' : 'ies', $clean));
        }

        return $bad > 0 ? EXIT_ERROR : EXIT_SUCCESS;
    }

    /**
     * The N companies (of the --all universe: distinct cmp_id in inv_documents) least recently
     * reconciled — a company with no row in inv_reconciliation_runs at all sorts first, ahead of
     * one reconciled a year ago, since "never checked" is more overdue than any checked date.
     * cmp_id ASC breaks ties (same last_run, or several companies never yet reconciled) so the
     * order — and therefore which N are picked — is stable across runs in the same second.
     *
     * Public so a test can call it directly without exercising the per-company loop, which
     * would otherwise need real financial-year data and a reachable Books to run cleanly.
     *
     * @return list<int>
     */
    public function dueCompanies(int $due): array
    {
        $db = \Config\Database::connect();

        return array_map(static fn ($r) => (int) $r['cmp_id'], $db->query(
            'SELECT d.cmp_id FROM (SELECT DISTINCT cmp_id FROM inv_documents) d'
            . ' LEFT JOIN (SELECT cmp_id, MAX(created_at) AS last_run FROM inv_reconciliation_runs GROUP BY cmp_id) r ON r.cmp_id = d.cmp_id'
            . ' ORDER BY r.last_run ASC NULLS FIRST, d.cmp_id ASC'
            . ' LIMIT ?',
            [$due],
        )->getResultArray());
    }
}
