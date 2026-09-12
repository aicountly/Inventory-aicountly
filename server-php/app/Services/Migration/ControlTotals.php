<?php

namespace App\Services\Migration;

use CodeIgniter\Database\BaseConnection;

/**
 * Control totals computed identically on the Books source ('books') and the Inventory
 * destination ('inventory') so BEFORE and AFTER can be compared line by line.
 *
 * Every figure is company-scoped and, where the source carries it, financial-year scoped.
 */
class ControlTotals
{
    public function __construct(private BaseConnection $db, private string $side)
    {
    }

    /**
     * @param list<int> $companies
     * @return array<string, mixed>
     */
    public function compute(array $companies = []): array
    {
        return $this->side === 'books' ? $this->fromBooks($companies) : $this->fromInventory($companies);
    }

    private function in(array $companies, string $col = 'cmp_id'): string
    {
        return $companies === [] ? '' : ' AND ' . $col . ' IN (' . implode(',', array_map('intval', $companies)) . ')';
    }

    private function has(string $table): bool
    {
        return $this->db->tableExists($table, false);
    }

    /** @return array<string, mixed> */
    private function fromBooks(array $c): array
    {
        $b = $this->db;
        $in = $this->in($c);
        $types = implode(',', TableMap::ITEM_BEARING_TYPES);
        $out = [];
        $out['masters'] = [];
        foreach (['books_items' => 'item_id', 'books_item_groups' => 'item_grp_id', 'books_stock_categories' => 'stock_cat_id', 'books_item_units' => 'unit_id', 'books_material_centres' => 'mc_id', 'books_material_centre_groups' => 'mc_grp_id', 'books_item_unit_lines' => 'item_unit_line_id', 'books_bom_headers' => 'bom_id', 'books_bom_lines' => 'bom_line_id'] as $t => $pk) {
            if (!$this->has($t)) {
                continue;
            }
            $soft = $b->fieldExists('deleted_at', $t);
            $out['masters'][$t] = [
                'rows' => (int) $b->query("SELECT COUNT(*) n FROM {$t} WHERE 1=1 {$in}")->getRowArray()['n'],
                'live' => $soft ? (int) $b->query("SELECT COUNT(*) n FROM {$t} WHERE deleted_at IS NULL {$in}")->getRowArray()['n'] : null,
                'by_company' => $this->byCompany($b, $t, $in),
                'max_pk' => (int) $b->query("SELECT COALESCE(MAX({$pk}),0) m FROM {$t}")->getRowArray()['m'],
            ];
        }
        // Item-bearing vouchers by type / company / fy
        $out['vouchers_by_type'] = $b->query("SELECT h.vch_type_id, h.status, COUNT(*) n FROM books_voucher_headers h WHERE h.vch_type_id IN ({$types}) AND (EXISTS (SELECT 1 FROM books_voucher_inventory_lines l WHERE l.vch_txn_id = h.vch_txn_id) OR h.vch_type_id IN (4,6,7,10,14,15,20,23,24)) " . str_replace('cmp_id', 'h.cmp_id', $in) . " GROUP BY h.vch_type_id, h.status ORDER BY 1,2")->getResultArray();
        $out['vouchers_by_company_fy'] = $b->query("SELECT h.cmp_id, h.fy_id, COUNT(*) n FROM books_voucher_headers h WHERE h.vch_type_id IN ({$types}) AND (EXISTS (SELECT 1 FROM books_voucher_inventory_lines l WHERE l.vch_txn_id = h.vch_txn_id) OR h.vch_type_id IN (4,6,7,10,14,15,20,23,24)) " . str_replace('cmp_id', 'h.cmp_id', $in) . " GROUP BY h.cmp_id, h.fy_id ORDER BY 1,2")->getResultArray();
        $out['inventory_lines'] = [
            'rows' => (int) $b->query("SELECT COUNT(*) n FROM books_voucher_inventory_lines WHERE 1=1 {$in}")->getRowArray()['n'],
            'by_company' => $this->byCompany($b, 'books_voucher_inventory_lines', $in),
            'max_pk' => (int) $b->query('SELECT COALESCE(MAX(inv_line_id),0) m FROM books_voucher_inventory_lines')->getRowArray()['m'],
        ];
        // Quantity / value control totals per company + fy (posted, non-cancelled), using the Books direction rule
        $out['movement_totals'] = $b->query(
            "SELECT l.cmp_id, l.fy_id,
                SUM(CASE WHEN dir.d = 'in' THEN l.qty ELSE 0 END) AS in_qty,
                SUM(CASE WHEN dir.d = 'out' THEN l.qty ELSE 0 END) AS out_qty,
                SUM(CASE WHEN dir.d = 'in' THEN l.amount ELSE 0 END) AS in_source_amount,
                SUM(CASE WHEN dir.d = 'out' THEN l.amount ELSE 0 END) AS out_source_amount,
                SUM(CASE WHEN dir.d = 'in' THEN COALESCE(l.cost_amount,0) ELSE 0 END) AS in_valuation,
                SUM(CASE WHEN dir.d = 'out' THEN COALESCE(l.cost_amount,0) ELSE 0 END) AS out_valuation,
                COUNT(*) AS line_count
             FROM books_voucher_inventory_lines l
             JOIN books_voucher_headers h ON h.vch_txn_id = l.vch_txn_id
             CROSS JOIN LATERAL (SELECT CASE
                WHEN h.vch_type_id IN (15,20,10,14,6) THEN CASE WHEN l.dr_cr = 1 THEN 'in' ELSE 'out' END
                WHEN h.vch_type_id IN (11,2,24) THEN 'in'
                WHEN h.vch_type_id IN (18,3,23,7) THEN 'out'
                ELSE NULL END AS d) dir
             WHERE h.status = 'posted' AND h.deleted_at IS NULL " . str_replace('cmp_id', 'l.cmp_id', $in) . "
             GROUP BY l.cmp_id, l.fy_id ORDER BY 1,2"
        )->getResultArray();
        $out['opening_totals'] = $b->query("SELECT l.cmp_id, COUNT(*) lines, SUM(l.opening_qty) qty, SUM(l.opening_qty * l.opening_rate) value FROM books_item_unit_lines l WHERE l.opening_qty <> 0 " . str_replace('cmp_id', 'l.cmp_id', $in) . " GROUP BY l.cmp_id ORDER BY 1")->getResultArray();
        if ($this->has('books_item_fy_openings')) {
            $out['fy_opening_totals'] = $b->query("SELECT cmp_id, fy_id, COUNT(*) lines, SUM(opening_qty) qty, SUM(COALESCE(opening_value,0)) value FROM books_item_fy_openings WHERE 1=1 {$in} GROUP BY cmp_id, fy_id ORDER BY 1,2")->getResultArray();
        }
        if ($this->has('books_inventory_cost_layers')) {
            $out['cost_layers'] = $b->query("SELECT cmp_id, COUNT(*) rows, SUM(qty_remaining) qty_remaining, SUM(qty_remaining * unit_cost) value_remaining FROM books_inventory_cost_layers WHERE 1=1 {$in} GROUP BY cmp_id ORDER BY 1")->getResultArray();
        }
        if ($this->has('books_inventory_wac_state')) {
            $out['wac_state'] = $b->query("SELECT cmp_id, COUNT(*) rows, SUM(qty_on_hand) qty, SUM(qty_on_hand * average_cost) value FROM books_inventory_wac_state WHERE 1=1 {$in} GROUP BY cmp_id ORDER BY 1")->getResultArray();
        }
        if ($this->has('books_stock_bucket_balances')) {
            $out['buckets'] = $b->query("SELECT cmp_id, COUNT(*) rows, SUM(packed_qty) packed, SUM(job_worker_qty) job_worker FROM books_stock_bucket_balances WHERE 1=1 {$in} GROUP BY cmp_id ORDER BY 1")->getResultArray();
        }
        if ($this->has('books_inventory_pending')) {
            $out['pending'] = $b->query("SELECT cmp_id, pending_kind, direction, status, COUNT(*) rows, SUM(qty_original) qty_original, SUM(qty_settled) qty_settled FROM books_inventory_pending WHERE 1=1 {$in} GROUP BY cmp_id, pending_kind, direction, status ORDER BY 1,2,3,4")->getResultArray();
        }
        // Financial controls that must NOT change (Books stays authoritative)
        $out['ledger_totals'] = $b->query("SELECT l.cmp_id, l.fy_id, SUM(CASE WHEN l.dr_cr = 1 THEN l.amount ELSE 0 END) debit, SUM(CASE WHEN l.dr_cr = 2 THEN l.amount ELSE 0 END) credit, COUNT(*) lines FROM books_voucher_lines l JOIN books_voucher_headers h ON h.vch_txn_id = l.vch_txn_id WHERE h.status = 'posted' AND h.deleted_at IS NULL " . str_replace('cmp_id', 'l.cmp_id', $in) . " GROUP BY l.cmp_id, l.fy_id ORDER BY 1,2")->getResultArray();
        $out['cogs_journal_totals'] = $b->query("SELECT l.cmp_id, l.fy_id, SUM(CASE WHEN l.line_narration LIKE 'COGS —%' THEN l.amount ELSE 0 END) cogs, SUM(CASE WHEN l.line_narration LIKE 'Stock issue —%' THEN l.amount ELSE 0 END) stock_issue, COUNT(*) FILTER (WHERE l.line_narration LIKE 'COGS —%') pairs FROM books_voucher_lines l JOIN books_voucher_headers h ON h.vch_txn_id = l.vch_txn_id WHERE h.status = 'posted' AND h.deleted_at IS NULL " . str_replace('cmp_id', 'l.cmp_id', $in) . " GROUP BY l.cmp_id, l.fy_id ORDER BY 1,2")->getResultArray();
        if ($this->has('books_bills')) {
            $out['bills'] = $b->query("SELECT cmp_id, fy_id, COUNT(*) rows, SUM(original_amount) original, SUM(pending_amount) pending FROM books_bills WHERE 1=1 {$in} GROUP BY cmp_id, fy_id ORDER BY 1,2")->getResultArray();
        }
        if ($this->has('books_voucher_line_cc_allocations')) {
            $out['cc_allocations'] = $b->query("SELECT cmp_id, COUNT(*) rows, SUM(amount) amount FROM books_voucher_line_cc_allocations WHERE 1=1 {$in} GROUP BY cmp_id ORDER BY 1")->getResultArray();
        }
        if ($this->has('books_voucher_line_subledger_allocations')) {
            $out['subledger_allocations'] = $b->query("SELECT cmp_id, COUNT(*) rows, SUM(amount) amount FROM books_voucher_line_subledger_allocations WHERE 1=1 {$in} GROUP BY cmp_id ORDER BY 1")->getResultArray();
        }
        $out['project_lines'] = $b->query("SELECT cmp_id, COUNT(*) FILTER (WHERE project_id IS NOT NULL) project_lines, COUNT(*) FILTER (WHERE cc_id IS NOT NULL) cc_lines FROM books_voucher_lines WHERE 1=1 {$in} GROUP BY cmp_id ORDER BY 1")->getResultArray();
        if ($this->has('books_credit_note_line_details')) {
            $out['credit_note_line_details'] = (int) $b->query("SELECT COUNT(*) n FROM books_credit_note_line_details WHERE 1=1 {$in}")->getRowArray()['n'];
        }
        if ($this->has('books_debit_note_line_details')) {
            $out['debit_note_line_details'] = (int) $b->query("SELECT COUNT(*) n FROM books_debit_note_line_details WHERE 1=1 {$in}")->getRowArray()['n'];
        }

        return $this->normalize($out);
    }

    /** @return array<string, mixed> */
    private function fromInventory(array $c): array
    {
        $b = $this->db;
        $in = $this->in($c);
        $out = ['masters' => []];
        foreach (['inv_items' => 'item_id', 'inv_item_groups' => 'item_grp_id', 'inv_stock_categories' => 'stock_cat_id', 'inv_uom' => 'unit_id', 'inv_warehouses' => 'warehouse_id', 'inv_warehouse_groups' => 'warehouse_group_id', 'inv_item_uoms' => 'item_unit_line_id', 'inv_bom_headers' => 'bom_id', 'inv_bom_lines' => 'bom_line_id'] as $t => $pk) {
            $soft = $b->fieldExists('deleted_at', $t);
            $out['masters'][$t] = [
                'rows' => (int) $b->query("SELECT COUNT(*) n FROM {$t} WHERE 1=1 {$in}")->getRowArray()['n'],
                'live' => $soft ? (int) $b->query("SELECT COUNT(*) n FROM {$t} WHERE deleted_at IS NULL {$in}")->getRowArray()['n'] : null,
                'by_company' => $this->byCompany($b, $t, $in),
                'max_pk' => (int) $b->query("SELECT COALESCE(MAX({$pk}),0) m FROM {$t}")->getRowArray()['m'],
            ];
        }
        $out['documents_by_type'] = $b->query("SELECT legacy_vch_type_id AS vch_type_id, CASE status WHEN 'POSTED' THEN 'posted' WHEN 'CANCELLED' THEN 'cancelled' WHEN 'REVERSED' THEN 'cancelled' ELSE LOWER(status) END AS status, COUNT(*) n FROM inv_documents WHERE legacy_source_table = 'books_voucher_headers' {$in} GROUP BY legacy_vch_type_id, 2 ORDER BY 1,2")->getResultArray();
        $out['documents_by_company_fy'] = $b->query("SELECT cmp_id, fy_id, COUNT(*) n FROM inv_documents WHERE legacy_source_table = 'books_voucher_headers' {$in} GROUP BY cmp_id, fy_id ORDER BY 1,2")->getResultArray();
        $out['inventory_lines'] = [
            'rows' => (int) $b->query("SELECT COUNT(*) n FROM inv_document_lines WHERE legacy_source_table = 'books_voucher_inventory_lines' {$in}")->getRowArray()['n'],
            'by_company' => $this->byCompany($b, 'inv_document_lines', $in . " AND legacy_source_table = 'books_voucher_inventory_lines'"),
            'max_pk' => (int) $b->query("SELECT COALESCE(MAX(line_id),0) m FROM inv_document_lines WHERE legacy_source_table = 'books_voucher_inventory_lines'")->getRowArray()['m'],
        ];
        $out['movement_totals'] = $b->query(
            "SELECT l.cmp_id, l.fy_id,
                SUM(CASE WHEN l.direction = 'in' THEN l.qty ELSE 0 END) AS in_qty,
                SUM(CASE WHEN l.direction = 'out' THEN l.qty ELSE 0 END) AS out_qty,
                SUM(CASE WHEN l.direction = 'in' THEN COALESCE(l.source_transaction_amount,0) ELSE 0 END) AS in_source_amount,
                SUM(CASE WHEN l.direction = 'out' THEN COALESCE(l.source_transaction_amount,0) ELSE 0 END) AS out_source_amount,
                SUM(CASE WHEN l.direction = 'in' THEN COALESCE(l.valuation_amount,0) ELSE 0 END) AS in_valuation,
                SUM(CASE WHEN l.direction = 'out' THEN COALESCE(l.valuation_amount,0) ELSE 0 END) AS out_valuation,
                COUNT(*) AS line_count
             FROM inv_document_lines l JOIN inv_documents d ON d.document_id = l.document_id
             WHERE d.status IN ('POSTED','COMPLETED','PARTIALLY_FULFILLED') AND l.legacy_source_table = 'books_voucher_inventory_lines' AND l.direction IN ('in','out') " . str_replace('cmp_id', 'l.cmp_id', $in) . "
             GROUP BY l.cmp_id, l.fy_id ORDER BY 1,2"
        )->getResultArray();
        $out['opening_totals'] = $b->query("SELECT cmp_id, COUNT(*) lines, SUM(opening_qty) qty, SUM(opening_value) value FROM inv_item_openings WHERE fy_id = 0 {$in} GROUP BY cmp_id ORDER BY 1")->getResultArray();
        $out['fy_opening_totals'] = $b->query("SELECT cmp_id, fy_id, COUNT(*) lines, SUM(opening_qty) qty, SUM(opening_value) value FROM inv_item_openings WHERE fy_id > 0 {$in} GROUP BY cmp_id, fy_id ORDER BY 1,2")->getResultArray();
        $out['cost_layers'] = $b->query("SELECT cmp_id, COUNT(*) rows, SUM(qty_remaining) qty_remaining, SUM(qty_remaining * unit_cost) value_remaining FROM inv_cost_layers WHERE legacy_source_table = 'books_inventory_cost_layers' {$in} GROUP BY cmp_id ORDER BY 1")->getResultArray();
        $out['wac_state'] = $b->query("SELECT cmp_id, COUNT(*) rows, SUM(qty_on_hand) qty, SUM(qty_on_hand * average_cost) value FROM inv_wac_state WHERE 1=1 {$in} GROUP BY cmp_id ORDER BY 1")->getResultArray();
        $out['buckets'] = $b->query("SELECT cmp_id, COUNT(*) rows, SUM(packed_qty) packed, SUM(job_worker_qty) job_worker FROM inv_stock_balances WHERE legacy_source_table = 'books_stock_bucket_balances' {$in} GROUP BY cmp_id ORDER BY 1")->getResultArray();
        $out['pending'] = $b->query("SELECT cmp_id, pending_kind, direction, CASE status WHEN 'settled' THEN 'closed' ELSE status END AS status, COUNT(*) rows, SUM(qty_original) qty_original, SUM(qty_settled) qty_settled FROM inv_pending_quantities WHERE legacy_source_table = 'books_inventory_pending' {$in} GROUP BY cmp_id, pending_kind, direction, 4 ORDER BY 1,2,3,4")->getResultArray();
        $out['stock_movements'] = $b->query("SELECT cmp_id, fy_id, COUNT(*) rows, SUM(CASE WHEN qty > 0 THEN qty ELSE 0 END) in_qty, SUM(CASE WHEN qty < 0 THEN -qty ELSE 0 END) out_qty FROM inv_stock_movements WHERE 1=1 {$in} GROUP BY cmp_id, fy_id ORDER BY 1,2")->getResultArray();

        return $this->normalize($out);
    }

    /** @return array<int, int> */
    private function byCompany(BaseConnection $b, string $table, string $in): array
    {
        $rows = $b->query("SELECT cmp_id, COUNT(*) n FROM {$table} WHERE 1=1 {$in} GROUP BY cmp_id ORDER BY cmp_id")->getResultArray();
        $out = [];
        foreach ($rows as $r) {
            $out[(int) $r['cmp_id']] = (int) $r['n'];
        }

        return $out;
    }

    /** Round every numeric string to 4 dp so JSON comparison is exact. */
    private function normalize(mixed $v): mixed
    {
        if (is_array($v)) {
            foreach ($v as $k => $item) {
                $v[$k] = $this->normalize($item);
            }

            return $v;
        }
        if (is_string($v) && is_numeric($v)) {
            return str_contains($v, '.') ? round((float) $v, 4) : (int) $v;
        }

        return $v;
    }
}
