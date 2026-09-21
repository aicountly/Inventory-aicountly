<?php

namespace Tests\Integration;

use App\Controllers\Api\V1\StockMovementsController;
use Tests\Support\IntegrationTestCase;

/**
 * The movement register's aggregate and its trend, over the WHOLE filtered set.
 *
 * `/v1/stock-movements?summary=1&trend=1` is what lets the register's KPI cards, its
 * pinned footer and its chart speak for every matching movement instead of the
 * twenty-five rows the page happened to serve. Both are hand-written aggregate SQL —
 * `CASE WHEN` sums, `COUNT(DISTINCT …)` across five joins, and a `date_trunc` grouping —
 * so the only test worth having is one that runs them against a real PostgreSQL and
 * checks the numbers.
 *
 * The rule the figures hang on, and the one thing to break if the SQL is ever rewritten:
 * INWARD AND OUTWARD ARE THE SIGN OF THE QUANTITY, not the `direction` column. A reversal
 * of a receipt is stored `direction = 'in'` with a negative quantity, and counting it as
 * inward would report goods arriving that actually left. `StockMovementsController::
 * ledger()` splits its own in / out the same way, and the two must not disagree.
 *
 * @group integration
 */
final class MovementSummaryTest extends IntegrationTestCase
{
    private int $itemA = 0;
    private int $itemB = 0;
    private int $warehouse = 0;
    /**
     * A fresh line for every movement.
     *
     * `uq_inv_stock_movements_line` is unique on
     * `(line_id, direction, movement_kind, COALESCE(reversal_of_movement_id, 0))`, which
     * is the database refusing to record the same document line moving the same way
     * twice. A fixture that reused one line id silently wrote fewer rows than it asked
     * for and made every aggregate below look wrong.
     */
    private int $nextLineId = 1;

    private function seedMasters(): void
    {
        $this->nextLineId = 1;
        $unit = $this->makeUnit();
        $this->itemA = $this->makeItem('Steel rod', $unit);
        $this->itemB = $this->makeItem('Cement', $unit);
        $this->warehouse = $this->makeWarehouse('Main');
    }

    private function makeDocument(string $no, string $date): int
    {
        $this->db->table('inv_documents')->insert([
            'cmp_id' => $this->cmpId, 'bo_id' => $this->boId, 'fy_id' => $this->fyId,
            'document_type' => 'MATERIAL_RECEIPT', 'document_no' => $no,
            'document_date' => $date, 'status' => 'POSTED',
        ]);

        return (int) $this->db->insertID();
    }

    /** One movement. `$qty` signed: negative is stock leaving. */
    private function makeMovement(
        int $documentId,
        int $itemId,
        string $date,
        float $qty,
        float $value,
        string $direction = 'in',
        string $kind = 'physical'
    ): void {
        $this->db->table('inv_stock_movements')->insert([
            'cmp_id' => $this->cmpId, 'fy_id' => $this->fyId, 'bo_id' => $this->boId,
            'document_id' => $documentId, 'line_id' => $this->nextLineId++,
            'document_type' => 'MATERIAL_RECEIPT', 'movement_date' => $date,
            'item_id' => $itemId, 'warehouse_id' => $this->warehouse,
            'direction' => $direction, 'qty' => $qty, 'unit_cost' => 1, 'value' => $value,
            'movement_kind' => $kind,
        ]);
    }

    /** The filtered, unpaged builder index() hands to summarise() and trendOver(). */
    private function builder()
    {
        return $this->db->table('inv_stock_movements m')
            ->join('inv_items i', 'i.item_id = m.item_id AND i.cmp_id = m.cmp_id', 'left')
            ->join('inv_documents d', 'd.document_id = m.document_id', 'left')
            ->where('m.cmp_id', $this->cmpId)
            ->where('m.fy_id', $this->fyId);
    }

    public function testTotalsEveryMatchingMovementRatherThanAPage(): void
    {
        $this->seedMasters();
        $doc = $this->makeDocument('MR-1', '2026-04-10');
        $this->makeMovement($doc, $this->itemA, '2026-04-10', 100, 1000);
        $this->makeMovement($doc, $this->itemB, '2026-04-11', 40, 400);
        $this->makeMovement($doc, $this->itemA, '2026-04-12', -30, -300, 'out');

        $summary = StockMovementsController::summarise($this->builder());

        $this->assertSame(3, $summary['movements']);
        $this->assertSame(140.0, $summary['in_qty']);
        $this->assertSame(30.0, $summary['out_qty']);
        $this->assertSame(110.0, $summary['net_qty'], 'net is in less out');
        $this->assertSame(1400.0, $summary['in_value']);
        $this->assertSame(300.0, $summary['out_value'], 'outward value is reported positive');
        $this->assertSame(1100.0, $summary['net_value']);
    }

    public function testAReversalCountsByTheSignOfItsQuantityNotItsDirectionColumn(): void
    {
        $this->seedMasters();
        $doc = $this->makeDocument('MR-2', '2026-04-10');
        $this->makeMovement($doc, $this->itemA, '2026-04-10', 100, 1000);
        // The reversal of that receipt: direction 'in', quantity negative. Stock left.
        $this->makeMovement($doc, $this->itemA, '2026-04-11', -100, -1000, 'in', 'reversal');

        $summary = StockMovementsController::summarise($this->builder());

        $this->assertSame(100.0, $summary['in_qty'], 'the reversal must not be counted as a receipt');
        $this->assertSame(100.0, $summary['out_qty']);
        $this->assertSame(0.0, $summary['net_qty'], 'a receipt and its reversal net to nothing');
        $this->assertSame(0.0, $summary['net_value']);
    }

    public function testCountsDistinctItemsAndDocumentsNotRows(): void
    {
        $this->seedMasters();
        $first = $this->makeDocument('MR-3', '2026-04-10');
        $second = $this->makeDocument('MR-4', '2026-04-11');
        $this->makeMovement($first, $this->itemA, '2026-04-10', 10, 100);
        $this->makeMovement($first, $this->itemA, '2026-04-10', 5, 50);
        $this->makeMovement($second, $this->itemB, '2026-04-11', 7, 70);

        $summary = StockMovementsController::summarise($this->builder());

        $this->assertSame(3, $summary['movements']);
        $this->assertSame(2, $summary['items']);
        $this->assertSame(2, $summary['documents']);
    }

    public function testAMovementWithNoValueCountsWithoutAddingValue(): void
    {
        $this->seedMasters();
        $doc = $this->makeDocument('MR-5', '2026-04-10');
        $this->db->table('inv_stock_movements')->insert([
            'cmp_id' => $this->cmpId, 'fy_id' => $this->fyId, 'bo_id' => $this->boId,
            'document_id' => $doc, 'line_id' => $this->nextLineId++, 'document_type' => 'MATERIAL_RECEIPT',
            'movement_date' => '2026-04-10', 'item_id' => $this->itemA,
            'warehouse_id' => $this->warehouse, 'direction' => 'in', 'qty' => 12,
            'unit_cost' => null, 'value' => null, 'movement_kind' => 'physical',
        ]);

        $summary = StockMovementsController::summarise($this->builder());

        $this->assertSame(1, $summary['movements']);
        $this->assertSame(12.0, $summary['in_qty']);
        $this->assertSame(0.0, $summary['in_value'], 'a null value must not poison the sum');
        $this->assertSame(0.0, $summary['net_value']);
    }

    public function testAnEmptyRegisterAggregatesToZeroRatherThanToNull(): void
    {
        $this->seedMasters();

        $summary = StockMovementsController::summarise($this->builder());

        $this->assertSame(0, $summary['movements']);
        $this->assertSame(0.0, $summary['in_qty']);
        $this->assertSame(0.0, $summary['net_value']);
    }

    public function testThePreviousWindowIsTheSameLengthAndEndsTheDayBefore(): void
    {
        // Thirty days to 19 September: the window before it is the thirty days ending
        // on the 20th of August. A window of a different length would make the
        // percentage on the card a comparison between two different spans of time.
        $this->assertSame(
            ['from' => '2026-07-22', 'to' => '2026-08-20'],
            StockMovementsController::previousWindow('2026-08-21', '2026-09-19')
        );
        $this->assertSame(
            ['from' => '2026-09-18', 'to' => '2026-09-18'],
            StockMovementsController::previousWindow('2026-09-19', '2026-09-19'),
            'a one-day register compares against the day before'
        );
    }

    public function testThereIsNoPreviousWindowForAnOpenEndedPeriod(): void
    {
        // "The period before all of time" is not a window, and a percentage drawn
        // against it would be computed from two different lengths of time.
        $this->assertNull(StockMovementsController::previousWindow(null, '2026-09-19'));
        $this->assertNull(StockMovementsController::previousWindow('2026-04-01', null));
        $this->assertNull(StockMovementsController::previousWindow(null, null));
        $this->assertNull(StockMovementsController::previousWindow('2026-09-19', '2026-04-01'));
    }

    public function testTheTrendBucketsByDayForAShortPeriod(): void
    {
        $this->seedMasters();
        $doc = $this->makeDocument('MR-6', '2026-04-10');
        $this->makeMovement($doc, $this->itemA, '2026-04-10', 10, 100);
        $this->makeMovement($doc, $this->itemA, '2026-04-10', 5, 50);
        $this->makeMovement($doc, $this->itemA, '2026-04-12', -4, -40, 'out');

        $trend = StockMovementsController::trendOver($this->builder(), '2026-04-01', '2026-04-30');

        $this->assertSame('day', $trend['bucket']);
        $this->assertFalse($trend['truncated']);
        $this->assertSame(['2026-04-10', '2026-04-12'], array_column($trend['points'], 'bucket'));
        $this->assertSame(15.0, $trend['points'][0]['in_qty'], 'the day is the sum of its movements');
        $this->assertSame(0.0, $trend['points'][0]['out_qty']);
        $this->assertSame(2, $trend['points'][0]['movements']);
        $this->assertSame(4.0, $trend['points'][1]['out_qty']);
        $this->assertSame(40.0, $trend['points'][1]['out_value'], 'outward value is reported positive');
    }

    public function testTheTrendWidensToWeeksOverAQuarterAndStartsThemOnMonday(): void
    {
        $this->seedMasters();
        $doc = $this->makeDocument('MR-7', '2026-04-10');
        // 2026-09-14 is a Monday; the 19th is the Saturday of the same week, and the
        // 21st opens the next one. The client re-buckets day → week with the same rule,
        // so a disagreement here would shift every column it draws.
        $this->makeMovement($doc, $this->itemA, '2026-09-14', 10, 100);
        $this->makeMovement($doc, $this->itemA, '2026-09-19', 5, 50);
        $this->makeMovement($doc, $this->itemA, '2026-09-21', 3, 30);

        $trend = StockMovementsController::trendOver($this->builder(), '2026-06-01', '2026-09-30');

        $this->assertSame('week', $trend['bucket']);
        $this->assertSame(['2026-09-14', '2026-09-21'], array_column($trend['points'], 'bucket'));
        $this->assertSame(15.0, $trend['points'][0]['in_qty']);
        $this->assertSame(3.0, $trend['points'][1]['in_qty']);
    }

    public function testTheTrendWidensToMonthsOverMoreThanAYearAndOverAnOpenPeriod(): void
    {
        $this->seedMasters();
        $doc = $this->makeDocument('MR-8', '2026-04-10');
        $this->makeMovement($doc, $this->itemA, '2026-04-10', 10, 100);
        $this->makeMovement($doc, $this->itemA, '2026-04-28', 5, 50);
        $this->makeMovement($doc, $this->itemA, '2026-05-02', 2, 20);

        $spanning = StockMovementsController::trendOver($this->builder(), '2025-04-01', '2026-09-30');
        $this->assertSame('month', $spanning['bucket']);
        $this->assertSame(['2026-04-01', '2026-05-01'], array_column($spanning['points'], 'bucket'));
        $this->assertSame(15.0, $spanning['points'][0]['in_qty']);

        // `all_fy=1` with no dates: bounded by the data, not by a span.
        $unbounded = StockMovementsController::trendOver($this->builder(), null, null);
        $this->assertSame('month', $unbounded['bucket']);
        $this->assertSame(['2026-04-01', '2026-05-01'], array_column($unbounded['points'], 'bucket'));
    }

    public function testTheAggregateAndTheTrendAgreeWithEachOther(): void
    {
        // They are two queries over one builder, and the register prints them side by
        // side — the cards above the chart and the chart below them. If they ever
        // disagree, the screen contradicts itself.
        $this->seedMasters();
        $doc = $this->makeDocument('MR-9', '2026-04-10');
        $this->makeMovement($doc, $this->itemA, '2026-04-10', 10, 100);
        $this->makeMovement($doc, $this->itemB, '2026-04-18', 7, 70);
        $this->makeMovement($doc, $this->itemA, '2026-04-25', -6, -60, 'out');

        $summary = StockMovementsController::summarise($this->builder());
        $trend = StockMovementsController::trendOver($this->builder(), '2026-04-01', '2026-04-30');

        $this->assertSame($summary['in_qty'], array_sum(array_column($trend['points'], 'in_qty')));
        $this->assertSame($summary['out_qty'], array_sum(array_column($trend['points'], 'out_qty')));
        $this->assertSame($summary['movements'], array_sum(array_column($trend['points'], 'movements')));
    }
}
