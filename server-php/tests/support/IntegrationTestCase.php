<?php

namespace Tests\Support;

use App\Services\FyCarryForwardStatus;
use App\Services\InventorySettingsService;
use App\Services\InventorySqlMigrationRunner;
use App\Services\SchemaCache;
use CodeIgniter\Database\BaseConnection;
use CodeIgniter\Database\Config as Db;
use PHPUnit\Framework\TestCase;

/**
 * Real PostgreSQL integration tests. The schema is applied once per process from
 * database/migrations; every test truncates the inv_* tables and starts from a clean company.
 */
abstract class IntegrationTestCase extends TestCase
{
    protected BaseConnection $db;
    protected int $cmpId = 101;
    protected int $fyId = 5;
    protected int $boId = 0;
    private static bool $migrated = false;

    protected function setUp(): void
    {
        parent::setUp();
        $this->db = Db::connect('tests', false);
        $this->db->initialize();
        // A test that expects an exception inside a transaction leaves PostgreSQL in an aborted
        // transaction on this shared connection; clear it before touching the schema.
        try {
            while ($this->db->transDepth > 0) {
                $this->db->transRollback();
            }
            $this->db->query('ROLLBACK');
        } catch (\Throwable) {
        }
        $this->db->resetTransStatus();
        if (!self::$migrated) {
            (new InventorySqlMigrationRunner($this->db))->runPending();
            self::$migrated = true;
        }
        $tables = $this->db->query("SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name LIKE 'inv\\_%' AND table_name <> 'inv_sql_migrations'")->getResultArray();
        $names = array_map(static fn ($r) => $r['table_name'], $tables);
        if ($names !== []) {
            $this->db->query('TRUNCATE ' . implode(', ', $names) . ' RESTART IDENTITY');
        }
        SchemaCache::flush();
        FyCarryForwardStatus::flush();
        InventorySettingsService::flush();
        $this->db->table('inv_fy_ranges')->insert(['cmp_id' => $this->cmpId, 'fy_id' => $this->fyId, 'fy_start' => '2026-04-01', 'fy_end' => '2027-03-31']);
        $this->db->table('inv_company_settings')->insert(['cmp_id' => $this->cmpId, 'default_valuation_method' => 'FIFO', 'valuation_scope' => 'company', 'negative_stock_policy' => 'allow', 'created_at' => date('Y-m-d H:i:s')]);
    }

    protected function ctx(): array
    {
        return ['cmp_id' => $this->cmpId, 'fy_id' => $this->fyId, 'bo_id' => $this->boId];
    }

    protected function makeUnit(string $name = 'Pcs', string $symbol = 'Pcs'): int
    {
        $this->db->table('inv_uom')->insert(['cmp_id' => $this->cmpId, 'unit_name' => $name, 'unit_symbol' => $symbol, 'print_name' => $symbol, 'uqc_gst' => 'PCS', 'is_active' => 1]);

        return (int) $this->db->insertID();
    }

    protected function makeWarehouse(string $name = 'Main'): int
    {
        $this->db->table('inv_warehouses')->insert(['cmp_id' => $this->cmpId, 'warehouse_name' => $name, 'warehouse_type' => 'standard', 'is_active' => 1]);

        return (int) $this->db->insertID();
    }

    protected function makeItem(string $name, int $unitId, string $method = 'FIFO', array $altUnits = []): int
    {
        $this->db->table('inv_items')->insert(['cmp_id' => $this->cmpId, 'item_name' => $name, 'unit_id' => $unitId, 'valuation_method' => $method, 'is_active' => 1]);
        $itemId = (int) $this->db->insertID();
        $this->db->table('inv_item_uoms')->insert(['cmp_id' => $this->cmpId, 'item_id' => $itemId, 'unit_id' => $unitId, 'is_default' => 1, 'conversion_factor' => 1]);
        foreach ($altUnits as $uid => $factor) {
            $this->db->table('inv_item_uoms')->insert(['cmp_id' => $this->cmpId, 'item_id' => $itemId, 'unit_id' => $uid, 'is_default' => 0, 'conversion_factor' => $factor]);
        }

        return $itemId;
    }

    protected function setOpening(int $itemId, int $unitId, float $qty, float $rate, int $fyId = 0, ?int $warehouseId = null): void
    {
        $this->db->table('inv_item_openings')->insert([
            'cmp_id' => $this->cmpId, 'fy_id' => $fyId, 'item_id' => $itemId, 'unit_id' => $unitId, 'warehouse_id' => $warehouseId,
            'opening_qty' => $qty, 'opening_valuation_rate' => $rate, 'opening_value' => round($qty * $rate, 4), 'source_kind' => $fyId > 0 ? 'carry_forward' : 'master_inception',
        ]);
    }
}
