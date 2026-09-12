<?php

namespace App\Services;

/**
 * Per-company inventory settings (inv_company_settings), created on first use.
 */
class InventorySettingsService
{
    public const METHODS = ['FIFO', 'LIFO', 'WAC'];
    public const METHOD_ALIASES = ['AVG' => 'WAC', 'AVG COST' => 'WAC', 'AVERAGE' => 'WAC', 'WEIGHTED' => 'WAC', 'FIFO' => 'FIFO', 'LIFO' => 'LIFO', 'WAC' => 'WAC'];
    public const NEGATIVE_POLICIES = ['allow', 'warn', 'block'];

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
        $row = $row ?: ['cmp_id' => $cmpId, 'default_valuation_method' => 'FIFO', 'valuation_scope' => 'company', 'negative_stock_policy' => 'allow'];
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

    /** @param array<string, mixed> $patch */
    public function update(int $cmpId, array $patch, ?string $actor = null): array
    {
        $this->ensureForCompany($cmpId);
        $allowed = ['default_valuation_method', 'valuation_scope', 'negative_stock_policy', 'approval_required', 'fefo_enabled', 'cogs_revision_mode', 'base_currency_code'];
        $update = [];
        foreach ($allowed as $k) {
            if (!array_key_exists($k, $patch)) {
                continue;
            }
            $v = $patch[$k];
            if ($k === 'default_valuation_method') {
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
