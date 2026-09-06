<?php

namespace App\Services;

/**
 * Whether the year-end close has carried ITEMS into a financial year.
 *
 * This is the switch that decides whether a year opens on carried-forward rows
 * (inv_item_openings with fy_id = year) or on the company's inception opening
 * (fy_id = 0). A completed run is the authority; a year closed flat writes no
 * rows and must still open at nil (identical rule to Books).
 */
class FyCarryForwardStatus
{
    /** @var array<string, bool> */
    private static array $cache = [];

    public static function hasRunInto(int $cmpId, int $fyId): bool
    {
        if ($cmpId <= 0 || $fyId <= 0) {
            return false;
        }
        $key = $cmpId . ':' . $fyId;
        if (array_key_exists($key, self::$cache)) {
            return self::$cache[$key];
        }
        $db = \Config\Database::connect();
        $completed = false;
        if (SchemaCache::tableExists($db, 'inv_fy_carryforward_status')) {
            $completed = $db->table('inv_fy_carryforward_status')
                ->where('cmp_id', $cmpId)->where('target_fy_id', $fyId)->where('status', 'completed')
                ->countAllResults() > 0;
        }
        if (!$completed && SchemaCache::tableExists($db, 'inv_item_openings')) {
            $completed = $db->table('inv_item_openings')
                ->where('cmp_id', $cmpId)->where('fy_id', $fyId)
                ->countAllResults() > 0;
        }

        return self::$cache[$key] = $completed;
    }

    public static function flush(): void
    {
        self::$cache = [];
    }
}
