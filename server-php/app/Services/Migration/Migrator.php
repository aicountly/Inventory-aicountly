<?php

namespace App\Services\Migration;

use App\Services\FyCarryForwardStatus;
use App\Services\SchemaCache;
use CodeIgniter\Database\BaseConnection;
use Config\DocumentTypeRegistry;

/**
 * MIGRATE: copies inventory-owned data from the Books database into the Inventory database.
 *
 *  - idempotent: every row is keyed by (legacy_source_table, legacy_source_id); re-running a
 *    company skips rows already present (or, with --replace, deletes that company's migrated
 *    rows first inside one transaction)
 *  - primary keys are preserved value-for-value (item_id, unit_id, mc_id -> warehouse_id,
 *    vch_txn_id -> document_id, inv_line_id -> line_id, layer_id ...)
 *  - --dry-run runs everything inside a transaction and rolls it back
 *  - one company per transaction; Books is only ever read
 *  - sequences are reset afterwards by SequenceResetter (VALIDATE / CUTOVER stages)
 */
class Migrator
{
    /** @var array<string, mixed> */
    private array $stats = [];
    private string $now;

    public function __construct(
        private BaseConnection $books,
        private BaseConnection $inv,
        private MigrationLog $log,
        private string $runId,
        private bool $dryRun = false,
        private bool $replace = false,
    ) {
        $this->now = date('Y-m-d H:i:s');
        // CodeIgniter swallows statement failures inside a transaction unless told
        // otherwise; a migration must never continue past a failed INSERT.
        $this->inv->transException(true);
    }

    /**
     * insertBatch() needs every row to carry the same key set; rows built from
     * different source tables (item lines vs packing vs job-work lines) do not.
     * Union the keys and fill the gaps with NULL.
     *
     * @param list<array<string, mixed>> $rows
     * @return list<array<string, mixed>>
     */
    private static function normaliseRows(array $rows): array
    {
        if ($rows === []) {
            return [];
        }
        $keys = [];
        foreach ($rows as $r) {
            foreach ($r as $k => $_) {
                $keys[$k] = true;
            }
        }
        $template = array_fill_keys(array_keys($keys), null);
        $out = [];
        foreach ($rows as $r) {
            $out[] = array_replace($template, $r);
        }

        return $out;
    }

    /** @return list<int> */
    public function discoverCompanies(): array
    {
        $rows = $this->books->query('SELECT DISTINCT cmp_id FROM books_items UNION SELECT DISTINCT cmp_id FROM books_voucher_inventory_lines UNION SELECT DISTINCT cmp_id FROM books_material_centres UNION SELECT DISTINCT cmp_id FROM books_item_units ORDER BY 1')->getResultArray();

        return array_map(static fn ($r) => (int) $r['cmp_id'], $rows);
    }

    /** @return array<string, mixed> */
    public function migrateCompany(int $cmpId): array
    {
        $this->stats = ['cmp_id' => $cmpId, 'tables' => [], 'warnings' => []];
        // Never touch a company that has gone live: documents without a legacy source were
        // created through the API after cutover and a re-run (or --replace) would destroy them.
        $live = (int) $this->inv->table('inv_documents')->where('cmp_id', $cmpId)->where('legacy_source_table', null)->countAllResults();
        if ($live > 0) {
            $this->log->event('company_refused_live_data', ['cmp_id' => $cmpId, 'live_documents' => $live], 'error');
            throw new \RuntimeException(sprintf('Company %d already has %d live inventory document(s) created after cutover; refusing to migrate or replace it. Use reconciliation and books:inventory-retry --resync instead.', $cmpId, $live));
        }
        $this->log->event('company_start', ['cmp_id' => $cmpId, 'dry_run' => $this->dryRun, 'replace' => $this->replace]);
        $inv = $this->inv;
        $inv->transStart();
        try {
            if ($this->replace) {
                $this->removeCompany($cmpId);
            }
            $this->assertNoLiveData($cmpId);
            $this->migrateSettings($cmpId);
            $this->copyMaster($cmpId, 'books_item_groups', 'inv_item_groups', 'item_grp_id', 'item_grp_id', ['grp_name', 'grp_alias', 'parent_grp_id', 'is_primary', 'is_active', 'created_at', 'updated_at', 'deleted_at', 'deleted_by', 'bo_id']);
            $this->copyMaster($cmpId, 'books_stock_categories', 'inv_stock_categories', 'stock_cat_id', 'stock_cat_id', ['cat_name', 'cat_alias', 'is_active', 'created_at', 'updated_at', 'deleted_at', 'deleted_by', 'bo_id']);
            $this->copyMaster($cmpId, 'books_item_units', 'inv_uom', 'unit_id', 'unit_id', ['unit_name', 'unit_symbol', 'print_name', 'uqc_gst', 'is_active', 'created_at', 'updated_at', 'deleted_at', 'deleted_by', 'bo_id']);
            $this->copyMaster($cmpId, 'books_material_centre_groups', 'inv_warehouse_groups', 'mc_grp_id', 'warehouse_group_id', ['grp_name', 'parent_grp_id', 'is_active', 'created_at', 'updated_at', 'deleted_at', 'deleted_by', 'bo_id']);
            $this->copyMaster($cmpId, 'books_material_centres', 'inv_warehouses', 'mc_id', 'warehouse_id', ['mc_name' => 'warehouse_name', 'mc_grp_id' => 'warehouse_group_id', 'is_active', 'created_at', 'updated_at', 'deleted_at', 'deleted_by', 'bo_id'], static fn (array $r) => $r + ['warehouse_type' => 'standard']);
            $this->migrateItems($cmpId);
            $this->copyMaster($cmpId, 'books_item_unit_lines', 'inv_item_uoms', 'item_unit_line_id', 'item_unit_line_id', ['item_id', 'unit_id', 'is_default', 'conversion_factor', 'mc_qty_wise', 'created_at', 'updated_at'], static fn (array $r) => $r + ['uom_role' => (int) ($r['is_default'] ?? 0) === 1 ? 'base' : null], false);
            if ($this->books->tableExists('books_bom_headers', false)) {
                $this->copyMaster($cmpId, 'books_bom_headers', 'inv_bom_headers', 'bom_id', 'bom_id', ['bom_name', 'finished_item_id', 'yield_qty', 'is_active', 'created_at', 'updated_at', 'deleted_at', 'deleted_by']);
                $this->copyMaster($cmpId, 'books_bom_lines', 'inv_bom_lines', 'bom_line_id', 'bom_line_id', ['bom_id', 'item_id', 'qty', 'unit_id', 'sort_order'], null, false);
            }
            $this->migrateOpenings($cmpId);
            $this->migrateCarryForwardStatus($cmpId);
            $this->migrateDocuments($cmpId);
            $this->migrateValuationState($cmpId);
            $this->migrateBuckets($cmpId);
            $this->migratePending($cmpId);
            $this->migrateSnapshots($cmpId);
            $this->buildMovementsAndBalances($cmpId);

            if ($this->dryRun) {
                $inv->transRollback();
                $inv->resetTransStatus();
                $this->log->event('company_dry_run_rolled_back', ['cmp_id' => $cmpId]);
            } else {
                $inv->transComplete();
                if ($inv->transStatus() === false) {
                    throw new \RuntimeException('Transaction failed for company ' . $cmpId);
                }
            }
        } catch (\Throwable $e) {
            $inv->transRollback();
            $inv->resetTransStatus();
            $this->log->event('company_failed', ['cmp_id' => $cmpId, 'error' => $e->getMessage(), 'at' => $e->getFile() . ':' . $e->getLine(), 'trace' => array_slice(explode("\n", $e->getTraceAsString()), 0, 8)], 'error');
            throw $e;
        }
        SchemaCache::flush();
        FyCarryForwardStatus::flush();
        $this->log->event('company_done', ['cmp_id' => $cmpId, 'stats' => $this->stats]);

        return $this->stats;
    }

    // ------------------------------------------------------------------ pieces

    private function migrateSettings(int $cmpId): void
    {
        $default = 'FIFO';
        if ($this->books->tableExists('books_company_settings', false)) {
            $row = $this->books->table('books_company_settings')->where('cmp_id', $cmpId)->get()->getRowArray();
            if ($row && !empty($row['default_stock'])) {
                $default = \App\Services\InventorySettingsService::normalizeMethod($row['default_stock']);
            }
        }
        $exists = $this->inv->table('inv_company_settings')->where('cmp_id', $cmpId)->countAllResults() > 0;
        if ($exists) {
            $this->inv->table('inv_company_settings')->where('cmp_id', $cmpId)->update(['default_valuation_method' => $default, 'valuation_scope' => 'company', 'negative_stock_policy' => 'allow', 'updated_at' => $this->now, 'updated_by' => 'migration:' . $this->runId]);
        } else {
            $this->inv->table('inv_company_settings')->insert(['cmp_id' => $cmpId, 'default_valuation_method' => $default, 'valuation_scope' => 'company', 'negative_stock_policy' => 'allow', 'created_at' => $this->now, 'updated_at' => $this->now, 'updated_by' => 'migration:' . $this->runId]);
        }
        $this->stats['tables']['inv_company_settings'] = ['inserted' => $exists ? 0 : 1, 'default_valuation_method' => $default];
    }

    /**
     * Generic master copy with PK preservation. $columns: list of source columns or source => dest pairs.
     */
    private function copyMaster(int $cmpId, string $src, string $dest, string $srcPk, string $destPk, array $columns, ?callable $decorate = null, bool $softDelete = true): void
    {
        if (!$this->books->tableExists($src, false)) {
            $this->stats['tables'][$dest] = ['skipped' => 'source table missing'];

            return;
        }
        $existing = $this->existingLegacyIds($cmpId, $src, $dest);
        $rows = $this->books->table($src)->where('cmp_id', $cmpId)->orderBy($srcPk, 'ASC')->get()->getResultArray();
        $inserted = 0;
        $skipped = 0;
        $batch = [];
        $map = [];
        foreach ($rows as $r) {
            $pk = (int) $r[$srcPk];
            if (isset($existing[$pk])) {
                $skipped++;
                continue;
            }
            $row = [$destPk => $pk, 'cmp_id' => $cmpId, 'legacy_source_table' => $src, 'legacy_source_id' => $pk];
            foreach ($columns as $k => $v) {
                $from = is_int($k) ? $v : $k;
                $to = is_int($k) ? $v : $v;
                if (array_key_exists($from, $r) && $this->inv->fieldExists($to, $dest)) {
                    $row[$to] = $r[$from];
                }
            }
            if ($decorate !== null) {
                $row = $decorate($row);
            }
            $batch[] = $row;
            $map[] = ['cmp_id' => $cmpId, 'legacy_table' => $src, 'legacy_id' => $pk, 'target_table' => $dest, 'target_id' => $pk, 'migration_run_id' => $this->runId, 'created_at' => $this->now];
            if (count($batch) >= 500) {
                $this->inv->table($dest)->insertBatch(self::normaliseRows($batch));
                $this->inv->table('inv_legacy_id_map')->insertBatch(self::normaliseRows($map));
                $inserted += count($batch);
                $batch = [];
                $map = [];
            }
        }
        if ($batch !== []) {
            $this->inv->table($dest)->insertBatch(self::normaliseRows($batch));
            $this->inv->table('inv_legacy_id_map')->insertBatch(self::normaliseRows($map));
            $inserted += count($batch);
        }
        $this->stats['tables'][$dest] = ['source' => $src, 'source_rows' => count($rows), 'inserted' => $inserted, 'skipped_existing' => $skipped];
        $this->log->event('table_copied', ['cmp_id' => $cmpId, 'source' => $src, 'dest' => $dest, 'rows' => count($rows), 'inserted' => $inserted, 'skipped' => $skipped]);
    }

    private function migrateItems(int $cmpId): void
    {
        $default = $this->inv->table('inv_company_settings')->where('cmp_id', $cmpId)->get()->getRowArray()['default_valuation_method'] ?? 'FIFO';
        $this->copyMaster($cmpId, 'books_items', 'inv_items', 'item_id', 'item_id', [
            'item_name', 'item_alias', 'print_name', 'item_sku', 'item_upc', 'hsn_sac', 'mrp', 'unit_id', 'stock_cat_id', 'item_grp_id',
            'sales_acc_id' => 'books_sales_acc_id', 'purchase_acc_id' => 'books_purchase_acc_id', 'tax_cat_id' => 'books_tax_cat_id',
            'valuation_method', 'is_active', 'created_at', 'updated_at', 'deleted_at', 'deleted_by', 'bo_id',
        ], static function (array $r) use ($default) {
            $r['valuation_method'] = \App\Services\InventorySettingsService::normalizeMethod($r['valuation_method'] ?? '', $default);
            $r['item_type'] = 'stock';
            $r['print_name'] = $r['print_name'] ?? $r['item_name'];

            return $r;
        });
    }

    /**
     * books_item_unit_lines.opening_qty/opening_rate -> inv_item_openings fy_id = 0 (inception),
     * books_item_fy_openings -> inv_item_openings fy_id = year (carry-forward), opening_id preserved.
     */
    private function migrateOpenings(int $cmpId): void
    {
        $existingInception = $this->existingLegacyIds($cmpId, 'books_item_unit_lines', 'inv_item_openings');
        $lines = $this->books->table('books_item_unit_lines')->where('cmp_id', $cmpId)->where('opening_qty <>', 0)->orderBy('item_unit_line_id')->get()->getResultArray();
        $rows = [];
        $map = [];
        $seenKey = [];
        foreach ($lines as $l) {
            $pk = (int) $l['item_unit_line_id'];
            if (isset($existingInception[$pk])) {
                continue;
            }
            $key = $l['item_id'] . ':' . $l['unit_id'];
            if (isset($seenKey[$key])) {
                $this->stats['warnings'][] = 'duplicate inception opening for item ' . $l['item_id'] . ' unit ' . $l['unit_id'] . ' (unit line ' . $pk . ') merged';
                // merge quantities into the earlier row
                foreach ($rows as &$prev) {
                    if ($prev['item_id'] == $l['item_id'] && $prev['unit_id'] == $l['unit_id']) {
                        $prev['opening_qty'] = round((float) $prev['opening_qty'] + (float) $l['opening_qty'], 4);
                        $prev['opening_value'] = round((float) $prev['opening_value'] + (float) $l['opening_qty'] * (float) ($l['opening_rate'] ?? 0), 4);
                        $prev['opening_valuation_rate'] = (float) $prev['opening_qty'] > 0 ? round((float) $prev['opening_value'] / (float) $prev['opening_qty'], 4) : 0;
                    }
                }
                unset($prev);
                continue;
            }
            $seenKey[$key] = true;
            $qty = (float) $l['opening_qty'];
            $rate = (float) ($l['opening_rate'] ?? 0);
            $rows[] = [
                'opening_id' => TableMap::OPENING_ID_OFFSET_INCEPTION + $pk, 'cmp_id' => $cmpId, 'fy_id' => 0, 'bo_id' => 0, 'item_id' => (int) $l['item_id'], 'warehouse_id' => null, 'unit_id' => (int) $l['unit_id'],
                'opening_qty' => $qty, 'opening_valuation_rate' => $rate, 'opening_value' => round($qty * $rate, 4), 'source_kind' => 'master_inception',
                'created_at' => $l['created_at'] ?? $this->now, 'updated_at' => $l['updated_at'] ?? $this->now, 'created_by' => 'migration:' . $this->runId,
                'legacy_source_table' => 'books_item_unit_lines', 'legacy_source_id' => $pk,
            ];
            $map[] = ['cmp_id' => $cmpId, 'legacy_table' => 'books_item_unit_lines', 'legacy_id' => $pk, 'target_table' => 'inv_item_openings', 'target_id' => TableMap::OPENING_ID_OFFSET_INCEPTION + $pk, 'migration_run_id' => $this->runId, 'created_at' => $this->now];
        }
        foreach (array_chunk($rows, 500) as $chunk) {
            $this->inv->table('inv_item_openings')->insertBatch(self::normaliseRows($chunk));
        }
        foreach (array_chunk($map, 500) as $chunk) {
            $this->inv->table('inv_legacy_id_map')->insertBatch(self::normaliseRows($chunk));
        }
        $this->stats['tables']['inv_item_openings.inception'] = ['source_rows' => count($lines), 'inserted' => count($rows)];

        if ($this->books->tableExists('books_item_fy_openings', false)) {
            $hasRate = $this->books->fieldExists('opening_rate', 'books_item_fy_openings');
            $this->copyMaster($cmpId, 'books_item_fy_openings', 'inv_item_openings', 'item_fy_opening_id', 'opening_id', ['fy_id', 'item_id', 'unit_id', 'mc_id' => 'warehouse_id', 'opening_qty', 'opening_rate' => 'opening_valuation_rate', 'opening_value', 'created_at', 'updated_at'], function (array $r) use ($hasRate) {
                $r['source_kind'] = 'carry_forward';
                $r['bo_id'] = 0;
                $r['created_by'] = 'migration:' . $this->runId;
                if (!$hasRate) {
                    $r['opening_valuation_rate'] = 0;
                    $r['opening_value'] = 0;
                }

                return $r;
            }, false);
        }
    }

    private function migrateCarryForwardStatus(int $cmpId): void
    {
        if (!$this->books->tableExists('books_fy_carryforward', false)) {
            return;
        }
        $this->copyMaster($cmpId, 'books_fy_carryforward', 'inv_fy_carryforward_status', 'carryforward_id', 'id', ['source_fy_id', 'target_fy_id', 'bo_id', 'status', 'stock_item_count', 'carried_forward_at', 'carried_forward_by', 'created_at'], static function (array $r) {
            // Only runs that carried ITEMS count for inventory openings (modules column, migration 145; older rows carried everything).
            return $r;
        }, false);
        // Drop rows whose run did not include the items module.
        $rows = $this->books->table('books_fy_carryforward')->select('carryforward_id, modules')->where('cmp_id', $cmpId)->get()->getResultArray();
        foreach ($rows as $r) {
            $modules = (string) ($r['modules'] ?? 'accounts,items,operations');
            if (!str_contains($modules, 'items')) {
                $this->inv->table('inv_fy_carryforward_status')->where('legacy_source_table', 'books_fy_carryforward')->where('legacy_source_id', (int) $r['carryforward_id'])->delete();
            }
        }
    }

    /**
     * Item-bearing Books vouchers -> inv_documents (document_id = vch_txn_id) with their item lines
     * (line_id = inv_line_id), packing lines and job-work lines (offset ids).
     */
    private function migrateDocuments(int $cmpId): void
    {
        $b = $this->books;
        $types = implode(',', TableMap::ITEM_BEARING_TYPES);
        $existing = $this->existingLegacyIds($cmpId, 'books_voucher_headers', 'inv_documents');
        $headers = $b->query(
            "SELECT h.* FROM books_voucher_headers h WHERE h.cmp_id = ? AND h.vch_type_id IN ({$types})
             AND (EXISTS (SELECT 1 FROM books_voucher_inventory_lines l WHERE l.vch_txn_id = h.vch_txn_id) OR h.vch_type_id IN (4,6,7,10,14,15,20,23,24))
             ORDER BY h.vch_txn_id",
            [$cmpId]
        )->getResultArray();
        $hasPackingMeta = $b->tableExists('books_voucher_packing_meta', false);
        $hasPackingLines = $b->tableExists('books_voucher_packing_lines', false);
        $hasJobLines = $b->tableExists('books_voucher_job_work_lines', false);
        $existingLines = $this->existingLegacyIds($cmpId, 'books_voucher_inventory_lines', 'inv_document_lines');
        $docsInserted = 0;
        $linesInserted = 0;
        $docBatch = [];
        $mapBatch = [];
        $lineBatch = [];
        $lineMap = [];
        $packingMeta = [];
        $flush = function () use (&$docBatch, &$mapBatch, &$lineBatch, &$lineMap, &$docsInserted, &$linesInserted) {
            if ($docBatch !== []) {
                $this->inv->table('inv_documents')->insertBatch(self::normaliseRows($docBatch));
                $docsInserted += count($docBatch);
                $docBatch = [];
            }
            if ($lineBatch !== []) {
                foreach (array_chunk($lineBatch, 500) as $chunk) {
                    $this->inv->table('inv_document_lines')->insertBatch(self::normaliseRows($chunk));
                }
                $linesInserted += count($lineBatch);
                $lineBatch = [];
            }
            foreach (array_chunk(array_merge($mapBatch, $lineMap), 500) as $chunk) {
                $this->inv->table('inv_legacy_id_map')->insertBatch(self::normaliseRows($chunk));
            }
            $mapBatch = [];
            $lineMap = [];
        };
        foreach ($headers as $h) {
            $vchTxnId = (int) $h['vch_txn_id'];
            if (isset($existing[$vchTxnId])) {
                continue;
            }
            $vchType = (int) $h['vch_type_id'];
            $docType = DocumentTypeRegistry::fromLegacyVchType($vchType);
            $status = $this->mapStatus((string) $h['status'], $h['deleted_at'] ?? null);
            $uuid = $this->deterministicUuid('books_voucher_headers:' . $vchTxnId);
            $meta = [];
            if (!empty($h['production_metadata_json'])) {
                $meta['production'] = json_decode((string) $h['production_metadata_json'], true);
            }
            if (!empty($h['transport_json'])) {
                $meta['transport'] = json_decode((string) $h['transport_json'], true);
            }
            $sourceType = 'books.' . $this->legacyTypeCode($vchType);
            $docBatch[] = [
                'document_id' => $vchTxnId, 'document_uuid' => $this->deterministicUuid('inv_documents:' . $vchTxnId), 'cmp_id' => $cmpId, 'bo_id' => (int) $h['bo_id'], 'fy_id' => (int) $h['fy_id'],
                'document_type' => $docType, 'document_no' => $h['vch_number'], 'series_id' => null, 'document_date' => $h['vch_date'], 'status' => $status,
                'source_app' => 'books', 'source_document_type' => $sourceType, 'source_document_id' => $vchTxnId, 'source_document_uuid' => $uuid, 'source_document_no' => $h['vch_number'], 'source_document_date' => $h['vch_date'],
                'party_ref' => $h['party_acc_id'] ?? null, 'dest_party_ref' => $h['dest_party_acc_id'] ?? null, 'from_warehouse_id' => null, 'to_warehouse_id' => $h['dest_mc_id'] ?? null, 'dest_bo_id' => $h['dest_bo_id'] ?? null,
                'stock_effect' => $h['stock_effect'] ?? null, 'returnable' => isset($h['returnable']) ? ($h['returnable'] === true || $h['returnable'] === 't' || $h['returnable'] === '1' || $h['returnable'] === 1) : null,
                'expected_return_date' => $h['expected_return_date'] ?? null, 'movement_reason' => $h['movement_reason'] ?? null, 'narration' => $h['narration'] ?? null,
                'currency_code' => 'INR', 'exchange_rate' => (float) ($h['exchange_rate'] ?? 1) ?: 1, 'metadata_json' => $meta !== [] ? json_encode($meta) : null,
                'posted_by' => $h['created_by'] ?? null, 'posted_at' => $status === 'POSTED' ? ($h['created_at'] ?? $this->now) : null,
                'cancelled_at' => $status === 'CANCELLED' ? ($h['updated_at'] ?? $this->now) : null, 'version' => (int) ($h['version'] ?? 1),
                'created_by' => $h['created_by'] ?? null, 'created_at' => $h['created_at'] ?? $this->now, 'updated_at' => $h['updated_at'] ?? $this->now,
                'legacy_source_table' => 'books_voucher_headers', 'legacy_source_id' => $vchTxnId, 'legacy_vch_type_id' => $vchType,
            ];
            $mapBatch[] = ['cmp_id' => $cmpId, 'legacy_table' => 'books_voucher_headers', 'legacy_id' => $vchTxnId, 'target_table' => 'inv_documents', 'target_id' => $vchTxnId, 'target_uuid' => $docBatch[count($docBatch) - 1]['document_uuid'], 'migration_run_id' => $this->runId, 'created_at' => $this->now];

            // Item lines
            $lines = $b->table('books_voucher_inventory_lines')->where('vch_txn_id', $vchTxnId)->orderBy('inv_line_id')->get()->getResultArray();
            $sort = 0;
            foreach ($lines as $l) {
                $lineId = (int) $l['inv_line_id'];
                if (isset($existingLines[$lineId])) {
                    continue;
                }
                $direction = DocumentTypeRegistry::legacyDirection($vchType, (int) $l['dr_cr']) ?? 'none';
                if (in_array($vchType, [23, 24], true) && ($h['stock_effect'] ?? 'challan_only') === 'challan_only') {
                    // challan_only: pending only, line keeps its nominal direction for display
                }
                $lineBatch[] = [
                    'line_id' => $lineId, 'line_uuid' => $this->deterministicUuid('inv_document_lines:' . $lineId), 'document_id' => $vchTxnId, 'cmp_id' => $cmpId, 'fy_id' => (int) ($l['fy_id'] ?: $h['fy_id']), 'bo_id' => (int) $h['bo_id'],
                    'item_id' => (int) $l['item_id'], 'warehouse_id' => $l['mc_id'] ?? null, 'unit_id' => !empty($l['unit_id']) ? (int) $l['unit_id'] : null, 'direction' => $direction,
                    'qty' => (float) $l['qty'], 'conversion_factor' => 1, 'base_qty' => (float) $l['qty'],
                    'source_transaction_rate' => (float) $l['rate'], 'source_transaction_amount' => (float) $l['amount'],
                    'source_fc_rate' => $l['fc_rate'] ?? null, 'source_fc_amount' => $l['fc_amount'] ?? null, 'source_exchange_rate' => $l['exchange_rate'] ?? null,
                    'valuation_rate' => $l['cost_rate'] ?? null, 'valuation_amount' => $l['cost_amount'] ?? null, 'valuation_method_applied' => $l['valuation_method_applied'] ?? null,
                    'book_qty' => $l['book_qty'] ?? null, 'physical_qty' => $l['physical_qty'] ?? null, 'books_tax_cat_id' => $l['tax_cat_id'] ?? null, 'hsn_sac' => $l['hsn_sac'] ?? null,
                    'source_line_ref' => $l['txn_id'] ?? null, 'sort_order' => $sort++, 'legacy_source_table' => 'books_voucher_inventory_lines', 'legacy_source_id' => $lineId,
                ];
                $lineMap[] = ['cmp_id' => $cmpId, 'legacy_table' => 'books_voucher_inventory_lines', 'legacy_id' => $lineId, 'target_table' => 'inv_document_lines', 'target_id' => $lineId, 'migration_run_id' => $this->runId, 'created_at' => $this->now];
            }
            // Packing lines (type 4) and job-work out lines (type 7) live in their own Books tables.
            if ($vchType === 4 && $hasPackingLines) {
                foreach ($b->table('books_voucher_packing_lines')->where('vch_txn_id', $vchTxnId)->orderBy('packing_line_id')->get()->getResultArray() as $pl) {
                    $lineId = TableMap::LINE_ID_OFFSET_PACKING + (int) $pl['packing_line_id'];
                    $lineBatch[] = [
                        'line_id' => $lineId, 'line_uuid' => $this->deterministicUuid('inv_document_lines:' . $lineId), 'document_id' => $vchTxnId, 'cmp_id' => $cmpId, 'fy_id' => (int) $h['fy_id'], 'bo_id' => (int) $h['bo_id'],
                        'item_id' => (int) $pl['item_id'], 'warehouse_id' => $pl['mc_id'] ?? null, 'unit_id' => (int) $pl['unit_id'] ?: null, 'direction' => 'out',
                        'qty' => (float) $pl['qty'], 'conversion_factor' => 1, 'base_qty' => (float) $pl['qty'], 'sort_order' => (int) $pl['sort_order'],
                        'metadata_json' => !empty($pl['box_marks_json']) ? json_encode(['box_marks' => json_decode((string) $pl['box_marks_json'], true)]) : null,
                        'legacy_source_table' => 'books_voucher_packing_lines', 'legacy_source_id' => (int) $pl['packing_line_id'],
                    ];
                    $lineMap[] = ['cmp_id' => $cmpId, 'legacy_table' => 'books_voucher_packing_lines', 'legacy_id' => (int) $pl['packing_line_id'], 'target_table' => 'inv_document_lines', 'target_id' => $lineId, 'migration_run_id' => $this->runId, 'created_at' => $this->now];
                }
                if ($hasPackingMeta) {
                    $pm = $b->table('books_voucher_packing_meta')->where('vch_txn_id', $vchTxnId)->get()->getRowArray();
                    if ($pm) {
                        $packingMeta[] = ['document_id' => $vchTxnId, 'cmp_id' => $cmpId, 'consignee_ref' => (int) $pm['consignee_acc_id'], 'packing_status' => $this->mapPackingStatus((string) $pm['packing_status']), 'locked_by_document_id' => $pm['locked_by_vch_txn_id'] ?? null, 'locked_by_external_ref' => !empty($pm['locked_by_draft_id']) ? 'books_draft:' . $pm['locked_by_draft_id'] : null, 'locked_at' => $pm['locked_at'] ?? null, 'created_at' => $pm['created_at'] ?? $this->now, 'updated_at' => $pm['updated_at'] ?? $this->now];
                    }
                }
            }
            if ($vchType === 7 && $hasJobLines) {
                foreach ($b->table('books_voucher_job_work_lines')->where('vch_txn_id', $vchTxnId)->orderBy('line_id')->get()->getResultArray() as $jl) {
                    $lineId = TableMap::LINE_ID_OFFSET_JOB_WORK + (int) $jl['line_id'];
                    $lineBatch[] = [
                        'line_id' => $lineId, 'line_uuid' => $this->deterministicUuid('inv_document_lines:' . $lineId), 'document_id' => $vchTxnId, 'cmp_id' => $cmpId, 'fy_id' => (int) $h['fy_id'], 'bo_id' => (int) $h['bo_id'],
                        'item_id' => (int) $jl['item_id'], 'warehouse_id' => $jl['mc_id'] ?? null, 'unit_id' => (int) $jl['unit_id'] ?: null, 'direction' => 'out',
                        'qty' => (float) $jl['qty'], 'conversion_factor' => 1, 'base_qty' => (float) $jl['qty'], 'sort_order' => (int) $jl['sort_order'],
                        'legacy_source_table' => 'books_voucher_job_work_lines', 'legacy_source_id' => (int) $jl['line_id'],
                    ];
                    $lineMap[] = ['cmp_id' => $cmpId, 'legacy_table' => 'books_voucher_job_work_lines', 'legacy_id' => (int) $jl['line_id'], 'target_table' => 'inv_document_lines', 'target_id' => $lineId, 'migration_run_id' => $this->runId, 'created_at' => $this->now];
                }
            }
            if (count($docBatch) >= 200) {
                $flush();
            }
        }
        $flush();
        if ($packingMeta !== []) {
            foreach (array_chunk($packingMeta, 500) as $chunk) {
                $this->inv->table('inv_packing_meta')->insertBatch(self::normaliseRows($chunk));
            }
        }
        $this->stats['tables']['inv_documents'] = ['source_rows' => count($headers), 'inserted' => $docsInserted];
        $this->stats['tables']['inv_document_lines'] = ['inserted' => $linesInserted];
        $this->log->event('documents_copied', ['cmp_id' => $cmpId, 'documents' => $docsInserted, 'lines' => $linesInserted]);
        // base_qty / conversion_factor from unit lines (Books stored qty in the line unit).
        $this->inv->query(
            'UPDATE inv_document_lines l SET conversion_factor = u.conversion_factor, base_qty = ROUND(l.qty * u.conversion_factor, 4)
             FROM inv_item_uoms u WHERE u.cmp_id = l.cmp_id AND u.item_id = l.item_id AND u.unit_id = l.unit_id AND u.is_default = 0 AND l.cmp_id = ? AND l.legacy_source_table IS NOT NULL',
            [$cmpId]
        );
    }

    private function migrateValuationState(int $cmpId): void
    {
        if ($this->books->tableExists('books_inventory_cost_layers', false)) {
            $this->copyMaster($cmpId, 'books_inventory_cost_layers', 'inv_cost_layers', 'layer_id', 'layer_id', ['fy_id', 'item_id', 'qty_remaining', 'unit_cost', 'received_at', 'source_vch_txn_id' => 'source_document_id', 'source_inv_line_id' => 'source_line_id', 'created_at'], static function (array $r) {
                $r['warehouse_id'] = null;
                $r['layer_kind'] = $r['source_document_id'] === null && $r['source_line_id'] === null ? 'opening' : ((float) $r['qty_remaining'] < 0 ? 'backorder' : 'receipt');
                $r['qty_received'] = null; // Books did not keep the received quantity

                return $r;
            }, false);
        }
        if ($this->books->tableExists('books_inventory_wac_state', false)) {
            $rows = $this->books->table('books_inventory_wac_state')->where('cmp_id', $cmpId)->get()->getResultArray();
            $n = 0;
            foreach ($rows as $r) {
                $exists = $this->inv->table('inv_wac_state')->where('cmp_id', $cmpId)->where('item_id', (int) $r['item_id'])->where('warehouse_id', 0)->countAllResults() > 0;
                if ($exists) {
                    continue;
                }
                $this->inv->table('inv_wac_state')->insert(['cmp_id' => $cmpId, 'item_id' => (int) $r['item_id'], 'warehouse_id' => 0, 'qty_on_hand' => (float) $r['qty_on_hand'], 'average_cost' => (float) $r['average_cost'], 'updated_at' => $r['updated_at'] ?? $this->now]);
                $n++;
            }
            $this->stats['tables']['inv_wac_state'] = ['source_rows' => count($rows), 'inserted' => $n];
        }
    }

    private function migrateBuckets(int $cmpId): void
    {
        if (!$this->books->tableExists('books_stock_bucket_balances', false)) {
            return;
        }
        $existing = $this->existingLegacyIds($cmpId, 'books_stock_bucket_balances', 'inv_stock_balances');
        $rows = $this->books->table('books_stock_bucket_balances')->where('cmp_id', $cmpId)->orderBy('balance_id')->get()->getResultArray();
        $n = 0;
        $factorCache = [];
        foreach ($rows as $r) {
            $pk = (int) $r['balance_id'];
            if (isset($existing[$pk])) {
                continue;
            }
            $itemId = (int) $r['item_id'];
            $unitId = (int) $r['unit_id'];
            $key = $itemId . ':' . $unitId;
            if (!isset($factorCache[$key])) {
                $u = $this->inv->table('inv_item_uoms')->select('is_default, conversion_factor')->where('cmp_id', $cmpId)->where('item_id', $itemId)->where('unit_id', $unitId)->get()->getRowArray();
                $factorCache[$key] = $u ? ((int) $u['is_default'] === 1 ? 1.0 : max(0.0000001, (float) $u['conversion_factor'])) : 1.0;
            }
            $f = $factorCache[$key];
            $wh = $r['mc_id'] !== null ? (int) $r['mc_id'] : null;
            // Merge into the (item, warehouse) row if another unit already created it.
            $target = $this->inv->table('inv_stock_balances')->where('cmp_id', $cmpId)->where('item_id', $itemId)->where('warehouse_id', $wh)->where('batch_id', null)->get()->getRowArray();
            $packed = round((float) $r['packed_qty'] * $f, 4);
            $jw = round((float) ($r['job_worker_qty'] ?? 0) * $f, 4);
            if ($target) {
                $this->inv->table('inv_stock_balances')->where('balance_id', (int) $target['balance_id'])->update(['packed_qty' => (float) $target['packed_qty'] + $packed, 'job_worker_qty' => (float) $target['job_worker_qty'] + $jw, 'updated_at' => $this->now]);
            } else {
                // Balance rows are derived state keyed by (item, warehouse); nothing references
                // balance_id, so the sequence assigns it and the Books id lives in legacy_source_id.
                $this->inv->table('inv_stock_balances')->insert(['cmp_id' => $cmpId, 'item_id' => $itemId, 'warehouse_id' => $wh, 'batch_id' => null, 'on_hand_qty' => 0, 'packed_qty' => $packed, 'job_worker_qty' => $jw, 'updated_at' => $r['updated_at'] ?? $this->now, 'legacy_source_table' => 'books_stock_bucket_balances', 'legacy_source_id' => $pk]);
                $target = ['balance_id' => (int) $this->inv->insertID()];
            }
            $this->inv->table('inv_legacy_id_map')->insert(['cmp_id' => $cmpId, 'legacy_table' => 'books_stock_bucket_balances', 'legacy_id' => $pk, 'target_table' => 'inv_stock_balances', 'target_id' => (int) $target['balance_id'], 'migration_run_id' => $this->runId, 'created_at' => $this->now]);
            $n++;
        }
        $this->stats['tables']['inv_stock_balances.buckets'] = ['source_rows' => count($rows), 'inserted_or_merged' => $n];
        if ($this->books->tableExists('books_stock_bucket_ledger', false)) {
            $this->copyMaster($cmpId, 'books_stock_bucket_ledger', 'inv_stock_status_movements', 'ledger_id', 'ledger_id', ['item_id', 'unit_id', 'mc_id' => 'warehouse_id', 'vch_txn_id' => 'document_id', 'movement_type', 'qty', 'created_at'], static fn (array $r) => $r + ['base_qty' => $r['qty']], false);
        }
    }

    private function migratePending(int $cmpId): void
    {
        if (!$this->books->tableExists('books_inventory_pending', false)) {
            return;
        }
        $this->copyMaster($cmpId, 'books_inventory_pending', 'inv_pending_quantities', 'pending_id', 'pending_id', ['fy_id', 'vch_txn_id' => 'document_id', 'inv_line_id' => 'line_id', 'pending_kind', 'direction', 'item_id', 'mc_id' => 'warehouse_id', 'party_acc_id' => 'party_ref', 'qty_original', 'qty_settled', 'status', 'created_at', 'updated_at'], static function (array $r) {
            $r['status'] = $r['status'] === 'closed' ? 'settled' : $r['status'];

            return $r;
        }, false);
        if ($this->books->tableExists('books_inventory_settlement', false)) {
            $this->copyMaster($cmpId, 'books_inventory_settlement', 'inv_pending_settlements', 'settlement_id', 'settlement_id', ['pending_id', 'settle_vch_txn_id' => 'settle_document_id', 'settle_inv_line_id' => 'settle_line_id', 'qty_settled', 'created_at'], null, false);
        }
    }

    private function migrateSnapshots(int $cmpId): void
    {
        if (!$this->books->tableExists('books_movement_document_snapshots', false)) {
            return;
        }
        $this->copyMaster($cmpId, 'books_movement_document_snapshots', 'inv_document_snapshots', 'snap_id', 'snap_id', ['branch_id' => 'bo_id', 'source_voucher_id' => 'document_id', 'document_variant', 'document_no', 'document_date', 'currency_code', 'header_snapshot_json', 'source_dest_snapshot_json', 'item_lines_snapshot_json', 'transport_snapshot_json', 'variant_extras_snapshot_json', 'footer_snapshot_json', 'print_configuration_id', 'print_configuration_version', 'template_version', 'status', 'legacy_reconstructed', 'created_by', 'created_at', 'updated_at'], null, false);
    }

    /**
     * Derive inv_stock_movements from migrated posted lines (Books had no movement ledger; its
     * reports walked the lines) and materialise on-hand balances. Only lines that moved stock in
     * Books move stock here: challan_only challans, job-work out, packing and deferred purchases
     * are pending/status-only exactly as before.
     */
    private function buildMovementsAndBalances(int $cmpId): void
    {
        $inv = $this->inv;
        $inv->table('inv_stock_movements')->where('cmp_id', $cmpId)->where("created_by LIKE 'migration:%'", null, false)->delete();
        $sql = "INSERT INTO inv_stock_movements (cmp_id, fy_id, bo_id, document_id, line_id, document_type, movement_date, sequence_no, item_id, warehouse_id, batch_id, direction, qty, unit_cost, value, movement_kind, created_at, created_by)
            SELECT l.cmp_id, l.fy_id, l.bo_id, l.document_id, l.line_id, d.document_type, d.document_date, l.sort_order, l.item_id, l.warehouse_id, NULL, l.direction,
                   CASE WHEN l.direction = 'in' THEN l.base_qty ELSE -l.base_qty END, l.valuation_rate,
                   CASE WHEN l.valuation_amount IS NULL THEN NULL WHEN l.direction = 'in' THEN l.valuation_amount ELSE -l.valuation_amount END,
                   'physical', d.created_at, 'migration:" . $this->runId . "'
            FROM inv_document_lines l JOIN inv_documents d ON d.document_id = l.document_id
            WHERE l.cmp_id = ? AND d.status = 'POSTED' AND l.direction IN ('in','out') AND l.base_qty > 0
              AND l.legacy_source_table = 'books_voucher_inventory_lines'
              AND NOT (d.document_type IN ('DELIVERY_CHALLAN','INWARD_CHALLAN') AND COALESCE(d.stock_effect,'challan_only') = 'challan_only')
              AND NOT (d.document_type = 'PURCHASE_RECEIPT' AND d.stock_effect = 'defer_inward')
              AND d.document_type NOT IN ('JOB_WORK_OUT','PACKING')";
        $inv->query($sql, [$cmpId]);
        $moved = (int) $inv->table('inv_stock_movements')->where('cmp_id', $cmpId)->countAllResults();
        $this->stats['tables']['inv_stock_movements'] = ['inserted' => $moved];
        // Materialised on-hand per (item, warehouse) for the LATEST FY per Books semantics (opening + movements).
        $balances = new \App\Services\StockBalanceService();
        $fyId = $balances->latestFyId($cmpId);
        $written = $fyId > 0 ? $balances->rebuildOnHand($cmpId, $fyId) : 0;
        $this->stats['tables']['inv_stock_balances.on_hand'] = ['fy_id' => $fyId, 'rows' => $written];
    }

    /**
     * A company that already has documents or movements NOT produced by a migration run is
     * live on Inventory; re-running the migration would rebuild its movements and balances
     * from Books and silently discard live activity. Refuse.
     */
    private function assertNoLiveData(int $cmpId): void
    {
        $liveDocs = (int) $this->inv->table('inv_documents')->where('cmp_id', $cmpId)->where('legacy_source_table', null)->countAllResults();
        $liveMoves = (int) $this->inv->table('inv_stock_movements')->where('cmp_id', $cmpId)->where("(created_by IS NULL OR created_by NOT LIKE 'migration:%')", null, false)->countAllResults();
        if ($liveDocs > 0 || $liveMoves > 0) {
            throw new \RuntimeException(sprintf('Company %d already has live Inventory data (%d documents, %d movements not written by a migration run); refusing to migrate over it.', $cmpId, $liveDocs, $liveMoves));
        }
    }

    private function removeCompany(int $cmpId): void
    {
        foreach (['inv_stock_movements', 'inv_stock_status_movements', 'inv_stock_balances', 'inv_pending_settlements', 'inv_pending_quantities', 'inv_packing_meta', 'inv_document_snapshots', 'inv_cost_layer_consumptions', 'inv_cost_layers', 'inv_wac_state', 'inv_document_line_serials', 'inv_document_lines', 'inv_documents', 'inv_item_openings', 'inv_fy_carryforward_status', 'inv_bom_lines', 'inv_bom_headers', 'inv_item_uoms', 'inv_items', 'inv_warehouses', 'inv_warehouse_groups', 'inv_uom', 'inv_stock_categories', 'inv_item_groups', 'inv_legacy_id_map'] as $t) {
            $this->inv->table($t)->where('cmp_id', $cmpId)->delete();
        }
        $this->log->event('company_replaced', ['cmp_id' => $cmpId], 'warning');
    }

    /** @return array<int, true> */
    private function existingLegacyIds(int $cmpId, string $legacyTable, string $targetTable): array
    {
        $rows = $this->inv->table('inv_legacy_id_map')->select('legacy_id')->where('cmp_id', $cmpId)->where('legacy_table', $legacyTable)->where('target_table', $targetTable)->get()->getResultArray();
        $out = [];
        foreach ($rows as $r) {
            $out[(int) $r['legacy_id']] = true;
        }

        return $out;
    }

    private function mapStatus(string $status, mixed $deletedAt): string
    {
        if ($deletedAt !== null && $deletedAt !== '') {
            return 'CANCELLED';
        }

        return match (strtolower($status)) {
            'posted' => 'POSTED',
            'cancelled' => 'CANCELLED',
            'draft' => 'DRAFT',
            default => 'POSTED',
        };
    }

    private function mapPackingStatus(string $s): string
    {
        return match ($s) {
            'open' => 'open', 'locked' => 'locked', 'invoiced', 'consumed' => 'consumed', 'unpacked' => 'unpacked', default => 'open',
        };
    }

    private function legacyTypeCode(int $vchType): string
    {
        static $codes = [2 => 'credit_note', 3 => 'debit_note', 4 => 'consignment_packing', 5 => 'journal', 6 => 'job_work_in', 7 => 'job_work_out', 10 => 'physical_stock', 11 => 'purchase', 14 => 'production', 15 => 'stock_transfer', 18 => 'sales', 20 => 'stock_journal', 23 => 'delivery_challan', 24 => 'inward_challan'];

        return $codes[$vchType] ?? ('type_' . $vchType);
    }

    /** RFC 4122 v5 UUID in the AICOUNTLY namespace — the same input always yields the same id. */
    public static function deterministicUuid(string $name): string
    {
        $ns = hex2bin('6ba7b8119dad11d180b400c04fd430c8'); // DNS namespace as base, name is prefixed with 'aicountly:'
        $hash = sha1($ns . 'aicountly:' . $name);
        $h = substr($hash, 0, 32);
        $h[12] = '5';
        $h[16] = dechex((hexdec($h[16]) & 0x3) | 0x8);

        return sprintf('%s-%s-%s-%s-%s', substr($h, 0, 8), substr($h, 8, 4), substr($h, 12, 4), substr($h, 16, 4), substr($h, 20, 12));
    }
}
