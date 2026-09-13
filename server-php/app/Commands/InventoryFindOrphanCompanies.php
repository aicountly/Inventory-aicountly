<?php

namespace App\Commands;

use CodeIgniter\CLI\BaseCommand;
use CodeIgniter\CLI\CLI;

/**
 * php spark inventory:find-orphan-companies [--deep] [--ids 3,13]
 *
 * Asks Manage whether the companies this database holds data for are still companies.
 *
 * Manage owns company identity; this product only ever sees a cmp_id. When a company is deleted
 * there, its data here stays — unreachable, because with no Manage record the company cannot be
 * opened, and unexplained, because the nightly reconciliation keeps reporting a difference for a
 * company nobody can see. Two companies sat like that for months and were found by accident.
 *
 * Manage now records deletions in ghm_company_deleted and answers
 * GET /internal/company-status?ids=... with one of:
 *
 *   active    the company exists and is in use          — nothing to do
 *   recycled  in Manage's recycle bin, restorable       — nothing to do, it may come back
 *   deleted   permanently deleted, tombstone present    — this data is orphaned
 *   unknown   Manage has never heard of the id          — orphaned, and deleted before Manage
 *                                                         kept tombstones, so no record of when
 *
 * It reports. It does not purge: deleting a company in Manage does not entitle anything to
 * destroy records this product is required to keep, and a purge that runs itself is a purge
 * nobody checked. Use inventory:purge-company for that, which archives first and reads the rows back.
 *
 * Exits non-zero when anything is orphaned, or when the question could not be asked, so a cron
 * entry surfaces both rather than only the first.
 */
class InventoryFindOrphanCompanies extends BaseCommand
{
    protected $group       = 'Inventory';
    protected $name        = 'inventory:find-orphan-companies';
    protected $description = 'Ask Manage whether the companies held here still exist.';
    protected $usage       = 'inventory:find-orphan-companies [--deep] [--ids 3,13]';
    protected $options     = [
        '--deep' => 'Look in every table with a cmp_id, not just inv_company_settings (slow on a large database)',
        '--ids'  => 'Check only these company ids, comma-separated, instead of discovering them',
    ];

    /**
     * One row per company, so it answers "which companies exist here" in a single indexed scan.
     *
     * A company whose settings row was removed but whose other data survived would be missed,
     * which is what --deep is for. The cheap question is the right default for something meant
     * to run nightly; the thorough one is there for when you want certainty.
     */
    private const SETTINGS_TABLE = 'inv_company_settings';

    public function run(array $params)
    {
        foreach ($_SERVER['argv'] ?? [] as $arg) {
            if (is_string($arg) && str_starts_with($arg, '--') && str_contains($arg, '=')) {
                [$k, $v] = explode('=', ltrim($arg, '-'), 2);
                $ref = new \ReflectionProperty(CLI::class, 'options');
                $ref->setAccessible(true);
                $opts = $ref->getValue();
                $opts[$k] ??= $v;
                $ref->setValue(null, $opts);
            }
        }

        $db = \Config\Database::connect();

        $explicit = trim((string) (CLI::getOption('ids') ?? ''));
        $ids = $explicit !== ''
            ? $this->parseIds($explicit)
            : $this->localCompanyIds($db, CLI::getOption('deep') !== null);

        if ($ids === []) {
            CLI::write('This database holds no company data.', 'green');

            return EXIT_SUCCESS;
        }
        CLI::write(sprintf('Asking Manage about %d company id(s).', count($ids)));

        $statuses = $this->askManage($ids);
        if ($statuses === null) {
            return EXIT_ERROR;
        }

        $orphans = [];
        $counts = ['active' => 0, 'recycled' => 0, 'deleted' => 0, 'unknown' => 0];
        foreach ($ids as $id) {
            $row = $statuses[(string) $id] ?? $statuses[$id] ?? ['status' => 'unknown'];
            $status = (string) ($row['status'] ?? 'unknown');
            $counts[$status] = ($counts[$status] ?? 0) + 1;
            if ($status === 'deleted' || $status === 'unknown') {
                $orphans[$id] = $row;
            }
        }

        CLI::write(sprintf('  active %d, recycled %d, deleted %d, unknown %d',
            $counts['active'], $counts['recycled'], $counts['deleted'], $counts['unknown']));

        if ($orphans === []) {
            CLI::write('');
            CLI::write('Every company held here still exists in Manage.', 'green');

            return EXIT_SUCCESS;
        }

        CLI::write('');
        CLI::error(sprintf('%d company(ies) hold data here but no longer exist in Manage:', count($orphans)));
        foreach ($orphans as $id => $row) {
            $name = trim((string) ($row['cmp_name'] ?? ''));
            $when = trim((string) ($row['deleted_at'] ?? ''));
            CLI::write(sprintf('  cmp %-6d %-40s %s', $id,
                $name !== '' ? $name : '(name not recorded)',
                (string) $row['status'] === 'deleted'
                    ? ('deleted ' . ($when !== '' ? substr($when, 0, 10) : 'on an unrecorded date'))
                    : 'deleted before Manage kept a record of deletions'), 'red');
        }
        CLI::write('');
        CLI::write('Review each one, then archive and remove it deliberately:');
        foreach (array_keys($orphans) as $id) {
            CLI::write(sprintf('  php spark inventory:purge-company --company %d            # dry run first', $id));
        }
        CLI::write('Nothing has been changed.');

        return EXIT_ERROR;
    }

    /** @return list<int> */
    private function parseIds(string $raw): array
    {
        $ids = array_filter(array_map('intval', explode(',', $raw)), static fn (int $i): bool => $i > 0);

        return array_values(array_unique($ids));
    }

    /** @return list<int> */
    private function localCompanyIds($db, bool $deep): array
    {
        $tables = $deep ? $this->tablesWithCompany($db) : [self::SETTINGS_TABLE];
        $ids = [];
        foreach ($tables as $t) {
            if (!$db->tableExists($t, false)) {
                continue;
            }
            try {
                $res = $db->query('SELECT DISTINCT cmp_id FROM public."' . $t . '" WHERE cmp_id IS NOT NULL');
            } catch (\Throwable) {
                continue;
            }
            if ($res === false) {
                continue;
            }
            foreach ($res->getResultArray() as $row) {
                $id = (int) ($row['cmp_id'] ?? 0);
                if ($id > 0) {
                    $ids[$id] = true;
                }
            }
        }
        $out = array_keys($ids);
        sort($out);

        return $out;
    }

    /** @return list<string> */
    private function tablesWithCompany($db): array
    {
        $res = $db->query(
            "SELECT table_name FROM information_schema.columns
             WHERE table_schema = 'public' AND column_name = 'cmp_id'
             ORDER BY table_name",
        );

        return $res === false ? [] : array_column($res->getResultArray(), 'table_name');
    }

    /**
     * @param list<int> $ids
     * @return array<array-key, array<string, mixed>>|null null when the question could not be asked
     */
    private function askManage(array $ids): ?array
    {
        $key = trim((string) (getenv('MANAGE_PRODUCT_SERVICE_KEY') ?: ''));
        if ($key === '') {
            CLI::error('MANAGE_PRODUCT_SERVICE_KEY is not set in this .env, so Manage cannot be asked.');
            CLI::write('It must match the same key in Manage\'s .env. Until it is set, an orphaned');
            CLI::write('company will go unnoticed exactly as before — this is not a harmless warning.');

            return null;
        }

        $base = rtrim((string) (getenv('MANAGE_API_BASE') ?: 'https://manage.aicountly.com'), '/');
        $url = $base . '/api/internal/company-status?ids=' . implode(',', $ids);

        try {
            $client = service('curlrequest', ['http_errors' => false, 'timeout' => 15, 'connect_timeout' => 5]);
            $response = $client->request('GET', $url, ['headers' => [
                'Accept'        => 'application/json',
                'Authorization' => 'Bearer ' . $key,
            ]]);
        } catch (\Throwable $e) {
            CLI::error('Could not reach Manage at ' . $base . ': ' . $e->getMessage());

            return null;
        }

        $code = $response->getStatusCode();
        if ($code >= 400) {
            CLI::error(sprintf('Manage answered %d for %s', $code, $url));
            if ($code === 401) {
                CLI::write('The key does not match the one in Manage\'s .env.');
            } elseif ($code === 503) {
                CLI::write('Manage has no MANAGE_PRODUCT_SERVICE_KEY configured on its side.');
            }

            return null;
        }

        $body = json_decode((string) $response->getBody(), true);
        $rows = $body['data']['companies'] ?? null;
        if (!is_array($rows)) {
            CLI::error('Manage answered with a body this command did not understand.');

            return null;
        }

        return $rows;
    }
}
