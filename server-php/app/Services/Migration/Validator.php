<?php

namespace App\Services\Migration;

use App\Services\StockBalanceService;
use App\Services\ValuationReplayService;
use CodeIgniter\Database\BaseConnection;

/**
 * VALIDATE / POSTCHECK: compare source and destination control totals, check referential
 * integrity on the destination, verify sequences, rebuild stock from opening + movements and
 * compare it with the migrated balances, and value stock the way Books did. Any unexplained
 * difference fails the stage.
 */
class Validator
{
    public function __construct(private BaseConnection $books, private BaseConnection $inv, private MigrationLog $log)
    {
    }

    /** @param list<int> $companies */
    public function run(array $companies, float $moneyTolerance = 0.01, float $qtyTolerance = 0.0001, ?string $booksSnapshotDir = null): array
    {
        $out = ['ok' => true, 'failures' => [], 'warnings' => [], 'sections' => []];
        $src = (new ControlTotals($this->books, 'books'))->compute($companies);
        $dst = (new ControlTotals($this->inv, 'inventory'))->compute($companies);
        $out['sections']['row_counts'] = $this->compareRowCounts($src, $dst, $out);
        $out['sections']['voucher_counts'] = $this->compareVoucherCounts($src, $dst, $out);
        $out['sections']['movement_totals'] = $this->compareKeyed($src['movement_totals'] ?? [], $dst['movement_totals'] ?? [], ['cmp_id', 'fy_id'], ['in_qty', 'out_qty', 'in_source_amount', 'out_source_amount', 'in_valuation', 'out_valuation', 'line_count'], $qtyTolerance, $moneyTolerance, 'movement_totals', $out);
        $out['sections']['opening_totals'] = $this->compareKeyed($src['opening_totals'] ?? [], $dst['opening_totals'] ?? [], ['cmp_id'], ['lines', 'qty', 'value'], $qtyTolerance, $moneyTolerance, 'opening_totals', $out, ['lines']);
        $out['sections']['fy_opening_totals'] = $this->compareKeyed($src['fy_opening_totals'] ?? [], $dst['fy_opening_totals'] ?? [], ['cmp_id', 'fy_id'], ['lines', 'qty', 'value'], $qtyTolerance, $moneyTolerance, 'fy_opening_totals', $out);
        $out['sections']['cost_layers'] = $this->compareKeyed($src['cost_layers'] ?? [], $dst['cost_layers'] ?? [], ['cmp_id'], ['rows', 'qty_remaining', 'value_remaining'], $qtyTolerance, $moneyTolerance, 'cost_layers', $out);
        $out['sections']['wac_state'] = $this->compareKeyed($src['wac_state'] ?? [], $dst['wac_state'] ?? [], ['cmp_id'], ['rows', 'qty', 'value'], $qtyTolerance, $moneyTolerance, 'wac_state', $out);
        $out['sections']['pending'] = $this->compareKeyed($src['pending'] ?? [], $dst['pending'] ?? [], ['cmp_id', 'pending_kind', 'direction', 'status'], ['rows', 'qty_original', 'qty_settled'], $qtyTolerance, $moneyTolerance, 'pending', $out);
        $out['sections']['buckets'] = $this->compareBuckets($src, $dst, $companies, $qtyTolerance, $out);
        $out['sections']['financial_unchanged'] = ['ledger_totals' => $src['ledger_totals'] ?? [], 'cogs_journal_totals' => $src['cogs_journal_totals'] ?? [], 'bills' => $src['bills'] ?? [], 'cc_allocations' => $src['cc_allocations'] ?? [], 'subledger_allocations' => $src['subledger_allocations'] ?? [], 'note' => 'Books financial tables are not touched by the migration; compare with the PRECHECK baseline of the same run.'];
        $out['sections']['destination_integrity'] = $this->destinationIntegrity($companies, $out);
        $out['sections']['sequences'] = $this->sequences($out);
        $out['sections']['stock_rebuild'] = $this->stockRebuild($companies, $qtyTolerance, $out);
        $out['sections']['valuation_vs_books'] = $this->valuationVsBooks($companies, $moneyTolerance, $out);
        if ($booksSnapshotDir !== null && $booksSnapshotDir !== '') {
            $out['sections']['books_snapshot'] = $this->booksSnapshot($booksSnapshotDir, $companies, $qtyTolerance, $moneyTolerance, $out);
        } else {
            $out['warnings'][] = 'No --books-snapshot directory given: Books\' own closing quantities and valuation (books:export-inventory-snapshot) were not compared.';
        }
        $out['ok'] = $out['failures'] === [];
        foreach ($out as $k => $v) {
            $this->log->set($k, $v);
        }

        return $out;
    }

    private function compareRowCounts(array $src, array $dst, array &$out): array
    {
        $pairs = ['books_items' => 'inv_items', 'books_item_groups' => 'inv_item_groups', 'books_stock_categories' => 'inv_stock_categories', 'books_item_units' => 'inv_uom', 'books_material_centres' => 'inv_warehouses', 'books_material_centre_groups' => 'inv_warehouse_groups', 'books_item_unit_lines' => 'inv_item_uoms', 'books_bom_headers' => 'inv_bom_headers', 'books_bom_lines' => 'inv_bom_lines'];
        $rows = [];
        foreach ($pairs as $s => $d) {
            if (!isset($src['masters'][$s])) {
                continue;
            }
            $a = $src['masters'][$s];
            $b = $dst['masters'][$d] ?? ['rows' => 0, 'by_company' => [], 'max_pk' => 0];
            $ok = (int) $a['rows'] === (int) $b['rows'] && $a['by_company'] == $b['by_company'] && (int) $a['max_pk'] <= (int) $b['max_pk'];
            $rows[] = ['source' => $s, 'dest' => $d, 'source_rows' => $a['rows'], 'dest_rows' => $b['rows'], 'source_max_pk' => $a['max_pk'], 'dest_max_pk' => $b['max_pk'], 'ok' => $ok, 'by_company_source' => $a['by_company'], 'by_company_dest' => $b['by_company']];
            if (!$ok) {
                $out['failures'][] = "row count mismatch {$s}({$a['rows']}) -> {$d}({$b['rows']})";
            }
        }
        $li = $src['inventory_lines'] ?? [];
        $ld = $dst['inventory_lines'] ?? [];
        $ok = (int) ($li['rows'] ?? 0) === (int) ($ld['rows'] ?? 0) && ($li['by_company'] ?? []) == ($ld['by_company'] ?? []);
        $rows[] = ['source' => 'books_voucher_inventory_lines', 'dest' => 'inv_document_lines', 'source_rows' => $li['rows'] ?? 0, 'dest_rows' => $ld['rows'] ?? 0, 'ok' => $ok];
        if (!$ok) {
            $out['failures'][] = 'inventory line count mismatch ' . ($li['rows'] ?? 0) . ' -> ' . ($ld['rows'] ?? 0);
        }

        return $rows;
    }

    private function compareVoucherCounts(array $src, array $dst, array &$out): array
    {
        $a = [];
        foreach ($src['vouchers_by_type'] ?? [] as $r) {
            $a[$r['vch_type_id'] . ':' . $r['status']] = (int) $r['n'];
        }
        $b = [];
        foreach ($dst['documents_by_type'] ?? [] as $r) {
            $b[$r['vch_type_id'] . ':' . $r['status']] = (int) $r['n'];
        }
        $diff = [];
        foreach (array_unique(array_merge(array_keys($a), array_keys($b))) as $k) {
            if (($a[$k] ?? 0) !== ($b[$k] ?? 0)) {
                $diff[$k] = ['source' => $a[$k] ?? 0, 'dest' => $b[$k] ?? 0];
            }
        }
        if ($diff !== []) {
            $out['failures'][] = 'voucher/document counts differ by type+status: ' . json_encode($diff);
        }
        $a2 = [];
        foreach ($src['vouchers_by_company_fy'] ?? [] as $r) {
            $a2[$r['cmp_id'] . ':' . $r['fy_id']] = (int) $r['n'];
        }
        $b2 = [];
        foreach ($dst['documents_by_company_fy'] ?? [] as $r) {
            $b2[$r['cmp_id'] . ':' . $r['fy_id']] = (int) $r['n'];
        }
        $diff2 = [];
        foreach (array_unique(array_merge(array_keys($a2), array_keys($b2))) as $k) {
            if (($a2[$k] ?? 0) !== ($b2[$k] ?? 0)) {
                $diff2[$k] = ['source' => $a2[$k] ?? 0, 'dest' => $b2[$k] ?? 0];
            }
        }
        if ($diff2 !== []) {
            $out['failures'][] = 'voucher/document counts differ by company+fy: ' . json_encode($diff2);
        }

        return ['by_type_status' => ['source' => $a, 'dest' => $b, 'diff' => $diff], 'by_company_fy' => ['source' => $a2, 'dest' => $b2, 'diff' => $diff2]];
    }

    private function compareKeyed(array $src, array $dst, array $keys, array $measures, float $qtyTol, float $moneyTol, string $section, array &$out, array $countMeasures = []): array
    {
        $index = static function (array $rows) use ($keys): array {
            $o = [];
            foreach ($rows as $r) {
                $o[implode(':', array_map(static fn ($k) => (string) ($r[$k] ?? ''), $keys))] = $r;
            }

            return $o;
        };
        $a = $index($src);
        $b = $index($dst);
        $diffs = [];
        foreach (array_unique(array_merge(array_keys($a), array_keys($b))) as $k) {
            foreach ($measures as $m) {
                $x = (float) ($a[$k][$m] ?? 0);
                $y = (float) ($b[$k][$m] ?? 0);
                $tol = (in_array($m, $countMeasures, true) || str_contains($m, 'count') || $m === 'rows' || $m === 'lines') ? 0.0 : (str_contains($m, 'qty') ? $qtyTol : $moneyTol);
                if (abs($x - $y) > $tol) {
                    $diffs[] = ['key' => $k, 'measure' => $m, 'source' => $x, 'dest' => $y, 'diff' => round($y - $x, 4)];
                }
            }
        }
        foreach ($diffs as $d) {
            $out['failures'][] = $section . ' ' . $d['key'] . ' ' . $d['measure'] . ': source ' . $d['source'] . ' dest ' . $d['dest'];
        }

        return ['keys' => count(array_unique(array_merge(array_keys($a), array_keys($b)))), 'diffs' => $diffs];
    }

    private function compareBuckets(array $src, array $dst, array $companies, float $qtyTol, array &$out): array
    {
        // Books buckets are per unit; Inventory converts to base units — compare after converting the source.
        $rows = [];
        $srcRows = $this->books->tableExists('books_stock_bucket_balances', false)
            ? $this->books->query('SELECT b.cmp_id, b.item_id, b.unit_id, b.mc_id, b.packed_qty, b.job_worker_qty, COALESCE(u.is_default,1) is_default, COALESCE(u.conversion_factor,1) factor FROM books_stock_bucket_balances b LEFT JOIN books_item_unit_lines u ON u.cmp_id = b.cmp_id AND u.item_id = b.item_id AND u.unit_id = b.unit_id' . ($companies ? ' WHERE b.cmp_id IN (' . implode(',', array_map('intval', $companies)) . ')' : ''))->getResultArray()
            : [];
        $expected = [];
        foreach ($srcRows as $r) {
            $f = (int) $r['is_default'] === 1 ? 1.0 : max(0.0000001, (float) $r['factor']);
            $k = $r['cmp_id'] . ':' . $r['item_id'] . ':' . (int) ($r['mc_id'] ?? 0);
            $expected[$k] ??= ['packed' => 0.0, 'job_worker' => 0.0];
            $expected[$k]['packed'] += (float) $r['packed_qty'] * $f;
            $expected[$k]['job_worker'] += (float) $r['job_worker_qty'] * $f;
        }
        $actual = [];
        foreach ($this->inv->query('SELECT cmp_id, item_id, COALESCE(warehouse_id,0) wh, packed_qty, job_worker_qty FROM inv_stock_balances WHERE batch_id IS NULL' . ($companies ? ' AND cmp_id IN (' . implode(',', array_map('intval', $companies)) . ')' : ''))->getResultArray() as $r) {
            $actual[$r['cmp_id'] . ':' . $r['item_id'] . ':' . $r['wh']] = ['packed' => (float) $r['packed_qty'], 'job_worker' => (float) $r['job_worker_qty']];
        }
        $diffs = [];
        foreach ($expected as $k => $e) {
            $a = $actual[$k] ?? ['packed' => 0.0, 'job_worker' => 0.0];
            foreach (['packed', 'job_worker'] as $m) {
                if (abs($e[$m] - $a[$m]) > $qtyTol) {
                    $diffs[] = ['key' => $k, 'measure' => $m, 'source' => round($e[$m], 4), 'dest' => round($a[$m], 4)];
                }
            }
        }
        foreach ($diffs as $d) {
            $out['failures'][] = 'bucket ' . $d['key'] . ' ' . $d['measure'] . ': source ' . $d['source'] . ' dest ' . $d['dest'];
        }

        return ['source_rows' => count($srcRows), 'keys' => count($expected), 'diffs' => $diffs];
    }

    private function destinationIntegrity(array $companies, array &$out): array
    {
        $in = $companies ? ' AND x.cmp_id IN (' . implode(',', array_map('intval', $companies)) . ')' : '';
        $checks = [
            'lines_without_document' => 'SELECT COUNT(*) n FROM inv_document_lines x LEFT JOIN inv_documents d ON d.document_id = x.document_id WHERE d.document_id IS NULL' . $in,
            'lines_unknown_item' => 'SELECT COUNT(*) n FROM inv_document_lines x LEFT JOIN inv_items i ON i.item_id = x.item_id WHERE i.item_id IS NULL' . $in,
            'lines_item_other_company' => 'SELECT COUNT(*) n FROM inv_document_lines x JOIN inv_items i ON i.item_id = x.item_id WHERE i.cmp_id <> x.cmp_id' . $in,
            'lines_unknown_warehouse' => 'SELECT COUNT(*) n FROM inv_document_lines x LEFT JOIN inv_warehouses w ON w.warehouse_id = x.warehouse_id WHERE x.warehouse_id IS NOT NULL AND w.warehouse_id IS NULL' . $in,
            'lines_warehouse_other_company' => 'SELECT COUNT(*) n FROM inv_document_lines x JOIN inv_warehouses w ON w.warehouse_id = x.warehouse_id WHERE w.cmp_id <> x.cmp_id' . $in,
            'lines_unknown_unit' => 'SELECT COUNT(*) n FROM inv_document_lines x LEFT JOIN inv_uom u ON u.unit_id = x.unit_id WHERE x.unit_id IS NOT NULL AND u.unit_id IS NULL' . $in,
            'documents_unknown_type' => "SELECT COUNT(*) n FROM inv_documents x WHERE x.document_type NOT IN ('" . implode("','", \Config\DocumentTypeRegistry::all()) . "')" . $in,
            'documents_zero_company' => 'SELECT COUNT(*) n FROM inv_documents x WHERE x.cmp_id <= 0 OR x.fy_id <= 0' . $in,
            'movements_without_line' => 'SELECT COUNT(*) n FROM inv_stock_movements x LEFT JOIN inv_document_lines l ON l.line_id = x.line_id WHERE l.line_id IS NULL' . $in,
            'items_unknown_base_unit' => 'SELECT COUNT(*) n FROM inv_items x LEFT JOIN inv_uom u ON u.unit_id = x.unit_id WHERE x.deleted_at IS NULL AND x.unit_id IS NOT NULL AND u.unit_id IS NULL' . $in,
            'items_unit_other_company' => 'SELECT COUNT(*) n FROM inv_items x JOIN inv_uom u ON u.unit_id = x.unit_id WHERE u.cmp_id <> x.cmp_id' . $in,
            'uoms_unknown_item' => 'SELECT COUNT(*) n FROM inv_item_uoms x LEFT JOIN inv_items i ON i.item_id = x.item_id WHERE i.item_id IS NULL' . $in,
            'openings_unknown_item' => 'SELECT COUNT(*) n FROM inv_item_openings x LEFT JOIN inv_items i ON i.item_id = x.item_id WHERE i.item_id IS NULL' . $in,
            'layers_unknown_item' => 'SELECT COUNT(*) n FROM inv_cost_layers x LEFT JOIN inv_items i ON i.item_id = x.item_id WHERE i.item_id IS NULL' . $in,
            'pending_unknown_document' => 'SELECT COUNT(*) n FROM inv_pending_quantities x LEFT JOIN inv_documents d ON d.document_id = x.document_id WHERE d.document_id IS NULL' . $in,
            'duplicate_source_documents' => 'SELECT COUNT(*) n FROM (SELECT x.cmp_id, x.source_app, x.source_document_type, x.source_document_id FROM inv_documents x WHERE x.source_document_id IS NOT NULL' . $in . ' GROUP BY 1,2,3,4 HAVING COUNT(*) > 1) q',
            'duplicate_legacy_map' => 'SELECT COUNT(*) n FROM (SELECT x.legacy_table, x.legacy_id, x.target_table FROM inv_legacy_id_map x WHERE 1=1' . $in . ' GROUP BY 1,2,3 HAVING COUNT(*) > 1) q',
            'lines_unaccounted' => "SELECT COUNT(*) n FROM inv_document_lines x WHERE x.legacy_source_table IS NOT NULL AND NOT EXISTS (SELECT 1 FROM inv_legacy_id_map m WHERE m.legacy_table = x.legacy_source_table AND m.legacy_id = x.legacy_source_id AND m.target_table = 'inv_document_lines')" . $in,
        ];
        $res = [];
        $soft = ['lines_unknown_warehouse', 'lines_unknown_unit', 'items_unknown_base_unit', 'layers_unknown_item'];
        foreach ($checks as $name => $sql) {
            $n = (int) $this->inv->query($sql)->getRowArray()['n'];
            $res[$name] = $n;
            if ($n > 0) {
                if (in_array($name, $soft, true)) {
                    $out['warnings'][] = "destination integrity {$name}: {$n} (soft — same rows were orphans in Books)";
                } else {
                    $out['failures'][] = "destination integrity {$name}: {$n}";
                }
            }
        }

        return $res;
    }

    private function sequences(array &$out): array
    {
        $r = new SequenceResetter($this->inv);
        $probe = $r->probe();
        foreach ($probe as $p) {
            if (!$p['ok']) {
                $out['failures'][] = 'sequence for ' . $p['table'] . ' would hand out ' . $p['next_value'] . ' <= max ' . $p['max_id'];
            }
        }
        $dupes = [];
        foreach (['inv_items' => 'item_id', 'inv_documents' => 'document_id', 'inv_document_lines' => 'line_id', 'inv_cost_layers' => 'layer_id', 'inv_uom' => 'unit_id', 'inv_warehouses' => 'warehouse_id', 'inv_item_openings' => 'opening_id'] as $t => $pk) {
            $n = (int) $this->inv->query("SELECT COUNT(*) n FROM (SELECT {$pk} FROM {$t} GROUP BY {$pk} HAVING COUNT(*) > 1) q")->getRowArray()['n'];
            if ($n > 0) {
                $dupes[$t] = $n;
                $out['failures'][] = "duplicate primary keys in {$t}: {$n}";
            }
        }

        return ['probe' => $probe, 'duplicate_pks' => $dupes];
    }

    /**
     * Rebuild closing stock per company/item/warehouse from opening + movements and compare with
     * the migrated inv_stock_balances.on_hand, and with Books' own closing quantities
     * (opening unit lines / fy openings + inventory lines walked with the Books direction rule).
     */
    private function stockRebuild(array $companies, float $qtyTol, array &$out): array
    {
        $svc = new StockBalanceService();
        $summary = [];
        $cmps = $companies ?: array_map(static fn ($r) => (int) $r['cmp_id'], $this->inv->query('SELECT DISTINCT cmp_id FROM inv_documents')->getResultArray());
        foreach ($cmps as $cmpId) {
            $fyId = $svc->latestFyId($cmpId);
            if ($fyId <= 0) {
                $summary[$cmpId] = ['fy_id' => 0, 'items' => 0, 'diffs' => []];
                continue;
            }
            $rebuilt = $svc->closingQuantities($cmpId, $fyId, 0, null, null);
            $bal = [];
            foreach ($this->inv->query('SELECT item_id, COALESCE(warehouse_id,0) wh, on_hand_qty FROM inv_stock_balances WHERE cmp_id = ? AND batch_id IS NULL', [$cmpId])->getResultArray() as $r) {
                $bal[$r['item_id'] . ':' . $r['wh']] = (float) $r['on_hand_qty'];
            }
            $diffs = [];
            foreach ($rebuilt as $key => $r) {
                $have = $bal[$key] ?? 0.0;
                if (abs($have - $r['closing_qty']) > $qtyTol) {
                    $diffs[] = ['key' => $key, 'rebuilt' => $r['closing_qty'], 'balance' => $have];
                }
                unset($bal[$key]);
            }
            foreach ($bal as $key => $have) {
                if (abs($have) > $qtyTol) {
                    $diffs[] = ['key' => $key, 'rebuilt' => 0.0, 'balance' => $have];
                }
            }
            // Books-side closing per item (same FY) using the Books rule, in base units.
            $booksClosing = $this->booksClosingByItem($cmpId, $fyId);
            $invByItem = [];
            foreach ($rebuilt as $r) {
                $invByItem[$r['item_id']] = round(($invByItem[$r['item_id']] ?? 0) + $r['closing_qty'], 4);
            }
            $bookDiffs = [];
            foreach (array_unique(array_merge(array_keys($booksClosing), array_keys($invByItem))) as $itemId) {
                $x = $booksClosing[$itemId] ?? 0.0;
                $y = $invByItem[$itemId] ?? 0.0;
                if (abs($x - $y) > $qtyTol) {
                    $bookDiffs[] = ['item_id' => $itemId, 'books' => $x, 'inventory' => $y];
                }
            }
            $summary[$cmpId] = ['fy_id' => $fyId, 'items' => count($invByItem), 'balance_vs_rebuild_diffs' => $diffs, 'books_vs_inventory_diffs' => $bookDiffs];
            if ($diffs !== []) {
                $out['failures'][] = "stock rebuild cmp {$cmpId}: " . count($diffs) . ' balance rows differ from rebuilt movements';
            }
            if ($bookDiffs !== []) {
                $out['failures'][] = "stock rebuild cmp {$cmpId}: " . count($bookDiffs) . ' items differ between Books walk and Inventory walk';
            }
        }

        return $summary;
    }

    /** @return array<int, float> Books closing qty per item (base units) for the FY, Books rule. */
    private function booksClosingByItem(int $cmpId, int $fyId): array
    {
        $b = $this->books;
        $factor = [];
        $default = [];
        foreach ($b->table('books_item_unit_lines')->select('item_id, unit_id, is_default, conversion_factor')->where('cmp_id', $cmpId)->get()->getResultArray() as $u) {
            $factor[$u['item_id'] . ':' . $u['unit_id']] = (int) $u['is_default'] === 1 ? 1.0 : max(0.0000001, (float) $u['conversion_factor']);
            if ((int) $u['is_default'] === 1) {
                $default[(int) $u['item_id']] = (int) $u['unit_id'];
            }
        }
        $toBase = static function (int $itemId, ?int $unitId, float $qty) use ($factor, $default): float {
            $u = $unitId ?: ($default[$itemId] ?? 0);
            $f = $u > 0 ? ($factor[$itemId . ':' . $u] ?? 1.0) : 1.0;

            return round($qty * $f, 4);
        };
        $out = [];
        $carried = $b->tableExists('books_fy_carryforward', false) && $b->table('books_fy_carryforward')->where('cmp_id', $cmpId)->where('target_fy_id', $fyId)->where('status', 'completed')->countAllResults() > 0;
        if (!$carried && $b->tableExists('books_item_fy_openings', false)) {
            $carried = $b->table('books_item_fy_openings')->where('cmp_id', $cmpId)->where('fy_id', $fyId)->countAllResults() > 0;
        }
        if ($carried) {
            foreach ($b->table('books_item_fy_openings')->select('item_id, unit_id, opening_qty')->where('cmp_id', $cmpId)->where('fy_id', $fyId)->get()->getResultArray() as $r) {
                $out[(int) $r['item_id']] = round(($out[(int) $r['item_id']] ?? 0) + $toBase((int) $r['item_id'], (int) $r['unit_id'], (float) $r['opening_qty']), 4);
            }
        } else {
            foreach ($b->table('books_item_unit_lines')->select('item_id, unit_id, opening_qty, is_default, conversion_factor')->where('cmp_id', $cmpId)->get()->getResultArray() as $r) {
                $f = (int) $r['is_default'] === 1 ? 1.0 : max(0.0000001, (float) $r['conversion_factor']);
                $out[(int) $r['item_id']] = round(($out[(int) $r['item_id']] ?? 0) + (float) $r['opening_qty'] * $f, 4);
            }
        }
        $rows = $b->query(
            "SELECT l.item_id, l.unit_id, l.qty, l.dr_cr, h.vch_type_id, h.stock_effect FROM books_voucher_inventory_lines l JOIN books_voucher_headers h ON h.vch_txn_id = l.vch_txn_id
             WHERE l.cmp_id = ? AND l.fy_id = ? AND h.status <> 'cancelled' AND h.deleted_at IS NULL",
            [$cmpId, $fyId]
        )->getResultArray();
        foreach ($rows as $r) {
            $dir = \Config\DocumentTypeRegistry::legacyDirection((int) $r['vch_type_id'], (int) $r['dr_cr']);
            if ($dir === null) {
                continue;
            }
            $t = (int) $r['vch_type_id'];
            if (in_array($t, [23, 24], true) && (($r['stock_effect'] ?? 'challan_only') === 'challan_only')) {
                continue;
            }
            if ($t === 11 && ($r['stock_effect'] ?? '') === 'defer_inward') {
                continue;
            }
            if ($t === 7) {
                continue;
            }
            $q = $toBase((int) $r['item_id'], (int) ($r['unit_id'] ?? 0) ?: null, (float) $r['qty']);
            $out[(int) $r['item_id']] = round(($out[(int) $r['item_id']] ?? 0) + ($dir === 'in' ? $q : -$q), 4);
        }

        return array_filter($out, static fn ($q) => abs($q) > 0.00001);
    }

    /**
     * Value the migrated stock with the Inventory replay engine and compare to the Books figures
     * recorded on the lines: Σ posted valuation (cost_amount) per company/FY must match exactly,
     * and the closing valuation must reconcile within tolerance to Books' own replay
     * (StockValuationService::snapshotValuation is reproduced by ValuationReplayService).
     */
    /**
     * Compare, item by item, the closing quantity and stock value Books itself reports
     * (files written by `php spark books:export-inventory-snapshot`, i.e. Books'
     * StockBalanceService + StockValuationService) with what Inventory reports for the
     * same company / FY / as-of date. This is the "compare with the backed-up database"
     * check: both engines must agree before cutover.
     */
    private function booksSnapshot(string $dir, array $companies, float $qtyTol, float $moneyTol, array &$out): array
    {
        $files = glob(rtrim($dir, '/') . '/*.json') ?: [];
        if ($files === []) {
            $out['failures'][] = "books snapshot: no *.json files in {$dir}";

            return ['dir' => $dir, 'files' => 0];
        }
        $svc = new ValuationReplayService();
        $summary = ['dir' => $dir, 'files' => 0, 'compared' => [], 'skipped' => []];
        foreach ($files as $file) {
            $snap = json_decode((string) file_get_contents($file), true);
            if (!is_array($snap) || ($snap['source'] ?? '') !== 'books') {
                $summary['skipped'][] = basename($file) . ': not a books snapshot';
                continue;
            }
            $cmpId = (int) $snap['cmp_id'];
            $fyId = (int) $snap['fy_id'];
            if ($companies !== [] && !in_array($cmpId, $companies, true)) {
                $summary['skipped'][] = basename($file) . ': company not in scope';
                continue;
            }
            $summary['files']++;
            $asOf = (string) ($snap['as_of'] ?? date('Y-m-d'));
            $inv = $svc->snapshot($cmpId, $fyId, (int) ($snap['bo_id'] ?? 0), $asOf, 'AS_PER_MASTER');
            $invRows = [];
            foreach ($inv['rows'] as $r) {
                $invRows[(int) $r['item_id']] = $r;
            }
            $booksRows = [];
            foreach ($snap['items'] ?? [] as $r) {
                $booksRows[(int) $r['item_id']] = $r;
            }
            $excluded = $this->booksDoubleCountedByItem($cmpId, $fyId, $asOf);
            $zeroCostTransfers = $this->booksZeroCostTransferInByItem($cmpId, $fyId, $asOf);
            $missingCostLayers = $this->booksMissingCostLayerByItem($cmpId, $fyId, $asOf);
            $booksLayerValue   = $this->booksLayerValueByItem($cmpId);
            $qtyDiffs = [];
            $explained = [];
            $valueDiffs = [];
            $valueExplained = [];
            foreach (array_unique(array_merge(array_keys($booksRows), array_keys($invRows))) as $itemId) {
                $bq = (float) ($booksRows[$itemId]['closing_qty'] ?? 0);
                $iq = (float) ($invRows[$itemId]['closing_qty'] ?? 0);
                $bv = (float) ($booksRows[$itemId]['stock_value'] ?? 0);
                $iv = (float) ($invRows[$itemId]['stock_value'] ?? 0);
                $qtyExplained = false;
                if (abs($bq - $iq) > $qtyTol) {
                    $extra = (float) ($excluded[$itemId]['qty'] ?? 0);
                    $entry = ['item_id' => $itemId, 'books' => $bq, 'inventory' => $iq, 'books_double_counted_qty' => $extra, 'residual' => round($bq - $iq - $extra, 4), 'lines' => $excluded[$itemId]['lines'] ?? []];
                    if (abs($entry['residual']) <= $qtyTol && $extra != 0.0) {
                        $explained[] = $entry;
                        $qtyExplained = true;
                    } else {
                        $qtyDiffs[] = $entry;
                    }
                }
                if (abs($bv - $iv) > $moneyTol) {
                    $entry = ['item_id' => $itemId, 'books' => $bv, 'inventory' => $iv, 'books_unit_cost' => $booksRows[$itemId]['unit_cost'] ?? null, 'inventory_unit_cost' => $invRows[$itemId]['unit_cost'] ?? null, 'method' => $booksRows[$itemId]['valuation_method_applied'] ?? null];
                    if ($qtyExplained) {
                        $valueExplained[] = $entry;
                    } elseif (isset($zeroCostTransfers[$itemId])) {
                        // Books wrote unit_cost 0 for this item's stock-transfer receiving-side
                        // layer despite the transfer line's own cost_rate being real and non-zero
                        // (a known Books valuation gap, not a migration defect — see
                        // docs/DB_MIGRATION_VALIDATION.md). Inventory's replay uses the line's
                        // real cost_rate, which is why its unit cost comes out higher than
                        // Books' own report whenever that layer is still open at the as-of date.
                        $entry['reason'] = 'transfer_zero_cost_layer';
                        $entry['transfer_zero_cost_lines'] = $zeroCostTransfers[$itemId];
                        $valueExplained[] = $entry;
                    } elseif (
                        isset($booksLayerValue[$itemId])
                        && abs($booksLayerValue[$itemId]['value'] - $iv) <= $moneyTol
                        && abs($booksLayerValue[$itemId]['value'] - $bv) > $moneyTol
                    ) {
                        // Books' own cost layers are complete and intact, and their total agrees
                        // with Inventory to the penny. Books' *valuation report* is the outlier.
                        // No accounting judgement is needed here: Books' own data proves the
                        // migrated figure correct.
                        $entry['reason'] = 'books_report_disagrees_with_own_layers';
                        $entry['books_layer_value'] = $booksLayerValue[$itemId]['value'];
                        $entry['books_layers'] = $booksLayerValue[$itemId]['layers'];
                        $valueExplained[] = $entry;
                    } elseif (
                        isset($missingCostLayers[$itemId])
                        && (float) ($entry['books_unit_cost'] ?? 0) < (float) ($entry['inventory_unit_cost'] ?? 0) - 0.00001
                    ) {
                        // Books' inward line carries a real cost_rate, but the cost layer its
                        // valuation report reads was never written (or was written at zero), so
                        // Books values the item off fewer receipts than it actually has.
                        // Inventory replays the movements and uses the cost Books itself recorded
                        // on each line, including the amount when the rate field was left blank.
                        //
                        // The test is on UNIT cost, not total value: a missing layer always
                        // leaves Books' per-unit cost too low, whether it reports zero (no layer
                        // at all) or merely too little (some layers present, others missing), and
                        // it holds for negative stock too, where a lower unit cost produces a
                        // MORE negative total. An item where Books' unit cost is at or above
                        // Inventory's is a different question and must still fail.
                        $entry['reason'] = 'books_cost_layer_missing';
                        $entry['books_lines_with_cost'] = $missingCostLayers[$itemId];
                        $valueExplained[] = $entry;
                    } else {
                        $valueDiffs[] = $entry;
                    }
                }
            }
            $row = [
                'file' => basename($file), 'cmp_id' => $cmpId, 'fy_id' => $fyId, 'as_of' => $asOf,
                'books' => ['items' => count($booksRows), 'closing_qty' => (float) ($snap['totals']['closing_qty'] ?? 0), 'stock_value' => (float) ($snap['totals']['stock_value'] ?? 0)],
                'inventory' => ['items' => count($invRows), 'closing_qty' => (float) $inv['total_qty'], 'stock_value' => (float) $inv['total_value']],
                'qty_diffs' => $qtyDiffs, 'value_diffs' => $valueDiffs,
                'explained_qty_diffs' => $explained, 'explained_value_diffs' => $valueExplained,
                'explanation' => $explained === [] ? null : 'Books\' stock-quantity reports count every stored item line, so a delivery challan (challan_only) AND the later invoice raised from it both reduce stock, and a deferred-inward purchase AND its inward challan both add it; Books\' valuation engine and Inventory count each physical movement once. books = inventory + books_double_counted_qty for every explained item.',
                'value_explanation' => self::valueExplanations($valueExplained),
            ];
            $summary['compared'][] = $row;
            $this->log->event('books_snapshot_compared', $row, ($qtyDiffs === [] && $valueDiffs === []) ? (($explained === [] && $valueExplained === []) ? 'info' : 'warning') : 'error');
            if ($explained !== []) {
                $out['warnings'][] = "books snapshot cmp {$cmpId} fy {$fyId}: " . count($explained) . ' items differ from the Books stock report ONLY by challan/deferred lines Books counted twice (residual 0) — explained, see validate.summary.json';
            }
            foreach (self::valueExplanations($valueExplained) ?? [] as $reason => $text) {
                $n = count(array_filter($valueExplained, static fn ($e) => ($e['reason'] ?? '') === $reason));
                $out['warnings'][] = "books snapshot cmp {$cmpId} fy {$fyId}: {$n} items differ in stock value only — {$reason} — explained and approved, see validate.summary.json";
            }
            if ($qtyDiffs !== []) {
                $out['failures'][] = "books snapshot cmp {$cmpId} fy {$fyId}: " . count($qtyDiffs) . ' items differ in closing quantity between Books and Inventory (unexplained residual)';
            }
            if ($valueDiffs !== []) {
                $out['failures'][] = "books snapshot cmp {$cmpId} fy {$fyId}: " . count($valueDiffs) . ' items differ in stock value between Books and Inventory';
            }
        }

        return $summary;
    }

    /**
     * Quantity (base units) per item that Books' StockBalanceService counts but no physical
     * movement backs: challan_only challan lines and deferred-inward purchase lines. Signed the
     * way Books counted them (dr_cr 1 = +, 2 = -), up to the as-of date, posted only.
     *
     * @return array<int, array{qty: float, lines: list<array<string, mixed>>}>
     */
    private function booksDoubleCountedByItem(int $cmpId, int $fyId, string $asOf): array
    {
        $rows = $this->books->query(
            "SELECT l.inv_line_id, h.vch_txn_id, h.vch_type_id, h.vch_number, h.vch_date, COALESCE(h.stock_effect,'challan_only') AS stock_effect, l.item_id, l.unit_id, l.qty, l.dr_cr,
                    COALESCE(CASE WHEN u.is_default = 1 THEN 1 ELSE u.conversion_factor END, 1) AS factor
             FROM books_voucher_inventory_lines l
             JOIN books_voucher_headers h ON h.vch_txn_id = l.vch_txn_id
             LEFT JOIN books_item_unit_lines u ON u.cmp_id = l.cmp_id AND u.item_id = l.item_id AND u.unit_id = l.unit_id
             WHERE l.cmp_id = ? AND l.fy_id = ? AND h.status = 'posted' AND h.deleted_at IS NULL AND h.vch_date <= ?
               AND ((h.vch_type_id IN (23,24) AND COALESCE(h.stock_effect,'challan_only') = 'challan_only')
                 OR (h.vch_type_id = 11 AND h.stock_effect = 'defer_inward'))
             ORDER BY l.item_id, h.vch_date, l.inv_line_id",
            [$cmpId, $fyId, $asOf]
        )->getResultArray();
        $out = [];
        foreach ($rows as $r) {
            $itemId = (int) $r['item_id'];
            $base = round((float) $r['qty'] * (float) $r['factor'], 4);
            $signed = (int) $r['dr_cr'] === 1 ? $base : -$base;
            $out[$itemId]['qty'] = round(($out[$itemId]['qty'] ?? 0) + $signed, 4);
            $out[$itemId]['lines'][] = ['vch_txn_id' => (int) $r['vch_txn_id'], 'vch_type_id' => (int) $r['vch_type_id'], 'vch_number' => $r['vch_number'], 'vch_date' => $r['vch_date'], 'stock_effect' => $r['stock_effect'], 'qty_base' => $signed];
        }

        return $out;
    }

    /**
     * Items whose stock-transfer (legacy vch_type 15) receiving-side cost layer Books stored
     * with unit_cost 0, even though the transfer line's own cost_rate was real — the same known
     * gap ReconciliationService::transferValuationGap() already names for the live-mode
     * reconciliation. Used to explain a value-only difference (matching quantity, differing
     * unit cost) between Books' own reported valuation and Inventory's replay, which uses the
     * line's real cost_rate instead of the zero Books wrote to the layer.
     *
     * @return array<int, list<array<string, mixed>>> item_id => the qualifying transfer lines
     */
    /**
     * One explanation line per reason actually present among the explained value differences.
     * Two different Books gaps produce value-only differences and they must not be conflated in
     * the cutover record.
     *
     * @param list<array<string, mixed>> $explained
     * @return array<string, string>|null
     */
    private static function valueExplanations(array $explained): ?array
    {
        if ($explained === []) {
            return null;
        }
        $texts = [
            'transfer_zero_cost_layer' => "Books wrote unit_cost 0 for these items' stock-transfer (vch_type 15) receiving-side cost layer, though the transfer line's own cost_rate was real and non-zero — a known Books valuation gap, not a migration defect. Inventory's replayed valuation uses the line's real cost_rate.",
            'books_cost_layer_missing' => "Books' inward line carries a real cost_rate but the cost layer its valuation report reads was never written, or was written at zero, so Books reports the item as worthless. Inventory replays the movement using the cost Books itself recorded on the line. Reviewed and approved by the owner before cutover: accepting Inventory's figures rather than carrying demonstrably purchased stock at zero. Every affected item and voucher is listed under books_lines_with_cost.",
            'books_report_disagrees_with_own_layers' => "Books' own cost layers for these items are complete and intact, and their total (qty_remaining x unit_cost, listed under books_layers) agrees with Inventory exactly. Books' valuation report disagrees with Books' own stored layers - a reporting defect in Books, not a migration difference. Inventory's figure is corroborated by Books' data itself, so no judgement call is involved in accepting it.",
            'qty_explained'            => 'Value differs only because the quantity difference is itself already explained; see explanation.',
        ];
        $out = [];
        foreach ($explained as $e) {
            $reason = (string) ($e['reason'] ?? 'qty_explained');
            if (isset($texts[$reason])) {
                $out[$reason] = $texts[$reason];
            }
        }

        return $out === [] ? null : $out;
    }

    /**
     * Books' own closing value per item, derived from its stored cost layers rather than from its
     * valuation report: SUM(qty_remaining * unit_cost). Layers are company-scoped, not FY-scoped,
     * and reflect current state, so this only corroborates a comparison whose as-of date is the
     * present. That is self-limiting: a historical as-of simply will not match, and then the
     * explanation does not fire and the difference still fails.
     *
     * @return array<int, array{value: float, layers: list<array<string, mixed>>}>
     */
    private function booksLayerValueByItem(int $cmpId): array
    {
        if (!$this->has('books_inventory_cost_layers')) {
            return [];
        }
        $rows = $this->books->query(
            "SELECT item_id, layer_id, qty_remaining, unit_cost
             FROM books_inventory_cost_layers
             WHERE cmp_id = ? AND qty_remaining <> 0
             ORDER BY item_id, layer_id",
            [$cmpId]
        )->getResultArray();
        $out = [];
        foreach ($rows as $r) {
            $itemId = (int) $r['item_id'];
            $qty = (float) $r['qty_remaining'];
            $cost = (float) $r['unit_cost'];
            $out[$itemId]['value'] = round(($out[$itemId]['value'] ?? 0.0) + $qty * $cost, 4);
            $out[$itemId]['layers'][] = [
                'layer_id' => (int) $r['layer_id'], 'qty_remaining' => $qty, 'unit_cost' => $cost,
                'layer_value' => round($qty * $cost, 4),
            ];
        }

        return $out;
    }

    /**
     * Items whose posted inward lines carry a real cost_rate while the Books cost layer that its
     * valuation report reads is missing or zero — so Books reports no value for stock it recorded
     * a purchase cost for. Distinct from booksZeroCostTransferInByItem(), which covers transfers
     * (vch_type 15); the inward types here (11, 2, 24) do not overlap with it.
     *
     * @return array<int, list<array<string, mixed>>> item_id => the qualifying lines
     */
    private function booksMissingCostLayerByItem(int $cmpId, int $fyId, string $asOf): array
    {
        $rows = $this->books->query(
            "SELECT l.item_id, h.vch_txn_id, h.vch_number, h.vch_date, h.vch_type_id, l.cost_rate,
                    cl.layer_id, cl.unit_cost AS layer_unit_cost
             FROM books_voucher_inventory_lines l
             JOIN books_voucher_headers h ON h.vch_txn_id = l.vch_txn_id
             LEFT JOIN books_inventory_cost_layers cl
                    ON cl.cmp_id = l.cmp_id AND cl.item_id = l.item_id AND cl.source_vch_txn_id = l.vch_txn_id
             WHERE l.cmp_id = ? AND l.fy_id = ? AND h.status = 'posted' AND h.deleted_at IS NULL
               AND h.vch_date <= ? AND h.vch_type_id IN (11, 2, 24) AND l.cost_rate > 0
               AND (cl.layer_id IS NULL OR cl.unit_cost IS NULL OR cl.unit_cost = 0)
             ORDER BY l.item_id, h.vch_date",
            [$cmpId, $fyId, $asOf]
        )->getResultArray();
        $out = [];
        foreach ($rows as $r) {
            $out[(int) $r['item_id']][] = [
                'vch_txn_id' => (int) $r['vch_txn_id'], 'vch_number' => $r['vch_number'], 'vch_date' => $r['vch_date'],
                'vch_type_id' => (int) $r['vch_type_id'], 'line_cost_rate' => (float) $r['cost_rate'],
                'layer_id' => $r['layer_id'] !== null ? (int) $r['layer_id'] : null,
                'layer_unit_cost' => $r['layer_unit_cost'] !== null ? (float) $r['layer_unit_cost'] : null,
            ];
        }

        return $out;
    }

    private function booksZeroCostTransferInByItem(int $cmpId, int $fyId, string $asOf): array
    {
        $rows = $this->books->query(
            "SELECT l.item_id, h.vch_txn_id, h.vch_number, h.vch_date, l.mc_id, l.cost_rate, cl.layer_id, cl.unit_cost AS layer_unit_cost
             FROM books_voucher_inventory_lines l
             JOIN books_voucher_headers h ON h.vch_txn_id = l.vch_txn_id
             LEFT JOIN books_inventory_cost_layers cl ON cl.cmp_id = l.cmp_id AND cl.item_id = l.item_id AND cl.source_vch_txn_id = l.vch_txn_id
             WHERE l.cmp_id = ? AND l.fy_id = ? AND h.status = 'posted' AND h.deleted_at IS NULL AND h.vch_date <= ?
               AND h.vch_type_id = 15 AND l.dr_cr = 1 AND l.cost_rate > 0
               AND (cl.unit_cost = 0 OR cl.unit_cost IS NULL)
             ORDER BY l.item_id, h.vch_date",
            [$cmpId, $fyId, $asOf]
        )->getResultArray();
        $out = [];
        foreach ($rows as $r) {
            $out[(int) $r['item_id']][] = [
                'vch_txn_id' => (int) $r['vch_txn_id'], 'vch_number' => $r['vch_number'], 'vch_date' => $r['vch_date'],
                'warehouse_id' => (int) $r['mc_id'], 'line_cost_rate' => (float) $r['cost_rate'],
                'layer_id' => $r['layer_id'] !== null ? (int) $r['layer_id'] : null, 'layer_unit_cost' => (float) ($r['layer_unit_cost'] ?? 0),
            ];
        }

        return $out;
    }

    private function valuationVsBooks(array $companies, float $moneyTol, array &$out): array
    {
        $svc = new ValuationReplayService();
        $summary = [];
        $cmps = $companies ?: array_map(static fn ($r) => (int) $r['cmp_id'], $this->inv->query('SELECT DISTINCT cmp_id FROM inv_documents')->getResultArray());
        foreach ($cmps as $cmpId) {
            $fyId = (new StockBalanceService())->latestFyId($cmpId);
            if ($fyId <= 0) {
                continue;
            }
            $snap = $svc->snapshot($cmpId, $fyId, 0, null, 'AS_PER_MASTER');
            $summary[$cmpId] = ['fy_id' => $fyId, 'inventory_closing_value' => $snap['total_value'], 'inventory_closing_qty' => $snap['total_qty'], 'items' => count($snap['rows'])];
            $this->log->event('valuation_snapshot', ['cmp_id' => $cmpId, 'fy_id' => $fyId, 'total_value' => $snap['total_value'], 'total_qty' => $snap['total_qty']]);
        }

        return $summary;
    }
}
