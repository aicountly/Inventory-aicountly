<?php

namespace Tests\Unit;

use App\Services\DocumentPostingService;
use App\Services\RecalculationService;
use Config\DocumentTypeRegistry;
use PHPUnit\Framework\TestCase;

/**
 * INWARD_CHALLAN is declared valuation => false and is at the same time listed in
 * COST_BEARING_SOURCE_RATE, whose comment calls "a GRN rate" one of the rates that IS the cost of
 * the goods. The two cannot both be policy: a challan that moves stock is a receipt, and a receipt
 * with no cost layer leaves on_hand holding goods the valuation pool does not know about.
 *
 * The decision is per document, not per type: a challan_only challan still moves nothing and still
 * values nothing, so reversing one must not reach into WAC state or the layers either.
 *
 * @group unit
 */
final class InwardChallanValuesMovedStockTest extends TestCase
{
    /** @return array<string, mixed> */
    private function spec(string $type): array
    {
        return DocumentTypeRegistry::get($type);
    }

    public function testAnInwardChallanValuesExactlyTheStockItMoves(): void
    {
        $spec = $this->spec('INWARD_CHALLAN');
        foreach (['settle_deferred', 'physical'] as $effect) {
            $this->assertTrue(DocumentPostingService::movesStockNow('INWARD_CHALLAN', $spec, $effect), $effect . ' moves stock');
            $this->assertTrue(DocumentPostingService::valuesLines('INWARD_CHALLAN', $spec, $effect), $effect . ' must open a cost layer');
        }
        $this->assertFalse(DocumentPostingService::movesStockNow('INWARD_CHALLAN', $spec, 'challan_only'));
        $this->assertFalse(DocumentPostingService::valuesLines('INWARD_CHALLAN', $spec, 'challan_only'), 'a pending quantity is not a receipt');
    }

    /** A type that declares valuation carries it whatever its stock_effect says. */
    public function testADeclaredValuationTypeIsUnaffected(): void
    {
        $this->assertTrue(DocumentPostingService::valuesLines('PURCHASE_RECEIPT', $this->spec('PURCHASE_RECEIPT'), 'defer_inward'));
        $this->assertFalse(DocumentPostingService::valuesLines('PACKING', $this->spec('PACKING'), ''));
        $this->assertFalse(DocumentPostingService::valuesLines('DELIVERY_CHALLAN', $this->spec('DELIVERY_CHALLAN'), 'challan_only'));
    }

    /** Only the inward challan values stock its type does not declare. */
    public function testTheRegistryNamesTheTypesThatValueMovedStock(): void
    {
        $this->assertTrue(DocumentTypeRegistry::valuesMovedStock('INWARD_CHALLAN'));
        $this->assertTrue(DocumentTypeRegistry::valuesMovedStock('inward_challan'));
        $this->assertFalse(DocumentTypeRegistry::valuesMovedStock('PACKING'));
        foreach (DocumentTypeRegistry::VALUES_MOVED_STOCK as $type) {
            $this->assertContains($type, DocumentTypeRegistry::COST_BEARING_SOURCE_RATE, 'a type that values moved stock must have a rate that is a cost');
        }
    }

    /**
     * The replay's guard refuses a job rather than invent a cost for a receipt that carries none.
     * A challan movement row exists only because the challan moved stock, which is exactly when
     * posting values it — so the guard must see it instead of waving it through to be replayed at
     * zero.
     */
    public function testAChallanMovementWithNoDecidedCostIsReportedAsUnpriced(): void
    {
        $movement = [
            'movement_id' => 1, 'line_id' => 501, 'document_id' => 90, 'qty' => 10.0,
            'document_type' => 'INWARD_CHALLAN', 'conversion_factor' => 1.0, 'line_qty' => 10.0,
            'source_transaction_rate' => null, 'source_transaction_amount' => null,
            'line_valuation_rate' => null, 'metadata_json' => null,
        ];

        $unpriced = RecalculationService::unpricedInwardMovements([$movement], []);

        $this->assertCount(1, $unpriced);
        $this->assertSame(501, $unpriced[0]['line_id']);
    }

    /** Priced from its own GRN rate, the same movement is replayable. */
    public function testAChallanMovementPricedByItsOwnRateIsReplayable(): void
    {
        $movement = [
            'movement_id' => 1, 'line_id' => 501, 'document_id' => 90, 'qty' => 10.0,
            'document_type' => 'INWARD_CHALLAN', 'conversion_factor' => 1.0, 'line_qty' => 10.0,
            'source_transaction_rate' => 150.0, 'source_transaction_amount' => 1500.0,
            'line_valuation_rate' => null, 'metadata_json' => null,
        ];

        $this->assertSame([], RecalculationService::unpricedInwardMovements([$movement], []));
        $this->assertEqualsWithDelta(150.0, (float) RecalculationService::decidedInwardUnitCost($movement), 0.0001);
    }
}
