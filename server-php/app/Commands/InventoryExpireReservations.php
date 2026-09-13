<?php

namespace App\Commands;

use App\Services\ReservationService;
use CodeIgniter\CLI\BaseCommand;
use CodeIgniter\CLI\CLI;

/**
 * php spark inventory:expire-reservations [--company=ID] [--as-of="YYYY-MM-DD HH:MM:SS"]
 *
 * Releases every open reservation whose expires_at has passed (ReservationService::expireDue),
 * company by company, so the reserved quantity flows back into "available". Meant to run from
 * cron every few minutes next to inventory:outbox-dispatch. Without --company every company that
 * has an open, expiring reservation is processed.
 */
class InventoryExpireReservations extends BaseCommand
{
    use EqualsOptionSyntax;

    protected $group       = 'Inventory';
    protected $name        = 'inventory:expire-reservations';
    protected $description = 'Release open reservations whose expiry time has passed.';
    protected $usage       = 'inventory:expire-reservations [--company=ID] [--as-of=DATETIME]';
    protected $options     = [
        '--company' => 'Only this company id (default: every company with a due reservation).',
        '--as-of'   => 'Treat this timestamp as "now" (default: current time).',
    ];

    public function run(array $params)
    {
        $this->normaliseEqualsOptions();
        $this->normaliseOptions();
        $cmpId = (int) (CLI::getOption('company') ?? $params['company'] ?? 0);
        $asOf = (string) (CLI::getOption('as-of') ?? $params['as-of'] ?? '');
        $asOf = $asOf !== '' ? date('Y-m-d H:i:s', strtotime($asOf) ?: time()) : date('Y-m-d H:i:s');

        $db = \Config\Database::connect();
        $q = $db->table('inv_reservations')->select('cmp_id')->distinct()
            ->whereIn('status', ReservationService::OPEN_STATUSES)
            ->where('expires_at IS NOT NULL', null, false)->where('expires_at <', $asOf)->orderBy('cmp_id', 'ASC');
        if ($cmpId > 0) {
            $q->where('cmp_id', $cmpId);
        }
        $companies = array_map(static fn ($r) => (int) $r['cmp_id'], $q->get()->getResultArray());
        if ($companies === []) {
            CLI::write('No reservations due for expiry.', 'yellow');

            return EXIT_SUCCESS;
        }

        $service = new ReservationService();
        $total = 0;
        $failed = 0;
        foreach ($companies as $company) {
            try {
                $n = $service->expireDue($company, $asOf);
                $total += $n;
                CLI::write(sprintf('company %d: expired %d reservation(s)', $company, $n), 'green');
            } catch (\Throwable $e) {
                $failed++;
                CLI::error(sprintf('company %d: %s', $company, $e->getMessage()));
            }
        }
        CLI::write(sprintf('expired=%d companies=%d failed=%d as_of=%s', $total, count($companies), $failed, $asOf), $failed > 0 ? 'yellow' : 'green');

        return $failed > 0 ? EXIT_ERROR : EXIT_SUCCESS;
    }

    /** CI4 only parses "--opt value"; accept "--opt=value" too (same trick as inventory:migrate-books). */
    private function normaliseOptions(): void
    {
        $args = $_SERVER['argv'] ?? [];
        $opts = [];
        foreach ($args as $a) {
            if (is_string($a) && str_starts_with($a, '--') && str_contains($a, '=')) {
                [$k, $v] = explode('=', substr($a, 2), 2);
                $opts[$k] = $v;
            }
        }
        if ($opts === []) {
            return;
        }
        try {
            $ref = new \ReflectionProperty(CLI::class, 'options');
            $ref->setAccessible(true);
            $ref->setValue(null, array_merge((array) $ref->getValue(), $opts));
        } catch (\Throwable) {
            // best effort
        }
    }
}
