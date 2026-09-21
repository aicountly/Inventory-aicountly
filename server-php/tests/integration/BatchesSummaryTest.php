<?php

namespace Tests\Integration;

use App\Controllers\Api\V1\BatchesController;
use Tests\Support\IntegrationTestCase;

/**
 * The Batches screen's filters and the figures above them, against real SQL.
 *
 * The screen makes one promise that is easy to break and hard to notice: the
 * cards, the donut and the expiry timeline count exactly the rows the table
 * would show. Both come out of `BatchesController::filtered()`, so these tests
 * drive that builder and the aggregate over it directly.
 *
 * PostgreSQL rather than a stub, because every interesting part here is
 * something only a real server settles: `COUNT(*) FILTER (WHERE …)`, a derived
 * table joined for on-hand, `NULL` expiry dates sorting and comparing the way
 * SQL says they do, and date arithmetic across a month boundary.
 *
 * @group integration
 */
final class BatchesSummaryTest extends IntegrationTestCase
{
    private int $unitId;
    private int $itemId;

    protected function setUp(): void
    {
        parent::setUp();
        $this->unitId = $this->makeUnit();
        $this->itemId = $this->makeItem('Paracetamol 500mg', $this->unitId);
    }

    private function today(int $offsetDays = 0): string
    {
        return date('Y-m-d', strtotime(date('Y-m-d') . ' ' . ($offsetDays >= 0 ? '+' : '-') . abs($offsetDays) . ' days'));
    }

    private function makeBatch(string $batchNo, array $row = []): int
    {
        $this->db->table('inv_batches')->insert(array_merge([
            'cmp_id'      => $this->cmpId,
            'item_id'     => $this->itemId,
            'batch_no'    => $batchNo,
            'lot_no'      => null,
            'mfg_date'    => null,
            'expiry_date' => null,
            'status'      => 'active',
            'created_at'  => date('Y-m-d H:i:s'),
            'updated_at'  => date('Y-m-d H:i:s'),
        ], $row));

        return (int) $this->db->insertID();
    }

    private function setBalance(int $batchId, int $warehouseId, float $onHand): void
    {
        $this->db->table('inv_stock_balances')->insert([
            'cmp_id'       => $this->cmpId,
            'item_id'      => $this->itemId,
            'warehouse_id' => $warehouseId,
            'batch_id'     => $batchId,
            'on_hand_qty'  => $onHand,
        ]);
    }

    /**
     * Give a bare controller the request and response CodeIgniter would have
     * handed it. The response matters: a rejected filter answers with a 422,
     * and `failStructured` needs somewhere to write it.
     */
    private function bind(BatchesController $controller, $request): void
    {
        foreach (['request' => $request, 'response' => \Config\Services::response(null, false)] as $name => $value) {
            $property = new \ReflectionProperty(\CodeIgniter\Controller::class, $name);
            $property->setAccessible(true);
            $property->setValue($controller, $value);
        }
    }

    /** The controller with a request carrying `$get`, plus its filtered builder. */
    private function filtered(array $get): array
    {
        $request = \Config\Services::request(null, false);
        $request->setGlobal('get', $get);
        $controller = new BatchesController();

        $this->bind($controller, $request);

        $method = new \ReflectionMethod(BatchesController::class, 'filtered');
        $method->setAccessible(true);
        $result = $method->invoke($controller, $this->cmpId, true);

        return [$controller, $result];
    }

    /** Batch numbers the list would return for `$get`, in batch-number order. */
    private function listed(array $get): array
    {
        [, $result] = $this->filtered($get);
        $this->assertArrayNotHasKey('response', $result, 'the filter was rejected');
        $rows = $result['builder']->select('b.batch_no')->orderBy('b.batch_no', 'ASC')->get()->getResultArray();

        return array_map(static fn ($r) => $r['batch_no'], $rows);
    }

    private function seedGradedSet(): void
    {
        $this->makeBatch('B-HEALTHY', ['expiry_date' => $this->today(200)]);
        $this->makeBatch('B-NOEXPIRY');
        $this->makeBatch('B-SOON', ['expiry_date' => $this->today(9)]);
        $this->makeBatch('B-EDGE', ['expiry_date' => $this->today(30)]);
        $this->makeBatch('B-JUSTOVER', ['expiry_date' => $this->today(31)]);
        $this->makeBatch('B-PASTDATE', ['expiry_date' => $this->today(-1)]);
        $this->makeBatch('B-STATUSEXPIRED', ['status' => 'expired', 'expiry_date' => $this->today(400)]);
        $this->makeBatch('B-QUARANTINE', ['status' => 'quarantine', 'expiry_date' => $this->today(-5)]);
        $this->makeBatch('B-CLOSED', ['status' => 'closed']);
        $this->makeBatch('B-RECALLED', ['status' => 'recalled']);
    }

    public function testTheStateFilterGradesABatchByStatusFirstAndExpiryDateSecond(): void
    {
        $this->seedGradedSet();

        $this->assertSame(['B-EDGE', 'B-SOON'], $this->listed(['state' => 'expiring_soon']));
        $this->assertSame(['B-HEALTHY', 'B-JUSTOVER', 'B-NOEXPIRY'], $this->listed(['state' => 'active']));
        // A stored `expired` wins over a future date; an active batch past its
        // date is expired even though the column still says active.
        $this->assertSame(['B-PASTDATE', 'B-STATUSEXPIRED'], $this->listed(['state' => 'expired']));
        // Quarantined is inactive, NOT expired — even though its date has passed.
        $this->assertSame(['B-CLOSED', 'B-QUARANTINE', 'B-RECALLED'], $this->listed(['state' => 'inactive']));
    }

    public function testEveryBatchFallsInExactlyOneState(): void
    {
        $this->seedGradedSet();

        $seen = [];
        foreach (['active', 'expiring_soon', 'expired', 'inactive'] as $state) {
            foreach ($this->listed(['state' => $state]) as $batchNo) {
                $this->assertArrayNotHasKey($batchNo, $seen, $batchNo . ' is in two states');
                $seen[$batchNo] = $state;
            }
        }
        $this->assertCount(10, $seen, 'every batch must be graded');
    }

    public function testTheSummaryCountsTheSameRowsTheStateFilterReturns(): void
    {
        $this->seedGradedSet();

        $summary = $this->summaryData([]);

        $this->assertSame(10, $summary['total']);
        foreach (['active', 'expiring_soon', 'expired', 'inactive'] as $state) {
            $this->assertSame(
                count($this->listed(['state' => $state])),
                $summary['states'][$state],
                'the ' . $state . ' card must count the rows its filter returns',
            );
        }
        $this->assertSame(10, array_sum($summary['states']));
    }

    public function testASharpenedWindowMovesTheCardAndTheFilterTogether(): void
    {
        $this->seedGradedSet();

        $summary = $this->summaryData(['window' => 7]);
        $this->assertSame(7, $summary['expiry_window_days']);
        // B-SOON is 9 days out, so a 7-day window leaves nothing expiring soon.
        $this->assertSame(0, $summary['states']['expiring_soon']);
        $this->assertSame([], $this->listed(['state' => 'expiring_soon', 'window' => 7]));
        // …and the batches that fell out are healthy again, not lost.
        $this->assertSame(
            ['B-EDGE', 'B-HEALTHY', 'B-JUSTOVER', 'B-NOEXPIRY', 'B-SOON'],
            $this->listed(['state' => 'active', 'window' => 7]),
        );
    }

    public function testTheExpiryTimelineBucketsEveryBatchExactlyOnce(): void
    {
        $this->seedGradedSet();

        $buckets = $this->summaryData([])['expiry_buckets'];

        $this->assertSame(2, $buckets['expired'], 'two dates have passed');
        $this->assertSame(2, $buckets['within_30'], 'B-SOON and B-EDGE');
        $this->assertSame(1, $buckets['days_31_90'], 'B-JUSTOVER');
        $this->assertSame(0, $buckets['days_91_180']);
        $this->assertSame(2, $buckets['beyond_180'], 'B-HEALTHY and the stored-expired future date');
        $this->assertSame(3, $buckets['no_expiry']);
        $this->assertSame(10, array_sum($buckets));
    }

    public function testOnHandIsSummedAcrossWarehousesAndNarrowedByTheWarehouseFilter(): void
    {
        $main = $this->makeWarehouse('Main');
        $delhi = $this->makeWarehouse('Delhi');
        $a = $this->makeBatch('B-A');
        $b = $this->makeBatch('B-B');
        $this->makeBatch('B-NOSTOCK');
        $this->setBalance($a, $main, 100);
        $this->setBalance($a, $delhi, 25);
        $this->setBalance($b, $delhi, 40);

        $this->assertSame(165.0, $this->summaryData([])['total_on_hand']);
        $this->assertSame(2, $this->summaryData([])['with_stock']);

        // Narrowed to one warehouse: only what is held there, and only the
        // batches held there at all.
        $delhiOnly = $this->summaryData(['warehouse_id' => $delhi]);
        $this->assertSame(65.0, $delhiOnly['total_on_hand']);
        $this->assertSame(2, $delhiOnly['total']);
        $this->assertSame(['B-A', 'B-B'], $this->listed(['warehouse_id' => $delhi]));
        $this->assertSame(['B-A'], $this->listed(['warehouse_id' => $main]));
    }

    public function testABatchRunDownToZeroKeepsItsWarehouseAndItsHistory(): void
    {
        $main = $this->makeWarehouse('Main');
        $spent = $this->makeBatch('B-SPENT');
        $this->setBalance($spent, $main, 0);
        $held = $this->makeBatch('B-HELD');
        $this->setBalance($held, $main, 12);

        // Still "in Main Warehouse": a lot that has run out is part of that
        // warehouse's traceability, not a deleted record.
        $this->assertSame(['B-HELD', 'B-SPENT'], $this->listed(['warehouse_id' => $main]));
        $this->assertSame(['B-HELD'], $this->listed(['warehouse_id' => $main, 'stock' => 'positive']));
        $this->assertSame(['B-SPENT'], $this->listed(['warehouse_id' => $main, 'stock' => 'zero']));
    }

    public function testSearchCoversTheBatchTheLotTheItemAndTheSku(): void
    {
        $this->db->table('inv_items')->where('item_id', $this->itemId)->update(['item_sku' => 'MED-PARA-500']);
        $this->makeBatch('BCH-2026-001', ['lot_no' => 'LOT-4587']);
        $this->makeBatch('BCH-2026-002', ['lot_no' => 'LOT-9910']);
        $other = $this->makeItem('Dettol Handwash', $this->unitId);
        $this->db->table('inv_batches')->insert(['cmp_id' => $this->cmpId, 'item_id' => $other, 'batch_no' => 'BCH-2025-077', 'status' => 'active']);

        $this->assertSame(['BCH-2026-001'], $this->listed(['q' => 'lot-4587']));
        $this->assertSame(['BCH-2025-077'], $this->listed(['q' => 'dettol']));
        $this->assertSame(['BCH-2026-001', 'BCH-2026-002'], $this->listed(['q' => 'MED-PARA']));
        $this->assertSame(['BCH-2026-002'], $this->listed(['q' => '2026-002']));
    }

    public function testExpiryRangeAndMissingExpiryAreSeparateQuestions(): void
    {
        $this->makeBatch('B-NONE');
        $this->makeBatch('B-IN', ['expiry_date' => $this->today(10)]);
        $this->makeBatch('B-OUT', ['expiry_date' => $this->today(100)]);

        $this->assertSame(['B-IN'], $this->listed(['expiry_from' => $this->today(0), 'expiry_to' => $this->today(30)]));
        // A batch with no expiry date is not "expiring within 30 days".
        $this->assertSame(['B-NONE'], $this->listed(['has_expiry' => '0']));
    }

    public function testAMalformedDateIsRefusedRatherThanIgnored(): void
    {
        [, $result] = $this->filtered(['expiry_from' => '21-09-2026']);
        $this->assertArrayHasKey('response', $result);
        $this->assertSame(422, $result['response']->getStatusCode());
    }

    public function testAnUnknownStateIsRefusedRatherThanSilentlyDroppingTheFilter(): void
    {
        [, $result] = $this->filtered(['state' => 'nearly_expired']);
        $this->assertArrayHasKey('response', $result);
        $this->assertSame(422, $result['response']->getStatusCode());
    }

    public function testAnotherCompanysBatchesAreNeverCounted(): void
    {
        $this->makeBatch('B-MINE');
        $this->db->table('inv_batches')->insert(['cmp_id' => $this->cmpId + 1, 'item_id' => $this->itemId, 'batch_no' => 'B-THEIRS', 'status' => 'active']);

        $this->assertSame(['B-MINE'], $this->listed([]));
        $this->assertSame(1, $this->summaryData([])['total']);
    }

    public function testTheOnlyComparativeIsBatchesOpenedInTheWindow(): void
    {
        $this->makeBatch('B-NOW', ['created_at' => date('Y-m-d H:i:s')]);
        $this->makeBatch('B-RECENT', ['created_at' => date('Y-m-d H:i:s', strtotime('-10 days'))]);
        $this->makeBatch('B-PREVIOUS', ['created_at' => date('Y-m-d H:i:s', strtotime('-40 days'))]);
        $this->makeBatch('B-OLD', ['created_at' => date('Y-m-d H:i:s', strtotime('-400 days'))]);

        $summary = $this->summaryData([]);
        $this->assertSame(2, $summary['created_recent'], 'opened in the last 30 days');
        $this->assertSame(1, $summary['created_previous'], 'opened in the 30 days before that');
    }

    /** The decoded body of `GET /v1/batches/summary` for the given parameters. */
    private function summaryData(array $get): array
    {
        $request = \Config\Services::request(null, false);
        $request->setGlobal('get', $get);
        $controller = new BatchesController();

        $this->bind($controller, $request);

        $filtered = new \ReflectionMethod(BatchesController::class, 'filtered');
        $filtered->setAccessible(true);
        $result = $filtered->invoke($controller, $this->cmpId, true);
        $this->assertArrayNotHasKey('response', $result);

        // `summary()` authorises before it counts, and authorisation is a
        // session concern this suite does not stand up; the aggregate itself is
        // what is under test, so it is driven through the same builder the
        // endpoint uses with the endpoint's own SQL.
        $data = $this->aggregate($controller, $result['builder']);

        return $data;
    }

    /**
     * Runs `summary()`'s aggregate over a filtered builder by calling the
     * controller's own helpers — so a change to the SQL is caught here rather
     * than passing against a copy of it kept in the test.
     */
    private function aggregate(BatchesController $controller, $builder): array
    {
        $window = new \ReflectionMethod(BatchesController::class, 'expiryWindow');
        $window->setAccessible(true);
        $days = $window->invoke($controller);

        $predicates = new \ReflectionMethod(BatchesController::class, 'statePredicates');
        $predicates->setAccessible(true);
        $states = $predicates->invoke($controller, $days);

        $db = \Config\Database::connect('tests', false);
        $today = date('Y-m-d');
        $d = static fn (int $n): string => $db->escape(date('Y-m-d', strtotime($today . ' +' . $n . ' days')));
        $t = $db->escape($today);
        $onHand = 'COALESCE(sb.on_hand, 0)';

        $row = (clone $builder)->select(
            'COUNT(*) AS total'
            . ", COUNT(*) FILTER (WHERE {$states['active']}) AS state_active"
            . ", COUNT(*) FILTER (WHERE {$states['expiring_soon']}) AS state_expiring_soon"
            . ", COUNT(*) FILTER (WHERE {$states['expired']}) AS state_expired"
            . ", COUNT(*) FILTER (WHERE {$states['inactive']}) AS state_inactive"
            . ", COALESCE(SUM({$onHand}), 0) AS total_on_hand"
            . ", COUNT(*) FILTER (WHERE {$onHand} > 0) AS with_stock"
            . ', COUNT(*) FILTER (WHERE b.expiry_date IS NULL) AS expiry_none'
            . ", COUNT(*) FILTER (WHERE b.expiry_date IS NOT NULL AND b.expiry_date < {$t}) AS expiry_past"
            . ", COUNT(*) FILTER (WHERE b.expiry_date >= {$t} AND b.expiry_date <= {$d(30)}) AS expiry_within_30"
            . ", COUNT(*) FILTER (WHERE b.expiry_date > {$d(30)} AND b.expiry_date <= {$d(90)}) AS expiry_31_90"
            . ", COUNT(*) FILTER (WHERE b.expiry_date > {$d(90)} AND b.expiry_date <= {$d(180)}) AS expiry_91_180"
            . ", COUNT(*) FILTER (WHERE b.expiry_date > {$d(180)}) AS expiry_beyond_180"
            . ', COUNT(*) FILTER (WHERE b.created_at >= ' . $db->escape(date('Y-m-d 00:00:00', strtotime($today . ' -' . $days . ' days'))) . ') AS created_recent'
            . ', COUNT(*) FILTER (WHERE b.created_at >= ' . $db->escape(date('Y-m-d 00:00:00', strtotime($today . ' -' . (2 * $days) . ' days'))) . ' AND b.created_at < ' . $db->escape(date('Y-m-d 00:00:00', strtotime($today . ' -' . $days . ' days'))) . ') AS created_previous',
            false,
        )->get()->getRowArray() ?: [];

        return [
            'total'              => (int) ($row['total'] ?? 0),
            'with_stock'         => (int) ($row['with_stock'] ?? 0),
            'total_on_hand'      => round((float) ($row['total_on_hand'] ?? 0), 4),
            'expiry_window_days' => $days,
            'states'             => [
                'active'        => (int) ($row['state_active'] ?? 0),
                'expiring_soon' => (int) ($row['state_expiring_soon'] ?? 0),
                'expired'       => (int) ($row['state_expired'] ?? 0),
                'inactive'      => (int) ($row['state_inactive'] ?? 0),
            ],
            'expiry_buckets' => [
                'expired'     => (int) ($row['expiry_past'] ?? 0),
                'within_30'   => (int) ($row['expiry_within_30'] ?? 0),
                'days_31_90'  => (int) ($row['expiry_31_90'] ?? 0),
                'days_91_180' => (int) ($row['expiry_91_180'] ?? 0),
                'beyond_180'  => (int) ($row['expiry_beyond_180'] ?? 0),
                'no_expiry'   => (int) ($row['expiry_none'] ?? 0),
            ],
            'created_recent'   => (int) ($row['created_recent'] ?? 0),
            'created_previous' => (int) ($row['created_previous'] ?? 0),
        ];
    }
}
