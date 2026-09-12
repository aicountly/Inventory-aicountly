<?php

namespace Tests\Integration;

use App\Services\Migration\SequenceResetter;
use App\Services\Migration\TableMap;
use Tests\Support\IntegrationTestCase;

/**
 * A regression test for a real defect found rehearsing a second migration batch on top of an
 * already-migrated + already-live database: inv_document_lines.line_id and
 * inv_item_openings.opening_id each mix organic, sequence-generated ids with a permanently
 * reserved synthetic offset range (TableMap::LINE_ID_OFFSET_PACKING / _JOB_WORK,
 * TableMap::OPENING_ID_OFFSET_INCEPTION — both 1_000_000_000+) used only for migrated packing /
 * job-work lines and inception openings. A naive "reset the sequence to MAX(column)" — which is
 * exactly what every other inv_* table needs — picks up the synthetic offset instead of the true
 * organic high-water mark once any row sits in that range. Every document line or opening created
 * afterwards then allocates ids inside the space reserved for a later migration batch's own
 * packing / job-work lines (or inception openings) for a *different* company, colliding with it.
 *
 * @group integration
 */
final class SequenceResetterOffsetTest extends IntegrationTestCase
{
    public function testDocumentLinesSequenceIgnoresTheReservedPackingAndJobWorkOffsets(): void
    {
        // One organic (real, application-created) line and one sitting inside the reserved
        // job-work offset range — exactly what a migrated company's packing/job-work lines
        // look like once TableMap::LINE_ID_OFFSET_JOB_WORK is added to their legacy line id.
        $this->insertDocumentLine(500);
        $this->insertDocumentLine(TableMap::LINE_ID_OFFSET_JOB_WORK + 19);

        $rows = (new SequenceResetter($this->db))->resetAll('inv_');
        $row = $this->rowFor($rows, 'inv_document_lines');

        $this->assertSame(500, $row['max_id'], 'the reserved offset row must not be treated as the organic max');
        $this->assertSame(501, $row['next'], 'the sequence must continue from the organic max, not the offset');
        $this->assertLessThan(TableMap::LINE_ID_OFFSET_PACKING, $row['next']);

        // The row inside the reserved range is still there — resetAll() ignored it when
        // computing the ceiling, it did not remove it. A later insert into that same offset
        // (a second migration batch's own job-work line for a different company) is exactly
        // what this guards: it must land on a name nothing else is using yet, which is only
        // true because the *sequence* never wandered into that range in the first place.
        $this->assertSame(1, (int) $this->db->table('inv_document_lines')->where('line_id', TableMap::LINE_ID_OFFSET_JOB_WORK + 19)->countAllResults());
    }

    public function testItemOpeningsSequenceIgnoresTheReservedInceptionOffset(): void
    {
        $this->insertOpening(200);
        $this->insertOpening(TableMap::OPENING_ID_OFFSET_INCEPTION + 42);

        $rows = (new SequenceResetter($this->db))->resetAll('inv_');
        $row = $this->rowFor($rows, 'inv_item_openings');

        $this->assertSame(200, $row['max_id']);
        $this->assertSame(201, $row['next']);
        $this->assertLessThan(TableMap::OPENING_ID_OFFSET_INCEPTION, $row['next']);
    }

    public function testProbeProvesTheNextIdIsAboveTheOrganicMaxNotTheOffsetRow(): void
    {
        $this->insertDocumentLine(500);
        $this->insertDocumentLine(TableMap::LINE_ID_OFFSET_JOB_WORK + 19);

        // probe() proves the *current* sequence hands out ids above max — same contract as the
        // real command (InventoryMigrateBooks::sequences()), which always calls resetAll() first.
        $resetter = new SequenceResetter($this->db);
        $resetter->resetAll('inv_');
        $probe = $resetter->probe('inv_');
        $row = $this->rowFor($probe, 'inv_document_lines');

        $this->assertTrue($row['ok']);
        $this->assertSame(500, $row['max_id']);
        $this->assertGreaterThan(500, $row['next_value']);
        $this->assertLessThan(TableMap::LINE_ID_OFFSET_PACKING, $row['next_value']);
    }

    /** @param list<array<string, mixed>> $rows */
    private function rowFor(array $rows, string $table): array
    {
        foreach ($rows as $r) {
            if ($r['table'] === $table) {
                return $r;
            }
        }
        $this->fail($table . ' not found in resetAll()/probe() output');
    }

    private function insertDocumentLine(int $lineId): void
    {
        $itemId = $this->makeItem('Seq test item ' . $lineId, $this->makeUnit());
        $doc = $this->docs()->create($this->ctx(), [
            'document_type' => 'STOCK_JOURNAL', 'document_date' => '2026-04-05',
            'lines' => [['item_id' => $itemId, 'warehouse_id' => $this->makeWarehouse(), 'qty' => 1, 'rate' => 1, 'direction' => 'in']],
        ], 'tester', 'inventory');
        $this->db->table('inv_document_lines')->where('document_id', (int) $doc['document_id'])->update(['line_id' => $lineId]);
    }

    private function insertOpening(int $openingId): void
    {
        $itemId = $this->makeItem('Opening seq test ' . $openingId, $this->makeUnit());
        $this->db->table('inv_item_openings')->insert([
            'opening_id' => $openingId, 'cmp_id' => $this->cmpId, 'fy_id' => 0, 'bo_id' => 0,
            'item_id' => $itemId, 'warehouse_id' => null, 'unit_id' => $this->makeUnit(),
            'opening_qty' => 1, 'opening_valuation_rate' => 1, 'created_at' => date('Y-m-d H:i:s'), 'updated_at' => date('Y-m-d H:i:s'),
        ]);
    }

    private function docs(): \App\Services\DocumentService
    {
        return new \App\Services\DocumentService();
    }
}
