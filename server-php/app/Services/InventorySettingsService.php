<?php

namespace App\Services;

use App\Exceptions\InventoryException;

/**
 * Per-company inventory settings (inv_company_settings), created on first use.
 */
class InventorySettingsService
{
    public const METHODS = ['FIFO', 'LIFO', 'WAC'];
    public const METHOD_ALIASES = ['AVG' => 'WAC', 'AVG COST' => 'WAC', 'AVERAGE' => 'WAC', 'WEIGHTED' => 'WAC', 'FIFO' => 'FIFO', 'LIFO' => 'LIFO', 'WAC' => 'WAC'];
    public const NEGATIVE_POLICIES = ['allow', 'warn', 'block'];

    /**
     * The landed-cost types a company may switch OFF, i.e. declare it does not capitalise into the
     * cost of stock. Some companies capitalise inward freight, some expense it; that is a genuine
     * accounting-policy choice and it belongs to the company, not to whoever types the voucher.
     *
     * DocumentService::LANDED_COST_TYPES is the vocabulary; this is that list minus the one type
     * that is not a choice.
     */
    public const LANDED_COST_SWITCHABLE_TYPES = ['freight', 'duty', 'insurance', 'handling', 'other'];

    /**
     * NOT SWITCHABLE, and the reason is not squeamishness about a checkbox.
     *
     * Under AS-2 the cost of purchase includes taxes that are NOT subsequently recoverable from the
     * taxing authority. A tax that cannot be claimed is therefore part of what the goods cost — it
     * is not an expense the company may elect to keep out of stock. Offering a switch would create
     * a third state in which those rupees are neither a recoverable input credit nor a cost of the
     * goods, and they would simply disappear from both.
     *
     * The user's real choice about that money is made UPSTREAM, in Books, when the input tax credit
     * is declared claimable or not. Money that is claimable never arrives here as a landed cost at
     * all; money that arrives here as non_creditable_tax has already been declared unrecoverable,
     * and at that point AS-2 has already decided where it goes.
     */
    public const LANDED_COST_ALWAYS_CAPITALISED = ['non_creditable_tax'];

    /** @var array<int, array<string, mixed>> */
    private static array $cache = [];

    public static function normalizeMethod(?string $method, string $fallback = 'FIFO'): string
    {
        $m = strtoupper(trim((string) $method));

        return self::METHOD_ALIASES[$m] ?? $fallback;
    }

    public static function flush(): void
    {
        self::$cache = [];
    }

    /** @return array<string, mixed> */
    public function get(int $cmpId): array
    {
        if (isset(self::$cache[$cmpId])) {
            return self::$cache[$cmpId];
        }
        $this->ensureForCompany($cmpId);
        $row = \Config\Database::connect()->table('inv_company_settings')->where('cmp_id', $cmpId)->get()->getRowArray();
        $row = $row ?: ['cmp_id' => $cmpId, 'default_valuation_method' => 'FIFO', 'valuation_scope' => 'company', 'negative_stock_policy' => 'allow', 'landed_cost_excluded_types' => null];
        $row['settings'] = json_decode((string) ($row['settings_json'] ?? '{}'), true) ?: [];

        return self::$cache[$cmpId] = $row;
    }

    public function ensureForCompany(int $cmpId, string $defaultMethod = 'FIFO'): void
    {
        $db = \Config\Database::connect();
        if (!SchemaCache::tableExists($db, 'inv_company_settings')) {
            return;
        }
        $exists = $db->table('inv_company_settings')->where('cmp_id', $cmpId)->countAllResults() > 0;
        if (!$exists) {
            $db->table('inv_company_settings')->insert([
                'cmp_id'                   => $cmpId,
                'default_valuation_method' => self::normalizeMethod($defaultMethod),
                'valuation_scope'          => 'company',
                'negative_stock_policy'    => 'allow',
                'created_at'               => date('Y-m-d H:i:s'),
                'updated_at'               => date('Y-m-d H:i:s'),
            ]);
        }
    }

    public function defaultValuationMethod(int $cmpId): string
    {
        return self::normalizeMethod($this->get($cmpId)['default_valuation_method'] ?? 'FIFO');
    }

    public function valuationScope(int $cmpId): string
    {
        return ($this->get($cmpId)['valuation_scope'] ?? 'company') === 'warehouse' ? 'warehouse' : 'company';
    }

    public function negativeStockPolicy(int $cmpId): string
    {
        $p = strtolower((string) ($this->get($cmpId)['negative_stock_policy'] ?? 'allow'));

        return in_array($p, self::NEGATIVE_POLICIES, true) ? $p : 'allow';
    }

    public function cogsRevisionMode(int $cmpId): string
    {
        return ($this->get($cmpId)['cogs_revision_mode'] ?? 'inline') === 'adjustment' ? 'adjustment' : 'inline';
    }

    // ------------------------------------------------------------------ landed cost capitalisation policy

    /**
     * Every landed-cost type, switchable ones first, in the order the vocabulary declares them.
     *
     * @return list<string>
     */
    public static function landedCostTypes(): array
    {
        return array_values(array_merge(self::LANDED_COST_SWITCHABLE_TYPES, self::LANDED_COST_ALWAYS_CAPITALISED));
    }

    /**
     * The stored EXCLUDED set, cleaned: unknown words dropped, duplicates collapsed, order fixed.
     *
     * Excluded rather than included is what makes the default free. NULL, '' and a column that does
     * not exist yet all mean "nothing excluded", so every company that existed before this policy
     * did is already on "capitalise everything" with no backfill, and a cost type added to the
     * vocabulary later arrives switched ON rather than silently off for everyone.
     *
     * @return list<string>
     */
    public function excludedLandedCostTypes(int $cmpId): array
    {
        return self::parseExcludedTypes($this->get($cmpId)['landed_cost_excluded_types'] ?? null);
    }

    /**
     * The cost types this company capitalises into the cost of stock.
     *
     * This is the set a posted breakdown is checked against, and the set Books is told to offer on
     * the purchase screen. non_creditable_tax is always in it — see LANDED_COST_ALWAYS_CAPITALISED.
     *
     * @return list<string>
     */
    public function capitalisableLandedCostTypes(int $cmpId): array
    {
        $excluded = $this->excludedLandedCostTypes($cmpId);

        return array_values(array_filter(self::landedCostTypes(), static fn (string $t) => !in_array($t, $excluded, true)));
    }

    /**
     * The whole policy, shaped for a caller: what is on, what is off, what cannot be switched.
     *
     * Books reads this to decide which cost types to offer on a purchase voucher. The offer is a
     * courtesy, not the control: a UI can be cached, stale or bypassed by a direct API call, so
     * Inventory refuses an excluded type on the way in regardless of what any screen showed.
     *
     * @return array{capitalisable_cost_types: list<string>, excluded_cost_types: list<string>, switchable_cost_types: list<string>, always_capitalised_cost_types: list<string>, all_cost_types: list<string>}
     */
    public function landedCostPolicy(int $cmpId): array
    {
        return [
            'capitalisable_cost_types'      => $this->capitalisableLandedCostTypes($cmpId),
            'excluded_cost_types'           => $this->excludedLandedCostTypes($cmpId),
            'switchable_cost_types'         => self::LANDED_COST_SWITCHABLE_TYPES,
            'always_capitalised_cost_types' => self::LANDED_COST_ALWAYS_CAPITALISED,
            'all_cost_types'                => self::landedCostTypes(),
        ];
    }

    /**
     * Read an excluded-type list from whatever a caller sent: an array, a comma-separated string,
     * or a stored column value.
     *
     * Unknown words are dropped rather than refused, because this runs on READ as well as on write
     * — a column holding a type that a later release removed from the vocabulary must not make the
     * settings unreadable. The WRITE path (assertExcludableTypes) refuses unknown words, so nothing
     * unknown ever gets stored through this service in the first place.
     *
     * @return list<string>
     */
    public static function parseExcludedTypes(mixed $raw): array
    {
        if ($raw === null || $raw === '' || $raw === false) {
            return [];
        }
        $parts = is_array($raw) ? $raw : explode(',', (string) $raw);
        $seen = [];
        foreach ($parts as $p) {
            $t = strtolower(trim((string) $p));
            if (in_array($t, self::LANDED_COST_SWITCHABLE_TYPES, true)) {
                $seen[$t] = true;
            }
        }

        // Ordered by the vocabulary, not by what the caller happened to type, so the stored string
        // is stable and two equal policies compare equal.
        return array_values(array_filter(self::LANDED_COST_SWITCHABLE_TYPES, static fn (string $t) => isset($seen[$t])));
    }

    /**
     * Refuse a write that names something this policy cannot switch.
     *
     * A silent drop here would be the same defect as a silently dropped cost: the operator turns
     * "non_creditable_tax" off, the screen says it is off, and the rupees keep being capitalised.
     * Both refusals name the value and say why.
     *
     * @param array<int, mixed>|string|null $raw
     */
    public static function assertExcludableTypes(mixed $raw): void
    {
        if ($raw === null || $raw === '') {
            return;
        }
        $parts = is_array($raw) ? $raw : explode(',', (string) $raw);
        foreach ($parts as $p) {
            $t = strtolower(trim((string) $p));
            if ($t === '' || in_array($t, self::LANDED_COST_SWITCHABLE_TYPES, true)) {
                continue;
            }
            if (in_array($t, self::LANDED_COST_ALWAYS_CAPITALISED, true)) {
                throw InventoryException::validation(
                    'A ' . $t . ' charge cannot be excluded from the cost of stock. Tax that is not recoverable from the authority is part of the cost of purchase under AS-2, '
                    . 'so switching it off would leave those rupees as neither a recoverable credit nor a cost. The choice about that money is made in Books, by declaring the input tax credit claimable or not.',
                    ['cost_type' => $t, 'switchable' => self::LANDED_COST_SWITCHABLE_TYPES],
                );
            }

            throw InventoryException::validation(
                '"' . $t . '" is not a landed cost type; the policy can only switch ' . implode(', ', self::LANDED_COST_SWITCHABLE_TYPES) . '.',
                ['cost_type' => $t, 'switchable' => self::LANDED_COST_SWITCHABLE_TYPES],
            );
        }
    }

    /** @param array<string, mixed> $patch */
    public function update(int $cmpId, array $patch, ?string $actor = null): array
    {
        $this->ensureForCompany($cmpId);
        $allowed = ['default_valuation_method', 'valuation_scope', 'negative_stock_policy', 'approval_required', 'fefo_enabled', 'cogs_revision_mode', 'base_currency_code', 'landed_cost_excluded_types'];
        $update = [];
        foreach ($allowed as $k) {
            if (!array_key_exists($k, $patch)) {
                continue;
            }
            $v = $patch[$k];
            if ($k === 'landed_cost_excluded_types') {
                // Refuse first, then clean. Refusing tells the operator that non_creditable_tax is
                // not a switch (and why); cleaning after that only reorders and de-duplicates what
                // is already legal, so nothing a caller sent is quietly discarded.
                self::assertExcludableTypes($v);
                $v = implode(',', self::parseExcludedTypes($v));
            } elseif ($k === 'default_valuation_method') {
                $v = self::normalizeMethod((string) $v);
            } elseif ($k === 'valuation_scope') {
                $v = $v === 'warehouse' ? 'warehouse' : 'company';
            } elseif ($k === 'negative_stock_policy') {
                $v = in_array(strtolower((string) $v), self::NEGATIVE_POLICIES, true) ? strtolower((string) $v) : 'allow';
            } elseif ($k === 'cogs_revision_mode') {
                $v = $v === 'adjustment' ? 'adjustment' : 'inline';
            } elseif (in_array($k, ['approval_required', 'fefo_enabled'], true)) {
                $v = !empty($v) ? 1 : 0;
            }
            $update[$k] = $v;
        }
        if (isset($patch['settings']) && is_array($patch['settings'])) {
            $current = $this->get($cmpId)['settings'] ?? [];
            $update['settings_json'] = json_encode(array_merge($current, $patch['settings']));
        }
        if ($update !== []) {
            $update['updated_at'] = date('Y-m-d H:i:s');
            $update['updated_by'] = $actor;
            \Config\Database::connect()->table('inv_company_settings')->where('cmp_id', $cmpId)->update($update);
            unset(self::$cache[$cmpId]);
        }

        return $this->get($cmpId);
    }
}
