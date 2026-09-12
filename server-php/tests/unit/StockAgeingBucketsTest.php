<?php

namespace Tests\Unit;

use App\Services\InventoryReportService;
use PHPUnit\Framework\TestCase;

/**
 * Pure bucketing / classification arithmetic of InventoryReportService (no database).
 *
 * @group unit
 */
final class StockAgeingBucketsTest extends TestCase
{
    public function testAgeBucketBoundaries(): void
    {
        $this->assertSame('0_30', InventoryReportService::ageBucket(0));
        $this->assertSame('0_30', InventoryReportService::ageBucket(30));
        $this->assertSame('31_60', InventoryReportService::ageBucket(31));
        $this->assertSame('31_60', InventoryReportService::ageBucket(60));
        $this->assertSame('61_90', InventoryReportService::ageBucket(61));
        $this->assertSame('61_90', InventoryReportService::ageBucket(90));
        $this->assertSame('91_180', InventoryReportService::ageBucket(91));
        $this->assertSame('91_180', InventoryReportService::ageBucket(180));
        $this->assertSame('180_plus', InventoryReportService::ageBucket(181));
        $this->assertSame('180_plus', InventoryReportService::ageBucket(5000));
        $this->assertSame('0_30', InventoryReportService::ageBucket(-3), 'future-dated layers sit in the first bucket');
    }

    public function testBucketKeysAreStableAndOrdered(): void
    {
        $this->assertSame(['0_30', '31_60', '61_90', '91_180', '180_plus'], InventoryReportService::AGE_BUCKETS);
        $this->assertSame(InventoryReportService::AGE_BUCKETS, array_keys(InventoryReportService::emptyAgeBuckets()));
        $this->assertSame(InventoryReportService::AGE_BUCKETS, array_keys(InventoryReportService::AGE_BUCKET_LABELS));
        foreach (InventoryReportService::emptyAgeBuckets() as $b) {
            $this->assertSame(['qty' => 0.0, 'value' => 0.0], $b);
        }
    }

    public function testAgeDaysFromTimestampsIsDateOnlyAndNeverNegative(): void
    {
        $this->assertSame(0, InventoryReportService::ageDays('2026-04-01 23:59:59', '2026-04-01'));
        $this->assertSame(1, InventoryReportService::ageDays('2026-04-01 23:59:59', '2026-04-02 00:00:01'));
        $this->assertSame(30, InventoryReportService::ageDays('2026-04-01', '2026-05-01'));
        $this->assertSame(365, InventoryReportService::ageDays('2025-04-01', '2026-04-01'));
        $this->assertSame(0, InventoryReportService::ageDays('2026-06-01', '2026-04-01'), 'a layer dated after as-of is not negative');
        $this->assertSame(0, InventoryReportService::ageDays('garbage', '2026-04-01'));
    }

    public function testDaysBetweenIsSignedAndDstSafe(): void
    {
        $this->assertSame(-5, InventoryReportService::daysBetween('2026-04-10', '2026-04-05'));
        $this->assertSame(5, InventoryReportService::daysBetween('2026-04-05', '2026-04-10'));
        // Across a DST change (Europe) the whole-day count must not lose a day.
        $tz = date_default_timezone_get();
        date_default_timezone_set('Europe/London');
        try {
            $this->assertSame(1, InventoryReportService::daysBetween('2026-03-28', '2026-03-29'));
            $this->assertSame(31, InventoryReportService::daysBetween('2026-03-15', '2026-04-15'));
        } finally {
            date_default_timezone_set($tz);
        }
    }

    public function testThresholdsAreNormalisedToAscendingOrder(): void
    {
        $this->assertSame([30, 90, 180], InventoryReportService::normaliseThresholds(30, 90, 180));
        $this->assertSame([30, 30, 30], InventoryReportService::normaliseThresholds(30, 10, 5), 'slow / dead never below fast');
        $this->assertSame([1, 90, 180], InventoryReportService::normaliseThresholds(0, 90, 180), 'zero / negative fast_days -> 1');
        $this->assertSame([45, 45, 200], InventoryReportService::normaliseThresholds(45, 20, 200));
    }

    public function testMovementClassificationByRecencyOfLastIssue(): void
    {
        // fast: issued within fast_days and some outward qty in the period
        $this->assertSame('fast', InventoryReportService::classifyMovement(0, 12.0));
        $this->assertSame('fast', InventoryReportService::classifyMovement(30, 0.5));
        // issued recently but nothing went out in the analysed period -> slow, not fast
        $this->assertSame('slow', InventoryReportService::classifyMovement(10, 0.0));
        $this->assertSame('slow', InventoryReportService::classifyMovement(31, 100.0));
        $this->assertSame('slow', InventoryReportService::classifyMovement(90, 100.0));
        $this->assertSame('non_moving', InventoryReportService::classifyMovement(91, 100.0));
        $this->assertSame('non_moving', InventoryReportService::classifyMovement(180, 0.0));
        $this->assertSame('dead', InventoryReportService::classifyMovement(181, 0.0));
        $this->assertSame('dead', InventoryReportService::classifyMovement(400, 5.0), 'period qty cannot rescue a stale last issue');
    }

    public function testNeverIssuedItemsFallBackToLastMovement(): void
    {
        $this->assertSame('dead', InventoryReportService::classifyMovement(null, 0.0), 'no movement at all');
        $this->assertSame('non_moving', InventoryReportService::classifyMovement(null, 0.0, 30, 90, 180, 20), 'received recently, never issued');
        $this->assertSame('non_moving', InventoryReportService::classifyMovement(null, 0.0, 30, 90, 180, 180));
        $this->assertSame('dead', InventoryReportService::classifyMovement(null, 0.0, 30, 90, 180, 181));
    }

    public function testMovementClassificationHonoursCustomThresholds(): void
    {
        $this->assertSame('fast', InventoryReportService::classifyMovement(7, 1.0, 7, 14, 30));
        $this->assertSame('slow', InventoryReportService::classifyMovement(8, 1.0, 7, 14, 30));
        $this->assertSame('non_moving', InventoryReportService::classifyMovement(15, 1.0, 7, 14, 30));
        $this->assertSame('dead', InventoryReportService::classifyMovement(31, 1.0, 7, 14, 30));
        // unordered thresholds are normalised (fast 30 > slow 10 -> slow = 30)
        $this->assertSame('slow', InventoryReportService::classifyMovement(25, 0.0, 30, 10, 5));
        $this->assertSame('dead', InventoryReportService::classifyMovement(31, 5.0, 30, 10, 5));
        $this->assertContains('fast', InventoryReportService::MOVEMENT_CLASSES);
    }

    public function testReplenishmentNotTriggeredWithoutThresholdsOrAboveThem(): void
    {
        $none = InventoryReportService::suggestReplenishment(-5.0, null, null, null, null, null);
        $this->assertFalse($none['triggered']);
        $this->assertSame([], $none['reasons']);
        $this->assertSame(0.0, $none['suggested_qty']);
        $this->assertNull($none['target_qty']);

        $zero = InventoryReportService::suggestReplenishment(0.0, 0.0, 0.0, 0.0, 0.0, 0.0);
        $this->assertFalse($zero['triggered'], 'zero thresholds mean "not set"');

        $above = InventoryReportService::suggestReplenishment(51.0, 50.0, 10.0, 20.0, 200.0, 25.0);
        $this->assertFalse($above['triggered']);
        $this->assertSame(0.0, $above['suggested_qty']);
    }

    public function testReplenishmentTargetsMaxStockWhenSet(): void
    {
        $r = InventoryReportService::suggestReplenishment(50.0, 50.0, 10.0, null, 200.0, 25.0);
        $this->assertTrue($r['triggered'], 'projected == reorder point triggers');
        $this->assertSame(['reorder_point'], $r['reasons']);
        $this->assertSame('max_stock', $r['target_basis']);
        $this->assertSame(200.0, $r['target_qty']);
        $this->assertSame(150.0, $r['suggested_qty']);

        $neg = InventoryReportService::suggestReplenishment(-12.5, 50.0, 10.0, null, 200.0, null);
        $this->assertSame(212.5, $neg['suggested_qty'], 'negative projected stock is made good');
        $this->assertSame(['reorder_point', 'safety_stock'], $neg['reasons']);
    }

    public function testReplenishmentUsesReorderQtyAsFixedLotAboveThreshold(): void
    {
        $r = InventoryReportService::suggestReplenishment(40.0, 50.0, null, null, null, 25.0);
        $this->assertTrue($r['triggered']);
        $this->assertSame('reorder_qty', $r['target_basis']);
        $this->assertSame(75.0, $r['target_qty']);
        $this->assertSame(35.0, $r['suggested_qty'], 'reorder point 50 + lot 25 - projected 40');
        $this->assertGreaterThanOrEqual(25.0, $r['suggested_qty'], 'never less than the reorder lot when at/below the reorder point');
    }

    public function testReplenishmentFallsBackToHighestThreshold(): void
    {
        $r = InventoryReportService::suggestReplenishment(3.0, null, 8.0, 5.0, null, null);
        $this->assertTrue($r['triggered']);
        $this->assertSame(['safety_stock', 'min_stock'], $r['reasons']);
        $this->assertSame('threshold', $r['target_basis']);
        $this->assertSame(8.0, $r['target_qty']);
        $this->assertSame(5.0, $r['suggested_qty']);

        // safety stock breached but reorder point not (projected == safety stock is fine, < triggers)
        $this->assertFalse(InventoryReportService::suggestReplenishment(8.0, null, 8.0, null, null, null)['triggered']);
        $this->assertTrue(InventoryReportService::suggestReplenishment(7.9999, null, 8.0, null, null, null)['triggered']);
    }

    public function testReplenishmentRoundsToFourDecimals(): void
    {
        $r = InventoryReportService::suggestReplenishment(1.11111, 2.0, null, null, 10.33333, null);
        $this->assertSame(10.3333, $r['target_qty']);
        $this->assertSame(9.2222, $r['suggested_qty']);
        // max stock below the threshold never suggests less than reaching the threshold
        $low = InventoryReportService::suggestReplenishment(1.0, 20.0, null, null, 5.0, null);
        $this->assertSame(20.0, $low['target_qty']);
        $this->assertSame(19.0, $low['suggested_qty']);
    }
}
