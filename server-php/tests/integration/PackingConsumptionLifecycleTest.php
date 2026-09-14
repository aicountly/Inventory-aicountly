<?php

namespace Tests\Integration;

use App\Exceptions\InventoryException;
use App\Services\DocumentPostingService;
use App\Services\DocumentService;
use App\Services\PackingService;
use App\Services\StockBalanceService;
use Tests\Support\IntegrationTestCase;

/**
 * What a sale does to the packed bucket, and what may still be reversed afterwards.
 *
 * The packed bucket is subtracted from `available` (StockBalanceService::availableFrom), so every
 * quantity that leaves a packing list has to leave it exactly once and under the movement type
 * that says what actually happened to it.
 *
 * @group integration
 */
final class PackingConsumptionLifecycleTest extends IntegrationTestCase
{
    private DocumentService $docs;
    private DocumentPostingService $posting;
    private StockBalanceService $balances;
    private PackingService $packing;

    protected function setUp(): void
    {
        parent::setUp();
        $this->docs = new DocumentService();
        $this->posting = new DocumentPostingService($this->docs);
        $this->balances = new StockBalanceService();
        $this->packing = new PackingService($this->docs);
    }

    /** @param array<string, mixed> $payload */
    private function postDoc(array $payload, string $source = 'inventory'): array
    {
        $doc = $this->docs->create($this->ctx(), $payload, 'tester', $source);

        return $this->posting->post($this->cmpId, (int) $doc['document_id'], 'tester', ['session' => ['kind' => 'service']]);
    }

    private function receive(int $item, int $wh, float $qty, int $sourceId): void
    {
        $this->postDoc([
            'document_type' => 'PURCHASE_RECEIPT', 'document_date' => '2026-04-05', 'source_document_type' => 'books.purchase', 'source_document_id' => $sourceId,
            'lines' => [['item_id' => $item, 'warehouse_id' => $wh, 'qty' => $qty, 'rate' => 50]],
        ], 'books');
    }

    private function pack(int $item, int $wh, float $qty): int
    {
        return (int) $this->postDoc([
            'document_type' => 'PACKING', 'document_date' => '2026-04-06', 'party_ref' => 9003,
            'lines' => [['item_id' => $item, 'warehouse_id' => $wh, 'qty' => $qty]],
        ])['document_id'];
    }

    /** The sale Books raises against a packing list: stock_effect on_invoice, the list named in metadata. */
    private function sale(int $item, int $wh, float $qty, int $listId, int $sourceId): array
    {
        return [
            'document_type' => 'SALES_ISSUE', 'document_date' => '2026-04-07', 'party_ref' => 9003,
            'source_document_type' => 'books.sales_invoice', 'source_document_id' => $sourceId,
            'metadata' => ['linked_source_document_id' => $listId],
            'lines' => [['item_id' => $item, 'warehouse_id' => $wh, 'qty' => $qty, 'rate' => 120]],
        ];
    }

    /** @return array<string, float> */
    private function statusMovements(int $documentId): array
    {
        $out = [];
        foreach ($this->db->table('inv_stock_status_movements')->where('cmp_id', $this->cmpId)->where('document_id', $documentId)->get()->getResultArray() as $r) {
            $out[$r['movement_type']] = round((float) ($out[$r['movement_type']] ?? 0) + (float) $r['base_qty'], 4);
        }

        return $out;
    }

    /**
     * A packing list whose goods have already left with an invoice is not reversible on its own.
     *
     * The sale emptied the packed bucket when it consumed the list, so unwinding the `pack`
     * movement credits back goods that are not there: packed goes to -4 and, because availableFrom()
     * subtracts packed, `available` reports 10 against an on_hand of 6 — four units the negative
     * stock guard would happily let someone sell all over again.
     */
    public function testAConsumedPackingListCannotBeReversedWhileTheInvoiceStands(): void
    {
        $pcs = $this->makeUnit();
        $wh = $this->makeWarehouse();
        $item = $this->makeItem('Consigned', $pcs);
        $this->receive($item, $wh, 10, 305);
        $listId = $this->pack($item, $wh, 4);
        $invoice = $this->postDoc($this->sale($item, $wh, 4, $listId, 7201), 'books');
        $this->assertSame('POSTED', $invoice['status']);

        $refusal = null;
        try {
            $this->posting->reverse($this->cmpId, $listId, 'tester', 'packed the wrong carton');
        } catch (InventoryException $e) {
            $refusal = $e;
        }

        $bal = $this->balances->balance($this->cmpId, $item, $wh);
        $this->assertEqualsWithDelta(6.0, $bal['on_hand'], 0.0001);
        $this->assertEqualsWithDelta(0.0, $bal['packed'], 0.0001, 'the packed bucket never goes negative');
        $this->assertEqualsWithDelta(6.0, $bal['available'], 0.0001, 'available may never exceed on_hand');
        $this->assertNotNull($refusal, 'a consignment that has already shipped cannot be un-packed by reversing the list');
        $this->assertSame('invalid_state', $refusal->errorCode());
        $this->assertStringContainsString('#' . (int) $invoice['document_id'], $refusal->getMessage(), 'the refusal names the invoice to reverse first');
        $this->assertSame('POSTED', $this->docs->get($this->cmpId, $listId)['status'], 'the refused reversal changed nothing');

        // Reversing the invoice first is the way out: that hands the consignment back, and the
        // list is open again and reversible like any other document.
        $this->posting->reverse($this->cmpId, (int) $invoice['document_id'], 'tester', 'customer refused delivery');
        $this->assertSame('open', $this->packing->get($this->cmpId, $listId)['packing']['packing_status']);
        $this->assertSame('REVERSED', $this->posting->reverse($this->cmpId, $listId, 'tester', 'packed the wrong carton')['status']);
        $bal = $this->balances->balance($this->cmpId, $item, $wh);
        $this->assertEqualsWithDelta(10.0, $bal['on_hand'], 0.0001);
        $this->assertEqualsWithDelta(0.0, $bal['packed'], 0.0001);
        $this->assertEqualsWithDelta(10.0, $bal['available'], 0.0001);
    }

    /**
     * Unpacking put the goods back in general stock, so a sale whose draft still names the list
     * has nothing to take from it — and billing a customer out of general stock is an ordinary
     * business action, not something to leave an invoice FAILED over.
     */
    public function testASaleNamingAnUnpackedListStillPosts(): void
    {
        $pcs = $this->makeUnit();
        $wh = $this->makeWarehouse();
        $item = $this->makeItem('Unpacked again', $pcs);
        $this->receive($item, $wh, 10, 306);
        $listId = $this->pack($item, $wh, 4);
        $this->assertSame('unpacked', $this->packing->unpack($this->cmpId, $listId, 'tester', 'consignment broken up')['packing']['packing_status']);
        $this->assertEqualsWithDelta(10.0, $this->balances->balance($this->cmpId, $item, $wh)['available'], 0.0001);

        $invoice = $this->postDoc($this->sale($item, $wh, 4, $listId, 7202), 'books');

        $this->assertSame('POSTED', $invoice['status']);
        $bal = $this->balances->balance($this->cmpId, $item, $wh);
        $this->assertEqualsWithDelta(6.0, $bal['on_hand'], 0.0001);
        $this->assertEqualsWithDelta(0.0, $bal['packed'], 0.0001, 'nothing was taken out of a bucket the unpack had already emptied');
        $this->assertEqualsWithDelta(6.0, $bal['available'], 0.0001);
        $this->assertSame('unpacked', $this->packing->get($this->cmpId, $listId)['packing']['packing_status'], 'the sale issued no consignment, so it closed none');
        $this->assertSame([], $this->statusMovements((int) $invoice['document_id']));
    }

    /**
     * An invoice that bills part of the consignment closes the list, so the rest has to leave the
     * packed bucket too — but as an `unpack` the list makes, not as an issue the invoice did not.
     * The status journal is the audit trail for the packed bucket: booking the whole list as
     * sale_issue states there that this invoice shipped 10 units when it shipped 4.
     */
    public function testAPartialInvoiceIssuesOnlyWhatItShipsAndReleasesTheRest(): void
    {
        $pcs = $this->makeUnit();
        $wh = $this->makeWarehouse();
        $item = $this->makeItem('Part shipped', $pcs);
        $this->receive($item, $wh, 20, 307);
        $listId = $this->pack($item, $wh, 10);
        $invoice = $this->postDoc($this->sale($item, $wh, 4, $listId, 7203), 'books');
        $invoiceId = (int) $invoice['document_id'];

        $this->assertSame('POSTED', $invoice['status']);
        $this->assertSame(['sale_issue' => 4.0, 'unpack' => 6.0], $this->statusMovements($invoiceId));
        $bal = $this->balances->balance($this->cmpId, $item, $wh);
        $this->assertEqualsWithDelta(16.0, $bal['on_hand'], 0.0001);
        $this->assertEqualsWithDelta(0.0, $bal['packed'], 0.0001, 'the closed list holds nothing back');
        $this->assertEqualsWithDelta(16.0, $bal['available'], 0.0001);
        $this->assertSame('consumed', $this->packing->get($this->cmpId, $listId)['packing']['packing_status']);

        // Both movements are booked against the invoice, so reversing it puts the whole
        // consignment back where releaseConsumedBy() reopens the list expecting to find it.
        $this->posting->reverse($this->cmpId, $invoiceId, 'tester', 'customer refused delivery');
        $bal = $this->balances->balance($this->cmpId, $item, $wh);
        $this->assertEqualsWithDelta(20.0, $bal['on_hand'], 0.0001);
        $this->assertEqualsWithDelta(10.0, $bal['packed'], 0.0001);
        $this->assertEqualsWithDelta(10.0, $bal['available'], 0.0001);
        $this->assertSame('open', $this->packing->get($this->cmpId, $listId)['packing']['packing_status']);
    }
}
