<?php

namespace App\Services;

/**
 * When a pending quantity is late, how old it is, and how much it matters.
 *
 * A pending line carries no due date of its own and no priority flag: the row in
 * inv_pending_quantities is a quantity and a status, and everything the register
 * shows beyond that is DERIVED. This class is the one place those derivations are
 * written down, so the SQL that filters on "overdue" and the SQL that colours a
 * priority badge cannot drift apart, and so a company can move the thresholds
 * without a schema change.
 *
 * The thresholds live in inv_company_settings.settings_json under
 * `pending_register`. That column already exists and is already the home of
 * per-company policy that does not deserve a column of its own; adding a master
 * table for six integers would be a duplicate of a thing the product already has.
 *
 * Nothing here invents a date. `expected_return_date` on the document is the real
 * commitment where one was recorded — it is what a delivery challan or a job-work
 * challan promises, and ITC-04 is read against it. Only when a document carries no
 * such date does the grace period below stand in for one, and the register says so
 * in the column's own tooltip rather than presenting a guess as a fact.
 */
class PendingRegisterPolicy
{
    /**
     * Days after the document date a line is allowed to stay open when the document
     * recorded no expected return date. Beyond it the line reads as overdue.
     *
     * 30 is the ordinary commercial month a challan or an open order is chased on,
     * and it is deliberately LONGER than the 15-day "badly overdue" step below so a
     * line becomes overdue before it becomes high priority, never the other way
     * round.
     */
    public const DEFAULT_GRACE_DAYS = 30;

    /** Days past due at which a line stops being merely late and becomes urgent. */
    public const DEFAULT_HIGH_OVERDUE_DAYS = 15;

    /** Days open at which age alone starts to count towards priority. */
    public const DEFAULT_HIGH_AGEING_DAYS = 60;

    /** Pending value, at cost, above which a line counts as material. */
    public const DEFAULT_HIGH_VALUE = 100000.0;

    /**
     * How recently a settlement must have landed for a part-settled line to read as
     * "settling" rather than "partial" — the difference between work in progress and
     * work that stalled halfway.
     */
    public const DEFAULT_SETTLING_WINDOW_DAYS = 7;

    /** The ageing buckets the filter offers, in days. `null` upper bound = open-ended. */
    public const AGEING_BUCKETS = [
        '0_7'   => [0, 7],
        '8_15'  => [8, 15],
        '16_30' => [16, 30],
        '31_60' => [31, 60],
        '60_'   => [61, null],
    ];

    /** @var array<int, array<string, float|int>> */
    private static array $cache = [];

    /**
     * Thresholds for a company, defaults filled in.
     *
     * @return array{grace_days:int, high_overdue_days:int, high_ageing_days:int, high_value:float, settling_window_days:int}
     */
    public function forCompany(int $cmpId): array
    {
        if (isset(self::$cache[$cmpId])) {
            /** @var array{grace_days:int, high_overdue_days:int, high_ageing_days:int, high_value:float, settling_window_days:int} */
            return self::$cache[$cmpId];
        }
        $settings = [];
        try {
            $settings = (new InventorySettingsService())->get($cmpId)['settings'] ?? [];
        } catch (\Throwable) {
            // A company whose settings row cannot be read still gets a register;
            // it gets one on the documented defaults.
            $settings = [];
        }
        $p = is_array($settings['pending_register'] ?? null) ? $settings['pending_register'] : [];

        $resolved = [
            'grace_days'           => $this->positiveInt($p['grace_days'] ?? null, self::DEFAULT_GRACE_DAYS),
            'high_overdue_days'    => $this->positiveInt($p['high_overdue_days'] ?? null, self::DEFAULT_HIGH_OVERDUE_DAYS),
            'high_ageing_days'     => $this->positiveInt($p['high_ageing_days'] ?? null, self::DEFAULT_HIGH_AGEING_DAYS),
            'high_value'           => $this->positiveFloat($p['high_value'] ?? null, self::DEFAULT_HIGH_VALUE),
            'settling_window_days' => $this->positiveInt($p['settling_window_days'] ?? null, self::DEFAULT_SETTLING_WINDOW_DAYS),
        ];

        return self::$cache[$cmpId] = $resolved;
    }

    public static function flush(): void
    {
        self::$cache = [];
    }

    private function positiveInt(mixed $value, int $fallback): int
    {
        if ($value === null || $value === '' || !is_numeric($value)) {
            return $fallback;
        }
        $n = (int) $value;

        return $n > 0 ? $n : $fallback;
    }

    private function positiveFloat(mixed $value, float $fallback): float
    {
        if ($value === null || $value === '' || !is_numeric($value)) {
            return $fallback;
        }
        $n = (float) $value;

        return $n > 0 ? $n : $fallback;
    }
}
