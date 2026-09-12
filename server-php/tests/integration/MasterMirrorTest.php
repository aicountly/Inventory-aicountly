<?php

namespace Tests\Integration;

use App\Services\MasterMirrorService;
use Tests\Support\IntegrationTestCase;

/**
 * Master-sync events for Books' read-only mirror.
 *
 * @group integration
 */
final class MasterMirrorTest extends IntegrationTestCase
{
    public function testUpsertEventsCarryTheFullRow(): void
    {
        $pcs = $this->makeUnit();
        $box = $this->makeUnit('Box', 'Box');
        $wh = $this->makeWarehouse();
        $item = $this->makeItem('Widget', $pcs, 'FIFO', [$box => 12]);
        $this->db->table('inv_items')->where('item_id', $item)->update(['item_sku' => 'W-1', 'hsn_sac' => '8471', 'mrp' => 99.5, 'books_sales_acc_id' => 4001]);
        $service = new MasterMirrorService();

        $this->assertNotNull($service->publishItem($this->cmpId, $item));
        $this->assertNotNull($service->publishUom($this->cmpId, $pcs));
        $this->assertNotNull($service->publishWarehouse($this->cmpId, $wh));
        $this->assertNull($service->publishItem($this->cmpId, 999999), 'unknown row → no event');
        $this->assertNull($service->publishItem($this->cmpId + 1, $item), 'another company\'s id → no event');

        $events = $this->db->table('inv_integration_events')->orderBy('event_id')->get()->getResultArray();
        $this->assertCount(3, $events);
        foreach ($events as $e) {
            $this->assertSame('books', $e['target_app']);
            $this->assertSame('PENDING', $e['status']);
            $this->assertSame($this->cmpId, (int) $e['cmp_id']);
        }

        [$itemEvent, $uomEvent, $whEvent] = $events;
        $this->assertSame('inventory.item.upserted', $itemEvent['event_type']);
        $this->assertSame('item', $itemEvent['aggregate_type']);
        $this->assertSame($item, (int) $itemEvent['aggregate_id']);
        $row = $this->db->table('inv_items')->where('item_id', $item)->get()->getRowArray();
        $this->assertSame($row['item_uuid'], $itemEvent['aggregate_uuid']);
        $p = json_decode((string) $itemEvent['payload_json'], true);
        foreach (['item_id', 'cmp_id', 'item_name', 'item_alias', 'print_name', 'item_sku', 'item_upc', 'hsn_sac', 'mrp', 'unit_id', 'stock_cat_id', 'item_grp_id', 'books_sales_acc_id', 'books_purchase_acc_id', 'books_tax_cat_id', 'valuation_method', 'is_active', 'deleted_at', 'uoms'] as $k) {
            $this->assertArrayHasKey($k, $p);
        }
        $this->assertSame($this->cmpId, $p['cmp_id']);
        $this->assertSame('Widget', $p['item_name']);
        $this->assertSame('W-1', $p['item_sku']);
        $this->assertSame(4001, $p['books_sales_acc_id']);
        $this->assertNull($p['books_purchase_acc_id']);
        $this->assertEqualsWithDelta(99.5, $p['mrp'], 0.0001);
        $this->assertSame(1, $p['is_active']);
        $this->assertNull($p['deleted_at']);
        $this->assertCount(2, $p['uoms']);
        // JSONB normalises key order on storage: compare key sets, not order.
        $this->assertEqualsCanonicalizing(['item_unit_line_id', 'unit_id', 'is_default', 'conversion_factor', 'mc_qty_wise'], array_keys($p['uoms'][0]));
        $this->assertSame($pcs, $p['uoms'][0]['unit_id']);
        $this->assertSame(1, $p['uoms'][0]['is_default']);
        $this->assertSame($box, $p['uoms'][1]['unit_id']);
        $this->assertSame(0, $p['uoms'][1]['is_default']);
        $this->assertEqualsWithDelta(12.0, $p['uoms'][1]['conversion_factor'], 0.0001);

        $this->assertSame('inventory.uom.upserted', $uomEvent['event_type']);
        $this->assertSame('uom', $uomEvent['aggregate_type']);
        $this->assertSame($pcs, (int) $uomEvent['aggregate_id']);
        $u = json_decode((string) $uomEvent['payload_json'], true);
        $this->assertEqualsCanonicalizing(['unit_id', 'unit_uuid', 'cmp_id', 'unit_name', 'unit_symbol', 'print_name', 'uqc_gst', 'is_active', 'deleted_at', 'updated_at'], array_keys($u));
        $this->assertSame('Pcs', $u['unit_name']);
        $this->assertSame('PCS', $u['uqc_gst']);

        $this->assertSame('inventory.warehouse.upserted', $whEvent['event_type']);
        $this->assertSame('warehouse', $whEvent['aggregate_type']);
        $w = json_decode((string) $whEvent['payload_json'], true);
        $this->assertEqualsCanonicalizing(['warehouse_id', 'warehouse_uuid', 'cmp_id', 'warehouse_name', 'warehouse_group_id', 'bo_id', 'is_active', 'deleted_at', 'updated_at'], array_keys($w));
        $this->assertSame('Main', $w['warehouse_name']);
        $this->assertSame(0, $w['bo_id']);
        $this->assertNull($w['warehouse_group_id']);
    }

    public function testDeletedRowsPublishWithDeletedAtAndResyncSkipsThem(): void
    {
        $pcs = $this->makeUnit();
        $box = $this->makeUnit('Box', 'Box');
        $wh = $this->makeWarehouse();
        $gone = $this->makeWarehouse('Closed');
        $item = $this->makeItem('Widget', $pcs);
        $this->db->table('inv_uom')->where('unit_id', $box)->update(['deleted_at' => '2026-05-01 10:00:00', 'is_active' => 0]);
        $this->db->table('inv_warehouses')->where('warehouse_id', $gone)->update(['deleted_at' => '2026-05-01 10:00:00', 'is_active' => 0]);
        $service = new MasterMirrorService();

        $this->assertNotNull($service->publishUom($this->cmpId, $box));
        $e = $this->db->table('inv_integration_events')->where('event_type', 'inventory.uom.upserted')->get()->getRowArray();
        $p = json_decode((string) $e['payload_json'], true);
        $this->assertSame('2026-05-01 10:00:00', $p['deleted_at']);
        $this->assertSame(0, $p['is_active']);

        $this->db->table('inv_integration_events')->truncate();
        $counts = $service->resyncCompany($this->cmpId);
        $this->assertSame(['uoms' => 1, 'warehouses' => 1, 'items' => 1], $counts);
        $events = $this->db->table('inv_integration_events')->orderBy('event_id')->get()->getResultArray();
        $this->assertSame(['inventory.uom.upserted', 'inventory.warehouse.upserted', 'inventory.item.upserted'], array_column($events, 'event_type'), 'units and warehouses before items');
        $this->assertSame([$pcs, $wh, $item], array_map('intval', array_column($events, 'aggregate_id')));
        $this->assertSame([$this->cmpId], $service->companiesWithMasters());
        $this->assertSame(['uoms' => 0, 'warehouses' => 0, 'items' => 0], $service->resyncCompany($this->cmpId + 1));
    }
}
