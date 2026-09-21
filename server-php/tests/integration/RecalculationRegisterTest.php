<?php

namespace Tests\Integration;

use App\Controllers\Api\V1\ValuationController;
use Tests\Support\IntegrationTestCase;

/**
 * The recalculation register's filtering, its KPI figures and its cancel path,
 * against real SQL.
 *
 * The cards above the table state counts someone acts on — a failure count, a
 * success rate, a COGS movement — so the failure that matters most is a figure
 * that disagrees with the rows beneath it. Both are built from
 * `ValuationController::recalcJobQuery()`, and these tests drive that builder
 * and the aggregates over it directly, on PostgreSQL: a comma-separated
 * `whereIn`, a case-insensitive LIKE across a LEFT JOIN, a DATE compared
 * against a timestamp and `COALESCE(SUM(...))` over an empty set are precisely
 * what a stub would get wrong.
 *
 * @group integration
 */
final class RecalculationRegisterTest extends IntegrationTestCase
{
    private int $seq = 0;

    /** @param array<string, mixed> $row */
    private function seed(array $row = []): int
    {
        $this->seq++;
        $this->db->table('inv_valuation_recalc_jobs')->insert(array_merge([
            'cmp_id'              => $this->cmpId,
            'fy_id'               => $this->fyId,
            'item_id'             => null,
            'warehouse_id'        => null,
            'from_date'           => '2026-07-01',
            'trigger_kind'        => 'manual',
            'trigger_document_id' => null,
            'status'              => 'COMPLETED',
            'dry_run'             => 0,
            'affected_line_count' => 10,
            'revised_line_count'  => 8,
            'cogs_delta'          => 100,
            'failure_reason'      => null,
            'remarks'             => null,
            'requested_by'        => 'tester',
            'created_at'          => '2026-09-10 10:00:00',
            'started_at'          => '2026-09-10 10:00:05',
            'finished_at'         => '2026-09-10 10:00:20',
        ], $row));

        return (int) $this->db->insertID();
    }

    /** A controller whose request carries `$get`, and its filtered builder. */
    private function controller(array $get): ValuationController
    {
        $request = \Config\Services::request(null, false);
        $request->setGlobal('get', $get);
        $controller = new ValuationController();
        $property = new \ReflectionProperty(\CodeIgniter\Controller::class, 'request');
        $property->setAccessible(true);
        $property->setValue($controller, $request);

        return $controller;
    }

    private function call(ValuationController $controller, string $name, array $args = []): mixed
    {
        $method = new \ReflectionMethod(ValuationController::class, $name);
        $method->setAccessible(true);

        return $method->invokeArgs($controller, $args);
    }

    /** @return list<int> job ids the register would list, in id order. */
    private function listed(array $get): array
    {
        $controller = $this->controller($get);
        $builder = $this->call($controller, 'recalcJobQuery', [$this->cmpId, $this->fyId, true]);
        $rows = $builder->select('j.job_id')->orderBy('j.job_id', 'ASC')->get()->getResultArray();

        return array_map(static fn ($r) => (int) $r['job_id'], $rows);
    }

    /** The status breakdown the cards show, for the same query. */
    private function counted(array $get): array
    {
        $controller = $this->controller($get);
        $builder = $this->call($controller, 'recalcJobQuery', [$this->cmpId, $this->fyId, false]);
        $rows = $builder->select('j.status, COUNT(*) AS jobs, COALESCE(SUM(j.cogs_delta),0) AS delta', false)
            ->groupBy('j.status')->get()->getResultArray();
        $out = [];
        foreach ($rows as $r) {
            $out[(string) $r['status']] = ['jobs' => (int) $r['jobs'], 'delta' => (float) $r['delta']];
        }

        return $out;
    }

    public function testTheCardsCountTheSameRowsTheTableWouldList(): void
    {
        $a = $this->seed(['status' => 'COMPLETED', 'cogs_delta' => 100]);
        $b = $this->seed(['status' => 'FAILED', 'cogs_delta' => 0, 'failure_reason' => 'Refusing to recalculate: 2 inward line(s) carry no cost to replay.']);
        $c = $this->seed(['status' => 'QUEUED', 'cogs_delta' => 0, 'finished_at' => null, 'started_at' => null]);
        // Another company's job must never reach either the list or the figures.
        $this->seed(['cmp_id' => $this->cmpId + 1, 'status' => 'COMPLETED', 'cogs_delta' => 9999]);

        $this->assertSame([$a, $b, $c], $this->listed([]));
        $counts = $this->counted([]);
        $this->assertSame(1, $counts['COMPLETED']['jobs']);
        $this->assertSame(1, $counts['FAILED']['jobs']);
        $this->assertSame(1, $counts['QUEUED']['jobs']);
        $this->assertEqualsWithDelta(100.0, array_sum(array_column($counts, 'delta')), 0.0001, 'the other company\'s 9,999 is not in this company\'s COGS delta');
    }

    public function testTheStatusFilterNarrowsTheTableButNotTheBreakdown(): void
    {
        $this->seed(['status' => 'COMPLETED']);
        $failed = $this->seed(['status' => 'FAILED']);

        // The rows obey the filter …
        $this->assertSame([$failed], $this->listed(['status' => 'FAILED']));
        // … and the cards deliberately do not, or a reader filtered to Failed
        // would be shown "Completed 0" for a register that has ten of them.
        $counts = $this->counted(['status' => 'FAILED']);
        $this->assertSame(1, $counts['COMPLETED']['jobs']);
        $this->assertSame(1, $counts['FAILED']['jobs']);
    }

    public function testStatusAcceptsTheCommaListTheDashboardLinksWith(): void
    {
        $queued = $this->seed(['status' => 'QUEUED']);
        $running = $this->seed(['status' => 'RUNNING']);
        $this->seed(['status' => 'COMPLETED']);

        $this->assertSame([$queued, $running], $this->listed(['status' => 'QUEUED,RUNNING']));
        // Lower case too: the value travels through a URL and a bookmark.
        $this->assertSame([$queued, $running], $this->listed(['status' => 'queued, running']));
    }

    public function testSearchFindsAJobByItsReferenceItemFailureOrReason(): void
    {
        $pcs = $this->makeUnit();
        $item = $this->makeItem('Dimmer switch', $pcs);
        $wh = $this->makeWarehouse('Mumbai');

        $plain = $this->seed();
        $byItem = $this->seed(['item_id' => $item]);
        $byWarehouse = $this->seed(['warehouse_id' => $wh]);
        $failed = $this->seed(['status' => 'FAILED', 'failure_reason' => 'Refusing to recalculate: 2 inward line(s) carry no cost to replay.']);
        $withReason = $this->seed(['remarks' => "Supplier's revised invoice for July receipts"]);

        // Case-insensitively, across the joined item and warehouse names.
        $this->assertSame([$byItem], $this->listed(['q' => 'dimmer']));
        $this->assertSame([$byWarehouse], $this->listed(['q' => 'MUMBAI']));
        $this->assertSame([$failed], $this->listed(['q' => 'carry no cost']));
        $this->assertSame([$withReason], $this->listed(['q' => 'revised invoice']));
        // The reference on screen is RC-000NN; a reader pastes what they see.
        $this->assertSame([$plain], $this->listed(['q' => 'RC-' . str_pad((string) $plain, 5, '0', STR_PAD_LEFT)]));
        $this->assertSame([$plain], $this->listed(['q' => (string) $plain]));
    }

    public function testSearchTreatsAWildcardAsATypedCharacter(): void
    {
        $this->seed(['remarks' => 'corrected cost']);
        $literal = $this->seed(['remarks' => '100% of the July receipts']);

        // `%` must match a per-cent sign, not every row in the register.
        $this->assertSame([$literal], $this->listed(['q' => '100%']));
    }

    public function testTheDateRangeCanNarrowAnyOfTheThreeStamps(): void
    {
        $early = $this->seed([
            'from_date' => '2026-05-01', 'created_at' => '2026-09-01 09:00:00', 'finished_at' => '2026-09-01 09:05:00',
        ]);
        $late = $this->seed([
            'from_date' => '2026-08-01', 'created_at' => '2026-09-20 09:00:00', 'finished_at' => '2026-09-20 09:05:00',
        ]);

        $this->assertSame([$early], $this->listed(['from' => '2026-09-01', 'to' => '2026-09-10']));
        $this->assertSame([$late], $this->listed(['date_field' => 'finished', 'from' => '2026-09-15', 'to' => '2026-09-25']));
        // The effective date is a DATE. A `to` of exactly that day must INCLUDE it;
        // comparing it against '… 23:59:59' would silently drop the boundary row.
        $this->assertSame([$early], $this->listed(['date_field' => 'effective', 'from' => '2026-05-01', 'to' => '2026-05-01']));
        $this->assertSame([$early, $late], $this->listed(['date_field' => 'effective', 'to' => '2026-08-01']));
    }

    public function testTheAdvancedFiltersEachNarrowTheSetTheyClaimTo(): void
    {
        $live = $this->seed(['dry_run' => 0, 'cogs_delta' => 250, 'trigger_kind' => 'backdated_document']);
        $dry = $this->seed(['dry_run' => 1, 'cogs_delta' => 0, 'trigger_kind' => 'manual']);

        $this->assertSame([$dry], $this->listed(['dry_run' => '1']));
        $this->assertSame([$live], $this->listed(['dry_run' => '0']));
        $this->assertSame([$live], $this->listed(['has_cogs_impact' => '1']));
        $this->assertSame([$live], $this->listed(['trigger_kind' => 'backdated_document']));
    }

    public function testAJobFromAnotherYearIsHiddenUntilAllYearsIsAskedFor(): void
    {
        $thisYear = $this->seed(['fy_id' => $this->fyId]);
        $otherYear = $this->seed(['fy_id' => $this->fyId + 1]);
        // A job the engine queued outside any one year belongs to whichever year
        // is on screen rather than to none, so it is always listed.
        $noYear = $this->seed(['fy_id' => null]);

        $this->assertSame([$thisYear, $noYear], $this->listed([]));
        $this->assertSame([$thisYear, $otherYear, $noYear], $this->listed(['all_fy' => '1']));
    }

    public function testEveryColumnTheRegisterSortsByIsOneTheServerAccepts(): void
    {
        $sortable = new \ReflectionClassConstant(ValuationController::class, 'JOB_SORTABLE');
        $columns = $sortable->getValue();
        $this->seed();
        // Each declared sort key has to be a real column, or the register draws a
        // header that returns a 500 the first time someone clicks it.
        foreach ($columns as $column) {
            $rows = $this->db->table('inv_valuation_recalc_jobs')
                ->select('job_id')->where('cmp_id', $this->cmpId)->orderBy($column, 'DESC')->get()->getResultArray();
            $this->assertCount(1, $rows, "sorting by {$column} must work against the real table");
        }
    }

    public function testCancellingOnlyEverTouchesAJobThatHasNotStarted(): void
    {
        $queued = $this->seed(['status' => 'QUEUED', 'finished_at' => null, 'started_at' => null]);
        $running = $this->seed(['status' => 'RUNNING', 'finished_at' => null]);

        $table = $this->db->table('inv_valuation_recalc_jobs');
        // The guarded write the controller performs: by id AND by status, so a
        // worker picking the job up between the read and the write cannot have a
        // RUNNING replay turned into a CANCELLED row behind it.
        $table->where('job_id', $queued)->where('cmp_id', $this->cmpId)->where('status', 'QUEUED')
            ->update(['status' => 'CANCELLED', 'cancelled_by' => 'tester', 'finished_at' => date('Y-m-d H:i:s')]);
        $this->assertSame(1, $this->db->affectedRows());

        $table->where('job_id', $running)->where('cmp_id', $this->cmpId)->where('status', 'QUEUED')
            ->update(['status' => 'CANCELLED', 'cancelled_by' => 'tester']);
        $this->assertSame(0, $this->db->affectedRows(), 'a running replay is never cancelled out from under itself');

        $after = $this->db->table('inv_valuation_recalc_jobs')->whereIn('job_id', [$queued, $running])->orderBy('job_id')->get()->getResultArray();
        $this->assertSame('CANCELLED', $after[0]['status']);
        $this->assertSame('tester', $after[0]['cancelled_by']);
        $this->assertSame('RUNNING', $after[1]['status']);
        $this->assertNull($after[1]['cancelled_by']);
    }

    public function testTheReasonGivenForARecalculationIsStoredOnTheJob(): void
    {
        $service = new \App\Services\RecalculationService();
        $withReason = $service->enqueue($this->cmpId, $this->fyId, null, '2026-07-01', 'manual', null, 'tester', true, 'Supplier revised the July invoice.');
        // Every existing caller — the posting engine, the reversal path, the
        // carry-forward — passes no reason and must be unaffected.
        $withoutReason = $service->enqueue($this->cmpId, $this->fyId, null, '2026-07-01', 'backdated_document', null, null);

        $rows = $this->db->table('inv_valuation_recalc_jobs')->whereIn('job_id', [$withReason, $withoutReason])->orderBy('job_id')->get()->getResultArray();
        $this->assertSame('Supplier revised the July invoice.', $rows[0]['remarks']);
        $this->assertSame(1, (int) $rows[0]['dry_run']);
        $this->assertNull($rows[1]['remarks']);
    }
}
