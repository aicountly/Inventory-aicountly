<?php

namespace Tests\Unit;

use App\Exceptions\InventoryException;
use App\Services\DocumentService;
use App\Services\PackingService;
use PHPUnit\Framework\TestCase;

/**
 * The two decisions a consumed packing list turns on.
 *
 * How much of the list the invoice actually issued — the rest is released by the list, not
 * shipped by the invoice, and the status journal is the audit trail for the packed bucket.
 *
 * And whether the list may still be reversed at all — once the goods have left with an invoice
 * the pack movement cannot be unwound, because the packed bucket no longer holds them.
 *
 * @group unit
 */
final class PackingConsumptionSplitTest extends TestCase
{
    /** @param array<string, mixed> $over */
    private function listLine(array $over = []): array
    {
        return $over + ['item_id' => 10, 'unit_id' => 3, 'warehouse_id' => 9, 'batch_id' => null, 'qty' => 10.0, 'base_qty' => 10.0];
    }

    /** @param array<string, mixed> $over */
    private function saleLine(array $over = []): array
    {
        return $over + ['item_id' => 10, 'unit_id' => 3, 'warehouse_id' => 9, 'batch_id' => null, 'qty' => 10.0, 'base_qty' => 10.0];
    }

    public function testAnInvoiceCoveringTheWholeListIssuesAllOfItAndReleasesNothing(): void
    {
        $split = PackingService::splitConsumption([$this->listLine()], [$this->saleLine()]);

        $this->assertSame([10.0], array_column($split['issued'], 'qty'));
        $this->assertSame([], $split['released']);
    }

    /**
     * The finding: the residual used to be drained under movement_type='sale_issue' at the list's
     * full quantity, so the journal said the invoice issued 10 units while on_hand moved by 4.
     */
    public function testAPartialInvoiceIssuesWhatItShipsAndReleasesTheRest(): void
    {
        $split = PackingService::splitConsumption([$this->listLine()], [$this->saleLine(['qty' => 4.0, 'base_qty' => 4.0])]);

        $this->assertSame([4.0], array_column($split['issued'], 'qty'));
        $this->assertSame([6.0], array_column($split['released'], 'qty'));
        $this->assertSame(9, $split['released'][0]['warehouse_id'], 'the release lands on the bucket the list packed');
    }

    /** Nothing may be left behind: the list closes, so every packed unit leaves under one type or the other. */
    public function testTheTwoMovementsAlwaysAddUpToTheListedQuantity(): void
    {
        foreach ([0.0, 0.5, 3.3333, 9.9999, 10.0] as $shipped) {
            $split = PackingService::splitConsumption([$this->listLine()], [$this->saleLine(['qty' => $shipped, 'base_qty' => $shipped])]);
            $moved = array_sum(array_column($split['issued'], 'qty')) + array_sum(array_column($split['released'], 'qty'));
            $this->assertEqualsWithDelta(10.0, $moved, 0.0001, 'shipped ' . $shipped);
        }
    }

    /** The list is packed in boxes of 12 and the invoice bills 12 pieces: half a box left the list. */
    public function testQuantitiesAreMatchedInBaseUnitsAndSplitInTheUnitTheListWasPackedIn(): void
    {
        $split = PackingService::splitConsumption(
            [$this->listLine(['unit_id' => 7, 'qty' => 2.0, 'base_qty' => 24.0])],
            [$this->saleLine(['qty' => 12.0, 'base_qty' => 12.0])],
        );

        $this->assertSame([1.0], array_column($split['issued'], 'qty'));
        $this->assertSame(7, $split['issued'][0]['unit_id']);
        $this->assertSame([1.0], array_column($split['released'], 'qty'));
    }

    /** A sale billing more than was set aside still takes only what the list held. */
    public function testAnInvoiceBiggerThanTheListIssuesOnlyTheList(): void
    {
        $split = PackingService::splitConsumption([$this->listLine()], [$this->saleLine(['qty' => 25.0, 'base_qty' => 25.0])]);

        $this->assertSame([10.0], array_column($split['issued'], 'qty'));
        $this->assertSame([], $split['released']);
    }

    /** Where the invoice says which bucket it shipped from, that is the line credited with issuing it. */
    public function testTheSaleIsMatchedToTheListLineItActuallyShipped(): void
    {
        $split = PackingService::splitConsumption(
            [$this->listLine(['warehouse_id' => 9, 'qty' => 6.0, 'base_qty' => 6.0]), $this->listLine(['warehouse_id' => 4, 'qty' => 4.0, 'base_qty' => 4.0])],
            [$this->saleLine(['warehouse_id' => 4, 'qty' => 4.0, 'base_qty' => 4.0])],
        );

        $this->assertSame([['warehouse_id' => 4, 'qty' => 4.0]], array_map(static fn ($l) => ['warehouse_id' => $l['warehouse_id'], 'qty' => $l['qty']], $split['issued']));
        $this->assertSame([['warehouse_id' => 9, 'qty' => 6.0]], array_map(static fn ($l) => ['warehouse_id' => $l['warehouse_id'], 'qty' => $l['qty']], $split['released']));
    }

    /** @param array<string, mixed>|null $meta */
    private function service(?array $meta): PackingService
    {
        return new class ($this->createMock(DocumentService::class), $meta) extends PackingService {
            /** @param array<string, mixed>|null $row */
            public function __construct(DocumentService $documents, private ?array $row)
            {
                parent::__construct($documents);
            }

            public function meta(int $cmpId, int $documentId): ?array
            {
                return $this->row;
            }
        };
    }

    public function testAListAnInvoiceHasAlreadyIssuedCannotBeReversed(): void
    {
        $refusal = null;
        try {
            $this->service(['document_id' => 55, 'packing_status' => 'consumed', 'locked_by_document_id' => 900, 'locked_by_external_ref' => null, 'locked_at' => null])
                ->assertReversible(101, ['document_type' => 'PACKING', 'document_id' => 55]);
        } catch (InventoryException $e) {
            $refusal = $e;
        }

        $this->assertNotNull($refusal, 'unwinding the pack movement would credit back goods that have shipped');
        $this->assertSame('invalid_state', $refusal->errorCode());
        $this->assertStringContainsString('#900', $refusal->getMessage(), 'the refusal names the invoice to reverse first');
    }

    public function testEveryOtherDocumentIsStillReversible(): void
    {
        foreach (['open', 'locked', 'unpacked'] as $status) {
            $this->service(['document_id' => 55, 'packing_status' => $status, 'locked_by_document_id' => null, 'locked_by_external_ref' => null, 'locked_at' => null])
                ->assertReversible(101, ['document_type' => 'PACKING', 'document_id' => 55]);
        }
        // A consumed list is the only thing this guards, so a sale naming one — the document that
        // must be reversible here, because reversing it is how the consignment comes back — passes.
        $this->service(['document_id' => 55, 'packing_status' => 'consumed', 'locked_by_document_id' => 900, 'locked_by_external_ref' => null, 'locked_at' => null])
            ->assertReversible(101, ['document_type' => 'SALES_ISSUE', 'document_id' => 900]);
        $this->service(null)->assertReversible(101, ['document_type' => 'PACKING', 'document_id' => 55]);

        $this->expectNotToPerformAssertions();
    }
}
