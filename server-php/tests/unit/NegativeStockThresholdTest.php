<?php

namespace Tests\Unit;

use App\Services\StockBalanceService;
use PHPUnit\Framework\TestCase;

/**
 * The dashboard's negative-stock card is the red "act now" tile, and clicking it opens the stock
 * balance register with ?negative=1. Card and register therefore have to count the same rows: one
 * tolerance, one table, one branch predicate. They used to be two hand-written SQL fragments in
 * two files, and only one of them knew about the branch.
 *
 * @group unit
 */
final class NegativeStockThresholdTest extends TestCase
{
    public function testDustAboveTheToleranceIsNotNegativeStock(): void
    {
        $this->assertFalse(StockBalanceService::isNegativeOnHand(0.0));
        $this->assertFalse(StockBalanceService::isNegativeOnHand(-0.00004), 'rounding dust is not a stock problem');
        $this->assertTrue(StockBalanceService::isNegativeOnHand(-0.0001));
        $this->assertTrue(StockBalanceService::isNegativeOnHand(-12.5));
        $this->assertSame(-0.00005, StockBalanceService::NEGATIVE_ON_HAND_EPSILON);
    }

    public function testTheDashboardCountsThroughTheSameServiceAsTheRegister(): void
    {
        $dashboard = file_get_contents(APPPATH . 'Controllers/Api/V1/DashboardController.php');

        $this->assertStringContainsString('negativeStockCounts', $dashboard, 'the card must count the way the register filters');
        $this->assertStringNotContainsString('-0.00005', $dashboard, 'a second copy of the tolerance is how the two drift apart');
    }

    public function testTheBalanceRegisterOffersTheFilterTheCardDrillsTo(): void
    {
        $service = file_get_contents(APPPATH . 'Services/StockBalanceService.php');
        $controller = file_get_contents(APPPATH . 'Controllers/Api/V1/AvailabilityController.php');

        $this->assertStringContainsString("\$filters['negative']", $service);
        $this->assertStringContainsString('NEGATIVE_ON_HAND_EPSILON', $service);
        $this->assertStringContainsString("getGet('negative')", $controller);
    }
}
