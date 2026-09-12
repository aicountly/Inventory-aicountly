<?php

namespace App\Services;

use CodeIgniter\Database\BaseConnection;

/**
 * Request-scoped memo for `tableExists` / `fieldExists` probes.
 *
 * CodeIgniter's `tableExists($name, false)` deliberately bypasses the driver's
 * table-name cache, so every call is a fresh `information_schema` round trip.
 * That is the right call in migration code, but reporting services probe the
 * same handful of tables inside per-item loops — a single Profit & Loss run was
 * issuing over 5,000 of these probes and spending the majority of its wall clock
 * inside them.
 *
 * Schema does not change while a request is in flight, so each answer is
 * memoised per connection. The memo hangs off a WeakMap keyed by the connection
 * object, so it is discarded with the connection and can never be handed to a
 * later connection that happens to reuse the same object slot. Processes that
 * run DDL and then keep querying (migrations, test schema rebuilds) call
 * {@see flush()} to drop it.
 */
final class SchemaCache
{
    /** @var \WeakMap<BaseConnection, array{tables: array<string, bool>, fields: array<string, bool>}>|null */
    private static ?\WeakMap $memo = null;

    public static function tableExists(BaseConnection $db, string $table): bool
    {
        $memo = self::memoFor($db);
        if (!array_key_exists($table, $memo['tables'])) {
            // Probe uncached on the miss, so a table created earlier in this
            // process (bootstrap, migrations) is still seen the first time.
            $memo['tables'][$table] = $db->tableExists($table, false);
            self::$memo[$db] = $memo;
        }

        return $memo['tables'][$table];
    }

    public static function fieldExists(BaseConnection $db, string $field, string $table): bool
    {
        $memo = self::memoFor($db);
        $key  = $table . '.' . $field;
        if (!array_key_exists($key, $memo['fields'])) {
            $memo['fields'][$key] = $db->fieldExists($field, $table);
            self::$memo[$db] = $memo;
        }

        return $memo['fields'][$key];
    }

    /**
     * Drop the memo. Call after DDL that adds or removes tables/columns inside
     * the same process (migrations, test schema rebuilds).
     */
    public static function flush(): void
    {
        self::$memo = null;
    }

    /**
     * @return array{tables: array<string, bool>, fields: array<string, bool>}
     */
    private static function memoFor(BaseConnection $db): array
    {
        self::$memo ??= new \WeakMap();

        return self::$memo[$db] ??= ['tables' => [], 'fields' => []];
    }
}
