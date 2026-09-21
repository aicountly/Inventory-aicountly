<?php

namespace Tests\Integration;

use App\Services\PendingRegisterPolicy;
use App\Services\PendingRegisterQuery;
use Tests\Support\IntegrationTestCase;

/**
 * The pending-quantity register's read side, against a real PostgreSQL.
 *
 * Everything this class asserts is computed in SQL — the filtering, the ordering,
 * the paging, the derived ageing / due date / status / priority, the aggregate
 * over the whole filtered set and the historical reconstruction behind the KPI
 * deltas. None of it can be checked by reading the code: the expressions only
 * exist as strings until Postgres parses them, and the production server runs 13
 * while a developer's machine may not.
 *
 * So these tests are deliberately about the SQL rather than about PHP branching.
 * A silent typo in a CASE arm, a bind threaded through the wrong placeholder, or
 * a window function the production server rejects would all pass a unit test and
 * fail on the first real request.
 *
 * @group integration
 */
final class PendingRegisterQueryTest extends IntegrationTestCase
{
    private int $unit;
    private int $item;
    private int $otherItem;
    private int $warehouse;
    private int $otherWarehouse;

    protected function setUp(): void
    {
        parent::setUp();
        $this->unit = $this->makeUnit();
        $this->item = $this->makeItem('TATA Steel Rod 8mm', $this->unit);
        $this->otherItem = $this->makeItem('UltraTech Cement 50kg', $this->unit);
        $this->warehouse = $this->makeWarehouse('Main - Delhi');
        $this->otherWarehouse = $this->makeWarehouse('North - Noida');
        PendingRegisterPolicy::flush();
    }

    /**
     * One pending line on its own document.
     *
     * `$daysAgo` drives the document date, so ageing and lateness are relative to
     * the day the suite runs rather than to a date that goes stale.
     */
    private function seed(array $over = []): int
    {
        $daysAgo = (int) ($over['days_ago'] ?? 10);
        $docDate = date('Y-m-d', strtotime("-{$daysAgo} days"));
        $this->db->table('inv_documents')->insert([
            'cmp_id'               => $this->cmpId,
            'bo_id'                => (int) ($over['bo_id'] ?? 0),
            'fy_id'                => $this->fyId,
            'document_type'        => $over['document_type'] ?? 'DELIVERY_CHALLAN',
            'document_no'          => $over['document_no'] ?? ('DC-' . random_int(1000, 9999)),
            'document_date'        => $docDate,
            'status'               => 'POSTED',
            'party_ref'            => $over['party_ref'] ?? null,
            'party_name'           => $over['party_name'] ?? null,
            'expected_return_date' => $over['expected_return_date'] ?? null,
        ]);
        $documentId = (int) $this->db->insertID();

        $lineId = null;
        if (array_key_exists('valuation_rate', $over)) {
            $this->db->table('inv_document_lines')->insert([
                'cmp_id'         => $this->cmpId,
                'fy_id'          => $this->fyId,
                'document_id'    => $documentId,
                'item_id'        => $over['item_id'] ?? $this->item,
                'unit_id'        => $this->unit,
                'direction'      => $over['direction'] ?? 'out',
                'qty'            => $over['qty_original'] ?? 100,
                'base_qty'       => $over['qty_original'] ?? 100,
                'valuation_rate' => $over['valuation_rate'],
            ]);
            $lineId = (int) $this->db->insertID();
        }

        $this->db->table('inv_pending_quantities')->insert([
            'cmp_id'       => $this->cmpId,
            'fy_id'        => $this->fyId,
            'document_id'  => $documentId,
            'line_id'      => $lineId,
            'pending_kind' => $over['pending_kind'] ?? 'challan',
            'direction'    => $over['direction'] ?? 'out',
            'item_id'      => $over['item_id'] ?? $this->item,
            'unit_id'      => $this->unit,
            'warehouse_id' => array_key_exists('warehouse_id', $over) ? $over['warehouse_id'] : $this->warehouse,
            'party_ref'    => $over['party_ref'] ?? null,
            'qty_original' => $over['qty_original'] ?? 100,
            'qty_settled'  => $over['qty_settled'] ?? 0,
            'status'       => $over['status'] ?? 'open',
            'created_at'   => $over['created_at'] ?? ($docDate . ' 10:00:00'),
            'updated_at'   => $over['updated_at'] ?? ($docDate . ' 10:00:00'),
        ]);

        return (int) $this->db->insertID();
    }

    private function settle(int $pendingId, float $qty, string $when): void
    {
        $this->db->table('inv_pending_settlements')->insert([
            'cmp_id'             => $this->cmpId,
            'pending_id'         => $pendingId,
            'settle_document_id' => 0,
            'qty_settled'        => $qty,
            'created_at'         => $when,
        ]);
    }

    private function query(int $boId = 0): PendingRegisterQuery
    {
        return new PendingRegisterQuery($this->cmpId, $boId);
    }

    /** @param array<string, mixed> $input */
    private function filters(array $input = []): array
    {
        return PendingRegisterQuery::normaliseFilters($input);
    }

    // ---------------------------------------------------------------- rows

    public function testOpenQuantityIsOriginalLessSettledAndNeverNegative(): void
    {
        $this->seed(['qty_original' => 500, 'qty_settled' => 200, 'status' => 'partial']);
        $page = $this->query()->page($this->filters(), 'document_date', 'asc', 50, 0);

        $this->assertSame(1, $page['total']);
        $row = $page['rows'][0];
        $this->assertSame(500.0, $row['qty_original']);
        $this->assertSame(200.0, $row['qty_settled']);
        $this->assertSame(300.0, $row['qty_open'], 'open = original - settled');
        $this->assertGreaterThanOrEqual(0, $row['qty_open']);
    }

    public function testDecimalQuantitiesSurviveTheRoundTrip(): void
    {
        $this->seed(['qty_original' => 1250.755, 'qty_settled' => 0.005]);
        $row = $this->query()->page($this->filters(), 'document_date', 'asc', 50, 0)['rows'][0];

        $this->assertSame(1250.755, $row['qty_original']);
        $this->assertSame(1250.75, $row['qty_open'], 'four-decimal arithmetic, not float drift');
    }

    public function testAgeingRunsFromTheDocumentDate(): void
    {
        $this->seed(['days_ago' => 28]);
        $row = $this->query()->page($this->filters(), 'document_date', 'asc', 50, 0)['rows'][0];

        $this->assertSame(28, $row['ageing_days']);
    }

    /**
     * The document's own promise wins; the company's grace period only stands in
     * where no promise was made, and the row says which of the two it got.
     */
    public function testExpectedDateDecidesLatenessWhenTheDocumentRecordedOne(): void
    {
        $this->seed([
            'days_ago'             => 5,
            'expected_return_date' => date('Y-m-d', strtotime('-2 days')),
            'document_no'          => 'JW-0001',
        ]);
        $row = $this->query()->page($this->filters(), 'document_date', 'asc', 50, 0)['rows'][0];

        $this->assertTrue($row['has_expected_date']);
        $this->assertTrue($row['is_overdue'], 'five days old but two days past its promise');
        $this->assertSame(2, $row['days_overdue']);
        $this->assertSame('overdue', $row['status']);
    }

    public function testWithoutAnExpectedDateTheGracePeriodStandsIn(): void
    {
        $grace = (new PendingRegisterPolicy())->forCompany($this->cmpId)['grace_days'];
        $this->seed(['days_ago' => $grace - 1, 'document_no' => 'DC-YOUNG']);
        $this->seed(['days_ago' => $grace + 3, 'document_no' => 'DC-OLD']);

        $rows = $this->query()->page($this->filters(), 'document_no', 'asc', 50, 0)['rows'];
        $byNo = array_column($rows, null, 'document_no');

        $this->assertFalse($byNo['DC-YOUNG']['is_overdue'], 'inside the grace period');
        $this->assertFalse($byNo['DC-YOUNG']['has_expected_date']);
        $this->assertTrue($byNo['DC-OLD']['is_overdue'], 'past it');
        $this->assertSame('open', $byNo['DC-YOUNG']['status']);
        $this->assertSame('overdue', $byNo['DC-OLD']['status']);
    }

    public function testPendingValueUsesTheLineRateThenFallsBackToWeightedAverage(): void
    {
        // A line that captured its own valuation rate.
        $this->seed(['document_no' => 'DC-RATED', 'qty_original' => 10, 'valuation_rate' => 250]);
        // A line with none, whose item has a weighted average on record.
        $this->db->table('inv_wac_state')->insert([
            'cmp_id' => $this->cmpId, 'item_id' => $this->otherItem, 'warehouse_id' => 0,
            'qty_on_hand' => 100, 'average_cost' => 40,
        ]);
        $this->seed(['document_no' => 'DC-WAC', 'qty_original' => 10, 'item_id' => $this->otherItem]);

        $rows = array_column($this->query()->page($this->filters(), 'document_no', 'asc', 50, 0)['rows'], null, 'document_no');

        $this->assertSame(250.0, $rows['DC-RATED']['unit_cost']);
        $this->assertSame(2500.0, $rows['DC-RATED']['pending_value']);
        $this->assertSame(40.0, $rows['DC-WAC']['unit_cost'], 'falls back to the item average');
        $this->assertSame(400.0, $rows['DC-WAC']['pending_value']);
    }

    public function testASettlementInsideTheWindowReadsAsSettlingRatherThanPartial(): void
    {
        $window = (new PendingRegisterPolicy())->forCompany($this->cmpId)['settling_window_days'];
        $this->seed([
            'document_no' => 'DC-MOVING', 'days_ago' => 3, 'qty_original' => 100, 'qty_settled' => 40,
            'status' => 'partial', 'updated_at' => date('Y-m-d H:i:s'),
        ]);
        $this->seed([
            'document_no' => 'DC-STALLED', 'days_ago' => 12, 'qty_original' => 100, 'qty_settled' => 40,
            'status' => 'partial', 'updated_at' => date('Y-m-d H:i:s', strtotime('-' . ($window + 5) . ' days')),
        ]);

        $rows = array_column($this->query()->page($this->filters(), 'document_no', 'asc', 50, 0)['rows'], null, 'document_no');

        $this->assertSame('settling', $rows['DC-MOVING']['status']);
        $this->assertSame('partial', $rows['DC-STALLED']['status']);
    }

    public function testPriorityNeedsTwoReasonsBeforeItReadsHigh(): void
    {
        $policy = (new PendingRegisterPolicy())->forCompany($this->cmpId);

        // Merely late: one reason.
        $this->seed([
            'document_no'          => 'DC-LATE',
            'days_ago'             => 3,
            'expected_return_date' => date('Y-m-d', strtotime('-1 day')),
            'qty_original'         => 1,
            'valuation_rate'       => 1,
        ]);
        // Late, badly late, and valuable: three.
        $this->seed([
            'document_no'          => 'DC-URGENT',
            'days_ago'             => 3,
            'expected_return_date' => date('Y-m-d', strtotime('-' . ($policy['high_overdue_days'] + 5) . ' days')),
            'qty_original'         => 1000,
            'valuation_rate'       => $policy['high_value'],
        ]);
        // Young, cheap, in date: none.
        $this->seed(['document_no' => 'DC-CALM', 'days_ago' => 1, 'qty_original' => 1, 'valuation_rate' => 1]);

        $rows = array_column($this->query()->page($this->filters(), 'document_no', 'asc', 50, 0)['rows'], null, 'document_no');

        $this->assertSame('medium', $rows['DC-LATE']['priority']);
        $this->assertSame('high', $rows['DC-URGENT']['priority']);
        $this->assertSame('low', $rows['DC-CALM']['priority']);
    }

    // ------------------------------------------------------------ filtering

    public function testEveryDeclaredFilterNarrowsInSql(): void
    {
        $this->seed(['document_no' => 'A', 'direction' => 'out', 'pending_kind' => 'challan', 'qty_original' => 10]);
        $this->seed([
            'document_no' => 'B', 'direction' => 'in', 'pending_kind' => 'job_work', 'qty_original' => 900,
            'item_id' => $this->otherItem, 'warehouse_id' => $this->otherWarehouse,
            'party_ref' => 88, 'party_name' => 'Sharma Traders', 'valuation_rate' => 100,
        ]);

        $q = $this->query();
        $only = fn (array $f) => array_column($q->page($this->filters($f), 'document_no', 'asc', 50, 0)['rows'], 'document_no');

        $this->assertSame(['A'], $only(['direction' => 'out']));
        $this->assertSame(['B'], $only(['direction' => 'in']));
        $this->assertSame(['B'], $only(['kind' => 'job_work']));
        $this->assertSame(['B'], $only(['item_id' => $this->otherItem]));
        $this->assertSame(['B'], $only(['warehouse_id' => $this->otherWarehouse]));
        $this->assertSame(['B'], $only(['party_ref' => 88]));
        $this->assertSame(['B'], $only(['item_search' => 'ultratech']), 'case-insensitive item search');
        $this->assertSame(['B'], $only(['min_open_qty' => 500]));
        $this->assertSame(['A'], $only(['max_open_qty' => 500]));
        $this->assertSame(['B'], $only(['min_pending_value' => 1000]));
        $this->assertSame(['A', 'B'], $only([]), 'no filter, both rows');
    }

    public function testStatusFilterCanReachSettledAndCancelledRowsTheRegisterOtherwiseHides(): void
    {
        $this->seed(['document_no' => 'OPEN', 'status' => 'open']);
        $this->seed(['document_no' => 'DONE', 'status' => 'settled', 'qty_original' => 10, 'qty_settled' => 10]);
        $this->seed(['document_no' => 'VOID', 'status' => 'cancelled']);

        $q = $this->query();
        $only = fn (array $f) => array_column($q->page($this->filters($f), 'document_no', 'asc', 50, 0)['rows'], 'document_no');

        $this->assertSame(['OPEN'], $only([]), 'the register shows what is outstanding');
        $this->assertSame(['DONE'], $only(['status' => 'settled']));
        $this->assertSame(['VOID'], $only(['status' => 'cancelled']));
        $this->assertSame(['DONE', 'OPEN'], $only(['status' => 'open,settled']));
    }

    public function testOverdueAndAgeingBucketFiltersAgreeWithTheAgeingTheRowReports(): void
    {
        $this->seed(['document_no' => 'YOUNG', 'days_ago' => 3]);
        $this->seed(['document_no' => 'MIDDLE', 'days_ago' => 20]);
        $this->seed(['document_no' => 'ANCIENT', 'days_ago' => 200]);

        $q = $this->query();
        $only = fn (array $f) => array_column($q->page($this->filters($f), 'document_no', 'asc', 50, 0)['rows'], 'document_no');

        $this->assertSame(['YOUNG'], $only(['ageing_bucket' => '0_7']));
        $this->assertSame(['MIDDLE'], $only(['ageing_bucket' => '16_30']));
        $this->assertSame(['ANCIENT'], $only(['ageing_bucket' => '60_']));
        $this->assertSame(['ANCIENT'], $only(['overdue_only' => '1']), 'only the one past its grace period');
        $this->assertSame(['MIDDLE'], $only(['ageing_from' => 10, 'ageing_to' => 30]));
    }

    public function testBranchScopeFollowsTheDocumentThatRaisedTheLine(): void
    {
        $this->seed(['document_no' => 'NORTH', 'bo_id' => 7]);
        $this->seed(['document_no' => 'SOUTH', 'bo_id' => 9]);

        $all = $this->query(0)->page($this->filters(), 'document_no', 'asc', 50, 0);
        $north = $this->query(7)->page($this->filters(), 'document_no', 'asc', 50, 0);

        $this->assertSame(2, $all['total']);
        $this->assertSame(1, $north['total']);
        $this->assertSame('NORTH', $north['rows'][0]['document_no']);
    }

    public function testTenantIsolation(): void
    {
        $this->seed(['document_no' => 'MINE']);
        $other = new PendingRegisterQuery($this->cmpId + 1, 0);

        $this->assertSame(0, $other->page($this->filters(), 'document_date', 'asc', 50, 0)['total']);
    }

    // ------------------------------------------------- ordering and paging

    public function testEverySortableColumnOrdersWithoutError(): void
    {
        $this->seed(['document_no' => 'A', 'days_ago' => 4, 'party_ref' => 2, 'valuation_rate' => 5]);
        $this->seed(['document_no' => 'B', 'days_ago' => 40, 'party_ref' => 1, 'valuation_rate' => 500]);

        // Every key the whitelist offers has to survive both directions: the web
        // app draws a sort control for each and the endpoint must honour it.
        foreach (array_keys(PendingRegisterQuery::SORTABLE) as $sort) {
            foreach (['asc', 'desc'] as $order) {
                $page = $this->query()->page($this->filters(), $sort, $order, 50, 0);
                $this->assertSame(2, $page['total'], "sorting by {$sort} {$order} changed the result set");
            }
        }
    }

    public function testSortingIsAppliedOverTheWholeSetAndPagesDoNotRepeatRows(): void
    {
        foreach (range(1, 12) as $i) {
            $this->seed(['document_no' => sprintf('DC-%03d', $i), 'qty_original' => $i * 10]);
        }

        $q = $this->query();
        $first = $q->page($this->filters(), 'qty_open', 'desc', 5, 0);
        $second = $q->page($this->filters(), 'qty_open', 'desc', 5, 5);

        $this->assertSame(12, $first['total'], 'total is the whole filtered set, not the page');
        $this->assertSame([120.0, 110.0, 100.0, 90.0, 80.0], array_column($first['rows'], 'qty_open'));
        $this->assertSame([70.0, 60.0, 50.0, 40.0, 30.0], array_column($second['rows'], 'qty_open'));
        $this->assertSame(
            [],
            array_intersect(array_column($first['rows'], 'pending_id'), array_column($second['rows'], 'pending_id')),
            'no row appears on two pages',
        );
    }

    public function testTiedRowsKeepOneStableOrderAcrossPages(): void
    {
        foreach (range(1, 6) as $i) {
            $this->seed(['document_no' => "SAME-{$i}", 'days_ago' => 5, 'qty_original' => 100]);
        }

        $q = $this->query();
        $ids = [];
        foreach ([0, 3] as $offset) {
            foreach ($q->page($this->filters(), 'document_date', 'asc', 3, $offset)['rows'] as $row) {
                $ids[] = $row['pending_id'];
            }
        }

        $this->assertSame(6, count(array_unique($ids)), 'six identical dates still page cleanly');
    }

    // ---------------------------------------------------------- aggregates

    public function testSummaryCoversTheWholeFilteredSetRatherThanAPage(): void
    {
        $this->seed(['document_no' => 'OUT-1', 'direction' => 'out', 'qty_original' => 500, 'qty_settled' => 200, 'status' => 'partial', 'valuation_rate' => 10]);
        $this->seed(['document_no' => 'OUT-2', 'direction' => 'out', 'qty_original' => 320, 'valuation_rate' => 10]);
        $this->seed(['document_no' => 'IN-1', 'direction' => 'in', 'qty_original' => 430.75, 'valuation_rate' => 10]);

        // One row per page: the aggregate must not follow the pager.
        $this->query()->page($this->filters(), 'document_date', 'asc', 1, 0);
        $summary = $this->query()->summary($this->filters());

        // open = 300 + 320 + 430.75; originals = 500 + 320 + 430.75; settled = 200.
        $this->assertSame(3, $summary['open_lines']);
        $this->assertSame(1050.75, $summary['open_quantity']);
        $this->assertSame(1250.75, $summary['original_qty_total']);
        $this->assertSame(200.0, $summary['settled_qty_total']);
        $this->assertSame(1050.75, $summary['open_qty_total']);
        $this->assertSame(430.75, $summary['inbound_pending'], 'in = owed to us');
        $this->assertSame(620.0, $summary['outbound_pending'], 'out = issued');
        $this->assertSame(189.25, $summary['net_exposure'], 'outbound less inbound');
        $this->assertSame(10507.5, $summary['pending_value'], 'open quantity at ten a unit');
        // All three lines are the same item, so the distinct count is one — the
        // register counts items, not rows.
        $this->assertSame(1, $summary['item_count']);
        $this->assertSame(3, $summary['document_count']);
    }

    public function testSettledTodayCountsLinesThatAreNoLongerOpen(): void
    {
        $pendingId = $this->seed(['qty_original' => 100, 'qty_settled' => 100, 'status' => 'settled']);
        $this->settle($pendingId, 100, date('Y-m-d H:i:s'));
        $older = $this->seed(['document_no' => 'DC-OLDSETTLE', 'qty_original' => 50, 'qty_settled' => 50, 'status' => 'settled']);
        $this->settle($older, 50, date('Y-m-d H:i:s', strtotime('-1 day')));

        $q = $this->query();
        $today = $q->settledOn($this->filters(), date('Y-m-d'));
        $yesterday = $q->settledOn($this->filters(), date('Y-m-d', strtotime('-1 day')));

        $this->assertSame(1, $today['lines'], 'a line settled in full today still counts');
        $this->assertSame(100.0, $today['quantity']);
        $this->assertSame(1, $yesterday['lines']);
        $this->assertSame(50.0, $yesterday['quantity']);
    }

    /**
     * The KPI deltas are only worth showing if the earlier figure was measured.
     * This is the reconstruction that measures it.
     */
    public function testTheComparisonReconstructsThePositionAtAPastDate(): void
    {
        // Raised six weeks ago, half-settled a week ago. A month back it was open
        // in full; today it is open for half.
        $pendingId = $this->seed([
            'days_ago' => 42, 'qty_original' => 100, 'qty_settled' => 50, 'status' => 'partial',
            'valuation_rate' => 10,
        ]);
        $this->settle($pendingId, 50, date('Y-m-d H:i:s', strtotime('-7 days')));

        // Raised three days ago: it did not exist a month back.
        $this->seed(['document_no' => 'DC-NEW', 'days_ago' => 3, 'qty_original' => 80, 'valuation_rate' => 10]);

        $q = $this->query();
        $now = $q->summary($this->filters());
        $then = $q->summaryAsOf($this->filters(), date('Y-m-d', strtotime('-1 month')));

        $this->assertSame(2, $now['open_lines']);
        $this->assertSame(130.0, $now['open_quantity']);

        $this->assertNotNull($then, 'the comparison has to be computable');
        $this->assertSame(1, $then['open_lines'], 'only the older line existed');
        $this->assertSame(100.0, $then['open_quantity'], 'and it was open in full');
        $this->assertSame(1000.0, $then['pending_value']);
    }

    public function testCancelledLinesAreLeftOutOfTheComparisonRatherThanGuessedBack(): void
    {
        $this->seed(['days_ago' => 60, 'qty_original' => 100, 'status' => 'cancelled']);
        $then = $this->query()->summaryAsOf($this->filters(), date('Y-m-d', strtotime('-1 month')));

        $this->assertNotNull($then);
        $this->assertSame(0, $then['open_lines']);
    }

    public function testTheTrendSeriesRunsOldestFirstAndReportsEveryPoint(): void
    {
        $this->seed(['days_ago' => 60, 'qty_original' => 100, 'valuation_rate' => 2]);
        $trend = $this->query()->trend($this->filters(), 6, 7);

        $this->assertCount(6, $trend);
        $dates = array_column($trend, 'date');
        $sorted = $dates;
        sort($sorted);
        $this->assertSame($sorted, $dates, 'oldest first, so a sparkline reads left to right');
        foreach ($trend as $point) {
            $this->assertSame(1, $point['open_lines']);
            $this->assertSame(100.0, $point['open_quantity']);
            $this->assertSame(200.0, $point['pending_value']);
        }
    }

    public function testTheTrendIsEmptyRatherThanWrongWhenThereIsNothingToPlot(): void
    {
        $this->assertSame([], $this->query()->trend($this->filters()));
    }

    public function testBreakdownsGroupTheFilteredSetAndCarryTheIdToDrillOnBySelf(): void
    {
        $this->seed([
            'document_no' => 'W1', 'qty_original' => 300, 'warehouse_id' => $this->warehouse,
            'party_ref' => 88, 'party_name' => 'Sharma Traders', 'valuation_rate' => 10,
        ]);
        $this->seed([
            'document_no' => 'W2', 'qty_original' => 620, 'warehouse_id' => $this->otherWarehouse,
            'pending_kind' => 'job_work', 'item_id' => $this->otherItem, 'valuation_rate' => 10,
        ]);

        $b = $this->query()->breakdowns($this->filters());

        $this->assertSame('North - Noida', $b['warehouse'][0]['label'], 'ranked by open quantity');
        $this->assertSame((string) $this->otherWarehouse, $b['warehouse'][0]['key'], 'the id travels for the drill-down');
        $this->assertSame(620.0, $b['warehouse'][0]['open_quantity']);
        $this->assertSame(6200.0, $b['warehouse'][0]['pending_value']);

        // The party column is the name captured on the document; a line raised
        // without one is grouped as such rather than dropped.
        $partyLabels = array_column($b['party'], 'label');
        $this->assertContains('Sharma Traders', $partyLabels);
        $this->assertContains('No party', $partyLabels);

        // Both kinds are reported, largest first.
        $this->assertSame(['job_work', 'challan'], array_column($b['kind'], 'label'));
        $this->assertSame(['out'], array_column($b['direction'], 'label'));

        // Every ageing bucket is reported, including the empty ones — a
        // distribution with gaps knocked out of it is not a distribution.
        $this->assertSame(
            array_keys(PendingRegisterPolicy::AGEING_BUCKETS),
            array_column($b['ageing'], 'label'),
        );
    }

    public function testHasAnyRowsTellsAnEmptyCompanyApartFromATightFilter(): void
    {
        $q = $this->query();
        $this->assertFalse($q->hasAnyRows(), 'nothing seeded');

        $this->seed(['document_no' => 'SOMETHING']);
        $this->assertTrue($q->hasAnyRows());

        // A filter that matches nothing must not change the answer.
        $page = $q->page($this->filters(['item_search' => 'no such item']), 'document_date', 'asc', 50, 0);
        $this->assertSame(0, $page['total']);
        $this->assertTrue($q->hasAnyRows(), 'still true — the filter was the problem, not the company');
    }

    public function testAnEmptyRegisterAnswersZeroesRatherThanFailing(): void
    {
        $q = $this->query();
        $summary = $q->summary($this->filters());

        $this->assertSame(0, $summary['open_lines']);
        $this->assertSame(0.0, $summary['open_quantity']);
        $this->assertSame(0.0, $summary['net_exposure']);
        $this->assertSame(0.0, $summary['average_ageing_days']);
        $this->assertSame(0, $q->page($this->filters(), 'document_date', 'asc', 50, 0)['total']);
    }

    public function testRowsSurviveAMissingWarehouseAndParty(): void
    {
        $this->seed(['document_no' => 'BARE', 'warehouse_id' => null, 'party_ref' => null]);
        $row = $this->query()->page($this->filters(), 'document_date', 'asc', 50, 0)['rows'][0];

        $this->assertNull($row['warehouse_id']);
        $this->assertNull($row['warehouse_name']);
        $this->assertNull($row['party_ref']);
        $this->assertSame(0.0, $row['pending_value'], 'no rate anywhere means no value, not a crash');
    }
}
