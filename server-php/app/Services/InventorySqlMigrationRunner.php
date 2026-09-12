<?php

namespace App\Services;

use CodeIgniter\Database\BaseConnection;
use CodeIgniter\Database\Exceptions\DatabaseException;

/**
 * Applies numbered SQL files from database/migrations/ once per database.
 * Mirrors Books' BooksSqlMigrationRunner; tracking table is inv_sql_migrations.
 */
class InventorySqlMigrationRunner
{
    private const TRACKING_TABLE = 'inv_sql_migrations';

    public function __construct(
        private ?BaseConnection $db = null,
        private ?string $migrationsDir = null,
    ) {
        $this->db ??= \Config\Database::connect();
        $this->migrationsDir ??= ROOTPATH . 'database' . DIRECTORY_SEPARATOR . 'migrations';
    }

    /** @return list<string> */
    public function listMigrationFiles(?array $filters = null): array
    {
        $files = glob($this->migrationsDir . DIRECTORY_SEPARATOR . '*.sql') ?: [];
        sort($files, SORT_NATURAL);
        if ($filters !== null && $filters !== []) {
            $files = array_values(array_filter($files, static function (string $path) use ($filters): bool {
                $name = basename($path);
                foreach ($filters as $filter) {
                    if ($name === $filter || str_starts_with($name, $filter . '_')) {
                        return true;
                    }
                }

                return false;
            }));
        }

        return array_map('basename', $files);
    }

    /** @return array{applied: list<string>, pending: list<string>} */
    public function status(?array $filters = null): array
    {
        $this->ensureTrackingTable();
        $applied = $this->loadAppliedFilenames();
        $all = $this->listMigrationFiles($filters);

        return [
            'applied' => array_values(array_intersect($all, array_keys($applied))),
            'pending' => array_values(array_filter($all, static fn (string $f) => !isset($applied[$f]))),
        ];
    }

    /** @return array{applied: list<string>, skipped: list<string>, failed: ?string} */
    public function runPending(?array $filters = null): array
    {
        if ($this->db->DBDriver !== 'Postgre') {
            throw new \RuntimeException('Inventory SQL migrations require PostgreSQL (database.default.DBDriver = Postgre).');
        }
        $this->ensureTrackingTable();
        $appliedSet = $this->loadAppliedFilenames();
        $applied = [];
        $skipped = [];

        foreach ($this->listMigrationFiles($filters) as $filename) {
            if (isset($appliedSet[$filename])) {
                $skipped[] = $filename;
                continue;
            }
            $sql = file_get_contents($this->migrationsDir . DIRECTORY_SEPARATOR . $filename);
            if ($sql === false || trim($sql) === '') {
                $skipped[] = $filename;
                continue;
            }
            try {
                $this->db->transStart();
                if ($this->db->simpleQuery($sql) === false) {
                    throw new DatabaseException('SQL failed for ' . $filename . $this->errorSuffix());
                }
                $this->recordApplied($filename);
                if ($this->db->transStatus() === false) {
                    throw new DatabaseException('Transaction failed while applying ' . $filename . $this->errorSuffix());
                }
                $this->db->transComplete();
                $applied[] = $filename;
            } catch (\Throwable $e) {
                $this->db->transRollback();

                return ['applied' => $applied, 'skipped' => $skipped, 'failed' => $filename . ': ' . $e->getMessage()];
            }
        }
        SchemaCache::flush();

        return ['applied' => $applied, 'skipped' => $skipped, 'failed' => null];
    }

    /** @return list<string> */
    public function markAllApplied(?array $filters = null): array
    {
        $this->ensureTrackingTable();
        $appliedSet = $this->loadAppliedFilenames();
        $marked = [];
        foreach ($this->listMigrationFiles($filters) as $filename) {
            if (isset($appliedSet[$filename])) {
                continue;
            }
            $this->recordApplied($filename);
            $marked[] = $filename;
        }

        return $marked;
    }

    private function ensureTrackingTable(): void
    {
        $this->db->simpleQuery(
            'CREATE TABLE IF NOT EXISTS ' . self::TRACKING_TABLE . ' ('
            . 'id BIGSERIAL PRIMARY KEY, filename VARCHAR(255) NOT NULL UNIQUE, applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP)'
        );
    }

    /** @return array<string, true> */
    private function loadAppliedFilenames(): array
    {
        $rows = $this->db->table(self::TRACKING_TABLE)->select('filename')->get()->getResultArray();
        $out = [];
        foreach ($rows as $r) {
            $out[$r['filename']] = true;
        }

        return $out;
    }

    private function recordApplied(string $filename): void
    {
        $this->db->table(self::TRACKING_TABLE)->insert(['filename' => $filename, 'applied_at' => date('Y-m-d H:i:s')]);
    }

    private function errorSuffix(): string
    {
        $err = $this->db->error();
        $msg = trim((string) ($err['message'] ?? ''));

        return $msg !== '' ? ' — ' . $msg : '';
    }
}
