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

    public function testSummaryBucketsCarryAnItemCountAndRowBucketsDoNot(): void
    {
        $this->assertSame(InventoryReportService::AGE_BUCKETS, array_keys(InventoryReportService::emptyAgeBucketTotals()));
        foreach (InventoryReportService::emptyAgeBucketTotals() as $b) {
            $this->assertSame(['qty' => 0.0, 'value' => 0.0, 'items' => 0], $b);
        }
        foreach (InventoryReportService::emptyAgeBuckets() as $b) {
            $this->assertArrayNotHasKey('items', $b, 'a row is one item; counting it on every row would be noise');
        }
    }

    public function testBucketSharesFallBackToQuantityWhenThereIsNoValue(): void
    {
        $buckets = self::buckets(['0_30' => [60.0, 600.0], '180_plus' => [40.0, 400.0]]);
        $byValue = InventoryReportService::ageBucketShares($buckets, 1000.0, 100.0);
        $this->assertEqualsWithDelta(0.6, $byValue['0_30'], 1e-9);
        $this->assertEqualsWithDelta(0.4, $byValue['180_plus'], 1e-9);
        $this->assertSame(0.0, $byValue['61_90']);

        // Free-issue stock still ages: no value to divide by, so quantity decides.
        $free = self::buckets(['0_30' => [25.0, 0.0], '91_180' => [75.0, 0.0]]);
        $byQty = InventoryReportService::ageBucketShares($free, 0.0, 100.0);
        $this->assertEqualsWithDelta(0.25, $byQty['0_30'], 1e-9);
        $this->assertEqualsWithDelta(0.75, $byQty['91_180'], 1e-9);

        $this->assertSame(0.0, InventoryReportService::ageBucketShares(InventoryReportService::emptyAgeBuckets(), 0.0, 0.0)['0_30']);
    }

    public function testHealthScoreIsTheWeightedPenaltyOnAgedValue(): void
    {
        $fresh = self::buckets(['0_30' => [10.0, 1000.0]]);
        $this->assertSame(100, InventoryReportService::healthScore($fresh, 1000.0, 10.0), 'everything inside 30 days');

        $inside60 = self::buckets(['0_30' => [5.0, 500.0], '31_60' => [5.0, 500.0]]);
        $this->assertSame(100, InventoryReportService::healthScore($inside60, 1000.0, 10.0), '31-60 carries no penalty');

        $allObsolete = self::buckets(['180_plus' => [10.0, 1000.0]]);
        $this->assertSame(40, InventoryReportService::healthScore($allObsolete, 1000.0, 10.0), '100 - 60');

        $allSlow = self::buckets(['91_180' => [10.0, 1000.0]]);
        $this->assertSame(75, InventoryReportService::healthScore($allSlow, 1000.0, 10.0), '100 - 25');

        $allWatch = self::buckets(['61_90' => [10.0, 1000.0]]);
        $this->assertSame(92, InventoryReportService::healthScore($allWatch, 1000.0, 10.0), '100 - 8');

        // Half fresh, a quarter slow, a quarter obsolete: 100 - 6.25 - 15 = 78.75 -> 79.
        $mixed = self::buckets(['0_30' => [5.0, 500.0], '91_180' => [2.5, 250.0], '180_plus' => [2.5, 250.0]]);
        $this->assertSame(79, InventoryReportService::healthScore($mixed, 1000.0, 10.0));

        $this->assertNull(InventoryReportService::healthScore(InventoryReportService::emptyAgeBuckets(), 0.0, 0.0), 'no stock scores nothing, not 100');
    }

    public function testHealthScoreIsClampedToZeroAndAHundred(): void
    {
        // Negative stock value inverts the shares; the score must still be a 0-100 figure.
        $odd = self::buckets(['180_plus' => [10.0, -5000.0], '0_30' => [1.0, 100.0]]);
        $score = InventoryReportService::healthScore($odd, -4900.0, 11.0);
        $this->assertNotNull($score);
        $this->assertGreaterThanOrEqual(0, $score);
        $this->assertLessThanOrEqual(100, $score);
    }

    public function testHealthBandsAreOrderedAndTotal(): void
    {
        $this->assertSame('excellent', InventoryReportService::healthBand(100));
        $this->assertSame('excellent', InventoryReportService::healthBand(90));
        $this->assertSame('healthy', InventoryReportService::healthBand(89));
        $this->assertSame('healthy', InventoryReportService::healthBand(75));
        $this->assertSame('watch', InventoryReportService::healthBand(74));
        $this->assertSame('watch', InventoryReportService::healthBand(60));
        $this->assertSame('at_risk', InventoryReportService::healthBand(59));
        $this->assertSame('at_risk', InventoryReportService::healthBand(40));
        $this->assertSame('critical', InventoryReportService::healthBand(39));
        $this->assertSame('critical', InventoryReportService::healthBand(0));
        $this->assertNull(InventoryReportService::healthBand(null));
    }

    public function testRowHealthTakesTheWorstBandHoldingAMeaningfulShare(): void
    {
        $this->assertSame('fresh', InventoryReportService::rowHealthStatus(self::buckets(['0_30' => [10.0, 1000.0]]), 1000.0, 10.0));
        $this->assertSame('healthy', InventoryReportService::rowHealthStatus(self::buckets(['0_30' => [5.0, 500.0], '31_60' => [5.0, 500.0]]), 1000.0, 10.0));
        $this->assertSame('watch', InventoryReportService::rowHealthStatus(self::buckets(['0_30' => [7.0, 700.0], '61_90' => [3.0, 300.0]]), 1000.0, 10.0));
        $this->assertSame('slow', InventoryReportService::rowHealthStatus(self::buckets(['0_30' => [7.0, 700.0], '91_180' => [3.0, 300.0]]), 1000.0, 10.0));
        $this->assertSame('obsolete', InventoryReportService::rowHealthStatus(self::buckets(['0_30' => [7.0, 700.0], '180_plus' => [3.0, 300.0]]), 1000.0, 10.0));

        // Worst-first: a fifth stranded past 180 days outranks a quarter sitting in 91-180.
        $both = self::buckets(['0_30' => [5.5, 550.0], '91_180' => [2.5, 250.0], '180_plus' => [2.0, 200.0]]);
        $this->assertSame('obsolete', InventoryReportService::rowHealthStatus($both, 1000.0, 10.0));

        // Just under the exposure share: not yet the row's headline.
        $under = self::buckets(['0_30' => [8.1, 810.0], '180_plus' => [1.9, 190.0]]);
        $this->assertSame('fresh', InventoryReportService::rowHealthStatus($under, 1000.0, 10.0));

        // Spread thin across the young bands with no majority anywhere -> watch.
        $spread = self::buckets(['0_30' => [3.0, 300.0], '31_60' => [2.5, 250.0], '61_90' => [1.5, 150.0], '91_180' => [1.5, 150.0], '180_plus' => [1.5, 150.0]]);
        $this->assertSame('watch', InventoryReportService::rowHealthStatus($spread, 1000.0, 10.0), 'no band reaches the exposure share and nothing holds a majority inside 60 days');

        $this->assertNull(InventoryReportService::rowHealthStatus(InventoryReportService::emptyAgeBuckets(), 0.0, 0.0));
    }

    public function testEveryRowHealthIsOneOfTheDeclaredStatuses(): void
    {
        foreach ([[10.0, 0.0, 0.0, 0.0, 0.0], [0.0, 10.0, 0.0, 0.0, 0.0], [0.0, 0.0, 10.0, 0.0, 0.0], [0.0, 0.0, 0.0, 10.0, 0.0], [0.0, 0.0, 0.0, 0.0, 10.0], [2.0, 2.0, 2.0, 2.0, 2.0], [4.0, 4.0, 1.0, 0.5, 0.5]] as $mix) {
            $buckets = [];
            $total = 0.0;
            foreach (InventoryReportService::AGE_BUCKETS as $i => $key) {
                $buckets[$key] = ['qty' => $mix[$i], 'value' => $mix[$i] * 100.0];
                $total += $mix[$i] * 100.0;
            }
            $status = InventoryReportService::rowHealthStatus($buckets, $total, array_sum($mix));
            $this->assertContains($status, InventoryReportService::HEALTH_STATUSES, 'mix ' . implode('/', $mix));
        }
    }

    /**
     * @param array<string, array{0: float, 1: float}> $filled
     * @return array<string, array{qty: float, value: float}>
     */
    private static function buckets(array $filled): array
    {
        $out = InventoryReportService::emptyAgeBuckets();
        foreach ($filled as $key => [$qty, $value]) {
            $out[$key] = ['qty' => $qty, 'value' => $value];
        }

        return $out;
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
