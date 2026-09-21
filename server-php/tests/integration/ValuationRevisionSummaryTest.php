<?php

namespace Tests\Integration;

use App\Controllers\Api\V1\ValuationController;
use Tests\Support\IntegrationTestCase;

/**
 * The valuation-revisions screen's filters and its summary aggregates, against real SQL.
 *
 * The cards, the charts and the insight panel on that screen all state figures an operator
 * acts on — they decide whether a COGS re-posting is chased today — so the one thing that
 * must never happen is a figure that disagrees with the rows underneath it. Both are built
 * from `ValuationController::revisionQuery()`, and these tests drive that builder and the
 * controller's own aggregate constants over it.
 *
 * Against real PostgreSQL, because `COUNT(DISTINCT CASE … END)`, a `::date` bucket, a ratio
 * guarded by `NULLIF` and a three-state NULL comparison on `published_at` are exactly the
 * things a stub would get wrong — and getting them wrong is invisible in review.
 *
 * @group integration
 */
final class ValuationRevisionSummaryTest extends IntegrationTestCase
{
    private int $itemA;
    private int $itemB;
    private int $warehouse;
    private int $otherWarehouse;

    protected function setUp(): void
    {
        parent::setUp();
        $unit = $this->makeUnit();
        $this->itemA = $this->makeItem('Steel coil', $unit);
        $this->itemB = $this->makeItem('Spare bearing', $unit);
        $this->db->table('inv_items')->where('item_id', $this->itemA)->update(['item_sku' => 'RM-STEEL-01']);
        $this->db->table('inv_items')->where('item_id', $this->itemB)->update(['item_sku' => 'SPARE-01']);
        $this->warehouse = $this->makeWarehouse('Main');
        $this->otherWarehouse = $this->makeWarehouse('Overflow');
    }

    private function makeJob(string $triggerKind = 'backdated_document'): int
    {
        $this->db->table('inv_valuation_recalc_jobs')->insert([
            'cmp_id' => $this->cmpId, 'fy_id' => $this->fyId, 'from_date' => '2026-06-01',
            'trigger_kind' => $triggerKind, 'status' => 'COMPLETED',
        ]);

        return (int) $this->db->insertID();
    }

    /** One posted document, one line on it, and the revision that revalued that line. */
    private function seedRevision(array $over = []): int
    {
        $o = array_merge([
            'document_type' => 'purchase',
            'document_no'   => 'GRN-1',
            'document_date' => '2026-06-17',
            'bo_id'         => 0,
            'item_id'       => $this->itemA,
            'warehouse_id'  => $this->warehouse,
            'base_qty'      => 100,
            'old_rate'      => 100.0,
            'new_rate'      => 120.0,
            'delta'         => 2000.0,
            'created_at'    => '2026-06-18 10:24:00',
            'published_at'  => null,
            'acknowledged_at' => null,
            'job_id'        => null,
            'source_app'    => 'books',
            'cmp_id'        => $this->cmpId,
        ], $over);

        $this->db->table('inv_documents')->insert([
            'cmp_id' => $o['cmp_id'], 'bo_id' => $o['bo_id'], 'fy_id' => $this->fyId,
            'document_type' => $o['document_type'], 'document_no' => $o['document_no'],
            'document_date' => $o['document_date'], 'status' => 'POSTED', 'source_app' => $o['source_app'],
        ]);
        $documentId = (int) $this->db->insertID();

        $this->db->table('inv_document_lines')->insert([
            'document_id' => $documentId, 'cmp_id' => $o['cmp_id'], 'fy_id' => $this->fyId, 'bo_id' => $o['bo_id'],
            'item_id' => $o['item_id'], 'warehouse_id' => $o['warehouse_id'], 'direction' => 'in',
            'qty' => $o['base_qty'], 'base_qty' => $o['base_qty'],
        ]);
        $lineId = (int) $this->db->insertID();

        $this->db->table('inv_valuation_revisions')->insert([
            'cmp_id' => $o['cmp_id'], 'job_id' => $o['job_id'] ?? $this->makeJob(), 'document_id' => $documentId,
            'line_id' => $lineId, 'source_app' => $o['source_app'],
            'old_valuation_rate' => $o['old_rate'], 'new_valuation_rate' => $o['new_rate'],
            'old_valuation_amount' => $o['old_rate'] * $o['base_qty'], 'new_valuation_amount' => $o['new_rate'] * $o['base_qty'],
            'delta_amount' => $o['delta'], 'published_at' => $o['published_at'],
            'acknowledged_at' => $o['acknowledged_at'], 'created_at' => $o['created_at'],
        ]);

        return (int) $this->db->insertID();
    }

    /** The controller's private filter builder, driven by one request's query parameters. */
    private function filtered(array $get, int $boId = 0)
    {
        $request = \Config\Services::request(null, false);
        $request->setGlobal('get', $get);
        $controller = new ValuationController();

        $property = new \ReflectionProperty(\CodeIgniter\Controller::class, 'request');
        $property->setAccessible(true);
        $property->setValue($controller, $request);

        $method = new \ReflectionMethod(ValuationController::class, 'revisionQuery');
        $method->setAccessible(true);

        return $method->invoke($controller, $this->cmpId, $boId);
    }

    private function idsFor(array $get, int $boId = 0): array
    {
        $rows = $this->filtered($get, $boId)->select('r.revision_id')->orderBy('r.revision_id', 'ASC')->get()->getResultArray();

        return array_map(static fn ($r) => (int) $r['revision_id'], $rows);
    }

    private function totalsFor(array $get, int $boId = 0): array
    {
        return $this->filtered($get, $boId)->select(ValuationController::REVISION_TOTALS_SELECT, false)->get()->getRowArray() ?: [];
    }

    // ------------------------------------------------------------------ Books lifecycle

    public function testTheThreeBooksStatesAreFilterableApart(): void
    {
        $generated = $this->seedRevision(['document_no' => 'D-1']);
        $published = $this->seedRevision(['document_no' => 'D-2', 'published_at' => '2026-06-18 11:00:00']);
        $applied = $this->seedRevision([
            'document_no' => 'D-3', 'published_at' => '2026-06-18 11:00:00', 'acknowledged_at' => '2026-06-18 12:00:00',
        ]);

        $this->assertSame([$generated], $this->idsFor(['books' => 'awaiting']));
        $this->assertSame([$published], $this->idsFor(['books' => 'published']));
        $this->assertSame([$applied], $this->idsFor(['books' => 'acknowledged']));
        // "Awaiting Books" is both of the first two: generated and published-but-unanswered.
        $this->assertSame([$generated, $published], $this->idsFor(['books' => 'unacknowledged']));
        $this->assertSame([$generated, $published, $applied], $this->idsFor([]));
    }

    public function testTheLegacyAcknowledgedFlagStillNarrowsTheList(): void
    {
        $open = $this->seedRevision(['document_no' => 'D-1']);
        $applied = $this->seedRevision(['document_no' => 'D-2', 'acknowledged_at' => '2026-06-18 12:00:00']);

        $this->assertSame([$open], $this->idsFor(['acknowledged' => '0']));
        $this->assertSame([$applied], $this->idsFor(['acknowledged' => '1']));
    }

    public function testAnUnknownBooksValueNarrowsNothingRatherThanEmptyingTheScreen(): void
    {
        $a = $this->seedRevision(['document_no' => 'D-1']);
        $b = $this->seedRevision(['document_no' => 'D-2', 'acknowledged_at' => '2026-06-18 12:00:00']);

        $this->assertSame([$a, $b], $this->idsFor(['books' => 'all']));
        $this->assertSame([$a, $b], $this->idsFor(['books' => 'not-a-state']));
    }

    // ------------------------------------------------------------------ the other filters

    public function testMovementAndThresholdFiltersSelectBySignAndSize(): void
    {
        $up = $this->seedRevision(['document_no' => 'D-1', 'delta' => 2000]);
        $down = $this->seedRevision(['document_no' => 'D-2', 'delta' => -9000, 'new_rate' => 80.0]);
        $flat = $this->seedRevision(['document_no' => 'D-3', 'delta' => 0, 'new_rate' => 100.0]);

        $this->assertSame([$up], $this->idsFor(['delta' => 'increase']));
        $this->assertSame([$down], $this->idsFor(['delta' => 'decrease']));
        $this->assertSame([$flat], $this->idsFor(['delta' => 'none']));
        // The threshold is on the ABSOLUTE movement: a big fall is as much work as a big rise.
        $this->assertSame([$down], $this->idsFor(['min_abs_delta' => '5000']));
        $this->assertSame([$up, $down], $this->idsFor(['min_abs_delta' => '2000']));
    }

    public function testSearchMatchesItemNameSkuOrDocumentNumber(): void
    {
        $steel = $this->seedRevision(['document_no' => 'GRN-9001', 'item_id' => $this->itemA]);
        $bearing = $this->seedRevision(['document_no' => 'SJ-4', 'item_id' => $this->itemB]);

        $this->assertSame([$steel], $this->idsFor(['q' => 'Steel']));
        $this->assertSame([$steel], $this->idsFor(['q' => 'RM-STEEL']));
        $this->assertSame([$bearing], $this->idsFor(['q' => 'SJ-4']));
        $this->assertSame([], $this->idsFor(['q' => 'nothing-matches-this']));
    }

    public function testWarehouseAndDocumentTypeComeFromTheRevaluedLineAndItsDocument(): void
    {
        $main = $this->seedRevision(['document_no' => 'D-1', 'warehouse_id' => $this->warehouse, 'document_type' => 'purchase']);
        $overflow = $this->seedRevision(['document_no' => 'D-2', 'warehouse_id' => $this->otherWarehouse, 'document_type' => 'stock_journal']);

        $this->assertSame([$main], $this->idsFor(['warehouse_id' => (string) $this->warehouse]));
        $this->assertSame([$overflow], $this->idsFor(['document_type' => 'stock_journal']));
    }

    public function testABranchSeesItsOwnRevisionsAndConsolidatedSeesThemAll(): void
    {
        $branchOne = $this->seedRevision(['document_no' => 'D-1', 'bo_id' => 7]);
        $branchTwo = $this->seedRevision(['document_no' => 'D-2', 'bo_id' => 9]);

        $this->assertSame([$branchOne], $this->idsFor([], 7));
        $this->assertSame([$branchTwo], $this->idsFor([], 9));
        // bo_id 0 is consolidated, not "branch zero".
        $this->assertSame([$branchOne, $branchTwo], $this->idsFor([], 0));
    }

    public function testAnotherCompanysRevisionIsNeverCountedIntoThisOne(): void
    {
        $mine = $this->seedRevision(['document_no' => 'D-1']);
        $this->seedRevision(['document_no' => 'D-2', 'cmp_id' => $this->cmpId + 1]);

        $this->assertSame([$mine], $this->idsFor([]));
    }

    public function testTheCreatedRangeBoundsWholeDaysAtBothEnds(): void
    {
        $early = $this->seedRevision(['document_no' => 'D-1', 'created_at' => '2026-06-15 00:00:01']);
        $late = $this->seedRevision(['document_no' => 'D-2', 'created_at' => '2026-06-18 23:59:59']);
        $this->seedRevision(['document_no' => 'D-3', 'created_at' => '2026-06-19 00:00:01']);

        $this->assertSame([$early, $late], $this->idsFor(['from' => '2026-06-15', 'to' => '2026-06-18']));
    }

    // ------------------------------------------------------------------ the aggregates

    public function testTheTotalsDescribeExactlyTheRowsTheListWouldReturn(): void
    {
        $this->seedRevision(['document_no' => 'D-1', 'item_id' => $this->itemA, 'delta' => 2000]);
        $this->seedRevision(['document_no' => 'D-2', 'item_id' => $this->itemA, 'delta' => -500, 'new_rate' => 95.0]);
        $this->seedRevision(['document_no' => 'D-3', 'item_id' => $this->itemB, 'delta' => 0, 'new_rate' => 100.0]);
        $this->seedRevision([
            'document_no' => 'D-4', 'item_id' => $this->itemB, 'delta' => 750,
            'published_at' => '2026-06-18 11:00:00', 'acknowledged_at' => '2026-06-18 12:00:00',
        ]);

        $t = $this->totalsFor([]);
        $this->assertSame(4, (int) $t['revisions']);
        $this->assertEqualsWithDelta(2250.0, (float) $t['net_delta'], 0.0001);
        $this->assertEqualsWithDelta(3250.0, (float) $t['abs_delta'], 0.0001);
        $this->assertSame(2, (int) $t['increased']);
        $this->assertSame(1, (int) $t['decreased']);
        $this->assertSame(1, (int) $t['unchanged']);
        $this->assertSame(2, (int) $t['items_affected']);
        $this->assertSame(2, (int) $t['items_increased']);
        $this->assertSame(1, (int) $t['items_decreased']);
        $this->assertSame(1, (int) $t['acknowledged']);
        $this->assertSame(3, (int) $t['awaiting_publish']);

        // And the filtered totals move with the filter, so a card cannot outlive its rows.
        $narrowed = $this->totalsFor(['delta' => 'increase']);
        $this->assertSame(2, (int) $narrowed['revisions']);
        $this->assertEqualsWithDelta(2750.0, (float) $narrowed['net_delta'], 0.0001);
    }

    public function testTheTimelineBucketsByTheDayARevisionWasCreated(): void
    {
        $this->seedRevision(['document_no' => 'D-1', 'created_at' => '2026-06-16 09:00:00', 'delta' => 100]);
        $this->seedRevision(['document_no' => 'D-2', 'created_at' => '2026-06-16 23:30:00', 'delta' => -100, 'new_rate' => 99.0]);
        $this->seedRevision(['document_no' => 'D-3', 'created_at' => '2026-06-18 08:00:00', 'delta' => 300]);

        $rows = $this->filtered([])
            ->select(ValuationController::REVISION_TIMELINE_SELECT, false)
            ->groupBy('r.created_at::date', false)
            ->orderBy('r.created_at::date', 'ASC', false)
            ->get()->getResultArray();

        $this->assertCount(2, $rows);
        $this->assertSame('2026-06-16', substr((string) $rows[0]['revision_day'], 0, 10));
        $this->assertSame(2, (int) $rows[0]['revisions']);
        $this->assertSame(1, (int) $rows[0]['increased']);
        $this->assertSame(1, (int) $rows[0]['decreased']);
        $this->assertSame(1, (int) $rows[1]['revisions']);
    }

    public function testTheSourceSplitGroupsByTheKindOfDocumentThatCausedIt(): void
    {
        $this->seedRevision(['document_no' => 'D-1', 'document_type' => 'purchase', 'delta' => 2000]);
        $this->seedRevision(['document_no' => 'D-2', 'document_type' => 'purchase', 'delta' => -500, 'new_rate' => 95.0]);
        $this->seedRevision(['document_no' => 'D-3', 'document_type' => 'stock_journal', 'delta' => 300]);

        $rows = $this->filtered([])
            ->select(ValuationController::REVISION_SOURCE_SELECT, false)
            ->groupBy('d.document_type')->orderBy('abs_delta', 'DESC', false)
            ->get()->getResultArray();

        $this->assertCount(2, $rows);
        $this->assertSame('purchase', $rows[0]['document_type']);
        // Gross, not net: a rise and a fall are both work.
        $this->assertEqualsWithDelta(2500.0, (float) $rows[0]['abs_delta'], 0.0001);
        $this->assertEqualsWithDelta(1500.0, (float) $rows[0]['net_delta'], 0.0001);
    }

    public function testTheItemSplitReportsTheLargestRateMoveAndNoneAtAllFromAZeroRate(): void
    {
        // 100 → 141 is a 41% move; the second revision on the same item is smaller.
        $this->seedRevision(['document_no' => 'D-1', 'item_id' => $this->itemA, 'old_rate' => 100.0, 'new_rate' => 141.0, 'delta' => 4100]);
        $this->seedRevision(['document_no' => 'D-2', 'item_id' => $this->itemA, 'old_rate' => 100.0, 'new_rate' => 105.0, 'delta' => 500]);
        // An item priced from nothing has no percentage to report.
        $this->seedRevision(['document_no' => 'D-3', 'item_id' => $this->itemB, 'old_rate' => 0.0, 'new_rate' => 60.0, 'delta' => 6000]);

        $rows = $this->filtered([])
            ->select(ValuationController::REVISION_TOP_ITEM_SELECT, false)
            ->where('l.item_id IS NOT NULL', null, false)
            ->groupBy('l.item_id')->groupBy('i.item_name')->groupBy('i.item_sku')
            ->orderBy('abs_delta', 'DESC', false)
            ->get()->getResultArray();

        $byItem = [];
        foreach ($rows as $row) {
            $byItem[(int) $row['item_id']] = $row;
        }
        $this->assertEqualsWithDelta(41.0, (float) $byItem[$this->itemA]['peak_change_pct'], 0.0001);
        $this->assertSame('RM-STEEL-01', $byItem[$this->itemA]['item_sku']);
        $this->assertNull($byItem[$this->itemB]['peak_change_pct']);
    }

    public function testTheTriggerSplitCountsJobsOnceAndRevisionsEveryTime(): void
    {
        $backdated = $this->makeJob('backdated_document');
        $revaluation = $this->makeJob('revaluation');
        $this->seedRevision(['document_no' => 'D-1', 'job_id' => $backdated, 'delta' => 100]);
        $this->seedRevision(['document_no' => 'D-2', 'job_id' => $backdated, 'delta' => 200]);
        $this->seedRevision(['document_no' => 'D-3', 'job_id' => $revaluation, 'delta' => 50]);

        $rows = $this->filtered([])
            ->join('inv_valuation_recalc_jobs jb', 'jb.job_id = r.job_id', 'left')
            ->select(ValuationController::REVISION_TRIGGER_SELECT, false)
            ->groupBy('jb.trigger_kind')->orderBy('revisions', 'DESC', false)
            ->get()->getResultArray();

        $this->assertSame('backdated_document', $rows[0]['trigger_kind']);
        $this->assertSame(1, (int) $rows[0]['jobs']);
        $this->assertSame(2, (int) $rows[0]['revisions']);
    }
}
