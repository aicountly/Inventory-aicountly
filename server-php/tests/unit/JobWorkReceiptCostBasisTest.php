<?php

namespace Tests\Unit;

use App\Services\DocumentPostingService;
use App\Services\ValuationEngine;
use App\Services\ValuationReplayService;
use Config\DocumentTypeRegistry;
use PHPUnit\Framework\TestCase;

/**
 * What a job-work receipt cost and what its challan declares are two different numbers.
 *
 * A JOB_WORK_IN line's source_transaction_rate is the value agreed with the job worker, and Books
 * files exactly that figure as the Value of every Table 5 row of FORM GST ITC-04. While the type
 * also sat in DocumentTypeRegistry::COST_BEARING_SOURCE_RATE the same number was adopted as the
 * inward unit cost, so the one rate the form asks for had to be two incomparable things at once:
 * entered as the challan value it re-priced closing stock at whatever was agreed with the job
 * worker, and entered as the cost it filed a valuation in a statutory column the department
 * reconciles against a challan.
 *
 * @group unit
 */
final class JobWorkReceiptCostBasisTest extends TestCase
{
    /** What the item last came in at — the only thing left once the commercial rate is refused. */
    public const FALLBACK = 640.0;

    private const CMP = 7;

    private function posting(): DocumentPostingService
    {
        $engine = new class extends ValuationEngine {
            public function scopeWarehouse(int $cmpId, ?int $warehouseId): ?int
            {
                return $warehouseId;
            }

            public function resolveFallbackUnitCost($db, int $cmpId, int $itemId, ?int $wh): float
            {
                return JobWorkReceiptCostBasisTest::FALLBACK;
            }
        };

        return new DocumentPostingService(null, $engine);
    }

    /** A receipt line as the job-work form sends it: quantity, the challan rate, and its cost. */
    private function receiptLine(?float $valuationRate = null): array
    {
        return [
            'item_id' => 90, 'warehouse_id' => 3, 'qty' => 10.0, 'conversion_factor' => 1.0,
            'source_transaction_rate' => 1250.0, 'source_transaction_amount' => 12500.0,
            'valuation_rate' => $valuationRate, 'metadata' => [],
        ];
    }

    /** @param array<string, mixed> $line */
    private function unitCost(string $type, array $line): float
    {
        $m = new \ReflectionMethod(DocumentPostingService::class, 'inwardUnitCost');
        $m->setAccessible(true);

        return (float) $m->invoke($this->posting(), self::CMP, ['document_type' => $type, 'metadata' => []], $line, [$line]);
    }

    public function testTheValueAgreedWithTheJobWorkerNeverPricesTheGoodsComingBack(): void
    {
        $cost = $this->unitCost('JOB_WORK_IN', $this->receiptLine());

        $this->assertNotEqualsWithDelta(1250.0, $cost, 0.0001, 'the challan value is commercial — costing stock from it re-prices closing stock at what was agreed');
        $this->assertEqualsWithDelta(self::FALLBACK, $cost, 0.0001);
    }

    /** Inventory's own column still decides: the operator types the cost of the returning goods. */
    public function testTheLinesValuationRateStillPricesTheReceipt(): void
    {
        $this->assertEqualsWithDelta(610.0, $this->unitCost('JOB_WORK_IN', $this->receiptLine(610.0)), 0.0001);
    }

    /** The rule is about commercial rates, not about every inward rate. */
    public function testAPurchaseRateIsStillTheCostOfWhatWasBought(): void
    {
        $this->assertEqualsWithDelta(1250.0, $this->unitCost('PURCHASE_RECEIPT', $this->receiptLine()), 0.0001);
    }

    public function testTheRegistryNoLongerCallsAJobWorkReceiptsRateACost(): void
    {
        $this->assertNotContains('JOB_WORK_IN', DocumentTypeRegistry::COST_BEARING_SOURCE_RATE);
        $this->assertContains('PURCHASE_RECEIPT', DocumentTypeRegistry::COST_BEARING_SOURCE_RATE);
    }

    /**
     * The replay carries its own copy of the list, and a what-if that still costed a receipt from
     * the challan value would answer with the very mixture the separation exists to prevent.
     */
    public function testTheValuationReplayReadsThePostedCostForAReceiptToo(): void
    {
        $source = (string) file_get_contents((string) (new \ReflectionClass(ValuationReplayService::class))->getFileName());

        $this->assertStringNotContainsString("'JOB_WORK_IN'", $source);
        $this->assertStringContainsString("'PURCHASE_RECEIPT'", $source);
    }
}
