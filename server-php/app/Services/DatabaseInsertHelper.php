<?php

namespace App\Services;

/**
 * Safe inserts and auto-increment reads (PostgreSQL transactions abort on failed SQL).
 */
class DatabaseInsertHelper
{
    /**
     * @param array<string, mixed> $data
     */
    public static function insert(\CodeIgniter\Database\BaseConnection $db, string $table, array $data): void
    {
        if ($db->table($table)->insert($data) === false) {
            throw self::queryFailed($db, 'Insert into ' . $table . ' failed');
        }
    }

    /**
     * @param callable(): int|null $fallback Resolve id when insertID()/LASTVAL is unavailable.
     */
    public static function lastInsertId(\CodeIgniter\Database\BaseConnection $db, ?callable $fallback = null): int
    {
        try {
            $id = (int) $db->insertID();
            if ($id > 0) {
                return $id;
            }
        } catch (\Throwable $e) {
            // PostgreSQL driver: failed LASTVAL query returns false → getRow() on bool.
        }

        if ($fallback !== null) {
            try {
                $id = (int) $fallback();
                if ($id > 0) {
                    return $id;
                }
            } catch (\Throwable $e) {
                throw self::queryFailed($db, 'Could not determine new row id after insert', $e);
            }
        }

        throw self::queryFailed($db, 'Could not determine new row id after insert');
    }

    /**
     * @param \CodeIgniter\Database\BaseBuilder $builder
     * @return ?array<string, mixed>
     */
    public static function firstRow(\CodeIgniter\Database\BaseConnection $db, $builder): ?array
    {
        $result = $builder->get();
        if ($result === false) {
            throw self::queryFailed($db, 'Query failed');
        }

        return $result->getRowArray() ?: null;
    }

    /**
     * @param \CodeIgniter\Database\BaseBuilder $builder
     * @return list<array<string, mixed>>
     */
    public static function allRows(\CodeIgniter\Database\BaseConnection $db, $builder): array
    {
        $result = $builder->get();
        if ($result === false) {
            throw self::queryFailed($db, 'Query failed');
        }

        return $result->getResultArray();
    }

    public static function queryFailed(
        \CodeIgniter\Database\BaseConnection $db,
        string $context,
        ?\Throwable $previous = null,
    ): \RuntimeException {
        $err = $db->error();
        $detail = trim((string) ($err['message'] ?? ''));
        $message = $detail !== '' ? $context . ': ' . $detail : $context;

        return new \RuntimeException($message, 0, $previous);
    }
}
