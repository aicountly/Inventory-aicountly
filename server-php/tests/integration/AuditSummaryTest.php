<?php

namespace Tests\Integration;

use App\Controllers\Api\V1\AuditController;
use Tests\Support\IntegrationTestCase;

/**
 * The figures above the audit table, against real SQL.
 *
 * The cards on the Audit screen state counts an auditor may act on, so the one
 * thing that must never happen is a figure that disagrees with the rows
 * underneath it. Both are built from `AuditController::filtered()`, and these
 * tests drive that builder and the aggregates over it directly — with real
 * PostgreSQL, because `COUNT(DISTINCT …)`, a NULL-vs-empty-string reason and a
 * `whereIn` over a comma list are exactly the things a stub would get wrong.
 *
 * @group integration
 */
final class AuditSummaryTest extends IntegrationTestCase
{
    private function seed(array $row): void
    {
        $this->db->table('inv_audit_log')->insert(array_merge([
            'cmp_id'      => $this->cmpId,
            'entity_type' => 'document',
            'entity_id'   => 1,
            'action'      => 'document.post',
            'actor_uuid'  => '7',
            'source_app'  => 'books',
            'reason'      => null,
            'created_at'  => '2026-09-16 10:15:00',
        ], $row));
    }

    /**
     * The controller's private query builder, driven by a request carrying the
     * given query parameters.
     *
     * The parameters go in through `setGlobal` rather than by assigning `$_GET`:
     * PHPUnit backs the superglobals up and restores them around every test, and
     * a filter that silently arrives empty on the second test of a run is a test
     * that passes alone and lies in the suite.
     */
    private function filtered(array $get)
    {
        $request = \Config\Services::request(null, false);
        $request->setGlobal('get', $get);
        $controller = new AuditController();

        $property = new \ReflectionProperty(\CodeIgniter\Controller::class, 'request');
        $property->setAccessible(true);
        $property->setValue($controller, $request);

        $method = new \ReflectionMethod(AuditController::class, 'filtered');
        $method->setAccessible(true);

        return [$controller, $method->invoke($controller, $this->cmpId)];
    }

    private function call(object $controller, string $name, array $args)
    {
        $method = new \ReflectionMethod(AuditController::class, $name);
        $method->setAccessible(true);

        return $method->invokeArgs($controller, $args);
    }

    public function testTheSummaryCountsTheSameRowsTheListWouldReturn(): void
    {
        $this->seed(['action' => 'document.post', 'actor_uuid' => '7']);
        $this->seed(['action' => 'document.create', 'actor_uuid' => '7']);
        $this->seed(['action' => 'item.update', 'actor_uuid' => '9', 'source_app' => 'inventory', 'entity_type' => 'item']);
        // Another company's write must never be counted into this one's figures.
        $this->seed(['cmp_id' => $this->cmpId + 1, 'action' => 'document.post', 'actor_uuid' => '99']);

        [, $builder] = $this->filtered([]);
        $agg = (clone $builder)
            ->select('COUNT(*) AS total, COUNT(DISTINCT actor_uuid) AS actors, COUNT(DISTINCT source_app) AS source_apps, COUNT(DISTINCT action) AS event_types, COUNT(DISTINCT entity_type) AS entity_types', false)
            ->get()
            ->getRowArray();

        $this->assertSame(3, (int) $agg['total']);
        $this->assertSame(2, (int) $agg['actors']);
        $this->assertSame(2, (int) $agg['source_apps']);
        $this->assertSame(3, (int) $agg['event_types']);
        $this->assertSame(2, (int) $agg['entity_types']);
    }

    public function testAFilterNarrowsTheFiguresExactlyAsItNarrowsTheRows(): void
    {
        $this->seed(['action' => 'document.post', 'actor_uuid' => '7']);
        $this->seed(['action' => 'document.post', 'actor_uuid' => '9']);
        $this->seed(['action' => 'item.update', 'actor_uuid' => '7', 'entity_type' => 'item']);

        [, $builder] = $this->filtered(['actor_uuid' => '7']);
        $this->assertSame(2, (clone $builder)->countAllResults(false));

        [, $byAction] = $this->filtered(['action' => 'document.post']);
        $this->assertSame(2, (clone $byAction)->countAllResults(false));
    }

    /** A comma list is an IN — the row menu's "filter by these two actions". */
    public function testACommaSeparatedFilterMatchesAnyOfTheValues(): void
    {
        $this->seed(['action' => 'document.post']);
        $this->seed(['action' => 'document.create']);
        $this->seed(['action' => 'item.update', 'entity_type' => 'item']);

        [, $builder] = $this->filtered(['action' => 'document.post,document.create']);
        $this->assertSame(2, (clone $builder)->countAllResults(false));
    }

    /**
     * "Without a reason" has to mean both ways a reason can be absent. A row
     * written with an empty string is not a row that carries an explanation,
     * and an investigation filtering for unexplained changes must see it.
     */
    public function testTheReasonFilterTreatsNullAndEmptyAlike(): void
    {
        $this->seed(['reason' => 'rate corrected']);
        $this->seed(['reason' => null]);
        $this->seed(['reason' => '']);

        [, $with] = $this->filtered(['has_reason' => '1']);
        $this->assertSame(1, (clone $with)->countAllResults(false));

        [, $without] = $this->filtered(['has_reason' => '0']);
        $this->assertSame(2, (clone $without)->countAllResults(false));
    }

    public function testTheFacetsListDistinctValuesCommonestFirst(): void
    {
        $this->seed(['action' => 'document.post']);
        $this->seed(['action' => 'document.post']);
        $this->seed(['action' => 'document.create']);
        // A NULL source app is not a distinct value; it is the absence of one.
        $this->seed(['action' => 'reconciliation.run', 'source_app' => null]);

        [$controller, $builder] = $this->filtered([]);
        $actions = $this->call($controller, 'facet', [$builder, 'action', 150]);

        $this->assertSame('document.post', $actions[0]['value']);
        $this->assertSame(2, $actions[0]['count']);
        $this->assertCount(3, $actions);

        $sources = $this->call($controller, 'facet', [$builder, 'source_app', 150]);
        $this->assertSame([['value' => 'books', 'count' => 3]], $sources);
    }

    /**
     * The delta chip compares this period with the one immediately before it.
     * It is only ever drawn from a real count over a real window — which is why
     * the method refuses to answer without both ends of the period.
     */
    public function testThePreviousWindowIsTheSameLengthImmediatelyBefore(): void
    {
        $this->seed(['created_at' => '2026-09-10 09:00:00']); // in the window
        $this->seed(['created_at' => '2026-09-12 09:00:00']); // in the window
        $this->seed(['created_at' => '2026-09-03 09:00:00']); // in the preceding window
        $this->seed(['created_at' => '2026-08-01 09:00:00']); // older than both

        [$controller] = $this->filtered(['from' => '2026-09-08', 'to' => '2026-09-14']);
        $previous = $this->call($controller, 'previousWindowTotal', [
            $this->cmpId,
            '2026-09-08 00:00:00',
            '2026-09-14 23:59:59',
        ]);

        $this->assertSame(1, $previous);
    }

    public function testThereIsNoPreviousWindowWithoutBothEndsOfThisOne(): void
    {
        $this->seed([]);
        [$controller] = $this->filtered(['from' => '2026-09-08']);

        $this->assertNull($this->call($controller, 'previousWindowTotal', [$this->cmpId, '2026-09-08 00:00:00', null]));
        $this->assertNull($this->call($controller, 'previousWindowTotal', [$this->cmpId, null, null]));
    }

    /**
     * The screen is read-only because the table is. This is the guarantee the
     * whole Audit module rests on, so it is asserted rather than assumed.
     */
    public function testTheAuditTableRefusesUpdatesAndDeletes(): void
    {
        $this->seed([]);

        foreach (['UPDATE inv_audit_log SET reason = \'tampered\'', 'DELETE FROM inv_audit_log'] as $sql) {
            try {
                // Silenced: the driver emits a PHP warning of its own before the
                // exception, and the exception is what this test is reading.
                @$this->db->query($sql);
                $this->fail("expected the append-only trigger to refuse: {$sql}");
            } catch (\Throwable $e) {
                $this->assertStringContainsString('append-only', $e->getMessage());
            }
        }
    }
}
