<?php

namespace App\Services\Migration;

use CodeIgniter\Database\BaseConnection;

/**
 * PRECHECK: schema inventory, row-count / control-total baselines, orphan and duplicate
 * baselines on the Books source. Read-only. Writes <run>/precheck.summary.json.
 */
class Precheck
{
    /** Books tables the migration reads (must exist). */
    public const REQUIRED_TABLES = [
        'books_items', 'books_item_groups', 'books_stock_categories', 'books_item_units', 'books_item_unit_lines',
        'books_material_centres', 'books_material_centre_groups', 'books_voucher_headers', 'books_voucher_inventory_lines',
        'books_voucher_lines', 'books_voucher_types',
    ];
    /** Optional tables (present on fully migrated Books databases). */
    public const OPTIONAL_TABLES = [
        'books_bom_headers', 'books_bom_lines', 'books_item_fy_openings', 'books_fy_carryforward', 'books_company_settings',
        'books_inventory_cost_layers', 'books_inventory_wac_state', 'books_stock_bucket_balances', 'books_stock_bucket_ledger',
        'books_voucher_packing_meta', 'books_voucher_packing_lines', 'books_voucher_job_work_lines', 'books_inventory_pending',
        'books_inventory_settlement', 'books_movement_document_snapshots', 'books_item_gst_profile_history',
        'books_credit_note_line_details', 'books_debit_note_line_details', 'books_bills', 'books_voucher_line_cc_allocations',
        'books_voucher_line_subledger_allocations', 'books_voucher_tax_lines',
    ];

    public function __construct(private BaseConnection $books, private MigrationLog $log)
    {
    }

    /** @param list<int> $companies empty = all */
    public function run(array $companies = []): array
    {
        $b = $this->books;
        $out = ['companies' => $companies, 'tables' => [], 'missing_required' => [], 'missing_optional' => [], 'sequences' => [], 'row_counts' => [], 'control_totals' => [], 'orphans' => [], 'duplicates' => [], 'blocking' => []];

        $present = $this->tableSet($b);
        foreach (self::REQUIRED_TABLES as $t) {
            if (!isset($present[$t])) {
                $out['missing_required'][] = $t;
            }
        }
        foreach (self::OPTIONAL_TABLES as $t) {
            if (!isset($present[$t])) {
                $out['missing_optional'][] = $t;
            }
        }
        foreach (array_merge(self::REQUIRED_TABLES, self::OPTIONAL_TABLES) as $t) {
            if (!isset($present[$t])) {
                continue;
            }
            $cols = $b->query("SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = ? ORDER BY ordinal_position", [$t])->getResultArray();
            $out['tables'][$t] = ['columns' => array_map(static fn ($c) => $c['column_name'] . ':' . $c['data_type'] . ($c['is_nullable'] === 'NO' ? '!' : ''), $cols)];
            $seq = $b->query("SELECT a.attname AS col, pg_get_serial_sequence(?, a.attname) AS seq FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid WHERE c.relname = ? AND a.attnum > 0 AND NOT a.attisdropped AND pg_get_serial_sequence(?, a.attname) IS NOT NULL", [$t, $t, $t])->getResultArray();
            foreach ($seq as $s) {
                $cur = $b->query('SELECT last_value, is_called FROM ' . $s['seq'])->getRowArray();
                $max = $b->query('SELECT MAX(' . $s['col'] . ') AS m FROM ' . $t)->getRowArray();
                $out['sequences'][$t] = ['column' => $s['col'], 'sequence' => $s['seq'], 'last_value' => (int) ($cur['last_value'] ?? 0), 'is_called' => (bool) ($cur['is_called'] ?? false), 'max_id' => (int) ($max['m'] ?? 0)];
            }
            $cmpFilter = $this->companyFilter($b, $t, $companies);
            $out['row_counts'][$t] = (int) $b->query('SELECT COUNT(*) AS n FROM ' . $t . $cmpFilter)->getRowArray()['n'];
            $this->log->event('table', ['table' => $t, 'rows' => $out['row_counts'][$t]]);
        }
        if ($out['missing_required'] !== []) {
            $out['blocking'][] = 'Missing required Books tables: ' . implode(', ', $out['missing_required']);
        }

        $out['control_totals'] = (new ControlTotals($b, 'books'))->compute($companies);
        $out['orphans'] = $this->orphans($b, $companies, $present);
        $out['duplicates'] = $this->duplicates($b, $companies, $present);
        $out['consistency'] = $this->consistency($b, $companies, $present);
        foreach ($out['orphans'] as $k => $v) {
            if (($v['count'] ?? 0) > 0 && ($v['blocking'] ?? false)) {
                $out['blocking'][] = 'Orphans: ' . $k . ' = ' . $v['count'];
            }
        }
        foreach ($out as $k => $v) {
            $this->log->set($k, $v);
        }

        return $out;
    }

    /** @return array<string, true> */
    private function tableSet(BaseConnection $b): array
    {
        $rows = $b->query("SELECT table_name FROM information_schema.tables WHERE table_schema = current_schema()")->getResultArray();
        $set = [];
        foreach ($rows as $r) {
            $set[$r['table_name']] = true;
        }

        return $set;
    }

    private function companyFilter(BaseConnection $b, string $table, array $companies, string $alias = ''): string
    {
        if ($companies === [] || !$b->fieldExists('cmp_id', $table)) {
            return '';
        }
        $col = ($alias !== '' ? $alias . '.' : '') . 'cmp_id';

        return ' WHERE ' . $col . ' IN (' . implode(',', array_map('intval', $companies)) . ')';
    }

    /** @return array<string, array{count:int, blocking:bool, sample:list<mixed>}> */
    private function orphans(BaseConnection $b, array $companies, array $present): array
    {
        $cmpIn = $companies === [] ? '' : ' AND x.cmp_id IN (' . implode(',', array_map('intval', $companies)) . ')';
        $checks = [
            'inventory_lines_without_header' => ['sql' => 'SELECT x.inv_line_id AS id FROM books_voucher_inventory_lines x LEFT JOIN books_voucher_headers h ON h.vch_txn_id = x.vch_txn_id WHERE h.vch_txn_id IS NULL' . $cmpIn, 'blocking' => true],
            'inventory_lines_unknown_item' => ['sql' => 'SELECT x.inv_line_id AS id FROM books_voucher_inventory_lines x LEFT JOIN books_items i ON i.item_id = x.item_id WHERE i.item_id IS NULL' . $cmpIn, 'blocking' => true],
            'inventory_lines_item_other_company' => ['sql' => 'SELECT x.inv_line_id AS id FROM books_voucher_inventory_lines x JOIN books_items i ON i.item_id = x.item_id WHERE i.cmp_id <> x.cmp_id' . $cmpIn, 'blocking' => true],
            'inventory_lines_unknown_mc' => ['sql' => 'SELECT x.inv_line_id AS id FROM books_voucher_inventory_lines x LEFT JOIN books_material_centres m ON m.mc_id = x.mc_id WHERE x.mc_id IS NOT NULL AND m.mc_id IS NULL' . $cmpIn, 'blocking' => false],
            'inventory_lines_unknown_unit' => ['sql' => 'SELECT x.inv_line_id AS id FROM books_voucher_inventory_lines x LEFT JOIN books_item_units u ON u.unit_id = x.unit_id WHERE x.unit_id IS NOT NULL AND x.unit_id <> 0 AND u.unit_id IS NULL' . $cmpIn, 'blocking' => false],
            'inventory_lines_cmp_mismatch_header' => ['sql' => 'SELECT x.inv_line_id AS id FROM books_voucher_inventory_lines x JOIN books_voucher_headers h ON h.vch_txn_id = x.vch_txn_id WHERE h.cmp_id <> x.cmp_id' . $cmpIn, 'blocking' => true],
            'items_unknown_unit' => ['sql' => 'SELECT x.item_id AS id FROM books_items x LEFT JOIN books_item_units u ON u.unit_id = x.unit_id WHERE x.deleted_at IS NULL AND x.unit_id IS NOT NULL AND u.unit_id IS NULL' . $cmpIn, 'blocking' => false],
            'items_unknown_group' => ['sql' => 'SELECT x.item_id AS id FROM books_items x LEFT JOIN books_item_groups g ON g.item_grp_id = x.item_grp_id WHERE x.deleted_at IS NULL AND x.item_grp_id IS NOT NULL AND g.item_grp_id IS NULL' . $cmpIn, 'blocking' => false],
            'items_unknown_stock_category' => ['sql' => 'SELECT x.item_id AS id FROM books_items x LEFT JOIN books_stock_categories c ON c.stock_cat_id = x.stock_cat_id WHERE x.deleted_at IS NULL AND x.stock_cat_id IS NOT NULL AND c.stock_cat_id IS NULL' . $cmpIn, 'blocking' => false],
            'items_without_unit_lines' => ['sql' => 'SELECT x.item_id AS id FROM books_items x LEFT JOIN books_item_unit_lines l ON l.item_id = x.item_id WHERE x.deleted_at IS NULL AND l.item_unit_line_id IS NULL' . $cmpIn, 'blocking' => false],
            'unit_lines_unknown_item' => ['sql' => 'SELECT x.item_unit_line_id AS id FROM books_item_unit_lines x LEFT JOIN books_items i ON i.item_id = x.item_id WHERE i.item_id IS NULL' . $cmpIn, 'blocking' => true],
            'unit_lines_unknown_unit' => ['sql' => 'SELECT x.item_unit_line_id AS id FROM books_item_unit_lines x LEFT JOIN books_item_units u ON u.unit_id = x.unit_id WHERE u.unit_id IS NULL' . $cmpIn, 'blocking' => false],
            'mc_unknown_group' => ['sql' => 'SELECT x.mc_id AS id FROM books_material_centres x LEFT JOIN books_material_centre_groups g ON g.mc_grp_id = x.mc_grp_id WHERE x.deleted_at IS NULL AND x.mc_grp_id IS NOT NULL AND g.mc_grp_id IS NULL' . $cmpIn, 'blocking' => false],
            'item_groups_unknown_parent' => ['sql' => 'SELECT x.item_grp_id AS id FROM books_item_groups x LEFT JOIN books_item_groups p ON p.item_grp_id = x.parent_grp_id WHERE x.deleted_at IS NULL AND x.parent_grp_id IS NOT NULL AND p.item_grp_id IS NULL' . $cmpIn, 'blocking' => false],
        ];
        if (isset($present['books_inventory_cost_layers'])) {
            $checks['cost_layers_unknown_item'] = ['sql' => 'SELECT x.layer_id AS id FROM books_inventory_cost_layers x LEFT JOIN books_items i ON i.item_id = x.item_id WHERE i.item_id IS NULL' . $cmpIn, 'blocking' => false];
            $checks['cost_layers_unknown_voucher'] = ['sql' => 'SELECT x.layer_id AS id FROM books_inventory_cost_layers x LEFT JOIN books_voucher_headers h ON h.vch_txn_id = x.source_vch_txn_id WHERE x.source_vch_txn_id IS NOT NULL AND h.vch_txn_id IS NULL' . $cmpIn, 'blocking' => false];
        }
        if (isset($present['books_bom_lines'])) {
            $checks['bom_lines_unknown_item'] = ['sql' => 'SELECT x.bom_line_id AS id FROM books_bom_lines x LEFT JOIN books_items i ON i.item_id = x.item_id WHERE i.item_id IS NULL' . $cmpIn, 'blocking' => false];
            $checks['bom_headers_unknown_finished_item'] = ['sql' => 'SELECT x.bom_id AS id FROM books_bom_headers x LEFT JOIN books_items i ON i.item_id = x.finished_item_id WHERE x.deleted_at IS NULL AND i.item_id IS NULL' . $cmpIn, 'blocking' => false];
        }
        if (isset($present['books_inventory_pending'])) {
            $checks['pending_unknown_voucher'] = ['sql' => 'SELECT x.pending_id AS id FROM books_inventory_pending x LEFT JOIN books_voucher_headers h ON h.vch_txn_id = x.vch_txn_id WHERE h.vch_txn_id IS NULL' . $cmpIn, 'blocking' => true];
        }
        if (isset($present['books_item_fy_openings'])) {
            $checks['fy_openings_unknown_item'] = ['sql' => 'SELECT x.item_fy_opening_id AS id FROM books_item_fy_openings x LEFT JOIN books_items i ON i.item_id = x.item_id WHERE i.item_id IS NULL' . $cmpIn, 'blocking' => true];
        }
        if (isset($present['books_voucher_packing_lines'])) {
            $checks['packing_lines_unknown_voucher'] = ['sql' => 'SELECT x.packing_line_id AS id FROM books_voucher_packing_lines x LEFT JOIN books_voucher_headers h ON h.vch_txn_id = x.vch_txn_id WHERE h.vch_txn_id IS NULL' . $cmpIn, 'blocking' => true];
        }
        if (isset($present['books_voucher_job_work_lines'])) {
            $checks['job_work_lines_unknown_voucher'] = ['sql' => 'SELECT x.line_id AS id FROM books_voucher_job_work_lines x LEFT JOIN books_voucher_headers h ON h.vch_txn_id = x.vch_txn_id WHERE h.vch_txn_id IS NULL' . $cmpIn, 'blocking' => true];
        }
        $out = [];
        foreach ($checks as $name => $c) {
            $rows = $b->query('SELECT COUNT(*) AS n FROM (' . $c['sql'] . ') q')->getRowArray();
            $n = (int) ($rows['n'] ?? 0);
            $sample = $n > 0 ? array_map(static fn ($r) => (int) $r['id'], $b->query($c['sql'] . ' LIMIT 20')->getResultArray()) : [];
            $out[$name] = ['count' => $n, 'blocking' => $c['blocking'], 'sample' => $sample];
            $this->log->event('orphan_check', ['check' => $name, 'count' => $n, 'blocking' => $c['blocking']], $n > 0 ? ($c['blocking'] ? 'error' : 'warning') : 'info');
        }

        return $out;
    }

    /** @return array<string, array{count:int, sample:list<mixed>}> */
    /**
     * Data whose meaning differs between Books' own engines. Books' stock-quantity reports
     * (StockBalanceService) read the line's dr_cr, while its valuation engine reads the
     * voucher TYPE (InventoryMovementClassifier). A sales line stored with dr_cr = 1 counts
     * as an inward movement in the first and an outward one in the second. Inventory follows
     * the type (the valuation truth), so such lines will change the quantity Books used to
     * report — they must be listed and signed off before cutover.
     */
    private function consistency(BaseConnection $b, array $companies, array $present): array
    {
        $cmpIn = $companies === [] ? '' : ' AND h.cmp_id IN (' . implode(',', array_map('intval', $companies)) . ')';
        $checks = [
            // fixed-direction types: 11,2,24 = in (dr_cr 1); 18,3,23 = out (dr_cr 2)
            'lines_dr_cr_contradicts_type' => "SELECT h.cmp_id, h.vch_type_id, COUNT(*) AS n, SUM(l.qty) AS qty FROM books_voucher_inventory_lines l JOIN books_voucher_headers h ON h.vch_txn_id = l.vch_txn_id WHERE h.status <> 'cancelled' AND h.deleted_at IS NULL {$cmpIn} AND ((h.vch_type_id IN (11,2,24) AND l.dr_cr <> 1) OR (h.vch_type_id IN (18,3,23) AND l.dr_cr <> 2)) GROUP BY h.cmp_id, h.vch_type_id ORDER BY 1,2",
            'lines_zero_or_negative_qty' => "SELECT h.cmp_id, h.vch_type_id, COUNT(*) AS n, SUM(l.qty) AS qty FROM books_voucher_inventory_lines l JOIN books_voucher_headers h ON h.vch_txn_id = l.vch_txn_id WHERE h.status <> 'cancelled' AND h.deleted_at IS NULL {$cmpIn} AND l.qty <= 0 GROUP BY h.cmp_id, h.vch_type_id ORDER BY 1,2",
            'lines_missing_unit' => "SELECT h.cmp_id, h.vch_type_id, COUNT(*) AS n, SUM(l.qty) AS qty FROM books_voucher_inventory_lines l JOIN books_voucher_headers h ON h.vch_txn_id = l.vch_txn_id WHERE h.status <> 'cancelled' AND h.deleted_at IS NULL {$cmpIn} AND (l.unit_id IS NULL OR l.unit_id = 0) GROUP BY h.cmp_id, h.vch_type_id ORDER BY 1,2",
            'lines_unit_not_on_item' => "SELECT h.cmp_id, h.vch_type_id, COUNT(*) AS n, SUM(l.qty) AS qty FROM books_voucher_inventory_lines l JOIN books_voucher_headers h ON h.vch_txn_id = l.vch_txn_id WHERE h.status <> 'cancelled' AND h.deleted_at IS NULL {$cmpIn} AND l.unit_id > 0 AND NOT EXISTS (SELECT 1 FROM books_item_unit_lines u WHERE u.cmp_id = l.cmp_id AND u.item_id = l.item_id AND u.unit_id = l.unit_id) GROUP BY h.cmp_id, h.vch_type_id ORDER BY 1,2",
            'items_without_default_unit' => "SELECT i.cmp_id, 0 AS vch_type_id, COUNT(*) AS n, 0 AS qty FROM books_items i JOIN books_voucher_headers h ON h.cmp_id = i.cmp_id WHERE i.deleted_at IS NULL {$cmpIn} AND NOT EXISTS (SELECT 1 FROM books_item_unit_lines u WHERE u.cmp_id = i.cmp_id AND u.item_id = i.item_id AND u.is_default = 1) GROUP BY i.cmp_id",
            'posted_lines_without_cost' => "SELECT h.cmp_id, h.vch_type_id, COUNT(*) AS n, SUM(l.qty) AS qty FROM books_voucher_inventory_lines l JOIN books_voucher_headers h ON h.vch_txn_id = l.vch_txn_id WHERE h.status = 'posted' AND h.deleted_at IS NULL {$cmpIn} AND l.cost_rate IS NULL AND NOT (h.vch_type_id IN (23,24) AND COALESCE(h.stock_effect,'challan_only') = 'challan_only') AND NOT (h.vch_type_id = 11 AND h.stock_effect = 'defer_inward') AND NOT (h.vch_type_id IN (11,18,2,3) AND h.stock_effect = 'from_challan') AND h.vch_type_id IN (2,3,6,10,11,14,15,18,20,23,24) GROUP BY h.cmp_id, h.vch_type_id ORDER BY 1,2",
        ];
        $out = [];
        foreach ($checks as $name => $sql) {
            $rows = $b->query($sql)->getResultArray();
            $count = 0;
            foreach ($rows as $r) {
                $count += (int) $r['n'];
            }
            $out[$name] = ['count' => $count, 'by_company_type' => $rows];
            $this->log->event('consistency_check', ['check' => $name, 'count' => $count, 'rows' => array_slice($rows, 0, 50)], $count > 0 ? 'warning' : 'info');
        }

        return $out;
    }

    private function duplicates(BaseConnection $b, array $companies, array $present): array
    {
        $cmpIn = $companies === [] ? '' : ' WHERE cmp_id IN (' . implode(',', array_map('intval', $companies)) . ')';
        $checks = [
            'items_same_name_live' => "SELECT cmp_id, LOWER(item_name) AS k, COUNT(*) AS n FROM books_items " . ($cmpIn ? $cmpIn . ' AND' : 'WHERE') . " deleted_at IS NULL GROUP BY cmp_id, LOWER(item_name) HAVING COUNT(*) > 1",
            'units_same_name_live' => "SELECT cmp_id, LOWER(unit_name) AS k, COUNT(*) AS n FROM books_item_units " . ($cmpIn ? $cmpIn . ' AND' : 'WHERE') . " deleted_at IS NULL GROUP BY cmp_id, LOWER(unit_name) HAVING COUNT(*) > 1",
            'mc_same_name_live' => "SELECT cmp_id, LOWER(mc_name) AS k, COUNT(*) AS n FROM books_material_centres " . ($cmpIn ? $cmpIn . ' AND' : 'WHERE') . " deleted_at IS NULL GROUP BY cmp_id, LOWER(mc_name) HAVING COUNT(*) > 1",
            'unit_lines_item_unit' => "SELECT cmp_id, item_id::text || ':' || unit_id::text AS k, COUNT(*) AS n FROM books_item_unit_lines " . $cmpIn . " GROUP BY cmp_id, item_id, unit_id HAVING COUNT(*) > 1",
            'unit_lines_multiple_default' => "SELECT cmp_id, item_id::text AS k, COUNT(*) AS n FROM books_item_unit_lines " . ($cmpIn ? $cmpIn . ' AND' : 'WHERE') . " is_default = 1 GROUP BY cmp_id, item_id HAVING COUNT(*) > 1",
        ];
        if (isset($present['books_inventory_wac_state'])) {
            $checks['wac_state_key'] = "SELECT cmp_id, item_id::text AS k, COUNT(*) AS n FROM books_inventory_wac_state " . $cmpIn . " GROUP BY cmp_id, item_id HAVING COUNT(*) > 1";
        }
        $out = [];
        foreach ($checks as $name => $sql) {
            $rows = $b->query($sql . ' LIMIT 50')->getResultArray();
            $count = (int) ($b->query('SELECT COUNT(*) AS n FROM (' . $sql . ') q')->getRowArray()['n'] ?? 0);
            $out[$name] = ['count' => $count, 'sample' => array_slice($rows, 0, 20)];
            $this->log->event('duplicate_check', ['check' => $name, 'count' => $count], $count > 0 ? 'warning' : 'info');
        }

        return $out;
    }
}
