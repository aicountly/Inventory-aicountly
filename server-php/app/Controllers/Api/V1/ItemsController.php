<?php

namespace App\Controllers\Api\V1;

use App\Controllers\Api\BaseController;
use App\Exceptions\InventoryException;
use App\Services\AuditService;
use App\Services\InventorySettingsService;
use App\Services\MasterMirrorService;
use App\Services\OpeningStockResolver;
use App\Services\StockBalanceService;
use App\Services\UnitConversionService;
use App\Services\ValuationEngine;
use App\Services\ValuationReplayService;

/**
 * /api/v1/items — the item master. Alternate units and openings ride along on the same resource.
 *
 * Books-owned references (sales/purchase ledger, tax category) are stored as opaque ids
 * (books_sales_acc_id, books_purchase_acc_id, books_tax_cat_id) so the item screen stays whole.
 */
class ItemsController extends BaseController
{
    private const COLUMNS = ['item_name', 'item_alias', 'print_name', 'item_type', 'item_sku', 'item_upc', 'hsn_sac', 'mrp', 'unit_id', 'purchase_unit_id', 'sales_unit_id', 'stock_cat_id', 'item_grp_id', 'brand_id', 'parent_item_id', 'valuation_method', 'books_sales_acc_id', 'books_purchase_acc_id', 'books_tax_cat_id', 'track_batch', 'track_serial', 'track_expiry', 'shelf_life_days', 'negative_stock_policy', 'min_stock_qty', 'max_stock_qty', 'reorder_point_qty', 'reorder_qty', 'safety_stock_qty', 'lead_time_days', 'default_warehouse_id', 'standard_cost'];
    private const LIST_COLUMNS = 'i.item_id, i.item_uuid, i.item_name, i.item_alias, i.print_name, i.item_type, i.item_sku, i.item_upc, i.hsn_sac, i.mrp, i.unit_id, i.stock_cat_id, i.item_grp_id, i.brand_id, i.valuation_method, i.books_sales_acc_id, i.books_purchase_acc_id, i.books_tax_cat_id, i.track_batch, i.track_serial, i.track_expiry, i.is_active, i.updated_at, i.created_at, u.unit_symbol, u.unit_name, g.grp_name, c.cat_name, b.brand_name';

    public function formOptions()
    {
        $a = $this->authorize('masters.items.read', true, false);
        if (isset($a['response'])) {
            return $a['response'];
        }
        $cmpId = (int) $a['ctx']['cmp_id'];
        $db = \Config\Database::connect();
        // A group, category or unit deactivated after items were already assigned to it must
        // stay selectable as a filter, or those items become unreachable in the master list.
        $includeInactive = (int) ($this->request->getGet('include_inactive') ?? 0) === 1;
        $live = static function ($t) use ($db, $cmpId, $includeInactive) {
            $b = $db->table($t)->where('cmp_id', $cmpId)->where('deleted_at', null);
            if (!$includeInactive) {
                $b->where('is_active', 1);
            }

            return $b;
        };

        return $this->respond(['data' => [
            'item_groups'      => $live('inv_item_groups')->select('item_grp_id, grp_name, grp_alias, is_primary, parent_grp_id')->orderBy('grp_name')->get()->getResultArray(),
            'stock_categories' => $live('inv_stock_categories')->select('stock_cat_id, cat_name, cat_alias')->orderBy('cat_name')->get()->getResultArray(),
            'brands'           => $live('inv_brands')->select('brand_id, brand_name')->orderBy('brand_name')->get()->getResultArray(),
            'units'            => $live('inv_uom')->select('unit_id, unit_name, unit_symbol, print_name, uqc_gst')->orderBy('unit_name')->get()->getResultArray(),
            'warehouses'       => $live('inv_warehouses')->select('warehouse_id, warehouse_name, warehouse_code, warehouse_type, is_default, bo_id')->orderBy('warehouse_name')->get()->getResultArray(),
            'valuation_methods' => InventorySettingsService::METHODS,
            'default_valuation_method' => (new InventorySettingsService())->defaultValuationMethod($cmpId),
            'negative_stock_policies' => InventorySettingsService::NEGATIVE_POLICIES,
        ]]);
    }

    public function index()
    {
        $a = $this->authorize('masters.items.read', true, false);
        if (isset($a['response'])) {
            return $a['response'];
        }
        $cmpId = (int) $a['ctx']['cmp_id'];
        $p = $this->listParams(50, 500, 'item_name');
        $b = $this->baseQuery($cmpId);
        $status = strtolower((string) ($this->request->getGet('status') ?? ''));
        if ($status === 'active' || (int) ($this->request->getGet('active_only') ?? 0) === 1) {
            $b->where('i.is_active', 1);
        } elseif ($status === 'inactive') {
            $b->where('i.is_active', 0);
        }
        foreach (['item_grp_id', 'stock_cat_id', 'brand_id', 'unit_id'] as $f) {
            if ($v = (int) $this->request->getGet($f)) {
                $b->where('i.' . $f, $v);
            }
        }
        // The tax category belongs to Books and is held here as an opaque id, so the column is
        // books_tax_cat_id while Books' own item-master filter sends it as tax_cat_id.
        if ($taxCat = (int) ($this->request->getGet('books_tax_cat_id') ?? $this->request->getGet('tax_cat_id'))) {
            $b->where('i.books_tax_cat_id', $taxCat);
        }
        if ($t = $this->request->getGet('item_type')) {
            $b->where('i.item_type', $t);
        }
        $q = trim((string) ($this->request->getGet('q') ?? ''));
        if ($q !== '') {
            $this->applySearch($b, $q, (string) ($this->request->getGet('q_mode') ?? 'contains'));
        }
        $total = (clone $b)->countAllResults(false);
        $sortMap = ['item_name' => 'i.item_name', 'item_sku' => 'i.item_sku', 'updated_at' => 'i.updated_at', 'created_at' => 'i.created_at', 'grp_name' => 'g.grp_name', 'item_id' => 'i.item_id', 'mrp' => 'i.mrp'];
        $rows = $b->select(self::LIST_COLUMNS)->orderBy($sortMap[$p['sort']] ?? 'i.item_name', $p['order'])->limit($p['limit'], $p['offset'])->get()->getResultArray();
        if ((int) ($this->request->getGet('with_stock') ?? 0) === 1 && $rows !== []) {
            $this->attachStock($cmpId, $rows, (int) $this->request->getGet('warehouse_id') ?: null);
        }
        // Books' quantity conversion needs every item's alternate units in one pass; without this
        // it would have to call bulk-lookup for the whole catalogue a second time.
        if ((int) ($this->request->getGet('with_units') ?? 0) === 1 && $rows !== []) {
            $units = $this->unitsForItems($cmpId, array_map(static fn ($r) => (int) $r['item_id'], $rows));
            foreach ($rows as &$r) {
                $r['units'] = $units[(int) $r['item_id']] ?? [];
            }
            unset($r);
        }

        return $this->respondList($rows, $total, $p['limit'], $p['offset']);
    }

    /** Typeahead: name / alias / sku / barcode prefix search, small payload, availability optional. */
    public function search()
    {
        $a = $this->authorize('masters.items.read', true, false);
        if (isset($a['response'])) {
            return $a['response'];
        }
        $cmpId = (int) $a['ctx']['cmp_id'];
        $q = trim((string) ($this->request->getGet('q') ?? ''));
        $limit = max(1, min(50, (int) ($this->request->getGet('limit') ?? 20)));
        $b = $this->baseQuery($cmpId)->where('i.is_active', 1);
        if ($q !== '') {
            $this->applySearch($b, $q, (string) ($this->request->getGet('q_mode') ?? 'prefix'));
        }
        $rows = $b->select('i.item_id, i.item_name, i.item_alias, i.print_name, i.item_sku, i.item_upc, i.hsn_sac, i.mrp, i.unit_id, u.unit_symbol, i.books_tax_cat_id, i.books_sales_acc_id, i.books_purchase_acc_id, i.track_batch, i.track_serial, i.valuation_method, i.default_warehouse_id')
            ->orderBy('i.item_name')->limit($limit)->get()->getResultArray();
        if ((int) ($this->request->getGet('with_stock') ?? 0) === 1 && $rows !== []) {
            $this->attachStock($cmpId, $rows, (int) $this->request->getGet('warehouse_id') ?: null);
        }
        $units = $this->unitsForItems($cmpId, array_map(static fn ($r) => (int) $r['item_id'], $rows));
        foreach ($rows as &$r) {
            $r['units'] = $units[(int) $r['item_id']] ?? [];
        }

        return $this->respond(['data' => $rows]);
    }

    public function byBarcode($code = null)
    {
        $a = $this->authorize('masters.items.read', true, false);
        if (isset($a['response'])) {
            return $a['response'];
        }
        $cmpId = (int) $a['ctx']['cmp_id'];
        $code = trim((string) rawurldecode((string) $code));
        $row = $this->baseQuery($cmpId)->where('i.is_active', 1)->groupStart()->where('i.item_upc', $code)->orWhere('i.item_sku', $code)->groupEnd()->select(self::LIST_COLUMNS)->get()->getRowArray();
        if (!$row) {
            return $this->failStructured(404, 'not_found', 'No item with that barcode / SKU');
        }
        $this->attachStock($cmpId, $rows = [$row], (int) $this->request->getGet('warehouse_id') ?: null);

        return $this->respond(['data' => $rows[0]]);
    }

    /** POST {item_ids:[...]} — Books uses this to label historical voucher lines without N+1 calls. */
    public function bulkLookup()
    {
        $a = $this->authorize('masters.items.read', true, false);
        if (isset($a['response'])) {
            return $a['response'];
        }
        $cmpId = (int) $a['ctx']['cmp_id'];
        $body = $this->request->getJSON(true) ?? [];
        $ids = array_values(array_unique(array_filter(array_map('intval', (array) ($body['item_ids'] ?? [])), static fn ($i) => $i > 0)));
        if ($ids === []) {
            return $this->respond(['data' => []]);
        }
        $out = [];
        $db = \Config\Database::connect();
        foreach (array_chunk($ids, 500) as $chunk) {
            $rows = $db->table('inv_items i')->select('i.item_id, i.item_uuid, i.item_name, i.item_alias, i.print_name, i.item_sku, i.item_upc, i.hsn_sac, i.unit_id, u.unit_symbol, u.uqc_gst, i.books_tax_cat_id, i.books_sales_acc_id, i.books_purchase_acc_id, i.valuation_method, i.track_batch, i.track_serial, i.default_warehouse_id, i.is_active, i.deleted_at')
                ->join('inv_uom u', 'u.unit_id = i.unit_id', 'left')->where('i.cmp_id', $cmpId)->whereIn('i.item_id', $chunk)->get()->getResultArray();
            foreach ($rows as $r) {
                $out[] = $r;
            }
        }
        $units = $this->unitsForItems($cmpId, $ids);
        foreach ($out as &$r) {
            $r['units'] = $units[(int) $r['item_id']] ?? [];
        }

        return $this->respond(['data' => $out]);
    }

    public function show($id = null)
    {
        $a = $this->authorize('masters.items.read', true, false);
        if (isset($a['response'])) {
            return $a['response'];
        }
        $cmpId = (int) $a['ctx']['cmp_id'];
        $row = $this->baseQuery($cmpId)->where('i.item_id', (int) $id)->select('i.*, u.unit_symbol, u.unit_name, g.grp_name, c.cat_name, b.brand_name')->get()->getRowArray();
        if (!$row) {
            return $this->failStructured(404, 'not_found', 'Item not found');
        }

        return $this->respond(['data' => $this->present($cmpId, $row, (int) $a['ctx']['fy_id'])]);
    }

    public function create()
    {
        $a = $this->authorize('masters.items.write', true, false);
        if (isset($a['response'])) {
            return $a['response'];
        }
        $cmpId = (int) $a['ctx']['cmp_id'];
        $body = $this->request->getJSON(true) ?? [];
        $db = \Config\Database::connect();
        try {
            $row = $this->buildRow($cmpId, $body, null);
            $lines = $this->normalizeUnitLines($cmpId, $body, (int) $row['unit_id']);
            $now = date('Y-m-d H:i:s');
            $db->transStart();
            $row += ['cmp_id' => $cmpId, 'bo_id' => 0, 'is_active' => isset($body['is_active']) ? (!empty($body['is_active']) ? 1 : 0) : 1, 'created_by' => $a['session']['uuid'], 'created_at' => $now, 'updated_by' => $a['session']['uuid'], 'updated_at' => $now];
            $db->table('inv_items')->insert($row);
            $itemId = (int) $db->insertID();
            $this->saveUnitLines($db, $cmpId, $itemId, $lines);
            $this->saveOpeningsFromBody($db, $cmpId, $itemId, $body, (int) $a['ctx']['fy_id'], $a['session']['uuid']);
            (new MasterMirrorService())->publishItem($cmpId, $itemId);
            $db->transComplete();
            (new AuditService())->log($cmpId, 'item', $itemId, 'item.create', $a['session']['uuid'], [], null, $row);

            return $this->respondCreated(['data' => $this->present($cmpId, $this->baseQuery($cmpId)->where('i.item_id', $itemId)->select('i.*, u.unit_symbol, u.unit_name, g.grp_name, c.cat_name, b.brand_name')->get()->getRowArray(), (int) $a['ctx']['fy_id'])]);
        } catch (\Throwable $e) {
            $db->transRollback();

            return $this->failFromException($e);
        }
    }

    public function update($id = null)
    {
        $a = $this->authorize('masters.items.write', true, false);
        if (isset($a['response'])) {
            return $a['response'];
        }
        $cmpId = (int) $a['ctx']['cmp_id'];
        $db = \Config\Database::connect();
        $existing = $db->table('inv_items')->where('cmp_id', $cmpId)->where('item_id', (int) $id)->where('deleted_at', null)->get()->getRowArray();
        if (!$existing) {
            return $this->failStructured(404, 'not_found', 'Item not found');
        }
        $body = $this->request->getJSON(true) ?? [];
        try {
            $row = $this->buildRow($cmpId, array_merge($existing, $body), $existing);
            $methodChanged = strtoupper((string) $existing['valuation_method']) !== $row['valuation_method'];
            if ($methodChanged) {
                $moved = $db->table('inv_stock_movements')->where('cmp_id', $cmpId)->where('item_id', (int) $id)->countAllResults();
                if ($moved > 0 && empty($body['valuation_method_recost'])) {
                    throw InventoryException::validation('Changing the valuation method of an item with posted movements re-costs its history. Confirm with valuation_method_recost=true.', ['movements' => $moved, 'requires' => 'valuation_method_recost']);
                }
            }
            $lines = array_key_exists('unit_lines', $body) || array_key_exists('units', $body) ? $this->normalizeUnitLines($cmpId, $body, (int) $row['unit_id']) : null;
            if (array_key_exists('is_active', $body)) {
                $row['is_active'] = !empty($body['is_active']) ? 1 : 0;
            }
            $row['updated_by'] = $a['session']['uuid'];
            $row['updated_at'] = date('Y-m-d H:i:s');
            $row['version'] = (int) $existing['version'] + 1;
            $db->transStart();
            $db->table('inv_items')->where('item_id', (int) $id)->where('cmp_id', $cmpId)->update($row);
            if ($lines !== null) {
                $this->saveUnitLines($db, $cmpId, (int) $id, $lines);
            }
            $this->saveOpeningsFromBody($db, $cmpId, (int) $id, $body, (int) $a['ctx']['fy_id'], $a['session']['uuid']);
            (new MasterMirrorService())->publishItem($cmpId, (int) $id);
            $db->transComplete();
            (new AuditService())->log($cmpId, 'item', (int) $id, 'item.update', $a['session']['uuid'], [], $existing, $row);
            if ($methodChanged && !empty($body['valuation_method_recost'])) {
                (new \App\Services\RecalculationService())->enqueue($cmpId, (int) $a['ctx']['fy_id'], (int) $id, '0001-01-01', 'method_change', null, $a['session']['uuid']);
            }

            return $this->respond(['data' => $this->present($cmpId, $this->baseQuery($cmpId)->where('i.item_id', (int) $id)->select('i.*, u.unit_symbol, u.unit_name, g.grp_name, c.cat_name, b.brand_name')->get()->getRowArray(), (int) $a['ctx']['fy_id'])]);
        } catch (\Throwable $e) {
            $db->transRollback();

            return $this->failFromException($e);
        }
    }

    public function delete($id = null)
    {
        $a = $this->authorize('masters.items.delete', true, false);
        if (isset($a['response'])) {
            return $a['response'];
        }
        $cmpId = (int) $a['ctx']['cmp_id'];
        $r = $this->tryDelete($cmpId, (int) $id, $a['session']['uuid']);

        return $r['ok'] ? $this->respondDeleted(['data' => ['item_id' => (int) $id]]) : $this->failStructured(409, 'delete_blocked', $r['message'], $r);
    }

    public function bulkDelete()
    {
        $a = $this->authorize('masters.items.delete', true, false);
        if (isset($a['response'])) {
            return $a['response'];
        }
        $cmpId = (int) $a['ctx']['cmp_id'];
        $ids = array_filter(array_map('intval', (array) (($this->request->getJSON(true) ?? [])['item_ids'] ?? [])));
        $deleted = [];
        $skipped = [];
        foreach ($ids as $id) {
            $r = $this->tryDelete($cmpId, $id, $a['session']['uuid']);
            $r['ok'] ? $deleted[] = $id : $skipped[] = ['item_id' => $id, 'message' => $r['message']];
        }

        return $this->respond(['data' => ['deleted' => $deleted, 'skipped' => $skipped]]);
    }

    public function stock($id = null)
    {
        $a = $this->authorizeAny(['masters.items.read', 'reports.stock_summary.read']);
        if (isset($a['response'])) {
            return $a['response'];
        }
        $cmpId = (int) $a['ctx']['cmp_id'];
        $bal = new StockBalanceService();
        $rows = $bal->availability($cmpId, [(int) $id], null, (int) $this->request->getGet('by_batch') === 1);
        $costs = (new ValuationReplayService())->unitCostsForItems($cmpId, (int) $a['ctx']['fy_id'], [(int) $id], date('Y-m-d'));

        return $this->respond(['data' => ['item_id' => (int) $id, 'total' => $bal->balance($cmpId, (int) $id), 'by_warehouse' => $rows, 'unit_cost' => $costs[(int) $id]['unit_cost'] ?? null, 'valuation_method' => $costs[(int) $id]['method'] ?? null]]);
    }

    public function openings($id = null)
    {
        $a = $this->authorize('masters.items.read', true, false);
        if (isset($a['response'])) {
            return $a['response'];
        }
        $cmpId = (int) $a['ctx']['cmp_id'];
        $fyId = (int) $a['ctx']['fy_id'];
        $rows = \Config\Database::connect()->table('inv_item_openings o')->select('o.*, w.warehouse_name, u.unit_symbol')
            ->join('inv_warehouses w', 'w.warehouse_id = o.warehouse_id', 'left')->join('inv_uom u', 'u.unit_id = o.unit_id', 'left')
            ->where('o.cmp_id', $cmpId)->where('o.item_id', (int) $id)->orderBy('o.fy_id')->orderBy('o.opening_id')->get()->getResultArray();

        return $this->respond(['data' => ['rows' => $rows, 'effective_fy_id' => \App\Services\FyCarryForwardStatus::hasRunInto($cmpId, $fyId) ? $fyId : 0, 'carried_forward' => \App\Services\FyCarryForwardStatus::hasRunInto($cmpId, $fyId)]]);
    }

    /** PUT {fy_id?: 0|fy, rows: [{warehouse_id?, unit_id, batch_id?, opening_qty, opening_valuation_rate}]} */
    public function saveOpenings($id = null)
    {
        $a = $this->authorize('masters.items.write', true, false);
        if (isset($a['response'])) {
            return $a['response'];
        }
        $cmpId = (int) $a['ctx']['cmp_id'];
        $body = $this->request->getJSON(true) ?? [];
        $db = \Config\Database::connect();
        try {
            $db->transStart();
            $this->writeOpenings($db, $cmpId, (int) $id, (int) ($body['fy_id'] ?? 0), (array) ($body['rows'] ?? []), $a['session']['uuid']);
            $db->transComplete();
        } catch (\Throwable $e) {
            $db->transRollback();

            return $this->failFromException($e);
        }

        return $this->openings($id);
    }

    // ------------------------------------------------------------------ helpers

    private function baseQuery(int $cmpId)
    {
        return \Config\Database::connect()->table('inv_items i')
            ->join('inv_uom u', 'u.unit_id = i.unit_id', 'left')
            ->join('inv_item_groups g', 'g.item_grp_id = i.item_grp_id', 'left')
            ->join('inv_stock_categories c', 'c.stock_cat_id = i.stock_cat_id', 'left')
            ->join('inv_brands b', 'b.brand_id = i.brand_id', 'left')
            ->where('i.cmp_id', $cmpId)->where('i.deleted_at', null);
    }

    private function applySearch($b, string $q, string $mode): void
    {
        $side = $mode === 'prefix' ? 'after' : 'both';
        $b->groupStart()->like('LOWER(i.item_name)', mb_strtolower($q), $side, null, true)
            ->orLike('LOWER(i.item_alias)', mb_strtolower($q), $side, null, true)
            ->orLike('LOWER(i.item_sku)', mb_strtolower($q), $side, null, true)
            ->orWhere('i.item_upc', $q)
            ->groupEnd();
    }

    private function attachStock(int $cmpId, array &$rows, ?int $warehouseId): void
    {
        $ids = array_map(static fn ($r) => (int) $r['item_id'], $rows);
        $av = (new StockBalanceService())->availability($cmpId, $ids, $warehouseId);
        $by = [];
        foreach ($av as $r) {
            $by[$r['item_id']] ??= ['on_hand' => 0.0, 'available' => 0.0, 'reserved' => 0.0];
            $by[$r['item_id']]['on_hand'] += $r['on_hand'];
            $by[$r['item_id']]['available'] += $r['available'];
            $by[$r['item_id']]['reserved'] += $r['reserved'];
        }
        foreach ($rows as &$r) {
            $r['stock'] = $by[(int) $r['item_id']] ?? ['on_hand' => 0.0, 'available' => 0.0, 'reserved' => 0.0];
        }
    }

    /** @return array<int, list<array<string,mixed>>> */
    private function unitsForItems(int $cmpId, array $itemIds): array
    {
        if ($itemIds === []) {
            return [];
        }
        $out = [];
        foreach (array_chunk($itemIds, 500) as $chunk) {
            $rows = \Config\Database::connect()->table('inv_item_uoms l')->select('l.item_id, l.unit_id, l.is_default, l.conversion_factor, l.uom_role, u.unit_symbol, u.unit_name')
                ->join('inv_uom u', 'u.unit_id = l.unit_id', 'left')->where('l.cmp_id', $cmpId)->whereIn('l.item_id', $chunk)->orderBy('l.is_default', 'DESC')->orderBy('l.item_unit_line_id')->get()->getResultArray();
            foreach ($rows as $r) {
                $out[(int) $r['item_id']][] = ['unit_id' => (int) $r['unit_id'], 'is_default' => (int) $r['is_default'], 'conversion_factor' => (float) $r['conversion_factor'], 'uom_role' => $r['uom_role'], 'unit_symbol' => $r['unit_symbol'], 'unit_name' => $r['unit_name']];
            }
        }

        return $out;
    }

    private function present(int $cmpId, array $row, int $fyId): array
    {
        $row['attributes'] = json_decode((string) ($row['attributes_json'] ?? ''), true);
        $row['variant_attributes'] = json_decode((string) ($row['variant_attributes_json'] ?? ''), true);
        unset($row['attributes_json'], $row['variant_attributes_json']);
        $row['unit_lines'] = $this->unitsForItems($cmpId, [(int) $row['item_id']])[(int) $row['item_id']] ?? [];
        $row['openings'] = \Config\Database::connect()->table('inv_item_openings')->where('cmp_id', $cmpId)->where('item_id', (int) $row['item_id'])->orderBy('fy_id')->orderBy('opening_id')->get()->getResultArray();
        $row['stock'] = (new StockBalanceService())->balance($cmpId, (int) $row['item_id']);

        return $row;
    }

    /** @return array<string, mixed> */
    private function buildRow(int $cmpId, array $body, ?array $existing): array
    {
        $row = [];
        foreach (self::COLUMNS as $col) {
            if (array_key_exists($col, $body)) {
                $v = $body[$col];
                $row[$col] = is_string($v) ? trim($v) : $v;
                if ($row[$col] === '') {
                    $row[$col] = null;
                }
            }
        }
        // Books legacy field names
        foreach (['sales_acc_id' => 'books_sales_acc_id', 'purchase_acc_id' => 'books_purchase_acc_id', 'tax_cat_id' => 'books_tax_cat_id'] as $legacy => $new) {
            if (array_key_exists($legacy, $body) && !array_key_exists($new, $body)) {
                $row[$new] = $body[$legacy] !== '' ? $body[$legacy] : null;
            }
        }
        $name = trim((string) ($row['item_name'] ?? ''));
        if ($name === '') {
            throw InventoryException::validation('item_name is required', ['field' => 'item_name']);
        }
        $row['item_name'] = $name;
        $row['print_name'] = $row['print_name'] ?? $name;
        $row['item_type'] = in_array($row['item_type'] ?? 'stock', ['stock', 'service', 'non_stock'], true) ? ($row['item_type'] ?? 'stock') : 'stock';
        $row['valuation_method'] = InventorySettingsService::normalizeMethod($row['valuation_method'] ?? '', (new InventorySettingsService())->defaultValuationMethod($cmpId));
        foreach (['track_batch', 'track_serial', 'track_expiry'] as $flag) {
            $row[$flag] = !empty($row[$flag]) ? 1 : 0;
        }
        if (isset($row['negative_stock_policy']) && !in_array($row['negative_stock_policy'], InventorySettingsService::NEGATIVE_POLICIES, true)) {
            $row['negative_stock_policy'] = null;
        }
        if (!empty($row['hsn_sac']) && !preg_match('/^[0-9A-Z]{4,8}$/', (string) $row['hsn_sac'])) {
            throw InventoryException::validation('HSN/SAC must be 4 to 8 alphanumeric characters', ['field' => 'hsn_sac']);
        }
        foreach (['unit_id', 'purchase_unit_id', 'sales_unit_id', 'stock_cat_id', 'item_grp_id', 'brand_id', 'parent_item_id', 'books_sales_acc_id', 'books_purchase_acc_id', 'books_tax_cat_id', 'default_warehouse_id', 'shelf_life_days', 'lead_time_days'] as $intCol) {
            if (array_key_exists($intCol, $row)) {
                $row[$intCol] = $row[$intCol] !== null && (int) $row[$intCol] > 0 ? (int) $row[$intCol] : null;
            }
        }
        $unitId = (int) ($row['unit_id'] ?? 0);
        $lines = $body['unit_lines'] ?? $body['units'] ?? null;
        if ($unitId <= 0 && is_array($lines)) {
            foreach ($lines as $l) {
                if (!empty($l['is_default'])) {
                    $unitId = (int) ($l['unit_id'] ?? 0);
                }
            }
            if ($unitId <= 0 && isset($lines[0]['unit_id'])) {
                $unitId = (int) $lines[0]['unit_id'];
            }
        }
        if ($unitId <= 0) {
            throw InventoryException::validation('A base unit (unit_id) is required', ['field' => 'unit_id']);
        }
        $db = \Config\Database::connect();
        if ($db->table('inv_uom')->where('cmp_id', $cmpId)->where('unit_id', $unitId)->where('deleted_at', null)->countAllResults() === 0) {
            throw InventoryException::validation('Unit #' . $unitId . ' not found in this company', ['field' => 'unit_id']);
        }
        $row['unit_id'] = $unitId;
        foreach (['item_grp_id' => 'inv_item_groups', 'stock_cat_id' => 'inv_stock_categories', 'brand_id' => 'inv_brands', 'default_warehouse_id' => 'inv_warehouses'] as $col => $table) {
            if (!empty($row[$col]) && $db->table($table)->where('cmp_id', $cmpId)->where(str_replace(['inv_item_groups', 'inv_stock_categories', 'inv_brands', 'inv_warehouses'], ['item_grp_id', 'stock_cat_id', 'brand_id', 'warehouse_id'], $table), (int) $row[$col])->where('deleted_at', null)->countAllResults() === 0) {
                throw InventoryException::validation(ucfirst(str_replace('_', ' ', $col)) . ' #' . $row[$col] . ' not found', ['field' => $col]);
            }
        }
        $dup = $db->table('inv_items')->where('cmp_id', $cmpId)->where('LOWER(item_name)', mb_strtolower($name))->where('deleted_at', null);
        if ($existing) {
            $dup->where('item_id !=', (int) $existing['item_id']);
        }
        if ($dup->countAllResults() > 0) {
            throw InventoryException::conflict('Item "' . $name . '" already exists', ['field' => 'item_name']);
        }
        if (!empty($row['item_sku'])) {
            $dupSku = $db->table('inv_items')->where('cmp_id', $cmpId)->where('item_sku', $row['item_sku'])->where('deleted_at', null);
            if ($existing) {
                $dupSku->where('item_id !=', (int) $existing['item_id']);
            }
            if ($dupSku->countAllResults() > 0) {
                throw InventoryException::conflict('SKU "' . $row['item_sku'] . '" already exists', ['field' => 'item_sku']);
            }
        }
        if (isset($body['attributes']) && is_array($body['attributes'])) {
            $row['attributes_json'] = json_encode($body['attributes']);
        }
        if (isset($body['variant_attributes']) && is_array($body['variant_attributes'])) {
            $row['variant_attributes_json'] = json_encode($body['variant_attributes']);
        }

        return $row;
    }

    /** @return list<array{unit_id:int, is_default:int, conversion_factor:float, uom_role:?string}> */
    private function normalizeUnitLines(int $cmpId, array $body, int $baseUnitId): array
    {
        $raw = $body['unit_lines'] ?? $body['units'] ?? [];
        $out = [];
        $seen = [];
        $hasDefault = false;
        foreach ((array) $raw as $l) {
            $unitId = (int) ($l['unit_id'] ?? 0);
            if ($unitId <= 0 || isset($seen[$unitId])) {
                continue;
            }
            $isDefault = $unitId === $baseUnitId;
            $factor = $isDefault ? 1.0 : UnitConversionService::normaliseFactor((float) ($l['conversion_factor'] ?? 1));
            $out[] = ['unit_id' => $unitId, 'is_default' => $isDefault ? 1 : 0, 'conversion_factor' => $factor, 'uom_role' => $l['uom_role'] ?? ($isDefault ? 'base' : null)];
            $seen[$unitId] = true;
            $hasDefault = $hasDefault || $isDefault;
        }
        if (!$hasDefault) {
            array_unshift($out, ['unit_id' => $baseUnitId, 'is_default' => 1, 'conversion_factor' => 1.0, 'uom_role' => 'base']);
        }

        return $out;
    }

    private function saveUnitLines($db, int $cmpId, int $itemId, array $lines): void
    {
        $existing = [];
        foreach ($db->table('inv_item_uoms')->where('cmp_id', $cmpId)->where('item_id', $itemId)->get()->getResultArray() as $r) {
            $existing[(int) $r['unit_id']] = $r;
        }
        $keep = [];
        foreach ($lines as $l) {
            $keep[$l['unit_id']] = true;
            $row = ['is_default' => $l['is_default'], 'conversion_factor' => $l['conversion_factor'], 'uom_role' => $l['uom_role'], 'updated_at' => date('Y-m-d H:i:s')];
            if (isset($existing[$l['unit_id']])) {
                $db->table('inv_item_uoms')->where('item_unit_line_id', (int) $existing[$l['unit_id']]['item_unit_line_id'])->update($row);
            } else {
                $db->table('inv_item_uoms')->insert(array_merge(['cmp_id' => $cmpId, 'item_id' => $itemId, 'unit_id' => $l['unit_id'], 'created_at' => date('Y-m-d H:i:s')], $row));
            }
        }
        foreach ($existing as $unitId => $r) {
            if (!isset($keep[$unitId])) {
                $used = $db->table('inv_document_lines')->where('cmp_id', $cmpId)->where('item_id', $itemId)->where('unit_id', $unitId)->countAllResults();
                if ($used > 0) {
                    throw InventoryException::validation('Unit #' . $unitId . ' is used on ' . $used . ' document line(s) and cannot be removed from the item');
                }
                $db->table('inv_item_uoms')->where('item_unit_line_id', (int) $r['item_unit_line_id'])->delete();
            }
        }
    }

    private function saveOpeningsFromBody($db, int $cmpId, int $itemId, array $body, int $fyId, ?string $actor): void
    {
        if (!array_key_exists('openings', $body)) {
            return;
        }
        $rows = (array) $body['openings'];
        $targetFy = (int) ($body['openings_fy_id'] ?? 0);
        $this->writeOpenings($db, $cmpId, $itemId, $targetFy, $rows, $actor);
    }

    private function writeOpenings($db, int $cmpId, int $itemId, int $fyId, array $rows, ?string $actor): void
    {
        if ($fyId > 0 && \App\Services\FyCarryForwardStatus::hasRunInto($cmpId, $fyId) === false) {
            throw InventoryException::validation('Opening stock for a year the close has not run into is the inception opening; save it with fy_id 0');
        }
        $consumed = $db->table('inv_stock_movements')->where('cmp_id', $cmpId)->where('item_id', $itemId)->where('qty <', 0)->countAllResults();
        $db->table('inv_item_openings')->where('cmp_id', $cmpId)->where('item_id', $itemId)->where('fy_id', $fyId)->delete();
        $now = date('Y-m-d H:i:s');
        foreach ($rows as $r) {
            $qty = (float) ($r['opening_qty'] ?? 0);
            $rate = (float) ($r['opening_valuation_rate'] ?? $r['opening_rate'] ?? 0);
            $unitId = (int) ($r['unit_id'] ?? 0);
            if ($qty == 0.0 || $unitId <= 0) {
                continue;
            }
            $db->table('inv_item_openings')->insert([
                'cmp_id' => $cmpId, 'fy_id' => $fyId, 'item_id' => $itemId, 'unit_id' => $unitId,
                'warehouse_id' => !empty($r['warehouse_id']) ? (int) $r['warehouse_id'] : null, 'batch_id' => !empty($r['batch_id']) ? (int) $r['batch_id'] : null,
                'opening_qty' => round($qty, 4), 'opening_valuation_rate' => round($rate, 4), 'opening_value' => round($qty * $rate, 4),
                'source_kind' => $fyId > 0 ? 'carry_forward' : 'master_inception', 'created_by' => $actor, 'created_at' => $now, 'updated_by' => $actor, 'updated_at' => $now,
            ]);
        }
        \App\Services\FyCarryForwardStatus::flush();
        $engine = new ValuationEngine();
        $engine->seedOpeningStock($cmpId, $fyId, $itemId);
        if ($consumed > 0) {
            (new \App\Services\RecalculationService($engine))->enqueue($cmpId, $fyId ?: null, $itemId, '0001-01-01', 'manual', null, $actor);
        }
        (new StockBalanceService())->rebuildOnHand($cmpId, $fyId > 0 ? $fyId : null);
    }

    /** @return array{ok:bool, message?:string} */
    private function tryDelete(int $cmpId, int $itemId, ?string $actor): array
    {
        $db = \Config\Database::connect();
        $item = $db->table('inv_items')->where('cmp_id', $cmpId)->where('item_id', $itemId)->where('deleted_at', null)->get()->getRowArray();
        if (!$item) {
            return ['ok' => false, 'message' => 'Item not found'];
        }
        $lines = $db->table('inv_document_lines')->where('cmp_id', $cmpId)->where('item_id', $itemId)->countAllResults();
        if ($lines > 0) {
            return ['ok' => false, 'message' => 'Item is used on ' . $lines . ' document line(s); deactivate it instead', 'count' => $lines];
        }
        $bom = $db->table('inv_bom_lines')->where('cmp_id', $cmpId)->where('item_id', $itemId)->countAllResults() + $db->table('inv_bom_headers')->where('cmp_id', $cmpId)->where('finished_item_id', $itemId)->where('deleted_at', null)->countAllResults();
        if ($bom > 0) {
            return ['ok' => false, 'message' => 'Item is used in ' . $bom . ' bill(s) of materials', 'count' => $bom];
        }
        $db->transStart();
        $db->table('inv_items')->where('item_id', $itemId)->update(['deleted_at' => date('Y-m-d H:i:s'), 'deleted_by' => $actor, 'is_active' => 0, 'updated_at' => date('Y-m-d H:i:s')]);
        (new MasterMirrorService())->publishItem($cmpId, $itemId);
        $db->transComplete();
        if ($db->transStatus() === false) {
            return ['ok' => false, 'message' => 'Item could not be deleted: transaction failed'];
        }
        (new AuditService())->log($cmpId, 'item', $itemId, 'item.delete', $actor, [], $item, null);

        return ['ok' => true];
    }
}
