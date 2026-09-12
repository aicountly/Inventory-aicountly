<?php

namespace App\Services;

/**
 * Books keeps a read-only mirror of item / unit / warehouse names for prints and registers.
 * Inventory is the writer: every create, update or (soft) delete of those masters enqueues an
 * upsert event carrying the full row — a deleted row is an upsert with deleted_at set — and
 * `php spark inventory:resync-masters` replays every live row once for a first sync.
 */
class MasterMirrorService
{
    public const EVENT_ITEM = 'inventory.item.upserted';
    public const EVENT_UOM = 'inventory.uom.upserted';
    public const EVENT_WAREHOUSE = 'inventory.warehouse.upserted';

    private const ITEM_COLUMNS = 'item_id, item_uuid, cmp_id, item_name, item_alias, print_name, item_sku, item_upc, hsn_sac, mrp, unit_id, stock_cat_id, item_grp_id, books_sales_acc_id, books_purchase_acc_id, books_tax_cat_id, valuation_method, is_active, deleted_at, updated_at';
    private const UOM_COLUMNS = 'unit_id, unit_uuid, cmp_id, unit_name, unit_symbol, print_name, uqc_gst, is_active, deleted_at, updated_at';
    private const WAREHOUSE_COLUMNS = 'warehouse_id, warehouse_uuid, cmp_id, warehouse_name, warehouse_group_id, bo_id, is_active, deleted_at, updated_at';
    private const UOM_LINE_COLUMNS = 'item_unit_line_id, item_id, unit_id, is_default, conversion_factor, mc_qty_wise';

    public function __construct(protected ?OutboxService $outbox = null)
    {
        $this->outbox ??= new OutboxService();
    }

    /** Publish by master kind (item | uom | warehouse). Returns the event id, or null when the row is unknown. */
    public function publish(string $kind, int $cmpId, int $id): ?int
    {
        return match ($kind) {
            'item'      => $this->publishItem($cmpId, $id),
            'uom'       => $this->publishUom($cmpId, $id),
            'warehouse' => $this->publishWarehouse($cmpId, $id),
            default     => throw new \InvalidArgumentException('Unknown master kind ' . $kind),
        };
    }

    public function publishItem(int $cmpId, int $itemId): ?int
    {
        $db = \Config\Database::connect();
        $row = $db->table('inv_items')->select(self::ITEM_COLUMNS)->where('cmp_id', $cmpId)->where('item_id', $itemId)->get()->getRowArray();
        if (!$row) {
            return null;
        }
        $lines = $this->uomLines($cmpId, [$itemId])[$itemId] ?? [];

        return $this->outbox->enqueue($cmpId, self::EVENT_ITEM, 'item', $itemId, $row['item_uuid'] ?? null, self::itemPayload($row, $lines));
    }

    public function publishUom(int $cmpId, int $unitId): ?int
    {
        $row = \Config\Database::connect()->table('inv_uom')->select(self::UOM_COLUMNS)->where('cmp_id', $cmpId)->where('unit_id', $unitId)->get()->getRowArray();
        if (!$row) {
            return null;
        }

        return $this->outbox->enqueue($cmpId, self::EVENT_UOM, 'uom', $unitId, $row['unit_uuid'] ?? null, self::uomPayload($row));
    }

    public function publishWarehouse(int $cmpId, int $warehouseId): ?int
    {
        $row = \Config\Database::connect()->table('inv_warehouses')->select(self::WAREHOUSE_COLUMNS)->where('cmp_id', $cmpId)->where('warehouse_id', $warehouseId)->get()->getRowArray();
        if (!$row) {
            return null;
        }

        return $this->outbox->enqueue($cmpId, self::EVENT_WAREHOUSE, 'warehouse', $warehouseId, $row['warehouse_uuid'] ?? null, self::warehousePayload($row));
    }

    /**
     * Enqueue one upsert event for every live (not soft-deleted) unit, warehouse and item of a company.
     *
     * @return array{uoms:int, warehouses:int, items:int}
     */
    public function resyncCompany(int $cmpId): array
    {
        $db = \Config\Database::connect();
        $out = ['uoms' => 0, 'warehouses' => 0, 'items' => 0];
        // Units and warehouses first: Books resolves item references against them.
        foreach ($db->table('inv_uom')->select(self::UOM_COLUMNS)->where('cmp_id', $cmpId)->where('deleted_at', null)->orderBy('unit_id')->get()->getResultArray() as $row) {
            $this->outbox->enqueue($cmpId, self::EVENT_UOM, 'uom', (int) $row['unit_id'], $row['unit_uuid'] ?? null, self::uomPayload($row));
            $out['uoms']++;
        }
        foreach ($db->table('inv_warehouses')->select(self::WAREHOUSE_COLUMNS)->where('cmp_id', $cmpId)->where('deleted_at', null)->orderBy('warehouse_id')->get()->getResultArray() as $row) {
            $this->outbox->enqueue($cmpId, self::EVENT_WAREHOUSE, 'warehouse', (int) $row['warehouse_id'], $row['warehouse_uuid'] ?? null, self::warehousePayload($row));
            $out['warehouses']++;
        }
        $offset = 0;
        $chunk = 500;
        do {
            $items = $db->table('inv_items')->select(self::ITEM_COLUMNS)->where('cmp_id', $cmpId)->where('deleted_at', null)->orderBy('item_id')->limit($chunk, $offset)->get()->getResultArray();
            $lines = $this->uomLines($cmpId, array_map(static fn ($r) => (int) $r['item_id'], $items));
            foreach ($items as $row) {
                $this->outbox->enqueue($cmpId, self::EVENT_ITEM, 'item', (int) $row['item_id'], $row['item_uuid'] ?? null, self::itemPayload($row, $lines[(int) $row['item_id']] ?? []));
                $out['items']++;
            }
            $offset += $chunk;
        } while (count($items) === $chunk);

        return $out;
    }

    /** Companies that own at least one live master row. @return list<int> */
    public function companiesWithMasters(): array
    {
        $db = \Config\Database::connect();
        $ids = [];
        foreach (['inv_items', 'inv_uom', 'inv_warehouses'] as $t) {
            foreach ($db->table($t)->distinct()->select('cmp_id')->where('deleted_at', null)->get()->getResultArray() as $r) {
                $ids[(int) $r['cmp_id']] = true;
            }
        }
        $out = array_keys($ids);
        sort($out);

        return $out;
    }

    // ------------------------------------------------------------------ payloads (pure)

    /**
     * @param array<string, mixed> $row
     * @param list<array<string, mixed>> $uomLines
     * @return array<string, mixed>
     */
    public static function itemPayload(array $row, array $uomLines): array
    {
        $uoms = [];
        foreach ($uomLines as $l) {
            $uoms[] = [
                'item_unit_line_id' => (int) $l['item_unit_line_id'],
                'unit_id'           => (int) $l['unit_id'],
                'is_default'        => (int) $l['is_default'],
                'conversion_factor' => round((float) $l['conversion_factor'], 4),
                'mc_qty_wise'       => (int) ($l['mc_qty_wise'] ?? 0),
            ];
        }

        return [
            'item_id'               => (int) $row['item_id'],
            'item_uuid'             => $row['item_uuid'] ?? null,
            'cmp_id'                => (int) $row['cmp_id'],
            'item_name'             => $row['item_name'],
            'item_alias'            => $row['item_alias'] ?? null,
            'print_name'            => $row['print_name'] ?? null,
            'item_sku'              => $row['item_sku'] ?? null,
            'item_upc'              => $row['item_upc'] ?? null,
            'hsn_sac'               => $row['hsn_sac'] ?? null,
            'mrp'                   => isset($row['mrp']) ? round((float) $row['mrp'], 4) : null,
            'unit_id'               => self::nullableInt($row['unit_id'] ?? null),
            'stock_cat_id'          => self::nullableInt($row['stock_cat_id'] ?? null),
            'item_grp_id'           => self::nullableInt($row['item_grp_id'] ?? null),
            'books_sales_acc_id'    => self::nullableInt($row['books_sales_acc_id'] ?? null),
            'books_purchase_acc_id' => self::nullableInt($row['books_purchase_acc_id'] ?? null),
            'books_tax_cat_id'      => self::nullableInt($row['books_tax_cat_id'] ?? null),
            'valuation_method'      => $row['valuation_method'] ?? null,
            'is_active'             => (int) ($row['is_active'] ?? 0),
            'deleted_at'            => $row['deleted_at'] ?? null,
            'updated_at'            => $row['updated_at'] ?? null,
            'uoms'                  => $uoms,
        ];
    }

    /** @param array<string, mixed> $row @return array<string, mixed> */
    public static function uomPayload(array $row): array
    {
        return [
            'unit_id'     => (int) $row['unit_id'],
            'unit_uuid'   => $row['unit_uuid'] ?? null,
            'cmp_id'      => (int) $row['cmp_id'],
            'unit_name'   => $row['unit_name'],
            'unit_symbol' => $row['unit_symbol'] ?? null,
            'print_name'  => $row['print_name'] ?? null,
            'uqc_gst'     => $row['uqc_gst'] ?? null,
            'is_active'   => (int) ($row['is_active'] ?? 0),
            'deleted_at'  => $row['deleted_at'] ?? null,
            'updated_at'  => $row['updated_at'] ?? null,
        ];
    }

    /** @param array<string, mixed> $row @return array<string, mixed> */
    public static function warehousePayload(array $row): array
    {
        return [
            'warehouse_id'       => (int) $row['warehouse_id'],
            'warehouse_uuid'     => $row['warehouse_uuid'] ?? null,
            'cmp_id'             => (int) $row['cmp_id'],
            'warehouse_name'     => $row['warehouse_name'],
            'warehouse_group_id' => self::nullableInt($row['warehouse_group_id'] ?? null),
            'bo_id'              => (int) ($row['bo_id'] ?? 0),
            'is_active'          => (int) ($row['is_active'] ?? 0),
            'deleted_at'         => $row['deleted_at'] ?? null,
            'updated_at'         => $row['updated_at'] ?? null,
        ];
    }

    private static function nullableInt(mixed $v): ?int
    {
        return $v === null || $v === '' ? null : (int) $v;
    }

    /**
     * @param list<int> $itemIds
     * @return array<int, list<array<string, mixed>>>
     */
    private function uomLines(int $cmpId, array $itemIds): array
    {
        $itemIds = array_values(array_unique(array_filter(array_map('intval', $itemIds))));
        if ($itemIds === []) {
            return [];
        }
        $out = [];
        foreach (array_chunk($itemIds, 500) as $chunk) {
            $rows = \Config\Database::connect()->table('inv_item_uoms')->select(self::UOM_LINE_COLUMNS)->where('cmp_id', $cmpId)->whereIn('item_id', $chunk)
                ->orderBy('item_id', 'ASC')->orderBy('is_default', 'DESC')->orderBy('item_unit_line_id', 'ASC')->get()->getResultArray();
            foreach ($rows as $r) {
                $out[(int) $r['item_id']][] = $r;
            }
        }

        return $out;
    }
}
