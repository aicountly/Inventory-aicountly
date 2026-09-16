<?php

namespace Tests\Integration;

use App\Commands\InventoryBackfillOpeningValue;
use App\Services\DocumentPostingService;
use App\Services\DocumentService;
use App\Services\RecalculationService;
use App\Services\ValuationReplayService;
use CodeIgniter\CLI\CLI;
use Tests\Support\IntegrationTestCase;

require_once __DIR__ . '/../../app/Commands/InventoryBackfillOpeningValue.php';

/**
 * The repair for inv_item_openings rows carrying a real quantity but a zero rate/value — the
 * defect a carry-forward that predates FyCarryForwardService's own valuation left behind (see
 * that command's docblock).
 *
 * @group integration
 */
final class OpeningValueBackfillTest extends IntegrationTestCase
{
    private const FY2 = 6;

    private DocumentService $docs;
    private DocumentPostingService $posting;

    /** @var array<string, mixed>|null */
    private $savedOptions;

    protected function setUp(): void
    {
        parent::setUp();
        $this->docs = new DocumentService();
        $this->posting = new DocumentPostingService($this->docs);
        $ref = new \ReflectionProperty(CLI::class, 'options');
        $ref->setAccessible(true);
        $this->savedOptions = $ref->getValue();
    }

    protected function tearDown(): void
    {
        $ref = new \ReflectionProperty(CLI::class, 'options');
        $ref->setAccessible(true);
        $ref->setValue(null, $this->savedOptions ?? []);
        parent::tearDown();
    }

    private function runCommand(array $options): ?int
    {
        $ref = new \ReflectionProperty(CLI::class, 'options');
        $ref->setAccessible(true);
        $ref->setValue(null, $options);

        return (new \ReflectionClass(InventoryBackfillOpeningValue::class))->newInstanceWithoutConstructor()->run([]);
    }

    private function postDoc(array $payload, ?array $ctx = null): array
    {
        $doc = $this->docs->create($ctx ?? $this->ctx(), $payload, 'tester', 'books');

        return $this->posting->post($this->cmpId, (int) $doc['document_id'], 'tester', ['session' => ['kind' => 'service']]);
    }

    /** Reproduces a real (pre-fix) closing: opening 10 @ 100, +10 @ 120, -15 -> closing 5 @ 120 FIFO. */
    private function seedYearOne(): array
    {
        $pcs = $this->makeUnit();
        $wh = $this->makeWarehouse();
        $item = $this->makeItem('Widget', $pcs, 'FIFO');
        $this->setOpening($item, $pcs, 10, 100, 0, $wh);
        $this->assertSame('POSTED', $this->postDoc([
            'document_type' => 'PURCHASE_RECEIPT', 'document_date' => '2026-04-10', 'source_document_type' => 'books.purchase', 'source_document_id' => 501, 'source_document_no' => 'P-501',
            'lines' => [['item_id' => $item, 'warehouse_id' => $wh, 'unit_id' => $pcs, 'qty' => 10, 'rate' => 120, 'amount' => 1200]],
        ])['status']);
        $this->assertSame('POSTED', $this->postDoc([
            'document_type' => 'SALES_ISSUE', 'document_date' => '2026-04-15', 'source_document_type' => 'books.sales', 'source_document_id' => 900, 'source_document_no' => 'S-1',
            'lines' => [['item_id' => $item, 'warehouse_id' => $wh, 'unit_id' => $pcs, 'qty' => 15, 'rate' => 300, 'amount' => 4500]],
        ])['status']);

        return ['unit' => $pcs, 'wh' => $wh, 'item' => $item];
    }

    /** Writes the exact shape a pre-fix / migrated carry-forward left: real qty, rate/value 0. */
    private function seedBrokenCarryForward(int $item, int $pcs, int $wh, float $qty, int $targetFy = self::FY2, ?int $sourceFy = null): void
    {
        $sourceFy ??= $this->fyId;
        $this->db->table('inv_fy_carryforward_status')->insert([
            'cmp_id' => $this->cmpId, 'source_fy_id' => $sourceFy, 'target_fy_id' => $targetFy, 'bo_id' => 0, 'status' => 'completed',
            'stock_item_count' => 1, 'carried_forward_at' => '2026-08-20 10:57:55', 'carried_forward_by' => 'migration:legacy',
        ]);
        $this->setOpening($item, $pcs, $qty, 0, $targetFy, $wh); // rate 0 -> value 0, exactly the defect shape
    }

    public function testDryRunFindsAndPricesButWritesNothing(): void
    {
        ['unit' => $pcs, 'wh' => $wh, 'item' => $item] = $this->seedYearOne();
        $this->db->table('inv_fy_ranges')->insert(['cmp_id' => $this->cmpId, 'fy_id' => self::FY2, 'fy_start' => '2027-04-01', 'fy_end' => '2028-03-31']);
        $this->seedBrokenCarryForward($item, $pcs, $wh, 5.0);

        $this->runCommand(['company' => $this->cmpId]);

        $row = $this->db->table('inv_item_openings')->where('cmp_id', $this->cmpId)->where('fy_id', self::FY2)->get()->getRowArray();
        $this->assertEqualsWithDelta(0.0, (float) $row['opening_valuation_rate'], 0.0001, 'dry run writes nothing');
        $this->assertEqualsWithDelta(0.0, (float) $row['opening_value'], 0.0001);
        $this->assertSame(0, $this->db->table('inv_valuation_recalc_jobs')->countAllResults());
        $this->assertSame(0, $this->db->table('inv_cost_layers')->where('cmp_id', $this->cmpId)->where('fy_id', self::FY2)->countAllResults());
    }

    public function testRepairsAndReseedsDirectlyWhenTheItemHasNoMovementsYetInTheTargetYear(): void
    {
        ['unit' => $pcs, 'wh' => $wh, 'item' => $item] = $this->seedYearOne();
        $this->db->table('inv_fy_ranges')->insert(['cmp_id' => $this->cmpId, 'fy_id' => self::FY2, 'fy_start' => '2027-04-01', 'fy_end' => '2028-03-31']);
        $this->seedBrokenCarryForward($item, $pcs, $wh, 5.0);

        $this->runCommand(['company' => $this->cmpId, 'apply' => true]);

        $row = $this->db->table('inv_item_openings')->where('cmp_id', $this->cmpId)->where('fy_id', self::FY2)->get()->getRowArray();
        $this->assertEqualsWithDelta(120.0, (float) $row['opening_valuation_rate'], 0.0001, 'FIFO closing cost of year one');
        $this->assertEqualsWithDelta(600.0, (float) $row['opening_value'], 0.0001);
        $this->assertEqualsWithDelta(5.0, (float) $row['opening_qty'], 0.0001, 'quantity is never touched');
        $this->assertSame('FIFO', $row['valuation_method'], 'filled in because it was blank');
        $this->assertSame('backfill:opening-value', $row['updated_by']);

        // No movements existed yet in FY2 for this item, so it is reseeded directly, not queued.
        $this->assertSame(0, $this->db->table('inv_valuation_recalc_jobs')->countAllResults());
        $layer = $this->db->table('inv_cost_layers')->where('cmp_id', $this->cmpId)->where('item_id', $item)->where('layer_kind', 'opening')->get()->getRowArray();
        $this->assertNotNull($layer);
        $this->assertEqualsWithDelta(120.0, (float) $layer['unit_cost'], 0.0001);
        $this->assertEqualsWithDelta(5.0, (float) $layer['qty_remaining'], 0.0001);

        $snap = (new ValuationReplayService())->snapshot($this->cmpId, self::FY2, 0, '2027-04-30');
        $this->assertEqualsWithDelta(600.0, $snap['rows'][0]['stock_value'], 0.0001);

        // Idempotent: nothing left to find, nothing written, nothing queued again.
        $this->runCommand(['company' => $this->cmpId, 'apply' => true]);
        $unchanged = $this->db->table('inv_item_openings')->where('cmp_id', $this->cmpId)->where('fy_id', self::FY2)->get()->getRowArray();
        $this->assertEqualsWithDelta(600.0, (float) $unchanged['opening_value'], 0.0001);
        $this->assertSame(0, $this->db->table('inv_valuation_recalc_jobs')->countAllResults());
    }

    public function testQueuesARecalcJobInsteadOfReseedingWhenMovementsAlreadyExistInTheTargetYear(): void
    {
        // A flat inception opening (100 @ 10), no movements ever posted against it in the source
        // year: the item has NEVER had an "opening" cost layer seeded before — company 54's own
        // shape, where the carry-forward was written by a migration, not by this app's own
        // seedOpeningStock(), so nothing lazily seeded a layer ahead of time.
        $pcs = $this->makeUnit();
        $wh = $this->makeWarehouse();
        $item = $this->makeItem('Untouched Widget', $pcs, 'FIFO');
        $this->setOpening($item, $pcs, 10, 100, 0, $wh);
        $this->db->table('inv_fy_ranges')->insert(['cmp_id' => $this->cmpId, 'fy_id' => self::FY2, 'fy_start' => '2027-04-01', 'fy_end' => '2028-03-31']);
        $this->seedBrokenCarryForward($item, $pcs, $wh, 5.0);

        // A FY2 purchase posts while the opening is still broken: posting's own lazy seed
        // (ValuationEngine::ensureOpeningSeeded) stamps a zero-cost "opening" layer right now,
        // exactly the situation a real company already past its year-end is in.
        $this->assertSame('POSTED', $this->postDoc([
            'document_type' => 'PURCHASE_RECEIPT', 'document_date' => '2027-04-05', 'source_document_type' => 'books.purchase', 'source_document_id' => 601, 'source_document_no' => 'P-601',
            'lines' => [['item_id' => $item, 'warehouse_id' => $wh, 'unit_id' => $pcs, 'qty' => 3, 'rate' => 140, 'amount' => 420]],
        ], ['cmp_id' => $this->cmpId, 'fy_id' => self::FY2, 'bo_id' => 0])['status']);
        $openingLayerBefore = $this->db->table('inv_cost_layers')->where('cmp_id', $this->cmpId)->where('item_id', $item)->where('layer_kind', 'opening')->get()->getRowArray();
        $this->assertNotNull($openingLayerBefore, 'sanity: posting lazily seeded an opening layer from the still-broken FY2 row');
        $this->assertEqualsWithDelta(0.0, (float) $openingLayerBefore['unit_cost'], 0.0001, 'sanity: the lazily-seeded opening layer is stamped at the broken zero cost');

        $this->runCommand(['company' => $this->cmpId, 'apply' => true]);

        $row = $this->db->table('inv_item_openings')->where('cmp_id', $this->cmpId)->where('fy_id', self::FY2)->get()->getRowArray();
        $this->assertEqualsWithDelta(100.0, (float) $row['opening_valuation_rate'], 0.0001, 'the stored row is corrected (flat inception cost, nothing to consume it in the source year)');
        $this->assertEqualsWithDelta(500.0, (float) $row['opening_value'], 0.0001);

        // Movements already existed, so this item is queued for the recalc worker, not reseeded inline.
        $job = $this->db->table('inv_valuation_recalc_jobs')->where('trigger_kind', 'opening_value_backfill')->get()->getRowArray();
        $this->assertNotNull($job);
        $this->assertSame($item, (int) $job['item_id']);
        $this->assertSame(self::FY2, (int) $job['fy_id']);
        $this->assertSame('QUEUED', $job['status']);
        // The command itself never replays inline: the stale zero-cost layer is still there.
        $stillStale = $this->db->table('inv_cost_layers')->where('cmp_id', $this->cmpId)->where('item_id', $item)->where('layer_kind', 'opening')->get()->getRowArray();
        $this->assertEqualsWithDelta(0.0, (float) $stillStale['unit_cost'], 0.0001);

        (new RecalculationService())->run((int) $job['job_id']);
        $fixedLayer = $this->db->table('inv_cost_layers')->where('cmp_id', $this->cmpId)->where('item_id', $item)->where('layer_kind', 'opening')->get()->getRowArray();
        $this->assertEqualsWithDelta(100.0, (float) $fixedLayer['unit_cost'], 0.0001, 'the queued replay re-seeds from the now-correct opening row');
        $snap = (new ValuationReplayService())->snapshot($this->cmpId, self::FY2, 0, '2027-04-30');
        $this->assertEqualsWithDelta(500.0 + 420.0, $snap['rows'][0]['stock_value'], 0.0001, 'carried 5 @ 100 + received 3 @ 140');
    }

    public function testMasterInceptionRowsAreReportedButNeverWrittenEvenWithApply(): void
    {
        $pcs = $this->makeUnit();
        $item = $this->makeItem('No-history Widget', $pcs, 'FIFO');
        $this->setOpening($item, $pcs, 8, 0, 0); // fy_id 0 = master_inception, qty real, rate never set

        $this->runCommand(['company' => $this->cmpId, 'apply' => true]);

        $row = $this->db->table('inv_item_openings')->where('cmp_id', $this->cmpId)->where('fy_id', 0)->get()->getRowArray();
        $this->assertEqualsWithDelta(0.0, (float) $row['opening_valuation_rate'], 0.0001, 'never invented');
        $this->assertEqualsWithDelta(0.0, (float) $row['opening_value'], 0.0001);
        $this->assertEqualsWithDelta(8.0, (float) $row['opening_qty'], 0.0001, 'quantity untouched');
        $this->assertNull($row['updated_by'], 'never touched at all');
        $this->assertSame(0, $this->db->table('inv_valuation_recalc_jobs')->countAllResults());
    }

    public function testAGroupWithNoResolvableSourceYearIsLeftAlone(): void
    {
        $pcs = $this->makeUnit();
        $wh = $this->makeWarehouse();
        $item = $this->makeItem('Orphan Widget', $pcs, 'FIFO');
        // A broken carry-forward row with NO inv_fy_carryforward_status backing it at all.
        $this->setOpening($item, $pcs, 5, 0, self::FY2, $wh);

        $result = $this->runCommand(['company' => $this->cmpId, 'apply' => true]);

        $row = $this->db->table('inv_item_openings')->where('cmp_id', $this->cmpId)->where('fy_id', self::FY2)->get()->getRowArray();
        $this->assertEqualsWithDelta(0.0, (float) $row['opening_value'], 0.0001, 'left alone: no source year could be resolved');
        $this->assertSame(0, $this->db->table('inv_valuation_recalc_jobs')->countAllResults());
        $this->assertSame(EXIT_ERROR, $result, 'an unresolved group is reported as a non-clean exit');
    }

    public function testARowThatReplaysToZeroAnywayIsLeftAloneNotOverwrittenWithAnotherZero(): void
    {
        // Source year itself has no cost history at all: an inception opening with rate 0 and no
        // purchases ever posted against it, so the replay has nothing to price from either.
        $pcs = $this->makeUnit();
        $wh = $this->makeWarehouse();
        $item = $this->makeItem('Costless Widget', $pcs, 'FIFO');
        $this->setOpening($item, $pcs, 5, 0, 0, $wh);
        $this->db->table('inv_fy_ranges')->insert(['cmp_id' => $this->cmpId, 'fy_id' => self::FY2, 'fy_start' => '2027-04-01', 'fy_end' => '2028-03-31']);
        $this->seedBrokenCarryForward($item, $pcs, $wh, 5.0);

        $this->runCommand(['company' => $this->cmpId, 'apply' => true]);

        $row = $this->db->table('inv_item_openings')->where('cmp_id', $this->cmpId)->where('fy_id', self::FY2)->get()->getRowArray();
        $this->assertEqualsWithDelta(0.0, (float) $row['opening_value'], 0.0001, 'a replay that itself yields 0 writes nothing new');
        $this->assertNull($row['updated_by']);
        $this->assertSame(0, $this->db->table('inv_valuation_recalc_jobs')->countAllResults());
    }
}
