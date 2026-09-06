<?php

namespace Tests\Integration;

use App\Exceptions\InventoryException;
use App\Services\DocumentPostingService;
use App\Services\DocumentService;
use App\Services\PackingService;
use App\Services\PendingQuantityService;
use App\Services\ReservationService;
use App\Services\StockBalanceService;
use Tests\Support\IntegrationTestCase;

/**
 * Reservations (reserved bucket), packing lists (packed bucket + inv_packing_meta) and the
 * open pending-quantity listing behind /pending-quantities.
 *
 * @group integration
 */
final class ReservationsAndPackingTest extends IntegrationTestCase
{
    private DocumentService $docs;
    private DocumentPostingService $posting;
    private StockBalanceService $balances;
    private ReservationService $reservations;
    private PackingService $packing;

    protected function setUp(): void
    {
        parent::setUp();
        $this->docs = new DocumentService();
        $this->posting = new DocumentPostingService($this->docs);
        $this->balances = new StockBalanceService();
        $this->reservations = new ReservationService();
        $this->packing = new PackingService($this->docs);
    }

    private function postDoc(array $payload, string $source = 'inventory'): array
    {
        $doc = $this->docs->create($this->ctx(), $payload, 'tester', $source);

        return $this->posting->post($this->cmpId, (int) $doc['document_id'], 'tester', ['session' => ['kind' => 'service']]);
    }

    /** Purchase receipt from Books so there is on-hand stock to reserve / pack. */
    private function receive(int $item, int $wh, float $qty, int $sourceId): array
    {
        return $this->postDoc([
            'document_type' => 'PURCHASE_RECEIPT', 'document_date' => '2026-04-05', 'source_document_type' => 'books.purchase', 'source_document_id' => $sourceId,
            'lines' => [['item_id' => $item, 'warehouse_id' => $wh, 'qty' => $qty, 'rate' => 50]],
        ], 'books');
    }

    public function testReserveDropsAvailabilityAndReleaseRestoresIt(): void
    {
        $pcs = $this->makeUnit();
        $wh = $this->makeWarehouse();
        $item = $this->makeItem('Reservable', $pcs);
        $this->assertSame('POSTED', $this->receive($item, $wh, 10, 301)['status']);
        $this->assertEqualsWithDelta(10.0, $this->balances->balance($this->cmpId, $item, $wh)['available'], 0.0001);

        $res = $this->reservations->reserve($this->ctx(), [
            'item_id' => $item, 'warehouse_id' => $wh, 'qty' => 4, 'source_document_type' => 'sales.order', 'source_document_id' => 7001, 'expires_at' => '2026-12-31T18:30:00Z',
        ], 'tester', 'sales');
        $this->assertSame('active', $res['status']);
        $this->assertEqualsWithDelta(4.0, $res['qty'], 0.0001);
        $this->assertEqualsWithDelta(4.0, $res['open_qty'], 0.0001);
        $this->assertSame('sales', $res['source_app']);
        $this->assertSame('Reservable', $res['item_name']);
        $this->assertSame('2026-12-31 18:30:00', $res['expires_at']);

        $bal = $this->balances->balance($this->cmpId, $item, $wh);
        $this->assertEqualsWithDelta(10.0, $bal['on_hand'], 0.0001, 'a reservation never moves stock');
        $this->assertEqualsWithDelta(4.0, $bal['reserved'], 0.0001);
        $this->assertEqualsWithDelta(6.0, $bal['available'], 0.0001);
        $this->assertSame(1, $this->db->table('inv_stock_status_movements')->where('movement_type', 'reserve')->where('item_id', $item)->countAllResults());

        // Duplicate-request guard: the same order line is found as an open reservation.
        $dup = $this->reservations->findOpenBySource($this->cmpId, 'sales', 'sales.order', 7001, $item, $wh, null);
        $this->assertNotNull($dup);
        $this->assertSame((int) $res['reservation_id'], $dup['reservation_id']);

        // More than what is available is refused before anything is written.
        try {
            $this->reservations->reserve($this->ctx(), ['item_id' => $item, 'warehouse_id' => $wh, 'qty' => 7], 'tester');
            $this->fail('expected insufficient available stock');
        } catch (InventoryException $e) {
            $this->assertSame('validation_failed', $e->errorCode());
            $this->assertSame(422, $e->httpStatus());
        }
        $this->assertSame(1, $this->db->table('inv_reservations')->countAllResults(), 'the failed reservation left no row');
        $this->assertEqualsWithDelta(6.0, $this->balances->balance($this->cmpId, $item, $wh)['available'], 0.0001);

        // Partial release lowers the reservation; full release closes it and gives everything back.
        $partial = $this->reservations->release($this->cmpId, (int) $res['reservation_id'], 'tester', 1, 'customer trimmed the order');
        $this->assertSame('active', $partial['status']);
        $this->assertEqualsWithDelta(3.0, $partial['qty'], 0.0001);
        $this->assertEqualsWithDelta(7.0, $this->balances->balance($this->cmpId, $item, $wh)['available'], 0.0001);

        $released = $this->reservations->release($this->cmpId, (int) $res['reservation_id'], 'tester');
        $this->assertSame('released', $released['status']);
        $this->assertFalse($released['is_open']);
        $bal = $this->balances->balance($this->cmpId, $item, $wh);
        $this->assertEqualsWithDelta(0.0, $bal['reserved'], 0.0001);
        $this->assertEqualsWithDelta(10.0, $bal['available'], 0.0001);
        $this->assertNull($this->reservations->findOpenBySource($this->cmpId, 'sales', 'sales.order', 7001, $item, $wh, null));

        try {
            $this->reservations->release($this->cmpId, (int) $res['reservation_id'], 'tester');
            $this->fail('a released reservation cannot be released again');
        } catch (InventoryException $e) {
            $this->assertSame('invalid_state', $e->errorCode());
            $this->assertSame(409, $e->httpStatus());
        }
        $this->assertGreaterThanOrEqual(3, $this->db->table('inv_audit_log')->where('entity_type', 'reservation')->countAllResults());
    }

    public function testFulfilRecordsFulfilledQtyAndReleasesTheRemainder(): void
    {
        $pcs = $this->makeUnit();
        $wh = $this->makeWarehouse();
        $item = $this->makeItem('Fulfillable', $pcs);
        $this->receive($item, $wh, 10, 302);

        $res = $this->reservations->reserve($this->ctx(), ['item_id' => $item, 'warehouse_id' => $wh, 'qty' => 5], 'tester');
        $this->assertEqualsWithDelta(5.0, $this->balances->balance($this->cmpId, $item, $wh)['available'], 0.0001);

        // Partial fulfilment that keeps the remainder reserved.
        $kept = $this->reservations->fulfil($this->cmpId, (int) $res['reservation_id'], 'tester', 2, ['release_remainder' => false]);
        $this->assertSame('partial', $kept['status']);
        $this->assertEqualsWithDelta(2.0, $kept['fulfilled_qty'], 0.0001);
        $this->assertEqualsWithDelta(3.0, $kept['open_qty'], 0.0001);
        $this->assertEqualsWithDelta(3.0, $this->balances->balance($this->cmpId, $item, $wh)['reserved'], 0.0001);

        // The invoice issued 1 more; the rest is released and the reservation closes.
        $done = $this->reservations->fulfil($this->cmpId, (int) $res['reservation_id'], 'tester', 1, ['document_id' => 4242]);
        $this->assertSame('fulfilled', $done['status']);
        $this->assertEqualsWithDelta(3.0, $done['fulfilled_qty'], 0.0001);
        $this->assertSame(4242, $done['document_id']);
        $bal = $this->balances->balance($this->cmpId, $item, $wh);
        $this->assertEqualsWithDelta(0.0, $bal['reserved'], 0.0001);
        $this->assertEqualsWithDelta(10.0, $bal['available'], 0.0001, 'on-hand is untouched: the issuing document moves it');

        try {
            $this->reservations->fulfil($this->cmpId, (int) $res['reservation_id'], 'tester');
            $this->fail('a fulfilled reservation cannot be fulfilled again');
        } catch (InventoryException $e) {
            $this->assertSame('invalid_state', $e->errorCode());
        }

        // Expiry sweep releases what is past its expires_at.
        $old = $this->reservations->reserve($this->ctx(), ['item_id' => $item, 'warehouse_id' => $wh, 'qty' => 2, 'expires_at' => '2026-01-01 00:00:00'], 'tester');
        $this->assertEqualsWithDelta(8.0, $this->balances->balance($this->cmpId, $item, $wh)['available'], 0.0001);
        $this->assertSame(1, $this->reservations->expireDue($this->cmpId, '2026-06-01 00:00:00'));
        $this->assertSame('expired', $this->reservations->get($this->cmpId, (int) $old['reservation_id'])['status']);
        $this->assertEqualsWithDelta(10.0, $this->balances->balance($this->cmpId, $item, $wh)['available'], 0.0001);
    }

    public function testPackUnpackRoundTripWithLockGuard(): void
    {
        $pcs = $this->makeUnit();
        $wh = $this->makeWarehouse();
        $item = $this->makeItem('Packable', $pcs);
        $this->receive($item, $wh, 10, 303);

        $packing = $this->postDoc([
            'document_type' => 'PACKING', 'document_date' => '2026-04-06', 'party_ref' => 9001, 'party_name' => 'Consignee Co', 'metadata' => ['box_marks' => ['CTN-1', 'CTN-2']],
            'lines' => [['item_id' => $item, 'warehouse_id' => $wh, 'qty' => 4]],
        ]);
        $this->assertSame('POSTED', $packing['status']);
        $id = (int) $packing['document_id'];
        $this->assertSame(0, $this->db->table('inv_stock_movements')->where('document_id', $id)->countAllResults(), 'packing never moves stock');
        $bal = $this->balances->balance($this->cmpId, $item, $wh);
        $this->assertEqualsWithDelta(4.0, $bal['packed'], 0.0001);
        $this->assertEqualsWithDelta(6.0, $bal['available'], 0.0001);

        $list = $this->packing->get($this->cmpId, $id);
        $this->assertSame('open', $list['packing']['packing_status']);
        $this->assertSame(9001, $list['packing']['consignee_ref']);
        $this->assertSame(['CTN-1', 'CTN-2'], $list['packing']['box_marks']);
        $this->assertTrue($list['packing']['is_open']);

        // Books starts keying a sale against it: locked, and unpack is refused with 409.
        $locked = $this->packing->lock($this->cmpId, $id, 'books-user', 'books-draft-55');
        $this->assertSame('locked', $locked['packing']['packing_status']);
        $this->assertSame('books-draft-55', $locked['packing']['locked_by_external_ref']);
        $this->assertNotNull($locked['packing']['locked_at']);
        $this->assertSame('locked', $this->packing->lock($this->cmpId, $id, 'books-user', 'books-draft-55')['packing']['packing_status'], 'same holder re-lock is idempotent');
        try {
            $this->packing->lock($this->cmpId, $id, 'books-user', 'books-draft-99');
            $this->fail('another draft cannot take the lock');
        } catch (InventoryException $e) {
            $this->assertSame('invalid_state', $e->errorCode());
            $this->assertSame(409, $e->httpStatus());
        }
        try {
            $this->packing->unpack($this->cmpId, $id, 'tester');
            $this->fail('a locked packing list cannot be unpacked');
        } catch (InventoryException $e) {
            $this->assertSame('invalid_state', $e->errorCode());
            $this->assertSame(409, $e->httpStatus());
        }
        $this->assertEqualsWithDelta(4.0, $this->balances->balance($this->cmpId, $item, $wh)['packed'], 0.0001, 'refused unpack changed nothing');

        try {
            $this->packing->unlock($this->cmpId, $id, 'books-user', 'books-draft-99');
            $this->fail('a different draft cannot unlock');
        } catch (InventoryException $e) {
            $this->assertSame('invalid_state', $e->errorCode());
        }
        $open = $this->packing->unlock($this->cmpId, $id, 'books-user', 'books-draft-55');
        $this->assertSame('open', $open['packing']['packing_status']);
        $this->assertNull($open['packing']['locked_by_external_ref']);

        // Unpack: packed bucket back to available, meta unpacked, document still POSTED.
        $unpacked = $this->packing->unpack($this->cmpId, $id, 'tester', 'customer cancelled');
        $this->assertSame('unpacked', $unpacked['packing']['packing_status']);
        $this->assertSame('POSTED', $unpacked['status']);
        $bal = $this->balances->balance($this->cmpId, $item, $wh);
        $this->assertEqualsWithDelta(0.0, $bal['packed'], 0.0001);
        $this->assertEqualsWithDelta(10.0, $bal['available'], 0.0001);
        $this->assertEqualsWithDelta(10.0, $bal['on_hand'], 0.0001);
        $types = array_column($this->db->table('inv_stock_status_movements')->select('movement_type')->where('document_id', $id)->orderBy('ledger_id')->get()->getResultArray(), 'movement_type');
        $this->assertSame(['pack', 'unpack'], $types, 'the bucket trail is append-only');

        foreach (['unpack', 'lock'] as $action) {
            try {
                $action === 'unpack' ? $this->packing->unpack($this->cmpId, $id, 'tester') : $this->packing->lock($this->cmpId, $id, 'tester', 'x');
                $this->fail('an unpacked list cannot be ' . $action . 'ed');
            } catch (InventoryException $e) {
                $this->assertSame('invalid_state', $e->errorCode());
            }
        }
        $this->assertSame(3, $this->db->table('inv_audit_log')->where('entity_type', 'document')->whereIn('action', ['packing.lock', 'packing.unlock', 'packing.unpack'])->countAllResults());
    }

    public function testMarkConsumedAndNonPackingDocumentsAreRejected(): void
    {
        $pcs = $this->makeUnit();
        $wh = $this->makeWarehouse();
        $item = $this->makeItem('Consumable', $pcs);
        $receipt = $this->receive($item, $wh, 10, 304);
        $packing = $this->postDoc(['document_type' => 'PACKING', 'document_date' => '2026-04-06', 'party_ref' => 9002, 'lines' => [['item_id' => $item, 'warehouse_id' => $wh, 'qty' => 3]]]);
        $id = (int) $packing['document_id'];

        $this->packing->lock($this->cmpId, $id, 'books-user', 'books-draft-1');
        $consumed = $this->packing->markConsumed($this->cmpId, $id, 777, 'books-user');
        $this->assertSame('consumed', $consumed['packing']['packing_status']);
        $this->assertSame(777, $consumed['packing']['locked_by_document_id']);
        $this->assertNull($consumed['packing']['locked_by_external_ref']);
        $this->assertSame('consumed', $this->packing->markConsumed($this->cmpId, $id, 777, 'books-user')['packing']['packing_status'], 'same consumer is idempotent');
        foreach ([fn () => $this->packing->markConsumed($this->cmpId, $id, 778, 'x'), fn () => $this->packing->unpack($this->cmpId, $id, 'x'), fn () => $this->packing->unlock($this->cmpId, $id, 'x')] as $call) {
            try {
                $call();
                $this->fail('a consumed list is terminal');
            } catch (InventoryException $e) {
                $this->assertSame('invalid_state', $e->errorCode());
            }
        }

        try {
            $this->packing->get($this->cmpId, (int) $receipt['document_id']);
            $this->fail('a purchase receipt is not a packing list');
        } catch (InventoryException $e) {
            $this->assertSame('not_found', $e->errorCode());
        }
        try {
            $this->packing->get($this->cmpId + 1, $id);
            $this->fail('tenant isolation: another company cannot see the list');
        } catch (InventoryException $e) {
            $this->assertSame('not_found', $e->errorCode());
        }
        $draft = $this->docs->create($this->ctx(), ['document_type' => 'PACKING', 'document_date' => '2026-04-07', 'party_ref' => 9002, 'lines' => [['item_id' => $item, 'warehouse_id' => $wh, 'qty' => 1]]], 'tester');
        $this->assertNull($this->packing->get($this->cmpId, (int) $draft['document_id'])['packing'], 'no packing state before posting');
        try {
            $this->packing->lock($this->cmpId, (int) $draft['document_id'], 'tester', 'd');
            $this->fail('a draft cannot be locked');
        } catch (InventoryException $e) {
            $this->assertSame('invalid_state', $e->errorCode());
        }
    }

    public function testOpenPendingQuantitiesListingBehindPendingController(): void
    {
        $pcs = $this->makeUnit();
        $whA = $this->makeWarehouse('A');
        $whB = $this->makeWarehouse('B');
        $item = $this->makeItem('Challaned', $pcs);
        $other = $this->makeItem('Other', $pcs);
        $this->receive($item, $whA, 10, 305);
        $this->postDoc(['document_type' => 'DELIVERY_CHALLAN', 'document_date' => '2026-04-08', 'party_ref' => 9100, 'lines' => [['item_id' => $item, 'warehouse_id' => $whA, 'qty' => 3], ['item_id' => $other, 'warehouse_id' => $whB, 'qty' => 2]]]);
        $this->postDoc(['document_type' => 'INWARD_CHALLAN', 'document_date' => '2026-04-09', 'party_ref' => 9200, 'lines' => [['item_id' => $item, 'warehouse_id' => $whA, 'qty' => 5]]]);

        $svc = new PendingQuantityService();
        $this->assertCount(3, $svc->listOpen($this->cmpId));
        $this->assertCount(2, $svc->listOpen($this->cmpId, 'challan', 'out'));
        $this->assertCount(1, $svc->listOpen($this->cmpId, null, 'in'));
        $this->assertCount(1, $svc->listOpen($this->cmpId, null, null, 9100, $item));
        $this->assertCount(1, $svc->listOpen($this->cmpId, null, null, null, null, $whB));
        $row = $svc->listOpen($this->cmpId, 'challan', 'out', 9100, $item)[0];
        $this->assertEqualsWithDelta(3.0, (float) $row['qty_open'], 0.0001);
        $this->assertSame('DELIVERY_CHALLAN', $row['document_type']);
        $this->assertSame('Challaned', $row['item_name']);
        $this->assertSame([], $svc->listOpen($this->cmpId + 1), 'tenant isolation');
    }
}
